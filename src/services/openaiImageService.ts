// OpenAI Images API client — dùng cho tier 2K / 4K khi Coachio bị lỗi hoặc
// chất lượng không đủ. Direct call browser → OpenAI (client-side key).
//
// Warning: API key nằm trong localStorage → visible cho JS khác của trang.
// Production nên proxy qua Vercel Edge để giấu key.
//
// Endpoints:
//   POST https://api.openai.com/v1/images/generations
//   POST https://api.openai.com/v1/images/edits (nếu có reference image)
//
// Model dùng: gpt-image-2 (OpenAI's latest — better typography, better
// non-English text rendering than gpt-image-1).

import { UploadedImage } from '../types';
import { uploadDataUrlToStorage } from './uploadService';
import { getSupabase, isRemoteSupabase } from './supabaseClient';

const OPENAI_API_BASE = 'https://api.openai.com/v1';
const OPENAI_API_KEY_STORAGE = 'openai_api_key';

/** Wrap browser `fetch()` so a network/CORS/extension-block failure surfaces
 *  as a clear message instead of a bare "Failed to fetch" TypeError. Browsers
 *  throw TypeError before any HTTP response when: DNS fails, offline, a Chrome
 *  extension (uBlock/Brave shield) blocks the origin, CSP blocks the request,
 *  or a CORS preflight fails silently. */
async function fetchOpenai(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes('Failed to fetch') || err?.name === 'TypeError') {
      throw new Error(
        'Không kết nối được api.openai.com — kiểm tra: ' +
        '(1) mạng có online không, (2) extension trình duyệt (uBlock / Brave Shields / AdGuard) có chặn openai.com không, ' +
        '(3) CSP hay proxy công ty có block không. Chi tiết gốc: ' + msg,
      );
    }
    throw err;
  }
}

/** Resolve OpenAI key. Priority:
 *  1. localStorage (user-configured via Settings UI)
 *  2. VITE_OPENAI_API_KEY env — bundled at build time; convenient for local dev
 *     & staging demo but visible to any browser client. Production should use
 *     server-side proxy, not this env fallback.
 */
export function getOpenaiApiKey(): string {
  const fromStorage = localStorage.getItem(OPENAI_API_KEY_STORAGE) || '';
  if (fromStorage) return fromStorage;
  const fromEnv = (import.meta.env.VITE_OPENAI_API_KEY as string | undefined) || '';
  return fromEnv.trim();
}

export function setOpenaiApiKey(key: string): void {
  localStorage.setItem(OPENAI_API_KEY_STORAGE, key);
}

export function removeOpenaiApiKey(): void {
  localStorage.removeItem(OPENAI_API_KEY_STORAGE);
}

/** True when the current key came from ENV (not user-saved). Used to show a
 *  hint in Settings so admins know why "Đã lưu" isn't showing. */
export function isOpenaiKeyFromEnv(): boolean {
  const fromStorage = localStorage.getItem(OPENAI_API_KEY_STORAGE) || '';
  if (fromStorage) return false;
  return !!(import.meta.env.VITE_OPENAI_API_KEY as string | undefined);
}

/** Map aspect ratio + quality tier → OpenAI size + quality. Size options
 *  của gpt-image-1: 1024x1024, 1024x1536, 1536x1024, auto. */
export function pickOpenaiSize(aspectRatio: string, qualityTier: string): { size: string; quality: string } {
  // Quality mapping: 2K → medium, 4K → high (cao nhất)
  const quality = qualityTier === '4K' ? 'high' : qualityTier === '2K' ? 'medium' : 'low';

  // Size mapping theo aspect
  const [a, b] = aspectRatio.split(':').map(n => parseInt(n, 10));
  if (!a || !b) return { size: '1024x1024', quality };
  const isPortrait = b > a;
  const isLandscape = a > b;

  if (isPortrait) return { size: '1024x1536', quality };
  if (isLandscape) return { size: '1536x1024', quality };
  return { size: '1024x1024', quality };
}

