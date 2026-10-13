// ゲーム全体の定数（路線に依存しないもの）
export const NOTCH_MIN = -9; // EB
export const NOTCH_MAX = 5;
export const NOTCH_EB = -9;
export const NOTCH_INITIAL = -4; // 発車前は B4

export const notchName = (n: number): string => (n > 0 ? 'P' + n : n === 0 ? 'N' : n === NOTCH_EB ? 'EB' : 'B' + -n);

export const OVERRUN_FAIL = 15; // これ以上行き過ぎたら失格 [m]
export const STOP_ZONE = 40; // 停止位置手前この距離以内で停止したら停車判定 [m]
export const STOP_CONFIRM = 1.0; // 停止継続で判定確定 [s]
export const OVERSPEED_MARGIN = 0.5; // 制限 + この値 [km/h] を超えたら速度超過
export const JOINT_INTERVAL = 25; // レール継ぎ目間隔 [m]
export const ANNOUNCE_DIST = 800; // 次駅案内の距離 [m]
export const NEAR_DIST = 100; // 「停止位置まで100m」[m]
export const LIMIT_NOTICE_DIST = 600; // 制限予告 [m]
export const MAX_DT = 0.05;
/** 戸閉め開始から閉まり切る（戸閉灯点灯）までの時間 [s]。audio/station.ts のチャイム 3回（約1.9秒）＋ 戸の摺動・当たり（約1.4秒）に合わせる */
export const DOOR_CLOSE_TIME = 3.5;
/** 始発駅でドアを開けて待つ時間 [s]（発車メロディ 約8.6秒 → 戸閉め） */
export const ORIGIN_DWELL = 16;
/** 時間帯ごとの始発時刻 [s since 0:00]（時刻表は相対時刻のまま平行移動） */
export const START_CLOCK: Record<'morning' | 'noon' | 'evening' | 'night', number> = {
  morning: 7.5 * 3600, noon: 10 * 3600, evening: 17.5 * 3600, night: 21.5 * 3600,
};

export const FONT = '"Hiragino Sans","Yu Gothic","Meiryo",sans-serif';
