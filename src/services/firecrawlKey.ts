// Firecrawl API key — same pattern as Coachio:
//   - Settings UI saves to localStorage + syncs to Supabase (user_api_keys)
//   - On auth restore, bootstrap from DB → localStorage (cross-device)
//   - Edge function /api/firecrawl-scrape resolves key per-user (admin gets
//     server env, everyone else gets their own).

import { getSupabase, isSupabaseConfigured } from './supabaseClient';

const KEY_STORAGE = 'firecrawl_api_key';

export function getFirecrawlApiKey(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(KEY_STORAGE) || '';
}

export function setFirecrawlApiKey(key: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY_STORAGE, key);
  syncFirecrawlKeyToCloud(key).catch(e => console.warn('[firecrawl] DB sync failed', e));
}

export function removeFirecrawlApiKey(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY_STORAGE);
  syncFirecrawlKeyToCloud(null).catch(e => console.warn('[firecrawl] DB clear failed', e));
}

async function syncFirecrawlKeyToCloud(key: string | null): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return;
  await fetch('/api/user-keys', {
    method: key == null ? 'DELETE' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    // DELETE clears every key for the user — to clear only Firecrawl, send null in POST.
    body: key == null ? undefined : JSON.stringify({ firecrawl_api_key: key }),
  });
}

export async function bootstrapFirecrawlKeyFromCloud(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  if (!isSupabaseConfigured) return null;
  const cached = getFirecrawlApiKey();
  if (cached) return cached;

  try {
    const { data } = await getSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const res = await fetch('/api/user-keys', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const dbKey = body?.firecrawl_api_key as string | null;
    if (dbKey) {
      localStorage.setItem(KEY_STORAGE, dbKey);
      return dbKey;
    }
    return null;
  } catch (e) {
    console.warn('[firecrawl] bootstrap from DB failed', e);
    return null;
  }
}
