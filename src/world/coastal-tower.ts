// 駅直結のタワーまわりで住宅・道路・街路樹を置かない範囲。
// 羽衣駅直結のタワーマンションは手で置いていたが、OpenStreetMap の沿線データ（osm-town.ts）が正しい位置に建てるので削除した。
// 残りは泉大津駅前の2棟並びのタワー（izumiotsu-towers.ts）。
import type { Route } from '../route/types';
import { twinTowerZones } from './izumiotsu-towers';

/** タワー周辺に住宅・道路・街路樹を置かない範囲（s）。向きに依らず中心対称。 */
export function towerZones(route: Route): { side: 1 | -1; from: number; to: number }[] {
  return twinTowerZones(route);
}
