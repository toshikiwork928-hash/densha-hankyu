# densha-hankyu

阪急神戸線（大阪梅田〜神戸三宮）の運転台視点ゲーム。南海版 `apps/densha-one-station` のエンジンを複製して作る。南海版のデータとはフォルダを分ける。

## 目的

南海版で作った走行・信号・ATS・採点・描画の仕組みを、別会社の路線データに差し替えて動かす。

## 状態

走行試作（2026-10-13）。線路・駅・高架・橋梁と、2000系（8両）1車種で走れる。作業計画は [docs/plan.md](./docs/plan.md)。

- コース: 大阪梅田〜西宮北口、西宮北口〜神戸三宮（各上下）。種別は普通だけ。
- 線形・勾配・橋・高架: OSM の線路の中心線と国土地理院の標高からの下書き（`npm run geometry:hankyu` → `npm run geometry:hankyu-slice`）。
- 駅の形・時刻表・2000系の性能は仮値。駅の照合、種別、対向列車、建物は未作成。
- 南海版から複製したエンジン。南海のコースのファイルは残っているが登録していない（後で削除）。

## 実行方法

```bash
cd apps/densha-hankyu
npm install
npm run dev   # http://localhost:8780
```

開発時 `?inspect=1&route=hankyu-kobe-east`（`-east-up`・`-west`・`-west-up`）で景観確認画面。

## 依存

南海版と同じ予定（Three.js + Vite + TypeScript）。

## 公開可否

公開。GitHub Pages: https://toshikiwork928-hash.github.io/densha-hankyu/ （公開用リポジトリ `toshikiwork928-hash/densha-hankyu` の main に、このフォルダの中身をルートとして置く。`.github/workflows/pages.yml` は公開側だけにある）。出典表示「© OpenStreetMap contributors（ODbL）」。
