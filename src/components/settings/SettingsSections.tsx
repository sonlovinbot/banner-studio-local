// Các section của trang Settings: Hồ sơ, API keys, Lưu trữ.
// Tab Media nằm riêng ở ./settings/MediaSection.

import React, { useEffect, useRef, useState } from 'react';
import {
  Key, ExternalLink, Eye, EyeOff, CheckCircle, Loader2, Camera, X,
  ChevronDown, ChevronRight, Save, Trash2, AlertCircle, HardDrive, Sparkles,
} from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import {
  getCoachioApiKey, setCoachioApiKey, removeCoachioApiKey, validateCoachioApiKey,
} from '../../services/coachioService';
import {
  getOpenaiApiKey, setOpenaiApiKey, removeOpenaiApiKey, isOpenaiKeyFromEnv,
} from '../../services/openaiImageService';
import {
  getGeminiApiKey, setGeminiApiKey, removeGeminiApiKey,
} from '../../services/storageService';
import { getSupabase } from '../../services/supabaseClient';
import { uploadToStorage } from '../../services/uploadService';
import { compressForUpload } from '../../services/imageUtils';
import {
  inventoryLocalStorage, clearGroups, formatBytes, StorageReport, StorageGroupId,
} from '../../services/storageCleanupService';
import {
  getFirecrawlApiKey, setFirecrawlApiKey, removeFirecrawlApiKey,
} from '../../services/firecrawlKey';
import {
  getKieApiKey, setKieApiKey, removeKieApiKey, syncKieKeyToServer,
} from '../../services/kieService';

const maskKey = (key: string) => key ? key.slice(0, 6) + '…' + key.slice(-4) : '';

// ────────────── Profile ──────────────

export const ProfileSection: React.FC<{ user?: User }> = ({ user }) => {
  const initialDisplay = (user?.user_metadata?.display_name as string) || '';
  const initialAvatar = (user?.user_metadata?.avatar_url as string) || '';
  const [displayName, setDisplayName] = useState(initialDisplay);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatar);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = displayName !== initialDisplay || avatarUrl !== initialAvatar;

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const { error } = await getSupabase().auth.updateUser({
        data: { display_name: displayName.trim() || undefined, avatar_url: avatarUrl || undefined },
      });
      if (error) throw error;
      setSavedAt(Date.now());
    } catch (e: any) {
      setError(e?.message || 'Lưu profile lỗi');
    } finally {
      setSaving(false);
    }
  };

  const handleFile = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      // Try storage local upload first (production). If /api/upload returns 404
      // (Vite dev mode without `vercel dev`), fall back to a compressed base64
      // data URL so avatar still works locally without server infra.
      try {
        const res = await uploadToStorage(file, 'misc');
        setAvatarUrl(res.url);
      } catch (uploadErr: any) {
        const msg = String(uploadErr?.message || '');
        const looksLike404 = msg.includes('404') || msg.toLowerCase().includes('not found');
        if (!looksLike404) throw uploadErr;
        // Fallback: aggressively compress to a tiny base64 avatar so it fits
        // in Supabase user_metadata without a CDN.
        const { dataUrl } = await compressForUpload(file, 256, 0.7);
        setAvatarUrl(dataUrl);
      }
    } catch (e: any) {
      setError(`Upload avatar lỗi: ${e?.message || e}`);
    } finally {
      setUploading(false);
    }
  };

  const initial = (displayName || user?.email || '?').slice(0, 1).toUpperCase();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <div className="relative">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="w-20 h-20 rounded-full object-cover border-2 border-line" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-brand/15 text-brand flex items-center justify-center text-2xl font-bold border-2 border-line">
              {initial}
            </div>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="absolute -bottom-1 -right-1 bg-brand hover:bg-brand-dark text-white p-1.5 rounded-full shadow-pop disabled:opacity-50"
            title="Đổi avatar"
          >
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-fg truncate">{displayName || user?.email?.split('@')[0]}</p>
          <p className="text-xs text-subtle truncate">{user?.email}</p>
          <p className="text-[10px] text-muted mt-0.5 font-mono">{user?.id?.slice(0, 8)}</p>
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted block mb-1.5">Tên hiển thị</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="VD: Sơn từ Coachio"
          className="w-full bg-canvas border border-line rounded-md px-3 py-2 text-sm focus:outline-none focus:border-brand"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted block mb-1.5">Email</label>
        <input
          type="email"
          value={user?.email || ''}
          readOnly
          className="w-full bg-raised border border-line rounded-md px-3 py-2 text-sm text-muted cursor-not-allowed"
        />
        <p className="text-xs text-muted mt-1">Email được Supabase quản lý, không sửa trực tiếp ở đây.</p>
      </div>

      {error && (
        <div className="status-danger border text-sm px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="text-sm bg-brand hover:bg-brand-dark disabled:bg-raised disabled:text-subtle text-white px-4 py-2 rounded-lg font-medium flex items-center gap-1.5"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Lưu hồ sơ
        </button>
        {savedAt && !dirty && (
          <span className="text-sm text-success flex items-center gap-1">
            <CheckCircle size={14} /> Đã lưu
          </span>
        )}
      </div>
    </div>
  );
};

