// 路線データの型。路線の追加・延伸はデータ追加のみで行えるようにする

/** 線形要素。s=0 は原点、初期進行方向は -Z */
export type Segment =
  | { type: 'straight'; length: number }
  | { type: 'arc'; radius: number; /** 曲がる角度 [rad] */ angle: number; turn: 'L' | 'R' };

/** 勾配区間 [‰]。正 = 上り */
export interface Gradient { from: number; to: number; permil: number }

/** 速度制限区間（先頭基準。to は後部通過分を含めた解除位置） */
export interface SpeedLimit { from: number; to: number; kmh: number; /** バナー用の種別名 */ label?: string }

/** 地上駅の駅舎とホーム間の連絡の実際の構成（world/stations.ts が描く。出典は駅ごとの Wikipedia「駅構造」。未指定は標準の駅舎）
 *  ホームは下りホーム（和歌山方面行き。下り本線の左）と上りホーム（なんば方面行き）。駅舎の位置はホーム上の端（なんば寄り・和歌山市寄り）か中央 */
export interface StationStructure {
  /** 駅舎のあるホーム（both = ホームごとに駅舎・改札がある） */
  building: 'down' | 'up' | 'both';
  /** 駅舎のホーム上の位置（ends = 両端に1棟ずつ） */
  end?: 'namba' | 'wakayama' | 'center' | 'ends';
  /** ホーム間の連絡: footbridge = 跨線橋、underpass = 連絡地下道、crossing = 構内踏切（route.crossings に歩行者踏切を置く）、none = 行き来できない（ホームごとに改札） */
  link?: 'footbridge' | 'underpass' | 'crossing' | 'none';
  /** 駅舎の外観（wood-western = 洋風木造駅舎。淡輪） */
  style?: 'wood-western';
}

export interface Station {
  /** 駅舎・ホーム間の連絡の構成（地上の相対式・custom の駅） */
  structure?: StationStructure;
  /** 沿岸線の駅固有意匠。線路運行は loop / island に従う。 */
  layout?: 'relative' | 'island' | 'loop' | 'hagoromo' | 'hamadera' | 'custom';
  /** layout 'custom' の駅のホーム（world/custom-stations.ts が描く）。island = 中心 lat・幅 width の島式、side = 線路 lat の side 側の片面ホーム。
   *  from/to 未指定は platform と同じ範囲。sign = 駅名標・人・上屋を作る（既定 true） */
  customPlatforms?: CustomPlatform[];
  name: string;
  kana?: string;
  /** 停止位置目標 [m]（先頭位置） */
  stopS: number;
  /** ホーム範囲。side は進行方向に対する側 */
  platform: { from: number; to: number; side: 'L' | 'R' };
  /** 出発からの定刻到着 [s]（始発駅は 0） */
  scheduledArrival: number;
  /** 停車時間 [s]（途中駅用） */
  dwell?: number;
  /** 通過駅 */
  pass?: boolean;
  /** 停止位置目標の両数表示 */
  stopMarkerCars?: number;
  /** 2面4線駅（島式ホーム2面）: 本線の外側に待避線、本線と待避線の間に島式ホーム。
   *  待避線を使う種別（ServiceSpec.useLoop）は分岐器で待避線へ入り、それ以外は本線のホームに停車・本線を通過 */
  loop?: StationLoop;
  /** 2面4線で、待避線（外側の線）を優等列車が使い、普通は本線側に停車する駅（堺の上り: 普通 = 3番線、優等 = 4番線。下り側の1・2番線と同じ並び） */
  loopPriority?: boolean;
  /** 本線側の番線名（loopPriority の駅で普通が入る番線の案内） */
  mainTrack?: string;
  /** 待避線側の番線名（例 '3番線'）。待避線へ入る種別（enterLoop）の到着案内に使う */
  loopTrack?: string;
  /** 島式1面2線駅: 下り線と上り線の間に島式ホーム1本。線路は駅の前後でホームの両側へ膨らみ（S字）、駅の外では元の間隔へ戻る。
   *  待避線は無く、全種別が自線を使う（ホームは自線から見て右側） */
  island?: StationIsland;
  /** 種別適用後: この駅で自列車が待避線に入る（route/service.ts が設定） */
  enterLoop?: boolean;
  /** 高架駅（ホームは高架上、駅舎は高架下） */
  elevated?: boolean;
  /** 頭端式（行き止まり）の終端駅。線路はホームの先（下りなら platform.to 側、route.extent の端）で車止めに終わる */
  headEnd?: boolean;
  /** 屋内式の駅（岸和田）: ホーム全体を屋根と壁で覆い、ホームに入ると外が見えない（駅の前後の開口部だけ）。world が室内として描き、環境光・音をトンネル同様に扱う */
  indoor?: boolean;
  /** 相対式2面2線で上下のホームを前後にずらす駅（踏切を挟んだ対面ホーム）。対向線側のホームは platform から s 方向へこの距離だけずれる（上下とも同じ符号） */
  platformOpp?: number;
}

