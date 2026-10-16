// Chính sách tự chuyển sang OpenAI khi Coachio hỏng.
//
// KHÔNG fallback với mọi lỗi. Có những lỗi mà OpenAI cũng sẽ từ chối y hệt —
// gọi lại chỉ tốn tiền lần hai và làm user chờ lâu gấp đôi trước khi nhận
// đúng câu từ chối đó. Nên chỉ chuyển khi lý do nằm ở phía Coachio, không
// nằm ở nội dung user gửi.

import { GenErrorKind, describeGenError } from './genErrors';

/** Lỗi thuộc về phía Coachio → provider khác có cơ hội chạy được. */
const FALLBACK_KINDS: GenErrorKind[] = [
  'credits',     // hết credit Coachio — ví OpenAI độc lập
  'auth',        // key Coachio hỏng/revoke
  'rate_limit',  // Coachio đang chặn tốc độ
  'network',     // không với tới được Coachio
  'unknown',     // task fail phía server không rõ lý do
];

/** Lỗi thuộc về nội dung/tham số user gửi → đổi provider vô ích.
 *  - content_policy: OpenAI cũng chặn, thậm chí chặt hơn.
 *  - input: ảnh quá lớn / sai định dạng thì provider nào cũng từ chối.
 *  - timeout: task Coachio có thể VẪN đang chạy và sẽ tính tiền; chạy thêm
 *    một lần ở OpenAI là trả tiền hai lần cho cùng một tấm.
 *  - not_deployed: endpoint của CHÍNH TA chưa deploy. Đổi provider không dựng
 *    ra được route còn thiếu.
 */
const NO_FALLBACK_KINDS: GenErrorKind[] = ['content_policy', 'input', 'timeout', 'not_deployed'];

export function shouldFallbackToOpenai(err: unknown): boolean {
  const { kind } = describeGenError(err);
  if (NO_FALLBACK_KINDS.includes(kind)) return false;
  return FALLBACK_KINDS.includes(kind);
}

/** Vì sao không chuyển provider — hiện cho user thay vì im lặng. */
export function explainNoFallback(err: unknown): string {
  const { kind } = describeGenError(err);
  switch (kind) {
    case 'content_policy':
      return 'Không tự chuyển sang OpenAI vì đây là lỗi nội dung — OpenAI sẽ từ chối y hệt. Sửa prompt hoặc ảnh ref rồi thử lại.';
    case 'input':
      return 'Không tự chuyển sang OpenAI vì ảnh/tham số không hợp lệ — provider nào cũng từ chối. Kiểm tra lại ảnh upload.';
    case 'timeout':
      return 'Không tự chuyển sang OpenAI vì task Coachio có thể vẫn đang chạy và sẽ bị tính tiền. Refresh History xem ảnh đã về chưa trước khi tạo lại.';
    case 'not_deployed':
      return 'Không tự chuyển sang OpenAI vì lỗi nằm ở endpoint của app, không phải ở provider. Deploy rồi thử lại.';
    default:
      return '';
  }
}

export interface FallbackOutcome<T> {
  result: T;
  /** true nếu kết quả này do OpenAI tạo sau khi Coachio hỏng. */
  usedFallback: boolean;
  /** Nguyên văn lỗi Coachio, giữ lại kể cả khi fallback thành công. */
  primaryError?: string;
}

export interface FallbackOpts<T> {
  primary: () => Promise<T>;
  fallback: () => Promise<T>;
  /** Có key OpenAI hay không. Không có thì ném thẳng lỗi Coachio. */
  fallbackAvailable: boolean;
  /** Báo cho user biết đang chuyển provider (hiện ngay, trước khi chờ). */
  onNotice?: (msg: string) => void;
}

/**
 * Chạy Coachio; hỏng theo kiểu đáng chuyển thì chạy lại bằng OpenAI.
 *
 * OpenAI cũng hỏng nốt thì ném lỗi kèm CẢ HAI nguyên nhân — biết mỗi lỗi
 * cuối thì không lần ra được chuyện gì đã xảy ra.
 */
export async function withOpenaiFallback<T>(opts: FallbackOpts<T>): Promise<FallbackOutcome<T>> {
  try {
    return { result: await opts.primary(), usedFallback: false };
  } catch (primaryErr) {
    const info = describeGenError(primaryErr);

    if (!shouldFallbackToOpenai(primaryErr)) {
      const why = explainNoFallback(primaryErr);
      throw new Error(why ? `${info.detail}\n${why}` : info.detail);
    }
    if (!opts.fallbackAvailable) {
      throw new Error(
        `${info.detail}\nCó thể tự chuyển sang OpenAI cho trường hợp này, nhưng chưa có OpenAI API key. Thêm key ở Settings → API Keys để lần sau không bị dừng.`,
      );
    }

    opts.onNotice?.(`Coachio lỗi (${info.title}) — đang tự chuyển sang OpenAI…`);
    try {
      const result = await opts.fallback();
      return { result, usedFallback: true, primaryError: info.detail };
    } catch (fallbackErr) {
      const fb = describeGenError(fallbackErr);
      throw new Error(
        `Cả hai provider đều lỗi.\nCoachio: ${info.detail}\nOpenAI: ${fb.detail}${fb.hint ? `\n${fb.hint}` : ''}`,
      );
    }
  }
}

/** Câu thông báo hiện sau khi fallback thành công. */
export function fallbackSuccessNotice(primaryError?: string): string {
  return [
    'Đã tạo bằng OpenAI vì Coachio lỗi.',
    primaryError ? `Lỗi Coachio: ${primaryError}` : '',
  ].filter(Boolean).join('\n');
}
