// Phân loại + diễn giải lỗi generate ảnh.
//
// Trước đây lỗi bị nuốt hai tầng:
//   1. pollTaskStatus chỉ đọc `data.message`, không có thì ném chuỗi cứng
//      "Task failed on server" — lý do thật (hết credit, sai key, vi phạm
//      policy) nằm ở field khác và mất sạch.
//   2. UI lại gộp tiếp về "Generation failed" / "Insufficient Coachio credits."
//      nên cả message gốc lẫn ngữ cảnh đều không tới được user.
//
// Module này giữ nguyên văn message của provider VÀ gắn thêm cách xử lý.

export type GenErrorKind =
  | 'not_deployed'
  | 'credits'
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'content_policy'
  | 'input'
  | 'network'
  | 'unknown';

export interface GenErrorInfo {
  kind: GenErrorKind;
  /** Tiêu đề ngắn hiện trên tile lỗi. */
  title: string;
  /** Nguyên văn message từ provider — không bịa, không rút gọn. */
  detail: string;
  /** Việc user cần làm. Rỗng nếu không có hành động rõ ràng. */
  hint?: string;
}

/** Các field mà backend có thể nhét lý do thất bại vào. Coachio trả khác nhau
 *  tuỳ provider phía sau (OpenAI / Google), nên dò hết thay vì đoán một chỗ. */
const ERROR_FIELDS = [
  'message', 'error', 'error_message', 'errorMessage', 'detail', 'details',
  'reason', 'failure_reason', 'failureReason', 'status_message', 'statusMessage',
];

function pickString(v: any): string {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (v && typeof v === 'object') {
    // { error: { message: "..." } }
    for (const f of ERROR_FIELDS) {
      const inner = (v as any)[f];
      if (typeof inner === 'string' && inner.trim()) return inner.trim();
    }
  }
  return '';
}

/**
 * Rút lý do thất bại từ payload task status. Dò nhiều field, kể cả lồng trong
 * `result` / `output` / `data`. Không tìm thấy thì trả JSON đã cắt ngắn — xấu
 * nhưng vẫn debug được, hơn hẳn một câu chung chung.
 */
export function extractTaskError(payload: any): string {
  if (!payload) return '';
  if (typeof payload === 'string') return payload.trim();

  for (const f of ERROR_FIELDS) {
    const s = pickString(payload[f]);
    if (s) return s;
  }
  for (const nest of ['result', 'output', 'data', 'response']) {
    const s = pickString(payload[nest]);
    if (s) return s;
  }

  try {
    // Bỏ các field cồng kềnh/không liên quan trước khi dump.
    const { result_urls, output_urls, ...rest } = payload;
    const dump = JSON.stringify(rest);
    if (dump && dump !== '{}') return `Phản hồi không có mô tả lỗi: ${dump.slice(0, 300)}`;
  } catch { /* payload không serialize được */ }
  return '';
}

interface Rule {
  kind: GenErrorKind;
  match: RegExp;
  title: string;
  hint?: string;
}

