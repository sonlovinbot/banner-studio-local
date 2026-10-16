// Bulk upload / paste panel — user paste (Ctrl+V) hoặc drag/drop nhiều ảnh
// cùng lúc, hệ thống upload vào storage local qua imageLibraryService, trả về
// list URL để copy hàng loạt.
//
// Use case: cần lấy nhiều URL ảnh nhanh để paste vào MCP/Claude / spreadsheet /
// creative tool ngoài.

import React, { useRef, useState } from 'react';
import {
  Upload, Clipboard, Loader2, Check, Copy, X, AlertCircle, Image as ImageIcon,
  ClipboardList, FileText, Braces, Trash2, Sparkles, Video,
} from 'lucide-react';
import { LibraryCategory } from '../../types';
import { addFileToLibrary, addVideoToLibrary } from '../../services/imageLibraryService';
import { extractImageFiles, readImagesFromClipboard } from '../../services/imageUtils';

interface QueueItem {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'done' | 'error';
  url?: string;
  error?: string;
}

const CATEGORY_OPTIONS: { id: LibraryCategory | 'logo'; label: string }[] = [
  { id: 'ref',  label: 'Style Ref' },
  { id: 'prod', label: 'Product' },
  { id: 'face', label: 'Face' },
  { id: 'logo', label: 'Logo' },
];

interface Props {
  /** Refresh callback — parent reload danh sách media sau khi upload done. */
  onDone?: () => void;
}

type MediaKind = 'image' | 'video';

