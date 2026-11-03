# densha-hankyu

阪急神戸線（大阪梅田〜神戸三宮）の運転台視点ゲーム。南海版 `apps/densha-one-station` のエンジンを複製して作る。南海版のデータとはフォルダを分ける。

## 目的

南海版で作った走行・信号・ATS・採点・描画の仕組みを、別会社の路線データに差し替えて動かす。

## 状態

遊べる試作（2026-11-03）。作業計画と進捗は [docs/plan.md](./docs/plan.md)、駅の照合表は [docs/spec-stations.md](./docs/spec-stations.md)。

- コース: 大阪梅田〜西宮北口（8駅・15.6km）、西宮北口〜神戸三宮（9駅・16.7km）。各上下。
- 種別: 普通・特急、梅田〜西宮北口は通勤特急・快速、西宮北口〜三宮は準特急。車両は2000系（8両）。性能は仮値。
- 時刻表: 自動運転の最速 +5%（`npm run timetable:hankyu`）。停車25秒はゲーム用。
- 対向列車（離合）: 各方向に特急と普通が10分ごとの規則ダイヤ（実ダイヤではない）。
- 駅: 全16駅を配線略図と Wikipedia で照合。大阪梅田は屋内の頭端式9線、十三は4面6線、中津は狭い島式、西宮北口の今津線・西宮車庫、塚口の伊丹線、夙川の甲陽線、六甲の通過線。
- 線形・勾配・橋・高架: OSM の線路の中心線と国土地理院の標高からの下書き（`npm run geometry:hankyu` → `npm run geometry:hankyu-slice`）。
- 沿線: OSM の建物・道路・水面（全線。`npm run osm:hankyu` で再生成）。梅田〜十三の宝塚線・京都線、三宮付近の JR の線路（描画だけ）。目印の建物（HEP FIVE の観覧車、梅田スカイビル、グランフロント、王子動物園の観覧車、神戸三宮阪急ビルなど。形は概形）。
- Three.js r186。
- 南海版から複製したエンジン（走行・信号・ATS・採点・描画・音）。南海のコース・沿線データ・専用の景観は削除済み（2026-11-03）。

## 実行方法

```bash
cd apps/densha-hankyu
npm install
npm run dev   # http://localhost:8780
```

開発時 `?inspect=1&route=hankyu-kobe-east`（`-east-up`・`-west`・`-west-up`）で景観確認画面。

## 依存

Three.js（0.186）+ Vite + TypeScript。

## 公開可否

公開。GitHub Pages: https://toshikiwork928-hash.github.io/densha-hankyu/ （公開用リポジトリ `toshikiwork928-hash/densha-hankyu` の main に、このフォルダの中身をルートとして置く。`.github/workflows/pages.yml` は公開側だけにある）。出典表示「© OpenStreetMap contributors（ODbL）」。
