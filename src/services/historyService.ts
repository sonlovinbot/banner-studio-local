import { HistoryItem, FeatureType } from '../types';
import { historyFeatureScope, OWN_TAB_ONLY } from './historyFeatureScope';
import { getSupabase } from './supabaseClient';
import { uploadDataUrlToStorage } from './uploadService';
import { PAGE_SIZE, rangeFor, totalPagesFor, clampPage } from './pagination';

function rowToItem(row: any): HistoryItem {
  return {
    id: row.id,
    imageUrl: row.image_url,
    promptUsed: row.prompt_used || '',
    timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    duration: row.duration ?? undefined,
    model: row.model || '',
    quality: row.quality || '1K',
    aspectRatio: row.aspect_ratio || '1:1',
    parentId: row.parent_id || undefined,
    version: row.version ?? 1,
    featureType: (row.feature_type as FeatureType) || 'banner',
    sessionId: row.session_id || undefined,
    isFavorite: row.is_favorite === true,
    genParams: row.gen_params || undefined,
  };
}

function itemToRow(item: HistoryItem, userId: string) {
  return {
    ...(favoritesEnabled() ? { is_favorite: item.isFavorite === true } : {}),
    id: item.id,
    user_id: userId,
    image_url: item.imageUrl,
    prompt_used: item.promptUsed,
    duration: item.duration ?? null,
    model: item.model || null,
    quality: item.quality || null,
    aspect_ratio: item.aspectRatio || null,
    parent_id: item.parentId || null,
    version: item.version ?? 1,
    feature_type: item.featureType || 'banner',
    session_id: item.sessionId || null,

    gen_params: item.genParams ?? null,
    created_at: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
  };
}

async function requireUserId(): Promise<string> {
  const { data: { user } } = await getSupabase().auth.getUser();
  if (!user) throw new Error('Chưa đăng nhập');
  return user.id;
}

export async function listHistoryFromCloud(): Promise<HistoryItem[]> {
  try {
    // Verify the session is present BEFORE issuing the RLS-protected query.
    // Without a session, RLS returns 0 rows silently (not an error) which
    // looks identical to "user has no history yet" — that ambiguity is
    // exactly the bug we surfaced. Refresh the session if we can.
    const sb = getSupabase();
    const { data: sess } = await sb.auth.getSession();
    if (!sess.session) {
      console.warn('[history] no session — attempting refresh');
      await sb.auth.refreshSession();
    }

    // Do NOT SELECT gen_params here. It stores full ref-image snapshots
    // (base64 refs can hit ~3-4 MB per row) — pulling it for the full list
    // hits statement_timeout on tables of any real size. gen_params is
    // fetched on demand by getHistoryDetailFromCloud when the user edits
    // a specific item.
    const cols = listCols();
    const { data, error } = await sb
      .from('banner_history')
      .select(cols)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    return (data || []).map(rowToItem);
  } catch (e: any) {
    console.warn('listHistoryFromCloud failed', e);
    throw new Error(e?.message || 'listHistoryFromCloud failed');
  }
}

/** Cột dùng cho mọi query danh sách. Không bao giờ SELECT gen_params ở đây —
 *  cột đó chứa snapshot ref-image (có row ~3-4 MB), kéo cả list là dính
 *  statement_timeout. Chỉ getHistoryDetailFromCloud mới lấy nó. */
const BASE_LIST_COLS = 'id, image_url, prompt_used, duration, model, quality, aspect_ratio, parent_id, version, feature_type, session_id, created_at';

/** `is_favorite` chỉ tồn tại sau migration sprint-history-favorites.sql. Nếu
 *  DB chưa chạy migration mà ta cứ SELECT cột đó thì Postgres trả 42703 và
 *  TOÀN BỘ History chết — nặng hơn nhiều so với việc tạm mất tính năng sao.
 *  Nên dò một lần rồi nhớ kết quả, thiếu cột thì degrade chứ không sập. */
let favoritesColumn: 'unknown' | 'yes' | 'no' = 'unknown';

