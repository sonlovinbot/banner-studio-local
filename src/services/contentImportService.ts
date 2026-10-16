// URL Import pipeline:
//   1. scrapeUrl(url)             → calls /api/firecrawl-scrape (server proxy) → markdown
//   2. summarizeContent(markdown) → Coachio LLM → ScrapedSummary JSON
//   3. generateBriefs(summary)    → Coachio LLM → BrandBrief[] (10 items, all types)
//
// All LLM calls are client-side (Coachio key in localStorage). Server only
// proxies Firecrawl since that key is admin-shared.

import { getSupabase } from './supabaseClient';
import { chatComplete } from './coachioLLMService';
import { ScrapedSummary, BriefType } from '../types';

// ─── 1. Scrape ───

export interface ScrapeResult {
  url: string;
  markdown: string;
  metadata: {
    title?: string;
    description?: string;
    ogTitle?: string;
    ogDescription?: string;
    sourceURL?: string;
  };
  bytes: number;
}

export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Chưa đăng nhập');

  const res = await fetch('/api/firecrawl-scrape', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url }),
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch {
    throw new Error(`Server trả non-JSON (${res.status})`);
  }
  if (!res.ok || body.error) {
    // If the backend included diagnostic info (key source / masking), surface
    // it inline so the user can see WHICH key was tried + format check.
    let msg = body.error || `HTTP ${res.status}`;
    if (body.diagnostic) {
      const d = body.diagnostic;
      msg += `\n[diag] email=${d.user_email}, admin=${d.is_admin}, src=${d.key_source}, key=${d.key_masked}, format_ok=${d.key_looks_valid_format}`;
    }
    throw new Error(msg);
  }
  return body as ScrapeResult;
}

// ─── 2. Summarize ───

const SUMMARY_PROMPT = `Bạn là chuyên gia performance marketing phân tích landing page để chuẩn bị brief cho banner ads.

Phân tích nội dung markdown được cung cấp và TRẢ VỀ DUY NHẤT một JSON object hợp lệ — KHÔNG markdown wrapper, KHÔNG giải thích:

{
  "brand": "Tên brand / công ty (1-5 từ)",
  "product": "Tên sản phẩm/dịch vụ cụ thể được quảng bá",
  "usp": "Unique Selling Proposition — 1 câu (10-25 từ) nêu rõ value chính",
  "target_audience": "Đối tượng cụ thể: nghề nghiệp, độ tuổi, pain point chính",
  "key_offerings": ["3-7 gạch đầu dòng: giá, ưu đãi, deliverables, ưu đãi sớm, ..."],
  "tone_of_voice": "Phong cách giao tiếp: chuyên nghiệp/thân thiện/aspirational/khẩn cấp/...",
  "notable_elements": ["3-5 yếu tố đáng chú ý: giảng viên, testimonial, số liệu cụ thể, partner, ..."]
}

QUAN TRỌNG:
- Chỉ trả JSON, không \`\`\`json wrapper
- Mọi field tiếng Việt nếu nội dung gốc tiếng Việt
- key_offerings và notable_elements luôn là array (rỗng nếu không có)
- Nếu thông tin không rõ → bỏ field hoặc empty string`;

export async function summarizeContent(markdown: string): Promise<ScrapedSummary> {
  const { text } = await chatComplete([
    { role: 'system', content: SUMMARY_PROMPT },
    {
      role: 'user',
      content: `Phân tích nội dung sau:\n\n${markdown.slice(0, 12000)}`,
    },
  ], { model: 'google/gemini-3.1-flash-lite', max_tokens: 2000 });

  return parseJsonLoosely<ScrapedSummary>(text);
}

// ─── 3. Generate 10 briefs ───

const BRIEF_TYPES: BriefType[] = [
  'offer-emphasis',
  'instructor-authority',
  'catchy-headline',
  'neutral-info',
  'social-proof',
  'urgency-fomo',
  'problem-solution',
  'benefit-led',
  'aspirational',
  'question-hook',
];

