/** 対向列車の共通時刻表モデルを、描画なしで検証する。 */
import { START_CLOCK } from '../src/core/config';
import { createMeet, planMeet } from '../src/game/meet';
import { ROUTES } from '../src/route';
import { runConsist } from '../src/route/oncoming-stops';
import { sakuragaoka } from '../src/route/routes/sakuragaoka';
import { WAKAYAMA_DEST } from '../src/route/service';
import type { CounterTrain } from '../src/world/oncoming-timetable';

// oncoming-timetable は描画アダプタも同居しており、モジュール初期化時だけ発光用 canvas を作る。
// 純粋モデルの検証では描画 API を実行しないため、この最小 canvas で初期化を抑える。
(globalThis as any).document ??= {
  createElement: () => ({ width: 0, height: 0, getContext: () => ({
    createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: '',
  }) }),
};
const { createCounterTraffic, COUNTER_BLOCK_GAP, counterTimetable, makeCounterPlans } = await import('../src/world/oncoming-timetable');
const { coastalThirdTracks } = await import('../src/world/coastal-stations');

type Tod = keyof typeof START_CLOCK;
const TODS: Tod[] = ['morning', 'noon', 'evening', 'night'];
const routeIds = ['shiokaze', 'shiokaze-up', 'kishiwada', 'kishiwada-up', 'izumisano', 'izumisano-up', 'nankai-through', 'nankai-through-up', 'namba', 'namba-up',
  // 泉佐野以南（実ダイヤの対向列車。みさき公園〜和歌山港は和歌山港線内の対向列車を出さない）
  'izumisano-misaki', 'izumisano-misaki-up', 'misaki-wakayamako', 'misaki-wakayamako-up'];
const only = (((globalThis as any).process?.argv as string[] | undefined)?.find(x => x.startsWith("--only="))?.slice("--only=".length) ?? "").split(",").filter(Boolean);
let checks = 0;
let minatoNoonExpressFollowFrames = 0;
const minatoNoonSamples: string[] = [];

function verify(condition: unknown, message: string): asserts condition {
  checks++;
  if (!condition) throw new Error(message);
}

function verifyLazy(condition: unknown, message: () => string): asserts condition {
  checks++;
  if (!condition) throw new Error(message());
}

/** world/oncoming.ts の realConsist と同じ種別・編成選択。車体長を含め本番と同じ条件で点検する。 */
function consist(code: string, ordinal: number, playerTowardNamba: boolean) {
  let result;
  if (code === 'L') result = runConsist('local', ordinal, 'noon', playerTowardNamba);
  else if (code === 'A') result = runConsist('kyuko', ordinal % 2 ? 3 : 1, 'evening', playerTowardNamba);
  else if (code.startsWith('E')) result = { ...runConsist('kyuko', [0, 2, 4][ordinal % 3], 'evening', playerTowardNamba), label: code.slice(1), id: 'express' as const };
  else if (code === 'S') result = runConsist('tokkyu', 1, 'evening', playerTowardNamba);
  else result = { id: 'limited' as const, kind: 'limited' as const, cars: 6, units: [6], label: code === 'Ra' ? '特急ラピートα' : '特急ラピートβ' };
  const { id, ...spec } = result;
  return { ...spec, cars: spec.cars!, kind: spec.kind!, dest: playerTowardNamba ? WAKAYAMA_DEST[id][0] : 'なんば' };
}

function snapshot(trains: CounterTrain[]) {
  return trains.map(t => [t.id, t.active, t.finished, +t.head.toFixed(3), +t.v.toFixed(3), t.station, +t.delay.toFixed(3)]);
}

function sameLaneAt(traffic: ReturnType<typeof createCounterTraffic>, a: CounterTrain, b: CounterTrain): boolean {
  const from = Math.max(a.head, b.head), to = Math.min(a.head + a.length, b.head + b.length);
  if (from > to) return false;
  for (let s = from; s <= to; s += 1) if (Math.abs(traffic.laneAt(a, s) - traffic.laneAt(b, s)) < 3.4) return true;
  return Math.abs(traffic.laneAt(a, to) - traffic.laneAt(b, to)) < 3.4;
}