function isMissingFavoriteColumn(error: any): boolean {
  if (!error) return false;
  if (error.code === '42703') return true;
  return /is_favorite/.test(error.message || '') && /column|does not exist/i.test(error.message || '');
}

export function favoritesEnabled(): boolean {
  return favoritesColumn !== 'no';
}

function listCols(): string {
  return favoritesColumn === 'no' ? BASE_LIST_COLS : `${BASE_LIST_COLS}, is_favorite`;
}

const LIST_COLS = BASE_LIST_COLS;
void LIST_COLS;

/** Session phải sẵn sàng TRƯỚC khi bắn query RLS: không session thì RLS trả
 *  0 row im lặng, nhìn y hệt "user chưa có banner nào". */
async function ensureSession(): Promise<void> {
  const sb = getSupabase();
  const { data: sess } = await sb.auth.getSession();
  if (!sess.session) {
    console.warn('[history] no session — attempting refresh');
    await sb.auth.refreshSession();
  }
}

export interface HistoryPageResult {
  items: HistoryItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ListHistoryPageOpts {
  page?: number;
  pageSize?: number;
  featureType?: FeatureType | 'all';
  /** Tìm trong prompt / model / tỉ lệ. Rỗng = không lọc. */
  search?: string;
  /** Chỉ lấy banner đã đánh sao (tab Yêu thích). */
  favoritesOnly?: boolean;
}

/** Escape ký tự đặc biệt của PostgREST or()/ilike để chuỗi tìm kiếm của user
 *  không phá cú pháp filter. Dấu phẩy và ngoặc là ký tự phân cách của or(). */
function sanitizeSearch(raw: string): string {
  return raw.trim().replace(/[,()\\]/g, ' ').replace(/\s+/g, ' ').slice(0, 100);
}

/** Một trang history. Trả cả tổng số row nên caller dựng được pager mà không
 *  cần query đếm riêng. */
export async function listHistoryPage(opts: ListHistoryPageOpts = {}): Promise<HistoryPageResult> {
  const pageSize = opts.pageSize && opts.pageSize > 0 ? opts.pageSize : PAGE_SIZE;
  const requestedPage = Math.max(1, Math.trunc(opts.page || 1));

  try {
    await ensureSession();

    const runQuery = async (page: number) => {
      const { from, to } = rangeFor(page, pageSize);
      let q = getSupabase()
        .from('banner_history')
        .select(listCols(), { count: 'exact' });

      const scope = historyFeatureScope(opts.featureType || 'all');
      q = 'include' in scope
        ? q.eq('feature_type', scope.include)
        : q.not('feature_type', 'in', `(${scope.excludeMany.join(',')})`);
      if (opts.favoritesOnly) {
        q = q.eq('is_favorite', true);
      }
      const search = opts.search ? sanitizeSearch(opts.search) : '';
      if (search) {
        q = q.or(`prompt_used.ilike.%${search}%,model.ilike.%${search}%,aspect_ratio.ilike.%${search}%`);
      }

      return q.order('created_at', { ascending: false }).range(from, to);
    };

    let { data, error, count } = await runQuery(requestedPage);
    if (error && isMissingFavoriteColumn(error)) {
      console.warn('[history] cột is_favorite chưa có — chạy db/sprint-history-favorites.sql để bật tab Yêu thích. Tạm ẩn tính năng.');
      favoritesColumn = 'no';
      ({ data, error, count } = await runQuery(requestedPage));
    } else if (!error && favoritesColumn === 'unknown') {
      favoritesColumn = 'yes';
    }
    if (error) throw error;

    const total = count ?? 0;
    const totalPages = totalPagesFor(total, pageSize);

    // ?page=999 hoặc vừa xoá hết row của trang cuối → nhảy về trang hợp lệ
    // và fetch lại, thay vì hiện lưới rỗng.
    const page = clampPage(requestedPage, totalPages);
    if (page !== requestedPage && total > 0) {
      const retry = await runQuery(page);
      if (retry.error) throw retry.error;
      data = retry.data;
    }

    return {
      items: (data || []).map(rowToItem),
      total,
      page,
      pageSize,
      totalPages,
    };
  } catch (e: any) {
    console.warn('listHistoryPage failed', e);
    throw new Error(e?.message || 'listHistoryPage failed');
  }
}

/** Bật/tắt sao cho 1 banner. Trả về trạng thái mới để caller cập nhật UI
 *  ngay mà không phải fetch lại. */
export async function setHistoryFavorite(id: string, favorite: boolean): Promise<boolean> {
  const { error } = await getSupabase()
    .from('banner_history')
    .update({ is_favorite: favorite })
    .eq('id', id);
  if (error) {
    if (isMissingFavoriteColumn(error)) {
      favoritesColumn = 'no';
      throw new Error('Chưa bật tính năng Yêu thích — chạy db/sprint-history-favorites.sql trên Supabase.');
    }
    throw error;
  }
  return favorite;
}

/** Đếm nhanh số banner đã đánh sao. Dùng để quyết định tab mặc định khi user
 *  mở History mà chưa chọn tab nào. */
export async function countFavorites(): Promise<number> {
  if (!favoritesEnabled()) return 0;
  const { count, error } = await getSupabase()
    .from('banner_history')
    .select('id', { count: 'exact', head: true })
    .neq('feature_type', 'mcp_banner')
    .eq('is_favorite', true);
  if (error) {
    if (isMissingFavoriteColumn(error)) { favoritesColumn = 'no'; return 0; }
    throw error;
  }
  return count ?? 0;
}

/** Nạp banner theo id. Dùng ở AdsManagerPage: creative gắn banner cũ nằm
 *  ngoài trang đang xem vẫn phải resolve được ảnh, nếu không thumbnail vỡ. */
export async function getHistoryByIds(ids: string[]): Promise<HistoryItem[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return [];
  const CHUNK = 100;
  const out: HistoryItem[] = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await getSupabase()
      .from('banner_history')
      .select(listCols())
      .in('id', unique.slice(i, i + CHUNK));
    if (error) throw error;
    out.push(...(data || []).map(rowToItem));
  }
  return out;
}

