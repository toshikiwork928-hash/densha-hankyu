// 2つの区間の路線データを、境目の駅（a の終着 = b の始発。同じ形の駅）でつないで通しのデータを作る。
// a の終着駅のホーム泉大津側の端と b の始発駅のホームの端をそろえ、b の位置を offset だけずらす。
// 線形は a を境目の駅の手前（ホームの端、直線）で切り、そこから b の線形を続ける（どちらも境目の駅は直線なので方位はつながる）。
import { sameClass, seaSideOf } from './service';
import type { LatProfile, Route, ServiceSpec, Sign, Station } from './types';

const segLen = (r: Route) => r.segments.reduce((a, g) => a + (g.type === 'straight' ? g.length : g.radius * g.angle), 0);

/** 線形を長さ len で切る（最後の要素が直線であること） */
function cutSegments(r: Route, len: number): Route['segments'] {
  const out: Route['segments'] = [];
  let acc = 0;
  for (const g of r.segments) {
    const l = g.type === 'straight' ? g.length : g.radius * g.angle;
    if (acc + l < len - 1e-9) { out.push({ ...g }); acc += l; continue; }
    if (g.type !== 'straight') throw new Error(`concat: ${r.id} の切断位置 ${len} が曲線上`);
    out.push({ type: 'straight', length: len - acc });
    return out;
  }
  throw new Error(`concat: ${r.id} の線形が ${len} m に届かない`);
}

/** 標高（勾配の積分） */
function elevationAt(r: Route, s: number): number {
  let y = r.elevation0 ?? 0;
  for (const g of r.gradients ?? []) y += (Math.min(s, g.to) - Math.min(s, g.from)) * g.permil / 1000;
  return y;
}

export interface ConcatOptions {
  id: string; name: string;
  /** 種別（停車駅・待避の station は通しの index）。timetable は生成済みのもの */
  services: ServiceSpec[];
  /** 距離標・停止位置目標 */
  signs: (stopS: number) => Sign[];
}