export type CustomPlatform =
  | { kind: 'island'; lat: number; width: number; from?: number; to?: number; roof?: number; /** ホーム中央の跨線橋への階段口（既定 true。みさき公園は専用の地下道の口を描くので false） */ stairs?: boolean; /** 専用モジュールが描く（難波など） */ external?: boolean }
  | { kind: 'side'; lat: number; side: 'L' | 'R'; from?: number; to?: number; width?: number; external?: boolean };

/** 線路の横位置の折れ線 [s, lat][]（s は昇順）。隣り合う点の lat が違う区間は余弦の S字でつなぎ、範囲外は端の値 */
export type LatProfile = [number, number][];

/** 描画・景観用の線路（複々線の追加の線・頭端駅の番線・支線・入出庫線）。自列車の走行線は ServiceSpec.lane が指す */
export interface ExtraTrack {
  id: string;
  /** 横位置（route.tracks と同じ基準。左が負） */
  lat: LatProfile;
  from: number; to: number;
  /** 車止めの位置（s） */
  bumpers?: number[];
  /** 架線を張らない */
  noWire?: boolean;
  /** 本線の床版から離れる区間は自前の細い床版（高架）を作る（既定 true） */
  ownDeck?: boolean;
  /** 自前の床版の横の範囲（線路中心からの相対、既定 [-2.7, 2.7]）。並ぶ2線を1枚で受けるとき広げる */
  deckSpan?: [number, number];
  /** 離れていく区間の架線柱の横位置（線路中心からの相対、既定は外側へ 2.7） */
  poleOffset?: number;
  /** 盛土の上の線路: 線路が地面より高く構造物でない区間は、盛土を本線と並ぶ線路（11m 以内）の外まで広げ、本線から離れる区間はこの線路だけの盛土を作る（world/terrain.ts） */
  bank?: boolean;
}

/** 2面4線の待避線。lat は自線待避線の横位置（左が負、例 -9.2）。対向側は route.tracks の対向線から鏡像に +lat 側へ */
export interface StationLoop {
  lat: number; turnoutLength: number; turnoutLimitKmh: number;
  /** 待避線のホームが待避線の外側（本線と反対側）にある（浜寺公園の堺方面）。既定は本線と待避線の間の島式 */
  outside?: boolean;
}

/** 島式1面2線駅の線形。spread = 各線がホーム側へ外へ膨らむ量 [m]（ホーム幅 = 線間 + 2×spread − 3.4）、length = S字（ホーム端の 70m 手前・先から）の長さ [m]。
 *  単線（route.singleTrack）では1本の線路が駅の前後の分岐器（両開き）で左右へ分かれ、自列車は左（-spread）、対向列車は右（+spread）を通る＝交換設備（ホーム幅 = 2×spread − 3.4） */
