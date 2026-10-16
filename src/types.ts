export interface UploadedImage {
  id: string;
  url: string;
  file: File;
  base64: string;
  mimeType: string;
}

export interface GeneratedBanner {
  id: string;
  imageUrl: string;
  promptUsed: string;
  status: 'loading' | 'success' | 'error';
  timestamp: number;
  duration?: number;
  refImage?: UploadedImage;
  prodImage?: UploadedImage;
  /** Actual aspect ratio used for this banner (multi-aspect gen). */
  aspectRatio?: string;
  /** Local-only params dùng để retry background regen (edit từ history).
   *  Chỉ populate khi status='error' và item là edit-regen. Không persist DB. */
  retryPayload?: RegenRetryPayload;
  /** Error message for background regen failures / timeout. */
  errorMsg?: string;
}

/** Snapshot của inputs sidebar khi user bấm Generate. Persist vào cột
 *  banner_history.gen_params (jsonb). Cho phép user click 1 banner từ
 *  history → "Nạp lại inputs" → sidebar auto-fill lại toàn bộ. */
export interface StoredImageRef {
  url?: string;      // storage local URL — preferred
  base64?: string;   // fallback (data URL)
  fileName?: string;
  mimeType?: string;
}

export interface GenParamsSnapshot {
  brandId?: string;
  brandContent?: string;
  userPrompt?: string;
  brandJsonPrompt?: string;
  refImages?: StoredImageRef[];
  prodImages?: StoredImageRef[];
  selectedAspectRatios?: string[];
  quality?: string;
  model?: string;
  bannerType?: string;
  multiContent?: boolean;
  contents?: string[];
  enabledBriefIds?: string[];
  enabledUrlBriefIds?: string[];
  variantCount?: number;
  versionsPerContent?: number;
  /** Output language for banner text (headline, CTA, subline). vi | en. */
  outputLang?: 'vi' | 'en';
}

/** Payload đủ để re-fire background regen sau khi task lỗi/timeout. Persist
 *  vào localStorage cùng với pending tasks. */
export interface RegenRetryPayload {
  sourceItemId: string;
  sourceImageUrl: string;
  sourceModel: string;
  sourcePromptUsed: string;
  sourceParentId: string;
  sourceVersion: number;
  sourceFeatureType?: FeatureType;
  /** Tỉ lệ của banner gốc. Dùng để biết lần edit này có đổi khung hay không
   *  — cùng tỉ lệ thì cấm re-crop, khác tỉ lệ thì chỉ cho re-flow tối thiểu. */
  sourceAspectRatio?: string;
  prompt: string;
  aspectRatio: string;
  quality: string;
  sessionId: string;
  /** Ảnh user upload thêm khi edit (logo / product / style cue), đã đẩy lên
   *  CDN nên serialize được → retry sau F5 vẫn giữ đúng refs. Ảnh đầu đóng
   *  vai product, các ảnh sau là reference bổ sung. */
  editRefs?: StoredImageRef[];
}

export interface GenerationConfig {
  userPrompt: string;
  brandContent: string;
  aspectRatio: "1:1" | "3:4" | "4:3" | "16:9" | "9:16";
  model: string;
  quality: "1K" | "2K" | "4K";
}

/** Which tool generated the item — drives history tabs + workspace panel
 *  filtering. Extend when we add more tools. */
export type FeatureType = 'banner' | 'ugc' | 'image_studio' | 'mcp_banner';

export interface HistoryItem {
  id: string;
  imageUrl: string;
  promptUsed: string;
  timestamp: number;
  duration?: number;
  model: string;
  quality: string;
  aspectRatio: string;
  /** id of the banner this was edited from. Empty for root versions. */
  parentId?: string;
  /** 1 for root, 2+ for each successive edit. */
  version?: number;
  /** Tool that produced this item. Defaults to 'banner' if missing (backfilled
   *  server-side by the sprint-history-tabs migration). */
  featureType?: FeatureType;
  /** Banner được user đánh sao — hiện ở tab Yêu thích. */
  isFavorite?: boolean;
  /** All items generated within the same Generate click share a sessionId.
   *  Client-side bucketing by timestamp is used when this is empty. */
  sessionId?: string;
  /** Local-only status marker cho pending background regen tasks. Không
   *  persist DB. 'loading' = đang chạy. 'error' / 'timeout' = fail, cần retry. */
  pendingStatus?: 'loading' | 'error' | 'timeout';
  pendingError?: string;
  /** Retry payload — có khi pendingStatus='error'/'timeout'. */
  retryPayload?: RegenRetryPayload;
  /** Snapshot của inputs sidebar khi Generate — cho phép "Nạp lại inputs"
   *  từ history modal. Null cho items cũ trước feature này. */
  genParams?: GenParamsSnapshot;
}