// ────────────── API Keys ──────────────

export const KeysSection: React.FC<{ user?: User }> = ({ user }) => {
  const [showCoachio, setShowCoachio] = useState(false);
  const [showOpenai, setShowOpenai] = useState(false);
  const [showFirecrawl, setShowFirecrawl] = useState(false);
  const [showKie, setShowKie] = useState(false);
  const coachioSaved = !!getCoachioApiKey();
  const openaiSaved = !!getOpenaiApiKey();
  const openaiFromEnv = isOpenaiKeyFromEnv();
  const firecrawlSaved = !!getFirecrawlApiKey();
  const kieSaved = !!getKieApiKey();
  // Gemini vẫn còn trong mã nguồn như một backend phụ, nhưng không hiện ô
  // nhập key ở đây để trang Settings gọn — đặt VITE_GEMINI_API_KEY nếu cần.
  void getGeminiApiKey;

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-subtle">
        Sau khi bấm <span className="text-fg font-semibold">Lưu</span>, box sẽ tự thu lại.
        Bấm vào tiêu đề để mở lại sửa key.
      </p>

      <KeyCard
        accent="orange"
        title="Coachio AI"
        subtitle="Image gen 1K (default) + LLM chat"
        helpUrl="https://studio.coachio.ai/"
        helpLabel="Mở Coachio Studio"
        savedBadge={coachioSaved}
        expanded={showCoachio}
        onToggle={() => setShowCoachio(s => !s)}
      >
        <CoachioForm onSaved={() => setShowCoachio(false)} />
      </KeyCard>

      <KeyCard
        accent="orange"
        title="OpenAI (2K / 4K)"
        subtitle={openaiFromEnv
          ? 'Đang dùng key từ VITE_OPENAI_API_KEY (env). Lưu key ở đây để override.'
          : 'Auto-route khi chọn quality 2K hoặc 4K.'}
        helpUrl="https://platform.openai.com/api-keys"
        helpLabel="Lấy key từ OpenAI"
        savedBadge={openaiSaved}
        expanded={showOpenai}
        onToggle={() => setShowOpenai(s => !s)}
      >
        <OpenaiForm onSaved={() => setShowOpenai(false)} />
      </KeyCard>

      <KeyCard
        accent="indigo"
        title="KIE.ai"
        subtitle="Một key chạy nhiều model (Nano Banana, Veo, Suno)"
        helpUrl="https://kie.ai/api-key"
        helpLabel="Lấy key từ KIE"
        savedBadge={kieSaved}
        expanded={showKie}
        onToggle={() => setShowKie(s => !s)}
      >
        <KieForm onSaved={() => setShowKie(false)} />
      </KeyCard>

      <KeyCard
        accent="indigo"
        title="Firecrawl"
        subtitle="Scrape URL → markdown cho URL Import trong Brand Style"
        helpUrl="https://firecrawl.dev/app/api-keys"
        helpLabel="Lấy key từ Firecrawl"
        savedBadge={firecrawlSaved}
        expanded={showFirecrawl}
        onToggle={() => setShowFirecrawl(s => !s)}
      >
        <FirecrawlForm onSaved={() => setShowFirecrawl(false)} />
      </KeyCard>
    </div>
  );
};

