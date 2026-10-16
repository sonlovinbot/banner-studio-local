// Media library aggregate — tổng hợp toàn bộ file media user upload từ mọi
// nguồn: image library (ref / prod / face / logo) + voted banners + MCP
// uploads. Filter theo category + search theo tên file.

import React, { useEffect, useMemo, useState } from 'react';
import {
  Image as ImageIcon, Package, UserSquare2, Palette, Heart, Loader2,
  Search, Download, Trash2, X, ExternalLink, Video, Copy, Check,
} from 'lucide-react';
import { LibraryImage, VotedBanner } from '../../types';
import { listLibraryFromCloud, removeLibraryItemFromCloud } from '../../services/imageLibraryService';
import { listVotesFromCloud, removeVoteFromCloud } from '../../services/votesService';
import { proxiedBannerUrl } from '../../services/cdnProxy';
import { BulkUploadPanel } from './BulkUploadPanel';

interface MediaEntry {
  id: string;
  url: string;
  fileName: string;
  mimeType?: string;
  addedAt: number;
  category: 'ref' | 'prod' | 'face' | 'logo' | 'video' | 'voted';
  source: 'library' | 'vote';
  rawItem: LibraryImage | VotedBanner;
}

const CATEGORY_META: Record<MediaEntry['category'], { label: string; icon: React.ReactNode; color: string }> = {
  ref:   { label: 'Style Ref',    icon: <ImageIcon size={14} />, color: 'text-brand' },
  prod:  { label: 'Product',      icon: <Package size={14} />,   color: 'text-info' },
  face:  { label: 'Face',         icon: <UserSquare2 size={14} />, color: 'text-purple-400' },
  logo:  { label: 'Logo',         icon: <Palette size={14} />,   color: 'text-warning-fg' },
  video: { label: 'Video',        icon: <Video size={14} />,     color: 'text-info' },
  voted: { label: 'Voted Banner', icon: <Heart size={14} />,     color: 'text-danger' },
};

