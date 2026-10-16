import React, { useState } from 'react';
import {
  UserSquare2, Wand2, AlertCircle, ArrowLeft, Key, Type,
} from 'lucide-react';
import {
  UploadedImage, GeneratedBanner, AppPage, LibraryCategory, LibraryImage, BrandProject, HistoryItem,
} from '../types';
import { ResultViewer } from './ResultViewer';
import { SessionsPanel } from './SessionsPanel';
import { describeGenError } from '../services/genErrors';
import { HistoryEditModal } from './HistoryEditModal';
import { BrandRow } from './banner/BrandRow';
import { OutputRow } from './banner/OutputRow';
import { AdvancedPopover } from './banner/AdvancedPopover';
import { ReferencePickerModal } from './banner/ReferencePickerModal';
import { UgcReferencesRow } from './ugc/UgcReferencesRow';
import { generateUgcWithGemini } from '../services/geminiService';
import { generateUgcWithOpenai, getOpenaiApiKey } from '../services/openaiImageService';
import { withOpenaiFallback, fallbackSuccessNotice } from '../services/genFallback';
import { generateUgcWithCoachio, getCoachioApiKey } from '../services/coachioService';
import {
  getGeminiApiKey, getActiveBackend, setActiveBackend,
  getLibrary,
} from '../services/storageService';
import { addHistoryToCloud, listHistoryPage, removeHistoryFromCloud } from '../services/historyService';
import { Pagination } from './Pagination';
import { PAGE_SIZE } from '../services/pagination';
import { listBrandProjectsFromCloud } from '../services/brandProjectService';
import {
  listLibraryFromCloud,
  addFileToLibrary,
  removeLibraryItemFromCloud,
  bulkMigrateLibrary,
} from '../services/imageLibraryService';
import { libraryItemToUploadedImageAsync } from '../services/imageUtils';
import { ApiKeySettings } from './ApiKeySettings';

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

type BackendType = 'gemini' | 'coachio';

interface Props {
  onNavigate: (page: AppPage) => void;
}

