import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Palette, Plus, Trash2, Edit3, Save, X, Upload, Image as ImageIcon, FileJson, Clipboard, Cloud, Loader2, Sparkles,
} from 'lucide-react';
import { AppPage, BrandProject, LibraryImage } from '../types';
import { getBrandProjects } from '../services/storageService';
import {
  listBrandProjectsFromCloud,
  saveBrandProjectToCloud,
  deleteBrandProjectFromCloud,
  bulkMigrateBrandProjects,
} from '../services/brandProjectService';
import { compressForLibrary, readImagesFromClipboard, filesToFileList } from '../services/imageUtils';
import { BrandUrlImportPanel } from './BrandUrlImportPanel';

interface Props {
  onNavigate: (page: AppPage) => void;
}

const MAX_REFERENCES = 5;

type RefSlot = 'styleReferences' | 'productReferences';

const emptyDraft = (): BrandProject => ({
  id: Math.random().toString(36).substring(7),
  name: '',
  brandInfo: '',
  eventInfo: '',
  jsonPrompt: '',
  logo: undefined,
  styleReferences: [],
  productReferences: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const formatDate = (ts: number) =>
  new Date(ts).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const BrandStylePage: React.FC<Props> = ({ onNavigate }) => {
  const [projects, setProjects] = useState<BrandProject[]>([]);
  const [editing, setEditing] = useState<BrandProject | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [loading, setLoading] = useState(true);
  const localCount = getBrandProjects().length;

  const refresh = async () => {
    setLoading(true);
    const cloud = await listBrandProjectsFromCloud();
    setProjects(cloud);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const handleNew = () => { setError(null); setEditing(emptyDraft()); };
  const handleEdit = (p: BrandProject) => { setError(null); setEditing({ ...p }); };
  const handleCancel = () => { setEditing(null); setError(null); };

  const handleSave = async (project: BrandProject) => {
    if (!project.name.trim()) { setError('Tên brand không được trống.'); return; }
    // Style Notes chấp nhận bất kỳ format nào (JSON, Markdown, plain text).
    // Không validate JSON nữa — user tự do nhồi context.
    setSaving(true);
    try {
      await saveBrandProjectToCloud({ ...project, name: project.name.trim() });
      await refresh();
      setEditing(null);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Không lưu được brand project.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteBrandProjectFromCloud(id);
      await refresh();
      setConfirmDelete(null);
    } catch (e: any) {
      setError(e.message || 'Không xoá được');
    }
  };

  const handleMigrateLocal = async () => {
    setMigrating(true);
    try {
      const local = getBrandProjects();
      const result = await bulkMigrateBrandProjects(local);
      await refresh();
      setError(`Migrate: +${result.inserted} brand, bỏ qua ${result.skipped}`);
    } catch (e: any) {
      setError(e.message || 'Migrate lỗi');
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-fg flex flex-col">
      <header className="border-b border-line bg-surface/80 backdrop-blur-sm sticky top-14 z-20">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => onNavigate('menu')}
              className="p-2 rounded-lg hover:bg-raised transition-colors text-muted hover:text-fg"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="flex items-center gap-3">
              <Palette size={20} className="text-brand" />
              <h1 className="text-lg font-bold text-fg">Brand Style</h1>
              <span className="text-xs text-success bg-success-soft border border-success-fg/40 px-2 py-1 rounded-full inline-flex items-center gap-1">
                <Cloud size={11} /> {loading ? '...' : projects.length} cloud
              </span>
              {/* local badge hidden — migration done */}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Migrate local button hidden */}
            {false && localCount > 0 && (
              <button
                onClick={handleMigrateLocal}
                disabled={migrating}
                className="text-xs text-warning hover:text-warning hover:bg-warning-soft px-3 py-2 rounded-lg flex items-center gap-1.5 border border-warning-fg/40 disabled:opacity-50"
              >
                {migrating ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}
                Migrate local ({localCount})
              </button>
            )}
            {!editing && (
              <button
                onClick={handleNew}
                className="text-xs bg-brand hover:bg-brand-dark text-white px-3 py-2 rounded-lg flex items-center gap-1.5 font-medium"
              >
                <Plus size={14} /> Tạo Brand mới
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-6">
        {editing ? (
          <BrandEditor
            draft={editing}
            onChange={setEditing}
            onCancel={handleCancel}
            onSave={() => handleSave(editing)}
            error={error}
            busy={saving}
          />
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[60vh] text-subtle">
            <Palette size={48} className="text-gray-700 mb-4" />
            <p className="text-lg mb-2">Chưa có brand nào</p>
            <p className="text-sm text-subtle mb-6">Tạo brand kit để chèn nhanh khi sinh banner</p>
            <button
              onClick={handleNew}
              className="bg-brand hover:bg-brand-dark text-white px-6 py-2.5 rounded-lg flex items-center gap-2"
            >
              <Plus size={16} /> Tạo Brand đầu tiên
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map(p => (
              <div key={p.id} className="bg-surface border border-line rounded-xl overflow-hidden flex flex-col">
                <div className="aspect-video bg-canvas grid grid-cols-3 gap-px">
                  {(() => {
                    const previews: LibraryImage[] = [
                      ...(p.logo ? [p.logo] : []),
                      ...p.styleReferences,
                      ...p.productReferences,
                    ].slice(0, 3);
                    return (
                      <>
                        {previews.map(img => (
                          <img key={img.id} src={img.url || img.base64} alt="brand" className="w-full h-full object-cover" />
                        ))}
                        {Array.from({ length: Math.max(0, 3 - previews.length) }).map((_, i) => (
                          <div key={`ph-${i}`} className="bg-surface border border-line" />
                        ))}
                      </>
                    );
                  })()}
                </div>
                <div className="p-4 flex-1 flex flex-col">
                  <h3 className="text-sm font-semibold text-fg truncate">{p.name}</h3>
                  <p className="text-[11px] text-subtle mt-0.5">Updated {formatDate(p.updatedAt)}</p>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="text-[10px] bg-raised text-muted px-1.5 py-0.5 rounded">
                      {p.styleReferences.length + p.productReferences.length + (p.logo ? 1 : 0)} ảnh
                    </span>
                    {p.styleReferences.length > 0 && (
                      <span className="text-[10px] bg-raised text-brand px-1.5 py-0.5 rounded border border-line">
                        style {p.styleReferences.length}
                      </span>
                    )}
                    {p.productReferences.length > 0 && (
                      <span className="text-[10px] bg-info-soft text-info px-1.5 py-0.5 rounded border border-brand/20">
                        product {p.productReferences.length}
                      </span>
                    )}
                    {p.brandInfo && (
                      <span className="text-[10px] bg-canvas text-brand px-1.5 py-0.5 rounded border border-brand/20">brand info</span>
                    )}
                    {p.eventInfo && (
                      <span className="text-[10px] bg-warning-soft text-warning px-1.5 py-0.5 rounded border border-warning-fg/40">event</span>
                    )}
                    {p.jsonPrompt && (
                      <span className="text-[10px] bg-success-soft text-success px-1.5 py-0.5 rounded border border-success-fg/40">json</span>
                    )}
                  </div>
                  <div className="mt-3 space-y-1.5">
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleEdit(p)}
                        className="flex-1 text-sm bg-canvas hover:bg-raised text-fg border border-line py-1.5 rounded-lg flex items-center justify-center gap-1"
                      >
                        <Edit3 size={13} /> Sửa
                      </button>
                      <button
                        onClick={() => setConfirmDelete(p.id)}
                        className="text-sm bg-canvas hover:bg-danger-soft hover:text-danger text-muted border border-line px-3 py-1.5 rounded-lg"
                        title="Xoá"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-line rounded-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-fg mb-3">Xoá brand này?</h3>
            <p className="text-sm text-muted mb-6">Hành động này không thể hoàn tác.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 rounded-lg bg-raised text-fg hover:bg-raised-2 text-sm">Huỷ</button>
              <button onClick={() => handleDelete(confirmDelete)} className="px-4 py-2 rounded-lg bg-danger-fg text-white hover:bg-danger-fg text-sm">Xoá</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ────────────────── Editor ──────────────────

interface EditorProps {
  draft: BrandProject;
  onChange: (p: BrandProject) => void;
  onCancel: () => void;
  onSave: () => void;
  error: string | null;
  busy?: boolean;
}

const BrandEditor: React.FC<EditorProps> = ({ draft, onChange, onCancel, onSave, error, busy: parentBusy }) => {
  const logoInput = useRef<HTMLInputElement>(null);
  const styleInput = useRef<HTMLInputElement>(null);
  const productInput = useRef<HTMLInputElement>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const busy = !!parentBusy || localBusy;
  const setBusy = setLocalBusy;

  const totalImages = useMemo(
    () => draft.styleReferences.length + draft.productReferences.length + (draft.logo ? 1 : 0),
    [draft]
  );

  const update = (patch: Partial<BrandProject>) => onChange({ ...draft, ...patch });

  const handleLogo = async (files: FileList) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const file = files[0];
      const { base64, mimeType } = await compressForLibrary(file, 1024, 0.85);
      const item: LibraryImage = {
        id: Math.random().toString(36).substring(7),
        base64, mimeType, fileName: file.name, addedAt: Date.now(),
      };
      update({ logo: item });
    } finally { setBusy(false); }
  };

  const handleRefs = async (files: FileList, slot: RefSlot) => {
    if (!files.length) return;
    const current = draft[slot];
    const room = MAX_REFERENCES - current.length;
    if (room <= 0) return;
    setBusy(true);
    try {
      const items = await Promise.all(
        Array.from(files).slice(0, room).map(async (file) => {
          const { base64, mimeType } = await compressForLibrary(file, 1280, 0.82);
          return {
            id: Math.random().toString(36).substring(7),
            base64, mimeType, fileName: file.name, addedAt: Date.now(),
          } as LibraryImage;
        })
      );
      update({ [slot]: [...current, ...items] } as Partial<BrandProject>);
    } finally { setBusy(false); }
  };

  const removeRef = (id: string, slot: RefSlot) => {
    update({ [slot]: draft[slot].filter(r => r.id !== id) } as Partial<BrandProject>);
  };

  const renderRefBlock = (
    label: string,
    slot: RefSlot,
    inputRef: React.RefObject<HTMLInputElement | null>,
    accentClass: string,
  ) => (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-muted flex items-center gap-1.5">
          <ImageIcon size={12} className={accentClass} /> {label}
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              const files = await readImagesFromClipboard();
              if (files.length > 0) handleRefs(filesToFileList(files), slot);
            }}
            className="text-[10px] flex items-center gap-1 px-2 py-0.5 rounded bg-raised hover:bg-raised-2 text-fg border border-line-strong"
            title="Dán ảnh từ clipboard"
          >
            <Clipboard size={10} /> Dán
          </button>
          <span className="text-[10px] text-subtle">{draft[slot].length}/{MAX_REFERENCES}</span>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {draft[slot].map(r => (
          <div key={r.id} className="relative group aspect-square rounded-md overflow-hidden bg-canvas border border-line">
            <img src={r.url || r.base64} alt="ref" className="w-full h-full object-cover" />
            <button
              onClick={() => removeRef(r.id, slot)}
              className="absolute top-1 right-1 bg-black/70 hover:bg-danger-soft text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {draft[slot].length < MAX_REFERENCES && (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex flex-col items-center justify-center aspect-square rounded-md bg-raised hover:bg-raised-2 border border-line-strong text-muted hover:text-fg disabled:opacity-50"
          >
            <Upload size={18} />
            <span className="text-[9px] mt-1">Thêm</span>
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleRefs(e.target.files, slot);
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg">
          {draft.createdAt === draft.updatedAt && !draft.name ? 'Brand mới' : `Sửa: ${draft.name || 'Brand'}`}
        </h2>
        <div className="flex gap-2">
          <button onClick={onCancel} className="text-xs px-3 py-2 rounded-lg bg-raised hover:bg-raised-2 text-fg flex items-center gap-1.5">
            <X size={14} /> Huỷ
          </button>
          <button onClick={onSave} disabled={busy} className="text-xs px-4 py-2 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-50 text-white flex items-center gap-1.5 font-medium">
            <Save size={14} /> Lưu
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-danger-soft border border-danger-fg/40 rounded-md p-3 text-xs text-danger">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-surface border border-line rounded-xl p-5 space-y-4">
          <div>
            <label className="text-xs text-muted mb-1 block">Tên Brand *</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="VD: Coachio Spring 2026"
              className="w-full bg-canvas border border-line rounded-md p-3 text-sm text-fg focus:outline-none focus:border-brand"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-muted flex items-center gap-1.5"><ImageIcon size={12} /> Logo</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const files = await readImagesFromClipboard();
                    if (files.length > 0) handleLogo(filesToFileList(files));
                  }}
                  className="text-[10px] flex items-center gap-1 px-2 py-0.5 rounded bg-raised hover:bg-raised-2 text-fg border border-line-strong"
                  title="Dán ảnh logo từ clipboard"
                >
                  <Clipboard size={10} /> Dán
                </button>
                <span className="text-[10px] text-subtle">tuỳ chọn · 1 ảnh</span>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {draft.logo ? (
                <div className="relative group aspect-square rounded-md overflow-hidden bg-canvas border border-line">
                  <img src={draft.logo.url || draft.logo.base64} alt="logo" className="w-full h-full object-cover" />
                  <button
                    onClick={() => update({ logo: undefined })}
                    className="absolute top-1 right-1 bg-black/70 hover:bg-danger-soft text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => logoInput.current?.click()}
                  className="flex flex-col items-center justify-center aspect-square rounded-md bg-raised hover:bg-raised-2 border border-line-strong text-muted hover:text-fg"
                >
                  <Upload size={18} />
                  <span className="text-[9px] mt-1">Logo</span>
                </button>
              )}
            </div>
            <input ref={logoInput} type="file" accept="image/*" className="hidden"
              onChange={(e) => { if (e.target.files) handleLogo(e.target.files); if (logoInput.current) logoInput.current.value = ''; }} />
          </div>

          {renderRefBlock('Style References', 'styleReferences', styleInput, 'text-brand')}
          {renderRefBlock('Product References', 'productReferences', productInput, 'text-info')}

          <p className="text-[10px] text-subtle">
            Tổng ảnh: <span className="text-fg">{totalImages}</span> · gợi ý 4–5 ảnh.
          </p>
        </section>

        <section className="bg-surface border border-line rounded-xl p-5 space-y-4">
          <div>
            <label className="text-xs text-muted mb-1 block">Brand Info</label>
            <textarea
              value={draft.brandInfo}
              onChange={(e) => update({ brandInfo: e.target.value })}
              placeholder="Tên thương hiệu, slogan, tone of voice…"
              className="w-full h-24 bg-canvas border border-line rounded-md p-3 text-sm text-fg focus:outline-none focus:border-brand resize-none"
            />
          </div>

          <div>
            <label className="text-xs text-muted mb-1 block">Event / Campaign Info</label>
            <textarea
              value={draft.eventInfo}
              onChange={(e) => update({ eventInfo: e.target.value })}
              placeholder="VD: Summer Sale 50% off · diễn ra 01/06–15/06"
              className="w-full h-24 bg-canvas border border-line rounded-md p-3 text-sm text-fg focus:outline-none focus:border-brand resize-none"
            />
          </div>

          <div>
            <label className="text-xs text-muted mb-1 flex items-center gap-1.5">
              <FileJson size={12} /> Style Notes (tuỳ chọn — JSON / MD / text đều được)
            </label>
            <textarea
              value={draft.jsonPrompt}
              onChange={(e) => update({ jsonPrompt: e.target.value })}
              placeholder={'Chấp nhận mọi format:\n\n1. JSON:\n{\n  "palette": ["#000", "#fff"],\n  "mood": "minimalist"\n}\n\n2. Markdown:\n- Palette: đen + trắng\n- Mood: minimalist\n- Typography: sans-serif\n\n3. Text tự do:\nBrand tối giản, palette đen trắng...'}
              className="w-full h-32 bg-canvas border border-line rounded-md p-3 text-xs font-mono text-fg focus:outline-none focus:border-brand resize-none"
            />
            <p className="text-[10px] text-subtle mt-1">
              Sẽ được nối vào prompt khi áp dụng brand. Model đọc được cả JSON, Markdown, plain text.
            </p>
          </div>
        </section>
      </div>

      {/* Full-width URL Import section — needs brand to be saved first */}
      <BrandUrlImportPanel
        draft={draft}
        onChange={(patch) => update(patch)}
      />
    </div>
  );
};
