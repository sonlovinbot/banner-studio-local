import React, { useRef, useState, useEffect, useMemo } from 'react';
import { X, Upload, Wand2, RefreshCw, Maximize2, Download, Clipboard, AlertCircle, Layers, Package } from 'lucide-react';
import { HistoryItem, UploadedImage } from '../types';
import {
  fileToUploadedImage,
  extractImageFiles,
  filesToFileList,
  dataUrlOrUrlToUploadedImage,
  readImagesFromClipboard,
} from '../services/imageUtils';
import { getActiveBackend } from '../services/storageService';
import { addHistoryToCloud } from '../services/historyService';
import { proxiedBannerUrl } from './../services/cdnProxy';
import { generateBannerWithGemini } from '../services/geminiService';
import { generateBannerWithCoachio, getCoachioApiKey } from '../services/coachioService';
import { buildEditPrompt } from '../services/editPromptBuilder';

const MAX_EXTRAS = 3;

const ASPECT_OPTIONS = ['1:1', '9:16', '16:9', '4:3', '3:4', '4:5', '5:4'];
const QUALITY_OPTIONS = ['1K', '2K', '4K'];

const DEFAULT_GEMINI_MODEL = 'gemini-3-pro-image-preview';
const DEFAULT_COACHIO_MODEL = 'gpt_image_2';

/** Params passed to the background regen handler. Parent chịu trách nhiệm
 *  chạy gen async + cập nhật state (placeholder loading + real result khi
 *  xong). Modal đóng ngay khi user submit. */
export interface BackgroundRegenParams {
  item: HistoryItem;
  prompt: string;
  extras: UploadedImage[];
  /** Nhiều tỉ lệ cùng lúc — mỗi tỉ lệ = 1 banner riêng (multi-aspect). */
  aspectRatios: string[];
  quality: string;
}

interface HistoryEditModalProps {
  item: HistoryItem;
  onClose: () => void;
  onUpdated?: () => void;
  /** Nếu truyền vào, submit sẽ đóng modal + fire-and-forget qua handler này
   *  (parent quản lý placeholder + async gen). Nếu không truyền, dùng flow
   *  cũ (gen inline trong modal). */
  onSubmitBackground?: (params: BackgroundRegenParams) => void;
  /** Sibling history items — dùng để render panel bên trái với các version
   *  ratio (grouped by aspectRatio). Parent lọc theo sessionId (hoặc rule
   *  khác) trước khi truyền vào. */
  siblings?: HistoryItem[];
  /** Handler cho nút "Nạp lại inputs" — bấm sẽ đổ toàn bộ params (brand,
   *  refs, content, aspect, quality, model, briefs...) từ item.genParams
   *  vào BannerTool sidebar. Modal tự đóng sau khi handler được gọi. */
  onReloadInputs?: (item: HistoryItem) => void;
}

