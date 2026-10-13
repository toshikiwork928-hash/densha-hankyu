// 描画を伴わない運行回帰チェック。esbuild で Node 向けに束ねて実行する。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { shiokaze, shiokazeUp } from '../src/route/routes/shiokaze';
import { mountain, mountainUp } from '../src/route/routes/mountain';
import { kishiwada, kishiwadaUp } from '../src/route/routes/kishiwada';
import { izumisano, izumisanoUp } from '../src/route/routes/izumisano';
import { izumisanoMisaki, izumisanoMisakiUp } from '../src/route/routes/izumisano-misaki';
import { through, throughUp } from '../src/route/routes/through';
import { namba, nambaUp, NAMBA_TRACKS } from '../src/route/routes/namba';
import { misakiWakayamako, misakiWakayamakoUp } from '../src/route/routes/misaki-wakayamako';
import { approachText, departText } from '../src/audio/announce-text';
import { applyService, destOf, sameClass, selectableServices } from '../src/route/service';
import { buildTrack } from '../src/route/track';
import { loopZone, loopShape, profileLat, trackLines } from '../src/route/service';
import { coastalThirdTracks } from '../src/world/coastal-stations';
import type { Route, ServiceId } from '../src/route/types';
import { createState, stagesOf, type VehicleSel } from '../src/game/state';
import { createGame } from '../src/game/loop';
import { EventBus } from '../src/core/events';
import { createTrainEnv } from '../src/sim/train';
import { createRng } from '../src/core/rng';
import { attachAutodrive } from '../src/debug/autodrive';
import { terminalSpeedLimit } from '../src/game/terminal-ats';
import type { GameContext } from '../src/core/context';
import { createSignalSystem } from '../src/game/signals';

(globalThis as any).window = {};

function context(source: Route, service: ServiceId, vehicles: VehicleSel = {}): GameContext {
  const route = structuredClone(source);
  return { route, track: buildTrack(route), events: new EventBus(), state: createState(route, { stageId: 'all', service, mode: 'normal', vehicles }),
    trainEnv: createTrainEnv(), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), renderer: null!, env: null!, rng: createRng(12345),
    assetsReady: true, envState: { timeOfDay: 'noon', weather: 'clear', intensity: 0 }, light: { night: 0, tunnel: 0 }, cameraMode: 'cab', actions: null! };
}

// タイトルボタンと同じ候補、保存復元、実際のTab/ゲームパッド用選択処理を確認。
for (const source of [shiokaze, shiokazeUp, kishiwada, kishiwadaUp, izumisano, izumisanoUp, through, throughUp, namba, nambaUp, izumisanoMisaki, izumisanoMisakiUp, misakiWakayamako, misakiWakayamakoUp]) {
  const ids = selectableServices(source).map(v => v.id);
  // 急行のあるコースは、選べない保存済み種別から急行へ戻る。急行の無いコース（みさき公園〜和歌山港）は先頭の種別（普通）へ戻る
  const fallback = ids.includes('express') ? 'express' : ids[0];
  const izumiotsuEnd = [source.stations[0], source.stations.at(-1)!].some(s => s.name === '泉大津');
  for (const special of ['limited', 'southern'] as const) {
    assert.equal(ids.includes(special), !izumiotsuEnd && !!source.services?.some(v => v.id === special), `${source.id}/${special}のTOP選択`);
    const restored = context(source, special);
    assert.equal(restored.state.sel.service, ids.includes(special) ? special : fallback, `${source.id}/${special}の保存復元`);
    if (ids.includes(special)) for (const stage of stagesOf(restored.route)) {
      assert.ok(!['泉大津', '羽衣'].includes(restored.route.stations[stage.from].name), `${source.id}/${special}通過駅から開始しない`);
      assert.ok(!['泉大津', '羽衣'].includes(restored.route.stations[stage.to].name), `${source.id}/${special}通過駅で終了しない`);
    }
  }
  const ctx = context(source, 'express'), game = createGame(ctx), selected = new Set<ServiceId>();
  for (let i = 0; i < ids.length; i++) { game.actions.selectService(1); selected.add(ctx.state.sel.service); }
  assert.deepEqual([...selected].sort(), [...ids].sort(), `${source.id}のキーボード選択候補`);
}