export const BulkUploadPanel: React.FC<Props> = ({ onDone }) => {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [mediaKind, setMediaKind] = useState<MediaKind>('image');
  const [category, setCategory] = useState<LibraryCategory | 'logo'>('ref');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: File[] | FileList) => {
    const allowedVideoTypes = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
    const arr = Array.from(files as any as Iterable<File>).filter(file => (
      mediaKind === 'image' ? file.type.startsWith('image/') : allowedVideoTypes.has(file.type)
    ));
    if (arr.length === 0) return;
    setQueue(prev => [
      ...prev,
      ...arr.map(f => ({
        id: Math.random().toString(36).slice(2, 8),
        file: f,
        status: 'pending' as const,
      })),
    ]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (mediaKind !== 'image') return;
    const files = extractImageFiles(e.clipboardData?.items);
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  };

  const handleClipboardBtn = async () => {
    if (mediaKind !== 'image') return;
    try {
      const files = await readImagesFromClipboard();
      if (files.length === 0) {
        alert('Clipboard không có ảnh — hãy copy ảnh trước hoặc dùng Ctrl/Cmd+V trong vùng dán.');
        return;
      }
      addFiles(files);
    } catch (e: any) {
      alert(`Clipboard access failed: ${e?.message || 'unknown'}`);
    }
  };

  const removeQueueItem = (id: string) => {
    setQueue(prev => prev.filter(q => q.id !== id));
  };

  const clearAll = () => {
    if (!confirm('Xoá tất cả file trong queue (bao gồm các URL đã upload)?')) return;
    setQueue([]);
  };

  const startUpload = async () => {
    if (uploading) return;
    const pending = queue.filter(q => q.status === 'pending' || q.status === 'error');
    if (pending.length === 0) return;
    setUploading(true);

    // Chạy song song (max 3 concurrent để không đè server)
    const CONCURRENCY = mediaKind === 'video' ? 2 : 3;
    let inFlight = 0;
    let idx = 0;

    await new Promise<void>((resolve) => {
      const kickNext = () => {
        while (inFlight < CONCURRENCY && idx < pending.length) {
          const item = pending[idx++];
          inFlight++;
          setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'uploading' } : q));

          const upload = mediaKind === 'video'
            ? addVideoToLibrary(item.file)
            : addFileToLibrary(item.file, category);
          upload
            .then(saved => {
              setQueue(prev => prev.map(q => q.id === item.id ? {
                ...q, status: 'done', url: saved.url || saved.base64,
              } : q));
            })
            .catch(err => {
              setQueue(prev => prev.map(q => q.id === item.id ? {
                ...q, status: 'error', error: err?.message || 'unknown',
              } : q));
            })
            .finally(() => {
              inFlight--;
              if (idx >= pending.length && inFlight === 0) resolve();
              else kickNext();
            });
        }
      };
      kickNext();
    });

    setUploading(false);
    onDone?.();
  };

  const doneItems = queue.filter(q => q.status === 'done' && q.url);
  const pendingCount = queue.filter(q => q.status === 'pending').length;
  const errorCount = queue.filter(q => q.status === 'error').length;

  const copySingle = async (url: string, id: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1200);
  };

  const copyAll = async (format: 'plain' | 'json' | 'markdown') => {
    if (doneItems.length === 0) return;
    let text = '';
    if (format === 'plain') {
      text = doneItems.map(q => q.url).join('\n');
    } else if (format === 'json') {
      text = JSON.stringify(doneItems.map(q => q.url), null, 2);
    } else if (format === 'markdown') {
      text = doneItems.map(q => mediaKind === 'video'
        ? `[${q.file.name}](${q.url})`
        : `![${q.file.name}](${q.url})`).join('\n');
    }
    await navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  };

  return (
    <section className="border border-line rounded-xl bg-brand/5 overflow-hidden">
      <header className="px-4 py-3 border-b border-line bg-brand/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-brand/20 text-brand p-1.5 rounded border border-brand/30">
            <Sparkles size={14} />
          </div>
          <div>
            <p className="text-sm font-semibold text-fg">Upload Media</p>
            <p className="text-[11px] text-subtle">
              {mediaKind === 'image'
                ? 'Paste hoặc kéo nhiều ảnh → storage local → copy URL'
                : 'Kéo video → lưu vào ./data/uploads → copy URL'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-line bg-canvas p-0.5">
            {(['image', 'video'] as MediaKind[]).map(kind => (
              <button
                key={kind}
                type="button"
                onClick={() => setMediaKind(kind)}
                disabled={uploading || queue.length > 0}
                className={`px-2.5 py-1 rounded text-xs flex items-center gap-1 disabled:opacity-40 ${
                  mediaKind === kind ? 'bg-brand text-white' : 'text-muted hover:text-fg'
                }`}
              >
                {kind === 'image' ? <ImageIcon size={11} /> : <Video size={11} />}
                {kind === 'image' ? 'Ảnh' : 'Video'}
              </button>
            ))}
          </div>
          {mediaKind === 'image' && (
            <>
              <label className="text-[10px] text-subtle uppercase">Category:</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                disabled={uploading}
                className="text-xs bg-canvas border border-line rounded-md px-2 py-1 focus:outline-none focus:border-brand disabled:opacity-50"
              >
                {CATEGORY_OPTIONS.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </>
          )}
        </div>
      </header>

      <div className="p-4 space-y-3">
        {/* Drop / paste zone */}
        <div
          tabIndex={0}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          className={`border-2 border-dashed rounded-lg p-6 focus:outline-none transition-colors ${
            dragOver
              ? 'border-brand bg-brand/10'
              : 'border-line-strong bg-canvas hover:border-brand/50'
          }`}
        >
          <div className="flex flex-col items-center gap-3 text-center">
            {mediaKind === 'image'
              ? <ImageIcon size={28} className="text-subtle" />
              : <Video size={28} className="text-subtle" />}
            <div>
              <p className="text-sm text-fg font-medium">
                {mediaKind === 'image'
                  ? 'Kéo ảnh vào đây · Paste Ctrl/Cmd+V · hoặc chọn file'
                  : 'Kéo video vào đây hoặc chọn file'}
              </p>
              <p className="text-[11px] text-subtle mt-1">
                {mediaKind === 'image'
                  ? 'Multi-select được. Ảnh .png / .jpg / .webp / .gif đều OK.'
                  : 'MP4 / WebM / MOV · tối đa 500 MB mỗi video.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="text-xs bg-brand hover:bg-brand-dark disabled:opacity-40 text-white px-3 py-1.5 rounded-md flex items-center gap-1.5"
              >
                <Upload size={12} /> {mediaKind === 'image' ? 'Chọn nhiều file' : 'Chọn video'}
              </button>
              {mediaKind === 'image' && (
                <button
                  onClick={handleClipboardBtn}
                  disabled={uploading}
                  className="text-xs bg-canvas border border-line hover:bg-raised disabled:opacity-40 text-fg px-3 py-1.5 rounded-md flex items-center gap-1.5"
                >
                  <Clipboard size={12} /> Đọc từ clipboard
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={mediaKind === 'image' ? 'image/*' : 'video/mp4,video/webm,video/quicktime,.mov'}
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files) addFiles(e.target.files); if (fileInputRef.current) fileInputRef.current.value = ''; }}
              />
            </div>
          </div>
        </div>

        {/* Queue */}
        {queue.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-fg">
              <p>
                Queue: <b className="text-brand">{queue.length}</b>
                {pendingCount > 0 && <span className="text-muted"> · {pendingCount} pending</span>}
                {doneItems.length > 0 && <span className="text-success"> · {doneItems.length} done</span>}
                {errorCount > 0 && <span className="text-danger"> · {errorCount} error</span>}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={clearAll}
                  disabled={uploading}
                  className="text-[11px] text-muted hover:text-danger disabled:opacity-40"
                >
                  <Trash2 size={11} className="inline mr-0.5" /> Xoá queue
                </button>
                <button
                  onClick={startUpload}
                  disabled={uploading || pendingCount + errorCount === 0}
                  className="text-xs bg-brand hover:bg-brand-dark disabled:opacity-40 text-white px-3 py-1.5 rounded-md font-medium flex items-center gap-1.5"
                >
                  {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  {uploading ? 'Đang upload...' : `Upload ${pendingCount + errorCount} ${mediaKind === 'image' ? 'ảnh' : 'video'}`}
                </button>
              </div>
            </div>

            <div className="border border-line rounded-md divide-y divide-line bg-canvas max-h-72 overflow-y-auto">
              {queue.map(q => (
                <div key={q.id} className="flex items-center gap-2 p-2 text-xs">
                  <div className="w-10 h-10 shrink-0 rounded overflow-hidden border border-line bg-surface">
                    {mediaKind === 'image' ? (
                      <img
                        src={URL.createObjectURL(q.file)}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-brand bg-brand/10">
                        <Video size={18} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-fg truncate">{q.file.name}</p>
                    {q.status === 'done' && q.url && (
                      <p className="text-[10px] text-muted font-mono truncate">{q.url}</p>
                    )}
                    {q.status === 'error' && (
                      <p className="text-[10px] text-danger truncate">Lỗi: {q.error}</p>
                    )}
                    {q.status === 'pending' && (
                      <p className="text-[10px] text-subtle">Chờ upload · {(q.file.size / 1024).toFixed(0)} KB</p>
                    )}
                    {q.status === 'uploading' && (
                      <p className="text-[10px] text-brand flex items-center gap-1">
                        <Loader2 size={9} className="animate-spin" /> Đang upload...
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-1">
                    {q.status === 'done' && q.url && (
                      <button
                        onClick={() => copySingle(q.url!, q.id)}
                        className="p-1 rounded text-brand hover:bg-brand/10"
                        title="Copy URL"
                      >
                        {copiedId === q.id ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    )}
                    {q.status === 'error' && (
                      <span className="text-danger p-1" title={q.error}>
                        <AlertCircle size={12} />
                      </span>
                    )}
                    {q.status !== 'uploading' && (
                      <button
                        onClick={() => removeQueueItem(q.id)}
                        className="p-1 rounded text-muted hover:text-danger hover:bg-danger-soft"
                        title="Bỏ khỏi queue"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Copy all block */}
        {doneItems.length > 0 && (
          <div className="border border-brand/30 bg-brand/5 rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-brand">
                {doneItems.length} URL đã sẵn sàng — copy hàng loạt:
              </p>
              {copiedAll && (
                <span className="text-[11px] text-success flex items-center gap-1">
                  <Check size={11} /> Đã copy!
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => copyAll('plain')}
                className="text-xs bg-canvas border border-line hover:bg-raised text-fg px-3 py-1.5 rounded-md flex items-center gap-1.5"
              >
                <FileText size={12} /> Copy plain (mỗi URL 1 dòng)
              </button>
              <button
                onClick={() => copyAll('json')}
                className="text-xs bg-canvas border border-line hover:bg-raised text-fg px-3 py-1.5 rounded-md flex items-center gap-1.5"
              >
                <Braces size={12} /> Copy JSON array
              </button>
              <button
                onClick={() => copyAll('markdown')}
                className="text-xs bg-canvas border border-line hover:bg-raised text-fg px-3 py-1.5 rounded-md flex items-center gap-1.5"
              >
                <ClipboardList size={12} /> Copy Markdown
              </button>
            </div>
            <textarea
              readOnly
              value={doneItems.map(q => q.url).join('\n')}
              className="w-full bg-canvas border border-line rounded-md p-2 text-[11px] text-muted font-mono h-24 resize-none focus:outline-none focus:border-brand"
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            />
          </div>
        )}
      </div>
    </section>
  );
};
