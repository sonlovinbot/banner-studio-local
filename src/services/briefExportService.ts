// Brief exporters — CSV / Markdown / JSON serializers for BrandBrief[]
// (from URL crawl or brand_briefs table). Triggers a browser download via
// blob URL so no server round-trip needed. Include ALL briefs (not just
// selected) so the user has full record.

import { BrandBrief } from '../types';

type Format = 'csv' | 'md' | 'json';

interface ExportOpts {
  briefs: BrandBrief[];
  format: Format;
  /** Used in filename + MD/JSON header. Falls back to timestamp. */
  sourceLabel?: string;
}

export function exportBriefs(opts: ExportOpts): void {
  const { briefs, format, sourceLabel } = opts;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const safeLabel = (sourceLabel || 'briefs')
    .replace(/[^a-zA-Z0-9À-ỹ-_ ]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .toLowerCase();

  let content: string;
  let mime: string;
  let ext: string;
  switch (format) {
    case 'csv':  content = toCsv(briefs);           mime = 'text/csv;charset=utf-8';               ext = 'csv';  break;
    case 'md':   content = toMarkdown(briefs, sourceLabel); mime = 'text/markdown;charset=utf-8'; ext = 'md';   break;
    case 'json': content = toJson(briefs, sourceLabel);     mime = 'application/json;charset=utf-8'; ext = 'json'; break;
  }

  const filename = `${safeLabel}-briefs-${stamp}.${ext}`;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ─── CSV (RFC 4180 escaping) ───

const CSV_HEADERS = [
  'idx', 'selected', 'angle', 'title', 'headline', 'subline', 'body',
  'cta_text', 'cta_code', 'badges', 'tone_notes', 'source_url', 'created_at',
] as const;

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(briefs: BrandBrief[]): string {
  const lines: string[] = [CSV_HEADERS.join(',')];
  briefs.forEach((b, i) => {
    const row = [
      i + 1,
      b.isSelected ? 'yes' : 'no',
      b.briefType || '',
      b.title || '',
      b.headline || '',
      b.subline || '',
      b.primaryText || '',
      b.ctaText || '',
      b.cta || '',
      (b.badges || []).join(' | '),
      b.toneNotes || '',
      b.sourceUrl || '',
      b.createdAt ? new Date(b.createdAt).toISOString() : '',
    ];
    lines.push(row.map(csvEscape).join(','));
  });
  // Prepend BOM so Excel opens UTF-8 correctly (Vietnamese diacritics).
  return '﻿' + lines.join('\n');
}

// ─── Markdown ───

function toMarkdown(briefs: BrandBrief[], sourceLabel?: string): string {
  const parts: string[] = [];
  parts.push(`# Ad Briefs`);
  if (sourceLabel) parts.push(`\n**Source**: ${sourceLabel}`);
  parts.push(`**Generated**: ${new Date().toLocaleString('vi-VN')}`);
  parts.push(`**Count**: ${briefs.length} (${briefs.filter(b => b.isSelected).length} đã chọn)`);
  parts.push('\n---\n');

  briefs.forEach((b, i) => {
    parts.push(`## ${i + 1}. ${b.title || b.briefType || 'Brief'}${b.isSelected ? ' ✅' : ''}`);
    if (b.briefType) parts.push(`- **Angle**: \`${b.briefType}\``);
    if (b.headline)  parts.push(`- **Headline**: **${b.headline}**`);
    if (b.subline)   parts.push(`- **Subline**: _${b.subline}_`);
    if (b.primaryText) parts.push(`- **Body**:\n\n  ${b.primaryText.split('\n').join('\n  ')}`);
    if (b.ctaText || b.cta) {
      const parts2: string[] = [];
      if (b.ctaText) parts2.push(`"${b.ctaText}"`);
      if (b.cta)     parts2.push(`\`${b.cta}\``);
      parts.push(`- **CTA**: ${parts2.join(' · ')}`);
    }
    if (b.badges && b.badges.length) {
      parts.push(`- **Badges**: ${b.badges.map(x => `\`${x}\``).join(' · ')}`);
    }
    if (b.toneNotes) parts.push(`- **Tone / visual**: ${b.toneNotes}`);
    if (b.sourceUrl) parts.push(`- **Source URL**: ${b.sourceUrl}`);
    parts.push('');
  });

  return parts.join('\n');
}

// ─── JSON ───

function toJson(briefs: BrandBrief[], sourceLabel?: string): string {
  const payload = {
    exported_at: new Date().toISOString(),
    source: sourceLabel || null,
    count: briefs.length,
    selected_count: briefs.filter(b => b.isSelected).length,
    briefs: briefs.map(b => ({
      id: b.id,
      selected: b.isSelected,
      angle: b.briefType || null,
      title: b.title,
      headline: b.headline || null,
      subline: b.subline || null,
      body: b.primaryText || null,
      cta_text: b.ctaText || null,
      cta_code: b.cta || null,
      badges: b.badges || [],
      tone_notes: b.toneNotes || null,
      source_url: b.sourceUrl || null,
      brand_id: b.brandId,
      position: b.position,
      created_at: b.createdAt,
      updated_at: b.updatedAt,
    })),
  };
  return JSON.stringify(payload, null, 2);
}
