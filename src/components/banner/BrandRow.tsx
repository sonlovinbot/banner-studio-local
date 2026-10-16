// Compact top-of-sidebar Brand block for BannerTool.
// One row: pill selector + clear + settings icon. Brand briefs live inside
// the MultiContentModal (Content variants → Briefs tab), not here.

import React from 'react';
import { Palette, Settings2, X } from 'lucide-react';
import { BrandProject, AppPage } from '../../types';

interface Props {
  projects: BrandProject[];
  activeBrandId: string;
  onApply: (id: string) => void;
  onClear: () => void;
  onNavigate: (page: AppPage) => void;
}

export const BrandRow: React.FC<Props> = ({
  projects, activeBrandId, onApply, onClear, onNavigate,
}) => {
  return (
    <section className="space-y-2">
      <label className="text-xs font-semibold text-subtle uppercase tracking-wider flex items-center gap-1.5">
        <Palette size={12} /> Brand
      </label>

      {projects.length === 0 ? (
        <button
          onClick={() => onNavigate('brand-style')}
          className="w-full text-xs py-2.5 px-3 rounded-md border border-dashed border-line-strong bg-canvas text-muted hover:bg-raised hover:border-brand/50 hover:text-brand text-left transition-colors"
        >
          + Tạo Brand Style
        </button>
      ) : (
        <div className="flex items-center gap-1.5">
          <select
            value={activeBrandId}
            onChange={(e) => onApply(e.target.value)}
            className="flex-1 min-w-0 bg-canvas border border-line rounded-md px-3 py-2 text-sm text-fg focus:outline-none focus:border-brand"
          >
            <option value="">— Không dùng brand —</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {activeBrandId && (
            <button
              onClick={onClear}
              className="shrink-0 p-2 rounded-md bg-canvas border border-line hover:bg-raised text-muted hover:text-fg"
              title="Bỏ chọn brand"
            >
              <X size={14} />
            </button>
          )}
          <button
            onClick={() => onNavigate('brand-style')}
            className="shrink-0 p-2 rounded-md bg-canvas border border-line hover:bg-raised text-muted hover:text-fg"
            title="Quản lý brand + edit briefs"
          >
            <Settings2 size={14} />
          </button>
        </div>
      )}
    </section>
  );
};