export function concatRoutes(a: Route, b: Route, opt: ConcatOptions): Route {
  const na = a.stations.length, joinA = a.stations[na - 1], joinB = b.stations[0];
  if (joinA.name !== joinB.name) throw new Error(`concat: 境目の駅が違う ${joinA.name} / ${joinB.name}`);
  // b の座標 + off = 通しの座標
  const off = joinA.platform.from - joinB.platform.from;
  if (Math.abs((joinA.platform.to - joinA.platform.from) - (joinB.platform.to - joinB.platform.from)) > 1e-6) throw new Error('concat: 境目の駅のホーム長が違う');
  if (Math.abs(elevationAt(a, joinA.platform.from) - elevationAt(b, joinB.platform.from)) > 1e-6) throw new Error('concat: 境目の駅の高さが違う');
  if (seaSideOf(a) !== seaSideOf(b)) throw new Error('concat: 海の側が違う');
  const sh = (s: number) => s + off;
  const ib = (i: number) => i + na - 1; // b の駅 index → 通し
  // 境目の駅は a のもの（途中駅として停車・通過。停車時間は種別適用で決まる）
  const stations: Station[] = [
    ...a.stations.map(s => ({ ...s, platform: { ...s.platform } })),
    ...b.stations.slice(1).map(s => ({
      ...s, stopS: sh(s.stopS), platform: { ...s.platform, from: sh(s.platform.from), to: sh(s.platform.to) },
      ...(s.customPlatforms ? { customPlatforms: s.customPlatforms.map(p => ({ ...p, ...(p.from != null ? { from: sh(p.from) } : {}), ...(p.to != null ? { to: sh(p.to) } : {}) })) } : {}),
    })),
  ];
  const joinS = joinA.platform.from; // ここで a の線形を切って b へ
  // 横位置の折れ線: 境目より前は a、後は b（境目の駅はどちらも基準の横位置）
  const joinProfile = (pa: LatProfile | undefined, pb: LatProfile | undefined, base: number): LatProfile | undefined => {
    if (!pa && !pb) return undefined;
    return [...(pa ?? [[-1e6, base]]).filter(([q]) => q < joinS - 1), [joinS, base], ...(pb ?? [[1e6, base]]).map(([q, l]) => [sh(q), l] as [number, number]).filter(([q]) => q > joinS + 1)];
  };
  const profiles: Record<string, LatProfile> = {};
  for (const c of a.tracks) { const pr = joinProfile(a.trackProfiles?.[String(c)], b.trackProfiles?.[String(c)], c); if (pr) profiles[String(c)] = pr; }
  // 種別ごとの走行線・制限・番線・ドアの側（区間データの同じ種別から）。駅 index は b を通しの index へ
  const ib0 = (i: number) => i + na - 1;
  const services = opt.services.map(v => {
    // 区間データに無い種別（堺〜泉大津の特急サザン）は同じ格の種別（特急ラピート）の走行線・番線・ドアの側を使う
    const pick = (r: Route) => r.services?.find(x => x.id === v.id) ?? r.services?.find(x => sameClass(x.id, v.id));
    const av = pick(a), bv = pick(b);
    const lane = v.lane ?? joinProfile(av?.lane, bv?.lane, a.tracks[0]);
    const laneLimits = v.laneLimits ?? [...(av?.laneLimits ?? []), ...(bv?.laneLimits ?? []).map(L => ({ ...L, from: sh(L.from), to: sh(L.to) }))];
    const remap = <T,>(ra?: Record<number, T>, rb?: Record<number, T>) => ra || rb ? { ...ra, ...Object.fromEntries(Object.entries(rb ?? {}).filter(([k]) => +k > 0).map(([k, x]) => [ib0(+k), x])) } : undefined;
    const platformSides = v.platformSides ?? remap(av?.platformSides, bv?.platformSides);
    const trackNames = v.trackNames ?? remap(av?.trackNames, bv?.trackNames);
    return { ...v, ...(lane ? { lane } : {}), ...(laneLimits.length ? { laneLimits } : {}), ...(platformSides ? { platformSides } : {}), ...(trackNames ? { trackNames } : {}) };
  });
  const total = joinS + segLen(b);
  const clipZones = (z: { from: number; to: number }[], lo: number, hi: number) =>
    z.map(q => ({ from: Math.max(q.from, lo), to: Math.min(q.to, hi) })).filter(q => q.from < q.to);
  return {
    ...a,
    id: opt.id, name: opt.name,
    seaSide: seaSideOf(a),
    segments: [...cutSegments(a, joinS), ...b.segments.map(g => ({ ...g }))],
    gradients: [
      ...(a.gradients ?? []).filter(g => g.to <= joinS),
      ...(b.gradients ?? []).map(g => ({ ...g, from: sh(g.from), to: sh(g.to) })),
    ],
    limits: [
      ...a.limits.filter(L => L.from < joinS).map(L => ({ ...L })),
      ...b.limits.map(L => ({ ...L, from: sh(L.from), to: sh(L.to) })),
    ],
    stations,
    services,
    ...(Object.keys(profiles).length ? { trackProfiles: profiles } : {}),
    ...(a.extraTracks || b.extraTracks ? { extraTracks: [
      ...(a.extraTracks ?? []).filter(x => x.from < joinS),
      ...(b.extraTracks ?? []).map(x => ({ ...x, lat: x.lat.map(([q, l]) => [sh(q), l] as [number, number]), from: sh(x.from), to: sh(x.to), ...(x.bumpers ? { bumpers: x.bumpers.map(sh) } : {}) })),
    ] } : {}),
    ...(a.reserved || b.reserved ? { reserved: [...(a.reserved ?? []), ...(b.reserved ?? []).map(z => ({ ...z, from: sh(z.from), to: sh(z.to) }))] } : {}),
    ...(a.deckJoin || b.deckJoin ? { deckJoin: [...(a.deckJoin ?? []), ...(b.deckJoin ?? []).map(z => ({ from: sh(z.from), to: sh(z.to) }))] } : {}),
    prevName: a.prevName, nextName: b.nextName,
    signs: stations.slice(1).flatMap(st => opt.signs(st.stopS)),
    extent: { from: a.extent.from, to: Math.min(sh(b.extent.to), total + 400) },
    scenery: {
      cityZones: [...clipZones(a.scenery.cityZones, -Infinity, joinS), ...clipZones(b.scenery.cityZones.map(z => ({ from: sh(z.from), to: sh(z.to) })), joinS, Infinity)],
    },
    oncoming: [
      ...a.oncoming.map(o => ({ ...o, ...(o.stop ? { stop: { ...o.stop } } : {}) })),
      ...b.oncoming.map(o => ({
        ...o, spawnAt: sh(o.spawnAt), startS: sh(o.startS),
        ...(o.stop ? { stop: { ...o.stop, station: ib(o.stop.station), headS: sh(o.stop.headS), ...(o.stop.zone ? { zone: { ...o.stop.zone, inFrom: sh(o.stop.zone.inFrom), inTo: sh(o.stop.zone.inTo), outFrom: sh(o.stop.zone.outFrom), outTo: sh(o.stop.zone.outTo) } } : {}) } } : {}),
      })),
    ],
    // 信号: a は境目の駅の場内信号まで（終着側に出発信号は無い）、b は境目の駅の出発信号から
    signals: [
      ...(a.signals ?? []).filter(g => g.s < joinA.stopS).map(g => ({ id: 'a' + g.id, s: g.s })),
      ...(b.signals ?? []).map(g => ({ id: 'b' + g.id, s: sh(g.s) })),
    ].sort((p, q) => p.s - q.s),
    crossings: [
      ...(a.crossings ?? []).map(c => ({ ...c, id: 'a' + c.id })),
      ...(b.crossings ?? []).map(c => ({ ...c, id: 'b' + c.id, s: sh(c.s) })),
    ],
    structures: [
      ...(a.structures ?? []).map(st => ({ ...st, to: Math.min(st.to, joinS) })).filter(st => st.from < st.to),
      ...(b.structures ?? []).map(st => ({ ...st, from: Math.max(sh(st.from), joinS), to: sh(st.to) })).filter(st => st.from < st.to),
    ],
    // 境目の駅のタワー（共通ランドマーク）は a の側のものだけ残す
    coastalLandmarks: [
      // 向き（反転済みか）は区間データのものを持ち越す（通しの route.id の '-up' と区間の向きが合わない区間がある）
      ...(a.coastalLandmarks ?? []).map(l => ({ ...l, reversed: l.reversed ?? a.id.endsWith('-up') })),
      ...(b.coastalLandmarks ?? []).filter(l => l.kind !== 'twin-tower').map(l => ({ ...l, s: sh(l.s), reversed: l.reversed ?? b.id.endsWith('-up') })),
    ],
    precedingHeadway: undefined,
    terminalApproach: false,
  };
}
