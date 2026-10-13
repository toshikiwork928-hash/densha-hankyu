// 泉佐野駅の配線（島式3面4線）の数値検査。描画なし。esbuild で Node 向けに束ねて実行する。
//   npm run verify:izumisano
// 線路は上（下りの進行方向左）から 外側下り線T1・下り本線T2・上り本線T3・外側上り線T4。
// 島式 P1=T1〜T2（1・2番）、P2=T2〜T3（3・4番）、P3=T3〜T4（5・6番）。横位置は下りの座標（左が負）で書く。
// 上りコースの横位置は reverseRoute の鏡像（lat' = 4 − lat。route.tracks の左右の和）なので、比較の前に下りの座標へ戻す。
import assert from 'node:assert/strict';
import { izumisano, izumisanoUp } from '../src/route/routes/izumisano';
import { applyService, trackLines } from '../src/route/service';
import { buildTrack } from '../src/route/track';
import type { Route, ServiceId } from '../src/route/types';

(globalThis as any).window = {};

const C = 4; // route.tracks [0, 4] の左右の和
const TRACKS = [-9.2, 0, 9.2, 18.4]; // T1〜T4
const ISLANDS = [-4.6, 4.6, 13.8];
const WIDTH = 5.8, EDGE = 1.7;
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;

/** ゲーム用の割り当て（docs/izumisano-station-reference.md 5章）: 種別 → [走行線の下り座標, 番線表示, ドアの側（コースの進行方向）] */
const DOWN: Record<ServiceId, [number, string, 'L' | 'R']> = {
  local: [-9.2, '1番線', 'R'], airport: [-9.2, '1番線', 'R'], limited: [-9.2, '1番線', 'R'],
  express: [0, '2番線', 'L'], southern: [0, '2番線', 'L'],
};
const UP: Record<ServiceId, [number, string, 'L' | 'R']> = {
  local: [9.2, '5番線', 'L'], express: [9.2, '5番線', 'L'], southern: [9.2, '5番線', 'L'],
  airport: [18.4, '6番線', 'R'], limited: [18.4, '6番線', 'R'],
};

/** 線路（下りの座標 track）に面するホーム island の番号。P1=1・2, P2=3・4, P3=5・6（線路がホームの左なら奇数、右なら偶数） */
function platformNumber(track: number, island: number): number | null {
  const k = ISLANDS.findIndex(p => near(p, island));
  if (k < 0) return null;
  if (near(island - WIDTH / 2 - EDGE, track)) return 2 * k + 1;
  if (near(island + WIDTH / 2 + EDGE, track)) return 2 * k + 2;
  return null;
}

