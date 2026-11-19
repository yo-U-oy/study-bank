/* 学习抽卡银行：页面与云端保存 */
(function () {
  const APP_VERSION = '1.5.2', APP_DATE = '2026-11-19'; // 每次发布都要改这里，并同步 sw.js 里的 VERSION
  const L = window.Logic;
  const $ = s => document.querySelector(s);
  const main = $('#main'), tabs = $('#tabs'), layer = $('#layer'), toasts = $('#toasts');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const pad = n => String(n).padStart(2, '0');

  let S = null, phase = 'loading', cloud = false, stateRef = null, downloads = null;
  let view = 'today', overlayOpen = false, modal = null;
  let dirty = false, inflight = false, saveErr = false, confirmed = false;
  let backTo = 'settings';
  const logView = () => view === 'ledger' || view === 'stats' || (view === 'draw' && !(lastDraw && lastDraw.rolling));
  let stat = { mode: 'week', off: 0, moff: 0, tip: '' };
  let remind = { a: false, b: false, over: 0 }, AC = null;
  let collapsed = {}, lastDraw = null, ledgerKeys = null, lastCheckMin = -1, lastMin = -1;
  const logCache = {}; let logChain = Promise.resolve();

  let DEVICE = 'd' + Math.random().toString(36).slice(2, 10);
  try { DEVICE = localStorage.getItem('bank-device') || DEVICE; localStorage.setItem('bank-device', DEVICE); } catch (e) { }

  /* ---------- 主题 ---------- */
  const RAR = { S: '传说', A: '史诗', B: '稀有', C: '罕见', D: '普通' };
  const rName = k => RAR[k] || k;
  const pageHead = t => '<div class="pagehead"><span class="gem"></span><h1>' + t + '</h1><span class="gem"></span></div>';
  // 骰面点数只是表现：传说 20，史诗 19，稀有 15–18，罕见 9–14，普通 1–8
  const dieNum = k => k === 'S' ? 20 : k === 'A' ? 19 : k === 'B' ? 15 + Math.floor(Math.random() * 4) : k === 'C' ? 9 + Math.floor(Math.random() * 6) : 1 + Math.floor(Math.random() * 8);
  const RUNES = (() => {
    let g = '<g class="runes"><circle cx="50" cy="50" r="48.5"/><circle cx="50" cy="50" r="44"/><circle cx="50" cy="50" r="38"/>' +
      '<polygon points="50,6.5 87.7,71.8 12.3,71.8"/><polygon points="50,93.5 12.3,28.2 87.7,28.2"/>';
    const glyphs = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, x = 50 + Math.sin(a) * 46.3, y = 50 - Math.cos(a) * 46.3 + 1.7; g += '<text x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '">' + glyphs[i] + '</text>'; }
    return g + '</g>';
  })();

  // 同伴小人：共 11 位，按日期或计时轮换。台词是原创的，只模仿语气
  const SPRITES = 11, spr = n => 'sprites/c' + n + '.png';
  const MATES = window.VOICES || [];
  // 同一状态下每 10 分钟换一句，避免每分钟刷新时台词乱跳
  const pick = (arr, salt) => { let h = 7; const k = salt + ':' + Math.floor(Date.now() / 600000); for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) % 100003; return arr[h % arr.length]; };
  const anyLine = arr => arr[Math.floor(Math.random() * arr.length)];
  const dayMate = () => { const k = S.today.key; let h = 0; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) % 9973; return 1 + h % SPRITES; };
  function buddyHtml() {
    const d = S.today, daily = S.tasks.filter(t => t.group === 'daily' && L.isActive(S, t));
    const allDone = daily.length && daily.every(t => L.taskDone(S, t));
    const n = dayMate(), m = MATES[n];
    const st = S.timer && S.timer.kind === 'study' ? 'focus' : allDone ? 'done' : d.totalSec >= 600 ? 'go' : 'idle', line = pick(m[st], S.today.key + st + n);
    return '<div class="buddy"><img src="' + spr(n) + '" alt="' + m.name + '" width="92" height="120"><p><span class="who">' + m.name + '</span>' + line + '</p></div>';
  }
  // 营地同伴一排：放三份，滑到头时悄悄跳回中间那份，看起来像一个可以一直转的圆环
  let partyPos = null;
  function partyHtml() {
    let h = '<div class="party" id="party" aria-label="营地里的同伴">';
    for (let c = 0; c < 3; c++) for (let i = 1; i <= SPRITES; i++) h += '<button data-act="mate" data-n="' + i + '"' + (c === 1 ? ' aria-label="' + MATES[i].name + '"' : ' aria-hidden="true" tabindex="-1"') + '><img src="' + spr(i) + '" alt=""></button>';
    return h + '</div>';
  }
  function partySetup() {
    const el = $('#party'); if (!el) return;
    const setW = () => el.scrollWidth / 3;
    const init = () => { const w = setW(); if (w) el.scrollLeft = partyPos == null ? w : w + (((partyPos % w) + w) % w); };
    const wrap = () => { const w = setW(); if (!w) return; if (el.scrollLeft < w * 0.5) el.scrollLeft += w; else if (el.scrollLeft > w * 1.5) el.scrollLeft -= w; partyPos = el.scrollLeft - w; };
    init(); el.querySelectorAll('img').forEach(im => { if (!im.complete) im.addEventListener('load', () => { if (partyPos == null || Math.abs(el.scrollLeft - setW() - partyPos) > 2) init(); }, { once: true }); });
    let raf = 0; el.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; wrap(); }); }, { passive: true });
  }

  /* ---------- 格式 ---------- */
  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return h ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
  }
  function fmtMin(min) {
    min = Math.round(min); if (min < 0) return '欠 ' + fmtMin(-min);
    const h = Math.floor(min / 60), m = min % 60;
    return h ? h + ' 小时' + (m ? ' ' + m + ' 分钟' : '') : m + ' 分钟';
  }
  function fmtTime(ms) { const d = new Date(ms + 9 * 3600e3); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  function amount(e) {
    const parts = [];
    if (e.min) parts.push('<span class="' + (e.min > 0 ? 'plus' : 'minus') + '">' + (e.min > 0 ? '+' : '−') + Math.abs(e.min) + ' 分钟</span>');
    if (e.tix) parts.push('<span class="' + (e.tix > 0 ? 'plus' : 'minus') + '">' + (e.tix > 0 ? '+' : '−') + Math.abs(e.tix) + ' 券</span>');
    return parts.join(' ');
  }

  /* ---------- 保存 ---------- */
  function save() {
    if (!cloud) { try { localStorage.setItem('bank-local-state', JSON.stringify(S)); } catch (e) { } return; }
    if (!confirmed) return;
    dirty = true; if (!inflight) flush();
  }
  async function flush() {
    inflight = true;
    while (dirty) {
      dirty = false;
      try { await stateRef.set(clone(S)); saveErr = false; }
      catch (e) { saveErr = true; break; }
    }
    inflight = false;
    if (saveErr) renderMain();
  }
  function logRef(k) { return stateRef.collection('logs').doc(k); }
  function localLogs() { try { return JSON.parse(localStorage.getItem('bank-local-logs')) || {}; } catch (e) { return {}; } }
  async function loadLog(k) {
    if (logCache[k]) return logCache[k];
    let d = null;
    if (cloud) { const s = await logRef(k).get(); if (s.exists) d = clone(s.data()); }
    else d = localLogs()[k] || null;
    d = d || {}; d.entries = d.entries || []; d.sessions = d.sessions || [];
    logCache[k] = d; return d;
  }
  async function writeLog(k) {
    if (cloud) await logRef(k).set(clone(logCache[k]));
    else { const all = localLogs(); all[k] = logCache[k]; try { localStorage.setItem('bank-local-logs', JSON.stringify(all)); } catch (e) { } }
  }
  function logAppend(entries, session) {
    const now = Date.now(), k = L.dayKey(now), aid = S ? (S.act || 0) : 0;
    if (!(entries && entries.length) && !session) return;
    logChain = logChain.then(async () => {
      const d = await loadLog(k);
      (entries || []).forEach(e => d.entries.push({ t: now, a: aid, label: e.label, min: e.min || 0, tix: e.tix || 0 }));
      if (session) d.sessions.push(Object.assign({ a: aid }, session));
      await writeLog(k);
      if (ledgerKeys && !ledgerKeys.includes(k)) ledgerKeys.unshift(k);
      if (logView()) renderMain();
    }).catch(() => { toast('这一笔流水没能写入记录，但余额已经正确保存。'); });
  }

  /* ---------- 启动 ---------- */
  async function boot() {
    const timer = setTimeout(() => {
      const el = $('#bootmsg'); if (phase === 'loading' && el) el.textContent = '暂时连不上云端数据。网络恢复后会自动继续，不需要刷新。';
    }, 10000);
    let db = null, user = null;
    try {
      if (window.claude && window.claude.use) [db, user, downloads] = await Promise.all([window.claude.use('db'), window.claude.use('user'), window.claude.use('downloads')]);
    } catch (e) { }
    let uid = null; try { uid = user ? await user.id() : null; } catch (e) { }
    if (!db || !uid) { clearTimeout(timer); startLocal(); return; }
    cloud = true; stateRef = db.doc('data/users/' + uid + '/state');
    stateRef.onSnapshot(snap => {
      if (!snap.exists) {
        if (!snap.metadata.fromCache && phase === 'loading') { clearTimeout(timer); phase = 'onboard'; render(); }
        return;
      }
      // 浏览器里留着的旧副本不能当真：等云端给出确认过的数据再显示和保存，否则旧数据会把新数据盖掉
      if (snap.metadata.fromCache && !confirmed) return;
      if (!snap.metadata.fromCache) { clearTimeout(timer); confirmed = true; }
      if (dirty || inflight) return;
      const hadTimer = !!(S && S.timer);
      S = clone(snap.data()); phase = 'ready';
      if (L.migrate(S)) save();
      if (S.timer && !hadTimer) overlayOpen = true;
      checkRollover(Date.now());
      render();
    }, () => {
      clearTimeout(timer);
      if (phase === 'loading') { phase = 'error'; render(); } else { saveErr = true; renderMain(); }
    });
  }
  function startLocal() {
    cloud = false;
    try { S = JSON.parse(localStorage.getItem('bank-local-state')); } catch (e) { S = null; }
    phase = S ? 'ready' : 'onboard';
    if (S) { if (L.migrate(S)) save(); if (S.timer) overlayOpen = true; checkRollover(Date.now()); }
    render();
  }
  function checkRollover(now) {
    if (S.today.key !== L.dayKey(now) || S.week.key !== L.weekKey(now)) { L.rollover(S, now); S.undo = null; S.timerBase = null; save(); return true; }
    return false;
  }

  /* ---------- 提示 ---------- */
  function toast(html, ms, live) {
    const el = document.createElement('div'); el.className = 'toast'; el.innerHTML = html;
    if (live) el.style.pointerEvents = 'auto';
    toasts.appendChild(el); setTimeout(() => el.remove(), ms || 4200);
  }
  function toastUndo(text) { toast(esc(text) + ' <button class="btn sm" data-act="undo" style="margin-left:8px">撤销</button>', 8000, true); }
  function celebrate(ev) {
    ev.forEach((e, i) => setTimeout(() => toast(esc(e.label) + '　' + amount(e)), i * 350));
  }

  /* ---------- 计时 ---------- */
  function liveExtra(now) { const t = S.timer; return t && t.kind === 'study' ? Math.max(0, L.elapsedSec(t, now) - t.committed) : 0; }

  function startTimer(kind, task) {
    if (S.timer) { toast('已经有一个计时在进行，先把它结束。'); overlayOpen = true; renderLayer(); return; }
    const now = Date.now();
    if (kind === 'play' && S.bank <= 0) { toast(S.bank < 0 ? '现在欠 ' + fmtMin(-S.bank).slice(2) + '。先学习、抽奖把账还上再玩。' : '没有游戏时间了。每学习 ' + S.settings.segMin + ' 分钟可以拿到一张抽奖券。'); return; }
    if (kind === 'play') { remind = { a: false, b: false, over: 0 }; try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) {} }
    const mode = task ? task.mode : 'up';
    S.timerBase = begin('计时'); S.undo = null;
    S.timer = {
      kind, taskId: task ? task.id : null, name: kind === 'play' ? '游戏时间' : task ? task.name : '自由学习',
      target: kind === 'study' && task ? (mode === 'down' ? task.downMin : mode === 'pomo' ? 25 : 0) : 0,
      began: now, startedAt: now, acc: 0, paused: false, committed: 0, device: DEVICE,
    };
    lastCheckMin = -1; overlayOpen = true; save(); render();
  }
  function pauseTimer() {
    const t = S.timer, now = Date.now(); if (!t) return;
    if (t.paused) { t.paused = false; t.startedAt = now; t.device = DEVICE; }
    else { t.acc += now - t.startedAt; t.paused = true; }
    save(); render();
  }
  function stopTimer() {
    const t = S.timer; if (!t) return;
    const sec = L.elapsedSec(t, Date.now());
    if (sec > 3 * 3600) { modal = { type: 'adjust', sec }; renderLayer(); return; }
    finishTimer(sec);
  }
  function finishTimer(sec) {
    const t = S.timer, now = Date.now(); if (!t) return;
    alarmClose();
    checkRollover(now);
    const base = S.timerBase; S.timerBase = null;
    const mkUndo = label => { S.undo = base ? { label, t: now, aid: base.aid, prev: base.prev, whole: true } : null; };
    if (t.kind === 'study') {
      sec = Math.max(sec, t.committed);
      if (sec < 60) { S.timer = null; overlayOpen = false; save(); render(); toast('不到 1 分钟，这次没有记录。下次再来。'); return; }
      L.addStudy(S, t.taskId, sec - t.committed);
      const ev = L.settle(S);
      S.timer = null; overlayOpen = false;
      logAppend(ev, { name: t.name, taskId: t.taskId, start: t.began, sec });
      mkUndo('结束计时：' + t.name + ' ' + Math.floor(sec / 60) + ' 分钟');
      save(); render();
      (S.undo ? toastUndo : toast)('这次学了 ' + fmtMin(Math.floor(sec / 60)) + '，已经记下了。');
      celebrate(ev);
    } else {
      const cost = L.playCost(sec, S.settings.roundTo), spent = L.spend(S, cost);
      S.timer = null; overlayOpen = false;
      if (spent) logAppend([{ label: '玩游戏 ' + Math.floor(sec / 60) + ' 分钟', min: -spent, tix: 0 }]);
      mkUndo('玩游戏 ' + Math.floor(sec / 60) + ' 分钟，扣除 ' + spent + ' 分钟');
      save(); render();
      (S.undo && spent ? toastUndo : toast)(spent ? '玩了 ' + Math.floor(sec / 60) + ' 分钟，从银行扣除 ' + spent + ' 分钟。' + (S.bank < 0 ? '现在' + fmtMin(S.bank) + '。' : '') : '不到 1 分钟，没有扣除。');
    }
  }
  function abandonTimer() {
    const t = S.timer; if (!t) return;
    const base = S.timerBase, el = L.elapsedSec(t, Date.now());
    if (t.kind === 'play' && el > 120) { toast('已经玩了超过 2 分钟，请用「结束」来结算。'); return; }
    const msg = t.kind === 'play' ? '这次游戏计时不会扣除时间。'
      : base ? '这次计时不会留下任何记录' + (t.committed ? '，途中已经发的奖励也会收回' : '') + '。<br><span class="small muted">如果只是想停下来并保留已学的时间，请点「结束」。</span>'
        : '已经结算的部分会保留，之后的时间不记录。';
    confirmBox('放弃这次计时？', msg, '放弃', () => {
      overlayOpen = false;
      if (base) { S.undo = { label: '计时', t: Date.now(), aid: base.aid, prev: base.prev, whole: true }; doUndo(true); }
      else { S.timer = null; S.timerBase = null; save(); render(); }
      toast('已放弃，这次计时没有记录。');
    });
  }

  /* ---------- 撤销 ---------- */
  // 每个操作前留一份底；撤销就是回到那份底，并删掉之后产生的流水。抽奖不能撤销。
  function begin(label) {
    const prev = clone(S); delete prev.undo;
    S.act = (S.act || 0) + 1;
    return { label, t: Date.now(), aid: S.act, prev };
  }
  function purgeLogs(keys, aid) {
    keys.forEach(k => {
      logChain = logChain.then(async () => {
        const d = await loadLog(k);
        const ne = d.entries.filter(e => !(e.a >= aid)), ns = d.sessions.filter(e => !(e.a >= aid));
        if (ne.length !== d.entries.length || ns.length !== d.sessions.length) { d.entries = ne; d.sessions = ns; await writeLog(k); }
        if (logView()) renderMain();
      }).catch(() => { });
    });
  }
  function doUndo(quiet) {
    const u = S.undo; if (!u) return;
    const cur = S.timer, curBase = S.timerBase, act = S.act || 0;
    const keys = Array.from(new Set([L.dayKey(Date.now()), u.prev.today.key]));
    S = clone(u.prev); S.act = Math.max(act, u.aid); S.undo = null;
    if (cur && !u.whole) { S.timer = Object.assign({}, cur, { committed: u.prev.timer ? u.prev.timer.committed : 0 }); S.timerBase = curBase || null; }
    checkRollover(Date.now()); purgeLogs(keys, u.aid); lastCheckMin = -1;
    save(); render();
    if (!quiet) toast('已撤销：' + esc(u.label));
  }
  function askUndo() {
    const u = S.undo; if (!u) { toast('现在没有可以撤销的操作。'); return; }
    if (u.whole) confirmBox('撤销「' + esc(u.label) + '」？', '会回到开始这次计时之前的状态：这次的时间、发的奖励和流水都会取消。', '撤销', () => doUndo());
    else doUndo();
  }
  function act(label, fn) { const u = begin(label); const r = fn(); S.undo = u; return r; }

  // 学习途中达到奖励条件时，由开始计时的那台设备当场发奖
  function tryCheckpoint(now) {
    const t = S.timer;
    if (!t || t.kind !== 'study' || t.paused || t.device !== DEVICE || dirty || inflight) return;
    const el = L.elapsedSec(t, now), m = Math.floor(el / 60);
    if (m === lastCheckMin || el - t.committed < 60) return;
    lastCheckMin = m;
    const probe = clone(S);
    L.addStudy(probe, t.taskId, el - t.committed);
    const ev = L.settle(probe);
    if (!ev.length) return;
    probe.timer.committed = el; S = probe;
    logAppend(ev); save(); celebrate(ev); renderMain();
  }
  function beep(n) {
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
    try {
      if (!AC) return; if (AC.state === 'suspended') AC.resume();
      for (let i = 0; i < n; i++) { const o = AC.createOscillator(), g = AC.createGain(); o.frequency.value = 880; o.connect(g); g.connect(AC.destination); const t0 = AC.currentTime + i * 0.35; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28); o.start(t0); o.stop(t0 + 0.3); }
    } catch (e) {}
  }
  function checkRemind(now) {
    const t = S && S.timer; if (!t || t.kind !== 'play' || t.paused) return;
    const leftSec = S.bank * 60 - L.elapsedSec(t, now);
    if (leftSec <= 600 && !remind.a) { remind.a = true; if (leftSec > 0) { beep(2); toast('游戏时间只剩 ' + Math.max(1, Math.ceil(leftSec / 60)) + ' 分钟了。', 9000); } }
    if (leftSec <= 0 && !remind.b) { remind.b = true; remind.a = true; remind.over = Math.floor(-leftSec / 300); alarmOpen('游戏时间用完了', '继续玩的部分会记成欠账。'); }
    if (leftSec <= -300) { const k = Math.floor(-leftSec / 300); if (k > remind.over) { remind.over = k; alarmOpen('已经超出 ' + k * 5 + ' 分钟', '超出的时间会记成欠账，可以停下来了。'); } }
  }
  // 全屏闹铃：一直响到点按钮为止（只在页面开着、在前台时有效）
  let alarmLoop = null;
  function alarmOpen(title, sub) {
    alarmClose(true);
    const el = document.createElement('div'); el.className = 'alarm'; el.id = 'alarm'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-live', 'assertive');
    el.innerHTML = '<div class="alarm-box"><div class="alarm-bell" aria-hidden="true"><svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></div>' +
      '<h2>' + esc(title) + '</h2><p>' + esc(sub) + '</p><div class="alarm-clock" id="alarmClock"></div>' +
      '<button class="btn primary" data-act="alarm-stop">结束游戏计时</button><button class="btn ghost" data-act="alarm-snooze">知道了，再玩一会</button></div>';
    document.body.appendChild(el);
    const tick = () => { beep(3); const t = S && S.timer, c = $('#alarmClock'); if (t && c) { const over = Math.ceil(L.elapsedSec(t, Date.now()) / 60) - S.bank; c.textContent = over > 0 ? '已超出 ' + over + ' 分钟' : ''; } };
    tick(); alarmLoop = setInterval(tick, 2200);
  }
  function alarmClose() { if (alarmLoop) { clearInterval(alarmLoop); alarmLoop = null; } const el = $('#alarm'); if (el) el.remove(); }
  function updateClock(now) {
    const t = S && S.timer, clock = $('#clock'), hint = $('#hint'), run = $('#runT');
    if (!t) return;
    const el = L.elapsedSec(t, now);
    let text = fmtClock(el), tip = '', frac = 0;
    if (t.kind === 'study') {
      if (t.target > 0) {
        const remain = t.target * 60 - el;
        text = remain > 0 ? fmtClock(remain) : '+' + fmtClock(-remain); frac = Math.min(1, el / (t.target * 60));
        tip = remain > 0 ? '奖励按实际学习的时间计算' : '时间到了。可以休息一下，也可以继续。';
      } else {
        const s = S.settings, total = S.today.totalSec + Math.max(0, el - t.committed); frac = (total % (s.segMin * 60)) / (s.segMin * 60);
        if (!S.today.start) tip = '再学 ' + Math.max(1, Math.ceil((s.startMin * 60 - total) / 60)) + ' 分钟，拿到今天的启动奖';
        else if (!(s.segCap > 0) || S.today.segs < s.segCap) tip = '距离下一张抽奖券还差 ' + Math.max(1, Math.ceil(((S.today.segs + 1) * s.segMin * 60 - total) / 60)) + ' 分钟';
        else tip = '今天的时长奖励已经领满，继续学习仍会记录';
      }
    } else {
      const left = S.bank - Math.ceil(el / 60); frac = S.bank > 0 ? Math.min(1, el / 60 / S.bank) : 1;
      tip = left > 0 ? '余额还可以玩 ' + fmtMin(left) : left === 0 ? '余额刚好用完，该停下来了' : '已经超出 ' + fmtMin(-left) + '，超出的会记成欠账';
    }
    if (t.paused) tip = '已暂停';
    if (clock) clock.textContent = text;
    const arc = $('#arc'); if (arc) arc.setAttribute('stroke-dashoffset', (100 - frac * 100).toFixed(2));
    if (hint) hint.textContent = tip;
    if (run) run.textContent = text;
  }

  /* ---------- 页面：今天 ---------- */
  function banners() {
    let h = '';
    if (saveErr) h += '<div class="note warn row spread"><span>刚才的修改还没保存到云端。</span><button class="btn sm" data-act="retry">重试保存</button></div>';
    return h;
  }
  function bankHtml() {
    const t = S.timer;
    return '<section class="bank' + (S.bank <= 0 ? ' empty' : '') + '">' +
      '<div class="row spread"><span class="label">剩余游戏时间' + (S.settings.bankCapMin > 0 ? '（最多存 ' + fmtMin(S.settings.bankCapMin) + '）' : '') + '</span><span class="small muted">抽奖券 <strong class="num" style="color:var(--brass-hi);font-size:18px">' + S.tickets + '</strong> 张</span></div>' +
      '<div class="amount">' + (S.bank < 0 ? '<small style="margin-left:0">欠</small>' : '') + Math.floor(Math.abs(S.bank) / 60) + '<small>小时</small>' + (Math.abs(S.bank) % 60) + '<small>分钟</small></div>' +
      (S.bank < 0 ? '<p class="small muted" style="margin:0">之后抽到的游戏时间会先用来还账。</p>' : '') +
      '<div class="row">' +
      '<button class="btn primary" data-act="play"' + (t ? ' disabled' : '') + '>开始游戏计时</button>' +
      '<button class="btn ghost" data-act="deduct">手动扣除</button></div></section>';
  }
  function runningHtml() {
    const t = S.timer; if (!t) return '';
    return '<button class="running' + (t.kind === 'play' ? ' play' : '') + '" data-act="ov-open"><span class="grow">' + (t.paused ? '已暂停：' : '正在计时：') + esc(t.name) + '</span><span class="t" id="runT"></span></button>';
  }
  function recentHtml() {
    const d = logCache[L.dayKey(Date.now())], list = d ? d.entries.slice(-8).reverse() : [];
    return '<section class="sec"><div class="row spread"><h2>今天的流水</h2><button class="btn sm" data-act="tab" data-tab="ledger" data-back="draw">全部流水</button></div>' +
      (list.length ? '<div>' + list.map(e => '<div class="entry"><span class="time">' + fmtTime(e.t) + '</span><span class="grow">' + esc(e.label) + '</span><span class="amt">' + amount(e) + '</span></div>').join('') + '</div>'
        : '<p class="muted small" style="margin:0">' + (ledgerKeys ? '今天还没有收入和支出。' : '正在读取') + '</p>') + '</section>';
  }
  function viewToday() {
    const s = S.settings, d = S.today, now = Date.now(), t = S.timer;
    const live = d.totalSec + liveExtra(now), segSec = s.segMin * 60;
    let segs = '', nextTip, head;
    if (s.segCap > 0) {
      for (let i = 0; i < s.segCap; i++) {
        const f = Math.max(0, Math.min(1, (live - i * segSec) / segSec));
        segs += '<i class="' + (i < d.segs ? 'done' : '') + '"><b style="transform:scaleX(' + f.toFixed(3) + ')"></b></i>';
      }
      head = '时长券 ' + d.segs + '/' + s.segCap + ' 张';
      nextTip = d.segs < s.segCap ? '再学 ' + Math.max(1, Math.ceil(((d.segs + 1) * segSec - live) / 60)) + ' 分钟得 1 张抽奖券' : '今天的时长券已领满';
    } else {
      segs = '<i><b style="transform:scaleX(' + ((live % segSec) / segSec).toFixed(3) + ')"></b></i>';
      head = '时长券 ' + d.segs + ' 张';
      nextTip = '再学 ' + Math.max(1, Math.ceil((segSec - live % segSec) / 60)) + ' 分钟得 1 张抽奖券';
    }
    let h = banners();
    if (S.undo) h += '<div class="note row spread small"><span class="grow">上一步：' + esc(S.undo.label) + '</span><button class="btn sm" data-act="undo">撤销</button></div>';
    h += runningHtml();
    if (false) h += '<button class="running' + (t.kind === 'play' ? ' play' : '') + '" data-act="ov-open"><span class="grow">' + (t.paused ? '已暂停：' : '正在计时：') + esc(t.name) + '</span><span class="t" id="runT"></span></button>';
    h += pageHead('任务日志') + buddyHtml();
    h += '<section class="dayline"><div class="row spread small"><span>今日经验 · 已学 <strong>' + Math.floor(live / 60) + '</strong> 分钟 · ' + head + '</span><span class="muted">' + nextTip + '</span></div><div class="segs">' + segs + '</div></section>';

    L.GROUPS.forEach(g => {
      const list = S.tasks.filter(x => x.group === g.id), open = !collapsed[g.id];
      let meta = '';
      if (g.id === 'daily' || g.id === 'weekly') {
        const act = list.filter(x => L.isActive(S, x));
        meta = '完成 ' + act.filter(x => L.taskDone(S, x)).length + '/' + act.length;
      }
      h += '<section class="group" data-g="' + g.id + '"><div class="ghead"><h2>' + g.name + '</h2><span class="meta">' + meta + '</span>' +
        '<button class="icon" data-act="collapse" data-g="' + g.id + '" aria-label="' + (open ? '收起' : '展开') + g.name + '">' + (open ? '&#8964;' : '&#8250;') + '</button>' +
        '<button class="icon" data-act="add" data-g="' + g.id + '" aria-label="在' + g.name + '里添加任务">+</button></div>';
      if (open) h += list.length ? list.map(x => card(x, g, now)).join('') : '<p class="muted small" style="margin:0 0 0 16px">这里还没有任务。</p>';
      h += '</section>';
      if (g.id === 'daily') h += specialsHtml(now);
    });
    h += '<button class="btn" data-act="free"' + (t ? ' disabled' : '') + '>自由学习（不选任务，直接计时）</button>';
    return h;
  }
  /* ---------- 特别任务 ---------- */
  const rewardText = (min, tix) => [min ? '+' + min + ' 分钟' : '', tix ? '+' + tix + ' 张券' : ''].filter(Boolean).join(' ');
  function specialsHtml(now) {
    const list = (S.specials || []).filter(g => L.specialVisible(g, now)), open = !collapsed.special;
    const left = list.reduce((a, g) => a + (L.specialStarted(g, now) ? g.items.filter(x => !L.specialDone(g, x, now)).length : 0), 0);
    let h = '<section class="group" data-g="special"><div class="ghead"><h2>特别任务</h2><span class="meta">' + (list.length ? '还剩 ' + left + ' 项' : '') + '</span>' +
      '<button class="icon" data-act="collapse" data-g="special" aria-label="' + (open ? '收起' : '展开') + '特别任务">' + (open ? '&#8964;' : '&#8250;') + '</button>' +
      '<button class="icon" data-act="sp-add" aria-label="新建特别任务">+</button></div>';
    if (open) {
      if (!list.length) h += '<p class="muted small" style="margin:0 0 0 16px">想给自己定一件额外的事？点右边的 + 新建，完成后直接拿奖励。</p>';
      list.forEach(g => {
        const today = L.dayKey(now), multi = g.items.length > 1, started = L.specialStarted(g, now), allDone = started && g.items.every(x => L.specialDone(g, x, now));
        const title = g.name || (multi ? '特别任务' : '');
        let tags = '';
        if (g.repeat === 'daily') tags += ' <span class="tag">每天</span>' + (started ? '' : ' <span class="tag">' + (g.date === L.nextDayKey(now) ? '明天' : g.date.slice(5).replace('-', '/')) + '开始</span>');
        else if (g.repeat === 'gap') tags += ' <span class="tag">按间隔</span>';
        else if (g.date) tags += ' <span class="tag">' + (g.date === today ? '今天' : g.date.slice(5).replace('-', '/')) + '</span>';
        if (allDone) tags += ' <span class="tag ok">已完成</span>';
        h += '<article class="spcard' + (allDone ? ' done' : '') + '">';
        if (title || tags) h += '<div class="sphead"><b>' + esc(title) + '</b>' + tags + '<span class="grow"></span><button class="icon sm" data-act="sp-del" data-id="' + g.id + '" aria-label="删除这组特别任务">&times;</button></div>';
        g.items.forEach(x => {
          const running = S.timer && S.timer.taskId === x.id, sec = (x.sec || 0) + (running ? liveExtra(now) : 0);
          const xd = L.specialDone(g, x, now), rw = L.specialReward(g, x, now);
          let gapNote = '';
          if (g.repeat === 'gap' && !xd) { const gd = L.specialGap(g, now); gapNote = '<div class="small muted">' + (gd === null ? '还没有完成记录，这次按较多的奖励' : '距上次完成 ' + gd + ' 天' + (gd <= g.gapDays ? '，在 ' + g.gapDays + ' 天之内，奖励更多' : '')) + '</div>'; }
          h += '<div class="spitem' + (xd ? ' done' : '') + '"><div class="grow"><div class="spname">' + esc(x.name) + '</div>' +
            (x.cond ? '<div class="small muted">条件：' + esc(x.cond) + '</div>' : '') + gapNote + (sec >= 60 ? '<div class="small muted">已学 <strong class="num">' + Math.floor(sec / 60) + '</strong> 分钟</div>' : '') + '</div><span class="spreward num">' + (g.repeat === 'gap' && xd ? '' : rewardText(rw.min, rw.tix)) + '</span>' +
            (xd ? '<span class="tag ok">' + (g.repeat ? '今天已完成' : '已完成') + '</span>' : !started ? '' : (running ? '<button class="btn sm" data-act="ov-open">计时中</button>' : '<button class="btn sm ghost" data-act="sp-start" data-i="' + x.id + '"' + (S.timer ? ' disabled' : '') + '>开始</button>') + '<button class="btn sm primary" data-act="sp-done" data-g="' + g.id + '" data-i="' + x.id + '">完成</button>') +
            (!title && !tags ? '<button class="icon sm" data-act="sp-del" data-id="' + g.id + '" aria-label="删除这个特别任务">&times;</button>' : '') + '</div>';
        });
        const bGot = g.repeat === 'daily' ? g.bonusDay === today : g.bonusDone;
        if (multi && (g.bonusMin || g.bonusTix)) h += '<div class="spbonus small' + (bGot ? ' got' : '') + '">' + (g.repeat ? '每天' : '') + '全部完成再 <b class="num">' + rewardText(g.bonusMin, g.bonusTix) + '</b>' + (bGot ? '　已领取' : '') + '</div>';
        h += '</article>';
      });
    }
    return h + '</section>';
  }
  function spDraftRead() {
    const m = modal; if (!m || m.type !== 'sp-new') return;
    m.draft.name = $('#sp-name').value; m.draft.date = $('#sp-date').value; m.draft.repeat = $('#sp-rep').checked; m.draft.gap = $('#sp-gap').checked;
    m.draft.gapDays = $('#sp-gd').value; m.draft.gapAmt = $('#sp-ga').value; m.draft.gapType = $('#sp-gt').value;
    m.draft.bonus = $('#sp-bonus').value; m.draft.bonusType = $('#sp-btype').value;
    m.draft.items = m.draft.items.map((it, i) => ({ name: $('#sp-n' + i).value, amt: $('#sp-a' + i).value, type: $('#sp-t' + i).value, cond: $('#sp-c' + i).value, showCond: it.showCond || !!$('#sp-c' + i).value }));
  }
  function spNewHtml(m) {
    const d = m.draft, typeSel = (id, v) => '<select id="' + id + '"><option value="min"' + (v !== 'tix' ? ' selected' : '') + '>分钟</option><option value="tix"' + (v === 'tix' ? ' selected' : '') + '>抽奖券</option></select>';
    let b = '<h3>新建特别任务</h3><p class="small muted" style="margin:0">自己定一件或几件想做的事，完成后直接拿奖励。奖励多少由你决定。</p>' +
      '<div class="grid2"><label class="field">组名（可不填）<input type="text" id="sp-name" maxlength="30" placeholder="比如：11/19 特别任务" value="' + esc(d.name) + '"></label>' +
      '<label class="field">日期（可不填）<input type="date" id="sp-date" value="' + esc(d.date) + '"></label></div>' +
      '<label class="check"><input type="checkbox" id="sp-rep"' + (d.repeat ? ' checked' : '') + '>每天重复（比如整理书桌，每天都能完成一次）</label>' +
      '<p class="small muted" style="margin:-4px 0 0">不重复时：填了日期，只在那一天显示，过了自动收起，不扣任何东西；不填就一直留到完成。<br>每天重复时：日期表示从哪天开始，不填就从今天开始。</p>' +
      '<label class="check"><input type="checkbox" id="sp-gap"' + (d.gap ? ' checked' : '') + '>按间隔天数给奖励（比如定期整理房间：越及时，奖励越多）</label>' +
      '<div class="inline2"><label class="field">几天之内完成算"及时"<input type="number" inputmode="numeric" min="1" id="sp-gd" placeholder="3" value="' + esc(d.gapDays || '') + '"></label><label class="field">及时完成的奖励<input type="number" inputmode="numeric" min="1" id="sp-ga" placeholder="60" value="' + esc(d.gapAmt || '') + '"></label></div>' +
      '<div class="inline2"><label class="field">单位' + typeSel('sp-gt', d.gapType) + '</label></div>' +
      '<p class="small muted" style="margin:-4px 0 0">选了这一项：只能有一项任务，每天最多完成一次。下面第 1 项的奖励是"超过这个天数"时拿的，在天数之内完成拿这里填的。第一次完成按"及时"算。不管隔多久，都不会扣东西。</p>';
    d.items.forEach((it, i) => {
      b += '<div class="spedit"><div class="row spread"><b class="small">第 ' + (i + 1) + ' 项</b>' + (d.items.length > 1 ? '<button class="btn ghost sm" data-act="sp-rm" data-i="' + i + '">删掉这一项</button>' : '') + '</div>' +
        '<label class="field">要做的事<input type="text" id="sp-n' + i + '" maxlength="40" placeholder="比如：完成一份作业" value="' + esc(it.name) + '"></label>' +
        '<div class="inline2"><label class="field">奖励<input type="number" inputmode="numeric" min="1" id="sp-a' + i + '" placeholder="40" value="' + esc(it.amt) + '"></label><label class="field">单位' + typeSel('sp-t' + i, it.type) + '</label></div>' +
        (it.showCond ? '<label class="field">领取条件（确认完成时会提醒你）<input type="text" id="sp-c' + i + '" maxlength="60" placeholder="比如：完成后收拾好桌面" value="' + esc(it.cond) + '"></label>'
          : '<input type="hidden" id="sp-c' + i + '" value=""><button class="btn ghost sm" data-act="sp-cond" data-i="' + i + '">+ 加一个领取条件（可选）</button>') + '</div>';
    });
    b += '<button class="btn" data-act="sp-more">+ 再加一项</button>';
    if (d.items.length > 1) b += '<div class="inline2"><label class="field">全部完成的额外奖励（可不填）<input type="number" inputmode="numeric" min="0" id="sp-bonus" placeholder="20" value="' + esc(d.bonus) + '"></label><label class="field">单位' + typeSel('sp-btype', d.bonusType) + '</label></div>';
    else b += '<input type="hidden" id="sp-bonus" value="' + esc(d.bonus) + '"><input type="hidden" id="sp-btype" value="' + esc(d.bonusType || 'min') + '">';
    b += '<p class="small" id="merr" style="margin:0;color:var(--warn)"></p><div class="row"><button class="btn primary" data-act="sp-save">建好了</button><button class="btn ghost" data-act="m-close">取消</button></div>';
    return b;
  }
  function spSave() {
    spDraftRead(); const d = modal.draft, err = $('#merr'), items = [];
    for (let i = 0; i < d.items.length; i++) {
      const it = d.items[i], name = it.name.trim(), amt = Math.round(Number(it.amt));
      if (!name) { err.textContent = '第 ' + (i + 1) + ' 项还没写要做的事。'; return; }
      if (!(amt > 0)) { err.textContent = '第 ' + (i + 1) + ' 项的奖励要填大于 0 的数字。'; return; }
      items.push({ name, min: it.type === 'tix' ? 0 : amt, tix: it.type === 'tix' ? amt : 0, cond: (it.cond || '').trim() });
    }
    const bonus = Math.max(0, Math.round(Number(d.bonus) || 0));
    let gapDays = 0, gapAmt = 0;
    if (d.gap) {
      gapDays = Math.round(Number(d.gapDays)); gapAmt = Math.round(Number(d.gapAmt));
      if (items.length > 1) { err.textContent = '按间隔天数给奖励，只能用在一项任务上。'; return; }
      if (!(gapDays > 0)) { err.textContent = '"几天之内"要填大于 0 的数字。'; return; }
      if (!(gapAmt > 0)) { err.textContent = '"及时完成的奖励"要填大于 0 的数字。'; return; }
    }
    const spec = { name: d.name.trim(), date: d.date || null, repeat: d.gap ? 'gap' : (d.repeat ? 'daily' : null), gapDays, gapMin: d.gapType === 'tix' ? 0 : gapAmt, gapTix: d.gapType === 'tix' ? gapAmt : 0, items, bonusMin: d.bonusType === 'tix' ? 0 : bonus, bonusTix: d.bonusType === 'tix' ? bonus : 0 };
    if (spec.date && spec.date < L.dayKey(Date.now())) { err.textContent = '这个日期已经过去了，选今天或以后的日子。'; return; }
    act('新建特别任务' + (spec.name ? '：' + spec.name : '：' + items[0].name), () => L.newSpecial(S, spec, Date.now()));
    collapsed.special = false; save(); closeModal(); toastUndo('特别任务建好了。');
  }
  // 第二步确认：同伴来问一句，滑动到底才算完成
  function spConfirmHtml(m) {
    const mt = MATES[m.n], g = S.specials.find(x => x.id === m.gid), it = g && g.items.find(x => x.id === m.iid);
    if (!it) return '';
    if (m.step === 'done') {
      return '<div class="scrim legend" data-act="m-scrim"><div class="cheer spdone" role="dialog" aria-modal="true" aria-label="特别任务完成">' +
        '<div class="rays" aria-hidden="true"></div><img src="' + spr(m.n) + '" alt="' + mt.name + '">' +
        '<div class="ctier tA">完成了</div><div class="cmin">' + m.reward + '</div>' +
        '<p><span class="who">' + mt.name + '</span>' + esc(m.line) + '</p><button class="btn primary" data-act="m-close">收下</button></div></div>';
    }
    return '<div class="scrim" data-act="m-scrim"><div class="sheet spask" role="dialog" aria-modal="true" aria-label="确认完成特别任务">' +
      '<div class="spwho"><img src="' + spr(m.n) + '" alt="' + mt.name + '"><p><span class="who">' + mt.name + '</span>「' + esc(it.name) + '」真的完成了吗？</p></div>' +
      (it.cond ? '<div class="spcond"><b>领取条件</b>' + esc(it.cond) + '<div class="small muted">滑到底表示这个条件也做到了。</div></div>' : '') +
      '<div class="spreward big num">' + (r => rewardText(r.min, r.tix))(L.specialReward(g, it, Date.now())) + '</div>' +
      '<div class="slide" id="spTrack"><div class="slide-fill" id="spFill"></div><span class="slide-text">向右滑动，确认完成</span><span class="slide-done" id="spDoneText"></span><button class="slide-knob" id="spKnob" aria-label="确认完成（也可以按回车）"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>' +
      '<div class="slide-burst" aria-hidden="true">' + '<i></i>'.repeat(12) + '</div></div>' +
      '<button class="btn ghost" data-act="m-close">还没完成</button></div></div>';
  }
  let spDrag = null;
  function spSet(x) {
    const k = $('#spKnob'), f = $('#spFill'); if (!k) return;
    k.style.transform = 'translateX(' + x + 'px)'; f.style.width = (x + k.offsetWidth / 2 + 6) + 'px';
    const tr = $('#spTrack'); if (tr) tr.style.setProperty('--p', Math.min(1, x / Math.max(1, spDrag ? spDrag.max : 1)).toFixed(3));
  }
  function spMax() { const tr = $('#spTrack'), k = $('#spKnob'); return tr && k ? tr.clientWidth - k.offsetWidth - 8 : 200; }
  function spFinish() {
    const m = modal; if (!m || m.type !== 'sp-confirm' || m.step !== 'ask') return;
    m.step = 'busy'; const tr = $('#spTrack'); if (tr) tr.classList.add('ok');
    try { navigator.vibrate && navigator.vibrate([20, 40, 60]); } catch (e) {}
    const g = S.specials.find(x => x.id === m.gid), it = g && g.items.find(x => x.id === m.iid);
    const r0 = g && it ? L.specialReward(g, it, Date.now()) : { min: 0, tix: 0 };
    const ev = act('完成特别任务：' + (it ? it.name : ''), () => L.completeSpecial(S, m.gid, m.iid, Date.now()));
    if (ev.length) logAppend(ev);
    save(); renderMain();
    const total = ev.reduce((a, e) => ({ min: a.min + e.min, tix: a.tix + e.tix }), { min: 0, tix: 0 });
    const capped = it && r0.min && total.min < r0.min + (ev.length > 1 ? g.bonusMin : 0);
    const reward = (rewardText(total.min, total.tix) || '') + (ev.length > 1 ? '（含全部完成奖励）' : '') + (capped ? '　余额已到上限' : '');
    const dt = $('#spDoneText'); if (dt) dt.textContent = '完成了' + (reward ? '　' + reward : '');
    const back = document.querySelector('.spask [data-act="m-close"]'); if (back) back.style.visibility = 'hidden';
    setTimeout(() => {
      if (!modal || modal.type !== 'sp-confirm') return;
      closeModal(); if (S.undo) toastUndo('特别任务完成' + (reward ? '：' + reward : '') + '。');
    }, 1500);
  }
  document.addEventListener('pointerdown', e => {
    const k = e.target.closest && e.target.closest('#spKnob'); if (!k || !modal || modal.step !== 'ask') return;
    e.preventDefault(); spDrag = { x0: e.clientX, x: 0, max: spMax() }; k.setPointerCapture && k.setPointerCapture(e.pointerId); $('#spTrack').classList.add('drag');
  });
  document.addEventListener('pointermove', e => {
    if (!spDrag) return; spDrag.x = Math.max(0, Math.min(spDrag.max, e.clientX - spDrag.x0)); spSet(spDrag.x);
  });
  function spEnd() {
    if (!spDrag) return; const d = spDrag; spDrag = null; const tr = $('#spTrack'); if (tr) tr.classList.remove('drag');
    if (d.x >= d.max * 0.92) { spSet(d.max); spFinish(); return; }
    const t0 = performance.now(), from = d.x;
    (function step(now) { const k = Math.min(1, (now - t0) / 240), x = from * (1 - (1 - Math.pow(1 - k, 3))); spSet(x); if (k < 1) requestAnimationFrame(step); })(t0);
  }
  document.addEventListener('pointerup', spEnd); document.addEventListener('pointercancel', spEnd);
  document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.id === 'spKnob') { e.preventDefault(); spSet(spMax()); spFinish(); } });

  function card(x, g, now) {
    const active = L.isActive(S, x), cnt = L.taskCount(S, x), tgt = Math.max(1, x.target), running = S.timer && S.timer.taskId === x.id;
    const sec = L.taskSec(S, x) + (running ? liveExtra(now) : 0);
    const done = g.period !== 'once' && cnt >= tgt;
    const next = g.period === 'day' ? '明天' : '下周';
    const modeLabel = x.manual && g.period !== 'once' ? '手动勾选' : ({ up: '正计时', down: '倒计时 ' + x.downMin + ' 分钟', pomo: '番茄钟 25 分钟' })[x.mode] || '正计时';
    let tags = '';
    if (!active) tags += ' <span class="tag">' + next + '生效</span>';
    if (x.endAt) tags += ' <span class="tag">' + next + '移除</span>';
    if (x.pending) tags += ' <span class="tag">修改' + next + '生效</span>';
    if (done) tags += ' <span class="tag ok">已完成</span>';
    let bar = '', right = '';
    if (g.period === 'once') right = '已学 <strong>' + Math.floor(sec / 60) + '</strong> 分钟';
    else {
      const pct = x.manual ? cnt / tgt : Math.min(1, sec / (Math.max(1, x.threshold) * 60 * tgt));
      bar = '<div class="bar"><b style="width:' + Math.round(pct * 100) + '%"></b></div>';
      right = (g.period === 'day' ? '今日 ' : '本周 ') + '<strong>' + cnt + '/' + tgt + '</strong> 次';
    }
    let acts = '';
    if (x.manual && g.period !== 'once') acts = '<button class="btn" data-act="check" data-id="' + x.id + '"' + (done ? ' disabled' : '') + '>' + (done ? '已勾选' : '勾选') + '</button>';
    else acts = '<button class="btn" data-act="start" data-id="' + x.id + '"' + (S.timer ? ' disabled' : '') + '>' + (running ? '计时中' : '开始') + '</button>';
    if (g.period === 'once') acts += '<button class="btn sm ghost" data-act="temp-done" data-id="' + x.id + '">完成</button>';
    return '<article class="card' + (active ? '' : ' inactive') + (done ? ' done' : '') + '"><div class="grow">' +
      '<button class="name" data-act="edit" data-id="' + x.id + '">' + esc(x.name) + '</button>' + tags + bar +
      '<div class="sub"><span>' + modeLabel + '</span><span>' + right + '</span></div></div><div class="acts">' + acts + '</div></article>';
  }

  /* ---------- 页面：抽奖 ---------- */
  function dieSvg(n, rolling) {
    return '<svg class="die' + (rolling ? ' roll' : '') + '" viewBox="0 0 100 100" role="img" aria-label="二十面骰，点数 ' + n + '">' +
      '<defs><linearGradient id="dieGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6b4a1f"/><stop offset=".55" stop-color="#3a2810"/><stop offset="1" stop-color="#1f150a"/></linearGradient></defs>' +
      '<polygon class="body" points="50,3 91,26.5 91,73.5 50,97 9,73.5 9,26.5"/>' +
      '<path class="edge" d="M50 3L50 25M50 25L91 26.5M50 25L9 26.5M77 70L91 26.5M77 70L91 73.5M77 70L50 97M23 70L9 26.5M23 70L9 73.5M23 70L50 97"/>' +
      '<polygon class="face" points="50,25 77,70 23,70"/><text id="dieNum" x="50" y="60">' + n + '</text></svg>';
  }
  function pouchSvg(open, dim) {
    return '<svg class="pouch' + (open ? ' open' : '') + (dim ? ' dim' : '') + '" viewBox="0 0 120 134" aria-hidden="true">' +
      '<defs><linearGradient id="bagG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a5a2e"/><stop offset=".6" stop-color="#4a3318"/><stop offset="1" stop-color="#2a1d0e"/></linearGradient>' +
      '<radialGradient id="bagGlow"><stop offset="0" stop-color="#fff0c0" stop-opacity=".95"/><stop offset="1" stop-color="#f0b84a" stop-opacity="0"/></radialGradient></defs>' +
      '<ellipse class="glow" cx="60" cy="50" rx="46" ry="30" fill="url(#bagGlow)"/>' +
      '<path class="bag" d="M30 52 C6 78 12 124 60 126 C108 124 114 78 90 52 Z" fill="url(#bagG)" stroke="#c9a05a" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path class="mouth" d="M28 52 Q44 40 60 47 Q76 40 92 52 Q76 62 60 56 Q44 62 28 52 Z" fill="#241809" stroke="#c9a05a" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M44 92 L52 80 L60 92 L68 80 L76 92" fill="none" stroke="#c9a05a" stroke-width="1.2" opacity=".55" stroke-linejoin="round"/>' +
      '<line id="pullRope" x1="60" y1="56" x2="60" y2="96" stroke="#e0c27a" stroke-width="2.4" stroke-linecap="round"/>' +
      '<g id="pullRing" class="pull"><circle cx="60" cy="104" r="26" fill="transparent"/><circle cx="60" cy="102" r="7" fill="none" stroke="#f0d38e" stroke-width="3"/><path d="M52 112 L60 118 L68 112" fill="none" stroke="#f0d38e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/></g></svg>';
  }
  const PULL_MAX = 34, PULL_GO = 22;
  let pullDrag = null;
  function pullSet(p) {
    const ring = $('#pullRing'), rope = $('#pullRope'), sv = ring && ring.ownerSVGElement;
    if (!ring) return;
    ring.setAttribute('transform', 'translate(0 ' + p + ')'); rope.setAttribute('y2', 96 + p);
    if (sv) { const g = sv.querySelector('.glow'); if (g) g.style.opacity = Math.min(1, p / PULL_GO) * 0.9; }
  }
  function pullSpringBack(from) {
    const t0 = performance.now();
    (function step(now) { const k = Math.min(1, (now - t0) / 260), e = 1 - Math.pow(1 - k, 3), over = Math.sin(k * Math.PI) * 4 * (1 - k); pullSet(Math.max(0, from * (1 - e) - over)); if (k < 1) requestAnimationFrame(step); else pullSet(0); })(t0);
  }
  document.addEventListener('pointerdown', e => {
    const ring = e.target.closest && e.target.closest('#pullRing'); if (!ring || !S || phase !== 'ready') return;
    const r = lastDraw, locked = (r && r.rolling) || S.tickets <= 0 || L.bankRoom(S) <= 0;
    if (locked) { toast(S.tickets <= 0 ? '没有券了，先去学习攒一张。' : L.bankRoom(S) <= 0 ? '余额已经存满，先去玩一会儿。' : '骰子还在转。'); return; }
    e.preventDefault(); pullDrag = { y: e.clientY, p: 0, tick: 0 };
  });
  document.addEventListener('pointermove', e => {
    if (!pullDrag) return;
    const sv = $('#pullRing') && $('#pullRing').ownerSVGElement, scale = sv ? sv.getBoundingClientRect().height / 134 : 1;
    const p = Math.max(0, Math.min(PULL_MAX, (e.clientY - pullDrag.y) / (scale || 1)));
    pullDrag.p = p; pullSet(p);
    const t = Math.floor(p / 8); if (t > pullDrag.tick) { pullDrag.tick = t; try { navigator.vibrate && navigator.vibrate(8); } catch (x) {} } else pullDrag.tick = t;
  });
  function pullEnd() {
    if (!pullDrag) return; const p = pullDrag.p; pullDrag = null;
    if (p >= PULL_GO) { try { navigator.vibrate && navigator.vibrate([20, 30, 40]); } catch (x) {} pullSet(0); doDraw(1); } else pullSpringBack(p);
  }
  document.addEventListener('pointerup', pullEnd);
  document.addEventListener('pointercancel', pullEnd);
  function viewDraw() {
    const s = S.settings, r = lastDraw;
    let prize = '<p class="muted">每一抽都有奖，最少 ' + s.pool[s.pool.length - 1].m + ' 分钟。</p>', face = 20, flash = false, pulls = '';
    if (r && r.rolling) { prize = '<p class="muted">骰子在转</p>'; face = 1 + Math.floor(Math.random() * 20); }
    else if (r) {
      const best = r.results.reduce((a, b) => (b.idx < a.idx ? b : a)), total = r.results.reduce((a, b) => a + b.got, 0), lost = r.results.reduce((a, b) => a + b.min - b.got, 0);
      face = best.n; flash = best.idx <= 1 || r.results.some(x => x.crit);
      if (r.results.length === 1) {
        prize = '<div class="reveal"><div class="grade">掷出 ' + best.n + ' · ' + best.k + ' 赏</div><div class="tier t' + best.k + '">' + rName(best.k) + '</div>' + (best.crit ? '<div class="crit">暴击 翻倍</div>' : '') +
          '<div class="mins">+' + best.got + ' 分钟' + (best.pity ? '（保底）' : '') + '</div>' + (lost ? '<div class="small muted">余额到上限了，有 ' + lost + ' 分钟没能存进去</div>' : '') + '</div>';
      } else {
        prize = '<div class="reveal"><div class="grade">最高 ' + rName(best.k) + ' · 掷出 ' + best.n + '</div><div class="tier t' + best.k + '">+' + total + '</div><div class="mins">' + r.results.length + ' 抽共获得 ' + fmtMin(total) + '</div></div>';
        pulls = '<div class="pulls">' + r.results.map(x => '<div><b class="t' + x.k + '">' + rName(x.k) + '</b>+' + x.got + (x.crit ? ' 暴击' : '') + (x.pity ? ' 保底' : '') + '</div>').join('') + '</div>';
      }
    }
    const rolling = r && r.rolling, full = L.bankRoom(S) <= 0;
    let h = banners() + pageHead('营地') + partyHtml() + bankHtml() + runningHtml() + '<section class="altar' + (flash ? ' flash' : '') + '"><h1>命运之骰</h1>' + pouchSvg(rolling, !S.tickets || full) + '<p class="small muted pullhint" style="margin:-6px 0 0">' + (rolling ? '' : S.tickets && !full ? '向下拉开袋口' : '') + '</p>' + dieSvg(face, rolling) +
      '<div class="prize">' + prize + '</div>' + pulls +
      '<div class="row" style="justify-content:center"><button class="btn primary" data-act="draw1"' + (S.tickets && !rolling && !full ? '' : ' disabled') + '>直接掷骰</button>' +
      '<button class="btn" data-act="drawall"' + (S.tickets > 1 && !rolling && !full ? '' : ' disabled') + '>全部掷完（' + S.tickets + '）</button></div>' +
      '<p class="small muted" style="margin:0">持有 ' + S.tickets + ' 张券 · 距保底还剩 ' + Math.max(1, s.pityN - S.pity) + ' 抽</p>' +
      (full ? '<p class="small" style="margin:0;color:var(--brass-hi)">余额已经存满 ' + fmtMin(S.settings.bankCapMin) + '。先去玩一会儿再来抽，抽奖券会一直留着。</p>' : '') +
      (S.tickets ? '' : '<p class="small" style="margin:0">没有券了。开始学习 ' + s.startMin + ' 分钟就能拿到今天的第一张。</p>') + '</section>';
    h += recentHtml();
    h += '<details class="sec pooldet"><summary><h2 style="display:inline">奖池与概率</h2><span class="small muted">　点开查看</span></summary><div class="tablewrap"><table><thead><tr><th>稀有度</th><th class="n">概率</th><th class="n">游戏时间</th></tr></thead><tbody>' +
      s.pool.map(p => '<tr><td><b class="t' + p.k + '" style="font-family:var(--display)">' + rName(p.k) + '</b> <span class="muted small num">' + p.k + '</span></td><td class="n">' + p.p + '%</td><td class="n">' + p.m + ' 分钟</td></tr>').join('') +
      '</tbody></table></div><p class="small muted" style="margin:0">连续 ' + (s.pityN - 1) + ' 抽没出' + rName(s.pool[0].k) + '或' + rName(s.pool[1].k) + '，下一抽必出' + rName(s.pool[1].k) + '。每一抽另有 ' + s.critPct + '% 概率暴击，奖励翻倍。骰面点数只是表现，结果按上表的概率决定。</p></details>';
    return h;
  }
  function doDraw(n) {
    const results = [], ev = [];
    for (let i = 0; i < n; i++) {
      const r = L.draw(S, Math.random); if (!r) break;
      r.n = dieNum(r.k); results.push(r);
      ev.push({ label: '抽奖 ' + rName(r.k) + '（' + r.k + ' 赏）' + (r.crit ? '（暴击）' : '') + (r.pity ? '（保底）' : ''), min: r.got, tix: -1 });
    }
    if (!results.length) return;
    S.undo = null; S.timerBase = null;
    logAppend(ev); save();
    lastDraw = { results, rolling: true }; renderMain();
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const flick = reduce ? null : setInterval(() => { const n = $('#dieNum'); if (n) n.textContent = 1 + Math.floor(Math.random() * 20); }, 70);
    setTimeout(() => {
      if (flick) clearInterval(flick); if (lastDraw) lastDraw.rolling = false; if (view === 'draw') renderMain();
      const legends = results.filter(x => x.k === 'S');
      if (legends.length) setTimeout(() => { const ln = 1 + Math.floor(Math.random() * SPRITES); modal = { type: 'legend', n: ln, line: anyLine(MATES[ln].legend), count: legends.length, min: legends.reduce((a, b) => a + b.got, 0) }; renderLayer(); }, reduce ? 0 : 450);
    }, reduce ? 50 : 1250);
  }

  /* ---------- 页面：流水 ---------- */
  function openLedger() {
    const today = L.dayKey(Date.now());
    logChain = logChain.then(async () => {
      if (!ledgerKeys) {
        let keys = [];
        if (cloud) {
          const q = await stateRef.collection('logs').get();
          q.docs.forEach(d => { const b = clone(d.data()); b.entries = b.entries || []; b.sessions = b.sessions || []; if (!logCache[d.id]) logCache[d.id] = b; keys.push(d.id); });
        } else { const all = localLogs(); keys = Object.keys(all); for (const k of keys) await loadLog(k); }
        if (!keys.includes(today)) keys.push(today);
        ledgerKeys = keys.sort().reverse();
      }
      await loadLog(today);
      if (logView()) renderMain();
    }).catch(() => { ledgerKeys = ledgerKeys || [today]; if (logView()) renderMain(); });
  }
  function viewLedger() {
    if (!ledgerKeys) return '<div class="center"><p class="muted">正在读取流水</p></div>';
    const today = L.dayKey(Date.now());
    let h = '<button class="btn sm ghost" data-act="tab" data-tab="' + backTo + '" style="align-self:flex-start">&#8249; 返回</button>' + pageHead('流水') + '<div class="row spread"><span></span><button class="btn sm" data-act="undo"' + (S.undo ? '' : ' disabled') + '>撤销上一步</button></div>', any = false;
    ledgerKeys.slice(0, 14).forEach(k => {
      const d = logCache[k]; if (!d || (!d.entries.length && !d.sessions.length)) return;
      any = true;
      const studied = Math.floor(d.sessions.reduce((a, b) => a + (b.sec || 0), 0) / 60);
      h += '<section class="sec"><div class="row spread"><h2>' + (k === today ? '今天' : k) + '</h2><span class="small muted">学习 ' + fmtMin(studied) + '</span></div><div>' +
        d.entries.slice().reverse().map(e => '<div class="entry' + (e.undone ? ' undone' : '') + '"><span class="time">' + fmtTime(e.t) + '</span><span class="grow">' + esc(e.label) + '</span><span class="amt">' + amount(e) + '</span></div>').join('') +
        '</div></section>';
    });
    if (!any) h += '<p class="muted">还没有记录。完成第一次学习后，每一笔收入和支出都会出现在这里。</p>';
    return h + '<p class="small muted">这里显示最近 14 天。更早的记录仍然保存着，导出备份时会一起带上。</p>';
  }
  /* ---------- 页面：统计 ---------- */
  const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'], OTHER = '#6b7084';
  const HEAT = ['#104281', '#1c5cab', '#3987e5', '#86b6ef'];
  const kms = k => Date.parse(k + 'T00:00:00Z'), kadd = (k, n) => new Date(kms(k) + n * 86400000).toISOString().slice(0, 10);
  function allSessions() {
    const out = [];
    (ledgerKeys || []).forEach(k => { const d = logCache[k]; if (d) d.sessions.forEach(x => out.push({ day: k, name: x.name || '自由学习', start: x.start || kms(k), sec: x.sec || 0 })); });
    return out;
  }
  // 颜色跟着任务走：按第一次出现的先后固定分配，第 9 个起归入「其他」
  function colorMap(all) {
    const first = {};
    all.forEach(x => { if (!(x.name in first) || x.start < first[x.name]) first[x.name] = x.start; });
    const m = {};
    Object.keys(first).sort((a, b) => first[a] - first[b]).forEach((n, i) => { m[n] = i < SERIES.length ? SERIES[i] : null; });
    return m;
  }
  function statRange(T) {
    if (stat.mode === 'day') { const k = kadd(T, stat.off); return { start: k, end: k, label: k }; }
    if (stat.mode === 'week') { const mon = kadd(T, -((new Date(kms(T)).getUTCDay() + 6) % 7)), st = kadd(mon, 7 * stat.off); return { start: st, end: kadd(st, 6), label: st + ' ~ ' + kadd(st, 6) }; }
    return monthRange(T, stat.off);
  }
  function monthRange(T, off) {
    const d = new Date(kms(T)); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + off);
    const st = d.toISOString().slice(0, 10); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
    return { start: st, end: d.toISOString().slice(0, 10), label: st.slice(0, 7) };
  }
  const tile = (label, value) => '<div><span>' + label + '</span><b class="num">' + value + '</b></div>';
  function viewStats() {
    if (!ledgerKeys) return '<div class="center"><p class="muted">正在读取学习记录</p></div>';
    const T = L.dayKey(Date.now()), all = allSessions(), cm = colorMap(all);
    const sum = list => list.reduce((a, b) => a + b.sec, 0), mins = sec => fmtMin(Math.floor(sec / 60));
    let h = '<button class="btn sm ghost" data-act="tab" data-tab="' + backTo + '" style="align-self:flex-start">&#8249; 返回</button>' + pageHead('冒险记录');
    if (!all.length) return h + '<section class="sec"><p style="margin:0">还没有学习记录。完成第一次计时后，这里会显示你的累计时长、各任务的时间分布和每月的学习日历。</p></section>';
    const firstDay = all.reduce((a, b) => (b.day < a ? b.day : a), T), days = Math.max(1, Math.round((kms(T) - kms(firstDay)) / 86400000) + 1);
    const today = all.filter(x => x.day === T);
    h += '<section class="sec"><h2>累计专注</h2><div class="tiles">' + tile('次数', all.length) + tile('时长', mins(sum(all))) + tile('日均时长', mins(sum(all) / days)) + '</div></section>';
    h += '<section class="sec"><h2>今日专注</h2><div class="tiles two">' + tile('次数', today.length) + tile('时长', mins(sum(today))) + '</div></section>';

    // 时长分布：细分段条 + 带色块的列表
    const r = statRange(T), inR = all.filter(x => x.day >= r.start && x.day <= r.end), by = {};
    inR.forEach(x => { const key = cm[x.name] ? x.name : '其他'; by[key] = (by[key] || 0) + x.sec; });
    const rows = Object.keys(by).map(n => ({ n, sec: by[n], c: cm[n] || OTHER })).sort((a, b) => b.sec - a.sec), tot = sum(inR);
    const lastDay = r.end < T ? r.end : T, elapsed = Math.max(1, Math.round((kms(lastDay) - kms(r.start)) / 86400000) + 1);
    h += '<section class="sec"><div class="row spread"><h2>专注时长分布</h2><div class="row" style="gap:4px"><button class="icon" data-act="stat-nav" data-d="-1" aria-label="上一段">&#8249;</button><button class="icon" data-act="stat-nav" data-d="1" aria-label="下一段"' + (stat.off >= 0 ? ' disabled style="opacity:.3"' : '') + '>&#8250;</button></div></div>' +
      '<div class="row spread"><div class="segctl">' + [['day', '日'], ['week', '周'], ['month', '月']].map(m => '<button data-act="stat-mode" data-m="' + m[0] + '" aria-pressed="' + (stat.mode === m[0]) + '">' + m[1] + '</button>').join('') + '</div><span class="small muted num">' + r.label + '</span></div>';
    if (!tot) h += '<p class="muted" style="margin:0">这段时间没有学习记录。</p>';
    else {
      h += '<div class="split" role="img" aria-label="各任务时长占比">' + rows.map(x => '<i style="width:' + (x.sec / tot * 100).toFixed(2) + '%;background:' + x.c + '" title="' + esc(x.n) + ' ' + mins(x.sec) + '"></i>').join('') + '</div>' +
        '<p class="small" style="margin:0">总计 <strong>' + mins(tot) + '</strong>' + (stat.mode === 'day' ? '' : '　日均 <strong>' + mins(tot / elapsed) + '</strong>') + '</p><div>' +
        rows.map(x => '<div class="lrow"><i class="sw" style="background:' + x.c + '"></i><span class="grow">' + esc(x.n) + '</span><span>' + mins(x.sec) + '</span><span class="muted num" style="min-width:3.6em;text-align:right">' + (x.sec / tot * 100).toFixed(1) + '%</span></div>').join('') + '</div>';
    }
    h += '</section>';

    // 月历热力图 + 时段分布
    const mr = monthRange(T, stat.moff), inM = all.filter(x => x.day >= mr.start && x.day <= mr.end), perDay = {}, hrs = new Array(24).fill(0);
    inM.forEach(x => {
      perDay[x.day] = (perDay[x.day] || 0) + x.sec;
      let t = x.start, left = x.sec;
      while (left > 0) { const loc = t + 9 * 3600e3, use = Math.min(left, 3600 - Math.floor((loc % 3600e3) / 1000)); hrs[new Date(loc).getUTCHours()] += use; left -= use; t += use * 1000; }
    });
    const maxDay = Math.max(0, ...Object.values(perDay)), lead = (new Date(kms(mr.start)).getUTCDay() + 6) % 7, nDays = Number(mr.end.slice(8));
    let cal = ['一', '二', '三', '四', '五', '六', '日'].map(w => '<span class="wd">' + w + '</span>').join('') + '<span class="wd"></span>'.repeat(lead);
    for (let i = 1; i <= nDays; i++) {
      const k = mr.start.slice(0, 8) + pad(i), sec = perDay[k] || 0, lv = sec ? Math.max(1, Math.ceil(sec / maxDay * 4)) : 0, tip = k + '：' + (sec ? mins(sec) : '没有记录');
      cal += '<button class="h' + lv + '" data-act="stat-tip" data-tip="' + tip + '" title="' + tip + '"' + (lv ? ' style="background:' + HEAT[lv - 1] + '"' : '') + '>' + i + '</button>';
    }
    h += '<section class="sec"><div class="row spread"><h2>' + mr.label + ' 学习日历</h2><div class="row" style="gap:4px"><button class="icon" data-act="stat-mnav" data-d="-1" aria-label="上个月">&#8249;</button><button class="icon" data-act="stat-mnav" data-d="1" aria-label="下个月"' + (stat.moff >= 0 ? ' disabled style="opacity:.3"' : '') + '>&#8250;</button></div></div>' +
      '<div class="cal">' + cal + '</div><div class="row spread small muted"><span id="stattip">' + (stat.tip || '点某一天可以看当天的时长') + '</span><span class="row" style="gap:3px">少' + HEAT.map(c => '<i class="sw" style="background:' + c + '"></i>').join('') + '多</span></div>';
    const maxH = Math.max(...hrs);
    if (maxH > 0) {
      const W = 336, H = 110, bw = 10, step = W / 24, peak = hrs.indexOf(maxH);
      let bars = '';
      hrs.forEach((v, i) => {
        const bh = v ? Math.max(2, v / maxH * 80) : 0, x = i * step + (step - bw) / 2;
        if (bh) bars += '<rect x="' + x.toFixed(1) + '" y="' + (90 - bh).toFixed(1) + '" width="' + bw + '" height="' + bh.toFixed(1) + '" rx="2" fill="' + SERIES[0] + '"><title>' + i + ' 点：' + mins(v) + '</title></rect>';
        if (i % 6 === 0 || i === 23) bars += '<text x="' + (x + bw / 2).toFixed(1) + '" y="106" text-anchor="middle">' + i + '</text>';
      });
      h += '<h2 style="font-size:17px">这个月在哪些时段学习</h2><div class="hours"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="按一天 24 小时统计的学习时长"><line x1="0" y1="90.5" x2="' + W + '" y2="90.5"/>' + bars + '</svg></div>' +
        '<p class="small muted" style="margin:0">横轴是几点（东京时间）。学得最多的是 ' + peak + ' 点到 ' + (peak + 1) + ' 点，共 ' + mins(maxH) + '。</p>';
    }
    return h + '</section>';
  }

  /* ---------- 页面：设置 ---------- */
  const FIELDS = [
    ['segMin', '每段学习分钟数'], ['segReward', '每段直接奖励游戏分钟'], ['segTickets', '每段奖励券数'], ['segCap', '每天时长券上限（0 为不限）'], ['bankCapMin', '余额上限分钟（0 为不限）'],
    ['startMin', '启动奖所需分钟'], ['startTickets', '启动奖券数（0 为关闭）'], ['dailyTaskTickets', '每日任务每项券数'], ['dailyAllMin', '每日全清奖励分钟'], ['dailyAllTickets', '每日全清券数'],
    ['weeklyAllMin', '每周全清奖励分钟'], ['weeklyAllTickets', '每周全清券数'],
    ['pityN', '保底抽数'], ['critPct', '暴击概率 %'], ['roundTo', '游戏扣时取整分钟'],
  ];
  function viewSettings() {
    const cur = S.pendingSettings || S.settings, grace = S.created === S.today.key;
    let h = pageHead('设置') +
      '<section class="sec"><h2>记录</h2><div class="row"><button class="btn" data-act="tab" data-tab="stats" data-back="settings">冒险记录（统计）</button><button class="btn" data-act="tab" data-tab="ledger" data-back="settings">全部流水</button></div></section>';
    if (S.pendingSettings) h += '<div class="note row spread"><span>有修改会在下周一 4:00 生效，下面显示的是修改后的数值。</span><button class="btn sm" data-act="cancel-pending">取消这次修改</button></div>';
    h += '<section class="sec"><h2>奖励数值</h2><p class="small muted" style="margin:0">' + (grace ? '今天是开始使用的第一天，修改立刻生效。' : '为了不让自己临时改规则，修改从下周一 4:00 开始生效。') + '</p><div class="grid2">' +
      FIELDS.map(f => '<label class="field">' + f[1] + '<input type="number" inputmode="decimal" min="0" step="any" id="set-' + f[0] + '" value="' + cur[f[0]] + '"></label>').join('') + '</div></section>';
    h += '<section class="sec"><h2>奖池</h2><div class="inline small muted"><span>稀有度</span><span>概率 %</span><span>分钟</span></div>' +
      cur.pool.map((p, i) => '<div class="inline"><b class="t' + p.k + '" style="font-family:var(--display)">' + rName(p.k) + '</b><input type="number" inputmode="decimal" min="0" step="any" id="pool-p-' + i + '" value="' + p.p + '" aria-label="' + p.k + ' 赏概率"><input type="number" inputmode="decimal" min="0" step="any" id="pool-m-' + i + '" value="' + p.m + '" aria-label="' + p.k + ' 赏分钟"></div>').join('') +
      '<p class="small" id="seterr" style="margin:0;color:var(--warn)"></p><div class="row"><button class="btn primary" data-act="save-settings">保存设置</button><button class="btn ghost" data-act="reset-settings">填回默认值</button></div></section>';
    h += '<section class="sec"><h2>备份</h2><p class="small muted" style="margin:0">' + (cloud ? '数据保存在云端，多台设备会自动同步。' : '数据只保存在这台设备的这个浏览器里，换设备或清除 Safari 数据会丢失。') + '建议每周导出一次备份，存到“文件”App 或 iCloud，需要时再导入恢复。</p><div class="row">' +
      '<button class="btn" data-act="export">导出备份</button><label class="btn" for="importfile" tabindex="0">导入备份</label><input type="file" id="importfile" accept=".json,application/json" hidden></div></section>';
    h += '<section class="sec"><h2>关于</h2><p style="margin:0"><b class="num" style="color:var(--brass-hi)">版本 ' + APP_VERSION + '</b> <span class="small muted">· ' + (cloud ? 'Claude 版' : '独立版') + ' · ' + APP_DATE + '</span></p><p class="small muted" style="margin:0">本页为免费的非官方同人作品，与 Larian Studios、Wizards of the Coast 无关，未经其批准或认可。同伴角色及其名称属于《博德之门 3》，版权归 Larian Studios 及 Wizards of the Coast 所有。</p>' +
      '<p class="small muted" style="margin:0" lang="en">学习抽卡银行 (Study Gacha Bank) is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. &copy;Wizards of the Coast LLC. Baldur&#39;s Gate 3 characters &copy; Larian Studios. This is free, non-commercial fan content and is not affiliated with Larian Studios.</p></section>';
    return h;
  }
  function readSettings() {
    const s = clone(S.settings);
    FIELDS.forEach(f => { s[f[0]] = Number($('#set-' + f[0]).value); if ($('#set-' + f[0]).value === '') s[f[0]] = NaN; });
    s.pool = s.pool.map((p, i) => ({ k: p.k, p: Number($('#pool-p-' + i).value), m: Number($('#pool-m-' + i).value) }));
    return s;
  }
  function saveSettings() {
    const s = readSettings(), err = L.settingsError(s);
    if (err) { $('#seterr').textContent = err; return; }
    const u = begin('修改设置');
    if (JSON.stringify(s) === JSON.stringify(S.settings)) { S.pendingSettings = null; toast('数值和现在一样，没有需要修改的。'); }
    else if (S.created === S.today.key) { S.settings = s; S.pendingSettings = null; toast('设置已保存，立刻生效。'); }
    else { S.pendingSettings = s; toast('设置已保存，下周一 4:00 生效。'); }
    S.undo = u; save(); renderMain();
  }
  async function exportBackup() {
    let logs = {};
    try {
      if (cloud) { const q = await stateRef.collection('logs').get(); q.docs.forEach(d => { logs[d.id] = d.data(); }); }
      else logs = localLogs();
    } catch (e) { toast('读取流水失败，备份里只包含当前余额和任务。'); }
    const data = JSON.stringify({ app: 'study-gacha-bank', v: 1, exported: new Date().toISOString(), state: S, logs }, null, 1);
    const filename = 'study-bank-backup-' + L.dayKey(Date.now()) + '.json';
    if (downloads) {
      try { await downloads.save({ filename, data }); toast('备份已交给浏览器保存。'); return; } catch (e) { }
    }
    modal = { type: 'copy', data }; renderLayer();
  }
  function importBackup(file) {
    const fr = new FileReader();
    fr.onload = () => {
      let b = null; try { b = JSON.parse(fr.result); } catch (e) { }
      if (!b || !b.state || !Array.isArray(b.state.tasks) || !b.state.settings || !b.state.today || !b.state.week) { toast('这个文件不是本页导出的备份，没有导入。'); return; }
      confirmBox('用备份覆盖现在的数据？', '备份时间：' + esc(b.exported || '未知') + '<br>备份里的余额：' + fmtMin(b.state.bank || 0) + '，抽奖券 ' + (b.state.tickets || 0) + ' 张。<br><span class="small muted">现在的余额、任务和设置会被备份里的内容替换。</span>', '覆盖并导入', () => {
        S = b.state; S.timer = null; L.migrate(S); checkRollover(Date.now()); save();
        Object.keys(logCache).forEach(k => delete logCache[k]); ledgerKeys = null;
        const logs = b.logs || {};
        logChain = logChain.then(async () => { for (const k of Object.keys(logs)) { logCache[k] = logs[k]; await writeLog(k); } }).catch(() => { toast('有一部分流水没能导入。'); });
        toast('已导入备份。'); render();
      });
    };
    fr.readAsText(file);
  }

  /* ---------- 弹层 ---------- */
  function confirmBox(title, html, okLabel, fn) { modal = { type: 'confirm', title, html, okLabel, fn }; renderLayer(); }
  function closeModal() { modal = null; renderLayer(); renderMain(); }
  function modalHtml() {
    const m = modal; let b = '';
    if (m.type === 'legend') {
      const mt = MATES[m.n];
      return '<div class="scrim legend" data-act="m-scrim"><div class="cheer" role="dialog" aria-modal="true" aria-label="抽到传说">' +
        '<div class="rays" aria-hidden="true"></div><img src="' + spr(m.n) + '" alt="' + mt.name + '">' +
        '<div class="ctier tS">传说' + (m.count > 1 ? ' ×' + m.count : '') + '</div><div class="cmin">+' + m.min + ' 分钟</div>' +
        '<p><span class="who">' + mt.name + '</span>' + m.line + '</p><button class="btn primary" data-act="m-close">收下</button></div></div>';
    }
    if (m.type === 'sp-confirm') return spConfirmHtml(m);
    if (m.type === 'sp-new') b = spNewHtml(m);
    else if (m.type === 'confirm') b = '<h3>' + m.title + '</h3><p style="margin:0">' + m.html + '</p><div class="row"><button class="btn primary" data-act="m-ok">' + m.okLabel + '</button><button class="btn ghost" data-act="m-close">取消</button></div>';
    else if (m.type === 'adjust') b = '<h3>这次计时超过 3 小时</h3><p style="margin:0">计时器显示 ' + fmtMin(Math.floor(m.sec / 60)) + '。如果中途忘了停，可以改成实际的分钟数。</p><label class="field">实际分钟数<input type="number" inputmode="numeric" min="0" id="adj" value="' + Math.floor(m.sec / 60) + '"></label><div class="row"><button class="btn primary" data-act="m-adjust">确认并结束</button><button class="btn ghost" data-act="m-close">继续计时</button></div>';
    else if (m.type === 'deduct') b = '<h3>手动扣除游戏时间</h3><p class="muted small" style="margin:0">忘记开计时就玩了的时候用。现在余额 ' + fmtMin(S.bank) + '。</p><label class="field">扣除分钟数<input type="number" inputmode="numeric" min="1" id="ded"></label><p class="small" id="merr" style="margin:0;color:var(--warn)"></p><div class="row"><button class="btn primary" data-act="m-deduct">扣除</button><button class="btn ghost" data-act="m-close">取消</button></div>';
    else if (m.type === 'copy') b = '<h3>复制备份内容</h3><p class="muted small" style="margin:0">这里没法直接下载文件。请复制下面的内容，粘贴到一个文本文件里保存，文件名以 .json 结尾。</p><textarea id="copyta" readonly style="width:100%;height:160px;background:var(--ink);color:var(--text);border:1px solid var(--line);border-radius:10px;padding:10px;font-size:12px"></textarea><div class="row"><button class="btn primary" data-act="m-copy">复制</button><button class="btn ghost" data-act="m-close">关闭</button></div>';
    else if (m.type === 'task') {
      const x = m.task, isNew = !m.id, g = L.GROUPS.find(q => q.id === x.group), per = g.period;
      const deferred = (x.group === 'daily' || x.group === 'weekly' || x.group === 'extra') && S.created !== S.today.key;
      const next = per === 'day' ? '明天' : '下周';
      let note = '';
      if (per !== 'once' && deferred && x.group !== 'extra') note = isNew ? '新任务从' + next + '开始计入奖励。' : '完成条件的修改和删除从' + next + '开始生效，名称和计时方式立刻生效。';
      b = '<h3>' + (isNew ? '添加任务到「' + g.name + '」' : '修改任务') + '</h3>' +
        '<label class="field">名称<input type="text" id="t-name" maxlength="40" value="' + esc(x.name) + '"></label>' +
        '<label class="field">计时方式<select id="t-mode"><option value="up"' + (x.mode === 'up' ? ' selected' : '') + '>正计时</option><option value="down"' + (x.mode === 'down' ? ' selected' : '') + '>倒计时</option><option value="pomo"' + (x.mode === 'pomo' ? ' selected' : '') + '>番茄钟（25 分钟）</option></select></label>' +
        '<label class="field">倒计时分钟数（只在倒计时方式下使用）<input type="number" inputmode="numeric" min="1" id="t-down" value="' + x.downMin + '"></label>';
      if (per !== 'once') b += '<label class="check"><input type="checkbox" id="t-manual"' + (x.manual ? ' checked' : '') + '>手动勾选（用于上课这类没法计时的任务）</label>' +
        '<div class="grid2"><label class="field">累计多少分钟算完成一次<input type="number" inputmode="numeric" min="1" id="t-th" value="' + x.threshold + '"></label>' +
        '<label class="field">' + (per === 'day' ? '每天' : '每周') + '目标次数<input type="number" inputmode="numeric" min="1" id="t-tg" value="' + x.target + '"></label></div>';
      b += (note ? '<p class="small muted" style="margin:0">' + note + '</p>' : '') + '<p class="small" id="merr" style="margin:0;color:var(--warn)"></p>' +
        '<div class="row"><button class="btn primary" data-act="m-task-save">保存</button><button class="btn ghost" data-act="m-close">取消</button>' + (isNew ? '' : '<span class="grow"></span><button class="btn ghost danger" data-act="m-task-del">删除任务</button>') + '</div>';
    }
    return '<div class="scrim" data-act="m-scrim"><div class="sheet" role="dialog" aria-modal="true">' + b + '</div></div>';
  }
  function saveTask() {
    const m = modal, name = $('#t-name').value.trim(), err = $('#merr');
    if (!name) { err.textContent = '请给任务起个名字。'; return; }
    const mode = $('#t-mode').value, downMin = Math.max(1, Math.round(Number($('#t-down').value) || 25));
    const g = L.GROUPS.find(q => q.id === m.task.group), per = g.period, now = Date.now(), grace = S.created === S.today.key;
    const cond = per === 'once' ? {} : { manual: $('#t-manual').checked, threshold: Math.max(1, Math.round(Number($('#t-th').value) || 10)), target: Math.max(1, Math.round(Number($('#t-tg').value) || 1)) };
    const strict = (g.id === 'daily' || g.id === 'weekly') && !grace;
    const nextKey = per === 'day' ? L.nextDayKey(now) : L.nextWeekKey(now);
    const u = begin((m.id ? '修改任务：' : '添加任务：') + name);
    if (!m.id) {
      if ((g.id === 'daily' || g.id === 'weekly') && S.tasks.filter(x => x.group === g.id && !x.endAt).length >= 6) { err.textContent = '「' + g.name + '」最多放 6 个任务。任务少一点，更容易全部完成。'; return; }
      S.seq = (S.seq || 0) + 1;
      S.tasks.push(L.newTask('t' + S.seq, name, g.id, Object.assign({ mode, downMin, activeFrom: strict ? nextKey : null }, cond)));
    } else {
      const x = S.tasks.find(q => q.id === m.id); if (!x) { closeModal(); return; }
      x.name = name; x.mode = mode; x.downMin = downMin;
      if (per !== 'once') {
        const changed = cond.manual !== x.manual || cond.threshold !== x.threshold || cond.target !== x.target;
        if (strict && L.isActive(S, x)) x.pending = changed ? Object.assign({ from: nextKey }, cond) : x.pending;
        else Object.assign(x, cond);
      }
    }
    const ev = L.settle(S); logAppend(ev); celebrate(ev);
    S.undo = u; save(); closeModal();
  }
  function deleteTask() {
    const m = modal, x = S.tasks.find(q => q.id === m.id); if (!x) { closeModal(); return; }
    const g = L.groupOf(x), strict = (g.id === 'daily' || g.id === 'weekly') && S.created !== S.today.key && L.isActive(S, x);
    const next = g.period === 'day' ? '明天' : '下周';
    confirmBox('删除「' + esc(x.name) + '」？', strict ? '它会保留到这个周期结束，' + next + '起不再出现。已经记录的学习时间不受影响。' : '已经记录的学习时间和奖励不受影响。', '删除', () => {
      const ev = act('删除任务：' + x.name, () => {
        if (strict) x.endAt = g.period === 'day' ? L.nextDayKey(Date.now()) : L.nextWeekKey(Date.now());
        else S.tasks = S.tasks.filter(q => q.id !== x.id);
        const e = L.settle(S); logAppend(e); return e;
      });
      celebrate(ev); save(); render();
    });
  }

  /* ---------- 渲染 ---------- */
  function viewOnboard() {
    const st = L.initialState(Date.now());
    return '<div class="center" style="align-items:stretch;text-align:left;max-width:520px;margin:0 auto"><h1 style="font-size:30px;color:var(--brass-hi)">学习抽卡银行</h1>' +
      '<p style="margin:0">学习换游戏时间和抽奖券。只有奖励，没有惩罚：已经拿到的时间不会过期，也不会被扣掉。</p>' +
      (cloud ? '' : '<div class="note">数据会保存在这台设备的浏览器里。已有备份的话，开始后到“设置”导入即可。</div>') +
      '<section class="sec"><h2>会先放进这些任务</h2>' + L.GROUPS.map(g => '<div class="small"><span class="muted">' + g.name + '：</span>' + st.tasks.filter(x => x.group === g.id).map(x => esc(x.name)).join('、') + '</div>').join('') +
      '<p class="small muted" style="margin:0">任务之后都可以改。第一天的修改立刻生效。</p></section>' +
      '<button class="btn primary" data-act="create">开始使用，领取 55 分钟测试礼包</button></div>';
  }
  function renderMain() {
    const top = main.scrollTop;
    tabs.hidden = phase !== 'ready';
    if (phase === 'loading') return;
    if (phase === 'error') { main.innerHTML = '<div class="center"><h1>读取不到数据</h1><p class="muted">请检查网络并确认已经登录，然后重新打开这个页面。你的数据仍然保存在云端。</p></div>'; return; }
    if (phase === 'onboard') { main.innerHTML = viewOnboard(); return; }
    main.innerHTML = view === 'draw' ? viewDraw() : view === 'stats' ? viewStats() : view === 'ledger' ? viewLedger() : view === 'settings' ? viewSettings() : viewToday();
    const cur = view === 'stats' || view === 'ledger' ? backTo : view;
    tabs.querySelectorAll('button').forEach(b => { if (b.dataset.tab === cur) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    main.scrollTop = top;
    partySetup();
    updateClock(Date.now());
  }
  function renderLayer() {
    let h = '';
    if (phase === 'ready' && S && S.timer && overlayOpen) {
      const t = S.timer;
      h += '<div class="overlay' + (t.kind === 'play' ? ' play' : '') + (t.paused ? ' paused' : '') + '"><button class="btn ghost sm close" data-act="ov-close">收起</button>' +
        '<div class="task">' + esc(t.name) + '</div><div class="circle"><svg viewBox="0 0 100 100" aria-hidden="true">' + RUNES + '<circle class="track" cx="50" cy="50" r="41"/><circle class="arc" id="arc" cx="50" cy="50" r="41" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg><div class="clock" id="clock"></div><img class="mate" data-act="poke" src="' + spr(1 + Math.floor((t.began || 0) / 1000) % SPRITES) + '" alt="' + MATES[1 + Math.floor((t.began || 0) / 1000) % SPRITES].name + '"></div><div class="hint" id="hint"></div>' +
        '<div class="row" style="justify-content:center"><button class="btn" data-act="pause">' + (t.paused ? '继续' : '暂停') + '</button><button class="btn primary" data-act="stop">结束</button></div><button class="btn ghost sm" data-act="abandon">放弃这次计时</button></div>';
    }
    if (modal) h += modalHtml();
    layer.innerHTML = h;
    if (modal && modal.type === 'copy') { const ta = $('#copyta'); if (ta) ta.value = modal.data; }
    updateClock(Date.now());
  }
  function render() { renderMain(); if (!modal) renderLayer(); }
  function setView(v) { view = v; lastDraw = v === 'draw' ? lastDraw : null; if (v === 'ledger' || v === 'stats' || v === 'draw') openLedger(); main.scrollTop = 0; renderMain(); }

  /* ---------- 事件 ---------- */
  const ACT = {
    tab: el => { if (el.dataset.back) backTo = el.dataset.back; setView(el.dataset.tab); },
    retry: () => { saveErr = false; save(); renderMain(); },
    create: async () => {
      // 新建之前再确认一次云端确实没有数据，避免把已有的余额盖掉
      if (cloud) {
        try { const snap = await stateRef.get(); if (snap.exists) { S = clone(snap.data()); confirmed = true; if (L.migrate(S)) save(); phase = 'ready'; checkRollover(Date.now()); render(); toast('找到了你已有的数据，已经直接读取。'); return; } }
        catch (e) { toast('暂时连不上云端，请稍后再点一次。'); return; }
      }
      S = L.initialState(Date.now()); phase = 'ready'; confirmed = true; save(); logAppend([{ label: '测试礼包', min: 55, tix: 0 }]); render(); toast('银行开好了，里面有 55 分钟。'); },
    play: () => startTimer('play'),
    free: () => startTimer('study', null),
    start: el => startTimer('study', S.tasks.find(x => x.id === el.dataset.id)),
    check: el => { const x = S.tasks.find(q => q.id === el.dataset.id); if (!x) return; const ev = act('勾选：' + x.name, () => { const e = L.manualCheck(S, x.id); logAppend(e); return e; }); save(); render(); celebrate(ev); },
    'temp-done': el => {
      const x = S.tasks.find(q => q.id === el.dataset.id); if (!x) return;
      const s = S.settings, enough = (x.totalSec || 0) >= s.tempMinMin * 60;
      const msg = enough ? (S.today.tempReward ? '今天已经领过临时任务的券了，这次不再发券。' : '完成后获得 ' + s.tempTickets + ' 张抽奖券。') : '这个任务累计计时还不到 ' + s.tempMinMin + ' 分钟，现在完成不会发券。';
      confirmBox('完成「' + esc(x.name) + '」？', msg + '<br><span class="small muted">完成后它会从列表里移走。</span>', '完成', () => { const ev = act('完成临时任务：' + x.name, () => { const e = L.completeTemp(S, x.id); logAppend(e); return e; }); save(); render(); celebrate(ev); });
    },
    collapse: el => { collapsed[el.dataset.g] = !collapsed[el.dataset.g]; renderMain(); },
    add: el => { modal = { type: 'task', id: null, task: L.newTask('', '', el.dataset.g) }; renderLayer(); const n = $('#t-name'); if (n) n.focus(); },
    edit: el => { const x = S.tasks.find(q => q.id === el.dataset.id); if (!x) return; const view = Object.assign({}, x, x.pending || {}); modal = { type: 'task', id: x.id, task: view }; renderLayer(); },
    deduct: () => { modal = { type: 'deduct' }; renderLayer(); const n = $('#ded'); if (n) n.focus(); },
    'ov-open': () => { overlayOpen = true; renderLayer(); },
    'ov-close': () => { overlayOpen = false; renderLayer(); },
    pause: pauseTimer, stop: stopTimer,
    'sp-add': () => { modal = { type: 'sp-new', draft: { name: '', date: '', gap: false, gapDays: '3', gapAmt: '', gapType: 'min', bonus: '', bonusType: 'min', items: [{ name: '', amt: '', type: 'min', cond: '', showCond: false }] } }; renderLayer(); },
    'sp-more': () => { spDraftRead(); modal.draft.items.push({ name: '', amt: '', type: 'min', cond: '', showCond: false }); renderLayer(); const n = modal.draft.items.length - 1, el = $('#sp-n' + n); if (el) el.focus(); },
    'sp-rm': el => { spDraftRead(); modal.draft.items.splice(Number(el.dataset.i), 1); renderLayer(); },
    'sp-cond': el => { spDraftRead(); modal.draft.items[Number(el.dataset.i)].showCond = true; renderLayer(); const c = $('#sp-c' + el.dataset.i); if (c) c.focus(); },
    'sp-save': spSave,
    'sp-start': el => { const it = L.findSpecialItem(S, el.dataset.i); if (it) startTimer('study', { id: it.id, name: it.name, mode: 'up', downMin: 25 }); },
    'sp-done': el => { modal = { type: 'sp-confirm', step: 'ask', gid: el.dataset.g, iid: el.dataset.i, n: 1 + Math.floor(Math.random() * SPRITES) }; renderLayer(); },
    'sp-del': el => {
      const g = S.specials.find(x => x.id === el.dataset.id); if (!g) return;
      confirmBox('删除这个特别任务？', '「' + esc(g.name || g.items.map(x => x.name).join('、')) + '」会从列表里拿掉。已经领到的奖励不会收回。', '删除', () => {
        act('删除特别任务', () => { S.specials = S.specials.filter(x => x.id !== g.id); }); save(); renderMain(); toastUndo('已删除。');
      });
    },
    'alarm-stop': () => { alarmClose(); stopTimer(); },
    'alarm-snooze': () => { alarmClose(); toast('好，超出 5 分钟时会再提醒一次。', 5000); },
    draw1: () => doDraw(1), drawall: () => doDraw(S.tickets),
    undo: askUndo, abandon: abandonTimer,
    'stat-mode': el => { stat.mode = el.dataset.m; stat.off = 0; renderMain(); },
    'stat-nav': el => { stat.off = Math.min(0, stat.off + Number(el.dataset.d)); renderMain(); },
    'stat-mnav': el => { stat.moff = Math.min(0, stat.moff + Number(el.dataset.d)); stat.tip = ''; renderMain(); },
    'stat-tip': el => { stat.tip = el.dataset.tip; const t = $('#stattip'); if (t) t.textContent = stat.tip; },
    'save-settings': saveSettings,
    'reset-settings': () => { const d = L.defaultSettings(); FIELDS.forEach(f => { $('#set-' + f[0]).value = d[f[0]]; }); d.pool.forEach((p, i) => { $('#pool-p-' + i).value = p.p; $('#pool-m-' + i).value = p.m; }); $('#seterr').textContent = '已填回默认值，点保存设置后才会生效。'; },
    'cancel-pending': () => { S.pendingSettings = null; save(); renderMain(); },
    export: exportBackup,
    'm-close': closeModal,
    poke: el => { el.classList.remove('hop'); void el.offsetWidth; el.classList.add('hop'); try { if (navigator.vibrate) navigator.vibrate(15); } catch (e) {} el.addEventListener('animationend', () => el.classList.remove('hop'), { once: true }); },
    mate: el => { const m = MATES[Number(el.dataset.n)]; if (m) toast('<b style="font-family:var(--display)">' + m.name + '</b>　' + esc(anyLine(m.idle.concat(m.go))), 5000); },
    'm-scrim': (el, e) => { if (e.target === el) closeModal(); },
    'm-ok': () => { const fn = modal.fn; modal = null; renderLayer(); fn(); },
    'm-adjust': () => { const v = Math.max(0, Math.round(Number($('#adj').value) || 0)); modal = null; finishTimer(v * 60); renderLayer(); },
    'm-deduct': () => {
      const v = Math.round(Number($('#ded').value));
      if (!(v > 0)) { $('#merr').textContent = '请输入大于 0 的分钟数。'; return; }
      const spent = act('手动扣除 ' + v + ' 分钟', () => { const sp = L.spend(S, v); if (sp) logAppend([{ label: '手动扣除游戏时间', min: -sp, tix: 0 }]); return sp; });
      save(); closeModal(); toast('已扣除 ' + spent + ' 分钟。' + (S.bank < 0 ? '现在' + fmtMin(S.bank) + '。' : ''));
    },
    'm-copy': async () => { try { await navigator.clipboard.writeText(modal.data); toast('已复制。'); } catch (e) { const ta = $('#copyta'); ta.focus(); ta.select(); toast('请手动全选并复制。'); } },
    'm-task-save': saveTask, 'm-task-del': deleteTask,
  };
  window.APP_VERSION = APP_VERSION;
  window.appToast = (h, ms) => toast(h, ms, true);
  document.addEventListener('pointerdown', () => { try { if (S && S.timer && S.timer.kind === 'play') { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } } catch (e) {} }, true);
  document.addEventListener('click', e => {
    const tab = e.target.closest('#tabs button'); if (tab) { setView(tab.dataset.tab); return; }
    const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
    const fn = ACT[el.dataset.act]; if (fn && (S || el.dataset.act === 'create')) fn(el, e);
  });
  document.addEventListener('change', e => { if (e.target.id === 'importfile' && e.target.files[0]) { importBackup(e.target.files[0]); e.target.value = ''; } });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal) closeModal();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('label[for="importfile"]')) { e.preventDefault(); $('#importfile').click(); }
  });

  setInterval(() => {
    if (phase !== 'ready' || !S) return;
    const now = Date.now();
    if (checkRollover(now)) render();
    if (S.timer) {
      updateClock(now); tryCheckpoint(now); checkRemind(now);
      const m = Math.floor(now / 60000);
      if (m !== lastMin) { lastMin = m; if (view === 'today' && !modal) renderMain(); }
    }
  }, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S && phase === 'ready') { checkRollover(Date.now()); render(); checkRemind(Date.now()); } });

  boot();
})();
