// 運行種別（普通・急行・特急）の適用と、2面4線駅の待避線の形状
// route は各モジュールが参照を保持しているので、種別の切替は route の中身を書き換えて反映する（元データは初回に退避）
import type { LatProfile, Route, ServiceId, ServiceSpec, SpeedLimit, Station, TimeOfDay, TrainKind } from './types';

/** TOPで選べる種別。南海本線の特急は、コース両端も実際の停車駅に限る（ラピートβ: 難波・新今宮・天下茶屋・堺・岸和田・泉佐野。
 *  特急サザンはそれに加えて、みさき公園・和歌山大学前・和歌山市・和歌山港など、泉佐野より和歌山側の停車駅）。 */
export function selectableServices(route: Route): ServiceSpec[] {
  const services = route.services ?? [];
  if (route.lineId !== 'shiokaze') return services;
  const limitedStops = new Set(['なんば', '新今宮', '天下茶屋', '堺', '岸和田', '泉佐野']);
  const southernStops = new Set([...limitedStops, '尾崎', 'みさき公園', '和歌山大学前', '和歌山市', '和歌山港']);
  const ends = [route.stations[0]?.name, route.stations.at(-1)?.name];
  return services.filter(v => (v.id !== 'limited' && v.id !== 'southern') || ends.every(name => name != null && (v.id === 'southern' ? southernStops : limitedStops).has(name)));
}

/** 1両の長さ [m]（既定。2300系・2000系・30000系の 17m 級は 18m） */
export const CAR_LEN = 20;
/** 車種ごとの1両の長さ [m] */
export const carLenOf = (kind: TrainKind): number => kind === 'hankyu-2000' ? 19 : kind === 'commuter-2300' || kind === 'commuter-2000' || kind === 'limited-30000' ? 18 : CAR_LEN;
/** 停止位置目標 stopS の基準両数（短い編成は手前に止める） */
export const BASE_CARS = 6;
/** n 両編成の停止位置のずれ [m]（基準 6両・20m 車なら 4両 → 20m 手前）。編成の中央をそろえる: (基準 − 両数) × 1両の長さ / 2 */
export const stopOffset = (cars: number, carLen = CAR_LEN, base = BASE_CARS): number => Math.max(0, base - cars) * carLen / 2;

/** 待避線の区間（入口分岐器 inFrom..inTo、出口分岐器 outFrom..outTo） */
export interface LoopZone { inFrom: number; inTo: number; outFrom: number; outTo: number; lat: number; limit: number }

/** 駅の待避線区間。入口分岐器はホーム端の 10m 手前まで、出口分岐器はホーム端の 70m 先（出発信号の先）から */
export function loopZone(sta: Station): LoopZone | null {
  const L = sta.loop;
  if (!L) return null;
  const inTo = sta.platform.from - 10, outFrom = sta.platform.to + 70;
  return { inFrom: inTo - L.turnoutLength, inTo, outFrom, outTo: outFrom + L.turnoutLength, lat: L.lat, limit: L.turnoutLimitKmh };
}

/** 待避線への振れ 0..1（分岐器内は S 字） */
export function loopShape(z: LoopZone, s: number): number {
  if (s <= z.inFrom || s >= z.outTo) return 0;
  if (s >= z.inTo && s <= z.outFrom) return 1;
  const u = s < z.inTo ? (s - z.inFrom) / (z.inTo - z.inFrom) : (z.outTo - s) / (z.outTo - z.outFrom);
  return (1 - Math.cos(Math.PI * u)) / 2;
}

/** 島式1面2線駅の線形区間（ホーム端の 70m 手前・先を平坦部とし、その外側に S字 length） */
export interface IslandZone { inFrom: number; inTo: number; outFrom: number; outTo: number; spread: number }

export function islandZone(sta: Station): IslandZone | null {
  const I = sta.island;
  if (!I) return null;
  const inTo = sta.platform.from - 70, outFrom = sta.platform.to + 70;
  return { inFrom: inTo - I.length, inTo, outFrom, outTo: outFrom + I.length, spread: I.spread };
}

