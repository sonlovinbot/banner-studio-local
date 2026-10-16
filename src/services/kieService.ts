// KIE.ai — một cổng API gom nhiều model của nhiều hãng (Google Nano Banana,
// Veo, Suno...) về cùng một giao thức. Dùng nó thì thêm model mới chỉ là đổi
// chuỗi `model`, không phải viết lại client cho từng hãng.
//
// Luồng của KIE là BẤT ĐỒNG BỘ:
//   1. POST /api/kie/create          -> taskId
//   2. GET  /api/kie/task?taskId=..  -> state: waiting|queuing|generating|success|fail
//   3. state=success -> danh sách URL ảnh
//
// Cả hai bước đi qua server local (xem server/apiRoutes.mjs) vì KIE không bật
// CORS cho trình duyệt, và để API key không lọt vào bundle front-end.
//
// GIỚI HẠN CÓ Ý: ở đây KIE chỉ dùng cho TEXT-TO-IMAGE, không nhận ảnh
// reference. Lý do: KIE tải ảnh reference bằng cách GET một URL công khai,
// còn ảnh của bản local nằm ở http://localhost — máy chủ của họ không với tới
// được. Cần đi từ ảnh mẫu thì dùng Coachio hoặc OpenAI.

export interface KieModel {
  id: string;
  label: string;
  note: string;
}

/** Các model ảnh dùng được. Danh sách đầy đủ: https://docs.kie.ai */
export const KIE_IMAGE_MODELS: KieModel[] = [
  { id: 'google/nano-banana',     label: 'Nano Banana',     note: 'Rẻ nhất, đủ dùng cho hầu hết banner' },
  { id: 'google/nano-banana-pro', label: 'Nano Banana Pro', note: 'Chi tiết và chữ tốt hơn, đắt hơn' },
  { id: 'google/nano-banana-2',   label: 'Nano Banana 2',   note: 'Bản mới, hỗ trợ ảnh 4K' },
];

export const DEFAULT_KIE_MODEL = KIE_IMAGE_MODELS[0].id;

const KIE_KEY_STORAGE = 'bannerAds:kieApiKey';

export function getKieApiKey(): string {
  const fromEnv = import.meta.env.VITE_KIE_API_KEY as string | undefined;
  if (fromEnv?.trim()) return fromEnv.trim();
  try { return localStorage.getItem(KIE_KEY_STORAGE) || ''; } catch { return ''; }
}

export function setKieApiKey(key: string): void {
  try { localStorage.setItem(KIE_KEY_STORAGE, key.trim()); } catch { /* storage bị chặn */ }
}

export function removeKieApiKey(): void {
  try { localStorage.removeItem(KIE_KEY_STORAGE); } catch { /* storage bị chặn */ }
}

/** Đồng bộ key xuống DB để server local (và MCP) đọc được. Trình duyệt giữ
 *  key trong localStorage, nhưng server chạy ở tiến trình khác nên không thấy. */
export async function syncKieKeyToServer(key: string | null): Promise<void> {
  await fetch('/api/user-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kie_api_key: key }),
  });
}

/** Nạp key đã lưu ở DB vào localStorage lúc mở app. */
export async function bootstrapKieKeyFromServer(): Promise<string | null> {
  try {
    const res = await fetch('/api/user-keys');
    if (!res.ok) return null;
    const data = await res.json();
    const key = data?.kie_api_key || null;
    if (key && !getKieApiKey()) setKieApiKey(key);
    return key;
  } catch {
    return null;
  }
}

interface KieTask {
  taskId: string;
  state: 'waiting' | 'queuing' | 'generating' | 'success' | 'fail' | 'unknown';
  urls: string[];
  failMsg: string | null;
  creditsConsumed: number | null;
  costTime: number | null;
}

async function postJson(path: string, body: unknown): Promise<any> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `${path} lỗi ${res.status}`);
  return data;
}

const POLL_INTERVAL_MS = 3000;
/** 5 phút. Ảnh của KIE thường xong trong 10-60s; quá 5 phút coi như treo. */
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export interface KieGenOptions {
  model?: string;
  aspectRatio?: string;
  outputFormat?: 'png' | 'jpeg';
  onProgress?: (msg: string) => void;
  /** Tải ảnh về ./data/uploads thay vì giữ URL tạm của KIE. Mặc định bật —
   *  URL của họ sẽ hết hạn, lưu vào lịch sử thì sau này ảnh hỏng. */
  mirror?: boolean;
}

/** Sinh một ảnh từ prompt. Trả về URL dùng được để lưu vào lịch sử. */
export async function generateImageWithKie(
  prompt: string,
  opts: KieGenOptions = {},
): Promise<string> {
  const {
    model = DEFAULT_KIE_MODEL,
    aspectRatio = '1:1',
    outputFormat = 'png',
    onProgress,
    mirror = true,
  } = opts;

  onProgress?.(`Gửi yêu cầu tới KIE (${model})...`);
  const { taskId } = await postJson('/api/kie/create', {
    model,
    input: { prompt, aspect_ratio: aspectRatio, output_format: outputFormat },
  });

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastState = '';
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`/api/kie/task?taskId=${encodeURIComponent(taskId)}`);
    const task = await res.json().catch(() => ({})) as KieTask & { error?: string };
    if (!res.ok) throw new Error(task?.error || `Hỏi trạng thái task lỗi ${res.status}`);

    if (task.state !== lastState) {
      lastState = task.state;
      onProgress?.(`KIE: ${STATE_LABELS[task.state] || task.state}...`);
    }

    if (task.state === 'fail') {
      throw new Error(task.failMsg || 'KIE báo task thất bại (không kèm lý do)');
    }
    if (task.state === 'success') {
      const url = task.urls?.[0];
      if (!url) throw new Error('KIE báo thành công nhưng không trả URL ảnh');
      if (!mirror) return url;

      onProgress?.('Tải ảnh về máy...');
      try {
        const saved = await postJson('/api/fetch-to-storage', { url, folder: 'banners' });
        return saved.url;
      } catch (e) {
        // Giữ URL của KIE còn hơn là làm vỡ cả lần sinh ảnh — chỉ là nó sẽ
        // hết hạn sau ít ngày.
        console.warn('[kie] không tải được ảnh về, dùng URL tạm của KIE', e);
        return url;
      }
    }
  }

  throw new Error(`Hết 5 phút chờ KIE (taskId=${taskId}). Task có thể vẫn đang chạy — kiểm tra ở kie.ai.`);
}

const STATE_LABELS: Record<string, string> = {
  waiting: 'đang xếp hàng',
  queuing: 'trong hàng đợi',
  generating: 'đang vẽ',
  success: 'xong',
  fail: 'thất bại',
};
