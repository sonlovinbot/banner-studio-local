import React, { useEffect, useState } from 'react';
import { Wand2, Mail, Lock, User as UserIcon, ArrowRight, AlertCircle, Sparkles, Loader2 } from 'lucide-react';
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithMagicLink,
  onAuthChange,
  getCurrentUser,
  AuthUser,
} from '../services/authService';
import { isLocalMode, ensureLocalSession } from '../services/supabaseClient';
import { APP_VERSION, APP_VERSION_NAME } from '../appdata/appVersion';
import { bootstrapCoachioKeyFromCloud } from '../services/coachioService';
import { bootstrapFirecrawlKeyFromCloud } from '../services/firecrawlKey';
import { bootstrapKieKeyFromServer } from '../services/kieService';

interface AuthGateProps {
  children: (user: AuthUser) => React.ReactNode;
}

type Mode = 'signin' | 'signup' | 'magic';

export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Bản local chỉ có một người dùng, chạy trên máy của chính bạn — bắt
    // đăng nhập ở đây không bảo vệ được gì mà chỉ thêm một bước vô nghĩa.
    // Server local tự cấp session, nên vào thẳng app.
    if (isLocalMode) {
      ensureLocalSession()
        .then(() => getCurrentUser())
        .then((u) => {
          if (cancelled) return;
          setUser(u);
          setLoading(false);
          if (u) {
            bootstrapCoachioKeyFromCloud().catch(() => {});
            bootstrapFirecrawlKeyFromCloud().catch(() => {});
            bootstrapKieKeyFromServer().catch(() => {});
          }
        })
        .catch((err) => {
          console.error('[AuthGate] server local không phản hồi', err);
          if (!cancelled) { setLocalError(err?.message || 'unknown'); setLoading(false); }
        });
      return () => { cancelled = true; };
    }

    // Race with a short timeout so the spinner never hangs. Purge cached
    // Supabase session tokens ONLY when the SDK genuinely failed (timed out
    // or threw). A clean null return just means "not signed in" — nothing
    // to purge. Purging on transient network blips would log out healthy
    // users, which then hides their data because RLS filters by auth.uid.
    let timedOut = false;
    let errored = false;
    const timeout = new Promise<null>((resolve) => setTimeout(() => {
      timedOut = true;
      resolve(null);
    }, 3000));

    Promise.race([getCurrentUser(), timeout])
      .catch((err) => {
        console.warn('[AuthGate] getCurrentUser threw, falling through to login', err);
        errored = true;
        return null;
      })
      .then((u) => {
        if (cancelled) return;

        if (timedOut || errored) {
          try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
              const k = localStorage.key(i);
              if (k && (k.startsWith('sb-') || k === 'supabase.auth.token')) {
                localStorage.removeItem(k);
              }
            }
          } catch { /* ignore */ }
        }

        setUser(u);
        setLoading(false);
        if (u) {
          bootstrapCoachioKeyFromCloud().catch(() => {});
          bootstrapFirecrawlKeyFromCloud().catch(() => {});
        }
      });

    const off = onAuthChange((u) => {
      setUser(u);
      if (u) {
        bootstrapCoachioKeyFromCloud().catch(() => {});
        bootstrapFirecrawlKeyFromCloud().catch(() => {});
      }
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas text-fg">
        <Loader2 className="animate-spin text-brand" size={28} />
      </div>
    );
  }

  if (localError) {
    return <LocalServerDown detail={localError} />;
  }

  if (!user) {
    return <LoginScreen />;
  }

  return <>{children(user)}</>;
};

/** Lỗi hay gặp nhất của bản local: chỉ chạy `vite` mà quên server API.
 *  Nói thẳng câu lệnh cần chạy, đừng để màn hình trắng. */
