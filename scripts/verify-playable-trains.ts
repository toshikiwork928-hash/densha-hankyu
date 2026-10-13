// 追加車両の選択・保存復元・方向別併結と既存運行の回帰検証。
// node_modules/.bin/esbuild scripts/verify-playable-trains.ts --bundle --platform=node --format=esm --external:three --outfile=node_modules/.cache/verify-playable-trains.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { shiokaze, shiokazeUp } from '../src/route/routes/shiokaze';
import { kishiwada, kishiwadaUp } from '../src/route/routes/kishiwada';
import { through, throughUp } from '../src/route/routes/through';
import { namba, nambaUp } from '../src/route/routes/namba';
import { mountain, mountainUp } from '../src/route/routes/mountain';
import { applyVehicles, applyService, serviceOf } from '../src/route/service';
import { createState, resetState, type VehicleSel } from '../src/game/state';
import { createGame } from '../src/game/loop';
import { buildTrack } from '../src/route/track';
import { EventBus } from '../src/core/events';
import { createTrainEnv, TRAIN_PERF } from '../src/sim/train';
import { createRng } from '../src/core/rng';
import type { Route, ServiceId, TrainKind } from '../src/route/types';
import type { GameContext } from '../src/core/context';

const memory = new Map<string, string>();
(globalThis as any).window = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => memory.set(k, v),
  removeItem: (k: string) => memory.delete(k),
};
function context(source: Route, service: ServiceId, vehicles: VehicleSel = {}): GameContext {
  const route = structuredClone(source);
  return {
    route, track: buildTrack(route), events: new EventBus(),
    state: createState(route, { stageId: 'all', service, mode: 'normal', vehicles }),
    trainEnv: createTrainEnv(), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    renderer: null!, env: null!, rng: createRng(12345), assetsReady: true,
    envState: { timeOfDay: 'noon', weather: 'clear', intensity: 0 }, light: { night: 0, tunnel: 0 },
    cameraMode: 'cab', actions: null!,
  };
}
function operation(route: Route) {
  return {
    stations: route.stations, limits: route.limits, trainLength: route.trainLength,
    startS: route.startS, lineLimit: route.lineLimit, activeLane: route.activeLane,
  };
}
let cases = 0;
const coastal = [shiokaze, shiokazeUp, kishiwada, kishiwadaUp, through, throughUp, namba, nambaUp];
for (const source of [...coastal, mountain, mountainUp]) {
  for (const spec of source.services ?? []) {
    // 追加前からの適用手順と既定車両の線路・停止位置・時刻を比較する。
    const baseline = structuredClone(source);
    applyVehicles(baseline, {}); applyService(baseline, spec.id);
    const current = context(source, spec.id);
    assert.deepEqual(operation(current.route), operation(baseline), `${source.id}/${spec.id} 既定運行`);
    assert.equal(serviceOf(current.route, spec.id)!.kind, spec.kind);
    assert.deepEqual(serviceOf(current.route, spec.id)!.units, spec.units);
    cases++;
  }
}
for (const source of coastal) {
  for (const id of ['local', 'express', 'airport'] as const) {
    if (!source.services?.some(s => s.id === id)) continue;
    const c = context(source, id, { [id]: { kind: 'commuter-1000', units: [4, 2] } });
    assert.equal(serviceOf(c.route, id)!.kind, 'commuter-1000');
    assert.deepEqual(serviceOf(c.route, id)!.units, [6], `${source.id}/${id} 1000系6両単独`);
    assert.equal(c.route.trainLength, 120);
    resetState(c.state, c.route);
    assert.deepEqual(serviceOf(c.route, id)!.units, [6]);
    cases++;
    if (id === 'local') {
      const denied = context(source, id, { local: { kind: 'commuter-9000', units: [4, 4] } });
      assert.notEqual(serviceOf(denied.route, id)!.kind, 'commuter-9000', '普通に9000系を出さない');
      cases++;
    } else {
      const old = context(source, id, { [id]: { kind: 'commuter-9000', units: [6] } });
      assert.equal(serviceOf(old.route, id)!.kind, 'commuter-9000');
      assert.deepEqual(serviceOf(old.route, id)!.units, [4, 4]);
      assert.equal(old.route.trainLength, 160);
      const game = createGame(old);
      game.actions.selectVehicle({ kind: 'commuter-1000' });
      assert.deepEqual(old.service!.units, [6]);
      game.actions.selectVehicle({ kind: 'commuter-new', units: [4, 2] });
      assert.deepEqual(old.service!.units, [4, 2], '8300系の既存編成へ戻せる');
      cases++;
    }
  }
  const original = source.services?.find(s => s.id === 'southern');
  if (!original) continue;
  const reservedAt = original.unitKinds!.indexOf('southern-10000');
  for (const freeKind of ['commuter-new', 'commuter-9000'] as const) {
    const chosen: VehicleSel = { southern: { kind: 'southern-12000', units: [4, 4], freeKind } };
    const c = context(source, 'southern', chosen), game = createGame(c);
    const expected: TrainKind[] = reservedAt === 0 ? ['southern-12000', freeKind] : [freeKind, 'southern-12000'];
    assert.deepEqual(c.service!.unitKinds, expected, `${source.id} 12000系の方向と相手`);
    assert.equal(c.service!.kind, expected[0]);
    assert.deepEqual(c.service!.units, [4, 4]);
    assert.equal(c.service!.cars, 8);
    assert.equal(c.trainEnv.perf!.a0, TRAIN_PERF['southern-12000'].a0, '混成全体の起動性能');
    const restored = context(source, 'southern', JSON.parse(JSON.stringify(c.state.sel.vehicles)));
    assert.deepEqual(serviceOf(restored.route, 'southern')!.unitKinds, expected, '選択の復元');
    game.actions.selectVehicle({ freeKind: freeKind === 'commuter-new' ? 'commuter-9000' : 'commuter-new' });
    assert.ok(c.service!.unitKinds!.includes('southern-12000'), '相手変更で指定席車を保持');
    game.actions.selectVehicle({ kind: 'southern-10000' });
    assert.deepEqual(c.service!.unitKinds, original.unitKinds, '既存10000系＋7100系へ戻る');
    game.actions.selectVehicle({ kind: 'southern-12000' });
    assert.ok(!c.service!.unitKinds!.includes('commuter-old'), '12000系に7100系を併結しない');
    cases++;
  }
  const invalid = context(source, 'southern', {
    southern: { kind: 'southern-12000', units: [6], freeKind: 'commuter-old' },
  });
  assert.deepEqual(serviceOf(invalid.route, 'southern')!.units, [4, 4]);
  assert.ok(!serviceOf(invalid.route, 'southern')!.unitKinds!.includes('commuter-old'));
  cases++;
}
console.log(`追加車両・保存・方向別併結・既存運行 ${cases} ケース合格`);
