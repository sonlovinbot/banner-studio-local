import React, { useState } from 'react';
import { Wand2, AlertCircle, ArrowLeft, Key, Trash2, X, Type } from 'lucide-react';
import { UploadedImage, GeneratedBanner, AppPage, LibraryCategory, LibraryImage, BrandSnippet, BrandProject, VotedBanner, HistoryItem, RegenRetryPayload, GenParamsSnapshot, StoredImageRef } from '../types';
import { SessionsPanel } from './SessionsPanel';
import { HistoryEditModal, BackgroundRegenParams } from './HistoryEditModal';
import { ImageUploader } from './ImageUploader';
import { ResultViewer } from './ResultViewer';
import { generateBannerWithGemini } from '../services/geminiService';
import { generateBannerWithCoachio, getCoachioApiKey } from '../services/coachioService';
import { generateBannerWithOpenai, getOpenaiApiKey } from '../services/openaiImageService';
import {
  generateImageWithKie, getKieApiKey, KIE_IMAGE_MODELS, DEFAULT_KIE_MODEL,
} from '../services/kieService';
import { BrandBrief } from '../types';
import { listBriefsForBrand, deleteBrief, updateBrief } from '../services/brandBriefService';
import {
  listUrlCrawlBriefs,
  replaceUrlCrawlBriefs as replaceUrlCrawlBriefsCloud,
  setUrlCrawlBriefsEnabled,
  clearUrlCrawlBriefs as clearUrlCrawlBriefsCloud,
  updateUrlCrawlBrief,
  deleteUrlCrawlBrief,
} from '../services/urlCrawlBriefService';
import { RawBrief } from '../services/contentImportService';
import { BrandRow } from './banner/BrandRow';
import { ReferencesRow } from './banner/ReferencesRow';
import { ReferencePickerModal } from './banner/ReferencePickerModal';
import { ContentSection } from './banner/ContentSection';
import { MultiContentModal } from './banner/MultiContentModal';
import { OutputRow } from './banner/OutputRow';
import { AdvancedPopover } from './banner/AdvancedPopover';
import {
  getGeminiApiKey,
  getActiveBackend,
  setActiveBackend,
  getLibrary,
} from '../services/storageService';
import { addHistoryToCloud, listHistoryPage, removeHistoryFromCloud } from '../services/historyService';
import { Pagination } from './Pagination';
import { PAGE_SIZE } from '../services/pagination';
import {
  listVotesFromCloud,
  addVoteToCloud,
  removeVoteFromCloud,
} from '../services/votesService';
import {
  listSnippetsFromCloud,
  addSnippetToCloud,
  removeSnippetFromCloud,
} from '../services/brandSnippetService';
import {
  listBrandProjectsFromCloud,
} from '../services/brandProjectService';
import {
  listLibraryFromCloud,
  addFileToLibrary,
  addDataUrlToLibrary,
  removeLibraryItemFromCloud,
  bulkMigrateLibrary,
} from '../services/imageLibraryService';
import { libraryItemToUploadedImage, libraryItemToUploadedImageAsync, dataUrlOrUrlToUploadedImage } from '../services/imageUtils';
import { proxiedBannerUrl } from '../services/cdnProxy';
import { mirrorEditRefsToCdn, restoreEditRefs } from '../services/regenService';
import { buildEditPrompt } from '../services/editPromptBuilder';
import { describeGenError } from '../services/genErrors';
import { withOpenaiFallback, fallbackSuccessNotice } from '../services/genFallback';
import { ApiKeySettings } from './ApiKeySettings';

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

// ─────────── Pending regen tasks (localStorage persist) ───────────

/** Task pending trong background — persist qua reload để user thấy status
 *  của các task cũ (running / error / timeout) sau khi F5. */
interface PendingRegenTask {
  taskId: string;
  startedAt: number;
  payload: RegenRetryPayload;
  status?: 'error' | 'timeout';
  errorMsg?: string;
}

const PENDING_TASKS_KEY = 'bannerAds:pendingRegenTasks';

function readPendingRegenTasks(): PendingRegenTask[] {
  try {
    const raw = localStorage.getItem(PENDING_TASKS_KEY);
    return raw ? (JSON.parse(raw) as PendingRegenTask[]) : [];
  } catch {
    return [];
  }
}

function savePendingRegenTasks(tasks: PendingRegenTask[]): void {
  try {
    localStorage.setItem(PENDING_TASKS_KEY, JSON.stringify(tasks));
  } catch (e) {
    console.warn('Persist pending regen tasks failed', e);
  }
}

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

type BackendType = 'gemini' | 'coachio';
/** Backend cho tier 2K/4K. */
type HqBackend = 'coachio' | 'openai' | 'kie';

type BannerType = 'general' | 'ads' | 'sale' | 'awareness' | 'software';

const MAX_CONTENTS = 5;
const MAX_VERSIONS_PER_CONTENT = 3;

const BANNER_TYPE_OPTIONS: { id: BannerType; label: string; hint: string }[] = [
  { id: 'general',   label: 'General',                hint: 'Banner tổng quát, không ràng buộc đặc thù.' },
  { id: 'ads',       label: 'Performance Ads',        hint: 'Headline + value prop + CTA mạnh + logo nổi.' },
  { id: 'sale',      label: 'Sale / Promo',           hint: 'Nhấn giảm giá + urgency + CTA gấp.' },
  { id: 'awareness', label: 'Brand Awareness',        hint: 'Tối giản, lifestyle, brand identity dẫn dắt.' },
  { id: 'software',  label: 'Software / Thumbnail',   hint: 'Screenshot / app preview, kiểu YouTube thumbnail — headline khổng lồ, contrast cao.' },
];

export type OutputLang = 'vi' | 'en';

/** Map Meta CTA code → button label in target language. Empty when NO_BUTTON. */
export function ctaLabelFor(cta: string | undefined | null, lang: OutputLang): string {
  if (!cta) return '';
  const vi: Record<string, string> = {
    SHOP_NOW: 'Mua ngay',
    BUY_NOW: 'Mua ngay',
    SIGN_UP: 'Đăng ký ngay',
    SUBSCRIBE: 'Đăng ký',
    LEARN_MORE: 'Xem thêm',
    WATCH_MORE: 'Xem ngay',
    GET_OFFER: 'Nhận Ưu đãi ngay',
    DOWNLOAD: 'Tải ngay',
    BOOK_TRAVEL: 'Đặt ngay',
    CONTACT_US: 'Liên hệ ngay',
    GET_QUOTE: 'Nhận báo giá',
    MESSAGE_PAGE: 'Nhắn tin',
    INSTALL_MOBILE_APP: 'Cài đặt',
    NO_BUTTON: '',
  };
  const en: Record<string, string> = {
    SHOP_NOW: 'Shop Now',
    BUY_NOW: 'Buy Now',
    SIGN_UP: 'Sign Up',
    SUBSCRIBE: 'Subscribe',
    LEARN_MORE: 'Learn More',
    WATCH_MORE: 'Watch Now',
    GET_OFFER: 'Get Offer',
    DOWNLOAD: 'Download',
    BOOK_TRAVEL: 'Book Now',
    CONTACT_US: 'Contact Us',
    GET_QUOTE: 'Get Quote',
    MESSAGE_PAGE: 'Message',
    INSTALL_MOBILE_APP: 'Install',
    NO_BUTTON: '',
  };
  const map = lang === 'vi' ? vi : en;
  return map[cta] || cta;
}

/** @deprecated use ctaLabelFor(cta, 'vi') instead. Kept for external callers. */
export function ctaToVietnamese(cta: string | undefined | null): string {
  return ctaLabelFor(cta, 'vi');
}

/** Extract explicit design tokens from the free-form brand JSON/MD/text so
 *  we can inject them into the image prompt as HARD CONSTRAINTS. Image models
 *  respect specific hex codes + font names much more than vague palettes. */
export function extractBrandTokens(brandJsonOrText: string): string {
  if (!brandJsonOrText.trim()) return '';
  const hex = new Set<string>();
  const fonts = new Set<string>();

  // Match #RGB, #RRGGBB (case insensitive).
  const hexRe = /#[0-9a-f]{3,8}\b/gi;
  let m: RegExpExecArray | null;
  while ((m = hexRe.exec(brandJsonOrText)) !== null) hex.add(m[0].toUpperCase());

  // Match common web/brand fonts (case sensitive against a whitelist to avoid
  // false positives on generic words).
  const FONT_WHITELIST = [
    'Inter', 'Manrope', 'Montserrat', 'Poppins', 'Roboto', 'Open Sans',
    'Lato', 'Nunito', 'Raleway', 'Oswald', 'Bebas Neue', 'Playfair Display',
    'Be Vietnam Pro', 'Be Vietnam', 'IBM Plex Sans', 'IBM Plex Serif',
    'Source Sans', 'Merriweather', 'Space Grotesk', 'DM Sans', 'Archivo',
    'Anton', 'Rubik', 'Barlow', 'Helvetica', 'Arial',
  ];
  for (const f of FONT_WHITELIST) {
    if (new RegExp(`\\b${f}\\b`, 'i').test(brandJsonOrText)) fonts.add(f);
  }

  const lines: string[] = [];
  if (hex.size) {
    const list = Array.from(hex).slice(0, 8).join(', ');
    lines.push(`- Palette (STRICT — use these hex codes verbatim, no substitutes): ${list}`);
  }
  if (fonts.size) {
    lines.push(`- Typography (STRICT): ${Array.from(fonts).join(' + ')}. Do not fall back to generic sans-serif.`);
  }
  if (lines.length === 0) return '';
  return ['BRAND DESIGN TOKENS (extracted from brand style):', ...lines].join('\n');
}

/** Language directive placed at the TOP of the prompt so the model treats it
 *  as a hard rule, not lost inside typography guidance. */
function languageDirective(lang: OutputLang): string {
  if (lang === 'en') {
    return [
      'LANGUAGE (HARD RULE, HIGHEST PRIORITY):',
      '- All banner text MUST be in ENGLISH. No Vietnamese words. No mixed-language phrases.',
      '- Headlines, sublines, CTA buttons, badges, tags — every letter in English.',
      '- If a source brief uses Vietnamese text, TRANSLATE it into natural, punchy commercial English before rendering. Never render the raw Vietnamese.',
      '',
      'TEXT ACCURACY (HARD RULE):',
      '- Render every headline, subline, and CTA exactly as specified in double-quotes below — do not paraphrase, translate again, or invent new copy.',
      '- Spelling MUST be perfect. Zero typos. Zero missing letters. Zero duplicated letters.',
      '- Every quoted string is a literal instruction: "Shop Now" means the button must read exactly SHOP NOW or Shop Now, never "Shop Nw" / "Shoop Now" / "Sohp Now".',
    ].join('\n');
  }
  return [
    'LANGUAGE (HARD RULE, HIGHEST PRIORITY):',
    '- All banner text MUST be in VIETNAMESE (Tiếng Việt) with EXACT diacritics (dấu thanh + dấu mũ + dấu móc). No English words unless it is a proper brand name.',
    '- Headlines, sublines, CTA button, badges — every character in Vietnamese, correctly spelled.',
    '- Forbidden English CTA words: "Shop Now", "Buy Now", "Sign Up", "Learn More", "Download", "Register", "Get Started", "Get Offer", "Sign In". Use the Vietnamese CTA specified below.',
    '',
    'VIETNAMESE TEXT ACCURACY (HARD RULE — HIGHEST PRIORITY):',
    '- Render every headline, subline, and CTA EXACTLY as specified in double-quotes below. Character-by-character. Do NOT paraphrase, shorten, translate, or invent new copy.',
    '- Vietnamese diacritics (ă, â, ê, ô, ơ, ư, đ, á à ả ã ạ, é è ẻ ẽ ẹ, í ì ỉ ĩ ị, ó ò ỏ õ ọ, ú ù ủ ũ ụ, ý ỳ ỷ ỹ ỵ) MUST be preserved on EVERY letter. Missing dấu = wrong text.',
    '- Examples of WRONG output that will REJECT this banner:',
    '  * "Dang ky ngay" (missing dấu) — MUST be "Đăng ký ngay".',
    '  * "Vibe Cude" or "Vibe Cude" (typo) — brand name must be exact.',
    '  * "Tu tay lam phan mem" (no dấu) — MUST be "Tự tay làm phần mềm".',
    '  * "Đăngky" (missing space) — words must be separated by spaces.',
    '  * "Đăng ký ngay!!" (extra punctuation) — do not add exclamation unless specified.',
    '- The letter Đ / đ is REQUIRED where specified — never substitute with D / d.',
    '- If unsure of a Vietnamese word\'s exact spelling, render it EXACTLY as it appears in the double-quotes below. The quoted string is the source of truth.',
    '- Zero typos. Zero missing letters. Zero missing diacritics. Zero fake Vietnamese-sounding gibberish.',
  ].join('\n');
}

