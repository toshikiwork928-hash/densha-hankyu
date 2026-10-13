// 堺駅の配線（配線略図.net 011_02）。上り（なんば方面）だけ特殊で、外側の4番線が本線（直進、優等列車）、
// 内側の3番線が分岐側（普通、分岐器制限 45km/h）。下り側は外側の1番線が副線、内側の2番線が本線。
// 上り方向の横位置（上り本線 = 0）: 4番線 0 | 島式 | 3番線 9.4 | 2番線（下り本線）13.4 | 島式 | 1番線 22.8。
// 下り本線は駅の前後で 4 から 13.4 へ外へずれて、上りの3番線の場所を空ける。
// 堺〜泉大津（shiokaze.ts、上りの終着）と堺〜なんば（namba.ts、上りの始発）で同じ形を使う。下りは reverseRoute が鏡像にする
import type { ExtraTrack, LatProfile, SpeedLimit, Station } from './types';

/** 3番線・下り本線・1番線の横位置 */
export const SAKAI_LAT = { up3: 9.4, down2: 13.4, down1: 22.8 } as const;

/** pf = ホームの泉大津側の端（上り方向の s）。ホームは 220m */
export function sakaiLayout(pf: number) {
  const pt = pf + 220;
  /** 下り本線（route.tracks の 4）の横位置の変化。前後の点は呼び出し側の折れ線に挿む */
  const down: LatProfile = [[pf - 260, 4], [pf - 150, SAKAI_LAT.down2], [pt + 150, SAKAI_LAT.down2], [pt + 260, 4]];
  /** 上りの3番線（分岐器はホーム端の 20〜130m 外） */
  const up3: LatProfile = [[pf - 130, 0], [pf - 20, SAKAI_LAT.up3], [pt + 20, SAKAI_LAT.up3], [pt + 130, 0]];
  const down1: LatProfile = [[pf - 130, SAKAI_LAT.down2], [pf - 20, SAKAI_LAT.down1], [pt + 20, SAKAI_LAT.down1], [pt + 130, SAKAI_LAT.down2]];
  const extraTracks: ExtraTrack[] = [
    { id: 'sakai-3', lat: up3, from: pf - 130, to: pt + 130 },
    { id: 'sakai-1', lat: down1, from: pf - 130, to: pt + 130 },
  ];
  const platforms: NonNullable<Station['customPlatforms']> = [
    { kind: 'island', lat: SAKAI_LAT.up3 / 2, width: 6 },
    { kind: 'island', lat: (SAKAI_LAT.down2 + SAKAI_LAT.down1) / 2, width: 6 },
  ];
  /** 普通の分岐器制限（3番線の分岐器。先頭基準の区間） */
  const localLimit = (from: number, to: number): SpeedLimit => ({ from, to, kmh: 45, label: '分岐器制限' });
  return { pf, pt, down, up3, extraTracks, platforms, localLimit };
}

/** 折れ線 base の [from, to] 区間を、挿入する点列 ins で置き換える（ins は s 昇順） */
export function spliceProfile(base: LatProfile, ins: LatProfile): LatProfile {
  const a = ins[0][0], b = ins[ins.length - 1][0];
  return [...base.filter(([s]) => s < a), ...ins, ...base.filter(([s]) => s > b)];
}