/** ホーム側へ開く量 0..1（S字は余弦） */
export function islandShape(z: IslandZone, s: number): number {
  if (s <= z.inFrom || s >= z.outTo) return 0;
  if (s >= z.inTo && s <= z.outFrom) return 1;
  const u = s < z.inTo ? (s - z.inFrom) / (z.inTo - z.inFrom) : (z.outTo - s) / (z.outTo - z.outFrom);
  return (1 - Math.cos(Math.PI * u)) / 2;
}

/** 路線の島式ホーム区間一覧（station index 付き） */
export function islandZones(route: Route): (IslandZone & { index: number })[] {
  const out: (IslandZone & { index: number })[] = [];
  route.stations.forEach((sta, index) => { const z = islandZone(sta); if (z) out.push({ ...z, index }); });
  return out;
}

/** 折れ線の横位置（隣り合う点の間は余弦の S字、範囲外は端の値） */
export function profileLat(p: LatProfile, s: number): number {
  if (s <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    const [s1, l1] = p[i];
    if (s > s1) continue;
    const [s0, l0] = p[i - 1];
    if (l0 === l1 || s1 <= s0) return l1;
    const u = (s - s0) / (s1 - s0);
    return l0 + (l1 - l0) * (1 - Math.cos(Math.PI * u)) / 2;
  }
  return p[p.length - 1][1];
}

/** 折れ線の S字区間（lat が変わる区間）の一覧 */
export function profileTransitions(p: LatProfile): { from: number; to: number; a: number; b: number }[] {
  const out: { from: number; to: number; a: number; b: number }[] = [];
  for (let i = 1; i < p.length; i++) if (p[i][1] !== p[i - 1][1]) out.push({ from: p[i - 1][0], to: p[i][0], a: p[i - 1][1], b: p[i][1] });
  return out;
}

/** 島式ホーム駅での線路の横ずれ [m]。base = 線路の横位置（tracks の中央より左の線は左へ、右の線は右へ開く）。
 *  単線（tracks が1本）は既定で左（自列車の線）。side = 1 で右の線（交換駅で対向列車が通る線） */
export function islandOffset(route: Route, base: number, s: number, side?: -1 | 1): number {
  const prof = route.trackProfiles?.[String(base)];
  return (prof ? profileLat(prof, s) - base : 0) + stationIslandOffset(route, base, s, side);
}

/** 島式1面2線駅の S字だけの横ずれ（route.trackProfiles を含まない） */
export function stationIslandOffset(route: Route, base: number, s: number, side?: -1 | 1): number {
  const tr = route.tracks, mid = (Math.min(...tr) + Math.max(...tr)) / 2;
  const dir = side ?? (base <= mid ? -1 : 1);
  let lat = 0;
  for (const sta of route.stations) {
    const z = islandZone(sta);
    if (z && s > z.inFrom && s < z.outTo) lat += dir * z.spread * islandShape(z, s);
  }
  return lat;
}

/** 単線の駅の副線（3線目、行き止まり）の区間。from..to = 線路のある範囲（車止め側の端 〜 合流点）、tFrom..tTo = 分岐器（S字）、lat = ホーム区間での横位置、side = 合流する島式の線の側 */
export interface BayZone { from: number; to: number; tFrom: number; tTo: number; lat: number; side: -1 | 1; bumperS: number; spread: number; island: IslandZone }

const BAY_TURNOUT = 50;
export function bayZone(sta: Station): BayZone | null {
  const b = sta.island?.bay, iz = islandZone(sta);
  if (!b || !iz) return null;
  const side = b.lat < 0 ? -1 : 1;
  if (b.bumper === 'behind') {
    const bumperS = sta.platform.from - 12, tFrom = sta.platform.to + 10;
    return { from: bumperS, to: tFrom + BAY_TURNOUT, tFrom, tTo: tFrom + BAY_TURNOUT, lat: b.lat, side, bumperS, spread: iz.spread, island: iz };
  }
  const bumperS = sta.platform.to + 12, tTo = sta.platform.from - 10;
  return { from: tTo - BAY_TURNOUT, to: bumperS, tFrom: tTo - BAY_TURNOUT, tTo, lat: b.lat, side, bumperS, spread: iz.spread, island: iz };
}

