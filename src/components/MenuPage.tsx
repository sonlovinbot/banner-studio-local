import React, { useEffect, useState } from 'react';
import {
  Wand2, Clock, ArrowRight, Palette, UserSquare2,
  Tag, X, Sparkles, Image as ImageIcon, Box, Stethoscope, Loader2,
} from 'lucide-react';
import { AppPage, HistoryItem } from '../types';
import { getCoachioApiKey } from '../services/coachioService';
import { getOpenaiApiKey } from '../services/openaiImageService';
import { getKieApiKey } from '../services/kieService';
import { listHistoryPage } from '../services/historyService';
import { listBrandProjectsFromCloud } from '../services/brandProjectService';
import { APP_VERSION, APP_VERSION_NAME, APP_RELEASE_DATE, APP_CHANGELOG } from '../appdata/appVersion';
import { proxiedBannerUrl } from '../services/cdnProxy';
import { getSupabase, isLocalMode } from '../services/supabaseClient';
import { uploadToStorage } from '../services/uploadService';

interface MenuPageProps {
  onNavigate: (page: AppPage) => void;
}

interface ToolCard {
  id: AppPage;
  title: string;
  description: string;
  icon: React.ReactNode;
  accent: string;       // tailwind text class
  bgAccent: string;     // tailwind bg class
}

const TOOLS: ToolCard[] = [
  {
    id: 'banner',
    title: 'Banner Tool',
    description: 'Generate ad banners. Style ref + product → AI sinh nhiều variant.',
    icon: <Wand2 size={20} />,
    accent: 'text-brand',
    bgAccent: 'bg-brand',
  },
  {
    id: 'ugc-studio',
    title: 'UGC Studio',
    description: 'Face-consistent UGC. Khuôn mặt + fashion + product.',
    icon: <UserSquare2 size={20} />,
    accent: 'text-fg',
    bgAccent: 'bg-fg',
  },
  {
    id: 'brand-style',
    title: 'Brand Style',
    description: 'Lưu brand kit: logo, references, JSON prompt cho team.',
    icon: <Palette size={20} />,
    accent: 'text-fg',
    bgAccent: 'bg-fg',
  },
  {
    id: 'history',
    title: 'History',
    description: 'Xem & chỉnh sửa banner đã tạo. Edit prompt + ảnh ref.',
    icon: <Clock size={20} />,
    accent: 'text-fg',
    bgAccent: 'bg-fg',
  },
];