/** 車体が離れていても、近接する前後端が同じ線路にいる場合は閉そく間隔を検査する。 */
function sharesLane(traffic: ReturnType<typeof createCounterTraffic>, rear: CounterTrain, front: CounterTrain): boolean {
  return traffic.sameTrack(rear, front) || sameLaneAt(traffic, rear, front)
    || Math.abs(traffic.laneAt(rear, rear.head) - traffic.laneAt(front, front.head + front.length)) < 3.4;
}

function trainTrace(traffic: ReturnType<typeof createCounterTraffic>, t: CounterTrain) {
  const path = t.paths.map(p => p.profile ? `profile(${p.profile[0][0]}-${p.profile.at(-1)![0]})` : p.zone ? `loop(${p.zone.inFrom}-${p.zone.outTo})` : 'main').join(',');
  const points = [t.head, t.head + t.length / 2, t.head + t.length].map(s => `${s.toFixed(1)}:${traffic.laneAt(t, s).toFixed(2)}`).join(' ');
  return `${t.id}/${t.code} head=${t.head.toFixed(2)} len=${t.length.toFixed(2)} v=${t.v.toFixed(2)} delay=${t.delay.toFixed(2)} station=${t.station} paths=${path || 'main'} lane[s:lat]=${points}`;
}

function activeSnapshot(trains: CounterTrain[]) {
  return trains.filter(t => t.active).map(t => ({ id: t.id, code: t.code, head: +t.head.toFixed(2), len: +t.length.toFixed(2), v: +t.v.toFixed(2), delay: +t.delay.toFixed(2), station: t.station }));
}

