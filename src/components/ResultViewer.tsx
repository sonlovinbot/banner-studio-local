import React, { useRef, useState, useMemo } from 'react';
import { describeGenError } from '../services/genErrors';
import { Download, Maximize2, X, RefreshCw, Wand2, ImagePlus, Heart, Clipboard, AlertCircle, Trash2 } from 'lucide-react';
import { GeneratedBanner, UploadedImage, RegenRetryPayload } from '../types';
import { fileToUploadedImage, extractImageFiles, readImagesFromClipboard } from '../services/imageUtils';
import { proxiedBannerUrl } from '../services/cdnProxy';

const MAX_REGEN_EXTRAS = 3;

interface ResultViewerProps {
  results: GeneratedBanner[];
  onRegenerate?: (id: string, prompt: string, extras?: UploadedImage[]) => void;
  onToggleVote?: (banner: GeneratedBanner) => void;
  isVoted?: (id: string) => boolean;
  /** Retry 1 pending background regen task đã lỗi/timeout. */
  onRetryBackground?: (oldTaskId: string, payload: RegenRetryPayload) => void;
  /** Xoá vĩnh viễn 1 pending task đã lỗi. */
  onRemoveErrorTask?: (taskId: string) => void;
}

export const ResultViewer: React.FC<ResultViewerProps> = ({ results, onRegenerate, onToggleVote, isVoted, onRetryBackground, onRemoveErrorTask }) => {
  const [selectedImage, setSelectedImage] = useState<GeneratedBanner | null>(null);
  const [adjustPrompts, setAdjustPrompts] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState<Record<string, UploadedImage[]>>({});
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const handlePromptChange = (id: string, val: string) => {
    setAdjustPrompts(prev => ({ ...prev, [id]: val }));
  };

  const submitRegenerate = (id: string) => {
    if (!onRegenerate) return;
    const prompt = adjustPrompts[id] || '';
    const banner = results.find(r => r.id === id);
    if (!prompt && (!extras[id] || extras[id].length === 0)) return;
    if (banner?.status === 'loading') return;
    onRegenerate(id, prompt || 'Refine using the additional reference images provided.', extras[id]);
    setAdjustPrompts(prev => ({ ...prev, [id]: '' }));
    setExtras(prev => ({ ...prev, [id]: [] }));
  };

  const handleExtraFiles = async (id: string, files: FileList | File[] | null) => {
    if (!files || (files as any).length === 0) return;
    const current = extras[id] || [];
    const room = Math.max(0, MAX_REGEN_EXTRAS - current.length);
    if (room === 0) return;
    const toLoad = Array.from(files as any as Iterable<File>).slice(0, room);
    const loaded = await Promise.all(toLoad.map(fileToUploadedImage));
    setExtras(prev => ({ ...prev, [id]: [...(prev[id] || []), ...loaded] }));
  };

  const handlePasteOnCard = (id: string, e: React.ClipboardEvent) => {
    const files = extractImageFiles(e.clipboardData?.items);
    if (files.length === 0) return;
    e.preventDefault();
    handleExtraFiles(id, files);
  };

  const removeExtra = (id: string, extraId: string) => {
    setExtras(prev => ({ ...prev, [id]: (prev[id] || []).filter(x => x.id !== extraId) }));
  };

  // Multi-aspect filter: user chọn tỉ lệ bên trái → chỉ xem banner tỉ lệ đó.
  const [ratioFilter, setRatioFilter] = useState<string | null>(null);

  const uniqueRatios = useMemo(() => {
    const ratios = new Set<string>();
    for (const r of results) {
      if (r.aspectRatio) ratios.add(r.aspectRatio);
    }
    return Array.from(ratios);
  }, [results]);

  // Nếu ratioFilter trỏ tới 1 ratio không còn (VD user regen với ratio khác),
  // reset.
  React.useEffect(() => {
    if (ratioFilter && !uniqueRatios.includes(ratioFilter)) setRatioFilter(null);
  }, [ratioFilter, uniqueRatios]);

  const filteredResults = ratioFilter
    ? results.filter(r => r.aspectRatio === ratioFilter)
    : results;

  const showRatioStrip = uniqueRatios.length > 1;

  const downloadAllInRatio = (ratio: string) => {
    const items = results.filter(r => r.status === 'success' && r.aspectRatio === ratio && r.imageUrl);
    if (items.length === 0) return;
    items.forEach((banner, idx) => {
      const a = document.createElement('a');
      a.href = proxiedBannerUrl(banner.imageUrl);
      a.download = `banner-${ratio.replace(':', 'x')}-${idx + 1}-${banner.id}.png`;
      a.style.display = 'none';
      document.body.appendChild(a);
      setTimeout(() => { a.click(); a.remove(); }, idx * 100);
    });
  };

  if (results.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-subtle opacity-50">
        <div className="w-24 h-24 border-4 border-line border-dashed rounded-xl mb-4 animate-pulse"></div>
        <p>Generated banners will appear here</p>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* Ratio filter strip — chỉ hiện khi >1 tỉ lệ trong results */}
      {showRatioStrip && (
        <div className="shrink-0 border-r border-line bg-surface/40 backdrop-blur-sm px-2 py-3 flex flex-col gap-1 overflow-y-auto w-16">
          <RatioBtn
            label="Tất cả"
            count={results.length}
            active={ratioFilter === null}
            onClick={() => setRatioFilter(null)}
          />
          {uniqueRatios.map(r => {
            const count = results.filter(x => x.aspectRatio === r).length;
            return (
              <RatioBtn
                key={r}
                label={r}
                count={count}
                active={ratioFilter === r}
                onClick={() => setRatioFilter(r)}
                onDownloadAll={() => downloadAllInRatio(r)}
              />
            );
          })}
        </div>
      )}

    <div className="flex-1 h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-20">
          {filteredResults.map((banner, index) => {
            const banExtras = extras[banner.id] || [];
            const voted = isVoted?.(banner.id) ?? false;
            return (
              <div
                key={banner.id}
                tabIndex={0}
                onPaste={(e) => handlePasteOnCard(banner.id, e)}
                className="bg-surface border border-line rounded-xl overflow-hidden shadow-xl flex flex-col relative group focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                title="Click vào card rồi Ctrl/Cmd+V để dán ảnh tham chiếu"
              >
                <div className="relative w-full aspect-square bg-canvas flex items-center justify-center">
                  {banner.status === 'loading' ? (
                    <div className="flex flex-col items-center gap-3">
                      <RefreshCw className="animate-spin text-brand" size={32} />
                      <span className="text-xs text-brand font-medium">Generating Variant {index + 1}...</span>
                    </div>
                  ) : banner.status === 'error' ? (
                    (() => {
                      // Nguyên văn message của server + việc user cần làm.
                      const info = describeGenError(banner.errorMsg || '');
                      return (
                    <div className="flex flex-col items-center gap-2 px-4 text-center overflow-y-auto max-h-full py-4">
                      <AlertCircle size={28} className="text-danger shrink-0" />
                      <div className="text-danger text-sm font-semibold">
                        {banner.errorMsg ? info.title : (banner.retryPayload ? 'Chạy nền lỗi' : 'Failed to generate')}
                      </div>
                      {banner.errorMsg && (
                        <p className="text-[11px] text-fg/80 max-w-[260px] leading-snug break-words">
                          {info.detail}
                        </p>
                      )}
                      {banner.errorMsg && info.hint && (
                        <p className="text-[11px] text-muted max-w-[260px] leading-snug border-t border-line pt-2">
                          {info.hint}
                        </p>
                      )}
                      <div className="flex items-center gap-2">
                        {banner.retryPayload && onRetryBackground ? (
                          <button
                            onClick={() => onRetryBackground(banner.id, banner.retryPayload as RegenRetryPayload)}
                            className="text-xs px-3 py-1.5 rounded-md bg-brand hover:bg-brand-dark text-white flex items-center gap-1.5 transition-colors"
                            title="Chạy lại task này ở background"
                          >
                            <RefreshCw size={14} /> Tạo lại
                          </button>
                        ) : onRegenerate ? (
                          <button
                            onClick={() => onRegenerate(banner.id, '', extras[banner.id] || [])}
                            className="text-xs px-3 py-1.5 rounded-md bg-brand hover:bg-brand-dark text-white flex items-center gap-1.5 transition-colors"
                            title="Tạo lại banner này"
                          >
                            <RefreshCw size={14} /> Tạo lại
                          </button>
                        ) : null}
                        {banner.retryPayload && onRemoveErrorTask && (
                          <button
                            onClick={() => onRemoveErrorTask(banner.id)}
                            className="text-xs px-3 py-1.5 rounded-md bg-canvas hover:bg-danger hover:text-white border border-danger-fg/40 text-danger flex items-center gap-1.5 transition-colors"
                            title="Xoá task lỗi này (không retry)"
                          >
                            <Trash2 size={14} /> Xoá
                          </button>
                        )}
                      </div>
                    </div>
                      );
                    })()
                  ) : (
                    <>
                      <img
                        src={proxiedBannerUrl(banner.imageUrl)}
                        alt="Generated Banner"
                        className="w-full h-full object-contain"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-200 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                        <button
                          onClick={() => setSelectedImage(banner)}
                          className="bg-white/10 backdrop-blur-md hover:bg-white/20 p-3 rounded-full text-white transition-all transform hover:scale-105"
                          title="View Fullscreen"
                        >
                          <Maximize2 size={24} />
                        </button>
                        <a
                          href={proxiedBannerUrl(banner.imageUrl)}
                          download={`banner-clone-${banner.id}.png`}
                          className="bg-brand hover:bg-brand-dark p-3 rounded-full text-white transition-all transform hover:scale-105 shadow-lg"
                          title="Download"
                        >
                          <Download size={24} />
                        </a>
                      </div>
                      {onToggleVote && (
                        <button
                          onClick={() => onToggleVote(banner)}
                          className={`absolute top-2 right-2 p-2 rounded-full backdrop-blur-md transition-all ${
                            voted
                              ? 'bg-rose-500/90 hover:bg-rose-500 text-white shadow-lg'
                              : 'bg-black/40 hover:bg-black/60 text-white/80 hover:text-white opacity-0 group-hover:opacity-100'
                          }`}
                          title={voted ? 'Bỏ vote' : 'Vote banner này (cho AI học)'}
                        >
                          <Heart size={18} fill={voted ? 'currentColor' : 'none'} />
                        </button>
                      )}
                    </>
                  )}
                </div>
                <div className="p-3 border-t border-line bg-surface flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-muted font-mono truncate">ID: {banner.id.slice(0, 8)}</p>
                    {banner.duration && (
                      <span className="text-[10px] text-brand font-medium bg-canvas px-2 py-0.5 rounded-full border border-brand/20">
                        {banner.duration.toFixed(1)}s
                      </span>
                    )}
                  </div>

                  {banExtras.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {banExtras.map(ex => (
                        <div key={ex.id} className="relative w-10 h-10 rounded border border-line-strong overflow-hidden">
                          <img src={ex.url} className="w-full h-full object-cover" alt="extra" />
                          <button
                            onClick={() => removeExtra(banner.id, ex.id)}
                            className="absolute -top-1 -right-1 bg-danger-fg hover:bg-danger-fg text-white rounded-full p-0.5"
                            title="Xoá"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                      <span className="text-[10px] text-subtle font-mono">{banExtras.length}/{MAX_REGEN_EXTRAS}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="text"
                      placeholder="Adjust this variant..."
                      value={adjustPrompts[banner.id] || ''}
                      onChange={(e) => handlePromptChange(banner.id, e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && submitRegenerate(banner.id)}
                      className="flex-1 bg-canvas border border-line rounded-md px-2 py-1.5 text-xs text-fg focus:outline-none focus:border-brand transition-colors"
                      disabled={banner.status === 'loading'}
                    />
                    <input
                      ref={(el) => { fileInputs.current[banner.id] = el; }}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => { handleExtraFiles(banner.id, e.target.files); e.target.value = ''; }}
                    />
                    <button
                      onClick={async () => {
                        const files = await readImagesFromClipboard();
                        if (files.length > 0) handleExtraFiles(banner.id, files);
                      }}
                      disabled={banner.status === 'loading' || banExtras.length >= MAX_REGEN_EXTRAS}
                      className="bg-raised hover:bg-raised-2 disabled:bg-surface disabled:text-subtle text-fg p-1.5 rounded-md transition-colors border border-line-strong"
                      title="Dán ảnh tham chiếu từ clipboard"
                    >
                      <Clipboard size={14} />
                    </button>
                    <button
                      onClick={() => fileInputs.current[banner.id]?.click()}
                      disabled={banner.status === 'loading' || banExtras.length >= MAX_REGEN_EXTRAS}
                      className="bg-raised hover:bg-raised-2 disabled:bg-surface disabled:text-subtle text-fg p-1.5 rounded-md transition-colors border border-line-strong"
                      title={`Upload ảnh tham chiếu thêm (tối đa ${MAX_REGEN_EXTRAS})`}
                    >
                      <ImagePlus size={14} />
                    </button>
                    <button
                      onClick={() => submitRegenerate(banner.id)}
                      disabled={banner.status === 'loading' || (!adjustPrompts[banner.id] && banExtras.length === 0)}
                      className="bg-brand hover:bg-brand-dark disabled:bg-raised disabled:text-subtle text-white p-1.5 rounded-md transition-colors"
                      title="Regenerate with adjustment"
                    >
                      {banner.status === 'loading' ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : (
                        <Wand2 size={14} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>

      {selectedImage && (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex items-center justify-center p-4">
          <button
            onClick={() => setSelectedImage(null)}
            className="absolute top-4 right-4 text-muted hover:text-fg p-2 rounded-full hover:bg-raised transition-colors"
          >
            <X size={32} />
          </button>

          <div className="max-w-[95vw] max-h-[90vh] relative">
            <img
              src={proxiedBannerUrl(selectedImage.imageUrl)}
              alt="Full View"
              className="max-w-full max-h-[90vh] object-contain rounded-md shadow-2xl"
            />
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-4">
              <a
                href={proxiedBannerUrl(selectedImage.imageUrl)}
                download={`banner-full-${selectedImage.id}.png`}
                className="bg-brand hover:bg-brand-dark text-white px-6 py-2 rounded-full shadow-lg font-medium flex items-center gap-2"
              >
                <Download size={18} /> Download High-Res
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Vertical ratio filter button ───

const RatioBtn: React.FC<{
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  onDownloadAll?: () => void;
}> = ({ label, count, active, onClick, onDownloadAll }) => (
  <div className={`group relative rounded-md border transition-colors ${
    active ? 'bg-brand border-brand' : 'bg-canvas border-line hover:border-brand/40'
  }`}>
    <button
      onClick={onClick}
      className="w-full px-1.5 py-2 flex flex-col items-center gap-0.5 text-center"
      title={active ? `Đang xem ${label}` : `Chỉ xem ${label}`}
    >
      <span className={`text-[10px] font-mono font-semibold ${
        active ? 'text-white' : 'text-fg'
      }`}>
        {label}
      </span>
      <span className={`text-[9px] font-mono ${
        active ? 'text-white/80' : 'text-subtle'
      }`}>
        {count}
      </span>
    </button>
    {onDownloadAll && count > 0 && (
      <button
        onClick={(e) => { e.stopPropagation(); onDownloadAll(); }}
        className={`w-full py-1 border-t text-[9px] flex items-center justify-center gap-0.5 transition-opacity ${
          active
            ? 'border-white/20 text-white/80 hover:text-white hover:bg-white/10'
            : 'border-line text-muted hover:text-brand hover:bg-brand/5 opacity-0 group-hover:opacity-100'
        }`}
        title={`Tải tất cả ${count} banner ${label}`}
      >
        <Download size={9} /> Tải
      </button>
    )}
  </div>
);