/** Số đếm cho từng tab History. */
export type FeatureCounts = Record<'all' | FeatureType | 'favorite', number>;

/** Số đếm cho tab filter. Phải query riêng — đếm trong mảng của trang hiện
 *  tại chỉ ra tối đa pageSize, không phải tổng thật. */
export async function countHistoryByFeature(): Promise<FeatureCounts> {
  await ensureSession();
  const sb = getSupabase();
  const countFor = async (opts: { featureType?: FeatureType | 'all'; favorite?: boolean } = {}) => {
    let q = sb.from('banner_history').select('id', { count: 'exact', head: true });
    if (opts.featureType) {
      const scope = historyFeatureScope(opts.featureType);
      q = 'include' in scope
        ? q.eq('feature_type', scope.include)
        : q.not('feature_type', 'in', `(${scope.excludeMany.join(',')})`);
    }
    if (opts.favorite) q = q.eq('is_favorite', true).not('feature_type', 'in', `(${OWN_TAB_ONLY.join(',')})`);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  };
  const [all, banner, ugc, imageStudio, mcpBanner, favorite] = await Promise.all([
    countFor({ featureType: 'all' }),
    countFor({ featureType: 'banner' }),
    countFor({ featureType: 'ugc' }),
    countFor({ featureType: 'image_studio' }),
    countFor({ featureType: 'mcp_banner' }),
    favoritesEnabled() ? countFor({ favorite: true }).catch(() => 0) : Promise.resolve(0),
  ]);
  return { all, banner, ugc, image_studio: imageStudio, mcp_banner: mcpBanner, favorite } as FeatureCounts;
}

/** Đếm bản chỉnh sửa cho từng banner trong trang hiện tại (badge "+N edits").
 *  Một query cho cả trang thay vì N query. */
export async function countChildrenFor(parentIds: string[]): Promise<Record<string, number>> {
  const unique = Array.from(new Set(parentIds.filter(Boolean)));
  if (unique.length === 0) return {};
  const { data, error } = await getSupabase()
    .from('banner_history')
    .select('parent_id')
    .in('parent_id', unique);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data || []) {
    const pid = (row as any).parent_id;
    if (pid) counts[pid] = (counts[pid] || 0) + 1;
  }
  return counts;
}