export interface StationIsland {
  spread: number; length: number;
  /** 分岐器（S字）の制限 [km/h]。指定時は S字の始まりから後部が抜けるまで制限（単線の交換駅・頭端駅） */
  turnoutLimitKmh?: number;
  /** 単線の駅の副線（3線目）: 島式ホームの線路の外側に並ぶ行き止まりの線路と片面ホーム。lat = ホーム区間での線路中心の横位置（例 +8.4。符号の側の島式の線へ分岐器で合流）、
   *  bumper = 車止めの側（behind = 進行方向の手前、ahead = 先）、platformWidth = 外側の片面ホームの幅（ホーム端は線路中心から 1.7m）。形状は route/service.ts の bayZone */
  bay?: { lat: number; bumper: 'behind' | 'ahead'; platformWidth: number };
}

/** 単線の交換駅での行き違い（対向列車）。station = 交換駅の index（その向きの route.stations）。自列車はこの駅で対向列車の到着を待って発車する（game/meet.ts） */
export interface MeetSpec { station: number; kind: TrainKind; cars: number; /** 巡航速度 [km/h] */ kmh: number; label?: string; dest?: string }

/** 時間帯（ダイヤのパターン。core/config の START_CLOCK と同じキー） */
export type TimeOfDay = 'morning' | 'noon' | 'evening' | 'night';
/** 待避: 普通がこの駅で後続の優等列車 passedBy を待つ。同じ駅に複数並べると、並べた順に待つ（例 特急の通過 → 急行の接続） */
export interface Wait { station: number; passedBy: ServiceId }
/** 走行中の追い越し（複々線）: 普通が from 駅を出て to 駅に着くまで（from = to なら to 駅に停車中）に、隣の線を後続の優等列車 passedBy が追い抜く（描画のみ） */
export interface RunPass { from: number; to: number; passedBy: ServiceId }

/** 運行種別（プレイヤーが選ぶ） */
/** southern = 特急サザン（10000系 + 7100系の8両。座席指定車と自由席車の併結） */
export type ServiceId = 'local' | 'express' | 'airport' | 'limited' | 'southern';
/** 車両の見た目の種類（world/train-models.ts が生成） */
/** commuter-2300 = 山岳線用の 2300系（18m 車体・2両ユニット）、southern-10000 = 特急サザンの座席指定車（10000系、4両ユニット）
 *  以下は運転できない車種（対向列車・高野線の電車・留置車両のモブ）: commuter-1000 = 1000系（本線・6両）、commuter-2000 = 2000系（17m・2扉。高野線 4両×2・支線 2両。本線には出さない）、
 *  commuter-6300 = 6300系（高野線。7100系と同じ形のステンレス無塗装）、limited-30000 = 30000系（特急こうや。17m・4両） */
export type TrainKind = 'commuter-new' | 'commuter-old' | 'limited' | 'commuter-2300' | 'southern-10000'
  | 'southern-12000' | 'commuter-1000' | 'commuter-9000' | 'commuter-2000' | 'commuter-6300' | 'limited-30000' | 'hankyu-2000';
