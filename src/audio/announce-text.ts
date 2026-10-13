// 車掌放送の文面。DOM・音声に依存しない純関数（読み上げは audio/announce.ts）。
// 駅名は読み間違いを避けるため、かな（カタカナに直して）で渡す
import type { Route, ServiceSpec, Station } from '../route/types';
import { sameClass, serviceOf } from '../route/service';

/** ひらがなをカタカナへ（音声エンジンの漢字辞書・分かち書きに頼らない） */
export const toKatakana = (s: string): string => s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
/** 読み上げ用の駅名 */
export const spoken = (s: Station): string => toKatakana(s.kana ?? s.name);

/** 路線の終点か（列車の本来の行先がコースの終点と違う＝なんば・和歌山市・羽倉崎など、のときは終点ではない） */
export const isTerminus = (route: Route, index: number, svc?: ServiceSpec): boolean =>
  index === route.stations.length - 1 && (!svc?.destination || svc.destination === route.stations[index].name);

/** 読み上げ用の行先（列車の本来の行先、無ければコースの終点） */
const spokenDest = (route: Route, svc?: ServiceSpec): string =>
  svc?.destination ? toKatakana(svc.destinationKana ?? svc.destination) : spoken(route.stations[route.stations.length - 1]);

/** 始発駅の発車後の行先案内。サザンは「一部座席指定」、行先のある優等列車は種別も言う */
function destText(route: Route, svc?: ServiceSpec): string {
  const dest = spokenDest(route, svc);
  if (svc?.id === 'southern') return `この電車は、一部座席指定、特急サザン${dest}行きです。`;
  if (svc?.destination) return `この電車は、${svc.name}、${dest}行きです。`;
  return `この電車は、${dest}行きです。`;
}

/** index より後の最初の停車駅 */
function nextStop(route: Route, index: number): { sta: Station; index: number } | null {
  for (let i = index + 1; i < route.stations.length; i++) if (!route.stations[i].pass) return { sta: route.stations[i], index: i };
  return null;
}

/** 発車後の放送。始発駅の発車直後のみ挨拶と行先、待避後の発車は最初に「お待たせしました」 */
export function departText(route: Route, index: number, afterWait: boolean, svc?: ServiceSpec): string {
  const parts: string[] = [];
  if (afterWait) parts.push('お待たせしました。');
  if (index === 0) parts.push(`ご乗車ありがとうございます。${destText(route, svc)}`);
  const nx = nextStop(route, index);
  if (nx) parts.push(nx.index === index + 1 ? `次は、${spoken(nx.sta)}、${spoken(nx.sta)}です。` : `次は、${spoken(nx.sta)}に停まります。`);
  return parts.join('');
}

/** 乗り換え案内（到着前の放送）。towardNamba = なんば方面の列車。固有名詞は読み間違いを避けてカタカナ */
const TRANSFERS: Record<string, (towardNamba: boolean) => string> = {
  新今宮: () => 'JR線はお乗り換えです。',
  天下茶屋: n => n ? 'コウヤ線、地下鉄サカイスジ線、阪急キョウト・キタセンリ方面はお乗り換えください。' : '地下鉄サカイスジ線、阪急キョウト・キタセンリ方面はお乗り換えください。',
  羽衣: () => 'タカシノハマ線はお乗り換えください。',
};
export function transferPhrase(route: Route, index: number, svc?: ServiceSpec): string {
  const f = TRANSFERS[route.stations[index].name];
  if (!f) return '';
  const dest = svc?.destination ?? route.stations[route.stations.length - 1].name;
  return f(dest === 'なんば' || dest === '難波');
}

/** 駅の手前（800m）の放送。終点の手前は御礼を添える。普通が待避する駅では、到着前にも待ち合わせ・通過待ちを案内する */
export function approachText(route: Route, index: number, svc?: ServiceSpec): string {
  const sta = route.stations[index], side = sta.platform.side === 'L' ? '左' : '右';
  const tr = sta.enterLoop ? sta.loopTrack : sta.mainTrack, track = tr ? `${tr}に到着します。` : '';
  const wait = waitPhrase(route, svc, index).replace(/^当駅で/, `${spoken(sta)}で`), tr2 = transferPhrase(route, index, svc);
  if (isTerminus(route, index, svc)) return `本日もご乗車いただきありがとうございました。まもなく終点、${spoken(sta)}、${track}お出口は${side}側です。${tr2}${wait}`;
  return `まもなく、${spoken(sta)}、${track}お出口は${side}側です。${tr2}${wait}`;
}

/** 普通がこの駅で優等列車を待つときの放送（待ち合わせ = 優等列車が停車、通過待ち = 通過。複数なら並べた順に「〜の通過待ちと〜の待ち合わせ」）。
 *  コースの終着駅は待ち合わせとして案内する（ゲームは着いたところで終わる） */
export function waitPhrase(route: Route, svc: ServiceSpec | undefined, index: number): string {
  const list = (svc?.waits ?? []).filter(x => x.station === index).map(w => serviceOf(route, w.passedBy)).filter((x): x is ServiceSpec => !!x);
  if (!list.length) return '';
  const last = index === route.stations.length - 1;
  const passes = list.filter(p => !last && !p.stops.includes(index)).map(p => p.name), meets = list.filter(p => last || p.stops.includes(index)).map(p => p.name);
  const parts = [passes.length ? `${passes.join('と')}の通過待ち` : '', meets.length ? `${meets.join('と')}の待ち合わせ` : ''].filter(Boolean);
  return `当駅で${parts.join('と')}をします。`;
}

/** 急行・特急が、普通が待ち合わせている駅（自分を待っている）に停車するとき: 乗り換え案内。追い越すだけの駅では言わない */
export function connectPhrase(route: Route, svc: ServiceSpec | undefined, index: number): string {
  const local = serviceOf(route, 'local');
  if (!svc || svc.id === 'local' || !svc.stops.includes(index)) return '';
  return local?.waits?.some(w => w.station === index && sameClass(w.passedBy, svc.id)) ? '当駅で普通車にお乗り換えになれます。' : '';
}

/** 到着後の放送（駅名のあとに待避・乗り換え案内）。番線は到着前の放送で案内済みなので言わない */
export function arriveText(route: Route, svc: ServiceSpec | undefined, index: number): string {
  const sta = route.stations[index];
  return `${spoken(sta)}、${spoken(sta)}です。${waitPhrase(route, svc, index)}${connectPhrase(route, svc, index)}`;
}