const LocalServerDown: React.FC<{ detail: string }> = ({ detail }) => (
  <div className="min-h-screen flex items-center justify-center bg-canvas text-fg p-6">
    <div className="max-w-md w-full bg-surface border border-line rounded-xl p-6 shadow-pop">
      <div className="flex items-center gap-3 mb-3">
        <div className="bg-warning-soft text-warning p-2 rounded-md border border-warning-fg/40">
          <AlertCircle size={18} />
        </div>
        <h2 className="text-base font-bold">Chưa kết nối được server local</h2>
      </div>
      <p className="text-sm text-muted mb-3">
        Giao diện đang chạy nhưng không gọi được API ở cổng 5174. Thường là do
        chỉ chạy <code className="bg-raised px-1.5 py-0.5 rounded font-mono text-[12px]">vite</code> mà thiếu server.
      </p>
      <pre className="bg-raised text-xs p-3 rounded-md font-mono overflow-x-auto">npm run dev</pre>
      <p className="text-[11px] text-subtle mt-3">
        Lệnh này chạy cả server local và giao diện. Chi tiết lỗi: {detail}
      </p>
    </div>
  </div>
);

const LoginScreen: React.FC = () => {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email, password);
      } else if (mode === 'signup') {
        await signUpWithEmail(email, password, displayName || undefined);
        setMsg({ kind: 'ok', text: 'Đăng ký thành công. Đang đăng nhập...' });
      } else {
        await signInWithMagicLink(email);
        setMsg({ kind: 'ok', text: 'Magic link đã gửi tới email. Kiểm tra inbox.' });
      }
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message || 'Có lỗi xảy ra' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas text-fg p-6">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center bg-brand text-white p-3 rounded-xl border-2 border-fg/10 shadow-pop mb-3">
            <Wand2 size={22} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Banner Studio</h1>
          <p className="text-[11px] text-subtle font-mono mt-0.5">
            v{APP_VERSION} · {APP_VERSION_NAME}
          </p>
        </div>

        <div className="bg-surface border border-line rounded-xl p-6 shadow-pop">
          {/* Tabs */}
          <div className="flex gap-1 mb-5 bg-raised rounded-md p-1">
            <TabBtn active={mode === 'signin'} onClick={() => setMode('signin')}>Đăng nhập</TabBtn>
            <TabBtn active={mode === 'signup'} onClick={() => setMode('signup')}>Đăng ký</TabBtn>
            <TabBtn active={mode === 'magic'}  onClick={() => setMode('magic')}>Magic Link</TabBtn>
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === 'signup' && (
              <Field icon={<UserIcon size={14} />} label="Tên hiển thị">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Bạn muốn được gọi là gì?"
                  className="w-full bg-canvas border border-line rounded-md px-3 py-2 text-sm focus:outline-none focus:border-brand"
                />
              </Field>
            )}

            <Field icon={<Mail size={14} />} label="Email">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ban@example.com"
                className="w-full bg-canvas border border-line rounded-md px-3 py-2 text-sm focus:outline-none focus:border-brand"
              />
            </Field>

            {mode !== 'magic' && (
              <Field icon={<Lock size={14} />} label="Mật khẩu">
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Ít nhất 6 ký tự"
                  className="w-full bg-canvas border border-line rounded-md px-3 py-2 text-sm focus:outline-none focus:border-brand"
                />
              </Field>
            )}

            {msg && (
              <div className={`text-xs rounded-md p-2.5 flex items-start gap-2 border ${
                msg.kind === 'err'
                  ? 'bg-danger-soft border-danger-fg/40 text-danger'
                  : 'bg-success-soft border-success-fg/40 text-success'
              }`}>
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                {msg.text}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-brand hover:bg-brand-dark text-white font-medium py-2.5 rounded-md flex items-center justify-center gap-2 transition-colors shadow-pop disabled:opacity-60"
            >
              {busy ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <>
                  {mode === 'signin' && <>Đăng nhập <ArrowRight size={16} /></>}
                  {mode === 'signup' && <>Tạo tài khoản <Sparkles size={16} /></>}
                  {mode === 'magic'  && <>Gửi magic link <Mail size={16} /></>}
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-subtle mt-4">
          Dữ liệu lưu cá nhân qua Supabase. RLS bật mặc định — chỉ bạn đọc được data của bạn.
        </p>
      </div>
    </div>
  );
};

const TabBtn: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex-1 text-xs py-1.5 rounded transition-colors ${
      active ? 'bg-canvas text-fg shadow-sm' : 'text-muted hover:text-fg'
    }`}
  >
    {children}
  </button>
);

const Field: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode }> = ({ icon, label, children }) => (
  <div>
    <label className="text-[11px] font-medium text-muted flex items-center gap-1.5 mb-1">
      {icon} {label}
    </label>
    {children}
  </div>
);