export const HistoryEditModal: React.FC<HistoryEditModalProps> = ({ item: initialItem, onClose, onUpdated, onSubmitBackground, siblings, onReloadInputs }) => {
  // Item hiện đang xem (có thể switch qua sibling trong panel bên trái)
  const [item, setItem] = useState<HistoryItem>(initialItem);
  const [prompt, setPrompt] = useState('');
  const [extras, setExtras] = useState<UploadedImage[]>([]);
  // Multi-aspect: mỗi tỉ lệ tick sẽ tạo 1 banner riêng.
  const [selectedAspectRatios, setSelectedAspectRatios] = useState<Set<string>>(
    new Set([initialItem.aspectRatio || '1:1']),
  );
  const [quality, setQuality] = useState<string>(item.quality || '1K');
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [generated, setGenerated] = useState<{ imageUrl: string; promptUsed: string; duration: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Gemini path hidden — Coachio only.
  const backend = 'coachio' as const;
  void getActiveBackend;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lazy-fetch full row (with gen_params) — list query doesn't include it
  // to avoid statement_timeout. Only pull it when the user opens edit.
  useEffect(() => {
    if (item.genParams) return;
    let cancelled = false;
    (async () => {
      try {
        const { getHistoryDetailFromCloud } = await import('../services/historyService');
        const full = await getHistoryDetailFromCloud(item.id);
        if (!cancelled && full) setItem(full);
      } catch (e) {
        console.warn('lazy load genParams failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [item.id]);

  const addExtraFiles = async (files: FileList | File[]) => {
    const room = Math.max(0, MAX_EXTRAS - extras.length);
    if (room === 0) return;
    const toLoad = Array.from(files as any as Iterable<File>).slice(0, room);
    const loaded = await Promise.all(toLoad.map(fileToUploadedImage));
    setExtras(prev => [...prev, ...loaded]);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const files = extractImageFiles(e.clipboardData?.items);
    if (files.length === 0) return;
    e.preventDefault();
    addExtraFiles(filesToFileList(files));
  };

  const handleSubmit = async () => {
    // Background mode: fire-and-forget qua parent, đóng modal ngay.
    if (onSubmitBackground) {
      if (backend === 'coachio' && !getCoachioApiKey()) {
        setErrorMsg('Coachio API key chưa cấu hình. Vào API Settings ở menu chính.');
        return;
      }
      const aspects = Array.from(selectedAspectRatios) as string[];
      if (aspects.length === 0) aspects.push(item.aspectRatio || '1:1');
      onSubmitBackground({
        item,
        prompt: prompt.trim(),
        extras,
        aspectRatios: aspects,
        quality,
      });
      onClose();
      return;
    }

    // Legacy in-modal mode: gen ngay trong modal, show result inline.
    setErrorMsg(null);
    setIsGenerating(true);
    setProgress('Preparing reference...');

    const source = proxiedBannerUrl(generated?.imageUrl || item.imageUrl);
    const base = await dataUrlOrUrlToUploadedImage(source, `base-${item.id}.png`);

    if (!base) {
      setErrorMsg('Không tải được ảnh gốc làm reference (CORS hoặc URL không truy cập được). Hãy upload lại ảnh thay thế.');
      setIsGenerating(false);
      return;
    }

    if (backend === 'coachio' && !getCoachioApiKey()) {
      setErrorMsg('Coachio API key chưa cấu hình. Vào API Settings ở menu chính.');
      setIsGenerating(false);
      return;
    }

    const referenceImage = base;
    const productImage = extras[0] ?? base;
    const extraRefs = extras.slice(1);

    // Legacy in-modal path — chỉ dùng tỉ lệ đầu tiên trong selection.
    const primaryAspect = (Array.from(selectedAspectRatios)[0] as string) || item.aspectRatio || '1:1';

    const combinedPrompt = buildEditPrompt({
      editInstruction: prompt.trim(),
      originalPrompt: item.promptUsed,
      extraRefCount: extras.length,
      sourceAspectRatio: item.aspectRatio,
      targetAspectRatio: primaryAspect,
    });

    try {
      const start = Date.now();
      let imageUrl: string;

      // Pick a model that matches the ACTIVE backend.
      // The history item's recorded model might belong to the other backend.
      const isItemCoachioModel = item.model === 'gpt_image_2' || item.model === 'google_image_gen_banana_pro';
      const isItemGeminiModel = item.model?.startsWith('gemini');
      const modelForBackend = backend === 'coachio'
        ? (isItemCoachioModel ? item.model : DEFAULT_COACHIO_MODEL)
        : (isItemGeminiModel ? item.model : DEFAULT_GEMINI_MODEL);

      if (backend === 'coachio') {
        setProgress('Calling Coachio...');
        imageUrl = await generateBannerWithCoachio(
          referenceImage, productImage, combinedPrompt, '',
          primaryAspect, quality, modelForBackend,
          (s) => setProgress(s),
          extraRefs,
        );
      } else {
        setProgress('Calling Gemini...');
        imageUrl = await generateBannerWithGemini(
          referenceImage, productImage, combinedPrompt, '',
          primaryAspect, modelForBackend, quality,
          extraRefs,
        );
      }

      const duration = (Date.now() - start) / 1000;
      const newId = Math.random().toString(36).substring(7);

      const rootParentId = item.parentId || item.id;
      const nextVersion = (item.version ?? 1) + 1;

      let persistedUrl = imageUrl;
      try {
        const saved = await addHistoryToCloud({
          id: newId,
          imageUrl,
          promptUsed: combinedPrompt,
          timestamp: Date.now(),
          duration,
          model: modelForBackend,
          quality,
          aspectRatio: primaryAspect,
          parentId: rootParentId,
          version: nextVersion,
        });
        persistedUrl = saved.imageUrl;
        onUpdated?.();
      } catch (e) {
        console.warn('addHistoryToCloud failed (still showing result)', e);
      }

      setGenerated({ imageUrl: persistedUrl, promptUsed: combinedPrompt, duration });
      setPrompt('');
      setExtras([]);
    } catch (err: any) {
      console.error('Edit regenerate failed', err);
      setErrorMsg(err?.message || 'Tạo lại banner thất bại');
    } finally {
      setIsGenerating(false);
      setProgress('');
    }
  };

  const displayUrl = proxiedBannerUrl(generated?.imageUrl || item.imageUrl);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-canvas border border-line rounded-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-line bg-surface/60">
          <div className="flex items-center gap-3">
            <div className="bg-brand/20 text-brand p-2 rounded-md border border-brand/30">
              <Wand2 size={16} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-fg flex items-center gap-2">
                Edit banner
                {item.version && item.version > 1 && (
                  <span className="text-[10px] bg-purple-500/10 text-purple-300 border border-purple-500/20 rounded-full px-2 py-0.5 font-mono">v{item.version}</span>
                )}
              </h3>
              <p className="text-[11px] text-subtle">
                Sửa prompt + thêm ảnh tham chiếu → tạo lại bằng Coachio.
                {item.parentId && <span className="text-purple-300/80"> · Chỉnh sửa từ banner gốc <span className="font-mono">{item.parentId.slice(0,6)}</span></span>}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-md hover:bg-raised text-muted hover:text-fg" aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {(() => {
          // Group siblings by aspectRatio (chỉ những item không rỗng ảnh)
          const groupedSiblings = (siblings || [])
            .filter(s => s.imageUrl)
            .reduce((acc, s) => {
              const key = s.aspectRatio || '?';
              if (!acc[key]) acc[key] = [];
              acc[key].push(s);
              return acc;
            }, {} as Record<string, HistoryItem[]>);
          const siblingRatios = Object.keys(groupedSiblings).sort();
          const showSiblingPanel = siblingRatios.length > 0 && (siblings?.length || 0) > 1;
          return (
        <div className={`flex-1 grid grid-cols-1 overflow-hidden ${
          showSiblingPanel ? 'md:grid-cols-[110px_1fr_1fr]' : 'md:grid-cols-2'
        }`}>
          {/* Left: sibling ratio thumbnails (chỉ hiện khi có siblings) */}
          {showSiblingPanel && (
            <div className="border-r border-line bg-canvas/40 overflow-y-auto p-2 space-y-3">
              <p className="text-[10px] uppercase tracking-wider text-subtle font-semibold flex items-center gap-1 sticky top-0 bg-canvas/60 backdrop-blur-sm py-1">
                <Layers size={11} /> Versions
              </p>
              {siblingRatios.map(ratio => (
                <div key={ratio} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono font-semibold text-brand">{ratio}</span>
                    <span className="text-[9px] text-subtle font-mono">{groupedSiblings[ratio].length}</span>
                  </div>
                  <div className="space-y-1">
                    {groupedSiblings[ratio].map(s => {
                      const isActive = s.id === item.id;
                      return (
                        <div key={s.id} className={`relative rounded border overflow-hidden group ${
                          isActive ? 'border-brand ring-2 ring-brand/40' : 'border-line hover:border-brand/50'
                        }`}>
                          <button
                            onClick={() => { setItem(s); setGenerated(null); }}
                            className="block w-full aspect-square"
                            title={`Xem ratio ${ratio}`}
                          >
                            <img
                              src={proxiedBannerUrl(s.imageUrl)}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          </button>
                          <a
                            href={proxiedBannerUrl(s.imageUrl)}
                            download={`banner-${ratio.replace(':', 'x')}-${s.id}.png`}
                            className="absolute bottom-0 left-0 right-0 bg-black/70 hover:bg-brand py-0.5 text-white flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-[9px]"
                            title="Tải banner này"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Download size={9} /> Tải
                          </a>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Left: preview */}
          <div className="bg-canvas border-r border-line p-5 flex flex-col items-center gap-3 overflow-y-auto">
            <div className="relative w-full max-w-[480px] aspect-square bg-surface rounded-lg overflow-hidden border border-line flex items-center justify-center">
              {isGenerating ? (
                <div className="flex flex-col items-center gap-2 text-brand text-sm">
                  <RefreshCw size={28} className="animate-spin" />
                  <span>{progress || 'Generating...'}</span>
                </div>
              ) : (
                <img src={displayUrl} alt="Banner" className="w-full h-full object-contain" />
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-center">
              <a
                href={displayUrl}
                download={`banner-${(generated ? 'edited' : 'history')}-${item.id}.png`}
                className="text-xs bg-brand hover:bg-brand-dark text-white px-3 py-1.5 rounded-md flex items-center gap-1.5"
              >
                <Download size={12} /> Tải về
              </a>
              {onReloadInputs && (
                <button
                  onClick={() => onReloadInputs(item)}
                  disabled={!item.genParams}
                  className="text-xs bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md flex items-center gap-1.5"
                  title={item.genParams
                    ? 'Nạp toàn bộ inputs (brand, refs, content, tỉ lệ, model, briefs) vào Banner Tool để tái tạo hoặc chỉnh sửa'
                    : 'Banner này được tạo trước feature này — không có snapshot inputs'}
                >
                  <Package size={12} /> Nạp lại inputs
                </button>
              )}
              {generated && (
                <span className="text-[11px] bg-success-soft text-success border border-success-fg/40 px-2 py-1 rounded-full">
                  Bản chỉnh sửa · {generated.duration.toFixed(1)}s
                </span>
              )}
            </div>
            <p className="text-[11px] text-subtle text-center max-w-[480px] leading-relaxed">
              {item.aspectRatio} · {item.quality} · {item.model}
              {onReloadInputs && !item.genParams && (
                <span className="block text-warning-fg mt-1">⚠ Banner cũ, không có snapshot để nạp lại</span>
              )}
            </p>
          </div>

          {/* Right: controls */}
          <div className="p-5 overflow-y-auto space-y-4">
            <div>
              <label className="text-xs text-muted block mb-1">Prompt chỉnh sửa</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="VD: đổi nền sang tông tím, headline đỏ to hơn, thêm CTA 'Mua ngay'..."
                className="w-full bg-canvas border border-line rounded-md p-3 text-sm text-fg focus:outline-none focus:border-brand h-24 resize-none"
              />
            </div>

            <div
              tabIndex={0}
              onPaste={handlePaste}
              className="border-2 border-dashed border-line-strong rounded-lg p-3 focus:outline-none focus:border-brand focus:ring-2 focus:ring-indigo-500/20"
              title="Click vùng này rồi Ctrl/Cmd+V để dán ảnh"
            >
              <div className="flex items-center justify-between mb-2 gap-2">
                <span className="text-xs text-muted">Ảnh tham chiếu thêm (tối đa {MAX_EXTRAS})</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={async () => {
                      const files = await readImagesFromClipboard();
                      if (files.length > 0) addExtraFiles(files);
                    }}
                    disabled={extras.length >= MAX_EXTRAS}
                    className="text-[11px] flex items-center gap-1 px-2 py-1 rounded bg-raised hover:bg-raised-2 text-fg border border-line-strong disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Dán ảnh từ clipboard"
                  >
                    <Clipboard size={11} /> Dán
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={extras.length >= MAX_EXTRAS}
                    className="text-[11px] flex items-center gap-1 px-2 py-1 rounded bg-brand hover:bg-brand-dark text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Upload size={11} /> Tải lên
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => { if (e.target.files) addExtraFiles(e.target.files); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                />
              </div>
              {extras.length === 0 ? (
                <div className="text-center text-subtle text-[11px] py-3 pointer-events-none flex flex-col items-center gap-1">
                  <span>Kéo / thả ảnh vào đây</span>
                  <span className="inline-flex items-center gap-1 text-subtle">
                    hoặc <Clipboard size={10} /> Ctrl/Cmd+V để dán
                  </span>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {extras.map((ex) => (
                    <div key={ex.id} className="relative aspect-square rounded-md overflow-hidden bg-canvas border border-line">
                      <img src={ex.url} alt="extra" className="w-full h-full object-cover" />
                      <button
                        onClick={() => setExtras(prev => prev.filter(x => x.id !== ex.id))}
                        className="absolute top-1 right-1 bg-black/70 hover:bg-danger-soft text-white rounded-full p-1"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-subtle mt-1 leading-snug">
                Ảnh đầu tiên sẽ thay vai trò <b>product</b>, các ảnh sau là style references bổ sung. Không upload gì thì ảnh banner gốc đóng vai cả 2.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted">Tỉ lệ (multi-select)</label>
                <span className="text-[10px] text-muted">
                  <b className="text-brand">{selectedAspectRatios.size}</b> / {ASPECT_OPTIONS.length} tỉ lệ chọn
                </span>
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {ASPECT_OPTIONS.map(r => {
                  const on = selectedAspectRatios.has(r);
                  return (
                    <button
                      key={r}
                      onClick={() => {
                        setSelectedAspectRatios(prev => {
                          const next = new Set(prev);
                          if (next.has(r)) {
                            if (next.size <= 1) return prev; // giữ ít nhất 1
                            next.delete(r);
                          } else {
                            next.add(r);
                          }
                          return next;
                        });
                      }}
                      className={`relative text-[11px] py-1.5 rounded-md border transition-all ${
                        on
                          ? 'bg-brand border-brand text-white font-semibold'
                          : 'bg-raised border-line-strong text-fg hover:bg-raised-2'
                      }`}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
              {onSubmitBackground && selectedAspectRatios.size > 1 && (
                <p className="text-[10px] text-brand mt-1">
                  Sẽ tạo <b>{selectedAspectRatios.size}</b> banner (mỗi tỉ lệ 1 bản) chạy song song.
                </p>
              )}
            </div>

            <div>
              <label className="text-xs text-muted block mb-1">Chất lượng</label>
              <div className="grid grid-cols-3 gap-2">
                {QUALITY_OPTIONS.map(q => (
                  <button
                    key={q}
                    onClick={() => setQuality(q)}
                    className={`text-xs py-2 rounded-md border transition-all ${
                      quality === q
                        ? 'bg-brand border-brand text-white'
                        : 'bg-raised border-line-strong text-fg hover:bg-raised-2'
                    }`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {errorMsg && (
              <div className="bg-danger-soft border border-danger-fg/40 rounded-md p-3 flex items-start gap-2">
                <AlertCircle size={14} className="text-danger shrink-0 mt-0.5" />
                <p className="text-xs text-danger">{errorMsg}</p>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={isGenerating}
              className={`w-full py-3 rounded-lg font-bold text-white shadow-lg flex items-center justify-center gap-2 transition-all ${
                isGenerating
                  ? 'bg-raised-2 cursor-not-allowed opacity-60 text-fg'
                  : backend === 'coachio'
                    ? 'bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500'
                    : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500'
              }`}
            >
              {isGenerating ? (
                <><RefreshCw size={18} className="animate-spin" /> {progress || 'Đang tạo...'}</>
              ) : (
                <>
                  <Wand2 size={18} />
                  {onSubmitBackground ? 'Chạy nền · Tạo lại' : 'Tạo lại banner'}
                </>
              )}
            </button>
            {onSubmitBackground && (
              <p className="text-[10px] text-subtle text-center leading-tight -mt-1">
                Modal sẽ đóng ngay khi bấm — banner mới chạy ngầm và hiện ở Sessions panel với loading spinner.
              </p>
            )}
          </div>
        </div>
          );
        })()}
      </div>
    </div>
  );
};
