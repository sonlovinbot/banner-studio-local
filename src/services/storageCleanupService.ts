// Inventory + selective cleanup of localStorage. All app data lives in
// Supabase + storage local now, but several legacy localStorage caches (banner
// history, brand projects, image library base64 blobs) survived from
// pre-migration. Once the user fills the ~5-10MB browser quota, every
// localStorage.setItem starts throwing — including critical ones like
// the studio handoff. This module lets the user see + reclaim space.

export type StorageGroupId =
  | 'legacy-history'
  | 'legacy-library'
  | 'legacy-brand'
  | 'legacy-votes'
  | 'chat-prefs'
  | 'api-keys'
  | 'app-settings'
  | 'other';

export interface StorageGroup {
  id: StorageGroupId;
  label: string;
  description: string;
  /** True if this group is safe to clear (data already in cloud or trivially regenerable). */
  safe: boolean;
  /** Matches each storage key against this group. Order of groups matters — first match wins. */
  match: (key: string) => boolean;
}

const GROUPS: StorageGroup[] = [
  {
    id: 'legacy-history',
    label: 'History (legacy local)',
    description: 'Banner cũ lưu trong localStorage trước khi migrate lên cloud. An toàn để xoá — cloud đã có.',
    safe: true,
    match: (k) => k === 'banner_pro_history',
  },
  {
    id: 'legacy-library',
    label: 'Image library (legacy)',
    description: 'Cache ảnh ref/prod/face base64 trước migration. An toàn — storage local đã có.',
    safe: true,
    match: (k) => k.startsWith('banner_pro_library_'),
  },
  {
    id: 'legacy-brand',
    label: 'Brand projects + library (legacy)',
    description: 'Brand cache cũ trước migration. An toàn — Supabase đã có.',
    safe: true,
    match: (k) => k === 'banner_pro_brand_library' || k === 'banner_pro_brand_projects',
  },
  {
    id: 'legacy-votes',
    label: 'Votes (legacy)',
    description: 'Vote feedback cũ. An toàn để xoá.',
    safe: true,
    match: (k) => k === 'banner_pro_votes' || k === 'banner_pro_learn_from_votes',
  },
  {
    id: 'chat-prefs',
    label: 'Chat preferences',
    description: 'System prompt, model/brand/pins/temperature theo phiên chat. Xoá → mất prefs phiên cũ (chat content vẫn ở cloud).',
    safe: false,
    match: (k) => k === 'ad_chat_system_prompt' ||
                  k === 'ad_chat_temperature' ||
                  k.startsWith('ad_chat_model_') ||
                  k.startsWith('ad_chat_brand_') ||
                  k.startsWith('ad_chat_pins_'),
  },
  {
    id: 'api-keys',
    label: 'API keys',
    description: 'Coachio + Gemini API keys lưu local. Xoá → phải nhập lại trong Settings.',
    safe: false,
    match: (k) => k === 'coachio_api_key' || k === 'gemini_api_key',
  },
  {
    id: 'app-settings',
    label: 'App settings',
    description: 'Theme, active backend. Xoá → reset về mặc định.',
    safe: false,
    match: (k) => k === 'theme' || k === 'active_backend',
  },
  {
    id: 'other',
    label: 'Khác (không nhận diện)',
    description: 'Key không thuộc nhóm nào — có thể từ extension/widget khác.',
    safe: false,
    match: () => true, // catch-all, runs last
  },
];

export interface StorageItem {
  key: string;
  bytes: number;
  group: StorageGroupId;
}

export interface StorageReport {
  /** Per-group totals. */
  groups: { id: StorageGroupId; label: string; description: string; safe: boolean; bytes: number; count: number }[];
  totalBytes: number;
  /** Best-effort browser quota estimate. May be undefined if API unavailable. */
  quotaBytes?: number;
  /** Raw items for delete operations. */
  items: StorageItem[];
}

function classify(key: string): StorageGroupId {
  for (const g of GROUPS) {
    if (g.match(key)) return g.id;
  }
  return 'other';
}

function bytesOf(value: string): number {
  // JS strings are UTF-16 in memory but browsers measure quota in UTF-16
  // code units (~2 bytes per char). Close enough for display.
  return value.length * 2;
}

/** Scan localStorage and aggregate by group. */
export async function inventoryLocalStorage(): Promise<StorageReport> {
  const items: StorageItem[] = [];
  let totalBytes = 0;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const value = localStorage.getItem(key) || '';
      const bytes = bytesOf(key) + bytesOf(value);
      items.push({ key, bytes, group: classify(key) });
      totalBytes += bytes;
    }
  } catch (e) {
    console.warn('localStorage scan failed', e);
  }

  // Aggregate by group, preserving GROUPS order
  const groups = GROUPS.map(g => {
    const groupItems = items.filter(it => it.group === g.id);
    return {
      id: g.id,
      label: g.label,
      description: g.description,
      safe: g.safe,
      bytes: groupItems.reduce((s, it) => s + it.bytes, 0),
      count: groupItems.length,
    };
  }).filter(g => g.count > 0); // hide empty groups

  // Try Storage API for quota
  let quotaBytes: number | undefined;
  try {
    if (typeof navigator !== 'undefined' && (navigator as any).storage?.estimate) {
      const est = await (navigator as any).storage.estimate();
      // localStorage quota is typically smaller (5-10MB) than the StorageManager
      // total — but the absolute number is hard to introspect. Use the
      // browser estimate as upper bound, treat 5MB as common cap.
      quotaBytes = est.quota || 10 * 1024 * 1024;
    }
  } catch {
    quotaBytes = undefined;
  }

  return { groups, totalBytes, quotaBytes, items };
}

/** Delete every key in the given groups. Returns total bytes reclaimed. */
export function clearGroups(groupIds: StorageGroupId[], items: StorageItem[]): number {
  let reclaimed = 0;
  const set = new Set(groupIds);
  for (const it of items) {
    if (!set.has(it.group)) continue;
    try {
      localStorage.removeItem(it.key);
      reclaimed += it.bytes;
    } catch (e) {
      console.warn('removeItem failed', it.key, e);
    }
  }
  return reclaimed;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