/** Shared typography discipline — model dễ bị nhồi text nếu không gò cứng. */
function typographyRules(lang: OutputLang): string {
  const font = lang === 'vi'
    ? 'Use heavy sans-serif with full Vietnamese diacritic support (Be Vietnam Pro, Inter, Manrope, Montserrat) at weight 800-900 for headline, weight 500-600 for subline.'
    : 'Use heavy sans-serif for headline (Inter, Manrope, Montserrat, Poppins) at weight 800-900, medium 500-600 for subline.';
  return [
    'TYPOGRAPHY & LAYOUT DISCIPLINE (STRICT):',
    `- ${font} Never mix more than 2 typefaces.`,
    '- Hierarchy: HEADLINE (biggest) → SUBLINE (medium, 1 line) → CTA BUTTON (bold, smaller). At most 3 text blocks total.',
    '- Headline max 7 words, 1-2 lines. Subline max 12 words, 1 line. CTA max 4 words. No paragraph copy on the banner.',
    '- Whitespace: padding ≥ 8% of the shorter side around every text block. Text never touches banner edges or the product silhouette.',
    '- Line-height: headline 1.05-1.15, subline 1.2-1.35. Letter-spacing: headline -1% to -2%, subline normal.',
    '- Alignment: one alignment (left OR center) for the whole text stack. Do not mix.',
    '- ONE clear focal point per banner (product OR headline). Everything else supports it, does not compete.',
    '- Contrast: text over an image must sit on a solid color plate, gradient scrim, or heavy stroke — never low-contrast text over busy pixels.',
    '- Composition: rule of thirds. Reserve a clear negative-space zone for the headline stack. Never overlap product silhouette with headline.',
    '- Forbidden: fake lorem-ipsum, gibberish, mis-spelled words, decorative text stacked randomly, more than 3 text blocks, more than 1 CTA button.',
  ].join('\n');
}

function getBannerTypePrompt(type: BannerType, ctaLabel: string, lang: OutputLang): string {
  const fallback = lang === 'vi' ? 'Xem ngay' : 'Learn More';
  const cta = (ctaLabel && ctaLabel.trim()) ? ctaLabel.trim() : fallback;
  const isVi = lang === 'vi';
  const marketLabel = isVi ? 'Vietnamese market' : 'English-speaking market';
  const typo = typographyRules(lang);
  const langDir = languageDirective(lang);

  const sampleBadges = isVi
    ? '"GIẢM 50%", "MUA 1 TẶNG 1", "FREESHIP", "TỪ 99K"'
    : '"-50%", "BUY 1 GET 1", "FREE SHIP", "FROM $9.99"';
  const urgencyExamples = isVi
    ? '"Chỉ hôm nay", "Số lượng có hạn", "Kết thúc tối nay"'
    : '"Today Only", "Limited Stock", "Ends Tonight"';
  const smBadges = isVi
    ? '"MỚI", "MIỄN PHÍ", "DEMO", "v2"'
    : '"NEW", "FREE", "DEMO", "v2"';

  switch (type) {
    case 'ads':
      return [
        langDir,
        `BANNER TYPE: Performance Ad (paid social / display) — ${marketLabel}.`,
        'Required elements:',
        `- Bold scannable HEADLINE (3-7 words, biggest typography, weight 800-900).`,
        '- Clear VALUE PROPOSITION under the headline (1 line, plain conversational language, no marketing clichés).',
        `- Prominent CALL-TO-ACTION button with text exactly "${cta}" — solid background, high contrast, 8-14px rounded, generous padding.`,
        '- Brand logo visible (top corner or beside headline), sized 10-14% of banner width.',
        '- Product is the undeniable focal point, clean lighting, no awkward crops.',
        '- Entire banner readable in 2 seconds at thumbnail size.',
        typo,
      ].join('\n');
    case 'sale':
      return [
        langDir,
        `BANNER TYPE: Sale / Promotion — ${marketLabel}.`,
        'Required elements:',
        `- HUGE offer badge such as ${sampleBadges} — it is the largest text element.`,
        `- Short URGENCY line: e.g. ${urgencyExamples}.`,
        `- CTA button with text exactly "${cta}" — prominent, high contrast, tappable.`,
        '- Palette: high saturation, strong contrast (red/yellow/black is a safe combo) but keep one neutral so text stays legible.',
        '- Product clearly shown but visually secondary to the offer badge.',
        typo,
      ].join('\n');
    case 'awareness':
      return [
        langDir,
        `BANNER TYPE: Brand Awareness — ${marketLabel}.`,
        'Required elements:',
        '- Hero lifestyle composition, premium tone, soft aspirational lighting.',
        '- Brand identity (logo + tagline) placed elegantly, does not dominate the image.',
        `- Minimal copy — 1 tagline + 1 small CTA "${cta}" (or omit CTA for pure awareness).`,
        '- Cohesive palette of 3-4 colors, not garish. Prioritize visual silence and breathing room.',
        typo,
      ].join('\n');
    case 'software':
      return [
        langDir,
        `BANNER TYPE: Software / App / SaaS showcase (YouTube-thumbnail energy) — ${marketLabel}.`,
        'Treat the PRODUCT IMAGE as a screenshot / UI / dashboard / app screen — NOT a physical object. Keep the screen pixels crisp; never blur or stylize the screen content.',
        'Required elements:',
        '- SCREENSHOT is the hero — in a device frame OR floating with a subtle 3D tilt and soft drop shadow.',
        '- HUGE HEADLINE (2-5 words, heavy sans-serif). Add contrasting stroke/outline so the text is legible on any background.',
        '- One annotation callout (circle, arrow, or highlight box) pointing to a specific feature in the screenshot.',
        '- Brand/app name or logo placed clearly (corner or beside the headline).',
        '- Background: high-contrast solid color OR vivid duotone gradient — clean, no busy textures.',
        `- Small corner badge such as ${smBadges} or a "▶︎" play icon to spark curiosity.`,
        `- CTA button with text exactly "${cta}" placed below the headline, solid button style, does not compete with the screenshot.`,
        '- Reading order: headline → screenshot → badge → CTA. Readable in 1-2 seconds at thumbnail size.',
        '- Avoid: tiny screenshot, low-contrast text, cluttered background, headline > 6 words, photorealistic objects that hide the UI.',
        typo,
      ].join('\n');
    case 'general':
    default:
      return [langDir, typo].join('\n');
  }
}

interface BannerToolProps {
  onNavigate: (page: AppPage) => void;
}

