// Full Settings page — thay thế ProfileSettingsModal popup. Left sidebar
// submenu + right content. Tab được persist qua URL query param ?tab=xxx
// nên deep-link được (VD: /?tab=media để mở tab Media ngay).

import React, { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  ArrowLeft, User as UserIcon, Key, HardDrive, Image as ImageIcon,
} from 'lucide-react';
import { AppPage, SettingsTab } from '../types';
import { useRoute, setRouteParams } from '../services/router';

const VALID_SETTINGS_TABS: SettingsTab[] = ['profile', 'keys', 'media', 'storage'];
import {
  ProfileSection,
  KeysSection,
  StorageSection,
} from './settings/SettingsSections';
import { MediaSection } from './settings/MediaSection';

interface Props {
  user?: User;
  onNavigate: (page: AppPage) => void;
  /** Initial tab hint từ URL query param hoặc navigate options. */
  initialTab?: SettingsTab;
}

interface SidebarItem {
  id: SettingsTab;
  label: string;
  icon: React.ReactNode;
  hint?: string;
  hidden?: boolean;
}

export const SettingsPage: React.FC<Props> = ({ user, onNavigate, initialTab }) => {
  // Tab sống trong ?tab= qua router chung. Trước đây component tự gọi
  // replaceState và XOÁ ?tab= lúc unmount — cleanup đó chạy sau khi đã điều
  // hướng sang trang khác nên ăn mất ?tab= của trang vừa tới.
  const { params: routeParams } = useRoute();
  const paramTab = routeParams.get('tab') as SettingsTab | null;
  const tab: SettingsTab = (paramTab && VALID_SETTINGS_TABS.includes(paramTab))
    ? paramTab
    : (initialTab || 'profile');
  const setTab = (t: SettingsTab) => setRouteParams({ tab: t });


  const items: SidebarItem[] = [
    { id: 'profile', label: 'Hồ sơ',        icon: <UserIcon size={16} />,  hint: 'Avatar, tên hiển thị, email' },
    { id: 'keys',    label: 'API Keys',      icon: <Key size={16} />,       hint: 'Coachio, OpenAI, KIE, Firecrawl' },
    { id: 'media',   label: 'Media',         icon: <ImageIcon size={16} />, hint: 'Refs, products, faces, voted' },
    { id: 'storage', label: 'Lưu trữ',       icon: <HardDrive size={16} />, hint: 'Dọn dẹp localStorage' },
  ];

  const visibleItems = items.filter(i => !i.hidden);

  return (
    <div className="min-h-screen bg-canvas text-fg flex flex-col">
      {/* Header */}
      <header className="border-b border-line bg-surface/80 backdrop-blur-sm sticky top-14 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => onNavigate('menu')}
            className="p-2 rounded-md hover:bg-raised text-muted hover:text-fg"
            title="Về Dashboard"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-fg">Settings</h1>
            <p className="text-[11px] text-subtle">Hồ sơ, API keys, media, cấu hình app</p>
          </div>
        </div>
      </header>

      {/* Body: sidebar + content */}
      <div className="flex-1 max-w-6xl mx-auto w-full px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
          {/* Sidebar submenu */}
          <nav className="md:sticky md:top-24 md:self-start space-y-1">
            {visibleItems.map(item => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`w-full text-left px-3 py-2.5 rounded-md border transition-colors flex items-start gap-2.5 ${
                  tab === item.id
                    ? 'bg-brand/10 border-brand/40 text-brand'
                    : 'bg-canvas border-line text-muted hover:bg-raised hover:text-fg'
                }`}
              >
                <span className={tab === item.id ? 'text-brand mt-0.5' : 'text-muted mt-0.5'}>
                  {item.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${tab === item.id ? 'font-semibold' : 'font-medium text-fg'}`}>
                    {item.label}
                  </p>
                  {item.hint && (
                    <p className={`text-[10px] mt-0.5 leading-tight ${
                      tab === item.id ? 'text-brand/70' : 'text-subtle'
                    }`}>
                      {item.hint}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="min-w-0">
            <div className="bg-surface border border-line rounded-xl p-5 md:p-6">
              {tab === 'profile' && <ProfileSection user={user} />}
              {tab === 'keys'    && <KeysSection user={user} />}
              {tab === 'media'   && <MediaSection />}
              {tab === 'storage' && <StorageSection />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
