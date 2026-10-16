// Compact Output row — aspect ratio as multi-select button grid (user có thể
// chọn nhiều tỉ lệ cùng lúc để gen mỗi tỉ lệ 1 batch banner). Quality + Qty
// giữ nguyên single-select.

import React from 'react';
import { Sliders } from 'lucide-react';

interface Props {
  /** Set of selected aspect ratio strings. Ít nhất 1 phải chọn. */
  selectedAspectRatios: Set<string>;
  /** All aspect ratios available for the current model. */
  aspectRatios: string[];
  onToggleAspect: (r: string) => void;

  quality: string;
  qualities: string[];
  isQualityDisabled?: (q: string) => boolean;
  onChangeQuality: (v: string) => void;

  /** Qty label + value: single-mode = variantCount, multi-mode = versionsPerContent */
  qtyLabel: string;
  qty: number;
  qtyMax: number;
  onChangeQty: (n: number) => void;

  /** Total banner preview: (variants × versions × aspects) */
  totalPreview?: number;
  totalHint?: string;
}

export const OutputRow: React.FC<Props> = ({
  selectedAspectRatios, aspectRatios, onToggleAspect,
  quality, qualities, isQualityDisabled, onChangeQuality,
  qtyLabel, qty, qtyMax, onChangeQty,
  totalPreview, totalHint,
}) => {
  const selectedCount = selectedAspectRatios.size;

  return (
    <section className="space-y-2">
      <label className="text-xs font-semibold text-subtle uppercase tracking-wider flex items-center gap-1.5">
        <Sliders size={12} /> Đầu ra
      </label>

      {/* Aspect ratio — multi-select button grid */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] text-subtle uppercase tracking-wider">
            Tỉ lệ
          </label>
          <span className="text-[10px] text-muted">
            <b className="text-brand">{selectedCount}</b> / {aspectRatios.length} tỉ lệ chọn
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {aspectRatios.map(r => {
            const on = selectedAspectRatios.has(r);
            return (
              <button
                key={r}
                onClick={() => {
                  // Không cho untick nếu chỉ còn 1 (phải có ít nhất 1)
                  if (on && selectedCount <= 1) return;
                  onToggleAspect(r);
                }}
                className={`relative text-[11px] py-1.5 px-2 rounded-md border transition-all ${
                  on
                    ? 'bg-brand/15 border-brand text-brand font-semibold'
                    : 'bg-canvas border-line text-muted hover:border-brand/40 hover:text-fg'
                }`}
                title={on ? (selectedCount <= 1 ? 'Cần ít nhất 1 tỉ lệ' : `Bỏ ${r}`) : `Thêm ${r}`}
              >
                {r}
                {on && (
                  <span className="absolute top-0.5 right-0.5 bg-brand rounded-full w-2 h-2" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Quality + Qty — hàng dưới, 2 col */}
      <div className="grid grid-cols-2 gap-2">
        <Select
          label="Độ nét"
          value={quality}
          options={qualities.map(q => ({
            value: q,
            label: q,
            disabled: isQualityDisabled?.(q),
          }))}
          onChange={onChangeQuality}
        />
        <Select
          label={qtyLabel}
          value={String(qty)}
          options={Array.from({ length: qtyMax }, (_, i) => ({
            value: String(i + 1),
            label: String(i + 1),
          }))}
          onChange={(v) => onChangeQty(Number(v))}
        />
      </div>

      {totalPreview != null && totalPreview > 0 && (
        <p className="text-[11px] text-brand bg-brand/5 border border-brand/20 rounded px-2 py-1.5">
          Sẽ tạo <b>{totalPreview}</b> banner{totalHint ? ` (${totalHint})` : ''}.
        </p>
      )}
    </section>
  );
};

// ─── Select primitive ───

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const Select: React.FC<{
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
}> = ({ label, value, options, onChange }) => (
  <div>
    <label className="text-[10px] text-subtle uppercase tracking-wider block mb-1">
      {label}
    </label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-canvas border border-line rounded-md px-2.5 py-2 text-sm text-fg focus:outline-none focus:border-brand"
    >
      {options.map(o => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}{o.disabled ? ' (n/a)' : ''}
        </option>
      ))}
    </select>
  </div>
);
