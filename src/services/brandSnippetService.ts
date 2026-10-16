import { BrandSnippet } from '../types';
import { getSupabase } from './supabaseClient';

async function requireUserId(): Promise<string> {
  const { data: { user } } = await getSupabase().auth.getUser();
  if (!user) throw new Error('Chưa đăng nhập');
  return user.id;
}

function rowToSnippet(r: any): BrandSnippet {
  return {
    id: r.id,
    content: r.content,
    addedAt: r.added_at ? new Date(r.added_at).getTime() : Date.now(),
  };
}

export async function listSnippetsFromCloud(): Promise<BrandSnippet[]> {
  try {
    const { data, error } = await getSupabase()
      .from('brand_snippets')
      .select('*')
      .order('added_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(rowToSnippet);
  } catch (e) {
    console.warn('listSnippetsFromCloud failed', e);
    return [];
  }
}

export async function addSnippetToCloud(content: string): Promise<BrandSnippet> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('Nội dung trống');
  const userId = await requireUserId();
  const id = Math.random().toString(36).substring(7);
  const row = { id, user_id: userId, content: trimmed, added_at: new Date().toISOString() };
  const { error } = await getSupabase().from('brand_snippets').insert(row);
  if (error) throw error;
  return rowToSnippet(row);
}

export async function removeSnippetFromCloud(id: string): Promise<void> {
  const { error } = await getSupabase().from('brand_snippets').delete().eq('id', id);
  if (error) throw error;
}

export async function bulkAddSnippetsToCloud(items: BrandSnippet[]): Promise<{ inserted: number; skipped: number }> {
  if (items.length === 0) return { inserted: 0, skipped: 0 };
  const userId = await requireUserId();
  const rows = items.map(s => ({
    id: s.id,
    user_id: userId,
    content: s.content,
    added_at: s.addedAt ? new Date(s.addedAt).toISOString() : new Date().toISOString(),
  }));
  const { data, error } = await getSupabase()
    .from('brand_snippets')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
    .select('id');
  if (error) throw error;
  const inserted = data?.length ?? 0;
  return { inserted, skipped: rows.length - inserted };
}