/** 副線の横位置（分岐器内は島式の線から S字で離れる） */
export function bayLat(z: BayZone, s: number): number {
  const base = z.side * z.spread * islandShape(z.island, s);
  let u = 1;
  if (s > z.tFrom && s < z.tTo) {
    const w = (s - z.tFrom) / (z.tTo - z.tFrom);
    u = z.bumperS < z.tFrom ? 1 - w : w; // 車止め側から合流点へ 1 → 0
    u = (1 - Math.cos(Math.PI * u)) / 2;
  } else if ((z.bumperS < z.tFrom && s >= z.tTo) || (z.bumperS > z.tTo && s <= z.tFrom)) u = 0;
  return base + (z.lat - base) * u;
}

/** 描画する線路1本（横位置は線路基準）。main = 自列車の線（単線区間はこれ1本）、passing = 交換駅・島式駅の右の線、bay = 副線、track = 複線の各線 */
export interface TrackLine { kind: 'track' | 'main' | 'passing' | 'bay' | 'extra'; from: number; to: number; lat(s: number): number; /** 行き止まりの端（車止め） */ bumpers: number[] }

/** 線路の一覧（線路・架線の描画用）。複線は route.tracks（島式駅の S字込み）。単線は本線＋駅の右の線＋副線。頭端駅の側の端は車止め */
export function trackLines(route: Route): TrackLine[] {
  const { from: E0, to: E1 } = route.extent;
  const first = route.stations[0], last = route.stations[route.stations.length - 1];
  const ends = [...(first?.headEnd ? [E0] : []), ...(last?.headEnd ? [E1] : [])];
  if (!route.singleTrack) return [
    ...route.tracks.map((c): TrackLine => ({ kind: 'track', from: E0, to: E1, lat: s => c + islandOffset(route, c, s), bumpers: ends })),
    ...(route.extraTracks ?? []).map((x): TrackLine => ({ kind: 'extra', from: x.from, to: x.to, lat: s => profileLat(x.lat, s), bumpers: x.bumpers ?? [] })),
  ];
  const out: TrackLine[] = [{ kind: 'main', from: E0, to: E1, lat: s => islandOffset(route, 0, s), bumpers: ends }];
  for (const sta of route.stations) {
    const z = islandZone(sta);
    if (z) {
      const a = Math.max(E0, z.inFrom), b = Math.min(E1, z.outTo);
      out.push({ kind: 'passing', from: a, to: b, lat: s => z.spread * islandShape(z, s), bumpers: ends.filter(e => e === a || e === b) });
    }
    const bz = bayZone(sta);
    if (bz) out.push({ kind: 'bay', from: Math.max(E0, bz.from), to: Math.min(E1, bz.to), lat: s => bayLat(bz, s), bumpers: [bz.bumperS] });
  }
  return out;
}

/** s での線路の横の範囲 [左, 右]（route.tracks とその横位置の変化、範囲の端から gap 以内で続く追加の線路）。
 *  離れていく支線（高野線の合流・入出庫線）は含めない */
export function trackSpan(route: Route, s: number, gap0 = 11): [number, number] {
  const gap = route.deckJoin?.some(z => s >= z.from && s <= z.to) ? Infinity : gap0;
  let lo = Infinity, hi = -Infinity;
  for (const c of route.tracks) { const l = c + islandOffset(route, c, s); lo = Math.min(lo, l); hi = Math.max(hi, l); }
  const ex = route.extraTracks;
  if (ex?.length) {
    const lats = ex.filter(x => s >= x.from - 1 && s <= x.to + 1).map(x => profileLat(x.lat, s)).sort((a, b) => a - b);
    for (const l of lats) if (l > hi && l - hi < gap) hi = l;
    for (let i = lats.length - 1; i >= 0; i--) if (lats[i] < lo && lo - lats[i] < gap) lo = lats[i];
  }
  return [lo, hi];
}

