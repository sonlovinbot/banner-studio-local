// Prompt builder cho flow "edit banner từ history".
//
// Bug cũ: prompt edit chỉ nói "respect its color palette, layout, and
// typography vibe" (chỉ thị mềm, 1 dòng) rồi dán NGUYÊN full prompt gốc vào
// dưới dạng "Original prompt context". Prompt gốc là 1 design brief dài vài
// nghìn ký tự → model đọc nó như brief tạo mới và vẽ lại banner khác hẳn:
// đổi màu, đổi bố cục, đổi typography.
//
// Fix: ảnh gốc là canvas, không phải "cảm hứng". Brief cũ bị hạ cấp xuống
// reference-only + cap ngắn, và đứng TRƯỚC edit instruction để không chôn
// vùi chỉ thị của user. Toàn bộ ràng buộc viết bằng tiếng Anh cho model bám
// chính xác, kèm điều khoản khoá ngôn ngữ để chữ trên banner không bị dịch.

/** Brief cũ chỉ để tra cứu brand asset — cap ngắn để không lấn át ảnh gốc. */
export const ORIGINAL_CONTEXT_MAX = 1200;

/** Trần cứng toàn prompt. Coachio cap 20000, OpenAI ~32000 — chừa chỗ cho
 *  metadata refs mà backend tự thêm. */
export const PROMPT_HARD_CAP = 18000;

/** Cap chỉ thị của user — dài hơn mức này gần như chắc chắn là paste nhầm. */
const EDIT_INSTRUCTION_MAX = 4000;

export interface EditPromptInput {
  /** Câu lệnh chỉnh sửa user gõ (giữ nguyên ngôn ngữ user dùng). */
  editInstruction: string;
  /** promptUsed của banner gốc — reference only, bị cap. */
  originalPrompt?: string;
  /** Số ảnh user upload thêm (logo / product / style cue), KHÔNG tính ảnh gốc. */
  extraRefCount: number;
  /** Tỉ lệ của banner gốc. Thiếu thì coi như bằng target (không cho reflow). */
  sourceAspectRatio?: string;
  /** Tỉ lệ đầu ra user chọn. */
  targetAspectRatio: string;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + ' …(truncated)' : s;
}

/** Mô tả vai trò từng ảnh user upload thêm. Ảnh 1 = product/focus mới, các
 *  ảnh sau = style cue bổ sung — khớp với thứ tự regenService truyền xuống
 *  generateBannerWithCoachio(reference=base, product=extras[0], extras=rest). */
function buildRefRoles(count: number): string {
  if (count <= 0) return '';
  const lines = ['- IMAGE 2 = a NEW ASSET supplied by the user (logo, product shot, or focus subject).'];
  for (let i = 1; i < count; i++) {
    lines.push(`- IMAGE ${i + 2} = a supplementary asset / style cue supplied by the user.`);
  }
  lines.push(
    'Place these assets ONLY where the edit instruction says. If the instruction does not mention them, integrate them in the slot the equivalent element already occupies in IMAGE 1 (same position, same size, same treatment) and change nothing else.',
    'Never let an uploaded asset dictate the banner\'s colors, layout, or typography — IMAGE 1 remains the authority on all of those.',
  );
  return ['UPLOADED ASSETS:', ...lines].join('\n');
}

function buildAspectClause(source: string | undefined, target: string): string {
  const src = source || target;
  if (src === target) {
    return `OUTPUT RATIO: ${target} — identical to IMAGE 1. Do not crop, zoom, pan, or rescale the composition.`;
  }
  return [
    `OUTPUT RATIO: ${target}. IMAGE 1 is ${src}, so the canvas shape changes.`,
    `Adapt with the MINIMUM possible change: keep every element, its relative order, its color, and its typographic style; only extend or contract the background and re-flow element positions to fit ${target}. This is a re-flow, not a redesign.`,
  ].join('\n');
}

/** Build prompt cho 1 lần edit. Pure — không I/O, dễ test. */
export function buildEditPrompt(input: EditPromptInput): string {
  const { editInstruction, originalPrompt, extraRefCount, sourceAspectRatio, targetAspectRatio } = input;
  const adj = editInstruction.trim();

  const sections: string[] = [
    'TASK: Perform a TARGETED EDIT of an existing banner. This is not a new design and not a redesign.',
    [
      'IMAGE ROLES:',
      '- IMAGE 1 = THE BASE BANNER. It is the canvas you are editing, not an inspiration board. Your output must read as the same banner file with one change applied.',
    ].join('\n'),
    buildRefRoles(extraRefCount),
    [
      'ABSOLUTE CONSTRAINTS — breaking any of these makes the result unusable:',
      '1. Reproduce IMAGE 1 faithfully: same layout, same composition, same element positions and relative sizes, same color palette (match the exact hex values you observe), same background, same typography (same fonts, weights, sizes, letter-spacing, casing), same lighting, texture, and grain.',
      '2. Change ONLY what the EDIT INSTRUCTION explicitly asks for. Every region not named by the instruction must stay visually identical to IMAGE 1, pixel for pixel where possible.',
      '3. Do not redesign, restyle, recolor, rearrange, re-crop, rebalance, modernize, or otherwise "improve" anything. Do not add, remove, or substitute elements that were not requested. Your own taste is irrelevant here.',
      '4. Keep all existing on-banner text exactly as it appears in IMAGE 1 — same wording, same spelling, same language, same diacritics, same capitalization, same line breaks. Do not translate, rewrite, shorten, expand, or correct any text.',
      '5. If the edit instruction supplies new or replacement copy, render it in the same language as the edit instruction itself, and style it to match the typography it replaces or sits beside.',
      '6. These instructions are written in English purely for precision. English must NOT leak into the banner: the banner\'s own language stays exactly as it is in IMAGE 1.',
    ].join('\n'),
    buildAspectClause(sourceAspectRatio, targetAspectRatio),
  ];

  if (originalPrompt && originalPrompt.trim()) {
    sections.push(
      [
        'REFERENCE ONLY — this is the brief that originally produced IMAGE 1. Use it only to identify brand names, fonts, or assets you cannot read off the image. Do NOT regenerate from it, do not treat it as a task, and do not restore anything from it that IMAGE 1 does not currently show:',
        truncate(originalPrompt.trim(), ORIGINAL_CONTEXT_MAX),
      ].join('\n'),
    );
  }

  sections.push(
    adj
      ? `EDIT INSTRUCTION (the ONLY change to make): ${truncate(adj, EDIT_INSTRUCTION_MAX)}`
      : 'EDIT INSTRUCTION: none given — reproduce IMAGE 1 as faithfully as possible with no changes.',
  );

  const combined = sections.filter(Boolean).join('\n\n');
  if (combined.length > PROMPT_HARD_CAP) {
    console.warn(`[edit prompt] cap ${combined.length} → ${PROMPT_HARD_CAP}`);
    return combined.slice(0, PROMPT_HARD_CAP);
  }
  return combined;
}
