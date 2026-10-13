// メニューの路線（線区）一覧と route id の解決。正本は route/index.ts の LINES・ROUTES
import { DEFAULT_ROUTE, LINES, ROUTES, type LineEntry } from '../route';
import type { Route } from '../route/types';

/** route id → Route（未知の id は既定の路線） */
export const resolveRoute = (id: string | undefined): Route => (id && ROUTES[id]) || DEFAULT_ROUTE;

/** route id の線区（見つからなければ先頭の路線） */
export const lineOfRoute = (id: string): LineEntry => LINES.find(l => l.dirs.some(d => d.id === id)) ?? LINES[0];
