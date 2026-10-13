// タイトル（ステージ・モード選択）・結果画面
import { notchName } from '../core/config';
import type { GameContext } from '../core/context';
import { $, fmtClock } from '../core/dom';
import { addHistory, getBest, getHistory, resetRecords, saveSelection, selectionForLine, submitScore } from '../game/ranking';
import { LINES, ROUTES, sectionOf, type LineEntry } from '../route';
import { lineOfRoute } from './lines';
import type { GameResult } from '../game/scoring';
import { safetyDeductions } from '../game/scoring';
import { MODE_LABEL, findStage, stagesOf, type GameMode } from '../game/state';
import { serviceOf, selectableServices, unitsLabel } from '../route/service';
import { playerVehicleOptions } from '../route/player-vehicles';
import type { ServiceSpec, TrainKind } from '../route/types';
import { createVehiclePreview } from './vehicle-preview';

/** 種別の説明（停車駅・編成） */
const svcDesc = (route: GameContext['route'], v: ServiceSpec) =>
  `${v.cars}両・${v.stops.length === route.stations.length ? '各駅に停車' : v.stops.length === 2 ? '途中駅すべて通過' : `${route.stations.filter((_, i) => !v.stops.includes(i)).map(x => x.name).join('・')} 通過`}`;

/** 車種の説明（選択画面用） */
const KIND_INFO: Record<TrainKind, { name: string; desc: string }> = {
  'commuter-new': { name: '8300系（新型通勤車）', desc: 'ステンレス・すそ絞り車体・VVVF。加速 3.0km/h/s' },
  'commuter-old': { name: '7100系（旧型通勤車）', desc: '鋼製・直線車体・抵抗制御。加速 2.5km/h/s、高速域は弱め' },
  'commuter-2300': { name: '2300系（山岳線用）', desc: '18m 車体・2両ユニット・VVVF。急勾配・急曲線向け' },
  'southern-10000': { name: '10000系（サザン座席指定車）', desc: '鋼製・1扉・リクライニング席。7100系と併結の抵抗制御' },
  'southern-12000': { name: '12000系（サザンプレミアム座席指定車）', desc: '指定席4両＋自由席4両。VVVF・営業最高110km/h' },
  'commuter-9000': { name: '9000系（更新VVVF車）', desc: '更新VVVF・急行／空港急行4+4固定' },
  limited: { name: '50000系（特急車）', desc: '流線形の先頭・定出力域が広く高速が得意' },
  // 以下は運転できない車種（対向列車などのモブ）。表を埋めるための項目
  'hankyu-2000': { name: '2000系', desc: '阪急の通勤車（8両・マルーン）' },
  'commuter-1000': { name: '1000系', desc: '本線の通勤車（6両）' },
  'commuter-2000': { name: '2000系', desc: '17m・2扉の通勤車' },
  'commuter-6300': { name: '6300系', desc: '高野線のステンレス通勤車' },
  'limited-30000': { name: '30000系（こうや）', desc: '高野線の特急車' },
};

const carsOfUnits = (u: number[]) => u.reduce((a, n) => a + n, 0);

const MODE_DESC: Record<GameMode, string> = {
  normal: '停止位置・定時・安全で採点',
  recovery: '遅れて発車。遅着に厳しい',
  timeOnly: '定時と安全のみ採点',
};