export interface ServiceSpec {
  id: ServiceId;
  /** 表示名（普通 / 急行 / 空港急行 / 特急ラピートβ / 特急サザン） */
  name: string;
  /** 総両数（units の合計。種別適用で route/service.ts が更新） */
  cars: number;
  /** 編成を組むユニット（両数）。4両・2両のユニットを連結する（例: 6両 = [4, 2]、8両 = [4, 4] または [4, 2, 2]） */
  units: number[];
  /** 先頭車の車種（性能・1両の長さもこれ） */
  kind: TrainKind;
  /** ユニットごとの車種（units と同じ並び、先頭のユニットから）。未指定なら全ユニット kind。サザン（10000系 + 7100系）のような車種混成の編成用 */
  unitKinds?: TrainKind[];
  /** 列車の本来の行先（行先表示・放送）。未指定ならコースの終点駅名。かなは destinationKana */
  destination?: string;
  destinationKana?: string;
  /** 選んだ区間の終点の駅名ごとの行先 [名前, かな]（終点がここにあれば destination の代わりに使う。game/state.ts の resetState が反映）。
   *  例: 急行・サザンの和歌山市まで（みさき公園〜和歌山港コース）は「和歌山市」行 */
  destinationByEnd?: Record<string, [string, string]>;
  /** 停車駅（stations の index）。それ以外は通過 */
  stops: number[];
  /** 停車駅ごとの定刻到着・発車 [s]（stations の index をキー） */
  timetable: Record<number, { arr: number; dep?: number }>;
  /** 線区最高速度 [km/h]（種別ごと。未指定なら route.lineLimit） */
  lineLimit?: number;
  /** 2面4線駅で待避線（外側）に停車する。false なら本線側のホームに停車 */
  useLoop?: boolean;
  /** プレイヤーが選べる車種（先頭が既定）。未指定なら kind 固定 */
  kindOptions?: TrainKind[];
  /** 選べる編成（units の候補。未指定なら units 固定。先頭が既定） */
  formationOptions?: number[][];
  /** 自列車の走行線の横位置（絶対値）。未指定なら route.tracks[0]（とその trackProfiles）。複々線の急行線・頭端駅の番線への進路 */
  lane?: LatProfile;
  /** 駅ごとのドアを開ける側（custom 駅で種別により番線が違う所。駅 index → 側） */
  platformSides?: Record<number, 'L' | 'R'>;
  /** 駅ごとの到着番線（custom 駅で種別により番線が違う所。駅 index → 番線名。Station.mainTrack を上書き） */
  trackNames?: Record<number, string>;
  /** 終着駅で先行の普通（見えない仮想列車）を、走行線の横位置が同じでも自列車と別の番線にいるものとして扱い、閉そくから外す。
   *  普通と同じ外側線を使う種別（泉佐野の空港急行・ラピートβ）が、先行の普通に塞がれて従来より遅れないようにする。向きごとに違うので reverseRoute は写さない */
  precedingLocalApart?: boolean;
  /** lane の分岐器などの制限（先頭基準の区間。to には編成長が加算される） */
  laneLimits?: SpeedLimit[];
  /** 待避（この駅で後続の通過列車を待つ）: 駅 index と、通過していく列車の種別。種別適用で時間帯のもの（waitsByTime）に置き換わる */
  waits?: Wait[];
  /** 時間帯ごとの待避（普通）。指定があれば、その時間帯に無い待避はしない */
  waitsByTime?: Partial<Record<TimeOfDay, Wait[]>>;
  /** 時間帯ごとの走行中の追い越し（普通、複々線） */
  runPassesByTime?: Partial<Record<TimeOfDay, RunPass[]>>;
  /** 種別適用後: 今の時間帯の走行中の追い越し */
  runPasses?: RunPass[];
  /** 時間帯ごとの時刻表（待避で停車時間が変わる普通。scripts/timetable.ts が生成） */
  timetableByTime?: Partial<Record<TimeOfDay, ServiceSpec['timetable']>>;
}

/** 線路脇の標識。lat は左が負 */
export type Sign =
  | { kind: 'limit'; s: number; kmh: number; lat?: number; size?: number; y?: number }
  | { kind: 'limitEnd'; s: number; lat?: number }
  /** 速度制限予告標（制限の手前） */
  | { kind: 'limitNotice'; s: number; kmh: number; lat?: number }
  | { kind: 'distance'; s: number; meters: number; lat?: number }
  | { kind: 'stopMarker'; s: number; cars: number; lat?: number };

