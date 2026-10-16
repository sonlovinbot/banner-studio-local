// Compact Content section for BannerTool sidebar.
// Old UI stacked "Brand Content" label + Save/Library buttons + textarea +
// (multi mode) more textareas + toggle checkbox. Now: one primary textarea +
// a "biến thể" chip that opens the MultiContentModal.

import React from 'react';
import { Type, ListPlus, FolderOpen, Save } from 'lucide-react';

interface Props {
  /** Primary brand content — always shown as the top textarea. */
  primaryContent: string;
  onChangePrimary: (v: string) => void;

  /** Whether multi-content mode is on. */
  multiOn: boolean;
  onToggleMulti: (on: boolean) => void;

  /** Total distinct content strings in multi mode (non-empty manual +
   *  enabled briefs). Single source of truth — chip and output preview both
   *  derive from this same number. */
  totalVariants: number;
  onOpenManage: () => void;

  /** Library actions on the primary textarea. */
  onSavePrimarySnippet?: () => void;
  onOpenLibrary?: () => void;
  librarySize?: number;
}

export const ContentSection: React.FC<Props> = ({
  primaryContent, onChangePrimary,
  multiOn, onToggleMulti,
  totalVariants, onOpenManage,
  onSavePrimarySnippet, onOpenLibrary, librarySize = 0,
}) => {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-subtle uppercase tracking-wider flex items-center gap-1.5">
          <Type size={12} /> Nội dung
        </label>
        <div className="flex items-center gap-1">
          {onSavePrimarySnippet && (
            <button
              onClick={onSavePrimarySnippet}
              disabled={!primaryContent.trim()}
              className="text-[10px] px-2 py-0.5 rounded bg-canvas border border-line hover:bg-raised text-muted hover:text-fg disabled:opacity-40"
              title="Lưu nội dung vào thư viện"
            >
              <Save size={10} className="inline mr-0.5" /> Lưu
            </button>
          )}
          {onOpenLibrary && (
            <button
              onClick={onOpenLibrary}
              className="text-[10px] px-2 py-0.5 rounded bg-canvas border border-line hover:bg-raised text-muted hover:text-fg flex items-center gap-1"
              title="Thư viện nội dung"
            >
              <FolderOpen size={10} /> Thư viện
              {librarySize > 0 && (
                <span className="bg-brand text-white rounded-full px-1 py-px text-[9px] font-mono min-w-[14px] text-center">
                  {librarySize}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      <textarea
        value={primaryContent}
        onChange={(e) => onChangePrimary(e.target.value)}
        placeholder="VD: 'Sale hè 50% — 500 Skills MKT...'"
        className="w-full bg-canvas border border-line rounded-md p-3 text-sm text-fg focus:outline-none focus:border-brand h-20 resize-none"
      />

      {/* Variants chip — always visible; label adapts to state */}
      <button
        onClick={onOpenManage}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border transition-colors text-left ${
          multiOn
            ? 'bg-brand/10 border-brand/30 hover:bg-brand/15'
            : 'bg-canvas border-line border-dashed hover:bg-brand/5 hover:border-brand/50'
        }`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <ListPlus size={12} className={multiOn ? 'text-brand' : 'text-muted'} />
          <span className={`text-xs font-medium truncate ${multiOn ? 'text-fg' : 'text-muted'}`}>
            {multiOn
              ? totalVariants === 0
                ? 'Đang bật — chưa có biến thể nào'
                : `${totalVariants} biến thể sẽ dùng`
              : '+ Thêm biến thể nội dung'}
          </span>
        </span>
        <span className={`text-[11px] font-medium shrink-0 hover:underline ${multiOn ? 'text-brand' : 'text-muted'}`}>
          Sửa
        </span>
      </button>

      {/* Multi mode toggle — sub-tle inline */}
      <label className="flex items-center gap-1.5 cursor-pointer select-none pl-0.5">
        <input
          type="checkbox"
          checked={multiOn}
          onChange={(e) => onToggleMulti(e.target.checked)}
          className="accent-brand"
        />
        <span className="text-[11px] text-muted">
          Chế độ nhiều biến thể (mỗi biến thể = 1 nội dung khác nhau)
        </span>
      </label>
    </section>
  );
};