const KeyCard: React.FC<{
  accent: 'indigo' | 'orange';
  title: string;
  subtitle: string;
  helpUrl: string;
  helpLabel: string;
  savedBadge: boolean;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ accent, title, subtitle, helpUrl, helpLabel, savedBadge, expanded, onToggle, children }) => {
  void accent;
  return (
    <div className="border border-line rounded-xl overflow-hidden bg-surface">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-raised transition-colors"
      >
        <div className="p-2 rounded-lg bg-brand text-white">
          <Sparkles size={14} />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-semibold text-fg flex items-center gap-2">
            {title}
            {savedBadge && <span className="text-xs status-success border px-2 py-0.5 rounded-md font-medium">đã lưu</span>}
          </p>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
        {expanded ? <ChevronDown size={16} className="text-muted" /> : <ChevronRight size={16} className="text-muted" />}
      </button>
      {expanded && (
        <div className="border-t border-line p-4 space-y-3">
          <a
            href={helpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-brand hover:underline inline-flex items-center gap-1"
          >
            {helpLabel} <ExternalLink size={10} />
          </a>
          {children}
        </div>
      )}
    </div>
  );
};

const GeminiForm: React.FC<{ onSaved: () => void }> = ({ onSaved }) => {
  const [key, setKey] = useState(getGeminiApiKey());
  const [show, setShow] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const save = () => {
    if (!key.trim()) return;
    setGeminiApiKey(key.trim());
    setSavedFlash(true);
    setTimeout(() => { setSavedFlash(false); onSaved(); }, 400);
  };

  const remove = () => {
    removeGeminiApiKey();
    setKey('');
  };

  return (
    <>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="AIzaSy..."
          className="w-full bg-canvas border border-line rounded-lg px-3 py-2.5 pr-10 text-sm font-mono focus:outline-none focus:border-brand"
        />
        <button
          onClick={() => setShow(!show)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-fg"
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {key && (
        <p className="text-xs font-mono text-muted">Hiện tại: {maskKey(key)}</p>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={save}
          disabled={!key.trim() || savedFlash}
          className="text-sm bg-brand hover:bg-brand-dark disabled:opacity-50 text-white px-3 py-2 rounded-lg flex items-center gap-1.5 font-medium"
        >
          {savedFlash ? <CheckCircle size={14} /> : <Save size={14} />}
          {savedFlash ? 'Đã lưu' : 'Lưu key'}
        </button>
        {key && (
          <button
            onClick={remove}
            className="text-sm text-danger hover:bg-danger-soft px-3 py-2 rounded-lg border border-line"
          >
            Xoá
          </button>
        )}
      </div>
    </>
  );
};

const CoachioForm: React.FC<{ onSaved: () => void }> = ({ onSaved }) => {
  const [key, setKey] = useState(getCoachioApiKey());
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [savedFlash, setSavedFlash] = useState(false);

  const validate = async () => {
    if (!key.trim()) return;
    setStatus('validating');
    const ok = await validateCoachioApiKey(key.trim());
    setStatus(ok ? 'valid' : 'invalid');
  };

  const save = () => {
    if (!key.trim()) return;
    setCoachioApiKey(key.trim());
    setSavedFlash(true);
    setTimeout(() => { setSavedFlash(false); onSaved(); }, 400);
  };

  const remove = () => {
    removeCoachioApiKey();
    setKey('');
    setStatus('idle');
  };

  return (
    <>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={key}
          onChange={(e) => { setKey(e.target.value); setStatus('idle'); }}
          placeholder="lv_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          className="w-full bg-canvas border border-line rounded-lg px-3 py-2.5 pr-10 text-sm font-mono focus:outline-none focus:border-brand"
        />
        <button
          onClick={() => setShow(!show)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-fg"
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {key && (
        <p className="text-xs font-mono text-muted">Hiện tại: {maskKey(key)}</p>
      )}
      {status !== 'idle' && (
        <div className={`text-sm flex items-center gap-1.5 px-3 py-2 rounded-lg border ${
          status === 'validating' ? 'status-info' :
          status === 'valid'      ? 'status-success' :
                                    'status-danger'
        }`}>
          {status === 'validating' && <><Loader2 size={14} className="animate-spin" /> Đang validate...</>}
          {status === 'valid' && <><CheckCircle size={14} /> Key hợp lệ</>}
          {status === 'invalid' && <><X size={14} /> Key sai hoặc hết credit</>}
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={save}
          disabled={!key.trim() || savedFlash}
          className="text-sm bg-brand hover:bg-brand-dark disabled:opacity-50 text-white px-3 py-2 rounded-lg flex items-center gap-1.5 font-medium"
        >
          {savedFlash ? <CheckCircle size={14} /> : <Save size={14} />}
          {savedFlash ? 'Đã lưu' : 'Lưu key'}
        </button>
        <button
          onClick={validate}
          disabled={!key.trim() || status === 'validating'}
          className="text-sm bg-canvas hover:bg-raised text-fg px-3 py-2 rounded-lg border border-line-strong disabled:opacity-50 font-medium"
        >
          Test key
        </button>
        {key && (
          <button
            onClick={remove}
            className="text-sm text-danger hover:bg-danger-soft px-3 py-2 rounded-lg border border-line"
          >
            Xoá
          </button>
        )}
      </div>
    </>
  );
};

const OpenaiForm: React.FC<{ onSaved: () => void }> = ({ onSaved }) => {
  const [key, setKey] = useState(getOpenaiApiKey());
  const [show, setShow] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const save = () => {
    if (!key.trim()) return;
    setOpenaiApiKey(key.trim());
    setSavedFlash(true);
    setTimeout(() => { setSavedFlash(false); onSaved(); }, 400);
  };

  const remove = () => {
    removeOpenaiApiKey();
    setKey('');
  };

  return (
    <>
      <div className="text-[11px] text-muted bg-canvas border border-line rounded-md p-2 mb-2">
        <b>Auto-routing</b>: khi user chọn <b>2K</b> hoặc <b>4K</b> quality,
        Banner Tool dùng OpenAI thay Coachio. 1K vẫn dùng Coachio (rẻ hơn).
      </div>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          className="w-full bg-canvas border border-line rounded-lg px-3 py-2.5 pr-10 text-sm font-mono focus:outline-none focus:border-brand"
        />
        <button onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-fg">
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {key && <p className="text-xs font-mono text-muted">Hiện tại: {maskKey(key)}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={save}
          disabled={!key.trim() || savedFlash}
          className="text-sm bg-brand hover:bg-brand-dark disabled:opacity-50 text-white px-3 py-2 rounded-lg flex items-center gap-1.5 font-medium"
        >
          {savedFlash ? <CheckCircle size={14} /> : <Save size={14} />}
          {savedFlash ? 'Đã lưu' : 'Lưu key'}
        </button>
        {key && (
          <button onClick={remove} className="text-sm text-danger hover:bg-danger-soft px-3 py-2 rounded-lg border border-line">
            Xoá
          </button>
        )}
      </div>
    </>
  );
};

/** Key KIE lưu ở hai nơi: localStorage để front-end gọi, và DB để server
 *  local + MCP đọc được (chúng chạy ở tiến trình khác, không thấy localStorage). */
const KieForm: React.FC<{ onSaved: () => void }> = ({ onSaved }) => {
  const [key, setKey] = useState(getKieApiKey());
  const [show, setShow] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const save = async () => {
    const k = key.trim();
    if (!k) return;
    setKieApiKey(k);
    await syncKieKeyToServer(k).catch(e => console.warn('[kie] đồng bộ key xuống server lỗi', e));
    setSavedFlash(true);
    setTimeout(() => { setSavedFlash(false); onSaved(); }, 400);
  };

  const remove = async () => {
    removeKieApiKey();
    setKey('');
    await syncKieKeyToServer(null).catch(() => {});
  };

  return (
    <>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Dán key từ kie.ai/api-key"
          className="w-full bg-canvas border border-line rounded-lg px-3 py-2.5 pr-10 text-sm font-mono focus:outline-none focus:border-brand"
        />
        <button onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-fg">
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {key && <p className="text-xs font-mono text-muted">Hiện tại: {maskKey(key)}</p>}
      <p className="text-[11px] text-muted">
        Dùng ở Banner Tool → chọn chất lượng 2K/4K → backend KIE. Chỉ sinh ảnh
        từ prompt, không nhận ảnh reference.
      </p>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={save}
          disabled={!key.trim() || savedFlash}
          className="text-sm bg-brand hover:bg-brand-dark disabled:opacity-50 text-white px-3 py-2 rounded-lg flex items-center gap-1.5 font-medium"
        >
          {savedFlash ? <CheckCircle size={14} /> : <Save size={14} />}
          {savedFlash ? 'Đã lưu' : 'Lưu key'}
        </button>
        {key && (
          <button onClick={remove} className="text-sm text-danger hover:bg-danger-soft px-3 py-2 rounded-lg border border-line">
            Xoá
          </button>
        )}
      </div>
    </>
  );
};

const FirecrawlForm: React.FC<{ onSaved: () => void }> = ({ onSaved }) => {
  const [key, setKey] = useState(getFirecrawlApiKey());
  const [show, setShow] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const save = () => {
    if (!key.trim()) return;
    setFirecrawlApiKey(key.trim());
    setSavedFlash(true);
    setTimeout(() => { setSavedFlash(false); onSaved(); }, 400);
  };

  const remove = () => {
    removeFirecrawlApiKey();
    setKey('');
  };

  return (
    <>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="fc-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          className="w-full bg-canvas border border-line rounded-lg px-3 py-2.5 pr-10 text-sm font-mono focus:outline-none focus:border-brand"
        />
        <button onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-fg">
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {key && <p className="text-xs font-mono text-muted">Hiện tại: {maskKey(key)}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={save}
          disabled={!key.trim() || savedFlash}
          className="text-sm bg-brand hover:bg-brand-dark disabled:opacity-50 text-white px-3 py-2 rounded-lg flex items-center gap-1.5 font-medium"
        >
          {savedFlash ? <CheckCircle size={14} /> : <Save size={14} />}
          {savedFlash ? 'Đã lưu' : 'Lưu key'}
        </button>
        {key && (
          <button onClick={remove} className="text-sm text-danger hover:bg-danger-soft px-3 py-2 rounded-lg border border-line">
            Xoá
          </button>
        )}
      </div>
    </>
  );
};

// ────────────── Storage cleanup ──────────────

export const StorageSection: React.FC = () => {
  const [report, setReport] = useState<StorageReport | null>(null);
  const [selected, setSelected] = useState<Set<StorageGroupId>>(new Set());
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    const r = await inventoryLocalStorage();
    setReport(r);
    // pre-select all safe groups
    setSelected(new Set(r.groups.filter(g => g.safe).map(g => g.id)));
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const toggle = (id: StorageGroupId) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleClear = async () => {
    if (!report || selected.size === 0) return;
    const unsafe = report.groups.filter(g => selected.has(g.id) && !g.safe);
    if (unsafe.length > 0) {
      const msg = `Bạn đang xoá nhóm KHÔNG an toàn:\n\n${unsafe.map(g => `• ${g.label}`).join('\n')}\n\nTiếp tục?`;
      if (!confirm(msg)) return;
    }
    setClearing(true);
    const reclaimed = clearGroups(Array.from(selected), report.items);
    setFlash(`Đã giải phóng ${formatBytes(reclaimed)}`);
    setTimeout(() => setFlash(null), 3000);
    await refresh();
    setClearing(false);
  };

  if (loading || !report) {
    return (
      <div className="py-12 text-center text-muted">
        <Loader2 className="animate-spin mx-auto" size={20} />
      </div>
    );
  }

  const usagePct = report.quotaBytes
    ? Math.min(100, (report.totalBytes / report.quotaBytes) * 100)
    : null;
  const usageBarColor =
    usagePct == null ? 'bg-brand' :
    usagePct > 80    ? 'bg-danger-fg' :
    usagePct > 50    ? 'bg-warning-fg' :
                       'bg-success-fg';

  return (
    <div className="space-y-4">
      {/* Usage bar */}
      <div className="bg-surface border border-line rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-sm font-semibold text-fg">Dung lượng localStorage</p>
            <p className="text-xs text-muted">Browser cap ~5-10 MB. Quá quota → setItem throws, app lỗi.</p>
          </div>
          <span className="text-base font-mono font-semibold text-fg">{formatBytes(report.totalBytes)}</span>
        </div>
        <div className="h-2 bg-raised rounded-full overflow-hidden">
          <div
            className={`h-full transition-all`}
            style={{
              width: `${Math.max(2, usagePct || 0)}%`,
              background: usagePct == null
                ? 'var(--brand)'
                : usagePct > 80 ? 'var(--danger-fg)'
                : usagePct > 50 ? 'var(--warning-fg)'
                : 'var(--success-fg)',
            }}
          />
        </div>
        {report.quotaBytes && (
          <p className="text-xs text-muted mt-1.5">
            ~{Math.round(usagePct || 0)}% của {formatBytes(report.quotaBytes)} (storage estimate — limit thực của localStorage thường nhỏ hơn)
          </p>
        )}
      </div>

      {flash && (
        <div className="status-success border text-sm px-3 py-2 rounded-lg flex items-center gap-2">
          <CheckCircle size={14} /> {flash}
        </div>
      )}

      {/* Group list */}
      <div className="space-y-2">
        {report.groups.map(g => {
          const checked = selected.has(g.id);
          return (
            <label
              key={g.id}
              className={`flex items-start gap-3 p-3 bg-surface border rounded-xl cursor-pointer hover:bg-raised transition-colors ${
                checked ? 'border-brand' : 'border-line'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(g.id)}
                className="mt-0.5 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-fg">{g.label}</p>
                  {g.safe ? (
                    <span className="text-xs status-success border px-2 py-0.5 rounded-md font-medium">an toàn</span>
                  ) : (
                    <span className="text-xs status-warning border px-2 py-0.5 rounded-md font-medium">cẩn thận</span>
                  )}
                </div>
                <p className="text-xs text-muted mt-1 leading-relaxed">{g.description}</p>
                <p className="text-xs text-subtle font-mono mt-1">{g.count} item · {formatBytes(g.bytes)}</p>
              </div>
            </label>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-muted">
          {selected.size === 0
            ? 'Chưa chọn nhóm nào.'
            : `Đã chọn ${selected.size} nhóm.`}
        </p>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            className="text-sm bg-canvas hover:bg-raised text-fg border border-line px-3 py-2 rounded-lg"
          >
            Scan lại
          </button>
          <button
            onClick={handleClear}
            disabled={clearing || selected.size === 0}
            className="text-sm bg-brand hover:bg-brand-dark disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-1.5"
          >
            {clearing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Dọn dẹp
          </button>
        </div>
      </div>
    </div>
  );
};
