// 海岸線のデータ（OSM の natural=coastline など、scripts/osm-scenery.ts が作る data.coast）の型と、海の内外の判定。
// 座標はコースの s（線路に沿った距離）・lat（横位置。進行方向の右が正）。描画は coast.ts、建物・木・道路の判定は osm-town.ts が使う。

export interface CoastData {
  /** 海の多角形 [[外周 s,lat の並び, 島の穴の並び…], …]。外周は反時計回り */
  sea: number[][][];
  /** 海岸線 [s,lat の並び]。進行方向に対して左が海（上りでは lat の小さい側）、右が陸 */
  lines: number[][];
  /** 砂浜の多角形 [s,lat の並び] */
  beach: number[][];
  /** 防波堤(b)・桟橋(p) [種類, 閉じた輪か(0/1), s,lat の並び] */
  works: [string, number, number[]][];
}

export interface SeaMask {
  /** (s, lat) の周り margin [m] 以内に海があるか（margin 0 = その点が海の中か） */
  inSea(s: number, lat: number, margin?: number): boolean;
}

interface Poly { s0: number; s1: number; l0: number; l1: number; outer: number[]; holes: number[][] }

const pip = (pts: number[], ps: number, pl: number) => {
  let c = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const si = pts[i], li = pts[i + 1], sj = pts[j], lj = pts[j + 1];
    if ((li > pl) !== (lj > pl) && ps < (sj - si) * (pl - li) / (lj - li) + si) c = !c;
  }
  return c;
};

const cache = new WeakMap<CoastData, SeaMask>();

/** 海の内外の判定（外周の内側で、島の穴の外側）。coast が無ければ null */
export function seaMaskOf(coast: CoastData | undefined | null): SeaMask | null {
  if (!coast || !coast.sea.length) return null;
  let m = cache.get(coast);
  if (m) return m;
  const polys: Poly[] = coast.sea.map(rings => {
    const outer = rings[0];
    let s0 = Infinity, s1 = -Infinity, l0 = Infinity, l1 = -Infinity;
    for (let i = 0; i < outer.length; i += 2) { s0 = Math.min(s0, outer[i]); s1 = Math.max(s1, outer[i]); l0 = Math.min(l0, outer[i + 1]); l1 = Math.max(l1, outer[i + 1]); }
    return { s0, s1, l0, l1, outer, holes: rings.slice(1) };
  });
  const at = (s: number, l: number) => polys.some(p => s >= p.s0 && s <= p.s1 && l >= p.l0 && l <= p.l1 && pip(p.outer, s, l) && !p.holes.some(h => pip(h, s, l)));
  m = {
    inSea: (s, l, margin = 0) => {
      if (at(s, l)) return true;
      if (margin <= 0) return false;
      return at(s - margin, l) || at(s + margin, l) || at(s, l - margin) || at(s, l + margin);
    },
  };
  cache.set(coast, m);
  return m;
}
