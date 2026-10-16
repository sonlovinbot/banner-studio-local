import { BrandProject, BrandSnippet, HistoryItem, LibraryCategory, LibraryImage, VotedBanner } from '../types';
import { EMBEDDED_HISTORY } from '../appdata/embeddedHistory';

const HISTORY_KEY = 'banner_pro_history';
const GEMINI_API_KEY_STORAGE = 'gemini_api_key';
const ACTIVE_BACKEND_STORAGE = 'active_backend';
const LIBRARY_KEY_PREFIX = 'banner_pro_library_';
const BRAND_LIBRARY_KEY = 'banner_pro_brand_library';
const BRAND_PROJECTS_KEY = 'banner_pro_brand_projects';
const VOTES_KEY = 'banner_pro_votes';
const LEARN_FROM_VOTES_KEY = 'banner_pro_learn_from_votes';
const MAX_LIBRARY_ITEMS = 30;
const MAX_BRAND_ITEMS = 30;
const MAX_VOTED_BANNERS = 30;

export function getGeminiApiKey(): string {
  return localStorage.getItem(GEMINI_API_KEY_STORAGE) || '';
}

export function setGeminiApiKey(key: string): void {
  localStorage.setItem(GEMINI_API_KEY_STORAGE, key);
}

export function removeGeminiApiKey(): void {
  localStorage.removeItem(GEMINI_API_KEY_STORAGE);
}

export function getActiveBackend(): 'gemini' | 'coachio' {
  // Mặc định Coachio: đó là backend duy nhất Banner Tool đang dùng. Trước đây
  // mặc định 'gemini' nên dashboard khoe sai backend dù chưa ai bật Gemini.
  return (localStorage.getItem(ACTIVE_BACKEND_STORAGE) as 'gemini' | 'coachio') || 'coachio';
}

export function setActiveBackend(backend: 'gemini' | 'coachio'): void {
  localStorage.setItem(ACTIVE_BACKEND_STORAGE, backend);
}