const TYPE_LABEL_VI: Record<BriefType, string> = {
  'offer-emphasis':       'Nhấn ưu đãi / giá',
  'instructor-authority': 'Uy tín giảng viên / chuyên gia',
  'catchy-headline':      'Hook mạnh / tiêu đề bắt mắt',
  'neutral-info':         'Thông tin trung tính',
  'social-proof':         'Bằng chứng xã hội / testimonial',
  'urgency-fomo':         'Khẩn cấp / FOMO',
  'problem-solution':     'Pain point + giải pháp',
  'benefit-led':          'Lợi ích cụ thể',
  'aspirational':         'Khát vọng / lifestyle',
  'question-hook':        'Câu hỏi gợi mở',
};

const BRIEFS_PROMPT = `Bạn là creative director cho performance banner ads tiếng Việt.
Mục tiêu: 12 briefs, mỗi brief 1 GÓC NHÌN KHÁC — pain / outcome / myth-bust / persona / feature / transformation / comparison / time-value / community-FOMO / authority-proof / skill-gap / ROI.

TRIẾT LÝ TỐI THƯỢNG (bắt buộc theo):
1. HEADLINE = INSIGHT / PAIN / OUTCOME / HOOK — đọc xong phải quan tâm ngay.
   HEADLINE KHÔNG PHẢI: giá, "còn N suất", "300K community", "10 năm kinh nghiệm" — những cái này là BADGE + BODY hỗ trợ.
2. Social proof / urgency / offer / authority → nhét vào "badges" (chip trên banner) + "body" (copy) → nâng CTR, KHÔNG cướp headline.
3. NHỒI KEYWORD THƯƠNG HIỆU vào headline: Claude Skills · ChatGPT · AI Agent · OpenClaw · n8n · Workshop · Video Motion · Marketing Automation · AI Skills.
4. Ghi THẲNG, không ẩn dụ. TRÁNH: "thợ", "nhạc trưởng", "nâng tầm", "bậc thầy", "làm chủ vận mệnh", "bứt phá".
5. Không đụng chạm nghề (KHÔNG "tạm biệt designer/copywriter"). An toàn: "tạm biệt CapCut", "tạm biệt video editor thuê ngoài".

═══════════════════════════════════════════════════════════════════
CẤU TRÚC MỖI BRIEF:

- angle (slug): "pain-solo-overload" | "myth-bust-video" | "outcome-cost-saving" | ... — bạn tự đặt, mỗi brief 1 slug khác.
- target_persona: 1 câu "Ai đọc" (VD: "Marketer 1 người ôm hết Content + Design + Ads")
- headline: INSIGHT / PAIN / OUTCOME / HOOK — 4-9 từ. Có brand keyword. Không dấu chấm cuối. Có thể dùng ký tự · để tách 2 cụm.
- subline: 1 dòng 10-15 từ giải nghĩa headline. Không lặp headline.
- body: 30-60 từ. Pain/hook 1 câu đầu → giải pháp có brand keyword → 1 con số cụ thể ở cuối. Emoji leading 1 cái.
- cta_text: TEXT tiếng Việt xuất hiện trên nút ("Giữ chỗ miễn phí", "Xem demo live", "Đăng ký ngay") — không dùng "Learn More"
- cta_code: Meta enum để đẩy Meta Ads sau — SHOP_NOW | LEARN_MORE | SIGN_UP | BUY_NOW | BOOK_TRAVEL | DOWNLOAD | CONTACT_US | GET_QUOTE | MESSAGE_PAGE | SUBSCRIBE | WATCH_MORE | GET_OFFER | INSTALL_MOBILE_APP | NO_BUTTON
- badges: MẢNG 2-3 chip. Đây là chỗ đặt urgency/offer/social proof (VD: ["MIỄN PHÍ · 20 SUẤT CUỐI", "300K+ COMMUNITY", "15/08 · 14H"])
- tone_notes: 6-15 từ mô tả PHONG CÁCH VISUAL + COMPOSITION (VD: "split-screen cũ vs mới, palette navy-orange, dấu × trên tools cũ")
═══════════════════════════════════════════════════════════════════

VÍ DỤ HEADLINE ĐÚNG (bám sát công thức trên):
- "VẬN HÀNH MARKETING 1 NGƯỜI · VỚI AI AGENT"
- "BẠN TỪNG NGHĨ CHATGPT/CLAUDE KHÔNG DỰNG NỔI VIDEO?"
- "TIẾT KIỆM 20 TRIỆU/THÁNG TIỀN THUÊ VIDEO EDITOR"
- "QUY TRÌNH THỦ CÔNG → AI SKILLS × CLAUDE/CHATGPT"
- "TẠM BIỆT CAPCUT · TẠM BIỆT VIDEO EDITOR THUÊ NGOÀI"
- "FOUNDER TỰ CHẠY MARKETING BẰNG AI AGENT"
- "LÀM CHỦ CLAUDE SKILLS · TRONG 3 TIẾNG"
- "AI AGENT TỰ CHẠY CONTENT · VIDEO · ADS 24/7"
- "300K MARKETER VIỆT ĐÃ DÙNG AI SKILLS · BẠN CHƯA?"
- "WORKSHOP KHÔNG LÝ THUYẾT · 4 DEMO AI CHẠY LIVE"

VÍ DỤ HEADLINE SAI (đừng bắt chước):
- "GIẢM 50% HÔM NAY" (không có brand keyword)
- "300K+ MARKETER TIN DÙNG" (headline social proof kiểu brag)
- "MASTER AI 30 NGÀY" (dùng "master" sáo)
- "TỪ THỢ → NHẠC TRƯỞNG AI" (metaphor khó hiểu)
- "MARKETING TỰ CHẠY CẢ KHI BẠN NGỦ" (ẩn dụ, không rõ AI Agent)

═══════════════════════════════════════════════════════════════════

TRẢ VỀ DUY NHẤT 1 JSON array 12 phần tử, không markdown wrapper:

[
  {
    "angle": "pain-solo-overload",
    "target_persona": "Marketer 1 người ôm hết Content + Design + Ads",
    "title": "Tên ngắn 5-8 từ cho UI tick chọn",
    "headline": "4-9 TỪ có brand keyword",
    "subline": "10-15 từ giải nghĩa headline",
    "body": "30-60 từ hook → giải pháp brand → con số cụ thể",
    "cta_text": "Text tiếng Việt trên nút",
    "cta_code": "SIGN_UP",
    "badges": ["chip 1", "chip 2"],
    "tone_notes": "PHONG CÁCH VISUAL + COMPOSITION"
  },
  // ... 11 brief khác
]

QUAN TRỌNG:
- 12 brief, 12 angle slug khác nhau
- Mọi field tiếng Việt trừ brand keyword giữ nguyên (Claude Skills, ChatGPT, OpenClaw, n8n, MCP, Meta Ads, Remotion, Vibe Content/Design/Video/Ads)
- Nhồi keyword vào MỌI headline (bắt buộc ít nhất 1 brand keyword/headline)
- badges chỉ chứa nội dung phụ (offer / urgency / social proof / date-time) — TUYỆT ĐỐI KHÔNG lặp headline
- Chỉ JSON, không \`\`\`json wrapper, không giải thích`;

