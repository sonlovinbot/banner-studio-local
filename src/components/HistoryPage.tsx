import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Download, Maximize2, X, Trash2, Clock, AlertTriangle, Upload, FileJson, Database, Wand2, Cloud, Loader2, Sparkles, Star } from 'lucide-react';
import { HistoryItem, AppPage, FeatureType } from '../types';
import { HistoryEditModal, BackgroundRegenParams } from './HistoryEditModal';
import { proxiedBannerUrl } from '../services/cdnProxy';
import {
  startBackgroundRegen, readPendingRegenTasks, removePendingRegenTask,
  pendingToHistoryPlaceholder, REGEN_EVENT, PendingRegenTask,
} from '../services/regenService';
import { describeGenError } from '../services/genErrors';
import {
  getHistory,
  getEmbeddedHistoryCount,
  exportHistoryAsJson,
} from '../services/storageService';
import {
  listHistoryFromCloud,
  listHistoryPage,
  countHistoryByFeature,
  countChildrenFor,
  countFavorites,
  setHistoryFavorite,
  favoritesEnabled,
  FeatureCounts,
  removeHistoryFromCloud,
  clearHistoryInCloud,
  bulkAddHistoryToCloud,
} from '../services/historyService';
import { Pagination } from './Pagination';
import { useRoute, setRouteParams } from '../services/router';
import { PAGE_SIZE } from '../services/pagination';
import { EMBEDDED_HISTORY } from '../appdata/embeddedHistory';

/** Tab của History: filter theo tool, cộng thêm tab Yêu thích. */
type HistoryTab = 'all' | FeatureType | 'favorite';

const TAB_LABELS: Record<string, string> = {
  all: 'Tất cả',
  favorite: 'Yêu thích',
  banner: 'Banner',
  ugc: 'UGC',
  image_studio: 'Image Studio',
  mcp_banner: 'Banner MCP',
};

interface HistoryPageProps {
  onNavigate: (page: AppPage) => void;
}

