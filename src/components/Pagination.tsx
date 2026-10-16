import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { buildPageRange, PageToken } from '../services/pagination';

interface Props {
  page: number;
  totalPages: number;
  /** Tổng số item — hiện ở dòng phụ dưới dãy nút. */
  total?: number;
  /** Nhãn đơn vị ("banner", "ảnh"...) cho dòng phụ. */
  unit?: string;
  onChange: (page: number) => void;
  /** Chặn thao tác khi trang đang fetch. */
  busy?: boolean;
  className?: string;
}

/** Dãy số trang `‹ Trước 1 2 [3] 4 … 10 Sau ›`. Thuần props — không tự fetch,
 *  parent quyết định lấy dữ liệu thế nào. */
export const Pagination: React.FC<Props> = ({
  page, totalPages, total, unit = 'banner', onChange, busy, className = '',
}) => {
  if (totalPages <= 1) return null;

  const tokens: PageToken[] = buildPageRange(page, totalPages);
  const go = (p: number) => { if (!busy && p !== page && p >= 1 && p <= totalPages) onChange(p); };

  const navBtn = 'flex items-center gap-1 px-3 py-1.5 rounded-md text-xs border border-line-strong bg-raised text-fg hover:bg-raised-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';

  return (
    <nav className={`flex flex-col items-center gap-2 py-6 ${className}`} aria-label="Phân trang">
      <div className="flex items-center gap-1.5 flex-wrap justify-center">
        <button onClick={() => go(page - 1)} disabled={busy || page <= 1} className={navBtn} aria-label="Trang trước">
          <ChevronLeft size={13} /> Trước
        </button>

        {tokens.map((t, i) => t === 'gap' ? (
          <span key={`gap-${i}`} className="px-1.5 text-subtle text-xs select-none" aria-hidden="true">…</span>
        ) : (
          <button
            key={t}
            onClick={() => go(t)}
            disabled={busy}
            aria-current={t === page ? 'page' : undefined}
            aria-label={`Trang ${t}`}
            className={`min-w-[32px] px-2 py-1.5 rounded-md text-xs border transition-colors disabled:cursor-not-allowed ${
              t === page
                ? 'bg-brand border-brand text-white font-semibold'
                : 'bg-raised border-line-strong text-fg hover:bg-raised-2 disabled:opacity-40'
            }`}
          >
            {t}
          </button>
        ))}

        <button onClick={() => go(page + 1)} disabled={busy || page >= totalPages} className={navBtn} aria-label="Trang sau">
          Sau <ChevronRight size={13} />
        </button>
      </div>

      <p className="text-[11px] text-subtle">
        Trang <b className="text-fg">{page}</b>/{totalPages}
        {typeof total === 'number' && <> · {total.toLocaleString('vi-VN')} {unit}</>}
      </p>
    </nav>
  );
};