export interface RawBrief {
  /** Free-form angle slug LLM picks (new). Falls back to brief_type from
   *  older LLM responses. Stored in DB as brief_type for backward compat. */
  angle?: string;
  brief_type?: string;
  target_persona?: string;
  title: string;
  primary_message?: string;
  headline?: string;
  /** NEW — one-line explainer under headline (10-15 words). */
  subline?: string;
  /** Body copy (30-60 words). Stored as primary_text in DB. */
  primary_text?: string;
  body?: string;
  /** Meta CTA enum for downstream Meta Ads push. */
  cta?: string;
  cta_code?: string;
  /** Vietnamese CTA button text rendered on the banner. */
  cta_text?: string;
  /** NEW — badge/chip strings (offer / urgency / social proof), max 3. */
  badges?: string[];
  tone_notes?: string;
}

export async function generateBriefs(summary: ScrapedSummary): Promise<RawBrief[]> {
  const summaryText = JSON.stringify(summary, null, 2);
  const { text } = await chatComplete([
    { role: 'system', content: BRIEFS_PROMPT },
    {
      role: 'user',
      content: `Tóm tắt brand:\n${summaryText}\n\nTạo 12 briefs theo triết lý headline = INSIGHT/PAIN/OUTCOME có brand keyword.`,
    },
  ], { model: 'google/gemini-3.1-flash-lite', max_tokens: 8000 });

  const parsed = parseJsonLoosely<RawBrief[]>(text);
  if (!Array.isArray(parsed)) {
    throw new Error('LLM trả về không phải JSON array');
  }

  // Normalize + accept any angle slug (no enum filtering — LLM picks freeform).
  // Legacy responses may use `brief_type` instead of `angle`; body/cta_code
  // migrated to primary_text/cta.
  const cleaned = parsed
    .filter(b => b && (b.headline || b.title))
    .map(b => ({
      ...b,
      angle: b.angle || b.brief_type || 'general',
      brief_type: b.brief_type || b.angle || 'general',
      primary_text: b.primary_text || b.body,
      cta: b.cta || b.cta_code,
      badges: Array.isArray(b.badges) ? b.badges.slice(0, 3) : undefined,
    }))
    .slice(0, 12);

  if (cleaned.length === 0) {
    throw new Error('LLM không trả về brief hợp lệ nào');
  }
  return cleaned;
}

