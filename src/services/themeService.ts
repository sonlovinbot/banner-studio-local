export type Theme = 'light' | 'dark';

const KEY = 'banner_pro_theme';

export function getTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(KEY) as Theme | null;
  if (stored === 'light' || stored === 'dark') return stored;
  return 'dark';
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

export function initTheme(): void {
  applyTheme(getTheme());
}