/** 対向列車の出現設定 */
export interface OncomingSpec {
  /** 自列車がこの位置を通過したら出現 */
  spawnAt: number;
  /** 出現時の先頭位置 */
  startS: number;
  cars: number;
  carLen: number;
  gap: number;
  kmh: number;
  /** 走行線の横位置 */
  lat: number;
  /** 車両の種類（未指定なら world/oncoming.ts が順に 普通/急行/特急 を割り当て） */
  kind?: TrainKind;
  /** ユニットごとの車種・両数（サザン = ['southern-10000', 'commuter-old'] と [4, 4]）。未指定は kind と cars から従来どおり */
  unitKinds?: TrainKind[];
  units?: number[];
  /** 種別表示（普通/急行/特急）と行先 */
  label?: string;
  dest?: string;
  /** 駅に停車する対向列車（未指定は走り抜ける）。ドアを開けて待ち、自列車が同じ駅で停車して少し経つと発車する */
  stop?: OncomingStop;
  /** 直前の要素（待避線に停車する普通）の後ろから出現する優等列車。普通が待避線へ入る間は後ろで間隔を保ち、普通はこの列車が出口分岐器を抜けてから発車する */
  follow?: boolean;
}

/** 対向列車の停車。headS = 停止時の先頭位置 [m]（対向列車は s の減る向きへ走るので、ホームの手前側＝ from 寄り）、station = 停車駅 index */
export interface OncomingStop {
  station: number; headS: number;
  /** 2面4線駅の対向側の待避線（本線の対向線から +lat 側へ鏡像）に停車。ドアは島式ホーム側（進行方向の右）だけ開く */
  loop?: boolean;
  /** 対向側の待避線の形が自線側の鏡像でない駅（浜寺公園の泉大津方面の副線）の待避線区間。lat は自線側の符号（例 -9.2 → 対向線から +9.2） */
  zone?: { inFrom: number; inTo: number; outFrom: number; outTo: number; lat: number; limit: number };
}

