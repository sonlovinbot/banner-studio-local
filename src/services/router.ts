// URL routing cho app. History API thuần, không thêm dependency.
//
// Trước đây App.tsx giữ trang hiện tại trong useState nên F5 luôn rơi về
// Dashboard và không share được link. Giờ URL là nguồn sự thật duy nhất:
// path chọn trang, query param giữ state phụ (tab, số trang, filter).
//
// vercel.json đã có rewrite `/(.*) → /` nên mọi path đều rơi về index.html.

import { AppPage } from '../types';

/** Path chính tắc của từng trang. Dashboard ở root. */
export const PAGE_PATHS: Record<AppPage, string> = {
  'menu': '/',
  'banner': '/banner',
  'ugc-studio': '/ugc-studio',
  'brand-style': '/brand-style',
  'history': '/history',
  'settings': '/settings',
};

const PATH_TO_PAGE: Record<string, AppPage> = Object.entries(PAGE_PATHS)
  .reduce((acc, [page, path]) => { acc[path] = page as AppPage; return acc; }, {} as Record<string, AppPage>);

export interface Route {
  page: AppPage;
  params: URLSearchParams;
}

/** Bỏ trailing slash (trừ root) để `/history/` và `/history` là một. */
function normalizePath(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

/** Path lạ → Dashboard, không văng lỗi. */
export function parseRoute(pathname: string, search = ''): Route {
  const path = normalizePath(pathname);
  return {
    page: PATH_TO_PAGE[path] || 'menu',
    params: new URLSearchParams(search),
  };
}

export type ParamInput = Record<string, string | number | undefined | null>;

/** Dựng URL đầy đủ. Param rỗng/undefined/null bị loại để URL không rác. */
export function buildUrl(page: AppPage, params?: ParamInput): string {
  const path = PAGE_PATHS[page] || '/';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  const query = qs.toString();
  return query ? `${path}?${query}` : path;
}

/** Gộp param mới vào param hiện tại. Giá trị rỗng = xoá key đó. */
export function mergeParams(current: URLSearchParams, patch: ParamInput): URLSearchParams {
  const next = new URLSearchParams(current.toString());
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === '') next.delete(k);
    else next.set(k, String(v));
  }
  return next;
}

/** Đọc param số dương (số trang). Rác hoặc < 1 → giá trị mặc định. */
export function readIntParam(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

// ─────────── React binding ───────────

import { useCallback, useEffect, useState } from 'react';

/** Event nội bộ để mọi useRoute() cùng cập nhật khi một chỗ gọi pushRoute —
 *  popstate chỉ bắn khi user bấm Back/Forward, không bắn khi pushState. */
const ROUTE_EVENT = 'app:routechange';

function currentRoute(): Route {
  if (typeof window === 'undefined') return { page: 'menu', params: new URLSearchParams() };
  return parseRoute(window.location.pathname, window.location.search);
}

/** Đẩy URL mới vào history stack. `replace` dùng khi chỉ chuẩn hoá URL
 *  (VD kẹp ?page=999 về trang cuối) để không rác history stack. */
export function pushRoute(page: AppPage, params?: ParamInput, opts: { replace?: boolean } = {}): void {
  const url = buildUrl(page, params);
  if (typeof window === 'undefined') return;
  if (url === window.location.pathname + window.location.search) return;
  if (opts.replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
  window.dispatchEvent(new CustomEvent(ROUTE_EVENT));
}

/** Cập nhật query param của trang hiện tại, giữ nguyên trang. */
export function setRouteParams(patch: ParamInput, opts: { replace?: boolean } = {}): void {
  const { page, params } = currentRoute();
  const merged = mergeParams(params, patch);
  const next: ParamInput = {};
  merged.forEach((v, k) => { next[k] = v; });
  pushRoute(page, next, opts);
}

/** Route hiện tại, tự cập nhật khi push hoặc khi user bấm Back/Forward. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(currentRoute);
  useEffect(() => {
    const sync = () => setRoute(currentRoute());
    window.addEventListener('popstate', sync);
    window.addEventListener(ROUTE_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(ROUTE_EVENT, sync);
    };
  }, []);
  return route;
}

/** Đọc + ghi một query param số (số trang). Giá trị mặc định không ghi vào
 *  URL để `/history` gọn hơn `/history?page=1`. */
export function usePageParam(key = 'page', fallback = 1): [number, (p: number) => void] {
  const { params } = useRoute();
  const value = readIntParam(params, key, fallback);
  const set = useCallback((p: number) => {
    setRouteParams({ [key]: p === fallback ? '' : p });
  }, [key, fallback]);
  return [value, set];
}