export function attachOverlay(ctx: GameContext): void {
  const { route, events } = ctx, st = ctx.state;
  const line = lineOfRoute(route.id);
  const overlay = $('overlay'), card = $('card');
  let lastResult: GameResult | null = null;
  let lastRecord: { isNew: boolean; prevTotal?: number } = { isNew: false };

  function bindGo() { $('go').onclick = () => ctx.actions.startOrRetry(); }

  // タイトルのタブ（再描画しても選択を保持）
  type Tab = 'stage' | 'car' | 'rec' | 'env' | 'sound' | 'keys';
  const TABS: [Tab, string][] = [['stage', '運転'], ['car', '車両'], ['rec', '記録'], ['env', '環境'], ['sound', '音'], ['keys', '操作']];
  let tab: Tab = 'stage';
  let gallery: ReturnType<typeof createVehiclePreview> | undefined;
  function showTab(t: Tab) {
    tab = t;
    card.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => { b.classList.toggle('on', b.dataset.tab === t); b.setAttribute('aria-selected', String(b.dataset.tab === t)); });
    card.querySelectorAll<HTMLElement>('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== t; });
    if (t === 'car') {
      const svc = serviceOf(route, st.sel.service);
      const host = card.querySelector<HTMLElement>('.vehicle-preview');
      if (svc && host) {
        gallery ??= createVehiclePreview(ctx);
        card.querySelectorAll<HTMLImageElement>('[data-face-kind]').forEach(img => { img.src = gallery!.faceIcon(img.dataset.faceKind as TrainKind); });
        gallery.mount(host, svc);
      }
    }
  }

  /** 路線の切替: 今の選択を路線ごとに保存し、切替先の前回の選択（無ければ既定）で再読込（線路・駅・景観を作り直す） */
  function switchLine(to: LineEntry) {
    saveSelection({ ...st.sel, routeId: route.id });
    const prevSel = selectionForLine(to.id);
    const routeId = prevSel?.routeId && to.dirs.some(d => d.id === prevSel.routeId) ? prevSel.routeId : to.dirs[0].id;
    const r = ROUTES[routeId];
    saveSelection(prevSel ? { ...prevSel, routeId } : {
      stageId: '', mode: st.sel.mode, vehicles: {}, routeId,
      service: r?.services?.find(v => v.id === 'express')?.id ?? r?.services?.[0]?.id ?? 'local',
    });
    card.innerHTML = `<p class="brief" style="text-align:center">${to.name}を読み込み中…</p>`;
    location.reload();
  }

  function showTitle() {
    const ready = ctx.assetsReady;
    const stage = findStage(route, st.sel.stageId);
    const first = route.stations[stage.from], last = route.stations[stage.to];
    const passes = route.stations.filter((x, i) => x.pass && i > stage.from && i < stage.to).map(x => x.name);
    const stops = route.stations.filter((x, i) => !x.pass && i > stage.from && i < stage.to).map(x => x.name);
    const lims = route.limits.filter(L => L.from > first.stopS && L.from < last.stopS);
    const notes = [
      lims.length ? `制限 ${[...new Set(lims.map(L => L.kmh))].join('・')}km/h` : '',
      stops.length ? `途中停車 ${stops.join('・')}` : '',
      passes.length ? `<b>${passes.join('・')} は通過</b>` : '',
    ].filter(Boolean).join('、');
    const best = getBest(route.id, stage.id, st.sel.mode, st.sel.service);
    const svc = serviceOf(route, st.sel.service), section = sectionOf(route.id);
    const svcs = selectableServices(route).map(v => `<button data-service="${v.id}" class="svc-${v.id} ${v.id === svc?.id ? 'on' : ''}">${v.name}<small>${svcDesc(route, v)}</small></button>`).join('');
    const wait = svc?.waits?.filter(w => w.station > stage.from && w.station < stage.to)
      .map(w => { const p = serviceOf(route, w.passedBy); return `<b>${route.stations[w.station].name}で${p?.name ?? ''}の${p?.stops.includes(w.station) ? '待ち合わせ' : '通過待ち'}</b>（出発信号が進行になってから発車）`; }).join('、') ?? '';
    const stages = stagesOf(route).map(s => `<button data-stage="${s.id}" class="${s.id === stage.id ? 'on' : ''}">${s.id === 'all' ? '全線通し' : s.label}${s.id === 'all' ? `<small>${route.stations[s.from].name} → ${route.stations[s.to].name}</small>` : ''}</button>`).join('');
    const modes = (Object.keys(MODE_LABEL) as GameMode[]).map(m => `<button data-mode="${m}" class="${m === st.sel.mode ? 'on' : ''}">${MODE_LABEL[m]}<small>${MODE_DESC[m]}</small></button>`).join('');
    overlay.classList.remove('hidden');
    card.innerHTML = `
    <h1>${line.name} 運転シミュレーター<small>運転台視点の電車運転ゲーム / Three.js</small></h1>
    <div class="lines" role="radiogroup" aria-label="路線">${LINES.map(l => `<button type="button" role="radio" aria-checked="${l.id === line.id}" data-line="${l.id}" class="line-${l.theme} ${l.id === line.id ? 'on' : ''}"><b>${l.name}</b><small>${l.desc}</small></button>`).join('')}</div>
    <div class="route"><span>${first.name}</span><span class="bar"></span><span>${last.name}</span></div>
    <div class="tabs" role="tablist">${TABS.map(([k, n]) => `<button type="button" role="tab" data-tab="${k}">${n}</button>`).join('')}</div>
    <div class="tabPane" data-pane="stage">
      ${line.sections ? `<div class="selLbl">区間</div><div class="sel" id="selSection">${line.sections.map(x => `<button data-section="${x.id}" class="${x.id === section?.id ? 'on' : ''}">${x.name}<small>${x.desc}</small></button>`).join('')}</div>` : ''}
      <div class="selLbl">方向</div><div class="sel" id="selDir">${(section?.dirs ?? line.dirs).map(d => `<button data-dir="${d.id}" class="${d.id === route.id ? 'on' : ''}">${d.label}<small>${d.desc}</small></button>`).join('')}</div>
      ${svcs ? `<div class="selLbl">種別（Tab）</div><div class="sel" id="selService">${svcs}</div>` : ''}
      <div class="selLbl">ステージ（← →）</div><div class="sel" id="selStage">${stages}</div>
      <div class="selLbl">モード（↑ ↓）</div><div class="sel" id="selMode">${modes}</div>
      <p class="brief">${first.name}を定刻に発車し、${last.name}の<b>停止位置ピッタリ</b>に<b>定刻どおり</b>止めよう。${notes ? notes + '。' : ''}${wait ? wait + '。' : ''}信号（YG 65 / Y 45 / R 停止）に従うこと。</p>
      <div class="best">${best ? `自己ベスト ${best.total}点（${best.rank}）${best.date}` : '自己ベスト なし'}</div>
    </div>
    <div class="tabPane" data-pane="car" hidden>${vehiclePane(svc)}</div>
    <div class="tabPane" data-pane="rec" hidden>${recordPane()}</div>
    <div class="tabPane" data-pane="env" hidden></div>
    <div class="tabPane" data-pane="sound" hidden></div>
    <div class="tabPane" data-pane="keys" hidden>
      <table class="keys">
        <tr><td><kbd>↑</kbd> <kbd>W</kbd> / <kbd>↓</kbd> <kbd>S</kbd></td><td>力行側 / ブレーキ側へ1段</td></tr>
        <tr><td><kbd>Tab</kbd> / <kbd>← →</kbd> / <kbd>↑ ↓</kbd></td><td>タイトルで 種別 / ステージ / モード</td></tr>
        <tr><td>マウスのホイール / 中ボタン</td><td>奥へ回すと力行側、手前へ回すとブレーキ側へ1段 / ノッチオフ（運転中）</td></tr>
        <tr><td><kbd>N</kbd> / <kbd>Space</kbd></td><td>ノッチオフ / 非常ブレーキ（減点）</td></tr>
        <tr><td><kbd>A</kbd></td><td>ATS 確認（B4 以上で）</td></tr>
        <tr><td><kbd>H</kbd> / <kbd>V</kbd></td><td>警笛（長押し） / 視点切替</td></tr>
        <tr><td><kbd>X</kbd> / <kbd>M</kbd></td><td>ワイパー / 消音</td></tr>
        <tr><td><kbd>Shift</kbd>+<kbd>T</kbd> <kbd>Y</kbd> <kbd>Q</kbd></td><td>時間帯 / 天候 / 画質</td></tr>
        <tr><td><kbd>Esc</kbd> / <kbd>P</kbd></td><td>運転・停車中に一時停止 / 再開（画面右上のボタン、ゲームパッド Start でも可）</td></tr>
        <tr><td><kbd>R</kbd> / <kbd>Esc</kbd></td><td>結果画面でリプレイ / タイトルへ</td></tr>
      </table>
      <p class="sub">途中駅はドアが閉まったら力行で発車。ゲームパッド対応（L3 でレバーモード）。タッチ端末は画面右下のボタン。</p>
    </div>
    <div id="titleExtra" hidden></div>
    <button class="btn" id="go" ${ready ? '' : 'disabled'}>${ready ? '出発（Enter）' : '3D素材を読み込み中…'}</button>
    <p class="sub credit">3D素材: Kenney / Quaternius（CC0）。店名・塗装は架空。実在の路線・駅を参考にした概形</p>`;
    bindGo();
    card.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.onclick = () => { showTab(b.dataset.tab as Tab); b.blur(); });
    card.querySelectorAll<HTMLButtonElement>('[data-stage]').forEach(b => b.onclick = () => {
      const list = stagesOf(route), cur = list.findIndex(s => s.id === st.sel.stageId), to = list.findIndex(s => s.id === b.dataset.stage);
      ctx.actions.selectStage(to - cur);
    });
    card.querySelectorAll<HTMLButtonElement>('[data-service]').forEach(b => b.onclick = () => {
      const list = selectableServices(route), cur = list.findIndex(v => v.id === st.sel.service), to = list.findIndex(v => v.id === b.dataset.service);
      ctx.actions.selectService(to - cur);
    });
    card.querySelectorAll<HTMLButtonElement>('[data-line]').forEach(b => b.onclick = () => {
      const to = LINES.find(l => l.id === b.dataset.line);
      if (to && to.id !== line.id) switchLine(to);
    });
    // 区間の切替: 同じ名前の方向（上り/下り）があればそれ、無ければ区間の既定の方向で再読込
    card.querySelectorAll<HTMLButtonElement>('[data-section]').forEach(b => b.onclick = () => {
      const to = line.sections?.find(x => x.id === b.dataset.section);
      if (!to || to.id === section?.id) return;
      const cur = (section?.dirs ?? line.dirs).find(d => d.id === route.id);
      const dir = to.dirs.find(d => d.label === cur?.label) ?? to.dirs[0];
      saveSelection({ ...st.sel, stageId: '', routeId: dir.id });
      card.innerHTML = `<p class="brief" style="text-align:center">${to.name}を読み込み中…</p>`;
      location.reload();
    });
    card.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach(b => b.onclick = () => {
      if (b.dataset.dir === route.id) return;
      // 方向が変わると線路・駅・景観を作り直すので再読込（種別・車両・モードは引き継ぐ）
      saveSelection({ ...st.sel, stageId: '', routeId: b.dataset.dir });
      card.innerHTML = '<p class="brief" style="text-align:center">路線を読み込み中…</p>';
      location.reload();
    });
    card.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(b => b.onclick = () => ctx.actions.selectVehicle({ kind: b.dataset.kind as TrainKind }));
    card.querySelectorAll<HTMLButtonElement>('[data-free-kind]').forEach(b => b.onclick = () => ctx.actions.selectVehicle({ freeKind: b.dataset.freeKind as TrainKind }));
    card.querySelectorAll<HTMLButtonElement>('[data-units]').forEach(b => b.onclick = () => ctx.actions.selectVehicle({ units: b.dataset.units!.split('+').map(Number) }));
    const rb = card.querySelector<HTMLButtonElement>('#resetRec');
    if (rb) rb.onclick = () => { if (confirm('自己ベストとプレイ履歴をすべて消します。よろしいですか？')) { resetRecords(); showTitle(); } };
    card.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.onclick = () => {
      const list = Object.keys(MODE_LABEL), cur = list.indexOf(st.sel.mode), to = list.indexOf(b.dataset.mode!);
      ctx.actions.selectMode(to - cur);
    });
    // 他モジュールの設定 UI を受け取り、各タブへ振り分ける
    const extra = $('titleExtra');
    events.emit('titleRender', { container: extra });
    const pane = (k: Tab) => card.querySelector<HTMLElement>(`[data-pane="${k}"]`)!;
    extra.querySelectorAll('.env-panel').forEach(e => pane('env').appendChild(e));
    extra.querySelectorAll('.audio-settings').forEach(e => pane('sound').appendChild(e));
    while (extra.firstChild) pane('stage').appendChild(extra.firstChild);
    showTab(tab);
  }

  /** 車両タブ: 選択中の種別の車種・両数 */
  function vehiclePane(svc: ServiceSpec | undefined): string {
    if (!svc) return '<p class="sub">この路線は車両を選べません。</p>';
    const saved = st.sel.vehicles[svc.id], opt = playerVehicleOptions(svc);
    const seat = svc.id === 'southern' ? (saved?.kind === 'southern-12000' || saved?.kind === 'southern-10000' ? saved.kind : svc.unitKinds?.find(k => k === 'southern-12000' || k === 'southern-10000') ?? 'southern-10000') : undefined;
    const free = svc.id === 'southern' ? (svc.unitKinds?.find(k => k !== 'southern-10000' && k !== 'southern-12000') ?? 'commuter-old') : undefined;
    const kinds = opt.kinds, forms = opt.formations;
    const kb = kinds.map(k => `<button data-kind="${k}" class="vehicle-choice ${k === (seat ?? svc.kind) ? 'on' : ''}" aria-pressed="${k === (seat ?? svc.kind)}"><img class="vehicle-face" data-face-kind="${k}" alt="${KIND_INFO[k].name}の正面" width="64" height="64"><span>${KIND_INFO[k].name}<small>${KIND_INFO[k].desc}</small></span></button>`).join('');
    const fb = svc.id === 'southern' ? `<div class="selLbl">自由席車（難波方）</div><div class="sel col">${opt.freeKinds!.map(k => `<button data-free-kind="${k}" class="vehicle-choice ${k === free ? 'on' : ''}" aria-pressed="${k === free}"><img class="vehicle-face" data-face-kind="${k}" alt="${KIND_INFO[k].name}の正面" width="64" height="64"><span>${KIND_INFO[k].name}</span></button>`).join('')}</div>` : '';
    const formLabel = (u: number[]) => `${carsOfUnits(u)}両${u.length > 1 ? `<small>${unitsLabel(u)}（${u.length}編成を連結）</small>` : ''}`;
    const cb = forms.map(u => `<button data-units="${u.join('+')}" class="${u.join('+') === svc.units.join('+') ? 'on' : ''}" ${forms.length < 2 ? 'disabled' : ''}>${formLabel(u)}</button>`).join('');
    return `<div class="selLbl"><span class="svcBadge svc-${svc.id}">${svc.id === 'southern' && seat === 'southern-12000' ? 'サザンプレミアム' : svc.name}</span> の車両</div>
      <div class="sel col" id="selKind">${kb}</div>
      ${fb}
      <div class="vehicle-preview"></div>
      <div class="selLbl">編成${forms.length < 2 ? '（固定）' : ''}</div><div class="sel" id="selCars">${cb}</div>
      <p class="sub">${svc.cars}両編成${svc.units.length > 1 ? `（${svc.unitKinds ? svc.units.map((n, i) => `${KIND_INFO[svc.unitKinds![i] ?? svc.kind].name.replace(/（.*/, '')}${n}両`).join(' + ') : svc.units.map(n => n + '両').join(' + ')}を連結）` : ''}。駅では「${svc.cars >= 8 ? '6・8' : svc.cars}両」の停止位置目標に先頭を合わせる。</p>`;
  }

  /** 記録タブ: 自己ベスト（種別×区間）と最近のプレイ */
  function recordPane(): string {
    const svcs = route.services ?? [];
    const rows: string[] = [];
    for (const v of svcs) for (const sg of stagesOfService(v.id)) {
      const b = getBest(route.id, sg.id, st.sel.mode, v.id);
      rows.push(`<tr><td><span class="svcBadge svc-${v.id}">${v.name}</span></td><td>${sg.id === 'all' ? '全線通し' : sg.label}</td><td>${b ? `${b.total}点 ${b.rank}` : '-'}</td></tr>`);
    }
    const hist = getHistory(route.id).slice(0, 20).map(h => {
      const v = svcs.find(x => x.id === h.service), d = new Date(h.at);
      const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const sg = stagesOfService(h.service).find(x => x.id === h.stageId);
      return `<tr><td>${when}</td><td>${v ? `<span class="svcBadge svc-${v.id}">${v.name}</span>` : ''} ${h.cars ?? ''}${h.cars ? '両' : ''}</td><td>${sg ? (sg.id === 'all' ? '全線' : sg.label) : h.stageId}</td><td>${h.result === 'overrun' ? '失格' : `${h.total}点 ${h.rank}`}</td></tr>`;
    }).join('');
    return `<div class="selLbl">自己ベスト（${MODE_LABEL[st.sel.mode]}モード）</div>
      <table class="res rec">${rows.join('')}</table>
      <div class="selLbl">最近のプレイ</div>
      ${hist ? `<table class="res rec">${hist}</table>` : '<p class="sub">まだ記録がありません。</p>'}
      <button class="btn sub2" id="resetRec">記録をリセット</button>`;
  }

  /** 種別ごとのステージ一覧（route は選択中の種別で書き換わっているので停車駅から作り直す） */
  function stagesOfService(id: string | undefined) {
    const v = route.services?.find(x => x.id === id);
    if (!v) return stagesOf(route);
    const idx = v.stops, list = [];
    for (let k = 0; k < idx.length - 1; k++) list.push({ id: `${idx[k]}-${idx[k + 1]}`, label: `${route.stations[idx[k]].name} → ${route.stations[idx[k + 1]].name}` });
    if (idx.length > 2) {
      const goals = (route.partialGoals ?? []).filter(g => g.services.includes(v.id) && idx.includes(g.from) && idx.includes(g.to) && g.from < g.to);
      const whole = goals.find(g => g.asAll), a = whole?.from ?? idx[0], b = whole?.to ?? idx[idx.length - 1];
      for (const g of goals) {
        if (!g.asAll && !(g.from === a && g.to === b))
          list.push({ id: `${g.from}-${g.to}`, label: `${route.stations[g.from].name} → ${route.stations[g.to].name}` });
      }
      list.push({ id: 'all', label: '全線通し' });
    }
    return list;
  }

  function showResult(r: GameResult) {
    lastResult = r;
    const j = r.last, err = j.err, delay = j.delay;
    let note = '';
    if (r.kind === 'overrun') note = '<div class="pitari" style="color:#ff7a6a">オーバーラン！</div>';
    else if (Math.abs(err) <= .3) note = '<div class="pitari">停止位置ピッタリ！</div>';
    else if (err < -15) note = '<div class="pitari" style="color:#ffb02e">停止位置まで届かず…</div>';
    if (lastRecord.isNew) note += '<div class="pitari">自己ベスト更新！</div>';
    const stage = findStage(route, r.stageId);
    const sta = route.stations[j.index];
    const sgn = (x: number, d = 1) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;
    const errTxt = `${sgn(err, 2)} m（${err >= 0 ? '行き過ぎ' : '手前'}）`;
    // 駅ごとの表（停車・通過を駅順に）
    const rows = [
      ...r.stops.map(s => ({ i: s.index, html: `<tr><td>${route.stations[s.index].name}</td><td>${s.kind === 'overrun' ? 'オーバーラン' : `${sgn(s.err, 2)}m`}</td><td>${sgn(s.delay)}秒</td><td>${Math.round(s.stopPts + s.timePts)}</td></tr>` })),
      ...r.passes.map(p => ({ i: p.index, html: `<tr><td>${route.stations[p.index].name}</td><td>${p.wrongStop ? '<span style="color:#ff7a6a">誤停車</span>' : '通過'}</td><td>${sgn(p.delay)}秒</td><td>-</td></tr>` })),
    ].sort((a, b) => a.i - b.i).map(x => x.html).join('');
    const ded = safetyDeductions(st).map(d => `${d.label} -${Math.round(d.pts)}`).join(' / ') || 'なし';
    const best = getBest(route.id, r.stageId, r.mode, r.service);
    const svcName = route.services ? `${serviceOf(route, r.service)?.name ?? ''}・` : '';
    overlay.classList.remove('hidden');
    card.innerHTML = `
    <h1>${r.kind === 'overrun' ? '失格' : `${sta.name} 到着`}<small>${svcName}${stage.id === 'all' ? '全線通し' : stage.label}・${MODE_LABEL[r.mode]}モード</small></h1>
    <div class="rank ${r.rank}">${r.rank}</div>${note}
    <table class="res">
      <tr><td>停止位置誤差</td><td>${errTxt}</td></tr>
      <tr><td>到着時刻（定刻比）</td><td>${fmtClock(route.startClock + j.t)}（${sgn(delay)} 秒）</td></tr>
      <tr><td>速度超過時間</td><td>${r.overspeed.toFixed(1)} 秒</td></tr>
      <tr><td>非常ブレーキ使用</td><td>${r.eb ? 'あり' : 'なし'}</td></tr>
      <tr><td>停車時の衝動</td><td>${j.jolt ? `あり（${notchName(j.notchAtStop)}で停車）` : 'なし'}</td></tr>
      <tr><td>停止 / 定時 / 安全</td><td>${Math.round(r.stopPts)}/${r.max.stop} · ${Math.round(r.timePts)}/${r.max.time} · ${Math.round(r.safePts)}/${r.max.safe}</td></tr>
    </table>
    ${r.stops.length + r.passes.length > 1 ? `<table class="res st"><tr><td>駅</td><td>停止位置</td><td>定刻比</td><td>点</td></tr>${rows}</table>` : ''}
    <p class="sub">安全減点: ${ded}</p>
    <div class="total">${r.total} 点</div>
    <div class="best">${best ? `自己ベスト ${best.total}点（${best.rank}）` : ''}</div>
    <button class="btn" id="go">もう一度（Enter）</button>
    <div class="btnRow"><button class="btn sub2" id="replayBtn">リプレイ（R）</button><button class="btn sub2" id="titleBtn">タイトルへ（Esc）</button></div>`;
    bindGo();
    $('replayBtn').onclick = () => ctx.actions.toggleReplay();
    $('titleBtn').onclick = () => ctx.actions.toTitle();
  }

  showTitle();
  events.on('assetsProgress', ({ done, total }) => {
    const b = document.getElementById('go');
    if (b && !ctx.assetsReady) b.textContent = `3D素材を読み込み中… ${done}/${total}`;
  });
  events.on('assetsReady', () => { if (st.state === 'title') showTitle(); });
  events.on('reset', () => { if (st.state === 'title') showTitle(); });
  events.on('stateChange', ({ to }) => { if (to === 'run' || to === 'dwell') overlay.classList.add('hidden'); });
  events.on('result', r => {
    const rec = r.kind === 'stop' ? submitScore(route.id, r.stageId, r.mode, r.total, r.rank, r.service) : { isNew: false };
    addHistory(route.id, {
      at: new Date().toISOString(), service: r.service, kind: ctx.service?.kind, cars: ctx.service?.cars, stageId: r.stageId, mode: r.mode,
      result: r.kind, total: r.total, rank: r.rank, err: r.last.err, delay: r.last.delay,
    });
    lastRecord = { isNew: rec.isNew };
    showResult(r);
  });
  // リプレイ中は結果カードを隠し、終わったら戻す
  events.on('cameraMode', ({ mode }) => {
    if (st.state !== 'result' || !lastResult) return;
    if (mode === 'replay') overlay.classList.add('hidden');
    else { lastRecord = { isNew: false }; showResult(lastResult); }
  });
}