/** Convert File / UploadedImage → base64 data URL (blocking). */
async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export interface RefSlot {
  /** 'face' dành cho UGC: người trong ảnh phải giữ nguyên danh tính, khác hẳn
   *  'style' (chỉ mượn palette/mood) — gán nhầm role là model đổi mặt. */
  role: 'logo' | 'style' | 'product' | 'face' | 'outfit';
  image: UploadedImage | { url?: string; base64?: string; file?: File; mimeType?: string };
}

async function toBlob(img: RefSlot['image']): Promise<{ blob: Blob; name: string }> {
  // Prefer `file` (has original bytes + name). Fall back to base64 data URL.
  // Last resort: fetch the CDN url and convert.
  if (img.file) {
    return { blob: img.file, name: img.file.name || 'ref.png' };
  }
  const dataUrl = img.base64 || (img.url ? await (await fetch(img.url)).text().then(() => img.url!) : '');
  if (img.url && !img.base64) {
    // Fetch and convert URL → blob.
    const r = await fetch(img.url);
    const blob = await r.blob();
    return { blob, name: 'ref.png' };
  }
  if (!dataUrl) throw new Error('Không load được reference image');
  const [meta, b64] = dataUrl.split(',');
  const mime = meta.match(/data:(.*?);/)?.[1] || 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { blob: new Blob([bytes], { type: mime }), name: 'ref.png' };
}

/** OpenAI /v1/images/edits with MULTI-image reference support (gpt-image-2
 *  accepts `image[]`). Each slot is tagged with its role in the prompt so the
 *  model knows which one is the logo (must preserve) vs style/product refs. */
