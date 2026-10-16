import React, { useEffect } from 'react';
import { AppPage, SettingsTab } from './types';
import { MenuPage } from './components/MenuPage';
import { BannerTool } from './components/BannerTool';
import { HistoryPage } from './components/HistoryPage';
import { BrandStylePage } from './components/BrandStylePage';
import { UGCStudio } from './components/UGCStudio';
import { SettingsPage } from './components/SettingsPage';
import { AppShell } from './components/AppShell';
import { AuthGate } from './components/AuthGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initTheme } from './services/themeService';
import { useRoute, pushRoute } from './services/router';

export default function App() {
  // URL là nguồn sự thật cho trang hiện tại — F5 và share link đều giữ đúng
  // chỗ user đang đứng, Back/Forward của trình duyệt chạy đúng.
  const { page: currentPage, params } = useRoute();

  // Sub-tab đọc thẳng từ ?tab= nên deep-link được (/settings?tab=keys).
  const settingsInitialTab = (params.get('tab') as SettingsTab | null) || undefined;

  useEffect(() => {
    initTheme();
  }, []);

  /** Single navigation entry — accepts a sub-target so a page can deep-link
   *  vào một tab cụ thể (icon settings → settings/keys). */
  const navigate = (page: AppPage, opts?: { settingsTab?: SettingsTab }) => {
    const tab = opts?.settingsTab;
    pushRoute(page, tab ? { tab } : undefined);
  };

  const renderPage = (user: any) => {
    const pageEl = (() => {
      switch (currentPage) {
        case 'banner':      return <BannerTool onNavigate={navigate} />;
        case 'history':     return <HistoryPage onNavigate={navigate} />;
        case 'brand-style': return <BrandStylePage onNavigate={navigate} />;
        case 'ugc-studio':  return <UGCStudio onNavigate={navigate} />;
        case 'settings':    return <SettingsPage user={user} onNavigate={navigate} initialTab={settingsInitialTab} />;
        default:            return <MenuPage onNavigate={navigate} />;
      }
    })();
    return <ErrorBoundary key={currentPage} label={currentPage}>{pageEl}</ErrorBoundary>;
  };

  return (
    <AuthGate>
      {(user) => (
        <AppShell currentPage={currentPage} onNavigate={navigate} user={user}>
          {renderPage(user)}
        </AppShell>
      )}
    </AuthGate>
  );
}