function assertSafety(routeId: string, tod: Tod): void {
  const route = ROUTES[routeId];
  const plans = makeCounterPlans(route, tod);
  const traffic = createCounterTraffic(route, tod, consist);
  // 対向普通の全車体・台車が通る横位置を、実描画と共有する浜寺公園の副線へ照合する。
  for (const train of traffic.trains.filter(t => t.code === 'L')) for (const point of train.plan.points) {
    if (!point.stop || point.station == null) continue;
    const station = route.stations[point.station];
    if (station.layout !== 'hamadera') continue;
    const siding = coastalThirdTracks(route, station).find(x => x.main === train.lat);
    verify(siding != null, `${routeId}/${tod}: 浜寺公園の対向副線がない`);
    for (let s = siding.from - train.length; s <= siding.to + train.length; s += 2) {
      verify(Math.abs(traffic.laneAt(train, s) - siding.lat(s)) < .001,
        `${routeId}/${tod}/${train.id}: 浜寺公園 s=${s} 車両横位置=${traffic.laneAt(train, s)} 線路=${siding.lat(s)}`);
    }
  }
  // 堺で停車する対向普通は、方向に応じた1/3番線の実プロファイルを使う。
  const sakai = route.stations.findIndex(s => s.name === '堺');
  if (sakai >= 0) for (const train of traffic.trains.filter(t => t.code === 'L' && t.plan.points.some(p => p.stop && p.station === sakai))) {
    const playerTowardNamba = route.services?.find(s => s.id === 'local')?.destination === 'なんば';
    const expected = route.extraTracks?.find(x => x.id === (playerTowardNamba ? 'sakai-1' : 'sakai-3'))?.lat;
    verify(expected != null && train.paths.some(p => p.station === sakai && p.profile === expected),
      `${routeId}/${tod}/${train.id}: 堺普通が指定番線プロファイルを使わない`);
  }
  verify(new Set(plans.map(p => p.id)).size === plans.length, `${routeId}/${tod}: 列車 id が重複`);
  for (const plan of plans) {
    verify(plan.points.length >= 2, `${routeId}/${tod}/${plan.id}: 点が不足`);
    for (let i = 1; i < plan.points.length; i++) {
      const a = plan.points[i - 1], b = plan.points[i];
      verify(a.s > b.s, `${routeId}/${tod}/${plan.id}: s が降順でない`);
      verify(a.depart <= b.depart, `${routeId}/${tod}/${plan.id}: 時刻が逆行`);
    }
    for (const p of plan.points) if (p.stop && p.station != null) {
      verify(route.stations[p.station] != null, `${routeId}/${tod}/${plan.id}: 停車駅 ${p.station} がない`);
    }
  }
  const first = Math.min(...plans.map(p => p.points[0].arrive));
  const last = Math.max(...plans.map(p => p.points.at(-1)!.depart));
  // 任意時刻からの冷間開始でも、初期配置した複数編成を同一線路へ重ねない。
  for (const coldClock of [first + 1, first + (last - first) * .35, first + (last - first) * .7]) {
    const cold = createCounterTraffic(route, tod, consist); cold.update(coldClock);
    for (const rear of cold.trains) for (const front of cold.trains) {
      if (rear === front || !rear.active || !front.active || rear.head <= front.head || !sharesLane(cold, rear, front)) continue;
      verify(rear.head + .02 >= front.head + front.length + COUNTER_BLOCK_GAP,
        `${routeId}/${tod}: cold start ${coldClock.toFixed(1)} で ${rear.id}/${front.id} の安全間隔がない`);
    }
  }
  let previous: ReturnType<typeof activeSnapshot> = [], lastClock = first - 1;
  // 遅延を戻しても全列車が系外へ抜けること。安全確認も同じ0.1秒刻みで続ける。
  for (let clock = first - 1; clock <= last + 3600; clock += .1) {
    lastClock = clock;
    traffic.update(clock);
    for (const rear of traffic.trains) for (const front of traffic.trains) {
      if (rear === front || !rear.active || !front.active || rear.head <= front.head || !sharesLane(traffic, rear, front)) continue;
      const floor = front.head + front.length + COUNTER_BLOCK_GAP;
      if (routeId === 'nankai-through-up' && tod === 'noon' && front.code === 'L' && front.stopped && front.station === 1 && rear.code === 'A') minatoNoonExpressFollowFrames++;
      verifyLazy(rear.head + .02 >= floor,
        () => `${routeId}/${tod}: clock=${clock.toFixed(1)} ${rear.id} が ${front.id} へ車体重なり又は ${COUNTER_BLOCK_GAP}m 未満\n現: rear ${trainTrace(traffic, rear)}\n現: front ${trainTrace(traffic, front)}\n直前(${(clock - .1).toFixed(1)}): ${JSON.stringify(previous)}`);
      if (front.stopped && front.station != null) {
        verifyLazy(rear.head + .02 >= route.stations[front.station].platform.to + 180,
          () => `${routeId}/${tod}: clock=${clock.toFixed(1)} ${rear.id}: ${front.id} がホーム占有中に構内へ進入\n現: rear ${trainTrace(traffic, rear)}\n現: front ${trainTrace(traffic, front)}\n直前(${(clock - .1).toFixed(1)}): ${JSON.stringify(previous)}`);
      }
    }
    previous = activeSnapshot(traffic.trains);
    if (clock >= last + 1 && traffic.trains.every(t => t.finished)) break;
  }
  verify(traffic.trains.every(t => t.finished), `${routeId}/${tod}: 遅延後も全列車が運行終了しない`);
  if (routeId === 'nankai-through-up' && tod === 'noon') verify(minatoNoonExpressFollowFrames > 0,
    `昼 堺→岸和田: 湊停車普通の直後に急行が現れない。観測=${minatoNoonSamples.join(' | ') || 'なし'}`);
  const fixed = snapshot(traffic.trains);
  traffic.update(lastClock);
  verify(JSON.stringify(fixed) === JSON.stringify(snapshot(traffic.trains)), `${routeId}/${tod}: 時計非進行で状態が変化`);

  // 遅延・途中時計開始・時計を戻しての再開は、同じ時刻に新規生成した状態と一致する。
  const middle = first + (last - first) * .55;
  const fresh = createCounterTraffic(route, tod, consist); fresh.update(middle);
  traffic.update(middle);
  verify(JSON.stringify(snapshot(fresh.trains)) === JSON.stringify(snapshot(traffic.trains)), `${routeId}/${tod}: 途中時計開始または再作成で状態不一致`);
}

