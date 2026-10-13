// みさき公園駅の 5番線（多奈川線）に停まっている 7100系 2両（ワンマン、多奈川行き。描画のみ）。車両生成は DOM を使うので、world/index.ts からだけ呼ぶ（建築限界検査には含めない）。
// 人は乗せない。多奈川線の列車の運転はしない（このコースは本線の運転だけ）。駅の形は route/routes/misaki-park.ts、駅舎は world/misaki-park.ts。
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { profileLat } from '../route/service';
import { GeoBatch, M, P, onLight } from './batch';
import { createRng } from '../core/rng';
import { cullByDistance } from './cull';
import { placeCar } from './emu';
import { isMisakiPark } from './misaki-park';
import { bogieOffset, createTrainSet, setTrainNight } from './train-models';

/** 先頭は多奈川線の側（本線の分岐の側）。ホームの多奈川線寄りの端に停める */
export function buildMisakiParkTrain(ctx: GameContext): void {
  const { route, track } = ctx;
  const sta = route.stations.find(isMisakiPark), x = route.extraTracks?.find(e => e.id === 'misaki-t5');
  if (!sta || !x || !x.bumpers?.length) return;
  const sc = (sta.platform.from + sta.platform.to) / 2, far = x.bumpers[0];
  const dir = far > sc ? 1 : -1; // 先頭の向き（多奈川線の車止めの側）
  const cars = createTrainSet('commuter-old', 2, ctx.renderer, { dest: '多奈川', label: '普通', units: [2] });
  const group = new THREE.Group(); group.name = 'misaki-park-parked';
  const a = new THREE.Vector3(), z = new THREE.Vector3();
  // 先頭をホームの多奈川線寄りの端の 10m 手前に置き、最後尾へ連ねる
  let head = (dir > 0 ? sta.platform.to : sta.platform.from) - dir * 10;
  const isl = (sta.customPlatforms ?? []).filter(p => p.kind === 'island').map(p => p.lat);
  for (const c of cars) {
    const mid = head - dir * c.length / 2, bog = bogieOffset(c.length);
    const lat = (q: number) => profileLat(x.lat, q);
    a.copy(track.at(mid + dir * bog, lat(mid + dir * bog), .38)); z.copy(track.at(mid - dir * bog, lat(mid - dir * bog), .38));
    placeCar(c.object, a, z); group.add(c.object);
    // ドアは島式ホーム（5番線のとなり）の側だけ開ける。進行方向（dir）に対する左右
    const platLat = isl.reduce((best, q) => Math.abs(q - lat(mid)) < Math.abs(best - lat(mid)) ? q : best, isl[0]);
    c.setDoors(true, (platLat - lat(mid)) * dir > 0 ? 'R' : 'L');
    head -= dir * c.length;
  }
  onLight(ctx, (n, t) => setTrainNight(Math.max(n, t)));
  ctx.scene.add(group); cullByDistance(ctx, group, 500);
}

/** 保守用の留置線（misaki-yard-*）に、黄色い保守用車両・資材を載せた貨車・資材置き場を並べる（描画のみ。位置・本数は不明でゲーム用の概形） */
export function buildMisakiYard(ctx: GameContext): void {
  const { route, track } = ctx;
  const yards = (route.extraTracks ?? []).filter(e => e.id.startsWith('misaki-yard'));
  if (!yards.length) return;
  const b = new GeoBatch(), rnd = createRng(5151);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  yards.forEach(x => {
    // 車止めの側へ向かって車両を並べる（反対側は本線から分かれる曲線なので 100m 空ける）。上りのコースでは s の向きが逆
    const bumperAtStart = (x.bumpers?.[0] ?? x.to) <= x.from + 1;
    const from = bumperAtStart ? x.from + 8 : x.from + 100, to = bumperAtStart ? x.to - 100 : x.to - 8;
    let s = from;
    while (s + 8 < to) {
      const kind = rnd(), len = kind < .4 ? 15 : kind < .72 ? 10 : 13;
      if (s + len > to) break;
      const sc = s + len / 2, p = track.at(sc, profileLat(x.lat, sc), .4), t = track.trackAt(sc);
      const yaw = -t.phi;
      if (kind < .4) { // 黄色い保守用車（車体・屋根・足まわり）
        b.add('body', P.boxB, M(p.x, p.y, p.z, yaw, 2.9, 3.0, len), 0xe2b100);
        b.add('body', P.boxB, M(p.x, p.y + 3.0, p.z, yaw, 2.5, .22, len - .8), 0x9a9c9e);
        b.add('body', P.boxB, M(p.x, p.y - .15, p.z, yaw, 2.3, .5, len - 3.5), 0x2a2c2f);
        b.add('body', P.box, M(p.x, p.y + 1.9, p.z, yaw, 2.95, .7, len - 3), 0x2f4a5a); // 窓の帯
      } else if (kind < .72) { // 砕石・まくらぎを載せた無蓋貨車
        b.add('body', P.boxB, M(p.x, p.y, p.z, yaw, 2.8, .9, len), 0x3a3d40);
        const load = rnd() < .5;
        b.add('body', P.boxB, M(p.x, p.y + .9, p.z, yaw, 2.5, load ? 1.0 : .6, len - 1), load ? 0xa49f93 : 0x78726a);
      } else { // 保守用の小型車（クレーン付き）
        b.add('body', P.boxB, M(p.x, p.y, p.z, yaw, 2.6, 1.0, len), 0x3a3d40);
        b.add('body', P.boxB, M(p.x, p.y + 1.0, p.z, yaw, 2.4, 1.9, 4.5), 0xe2b100);
        b.add('body', P.boxB, M(p.x + t.rx * .0, p.y + 2.9, p.z, yaw, .5, .5, len - 5), 0xe2b100);
      }
      s += len + 1.2 + rnd() * 3.5;
    }
    // 資材置き場: 留置線の外側（左）に、まくらぎ・砕石の山と小屋
    const out = profileLat(x.lat, (x.from + to) / 2) - 5;
    for (let q = from; q < to - 10; q += 22 + rnd() * 18) {
      const pp = track.at(q, out - rnd() * 3, 0), t = track.trackAt(q);
      const h = .8 + rnd() * 1.4;
      b.add('body', P.boxB, M(pp.x, pp.y, pp.z, -t.phi, 2.2 + rnd() * 1.5, h, 6 + rnd() * 8), rnd() < .5 ? 0x9e998d : 0x6f6a60);
    }
    const hut = track.at((from + to) / 2, out - 8, 0), ht = track.trackAt((from + to) / 2);
    b.add('body', P.boxB, M(hut.x, hut.y, hut.z, -ht.phi, 5, 3, 9), 0xd8d6cc);
    b.add('body', P.boxB, M(hut.x, hut.y + 3, hut.z, -ht.phi, 5.4, .3, 9.4), 0x5d6670);
  });
  const g = new THREE.Group(); g.name = 'misaki-yard';
  b.build({ body: mat }, g);
  ctx.scene.add(g); cullByDistance(ctx, g, 600);
}
