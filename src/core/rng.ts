// 再現性のある疑似乱数（Park–Miller）。呼び出し順で配置が決まるため、生成順を変えると景色が変わる
export type Rng = () => number;

export function createRng(seed = 12345): Rng {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