for (const routeId of routeIds) for (const tod of TODS) {
  if (only.length && !only.includes(`${routeId}/${tod}`) && !only.includes(routeId)) continue;
  const timetable = counterTimetable(routeId, tod);
  verify(timetable != null && timetable.length > 0, `${routeId}/${tod}: 時刻表がない`);
  assertSafety(routeId, tod);
}

// 朝の堺〜岸和田: 堺での普通6602と区急3808は同時停車しても3/4番線に分かれる。
const throughMorning = ROUTES['nankai-through-up'];
const throughTraffic = createCounterTraffic(throughMorning, 'morning', consist);
throughTraffic.update(START_CLOCK.morning + 40);
const train6602 = throughTraffic.trains.find(t => t.id === '6602');
const train3808 = throughTraffic.trains.find(t => t.id === '3808');
verify(train6602?.active && train6602.stopped && train6602.station === 0 && Math.abs(train6602.head - 388) < .1,
  '朝 堺→岸和田: 6602 が堺3番線の停止位置にいない');
verify(train3808?.active && train3808.stopped && train3808.station === 0 && Math.abs(train3808.head - 388) < .1,
  '朝 堺→岸和田: 3808 が堺4番線の停止位置にいない');
verify(Math.abs(throughTraffic.laneAt(train6602!, train6602!.head) - throughTraffic.laneAt(train3808!, train3808!.head)) >= 3.4,
  '朝 堺→岸和田: 6602 と3808が同一線路に重なる');

// 単線交換は共通ダイヤを使わず、出発信号保持と閉そく占有を従来経路で維持する。
for (const mountainId of ['mountain', 'mountain-up']) {
  const mountain = ROUTES[mountainId];
  verify(mountain.singleTrack && mountain.meets?.length, `${mountainId}: 単線交換設定がない`);
  verify(counterTimetable(mountain.id, 'noon') == null, `${mountainId}: 共通時刻表を誤適用`);
  const station = mountain.meets![0].station;
  const state: any = { state: 'run', target: station, train: { s: mountain.stations[station].stopS - 500, v: 40 / 3.6 } };
  const events: any = { emit() {} };
  const meet = createMeet({ route: mountain, state, events, track: { limitAt: () => mountain.lineLimit } } as any);
  meet.update(.1);
  verify(state.meet != null && meet.occupying() != null, `${mountainId}: 接近中の対向列車の単線閉そく占有がない`);
  // 到着後の待機は別の実運行入口として確認する（onArrive は18秒到着を予約する）。
  state.meet = undefined;
  state.train.s = mountain.stations[station].stopS; state.train.v = 0;
  meet.onArrive(station, true);
  verify(meet.heldSignal() >= 0, `${mountainId}: 交換待ちの出発信号を保持しない`);
  const p = planMeet(mountain, mountain.meets![0]);
  for (let i = 0; i < 300 && !state.meet.arrived; i++) meet.update(.1);
  verify(state.meet.arrived && state.meet.head === p.headS, `${mountainId}: 対向列車が交換駅で停止しない`);
  verify(meet.heldSignal() === -1, `${mountainId}: 到着後も出発信号を保持する`);
}

// 旧架空コースは従来の 1 編成だけで、共通ダイヤを使わない。
verify(sakuragaoka.oncoming.length === 1, '桜ヶ丘: 旧対向列車が1編成でない');
verify(counterTimetable(sakuragaoka.id, 'noon') == null, '桜ヶ丘: 共通時刻表を誤適用');
console.log(`対向列車検証: ${checks} 件成功（${routeIds.length}方向×4時間帯、0.1秒刻み、昼の湊停車普通直後の急行 ${minatoNoonExpressFollowFrames} フレーム）`);