export const MediaSection: React.FC = () => {
  const [entries, setEntries] = useState<MediaEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<MediaEntry['category'] | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<MediaEntry | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [refs, prods, faces, logos, videos, votes] = await Promise.all([
        listLibraryFromCloud('ref').catch(() => []),
        listLibraryFromCloud('prod').catch(() => []),
        listLibraryFromCloud('face').catch(() => []),
        listLibraryFromCloud('logo').catch(() => []),
        listLibraryFromCloud('video').catch(() => []),
        listVotesFromCloud().catch(() => []),
      ]);
      const mapped: MediaEntry[] = [
        ...refs.map(r => libraryToEntry(r, 'ref')),
        ...prods.map(r => libraryToEntry(r, 'prod')),
        ...faces.map(r => libraryToEntry(r, 'face')),
        ...logos.map(r => libraryToEntry(r, 'logo')),
        ...videos.map(r => libraryToEntry(r, 'video')),
        ...votes.map(v => voteToEntry(v)),
      ];
      mapped.sort((a, b) => b.addedAt - a.addedAt);
      setEntries(mapped);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return entries.filter(e => {
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
      if (q && !e.fileName.toLowerCase().includes(q) && !e.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, categoryFilter, search]);

  const counts = useMemo(() => {
    const c = { all: entries.length, ref: 0, prod: 0, face: 0, logo: 0, video: 0, voted: 0 };
    for (const e of entries) c[e.category]++;
    return c;
  }, [entries]);

  const copyUrl = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const handleDelete = async (entry: MediaEntry) => {
    if (!confirm(`Xoá ${entry.fileName}? Không undo được.`)) return;
    try {
      if (entry.source === 'library') {
        await removeLibraryItemFromCloud(entry.id);
      } else {
        await removeVoteFromCloud(entry.id);
      }
      setEntries(prev => prev.filter(e => e.id !== entry.id));
      if (selected?.id === entry.id) setSelected(null);
    } catch (e: any) {
      alert(`Xoá lỗi: ${e?.message || 'unknown'}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header + total */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-fg">Media Library</h3>
          <p className="text-xs text-subtle">
            Tổng hợp ảnh và video đã upload — refs, products, faces, logos, videos, voted banners.
            {' '}
            {entries.length > 0 && <span className="font-mono">{entries.length} media</span>}
          </p>
        </div>
        <button
          onClick={load}
          className="text-xs text-muted hover:text-fg border border-line rounded-md px-3 py-1.5 flex items-center gap-1.5"
        >
          <Loader2 size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Bulk upload / paste — lên trên library grid để dễ tiếp cận */}
      <BulkUploadPanel onDone={load} />

      {/* Category tabs */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <CategoryTab
          label="Tất cả"
          count={counts.all}
          active={categoryFilter === 'all'}
          onClick={() => setCategoryFilter('all')}
        />
        {(Object.keys(CATEGORY_META) as MediaEntry['category'][]).map(cat => (
          <CategoryTab
            key={cat}
            label={CATEGORY_META[cat].label}
            count={counts[cat]}
            icon={CATEGORY_META[cat].icon}
            color={CATEGORY_META[cat].color}
            active={categoryFilter === cat}
            onClick={() => setCategoryFilter(cat)}
          />
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm theo tên file hoặc ID..."
          className="w-full bg-canvas border border-line rounded-md pl-8 pr-3 py-2 text-sm text-fg focus:outline-none focus:border-brand"
        />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="py-16 text-center text-muted">
          <Loader2 size={24} className="animate-spin mx-auto mb-2" />
          <p className="text-xs">Đang tải media...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-muted border border-dashed border-line rounded-md">
          <p className="text-sm">Không có media nào {search && 'khớp'}.</p>
          {entries.length === 0 && (
            <p className="text-[11px] text-subtle mt-1">Upload ảnh hoặc video ở khung phía trên → sẽ hiện ở đây.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {filtered.map(e => (
            <button
              key={e.id}
              onClick={() => setSelected(e)}
              className="group relative aspect-square bg-canvas border border-line rounded-md overflow-hidden hover:border-brand/50 hover:ring-2 hover:ring-brand/20 transition-all"
            >
              {e.category === 'video' ? (
                <video
                  src={e.url}
                  className="w-full h-full object-cover"
                  muted
                  preload="metadata"
                />
              ) : (
                <img
                  src={proxiedBannerUrl(e.url)}
                  alt={e.fileName}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-start justify-end p-1.5">
                <span className={`text-[9px] font-mono uppercase px-1 py-0.5 rounded ${
                  CATEGORY_META[e.category].color
                } bg-black/40 backdrop-blur-sm`}>
                  {CATEGORY_META[e.category].label}
                </span>
                <p className="text-[10px] text-white truncate w-full mt-0.5">{e.fileName}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Preview modal */}
      {selected && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-canvas border border-line rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-5 py-3 border-b border-line bg-surface flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={CATEGORY_META[selected.category].color}>
                  {CATEGORY_META[selected.category].icon}
                </span>
                <div>
                  <p className="text-sm font-semibold text-fg">{selected.fileName}</p>
                  <p className="text-[11px] text-subtle font-mono">{selected.id}</p>
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="p-1.5 rounded-md hover:bg-raised text-muted hover:text-fg">
                <X size={16} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-5 flex items-center justify-center bg-canvas/50">
              {selected.category === 'video' ? (
                <video
                  src={selected.url}
                  className="max-w-full max-h-[60vh] rounded"
                  controls
                  autoPlay
                />
              ) : (
                <img
                  src={proxiedBannerUrl(selected.url)}
                  alt={selected.fileName}
                  className="max-w-full max-h-[60vh] object-contain rounded"
                />
              )}
            </div>

            <footer className="px-5 py-3 border-t border-line bg-surface flex items-center justify-between gap-2 flex-wrap">
              <div className="text-[11px] text-subtle">
                <span className={CATEGORY_META[selected.category].color}>{CATEGORY_META[selected.category].label}</span>
                {' · '}
                {new Date(selected.addedAt).toLocaleString('vi-VN')}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyUrl(selected.url)}
                  className="text-xs bg-canvas border border-line hover:bg-raised text-fg px-3 py-1.5 rounded-md flex items-center gap-1.5"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Đã copy' : 'Copy URL'}
                </button>
                <a
                  href={proxiedBannerUrl(selected.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs bg-canvas border border-line hover:bg-raised text-fg px-3 py-1.5 rounded-md flex items-center gap-1.5"
                >
                  <ExternalLink size={12} /> Mở tab mới
                </a>
                <a
                  href={proxiedBannerUrl(selected.url)}
                  download={selected.fileName}
                  className="text-xs bg-brand hover:bg-brand-dark text-white px-3 py-1.5 rounded-md flex items-center gap-1.5"
                >
                  <Download size={12} /> Tải về
                </a>
                <button
                  onClick={() => handleDelete(selected)}
                  className="text-xs bg-danger-soft hover:bg-danger hover:text-white border border-danger-fg/40 text-danger px-3 py-1.5 rounded-md flex items-center gap-1.5"
                >
                  <Trash2 size={12} /> Xoá
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};

// ───────────────────

const CategoryTab: React.FC<{
  label: string;
  count: number;
  icon?: React.ReactNode;
  color?: string;
  active: boolean;
  onClick: () => void;
}> = ({ label, count, icon, color, active, onClick }) => (
  <button
    onClick={onClick}
    className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
      active
        ? 'bg-brand/15 border-brand/40 text-brand font-semibold'
        : 'bg-canvas border-line text-muted hover:border-brand/30 hover:text-fg'
    }`}
  >
    {icon && <span className={active ? '' : color}>{icon}</span>}
    {label}
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
      active ? 'bg-brand/20 text-brand' : 'bg-raised text-subtle'
    }`}>
      {count}
    </span>
  </button>
);

// ─── Helpers ───

function libraryToEntry(item: LibraryImage, category: 'ref' | 'prod' | 'face' | 'logo' | 'video'): MediaEntry {
  const url = item.url || item.base64 || '';
  return {
    id: item.id,
    url,
    fileName: item.fileName || `${category}-${item.id}.${category === 'video' ? 'mp4' : 'jpg'}`,
    mimeType: item.mimeType,
    addedAt: item.addedAt || Date.now(),
    category,
    source: 'library',
    rawItem: item,
  };
}

function voteToEntry(v: VotedBanner): MediaEntry {
  return {
    id: v.id,
    url: v.imageUrl,
    fileName: `voted-banner-${v.id}.png`,
    addedAt: v.votedAt || Date.now(),
    category: 'voted',
    source: 'vote',
    rawItem: v,
  };
}