/** custom 駅の片面ホームの外縁 [左, 右]（無い側は ±Infinity の逆）。s がホーム範囲 ± margin の外なら null */
export function customPlatformEdges(route: Route, s: number, margin = 0): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (const st of route.stations) for (const p of st.customPlatforms ?? []) {
    const a = (p.from ?? st.platform.from) - margin, b = (p.to ?? st.platform.to) + margin;
    if (s < a || s > b) continue;
    if (p.kind === 'side') {
      const e = p.lat + (p.side === 'L' ? -1 : 1) * (1.7 + (p.width ?? 5));
      lo = Math.min(lo, e); hi = Math.max(hi, e);
    } else { lo = Math.min(lo, p.lat - p.width / 2); hi = Math.max(hi, p.lat + p.width / 2); }
  }
  return lo <= hi ? [lo, hi] : null;
}

/** custom 駅で横位置 own の線路に面するホームの側（無ければ null）。島式は線路中心からホーム端 1.7m */
export function customPlatformSide(sta: Station, own: number): 'L' | 'R' | null {
  for (const p of sta.customPlatforms ?? []) {
    if (p.kind === 'side') { if (Math.abs(p.lat - own) < .3) return p.side; continue; }
    if (Math.abs(p.lat - p.width / 2 - 1.7 - own) < .3) return 'R';
    if (Math.abs(p.lat + p.width / 2 + 1.7 - own) < .3) return 'L';
  }
  return null;
}

/** 路線の待避線区間一覧（station index 付き） */
export function loopZones(route: Route): (LoopZone & { index: number })[] {
  const out: (LoopZone & { index: number })[] = [];
  route.stations.forEach((sta, index) => { const z = loopZone(sta); if (z) out.push({ ...z, index }); });
  return out;
}

/** 自列車の走行位置の横ずれ [m]（停車する 2面4線駅では待避線へ入る）。stations[].pass は種別適用後の値 */
export function playerPathLat(route: Route, s: number): number {
  let lat = 0;
  for (const sta of route.stations) {
    if (!sta.enterLoop || !sta.loop) continue;
    const z = loopZone(sta)!;
    if (s > z.inFrom && s < z.outTo) lat += z.lat * loopShape(z, s);
  }
  const base = route.tracks[0] ?? 0;
  return lat + (route.activeLane ? profileLat(route.activeLane, s) - base + stationIslandOffset(route, base, s) : islandOffset(route, base, s));
}

/** 線路側の横ずれ（種別に関係なく待避線に沿う）。s が待避線区間外なら 0 */
export function stationLoopLat(route: Route, s: number): number {
  let lat = 0;
  for (const sta of route.stations) {
    const z = loopZone(sta);
    if (z && s > z.inFrom && s < z.outTo) lat += z.lat * loopShape(z, s);
  }
  return lat;
}

interface Base { stations: Station[]; limits: SpeedLimit[]; trainLength: number; startS: number; lineLimit: number }
const bases = new WeakMap<Route, Base>();

export const serviceOf = (route: Route, id: ServiceId | undefined): ServiceSpec | undefined =>
  route.services?.find(s => s.id === id) ?? route.services?.[0];

/** 海の側（進行方向に対して -1 = 左、1 = 右）。route.seaSide、無ければ高架支線の側（汐風線の従来の決め方） */
export const seaSideOf = (route: Route): 1 | -1 => route.seaSide ?? route.coastalLandmarks?.find(l => l.kind === 'branch')?.side ?? -1;

