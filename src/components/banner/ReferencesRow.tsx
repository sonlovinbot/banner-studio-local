// 2-card compact References row (Style + Product). Thay cho các section
// Assets cũ chiếm ~60% chiều cao sidebar.
//
// Each card shows a summary (count + thumbnails) and clicking opens the
// appropriate modal for detailed editing.

import React from 'react';
import { Image as ImageIcon, Package, Layers, Plus } from 'lucide-react';
import { UploadedImage } from '../../types';
import { proxiedBannerUrl } from '../../services/cdnProxy';

interface Props {
  styleImages: UploadedImage[];
  productImages: UploadedImage[];
  onOpenStyle: () => void;
  onOpenProduct: () => void;
}

export const ReferencesRow: React.FC<Props> = ({
  styleImages, productImages,
  onOpenStyle, onOpenProduct,
}) => {
  return (
    <section className="space-y-2">
      <label className="text-xs font-semibold text-subtle uppercase tracking-wider flex items-center gap-1.5">
        <Layers size={12} /> References
      </label>
      <div className="grid grid-cols-2 gap-2">
        <RefCard
          icon={<ImageIcon size={14} />}
          title="Style"
          count={styleImages.length}
          preview={styleImages.slice(0, 3).map(i => i.base64 || '')}
          onClick={onOpenStyle}
        />
        <RefCard
          icon={<Package size={14} />}
          title="Product"
          count={productImages.length}
          preview={productImages.slice(0, 3).map(i => i.base64 || '')}
          onClick={onOpenProduct}
        />
      </div>
    </section>
  );
};

// ─────────────────── Cards ───────────────────

const RefCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  count: number;
  preview: string[];
  onClick: () => void;
  dimHint?: string;
}> = ({ icon, title, count, preview, onClick, dimHint }) => {
  const empty = count === 0;
  const dim = !!dimHint && empty;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group aspect-square rounded-lg border transition-all flex flex-col items-stretch p-2 text-left relative ${
        dim
          ? 'border-dashed border-line bg-canvas/50 opacity-60 hover:opacity-100 hover:border-brand/40'
          : empty
            ? 'border-dashed border-line-strong bg-canvas hover:border-brand/50 hover:bg-brand/5'
            : 'border-line bg-canvas hover:border-brand/50 hover:bg-raised'
      }`}
      title={dimHint || undefined}
    >
      <div className="flex items-center justify-between mb-1">
        <span className={`flex items-center gap-1 ${dim ? 'text-subtle' : 'text-muted group-hover:text-fg'}`}>
          {icon}
          <span className="text-[11px] font-medium">{title}</span>
        </span>
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
          empty ? 'text-subtle' : 'bg-brand/15 text-brand'
        }`}>
          {count}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        {empty ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-muted group-hover:text-brand transition-colors">
            <Plus size={20} strokeWidth={1.5} />
            {dimHint && (
              <p className="text-[9px] text-subtle mt-1 leading-tight text-center line-clamp-2 px-1">
                {dimHint}
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-0.5 w-full h-full overflow-hidden rounded">
            {preview.slice(0, 4).map((src, i) => (
              <div key={i} className="bg-raised overflow-hidden">
                {src && <img src={src} alt="" className="w-full h-full object-cover" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </button>
  );
};