export interface Route {
  /** コース終着駅への接近を連続速度照査（実路線ATSの仕様そのものではない）。南海本線は無効（false）。 */
  terminalApproach?: boolean;
  /** 描画専用の沿岸線ランドマーク。進行反転時は位置・左右・分岐向きを反転する。 */
  coastalLandmarks?: { kind: 'road-overpass' | 'tram-overpass' | 'steel-bridge' | 'branch' | 'twin-tower'; s: number; length?: number; label?: string; side?: 1 | -1; direction?: 1 | -1;
    /** 区間データの向きが反転済み（reverseRoute で作った側）。未指定なら route.id の '-up' で判定。通しコース（route/concat.ts）は区間ごとに持ち越す */
    reversed?: boolean;
    /** steel-bridge: トラスの色（既定は bridgeStyle.color） */
    color?: number;
    /** steel-bridge: 曲弦トラス（下路）で、上下線が別々の橋のとき線路ごとの形式。route.tracks の横位置の小さい線（左）から並べる（向きが反転した側は reversed で自動的に逆順） */
    trussStyles?: ('pratt' | 'warren')[] }[];
  id: string;
  name: string;
  /** 路線（線区）の識別子。同じ線区の下り・上りで共通（例 'shiokaze'、'mountain'）。メニューの路線選択に使う */
  lineId?: string;
  /** 海の側（進行方向に対して。-1 = 左、1 = 右）。未指定なら高架支線の側（従来どおり） */
  seaSide?: 1 | -1;
  /** 沿線の景観テーマ（既定 'coast' = 南海本線の街並み・海沿い、'mountain' = 山岳線） */
  theme?: 'coast' | 'mountain';
  /** 単線区間（駅の交換設備以外は1線）。true なら route.tracks は自線のみ、行き違いは駅の交換設備で行う */
  singleTrack?: boolean;
  /** 線区最高速度 [km/h] */
  lineLimit: number;
  /** 出発時の先頭位置 [m] */
  startS: number;
  /** 出発時刻 [s since 0:00] */
  startClock: number;
  /** 編成長 [m] */
  trainLength: number;
  segments: Segment[];
  gradients?: Gradient[];
  /** s = 0 の標高 [m]（上りは下りの終点側の標高から始まる） */
  elevation0?: number;
  /** 地面が線路の高さに沿って上下する（山あいを通る路線）。既定（未指定）は地面の高さ 0 で、線路が 0 より高い所は盛土・高架になる。
   *  true のときは線路が地面と同じ高さで、橋・高架・トンネルの所だけ地面と線路の高さが違う（world/terrain.ts） */
  groundFollowsTrack?: boolean;
  /** groundFollowsTrack のとき、高架（'viaduct'）の線路面と地面の高さの差 [m]（既定 9） */
  viaductHeight?: number;
  /** 周囲の山（国土地理院の標高）。線路の地面からの高さ [m] の格子。s0 から step ごとの行、lats は線路の中心からの横位置（右が正）。線路から ±350m 以内は 0（OSM の建物・道路が平らな地面を前提に置かれるため）。world/terrain.ts の reliefY */
  relief?: { s0: number; step: number; lats: number[]; rows: number[][] };
  /** 周囲の山を、線路から ±350m 以内（線路際 25m を除く）にも広げる s の範囲。山あいの区間（建物がほとんど無い所）だけ。範囲の両端は 150m でならす */
  reliefNear?: { from: number; to: number }[];
  /** OSM の建物が無い所に家を補わない s の範囲（山あいの区間。osm-town.ts の空き地の補い） */
  noInfill?: { from: number; to: number }[];
  limits: SpeedLimit[];
  /** 停車順。stations[0] が始発 */
  stations: Station[];
  /** 端の駅の駅名標用（前後の隣の駅名） */
  prevName?: string;
  nextName?: string;
  signs: Sign[];
  /** 線路・沿線を生成する範囲 [m] */
  extent: { from: number; to: number };
  /** 線路中心の横位置（自線 0、対向線 +4 など） */
  tracks: number[];
  /** 沿線景観のヒント */
  scenery: { cityZones: { from: number; to: number }[]; endBlockS?: number };
  oncoming: OncomingSpec[];
  /** 単線の交換駅での行き違い（game/meet.ts が対向列車を動かし、world/oncoming.ts が描く） */
  meets?: MeetSpec[];
  /** 停止位置目標 stopS の基準両数（既定 6）。短い編成は (基準 − 両数) × 1両の長さ / 2 だけ手前に止まる */
  stopBaseCars?: number;
  /** 先行の普通との時隔 [s] の路線ごとの上書き（待避駅が無く、優等列車が途中で普通に追いつかないように広げる） */
  precedingHeadway?: Partial<Record<ServiceId, number>>;
  /** 運行種別（未指定なら従来どおり stations の pass/scheduledArrival を使う） */
  services?: ServiceSpec[];
  /** [A] 閉そく信号（自線左側）。aspect は A のロジックが決める */
  signals?: { id: string; s: number }[];
  /** [C] 踏切（中心位置 s） */
  crossings?: { id: string; s: number; roadWidth?: number; /** 歩行者専用の踏切（待機する車を出さない。道幅は 3m 前後） */ foot?: boolean }[];
  /** [C] トンネル・高架などの構造物区間 */
  structures?: { kind: 'tunnel' | 'viaduct' | 'bridge'; from: number; to: number; /** 高架の壁（高欄）を低くする（壁のない高架） */ open?: boolean;
    /** 橋梁: 上下線が別々の単線橋（線路ごとの床版・主桁・橋脚） */ split?: boolean;
    /** 橋梁: 橋脚の位置 s（未指定は 45m ごと） */ piers?: number[];
    /** 橋梁: 線路ごとの橋脚の材質（route.tracks の順。split のとき） */ pierStyle?: ('brick' | 'concrete')[];
    /** 橋梁（groundFollowsTrack のコース）: 橋の下の地面を線路面より下げる量 [m]（両端 120m でならす）。水面もこの分だけ下がり、桁と水面の間が空く */ drop?: number }[];
  /** route.tracks の線の横位置の変化（キー = tracks の値の文字列。値は絶対の横位置）。複々線で対向線が外へずれる・駅で線路が開く */
  trackProfiles?: Record<string, LatProfile>;
  /** この範囲では追加の線路をすべて本線と一続きの床版・架線柱の範囲に含める（頭端駅の扇状の構内） */
  deckJoin?: { from: number; to: number }[];
  /** 描画・景観用の追加の線路 */
  extraTracks?: ExtraTrack[];
  /** 単線区間: route.tracks の線 track が、この範囲では他の線と同じ横位置に重なっているので、その線の線路面・枕木を描かない（trackProfiles で重ねる） */
  hiddenTracks?: { track: number; from: number; to: number }[];
  /** 景観（住宅・ビル・道路）を置かない範囲（s・横位置の矩形）。車庫・大型施設の敷地 */
  reserved?: { from: number; to: number; lat0: number; lat1: number; /** この範囲には高架の橋脚を立てない（下を他の線路が通る） */ noPiers?: boolean;
    /** 建物・木・駐車場は置かないが、OSM の道路は残す（高架の下を道路が通る。空港線・JR の高架） */ keepRoads?: boolean }[];
  /** 時間帯（ダイヤのパターン）。game/loop.ts が環境の時間帯から設定。未指定は昼 */
  timeOfDay?: TimeOfDay;
  /** 種別適用後: 自列車の走行線（ServiceSpec.lane。route/service.ts が設定） */
  activeLane?: LatProfile;
  /** 切土の擁壁（world/cuttings.ts）。side = 線路の左（-1）・右（+1）（下りの向きの横位置の符号）。offset = 外側の線路からの距離 [m]（既定 6.5）、height = 壁の高さ [m]（既定 4.5） */
  cuttings?: { from: number; to: number; side: -1 | 1; offset?: number; height?: number }[];
  /** 種別適用後: いま選んでいる種別（route/service.ts が設定。種別ごとに区間の一覧を変えるのに使う） */
  activeServiceId?: ServiceId;
  /** 和歌山方面へ向かう列車（対向列車・追い抜き）の種別ごとの行先 [名前, かな]。未指定の種別は route/service.ts の WAKAYAMA_DEST（普通は羽倉崎） */
  wakayamaDest?: Partial<Record<ServiceId, [string, string]>>;
  /** 全線通しとは別の始発・終着の区間（例: 急行・サザンの和歌山市行き）。from・to は駅 index。
   *  指定した種別でどちらも停車駅のときだけ有効。asAll なら全線通しの区間そのものをこの区間にし、無ければ全線通しの前に区間として加わる。
   *  上りの路線へは引き継がない（上りの路線データで指定する） */
  partialGoals?: { from: number; to: number; services: ServiceId[]; asAll?: boolean }[];
  /** false のとき、coastalLandmarks があっても遠景を沿岸（海・工業地帯）にしない。内陸のコースが鋼橋などの目印だけを使うとき */
  coastalScenery?: false;
  /** 鋼橋の塗色と形（throughGirder = 下路プレートガーダー: 線路の両脇に桁の側板が立つ。トラス区間 steel-bridge は除く） */
  bridgeStyle?: { color: number; throughGirder?: boolean };
  /** 複々線の駅（stations）でラッシュ時に足す対向の普通の走行線の横位置（trackProfiles のキー。緩行線） */
  oncomingLocal?: { stations: number[]; lat: number };
  /** 対向列車の同じ線の判定（world/oncoming-timetable.ts）: 横位置の基準が同じで、待避線・番線の経路を持たない列車は、線形の S字（合流部）で横位置が離れて見えても同じ線とみなす。
   *  既定は横位置の差だけで判定する。泉佐野の南の合流部（泉佐野〜みさき公園）で、同じ線の後続が横位置の差で別の線と判定される不具合を避ける */
  counterSameTrack?: boolean;
  /** 市街地（海・工業地帯の遠景を置かない） */
  urban?: boolean;
}
