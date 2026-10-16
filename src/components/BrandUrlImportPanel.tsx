// URL Import section embedded inside BrandEditor — scrapes a landing page,
// summarizes, generates 10 banner briefs, and lets user pick / edit / save.

import React, { useEffect, useState } from 'react';
import {
  Globe, Loader2, AlertCircle, Sparkles, RefreshCw, Trash2, Edit3, Save, X,
  CheckCircle, Tag, Download, ChevronDown,
} from 'lucide-react';
import { BrandProject, BrandBrief, BriefType, ScrapedSummary } from '../types';
import {
  scrapeUrl, summarizeContent, generateBriefs,
  TYPE_LABEL_VI, BRIEF_TYPES,
} from '../services/contentImportService';
import {
  listBriefsForBrand, replaceBriefsForBrand, toggleBriefSelected,
  updateBrief, deleteBrief,
} from '../services/brandBriefService';
import { exportBriefs } from '../services/briefExportService';

const MAX_SELECTED = 5;

interface Props {
  draft: BrandProject;
  onChange: (patch: Partial<BrandProject>) => void;
}

export const BrandUrlImportPanel: React.FC<Props> = ({ draft, onChange }) => {
  const [url, setUrl] = useState(draft.scrapedUrl || '');
  const [busy, setBusy] = useState<'idle' | 'scraping' | 'summarizing' | 'generating' | 'saving'>('idle');
  const [phase, setPhase] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [briefs, setBriefs] = useState<BrandBrief[]>([]);
  const [editing, setEditing] = useState<BrandBrief | null>(null);

  // Load existing briefs whenever brand id changes.
  useEffect(() => {
    if (!draft.id) return;
    listBriefsForBrand(draft.id).then(setBriefs).catch(() => setBriefs([]));
  }, [draft.id]);

  const selectedCount = briefs.filter(b => b.isSelected).length;

  const handleImport = async () => {
    if (!url.trim()) { setError('Nhập URL'); return; }
    if (!draft.id) { setError('Lưu brand trước khi import URL'); return; }
    setError(null);

    try {
      setBusy('scraping');
      setPhase('Firecrawl đang scrape page...');
      const scrape = await scrapeUrl(url.trim());

      setBusy('summarizing');
      setPhase('Coachio LLM tóm tắt nội dung...');
      const summary = await summarizeContent(scrape.markdown);
      onChange({
        scrapedUrl: scrape.url,
        scrapedSummary: summary,
        scrapedAt: Date.now(),
      });

      setBusy('generating');
      setPhase('LLM tạo 10 briefs đa template...');
      const raw = await generateBriefs(summary);

      setBusy('saving');
      setPhase('Lưu vào DB...');
      const saved = await replaceBriefsForBrand(draft.id, raw, scrape.url);
      setBriefs(saved);
      setPhase('Hoàn tất.');
    } catch (e: any) {
      setError(e?.message || 'Import lỗi');
    } finally {
      setBusy('idle');
    }
  };

  const handleRegen = async () => {
    if (!draft.scrapedSummary) { setError('Chưa có summary — bấm Import trước'); return; }
    if (!draft.id) return;
    if (briefs.some(b => b.isSelected)) {
      if (!confirm(`Regen sẽ XOÁ ${briefs.length} brief hiện tại (kể cả ${selectedCount} cái đã chọn). Tiếp tục?`)) return;
    }
    setError(null);
    try {
      setBusy('generating');
      setPhase('LLM tạo 10 briefs mới...');
      const raw = await generateBriefs(draft.scrapedSummary);
      const saved = await replaceBriefsForBrand(draft.id, raw, draft.scrapedUrl || '');
      setBriefs(saved);
      setPhase('Hoàn tất.');
    } catch (e: any) {
      setError(e?.message || 'Regen lỗi');
    } finally {
      setBusy('idle');
    }
  };

  const handleToggleSelect = async (brief: BrandBrief) => {
    const newValue = !brief.isSelected;
    if (newValue && selectedCount >= MAX_SELECTED) {
      setError(`Tối đa ${MAX_SELECTED} briefs — bỏ chọn 1 cái trước.`);
      return;
    }
    setError(null);
    // Optimistic update
    setBriefs(prev => prev.map(b => b.id === brief.id ? { ...b, isSelected: newValue } : b));
    try {
      await toggleBriefSelected(brief.id, newValue);
    } catch (e: any) {
      setBriefs(prev => prev.map(b => b.id === brief.id ? { ...b, isSelected: !newValue } : b));
      setError(`Toggle lỗi: ${e?.message || e}`);
    }
  };

  const handleDeleteBrief = async (brief: BrandBrief) => {
    if (!confirm(`Xoá brief "${brief.title}"?`)) return;
    try {
      await deleteBrief(brief.id);
      setBriefs(prev => prev.filter(b => b.id !== brief.id));
    } catch (e: any) {
      setError(`Xoá lỗi: ${e?.message || e}`);
    }
  };

  return (
    <section className="bg-surface border border-line rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg flex items-center gap-2">
          <Globe size={14} className="text-info" /> Import từ URL
        </h3>
        {briefs.length > 0 && (
          <span className="text-[11px] font-mono text-muted">
            {briefs.length} briefs · {selectedCount}/{MAX_SELECTED} chọn
          </span>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://landing-page.com/khoa-hoc-ai"
            className="flex-1 bg-canvas border border-line rounded-md px-3 py-2 text-sm focus:outline-none focus:border-brand"
            disabled={busy !== 'idle'}
          />
          <button
            onClick={handleImport}
            disabled={busy !== 'idle' || !url.trim()}
            className="text-sm bg-brand hover:bg-brand-dark text-white px-4 py-2 rounded-md font-semibold flex items-center gap-1.5 disabled:opacity-50"
          >
            {busy !== 'idle' ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
            {busy === 'idle' ? 'Import' : 'Đang xử lý'}
          </button>
        </div>
        {phase && busy !== 'idle' && (
          <p className="text-[11px] text-muted">{phase}</p>
        )}
        <p className="text-[10px] text-subtle">
          Firecrawl scrape → Coachio LLM tóm tắt + tạo 10 briefs (~10-30s).
          Mỗi import overwrite briefs cũ.
        </p>
      </div>

      {error && (
        <div className="status-danger border text-xs px-3 py-2 rounded-lg flex items-center gap-2">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {/* Summary display */}
      {draft.scrapedSummary && (
        <details className="bg-raised/40 border border-line rounded-lg overflow-hidden">
          <summary className="px-3 py-2 cursor-pointer text-xs font-medium text-fg hover:bg-raised/60">
            <span className="flex items-center gap-2">
              <CheckCircle size={11} className="text-success" />
              Summary từ URL{draft.scrapedAt ? ` (${new Date(draft.scrapedAt).toLocaleString('vi-VN')})` : ''}
            </span>
          </summary>
          <div className="p-3 border-t border-line text-[11px] space-y-1.5">
            <SummaryField label="Brand"            value={draft.scrapedSummary.brand} />
            <SummaryField label="Product"          value={draft.scrapedSummary.product} />
            <SummaryField label="USP"              value={draft.scrapedSummary.usp} />
            <SummaryField label="Target audience"  value={draft.scrapedSummary.target_audience} />
            <SummaryField label="Tone of voice"    value={draft.scrapedSummary.tone_of_voice} />
            <SummaryListField label="Offerings"    items={draft.scrapedSummary.key_offerings} />
            <SummaryListField label="Notable"      items={draft.scrapedSummary.notable_elements} />
          </div>
        </details>
      )}

      {/* Briefs grid */}
      {briefs.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-fg">
              {briefs.length} briefs — chọn tối đa {MAX_SELECTED}
            </p>
            <div className="flex items-center gap-1.5">
              <ExportMenu
                briefs={briefs}
                sourceLabel={draft.name || draft.scrapedUrl}
              />
              <button
                onClick={handleRegen}
                disabled={busy !== 'idle'}
                className="text-xs text-muted hover:text-fg flex items-center gap-1 border border-line rounded px-2 py-1 hover:bg-raised disabled:opacity-50"
              >
                {busy === 'generating' ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                Regen tất cả
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {briefs.map(b => (
              <BriefCard
                key={b.id}
                brief={b}
                onToggle={() => handleToggleSelect(b)}
                onEdit={() => setEditing(b)}
                onDelete={() => handleDeleteBrief(b)}
                selectedCount={selectedCount}
              />
            ))}
          </div>
        </div>
      )}

      {editing && (
        <BriefEditModal
          brief={editing}
          onClose={() => setEditing(null)}
          onSaved={(patch) => {
            setBriefs(prev => prev.map(b => b.id === editing.id ? { ...b, ...patch } : b));
            setEditing(null);
          }}
        />
      )}
    </section>
  );
};

// ─────────────────── Brief card ───────────────────

// (Legacy palette removed — angle is now free-form. Chip uses a neutral style.)

const BriefCard: React.FC<{
  brief: BrandBrief;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  selectedCount: number;
}> = ({ brief, onToggle, onEdit, onDelete, selectedCount }) => {
  const blockedFromSelect = !brief.isSelected && selectedCount >= MAX_SELECTED;
  return (
    <div className={`border rounded-lg p-2.5 space-y-1.5 transition-colors ${
      brief.isSelected ? 'border-brand bg-brand/5' : 'border-line bg-canvas'
    }`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-raised text-muted border-line" title={`Angle: ${brief.briefType}`}>
          <Tag size={9} className="inline -mt-0.5 mr-0.5" /> {TYPE_LABEL_VI[brief.briefType] || brief.briefType}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={onEdit} className="text-muted hover:text-fg p-1 rounded hover:bg-raised" title="Sửa">
            <Edit3 size={11} />
          </button>
          <button onClick={onDelete} className="text-muted hover:text-danger p-1 rounded hover:bg-danger-soft" title="Xoá">
            <Trash2 size={11} />
          </button>
        </div>
      </div>
      <p className="text-sm font-semibold text-fg leading-snug" title={brief.title}>{brief.title}</p>
      {brief.headline && (
        <p className="text-[13px] font-bold text-fg leading-tight" title={brief.headline}>
          {brief.headline}
        </p>
      )}
      {brief.subline && (
        <p className="text-[11px] text-fg/75 italic line-clamp-1 leading-snug">{brief.subline}</p>
      )}
      {brief.primaryText && (
        <p className="text-[11px] text-muted line-clamp-2 leading-snug">{brief.primaryText}</p>
      )}
      {Array.isArray(brief.badges) && brief.badges.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {brief.badges.slice(0, 3).map((b, i) => (
            <span key={i} className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand/15 text-brand border border-brand/30">
              {b}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between pt-1 border-t border-line/50">
        <span className="text-[10px] font-mono text-subtle" title={`Angle: ${brief.briefType}`}>
          {brief.ctaText ? `→ ${brief.ctaText}` : `CTA: ${brief.cta || '—'}`}
        </span>
        <button
          onClick={onToggle}
          disabled={blockedFromSelect}
          className={`text-[11px] px-2.5 py-1 rounded-md font-medium flex items-center gap-1 ${
            brief.isSelected
              ? 'bg-brand text-white'
              : blockedFromSelect
                ? 'bg-raised text-subtle cursor-not-allowed'
                : 'bg-canvas border border-line hover:bg-raised text-fg'
          }`}
          title={blockedFromSelect ? `Tối đa ${MAX_SELECTED} briefs đã đầy` : ''}
        >
          {brief.isSelected ? <CheckCircle size={11} /> : null}
          {brief.isSelected ? 'Đã chọn' : 'Chọn'}
        </button>
      </div>
    </div>
  );
};

// ─────────────────── Brief edit modal ───────────────────

const VALID_CTAS = [
  'SHOP_NOW', 'LEARN_MORE', 'SIGN_UP', 'BUY_NOW', 'BOOK_TRAVEL',
  'DOWNLOAD', 'CONTACT_US', 'GET_QUOTE', 'MESSAGE_PAGE', 'SUBSCRIBE',
  'WATCH_MORE', 'GET_OFFER', 'INSTALL_MOBILE_APP', 'NO_BUTTON',
];

const BriefEditModal: React.FC<{
  brief: BrandBrief;
  onClose: () => void;
  onSaved: (patch: Partial<BrandBrief>) => void;
}> = ({ brief, onClose, onSaved }) => {
  const [title, setTitle] = useState(brief.title);
  const [briefType, setBriefType] = useState<BriefType>(brief.briefType);
  const [primaryMessage, setPrimaryMessage] = useState(brief.primaryMessage || '');
  const [headline, setHeadline] = useState(brief.headline || '');
  const [subline, setSubline] = useState(brief.subline || '');
  const [primaryText, setPrimaryText] = useState(brief.primaryText || '');
  const [cta, setCta] = useState(brief.cta || 'LEARN_MORE');
  const [ctaText, setCtaText] = useState(brief.ctaText || '');
  const [badgesText, setBadgesText] = useState((brief.badges || []).join('\n'));
  const [toneNotes, setToneNotes] = useState(brief.toneNotes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const badges = badgesText.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 3);
      const patch = { title, briefType, primaryMessage, headline, subline, primaryText, cta, ctaText, badges, toneNotes };
      await updateBrief(brief.id, patch);
      onSaved(patch);
    } catch (e: any) {
      setError(e?.message || 'Save lỗi');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-canvas border border-line rounded-2xl w-full max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-3 border-b border-line bg-surface flex items-center justify-between">
          <h3 className="text-sm font-semibold text-fg">Sửa brief</h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-raised text-muted"><X size={14} /></button>
        </header>
        <div className="p-5 space-y-3">
          <Field label="Angle (slug)">
            <input type="text" value={briefType} onChange={(e) => setBriefType(e.target.value)}
              placeholder="pain-solo-overload / myth-bust-video / outcome-cost-saving"
              className="w-full bg-canvas border border-line rounded-md px-3 py-2 text-sm font-mono" />
          </Field>
          <Field label="Title *">
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-canvas border border-line rounded-md px-3 py-2 text-sm" />
          </Field>
          <Field label="Headline (INSIGHT / PAIN / OUTCOME · có brand keyword)">
            <input type="text" value={headline} onChange={(e) => setHeadline(e.target.value)}
              placeholder="VD: VẬN HÀNH MARKETING 1 NGƯỜI · VỚI AI AGENT"
              className="w-full bg-canvas border border-line rounded-md px-3 py-2 text-sm font-semibold" />
          </Field>
          <Field label="Subline (10-15 từ giải nghĩa headline)">
            <input type="text" value={subline} onChange={(e) => setSubline(e.target.value)}
              className="w-full bg-canvas border border-line rounded-md px-3 py-2 text-sm" />
          </Field>
          <Field label="Body (30-60 từ, pain → giải pháp brand → con số)">
            <textarea value={primaryText} onChange={(e) => setPrimaryText(e.target.value)} rows={3}
              className="w-full bg-canvas border border-line rounded-md px-3 py-2 text-sm resize-none" />
          </Field>
          <Field label="Primary message (optional)">
            <textarea value={primaryMessage} onChange={(e) => setPrimaryMessage(e.target.value)} rows={2}
              className="w-full bg-canvas border border-line rounded-md px-3 py-2 text-sm resize-none" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="CTA text (nút VN)">
              <input type="text" value={ctaText} onChange={(e) => setCtaText(e.target.value)}
                placeholder="Giữ chỗ miễn phí"
                className="w-full bg-canvas border border-line rounded-md px-3 py-2 text-sm" />
            </Field>
            <Field label="CTA code (Meta)">
              <select value={cta} onChange={(e) => setCta(e.target.value)}
                className="w-full bg-canvas border border-line rounded-md px-3 py-2 text-sm">
                {VALID_CTAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Badges (chip trên banner · mỗi dòng 1 badge · max 3)">
            <textarea value={badgesText} onChange={(e) => setBadgesText(e.target.value)} rows={3}
              placeholder={'MIỄN PHÍ · 20 SUẤT CUỐI\n15/08 · 14H\n300K+ COMMUNITY'}
              className="w-full bg-canvas border border-line rounded-md px-3 py-2 text-sm resize-none font-mono" />
          </Field>
          <Field label="Tone notes (visual + composition)">
            <input type="text" value={toneNotes} onChange={(e) => setToneNotes(e.target.value)}
              className="w-full bg-canvas border border-line rounded-md px-3 py-2 text-sm" />
          </Field>
          {error && <div className="status-danger border text-xs px-3 py-2 rounded-lg">{error}</div>}
        </div>
        <footer className="px-5 py-3 border-t border-line bg-surface flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg bg-canvas border border-line text-fg">Huỷ</button>
          <button onClick={save} disabled={saving}
            className="text-sm px-4 py-1.5 rounded-lg bg-brand text-white font-semibold flex items-center gap-1.5 disabled:opacity-50">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save
          </button>
        </footer>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="text-[11px] font-medium text-muted block mb-1">{label}</label>
    {children}
  </div>
);

const SummaryField: React.FC<{ label: string; value?: string }> = ({ label, value }) => {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted shrink-0 w-28">{label}:</span>
      <span className="text-fg/90 flex-1">{value}</span>
    </div>
  );
};

const SummaryListField: React.FC<{ label: string; items?: string[] }> = ({ label, items }) => {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted shrink-0 w-28">{label}:</span>
      <ul className="text-fg/90 flex-1 list-disc list-inside space-y-0.5">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
};

// ─────────────────── Export menu ───────────────────

const ExportMenu: React.FC<{ briefs: BrandBrief[]; sourceLabel?: string }> = ({ briefs, sourceLabel }) => {
  const [open, setOpen] = useState(false);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const off = () => setOpen(false);
    document.addEventListener('click', off);
    return () => document.removeEventListener('click', off);
  }, [open]);

  const doExport = (format: 'csv' | 'md' | 'json') => {
    exportBriefs({ briefs, format, sourceLabel });
    setOpen(false);
  };

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        className="text-xs text-muted hover:text-fg flex items-center gap-1 border border-line rounded px-2 py-1 hover:bg-raised"
        title={`Export ${briefs.length} briefs`}
      >
        <Download size={11} /> Export
        <ChevronDown size={10} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-canvas border border-line rounded-md shadow-pop min-w-[180px] overflow-hidden">
          <button
            onClick={() => doExport('csv')}
            className="w-full text-left px-3 py-2 text-xs hover:bg-raised flex items-center justify-between gap-2"
          >
            <span><span className="font-mono text-brand mr-1.5">.csv</span> Excel / Google Sheets</span>
          </button>
          <button
            onClick={() => doExport('md')}
            className="w-full text-left px-3 py-2 text-xs hover:bg-raised flex items-center justify-between gap-2 border-t border-line"
          >
            <span><span className="font-mono text-brand mr-1.5">.md</span> Markdown (Notion / Claude)</span>
          </button>
          <button
            onClick={() => doExport('json')}
            className="w-full text-left px-3 py-2 text-xs hover:bg-raised flex items-center justify-between gap-2 border-t border-line"
          >
            <span><span className="font-mono text-brand mr-1.5">.json</span> JSON (agent / re-import)</span>
          </button>
        </div>
      )}
    </div>
  );
};