for (const route of [izumisano, izumisanoUp] as Route[]) {
  const up = route.id === 'izumisano-up';
  const down = (lat: number) => up ? C - lat : lat; // 路線の横位置 → 下りの座標（鏡像は自己逆変換）
  const at = up ? 0 : route.stations.length - 1;
  const sta0 = route.stations[at];
  assert.equal(sta0.name, '泉佐野');
  const label = (m: string) => `${route.id}: ${m}`;

  // 線路は4本（route.tracks 2本＋外側2本）。ホーム区間で横位置が一定
  const lines = trackLines(route);
  assert.equal(lines.length, 4, label('泉佐野の線路は4本'));
  const platform = sta0.platform;
  for (let s = platform.from; s <= platform.to; s += 2) {
    const lats = lines.filter(l => s >= l.from && s <= l.to).map(l => down(l.lat(s))).sort((a, b) => a - b);
    assert.equal(lats.length, 4, label(`s=${s} の線路数`));
    lats.forEach((v, i) => assert.ok(near(v, TRACKS[i]), label(`s=${s} 線路${i + 1} の横位置 ${v}`)));
  }

  // 島式3面: 位置・幅、線路中心からホーム端1.7m、ホームの上に線路がない、島式は両側に線路
  const islands = (sta0.customPlatforms ?? []).map(p => ({ ...p, lat: down(p.lat) })).sort((a, b) => a.lat - b.lat);
  assert.equal(islands.length, 3, label('島式ホームは3面'));
  islands.forEach((p, i) => {
    assert.equal(p.kind, 'island', label(`P${i + 1} は島式`));
    assert.ok(near(p.lat, ISLANDS[i]) && near(p.width!, WIDTH), label(`P${i + 1} の位置・幅`));
    const lo = p.lat - p.width! / 2, hi = p.lat + p.width! / 2;
    for (const t of TRACKS) assert.ok(t <= lo - EDGE + 1e-6 || t >= hi + EDGE - 1e-6, label(`P${i + 1} の上に線路 ${t} が乗る`));
    assert.ok(TRACKS.some(t => near(t, lo - EDGE)) && TRACKS.some(t => near(t, hi + EDGE)), label(`P${i + 1} の両側の線路と端のすき間 ${EDGE}m`));
  });
  for (let i = 1; i < islands.length; i++) assert.ok(islands[i].lat - islands[i - 1].lat - WIDTH >= 2 * EDGE - 1e-6, label('隣り合うホームの間に線路の両側のすき間（1.7m×2）'));
  // 本線T2・T3 は両側にホーム、外側T1・T4 は片側だけ
  const sides = (t: number) => islands.filter(p => near(Math.abs(p.lat - t), WIDTH / 2 + EDGE)).length;
  for (const t of [0, 9.2]) assert.equal(sides(t), 2, label(`本線 ${t} は両側にホーム`));
  for (const t of [-9.2, 18.4]) assert.equal(sides(t), 1, label(`外側線 ${t} は片側だけにホーム`));

  // 種別ごとの走行線・番線・ドアの側・分岐器制限
  const table = up ? UP : DOWN;
  for (const service of route.services!) {
    const r = structuredClone(route);
    applyService(r, service.id);
    const sta = r.stations[at], tr = buildTrack(r);
    const [want, name, side] = table[service.id];
    const wantRoute = down(want);
    const id = `${route.id}/${service.id}`;
    assert.ok(near(tr.pathLat(sta.stopS), wantRoute), `${id}: 停止時の走行線 ${tr.pathLat(sta.stopS)} / 期待 ${wantRoute}`);
    assert.equal(sta.mainTrack, name, `${id}: 番線表示`);
    assert.equal(sta.platform.side, side, `${id}: ドアの側`);
    // ドアを開けるホームが、番線表示の番号のホーム
    const doorLat = down(wantRoute + (side === 'L' ? -1 : 1) * (WIDTH / 2 + EDGE));
    const door = islands.find(q => near(q.lat, doorLat));
    assert.ok(door, `${id}: ドア側にホームがある`);
    assert.equal(`${platformNumber(want, door!.lat)}番線`, name, `${id}: ホームの番号と番線表示`);
    // 走行線は泉佐野側の 1500m で連続（1m で 0.2m 以内）、ホーム前後で一定
    const [sFrom, sTo] = up ? [0, 1500] : [tr.length - 1500, tr.length];
    for (let s = sFrom; s < sTo; s += 1) assert.ok(Math.abs(tr.pathLat(s + 1) - tr.pathLat(s)) < .2, `${id}: s=${s} で走行線が連続`);
    for (let s = platform.from - 20; s <= platform.to; s += 5) assert.ok(near(tr.pathLat(s), wantRoute), `${id}: ホーム前後で走行線が一定 s=${s}`);
    // 分岐器制限 45km/h は外側線へ入る種別だけ。位置は下り s=7700..8000、上りは鏡像（全長 − 8000 .. 全長 − 7650）
    const outer = want === -9.2 || want === 18.4;
    const limits = r.limits.filter(l => l.label === '泉佐野分岐器');
    assert.equal(limits.length, outer ? 1 : 0, `${id}: 分岐器制限の有無`);
    if (outer) {
      const [z] = limits, len = r.trainLength;
      const [a, b] = up ? [tr.length - 8000, tr.length - 7650] : [7700, 8000];
      assert.ok(z.kmh === 45 && near(z.from, a) && near(z.to, b + len), `${id}: 分岐器制限の位置 ${z.from}..${z.to}`);
    }
  }
}
console.log('泉佐野の配線検査 OK（下り・上り × 5種別: 線路4本・島式3面・端1.7m・走行線・番線・ドア側・分岐器制限）');