/** 列車の行先（行先表示・放送）。種別に本来の行先（なんば・和歌山市など）があればそれ、無ければコースの終点 */
export const destOf = (route: Route, svc?: ServiceSpec): string => svc?.destination ?? route.stations[route.stations.length - 1]?.name ?? '';
/** 和歌山方面（コースの終点が岸和田・泉大津でも）の種別ごとの本来の行先 */
export const WAKAYAMA_DEST: Record<ServiceId, [string, string]> = {
  local: ['羽倉崎', 'はぐらざき'], express: ['和歌山市', 'わかやまし'], airport: ['関西空港', 'かんさいくうこう'],
  limited: ['関西空港', 'かんさいくうこう'], southern: ['和歌山港', 'わかやまこう'],
};
/** 種別の行先を本来のものにそろえる。堺方面（なんば方面）は全種別「なんば」、和歌山方面は種別ごと（普通 羽倉崎・急行 和歌山市・空港急行/ラピート 関西空港・サザン 和歌山港） */
export function setDestinations(services: ServiceSpec[], toward: 'namba' | 'wakayama'): void {
  for (const v of services) {
    const [d, k] = toward === 'namba' ? ['なんば', 'なんば'] : WAKAYAMA_DEST[v.id];
    v.destination = d; v.destinationKana = k;
  }
}
/** 空港急行（8300系 8両が既定、6両も選べる。停車駅は急行と同じ、最高速度 110km/h） */
export const airportService = (stops: number[], timetable: ServiceSpec['timetable']): ServiceSpec => ({
  id: 'airport', name: '空港急行', cars: 8, units: [4, 4], kind: 'commuter-new',
  kindOptions: ['commuter-new', 'commuter-old'], formationOptions: [[4, 4], [4, 2]],
  lineLimit: 110, stops, timetable,
});
/** 編成の車種の並びのキー（キャッシュ用。例 'southern-10000+commuter-old'） */
export const kindsKey = (svc: ServiceSpec): string => svc.unitKinds?.join('+') ?? svc.kind;

/** 編成の合計両数 */
export const carsOf = (units: readonly number[]): number => units.reduce((a, n) => a + n, 0);
/** 編成の表示（4+2 など。1ユニットは両数のみ） */
export const unitsLabel = (units: readonly number[]): string => units.length > 1 ? `${units.join('+')}` : String(units[0]);
const sameUnits = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((n, i) => n === b[i]);

const defaults = new WeakMap<ServiceSpec, { kind: TrainKind; units: number[] }>();
/** 選択した車種・編成を route.services へ反映（選択肢にないものは既定値）。旧形式の保存（両数のみ）は同じ両数の最初の編成へ */
export function applyVehicles(route: Route, sel: Partial<Record<ServiceId, { kind: TrainKind; units?: number[]; cars?: number }>>): void {
  for (const svc of route.services ?? []) {
    let d = defaults.get(svc);
    if (!d) { d = { kind: svc.kind, units: [...svc.units] }; defaults.set(svc, d); }
    const v = sel[svc.id], opts = svc.formationOptions ?? [d.units];
    svc.kind = v && svc.kindOptions?.includes(v.kind) ? v.kind : d.kind;
    svc.units = [...(v && (opts.find(o => (v.units ? sameUnits(o, v.units) : carsOf(o) === v.cars)) ?? undefined) || d.units)];
    svc.cars = carsOf(svc.units);
  }
}

/** 種別の格（特急 = ラピート・サザン、急行 = 急行・空港急行、普通）。待避の相手は格で照合する（特急の待避は自分がサザンでもラピートでも同じ） */
export const classOf = (id: ServiceId): 'tokkyu' | 'kyuko' | 'local' => id === 'limited' || id === 'southern' ? 'tokkyu' : id === 'express' || id === 'airport' ? 'kyuko' : 'local';
export const sameClass = (a: ServiceId, b: ServiceId): boolean => classOf(a) === classOf(b);

const baseTimetables = new WeakMap<ServiceSpec, { timetable: ServiceSpec['timetable']; waits?: ServiceSpec['waits'] }>();
/** 時間帯のダイヤ（待避・走行中の追い越し・時刻表）を全種別へ反映 */
export function applyTimeOfDay(route: Route, tod: TimeOfDay = route.timeOfDay ?? 'noon'): void {
  for (const v of route.services ?? []) {
    let b = baseTimetables.get(v);
    if (!b) { b = { timetable: v.timetable, waits: v.waits }; baseTimetables.set(v, b); }
    v.waits = v.waitsByTime ? [...(v.waitsByTime[tod] ?? [])] : b.waits;
    v.runPasses = v.runPassesByTime?.[tod] ?? [];
    v.timetable = v.timetableByTime?.[tod] ?? b.timetable;
  }
}

