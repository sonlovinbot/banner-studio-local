// Wraps the existing ImageUploader in a modal shell so Style / Product refs
// live in a popup instead of eating sidebar space. Kept as a thin wrapper —
// all upload / paste / library logic still lives in ImageUploader.

import React from 'react';
import { X, Image as ImageIcon, Package, UserSquare2, Shirt } from 'lucide-react';
import { UploadedImage, LibraryImage } from '../../types';
import { ImageUploader } from '../ImageUploader';

export type PickerKind = 'style' | 'product' | 'face' | 'fashion';

interface Props {
  kind: PickerKind;
  images: UploadedImage[];
  library: LibraryImage[];
  onUpload: (files: FileList) => Promise<void>;
  onRemove: (id: string) => void;
  onLibrarySelect: (item: LibraryImage) => void;
  onLibraryDelete: (id: string) => void;
  onClose: () => void;
}

const KIND_META: Record<PickerKind, { title: string; icon: React.ReactNode; hint: string }> = {
  style:   { title: 'Style Reference(s)',  icon: <ImageIcon size={14} />,    hint: 'Ảnh minh hoạ cho composition / palette / typography.' },
  product: { title: 'Product Image(s)',    icon: <Package size={14} />,      hint: 'Ảnh sản phẩm chính sẽ integrate vào banner.' },
  face:    { title: 'Face Reference(s)',   icon: <UserSquare2 size={14} />,  hint: 'Ảnh khuôn mặt để giữ nhận dạng nhất quán qua các gen.' },
  fashion: { title: 'Fashion + Style',     icon: <Shirt size={14} />,        hint: 'Ảnh trang phục / phong cách outfit tham chiếu.' },
};

export const ReferencePickerModal: React.FC<Props> = ({
  kind, images, library, onUpload, onRemove, onLibrarySelect, onLibraryDelete, onClose,
}) => {
  const meta = KIND_META[kind];
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-canvas border border-line rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-line bg-surface flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="bg-brand/15 text-brand p-2 rounded-md border border-brand/30">
              {meta.icon}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-fg">{meta.title}</h3>
              <p className="text-[11px] text-subtle">{meta.hint}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-raised text-muted hover:text-fg"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          <ImageUploader
            title={meta.title}
            images={images}
            onUpload={onUpload}
            onRemove={onRemove}
            library={library}
            onLibrarySelect={onLibrarySelect}
            onLibraryDelete={onLibraryDelete}
          />
        </div>

        <footer className="px-5 py-3 border-t border-line bg-surface flex items-center justify-between">
          <span className="text-[11px] text-muted font-mono">
            {images.length} ảnh đã chọn
          </span>
          <button
            onClick={onClose}
            className="text-sm px-4 py-1.5 rounded-lg bg-brand hover:bg-brand-dark text-white font-semibold"
          >
            Xong
          </button>
        </footer>
      </div>
    </div>
  );
};