export const MenuPage: React.FC<MenuPageProps> = ({ onNavigate }) => {
  const hasCoachioKey = !!getCoachioApiKey();
  const hasOpenaiKey = !!getOpenaiApiKey();
  const hasKieKey = !!getKieApiKey();
  const [brandCount, setBrandCount] = useState(0);
  const [showChangelog, setShowChangelog] = useState(false);
  const [diagnostic, setDiagnostic] = useState<any | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyCount, setHistoryCount] = useState(0);

  // Dashboard chỉ khoe 4 banner gần nhất — kéo cả list về đây là lãng phí.
  // Tổng số lấy từ `total` của query, không đếm độ dài mảng đã tải.
  useEffect(() => {
    listHistoryPage({ page: 1, pageSize: 4 })
      .then(res => { setHistory(res.items); setHistoryCount(res.total); })
      .catch(() => {});
    // Đếm brand từ DB. Bản cũ đếm từ localStorage nên luôn ra 0 dù DB có dữ liệu.
    listBrandProjectsFromCloud()
      .then(list => setBrandCount(list.length))
      .catch(() => {});
  }, []);

  const recent = history.slice(0, 4);

  const runDiagnostic = async () => {
    setDiagBusy(true);
    setDiagnostic(null);
    const out: any = { steps: [] };
    try {
      out.steps.push({ name: 'Chế độ', value: isLocalMode ? 'local (SQLite trong ./data)' : 'Supabase cloud' });

      const { data } = await getSupabase().auth.getSession();
      const tok = data.session?.access_token;
      out.steps.push({ name: 'Session', value: tok ? `có token (${tok.slice(0, 16)}...)` : 'CHƯA CÓ' });

      const who = await fetch('/api/whoami', { headers: { Authorization: `Bearer ${tok || ''}` } });
      const whoBody = await who.json().catch(() => ({}));
      out.steps.push({ name: 'GET /api/whoami', value: { status: who.status, body: whoBody } });

      // Try real storage local upload with a 1px PNG
      try {
        const tiny = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), c => c.charCodeAt(0));
        const file = new File([tiny], 'diag.png', { type: 'image/png' });
        const result = await uploadToStorage(file, 'misc');
        out.steps.push({ name: 'POST /api/upload', value: result });
      } catch (e: any) {
        out.steps.push({ name: 'POST /api/upload', value: { error: e?.message } });
      }
    } catch (e: any) {
      out.steps.push({ name: 'Unexpected error', value: e?.message });
    } finally {
      setDiagBusy(false);
      setDiagnostic(out);
    }
  };

  return (
    <div className="px-6 py-8 lg:px-10 lg:py-10 max-w-7xl mx-auto w-full">
      {/* Hero / Welcome */}
      <div className="mb-8 flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-subtle mb-2">
            <Sparkles size={12} className="text-brand" /> BANNER STUDIO
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-fg mb-1">
            Chào bạn quay lại.
          </h1>
          <p className="text-sm text-muted">
            {isLocalMode ? 'Chạy local — dữ liệu nằm trong ./data' : 'Đang nối Supabase cloud'}
            {' · '}
            <button
              onClick={() => setShowChangelog(true)}
              className="hover:text-fg underline-offset-4 hover:underline"
            >
              v{APP_VERSION} · {APP_VERSION_NAME}
            </button>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runDiagnostic}
            disabled={diagBusy}
            className="bg-raised hover:bg-raised-2 text-fg border border-line-strong font-medium px-3 py-2.5 rounded-md flex items-center gap-2 transition-colors disabled:opacity-50"
            title="Kiểm tra DB, session và đường upload"
          >
            {diagBusy ? <Loader2 size={16} className="animate-spin" /> : <Stethoscope size={16} />}
            Diagnostic
          </button>
          <button
            onClick={() => onNavigate('banner')}
            className="bg-brand hover:bg-brand-dark text-white font-medium px-5 py-2.5 rounded-md flex items-center gap-2 transition-colors shadow-pop"
          >
            <Wand2 size={16} /> Tạo banner mới
          </button>
        </div>
      </div>

      {diagnostic && (
        <div className="mb-6 bg-surface border border-line rounded-lg p-4 text-xs font-mono">
          <div className="flex items-center justify-between mb-2">
            <span className="text-fg font-semibold">Diagnostic Result</span>
            <button onClick={() => setDiagnostic(null)} className="text-muted hover:text-fg">
              <X size={14} />
            </button>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap text-muted">
{JSON.stringify(diagnostic, null, 2)}
          </pre>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatCard label="Banners trong history" value={historyCount} icon={<Clock size={14} />} accent="text-success" />
        <StatCard label="Brand projects" value={brandCount} icon={<Palette size={14} />} accent="text-fg" />
        <StatCard
          label="Coachio API key"
          value={hasCoachioKey ? 'Đã có' : 'Chưa có'}
          icon={<Box size={14} />}
          accent={hasCoachioKey ? 'text-success' : 'text-subtle'}
          numeric={false}
        />
        <StatCard
          label="OpenAI / KIE"
          value={[hasOpenaiKey && 'OpenAI', hasKieKey && 'KIE'].filter(Boolean).join(' + ') || 'Chưa có'}
          icon={<Box size={14} />}
          accent={hasOpenaiKey || hasKieKey ? 'text-success' : 'text-subtle'}
          numeric={false}
        />
      </div>

      {/* Tools grid */}
      <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle mb-3">Công cụ</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {TOOLS.map(t => (
          <button
            key={t.id}
            onClick={() => onNavigate(t.id)}
            className="group text-left bg-surface border border-line hover:border-line-strong rounded-lg p-5 transition-all hover:shadow-pop"
          >
            <div className={`${t.bgAccent} text-white w-10 h-10 rounded-md flex items-center justify-center mb-4`}>
              {t.icon}
            </div>
            <h2 className="text-sm font-bold text-fg mb-1 flex items-center gap-1">
              {t.title}
              <ArrowRight size={14} className={`opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all ${t.accent}`} />
            </h2>
            <p className="text-xs text-muted leading-relaxed">{t.description}</p>
          </button>
        ))}
      </div>

      {/* Recent banners */}
      {recent.length > 0 && (
        <>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle flex items-center gap-2">
              <ImageIcon size={12} /> Banner gần đây
            </h3>
            <button
              onClick={() => onNavigate('history')}
              className="text-xs text-muted hover:text-fg flex items-center gap-1"
            >
              Xem tất cả <ArrowRight size={12} />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            {recent.map(item => (
              <button
                key={item.id}
                onClick={() => onNavigate('history')}
                className="aspect-square bg-surface border border-line hover:border-line-strong rounded-md overflow-hidden transition-colors group"
              >
                <img src={proxiedBannerUrl(item.imageUrl)} alt="Recent" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
              </button>
            ))}
          </div>
        </>
      )}

      {/* Changelog Modal */}
      {showChangelog && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowChangelog(false)}>
          <div className="bg-surface border border-line rounded-lg max-w-xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-pop-lg" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-center justify-between px-5 py-4 border-b border-line">
              <div className="flex items-center gap-3">
                <div className="bg-brand/10 text-brand p-2 rounded-md border border-brand/20">
                  <Tag size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-fg">Changelog</h3>
                  <p className="text-[11px] text-muted">v{APP_VERSION} · {APP_VERSION_NAME} · {APP_RELEASE_DATE}</p>
                </div>
              </div>
              <button onClick={() => setShowChangelog(false)} className="p-2 rounded-md hover:bg-raised text-muted hover:text-fg">
                <X size={16} />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {APP_CHANGELOG.map((rel) => (
                <div key={rel.version} className="border-l-2 border-brand/50 pl-4">
                  <div className="flex items-baseline gap-2">
                    <h4 className="text-sm font-bold text-fg">v{rel.version}</h4>
                    <span className="text-[11px] text-subtle">· {rel.date}</span>
                  </div>
                  <ul className="mt-1 space-y-1">
                    {rel.highlights.map((h, i) => (
                      <li key={i} className="text-[12px] text-muted leading-snug">• {h}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard: React.FC<{
  label: string; value: string | number; icon: React.ReactNode; accent: string; numeric?: boolean;
}> = ({ label, value, icon, accent, numeric = true }) => (
  <div className="bg-surface border border-line rounded-lg p-4">
    <div className={`flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider mb-2 ${accent}`}>
      {icon} {label}
    </div>
    <div className={`text-2xl font-bold text-fg ${numeric ? 'font-mono' : 'text-base'}`}>
      {value}
    </div>
  </div>
);