// 車両モデル生成だけを代替し、実際のovertaking描画処理がtrack.atへ渡す横位置を採取。
// 分岐計算や配置処理は本番ソースをそのまま実行する。WebGLと画像生成は不要。
{
  (globalThis as any).document ??= { createElement: () => ({ getContext: () => ({
    createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
  }) }) };
  const source = readFileSync('src/world/overtaking.ts', 'utf8').replace(
    "import { bogieOffset, createTrainSet, type TrainCar } from './train-models';",
    `const bogieOffset = (length: number) => length * .35;
     const createTrainSet = (_kind: unknown, cars: number) => Array.from({ length: cars }, () => ({ object: new THREE.Group(), length: 20.8, setDoors() {} }));
     type TrainCar = ReturnType<typeof createTrainSet>[number];`);
  const { build } = createRequire(import.meta.url)('esbuild');
  const compiled = await build({ stdin: { contents: source, resolveDir: process.cwd() + '/src/world', loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['three', 'three/*'], write: false, logLevel: 'silent' });
  const module = { exports: {} as { createOvertaking: (ctx: GameContext) => void } };
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  for (const service of ['express', 'airport'] as const) {
    const ctx = context(shiokazeUp, service), coordinates: number[] = [], at = ctx.track.at.bind(ctx.track);
    ctx.track.at = ((s: number, lat: number, y: number) => { coordinates.push(lat); return at(s, lat, y); }) as typeof ctx.track.at;
    ctx.state.state = 'run'; ctx.state.train.s = ctx.route.stations.at(-1)!.stopS - 200;
    module.exports.createOvertaking(ctx); ctx.events.emit('frame', { dt: .1 });
    assert.ok(coordinates.length >= 8, `${service}泉大津待機普通の台車を配置`);
    assert.ok(coordinates.every(lat => Math.abs(lat + 9.2) < .001), `${service}泉大津待機普通は1番線に配置 ${coordinates}`);
    assert.ok(ctx.scene.children.some(group => group.visible && group.name.endsWith(':goal')), '終着待機普通を表示');
  }
}
console.log('TOP種別・保存復元・入力選択・泉大津待機普通の配置を確認');
if (process.argv.includes('--selection-only')) process.exit(0);

// 南海本線 みさき公園〜和歌山港（下り・上り）: 駅・線形・終着・種別・景観データの構造（完走は後の共通ループが全種別・全時間帯で検査する）
{
  const names = ['みさき公園', '孝子', '和歌山大学前', '紀ノ川', '和歌山市', '和歌山港'];
  for (const route of [misakiWakayamako, misakiWakayamakoUp]) {
    const down = route === misakiWakayamako, n = route.stations.length, last = n - 1, tag = route.id;
    assert.deepEqual(route.stations.map(s => s.name), down ? names : [...names].reverse(), `${tag}の駅`);
    assert.equal(Math.abs(route.stations[last].stopS - route.stations[0].stopS), 15100, `${tag}みさき公園〜和歌山港 15.1km`);
    assert.equal(route.oncoming.length, 0, `${tag}の route.oncoming は空（対向列車は oncoming-timetable.json の共通運行）`);
    // 踏切は OSM の位置（scripts/build-crossings.ts）。停車した列車（最長 8両）の下には置かない
    assert.ok((route.crossings?.length ?? 0) >= 20, `${tag}の踏切 ${route.crossings?.length}`);
    for (const c of route.crossings ?? []) for (const st of route.stations) assert.ok(c.s < st.stopS - 165 - (c.roadWidth ?? 6) / 2 || c.s > st.stopS + 6 + (c.roadWidth ?? 6) / 2, `${tag}の踏切 ${c.id} が ${st.name} の停車位置の下`);
    assert.deepEqual(selectableServices(route).map(v => v.id), ['local', 'express', 'southern'], `${tag}のTOP種別は普通・急行・サザン`);
    const track = buildTrack(route);
    assert.ok(Math.abs(track.length - 15378.192) < .01, `${tag}の線形の総延長 ${track.length}`);
    // ホームは直線・水平（みさき公園は待避線の分岐器を含む区間も本線が直線）
    for (const st of route.stations) {
      const { from, to } = st.platform, phi = track.trackAt(from).phi, y = track.trackAt(from).y;
      for (let q = from; q <= to; q += 5) {
        assert.ok(Math.abs(track.trackAt(q).phi - phi) < 1e-9, `${tag}/${st.name}ホーム全体が直線`);
        assert.ok(Math.abs(track.trackAt(q).y - y) < 1e-6, `${tag}/${st.name}ホームが水平`);
      }
      // 待避線の入口の分岐器からホームの端まで本線が直線（和歌山港の島式は、線形がホームの手前 15032〜15090 の R168 の曲線で、線路を開く S字区間はこの曲線に重なる）
      // （上りのみさき公園は、逆向きの入口の分岐器が出口側の R4977 以上の緩い曲線にかかるので、ホームの範囲だけ検査する）
      for (const z of [down ? loopZone(st) : null]) if (z) {
        const ap = track.trackAt(z.inFrom).phi;
        for (let q = z.inFrom; q <= st.platform.to; q += 5) assert.ok(Math.abs(track.trackAt(q).phi - ap) < 1e-9, `${tag}/${st.name}入口の分岐器からホームの端まで本線が直線`);
      }
    }
    // 勾配は ±25‰ 以内、トンネル・橋・高架はホームの範囲に重ならない（和歌山港の築堤だけホームを含む）
    for (const g of route.gradients ?? []) assert.ok(Math.abs(g.permil) <= 25, `${tag}の勾配 ${g.permil}‰`);
    for (const st of route.stations) for (const x of route.structures ?? []) {
      if (x.kind === 'viaduct' && st.name === '和歌山港') continue;
      assert.ok(st.platform.to <= x.from || st.platform.from >= x.to, `${tag}/${st.name}ホームと${x.kind}が重ならない`);
    }
    assert.deepEqual((route.structures ?? []).map(x => x.kind).sort(), ['bridge', 'bridge', 'tunnel', 'tunnel', 'tunnel', 'viaduct'], `${tag}の構造物`);
    const bridges = (route.structures ?? []).filter(x => x.kind === 'bridge').sort((a, b) => a.from - b.from);
    assert.ok(bridges.some(b => Math.abs((b.to - b.from) - 650) < .5), `${tag}の紀ノ川橋梁 650m`);
    // 終点は和歌山港（頭端・島式・築堤上）。下りは終着 ATS（低速進入）有効、上りは無効（みさき公園は途中駅）
    const term = down ? route.stations[last] : route.stations[0];
    assert.ok(term.headEnd && term.island && term.elevated, `${tag}の和歌山港は頭端・島式・築堤上`);
    assert.equal(!!route.terminalApproach, down, `${tag}の終着ATS`);
    assert.equal(route.groundFollowsTrack, true);
    // 和歌山港線（和歌山市の先）は 80km/h の仮値
    const sec = down ? [route.stations[4].platform.to + 10, route.stations[5].platform.from - 100] : [route.stations[0].platform.to + 100, route.stations[1].platform.from - 10];
    let maxLim = 0;
    for (let q = sec[0]; q <= sec[1]; q += 10) { const k = track.limitAt(q); assert.ok(k <= 80, `${tag}の和歌山港線は80km/h以下 s=${q} ${k}`); maxLim = Math.max(maxLim, k); }
    assert.equal(maxLim, 80, `${tag}の和歌山港線の制限（曲線のない所は80km/h）`);
    // 信号の id は重複せず、s の範囲内
    const ids = route.signals!.map(g => g.id);
    assert.equal(new Set(ids).size, ids.length, `${tag}信号 id の重複なし`);
    for (const g of route.signals!) assert.ok(g.s > route.extent.from && g.s < route.extent.to, `${tag}信号 ${g.id} が範囲内`);
    // サザンは みさき公園・和歌山大学前・和歌山市・和歌山港に停車し、孝子・紀ノ川は通過（上りは反転）
    const sv = route.services!.find(v => v.id === 'southern')!, lv = route.services!.find(v => v.id === 'local')!;
    const idx = (nm: string) => route.stations.findIndex(s => s.name === nm);
    assert.deepEqual(sv.stops, ['みさき公園', '和歌山大学前', '和歌山市', '和歌山港'].map(idx).sort((a, b) => a - b), `${tag}サザンの停車駅`);
    assert.deepEqual(lv.stops, [0, 1, 2, 3, 4, 5], `${tag}普通の停車駅`);
    assert.equal(sv.lineLimit, 110); assert.equal(lv.lineLimit, 90);
    assert.deepEqual(sv.units, [4, 4]); assert.deepEqual(sv.unitKinds, down ? ['southern-10000', 'commuter-old'] : ['commuter-old', 'southern-10000']);
    assert.ok(!lv.waits?.length && !lv.waitsByTime, `${tag}の普通は待避しない`);
    for (const v of route.services!) for (const [k, tt] of Object.entries(v.timetable)) assert.ok(tt.arr >= 0 && (+k === 0 || tt.arr > 0), `${tag}/${v.id}時刻表`);
    // 終着の案内（下りは終点・2番線）と番線
    const r = structuredClone(route);
    for (const v of selectableServices(route)) {
      const svc = applyService(r, v.id)!, tr = buildTrack(r);
      if (down) {
        // 始発のみさき公園: 普通は1番線(T1・横位置-9.2・ドア右)、サザンは2番線(T2・0・ドア左)
        assert.equal(r.stations[0].mainTrack, v.id === 'local' ? '1番線' : '2番線');
        assert.ok(Math.abs(tr.pathLat(r.stations[0].stopS) - (v.id === 'local' ? -9.2 : 0)) < 1e-6, `${tag}/${v.id}みさき公園の発車線`);
        assert.equal(r.stations[0].platform.side, v.id === 'local' ? 'R' : 'L');
        assert.equal(r.stations[last].mainTrack, '2番線');
        // 普通の行先は和歌山市（和歌山港まで走る区間 4-5 のときだけ和歌山港）。終点の放送は、行先が終着駅のときだけ
        const atLast = v.id === 'local' ? { ...svc, destination: '和歌山港', destinationKana: 'わかやまこう' } : svc;
        assert.ok(approachText(r, last, atLast).includes('終点'), approachText(r, last, atLast));
        if (v.id === 'local') assert.ok(!approachText(r, last, svc).includes('終点'), '普通（和歌山市行）は和歌山港を終点と言わない');
        // 行先は選んだ区間の終点で決まる: 普通は和歌山市（4-5 は和歌山港）、急行・サザンは和歌山港（和歌山市までの区間は和歌山市）
        for (const [stageId, dest] of [['all', v.id === 'local' ? '和歌山市' : '和歌山港'], ['0-4', '和歌山市'], ['4-5', '和歌山港']] as const) {
          if (v.id === 'local' && stageId === '0-4') continue; // 普通に 0-4 は無い（通しが和歌山市まで）
          const q = structuredClone(route);
          createState(q, { stageId, service: v.id, mode: 'normal', vehicles: {} } as any);
          const got = q.services!.find(x => x.id === v.id)!;
          assert.equal(got.destination, dest, `${tag}/${v.id}/${stageId}の行先`);
          assert.ok(departText(q, 0, false, got).includes(`${dest === '和歌山市' ? 'ワカヤマシ' : 'ワカヤマコウ'}行きです`), `${tag}/${v.id}/${stageId}の放送`);
        }
        assert.ok(Math.abs(tr.pathLat(r.stations[last].stopS) + 3.9) < 1e-6, `${tag}/${v.id}和歌山港の自線は島式ホームの左の線`);
        assert.equal(r.stations[last].platform.side, 'R');
      } else {
        assert.equal(r.stations[0].mainTrack, '1番線');
        assert.ok(Math.abs(tr.pathLat(r.stations[0].stopS) + 3.9) < 1e-6, `${tag}/${v.id}和歌山港の発車線`);
        // 上りの終着はみさき公園: 上り本線(T3)の3番線（待避線は使わない。ドア左）
        assert.ok(!r.stations[last].enterLoop && !r.stations[last].loop, `${tag}/${v.id}みさき公園は待避線なし`);
        assert.equal(r.stations[last].mainTrack, '3番線');
        assert.equal(r.stations[last].platform.side, 'L');
        assert.ok(Math.abs(tr.pathLat(r.stations[last].stopS)) < 1e-6, `${tag}/${v.id}みさき公園の自線は上り本線`);
      }
    }
  }
  console.log('みさき公園〜和歌山港（上下）の駅・線形・終着・種別チェック成功');
}
// みさき公園駅（盛土上の島式2面5線）: 2コース・上下で共通の定義（routes/misaki-park.ts）。線路4本（T1・T2・T3・T5）、島式2面、多奈川線の車止め
{
  const C = 4; // route.tracks [0, 4] の左右の和
  for (const [route, at, down] of [[izumisanoMisaki, 9, true], [izumisanoMisakiUp, 0, false], [misakiWakayamako, 0, true], [misakiWakayamakoUp, 5, false]] as const) {
    const sta = route.stations[at], tag = route.id, dn = (lat: number) => down ? lat : C - lat; // 下りの座標へ戻す
    assert.equal(sta.name, 'みさき公園');
    assert.equal(sta.layout, 'custom'); assert.ok(!sta.loop && !sta.island, `${tag}みさき公園は待避線・島式1面ではない`);
    const mid = (sta.platform.from + sta.platform.to) / 2;
    const lats = trackLines(route).filter(l => mid >= l.from && mid <= l.to).map(l => dn(l.lat(mid))).sort((a, b) => a - b);
    assert.deepEqual(lats.map(v => Math.round(v * 10) / 10), [-9.2, 0, 4, 13.2], `${tag}みさき公園の線路は4本`);
    const isl = (sta.customPlatforms ?? []).map(p => ({ lat: dn(p.lat), w: p.kind === 'island' ? p.width : 0 })).sort((a, b) => a.lat - b.lat);
    assert.deepEqual(isl.map(p => [Math.round(p.lat * 10) / 10, p.w]), [[-4.6, 5.8], [8.6, 5.8]], `${tag}島式ホーム2面`);
    // 5番線（多奈川線）: 車止めで終わる、本線から離れていく、ホームの先 300m から曲がる
    const t5 = route.extraTracks!.find(x => x.id === 'misaki-t5')!;
    assert.equal(t5.bumpers?.length, 1, `${tag}多奈川線の車止め`);
    const far = t5.bumpers![0], dir = far > mid ? 1 : -1;
    const sep = (d: number) => Math.abs(dn(profileLat(t5.lat, mid + dir * d)) - 4);
    assert.ok(sep(260) < 4.5 && sep(700) > 40 && sep(700) > sep(500), `${tag}多奈川線は並んでから右（西）へ離れる ${sep(260)} ${sep(700)}`);
    assert.ok(Math.abs(far - mid) > 700 && Math.abs(far - mid) < 1000 && (dir > 0 ? far < route.extent.to : far > route.extent.from), `${tag}車止めはコースの範囲内`);
    // 景観を置かない範囲がホームと多奈川線を含む
    assert.ok(route.reserved!.some(z => z.from < sta.platform.from && z.to > sta.platform.to), `${tag}駅の景観除外`);
    // 種別ごとの番線: 下りは普通 1番線・サザン 2番線、上りは3番線
    for (const v of route.services!) {
      const name = v.trackNames?.[at], side = v.platformSides?.[at];
      assert.equal(name, down ? (v.id === 'local' ? '1番線' : '2番線') : '3番線', `${tag}/${v.id}みさき公園の番線`);
      assert.equal(side, down && v.id === 'local' ? 'R' : 'L', `${tag}/${v.id}みさき公園のドア側`);
    }
  }
  console.log('みさき公園駅（島式2面5線・多奈川線の分岐）の定義チェック成功');
}
if (process.argv.includes('--misaki-only')) process.exit(0);

for (const route of [shiokaze, shiokazeUp]) {
  assert.equal(route.stations.length, 10);
  assert.equal(route.stations[9].stopS - route.stations[0].stopS, 10600);
  const geometry = buildTrack(route);
  assert.equal(geometry.length, 11200, '南海本線の線形総延長');
  for (const crossing of route.crossings ?? []) {
    const half = (crossing.roadWidth ?? 6) / 2;
    for (const station of route.stations) assert.ok(crossing.s + half < station.platform.from || crossing.s - half > station.platform.to,
      `${route.id}/${crossing.id}踏切道路がホームを横切らない`);
    for (const structure of route.structures ?? []) assert.ok(crossing.s + half < structure.from || crossing.s - half > structure.to,
      `${route.id}/${crossing.id}踏切道路が高架・橋梁に重ならない`);
    assert.ok(Math.abs(geometry.trackAt(crossing.s).y) < .01, `${route.id}/${crossing.id}踏切は地上`);
  }
  for (const station of route.stations) {
    const { from, to } = station.platform, phi = geometry.trackAt(from).phi;
    assert.ok(Math.abs(geometry.trackAt(to).phi - phi) < 1e-9, `${route.id}/${station.name}ホーム両端の方位一致`);
    // S字で両端だけ同じ方位になるケースも検知する。
    for (let s = from; s <= to; s += 5) assert.ok(Math.abs(geometry.trackAt(s).phi - phi) < 1e-9, `${route.id}/${station.name}ホーム全体が直線`);
    const loop = loopZone(station);
    if (loop) {
      const approachPhi = geometry.trackAt(loop.inFrom).phi;
      for (let s = loop.inFrom; s <= loop.outTo; s += 5) assert.ok(Math.abs(geometry.trackAt(s).phi - approachPhi) < 1e-9, `${route.id}/${station.name}待避線分岐区間の本線が直線`);
    }
    for (const structure of route.structures ?? []) {
      if (structure.kind === 'bridge') assert.ok(to <= structure.from || from >= structure.to, `${route.id}/${station.name}ホームと橋梁区間が重ならない`);
    }
  }
  // 終着 ATS は無効。泉大津は普通が待避線（1番線）へ入り分岐器制限45km/h、急行・特急は本線で制限なし。
  // 堺（上りの終着）は逆: 普通は本線側の3番線で制限なし、急行・特急は外側の4番線へ分岐器制限45km/h。
  const target = 9, stop = route.stations[target].stopS;
  assert.ok(!route.terminalApproach, `${route.id}終着ATSは無効`);
  for (const distance of [1000, 600, 300, 120, 50, 0]) assert.equal(terminalSpeedLimit(route, target, stop - distance), Infinity);
  const sakai = route.id === 'shiokaze';
  for (const service of selectableServices(route).map(v => v.id)) {
    const ctx = context(route, service), sta = ctx.route.stations[target];
    if (sakai) {
      // 堺（上りの終着）: 普通は内側の3番線（分岐器制限45km/h）、優等は外側の4番線（直進・制限なし）
      assert.ok(!sta.loop && !sta.enterLoop, `${route.id}/${service}堺は待避線の仕組みを使わない`);
      assert.equal(sta.mainTrack, service === 'local' ? '3番線' : '4番線', `${route.id}/${service}終着の番線名`);
      assert.equal(ctx.track.limitAt(sta.platform.from - 30), service === 'local' ? 45 : ctx.route.lineLimit, `${route.id}/${service}終着入線の制限`);
      assert.ok(Math.abs(ctx.track.pathLat(sta.stopS) - (service === 'local' ? 9.4 : 0)) < 1e-6, `${route.id}/${service}堺の走行線`);
      assert.equal(sta.platform.side, service === 'local' ? 'L' : 'R');
    } else {
      const loop = service === 'local';
      assert.equal(!!sta.enterLoop, loop, `${route.id}/${service}終着の待避線入線`);
      assert.equal(sta.enterLoop ? sta.loopTrack : sta.mainTrack ?? '', loop ? '1番線' : '', `${route.id}/${service}終着の番線名`);
      const z = loopZone(sta)!;
      assert.equal(ctx.track.limitAt(z.inFrom + 10), loop ? 45 : ctx.route.lineLimit, `${route.id}/${service}終着入線の制限`);
      assert.equal(ctx.track.limitAt(stop - 40) <= (loop ? 45 : 999), true);
    }
    ctx.state.target = target;
    let eb = 0; const ats = createSignalSystem(ctx, () => eb++);
    ctx.state.train.s = stop - 40; ctx.state.train.v = 25 / 3.6; ctx.state.nextSignal = -1; ats.update(1 / 60, true);
    assert.equal(eb, 0, `${route.id}/${service}終着で低速進入ATSの非常制動なし`);
  }
}

for (const route of [izumisano, izumisanoUp]) {
  assert.equal(route.stations.length, 7, `${route.id}駅数`);
  assert.equal(Math.abs(route.stations.at(-1)!.stopS - route.stations[0].stopS), 8000, `${route.id}営業キロ区間`);
  assert.deepEqual(route.stations.map(s => s.name), route.id === 'izumisano'
    ? ['岸和田', '蛸地蔵', '貝塚', '二色浜', '鶴原', '井原里', '泉佐野']
    : ['泉佐野', '井原里', '鶴原', '二色浜', '貝塚', '蛸地蔵', '岸和田']);
  assert.equal(route.services?.length, 5, `${route.id}種別数`);
  const terminal = route.stations[route.id === 'izumisano' ? 6 : 0];
  assert.equal(terminal.layout, 'custom', `${route.id}/泉佐野3面4線カスタム駅`);
  assert.equal(terminal.customPlatforms?.length, 3, `${route.id}/泉佐野ホーム面数`);
  assert.equal(route.extraTracks?.length, 2, `${route.id}/泉佐野追加線（外側2本）`);
  const geometry = buildTrack(route);
  for (const station of route.stations) {
    const phi = geometry.trackAt(station.platform.from).phi;
    const y = geometry.trackAt(station.platform.from).y;
    for (let s = station.platform.from; s <= station.platform.to; s += 5) {
      assert.ok(Math.abs(geometry.trackAt(s).phi - phi) < 1e-9, `${route.id}/${station.name}ホーム直線`);
      assert.ok(Math.abs(geometry.trackAt(s).y - y) < 1e-6, `${route.id}/${station.name}ホーム水平`);
    }
  }
  for (const crossing of route.crossings ?? []) {
    const half = (crossing.roadWidth ?? 6) / 2;
    assert.ok(Math.abs(geometry.trackAt(crossing.s).y) < .01, `${route.id}/${crossing.id}踏切は地上`);
    for (const st of route.stations) assert.ok(crossing.s + half < st.platform.from || crossing.s - half > st.platform.to, `${route.id}/${crossing.id}ホームを横切らない`);
  }
  for (const service of route.services!) {
    assert.ok(service.stops.every(i => i >= 0 && i < route.stations.length), `${route.id}/${service.id}停車駅範囲`);
    assert.equal(service.timetable[route.stations.length - 1]?.arr != null, true, `${route.id}/${service.id}終着時刻`);
    const r = structuredClone(route); applyService(r, service.id);
    const at = route.id === 'izumisano' ? 6 : 0, sta = r.stations[at], track = buildTrack(r);
    const airport = service.id === 'airport' || service.id === 'limited';
    // 下り: 普通・空港系統は外側下り線T1(-9.2)、急行・サザンは下り本線T2(0)。上り（横位置は 4 − 元の値）: 空港系統は外側上り線T4(18.4)、本線系統は上り本線T3(9.2)
    const outerDown = service.id === 'local' || airport;
    const want = route.id === 'izumisano' ? (outerDown ? -9.2 : 0) : (airport ? 4 - 18.4 : 4 - 9.2);
    assert.ok(Math.abs(track.pathLat(sta.stopS) - want) < 1e-6, `${route.id}/${service.id}泉佐野番線の横位置`);
    const p = sta.customPlatforms!.find(p => p.kind === 'island' && Math.abs(p.lat - want) < p.width! / 2 + 2 && (p.lat < want ? 'L' : 'R') === sta.platform.side);
    assert.ok(p, `${route.id}/${service.id}走行線に接するホームがある`);
    assert.equal(sta.platform.side, p!.lat < want ? 'L' : 'R', `${route.id}/${service.id}開扉側`);
  }
}
const downTrack = buildTrack(shiokaze), upTrack = buildTrack(shiokazeUp);
for (let s = 0; s <= downTrack.length; s += 50) assert.ok(Math.abs(downTrack.trackAt(s).y - upTrack.trackAt(upTrack.length - s).y) < 1e-6, '復路の標高一致');

// 時間帯ごとの普通の待避（route/day-patterns.ts）。昼: 泉大津 → 堺は泉大津（始発、待たない）で空港急行・高石で特急、堺 → 泉大津は高石で特急・泉大津（終着、案内のみ）で空港急行
const expectedWaits = new Map([
  ['shiokaze', [['泉大津', 'airport'], ['高石', 'limited']]],
  ['shiokaze-up', [['高石', 'limited'], ['泉大津', 'airport']]],
]);
for (const route of [shiokaze, shiokazeUp]) {
  const r = structuredClone(route); applyService(r, 'local');
  const waits = r.services!.find(s => s.id === 'local')!.waits!;
  assert.deepEqual(waits.map(w => [r.stations[w.station].name, w.passedBy]), expectedWaits.get(route.id));
  for (const tod of ['morning', 'noon', 'evening', 'night'] as const) {
    const q = structuredClone(route); q.timeOfDay = tod; applyService(q, 'local');
    for (const w of q.services!.find(s => s.id === 'local')!.waits!) {
      if (w.station === 0 || w.station === 9) continue; // 起終点では待たない（終着は放送のみ）
      assert.ok(loopZone(q.stations[w.station]), '待避線へ進入可能');
    }
  }
}
// 夜の堺 → 泉大津: 浜寺公園で特急・急行の通過待ち、終着の泉大津の到着前に「特急ラピートβの通過待ちと急行の待ち合わせ」ではなく待ち合わせとして案内
{
  const q = structuredClone(shiokazeUp); q.timeOfDay = 'night'; const sv = applyService(q, 'local')!;
  const park = q.stations.findIndex(s => s.name === '浜寺公園');
  assert.ok(approachText(q, park, sv).includes('ハマデラコウエンで特急ラピートβと急行の通過待ちをします。'), approachText(q, park, sv));
  assert.ok(approachText(q, 9, sv).includes('イズミオオツで特急ラピートβと空港急行の待ち合わせをします。'), approachText(q, 9, sv));
  // 羽衣の到着前は高師浜線の乗り換え案内
  assert.ok(approachText(q, q.stations.findIndex(s => s.name === '羽衣'), sv).includes('タカシノハマ線はお乗り換えください。'));
}
// 特急はラピートとサザン、急行は急行と空港急行が交互（夜の堺 → 岸和田: 浜寺公園はラピート・急行、泉大津はサザン・空港急行）
{
  const q = structuredClone(throughUp); q.timeOfDay = 'night'; const sv = applyService(q, 'local')!;
  const name = (st: string) => sv.waits!.filter(w => q.stations[w.station].name === st).map(w => w.passedBy);
  assert.deepEqual(name('浜寺公園'), ['limited', 'express']); assert.deepEqual(name('泉大津'), ['southern', 'airport']);
}
// 乗り換え案内: 新今宮（JR線）、天下茶屋（なんば行きは高野線も）
{
  const up = structuredClone(namba), sv = applyService(up, 'local')!, dn = structuredClone(nambaUp), sd = applyService(dn, 'local')!;
  const ix = (r: Route, n: string) => r.stations.findIndex(s => s.name === n);
  assert.ok(approachText(up, ix(up, '新今宮'), sv).includes('JR線はお乗り換えです。'));
  assert.ok(approachText(up, ix(up, '天下茶屋'), sv).includes('コウヤ線、地下鉄サカイスジ線、阪急キョウト・キタセンリ方面はお乗り換えください。'));
  assert.ok(approachText(dn, ix(dn, '天下茶屋'), sd).endsWith('。地下鉄サカイスジ線、阪急キョウト・キタセンリ方面はお乗り換えください。') || approachText(dn, ix(dn, '天下茶屋'), sd).includes('です。地下鉄サカイスジ線'), approachText(dn, ix(dn, '天下茶屋'), sd));
}
const parkDown = shiokaze.stations.find(s => s.layout === 'hamadera')!;
const parkUp = shiokazeUp.stations.find(s => s.layout === 'hamadera')!;
const [izumiDown, sakaiDown] = coastalThirdTracks(shiokaze, parkDown), [izumiUp, sakaiUp] = coastalThirdTracks(shiokazeUp, parkUp);
const zoneDown = loopZone(parkDown)!, zoneUp = loopZone(parkUp)!;
// 自線側の副線は普通の走行位置と一致。両方向で同一の物理4線（泉大津方面の島式外側線・堺方面の待避線）。
for (let s = sakaiDown.from; s <= sakaiDown.to; s += 2) assert.ok(Math.abs(sakaiDown.lat(s) - zoneDown.lat * loopShape(zoneDown, s)) < 1e-9, '下り: 普通の走行位置と堺方面待避線が一致');
for (let s = izumiUp.from; s <= izumiUp.to; s += 2) assert.ok(Math.abs(izumiUp.lat(s) - zoneUp.lat * loopShape(zoneUp, s)) < 1e-9, '上り: 普通の走行位置と泉大津方面副線が一致');
for (const s of [izumiDown.from, (izumiDown.from + izumiDown.to) / 2, izumiDown.to - 1]) {
  assert.ok(Math.abs(izumiDown.lat(11200 - s) + izumiUp.lat(s) - 4) < 1e-9, '両方向で同一の物理配置（泉大津方面副線）');
  assert.ok(Math.abs(sakaiDown.lat(11200 - s) + sakaiUp.lat(s) - 4) < 1e-9, '両方向で同一の物理配置（堺方面待避線）');
}
// 諏訪ノ森: 上下ホームは踏切を挟んで離れ、重ならない。
for (const route of [shiokaze, shiokazeUp]) {
  const suwa = route.stations.find(s => s.name === '諏訪ノ森')!, opp = { from: suwa.platform.from + suwa.platformOpp!, to: suwa.platform.to + suwa.platformOpp! };
  const gap = route.crossings!.filter(c => c.s > Math.min(suwa.platform.to, opp.to) && c.s < Math.max(suwa.platform.from, opp.from));
  assert.ok(opp.from > suwa.platform.to + 20 && gap.length === 1, `${route.id}: 諏訪ノ森の上下ホームは踏切を挟んで離れる`);
}
// 石津川〜湊は直線、湊は島式。
{
  const t = buildTrack(shiokaze), ishi = shiokaze.stations[7], minato = shiokaze.stations[8];
  for (let s = ishi.platform.from; s <= minato.platform.to; s += 10) assert.ok(Math.abs(t.trackAt(s).phi - t.trackAt(ishi.platform.from).phi) < 1e-9, '石津川〜湊は直線');
  assert.ok(minato.island && !minato.loop, '湊は島式ホーム');
}

for (const source of [shiokaze, shiokazeUp, mountain, mountainUp]) {
  for (const service of selectableServices(source).map(v => v.id)) {
    const ctx = context(source, service), game = createGame(ctx);
    const observedWaits = new Set<number>(), observedSidings = new Set<number>();
    let heldStation = -1, zoneMax = 0;
    const finalSta = ctx.route.stations.at(-1)!;
    // 堺（custom）は3番線の分岐器の区間（ホームの 140m 手前〜）
    const finalZone = loopZone(finalSta) ?? { inFrom: finalSta.platform.from - 160, outTo: finalSta.platform.to + 130 };
    attachAutodrive(ctx, (sec, dt = 1 / 30, hook) => {
      for (let t = 0; t < sec; t += dt) {
        if (hook?.()) break; game.update(dt);
        const st = ctx.state, o = st.overtake;
        if (source.theme === 'coast' && st.train.s > finalZone.inFrom + 20 && st.train.s < finalZone.outTo) zoneMax = Math.max(zoneMax, st.train.v * 3.6);
        if (o?.localStopped && !o.cleared) {
          observedWaits.add(o.station);
          if (heldStation === o.station) assert.equal(st.signals[o.depSignal], 'R', '優等列車が抜けるまで普通の出発信号は停止');
          heldStation = o.station;
        }
        if (service !== 'local') for (const w of ctx.route.services?.find(s => s.id === 'local')?.waits ?? []) {
          if (!sameClass(w.passedBy, service) || w.station === 0 || w.station === ctx.route.stations.length - 1) continue;
          const sta = ctx.route.stations[w.station], z = loopZone(sta)!;
          if (Math.abs(st.train.s - sta.stopS) < 20) {
            assert.ok(st.precedingS >= z.inTo + 80 && st.precedingS <= z.outFrom, '優等列車が通過時、普通全車が待避線内');
            observedSidings.add(w.station);
          }
        }
      }
    });
    const result = (globalThis as any).window.__qa.run(service, 'all', 3600);
    console.log(JSON.stringify({ route: source.id, service, state: ctx.state.state, s: ctx.state.train.s, time: result.t,
      ats: ctx.state.penalties.atsBrake, overspeed: ctx.state.overspeed, stops: ctx.state.stops.length, final: result.log.slice(-3) }));
    assert.equal(ctx.state.state, 'result', `${source.id}/${service}完走`);
    assert.equal(ctx.state.penalties.atsBrake, 0, `${source.id}/${service}正常運転でATS非常制動なし`);
    assert.equal(result.overspeed, 0, `${source.id}/${service}全区間（終着ATS速度曲線含む）で速度超過減点なし`);
    // 終着は選んだ区間の終点（普通の全線通しが和歌山市までのコースがある）
    assert.ok(Math.abs(ctx.state.train.s - ctx.route.stations[ctx.state.endIndex].stopS) < 15, `${source.id}/${service}終着停止`);
    if (source.theme === 'coast') {
      console.log(`  終着入線 ${service}: 入線区間の最高速 ${zoneMax.toFixed(1)}km/h 番線案内=${result.log.some((l: string) => l.includes('入線'))}`);
      const intoLoop = service === 'local', track = finalSta.enterLoop ? finalSta.loopTrack : finalSta.mainTrack;
      if (intoLoop) assert.ok(zoneMax <= 45 + 1, `${source.id}/${service}終着の待避線入線で45km/h制限を保持`);
      if (track) assert.ok(result.log.some((l: string) => l.includes(`${track}へ入線`)), `${source.id}/${service}終着の番線予告バナー`);
      else assert.ok(!result.log.some((l: string) => l.includes('入線')), `${source.id}/${service}は入線案内なし`);
    }
    if (source.theme === 'coast') {
      const n = ctx.route.stations.length, waits = ctx.route.services!.find(s => s.id === 'local')!.waits!.filter(w => w.station > 0 && w.station < n - 1);
      assert.deepEqual([...observedWaits], service === 'local' ? [...new Set(waits.map(w => w.station))] : [], '普通の通過待ちを指定順で実施');
      assert.deepEqual([...observedSidings], service === 'local' ? [] : [...new Set(waits.filter(w => sameClass(w.passedBy, service)).map(w => w.station))], '指定駅で先行普通の待避を確認');
    }
  }
}
console.log('運行・終着ATS・復路標高チェック成功');

// 最大編成でも第3線への進入・本線通過が成立する。
for (const service of selectableServices(shiokazeUp).map(v => v.id).filter((v): v is 'local' | 'express' | 'airport' => v === 'local' || v === 'express' || v === 'airport')) {
  const ctx = context(shiokazeUp, service, {
    local: { kind: 'commuter-old', units: [4, 2] }, express: { kind: 'commuter-new', units: [4, 4] }, airport: { kind: 'commuter-new', units: [4, 4] },
  });
  const game = createGame(ctx);
  attachAutodrive(ctx, (sec, dt = 1 / 30, hook) => {
    for (let t = 0; t < sec; t += dt) { if (hook?.()) break; game.update(dt); }
  });
  const result = (globalThis as any).window.__qa.run(service, 'all', 3600);
  assert.equal(ctx.state.state, 'result', `最大編成/${service}完走`);
  assert.equal(ctx.state.penalties.atsBrake, 0);
  assert.equal(result.overspeed, 0);
}
console.log('普通6両・急行8両・空港急行8両の待避運行成功');
// 空港急行の6両（4+2）も上下で完走
for (const source of [shiokaze, shiokazeUp]) {
  const ctx = context(source, 'airport', { airport: { kind: 'commuter-new', units: [4, 2] } });
  assert.equal(ctx.route.services!.find(v => v.id === 'airport')!.cars, 6, '空港急行6両');
  const game = createGame(ctx);
  attachAutodrive(ctx, (sec, dt = 1 / 30, hook) => {
    for (let t = 0; t < sec; t += dt) { if (hook?.()) break; game.update(dt); }
  });
  const result = (globalThis as any).window.__qa.run('airport', 'all', 3600);
  assert.equal(ctx.state.state, 'result', `${source.id}/空港急行6両完走`);
  assert.equal(ctx.state.penalties.atsBrake, 0);
  assert.equal(result.overspeed, 0);
}

// 南海本線 泉大津〜岸和田（特急サザン）: 線形・踏切・駅の形と、5種別×上下の完走
for (const route of [kishiwada, kishiwadaUp]) {
  assert.equal(route.stations.length, 5);
  assert.equal(route.stations[4].stopS - route.stations[0].stopS, 5600, '泉大津〜岸和田 5.6km');
  const geometry = buildTrack(route);
  for (const crossing of route.crossings ?? []) {
    const half = (crossing.roadWidth ?? 6) / 2;
    for (const station of route.stations) assert.ok(crossing.s + half < station.platform.from || crossing.s - half > station.platform.to, `${route.id}/${crossing.id}踏切道路がホームを横切らない`);
    for (const structure of route.structures ?? []) assert.ok(crossing.s + half < structure.from || crossing.s - half > structure.to, `${route.id}/${crossing.id}踏切道路が高架・橋梁に重ならない`);
    assert.ok(Math.abs(geometry.trackAt(crossing.s).y) < .01, `${route.id}/${crossing.id}踏切は地上`);
  }
  for (const station of route.stations) {
    const { from, to } = station.platform, phi = geometry.trackAt(from).phi;
    for (let s = from; s <= to; s += 5) assert.ok(Math.abs(geometry.trackAt(s).phi - phi) < 1e-9, `${route.id}/${station.name}ホーム全体が直線`);
    const loop = loopZone(station);
    if (loop) for (let s = loop.inFrom; s <= loop.outTo; s += 5) assert.ok(Math.abs(geometry.trackAt(s).phi - geometry.trackAt(loop.inFrom).phi) < 1e-9, `${route.id}/${station.name}分岐区間が直線`);
    const y = geometry.trackAt(from).y;
    for (let s = from; s <= to; s += 10) assert.ok(Math.abs(geometry.trackAt(s).y - y) < 1e-6, `${route.id}/${station.name}ホームが水平`);
    assert.equal(y > 1, !!station.elevated, `${route.id}/${station.name}高架/地上`);
  }
  // 泉大津の形は堺〜泉大津と同じ（島式2面4線・待避線の位置）
  const izumi = route.stations.find(s => s.name === '泉大津')!, izumiS = shiokaze.stations[0];
  assert.deepEqual(izumi.loop, izumiS.loop, '泉大津の待避線は既存と同じ');
  assert.equal(izumi.platform.to - izumi.platform.from, izumiS.platform.to - izumiS.platform.from);
  assert.ok(route.stations.find(s => s.name === '岸和田')!.indoor, '岸和田は屋内式');
}
{
  const t = buildTrack(kishiwada), u = buildTrack(kishiwadaUp);
  for (let s = 0; s <= t.length; s += 50) assert.ok(Math.abs(t.trackAt(s).y - u.trackAt(u.length - s).y) < 1e-6, '泉大津〜岸和田 復路の標高一致');
}
// 通し（堺〜岸和田）: 区間データと同じ線形・駅位置・標高をつないだもの
for (const [route, parts] of [[throughUp, [shiokazeUp, kishiwada]], [through, [kishiwadaUp, shiokaze]]] as const) {
  const [a, b] = parts, t = buildTrack(route), ta = buildTrack(a), tb = buildTrack(b);
  assert.equal(route.stations.length, 14);
  assert.ok(Math.abs(route.stations[13].stopS - route.stations[0].stopS - 16200) < 1e-6, `${route.id} 堺〜岸和田 16.2km`);
  const off = a.stations.at(-1)!.platform.from - b.stations[0].platform.from;
  // 境目の前後で、区間データと同じ線路の形（相対位置・方位・標高）
  const rel = (tr: typeof t, s0: number, s1: number) => { const p = tr.trackAt(s0), q = tr.trackAt(s1); return [Math.hypot(q.x - p.x, q.z - p.z), q.phi - p.phi, q.y - p.y]; };
  for (const [s0, s1] of [[off, off + 3000], [off + 500, route.stations[13].stopS]]) {
    const [d, dp, dy] = rel(t, s0, s1), [e, ep, ey] = rel(tb, s0 - off, s1 - off);
    assert.ok(Math.abs(d - e) < .05 && Math.abs(dp - ep) < 1e-6 && Math.abs(dy - ey) < 1e-6, `${route.id} b の区間の形が一致`);
  }
  {
    const [d, dp, dy] = rel(t, 0, off), [e, ep, ey] = rel(ta, 0, off);
    assert.ok(Math.abs(d - e) < .05 && Math.abs(dp - ep) < 1e-6 && Math.abs(dy - ey) < 1e-6, `${route.id} a の区間の形が一致`);
  }
  for (const st of route.stations) {
    const { from, to } = st.platform, phi = t.trackAt(from).phi;
    for (let q = from; q <= to; q += 5) assert.ok(Math.abs(t.trackAt(q).phi - phi) < 1e-9, `${route.id}/${st.name}ホーム全体が直線`);
  }
  assert.equal(route.coastalLandmarks!.filter(l => l.kind === 'twin-tower').length, 1, 'タワーは1組');
  const ids = route.signals!.map(g => g.id);
  assert.equal(new Set(ids).size, ids.length, '信号 id の重複なし');
}
// 放送・行先: 堺方面（なんば方面）は全種別「なんば」、和歌山方面は 普通 羽倉崎・急行 和歌山市・空港急行 関西空港・特急ラピートβ 関西空港・特急サザン 和歌山港。
// コースの終着駅は列車の行先ではないので、「終点」と言わない
{
  const want: Record<string, Record<ServiceId, string>> = {
    namba: { local: 'なんば', express: 'なんば', airport: 'なんば', limited: 'なんば', southern: 'なんば' },
    wakayama: { local: '羽倉崎', express: '和歌山市', airport: '関西空港', limited: '関西空港', southern: '和歌山港' },
  };
  const kana: Record<string, string> = { なんば: 'ナンバ', 羽倉崎: 'ハグラザキ', 和歌山市: 'ワカヤマシ', 関西空港: 'カンサイクウコウ', 和歌山港: 'ワカヤマコウ' };
  const names: Record<ServiceId, string> = { local: '普通', express: '急行', airport: '空港急行', limited: '特急ラピートβ', southern: '特急サザン' };
  const courses: [Route, 'namba' | 'wakayama'][] = [[shiokaze, 'namba'], [kishiwadaUp, 'namba'], [through, 'namba'], [shiokazeUp, 'wakayama'], [kishiwada, 'wakayama'], [throughUp, 'wakayama']];
  for (const [route, toward] of courses) {
    for (const v of route.services!) {
      const r = structuredClone(route), sv = applyService(r, v.id)!, dest = want[toward][v.id];
      assert.equal(sv.destination, dest, `${route.id}/${v.id}の行先`);
      assert.equal(sv.name, names[v.id], `${route.id}/${v.id}の種別名`);
      assert.equal(destOf(r, sv), dest);
      const dep = departText(r, 0, false, sv);
      const label = v.id === 'southern' ? '一部座席指定、特急サザン' : `${names[v.id]}、`;
      assert.ok(dep.includes(`この電車は、${label}${kana[dest]}行きです。`), dep);
      assert.ok(!approachText(r, r.stations.length - 1, sv).includes('終点'), `${route.id}/${v.id}の終着駅は終点ではない`);
    }
  }
  assert.ok(departText(...(() => { const r = structuredClone(kishiwada); return [r, 0, false, applyService(r, 'southern')] as const; })()).includes('次は、キシワダに停まります。'));
  // 和歌山市行の急行は春木通過。空港急行のみ春木停車。
  for (const route of [shiokaze, shiokazeUp, kishiwada, kishiwadaUp, izumisano, izumisanoUp, throughUp, through]) {
    const a = route.services!.find(v => v.id === 'airport')!, e = route.services!.find(v => v.id === 'express')!;
    const haruki = route.stations.findIndex(s => s.name === '春木');
    assert.deepEqual(a.stops.filter(i => i !== haruki), e.stops, `${route.id}空港急行と急行の差は春木停車のみ`);
    assert.equal(a.lineLimit, 110); assert.deepEqual(a.units, [4, 4]); assert.equal(a.kind, 'commuter-new');
    if (haruki >= 0) {
      assert.ok(a.stops.includes(haruki), `${route.id}空港急行は春木に停車`);
      assert.ok(!e.stops.includes(haruki), `${route.id}急行は春木を通過`);
      assert.equal(e.timetable?.[haruki]?.dep, undefined, `${route.id}春木通過時刻に発車時刻を置かない`);
    }
  }
  // 普通が終着駅で待避線へ入る番線案内はそのまま（岸和田 → 泉大津の普通は4番線）
  const lu = structuredClone(kishiwadaUp), sl = applyService(lu, 'local')!;
  assert.ok(approachText(lu, 4, sl).includes('4番線'), approachText(lu, 4, sl));
  const su = applyService(structuredClone(kishiwadaUp), 'southern')!;
  assert.deepEqual(su.unitKinds, ['commuter-old', 'southern-10000'], '上りのサザンは 7100系が先頭');
  assert.deepEqual(applyService(structuredClone(kishiwada), 'southern')!.unitKinds, ['southern-10000', 'commuter-old'], '下りのサザンは 10000系が先頭');
}
// 普通の待避駅では、到着前の放送でも待ち合わせ・通過待ちを案内する（堺〜泉大津: 高石で特急の通過待ち）
{
  const r = structuredClone(shiokaze), sv = applyService(r, 'local')!;
  assert.ok(approachText(r, 3, sv).endsWith('タカイシで特急ラピートβの通過待ちをします。'), approachText(r, 3, sv));
  assert.ok(!approachText(r, 5, sv).includes('待'), '昼の浜寺公園は待避なし');
  assert.ok(!approachText(r, 1, sv).includes('待'), '待避しない駅は案内なし');
}
const routeOnly = process.argv.find(a => a.startsWith('--route-only='))?.slice('--route-only='.length);
for (const source of [kishiwada, kishiwadaUp, izumisano, izumisanoUp, throughUp, through, misakiWakayamako, misakiWakayamakoUp].filter(r => !routeOnly || r.id === routeOnly)) {
  for (const service of selectableServices(source).map(v => v.id)) {
    const ctx = context(source, service), game = createGame(ctx);
    const finalSta = ctx.route.stations.at(-1)!, finalZone = loopZone(finalSta) ?? { inFrom: finalSta.platform.from - 160, outTo: finalSta.platform.to + 130 };
    let zoneMax = 0;
    const observedWaits = new Set<number>(), stopT: Record<number, number> = {}, arriveT: Record<number, number> = {};
    attachAutodrive(ctx, (sec, dt = 1 / 30, hook) => {
      for (let t = 0; t < sec; t += dt) {
        if (hook?.()) break; game.update(dt);
        const st = ctx.state;
        if (st.overtake?.localStopped && !st.overtake.cleared) observedWaits.add(st.overtake.station);
        // 優等列車は普通が止まってから着く（到着点 = 停止位置。通過列車は普通の停止位置を通過）
        const o = st.overtake;
        if (o && !o.cleared) {
          const arrive = o.stopAt ?? ctx.route.stations[o.station].stopS;
          if (o.localStopped && stopT[o.station] == null) stopT[o.station] = st.t;
          if (o.head >= arrive - .1 && arriveT[o.station] == null) arriveT[o.station] = st.t;
        }
        if (st.train.s > finalZone.inFrom + 20 && st.train.s < finalZone.outTo) zoneMax = Math.max(zoneMax, st.train.v * 3.6);
      }
    });
    const result = (globalThis as any).window.__qa.run(service, 'all', 3600);
    if (ctx.state.penalties.atsBrake) console.log(result.log.filter((l: string) => /ATS|信号|R|EB|非常/.test(l)).slice(0, 12).join(' | '));
    console.log(JSON.stringify({ route: source.id, service, state: ctx.state.state, time: result.t, ats: ctx.state.penalties.atsBrake, overspeed: ctx.state.overspeed, stops: ctx.state.stops.length }));
    assert.equal(ctx.state.state, 'result', `${source.id}/${service}完走`);
    assert.equal(ctx.state.penalties.atsBrake, 0, `${source.id}/${service}ATS非常制動なし`);
    assert.equal(result.overspeed, 0, `${source.id}/${service}速度超過なし`);
    // 終着・停車駅数は選んだ区間（普通の全線通しが和歌山市までのコースがある）で数える
    const endSta = ctx.route.stations[ctx.state.endIndex], reachesLast = ctx.state.endIndex === ctx.route.stations.length - 1;
    assert.ok(Math.abs(ctx.state.train.s - endSta.stopS) < 15, `${source.id}/${service}終着停止`);
    assert.equal(ctx.state.stops.length, ctx.route.services!.find(s => s.id === service)!.stops.filter(i => i > ctx.state.fromIndex && i <= ctx.state.endIndex).length, `${source.id}/${service}停車駅数`);
    if (service === 'local' && finalSta.loop && reachesLast) assert.ok(zoneMax <= 46, `${source.id}/${service}終着の待避線へ45km/hで入線`);
    const waits = [...new Set(ctx.route.services!.find(v => v.id === 'local')!.waits?.filter(w => w.station > 0 && w.station < ctx.state.endIndex).map(w => w.station) ?? [])];
    assert.deepEqual([...observedWaits], service === 'local' ? waits : [], `${source.id}/${service}普通の待避`);
    for (const k of Object.keys(stopT)) {
      const gap = arriveT[+k] - stopT[+k];
      console.log(`  待避 ${ctx.route.stations[+k].name}: 普通の停止から優等列車の到着まで ${gap.toFixed(1)}秒`);
      assert.ok(gap >= 3, `${source.id}/${ctx.route.stations[+k].name} 優等列車は普通が止まってから着く`);
    }
  }
}
console.log('泉大津〜岸和田・堺〜岸和田・みさき公園〜和歌山港（上下）の完走・サザンの放送チェック成功');
if (routeOnly) process.exit(0);

// 南海本線 堺〜難波（上りのみ・頭端式の難波）: 駅・線形・番線、5種別の完走
{
  const route = namba, t = buildTrack(route);
  assert.equal(route.stations.length, 9);
  assert.equal(route.stations[8].stopS - route.stations[0].stopS, 9800, '堺〜難波 9.8km');
  assert.ok(route.stations[8].headEnd, '難波は頭端式');
  // 堺の形は堺〜泉大津（上りの終着）と同じ（route/sakai-layout.ts）
  const sakai = route.stations[0], sakaiS = shiokaze.stations[9];
  assert.deepEqual(sakai.customPlatforms, sakaiS.customPlatforms);
  assert.equal(sakai.platform.to - sakai.platform.from, sakaiS.platform.to - sakaiS.platform.from);
  for (const st of route.stations) {
    const { from, to } = st.platform, phi = t.trackAt(from).phi, y = t.trackAt(from).y;
    for (let q = from; q <= to; q += 5) {
      assert.ok(Math.abs(t.trackAt(q).phi - phi) < 1e-9, `namba/${st.name}ホーム全体が直線`);
      assert.ok(Math.abs(t.trackAt(q).y - y) < 1e-6, `namba/${st.name}ホームが水平`);
    }
  }
  const want: Record<ServiceId, number> = { local: NAMBA_TRACKS[7], express: NAMBA_TRACKS[6], airport: NAMBA_TRACKS[6], southern: NAMBA_TRACKS[5], limited: NAMBA_TRACKS[9] };
    for (const v of selectableServices(route)) {
    const r = structuredClone(route), sv = applyService(r, v.id)!, tr = buildTrack(r), stop = r.stations[8].stopS;
    assert.ok(Math.abs(tr.pathLat(stop) - want[v.id]) < 1e-6, `namba/${v.id}の番線（横位置 ${tr.pathLat(stop)}）`);
    // 普通は内側の緩行線（住吉大社で 9.4、堺は3番線 9.4）、優等は外側の急行線（0、堺は4番線）
    assert.ok(Math.abs(tr.pathLat(r.stations[3].stopS) - (v.id === 'local' ? 9.4 : 0)) < 1e-6, `namba/${v.id}の複々線の走行線`);
    assert.ok(Math.abs(tr.pathLat(r.stations[0].stopS) - (v.id === 'local' ? 9.4 : 0)) < 1e-6, `namba/${v.id}の堺の番線`);
    assert.equal(tr.limitAt(r.stations[0].stopS + 100), v.id === 'local' ? 45 : r.lineLimit, `namba/${v.id}の堺の分岐器制限`);
    assert.equal(sv.destination, 'なんば');
    const ap = approachText(r, 8, sv);
    assert.ok(ap.includes('終点、ナンバ、') && ap.includes(`${({ local: 7, express: 6, airport: 6, southern: 5, limited: 9 } as Record<ServiceId, number>)[v.id]}番線`), ap);
  }
  const ids = route.signals!.map(g => g.id);
  assert.equal(new Set(ids).size, ids.length, '信号 id の重複なし');
  for (const service of selectableServices(route).map(v => v.id)) {
    const ctx = context(route, service), game = createGame(ctx);
    attachAutodrive(ctx, (sec, dt = 1 / 30, hook) => { for (let q = 0; q < sec; q += dt) { if (hook?.()) break; game.update(dt); } });
    const result = (globalThis as any).window.__qa.run(service, 'all', 3600);
    if (ctx.state.penalties.atsBrake) console.log(Object.keys(result), (result.log ?? []).slice(0, 40).join(' | '));
    console.log(JSON.stringify({ route: route.id, service, state: ctx.state.state, time: result.t, ats: ctx.state.penalties.atsBrake, overspeed: ctx.state.overspeed, stops: ctx.state.stops.length }));
    assert.equal(ctx.state.state, 'result', `namba/${service}完走`);
    assert.equal(ctx.state.penalties.atsBrake, 0, `namba/${service}ATS非常制動なし`);
    assert.equal(result.overspeed, 0, `namba/${service}速度超過なし`);
    assert.ok(Math.abs(ctx.state.train.s - ctx.route.stations[8].stopS) < 15, `namba/${service}終着停止`);
    assert.equal(ctx.state.stops.length, ctx.route.services!.find(s => s.id === service)!.stops.length - 1, `namba/${service}停車駅数`);
  }
  console.log('堺〜難波（5種別）チェック成功');
}
// なんば → 堺（下り）: 発車番線・堺の入線番線（普通 1番線 45km/h、優等 2番線）、5種別の完走
{
  const route = nambaUp, n = route.stations.length;
  assert.equal(n, 9); assert.ok(route.stations[0].headEnd, '始発のなんばは頭端式');
  const dep: Record<ServiceId, number> = { local: 7, express: 6, airport: 6, southern: 5, limited: 9 };
  for (const v of route.services!) {
    const r = structuredClone(route), sv = applyService(r, v.id)!, tr = buildTrack(r);
    assert.ok(Math.abs(tr.pathLat(r.stations[0].stopS) - (4 - NAMBA_TRACKS[dep[v.id] as 9 | 7 | 6 | 5])) < 1e-6, `namba-up/${v.id}の発車番線`);
    assert.ok(Math.abs(tr.pathLat(r.stations[n - 1].stopS) - (v.id === 'local' ? 4 - 22.8 : 4 - 13.4)) < 1e-6, `namba-up/${v.id}の堺の番線`);
    assert.equal(r.stations[n - 1].mainTrack, v.id === 'local' ? '1番線' : '2番線');
    assert.equal(tr.limitAt(r.stations[n - 1].platform.from - 30), v.id === 'local' ? 45 : r.lineLimit, `namba-up/${v.id}の堺の分岐器制限`);
    assert.ok(!sv.waits?.length, '普通の待避なし');
  }
  for (const service of selectableServices(route).map(v => v.id)) {
    const ctx = context(route, service), game = createGame(ctx);
    attachAutodrive(ctx, (sec, dt = 1 / 30, hook) => { for (let q = 0; q < sec; q += dt) { if (hook?.()) break; game.update(dt); } });
    const result = (globalThis as any).window.__qa.run(service, 'all', 3600);
    if (ctx.state.penalties.atsBrake) console.log((result.log ?? []).filter((l: string) => /ATS|非常/.test(l)).slice(0, 6).join(' | '));
    console.log(JSON.stringify({ route: route.id, service, state: ctx.state.state, time: result.t, ats: ctx.state.penalties.atsBrake, overspeed: ctx.state.overspeed, stops: ctx.state.stops.length }));
    assert.equal(ctx.state.state, 'result', `namba-up/${service}完走`);
    assert.equal(ctx.state.penalties.atsBrake, 0, `namba-up/${service}ATS非常制動なし`);
    assert.equal(result.overspeed, 0, `namba-up/${service}速度超過なし`);
    assert.ok(Math.abs(ctx.state.train.s - ctx.route.stations[n - 1].stopS) < 15, `namba-up/${service}終着停止`);
  }
  console.log('なんば〜堺（下り・5種別）チェック成功');
}

// 時間帯ごとのダイヤ（朝・夕・夜）: 全コース・全種別で完走、ATS非常制動なし、速度超過なし、普通は時間帯の待避駅で待つ
{
  let n = 0;
  for (const route of [shiokaze, shiokazeUp, kishiwada, kishiwadaUp, izumisano, izumisanoUp, throughUp, through, namba, nambaUp, izumisanoMisaki, izumisanoMisakiUp, misakiWakayamako, misakiWakayamakoUp]) {
    for (const tod of ['morning', 'evening', 'night'] as const) {
      for (const service of selectableServices(route).map(v => v.id)) {
        const ctx = context(route, service); ctx.envState.timeOfDay = tod;
        const game = createGame(ctx);
        assert.equal(ctx.route.timeOfDay, tod);
        const observed = new Set<number>();
        attachAutodrive(ctx, (sec, dt = 1 / 30, hook) => {
          for (let q = 0; q < sec; q += dt) {
            if (hook?.()) break; game.update(dt);
            const o = ctx.state.overtake;
            if (o?.localStopped && !o.cleared) observed.add(o.station);
          }
        });
        const result = (globalThis as any).window.__qa.run(service, 'all', 4000);
        const tag = `${route.id}/${tod}/${service}`;
        if (ctx.state.penalties.atsBrake || ctx.state.state !== 'result') console.log(tag, (result.log ?? []).filter((l: string) => /ATS警報|非常|待|通過/.test(l)).slice(0, 14).join(' | '));
        assert.equal(ctx.state.state, 'result', `${tag}完走`);
        assert.equal(ctx.state.penalties.atsBrake, 0, `${tag}ATS非常制動なし`);
        assert.equal(result.overspeed, 0, `${tag}速度超過なし`);
        const last = ctx.route.stations.length - 1;
        const want = service === 'local' ? [...new Set((ctx.route.services!.find(v => v.id === 'local')!.waits ?? []).filter(w => w.station > 0 && w.station < last).map(w => w.station))] : [];
        assert.deepEqual([...observed], want, `${tag}普通の待避`);
        n++;
      }
    }
  }
  console.log(`時間帯ごとのダイヤ（朝・夕・夜）${n}運行チェック成功`);
}
