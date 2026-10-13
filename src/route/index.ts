// 路線レジストリ（阪急神戸線だけを登録する。南海のコースのファイルは複製元の名残で、登録しない）
import type { Route } from './types';
import { hankyuKobeEast, hankyuKobeEastUp, hankyuKobeWest, hankyuKobeWestUp } from './routes/hankyu-kobe';

export const ROUTES: Record<string, Route> = Object.fromEntries([hankyuKobeEast, hankyuKobeEastUp, hankyuKobeWest, hankyuKobeWestUp].map(r => [r.id, r]));
/** 路線（線区）の一覧。メインメニューの路線選択用。dirs[0] が既定の方向。山岳線は route/routes/ に追加して登録する */
export interface DirEntry { id: string; label: string; desc: string }
/** 区間（同じ線区を複数の路線データに分けたもの）。dirs[0] が既定の方向 */
export interface SectionEntry { id: string; name: string; desc: string; dirs: DirEntry[] }
/** dirs = 線区の全方向（区間があれば全区間の方向を連結）。sections があればメニューで区間 → 方向の順に選ぶ */
export interface LineEntry { id: string; name: string; desc: string; theme: 'coast' | 'mountain'; dirs: DirEntry[]; sections?: SectionEntry[] }
const HANKYU_SECTIONS: SectionEntry[] = [
  {
    id: 'umeda-nishinomiya', name: '大阪梅田〜西宮北口', desc: '8駅・15.6km。淀川・神崎川・武庫川を渡る。宝塚線・京都線と並ぶ梅田〜十三',
    dirs: [{ id: hankyuKobeEast.id, label: '下り', desc: '大阪梅田 → 西宮北口' }, { id: hankyuKobeEastUp.id, label: '上り', desc: '西宮北口 → 大阪梅田' }],
  },
  {
    id: 'nishinomiya-sannomiya', name: '西宮北口〜神戸三宮', desc: '9駅・16.7km。夙川・芦屋川の上の駅、六甲山のふもとの勾配、王子公園から高架で三宮へ',
    dirs: [{ id: hankyuKobeWest.id, label: '下り', desc: '西宮北口 → 神戸三宮' }, { id: hankyuKobeWestUp.id, label: '上り', desc: '神戸三宮 → 西宮北口' }],
  },
];
export const LINES: LineEntry[] = [
  { id: 'hankyu-kobe', name: '阪急神戸線', desc: '阪急神戸線（大阪梅田〜神戸三宮）。区間を選ぶ。普通（2000系 8両）', theme: 'coast', dirs: HANKYU_SECTIONS.flatMap(x => x.dirs), sections: HANKYU_SECTIONS },
];
/** route id → 区間（区間の無い線区は undefined） */
export const sectionOf = (routeId: string): SectionEntry | undefined => lineOf(routeId)?.sections?.find(x => x.dirs.some(d => d.id === routeId));
/** route id → 線区 */
export const lineOf = (routeId: string): LineEntry | undefined => LINES.find(l => l.dirs.some(d => d.id === routeId));
/** 既定は大阪梅田 → 西宮北口 */
export const DEFAULT_ROUTE = hankyuKobeEast;
export type { Route } from './types';
