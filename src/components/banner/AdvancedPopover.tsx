// Advanced settings popover — collapsed by default. Contains the Coachio
// model picker + banner type + optional JSON prompt guidance.

import React, { useState } from 'react';
import { ChevronDown, Cpu, Megaphone, Braces, Sparkles } from 'lucide-react';

interface CoachioModel {
  id: string;
  name: string;
}

interface BannerTypeOption {
  id: string;
  label: string;
}

interface Props {
  coachioModel: string;
  coachioModels: CoachioModel[];
  onChangeCoachioModel: (id: string) => void;

  bannerType: string;
  bannerTypeOptions: BannerTypeOption[];
  onChangeBannerType: (id: string) => void;

  /** Optional JSON prompt to inject as BRAND STYLE section vào gen prompt.
   *  Được auto-fill từ project.jsonPrompt khi user chọn brand — user vẫn
   *  edit thủ công được ở đây. */
  jsonPrompt?: string;
  onChangeJsonPrompt?: (v: string) => void;
  /** Nếu true, hint user rằng JSON đang auto từ brand (chưa override). */
  jsonFromBrand?: boolean;

  /** Start expanded or collapsed. Default false (collapsed). */
  defaultOpen?: boolean;
}

export const AdvancedPopover: React.FC<Props> = ({
  coachioModel, coachioModels, onChangeCoachioModel,
  bannerType, bannerTypeOptions, onChangeBannerType,
  jsonPrompt, onChangeJsonPrompt, jsonFromBrand,
  defaultOpen = false,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const activeModel = coachioModels.find(m => m.id === coachioModel)?.name;
  const activeType  = bannerTypeOptions.find(t => t.id === bannerType)?.label;
  const hasJson = !!(jsonPrompt && jsonPrompt.trim());

  return (
    <section className="space-y-2">
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border transition-colors text-left ${
          open ? 'bg-canvas border-line' : 'bg-canvas border-line hover:bg-raised'
        }`}
      >
        <span className="text-xs font-semibold text-subtle uppercase tracking-wider flex items-center gap-1.5">
          Advanced
          {hasJson && (
            <span className="text-[9px] font-normal normal-case bg-brand/15 text-brand border border-brand/30 rounded px-1 py-px flex items-center gap-0.5">
              <Braces size={9} /> JSON
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 text-[11px] text-muted">
          {!open && activeModel && (
            <span className="font-mono">
              {activeType ? `${activeType} · ${activeModel}` : activeModel}
            </span>
          )}
          <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="space-y-3 border border-line rounded-md p-3 bg-canvas/50">
          {/* Model */}
          <div>
            <label className="text-[10px] text-subtle uppercase tracking-wider block mb-1 flex items-center gap-1">
              <Cpu size={11} /> Model
            </label>
            <select
              value={coachioModel}
              onChange={(e) => onChangeCoachioModel(e.target.value)}
              className="w-full bg-canvas border border-line rounded-md px-2.5 py-2 text-sm text-fg focus:outline-none focus:border-brand"
            >
              {coachioModels.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          {/* Banner Type — only when the caller passes options (banner tool) */}
          {bannerTypeOptions.length > 0 && (
            <div>
              <label className="text-[10px] text-subtle uppercase tracking-wider block mb-1 flex items-center gap-1">
                <Megaphone size={11} /> Loại banner
              </label>
              <select
                value={bannerType}
                onChange={(e) => onChangeBannerType(e.target.value)}
                className="w-full bg-canvas border border-line rounded-md px-2.5 py-2 text-sm text-fg focus:outline-none focus:border-brand"
              >
                {bannerTypeOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* JSON Prompt — style guide dạng JSON nhét vào section BRAND STYLE */}
          {onChangeJsonPrompt && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-subtle uppercase tracking-wider flex items-center gap-1">
                  <Braces size={11} /> JSON Prompt (tuỳ chọn)
                </label>
                <div className="flex items-center gap-2 text-[10px]">
                  {jsonFromBrand && hasJson && (
                    <span className="text-brand flex items-center gap-0.5">
                      <Sparkles size={9} /> từ brand
                    </span>
                  )}
                  {hasJson && (
                    <button
                      onClick={() => onChangeJsonPrompt('')}
                      className="text-muted hover:text-danger hover:underline"
                    >
                      Xoá
                    </button>
                  )}
                </div>
              </div>
              <textarea
                value={jsonPrompt || ''}
                onChange={(e) => onChangeJsonPrompt(e.target.value)}
                placeholder={`VD:\n{\n  "style": "cozy, warm lighting",\n  "palette": ["#6B3410", "#F5E6D3"],\n  "mood": "inviting"\n}`}
                className="w-full bg-canvas border border-line rounded-md px-2.5 py-2 text-[11px] text-fg focus:outline-none focus:border-brand h-24 resize-none font-mono"
              />
              <p className="text-[10px] text-subtle mt-1 leading-tight">
                Được nhét vào section <b>BRAND STYLE (JSON)</b> của gen prompt. Không bắt buộc phải JSON valid — text thường cũng được.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
