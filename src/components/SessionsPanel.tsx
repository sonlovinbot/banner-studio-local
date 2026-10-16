// SessionsPanel — bottom strip in the Generated Workspace showing recent
// generation sessions. A session = a batch of banners generated together
// (either via shared sessionId or bucketed by close timestamps in
// historyService.bucketIntoSessions).
//
// UI has two modes:
//   - row   (default, tight): one horizontal thumbnail strip per session.
//   - grid  (expanded):        session rows are taller with 2×3-ish grid.
//
// Clicking a thumbnail bubbles the item up to the parent so it can open
// the existing HistoryEditModal (same flow as the History page).

import React, { useMemo, useState } from 'react';
import { Clock, LayoutGrid, Rows3, History as HistoryIcon, ChevronDown, Trash2, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { RegenRetryPayload } from '../types';
import { HistoryItem, FeatureType } from '../types';
import { bucketIntoSessions } from '../services/historyService';
import { proxiedBannerUrl } from '../services/cdnProxy';

type Mode = 'row' | 'grid';

interface Props {
  /** All history items — panel filters by featureType internally. */
  history: HistoryItem[];
  /** Only show sessions matching this feature. */
  featureType: FeatureType;
  /** Click a banner to open the edit modal (parent already owns that state). */
  onSelectItem: (item: HistoryItem) => void;

  /** Delete one banner. Parent chịu trách nhiệm confirm + refresh history. */
  onDeleteItem?: (item: HistoryItem) => void;
  /** Delete an entire session (all banners in the group). */
  onDeleteSession?: (itemIds: string[]) => void;
  /** Retry 1 pending regen task đã lỗi/timeout. */
  onRetryRegen?: (taskId: string, payload: RegenRetryPayload) => void;
  /** Xoá vĩnh viễn 1 pending task đã lỗi (không retry). */
  onRemoveErrorTask?: (taskId: string) => void;

  /** Optional: navigate to the full HistoryPage. */
  onOpenFullHistory?: () => void;
  /** Cap number of sessions shown to keep the panel scannable. */
  maxSessions?: number;

  /** Slot dưới đáy panel — parent nhét <Pagination> vào đây. Panel không tự
   *  fetch, chỉ chừa chỗ. */
  footer?: React.ReactNode;

  /** Full-height mode — panel expands to fill available vertical space.
   *  Used when no current generation results are showing, so past sessions
   *  become the primary content of the workspace. Bigger thumbnails, grid
   *  mode default, no scroll cap. */
  fullHeight?: boolean;
}

// Sessions cap: bao nhiêu phiên gần đây hiển thị trong panel. Cao hơn = user
// scroll thấy nhiều history hơn (trước là 12, quá ít cho user gen nhiều).
const DEFAULT_MAX = 40;

export const SessionsPanel: React.FC<Props> = ({
  history, featureType, onSelectItem, onDeleteItem, onDeleteSession, onRetryRegen, onRemoveErrorTask, onOpenFullHistory,
  maxSessions = DEFAULT_MAX,
  fullHeight = false,
  footer,
}) => {
  // In fullHeight mode we default to grid — the whole workspace is the
  // panel, so bigger thumbnails read better than compact rows.
  const [mode, setMode] = useState<Mode>(fullHeight ? 'grid' : 'row');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const effectiveMax = fullHeight ? maxSessions * 2 : maxSessions;
  const sessions = useMemo(() => {
    const filtered = history.filter(h => (h.featureType || 'banner') === featureType);
    return bucketIntoSessions(filtered).slice(0, effectiveMax);
  }, [history, featureType, effectiveMax]);

  const toggleExpand = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  if (sessions.length === 0) {
    return (
      <div className={`border-t border-line bg-surface/50 backdrop-blur-sm ${
        fullHeight ? 'flex-1 flex flex-col items-center justify-center' : 'px-6 py-4 flex items-center gap-2'
      } text-xs text-subtle`}>
        <HistoryIcon size={fullHeight ? 28 : 13} className={fullHeight ? 'text-subtle mb-2 opacity-50' : ''} />
        <span className={fullHeight ? 'text-sm' : ''}>
          Chưa có phiên nào — banner sẽ hiện ở đây sau khi generate.
        </span>
        {footer}
      </div>
    );
  }

  return (
    <div className={`border-t border-line bg-surface/60 backdrop-blur-sm flex flex-col overflow-hidden ${
      fullHeight ? 'flex-1 min-h-0' : ''
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-line bg-canvas/40">
        <div className="flex items-center gap-2 text-xs">
          <HistoryIcon size={13} className="text-brand" />
          <span className="font-semibold text-fg">Phiên gần đây</span>
          <span className="text-subtle font-mono text-[11px]">
            {sessions.length} phiên · {sessions.reduce((n, s) => n + s.items.length, 0)} banner
          </span>
        </div>
        <div className="flex items-center gap-1">
          <ModeButton active={mode === 'row'}  onClick={() => setMode('row')}  icon={<Rows3 size={12} />}     label="Dòng" />
          <ModeButton active={mode === 'grid'} onClick={() => setMode('grid')} icon={<LayoutGrid size={12} />} label="Lưới" />
          {onOpenFullHistory && (
            <button
              onClick={onOpenFullHistory}
              className="text-[11px] px-2 py-1 rounded-md text-muted hover:text-brand hover:underline"
            >
              Xem toàn bộ →
            </button>
          )}
        </div>
      </div>

      {/* Sessions list — max-height only when embedded as a bottom strip.
          In fullHeight mode the parent flex controls how much space we get. */}
      <div className={`flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-[120px] ${
        fullHeight ? '' : 'max-h-[42vh]'
      }`}>
        {sessions.map(s => {
          const isExpanded = expanded.has(s.key);
          return mode === 'row' ? (
            <SessionRow
              key={s.key}
              session={s}
              onSelectItem={onSelectItem}
              onDeleteItem={onDeleteItem}
              onDeleteSession={onDeleteSession}
              onRetryRegen={onRetryRegen}
              onRemoveErrorTask={onRemoveErrorTask}
              expanded={isExpanded}
              onToggleExpand={() => toggleExpand(s.key)}
              fullHeight={fullHeight}
            />
          ) : (
            <SessionGrid
              key={s.key}
              session={s}
              onSelectItem={onSelectItem}
              onDeleteItem={onDeleteItem}
              onDeleteSession={onDeleteSession}
              onRetryRegen={onRetryRegen}
              onRemoveErrorTask={onRemoveErrorTask}
              fullHeight={fullHeight}
            />
          );
        })}
      </div>
      {footer && <div className="border-t border-line bg-canvas/40">{footer}</div>}
    </div>
  );
};

// ─────────── Session row (compact) ───────────

interface SessionRowProps {
  session: ReturnType<typeof bucketIntoSessions>[number];
  onSelectItem: (item: HistoryItem) => void;
  onDeleteItem?: (item: HistoryItem) => void;
  onDeleteSession?: (itemIds: string[]) => void;
  onRetryRegen?: (taskId: string, payload: RegenRetryPayload) => void;
  onRemoveErrorTask?: (taskId: string) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  fullHeight?: boolean;
}

const SessionRow: React.FC<SessionRowProps> = ({ session, onSelectItem, onDeleteItem, onDeleteSession, onRetryRegen, onRemoveErrorTask, expanded, onToggleExpand, fullHeight }) => {
  // Items per session shown trước khi bấm "+N more" — tăng để user thấy
  // nhiều thumbnail luôn trong 1 phiên mà không phải bấm expand.
  const capBig = fullHeight ? 20 : 14;
  const shown = expanded ? session.items : session.items.slice(0, capBig);
  const overflow = session.items.length - shown.length;
  const thumbSize = fullHeight ? 72 : 44;

  const handleDeleteSession = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDeleteSession) return;
    if (!confirm(`Xoá cả phiên (${session.items.length} banner)? Không undo được.`)) return;
    onDeleteSession(session.items.map(i => i.id));
  };

  return (
    <div className="rounded-md border border-line bg-canvas hover:border-brand/40 transition-colors">
      <div className="w-full flex items-center gap-3 px-3 py-2">
        <button
          onClick={onToggleExpand}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <ChevronDown size={13} className={`text-muted shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`} />
          <Clock size={11} className="text-subtle shrink-0" />
          <span className="text-[11px] text-fg font-medium shrink-0">
            {relativeTime(session.startedAt)}
          </span>
          <span className="text-[11px] text-subtle shrink-0 font-mono">
            {session.items.length} banner
          </span>
        </button>
        <div className="shrink-0 flex items-center gap-1">
          <ConfigChips item={session.items[0]} />
          {onDeleteSession && (
            <button
              onClick={handleDeleteSession}
              className="p-1 rounded text-muted hover:text-danger hover:bg-danger-soft"
              title="Xoá cả phiên"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      <div className="px-3 pb-2 flex items-center gap-1.5 overflow-x-auto">
        {shown.map(it => (
          <Thumb
            key={it.id}
            item={it}
            size={thumbSize}
            onClick={() => onSelectItem(it)}
            onDelete={onDeleteItem ? () => onDeleteItem(it) : undefined}
            onRetry={onRetryRegen && it.retryPayload
              ? () => onRetryRegen(it.id, it.retryPayload as RegenRetryPayload)
              : undefined}
            onRemoveErrorTask={onRemoveErrorTask && (it.pendingStatus === 'error' || it.pendingStatus === 'timeout')
              ? () => onRemoveErrorTask(it.id)
              : undefined}
          />
        ))}
        {overflow > 0 && (
          <button
            onClick={onToggleExpand}
            style={{ width: thumbSize, height: thumbSize }}
            className="shrink-0 rounded border border-dashed border-line text-[10px] text-muted hover:text-brand hover:border-brand/40"
          >
            +{overflow}
          </button>
        )}
      </div>
    </div>
  );
};

// ─────────── Session grid (expanded) ───────────

const SessionGrid: React.FC<{
  session: ReturnType<typeof bucketIntoSessions>[number];
  onSelectItem: (item: HistoryItem) => void;
  onDeleteItem?: (item: HistoryItem) => void;
  onDeleteSession?: (itemIds: string[]) => void;
  onRetryRegen?: (taskId: string, payload: RegenRetryPayload) => void;
  onRemoveErrorTask?: (taskId: string) => void;
  fullHeight?: boolean;
}> = ({ session, onSelectItem, onDeleteItem, onDeleteSession, onRetryRegen, onRemoveErrorTask, fullHeight }) => {
  const gridCols = fullHeight
    ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5'
    : 'grid-cols-4 sm:grid-cols-6 md:grid-cols-8';

  const handleDeleteSession = () => {
    if (!onDeleteSession) return;
    if (!confirm(`Xoá cả phiên (${session.items.length} banner)? Không undo được.`)) return;
    onDeleteSession(session.items.map(i => i.id));
  };

  return (
    <div className="rounded-md border border-line bg-canvas p-3 space-y-2">
      <div className="flex items-center gap-2 text-[11px]">
        <Clock size={11} className="text-brand" />
        <span className="text-fg font-medium">{relativeTime(session.startedAt)}</span>
        <span className="text-subtle font-mono">{session.items.length} banner</span>
        <div className="ml-auto shrink-0 flex items-center gap-1">
          <ConfigChips item={session.items[0]} />
          {onDeleteSession && (
            <button
              onClick={handleDeleteSession}
              className="p-1 rounded text-muted hover:text-danger hover:bg-danger-soft"
              title="Xoá cả phiên"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>
      <div className={`grid ${gridCols} gap-2`}>
        {session.items.map(it => (
          <Thumb
            key={it.id}
            item={it}
            size={0}
            onClick={() => onSelectItem(it)}
            onDelete={onDeleteItem ? () => onDeleteItem(it) : undefined}
            onRetry={onRetryRegen && it.retryPayload
              ? () => onRetryRegen(it.id, it.retryPayload as RegenRetryPayload)
              : undefined}
            onRemoveErrorTask={onRemoveErrorTask && (it.pendingStatus === 'error' || it.pendingStatus === 'timeout')
              ? () => onRemoveErrorTask(it.id)
              : undefined}
          />
        ))}
      </div>
    </div>
  );
};

// ─────────── Shared thumbnail ───────────

const Thumb: React.FC<{
  item: HistoryItem;
  onClick: () => void;
  onDelete?: () => void;
  onRetry?: () => void;
  onRemoveErrorTask?: () => void;
  /** Fixed pixel size for row mode; 0 = grid mode with aspect-square */
  size: number;
}> = ({ item, onClick, onDelete, onRetry, onRemoveErrorTask, size }) => {
  const style = size > 0 ? { width: size, height: size } : undefined;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDelete) return;
    if (!confirm('Xoá banner này?')) return;
    onDelete();
  };

  const handleRetry = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onRetry) return;
    onRetry();
  };

  const handleRemoveError = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onRemoveErrorTask) return;
    onRemoveErrorTask();
  };

  // 3 states: 'success' (có imageUrl), 'error/timeout' (empty + pendingStatus),
  // 'loading' (empty + pendingStatus='loading' hoặc không có pendingStatus)
  const isError = item.pendingStatus === 'error' || item.pendingStatus === 'timeout';
  const isLoading = !item.imageUrl && !isError;
  const iconSize = size > 0 ? Math.max(12, size * 0.35) : 20;

  return (
    <div
      style={style}
      className={`group relative overflow-hidden rounded border transition-all shrink-0 ${
        isError
          ? 'border-danger/50 bg-danger-soft ring-1 ring-danger/20'
          : isLoading
            ? 'border-brand/50 bg-brand/5 ring-1 ring-brand/20 animate-pulse'
            : 'border-line hover:border-brand hover:ring-2 hover:ring-brand/30'
      } ${size === 0 ? 'aspect-square w-full' : ''}`}
      title={
        isError ? (item.pendingError || 'Task lỗi — bấm nút retry')
        : isLoading ? 'Đang chạy nền...'
        : (item.promptUsed || 'Click để mở edit')
      }
    >
      {isError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-danger p-1">
          <AlertCircle size={iconSize} />
          <span className="text-[8px] font-mono font-semibold uppercase">
            {item.pendingStatus === 'timeout' ? 'timeout' : 'lỗi'}
          </span>
          <div className="flex items-center gap-1 mt-0.5">
            {onRetry && (
              <button
                onClick={handleRetry}
                className="text-[8px] bg-brand hover:bg-brand-dark text-white rounded px-1.5 py-0.5 flex items-center gap-0.5"
                title="Tạo lại banner này"
              >
                <RefreshCw size={8} /> Tạo lại
              </button>
            )}
            {onRemoveErrorTask && (
              <button
                onClick={handleRemoveError}
                className="text-[8px] bg-canvas hover:bg-danger hover:text-white border border-danger-fg/40 text-danger rounded px-1.5 py-0.5 flex items-center gap-0.5"
                title="Xoá task lỗi này (không retry)"
              >
                <Trash2 size={8} /> Xoá
              </button>
            )}
          </div>
        </div>
      ) : isLoading ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-brand">
          <Loader2 size={iconSize} className="animate-spin" />
          <span className="text-[8px] font-mono">chạy nền</span>
        </div>
      ) : (
        <button
          onClick={onClick}
          className="absolute inset-0 w-full h-full"
        >
          <img
            src={proxiedBannerUrl(item.imageUrl)}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </button>
      )}
      {!isLoading && !isError && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none flex items-end p-1">
          <span className="text-[8px] text-white font-mono truncate w-full">
            {item.aspectRatio} · {item.quality}
          </span>
        </div>
      )}
      {onDelete && !isLoading && (
        <button
          onClick={handleDelete}
          className="absolute top-0.5 right-0.5 p-1 rounded bg-black/50 text-white/80 hover:bg-danger hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
          title={isError ? 'Xoá task lỗi này' : 'Xoá banner này'}
        >
          <Trash2 size={10} />
        </button>
      )}
    </div>
  );
};

// ─────────── Mode toggle button ───────────

const ModeButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`text-[11px] px-2 py-1 rounded-md border transition-colors flex items-center gap-1 ${
      active
        ? 'bg-brand/15 border-brand/40 text-brand'
        : 'bg-canvas border-line text-muted hover:border-brand/30 hover:text-fg'
    }`}
    title={label}
  >
    {icon} {label}
  </button>
);

// ─────────── Helpers ───────────

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60)         return `${s}s trước`;
  const m = Math.floor(s / 60);
  if (m < 60)         return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24)         return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d === 1)        return 'Hôm qua';
  if (d < 7)          return `${d} ngày trước`;
  const w = Math.floor(d / 7);
  if (w < 5)          return `${w} tuần trước`;
  return new Date(ts).toLocaleDateString('vi-VN');
}

// Compact config chips shown at the right of each session row/grid header.
// Replaces the previous raw-prompt subtitle which surfaced noisy strings
// like `Brand reference (JSON): {"source": "Pasted markdown.md ..."}`.
const ConfigChips: React.FC<{ item: HistoryItem | undefined }> = ({ item }) => {
  if (!item) return null;
  const modelLabel = friendlyModel(item.model);
  return (
    <>
      {modelLabel && (
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-brand/10 text-brand border border-brand/20">
          {modelLabel}
        </span>
      )}
      {item.aspectRatio && (
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-raised text-muted border border-line">
          {item.aspectRatio}
        </span>
      )}
      {item.quality && (
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-raised text-muted border border-line">
          {item.quality}
        </span>
      )}
    </>
  );
};

/** Map raw model ids to human names. Falls back to the raw string. */
function friendlyModel(raw: string | undefined): string {
  if (!raw) return '';
  const s = raw.trim();
  if (s === 'gpt_image_2')                       return 'GPT Image 2';
  if (s === 'google_image_gen_banana_pro')       return 'Nano Banana Pro';
  if (s.startsWith('gemini-'))                   return 'Gemini';
  // Legacy "UGC · <model>" leaks — display without prefix.
  if (s.startsWith('UGC ') || s.startsWith('UGC·')) return s.replace(/^UGC\s*·?\s*/, '');
  return s;
}
