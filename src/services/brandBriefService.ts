// CRUD for brand_briefs — 10 briefs per import are persisted; user toggles
// is_selected on the ones they want to use in BannerTool multi-content mode.

import { getSupabase } from './supabaseClient';
import { BrandBrief, BriefType } from '../types';
import { RawBrief } from './contentImportService';

const VALID_CTAS = new Set([
  'SHOP_NOW', 'LEARN_MORE', 'SIGN_UP', 'BUY_NOW', 'BOOK_TRAVEL',
  'DOWNLOAD', 'CONTACT_US', 'GET_QUOTE', 'MESSAGE_PAGE', 'SUBSCRIBE',
  'WATCH_MORE', 'GET_OFFER', 'INSTALL_MOBILE_APP', 'NO_BUTTON',
]);

function newId(): string {
  return 'brf_' + Math.random().toString(36).substring(2, 8) + Date.now().toString(36);
}

function rowToBrief(r: any): BrandBrief {
  return {
    id: r.id,
    brandId: r.brand_id,
    briefType: r.brief_type as BriefType,
    title: r.title,
    primaryMessage: r.primary_message || undefined,
    headline: r.headline || undefined,
    subline: r.subline || undefined,
    primaryText: r.primary_text || undefined,
    cta: r.cta || undefined,
    ctaText: r.cta_text || undefined,
    badges: Array.isArray(r.badges) ? r.badges.filter((x: any) => typeof x === 'string') : undefined,
    toneNotes: r.tone_notes || undefined,
    sourceUrl: r.source_url || undefined,
    isSelected: !!r.is_selected,
    position: r.position ?? 100,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
  };
}

async function requireUserId(): Promise<string> {
  const { data: { user } } = await getSupabase().auth.getUser();
  if (!user) throw new Error('Chưa đăng nhập');
  return user.id;
}

export async function listBriefsForBrand(brandId: string): Promise<BrandBrief[]> {
  const { data, error } = await getSupabase()
    .from('brand_briefs')
    .select('*')
    .eq('brand_id', brandId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('listBriefsForBrand', error);
    return [];
  }
  return (data || []).map(rowToBrief);
}

export async function listSelectedBriefsForBrand(brandId: string): Promise<BrandBrief[]> {
  const { data, error } = await getSupabase()
    .from('brand_briefs')
    .select('*')
    .eq('brand_id', brandId)
    .eq('is_selected', true)
    .order('position', { ascending: true });
  if (error) {
    console.warn('listSelectedBriefsForBrand', error);
    return [];
  }
  return (data || []).map(rowToBrief);
}

/** Replace ALL briefs for a brand with a new batch (used after generate).
 *  Use case: regen wipes old draft briefs cleanly. */
export async function replaceBriefsForBrand(
  brandId: string,
  rawBriefs: RawBrief[],
  sourceUrl: string,
): Promise<BrandBrief[]> {
  const userId = await requireUserId();

  // Verify the brand row actually exists in DB. If the user clicked
  // "Brand mới" but hasn't saved yet, the brand_projects row doesn't exist
  // yet and the briefs insert would hit a foreign key violation with an
  // opaque error message. Surface a friendlier one.
  const { data: brand, error: brandErr } = await getSupabase()
    .from('brand_projects')
    .select('id')
    .eq('id', brandId)
    .maybeSingle();
  if (brandErr) throw brandErr;
  if (!brand) {
    throw new Error(
      'Brand chưa được lưu vào cloud — click "Lưu" ở trên (cần đặt tên brand trước) ' +
      'rồi mở lại Import URL.',
    );
  }

  // Delete existing first.
  const { error: delErr } = await getSupabase()
    .from('brand_briefs')
    .delete()
    .eq('brand_id', brandId);
  if (delErr) throw delErr;

  const now = new Date().toISOString();
  const rows = rawBriefs.map((b, idx) => {
    const rawCta = b.cta || b.cta_code;
    return {
      id: newId(),
      brand_id: brandId,
      user_id: userId,
      brief_type: b.angle || b.brief_type || 'general',
      title: b.title || `Brief ${idx + 1}`,
      primary_message: b.primary_message || null,
      headline: b.headline || null,
      subline: b.subline || null,
      primary_text: b.primary_text || b.body || null,
      cta: rawCta && VALID_CTAS.has(rawCta) ? rawCta : 'LEARN_MORE',
      cta_text: b.cta_text || null,
      badges: Array.isArray(b.badges) && b.badges.length ? b.badges.slice(0, 3) : null,
      tone_notes: b.tone_notes || null,
      source_url: sourceUrl,
      is_selected: false,
      position: 100 + idx,
      created_at: now,
      updated_at: now,
    };
  });

  const { data, error } = await getSupabase()
    .from('brand_briefs')
    .insert(rows)
    .select();
  if (error) throw error;
  return (data || []).map(rowToBrief);
}

export async function toggleBriefSelected(id: string, isSelected: boolean): Promise<void> {
  const { error } = await getSupabase()
    .from('brand_briefs')
    .update({ is_selected: isSelected, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function updateBrief(
  id: string,
  patch: Partial<Pick<BrandBrief, 'title' | 'primaryMessage' | 'headline' | 'subline' | 'primaryText' | 'cta' | 'ctaText' | 'badges' | 'toneNotes' | 'briefType' | 'position'>>,
): Promise<void> {
  const dbPatch: any = { updated_at: new Date().toISOString() };
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
  if (Object.keys(dbPatch).length === 1) return;  // nothing to update

  const { error } = await getSupabase()
    .from('brand_briefs')
    .update(dbPatch)
    .eq('id', id);
  if (error) throw error;
}

export async function deleteBrief(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from('brand_briefs')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

/** Count of currently selected briefs for a brand — used for "x/5 selected" badges. */
export async function countSelectedBriefs(brandId: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from('brand_briefs')
    .select('*', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .eq('is_selected', true);
  if (error) return 0;
  return count || 0;
}
