// HUD（時計・制限速度・距離・ノッチ表示・バナー・信号/ATS・戸閉・時刻表）
import { NOTCH_EB, NOTCH_MAX, NOTCH_MIN, OVERSPEED_MARGIN, notchName } from '../core/config';
import type { GameContext } from '../core/context';
import { $, fmtClock } from '../core/dom';
import { ASPECT_LABEL, ASPECT_LIMIT } from '../game/preceding';
import { departureTime } from '../game/state';
import { destOf, serviceOf, unitsLabel } from '../route/service';
import { drawMeter } from './meter';
import { terminalSpeedLimit } from '../game/terminal-ats';

const fmtHM = (sec: number) => fmtClock(sec);

export function attachHud(ctx: GameContext): void {
  const { route, events, track } = ctx, st = ctx.state;
  const mctx = $<HTMLCanvasElement>('meter').getContext('2d')!;
  const el = {
    clock: $('clock'), sched: $('sched'), delay: $('delay'), limit: $('limit'), limitPanel: $('limitPanel'),
    nextLimit: $('nextLimit'), dist: $('dist'), distPanel: $('distPanel'), nextSta: $('nextSta'), banner: $('banner'), notches: $('notches'),
  };
  const distLbl = $('distPanel').querySelector<HTMLElement>('.lbl');
  // 「定刻 … 着」の「着」を停車中は「発」に切り替える
  const schedTail = el.sched.nextSibling;
  /** 停車中（始発・途中駅）は発車時刻が基準 */
  const dwelling = () => st.state === 'dwell' && st.target >= 0 && st.target !== st.endIndex;

  // 追加パネル（信号・ATS・戸閉・時刻表）。index.html は触らずここで生成
  const side = document.createElement('div');
  side.id = 'sidePanel';
  side.innerHTML = `
    <div class="panel sp-svc" id="svcPanel"></div>
    <div class="panel sp-sig"><div class="lbl">次の信号</div>
      <div class="sigRow"><div class="sigLamps"><i class="l-g"></i><i class="l-y1"></i><i class="l-r"></i><i class="l-y2"></i></div>
      <div><div id="sigTxt">-</div><div class="sub" id="sigDist">&nbsp;</div></div></div>
      <div id="atsLine" class="ats-ok">ATS 正常</div>
    </div>
    <div class="panel sp-door"><span id="doorLamp" class="doorLamp on">戸閉</span><span id="doorTxt" class="sub"></span></div>
    <div class="panel sp-tt"><div class="lbl">時刻表</div><table id="ttTable"></table></div>
    <div id="replayTag">REPLAY</div>`;
  $('hud').appendChild(side);
  // PC 幅（styles.css と同じ条件）では制限速度パネルを左の信号パネルの直下へ移す。それ以外は右上のまま
  const limitBox = el.limitPanel, topRight = $('topRight'), sigBox = side.querySelector('.sp-sig')!;
  const pcMq = window.matchMedia('(min-width: 900px) and (min-height: 600px) and (any-pointer: fine)');
  const placeLimit = () => {
    if (pcMq.matches) sigBox.after(limitBox); else topRight.prepend(limitBox);
  };
  placeLimit();
  pcMq.addEventListener('change', placeLimit);
  const sx = {
    lamps: side.querySelector<HTMLElement>('.sigLamps')!, sigTxt: $('sigTxt'), sigDist: $('sigDist'), ats: $('atsLine'),
    door: $('doorLamp'), doorTxt: $('doorTxt'), tt: $<HTMLTableElement>('ttTable'), replay: $('replayTag'), svc: $('svcPanel'),
  };
  // リプレイ中の操作ボタン（結果画面へ戻る・タイトルへ）。サイドパネルの外（body 直下）に置いて画面の手前に出す
  const replayBar = document.createElement('div'); replayBar.id = 'replayBar';
  replayBar.innerHTML = '<button id="replayStopBtn">結果へ戻る（R）</button><button id="replayTitleBtn">タイトルへ（Esc）</button>';
  document.body.append(replayBar);
  $('replayStopBtn').onclick = () => ctx.actions.toggleReplay();
  $('replayTitleBtn').onclick = () => ctx.actions.toTitle();
  ctx.events.on('cameraMode', ({ mode }) => replayBar.classList.toggle('show', mode === 'replay'));
  /** 種別表示（普通・急行・特急、両数） */
  function renderService() {
    const v = route.services ? serviceOf(route, st.sel.service) : undefined;
    sx.svc.hidden = !v;
    if (v) sx.svc.innerHTML = `<span class="svcBadge svc-${v.id}">${v.name}</span> ${destOf(route, v)}行 <span class="sub">${v.cars}両${v.units.length > 1 ? `（${unitsLabel(v.units)}）` : ''}</span>`;
  }

  // 表示対象の駅（次の停車駅。終了後は最後に判定した駅）
  const targetIndex = () => st.target >= 0 ? st.target : route.stations.length - 1;
  /** 次の停車駅より手前の通過駅（未通過） */
  const nextPass = () => route.stations.findIndex((x, i) => x.pass && i > st.fromIndex && i < targetIndex() && !st.flags['passed' + i]);

  function renderTarget() {
    const sta = route.stations[targetIndex()];
    const dep = dwelling();
    el.sched.textContent = fmtClock(route.startClock + (dep ? departureTime(route, targetIndex()) : sta.scheduledArrival));
    if (schedTail && schedTail.nodeType === Node.TEXT_NODE) schedTail.textContent = dep ? ' 発 ' : ' 着 ';
    const p = nextPass();
    const v = route.services ? serviceOf(route, st.sel.service) : undefined;
    el.nextSta.textContent = (v ? `${v.name} ` : '') + (st.state === 'dwell' ? `${sta.name} 停車中` : `次は ${sta.name}` + (p >= 0 ? `（${route.stations[p].name} 通過）` : ''));
    renderService();
    renderTimetable();
  }

  /** 時刻表の表示行数の上限（堺〜泉大津の10駅と同じ大きさ）。駅が多いコースは、次の停車駅の2駅前から表示し、過ぎた駅は上へ送って消す */
  const TT_ROWS = 10;
  function renderTimetable() {
    const rows: string[] = [];
    const first = Math.max(st.fromIndex, Math.min(targetIndex() - 2, st.endIndex - TT_ROWS + 1)), last = Math.min(st.endIndex, first + TT_ROWS - 1);
    for (let i = first; i <= last; i++) {
      const x = route.stations[i], c = route.startClock;
      const arr = i === st.fromIndex ? '' : fmtHM(c + x.scheduledArrival).slice(0, -3) + `<small>${fmtHM(c + x.scheduledArrival).slice(-2)}</small>`;
      const dep = x.pass ? 'レ' : i === st.endIndex ? '' : fmtHM(c + departureTime(route, i)).slice(0, -3) + `<small>${fmtHM(c + departureTime(route, i)).slice(-2)}</small>`;
      const done = st.stops.some(j => j.index === i) || st.passes.some(j => j.index === i) || i === st.fromIndex && st.state !== 'title';
      const cls = i === targetIndex() ? 'next' : done ? 'done' : '';
      rows.push(`<tr class="${cls}${x.pass ? ' pass' : ''}"><td>${x.name}</td><td>${arr}</td><td>${dep}</td></tr>`);
    }
    sx.tt.innerHTML = rows.join('');
    // 低い画面で時刻表がはみ出す場合は次の停車駅付近が見える位置へ寄せる
    const box = sx.tt.parentElement!, nr = sx.tt.querySelector<HTMLElement>('tr.next');
    box.scrollTop = nr ? Math.max(0, nr.offsetTop - 48) : 0;
  }

  // ノッチ列
  const notchEls: [number, HTMLDivElement][] = [];
  for (let n = NOTCH_MAX; n >= NOTCH_MIN; n--) {
    const d = document.createElement('div'); d.textContent = notchName(n);
    d.className = n > 0 ? 'p' : n === 0 ? 'n' : n === NOTCH_EB ? 'e' : 'b';
    el.notches.appendChild(d); notchEls.push([n, d]);
  }
  const renderNotches = () => { for (const [n, d] of notchEls) d.classList.toggle('on', n === st.train.notch); };

  let bannerTimer = 0;
  const showBanner = (text: string, sec: number) => { el.banner.textContent = text; el.banner.classList.add('show'); bannerTimer = sec; };

  function updateSide() {
    const sigs = route.signals ?? [], n = st.nextSignal;
    if (n >= 0 && sigs[n]) {
      const a = st.signals[n], lim = ASPECT_LIMIT[a];
      sx.lamps.dataset.a = a;
      sx.sigTxt.textContent = `${a === 'YG' ? 'YG' : a} ${ASPECT_LABEL[a]}${a === 'R' ? '' : lim < Infinity ? ` ${lim}` : ''}`;
      sx.sigTxt.className = 'asp-' + a;
      sx.sigDist.textContent = `${Math.round(sigs[n].s - st.train.s)} m`;
    } else { sx.lamps.dataset.a = ''; sx.sigTxt.textContent = '-'; sx.sigDist.innerHTML = '&nbsp;'; }
    const ats = st.ats;
    sx.ats.className = 'ats-' + (ats.state === 'normal' ? 'ok' : ats.state);
    const terminalLimit = terminalSpeedLimit(route, st.target, st.train.s);
    const terminalDistance = route.terminalApproach && st.target === route.stations.length - 1
      ? route.stations[st.target].stopS - st.train.s : Infinity;
    sx.ats.textContent = ats.state === 'normal' ? (terminalLimit < Infinity ? `ATS 終着照査 ${Math.floor(terminalLimit)}km/h` : terminalDistance <= 1500 ? `ATS 終着予告 65km/hまで ${Math.ceil(terminalDistance - 1000)}m` : st.sigLimit < Infinity ? `ATS 正常（信号制限 ${Math.floor(st.sigLimit + 1e-6)}）` : 'ATS 正常')
      : ats.state === 'warn' ? `ATS 警報 ${Math.max(0, ats.timer).toFixed(1)}s — B4以上＋確認(A)`
        : `ATS 非常制動 — 停止後 確認(A)で復帰`;
    const open = st.doors === 'open', closing = st.doors === 'closing';
    sx.door.classList.toggle('on', st.doors === 'closed');
    sx.door.textContent = open ? 'ドア開' : closing ? '戸閉め中' : '戸閉';
    const ot = st.overtake, waiting = st.state === 'dwell' && !!ot && !ot.cleared && ot.station === st.target;
    sx.doorTxt.textContent = st.state === 'dwell' ? (open ? ` 戸閉めまで ${Math.ceil(st.dwellT)}秒` : closing ? ' 発車できません' : waiting ? ' 通過待ち' : ' 力行で発車') : '';
    // 単線の交換駅: 対向列車が着くまで行き違い待ち
    const mt = st.meet;
    if (st.state === 'dwell' && !open && !closing && mt && mt.station === st.target && !mt.arrived) sx.doorTxt.textContent = ' 対向列車の行き違い待ち';
    if (waiting && !open) { const p = serviceOf(route, ot.passedBy); sx.doorTxt.textContent = ` ${p?.name ?? ''}の${p?.stops.includes(ot.station) ? '待ち合わせ' : '通過待ち'}`; }
    sx.replay.classList.toggle('show', ctx.cameraMode === 'replay');
  }

  function update() {
    const { s, v } = st.train, vk = v * 3.6, now = route.startClock + st.t;
    const lim = Math.min(track.limitAt(s), st.state === 'run' ? st.sigLimit : Infinity);
    const sta = route.stations[targetIndex()];
    el.clock.textContent = fmtClock(now);
    const running = st.state === 'run' || st.state === 'dwell';
    const remain = (dwelling() ? departureTime(route, targetIndex()) : sta.scheduledArrival) - st.t;
    if (running && remain < 0) { el.delay.textContent = `(遅れ ${Math.floor(-remain)}秒)`; el.delay.className = 'late'; }
    else { el.delay.textContent = running ? `(あと ${Math.ceil(remain)}秒)` : ''; el.delay.className = 'early'; }
    el.limit.textContent = lim < Infinity ? String(Math.floor(lim + 1e-6)) : '-';
    // 信号による制限が線路の制限より低いときは標識を黄色で強調（判定は loop.ts と同じ min(線路, 信号)）
    el.limitPanel.classList.toggle('sigcut', st.state === 'run' && st.sigLimit < track.limitAt(s));
    el.limitPanel.classList.toggle('over', vk > lim + OVERSPEED_MARGIN);
    // 制限の補助表示: 制限中は解除（後部通過）までの距離、制限外は次の制限までの距離
    let nxt = '&nbsp;';
    const cur = route.limits.filter(L => s >= L.from && s < L.to && L.kmh <= route.lineLimit).sort((a, b) => a.kmh - b.kmh)[0];
    const ahead = route.limits.find(L => L.from > s && L.from - s < 1200 && L.kmh < (cur?.kmh ?? route.lineLimit));
    if (ahead && (!cur || ahead.from < cur.to)) nxt = `<b>この先 ${Math.round(ahead.kmh)}</b> あと ${Math.round(ahead.from - s)}m`;
    else if (cur) nxt = `<b>${Math.round(cur.kmh)} 解除</b>まで ${Math.round(cur.to - s)}m`;
    el.nextLimit.innerHTML = nxt;
    // 通過駅が手前にあればそこまでの距離を補助表示
    const p = nextPass();
    const d = sta.stopS - s;
    el.dist.textContent = d > 100 ? `${Math.round(d)} m` : d >= 0 ? `${d.toFixed(2)} m` : `+${(-d).toFixed(2)} m`;
    el.dist.classList.toggle('near', d <= 100);
    el.distPanel.classList.toggle('near', d <= 100 && d >= 0);
    el.distPanel.classList.toggle('over', d < 0);
    if (distLbl) distLbl.textContent = p >= 0 ? `停止位置まで（${route.stations[p].name}通過まで ${Math.max(0, Math.round(route.stations[p].stopS - s))}m）` : '停止位置まで';
    drawMeter(mctx, vk, lim, route.lineLimit > 100 ? 140 : 120, route.lineLimit);
    updateSide();
  }

  // ---- 一時停止（右上のボタン・中央の停止画面・タブ非表示で自動停止） ----
  const pause = {
    btn: $<HTMLButtonElement>('pauseBtn'), box: $('pauseOverlay'), info: $('pauseInfo'),
    resume: $<HTMLButtonElement>('resumeBtn'), quit: $<HTMLButtonElement>('quitBtn'),
  };
  let quitArmed = false;
  const armQuit = (on: boolean) => {
    quitArmed = on;
    pause.quit.textContent = on ? 'もう一度押すとタイトルへ（記録は残らない）' : 'タイトルへ戻る';
    pause.quit.classList.toggle('warn', on);
  };
  // pointerdown でなく click: 押した指を離したときの誤操作（停止画面の下の操作ボタン）を避ける
  pause.btn.addEventListener('click', () => { ctx.actions.setPaused(true); pause.btn.blur(); });
  pause.resume.addEventListener('click', () => ctx.actions.setPaused(false));
  pause.quit.addEventListener('click', () => { if (!quitArmed) { armQuit(true); return; } armQuit(false); ctx.actions.quitToTitle(); });
  events.on('pause', ({ paused, reason }) => {
    pause.box.hidden = !paused;
    document.body.classList.toggle('paused', paused);
    armQuit(false);
    if (paused) {
      pause.info.textContent = `${fmtClock(route.startClock + st.t)} で停止中${reason === 'hidden' ? '（画面が非表示になったため自動で一時停止）' : ''}`;
      pause.resume.focus({ preventScroll: true });
    }
  });
  // タブ・アプリが背面へ回ったら自動で一時停止（戻っても自動再開はしない）
  document.addEventListener('visibilitychange', () => { if (document.hidden && !st.paused && ctx.actions.canPause()) ctx.actions.setPaused(true, 'hidden'); });
  const syncPauseBtn = () => {
    const show = !st.paused && ctx.actions.canPause();
    if (pause.btn.hidden === show) pause.btn.hidden = !show;
  };

  let passCount = 0;
  renderTarget();
  renderNotches();
  events.on('notch', renderNotches);
  events.on('reset', () => { renderNotches(); renderTarget(); });
  events.on('depart', renderTarget);
  events.on('arrive', renderTimetable);
  events.on('stateChange', renderTarget);
  events.on('banner', e => showBanner(e.text, e.sec));
  events.on('frame', ({ dt }) => {
    if (bannerTimer > 0 && (bannerTimer -= dt) <= 0) el.banner.classList.remove('show');
    if (st.passes.length !== passCount) { passCount = st.passes.length; renderTarget(); } // 通過駅を過ぎたら更新
    update();
    syncPauseBtn();
  });
}