export type AppPage = 'menu' | 'banner' | 'history' | 'brand-style' | 'ugc-studio' | 'settings';

/** Sub-tab của Settings page — persist qua URL query param `?tab=` để deep-link được. */
export type SettingsTab = 'profile' | 'keys' | 'media' | 'storage';

export type LibraryCategory = 'ref' | 'prod' | 'face';

export interface LibraryImage {
  id: string;
  /** @deprecated for new data — kept for legacy localStorage entries */
  base64?: string;
  /** storage local URL (new cloud entries always have this) */
  url?: string;
  mimeType: string;
  fileName: string;
  addedAt: number;
}

/** Returns the renderable src for an <img>: prefer CDN url, fall back to base64. */
export function libraryImageSrc(img: LibraryImage | undefined | null): string {
  if (!img) return '';
  return img.url || img.base64 || '';
}

export interface BrandSnippet {
  id: string;
  content: string;
  addedAt: number;
}

export interface VotedBanner {
  id: string;
  imageUrl: string;
  promptUsed: string;
  brandContent: string;
  bannerType: string;
  aspectRatio: string;
  model: string;
  votedAt: number;
}

// ===== Ads Studio Chat =====

export interface BrandProject {
  id: string;
  name: string;
  brandInfo: string;
  eventInfo: string;
  jsonPrompt: string;
  logo?: LibraryImage;
  /** @deprecated use styleReferences */
  references?: LibraryImage[];
  styleReferences: LibraryImage[];
  productReferences: LibraryImage[];
  /** URL the user imported context from (Sprint G). */
  scrapedUrl?: string;
  /** AI summary of the scraped page — feeds brief generation. */
  scrapedSummary?: ScrapedSummary;
  /** When the URL was last scraped. */
  scrapedAt?: number;
  createdAt: number;
  updatedAt: number;
}

// ─── Sprint G: URL import + briefs ───

export interface ScrapedSummary {
  brand?: string;
  product?: string;
  usp?: string;
  target_audience?: string;
  key_offerings?: string[];
  tone_of_voice?: string;
  notable_elements?: string[];
}

/** @deprecated legacy fixed enum. New briefs use free-form `angle` slug via
 *  `briefType` (schema kept for backward compat — LLM picks any short slug
 *  like "pain-solo-overload", "myth-bust-video", "outcome-cost-saving"). */
export type BriefType = string;

export interface BrandBrief {
  id: string;
  brandId: string;
  /** Free-form angle slug (e.g. "pain-solo-overload"). Legacy fixed enum
   *  values still readable but new writes use freeform. */
  briefType: BriefType;
  title: string;
  primaryMessage?: string;
  /** Insight / pain / outcome / hook — 3-8 words, reads-and-quarantines. */
  headline?: string;
  /** One-line explainer under headline (10-15 words). */
  subline?: string;
  /** Body copy (30-60 words) — pain → solution flow. Mapped to primary_text
   *  in DB for backward compat. */
  primaryText?: string;
  /** Legacy Meta CTA code (SIGN_UP / SHOP_NOW / …). */
  cta?: string;
  /** Human-readable Vietnamese button text ("Giữ chỗ miễn phí"). Rendered
   *  ON the banner — LLM writes this. If empty, falls back to ctaLabelFor. */
  ctaText?: string;
  /** Badge/chip strings placed on the banner (social proof, urgency, offer).
   *  Max 3 items, each 1-6 words. */
  badges?: string[];
  toneNotes?: string;
  sourceUrl?: string;
  isSelected: boolean;
  position: number;
  createdAt: number;
  updatedAt: number;
}