export function getHistory(): HistoryItem[] {
  try {
    const data = localStorage.getItem(HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function persistHistory(items: HistoryItem[]): { saved: boolean; dropped: number } {
  let trimmed = [...items];
  let dropped = 0;
  while (trimmed.length > 0) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
      return { saved: true, dropped };
    } catch {
      trimmed.pop();
      dropped++;
    }
  }
  try { localStorage.removeItem(HISTORY_KEY); } catch {}
  return { saved: false, dropped };
}

export function saveToHistory(item: HistoryItem): void {
  const history = getHistory();
  history.unshift(item);
  const { dropped } = persistHistory(history);
  if (dropped > 0) {
    console.warn(`[history] localStorage quota exceeded — dropped ${dropped} oldest item${dropped > 1 ? 's' : ''}.`);
  }
}

export function saveBatchToHistory(items: HistoryItem[]): void {
  const history = getHistory();
  history.unshift(...items);
  const { dropped } = persistHistory(history);
  if (dropped > 0) {
    console.warn(`[history] localStorage quota exceeded — dropped ${dropped} oldest item${dropped > 1 ? 's' : ''}.`);
  }
}

export function removeFromHistory(id: string): void {
  const history = getHistory().filter(item => item.id !== id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}

export interface HistoryExportPayload {
  type: 'banner_pro_history';
  version: 1;
  exportedAt: number;
  count: number;
  items: HistoryItem[];
}

export function exportHistoryAsJson(): string {
  const payload: HistoryExportPayload = {
    type: 'banner_pro_history',
    version: 1,
    exportedAt: Date.now(),
    count: getHistory().length,
    items: getHistory(),
  };
  return JSON.stringify(payload, null, 2);
}

function isValidHistoryItem(x: any): x is HistoryItem {
  return (
    x && typeof x === 'object' &&
    typeof x.id === 'string' &&
    typeof x.imageUrl === 'string' &&
    typeof x.timestamp === 'number'
  );
}

function parseHistoryJson(json: string): HistoryItem[] {
  const raw = JSON.parse(json);
  const items: any[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.items)
      ? raw.items
      : [];
  return items.filter(isValidHistoryItem);
}

export interface ImportHistoryResult {
  added: number;
  skipped: number;
  total: number;
}

export function importHistoryItems(
  items: HistoryItem[],
  mode: 'merge' | 'replace' = 'merge',
): ImportHistoryResult {
  if (mode === 'replace') {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
    return { added: items.length, skipped: 0, total: items.length };
  }
  const existing = getHistory();
  const seen = new Set(existing.map(i => i.id));
  let skipped = 0;
  const fresh: HistoryItem[] = [];
  for (const it of items) {
    if (seen.has(it.id)) { skipped++; continue; }
    seen.add(it.id);
    fresh.push(it);
  }
  const merged = [...fresh, ...existing].sort((a, b) => b.timestamp - a.timestamp);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
  return { added: fresh.length, skipped, total: merged.length };
}

export function importHistoryFromJson(
  json: string,
  mode: 'merge' | 'replace' = 'merge',
): ImportHistoryResult {
  const items = parseHistoryJson(json);
  return importHistoryItems(items, mode);
}

export function getEmbeddedHistoryCount(): number {
  return EMBEDDED_HISTORY.length;
}

export function importEmbeddedHistory(
  mode: 'merge' | 'replace' = 'merge',
): ImportHistoryResult {
  return importHistoryItems(EMBEDDED_HISTORY as HistoryItem[], mode);
}

export function getLibrary(category: LibraryCategory): LibraryImage[] {
  try {
    const data = localStorage.getItem(LIBRARY_KEY_PREFIX + category);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function persistLibrary(category: LibraryCategory, items: LibraryImage[]): boolean {
  // Drop oldest entries until it fits within the localStorage quota.
  let trimmed = [...items];
  while (trimmed.length > 0) {
    try {
      localStorage.setItem(LIBRARY_KEY_PREFIX + category, JSON.stringify(trimmed));
      return true;
    } catch {
      trimmed.pop();
    }
  }
  try { localStorage.removeItem(LIBRARY_KEY_PREFIX + category); } catch {}
  return false;
}

export function addToLibrary(category: LibraryCategory, item: LibraryImage): LibraryImage[] {
  const lib = getLibrary(category);
  if (lib.some(x => x.base64 === item.base64)) return lib;
  const next = [item, ...lib].slice(0, MAX_LIBRARY_ITEMS);
  persistLibrary(category, next);
  return getLibrary(category);
}

export function removeFromLibrary(category: LibraryCategory, id: string): LibraryImage[] {
  const next = getLibrary(category).filter(x => x.id !== id);
  persistLibrary(category, next);
  return next;
}

export function getBrandLibrary(): BrandSnippet[] {
  try {
    const data = localStorage.getItem(BRAND_LIBRARY_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function addToBrandLibrary(content: string): BrandSnippet[] {
  const trimmed = content.trim();
  if (!trimmed) return getBrandLibrary();
  const lib = getBrandLibrary();
  if (lib.some(x => x.content === trimmed)) return lib;
  const next = [
    { id: Math.random().toString(36).substring(7), content: trimmed, addedAt: Date.now() },
    ...lib,
  ].slice(0, MAX_BRAND_ITEMS);
  try { localStorage.setItem(BRAND_LIBRARY_KEY, JSON.stringify(next)); } catch {}
  return next;
}

export function removeFromBrandLibrary(id: string): BrandSnippet[] {
  const next = getBrandLibrary().filter(x => x.id !== id);
  try { localStorage.setItem(BRAND_LIBRARY_KEY, JSON.stringify(next)); } catch {}
  return next;
}

export function getBrandProjects(): BrandProject[] {
  try {
    const data = localStorage.getItem(BRAND_PROJECTS_KEY);
    if (!data) return [];
    const raw = JSON.parse(data) as any[];
    return raw.map((p) => ({
      ...p,
      styleReferences: p.styleReferences ?? p.references ?? [],
      productReferences: p.productReferences ?? [],
    })) as BrandProject[];
  } catch {
    return [];
  }
}

export function saveBrandProject(project: BrandProject): BrandProject[] {
  const projects = getBrandProjects();
  const idx = projects.findIndex(p => p.id === project.id);
  const next = [...projects];
  if (idx >= 0) next[idx] = { ...project, updatedAt: Date.now() };
  else next.unshift(project);
  try {
    localStorage.setItem(BRAND_PROJECTS_KEY, JSON.stringify(next));
  } catch (e) {
    throw new Error('Brand project too large for local storage. Try fewer or smaller images.');
  }
  return next;
}

export function deleteBrandProject(id: string): BrandProject[] {
  const next = getBrandProjects().filter(p => p.id !== id);
  try { localStorage.setItem(BRAND_PROJECTS_KEY, JSON.stringify(next)); } catch {}
  return next;
}

// ---------- Voted banners (training feedback) ----------

export function getVotedBanners(): VotedBanner[] {
  try {
    const data = localStorage.getItem(VOTES_KEY);
    return data ? (JSON.parse(data) as VotedBanner[]) : [];
  } catch {
    return [];
  }
}

function persistVotes(items: VotedBanner[]): boolean {
  let trimmed = [...items];
  while (trimmed.length > 0) {
    try {
      localStorage.setItem(VOTES_KEY, JSON.stringify(trimmed));
      return true;
    } catch {
      trimmed.pop();
    }
  }
  try { localStorage.removeItem(VOTES_KEY); } catch {}
  return false;
}

export function isVoted(id: string): boolean {
  return getVotedBanners().some(v => v.id === id);
}

export function addVotedBanner(banner: VotedBanner): VotedBanner[] {
  const all = getVotedBanners();
  if (all.some(v => v.id === banner.id)) return all;
  const next = [banner, ...all].slice(0, MAX_VOTED_BANNERS);
  persistVotes(next);
  return getVotedBanners();
}

export function removeVotedBanner(id: string): VotedBanner[] {
  const next = getVotedBanners().filter(v => v.id !== id);
  persistVotes(next);
  return next;
}

export function clearVotedBanners(): void {
  try { localStorage.removeItem(VOTES_KEY); } catch {}
}

export function getLearnFromVotes(): boolean {
  return localStorage.getItem(LEARN_FROM_VOTES_KEY) === '1';
}

export function setLearnFromVotes(on: boolean): void {
  localStorage.setItem(LEARN_FROM_VOTES_KEY, on ? '1' : '0');
}