/** Fetch the full row (including bulky gen_params) for a single history item.
 *  Use this when the user opens the edit modal — never load gen_params for
 *  every row in the list. */
export async function getHistoryDetailFromCloud(id: string): Promise<HistoryItem | null> {
  const { data, error } = await getSupabase()
    .from('banner_history')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToItem(data) : null;
}

export async function addHistoryToCloud(item: HistoryItem): Promise<HistoryItem> {
  const userId = await requireUserId();

  // If image is a data: URL (Gemini), persist it to storage local first
  let imageUrl = item.imageUrl;
  if (imageUrl.startsWith('data:')) {
    const uploaded = await uploadDataUrlToStorage(imageUrl, `banner-${item.id}.png`, 'banners');
    imageUrl = uploaded.url;
  }

  const persisted: HistoryItem = { ...item, imageUrl };
  const row = itemToRow(persisted, userId);

  const { error } = await getSupabase().from('banner_history').insert(row);
  if (error) throw error;
  return persisted;
}

export async function removeHistoryFromCloud(id: string): Promise<void> {
  const { error } = await getSupabase().from('banner_history').delete().eq('id', id);
  if (error) throw error;
}

export async function clearHistoryInCloud(): Promise<void> {
  const userId = await requireUserId();
  const { error } = await getSupabase().from('banner_history').delete().eq('user_id', userId);
  if (error) throw error;
}

// ─────────── Session grouping ───────────

/** A group of history items generated in one Generate click (same
 *  sessionId, or bucketed by close timestamps if sessionId is missing). */
export interface HistorySession {
  key: string;              // sessionId if available, else "ts-<bucketStart>"
  startedAt: number;        // earliest timestamp in the group
  items: HistoryItem[];     // chronological, oldest first within the session
  featureType: FeatureType; // majority feature type in the group
}

/** Client-side bucketing. Rules:
 *   - Same non-empty sessionId → same group.
 *   - Otherwise: items within GAP_MS of each other (same featureType) merge.
 *  Input is expected in descending time order (as returned by listHistoryFromCloud).
 *  Output is descending time order of sessions (newest first). */
const SESSION_GAP_MS = 2 * 60 * 1000; // 2 minutes

export function bucketIntoSessions(items: HistoryItem[]): HistorySession[] {
  if (items.length === 0) return [];
  // Work with a shallow copy sorted ascending so bucketing is intuitive.
  const asc = [...items].sort((a, b) => a.timestamp - b.timestamp);
  const sessions: HistorySession[] = [];
  let current: HistorySession | null = null;

  for (const it of asc) {
    const feat = it.featureType || 'banner';
    if (!current) {
      current = { key: it.sessionId || `ts-${it.timestamp}`, startedAt: it.timestamp, items: [it], featureType: feat };
      continue;
    }
    const sameSessionId = it.sessionId && current.items[0]?.sessionId === it.sessionId;
    const sameFeature   = feat === current.featureType;
    const withinGap     = it.timestamp - current.items[current.items.length - 1].timestamp <= SESSION_GAP_MS;
    if (sameSessionId || (sameFeature && withinGap)) {
      current.items.push(it);
    } else {
      sessions.push(current);
      current = { key: it.sessionId || `ts-${it.timestamp}`, startedAt: it.timestamp, items: [it], featureType: feat };
    }
  }
  if (current) sessions.push(current);

  // Return newest first.
  return sessions.sort((a, b) => b.startedAt - a.startedAt);
}

export async function bulkAddHistoryToCloud(items: HistoryItem[]): Promise<{ inserted: number; skipped: number }> {
  if (items.length === 0) return { inserted: 0, skipped: 0 };
  const userId = await requireUserId();
  const rows = items.map(i => itemToRow(i, userId));
  // upsert by id to skip duplicates
  const { data, error } = await getSupabase()
    .from('banner_history')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
    .select('id');
  if (error) throw error;
  const inserted = data?.length ?? 0;
  return { inserted, skipped: rows.length - inserted };
}
