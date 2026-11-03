// ワールド構築の入口。生成順は ctx.rng の消費順に影響するので変えるときは注意
import type { GameContext } from '../core/context';
import { loadAllAssets } from './assets';
import { createOncoming, type OncomingSystem } from './oncoming';
import { buildBackdrop, buildEndBlock, placeScenery, prepareSceneryModels } from './scenery';
import { buildSigns } from './signs';
import { buildSignals } from './signals';
import { buildStations } from './stations';
import { buildTrackMesh } from './track-mesh';
import { buildTerrain } from './terrain';
import { buildCoast } from './coast';
import { buildStructures } from './structures';
import { buildCatenary } from './catenary';
import { buildCrossings } from './crossings';
import { buildCuttings } from './cuttings';
import { buildTown } from './town-jp';
import { createCab } from './cab';
import { createPlayerTrain, type PlayerTrain } from './player-train';
import { createOvertaking } from './overtaking';
import { buildCoastalLandmarks } from './coastal-landmarks';
import { createRunPasses } from './run-pass';
import { buildHankyuBranches } from './hankyu-branches';
import { buildHankyuLandmarks } from './hankyu-landmarks';
import { buildHankyuDepotTrains } from './hankyu-depot';

export interface World {
  oncoming: OncomingSystem;
  player: PlayerTrain;
  /** 外部素材を読み込んで配置。戻り値 = 失敗件数 */
  loadAssets(): Promise<number>;
}

/** 同期部分（線路・山・標識・駅）を生成 */
export function buildWorld(ctx: GameContext): World {
  buildTerrain(ctx);
  buildTrackMesh(ctx);
  buildStructures(ctx);
  buildCoastalLandmarks(ctx);
  buildCatenary(ctx); // rng 不使用
  buildBackdrop(ctx);
  buildCoast(ctx); // OSM の海岸線のあるコースだけ（rng 不使用）
  buildSigns(ctx);
  buildStations(ctx);
  buildHankyuBranches(ctx); // 阪急: 今津線・甲陽線の直角のホームと線路（rng 不使用）
  buildHankyuLandmarks(ctx); // 阪急: 沿線の目印（rng 不使用）
  buildEndBlock(ctx);
  const town = buildTown(ctx); // 独自乱数（ctx.rng 不使用）
  buildSignals(ctx); // [A] 閉そく信号機（rng 不使用）
  const oncoming = createOncoming(ctx);
  buildCrossings(ctx, oncoming);
  buildCuttings(ctx);
  buildHankyuDepotTrains(ctx); // 阪急: 西宮車庫の留置の2000系（描画のみ）
  const player = createPlayerTrain(ctx);
  createOvertaking(ctx); // [G] 待避の通過列車・待避線の先行普通
  createRunPasses(ctx); // 複々線の走行中の追い越し（時間帯のパターン）
  createCab(ctx);

  return {
    oncoming,
    player,
    async loadAssets() {
      const { loaded, failed, total } = await loadAllAssets((done, n) => ctx.events.emit('assetsProgress', { done, total: n }));
      placeScenery(ctx, prepareSceneryModels(loaded), town.trees);
      if (failed) console.warn(`素材 ${failed}/${total} 件の読込に失敗。簡易モデルで代替`);
      return failed;
    },
  };
}
