// 3-card compact References row for UGC Studio. Mirrors the banner
// components/banner/ReferencesRow layout but with Face / Fashion / Product
// slots — cả ba là bucket user tự upload.

import React from 'react';
import { UserSquare2, Shirt, Package, Plus, Layers } from 'lucide-react';
import { UploadedImage } from '../../types';

interface Props {
  faceImages: UploadedImage[];
  fashionImages: UploadedImage[];
  productImages: UploadedImage[];

  onOpenFace: () => void;
  onOpenFashion: () => void;
  onOpenProduct: () => void;
}

export const UgcReferencesRow: React.FC<Props> = ({
  faceImages, fashionImages, productImages,
  onOpenFace, onOpenFashion, onOpenProduct,
}) => {
  return (
    <section className="space-y-2">
      <label className="text-xs font-semibold text-subtle uppercase tracking-wider flex items-center gap-1.5">
        <Layers size={12} /> References
      </label>
      <div className="grid grid-cols-3 gap-2">
        <RefCard
          icon={<UserSquare2 size={14} />}
          title="Face"
          count={faceImages.length}
          preview={faceImages.slice(0, 3).map(i => i.base64 || '')}
          onClick={onOpenFace}
          required
        />
        <RefCard
          icon={<Shirt size={14} />}
          title="Fashion"
          count={fashionImages.length}
          preview={fashionImages.slice(0, 3).map(i => i.base64 || '')}
          onClick={onOpenFashion}
          required
        />
        <RefCard
          icon={<Package size={14} />}
          title="Product"
          count={productImages.length}
          preview={productImages.slice(0, 3).map(i => i.base64 || '')}
          onClick={onOpenProduct}
          required
        />
      </div>
    </section>
  );
};

// ─────────────────── Card ───────────────────

const RefCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  count: number;
  preview: string[];
  onClick: () => void;
  required?: boolean;
}> = ({ icon, title, count, preview, onClick, required }) => {
  const empty = count === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group aspect-square rounded-lg border transition-all flex flex-col items-stretch p-2 text-left ${
        empty
          ? required
            ? 'border-dashed border-warning-fg/40 bg-canvas hover:border-brand/50 hover:bg-brand/5'
            : 'border-dashed border-line-strong bg-canvas hover:border-brand/50 hover:bg-brand/5'
          : 'border-line bg-canvas hover:border-brand/50 hover:bg-raised'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-muted group-hover:text-fg flex items-center gap-1">
          {icon}
          <span className="text-[11px] font-medium">{title}</span>
        </span>
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
          empty ? (required ? 'text-warning-fg' : 'text-subtle') : 'bg-brand/15 text-brand'
        }`}>
          {count}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        {empty ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-muted group-hover:text-brand transition-colors">
            <Plus size={20} strokeWidth={1.5} />
            {required && (
              <p className="text-[9px] text-warning-fg/70 mt-0.5">bắt buộc</p>
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