/** 種別を route へ反映（停車駅・時刻・停止位置・編成長・制限）。何度呼んでもよい */
export function applyService(route: Route, id: ServiceId | undefined): ServiceSpec | undefined {
  applyTimeOfDay(route);
  const svc = serviceOf(route, id);
  if (!svc) return undefined;
  let b = bases.get(route);
  if (!b) {
    b = { stations: route.stations.map(s => ({ ...s, platform: { ...s.platform } })), limits: route.limits.map(L => ({ ...L })), trainLength: route.trainLength, startS: route.startS, lineLimit: route.lineLimit };
    bases.set(route, b);
  }
  const carLen = carLenOf(svc.kind), len = svc.cars * carLen, off = stopOffset(svc.cars, carLen, route.stopBaseCars ?? BASE_CARS);
  route.trainLength = len;
  route.activeLane = svc.lane;
  route.activeServiceId = svc.id;
  route.lineLimit = svc.lineLimit ?? b.lineLimit; // 種別ごとの最高速度（曲線・分岐器の制限は共通）
  route.startS = b.startS - off;
  route.stations.forEach((sta, i) => {
    const base = b.stations[i], tt = svc.timetable[i];
    sta.pass = svc.stops.includes(i) ? undefined : true;
    sta.stopS = base.stopS - off;
    sta.scheduledArrival = tt?.arr ?? base.scheduledArrival;
    sta.dwell = tt?.dep != null ? tt.dep - tt.arr : undefined;
    sta.stopMarkerCars = svc.cars;
    sta.mainTrack = svc.trackNames?.[i] ?? base.mainTrack;
    // 普通（useLoop）は待避線へ。loopPriority の駅（堺の上り）は逆で、優等列車が外側の線、普通が本線側
    // 普通（useLoop）が待避線へ入るのは、この時間帯にその駅で待避・待ち合わせがあるときだけ（始発駅・終着駅は従来どおり待避線）。
    // 待避線の外側にだけホームがある駅（浜寺公園の堺方面。本線にホームが無い）は、待避が無くても待避線へ
    const waitsHere = i === 0 || i === route.stations.length - 1 || !!sta.loop?.outside || !!svc.waits?.some(w => w.station === i);
    sta.enterLoop = !!sta.loop && !sta.pass && (sta.loopPriority ? !svc.useLoop : !!svc.useLoop && waitsHere);
    // 2面4線: 待避線に入ると右側、本線は左側がホーム。島式1面2線: 自線の右側
    // 待避線のホームが外側にある駅（浜寺公園の堺方面）は、待避線に入ると待避線の外（左）がホーム
    sta.platform.side = sta.island ? 'R' : sta.loop ? (sta.enterLoop ? (sta.loop.outside ? (sta.loop.lat < 0 ? 'L' : 'R') : 'R') : 'L') : svc.platformSides?.[i] ?? base.platform.side;
  });
  // 曲線制限の解除位置は編成長に合わせる（元データは base.trainLength 分を含む）
  const lim: SpeedLimit[] = b.limits.map(L => ({ ...L, to: L.to - b.trainLength + len }));
  // 待避線に入る 2面4線駅: 入口分岐器から出口分岐器を後部が抜けるまで分岐器制限
  route.stations.forEach(sta => {
    const z = loopZone(sta);
    if (!z || !sta.enterLoop) return;
    lim.push({ from: z.inFrom, to: z.outTo + len, kmh: z.limit, label: '分岐器制限' });
  });
  // 分岐器制限のある島式駅（単線の交換駅・頭端駅）: S字の始まりから後部が抜けるまで
  route.stations.forEach(sta => {
    const z = islandZone(sta), k = sta.island?.turnoutLimitKmh;
    if (!z || !k) return;
    lim.push({ from: Math.max(route.extent.from, z.inFrom), to: Math.min(z.outTo, route.extent.to) + len, kmh: k, label: '分岐器制限' });
  });
  for (const L of svc.laneLimits ?? []) lim.push({ ...L, to: L.to + len });
  lim.sort((a, c) => a.from - c.from);
  route.limits.splice(0, route.limits.length, ...lim);
  return svc;
}
