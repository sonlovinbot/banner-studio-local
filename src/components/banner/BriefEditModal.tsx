// Popup edit cho từng brief (brand hoặc URL-crawl). Cho phép user:
//   - Sửa tay các field (title, headline, primary_text, CTA, tone, type)
//   - AI regen theo hint text — LLM sinh lại toàn bộ brief theo hướng user
//
// Persist qua handler onSave (parent quyết định gọi service brand hay URL).

import React, { useState } from 'react';
import { X, Save, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { BrandBrief, BriefType } from '../../types';
import { regenerateBrief, TYPE_LABEL_VI, BRIEF_TYPES } from '../../services/contentImportService';

const CTA_OPTIONS = [
  'SHOP_NOW', 'LEARN_MORE', 'SIGN_UP', 'BUY_NOW', 'BOOK_TRAVEL',
  'DOWNLOAD', 'CONTACT_US', 'GET_QUOTE', 'MESSAGE_PAGE', 'SUBSCRIBE',
  'WATCH_MORE', 'GET_OFFER', 'INSTALL_MOBILE_APP', 'NO_BUTTON',
];

interface Props {
  brief: BrandBrief;
  /** Persist patch to appropriate service (brand vs URL). */
  onSave: (id: string, patch: Partial<BrandBrief>) => Promise<void>;
  onClose: () => void;
  /** Accent: 'brand' cho brand briefs, 'info' cho URL crawl. */
  accent?: 'brand' | 'info';
}

export const BriefEditModal: React.FC<Props> = ({ brief, onSave, onClose, accent = 'brand' }) => {
  const [briefType, setBriefType] = useState<BriefType>(brief.briefType);
  const [title, setTitle] = useState(brief.title || '');
  const [headline, setHeadline] = useState(brief.headline || '');
  const [primaryText, setPrimaryText] = useState(brief.primaryText || '');
  const [cta, setCta] = useState(brief.cta || 'LEARN_MORE');
  const [toneNotes, setToneNotes] = useState(brief.toneNotes || '');

  const [aiHint, setAiHint] = useState('');
  const [aiRunning, setAiRunning] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const accentBtnBg = accent === 'info' ? 'bg-info hover:bg-info-fg' : 'bg-brand hover:bg-brand-dark';

  const handleAiRegen = async () => {
    setAiError(null);
    setAiRunning(true);
    try {
      const fresh = await regenerateBrief(
        { briefType, title, headline, primaryText, cta, toneNotes },
        aiHint,
      );
      // Merge — chỉ update field LLM có trả về, giữ nguyên field khác.
      if (fresh.brief_type) setBriefType(fresh.brief_type as BriefType);
      if (fresh.title)          setTitle(fresh.title);
      if (fresh.headline)       setHeadline(fresh.headline);
      if (fresh.primary_text)   setPrimaryText(fresh.primary_text);
      if (fresh.cta)            setCta(fresh.cta);
      if (fresh.tone_notes)     setToneNotes(fresh.tone_notes);
    } catch (e: any) {
      setAiError(e?.message || 'AI regen thất bại');
    } finally {
      setAiRunning(false);
    }
  };

  const handleSave = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      await onSave(brief.id, {
        briefType,
        title: title.trim(),
        headline: headline.trim(),
        primaryText: primaryText.trim(),
        cta: cta.trim(),
        toneNotes: toneNotes.trim(),
      });
      onClose();
    } catch (e: any) {
      setSaveError(e?.message || 'Lưu thất bại');
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-canvas border border-line rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-line bg-surface flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-md border ${
              accent === 'info' ? 'bg-info-soft border-info/40 text-info' : 'bg-brand/15 border-brand/30 text-brand'
            }`}>
              <Sparkles size={14} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-fg">Sửa brief</h3>
              <p className="text-[11px] text-subtle">Chỉnh tay hoặc để AI sửa lại theo hướng anh yêu cầu</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-raised text-muted hover:text-fg">
            <X size={14} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Type + CTA */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-subtle uppercase tracking-wider block mb-1">Type</label>
              <select
                value={briefType}
                onChange={(e) => setBriefType(e.target.value as BriefType)}
                className="w-full bg-canvas border border-line rounded-md px-2.5 py-2 text-xs text-fg focus:outline-none focus:border-brand"
              >
                {BRIEF_TYPES.map(t => (
                  <option key={t} value={t}>{t} — {TYPE_LABEL_VI[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-subtle uppercase tracking-wider block mb-1">CTA</label>
              <select
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                className="w-full bg-canvas border border-line rounded-md px-2.5 py-2 text-xs text-fg focus:outline-none focus:border-brand"
              >
                {CTA_OPTIONS.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="text-[10px] text-subtle uppercase tracking-wider block mb-1">Title (label UI)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: 30% Off First Order"
              className="w-full bg-canvas border border-line rounded-md px-2.5 py-2 text-sm text-fg focus:outline-none focus:border-brand"
            />
          </div>

          {/* Headline */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-subtle uppercase tracking-wider">
                Headline <span className="text-warning-fg">(3-7 từ, in HOA nhấn)</span>
              </label>
              <span className="text-[10px] text-muted font-mono">{headline.length} ký tự</span>
            </div>
            <input
              type="text"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="VD: GIẢM 50% HÔM NAY"
              className="w-full bg-canvas border border-line rounded-md px-2.5 py-2 text-sm text-fg focus:outline-none focus:border-brand"
            />
          </div>

          {/* Primary text */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-subtle uppercase tracking-wider">
                Primary text <span className="text-warning-fg">(30-80 từ, hook + CTA)</span>
              </label>
              <span className="text-[10px] text-muted font-mono">
                {primaryText.trim().split(/\s+/).filter(Boolean).length} từ
              </span>
            </div>
            <textarea
              value={primaryText}
              onChange={(e) => setPrimaryText(e.target.value)}
              placeholder="Hook đầu... Nội dung... CTA cuối."
              className="w-full bg-canvas border border-line rounded-md px-2.5 py-2 text-sm text-fg focus:outline-none focus:border-brand h-24 resize-none"
            />
          </div>

          {/* Tone */}
          <div>
            <label className="text-[10px] text-subtle uppercase tracking-wider block mb-1">
              Tone notes <span className="text-warning-fg">(phong cách + cảm xúc cho AI)</span>
            </label>
            <input
              type="text"
              value={toneNotes}
              onChange={(e) => setToneNotes(e.target.value)}
              placeholder="VD: urgent, khẩn cấp, con số bự, màu đỏ vàng"
              className="w-full bg-canvas border border-line rounded-md px-2.5 py-2 text-sm text-fg focus:outline-none focus:border-brand"
            />
          </div>

          {/* AI regen section */}
          <div className="border-t border-line pt-4">
            <label className="text-[11px] font-semibold text-brand uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Sparkles size={11} /> AI sửa lại
            </label>
            <p className="text-[11px] text-subtle leading-snug mb-2">
              Ghi hướng anh muốn AI sửa (VD: "làm ngắn hơn", "focus vào ưu đãi giá", "tone khẩn cấp hơn"). AI sẽ regen toàn bộ brief theo hướng đó — giữ nguyên type.
            </p>
            <div className="flex items-start gap-2">
              <textarea
                value={aiHint}
                onChange={(e) => setAiHint(e.target.value)}
                placeholder="VD: Ngắn hơn, thêm số cụ thể..."
                disabled={aiRunning}
                className="flex-1 bg-canvas border border-line rounded-md px-2.5 py-2 text-xs text-fg focus:outline-none focus:border-brand h-16 resize-none disabled:opacity-50"
              />
              <button
                onClick={handleAiRegen}
                disabled={aiRunning}
                className="shrink-0 text-xs bg-brand hover:bg-brand-dark disabled:opacity-40 text-white px-3 py-2 rounded-md font-medium flex items-center gap-1.5 h-16"
                title="Regen brief theo hint"
              >
                {aiRunning ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                <span className="text-[10px] leading-tight">{aiRunning ? 'Đang sinh...' : 'Sinh lại\nvới AI'}</span>
              </button>
            </div>
            {aiError && (
              <div className="text-[11px] text-danger bg-danger-soft border border-danger-fg/30 rounded px-2 py-1.5 mt-2 flex items-start gap-1.5">
                <AlertCircle size={11} className="shrink-0 mt-0.5" /> {aiError}
              </div>
            )}
          </div>

          {saveError && (
            <div className="text-[11px] text-danger bg-danger-soft border border-danger-fg/30 rounded px-2 py-1.5 flex items-start gap-1.5">
              <AlertCircle size={11} className="shrink-0 mt-0.5" /> {saveError}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-line bg-surface flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="text-sm px-4 py-1.5 rounded-lg bg-canvas border border-line hover:bg-raised text-fg"
          >
            Huỷ
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`text-sm px-4 py-1.5 rounded-lg text-white font-semibold flex items-center gap-1.5 ${accentBtnBg} disabled:opacity-50`}
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Lưu
          </button>
        </footer>
      </div>
    </div>
  );
};