export const BannerTool: React.FC<BannerToolProps> = ({ onNavigate }) => {
  const [refImages, setRefImages] = useState<UploadedImage[]>([]);
  const [prodImages, setProdImages] = useState<UploadedImage[]>([]);
  const [userPrompt, setUserPrompt] = useState<string>("");
  const [brandContent, setBrandContent] = useState<string>("");
  // Default to Performance Ads — most common use case for this tool.
  const [bannerType, setBannerType] = useState<BannerType>('ads');
  const [outputLang, setOutputLang] = useState<OutputLang>('vi');
  const [multiContent, setMultiContent] = useState<boolean>(false);
  const [contents, setContents] = useState<string[]>([""]);
  // Brand briefs auto-loaded when multi-mode + brand picked. User can toggle
  // per-brief which to use as content variants in the gen plan.
  const [brandBriefs, setBrandBriefs] = useState<BrandBrief[]>([]);
  const [enabledBriefIds, setEnabledBriefIds] = useState<Set<string>>(new Set());
  // URL Crawl briefs — persist trong Supabase table `url_crawl_briefs`.
  // Single active batch per user: mỗi crawl mới wipe batch cũ (xem service).
  const [urlBriefs, setUrlBriefs] = useState<BrandBrief[]>([]);
  const [enabledUrlBriefIds, setEnabledUrlBriefIds] = useState<Set<string>>(new Set());

  // Load URL crawl briefs từ Supabase khi mount.
  React.useEffect(() => {
    listUrlCrawlBriefs()
      .then(briefs => {
        setUrlBriefs(briefs);
        setEnabledUrlBriefIds(
          new Set(briefs.filter(b => b.isSelected).map(b => b.id)),
        );
      })
      .catch(() => {
        setUrlBriefs([]);
        setEnabledUrlBriefIds(new Set());
      });
  }, []);

  const handleUrlCrawlComplete = React.useCallback(async (sourceUrl: string, rawBriefs: RawBrief[]) => {
    const persisted = await replaceUrlCrawlBriefsCloud(sourceUrl, rawBriefs);
    setUrlBriefs(persisted);
    // Default: enable all — user unticks những cái không muốn
    setEnabledUrlBriefIds(new Set(persisted.map(b => b.id)));
    return persisted;
  }, []);

  const handleToggleUrlBrief = React.useCallback(async (id: string, enabled: boolean) => {
    await setUrlCrawlBriefsEnabled([id], enabled);
    setEnabledUrlBriefIds(prev => {
      const next = new Set(prev);
      if (enabled) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const handleSetAllUrlBriefsEnabled = React.useCallback(async (mode: 'all' | 'none') => {
    const ids = urlBriefs.map(b => b.id);
    if (ids.length === 0) return;
    const enabled = mode === 'all';
    await setUrlCrawlBriefsEnabled(ids, enabled);
    setEnabledUrlBriefIds(enabled ? new Set(ids) : new Set());
  }, [urlBriefs]);

  const handleClearAllUrlBriefs = React.useCallback(async () => {
    await clearUrlCrawlBriefsCloud();
    setUrlBriefs([]);
    setEnabledUrlBriefIds(new Set());
  }, []);
  // Brand JSON style guide — tách ra state riêng thay vì nhồi vào userPrompt.
  const [brandJsonPrompt, setBrandJsonPrompt] = useState<string>('');
  const [showStyleModal, setShowStyleModal] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  const [showMultiContentModal, setShowMultiContentModal] = useState(false);
  const [versionsPerContent, setVersionsPerContent] = useState<number>(2);
  const [aspectRatio, setAspectRatio] = useState<string>("1:1");
  // Multi-aspect ratio: user pick nhiều tỉ lệ cùng lúc. Mỗi tỉ lệ = 1 batch
  // banner. Set này gồm tỉ lệ chính (aspectRatio) + additional. Ít nhất 1.
  const [selectedAspectRatios, setSelectedAspectRatios] = useState<Set<string>>(new Set(['1:1']));
  const [selectedModel, setSelectedModel] = useState<string>("gemini-3-pro-image-preview");
  const [coachioModel, setCoachioModel] = useState<string>("gpt_image_2");
  const [imageSize, setImageSize] = useState<string>("1K");
  // Backend cho 2K/4K: user tự chọn. Lựa chọn được giữ qua localStorage.
  //   coachio — proxy, không cần key riêng của OpenAI
  //   openai  — gọi thẳng OpenAI, nhận được cả logo/product làm reference
  //   kie      — cổng gom model (Nano Banana). CHỈ text-to-image: KIE phải tải
  //              ảnh reference qua URL công khai, mà ảnh của bản local nằm ở
  //              localhost nên họ không với tới được.
  const [hqBackend, setHqBackendState] = useState<HqBackend>(() => {
    try {
      const v = localStorage.getItem('hq_backend_2k4k');
      return v === 'openai' || v === 'kie' ? v : 'coachio';
    } catch { return 'coachio'; }
  });
  const setHqBackend = (v: HqBackend) => {
    setHqBackendState(v);
    try { localStorage.setItem('hq_backend_2k4k', v); } catch { /* ignore */ }
  };
  const [kieModel, setKieModelState] = useState<string>(() => {
    try { return localStorage.getItem('kie_model') || DEFAULT_KIE_MODEL; }
    catch { return DEFAULT_KIE_MODEL; }
  });
  const setKieModel = (v: string) => {
    setKieModelState(v);
    try { localStorage.setItem('kie_model', v); } catch { /* ignore */ }
  };
  const [variantCount, setVariantCount] = useState<number>(5);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [results, setResults] = useState<GeneratedBanner[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** Đã tự chuyển provider — cảnh báo chứ không phải lỗi, ảnh vẫn ra. */
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  // Gemini backend hidden — Coachio is the only generation path now.
  // backend state retained for the existing call-site switch; locked to 'coachio'.
  const [backend, setBackendState] = useState<BackendType>('coachio');
  const [showApiKeySettings, setShowApiKeySettings] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<Record<string, string>>({});
  const [refLibrary, setRefLibrary] = useState<LibraryImage[]>([]);
  const [prodLibrary, setProdLibrary] = useState<LibraryImage[]>([]);

  // Migrate counts surfaced in case user has legacy localStorage items
  const localRefCount = getLibrary('ref').length;
  const localProdCount = getLibrary('prod').length;

  React.useEffect(() => {
    listLibraryFromCloud('ref').then(setRefLibrary).catch(() => {});
    listLibraryFromCloud('prod').then(setProdLibrary).catch(() => {});
  }, []);
  const [brandLibrary, setBrandLibrary] = useState<BrandSnippet[]>([]);
  const [showBrandLibrary, setShowBrandLibrary] = useState(false);
  const [expandedBrandIds, setExpandedBrandIds] = useState<Set<string>>(new Set());

  const toggleBrandExpanded = (id: string) => {
    setExpandedBrandIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const [brandProjects, setBrandProjects] = useState<BrandProject[]>([]);
  const [activeBrandId, setActiveBrandId] = useState<string>('');
  const [votes, setVotes] = useState<VotedBanner[]>([]);

  // History for the workspace bottom Sessions panel.
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [editingItem, setEditingItem] = useState<HistoryItem | null>(null);
  // Panel phiên gần đây phân trang phía server — trước đây kéo 500 row mỗi
  // lần mount. Một phiên nằm vắt qua ranh giới trang sẽ bị cắt đôi; panel vốn
  // đã cắt bằng maxSessions nên đây vẫn là cải thiện.
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const refreshHistory = React.useCallback(() => {
    listHistoryPage({ page: historyPage, pageSize: PAGE_SIZE, featureType: 'banner' })
      .then(res => {
        setHistory(res.items);
        setHistoryTotal(res.total);
        setHistoryTotalPages(res.totalPages);
        if (res.page !== historyPage) setHistoryPage(res.page);
      })
      .catch(() => {});
  }, [historyPage]);

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

  /** Kick off 1 async regen với timeout 5 phút. Được share giữa initial
   *  submit và retry sau khi lỗi. */
  const kickOffRegenTask = React.useCallback((payload: RegenRetryPayload, inMemoryExtras: UploadedImage[] = []) => {
    const {
      sourceItemId, sourceImageUrl, sourceModel, sourcePromptUsed,
      sourceParentId, sourceVersion, sourceFeatureType, sourceAspectRatio,
      prompt: adj, aspectRatio: ar, quality: qual, sessionId,
    } = payload;
    const placeholderId = Math.random().toString(36).substring(7);
    const commonPromptUsed = adj ? `Edit: ${adj}` : 'Chỉnh sửa từ bản trước';

    // Persist task vào localStorage để F5 khôi phục được.
    const pending = readPendingRegenTasks();
    const nextTasks: PendingRegenTask[] = [
      ...pending,
      { taskId: placeholderId, startedAt: Date.now(), payload },
    ];
    savePendingRegenTasks(nextTasks);

    // Placeholder loading vào history + results (prepend, không replace).
    const placeholder: HistoryItem = {
      id: placeholderId,
      imageUrl: '',
      promptUsed: commonPromptUsed,
      timestamp: Date.now(),
      model: sourceModel,
      quality: qual,
      aspectRatio: ar,
      parentId: sourceParentId,
      version: sourceVersion,
      featureType: sourceFeatureType || 'banner',
      sessionId,
      pendingStatus: 'loading',
    };
    setHistory(prev => [placeholder, ...prev]);
    setResults(prev => [{
      id: placeholderId,
      imageUrl: '',
      promptUsed: commonPromptUsed,
      status: 'loading',
      timestamp: Date.now(),
      aspectRatio: ar,
    }, ...prev]);

    // Async gen với 2-min timeout race.
    (async () => {
      try {
        const source = proxiedBannerUrl(sourceImageUrl);
        const base = await dataUrlOrUrlToUploadedImage(source, `base-${sourceItemId}.png`);
        if (!base) throw new Error('Không tải được ảnh gốc làm reference');

        // Ưu tiên ảnh vừa upload trong modal; retry sau F5 thì dựng lại từ
        // refs đã mirror lên CDN trong payload.
        let extras = inMemoryExtras;
        if (extras.length > 0 && !payload.editRefs?.length) {
          const stored = await mirrorEditRefsToCdn(extras);
          payload.editRefs = stored;
          savePendingRegenTasks(readPendingRegenTasks().map(t => t.taskId === placeholderId
            ? { ...t, payload: { ...t.payload, editRefs: stored } }
            : t));
        } else if (extras.length === 0) {
          extras = await restoreEditRefs(payload.editRefs);
        }

        // Ảnh gốc luôn là reference (canvas được sửa); ảnh upload đầu tiên
        // đóng vai product mới, phần còn lại là reference bổ sung.
        const productImage = extras[0] ?? base;
        const extraRefs = extras.slice(1);

        const combinedPrompt = buildEditPrompt({
          editInstruction: adj,
          originalPrompt: sourcePromptUsed,
          extraRefCount: extras.length,
          sourceAspectRatio,
          targetAspectRatio: ar,
        });

        const isItemCoachioModel = sourceModel === 'gpt_image_2' || sourceModel === 'google_image_gen_banana_pro';
        const modelForBackend = isItemCoachioModel ? sourceModel : coachioModel;

        const start = Date.now();
        // Race: gen call vs 2-min timer. Cái nào xong trước.
        // Cùng chính sách với regenService: Coachio hỏng phía họ thì chạy
        // lại bằng OpenAI, task nền không có ai canh để đổi backend.
        let usedFallbackModel = '';
        const genPromise = withOpenaiFallback<string>({
          fallbackAvailable: !!getOpenaiApiKey(),
          onNotice: (m) => setFallbackNotice(m),
          primary: () => generateBannerWithCoachio(
            base, productImage, combinedPrompt, '',
            ar, qual, modelForBackend,
            undefined, extraRefs,
          ),
          fallback: () => generateBannerWithOpenai(
            { logo: null, styleRefs: [base, ...extraRefs].filter(Boolean), productRef: productImage },
            combinedPrompt, '', ar, qual,
          ),
        }).then(out => {
          if (out.usedFallback) {
            usedFallbackModel = `openai-gpt-image-2-${String(qual).toLowerCase()}`;
            setFallbackNotice(fallbackSuccessNotice(out.primaryError));
          }
          return out.result;
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Timeout 5 phút — banner có thể vẫn đang tạo phía server. Bấm Tạo lại để thử.')), 5 * 60 * 1000);
        });
        const imageUrl = await Promise.race([genPromise, timeoutPromise]);
        const duration = (Date.now() - start) / 1000;

        const saved = await addHistoryToCloud({
          id: placeholderId,
          imageUrl,
          promptUsed: combinedPrompt,
          timestamp: Date.now(),
          duration,
          model: usedFallbackModel || modelForBackend,
          quality: qual,
          aspectRatio: ar,
          parentId: sourceParentId,
          version: sourceVersion,
          featureType: sourceFeatureType || 'banner',
          sessionId,
        });

        // Success: clean task khỏi localStorage + swap placeholder → real.
        savePendingRegenTasks(readPendingRegenTasks().filter(t => t.taskId !== placeholderId));
        setHistory(prev => prev.map(h => h.id === placeholderId ? saved : h));
        setResults(prev => prev.map(r => r.id === placeholderId ? {
          ...r,
          imageUrl: saved.imageUrl,
          status: 'success',
          promptUsed: combinedPrompt,
          duration,
        } : r));
      } catch (err: any) {
        console.error('Background regen failed', err);
        const isTimeout = err?.message?.includes('Timeout');
        const errorMsg = err?.message || 'unknown';
        // Giữ task trong localStorage với status error để user retry.
        savePendingRegenTasks(readPendingRegenTasks().map(t => t.taskId === placeholderId
          ? { ...t, status: isTimeout ? 'timeout' : 'error', errorMsg }
          : t));
        // Mark placeholder error trong history + results.
        setHistory(prev => prev.map(h => h.id === placeholderId ? {
          ...h,
          pendingStatus: isTimeout ? 'timeout' : 'error',
          pendingError: errorMsg,
          retryPayload: payload,
        } : h));
        setResults(prev => prev.map(r => r.id === placeholderId ? {
          ...r,
          status: 'error',
          errorMsg,
          retryPayload: payload,
        } : r));
      }
    })();
  }, [coachioModel]);

  /** Fire-and-forget regen từ HistoryEditModal. Modal đóng ngay khi user
   *  submit — parent kick off task per aspect ratio. Multi-thread, persist
   *  qua localStorage nên F5 hồi phục được. Timeout 5 phút mỗi task. */
  const handleBackgroundRegen = React.useCallback((params: BackgroundRegenParams) => {
    const { item, prompt: adj, extras, aspectRatios, quality: qual } = params;
    const rootParentId = item.parentId || item.id;
    const nextVersion = (item.version ?? 1) + 1;
    const sessionId = `edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    aspectRatios.forEach(ar => {
      kickOffRegenTask({
        sourceItemId: item.id,
        sourceImageUrl: item.imageUrl,
        sourceModel: item.model,
        sourcePromptUsed: item.promptUsed,
        sourceParentId: rootParentId,
        sourceVersion: nextVersion,
        sourceFeatureType: (item.featureType as 'banner' | 'ugc') || 'banner',
        sourceAspectRatio: item.aspectRatio,
        prompt: adj,
        aspectRatio: ar,
        quality: qual,
        sessionId,
      }, extras);
    });
  }, [kickOffRegenTask]);

  /** Retry 1 errored/timeout task. Xoá placeholder cũ khỏi state + kick off
   *  task mới với cùng payload. */
  const handleRetryRegen = React.useCallback((oldTaskId: string, payload: RegenRetryPayload) => {
    // Remove failed task from localStorage + state.
    savePendingRegenTasks(readPendingRegenTasks().filter(t => t.taskId !== oldTaskId));
    setHistory(prev => prev.filter(h => h.id !== oldTaskId));
    setResults(prev => prev.filter(r => r.id !== oldTaskId));
    kickOffRegenTask(payload);
  }, [kickOffRegenTask]);

  /** Xoá vĩnh viễn 1 pending task đã lỗi/timeout (không tạo lại). Local-only,
   *  không gọi cloud vì placeholder chưa vào DB. */
  const handleRemoveErrorTask = React.useCallback((taskId: string) => {
    if (!confirm('Xoá task lỗi này (không tạo lại)?')) return;
    savePendingRegenTasks(readPendingRegenTasks().filter(t => t.taskId !== taskId));
    setHistory(prev => prev.filter(h => h.id !== taskId));
    setResults(prev => prev.filter(r => r.id !== taskId));
  }, []);

  /** Nạp lại toàn bộ inputs / options / refs từ 1 history item vào
   *  BannerTool sidebar. User có thể adjust rồi bấm Generate lại. */
  const hydrateFromHistory = React.useCallback(async (source: HistoryItem) => {
    const p = source.genParams;
    if (!p) {
      setErrorMsg('Banner này không có snapshot inputs — được tạo trước khi feature này ra mắt. Chỉ có thể xem/chỉnh sửa qua modal Edit.');
      return;
    }

    // Nạp text-based state (đồng bộ)
    if (p.brandId !== undefined) setActiveBrandId(p.brandId || '');
    if (p.brandContent !== undefined) setBrandContent(p.brandContent);
    if (p.userPrompt !== undefined) setUserPrompt(p.userPrompt);
    if (p.brandJsonPrompt !== undefined) setBrandJsonPrompt(p.brandJsonPrompt);
    if (p.selectedAspectRatios && p.selectedAspectRatios.length > 0) {
      setSelectedAspectRatios(new Set(p.selectedAspectRatios));
      setAspectRatio(p.selectedAspectRatios[0]);
    }
    if (p.quality) setImageSize(p.quality);
    if (p.model) setCoachioModel(p.model);
    if (p.bannerType) setBannerType(p.bannerType as BannerType);
    if (p.outputLang === 'vi' || p.outputLang === 'en') setOutputLang(p.outputLang);
    if (p.multiContent !== undefined) setMultiContent(p.multiContent);
    if (p.contents) setContents(p.contents);
    if (p.enabledBriefIds) setEnabledBriefIds(new Set(p.enabledBriefIds));
    if (p.enabledUrlBriefIds) setEnabledUrlBriefIds(new Set(p.enabledUrlBriefIds));
    if (p.variantCount !== undefined) setVariantCount(p.variantCount);
    if (p.versionsPerContent !== undefined) setVersionsPerContent(p.versionsPerContent);

    // Nạp refs (async — cần fetch URLs thành UploadedImage)
    const restoreImages = async (refs: StoredImageRef[] | undefined): Promise<UploadedImage[]> => {
      if (!refs || refs.length === 0) return [];
      const uploaded = await Promise.all(refs.map(async (r, idx) => {
        try {
          const source = r.url || r.base64;
          if (!source) return null;
          const filename = r.fileName || `ref-${idx}.png`;
          const uploadedImg = await dataUrlOrUrlToUploadedImage(source, filename);
          return uploadedImg;
        } catch (e) {
          console.warn('Restore image failed', r, e);
          return null;
        }
      }));
      return uploaded.filter(Boolean) as UploadedImage[];
    };

    try {
      const [freshRefs, freshProds] = await Promise.all([
        restoreImages(p.refImages),
        restoreImages(p.prodImages),
      ]);
      setRefImages(freshRefs);
      setProdImages(freshProds);
      setErrorMsg(null);
    } catch (e: any) {
      console.warn('Hydrate images failed', e);
      setErrorMsg(`Nạp lại refs lỗi (một phần): ${e?.message || 'unknown'}`);
    }

    // Đóng modal + scroll sidebar về top để user thấy inputs mới.
    setEditingItem(null);
  }, []);

  // Restore pending regen tasks on mount — nếu user đóng tab / F5 giữa lúc
  // gen chạy, hiển thị các task đang running / lỗi để user biết + retry.
  React.useEffect(() => {
    const pending = readPendingRegenTasks();
    if (pending.length === 0) return;

    const now = Date.now();
    const TIMEOUT_MS = 5 * 60 * 1000;
    const restored: HistoryItem[] = [];
    const kept: PendingRegenTask[] = [];

    for (const t of pending) {
      const age = now - t.startedAt;
      const commonPromptUsed = t.payload.prompt ? `Edit: ${t.payload.prompt}` : 'Chỉnh sửa từ bản trước';
      if (age > TIMEOUT_MS || t.status === 'error' || t.status === 'timeout') {
        // Timeout hoặc lỗi cũ — mark error, cho retry
        restored.push({
          id: t.taskId,
          imageUrl: '',
          promptUsed: commonPromptUsed,
          timestamp: t.startedAt,
          model: t.payload.sourceModel,
          quality: t.payload.quality,
          aspectRatio: t.payload.aspectRatio,
          parentId: t.payload.sourceParentId,
          version: t.payload.sourceVersion,
          featureType: t.payload.sourceFeatureType || 'banner',
          sessionId: t.payload.sessionId,
          pendingStatus: age > TIMEOUT_MS ? 'timeout' : (t.status || 'error'),
          pendingError: t.errorMsg || (age > TIMEOUT_MS
            ? 'Task quá 5 phút mà chưa xong — có thể tab bị đóng giữa chừng. Bấm Tạo lại để thử.'
            : 'Task bị interrupt trước khi hoàn thành.'),
          retryPayload: t.payload,
        });
        // Cập nhật status trong localStorage để lần sau restore đúng
        kept.push({ ...t, status: age > TIMEOUT_MS ? 'timeout' : (t.status || 'error') });
      } else {
        // Vẫn trong 5 phút — vì promise cũ đã chết, ta cũng phải mark là
        // error/interrupted (không cách nào recover). Nhưng cho user retry.
        restored.push({
          id: t.taskId,
          imageUrl: '',
          promptUsed: commonPromptUsed,
          timestamp: t.startedAt,
          model: t.payload.sourceModel,
          quality: t.payload.quality,
          aspectRatio: t.payload.aspectRatio,
          parentId: t.payload.sourceParentId,
          version: t.payload.sourceVersion,
          featureType: t.payload.sourceFeatureType || 'banner',
          sessionId: t.payload.sessionId,
          pendingStatus: 'error',
          pendingError: 'Session cũ bị interrupt (tab đóng hoặc F5). Bấm Tạo lại để chạy tiếp.',
          retryPayload: t.payload,
        });
        kept.push({ ...t, status: 'error', errorMsg: 'Session interrupted' });
      }
    }
    savePendingRegenTasks(kept);
    setHistory(prev => [...restored, ...prev]);
    setResults(prev => [
      ...restored.map(r => ({
        id: r.id,
        imageUrl: '',
        promptUsed: r.promptUsed,
        status: 'error' as const,
        timestamp: r.timestamp,
        aspectRatio: r.aspectRatio,
        retryPayload: r.retryPayload,
        errorMsg: r.pendingError,
      })),
      ...prev,
    ]);
  }, []);

  const updateBrandBrief = React.useCallback(async (briefId: string, patch: Partial<BrandBrief>) => {
    await updateBrief(briefId, patch as any);
    // Optimistic update local state
    setBrandBriefs(prev => prev.map(b => b.id === briefId ? { ...b, ...patch } : b));
  }, []);

  const updateUrlBriefLocal = React.useCallback(async (briefId: string, patch: Partial<BrandBrief>) => {
    await updateUrlCrawlBrief(briefId, patch as any);
    setUrlBriefs(prev => prev.map(b => b.id === briefId ? { ...b, ...patch } : b));
  }, []);

  const deleteUrlBriefLocal = React.useCallback(async (briefId: string) => {
    if (!confirm('Xoá URL brief này? Không undo được.')) return;
    try {
      await deleteUrlCrawlBrief(briefId);
      setUrlBriefs(prev => prev.filter(b => b.id !== briefId));
      setEnabledUrlBriefIds(prev => {
        const next = new Set(prev);
        next.delete(briefId);
        return next;
      });
    } catch (e: any) {
      alert(`Xoá URL brief lỗi: ${e?.message || 'unknown'}`);
    }
  }, []);

  const removeBrandBrief = React.useCallback(async (briefId: string) => {
    if (!confirm('Xoá brief này khỏi brand? Không undo được (sẽ mất luôn ở Brand Style).')) return;
    try {
      await deleteBrief(briefId);
      setBrandBriefs(prev => prev.filter(b => b.id !== briefId));
      setEnabledBriefIds(prev => {
        const next = new Set(prev);
        next.delete(briefId);
        return next;
      });
    } catch (e: any) {
      alert(`Xoá brief lỗi: ${e?.message || 'unknown'}`);
    }
  }, []);

  // Initial cloud loads
  React.useEffect(() => {
    listVotesFromCloud().then(setVotes).catch(() => {});
    listSnippetsFromCloud().then(setBrandLibrary).catch(() => {});
    listBrandProjectsFromCloud().then(setBrandProjects).catch(() => {});
    refreshHistory();
  }, [refreshHistory]);

  // Auto-load ALL brand briefs when a brand is applied (bao gồm cả briefs
  // đã crawl trong Brand Style mà chưa tick is_selected). Default: enable
  // những brief có is_selected=true — user tick/untick trong Multi Content
  // Modal cho từng lần gen.
  React.useEffect(() => {
    if (!activeBrandId) { setBrandBriefs([]); setEnabledBriefIds(new Set()); return; }
    listBriefsForBrand(activeBrandId)
      .then(b => {
        setBrandBriefs(b);
        // Enable defaults: chỉ những brief đã tick is_selected trong Brand Style.
        // Nếu không có brief nào tick, enable hết (fallback dễ dùng).
        const preSelected = b.filter(x => x.isSelected);
        setEnabledBriefIds(new Set((preSelected.length > 0 ? preSelected : b).map(x => x.id)));
      })
      .catch(() => { setBrandBriefs([]); setEnabledBriefIds(new Set()); });
  }, [activeBrandId]);

  const libraryIdForVote = (bannerId: string) => `voted-${bannerId}`;

  const toggleVote = async (banner: GeneratedBanner) => {
    if (banner.status !== 'success' || !banner.imageUrl) return;
    const already = votes.some(v => v.id === banner.id);

    if (already) {
      try {
        await removeVoteFromCloud(banner.id);
        setVotes(prev => prev.filter(v => v.id !== banner.id));
        // Remove from cloud ref library mirror (best effort)
        const mirrorId = libraryIdForVote(banner.id);
        const mirror = refLibrary.find(r => r.id === mirrorId);
        if (mirror) {
          await removeLibraryItemFromCloud(mirrorId).catch(() => {});
          setRefLibrary(prev => prev.filter(r => r.id !== mirrorId));
        }
      } catch (e) {
        console.warn('Remove vote failed', e);
      }
      return;
    }

    // Mirror into the cloud ref library so future generations can reuse the
    // liked banner as a style reference picker entry.
    try {
      const added = await addDataUrlToLibrary(
        proxiedBannerUrl(banner.imageUrl),
        `liked-banner-${banner.id}.jpg`,
        'ref',
      );
      setRefLibrary(prev => [added, ...prev]);
    } catch (e) {
      console.warn('Save voted banner to cloud library failed', e);
    }

    try {
      const saved = await addVoteToCloud({
        id: banner.id,
        imageUrl: banner.imageUrl,
        promptUsed: banner.promptUsed || '',
        brandContent: brandContent || '',
        bannerType,
        aspectRatio,
        model: backend === 'coachio' ? coachioModel : selectedModel,
        votedAt: Date.now(),
      });
      setVotes(prev => [saved, ...prev]);
    } catch (e) {
      console.warn('Add vote failed', e);
    }
  };

  const saveContentSnippet = async (text: string) => {
    const t = text.trim();
    if (!t) return;
    try {
      const snippet = await addSnippetToCloud(t);
      setBrandLibrary(prev => [snippet, ...prev.filter(s => s.content !== t)]);
    } catch (e) {
      console.warn('addSnippetToCloud failed', e);
    }
  };

  const hasCoachioKey = !!getCoachioApiKey();
  const hasOpenaiKey = !!getOpenaiApiKey();
  const hasKieKey = !!getKieApiKey();
  // Chọn backend mà chưa có key của nó -> lúc gen sẽ rơi về Coachio. Nói
  // trước ở đây để không ai ngồi đợi rồi tưởng đã dùng backend mình chọn.
  const missingHqKey = (hqBackend === 'openai' && !hasOpenaiKey)
                    || (hqBackend === 'kie' && !hasKieKey);
  // Gemini path locked off — these are kept for the unreachable code branches
  // that still type-check the legacy flow. Re-enable by un-hiding the backend
  // selector and calling setBackend('gemini').
  const hasGoogleKey = !!getGeminiApiKey() || (import.meta.env.VITE_GEMINI_API_KEY && import.meta.env.VITE_GEMINI_API_KEY !== 'your_api_key_here');
  const setBackend = (b: BackendType) => {
    setBackendState(b);
    setActiveBackend(b);
  };
  void hasGoogleKey; void setBackend;

  const processFile = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  const persistToLibrary = async (file: File, category: LibraryCategory) => {
    try {
      const item = await addFileToLibrary(file, category);
      if (category === 'ref') setRefLibrary(prev => [item, ...prev]);
      else setProdLibrary(prev => [item, ...prev]);
    } catch (err) {
      console.error('Library save to cloud failed', err);
    }
  };

  const handleUpload = async (files: FileList, type: LibraryCategory) => {
    const fileArray = Array.from(files);

    const processed = await Promise.all(
      fileArray.map(async (file) => {
        try {
          const base64 = await processFile(file);
          return {
            uploaded: {
              id: Math.random().toString(36).substring(7),
              url: URL.createObjectURL(file),
              file,
              base64,
              mimeType: file.type,
            } as UploadedImage,
            file,
          };
        } catch (err) {
          console.error('File processing error', err);
          return null;
        }
      })
    );

    const newImages = processed.filter(Boolean).map(p => p!.uploaded);
    if (type === 'ref') setRefImages(prev => [...prev, ...newImages]);
    else setProdImages(prev => [...prev, ...newImages]);

    await Promise.all(
      processed.filter(Boolean).map(p => persistToLibrary(p!.file, type))
    );
  };

  const handleLibrarySelect = async (item: LibraryImage, type: LibraryCategory) => {
    try {
      const uploaded = await libraryItemToUploadedImageAsync(item);
      if (type === 'ref') setRefImages(prev => [...prev, uploaded]);
      else setProdImages(prev => [...prev, uploaded]);
    } catch (e) {
      console.warn('library select failed', e);
      setErrorMsg('Không tải được ảnh từ thư viện');
    }
  };

  const handleLibraryDelete = async (id: string, type: LibraryCategory) => {
    try {
      await removeLibraryItemFromCloud(id);
      if (type === 'ref') setRefLibrary(prev => prev.filter(i => i.id !== id));
      else setProdLibrary(prev => prev.filter(i => i.id !== id));
    } catch (e) {
      console.warn('library delete failed', e);
    }
  };

  const migrateLocalLibraries = async () => {
    try {
      const refResult = await bulkMigrateLibrary(getLibrary('ref'), 'ref');
      const prodResult = await bulkMigrateLibrary(getLibrary('prod'), 'prod');
      const [r, p] = await Promise.all([
        listLibraryFromCloud('ref'),
        listLibraryFromCloud('prod'),
      ]);
      setRefLibrary(r);
      setProdLibrary(p);
      setErrorMsg(
        `Migrate library: +${refResult.inserted} ref, +${prodResult.inserted} prod (bỏ qua ${refResult.skipped + prodResult.skipped} trùng)`,
      );
    } catch (e: any) {
      setErrorMsg(`Migrate lỗi: ${e?.message || 'unknown'}`);
    }
  };

  const handleBrandDelete = async (id: string) => {
    try {
      await removeSnippetFromCloud(id);
      setBrandLibrary(prev => prev.filter(s => s.id !== id));
    } catch (e) {
      console.warn('removeSnippetFromCloud failed', e);
    }
  };

  const handleBrandSave = async () => {
    if (!brandContent.trim()) return;
    try {
      const snippet = await addSnippetToCloud(brandContent);
      setBrandLibrary(prev => [snippet, ...prev.filter(s => s.content !== brandContent.trim())]);
    } catch (e) {
      console.warn('addSnippetToCloud failed', e);
    }
  };

  const applyBrandProject = (projectId: string) => {
    if (!projectId) { setActiveBrandId(''); return; }
    const project = brandProjects.find(p => p.id === projectId);
    if (!project) return;

    // Đổi brand → RESET refs cũ trước (không append tràn). User expect
    // "brand mới = refs mới" — không phải mix với brand cũ.
    const styleSource: LibraryImage[] = [
      ...(project.logo ? [project.logo] : []),
      ...(project.styleReferences ?? project.references ?? []),
    ];
    const productSource: LibraryImage[] = project.productReferences ?? [];

    // Wipe first, then load new refs. Nếu brand không có ref nào, refs bị
    // xoá sạch — user tự upload lại nếu cần.
    setRefImages([]);
    setProdImages([]);

    Promise.all(
      styleSource.map(i => libraryItemToUploadedImageAsync(i)
        .catch(e => { console.warn('apply brand ref load', e); return null; })),
    ).then(items => {
      const fresh = items.filter(Boolean) as any;
      if (fresh.length) setRefImages(fresh);
    });

    Promise.all(
      productSource.map(i => libraryItemToUploadedImageAsync(i)
        .catch(e => { console.warn('apply brand prod load', e); return null; })),
    ).then(items => {
      const fresh = items.filter(Boolean) as any;
      if (fresh.length) setProdImages(fresh);
    });

    const composedBrand = [project.brandInfo, project.eventInfo]
      .filter(s => (s || '').trim())
      .join('\n');
    setBrandContent(composedBrand || ''); // reset nếu brand mới không có content

    // Brand JSON prompt — reset về trống nếu brand mới không có JSON.
    setBrandJsonPrompt((project.jsonPrompt || '').trim());

    setActiveBrandId(project.id);
  };

  const clearBrandSelection = () => {
    setActiveBrandId('');
    setBrandJsonPrompt('');
  };

  const handleRemove = (id: string, type: 'ref' | 'prod') => {
    if (type === 'ref') {
      setRefImages(prev => prev.filter(img => img.id !== id));
    } else {
      setProdImages(prev => prev.filter(img => img.id !== id));
    }
  };

  const generateSingle = async (
    placeholder: GeneratedBanner,
    selectedRef: UploadedImage,
    selectedProd: UploadedImage,
    combinedPrompt: string,
    contentForThis?: string,
    extraReferences: UploadedImage[] = [],
    sessionId?: string,
    aspectRatioForThis?: string,
    genParamsForThis?: GenParamsSnapshot,
  ) => {
    const startTime = Date.now();
    let imageUrl: string;
    const brandContentToUse = contentForThis ?? brandContent;
    const arForThis = aspectRatioForThis || aspectRatio;

    // Route theo quality tier + user pick:
    //   1K       → Coachio (rẻ, fast)
    //   2K/4K    → theo hqBackend (Coachio hoặc OpenAI). Fallback Coachio nếu
    //              chọn OpenAI mà không có key (tránh crash im lặng).
    const isHqTier = imageSize === '2K' || imageSize === '4K';
    const useOpenai = isHqTier && hqBackend === 'openai' && !!getOpenaiApiKey();
    const useKie = isHqTier && hqBackend === 'kie' && !!getKieApiKey();
    let modelUsedForHistory = backend === 'coachio' ? coachioModel : selectedModel;

    if (useKie) {
      const progress = (status: string) =>
        setGenerationProgress(prev => ({ ...prev, [placeholder.id]: status }));
      if (selectedRef || selectedProd || extraReferences.length) {
        progress('KIE không nhận ảnh reference — chỉ dùng prompt.');
      }
      imageUrl = await generateImageWithKie(combinedPrompt, {
        model: kieModel,
        aspectRatio: arForThis,
        onProgress: progress,
      });
      modelUsedForHistory = `kie-${kieModel}`;
    } else if (useOpenai) {
      // Bundle up ALL roled refs from active brand + user picks so gpt-image-2
      // /edits gets logo separately (must preserve) from style + product.
      const activeBrand = brandProjects.find(p => p.id === activeBrandId);
      const bundle = {
        logo: activeBrand?.logo || null,
        styleRefs: [selectedRef, ...extraReferences.slice(0, 3)].filter(Boolean),
        productRef: selectedProd || null,
      };
      const refCount = (bundle.logo ? 1 : 0) + bundle.styleRefs.length + (bundle.productRef ? 1 : 0);
      setGenerationProgress(prev => ({
        ...prev,
        [placeholder.id]: `Using OpenAI (${imageSize}, ${refCount} refs)...`,
      }));
      imageUrl = await generateBannerWithOpenai(
        bundle,
        combinedPrompt,
        brandContentToUse,
        arForThis,
        imageSize,
        (status) => setGenerationProgress(prev => ({ ...prev, [placeholder.id]: status })),
      );
      modelUsedForHistory = `openai-gpt-image-2-${imageSize.toLowerCase()}`;
    } else if (backend === 'coachio') {
      const progress = (status: string) =>
        setGenerationProgress(prev => ({ ...prev, [placeholder.id]: status }));
      // Hỏng vì phía Coachio (hết credit, key, rate limit, task fail) thì chạy
      // lại bằng OpenAI với cùng bộ refs, thay vì bắt user đổi backend thủ công.
      const activeBrandForFb = brandProjects.find(p => p.id === activeBrandId);
      const out = await withOpenaiFallback<string>({
        fallbackAvailable: !!getOpenaiApiKey(),
        onNotice: (m) => { setFallbackNotice(m); progress(m); },
        primary: () => generateBannerWithCoachio(
          selectedRef, selectedProd, combinedPrompt, brandContentToUse,
          arForThis, imageSize, coachioModel, progress,
          extraReferences,
        ),
        fallback: () => generateBannerWithOpenai(
          {
            logo: activeBrandForFb?.logo || null,
            styleRefs: [selectedRef, ...extraReferences.slice(0, 3)].filter(Boolean),
            productRef: selectedProd || null,
          },
          combinedPrompt, brandContentToUse, arForThis, imageSize, progress,
        ),
      });
      imageUrl = out.result;
      if (out.usedFallback) {
        setFallbackNotice(fallbackSuccessNotice(out.primaryError));
        modelUsedForHistory = `openai-gpt-image-2-${imageSize.toLowerCase()}`;
      }
    } else {
      imageUrl = await generateBannerWithGemini(
        selectedRef, selectedProd, combinedPrompt, brandContentToUse,
        arForThis, selectedModel, imageSize, extraReferences,
      );
    }

    const duration = (Date.now() - startTime) / 1000;

    // Persist to Supabase + auto-upload Gemini base64 to storage local.
    // Defensive: never let history persistence sabotage a successful API result.
    let persistedImageUrl = imageUrl;
    try {
      const saved = await addHistoryToCloud({
        id: placeholder.id,
        imageUrl,
        promptUsed: combinedPrompt,
        timestamp: Date.now(),
        duration,
        model: modelUsedForHistory,
        quality: imageSize,
        aspectRatio: arForThis,
        featureType: 'banner',
        sessionId,
        genParams: genParamsForThis,
      });
      persistedImageUrl = saved.imageUrl; // storage local URL if Gemini base64 was uploaded
    } catch (e: any) {
      console.warn('addHistoryToCloud failed (banner shown to user but NOT saved to cloud)', e);
      setErrorMsg(`Lưu lên cloud thất bại: ${e?.message || 'unknown'}. Banner đang chỉ hiện local, sẽ mất khi reload.`);
    }

    return { imageUrl: persistedImageUrl, duration };
  };

  const handleGenerate = async () => {
    if (refImages.length === 0 && prodImages.length === 0) {
      setErrorMsg("Cần ít nhất 1 ảnh — Style Reference hoặc Product Image (không bắt buộc cả 2).");
      return;
    }

    if (backend === 'coachio' && !getCoachioApiKey()) {
      setErrorMsg("Coachio API key not set. Click the key icon to configure.");
      setShowApiKeySettings(true);
      return;
    }

    if (backend === 'gemini') {
      if (!hasGoogleKey) {
        try {
          const hasKey = await window.aistudio?.hasSelectedApiKey?.();
          if (hasKey === false) {
            await window.aistudio.openSelectKey();
          }
        } catch (e) {
          setErrorMsg("Google API key not set. Please configure it in API Settings.");
          setShowApiKeySettings(true);
          return;
        }
      }
    }

    setErrorMsg(null);
    setFallbackNotice(null);
    setIsGenerating(true);
    setGenerationProgress({});

    // Build the list of content sources — mỗi source có text (nội dung
    // banner) và optional brief (context bổ sung cho AI). Multi mode gộp
    // 3 nguồn: manual + brand briefs + URL crawl briefs. Single mode chỉ
    // dùng brandContent.
    type ContentSource = { text: string; brief?: BrandBrief };
    const enabledBriefs = brandBriefs.filter(b => enabledBriefIds.has(b.id));
    const enabledUrlBrief = urlBriefs.filter(b => enabledUrlBriefIds.has(b.id));
    const briefSources: ContentSource[] = [...enabledBriefs, ...enabledUrlBrief]
      .map(b => ({
        text: (b.primaryText || b.primaryMessage || b.headline || '').trim(),
        brief: b,
      }))
      .filter(s => s.text);
    const manualSources: ContentSource[] = contents
      .map(c => ({ text: c.trim() }))
      .filter(s => s.text);

    const contentSources: ContentSource[] = multiContent
      ? [...manualSources, ...briefSources]
      : [{ text: brandContent.trim() }];

    // Multi mode requires at least one non-empty content
    if (multiContent && contentSources.length === 0) {
      setErrorMsg("Multi-content mode is on — vui lòng nhập ít nhất một nội dung.");
      setIsGenerating(false);
      return;
    }

    // Single mode: still ok if empty (matches prior behavior of allowing empty brand content)
    if (!multiContent && contentSources.length === 0) {
      contentSources.push({ text: "" });
    }

    // Persist non-empty MANUAL contents into brand library (cloud) —
    // briefs không nhét lại vì đã có trong brand.
    for (const s of contentSources) {
      if (s.text && !s.brief) {
        addSnippetToCloud(s.text)
          .then(snippet => setBrandLibrary(prev => [snippet, ...prev.filter(sn => sn.content !== s.text)]))
          .catch(e => console.warn('addSnippetToCloud (bulk) failed', e));
      }
    }

    const perContent = multiContent ? versionsPerContent : variantCount;
    const aspectsToGen: string[] = Array.from(selectedAspectRatios) as string[];
    if (aspectsToGen.length === 0) aspectsToGen.push(aspectRatio); // defensive

    type Plan = { placeholder: GeneratedBanner; source: ContentSource; aspect: string };
    const plan: Plan[] = [];
    for (const source of contentSources) {
      for (const aspect of aspectsToGen) {
        for (let i = 0; i < perContent; i++) {
          plan.push({
            placeholder: {
              id: Math.random().toString(36).substring(7),
              imageUrl: '',
              promptUsed: '',
              status: 'loading',
              timestamp: Date.now(),
              aspectRatio: aspect, // để ResultViewer ratio filter phân loại được từ loading state
            },
            source,
            aspect,
          });
        }
      }
    }

    setResults(plan.map(p => p.placeholder));

    // One session = one Generate click. Every banner in this batch shares
    // the sessionId so the Sessions panel groups them together even if the
    // per-banner timestamps drift due to async completion order.
    const sessionId = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    // Capture full input snapshot 1 lần cho batch này. Mỗi row history
    // sẽ persist same snapshot → user click bất kỳ banner nào cũng nạp lại
    // được toàn bộ inputs.
    // Persist URL only, and only CDN-quality URLs. NEVER persist base64
    // (in either the `base64` field OR as a data: URL inside `url`) —
    // history rows would explode to multi-MB and hit statement_timeout on
    // list queries. blob: URLs are also skipped because they die on reload.
    const isPersistableUrl = (u: string | undefined): u is string =>
      !!u && !u.startsWith('blob:') && !u.startsWith('data:');
    const toStoredImage = (img: UploadedImage): StoredImageRef => ({
      url: isPersistableUrl(img.url) ? img.url : undefined,
      fileName: img.file?.name,
      mimeType: img.mimeType,
    });
    const genSnapshot: GenParamsSnapshot = {
      brandId: activeBrandId || undefined,
      brandContent,
      userPrompt,
      brandJsonPrompt,
      refImages: refImages.map(toStoredImage),
      prodImages: prodImages.map(toStoredImage),
      selectedAspectRatios: Array.from(selectedAspectRatios) as string[],
      quality: imageSize,
      model: coachioModel,
      bannerType,
      multiContent,
      contents,
      enabledBriefIds: Array.from(enabledBriefIds) as string[],
      enabledUrlBriefIds: Array.from(enabledUrlBriefIds) as string[],
      variantCount,
      versionsPerContent,
      outputLang,
    };

    const activeBrandForGen = brandProjects.find(p => p.id === activeBrandId);
    const brandTokens = extractBrandTokens(brandJsonPrompt);

    const promises = plan.map(async ({ placeholder, source, aspect }, planIdx) => {
      // Either pool can be empty; fall back to the other so user can run
      // with style-only or product-only inputs. Deterministic: rotate by
      // planIdx so variants get consistent (but distributed) refs — no more
      // "different logo every time" chaos.
      const refPool = refImages.length > 0 ? refImages : prodImages;
      const prodPool = prodImages.length > 0 ? prodImages : refImages;
      const pickRotating = (arr: UploadedImage[], i: number): UploadedImage => arr[i % arr.length];
      const selectedRef = pickRotating(refPool, planIdx);
      const selectedProd = pickRotating(prodPool, planIdx);

      const varietyPrompts = [
        "Focus on clean lines and minimalism.",
        "Use bold, high-contrast aesthetics.",
        "Create a soft, elegant atmosphere.",
        "Make it dynamic and energetic.",
        "Ensure a balanced, professional composition."
      ];
      const randomNuance = getRandomItem(varietyPrompts);

      // Extract CTA from brief (if any) → map sang label theo lang. Meta CTA
      // code không tự dịch được bởi model, phải map bên client trước khi
      // feed vào prompt.
      const ctaLabel = ctaLabelFor(source.brief?.cta, outputLang);
      const typePromptForThis = getBannerTypePrompt(bannerType, ctaLabel, outputLang);
      const langTag = outputLang === 'vi' ? 'VN' : 'EN';

      // Cap the raw brand notes so a pasted design system doc doesn't blow
      // through backend prompt limits. Coachio caps at 20000 chars, OpenAI
      // gpt-image-2 caps around 32000. Extracted BRAND TOKENS carry the
      // high-signal bits (palette hex + font names) — raw notes are just
      // extra context, safe to truncate hard.
      const BRAND_NOTES_MAX = 2000;
      const brandNotesRaw = brandJsonPrompt.trim();
      const brandNotesTrimmed = brandNotesRaw.length > BRAND_NOTES_MAX
        ? brandNotesRaw.slice(0, BRAND_NOTES_MAX) + `\n… (truncated ${brandNotesRaw.length - BRAND_NOTES_MAX} chars — palette/typo already extracted above)`
        : brandNotesRaw;

      // Structured user-side prompt — sections rõ ràng, model dễ parse hơn
      // string join lộn xộn. Order: BRAND TOKENS (strict) → BRAND STYLE (raw)
      // → BRIEF → TYPE → USER ADJUSTMENTS → STYLE VARIETY.
      const sections: string[] = [];
      if (brandTokens) sections.push(brandTokens);
      if (brandNotesTrimmed) {
        sections.push(`BRAND STYLE (raw notes):\n${brandNotesTrimmed}`);
      }
      if (source.brief) {
        const b = source.brief;
        const briefLines: string[] = [`Type: ${b.briefType}`];
        if (b.headline)   briefLines.push(`Headline (${langTag}): "${b.headline}"`);
        if (ctaLabel)     briefLines.push(`CTA button text (${langTag}): "${ctaLabel}"`);
        if (b.toneNotes)  briefLines.push(`Tone: ${b.toneNotes}`);
        sections.push(`BRIEF CONTEXT:\n${briefLines.join('\n')}`);
      }
      if (typePromptForThis) sections.push(typePromptForThis);
      if (userPrompt.trim()) sections.push(`USER ADJUSTMENTS:\n${userPrompt.trim()}`);
      sections.push(`STYLE VARIETY: ${randomNuance}`);

      let combinedPrompt = sections.join('\n\n');

      // Hard backend limit safety net: Coachio 422s at >20000 chars. Cap
      // conservatively so headers + refs metadata don't push us over.
      const PROMPT_HARD_CAP = 18000;
      if (combinedPrompt.length > PROMPT_HARD_CAP) {
        const dropped = combinedPrompt.length - PROMPT_HARD_CAP;
        console.warn(`[prompt] cap ${combinedPrompt.length} → ${PROMPT_HARD_CAP} chars, dropping ${dropped} from tail`);
        combinedPrompt = combinedPrompt.slice(0, PROMPT_HARD_CAP);
      }

      try {
        const { imageUrl, duration } = await generateSingle(
          placeholder, selectedRef, selectedProd, combinedPrompt, source.text,
          [], sessionId, aspect, genSnapshot,
        );

        setResults(prev => prev.map(p =>
          p.id === placeholder.id
            ? { ...p, imageUrl, status: 'success', promptUsed: combinedPrompt, duration, refImage: selectedRef, prodImage: selectedProd, aspectRatio: aspect }
            : p
        ));
      } catch (err: any) {
        console.error("Generation failed for one item", err);
        // Provider nào chạy request này — quan trọng vì user hay nhầm ví
        // OpenAI với credit Coachio.
        const provider = (imageSize === '2K' || imageSize === '4K') && hqBackend === 'openai' && !!getOpenaiApiKey()
          ? 'OpenAI'
          : (backend === 'coachio' ? 'Coachio' : 'Gemini');
        const info = describeGenError(err);
        // Giữ NGUYÊN VĂN message của provider — trước đây các nhánh này thay
        // nó bằng câu cố định và cắt còn 250 ký tự, nên lý do thật biến mất.
        const userMsg = `${provider} (${imageSize}) · ${info.title} — ${info.detail}${info.hint ? `\n${info.hint}` : ''}`;
        setErrorMsg(userMsg);

        setResults(prev => prev.map(p =>
          p.id === placeholder.id
            ? { ...p, status: 'error', errorMsg: userMsg, refImage: selectedRef, prodImage: selectedProd, promptUsed: combinedPrompt }
            : p
        ));
      }
    });

    await Promise.all(promises);
    setIsGenerating(false);
    setGenerationProgress({});
    // Pull the fresh batch into the Sessions panel.
    refreshHistory();
  };

  const handleRegenerate = async (id: string, adjustmentPrompt: string, extras: UploadedImage[] = []) => {
    const target = results.find(r => r.id === id);
    if (!target || !target.refImage || !target.prodImage) {
      setErrorMsg("Cannot regenerate: missing reference or product image.");
      return;
    }

    setResults(prev => prev.map(p => p.id === id ? { ...p, status: 'loading' } : p));

    try {
      const adj = adjustmentPrompt?.trim();
      const extraNote = extras.length > 0
        ? ` Use the ${extras.length} extra reference image${extras.length > 1 ? 's' : ''} as additional style/composition cues.`
        : '';
      const combinedPrompt = `${target.promptUsed}.${adj ? ` Adjustment: ${adj}.` : ''}${extraNote}`;

      const newPlaceholder = { ...target, id };
      const { imageUrl, duration } = await generateSingle(
        newPlaceholder, target.refImage, target.prodImage, combinedPrompt, undefined, extras
      );

      setResults(prev => prev.map(p =>
        p.id === id
          ? { ...p, imageUrl, status: 'success', promptUsed: combinedPrompt, duration }
          : p
      ));
    } catch (err: any) {
      console.error("Regeneration failed", err);
      const info = describeGenError(err);
      setErrorMsg(`${info.title} — ${info.detail}${info.hint ? `\n${info.hint}` : ''}`);
      setResults(prev => prev.map(p => p.id === id ? { ...p, status: 'error', errorMsg: info.detail } : p));
    }
  };

  const bananaProAspectRatios = ['1:1', '9:16', '16:9', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
  const gptImage2AspectRatios = ['auto', '1:1', '5:4', '9:16', '21:9', '16:9', '4:3', '3:2', '4:5', '3:4', '2:3'];
  const geminiAspectRatios = ['1:1', '9:16', '16:9'];
  const currentAspectRatios =
    backend === 'coachio'
      ? (coachioModel === 'gpt_image_2' ? gptImage2AspectRatios : bananaProAspectRatios)
      : geminiAspectRatios;

  const isGptImage2 = backend === 'coachio' && coachioModel === 'gpt_image_2';
  const accent = backend === 'coachio'
    ? { bg: 'bg-brand', border: 'border-brand' }
    : { bg: 'bg-brand', border: 'border-brand' };
  const isResolutionDisabled = (size: string) => {
    if (!isGptImage2) return false;
    if (aspectRatio === 'auto' && size !== '1K') return true;
    if (aspectRatio === '1:1' && size === '4K') return true;
    return false;
  };

  // Auto-correct invalid combos for GPT Image 2
  React.useEffect(() => {
    if (!isGptImage2) return;
    if (aspectRatio === 'auto' && imageSize !== '1K') setImageSize('1K');
    else if (aspectRatio === '1:1' && imageSize === '4K') setImageSize('2K');
  }, [isGptImage2, aspectRatio, imageSize]);

  // Reset aspect ratio if switching to a model that doesn't support it
  React.useEffect(() => {
    if (!currentAspectRatios.includes(aspectRatio)) {
      setAspectRatio(currentAspectRatios[0]);
    }
    // Cũng filter selectedAspectRatios: giữ những cái vẫn được model
    // support, drop những cái không hỗ trợ. Đảm bảo ít nhất 1.
    setSelectedAspectRatios(prev => {
      const filtered = new Set<string>(
        (Array.from(prev) as string[]).filter(r => currentAspectRatios.includes(r)),
      );
      if (filtered.size === 0) filtered.add(currentAspectRatios[0]);
      return filtered;
    });
  }, [coachioModel, backend]);

  // Sync aspectRatio (primary) với first item của selectedAspectRatios
  // để UI cũ (single aspect) không lệch.
  React.useEffect(() => {
    const first = Array.from(selectedAspectRatios)[0];
    if (first && first !== aspectRatio) setAspectRatio(first);
  }, [selectedAspectRatios]);

  const toggleAspectRatio = React.useCallback((r: string) => {
    setSelectedAspectRatios(prev => {
      const next = new Set(prev);
      if (next.has(r)) {
        if (next.size <= 1) return prev; // đảm bảo ít nhất 1
        next.delete(r);
      } else {
        next.add(r);
      }
      return next;
    });
  }, []);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full bg-canvas text-fg font-sans">

      {/* Sidebar Controls */}
      <div className="w-80 sm:w-96 flex-shrink-0 bg-surface border-r border-line flex flex-col h-full overflow-hidden">
        <div className="px-5 py-4 border-b border-line flex items-center gap-3">
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-fg">Controls</h2>
            <p className="text-[11px] text-subtle">Brand · References · Content → AI</p>
          </div>
          <button
            onClick={() => setShowApiKeySettings(true)}
            className={`p-2 rounded-md transition-colors ${
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

          {/* Backend: Coachio only — Gemini path hidden but kept in code for future re-enable */}
          {!hasCoachioKey && (
            <div className="status-warning border rounded-md px-3 py-2.5 text-xs flex items-center justify-between gap-2">
              <span>Chưa có Coachio API key — bắt buộc để generate.</span>
              <button
                onClick={() => setShowApiKeySettings(true)}
                className="text-xs font-semibold underline hover:no-underline shrink-0"
              >
                Thêm key
              </button>
            </div>
          )}

          {/* Backend picker cho 2K/4K — chỉ hiện khi user chọn tier HQ */}
          {(imageSize === '2K' || imageSize === '4K') && (
            <div className="border border-line rounded-md px-3 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-subtle uppercase tracking-wider">
                  Backend cho {imageSize}
                </label>
                <span className={`text-[10px] font-mono ${
                  missingHqKey ? 'text-warning' : 'text-muted'
                }`}>
                  {missingHqKey ? 'thiếu key → Coachio' : 'active'}
                </span>
              </div>
              <div className="inline-flex rounded-md border border-line overflow-hidden w-full">
                {([
                  { id: 'coachio' as const, label: 'Coachio', title: 'GPT Image 2 / Nano Banana Pro qua Coachio' },
                  { id: 'openai' as const,  label: 'OpenAI',  title: 'OpenAI /v1/images/edits (gpt-image-2)' },
                  { id: 'kie' as const,     label: 'KIE',     title: 'KIE.ai — Nano Banana. Chỉ text-to-image.' },
                ]).map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setHqBackend(opt.id)}
                    className={`flex-1 px-3 py-1.5 text-xs font-semibold ${
                      hqBackend === opt.id
                        ? 'bg-brand text-white'
                        : 'bg-canvas text-muted hover:text-fg hover:bg-raised'
                    }`}
                    title={opt.title}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {hqBackend === 'kie' && (
                <div className="space-y-1.5 pt-1">
                  <select
                    value={kieModel}
                    onChange={(e) => setKieModel(e.target.value)}
                    className="w-full bg-canvas border border-line rounded-md px-2 py-1.5 text-xs text-fg"
                  >
                    {KIE_IMAGE_MODELS.map(m => (
                      <option key={m.id} value={m.id}>{m.label} — {m.note}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-warning leading-snug">
                    KIE chỉ sinh ảnh từ prompt. Ảnh style/product/logo sẽ bị bỏ qua —
                    cần bám ảnh mẫu thì chọn Coachio hoặc OpenAI.
                  </p>
                </div>
              )}

              <p className="text-[10px] text-subtle leading-snug">
                {hqBackend === 'coachio'
                  ? 'Coachio proxy — rẻ, không cần key OpenAI riêng.'
                  : hqBackend === 'openai'
                    ? 'OpenAI trực tiếp — chất lượng gốc, cần key OpenAI (Settings → API Keys).'
                    : 'KIE.ai — một key dùng được nhiều model. Cần key KIE (Settings → API Keys).'}
              </p>
            </div>
          )}

          {/* Chọn backend mà thiếu key của nó → sẽ fallback về Coachio */}
          {(imageSize === '2K' || imageSize === '4K') && missingHqKey && (
            <div className="border border-warning-fg/40 bg-warning-soft rounded-md px-3 py-2.5 text-xs flex items-center justify-between gap-2">
              <div>
                <p className="text-fg font-medium">
                  ⚠ Đã chọn {hqBackend === 'kie' ? 'KIE' : 'OpenAI'} nhưng chưa có key
                </p>
                <p className="text-muted text-[11px] mt-0.5">Sẽ chạy bằng Coachio. Thêm key để dùng đúng backend đã chọn.</p>
              </div>
              <button
                onClick={() => onNavigate('settings')}
                className="text-xs font-semibold underline hover:no-underline shrink-0"
              >
                Thêm key
              </button>
            </div>
          )}

          {/* References — 2 compact cards, mỗi cái mở picker modal. */}
          <ReferencesRow
            styleImages={refImages}
            productImages={prodImages}
            onOpenStyle={() => setShowStyleModal(true)}
            onOpenProduct={() => setShowProductModal(true)}
          />

          <div className="h-px bg-raised" />

          {/* Brand — compact row only. Briefs live inside MultiContentModal */}
          <BrandRow
            projects={brandProjects}
            activeBrandId={activeBrandId}
            onApply={applyBrandProject}
            onClear={clearBrandSelection}
            onNavigate={onNavigate}
          />

          {/* Configuration wrapper — bundles the section-below-references */}
          <div className="space-y-4">

            {/* Output row — Aspect / Quality / Qty inline selects (Sprint H5)
                totalVariants is the single source of truth used by both the
                Content chip and this row's preview. */}
            {(() => {
              const nonEmptyContents = contents.filter(c => c.trim()).length;
              const enabledBriefCount = enabledBriefIds.size;
              const enabledUrlBriefCount = enabledUrlBriefIds.size;
              const totalVariants = multiContent
                ? nonEmptyContents + enabledBriefCount + enabledUrlBriefCount
                : 0;
              // At least 1 content is always sent (falls back to empty in
              // single-mode). Used for total banner preview math.
              const effectiveContents = Math.max(1, multiContent ? totalVariants : 1);
              const versions = multiContent ? versionsPerContent : variantCount;
              const aspectCount = Math.max(1, selectedAspectRatios.size);
              const total = multiContent
                ? effectiveContents * versions * aspectCount
                : versions * aspectCount;
              return (
                <>
                  <OutputRow
                    selectedAspectRatios={selectedAspectRatios}
                    aspectRatios={currentAspectRatios}
                    onToggleAspect={toggleAspectRatio}
                    quality={imageSize}
                    qualities={['1K', '2K', '4K']}
                    isQualityDisabled={isResolutionDisabled}
                    onChangeQuality={setImageSize}
                    qtyLabel={multiContent ? 'Bản / biến thể' : 'Số bản'}
                    qty={versions}
                    qtyMax={multiContent ? MAX_VERSIONS_PER_CONTENT : 10}
                    onChangeQty={(n) => multiContent ? setVersionsPerContent(n) : setVariantCount(n)}
                    totalPreview={total}
                    totalHint={multiContent
                      ? `${effectiveContents} biến thể × ${aspectCount} tỉ lệ × ${versions} bản`
                      : `${aspectCount} tỉ lệ × ${versions} bản`}
                  />

                  {/* Language selector — decides output language for all banner
                      text (headline, subline, CTA button, badges). Flows into
                      the LANGUAGE hard rule at the top of the gen prompt. */}
                  <div className="flex items-center justify-between gap-2 -mt-2">
                    <label className="text-[10px] text-subtle uppercase tracking-wider">
                      Ngôn ngữ nội dung
                    </label>
                    <div className="inline-flex rounded-md border border-line overflow-hidden">
                      {(['vi', 'en'] as OutputLang[]).map(l => (
                        <button
                          key={l}
                          type="button"
                          onClick={() => setOutputLang(l)}
                          className={`px-3 py-1 text-xs font-semibold ${
                            outputLang === l
                              ? 'bg-brand text-white'
                              : 'bg-canvas text-muted hover:text-fg hover:bg-raised'
                          }`}
                        >
                          {l === 'vi' ? '🇻🇳 Tiếng Việt' : '🇬🇧 English'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Content — compact primary + variants chip → MultiContentModal (Sprint H3) */}
                  <ContentSection
                    primaryContent={multiContent ? (contents[0] || '') : brandContent}
                    onChangePrimary={(v) => {
                      if (multiContent) {
                        setContents(prev => {
                          const next = [...prev];
                          next[0] = v;
                          return next;
                        });
                      } else {
                        setBrandContent(v);
                      }
                    }}
                    multiOn={multiContent}
                    onToggleMulti={(on) => {
                      setMultiContent(on);
                      if (on && contents.every(c => !c.trim()) && brandContent.trim()) {
                        setContents([brandContent.trim()]);
                      }
                    }}
                    totalVariants={totalVariants}
                    onOpenManage={() => setShowMultiContentModal(true)}
                    onSavePrimarySnippet={() => handleBrandSave()}
                    onOpenLibrary={() => setShowBrandLibrary(true)}
                    librarySize={brandLibrary.length}
                  />
                </>
              );
            })()}

            <div className="mb-4" />

            {/* Prompt Adjustments — kept inline (small textarea) */}
            <div>
              <label className="text-[10px] text-subtle uppercase tracking-wider block mb-1">
                Điều chỉnh prompt (tuỳ chọn)
              </label>
              <textarea
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                placeholder="VD: Nền tối hơn, màu tươi hơn..."
                className="w-full bg-canvas border border-line rounded-md p-3 text-sm text-fg focus:outline-none focus:border-brand h-16 resize-none"
              />
            </div>

            {/* Advanced — collapsed, holds model + banner type + JSON prompt */}
            {(() => {
              const activeBrand = brandProjects.find(p => p.id === activeBrandId);
              const jsonFromBrand = !!(activeBrand && activeBrand.jsonPrompt && brandJsonPrompt === activeBrand.jsonPrompt.trim());
              return (
                <AdvancedPopover
                  coachioModel={coachioModel}
                  coachioModels={[
                    { id: 'google_image_gen_banana_pro', name: 'Nano Banana Pro' },
                    { id: 'gpt_image_2', name: 'GPT Image 2' },
                  ]}
                  onChangeCoachioModel={setCoachioModel}
                  bannerType={bannerType}
                  bannerTypeOptions={BANNER_TYPE_OPTIONS}
                  onChangeBannerType={(id) => setBannerType(id as BannerType)}
                  jsonPrompt={brandJsonPrompt}
                  onChangeJsonPrompt={setBrandJsonPrompt}
                  jsonFromBrand={jsonFromBrand}
                />
              );
            })()}
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
                : backend === 'coachio'
                  ? 'bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 hover:scale-[1.02] active:scale-95'
                  : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 hover:scale-[1.02] active:scale-95'
            }`}
          >
            {isGenerating ? (
              <>
                <Wand2 className="animate-spin" size={20} /> Generating {results.length || (multiContent ? Math.max(1, contents.filter(c => c.trim()).length) * versionsPerContent : variantCount)} variant{(results.length || 1) !== 1 ? 's' : ''}...
              </>
            ) : (
              <>
                <Wand2 size={20} /> Generate via {coachioModel === 'gpt_image_2' ? 'GPT Image 2' : 'Nano Banana Pro'}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full bg-canvas relative overflow-hidden">
        <header className="h-16 flex items-center justify-between px-6 border-b border-line bg-surface/50 backdrop-blur-sm z-10">
          <h2 className="font-medium text-fg">Generated Workspace</h2>
          <div className="flex items-center gap-4 text-xs text-subtle">
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isGenerating ? 'bg-warning-fg animate-pulse' : 'bg-success-fg'}`}></span>
              {isGenerating ? 'Generating' : 'Ready'}
            </span>
            <span className="px-2 py-0.5 rounded-full border bg-brand/10 border-brand/30 text-brand font-mono">
              {coachioModel === 'gpt_image_2' ? 'GPT Image 2' : 'Nano Banana Pro'}
            </span>
            <span className="font-mono">{imageSize} · {aspectRatio}</span>
          </div>
        </header>

        <main className="flex-1 overflow-hidden relative flex flex-col">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-brand/10 via-canvas to-canvas pointer-events-none" />
          {/* Layout flip based on whether we have current results:
              - No results → SessionsPanel occupies the full workspace so past
                banners are the primary content (bigger thumbnails, grid mode).
              - Has results → ResultViewer takes the top, SessionsPanel becomes
                a compact bottom strip showing recent runs for quick reference. */}
          {results.length === 0 ? (
            <div className="relative flex-1 min-h-0 flex flex-col z-10">
              <SessionsPanel
                history={history}
                featureType="banner"
                fullHeight
                footer={<Pagination page={historyPage} totalPages={historyTotalPages} total={historyTotal} unit="banner" onChange={setHistoryPage} />}
                onSelectItem={(it) => setEditingItem(it)}
                onDeleteItem={deleteHistoryItem}
                onDeleteSession={deleteHistorySession}
                onRetryRegen={handleRetryRegen}
                onRemoveErrorTask={handleRemoveErrorTask}
                onOpenFullHistory={() => onNavigate('history')}
              />
            </div>
          ) : (
            <>
              <div className="relative flex-1 min-h-0 overflow-hidden">
                <ResultViewer
                  results={results}
                  onRegenerate={handleRegenerate}
                  onToggleVote={toggleVote}
                  isVoted={(id) => votes.some(v => v.id === id)}
                  onRetryBackground={handleRetryRegen}
                  onRemoveErrorTask={handleRemoveErrorTask}
                />
              </div>
              <div className="relative shrink-0 z-10">
                <SessionsPanel
                  history={history}
                  featureType="banner"
                  footer={<Pagination page={historyPage} totalPages={historyTotalPages} total={historyTotal} unit="banner" onChange={setHistoryPage} />}
                  onSelectItem={(it) => setEditingItem(it)}
                  onDeleteItem={deleteHistoryItem}
                  onDeleteSession={deleteHistorySession}
                  onRetryRegen={handleRetryRegen}
                  onOpenFullHistory={() => onNavigate('history')}
                />
              </div>
            </>
          )}
        </main>
      </div>

      {/* History edit modal — shared with the HistoryPage flow */}
      {editingItem && (() => {
        // Sibling ratio versions: cùng sessionId với item được chọn.
        // Nếu item không có sessionId, chỉ item đó là sibling.
        const siblings = editingItem.sessionId
          ? history.filter(h => h.sessionId === editingItem.sessionId)
          : [editingItem];
        return (
          <HistoryEditModal
            item={editingItem}
            onClose={() => setEditingItem(null)}
            onUpdated={() => { refreshHistory(); }}
            onSubmitBackground={handleBackgroundRegen}
            siblings={siblings}
            onReloadInputs={hydrateFromHistory}
          />
        );
      })()}

      {/* API Key Settings Modal */}
      {showApiKeySettings && (
        <ApiKeySettings onClose={() => setShowApiKeySettings(false)} />
      )}

      {/* Style / Product reference pickers (Sprint H2) */}
      {showStyleModal && (
        <ReferencePickerModal
          kind="style"
          images={refImages}
          library={refLibrary}
          onUpload={(f) => handleUpload(f, 'ref')}
          onRemove={(id) => handleRemove(id, 'ref')}
          onLibrarySelect={(item) => handleLibrarySelect(item, 'ref')}
          onLibraryDelete={(id) => handleLibraryDelete(id, 'ref')}
          onClose={() => setShowStyleModal(false)}
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
      {showMultiContentModal && (
        <MultiContentModal
          contents={contents}
          onChangeContents={setContents}
          allBriefs={brandBriefs}
          enabledBriefIds={enabledBriefIds}
          onChangeEnabledBriefIds={setEnabledBriefIds}
          onDeleteBrief={removeBrandBrief}
          onUpdateBrandBrief={updateBrandBrief}
          urlBriefs={urlBriefs}
          enabledUrlBriefIds={enabledUrlBriefIds}
          onUrlCrawlComplete={handleUrlCrawlComplete}
          onToggleUrlBrief={handleToggleUrlBrief}
          onSetAllUrlBriefsEnabled={handleSetAllUrlBriefsEnabled}
          onClearAllUrlBriefs={handleClearAllUrlBriefs}
          onUpdateUrlBrief={updateUrlBriefLocal}
          onDeleteUrlBrief={deleteUrlBriefLocal}
          onSaveSnippet={(c) => saveContentSnippet(c)}
          onOpenLibrary={() => { setShowMultiContentModal(false); setShowBrandLibrary(true); }}
          onNavigateToBrandStyle={onNavigate}
          maxContents={MAX_CONTENTS}
          onClose={() => setShowMultiContentModal(false)}
        />
      )}

      {/* Brand Content Library Modal */}
      {showBrandLibrary && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
          onClick={() => setShowBrandLibrary(false)}
        >
          <div
            className="bg-surface border border-line-strong rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-line">
              <div className="flex items-center gap-3">
                <div className="bg-canvas text-brand p-2 rounded-md"><Type size={18} /></div>
                <div>
                  <h3 className="text-base font-semibold text-fg">Thư viện Brand Content</h3>
                  <p className="text-xs text-subtle">Bấm vào dòng để chèn vào ô brand · {brandLibrary.length}/30</p>
                </div>
              </div>
              <button
                onClick={() => setShowBrandLibrary(false)}
                className="p-2 rounded-md hover:bg-raised text-muted hover:text-fg"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {brandLibrary.length === 0 ? (
                <div className="text-center text-subtle text-sm py-16">
                  Chưa có brand content nào được lưu.
                  <br />
                  <span className="text-xs">Nội dung sẽ được lưu khi bạn bấm "Lưu" hoặc khi sinh banner.</span>
                </div>
              ) : (
                <ul className="space-y-2">
                  {brandLibrary.map(item => {
                    const expanded = expandedBrandIds.has(item.id);
                    const isLong = item.content.length > 140 || (item.content.match(/\n/g)?.length ?? 0) >= 2;
                    return (
                      <li key={item.id} className="bg-canvas border border-line hover:border-brand/60 rounded-md transition-colors">
                        <div className="flex items-stretch gap-0">
                          <div
                            className={`flex-1 p-3 text-sm text-fg whitespace-pre-wrap break-words cursor-pointer ${
                              expanded ? '' : 'line-clamp-3'
                            }`}
                            onClick={() => toggleBrandExpanded(item.id)}
                            title="Bấm để xem thêm / thu gọn"
                          >
                            {item.content}
                          </div>
                          <div className="flex flex-col border-l border-line">
                            <button
                              type="button"
                              onClick={() => {
                                setBrandContent(item.content);
                                setShowBrandLibrary(false);
                              }}
                              className="flex-1 px-3 text-[11px] text-brand hover:bg-canvas transition-colors"
                              title="Dùng nội dung này"
                            >
                              Dùng
                            </button>
                            <button
                              type="button"
                              onClick={() => handleBrandDelete(item.id)}
                              className="flex-1 px-3 text-muted hover:bg-danger-soft hover:text-fg border-t border-line transition-colors"
                              title="Remove"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        {isLong && (
                          <button
                            type="button"
                            onClick={() => toggleBrandExpanded(item.id)}
                            className="block w-full text-[10px] text-subtle hover:text-brand px-3 py-1 text-left border-t border-line/50"
                          >
                            {expanded ? '↑ Thu gọn' : '↓ Xem thêm'}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