// ─── helpers ───

function parseJsonLoosely<T>(raw: string): T {
  // Strip ```json wrapper + leading/trailing whitespace
  const cleaned = raw
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch (e) {
    // Try extracting the first {...} or [...] block
    const objMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (objMatch) {
      try { return JSON.parse(objMatch[1]) as T; } catch {}
    }
    throw new Error(`Không parse được JSON: ${cleaned.slice(0, 200)}`);
  }
}

// ─── 4. Regenerate 1 brief theo user hint ───

const REGEN_BRIEF_PROMPT = `Bạn là copywriter cho performance banner ads tiếng Việt.
Sinh lại 1 brief từ brief cũ + hướng user muốn sửa.

TRIẾT LÝ:
- Headline = INSIGHT/PAIN/OUTCOME/HOOK, 4-9 từ, có brand keyword (Claude Skills, ChatGPT, AI Agent, OpenClaw, Workshop, Video Motion, Marketing Automation).
- Social proof / urgency / offer / authority → nhét vào badges + body, KHÔNG chiếm headline.
- Ghi thẳng, không ẩn dụ ("thợ", "nhạc trưởng", "bậc thầy", "nâng tầm"). Không đụng chạm nghề.
- badges = mảng 2-3 chip cho urgency/offer/social proof.
- cta_text = text tiếng Việt trên nút ("Giữ chỗ miễn phí", "Xem demo live"). cta_code = Meta enum.

TRẢ VỀ DUY NHẤT 1 JSON object (không array, không markdown wrapper):
{
  "angle": "giữ hoặc đổi slug nếu góc mới",
  "target_persona": "1 câu ai đọc",
  "title": "tên ngắn 5-8 từ cho UI",
  "headline": "4-9 TỪ có brand keyword",
  "subline": "10-15 từ giải nghĩa headline",
  "body": "30-60 từ hook → giải pháp → con số",
  "cta_text": "text tiếng Việt trên nút",
  "cta_code": "SIGN_UP",
  "badges": ["chip 1", "chip 2"],
  "tone_notes": "phong cách visual + composition"
}`;

export async function regenerateBrief(
  currentBrief: {
    briefType?: string;
    title?: string;
    headline?: string;
    primaryText?: string;
    primaryMessage?: string;
    cta?: string;
    toneNotes?: string;
  },
  userHint: string,
): Promise<RawBrief> {
  const briefContext = JSON.stringify({
    brief_type: currentBrief.briefType,
    title: currentBrief.title,
    primary_message: currentBrief.primaryMessage,
    headline: currentBrief.headline,
    primary_text: currentBrief.primaryText,
    cta: currentBrief.cta,
    tone_notes: currentBrief.toneNotes,
  }, null, 2);

  const { text } = await chatComplete([
    { role: 'system', content: REGEN_BRIEF_PROMPT },
    {
      role: 'user',
      content: `Brief hiện tại:\n${briefContext}\n\nUser muốn sửa theo hướng: ${userHint || '(không nêu — sinh biến thể mới cùng type)'}\n\nSinh brief mới.`,
    },
  ], { model: 'google/gemini-3.1-flash-lite', max_tokens: 1500 });

  const parsed = parseJsonLoosely<RawBrief>(text);
  if (!parsed || typeof parsed !== 'object' || !parsed.brief_type) {
    throw new Error('LLM trả về không phải brief hợp lệ');
  }
  return parsed;
}

export { BRIEF_TYPES, TYPE_LABEL_VI };
