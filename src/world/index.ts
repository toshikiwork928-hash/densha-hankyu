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
import { buildHagoromoTrain } from './hagoromo-train';
import { buildNambaTerminal } from './namba-terminal';
import { buildMisakiParkTrain, buildMisakiYard } from './misaki-park-train';
import { buildSuminoeDepot, buildSuminoeDepotTrains } from './suminoe-depot';
import { buildKoyaPlatforms, buildKoyaTraffic } from './koya-traffic';
import { buildNambaParked } from './namba-parked';
import { buildNambaLandmarks } from './namba-landmarks';
import { nambaFrame } from './namba-frame';
import { buildSumiyoshiTaisha } from './sumiyoshi-taisha';
import { createRunPasses } from './run-pass';
import { buildWakayamashi } from './wakayamashi';
import { buildWakayamashiTrains } from './wakayamashi-trains';
import { buildWakayamadaigakumae } from './wakayamadaigakumae';
import { downFrame } from './down-frame';
import { buildIzumisanoAirport } from './izumisano-airport';
import { buildHagurazakiDepot, buildHagurazakiDepotTrains } from './hagurazaki-depot';

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
  buildHagoromoTrain(ctx); // 羽衣3番線に停車中の 2000系（描画のみ）
  buildMisakiParkTrain(ctx); // みさき公園5番線（多奈川線）に停車中の 7100系 2両（描画のみ）
  buildMisakiYard(ctx); // みさき公園の保守用の留置線（黄色い保守用車両・資材）
  buildCatenary(ctx); // rng 不使用
  buildBackdrop(ctx);
  buildCoast(ctx); // OSM の海岸線のあるコースだけ（rng 不使用）
  buildSigns(ctx);
  buildStations(ctx);
  buildEndBlock(ctx);
  const town = buildTown(ctx); // 独自乱数（ctx.rng 不使用）
  buildSignals(ctx); // [A] 閉そく信号機（rng 不使用）
  const oncoming = createOncoming(ctx);
  buildCrossings(ctx, oncoming);
  buildCuttings(ctx);
  // 堺〜なんば専用（上り 'namba' と下り 'namba-up'。座標は上りのもの、world/namba-frame.ts）。ctx.rng を消費しない（他の路線の生成順に影響しない）
  const nctx = nambaFrame(ctx);
  if (nctx) {
    buildNambaTerminal(nctx);
    buildSuminoeDepot(nctx);
    buildSuminoeDepotTrains(nctx); // 留置の電車（描画のみ）
    buildNambaLandmarks(nctx);
    buildSumiyoshiTaisha(nctx); // 住吉大社（OSM の位置）
    buildKoyaPlatforms(nctx);
    buildKoyaTraffic(nctx); // 高野線・汐見橋線の電車（描画のみ）
    buildNambaParked(nctx); // 難波の他の番線に停まっている電車（描画のみ）
  }
  // みさき公園〜和歌山港の和歌山市駅（構内・車庫・JR・留置の電車。上りは world/mw-frame.ts で下りの座標へ写す）。ctx.rng を消費しない
  buildWakayamashi(ctx);
  buildWakayamashiTrains(ctx);
  // みさき公園〜和歌山港の和歌山大学前駅の周辺（橋上駅舎・駅ビル・イオンモールへのデッキ・西口・マンション・斜面。同じく下りの座標）。ctx.rng を消費しない
  buildWakayamadaigakumae(ctx);
  // 泉佐野〜みさき公園専用（下り 'izumisano-misaki' と上り '-up'。座標は下りのもの、world/down-frame.ts）。ctx.rng を消費しない
  const sctx = downFrame(ctx, 'izumisano-misaki');
  if (sctx) {
    buildIzumisanoAirport(sctx); // 南海空港線の分岐の高架と、その上を通る JR 関西空港線の橋
    buildHagurazakiDepot(sctx); // 羽倉崎検車区
    buildHagurazakiDepotTrains(sctx); // 留置の電車（描画のみ）
  }
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
