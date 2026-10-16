// Content variants manager — one scroll, three stacked sections:
//   1. Manual biến thể (textareas, index 0 mirrors sidebar primary)
//   2. Brand briefs (compact ticklist beneath manual)
//   3. URL Crawl briefs (session-scoped: paste URL → Firecrawl → 10 briefs
//      → tick chọn; không lưu vào brand)

import React, { useState } from 'react';
import {
  X, Plus, ListPlus, Save, Trash2, FolderOpen, Sparkles, CheckCircle,
  Link as LinkIcon, Loader2, AlertCircle, Pencil,
} from 'lucide-react';
import { BrandBrief, BriefType, AppPage } from '../../types';
import {
  scrapeUrl, summarizeContent, generateBriefs, RawBrief,
} from '../../services/contentImportService';
import { BriefEditModal } from './BriefEditModal';

export type UrlCrawlEnable = 'all' | 'none';

const TYPE_ABBR: Partial<Record<BriefType, string>> = {
  'offer-emphasis':       'OFFER',
  'instructor-authority': 'INSTR',
  'catchy-headline':      'HOOK',
  'neutral-info':         'INFO',
  'social-proof':         'PROOF',
  'urgency-fomo':         'URGE',
  'problem-solution':     'PROB',
  'benefit-led':          'BENE',
  'aspirational':         'ASPIR',
  'question-hook':        'QUES',
};

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'vừa xong';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} ngày trước`;
  return new Date(ts).toLocaleDateString('vi-VN');
}

interface Props {
  contents: string[];
  onChangeContents: (next: string[]) => void;

  allBriefs: BrandBrief[];
  enabledBriefIds: Set<string>;
  onChangeEnabledBriefIds: (next: Set<string>) => void;
  /** Xoá luôn 1 brand brief khỏi DB (không chỉ untick). Optional — chỉ hiện
   *  button nếu parent truyền handler. */
  onDeleteBrief?: (briefId: string) => Promise<void>;
  /** Update 1 brand brief (từ edit modal). Parent persist + update state. */
  onUpdateBrandBrief?: (id: string, patch: Partial<BrandBrief>) => Promise<void>;

  /** URL-crawled briefs — persist trong Supabase (user-scoped, không tie brand). */
  urlBriefs: BrandBrief[];
  enabledUrlBriefIds: Set<string>;
  /** Sau khi LLM sinh xong 10 briefs, modal gọi handler này để parent
   *  persist sang Supabase + update state. Trả về briefs đã persist. */
  onUrlCrawlComplete: (sourceUrl: string, rawBriefs: RawBrief[]) => Promise<BrandBrief[]>;
  /** Toggle enabled state cho 1 URL brief (parent persist + update state). */
  onToggleUrlBrief: (id: string, enabled: boolean) => Promise<void>;
  /** Bulk enable/disable tất cả URL briefs. */
  onSetAllUrlBriefsEnabled: (mode: UrlCrawlEnable) => Promise<void>;
  /** Wipe hết URL briefs (dùng cho Reset). */
  onClearAllUrlBriefs: () => Promise<void>;
  /** Update 1 URL brief (từ edit modal). */
  onUpdateUrlBrief?: (id: string, patch: Partial<BrandBrief>) => Promise<void>;
  /** Xoá 1 URL brief cá nhân. */
  onDeleteUrlBrief?: (id: string) => Promise<void>;

  onSaveSnippet?: (content: string) => void;
  onOpenLibrary?: () => void;
  onNavigateToBrandStyle?: (page: AppPage) => void;

  maxContents?: number;
  onClose: () => void;
}

export const MultiContentModal: React.FC<Props> = ({
  contents, onChangeContents,
  allBriefs, enabledBriefIds, onChangeEnabledBriefIds, onDeleteBrief, onUpdateBrandBrief,
  urlBriefs, enabledUrlBriefIds,
  onUrlCrawlComplete, onToggleUrlBrief, onSetAllUrlBriefsEnabled, onClearAllUrlBriefs,
  onUpdateUrlBrief, onDeleteUrlBrief,
  onSaveSnippet, onOpenLibrary, onNavigateToBrandStyle,
  maxContents = 5,
  onClose,
}) => {
  const [focused, setFocused] = useState<number | null>(null);

  // Brief đang được edit (mở BriefEditModal). {brief, source} để biết
  // dùng service brand hay URL.
  const [editingBrief, setEditingBrief] = useState<{ brief: BrandBrief; source: 'brand' | 'url' } | null>(null);

  // URL crawl state — local to modal.
  const [url, setUrl] = useState('');
  const [crawling, setCrawling] = useState(false);
  const [crawlPhase, setCrawlPhase] = useState<string>('');
  const [crawlError, setCrawlError] = useState<string | null>(null);

  const setContent = (idx: number, v: string) => {
    onChangeContents(contents.map((c, i) => (i === idx ? v : c)));
  };
  const addContent = () => {
    if (contents.length >= maxContents) return;
    onChangeContents([...contents, '']);
    setFocused(contents.length);
  };
  const removeContent = (idx: number) => {
    onChangeContents(contents.filter((_, i) => i !== idx));
  };

  const toggleBrief = (id: string) => {
    const next = new Set(enabledBriefIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChangeEnabledBriefIds(next);
  };
  const enableAllBriefs = () => onChangeEnabledBriefIds(new Set(allBriefs.map(b => b.id)));
  const clearBriefs     = () => onChangeEnabledBriefIds(new Set());

  const toggleUrlBrief = async (id: string) => {
    const nextEnabled = !enabledUrlBriefIds.has(id);
    try {
      await onToggleUrlBrief(id, nextEnabled);
    } catch (e: any) {
      console.warn('toggleUrlBrief failed', e);
    }
  };
  const enableAllUrlBriefs = async () => {
    try { await onSetAllUrlBriefsEnabled('all'); } catch (e) { console.warn('enableAllUrlBriefs failed', e); }
  };
  const clearUrlBriefs = async () => {
    try { await onSetAllUrlBriefsEnabled('none'); } catch (e) { console.warn('clearUrlBriefs failed', e); }
  };

  const handleCrawl = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!/^https?:\/\//i.test(trimmed)) {
      setCrawlError('URL phải bắt đầu bằng http:// hoặc https://');
      return;
    }

    setCrawlError(null);
    setCrawling(true);

    try {
      setCrawlPhase('Đang crawl URL...');
      const scrape = await scrapeUrl(trimmed);

      setCrawlPhase('Đang tóm tắt brand/USP...');
      const summary = await summarizeContent(scrape.markdown);

      setCrawlPhase('Đang sinh 10 briefs...');
      const raw = await generateBriefs(summary);

      setCrawlPhase('Đang lưu Supabase...');
      await onUrlCrawlComplete(trimmed, raw);

      setCrawlPhase('');
    } catch (e: any) {
      setCrawlError(e?.message || 'Crawl thất bại');
      setCrawlPhase('');
    } finally {
      setCrawling(false);
    }
  };

  const clearUrlBriefsAll = async () => {
    try {
      await onClearAllUrlBriefs();
      setUrl('');
    } catch (e: any) {
      console.warn('clearUrlBriefsAll failed', e);
    }
  };

  const nonEmptyManual   = contents.filter(c => c.trim()).length;
  const enabledBriefCnt  = enabledBriefIds.size;
  const enabledUrlCnt    = enabledUrlBriefIds.size;
  const totalVariants    = nonEmptyManual + enabledBriefCnt + enabledUrlCnt;

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
              <ListPlus size={14} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-fg">Biến thể nội dung</h3>
              <p className="text-[11px] text-subtle">
                Manual + brand briefs + URL crawl briefs. Số bản/biến thể ở panel Đầu ra.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-raised text-muted hover:text-fg">
            <X size={14} />
          </button>
        </header>

        <div className="px-5 py-3 border-b border-line bg-canvas/50 flex items-center justify-between">
          <span className="text-xs text-fg font-medium">
            Tổng <span className="text-brand">{totalVariants}</span> biến thể ·{' '}
            <span className="text-muted">{nonEmptyManual} tay + {enabledBriefCnt} brief + {enabledUrlCnt} URL</span>
          </span>
          {onOpenLibrary && (
            <button
              onClick={onOpenLibrary}
              className="text-[11px] flex items-center gap-1 text-muted hover:text-fg hover:underline"
            >
              <FolderOpen size={11} /> Thư viện nội dung
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* ─── Manual ─── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-subtle uppercase tracking-wider">
                Nội dung tay ({nonEmptyManual}/{maxContents})
              </p>
            </div>
            {contents.map((c, idx) => (
              <div
                key={idx}
                className={`relative rounded-md border transition-colors ${
                  focused === idx ? 'border-brand bg-brand/5' : 'border-line bg-canvas hover:bg-raised/40'
                }`}
              >
                <textarea
                  autoFocus={focused === idx}
                  value={c}
                  onChange={(e) => setContent(idx, e.target.value)}
                  onFocus={() => setFocused(idx)}
                  onBlur={() => setFocused(null)}
                  placeholder={`Nội dung #${idx + 1} — VD: 'Hè rực rỡ, Sale 50%'`}
                  className="w-full bg-transparent px-3 py-2.5 pr-16 text-sm text-fg focus:outline-none rounded-md resize-none h-16"
                />
                <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5">
                  <span className="text-[10px] text-subtle font-mono bg-surface border border-line px-1.5 py-0.5 rounded">
                    #{idx + 1}
                  </span>
                  {onSaveSnippet && (
                    <button
                      onClick={() => onSaveSnippet(c)}
                      disabled={!c.trim()}
                      className="p-1 text-muted hover:text-success disabled:opacity-30 disabled:hover:text-muted"
                      title="Lưu vào thư viện"
                    >
                      <Save size={11} />
                    </button>
                  )}
                  {contents.length > 1 && (
                    <button
                      onClick={() => removeContent(idx)}
                      className="p-1 text-muted hover:text-danger"
                      title="Xoá biến thể"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            <button
              onClick={addContent}
              disabled={contents.length >= maxContents}
              className="w-full text-xs py-2 rounded-md border border-dashed border-line-strong text-muted hover:border-brand/60 hover:text-brand hover:bg-brand/5 flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={12} /> Thêm nội dung tay
              <span className="text-[10px] text-subtle font-mono">
                {contents.length}/{maxContents}
              </span>
            </button>
          </section>

          {/* ─── URL Crawl briefs (đặt TRÊN Brand briefs — tick vào là hiện
                phía trên khu vực brand briefs). Persist trong localStorage
                nên nguồn URL vẫn còn sau reload. ─── */}
          <section className="space-y-2 border-t border-line pt-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-subtle uppercase tracking-wider flex items-center gap-1.5">
                <LinkIcon size={11} className="text-info" />
                URL Crawl briefs ({enabledUrlCnt}/{urlBriefs.length})
                <span className="text-[9px] font-normal text-subtle italic">đã lưu localStorage</span>
              </p>
              {urlBriefs.length > 0 && (
                <div className="flex items-center gap-2 text-[10px]">
                  <button
                    onClick={enableAllUrlBriefs}
                    disabled={enabledUrlCnt === urlBriefs.length}
                    className="text-brand hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    Tất cả
                  </button>
                  <span className="text-subtle">·</span>
                  <button
                    onClick={clearUrlBriefs}
                    disabled={enabledUrlCnt === 0}
                    className="text-muted hover:text-fg hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    Bỏ hết
                  </button>
                  <span className="text-subtle">·</span>
                  <button
                    onClick={clearUrlBriefsAll}
                    className="text-muted hover:text-danger hover:underline"
                    title="Xoá tất cả URL briefs + input"
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>

            {/* URL input + Crawl button */}
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setCrawlError(null); }}
                placeholder="https://landing-page.com/promo"
                disabled={crawling}
                className="flex-1 text-xs bg-canvas border border-line rounded-md px-3 py-2 text-fg focus:outline-none focus:border-brand disabled:opacity-50"
              />
              <button
                onClick={handleCrawl}
                disabled={crawling || !url.trim()}
                className="text-xs px-3 py-2 rounded-md bg-brand hover:bg-brand-dark disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium flex items-center gap-1.5"
              >
                {crawling ? <Loader2 size={12} className="animate-spin" /> : <LinkIcon size={12} />}
                {crawling ? 'Crawling...' : 'Crawl'}
              </button>
            </div>

            {crawlPhase && (
              <div className="text-[11px] text-brand bg-brand/5 border border-brand/20 rounded px-2 py-1.5 flex items-center gap-1.5">
                <Loader2 size={11} className="animate-spin" /> {crawlPhase}
              </div>
            )}

            {crawlError && (
              <div className="text-[11px] text-danger bg-danger-soft border border-danger-fg/30 rounded px-2 py-1.5 flex items-start gap-1.5">
                <AlertCircle size={11} className="shrink-0 mt-0.5" />
                <span className="whitespace-pre-wrap">{crawlError}</span>
              </div>
            )}

            {urlBriefs.length === 0 && !crawling && !crawlError && (
              <p className="text-[11px] text-subtle italic">
                Paste URL landing page → hệ thống scrape + AI sinh 10 briefs tick chọn cho gen này. Lưu tự động localStorage.
              </p>
            )}

            {urlBriefs.length > 0 && (
              <>
                {(() => {
                  // Nguồn URL: lấy từ brief đầu tiên (tất cả cùng 1 crawl).
                  const src = urlBriefs[0]?.sourceUrl;
                  const crawledAt = urlBriefs[0]?.createdAt;
                  if (!src) return null;
                  let hostname = src;
                  try { hostname = new URL(src).hostname; } catch {}
                  const rel = crawledAt ? relativeTime(crawledAt) : '';
                  return (
                    <div className="flex items-center gap-2 text-[10px] text-muted bg-info-soft border border-info-fg/30 rounded px-2 py-1">
                      <LinkIcon size={9} className="text-info shrink-0" />
                      <span className="truncate flex-1 min-w-0">
                        <b>Nguồn:</b> {hostname}
                        {rel && <span className="text-subtle ml-1.5">· {rel}</span>}
                      </span>
                      <a
                        href={src}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-info hover:underline"
                        title={src}
                      >
                        mở →
                      </a>
                    </div>
                  );
                })()}
                <div className="space-y-1">
                  {urlBriefs.map(b => (
                    <BriefCard
                      key={b.id}
                      brief={b}
                      on={enabledUrlBriefIds.has(b.id)}
                      onToggle={() => toggleUrlBrief(b.id)}
                      onEdit={onUpdateUrlBrief ? () => setEditingBrief({ brief: b, source: 'url' }) : undefined}
                      onDelete={onDeleteUrlBrief ? () => onDeleteUrlBrief(b.id) : undefined}
                      accent="info"
                    />
                  ))}
                </div>
              </>
            )}
          </section>

          {/* ─── Brand briefs (giờ nằm phía dưới URL Crawl) ─── */}
          <section className="space-y-2 border-t border-line pt-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-subtle uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles size={11} className="text-brand" />
                Brand briefs ({enabledBriefCnt}/{allBriefs.length})
              </p>
              {allBriefs.length > 0 && (
                <div className="flex items-center gap-2 text-[10px]">
                  <button
                    onClick={enableAllBriefs}
                    disabled={enabledBriefCnt === allBriefs.length}
                    className="text-brand hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    Tất cả
                  </button>
                  <span className="text-subtle">·</span>
                  <button
                    onClick={clearBriefs}
                    disabled={enabledBriefCnt === 0}
                    className="text-muted hover:text-fg hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    Bỏ hết
                  </button>
                  {onNavigateToBrandStyle && (
                    <>
                      <span className="text-subtle">·</span>
                      <button
                        onClick={() => { onClose(); onNavigateToBrandStyle('brand-style'); }}
                        className="text-muted hover:text-fg hover:underline"
                        title="Sửa nội dung brief"
                      >
                        ✎ Sửa
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {allBriefs.length === 0 ? (
              <div className="text-center py-4 text-[11px] text-subtle italic border border-dashed border-line rounded-md">
                Brand này chưa có brief. Dùng URL Crawl phía trên hoặc tạo trong Brand Style.
              </div>
            ) : (
              <div className="space-y-1">
                {allBriefs.map(b => (
                  <BriefCard
                    key={b.id}
                    brief={b}
                    on={enabledBriefIds.has(b.id)}
                    onToggle={() => toggleBrief(b.id)}
                    onDelete={onDeleteBrief ? () => onDeleteBrief(b.id) : undefined}
                    onEdit={onUpdateBrandBrief ? () => setEditingBrief({ brief: b, source: 'brand' }) : undefined}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <footer className="px-5 py-3 border-t border-line bg-surface flex items-center justify-between">
          <p className="text-[11px] text-subtle">Áp dụng ngay — không cần Save</p>
          <button
            onClick={onClose}
            className="text-sm px-4 py-1.5 rounded-lg bg-brand hover:bg-brand-dark text-white font-semibold"
          >
            Xong
          </button>
        </footer>
      </div>

      {/* Brief edit modal — hiện khi user click nút Sửa trên brief card */}
      {editingBrief && (
        <BriefEditModal
          brief={editingBrief.brief}
          accent={editingBrief.source === 'url' ? 'info' : 'brand'}
          onSave={async (id, patch) => {
            if (editingBrief.source === 'url' && onUpdateUrlBrief) {
              await onUpdateUrlBrief(id, patch);
            } else if (editingBrief.source === 'brand' && onUpdateBrandBrief) {
              await onUpdateBrandBrief(id, patch);
            }
          }}
          onClose={() => setEditingBrief(null)}
        />
      )}
    </div>
  );
};

// ─── Shared brief card ───

const BriefCard: React.FC<{
  brief: BrandBrief;
  on: boolean;
  onToggle: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
  accent?: 'brand' | 'info';
}> = ({ brief: b, on, onToggle, onDelete, onEdit, accent = 'brand' }) => {
  // Selected style: thicker border + ring + shadow → tương phản mạnh khi picked
  const activeStyle = accent === 'info'
    ? 'bg-info-soft border-info border-2 ring-2 ring-info/30 shadow-md shadow-info/10'
    : 'bg-brand/10 border-brand border-2 ring-2 ring-brand/30 shadow-md shadow-brand/10';
  const activeIcon  = accent === 'info' ? 'bg-info text-white' : 'bg-brand text-white';

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDelete) return;
    onDelete();
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onEdit) return;
    onEdit();
  };

  return (
    <div
      className={`group w-full rounded-md transition-all flex items-start gap-2 p-2 ${
        on ? activeStyle : 'bg-canvas border border-line hover:bg-raised hover:border-line-strong'
      }`}
    >
      <button
        onClick={onToggle}
        className="flex-1 min-w-0 flex items-start gap-2 text-left"
      >
        <span className={`shrink-0 mt-0.5 w-5 h-5 rounded flex items-center justify-center transition-transform ${
          on ? `${activeIcon} scale-110` : 'border border-line bg-surface'
        }`}>
          {on && <CheckCircle size={13} strokeWidth={2.5} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className={`text-[12px] leading-tight truncate ${
              on ? 'font-semibold text-fg' : 'font-medium text-fg'
            }`}>{b.title}</p>
            <span className={`text-[9px] font-mono uppercase px-1 py-px rounded shrink-0 ${
              on
                ? (accent === 'info' ? 'bg-info text-white' : 'bg-brand text-white')
                : 'text-subtle bg-raised border border-line'
            }`}>
              {TYPE_ABBR[b.briefType] || b.briefType}
            </span>
          </div>
          {b.headline && (
            <p className={`text-[11px] leading-snug line-clamp-1 mt-0.5 ${
              on ? 'text-fg/90' : 'text-fg/70'
            }`}>
              <span className="text-subtle font-mono mr-1">H:</span>{b.headline}
            </p>
          )}
        </div>
      </button>
      <div className="shrink-0 flex items-center gap-0.5">
        {onEdit && (
          <button
            onClick={handleEdit}
            className={`p-1 rounded text-muted hover:text-brand hover:bg-brand/10 transition-opacity ${
              on ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            title="Sửa brief (chỉnh tay hoặc AI regen)"
          >
            <Pencil size={11} />
          </button>
        )}
        {onDelete && (
        <button
          onClick={handleDelete}
          className="p-1 rounded text-muted hover:text-danger hover:bg-danger-soft opacity-0 group-hover:opacity-100 transition-opacity"
          title="Xoá brief này khỏi brand"
        >
          <Trash2 size={11} />
        </button>
      )}
      </div>
    </div>
  );
};
