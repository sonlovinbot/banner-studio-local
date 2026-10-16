// CRUD cho url_crawl_briefs — persist URL crawl briefs sang Supabase.
// Single active batch per user: mỗi lần crawl mới wipe batch cũ và insert
// briefs mới (không giữ history — user muốn snapshot, không phải log).

import { getSupabase } from './supabaseClient';
import { BrandBrief, BriefType } from '../types';
import { RawBrief } from './contentImportService';

const URL_BRIEF_BRAND_ID = '_url_session';

const VALID_CTAS = new Set([
  'SHOP_NOW', 'LEARN_MORE', 'SIGN_UP', 'BUY_NOW', 'BOOK_TRAVEL',
  'DOWNLOAD', 'CONTACT_US', 'GET_QUOTE', 'MESSAGE_PAGE', 'SUBSCRIBE',
  'WATCH_MORE', 'GET_OFFER', 'INSTALL_MOBILE_APP', 'NO_BUTTON',
]);

/** Reads new-schema JSONB `badges` column or falls back to null. */
function badgesFromRow(v: any): string[] | undefined {
  if (!v) return undefined;
  if (Array.isArray(v)) return v.filter(x => typeof x === 'string');
  return undefined;
}

function newId(): string {
  return 'ucb_' + Math.random().toString(36).substring(2, 8) + Date.now().toString(36);
}

function rowToBrief(r: any): BrandBrief {
  return {
    id: r.id,
    brandId: URL_BRIEF_BRAND_ID,
    briefType: r.brief_type as BriefType,
    title: r.title,
    primaryMessage: r.primary_message || undefined,
    headline: r.headline || undefined,
    subline: r.subline || undefined,
    primaryText: r.primary_text || undefined,
    cta: r.cta || undefined,
    ctaText: r.cta_text || undefined,
    badges: badgesFromRow(r.badges),
    toneNotes: r.tone_notes || undefined,
    sourceUrl: r.source_url,
    isSelected: !!r.is_enabled,
    position: r.position ?? 100,
    createdAt: r.crawled_at ? new Date(r.crawled_at).getTime() : Date.now(),
    updatedAt: r.crawled_at ? new Date(r.crawled_at).getTime() : Date.now(),
  };
}

async function requireUserId(): Promise<string> {
  const { data: { user } } = await getSupabase().auth.getUser();
  if (!user) throw new Error('Chưa đăng nhập');
  return user.id;
}

/** List URL crawl briefs của user (sorted by position). */
export async function listUrlCrawlBriefs(): Promise<BrandBrief[]> {
  try {
    const { data, error } = await getSupabase()
      .from('url_crawl_briefs')
      .select('*')
      .order('position', { ascending: true });
    if (error) throw error;
    return (data || []).map(rowToBrief);
  } catch (e) {
    console.warn('listUrlCrawlBriefs failed', e);
    return [];
  }
}

/** Replace toàn bộ URL crawl briefs của user với batch mới. Trả về briefs
 *  đã persist. */
export async function replaceUrlCrawlBriefs(
  sourceUrl: string,
  rawBriefs: RawBrief[],
): Promise<BrandBrief[]> {
  const userId = await requireUserId();
  const sb = getSupabase();

  // Wipe batch cũ.
  const { error: delErr } = await sb.from('url_crawl_briefs').delete().eq('user_id', userId);
  if (delErr) throw delErr;

  if (rawBriefs.length === 0) return [];

  const now = new Date().toISOString();
  const rows = rawBriefs.map((b, idx) => {
    const rawCta = b.cta || b.cta_code;
    return {
      id: newId(),
      user_id: userId,
      source_url: sourceUrl,
      brief_type: b.angle || b.brief_type || 'general',
      title: b.title || `URL Brief ${idx + 1}`,
      primary_message: b.primary_message || null,
      headline: b.headline || null,
      subline: b.subline || null,
      primary_text: b.primary_text || b.body || null,
      cta: rawCta && VALID_CTAS.has(rawCta) ? rawCta : 'LEARN_MORE',
      cta_text: b.cta_text || null,
      badges: Array.isArray(b.badges) && b.badges.length ? b.badges.slice(0, 3) : null,
      tone_notes: b.tone_notes || null,
      is_enabled: true,
      position: 100 + idx,
      crawled_at: now,
    };
  });

  const { data, error } = await sb.from('url_crawl_briefs').insert(rows).select();
  if (error) throw error;
  return (data || []).map(rowToBrief);
}

/** Update 1 URL crawl brief. Chỉ patch những field truyền vào. */
export async function updateUrlCrawlBrief(
  id: string,
  patch: Partial<Pick<BrandBrief, 'title' | 'primaryMessage' | 'headline' | 'subline' | 'primaryText' | 'cta' | 'ctaText' | 'badges' | 'toneNotes' | 'briefType' | 'position'>>,
): Promise<void> {
  const dbPatch: any = {};
  if (patch.title !== undefined)          dbPatch.title = patch.title;
  if (patch.primaryMessage !== undefined) dbPatch.primary_message = patch.primaryMessage;
  if (patch.headline !== undefined)       dbPatch.headline = patch.headline;
  if (patch.subline !== undefined)        dbPatch.subline = patch.subline;
  if (patch.primaryText !== undefined)    dbPatch.primary_text = patch.primaryText;
  if (patch.cta !== undefined)            dbPatch.cta = patch.cta;
  if (patch.ctaText !== undefined)        dbPatch.cta_text = patch.ctaText;
  if (patch.badges !== undefined)         dbPatch.badges = patch.badges;
  if (patch.toneNotes !== undefined)      dbPatch.tone_notes = patch.toneNotes;
  if (patch.briefType !== undefined)      dbPatch.brief_type = patch.briefType;
  if (patch.position !== undefined)       dbPatch.position = patch.position;
  if (Object.keys(dbPatch).length === 0) return;

  const { error } = await getSupabase()
    .from('url_crawl_briefs')
    .update(dbPatch)
    .eq('id', id);
  if (error) throw error;
}

/** Toggle enabled state cho 1 URL crawl brief. */
export async function toggleUrlCrawlBriefEnabled(id: string, isEnabled: boolean): Promise<void> {
  const { error } = await getSupabase()
    .from('url_crawl_briefs')
    .update({ is_enabled: isEnabled })
    .eq('id', id);
  if (error) throw error;
}

/** Bulk update enabled state cho nhiều briefs (dùng khi user click "Tất cả"
 *  hoặc "Bỏ hết"). */
export async function setUrlCrawlBriefsEnabled(ids: string[], isEnabled: boolean): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await getSupabase()
    .from('url_crawl_briefs')
    .update({ is_enabled: isEnabled })
    .in('id', ids);
  if (error) throw error;
}

/** Xoá 1 URL crawl brief cá nhân. */
export async function deleteUrlCrawlBrief(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from('url_crawl_briefs')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

/** Xoá tất cả URL crawl briefs của user (dùng cho nút Reset). */
export async function clearUrlCrawlBriefs(): Promise<void> {
  const userId = await requireUserId();
  const { error } = await getSupabase()
    .from('url_crawl_briefs')
    .delete()
    .eq('user_id', userId);
  if (error) throw error;
}
