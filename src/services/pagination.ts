// Logic dãy số trang cho component Pagination. Tách khỏi JSX để test thuần.

export const PAGE_SIZE = 40;

export type PageToken = number | 'gap';

/** Từ ngưỡng này trở xuống thì hiện đủ số trang, không rút gọn. */
export const ALWAYS_SHOW_ALL_UPTO = 7;

/**
 * Dựng dãy nút trang rút gọn: `1 2 [3] 4 … 10`.
 *
 * Luôn giữ trang đầu, trang cuối, và `window` trang mỗi bên trang hiện tại.
 * Chèn 'gap' (dấu …) vào chỗ bị cắt. Không bao giờ chèn gap để thay đúng
 * 1 số — hiện luôn số đó cho đỡ hụt.
 */
export function buildPageRange(current: number, totalPages: number, window = 1): PageToken[] {
  if (totalPages <= 0) return [];
  const cur = Math.min(Math.max(current, 1), totalPages);

  // Ít trang thì hiện hết — rút gọn ở đây chỉ tổ giấu mất trang mà không
  // tiết kiệm được chỗ nào.
  if (totalPages <= ALWAYS_SHOW_ALL_UPTO) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const keep = new Set<number>([1, totalPages]);
  for (let p = cur - window; p <= cur + window; p++) {
    if (p >= 1 && p <= totalPages) keep.add(p);
  }

  const sorted = Array.from(keep).sort((a, b) => a - b);
  const out: PageToken[] = [];
  let prev = 0;
  for (const p of sorted) {
    const missing = p - prev - 1;
    if (prev !== 0 && missing > 0) {
      // Chỉ hụt 1 số thì hiện luôn số đó thay vì dấu …
      if (missing === 1) out.push(prev + 1);
      else out.push('gap');
    }
    out.push(p);
    prev = p;
  }
  return out;
}

/** Tổng số trang từ tổng số item. Không có item vẫn tính là 1 trang. */
export function totalPagesFor(total: number, pageSize: number = PAGE_SIZE): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Kẹp số trang vào khoảng hợp lệ. Dùng khi URL mang ?page=999. */
export function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.trunc(page), 1), Math.max(1, totalPages));
}

/** Khoảng row cho Supabase .range(from, to) — inclusive hai đầu. */
export function rangeFor(page: number, pageSize: number = PAGE_SIZE): { from: number; to: number } {
  const p = Math.max(1, Math.trunc(page));
  const from = (p - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}
