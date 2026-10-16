import React, { useEffect, useRef, useState } from 'react';
import { Upload, X, Image as ImageIcon, FolderOpen, Trash2, Plus, Clipboard } from 'lucide-react';
import { LibraryImage, UploadedImage } from '../types';
import { extractImageFiles, filesToFileList, readImagesFromClipboard } from '../services/imageUtils';

interface ImageUploaderProps {
  title: string;
  images: UploadedImage[];
  onUpload: (files: FileList) => void;
  onRemove: (id: string) => void;
  library?: LibraryImage[];
  onLibrarySelect?: (item: LibraryImage) => void;
  onLibraryDelete?: (id: string) => void;
  accept?: string;
  multiple?: boolean;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({
  title,
  images,
  onUpload,
  onRemove,
  library,
  onLibrarySelect,
  onLibraryDelete,
  accept = "image/*",
  multiple = true
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const libraryEnabled = !!library && !!onLibrarySelect && !!onLibraryDelete;

  useEffect(() => {
    if (!showLibrary) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowLibrary(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showLibrary]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onUpload(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const files = extractImageFiles(e.clipboardData?.items);
    if (files.length > 0) {
      e.preventDefault();
      onUpload(filesToFileList(files));
    }
  };

  const handleClipboardClick = async () => {
    const files = await readImagesFromClipboard();
    if (files.length > 0) onUpload(filesToFileList(files));
  };

  return (
    <div className="flex flex-col gap-2 mb-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-fg flex items-center gap-2">
          <ImageIcon size={16} />
          {title}
        </label>
        <span className="text-xs text-subtle">{images.length} uploaded</span>
      </div>

      <div className={`grid gap-2 ${libraryEnabled ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center gap-1.5 text-xs py-2 px-2 rounded-md bg-brand hover:bg-brand-dark text-white font-medium transition-colors"
          title="Upload one or more images"
        >
          <Upload size={14} /> Tải lên
        </button>
        <button
          onClick={handleClipboardClick}
          className="flex items-center justify-center gap-1.5 text-xs py-2 px-2 rounded-md bg-raised hover:bg-raised-2 text-fg border border-line-strong transition-colors"
          title="Dán ảnh từ clipboard"
        >
          <Clipboard size={14} /> Dán
        </button>
        {libraryEnabled && (
          <button
            onClick={() => setShowLibrary(true)}
            className="flex items-center justify-center gap-1.5 text-xs py-2 px-2 rounded-md bg-raised hover:bg-raised-2 text-fg border border-line-strong transition-colors"
            title="Open saved library"
          >
            <FolderOpen size={14} /> Thư viện
            {library!.length > 0 && (
              <span className="ml-0.5 bg-brand text-white rounded-full px-1.5 py-px text-[10px] font-mono font-semibold min-w-[18px] text-center">
                {library!.length}
              </span>
            )}
          </button>
        )}
      </div>

      <div
        tabIndex={0}
        className="border-2 border-dashed border-line-strong bg-surface/50 rounded-lg p-3 transition-colors hover:border-brand/50 hover:bg-raised/50 focus:outline-none focus:border-brand focus:ring-2 focus:ring-indigo-500/20"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onPaste={handlePaste}
        title="Bấm để focus rồi Ctrl/Cmd+V để dán ảnh"
      >
        {images.length > 0 ? (
          <div className="grid grid-cols-4 gap-2">
            {images.map((img) => (
              <div key={img.id} className="relative group aspect-square rounded-md overflow-hidden bg-canvas border border-line">
                <img src={img.url} alt="upload" className="w-full h-full object-cover" />
                <button
                  onClick={() => onRemove(img.id)}
                  className="absolute top-1 right-1 bg-black/70 hover:bg-danger-soft text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center aspect-square rounded-md bg-raised hover:bg-raised-2 transition-colors border border-line-strong text-muted hover:text-fg"
              title="Add more"
            >
              <Plus size={20} />
            </button>
          </div>
        ) : (
          <div className="text-center text-subtle text-xs py-3 pointer-events-none flex flex-col items-center gap-1">
            <span>Kéo &amp; thả nhiều ảnh vào đây</span>
            <span className="inline-flex items-center gap-1 text-[10px] text-subtle">
              hoặc <Clipboard size={10} /> Ctrl/Cmd+V để dán &middot; hoặc bấm "Tải lên" / "Thư viện"
            </span>
          </div>
        )}

        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept={accept}
          multiple={multiple}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) onUpload(e.target.files);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
      </div>

      {showLibrary && libraryEnabled && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
          onClick={() => setShowLibrary(false)}
        >
          <div
            className="bg-surface border border-line-strong rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-line">
              <div className="flex items-center gap-3">
                <div className="bg-canvas text-brand p-2 rounded-md"><FolderOpen size={18} /></div>
                <div>
                  <h3 className="text-base font-semibold text-fg">Thư viện — {title}</h3>
                  <p className="text-xs text-subtle">Bấm vào ảnh để dùng lại · {library!.length}/30</p>
                </div>
              </div>
              <button
                onClick={() => setShowLibrary(false)}
                className="p-2 rounded-md hover:bg-raised text-muted hover:text-fg"
                aria-label="Close library"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {library!.length === 0 ? (
                <div className="text-center text-subtle text-sm py-16">
                  Chưa có ảnh nào trong thư viện.
                  <br />
                  <span className="text-xs">Tải ảnh lên — chúng sẽ được lưu tự động (tối đa 10 ảnh).</span>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
                  {library!.map(item => (
                    <div
                      key={item.id}
                      className="relative group aspect-square rounded-lg overflow-hidden bg-canvas border border-line hover:border-brand transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onLibrarySelect!(item);
                          setShowLibrary(false);
                        }}
                        className="w-full h-full"
                        title="Use this image"
                      >
                        <img src={item.url || item.base64} alt="library" className="w-full h-full object-cover" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onLibraryDelete!(item.id);
                        }}
                        className="absolute top-2 right-2 bg-black/70 hover:bg-danger-soft text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove from library"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
