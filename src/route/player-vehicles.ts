// プレイヤー用の車両候補と保存値を路線データへ反映する。
import { applyVehicles, carsOf } from './service';
import type { Route, ServiceId, ServiceSpec, TrainKind } from './types';

export interface PlayerVehicleSelection {
  kind: TrainKind;
  freeKind?: TrainKind;
  units?: number[];
  cars?: number;
}

export interface PlayerVehicleOptions {
  kinds: TrainKind[];
  formations: number[][];
  freeKinds?: TrainKind[];
}

const addUnique = <T>(base: T[], ...values: T[]): T[] => [...base, ...values.filter(v => !base.includes(v))];
const sameUnits = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((n, i) => n === b[i]);
const originalKinds = new WeakMap<ServiceSpec, TrainKind[] | undefined>();
const formationsFor = (svc: ServiceSpec, kind: TrainKind): number[][] =>
  kind === 'commuter-1000' ? [[6]] : kind === 'commuter-9000' ? [[4, 4]]
    : (svc.formationOptions ?? [svc.units]).filter(u => u.length !== 1 || u[0] !== 6 || svc.id === 'limited');

/** 路線側に書かれた候補へ、空港急行など共通生成される候補を補う。 */
export function playerVehicleOptions(svc: ServiceSpec): PlayerVehicleOptions {
  if (svc.kind === 'commuter-2300') return { kinds: [svc.kind], formations: svc.formationOptions ?? [svc.units] };
  if (svc.id === 'southern') return {
    kinds: ['southern-10000', 'southern-12000'],
    // 10000系は既存の7100系併結を維持し、12000系だけ自由席を選べる。
    freeKinds: svc.unitKinds?.includes('southern-12000') ? ['commuter-new', 'commuter-9000'] : ['commuter-old'],
    formations: [[4, 4]],
  };
  let kinds = [...(svc.kindOptions ?? [svc.kind])];
  const formations = formationsFor(svc, svc.kind);
  if (svc.id === 'local') kinds = addUnique(kinds, 'commuter-1000');
  if (svc.id === 'express' || svc.id === 'airport') {
    kinds = addUnique(kinds, 'commuter-1000', 'commuter-9000');
  }
  return { kinds, formations };
}

const valid = (svc: ServiceSpec, v: PlayerVehicleSelection | undefined): v is PlayerVehicleSelection =>
  !!v && playerVehicleOptions(svc).kinds.includes(v.kind);

/** 保存値を検査し、車種ごとの固定編成とサザンの座席指定・自由席を反映する。 */
export function applyPlayerVehicles(route: Route, selections: Partial<Record<ServiceId, PlayerVehicleSelection>>): void {
  for (const svc of route.services ?? []) {
    if (!originalKinds.has(svc)) originalKinds.set(svc, svc.unitKinds ? [...svc.unitKinds] : undefined);
    svc.unitKinds = originalKinds.get(svc)?.slice();
  }
  applyVehicles(route, selections);
  for (const svc of route.services ?? []) {
    const v = selections[svc.id];
    if (!valid(svc, v)) continue;
    if (svc.id === 'southern') {
      const seat = v.kind === 'southern-12000' ? v.kind : 'southern-10000';
      const freeKinds = v.kind === 'southern-12000' ? ['commuter-new', 'commuter-9000'] as TrainKind[] : ['commuter-old'] as TrainKind[];
      const selectedFree = v.freeKind;
      const free = selectedFree && freeKinds.includes(selectedFree) ? selectedFree : freeKinds[0];
      // 路線の向きが変わっても、座席指定車の位置は既存の unitKinds の位置を保つ。
      const seatAtHead = svc.unitKinds?.[0] === 'southern-10000' || svc.unitKinds?.[0] === 'southern-12000';
      svc.unitKinds = seatAtHead ? [seat, free] : [free, seat];
      svc.kind = svc.unitKinds[0];
      svc.units = [4, 4]; svc.cars = 8;
      continue;
    }
    svc.kind = v.kind;
    const fixed = v.kind === 'commuter-1000' ? [6] : v.kind === 'commuter-9000' ? [4, 4] : undefined;
    const formations = formationsFor(svc, v.kind);
    const units = fixed ?? formations.find(x => v.units ? sameUnits(x, v.units) : carsOf(x) === v.cars)
      ?? formations.find(x => sameUnits(x, svc.units)) ?? formations[0];
    svc.units = [...units]; svc.cars = carsOf(units);
  }
}