// Thứ tự có ý nghĩa: rule cụ thể đứng trước rule chung.
const RULES: Rule[] = [
  {
    // 405/501 nghĩa là đường dẫn KHÔNG xử lý method này — với API của chính
    // mình thì gần như luôn là endpoint chưa deploy. Thử lại vô ích, nên phải
    // tách khỏi nhóm 'unknown' (nhóm đó khuyên "Bấm Thử lại").
    //
    // Cố ý KHÔNG bắt 404 trần: provider cũng trả 404 khi sai model id, gộp
    // vào đây sẽ khuyên sai.
    kind: 'not_deployed',
    match: /\b405\b|method not allowed|cannot (?:post|get|put|patch|delete)\b|\b501\b|not implemented/i,
    title: 'Endpoint chưa deploy',
    hint: 'Đường dẫn API không nhận method này — thường là function chưa được deploy. '
      + 'Nếu đang chạy `npm run dev`: Vite KHÔNG chạy Vercel function, và vite.config.ts proxy /api về production, '
      + 'nên endpoint mới chưa deploy sẽ trả 405. Dùng `vercel dev` để chạy function ở máy, hoặc deploy lên Vercel trước.',
  },
  {
    kind: 'credits',
    match: /insufficient|not enough|no credit|out of credit|credit.{0,20}(insufficient|low|empty)|balance|top ?up|quota exceeded|billing|payment required|402/i,
    title: 'Hết credit Coachio',
    // User đã kiểm tra ví OpenAI và tưởng bị báo nhầm — nói rõ đây là ví nào.
    hint: 'Đây là số dư tài khoản Coachio, KHÔNG phải ví OpenAI. Ảnh chạy qua backend Coachio nên dù OpenAI còn tiền, hết credit Coachio là dừng. Nạp thêm tại tài khoản Coachio rồi bấm Thử lại.',
  },
  {
    kind: 'auth',
    match: /invalid.{0,15}api key|unauthorized|401|api key not set|authentication|forbidden|403/i,
    title: 'API key không hợp lệ',
    hint: 'Mở Settings → API Keys, dán lại key Coachio rồi thử lại.',
  },
  {
    kind: 'rate_limit',
    match: /rate limit|too many requests|429|throttl/i,
    title: 'Bị giới hạn tốc độ',
    hint: 'Gửi quá nhiều request trong thời gian ngắn. Chờ khoảng 1 phút rồi bấm Thử lại.',
  },
  {
    kind: 'timeout',
    match: /timeout|timed out|hết thời gian/i,
    title: 'Quá thời gian chờ',
    hint: 'Ảnh có thể vẫn đang được tạo phía server. Chờ chút rồi refresh History trước khi tạo lại để khỏi tốn thêm credit.',
  },
  {
    kind: 'content_policy',
    match: /content policy|safety|moderation|violat|blocked|not allowed|inappropriate|rejected by/i,
    title: 'Nội dung bị chặn',
    hint: 'Prompt hoặc ảnh tham chiếu vi phạm chính sách nội dung của provider. Sửa lại câu lệnh hoặc đổi ảnh ref.',
  },
  {
    kind: 'input',
    match: /exceeds .{0,10}limit|too large|unsupported image|invalid image|bad request|400|unsupported format/i,
    title: 'Ảnh hoặc tham số không hợp lệ',
    hint: 'Kiểm tra ảnh upload (định dạng JPG/PNG/WebP, dưới 15MB) và tỉ lệ đã chọn.',
  },
  {
    kind: 'network',
    match: /failed to fetch|network|econn|socket|dns|offline|load failed/i,
    title: 'Lỗi kết nối',
    hint: 'Không gọi được tới server. Kiểm tra mạng rồi thử lại.',
  },
];

/** Chuẩn hoá mọi thứ có thể bị throw về một chuỗi message. */
export function toMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err.trim();
  if (err instanceof Error) return err.message.trim();
  if (typeof err === 'object') {
    const s = pickString(err);
    if (s) return s;
    try { return JSON.stringify(err).slice(0, 300); } catch { /* ignore */ }
  }
  return String(err);
}

/** Phân loại lỗi và gắn hướng xử lý. Luôn giữ nguyên văn message gốc ở
 *  `detail` — không bao giờ thay thế bằng chữ chung chung. */
export function describeGenError(err: unknown): GenErrorInfo {
  const detail = toMessage(err) || 'Không có mô tả lỗi từ server.';
  for (const r of RULES) {
    if (r.match.test(detail)) {
      return { kind: r.kind, title: r.title, detail, hint: r.hint };
    }
  }
  return {
    kind: 'unknown',
    title: 'Tạo ảnh thất bại',
    detail,
    hint: 'Bấm Thử lại. Nếu vẫn lỗi, gửi nguyên dòng mô tả bên trên để tra tiếp.',
  };
}

/** Một dòng gọn cho toast / thanh lỗi: "Tiêu đề — nguyên văn". */
export function formatGenError(err: unknown): string {
  const info = describeGenError(err);
  return info.detail.toLowerCase().includes(info.title.toLowerCase())
    ? info.detail
    : `${info.title} — ${info.detail}`;
}