async function generateWithReferences(
  apiKey: string,
  prompt: string,
  refs: RefSlot[],
  size: string,
  quality: string,
  onProgress?: (msg: string) => void,
): Promise<string> {
  onProgress?.(`Preparing ${refs.length} reference image(s)...`);

  const formData = new FormData();
  formData.append('model', 'gpt-image-2');
  formData.append('n', '1');
  formData.append('size', size);
  formData.append('quality', quality);

  // Describe each ref by role so the prompt can reference them by index.
  const ROLE_LABELS: Record<string, string> = {
    logo: 'BRAND LOGO (must reproduce exactly)',
    style: 'STYLE REFERENCE (match palette, mood, composition)',
    product: 'PRODUCT (feature this exact product)',
    face: 'PERSON (keep this exact face and identity)',
    outfit: 'OUTFIT (dress the person in this exact clothing)',
  };
  const roleLines = refs.map((r, i) =>
    `- image[${i}]: ${ROLE_LABELS[r.role] || ROLE_LABELS.style}`).join('\n');

  const refDirective = [
    'REFERENCE IMAGES (attached, ordered):',
    roleLines,
    '',
    'HOW TO USE THE REFERENCES:',
    '- The image marked BRAND LOGO must be reproduced EXACTLY as-is — same shape, same wordmark, same colors, same proportions. Do NOT redesign, do NOT invent a new logo, do NOT translate the brand name.',
    '- The STYLE REFERENCE(s) dictate the visual system: palette, typography feel, layout rhythm, mood. Do not copy the exact composition — reuse the vibe.',
    '- The PRODUCT reference is the actual item to feature. Preserve its shape and identifying details.',
    '- The PERSON reference defines who appears in the image. Keep the same face, skin tone, hair and build — this must read as the same individual, not a lookalike. Never swap in a different person.',
    '- The OUTFIT reference is the clothing that person wears. Match the garment, its cut and its colors.',
    '- If a role is missing, do not invent one.',
  ].join('\n');

  const finalPrompt = `${refDirective}\n\n${prompt}`;
  formData.append('prompt', finalPrompt);

  for (const r of refs) {
    const { blob, name } = await toBlob(r.image);
    // OpenAI docs: for multi-image, use `image[]` (repeat the same field).
    formData.append('image[]', blob, name);
  }

  onProgress?.('Calling OpenAI /images/edits (multi-ref)...');
  const res = await fetchOpenai(`${OPENAI_API_BASE}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('OpenAI API key không hợp lệ hoặc đã revoke — cập nhật VITE_OPENAI_API_KEY hoặc Settings → OpenAI');
    if (res.status === 402) throw new Error('OpenAI: hết credit / billing — top up tại platform.openai.com/settings/organization/billing');
    if (res.status === 429) throw new Error('OpenAI rate limit — thử lại sau vài giây');
    if (res.status >= 500) throw new Error(`OpenAI server error (${res.status}) — thử lại sau vài phút`);
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const b64Json = data?.data?.[0]?.b64_json;
  if (!b64Json) throw new Error('OpenAI không trả về ảnh (empty response)');

  onProgress?.('Uploading result to CDN...');
  const persistUrl = `data:image/png;base64,${b64Json}`;
  return await persistToLocalOrSupabase(persistUrl, 'image/png', b64Json, onProgress);
}

/** Chuỗi lưu ảnh — thử lần lượt đến khi có URL bền:
 *  1. storage local (qua /api/upload) — đường chính của bản local
 *  2. Supabase Storage bucket `banners` — chỉ khi đang nối Supabase thật
 *  3. Blob URL — phương án cuối; chỉ sống trong phiên, F5 là mất. */
async function persistToLocalOrSupabase(
  persistUrl: string,
  mime: string,
  b64Json: string,
  onProgress?: (msg: string) => void,
): Promise<string> {
  try {
    const uploaded = await uploadDataUrlToStorage(persistUrl, `openai-${Date.now()}.png`, 'banners');
    return uploaded.url;
  } catch (err) {
    console.warn('[openai] storage local upload failed, trying Supabase Storage', err);
  }

  try {
    const url = await uploadToSupabaseStorage(mime, b64Json, onProgress);
    if (url) return url;
  } catch (err) {
    console.warn('[openai] Supabase Storage upload failed, falling back to blob URL', err);
  }

  onProgress?.('CDN unreachable — showing local preview only (will disappear on reload)...');
  const bytes = Uint8Array.from(atob(b64Json), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mime });
  return URL.createObjectURL(blob);
}

/** Direct browser → Supabase Storage upload. Requires:
 *  - Bucket `banners` exists (create in Dashboard → Storage → New bucket)
 *  - Bucket is public (so `<img src>` renders without signed URL)
 *  - User is logged in (RLS scopes upload to their own folder) */
async function uploadToSupabaseStorage(
  mime: string,
  b64Json: string,
  onProgress?: (msg: string) => void,
): Promise<string | null> {
  // Bản local không có Storage bucket — bỏ qua hẳn thay vì gọi rồi nhận 404.
  if (!isRemoteSupabase) return null;
  onProgress?.('Uploading to Supabase Storage...');

  const bytes = Uint8Array.from(atob(b64Json), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mime });
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';

  const sb = getSupabase();
  const { data: userData } = await sb.auth.getUser();
  const userId = userData?.user?.id || 'anon';
  const path = `${userId}/openai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await sb.storage.from('banners').upload(path, blob, {
    contentType: mime,
    upsert: false,
  });
  if (error) {
    console.warn('[supabase-storage] upload error', error);
    return null;
  }
  const { data: pub } = sb.storage.from('banners').getPublicUrl(path);
  return pub?.publicUrl || null;
}

/** OpenAI Image generations endpoint — prompt-only, no reference image. */
async function generateFromPrompt(
  apiKey: string,
  prompt: string,
  size: string,
  quality: string,
  onProgress?: (msg: string) => void,
): Promise<string> {
  onProgress?.('Calling OpenAI /images/generations...');
  const res = await fetchOpenai(`${OPENAI_API_BASE}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt,
      n: 1,
      size,
      quality,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('OpenAI API key không hợp lệ hoặc đã revoke — cập nhật VITE_OPENAI_API_KEY hoặc Settings → OpenAI');
    if (res.status === 402) throw new Error('OpenAI: hết credit / billing — top up tại platform.openai.com/settings/organization/billing');
    if (res.status === 429) throw new Error('OpenAI rate limit — thử lại sau vài giây');
    if (res.status >= 500) throw new Error(`OpenAI server error (${res.status}) — thử lại sau vài phút`);
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const b64Json = data?.data?.[0]?.b64_json;
  if (!b64Json) throw new Error('OpenAI không trả về ảnh (empty response)');

  onProgress?.('Uploading result to CDN...');
  const persistUrl = `data:image/png;base64,${b64Json}`;
  return await persistToLocalOrSupabase(persistUrl, 'image/png', b64Json, onProgress);
}

export interface OpenaiRefBundle {
  /** The official brand logo — required to reproduce exactly. */
  logo?: UploadedImage | { url?: string; base64?: string; file?: File; mimeType?: string } | null;
  /** Style references (palette / mood / composition). */
  styleRefs?: UploadedImage[];
  /** Product reference (the actual item to feature). */
  productRef?: UploadedImage | null;
}

/** Main entry. `bundle` provides the roled references; when empty falls back
 *  to prompt-only /generations. Multi-image support via gpt-image-2 /edits. */
export async function generateBannerWithOpenai(
  bundle: OpenaiRefBundle,
  userPrompt: string,
  brandContent: string,
  aspectRatio: string,
  qualityTier: string,
  onProgress?: (msg: string) => void,
): Promise<string> {
  const apiKey = getOpenaiApiKey();
  if (!apiKey) {
    throw new Error('OpenAI API key chưa cấu hình. Vào Settings → API Keys.');
  }

  const { size, quality } = pickOpenaiSize(aspectRatio, qualityTier);

  const parts = [
    'Task: create a high-quality professional advertising banner image.',
    userPrompt,
    brandContent ? `Additional brand context:\n${brandContent}` : '',
  ].filter(Boolean);
  const fullPrompt = parts.join('\n\n');

  // Build ordered ref list: logo FIRST (so image[0] = logo), then style, then
  // product. gpt-image-2 supports up to 16 image inputs; cap at 6 to keep
  // upload size sane.
  const refs: RefSlot[] = [];
  if (bundle.logo) refs.push({ role: 'logo', image: bundle.logo });
  for (const s of (bundle.styleRefs || []).slice(0, 4)) refs.push({ role: 'style', image: s });
  if (bundle.productRef) refs.push({ role: 'product', image: bundle.productRef });
  const capped = refs.slice(0, 6);

  if (capped.length > 0) {
    return await generateWithReferences(apiKey, fullPrompt, capped, size, quality, onProgress);
  }
  return await generateFromPrompt(apiKey, fullPrompt, size, quality, onProgress);
}


/** UGC qua OpenAI — dùng làm fallback khi Coachio hỏng.
 *
 *  Ba ảnh vào ba role riêng: mặt phải giữ nguyên danh tính, trang phục phải
 *  khớp, sản phẩm phải đúng vật thể. Nhét cả ba vào role 'style' là model chỉ
 *  mượn tông màu rồi vẽ ra người khác. */
export async function generateUgcWithOpenai(
  face: UploadedImage,
  fashion: UploadedImage,
  product: UploadedImage,
  userPrompt: string,
  brandContent: string,
  aspectRatio: string,
  qualityTier: string,
  onProgress?: (msg: string) => void,
): Promise<string> {
  const apiKey = getOpenaiApiKey();
  if (!apiKey) {
    throw new Error('OpenAI API key chưa cấu hình. Vào Settings → API Keys.');
  }

  const { size, quality } = pickOpenaiSize(aspectRatio, qualityTier);
  const prompt = [
    'Task: create a photorealistic UGC-style lifestyle photo — the kind a real customer would post.',
    'The person from the PERSON reference wears the OUTFIT reference and presents the PRODUCT reference naturally.',
    'Natural lighting, candid framing, believable setting. Not a studio product shot, not a poster.',
    userPrompt,
    brandContent ? `Additional brand context:\n${brandContent}` : '',
  ].filter(Boolean).join('\n\n');

  const refs: RefSlot[] = [
    { role: 'face', image: face },
    { role: 'outfit', image: fashion },
    { role: 'product', image: product },
  ];

  return generateWithReferences(apiKey, prompt, refs, size, quality, onProgress);
}