export const HistoryPage: React.FC<HistoryPageProps> = ({ onNavigate }) => {
  const [items, setItems] = useState<HistoryItem[]>([]);

  // Trang + filter sống trong URL: F5 hoặc share link đều giữ đúng chỗ đang
  // xem. `?page=1` và `?type=all` không ghi vào URL cho gọn.
  const { params } = useRoute();
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
  const featureFilter = ((params.get('type') as HistoryTab | null) || 'all') as HistoryTab;
  const isFavoriteTab = featureFilter === 'favorite';
  const setPage = (p: number) => {
    setRouteParams({ page: p === 1 ? '' : p });
    // Pager nằm dưới đáy lưới — không cuộn lên thì sang trang mới user vẫn
    // đang đứng ở cuối trang, tưởng như chưa có gì đổi.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const setFeatureFilter = (f: HistoryTab) => {
    tabChosenRef.current = true; // user đã tự chọn — thôi auto-mở tab Yêu thích
    setRouteParams({ type: f === 'all' ? '' : f, page: '' }); // đổi tab luôn về trang 1
  };

  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [featureCounts, setFeatureCounts] = useState<FeatureCounts | null>(null);
  // Tắt khi DB chưa chạy migration favorites — thà ẩn tab còn hơn để tab chết.
  const [favEnabled, setFavEnabled] = useState(true);
  const [childCounts, setChildCounts] = useState<Record<string, number>>({});
  const [selectedImage, setSelectedImage] = useState<HistoryItem | null>(null);
  const [editTarget, setEditTarget] = useState<HistoryItem | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string; action?: { label: string; onClick: () => void } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const embeddedCount = getEmbeddedHistoryCount();
  const localCount = getHistory().length;

  const [fetchError, setFetchError] = useState<string | null>(null);

  // Pending regen tasks — cross-page, cross-tab source. Poll localStorage
  // (both from a REGEN_EVENT dispatch inside this tab and a storage event
  // from other tabs) so a task started in BannerTool shows up here too.
  const [pending, setPending] = useState<PendingRegenTask[]>(() => readPendingRegenTasks());
  useEffect(() => {
    const refreshPending = () => setPending(readPendingRegenTasks());
    window.addEventListener(REGEN_EVENT, refreshPending);
    window.addEventListener('storage', refreshPending);
    const interval = setInterval(refreshPending, 3000); // fallback poll
    return () => {
      window.removeEventListener(REGEN_EVENT, refreshPending);
      window.removeEventListener('storage', refreshPending);
      clearInterval(interval);
    };
  }, []);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await listHistoryPage({
        page,
        pageSize: PAGE_SIZE,
        featureType: isFavoriteTab ? 'all' : (featureFilter as FeatureType | 'all'),
        favoritesOnly: isFavoriteTab,
      });
      setItems(res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages);
      setFavEnabled(favoritesEnabled());
      // Server kẹp ?page=999 về trang cuối — đồng bộ lại URL để nút pager
      // và địa chỉ khớp nhau.
      if (res.page !== page) setRouteParams({ page: res.page === 1 ? '' : res.page }, { replace: true });

      // Badge "+N edits" đếm theo trang hiện tại, một query cho cả trang.
      countChildrenFor(res.items.map(i => i.id))
        .then(setChildCounts)
        .catch(e => console.warn('countChildrenFor failed', e));
    } catch (e: any) {
      setFetchError(e?.message || 'Không tải được history từ cloud');
    } finally {
      setLoading(false);
    }
  }, [page, featureFilter, isFavoriteTab]);

  useEffect(() => { refresh(); }, [refresh]);

  // Lần đầu vào History mà URL chưa chỉ định tab: đã có banner yêu thích thì
  // mở thẳng tab Yêu thích, chưa có thì ở lại Tất cả. Chỉ chạy một lần, và
  // không chạy nữa khi user đã tự bấm tab.
  const tabChosenRef = useRef(params.get('type') !== null);
  useEffect(() => {
    if (tabChosenRef.current) return;
    tabChosenRef.current = true;
    let cancelled = false;
    countFavorites()
      .then(n => { if (!cancelled && n > 0) setRouteParams({ type: 'favorite' }, { replace: true }); })
      .catch(e => console.warn('countFavorites failed', e));
    return () => { cancelled = true; };
  }, []);

  /** Bật/tắt sao. Cập nhật UI ngay rồi mới ghi DB; lỗi thì trả lại trạng thái
   *  cũ để không hiện sai. Ở tab Yêu thích, bỏ sao thì gỡ luôn khỏi lưới. */
  const toggleFavorite = async (item: HistoryItem) => {
    const next = !item.isFavorite;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, isFavorite: next } : i));
    try {
      await setHistoryFavorite(item.id, next);
      refreshCounts();
      if (isFavoriteTab && !next) {
        setItems(prev => prev.filter(i => i.id !== item.id));
        setTotal(t => Math.max(0, t - 1));
      }
    } catch (e: any) {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, isFavorite: !next } : i));
      setToast({ kind: 'err', msg: `Lưu yêu thích lỗi: ${e?.message || 'unknown'}` });
    }
  };

  // Số đếm trên tab phải là tổng thật, không phải số row của trang đang xem.
  const refreshCounts = React.useCallback(() => {
    countHistoryByFeature().then(setFeatureCounts).catch(e => console.warn('countHistoryByFeature failed', e));
  }, []);
  useEffect(() => { refreshCounts(); }, [refreshCounts]);

  /** User submits background regen from the modal → modal closes → task
   *  runs, refreshing the history grid on success. Loading/error state
   *  shows immediately as a pending tile. */
  const handleBackgroundRegen = React.useCallback((params: BackgroundRegenParams) => {
    const { item, prompt: adj, extras, aspectRatios, quality: qual } = params;
    const rootParentId = item.parentId || item.id;
    const nextVersion = (item.version ?? 1) + 1;
    const sessionId = `edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    aspectRatios.forEach(ar => {
      startBackgroundRegen({
        sourceItemId: item.id,
        sourceImageUrl: item.imageUrl,
        sourceModel: item.model,
        sourcePromptUsed: item.promptUsed,
        sourceParentId: rootParentId,
        sourceVersion: nextVersion,
        sourceFeatureType: (item.featureType as any) || 'banner',
        sourceAspectRatio: item.aspectRatio,
        prompt: adj,
        aspectRatio: ar,
        quality: qual,
        sessionId,
      }, {
        extras,
        callbacks: {
          onPlaceholder: () => setPending(readPendingRegenTasks()),
          onSuccess: () => { refresh(); refreshCounts(); setPending(readPendingRegenTasks()); },
          onError: () => setPending(readPendingRegenTasks()),
          onNotice: (_id, msg) => setToast({ kind: 'ok', msg }),
        },
      });
    });
  }, [refresh, refreshCounts]);

  // Đếm từ server cho đúng trang — đếm trong `items` chỉ thấy tối đa 40 row
  // nên bản chỉnh sửa nằm ở trang khác sẽ không được tính.
  const childCount = (id: string) => childCounts[id] || 0;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  /** Export phải lấy TOÀN BỘ history, không phải 40 item của trang đang xem. */
  const handleExport = async () => {
    if (total === 0) return;
    setToast({ kind: 'ok', msg: 'Đang chuẩn bị file export…' });
    try {
      const all = await listHistoryFromCloud();
      const payload = JSON.stringify({
        type: 'banner_pro_history', version: 1, exportedAt: Date.now(),
        count: all.length, items: all,
      }, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `banner-history-${stamp}-${all.length}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setToast({ kind: 'ok', msg: `Đã xuất ${all.length} banner` });
    } catch (e: any) {
      setToast({ kind: 'err', msg: `Export lỗi: ${e?.message || 'unknown'}` });
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const incoming: HistoryItem[] = Array.isArray(raw) ? raw : (raw.items || []);
      const result = await bulkAddHistoryToCloud(incoming);
      await refresh(); refreshCounts();
      setToast({ kind: 'ok', msg: `Import ${file.name}: +${result.inserted} item, bỏ qua ${result.skipped} trùng` });
    } catch (e: any) {
      setToast({ kind: 'err', msg: `Import lỗi: ${e?.message || 'JSON không hợp lệ'}` });
    }
  };

  const handleRestoreSnapshot = async () => {
    try {
      const result = await bulkAddHistoryToCloud(EMBEDDED_HISTORY);
      await refresh(); refreshCounts();
      setToast({ kind: 'ok', msg: `Snapshot: +${result.inserted} item, bỏ qua ${result.skipped} trùng` });
    } catch (e: any) {
      setToast({ kind: 'err', msg: `Snapshot lỗi: ${e?.message || 'unknown'}` });
    }
  };

  const handleMigrateLocal = async () => {
    setMigrating(true);
    try {
      const local = getHistory();
      if (local.length === 0) {
        setToast({ kind: 'ok', msg: 'Local không có banner cũ để migrate' });
        return;
      }
      const result = await bulkAddHistoryToCloud(local);
      await refresh(); refreshCounts();
      setToast({ kind: 'ok', msg: `Migrate local: +${result.inserted} item lên cloud, bỏ qua ${result.skipped} trùng` });
    } catch (e: any) {
      setToast({ kind: 'err', msg: `Migrate lỗi: ${e?.message || 'unknown'}` });
    } finally {
      setMigrating(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await removeHistoryFromCloud(id);
      setItems(prev => prev.filter(item => item.id !== id));
      setTotal(t => Math.max(0, t - 1));
      refreshCounts();
    } catch (e: any) {
      setToast({ kind: 'err', msg: `Xoá lỗi: ${e?.message}` });
    }
  };

  const handleClearAll = async () => {
    try {
      await clearHistoryInCloud();
      setItems([]);
      setTotal(0);
      setTotalPages(1);
      refreshCounts();
      setShowClearConfirm(false);
    } catch (e: any) {
      setToast({ kind: 'err', msg: `Clear lỗi: ${e?.message}` });
    }
  };

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleString('vi-VN', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <div className="min-h-screen bg-canvas text-fg flex flex-col">
      {/* Header */}
      <header className="border-b border-line bg-surface/80 backdrop-blur-sm sticky top-14 z-20">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => onNavigate('menu')}
              className="p-2 rounded-lg hover:bg-raised transition-colors text-muted hover:text-fg"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="flex items-center gap-3">
              <Clock size={20} className="text-success" />
              <h1 className="text-lg font-bold text-fg">History</h1>
              <span className="text-xs text-success bg-success-soft border border-success-fg/40 px-2 py-1 rounded-full inline-flex items-center gap-1">
                <Cloud size={11} /> {loading ? '...' : total} cloud
              </span>
              {/* {localCount} local badge hidden after migration done */}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Migrate local button hidden — migration done */}
            {false && localCount > 0 && (
              <button
                onClick={handleMigrateLocal}
                disabled={migrating}
                className="text-xs text-warning hover:text-warning hover:bg-warning-soft px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 border border-warning-fg/40 disabled:opacity-50"
              >
                {migrating ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}
                Migrate local ({localCount})
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportFile(f);
                e.target.value = '';
              }}
            />
            {/* Restore snapshot button hidden */}
            {false && embeddedCount > 0 && (
              <button
                onClick={handleRestoreSnapshot}
                className="text-xs text-success hover:text-success hover:bg-success-soft px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 border border-success-fg/40"
              >
                <Database size={14} /> Restore snapshot
                <span className="text-[10px] bg-success-soft text-success px-1.5 py-0.5 rounded-full">{embeddedCount}</span>
              </button>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-xs text-info hover:text-info hover:bg-info-soft px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5"
              title="Import từ file JSON"
            >
              <Upload size={14} /> Import
            </button>
            {total > 0 && (
              <button
                onClick={handleExport}
                className="text-xs text-brand hover:text-brand hover:bg-canvas px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5"
                title="Export toàn bộ history ra file JSON"
              >
                <FileJson size={14} /> Export
              </button>
            )}
            {total > 0 && (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="text-xs text-danger hover:text-danger hover:bg-danger-soft px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Trash2 size={14} /> Clear All
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Feature tabs */}
      <div className="max-w-7xl mx-auto w-full px-6 pt-4 flex items-center gap-2">
        {favEnabled && (
          <FeatureTab
            active={featureFilter === 'favorite'}
            onClick={() => setFeatureFilter('favorite')}
            label="Yêu thích"
            count={featureCounts?.favorite ?? 0}
            icon={<Star size={12} className={featureFilter === 'favorite' ? 'fill-current' : ''} />}
          />
        )}
        <FeatureTab
          active={featureFilter === 'all'}
          onClick={() => setFeatureFilter('all')}
          label="Tất cả"
          count={featureCounts?.all ?? 0}
        />
        <FeatureTab
          active={featureFilter === 'banner'}
          onClick={() => setFeatureFilter('banner')}
          label="Banner"
          count={featureCounts?.banner ?? 0}
        />
        <FeatureTab
          active={featureFilter === 'ugc'}
          onClick={() => setFeatureFilter('ugc')}
          label="UGC"
          count={featureCounts?.ugc ?? 0}
        />
        <FeatureTab
          active={featureFilter === 'image_studio'}
          onClick={() => setFeatureFilter('image_studio')}
          label="Image Studio"
          count={featureCounts?.image_studio ?? 0}
        />
        <FeatureTab
          active={featureFilter === 'mcp_banner'}
          onClick={() => setFeatureFilter('mcp_banner')}
          label="Banner MCP"
          count={featureCounts?.mcp_banner ?? 0}
          icon={<Sparkles size={12} />}
        />
      </div>

      {/* Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-6">
        {fetchError ? (
          <div className="flex flex-col items-center justify-center h-[60vh] text-subtle">
            <div className="w-20 h-20 border-4 border-danger-fg/40 border-dashed rounded-xl mb-4 opacity-60"></div>
            <p className="text-lg mb-2 text-danger">Không load được history</p>
            <p className="text-sm text-subtle max-w-md text-center px-4">{fetchError}</p>
            <p className="text-xs text-subtle mt-3 max-w-md text-center px-4">
              Thường do session token đã hết hạn. Thử logout rồi login lại.
            </p>
            <div className="mt-6 flex gap-2">
              <button
                onClick={refresh}
                className="bg-brand hover:bg-brand-dark text-white px-6 py-2 rounded-lg text-sm"
              >
                Thử lại
              </button>
              <button
                onClick={async () => {
                  try {
                    for (let i = localStorage.length - 1; i >= 0; i--) {
                      const k = localStorage.key(i);
                      if (k && (k.startsWith('sb-') || k === 'supabase.auth.token')) {
                        localStorage.removeItem(k);
                      }
                    }
                  } catch { /* ignore */ }
                  window.location.reload();
                }}
                className="bg-canvas hover:bg-raised text-fg border border-line px-6 py-2 rounded-lg text-sm"
              >
                Logout & reload
              </button>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[60vh] text-subtle">
            <div className="w-20 h-20 border-4 border-line border-dashed rounded-xl mb-4 opacity-50"></div>
            <p className="text-lg mb-2">No history yet</p>
            <p className="text-sm text-subtle">Generated banners will appear here</p>
            <div className="mt-6 flex flex-wrap gap-2 justify-center">
              <button
                onClick={() => onNavigate('banner')}
                className="bg-brand hover:bg-brand-dark text-white px-6 py-2 rounded-lg transition-colors text-sm"
              >
                Go to Banner Tool
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="bg-info-soft hover:bg-info-soft text-info border border-info-fg/40 px-6 py-2 rounded-lg transition-colors text-sm flex items-center gap-2"
              >
                <Upload size={16} /> Import JSON
              </button>
              {/* Restore snapshot button hidden */}
              {false && embeddedCount > 0 && (
                <button
                  onClick={handleRestoreSnapshot}
                  className="bg-success-soft hover:bg-success-soft text-success border border-success-fg/40 px-6 py-2 rounded-lg transition-colors text-sm flex items-center gap-2"
                >
                  <Database size={16} /> Restore snapshot ({embeddedCount})
                </button>
              )}
            </div>
          </div>
        ) : (() => {
          // Server đã lọc theo featureFilter rồi — không lọc lại phía client,
          // nếu không trang 2 sẽ tự rỗng đi.
          const cloudItems = items;
          // Interleave pending tasks (loading/error/timeout) at the top of the
          // grid — so user always sees "đang chạy nền" state even after they
          // closed the edit modal. Filter to the current feature tab.
          const pendingTiles = isFavoriteTab
            ? [] // task đang chạy chưa được đánh sao nên không thuộc tab này
            : pending
                .filter(t => {
                  const ft = (t.payload.sourceFeatureType as FeatureType) || 'banner';
                  return featureFilter === 'all' ? ft !== 'mcp_banner' : ft === featureFilter;
                })
                .map(pendingToHistoryPlaceholder);
          const visibleItems = [...pendingTiles, ...cloudItems];
          if (visibleItems.length === 0) {
            return (
              <div className="flex flex-col items-center justify-center h-[40vh] text-subtle">
                <p className="text-sm">
                  {isFavoriteTab
                    ? <>Chưa có banner yêu thích nào. Bấm <Star size={12} className="inline -mt-0.5" /> trên banner để lưu vào đây.</>
                    : <>Chưa có banner nào ở tab <b>{TAB_LABELS[featureFilter] || featureFilter}</b>.</>}
                </p>
                <button
                  onClick={() => setFeatureFilter('all')}
                  className="mt-3 text-xs text-brand hover:underline"
                >
                  Xem tất cả
                </button>
              </div>
            );
          }
          return (
          <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {visibleItems.map(item => (
              <div
                key={item.id}
                className="bg-surface border border-line rounded-xl overflow-hidden group hover:border-line-strong transition-colors"
              >
                <div className="relative aspect-square bg-canvas">
                  {item.pendingStatus ? (
                    <PendingTile
                      status={item.pendingStatus}
                      aspectRatio={item.aspectRatio}
                      quality={item.quality}
                      errorMsg={item.pendingError}
                      onRetry={item.retryPayload
                        ? () => {
                            removePendingRegenTask(item.id);
                            setPending(readPendingRegenTasks());
                            startBackgroundRegen(item.retryPayload!, {
                              callbacks: {
                                onPlaceholder: () => setPending(readPendingRegenTasks()),
                                onSuccess: () => { refresh(); setPending(readPendingRegenTasks()); },
                                onError: () => setPending(readPendingRegenTasks()),
                              },
                            });
                          }
                        : undefined}
                      onDismiss={() => {
                        removePendingRegenTask(item.id);
                        setPending(readPendingRegenTasks());
                      }}
                    />
                  ) : (
                    <>
                      <img
                        src={proxiedBannerUrl(item.imageUrl)}
                        alt="Banner"
                        className="w-full h-full object-contain"
                      />
                      {/* Luôn hiện (không chỉ khi hover) để user quét mắt là
                          biết banner nào đã lưu. */}
                      {favEnabled && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(item); }}
                        title={item.isFavorite ? 'Bỏ khỏi Yêu thích' : 'Lưu vào Yêu thích'}
                        aria-label={item.isFavorite ? 'Bỏ khỏi Yêu thích' : 'Lưu vào Yêu thích'}
                        aria-pressed={!!item.isFavorite}
                        className={`absolute top-2 right-2 z-10 p-1.5 rounded-full backdrop-blur-sm border transition-colors ${
                          item.isFavorite
                            ? 'bg-amber-400/90 border-amber-300 text-amber-950'
                            : 'bg-black/45 border-white/20 text-white/80 hover:bg-black/70 hover:text-amber-300'
                        }`}
                      >
                        <Star size={15} className={item.isFavorite ? 'fill-current' : ''} />
                      </button>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/55 transition-colors flex flex-col items-center justify-center gap-3 opacity-0 group-hover:opacity-100">
                        <div className="flex items-center justify-center gap-2">
                          <ThumbAction
                            kind="neutral"
                            icon={<Wand2 size={18} />}
                            label="Edit"
                            title="Chỉnh sửa prompt + version mới"
                            onClick={() => setEditTarget(item)}
                          />
                          <ThumbAction
                            kind="neutral"
                            icon={<Maximize2 size={18} />}
                            label="Xem"
                            title="Phóng to xem chi tiết"
                            onClick={() => setSelectedImage(item)}
                          />
                          <ThumbAction
                            kind="neutral"
                            icon={<Download size={18} />}
                            label="Tải"
                            title="Tải ảnh về máy"
                            as="a"
                            href={proxiedBannerUrl(item.imageUrl)}
                            downloadName={`banner-${item.id}.png`}
                          />
                          <ThumbAction
                            kind="danger"
                            icon={<Trash2 size={18} />}
                            label="Xoá"
                            title="Xoá banner khỏi history"
                            onClick={() => handleRemove(item.id)}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <div className="p-3 border-t border-line">
                  <p className="text-[11px] text-subtle mb-1">{formatDate(item.timestamp)}</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {item.version && item.version > 1 && (
                      <span
                        className="text-[10px] bg-purple-500/20 text-purple-200 px-1.5 py-0.5 rounded border border-purple-500/30 font-mono"
                        title={`Phiên bản v${item.version}, edit từ ${item.parentId?.slice(0,6) || '?'}`}
                      >
                        v{item.version}
                      </span>
                    )}
                    {childCount(item.id) > 0 && (
                      <span
                        className="text-[10px] bg-rose-500/10 text-rose-300 px-1.5 py-0.5 rounded border border-rose-500/20"
                        title={`${childCount(item.id)} bản chỉnh sửa từ banner này`}
                      >
                        +{childCount(item.id)} edits
                      </span>
                    )}
                    <span className="text-[10px] bg-raised text-muted px-1.5 py-0.5 rounded">{item.aspectRatio}</span>
                    <span className="text-[10px] bg-raised text-muted px-1.5 py-0.5 rounded">{item.quality}</span>
                    {item.model && (
                      <span
                        className="text-[10px] bg-purple-500/10 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/20 truncate max-w-[120px]"
                        title={item.model}
                      >
                        {item.model}
                      </span>
                    )}
                    {item.duration && (
                      <span className="text-[10px] bg-canvas text-brand px-1.5 py-0.5 rounded border border-brand/20">
                        {item.duration.toFixed(1)}s
                      </span>
                    )}
                  </div>
                  {item.promptUsed && (
                    <p className="text-[11px] text-subtle mt-2 line-clamp-2 leading-relaxed">{item.promptUsed}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            unit="banner"
            busy={loading}
            onChange={setPage}
          />
          </>
          );
        })()}
      </main>

      {/* Lightbox (view only) */}
      {selectedImage && (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex items-center justify-center p-4">
          <button
            onClick={() => setSelectedImage(null)}
            className="absolute top-4 right-4 text-muted hover:text-fg p-2 rounded-full hover:bg-raised transition-colors"
          >
            <X size={32} />
          </button>
          <div className="max-w-[95vw] max-h-[90vh] relative">
            <img
              src={proxiedBannerUrl(selectedImage.imageUrl)}
              alt="Full View"
              className="max-w-full max-h-[90vh] object-contain rounded-md shadow-2xl"
            />
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-3">
              <button
                onClick={() => { setEditTarget(selectedImage); setSelectedImage(null); }}
                className="bg-brand hover:bg-brand-dark text-white px-6 py-2 rounded-full shadow-lg font-medium flex items-center gap-2"
              >
                <Wand2 size={18} /> Edit
              </button>
              <a
                href={proxiedBannerUrl(selectedImage.imageUrl)}
                download={`banner-full-${selectedImage.id}.png`}
                className="bg-brand hover:bg-brand-dark text-white px-6 py-2 rounded-full shadow-lg font-medium flex items-center gap-2"
              >
                <Download size={18} /> Download
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal — supports background regen so user can close it while
          the task runs; a loading tile shows at the top of the grid. */}
      {editTarget && (
        <HistoryEditModal
          item={editTarget}
          onClose={() => setEditTarget(null)}
          onUpdated={refresh}
          onSubmitBackground={(params) => {
            handleBackgroundRegen(params);
            setEditTarget(null);
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2">
          <div
            className={`px-4 py-3 rounded-lg shadow-2xl text-sm flex items-center gap-3 border-2 backdrop-blur-md ${
              toast.kind === 'ok'
                ? 'bg-success-soft border-success-fg/50 text-fg'
                : 'bg-danger-soft border-danger-fg/50 text-fg'
            }`}
          >
            <span className="text-base">{toast.kind === 'ok' ? '✓' : '✕'}</span>
            <span className="font-medium">{toast.msg}</span>
            {toast.action && (
              <button
                onClick={() => { toast.action!.onClick(); setToast(null); }}
                className="ml-2 text-xs bg-white/10 hover:bg-white/20 px-3 py-1 rounded font-semibold transition-colors"
              >
                {toast.action.label} →
              </button>
            )}
            <button
              onClick={() => setToast(null)}
              className="ml-1 opacity-60 hover:opacity-100"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Clear Confirm Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-line rounded-xl p-6 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle size={24} className="text-danger" />
              <h3 className="text-lg font-bold text-fg">Clear All History?</h3>
            </div>
            <p className="text-sm text-muted mb-6">
              This will permanently delete all {total} saved banners. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 rounded-lg bg-raised text-fg hover:bg-raised-2 transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleClearAll}
                className="px-4 py-2 rounded-lg bg-danger-fg text-white hover:bg-danger-fg transition-colors text-sm"
              >
                Delete All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ────────────── Thumbnail action button ──────────────

interface ThumbActionProps {
  kind: 'primary' | 'neutral' | 'danger';
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick?: () => void;
  as?: 'button' | 'a';
  href?: string;
  downloadName?: string;
}

/** Hover-reveals a label under the icon so the action is self-explanatory. */
const ThumbAction: React.FC<ThumbActionProps> = ({
  kind, icon, label, title, onClick, as = 'button', href, downloadName,
}) => {
  // Color discipline: 1 primary (brand), 1 neutral, 1 danger — clearly readable on hover.
  const baseColor =
    kind === 'primary' ? 'bg-brand hover:bg-brand-dark text-white' :
    kind === 'danger'  ? 'text-white' :
                         'bg-white/15 hover:bg-white/25 text-white backdrop-blur';
  const dangerStyle = kind === 'danger' ? { background: 'var(--danger-fg)' } as React.CSSProperties : undefined;
  const labelClass =
    kind === 'primary' ? 'text-white font-semibold' :
    kind === 'danger'  ? 'text-white font-semibold' :
                         'text-white/90 font-medium';

  const inner = (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`p-2.5 rounded-full transition-all ${baseColor}`}
        style={dangerStyle}
      >
        {icon}
      </div>
      <span className={`text-[10px] tracking-wide uppercase ${labelClass}`}>{label}</span>
    </div>
  );

  if (as === 'a') {
    return (
      <a href={href} download={downloadName} title={title} className="block">
        {inner}
      </a>
    );
  }
  return (
    <button onClick={onClick} title={title} type="button">
      {inner}
    </button>
  );
};

const FeatureTab: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  icon?: React.ReactNode;
}> = ({ active, onClick, label, count, icon }) => (
  <button
    onClick={onClick}
    className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
      active
        ? 'bg-brand/15 border-brand/40 text-brand font-semibold'
        : 'bg-canvas border-line text-muted hover:border-brand/30 hover:text-fg'
    }`}
  >
    {icon}
    {label}
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
      active ? 'bg-brand/20 text-brand' : 'bg-raised text-subtle'
    }`}>
      {count}
    </span>
  </button>
);

// ─────────────────── Pending tile ───────────────────

const PendingTile: React.FC<{
  status: 'loading' | 'error' | 'timeout';
  aspectRatio?: string;
  quality?: string;
  errorMsg?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}> = ({ status, aspectRatio, quality, errorMsg, onRetry, onDismiss }) => {
  if (status === 'loading') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-canvas">
        <Loader2 size={28} className="animate-spin text-brand" />
        <p className="text-xs text-muted">Đang tạo nền…</p>
        {(aspectRatio || quality) && (
          <p className="text-[10px] font-mono text-subtle">
            {quality || ''}{aspectRatio ? ` · ${aspectRatio}` : ''}
          </p>
        )}
      </div>
    );
  }
  const isTimeout = status === 'timeout';
  // Phân loại để user biết PHẢI LÀM GÌ, nhưng vẫn hiện nguyên văn message của
  // server — trước đây tile chỉ có "Tạo lỗi / Task failed on server".
  const info = describeGenError(errorMsg || (isTimeout ? 'Generation timed out' : ''));
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-danger-soft p-3 overflow-y-auto">
      <AlertTriangle size={22} className="text-danger shrink-0" />
      <p className="text-xs font-semibold text-danger text-center">
        {isTimeout ? 'Timeout 5 phút' : info.title}
      </p>
      {errorMsg && (
        <p className="text-[10px] text-fg/80 text-center max-w-[240px] leading-snug break-words">
          {info.detail}
        </p>
      )}
      {info.hint && (
        <p className="text-[10px] text-fg/60 text-center max-w-[240px] leading-snug border-t border-danger-fg/20 pt-1.5 mt-0.5">
          {info.hint}
        </p>
      )}
      <div className="flex gap-1.5 mt-1 shrink-0">
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-[10px] font-semibold bg-brand text-white px-2 py-1 rounded hover:bg-brand-dark"
          >
            Thử lại
          </button>
        )}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-[10px] font-semibold bg-canvas border border-line text-fg px-2 py-1 rounded hover:bg-raised"
          >
            Bỏ qua
          </button>
        )}
      </div>
    </div>
  );
};