export const UGCStudio: React.FC<Props> = ({ onNavigate }) => {
  const [faceImages, setFaceImages] = useState<UploadedImage[]>([]);
  const [fashionImages, setFashionImages] = useState<UploadedImage[]>([]);
  const [prodImages, setProdImages] = useState<UploadedImage[]>([]);
  const [userPrompt, setUserPrompt] = useState<string>('');
  const [brandContent, setBrandContent] = useState<string>('');
  const [aspectRatio, setAspectRatio] = useState<string>('4:5');
  // UGC chọn một tỉ lệ; OutputRow nhận Set nên gói lại ở đây.
  const ugcAspectSet = React.useMemo(() => new Set([aspectRatio]), [aspectRatio]);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3-pro-image-preview');
  const [coachioModel, setCoachioModel] = useState<string>('gpt_image_2');
  const [imageSize, setImageSize] = useState<string>('1K');
  const [variantCount, setVariantCount] = useState<number>(4);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [results, setResults] = useState<GeneratedBanner[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** Thông báo đã chuyển provider — cảnh báo, không phải lỗi (ảnh vẫn ra). */
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  // Gemini path hidden — Coachio only. State kept for unreachable legacy branches.
  const [backend, setBackendState] = useState<BackendType>('coachio');
  const [showApiKeySettings, setShowApiKeySettings] = useState(false);
  const [, setGenerationProgress] = useState<Record<string, string>>({});

  const [faceLibrary, setFaceLibrary] = useState<LibraryImage[]>([]);
  const [fashionLibrary, setFashionLibrary] = useState<LibraryImage[]>([]);
  const [prodLibrary, setProdLibrary] = useState<LibraryImage[]>([]);
  const localFaceCount = getLibrary('face').length;
  const localFashionCount = getLibrary('ref').length;
  const localProdCount = getLibrary('prod').length;

  React.useEffect(() => {
    listLibraryFromCloud('face').then(setFaceLibrary).catch(() => {});
    listLibraryFromCloud('ref').then(setFashionLibrary).catch(() => {});
    listLibraryFromCloud('prod').then(setProdLibrary).catch(() => {});
  }, []);
  const [brandProjects, setBrandProjects] = useState<BrandProject[]>([]);
  React.useEffect(() => { listBrandProjectsFromCloud().then(setBrandProjects).catch(() => {}); }, []);
  const [activeBrandId, setActiveBrandId] = useState<string>('');

  // History + Sessions panel state (mirrors BannerTool).
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [editingItem, setEditingItem] = useState<HistoryItem | null>(null);
  // Panel phiên gần đây phân trang phía server — trước đây kéo 500 row mỗi
  // lần mount. Một phiên nằm vắt qua ranh giới trang sẽ bị cắt đôi; panel vốn
  // đã cắt bằng maxSessions nên đây vẫn là cải thiện.
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const refreshHistory = React.useCallback(() => {
    listHistoryPage({ page: historyPage, pageSize: PAGE_SIZE, featureType: 'ugc' })
      .then(res => {
        setHistory(res.items);
        setHistoryTotal(res.total);
        setHistoryTotalPages(res.totalPages);
        if (res.page !== historyPage) setHistoryPage(res.page);
      })
      .catch(() => {});
  }, [historyPage]);
  React.useEffect(() => { refreshHistory(); }, [refreshHistory]);

  const deleteHistoryItem = React.useCallback(async (item: HistoryItem) => {
    try {
      await removeHistoryFromCloud(item.id);
      setHistory(prev => prev.filter(h => h.id !== item.id));
    } catch (e: any) {
      console.warn('deleteHistoryItem failed', e);
      alert(`Xoá lỗi: ${e?.message || 'unknown'}`);
    }
  }, []);

  const deleteHistorySession = React.useCallback(async (ids: string[]) => {
    try {
      await Promise.all(ids.map(id => removeHistoryFromCloud(id).catch(e => {
        console.warn('deleteHistorySession item failed', id, e);
      })));
      setHistory(prev => prev.filter(h => !ids.includes(h.id)));
    } catch (e: any) {
      console.warn('deleteHistorySession failed', e);
    }
  }, []);

  // Reference picker modals (Face / Fashion / Product live in popups now).
  const [showFaceModal, setShowFaceModal] = useState(false);
  const [showFashionModal, setShowFashionModal] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);

  const hasCoachioKey = !!getCoachioApiKey();
  const hasGoogleKey =
    !!getGeminiApiKey() ||
    (import.meta.env.VITE_GEMINI_API_KEY && import.meta.env.VITE_GEMINI_API_KEY !== 'your_api_key_here');

  const setBackend = (b: BackendType) => { setBackendState(b); setActiveBackend(b); };

  const processFile = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (e) => reject(e);
    });

  const persistToLibrary = async (file: File, category: LibraryCategory) => {
    try {
      const item = await addFileToLibrary(file, category);
      if (category === 'face') setFaceLibrary(prev => [item, ...prev]);
      else if (category === 'ref') setFashionLibrary(prev => [item, ...prev]);
      else setProdLibrary(prev => [item, ...prev]);
    } catch (e) { console.error('Library save to cloud failed', e); }
  };

  const setterFor = (slot: 'face' | 'fashion' | 'prod') =>
    slot === 'face' ? setFaceImages : slot === 'fashion' ? setFashionImages : setProdImages;

  const categoryFor = (slot: 'face' | 'fashion' | 'prod'): LibraryCategory =>
    slot === 'face' ? 'face' : slot === 'fashion' ? 'ref' : 'prod';

  const handleUpload = async (files: FileList, slot: 'face' | 'fashion' | 'prod') => {
    const fileArray = Array.from(files);
    const processed = await Promise.all(
      fileArray.map(async (file) => {
        try {
          const base64 = await processFile(file);
          return {
            uploaded: {
              id: Math.random().toString(36).substring(7),
              url: URL.createObjectURL(file),
              file, base64, mimeType: file.type,
            } as UploadedImage,
            file,
          };
        } catch { return null; }
      })
    );
    const newImages = processed.filter(Boolean).map(p => p!.uploaded);
    setterFor(slot)(prev => [...prev, ...newImages]);
    const category = categoryFor(slot);
    await Promise.all(processed.filter(Boolean).map(p => persistToLibrary(p!.file, category)));
  };

  const handleRemove = (id: string, slot: 'face' | 'fashion' | 'prod') => {
    setterFor(slot)(prev => prev.filter(i => i.id !== id));
  };

  const handleLibrarySelect = async (item: LibraryImage, slot: 'face' | 'fashion' | 'prod') => {
    try {
      const uploaded = await libraryItemToUploadedImageAsync(item);
      setterFor(slot)(prev => [...prev, uploaded]);
    } catch (e) { console.warn('library select failed', e); }
  };

  const handleLibraryDelete = async (id: string, slot: 'face' | 'fashion' | 'prod') => {
    try {
      await removeLibraryItemFromCloud(id);
      if (slot === 'face') setFaceLibrary(prev => prev.filter(i => i.id !== id));
      else if (slot === 'fashion') setFashionLibrary(prev => prev.filter(i => i.id !== id));
      else setProdLibrary(prev => prev.filter(i => i.id !== id));
    } catch (e) { console.warn('library delete failed', e); }
  };

  const migrateLocalLibraries = async () => {
    try {
      const f = await bulkMigrateLibrary(getLibrary('face'), 'face');
      const s = await bulkMigrateLibrary(getLibrary('ref'), 'ref');
      const p = await bulkMigrateLibrary(getLibrary('prod'), 'prod');
      const [face, fashion, prod] = await Promise.all([
        listLibraryFromCloud('face'),
        listLibraryFromCloud('ref'),
        listLibraryFromCloud('prod'),
      ]);
      setFaceLibrary(face);
      setFashionLibrary(fashion);
      setProdLibrary(prod);
      setErrorMsg(`Migrate: +${f.inserted} face, +${s.inserted} fashion, +${p.inserted} prod`);
    } catch (e: any) {
      setErrorMsg(`Migrate lỗi: ${e?.message || 'unknown'}`);
    }
  };

  const applyBrandProject = (projectId: string) => {
    if (!projectId) { setActiveBrandId(''); return; }
    const project = brandProjects.find(p => p.id === projectId);
    if (!project) return;

    const styleSource: LibraryImage[] = [
      ...(project.logo ? [project.logo] : []),
      ...(project.styleReferences ?? project.references ?? []),
    ];
    const productSource: LibraryImage[] = project.productReferences ?? [];

    const styleKeys = new Set(fashionImages.map(i => i.url || i.base64));
    const prodKeys = new Set(prodImages.map(i => i.url || i.base64));

    Promise.all(
      styleSource
        .filter(i => !styleKeys.has(i.url || i.base64 || ''))
        .map(i => libraryItemToUploadedImageAsync(i).catch(() => null)),
    ).then(items => {
      const fresh = items.filter(Boolean) as any;
      if (fresh.length) setFashionImages(prev => [...prev, ...fresh]);
    });

    Promise.all(
      productSource
        .filter(i => !prodKeys.has(i.url || i.base64 || ''))
        .map(i => libraryItemToUploadedImageAsync(i).catch(() => null)),
    ).then(items => {
      const fresh = items.filter(Boolean) as any;
      if (fresh.length) setProdImages(prev => [...prev, ...fresh]);
    });

    const composedBrand = [project.brandInfo, project.eventInfo]
      .filter(s => (s || '').trim())
      .join('\n');
    if (composedBrand) setBrandContent(composedBrand);

    const jsonRaw = (project.jsonPrompt || '').trim();
    if (jsonRaw) {
      const jsonLine = `Brand reference (JSON): ${jsonRaw}`;
      setUserPrompt(prev => prev.trim() ? `${prev}\n${jsonLine}` : jsonLine);
    }
    setActiveBrandId(project.id);
  };

  const generateSingle = async (
    placeholder: GeneratedBanner,
    face: UploadedImage,
    fashion: UploadedImage,
    product: UploadedImage,
    combinedPrompt: string,
    sessionId?: string,
  ) => {
    const startTime = Date.now();
    let imageUrl: string;
    if (backend === 'coachio') {
      const progress = (status: string) =>
        setGenerationProgress(prev => ({ ...prev, [placeholder.id]: status }));
      // Coachio hỏng vì lý do phía Coachio (hết credit, key, rate limit) thì
      // chạy lại bằng OpenAI thay vì bắt user tự đổi backend rồi gen lại.
      const out = await withOpenaiFallback<string>({
        fallbackAvailable: !!getOpenaiApiKey(),
        onNotice: (m) => { setFallbackNotice(m); progress(m); },
        primary: () => generateUgcWithCoachio(
          face, fashion, product, combinedPrompt, brandContent,
          aspectRatio, imageSize, coachioModel, progress,
        ),
        fallback: () => generateUgcWithOpenai(
          face, fashion, product, combinedPrompt, brandContent,
          aspectRatio, imageSize, progress,
        ),
      });
      imageUrl = out.result;
      if (out.usedFallback) setFallbackNotice(fallbackSuccessNotice(out.primaryError));
    } else {
      imageUrl = await generateUgcWithGemini(
        face, fashion, product, combinedPrompt, brandContent,
        aspectRatio, selectedModel, imageSize,
      );
    }
    const duration = (Date.now() - startTime) / 1000;
    let persistedUrl = imageUrl;
    try {
      const saved = await addHistoryToCloud({
        id: placeholder.id,
        imageUrl,
        promptUsed: combinedPrompt,
        timestamp: Date.now(),
        duration,
        // featureType is the discriminator now; don't prefix the model name.
        model: backend === 'coachio' ? coachioModel : selectedModel,
        quality: imageSize,
        aspectRatio,
        featureType: 'ugc',
        sessionId,
      });
      persistedUrl = saved.imageUrl;
    } catch (e) {
      console.warn('addHistoryToCloud (UGC) failed', e);
    }
    return { imageUrl: persistedUrl, duration };
  };

  const handleGenerate = async () => {
    if (faceImages.length === 0 || fashionImages.length === 0 || prodImages.length === 0) {
      setErrorMsg('Vui lòng upload ít nhất 1 ảnh ở Face, Fashion + Style và Product.');
      return;
    }
    if (backend === 'coachio' && !getCoachioApiKey()) {
      setErrorMsg('Coachio API key chưa cấu hình.');
      setShowApiKeySettings(true);
      return;
    }
    if (backend === 'gemini' && !hasGoogleKey) {
      setErrorMsg('Google API key chưa cấu hình.');
      setShowApiKeySettings(true);
      return;
    }

    setErrorMsg(null);
    setFallbackNotice(null);
    setIsGenerating(true);
    setGenerationProgress({});

    const placeholders: GeneratedBanner[] = Array.from({ length: variantCount }).map(() => ({
      id: Math.random().toString(36).substring(7),
      imageUrl: '', promptUsed: '', status: 'loading', timestamp: Date.now(),
    }));
    setResults(placeholders);

    const varietyPrompts = [
      'Candid lifestyle shot, soft daylight.',
      'Studio-grade lighting, premium look.',
      'Outdoor casual scene with natural mood.',
      'Close-up POV, social-media native composition.',
      'Editorial-style framing, cinematic colors.',
    ];

    // Share a sessionId across every generation in this batch so the
    // Sessions panel groups them correctly.
    const sessionId = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const promises = placeholders.map(async (placeholder) => {
      try {
        const face = getRandomItem<UploadedImage>(faceImages);
        const fashion = getRandomItem<UploadedImage>(fashionImages);
        const product = getRandomItem<UploadedImage>(prodImages);
        const nuance = getRandomItem<string>(varietyPrompts);
        const combinedPrompt = `${userPrompt}. ${nuance}`.trim();

        const { imageUrl, duration } = await generateSingle(placeholder, face, fashion, product, combinedPrompt, sessionId);
        setResults(prev => prev.map(p =>
          p.id === placeholder.id
            ? { ...p, imageUrl, status: 'success', promptUsed: combinedPrompt, duration, refImage: fashion, prodImage: product }
            : p,
        ));
      } catch (err: any) {
        console.error('UGC generation failed', err);
        // Giữ nguyên văn message của provider + gắn hướng xử lý. Trước đây
        // đoạn này gộp mọi lỗi về vài câu cố định nên lý do thật biến mất.
        const info = describeGenError(err);
        setErrorMsg(`${info.title} — ${info.detail}${info.hint ? `\n${info.hint}` : ''}`);
        setResults(prev => prev.map(p => p.id === placeholder.id
          ? { ...p, status: 'error', errorMsg: info.detail }
          : p));
      }
    });

    await Promise.all(promises);
    setIsGenerating(false);
    setGenerationProgress({});
    refreshHistory();
  };

  const handleRegenerate = async (id: string, adjustmentPrompt: string) => {
    const target = results.find(r => r.id === id);
    if (!target || !target.refImage || !target.prodImage) return;
    if (faceImages.length === 0) { setErrorMsg('Cần ít nhất 1 face để regenerate.'); return; }

    setResults(prev => prev.map(p => p.id === id ? { ...p, status: 'loading' } : p));
    try {
      const combinedPrompt = `${target.promptUsed}. Adjustment: ${adjustmentPrompt}`;
      const face = getRandomItem<UploadedImage>(faceImages);
      const { imageUrl, duration } = await generateSingle({ ...target, id }, face, target.refImage, target.prodImage, combinedPrompt);
      setResults(prev => prev.map(p => p.id === id ? { ...p, imageUrl, status: 'success', promptUsed: combinedPrompt, duration } : p));
    } catch (err: any) {
      const info = describeGenError(err);
      setErrorMsg(`${info.title} — ${info.detail}${info.hint ? `\n${info.hint}` : ''}`);
      setResults(prev => prev.map(p => p.id === id ? { ...p, status: 'error', errorMsg: info.detail } : p));
    }
  };

  const bananaProAspectRatios = ['1:1', '9:16', '16:9', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
  const gptImage2AspectRatios = ['auto', '1:1', '5:4', '9:16', '21:9', '16:9', '4:3', '3:2', '4:5', '3:4', '2:3'];
  const geminiAspectRatios = ['1:1', '9:16', '16:9'];
  const currentAspectRatios = backend === 'coachio'
    ? (coachioModel === 'gpt_image_2' ? gptImage2AspectRatios : bananaProAspectRatios)
    : geminiAspectRatios;

  const isGptImage2 = backend === 'coachio' && coachioModel === 'gpt_image_2';
  const isResolutionDisabled = (size: string) => {
    if (!isGptImage2) return false;
    if (aspectRatio === 'auto' && size !== '1K') return true;
    if (aspectRatio === '1:1' && size === '4K') return true;
    return false;
  };

  React.useEffect(() => {
    if (!isGptImage2) return;
    if (aspectRatio === 'auto' && imageSize !== '1K') setImageSize('1K');
    else if (aspectRatio === '1:1' && imageSize === '4K') setImageSize('2K');
  }, [isGptImage2, aspectRatio, imageSize]);

  React.useEffect(() => {
    if (!currentAspectRatios.includes(aspectRatio)) setAspectRatio(currentAspectRatios[0]);
  }, [coachioModel, backend]);

  const accent = backend === 'coachio'
    ? { bg: 'bg-brand', border: 'border-brand' }
    : { bg: 'bg-brand', border: 'border-brand' };

  return (
    <div className="flex h-screen w-full bg-canvas text-fg font-sans">
      {/* Sidebar */}
      <div className="w-80 sm:w-96 flex-shrink-0 bg-surface border-r border-line flex flex-col h-full overflow-hidden">
        <div className="p-6 border-b border-line flex items-center gap-3">
          <button
            onClick={() => onNavigate('menu')}
            className="p-2 rounded-lg hover:bg-raised text-muted hover:text-fg"
            title="Back to Menu"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="bg-brand p-2 rounded-lg text-white">
            <UserSquare2 size={24} />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-fg tracking-tight">UGC Studio</h1>
            <p className="text-xs text-brand font-mono">Face-consistent</p>
          </div>
          <button
            onClick={() => setShowApiKeySettings(true)}
            className={`p-2 rounded-lg transition-colors ${
              hasCoachioKey
                ? 'bg-success-fg/10 text-success hover:bg-success-fg/20'
                : 'bg-raised text-muted hover:bg-raised-2 hover:text-white'
            }`}
            title="API Key Settings"
          >
            <Key size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Backend selector hidden — Coachio only. Warn if key missing. */}
          {!hasCoachioKey && (
            <div className="status-warning border rounded-md px-3 py-2.5 text-xs flex items-center justify-between gap-2">
              <span>Chưa có Coachio API key — bắt buộc để generate UGC.</span>
              <button
                onClick={() => setShowApiKeySettings(true)}
                className="text-xs font-semibold underline hover:no-underline shrink-0"
              >
                Thêm key
              </button>
            </div>
          )}

          {/* References — 3 compact cards (Face / Fashion / Product) */}
          <UgcReferencesRow
            faceImages={faceImages}
            fashionImages={fashionImages}
            productImages={prodImages}
            onOpenFace={() => setShowFaceModal(true)}
            onOpenFashion={() => setShowFashionModal(true)}
            onOpenProduct={() => setShowProductModal(true)}
          />

          <div className="h-px bg-raised" />

          {/* Brand — compact row (shared with BannerTool) */}
          <BrandRow
            projects={brandProjects}
            activeBrandId={activeBrandId}
            onApply={applyBrandProject}
            onClear={() => setActiveBrandId('')}
            onNavigate={onNavigate}
          />

          {/* Configuration wrapper */}
          <div className="space-y-4">
            {/* Output row — Aspect / Quality / Số bản */}
            <OutputRow
              // OutputRow đã chuyển sang API multi-select (Set + onToggle).
              // UGC vẫn là chọn-một, nên bọc giá trị đơn thành Set 1 phần tử
              // và toggle = thay thế. Trước đây chỗ này còn truyền
              // aspectRatio/onChangeAspect của API cũ nên selectedAspectRatios
              // là undefined và cả tab UGC crash khi render.
              selectedAspectRatios={ugcAspectSet}
              aspectRatios={currentAspectRatios}
              onToggleAspect={setAspectRatio}
              quality={imageSize}
              qualities={['1K', '2K', '4K']}
              isQualityDisabled={isResolutionDisabled}
              onChangeQuality={setImageSize}
              qtyLabel="Số bản"
              qty={variantCount}
              qtyMax={10}
              onChangeQty={setVariantCount}
              totalPreview={variantCount}
            />

            {/* Brand content */}
            <div>
              <label className="text-xs font-semibold text-subtle uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <Type size={12} /> Brand Content
              </label>
              <textarea
                value={brandContent}
                onChange={(e) => setBrandContent(e.target.value)}
                placeholder="Tên brand, slogan, tone of voice…"
                className="w-full bg-canvas border border-line rounded-md p-3 text-sm text-fg focus:outline-none focus:border-brand h-20 resize-none"
              />
            </div>

            {/* Prompt Adjustments */}
            <div>
              <label className="text-[10px] text-subtle uppercase tracking-wider block mb-1">
                Điều chỉnh prompt
              </label>
              <textarea
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                placeholder="VD: ngồi quán cafe, ánh sáng tự nhiên, đang cầm sản phẩm…"
                className="w-full bg-canvas border border-line rounded-md p-3 text-sm text-fg focus:outline-none focus:border-brand h-16 resize-none"
              />
            </div>

            {/* Advanced — Model picker collapsed */}
            <AdvancedPopover
              coachioModel={coachioModel}
              coachioModels={[
                { id: 'google_image_gen_banana_pro', name: 'Nano Banana Pro' },
                { id: 'gpt_image_2', name: 'GPT Image 2' },
              ]}
              onChangeCoachioModel={setCoachioModel}
              bannerType=""
              bannerTypeOptions={[]}
              onChangeBannerType={() => {}}
            />
          </div>

          {fallbackNotice && (
            <div className="bg-warning-soft border border-warning-fg/40 rounded-md p-3 flex items-start gap-2">
              <AlertCircle size={14} className="text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-warning-fg whitespace-pre-line leading-relaxed">{fallbackNotice}</p>
            </div>
          )}
          {errorMsg && (
            <div className="bg-danger-soft border border-danger-fg/40 rounded-md p-3 flex items-start gap-2">
              <AlertCircle size={16} className="text-danger shrink-0 mt-0.5" />
              <p className="text-xs text-danger whitespace-pre-line leading-relaxed">{errorMsg}</p>
            </div>
          )}
        </div>

        <div className="p-6 bg-surface border-t border-line">
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className={`w-full py-4 rounded-xl font-bold text-white shadow-lg flex items-center justify-center gap-2 transition-all transform ${
              isGenerating
                ? 'bg-raised-2 cursor-not-allowed opacity-50 text-fg'
                : 'bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 hover:scale-[1.02] active:scale-95'
            }`}
          >
            {isGenerating ? (
              <><Wand2 className="animate-spin" size={20} /> Generating {variantCount} variant{variantCount !== 1 ? 's' : ''}…</>
            ) : (
              <><Wand2 size={20} /> Generate via {coachioModel === 'gpt_image_2' ? 'GPT Image 2' : 'Nano Banana Pro'}</>
            )}
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col h-full bg-canvas relative overflow-hidden">
        <header className="h-16 flex items-center justify-between px-6 border-b border-line bg-surface/50 backdrop-blur-sm z-10">
          <h2 className="font-medium text-fg">UGC Workspace</h2>
          <div className="flex items-center gap-4 text-xs text-subtle">
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isGenerating ? 'bg-warning-fg animate-pulse' : 'bg-success-fg'}`} />
              {isGenerating ? 'Generating' : 'Ready'}
            </span>
            <span className="px-2 py-0.5 rounded-full border bg-brand/10 border-brand/30 text-brand font-mono">
              {coachioModel === 'gpt_image_2' ? 'GPT Image 2' : 'Nano Banana Pro'}
            </span>
            <span className="font-mono">{imageSize} · {aspectRatio}</span>
          </div>
        </header>
        <main className="flex-1 overflow-hidden relative flex flex-col">
          {/* Theme-aware background so the workspace looks right in both light
              and dark modes. Was hardcoded from-cyan-900/20 via-gray-950 which
              only worked on dark. Now uses brand tint over canvas — same as
              BannerTool. */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-brand/10 via-canvas to-canvas pointer-events-none" />
          {results.length === 0 ? (
            <div className="relative flex-1 min-h-0 flex flex-col z-10">
              <SessionsPanel
                history={history}
                featureType="ugc"
                fullHeight
                footer={<Pagination page={historyPage} totalPages={historyTotalPages} total={historyTotal} unit="UGC" onChange={setHistoryPage} />}
                onSelectItem={(it) => setEditingItem(it)}
                onDeleteItem={deleteHistoryItem}
                onDeleteSession={deleteHistorySession}
                onOpenFullHistory={() => onNavigate('history')}
              />
            </div>
          ) : (
            <>
              <div className="relative flex-1 min-h-0 overflow-hidden">
                <ResultViewer results={results} onRegenerate={handleRegenerate} />
              </div>
              <div className="relative shrink-0 z-10">
                <SessionsPanel
                  history={history}
                  featureType="ugc"
                  footer={<Pagination page={historyPage} totalPages={historyTotalPages} total={historyTotal} unit="UGC" onChange={setHistoryPage} />}
                  onSelectItem={(it) => setEditingItem(it)}
                  onOpenFullHistory={() => onNavigate('history')}
                />
              </div>
            </>
          )}
        </main>
      </div>

      {showApiKeySettings && <ApiKeySettings onClose={() => setShowApiKeySettings(false)} />}

      {/* Reference pickers — mirrors BannerTool's modal-based ref UX */}
      {showFaceModal && (
        <ReferencePickerModal
          kind="face"
          images={faceImages}
          library={faceLibrary}
          onUpload={(f) => handleUpload(f, 'face')}
          onRemove={(id) => handleRemove(id, 'face')}
          onLibrarySelect={(item) => handleLibrarySelect(item, 'face')}
          onLibraryDelete={(id) => handleLibraryDelete(id, 'face')}
          onClose={() => setShowFaceModal(false)}
        />
      )}
      {showFashionModal && (
        <ReferencePickerModal
          kind="fashion"
          images={fashionImages}
          library={fashionLibrary}
          onUpload={(f) => handleUpload(f, 'fashion')}
          onRemove={(id) => handleRemove(id, 'fashion')}
          onLibrarySelect={(item) => handleLibrarySelect(item, 'fashion')}
          onLibraryDelete={(id) => handleLibraryDelete(id, 'fashion')}
          onClose={() => setShowFashionModal(false)}
        />
      )}
      {showProductModal && (
        <ReferencePickerModal
          kind="product"
          images={prodImages}
          library={prodLibrary}
          onUpload={(f) => handleUpload(f, 'prod')}
          onRemove={(id) => handleRemove(id, 'prod')}
          onLibrarySelect={(item) => handleLibrarySelect(item, 'prod')}
          onLibraryDelete={(id) => handleLibraryDelete(id, 'prod')}
          onClose={() => setShowProductModal(false)}
        />
      )}

      {editingItem && (
        <HistoryEditModal
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onUpdated={() => refreshHistory()}
        />
      )}
    </div>
  );
};
