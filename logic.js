/* 学习抽卡银行：纯逻辑（不碰页面），页面和测试共用 */
(function (root) {
  const DAY = 86400000;
  const GROUPS = [
    { id: 'daily', name: '每日', period: 'day' },
    { id: 'weekly', name: '每周', period: 'week' },
    { id: 'extra', name: '非必要', period: 'week' },
  ];

  // 一天从东京时间 4:00 开始；一周从周一 4:00 开始
  function dayKey(ms) { return new Date(ms + 5 * 3600e3).toISOString().slice(0, 10); }
  function weekKey(ms) {
    const d = new Date(ms + 5 * 3600e3);
    const dow = (d.getUTCDay() + 6) % 7;
    return new Date(d.getTime() - dow * DAY).toISOString().slice(0, 10);
  }
  function nextDayKey(ms) { return dayKey(ms + DAY); }
  function nextWeekKey(ms) { return weekKey(ms + 7 * DAY); }

  function defaultSettings() {
    return {
      segMin: 30, segReward: 0, segTickets: 1, segCap: 0, bankCapMin: 2880,
      startMin: 10, startTickets: 1,
      dailyTaskTickets: 0, dailyAllMin: 0, dailyAllTickets: 1,
      weeklyAllMin: 0, weeklyAllTickets: 5,
      tempTickets: 1, tempMinMin: 10,
      pityN: 10, critPct: 5, roundTo: 5,
      pool: [
        { k: 'S', p: 2, m: 120 }, { k: 'A', p: 8, m: 60 }, { k: 'B', p: 20, m: 30 },
        { k: 'C', p: 30, m: 15 }, { k: 'D', p: 40, m: 10 },
      ],
    };
  }

  function newTask(id, name, group, extra) {
    return Object.assign({
      id, name, group, mode: 'up', downMin: 25, target: 1, threshold: 10,
      manual: false, startDate: null, endDate: null, totalSec: 0,
    }, extra || {});
  }

  function freshDay(key) {
    return { key, totalSec: 0, segs: 0, start: false, taskSec: {}, manual: {}, rewarded: {}, allBonus: false, tempReward: false };
  }
  function freshWeek(key) { return { key, taskSec: {}, manual: {}, bonus: false }; }

  function initialState(now) {
    const names = [
      ['每日任务 A', 'daily'], ['每日任务 B', 'daily'],
      ['每周任务 A', 'weekly'], ['每周任务 B', 'weekly'],
      ['非必要任务 A', 'extra'],
    ];
    const st = {
      v: 7, specials: [], scheduled: [], created: dayKey(now), bank: 55, tickets: 0, pity: 0, seq: names.length,
      tasks: names.map((n, i) => newTask('t' + (i + 1), n[0], n[1])),
      settings: defaultSettings(), timer: null, credit: { score: CREDIT_START, day: dayKey(now), prevBank: 55 },
      today: freshDay(dayKey(now)), week: freshWeek(weekKey(now)),
    };
    newSpecial(st, { items: [{ name: '完成一件今天想做的事', tix: 1 }] }, now);
    return st;
  }

  function groupOf(task) { return GROUPS.find(g => g.id === task.group) || GROUPS.find(g => g.id === 'extra'); }

  function periodOf(state, task) {
    const p = groupOf(task).period;
    return p === 'day' ? state.today : p === 'week' ? state.week : null;
  }

  // 任务只在开始日期到结束日期之间算数（都不填就一直算）
  function isActive(state, task) {
    const today = state.today.key;
    return (!task.startDate || task.startDate <= today) && (!task.endDate || task.endDate >= today);
  }
  function isEnded(state, task) { return !!task.endDate && task.endDate < state.today.key; }

  function taskSec(state, task) {
    const per = periodOf(state, task);
    return per ? (per.taskSec[task.id] || 0) : (task.totalSec || 0);
  }

  function taskCount(state, task) {
    const per = periodOf(state, task);
    const target = Math.max(1, task.target || 1);
    if (!per) return 0;
    if (task.manual) return Math.min(target, per.manual[task.id] || 0);
    return Math.min(target, Math.floor(taskSec(state, task) / (Math.max(1, task.threshold) * 60)));
  }
  function taskDone(state, task) { return taskCount(state, task) >= Math.max(1, task.target || 1); }

  // ---------- 信用（借着玩）----------
  // 只看还款趋势：每天 4:00 换日时，按前一天结束时的余额加减分。掉得慢、涨得快；只限制借，不扣已经拿到的东西
  // 没欠 +3；欠着但比前一天少 +1；欠着没变少 -2；欠超过 3 小时再 -2；欠账还清的那天再 +10。分数 0–100，从 70 开始
  const CREDIT_START = 70;
  // 信用规则可以在设置里改（settings.credit）；没有设置时用默认值。三个预设：宽松 / 默认 / 严格
  const CREDIT_PRESETS = {
    loose: { borrow: true, useCredit: true, plusClear: 3, plusRepay: 2, minusStuck: 1, deepMin: 300, minusDeep: 1, clearBonus: 15, watchBelow: 40, pauseBelow: 20, watchLimit: 180, remindMin: 120 },
    normal: { borrow: true, useCredit: true, plusClear: 3, plusRepay: 1, minusStuck: 2, deepMin: 180, minusDeep: 2, clearBonus: 10, watchBelow: 50, pauseBelow: 30, watchLimit: 120, remindMin: 120 },
    strict: { borrow: true, useCredit: true, plusClear: 2, plusRepay: 1, minusStuck: 3, deepMin: 120, minusDeep: 3, clearBonus: 8, watchBelow: 60, pauseBelow: 40, watchLimit: 60, remindMin: 60 },
  };
  function creditCfg(state) { return Object.assign({}, CREDIT_PRESETS.normal, (state && state.settings && state.settings.credit) || {}); }
  function creditError(c) {
    const nums = ['plusClear', 'plusRepay', 'minusStuck', 'deepMin', 'minusDeep', 'clearBonus', 'watchBelow', 'pauseBelow', 'watchLimit', 'remindMin'];
    if (nums.some(k => !Number.isFinite(c[k]) || c[k] < 0)) return '有一项数值为空或为负数，请检查。';
    if (!(c.pauseBelow < c.watchBelow && c.watchBelow <= 80)) return '「暂停借款」的分数要低于「注意」，「注意」最高 80。';
    if (c.remindMin < 10) return '提醒间隔至少 10 分钟。';
    return '';
  }
  function ensureCredit(state) {
    if (!state.credit || typeof state.credit.score !== 'number') state.credit = { score: CREDIT_START, day: state.today ? state.today.key : null, prevBank: state.bank || 0 };
    return state.credit;
  }
  function creditTier(score, cfg) {
    const k = cfg || CREDIT_PRESETS.normal;
    return score < k.pauseBelow ? 'paused' : score < k.watchBelow ? 'watch' : score >= 80 ? 'great' : 'good';
  }
  function creditDay(c, endBank, k) {
    let d = endBank >= 0 ? k.plusClear : (endBank > c.prevBank ? k.plusRepay : -k.minusStuck);
    if (endBank < -k.deepMin) d -= k.minusDeep;
    if (c.prevBank < 0 && endBank >= 0) d += k.clearBonus;
    c.score = Math.max(0, Math.min(100, c.score + d)); c.prevBank = endBank;
  }
  function updateCredit(state, now) {
    const c = ensureCredit(state), today = dayKey(now);
    if (!c.day) { c.day = today; c.prevBank = state.bank; return; }
    if (c.day >= today) return;
    const n = Math.min(7, Math.round((Date.parse(today) - Date.parse(c.day)) / DAY)); // 很多天没打开，最多补算 7 天
    const k = creditCfg(state);
    for (let i = 0; i < n; i++) creditDay(c, state.bank, k);
    c.day = today;
  }
  // 能不能借着玩：只在余额 <= 0 时才需要问
  function canBorrow(state) {
    const k = creditCfg(state);
    if (!k.borrow) return { ok: false, why: 'off' };
    if (!k.useCredit) return { ok: true };
    const tier = creditTier(ensureCredit(state).score, k);
    if (tier === 'paused') return { ok: false, why: 'paused' };
    if (tier === 'watch' && state.bank <= -k.watchLimit) return { ok: false, why: 'limit' };
    return { ok: true };
  }

  // 换日 / 换周：重置进度，然后执行到期的"准备生效"修改
  function rollover(state, now) {
    let changed = false;
    const dk = dayKey(now), wk = weekKey(now);
    if (state.today.key !== dk) updateCredit(state, now);
    if (state.today.key !== dk) { state.today = freshDay(dk); changed = true; }
    if (state.week.key !== wk) { state.week = freshWeek(wk); changed = true; }
    if (applyScheduled(state, now)) changed = true;
    return changed;
  }

  // ---------- 准备生效的修改（排队）----------
  // 每一条：{ id, at: 'YYYY-MM-DD'（那天 4:00 生效）, type, data, made }
  // type：settings / task-add / task-edit / task-del / sp-add / sp-edit / sp-del。可以排好几条，按日期先后执行
  const TASK_FIELDS = ['name', 'mode', 'downMin', 'manual', 'threshold', 'target', 'startDate', 'endDate'];
  function schedule(state, at, type, data, now) {
    if (!Array.isArray(state.scheduled)) state.scheduled = [];
    state.seq = (state.seq || 0) + 1;
    const q = { id: 'q' + state.seq, at, type, data: JSON.parse(JSON.stringify(data)), made: dayKey(now) };
    state.scheduled.push(q); return q;
  }
  function cancelScheduled(state, id) { state.scheduled = (state.scheduled || []).filter(q => q.id !== id); }
  function applyOne(state, q, now) {
    const d = q.data;
    if (q.type === 'settings') state.settings = d.patch ? Object.assign({}, state.settings, JSON.parse(JSON.stringify(d.patch))) : d.settings;
    else if (q.type === 'task-add') { state.seq = (state.seq || 0) + 1; state.tasks.push(newTask('t' + state.seq, d.name, d.group, pickFields(d))); }
    else if (q.type === 'task-edit') { const t = state.tasks.find(x => x.id === d.id); if (t) Object.assign(t, pickFields(d.fields)); }
    else if (q.type === 'task-del') state.tasks = state.tasks.filter(x => x.id !== d.id);
    else if (q.type === 'sp-add') newSpecial(state, d.spec, now);
    else if (q.type === 'sp-edit') updateSpecial(state, d.gid, d.spec, now);
    else if (q.type === 'sp-del') state.specials = (state.specials || []).filter(x => x.id !== d.gid);
  }
  function pickFields(o) { const r = {}; TASK_FIELDS.forEach(f => { if (o[f] !== undefined) r[f] = o[f]; }); return r; }
  function applyScheduled(state, now) {
    const today = dayKey(now), list = state.scheduled || [];
    const due = list.filter(q => q.at <= today).sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : (parseInt(a.id.slice(1), 10) - parseInt(b.id.slice(1), 10)));
    if (!due.length) return false;
    state.scheduled = list.filter(q => q.at > today);
    due.forEach(q => applyOne(state, q, now));
    return true;
  }

  function addStudy(state, taskId, sec) {
    if (sec <= 0) return;
    state.today.totalSec += sec;
    const t = state.tasks.find(x => x.id === taskId);
    if (!t) { const it = findSpecialItem(state, taskId); if (it) it.sec = (it.sec || 0) + sec; return; }
    const per = periodOf(state, t);
    if (per) per.taskSec[t.id] = (per.taskSec[t.id] || 0) + sec;
    else t.totalSec = (t.totalSec || 0) + sec;
  }

  // 余额上限（0 为不限）：还能再存多少分钟
  function bankRoom(state) { const cap = state.settings.bankCapMin || 0; return cap > 0 ? Math.max(0, cap - state.bank) : Infinity; }
  function give(state, events, label, min, tix) {
    min = Math.min(min, bankRoom(state));
    if (!min && !tix) return;
    state.bank += min; state.tickets += tix;
    events.push({ label, min, tix });
  }

  // 根据当前累计进度补发所有应得奖励（可重复调用，不会重复发）
  function settle(state) {
    const s = state.settings, d = state.today, w = state.week, ev = [];
    const raw = Math.floor(d.totalSec / (s.segMin * 60)), segs = s.segCap > 0 ? Math.min(s.segCap, raw) : raw;
    while (d.segs < segs) { d.segs++; give(state, ev, '学习满 ' + s.segMin + ' 分钟（今日第 ' + d.segs + ' 张时长券）', s.segReward, s.segTickets); }
    if (!d.start && d.totalSec >= s.startMin * 60) { d.start = true; give(state, ev, '启动奖：今天开始学习了', 0, s.startTickets); }

    const daily = state.tasks.filter(t => t.group === 'daily' && isActive(state, t));
    daily.forEach(t => {
      if (!d.rewarded[t.id] && taskDone(state, t)) { d.rewarded[t.id] = true; give(state, ev, '每日任务完成：' + t.name, 0, s.dailyTaskTickets); }
    });
    if (!d.allBonus && daily.length && daily.every(t => taskDone(state, t))) { d.allBonus = true; give(state, ev, '每日任务全部完成', s.dailyAllMin, s.dailyAllTickets || 0); }

    const weekly = state.tasks.filter(t => t.group === 'weekly' && isActive(state, t));
    if (!w.bonus && weekly.length && weekly.every(t => taskDone(state, t))) { w.bonus = true; give(state, ev, '每周任务全部完成', s.weeklyAllMin, s.weeklyAllTickets); }
    return ev;
  }

  function manualCheck(state, taskId) {
    const t = state.tasks.find(x => x.id === taskId);
    const per = t && periodOf(state, t);
    if (!t || !per || !t.manual) return [];
    per.manual[t.id] = Math.min(Math.max(1, t.target), (per.manual[t.id] || 0) + 1);
    return settle(state);
  }

  function completeTemp(state, taskId) {
    const t = state.tasks.find(x => x.id === taskId), s = state.settings, ev = [];
    if (!t || t.group !== 'temp') return ev;
    if (!state.today.tempReward && (t.totalSec || 0) >= s.tempMinMin * 60) {
      state.today.tempReward = true; give(state, ev, '临时任务完成：' + t.name, 0, s.tempTickets);
    }
    state.tasks = state.tasks.filter(x => x.id !== taskId);
    return ev;
  }

  function draw(state, rng) {
    const s = state.settings, pool = s.pool;
    if (state.tickets <= 0 || bankRoom(state) <= 0) return null;
    let idx, pity = false;
    if (state.pity >= s.pityN - 1) { idx = 1; pity = true; }
    else {
      const r = rng() * 100; let acc = 0; idx = pool.length - 1;
      for (let i = 0; i < pool.length; i++) { acc += pool[i].p; if (r < acc) { idx = i; break; } }
    }
    const crit = rng() * 100 < s.critPct;
    state.pity = idx <= 1 ? 0 : state.pity + 1;
    const min = pool[idx].m * (crit ? 2 : 1), got = Math.min(min, bankRoom(state));
    state.tickets--; state.bank += got;
    return { k: pool[idx].k, idx, min, got, crit, pity };
  }

  function playCost(sec, roundTo) { return sec < 60 ? 0 : Math.ceil(sec / 60 / roundTo) * roundTo; }
  function spend(state, min) { const a = Math.max(0, Math.round(min)); state.bank -= a; return a; } // 允许变成负数（欠账），之后的奖励先还账

  function elapsedSec(timer, now) {
    return Math.max(0, Math.floor((timer.acc + (timer.paused ? 0 : now - timer.startedAt)) / 1000));
  }

  function settingsError(s) {
    const sum = s.pool.reduce((a, b) => a + Number(b.p), 0);
    if (Math.abs(sum - 100) > 1e-9) return '各奖项概率加起来是 ' + sum + '%，需要正好 100%。';
    const nums = ['segMin', 'segReward', 'segTickets', 'segCap', 'bankCapMin', 'startMin', 'startTickets', 'dailyTaskTickets', 'dailyAllMin', 'dailyAllTickets', 'weeklyAllMin', 'weeklyAllTickets', 'tempTickets', 'tempMinMin', 'pityN', 'critPct', 'roundTo'];
    for (const k of nums) if (!(Number.isFinite(s[k]) && s[k] >= 0)) return '有一项数值为空或为负数，请检查。';
    if (s.segMin < 1 || s.pityN < 2 || s.roundTo < 1 || s.startMin < 1) return '每段分钟数、启动分钟数、取整分钟数至少为 1，保底抽数至少为 2。';
    if (s.pool.some(x => !(x.p >= 0) || !(x.m >= 0))) return '奖项的概率和分钟数不能为负数。';
    return null;
  }

  // 旧数据升级到第 2 版规则：每 30 分钟只发 1 张券；每日任务全部完成才发 1 张券
  function migrate(state) {
    const v = state.v || 1; if (v >= 7) return false;
    if (v < 6) migrateTo6(state, v);
    // 第 7 版：所有延后生效的修改改成排队；任务有开始 / 结束日期
    const now = Date.now();
    if (!Array.isArray(state.scheduled)) state.scheduled = [];
    if (state.pendingSettings) schedule(state, nextWeekKey(now), 'settings', { settings: state.pendingSettings }, now);
    delete state.pendingSettings;
    (state.tasks || []).forEach(t => {
      if (t.pending) { const p = t.pending; schedule(state, p.from || nextDayKey(now), 'task-edit', { id: t.id, fields: pickFields(p) }, now); }
      if (t.endAt) schedule(state, t.endAt, 'task-del', { id: t.id }, now);
      t.startDate = t.activeFrom && t.activeFrom > dayKey(now) ? t.activeFrom : (t.startDate || null);
      if (t.endDate === undefined) t.endDate = null;
      delete t.pending; delete t.endAt; delete t.activeFrom;
    });
    state.v = 7; return true;
  }
  function migrateTo6(state, v) {
    if (!Array.isArray(state.specials)) state.specials = []; // 第 5 版：特别任务
    // 第 6 版：临时任务并入特别任务（保留已学时间，奖励沿用原来的券数）
    const temps = (state.tasks || []).filter(t => t.group === 'temp');
    temps.forEach(t => newSpecial(state, { items: [{ name: t.name, tix: (state.settings && state.settings.tempTickets) || 1, sec: t.totalSec || 0 }] }, Date.now()));
    state.tasks = (state.tasks || []).filter(t => t.group !== 'temp');
    if (state.timer && temps.some(t => t.id === state.timer.taskId)) { const g = state.specials[state.specials.length - temps.length + temps.findIndex(t => t.id === state.timer.taskId)]; state.timer.taskId = g.items[0].id; }
    if (v >= 4) { state.v = 6; return; }
    [state.settings, state.pendingSettings].forEach(s => {
      if (!s) return;
      if (v < 2) { s.segReward = 0; s.dailyTaskTickets = 0; s.dailyAllMin = 0; s.dailyAllTickets = 1; }
      if (v < 3) { s.weeklyAllMin = 0; s.weeklyAllTickets = 5; } // 第 3 版：每周全清改为 5 张券
      s.segCap = 0; s.bankCapMin = 2880; // 第 4 版：时长券不设上限，余额最多 48 小时
    });
    state.v = 6;
  }

  // ---------- 特别任务：自己设的一次性任务，手动确认完成后直接发奖励 ----------
  // 结构：{ id, name, date|null, bonusMin, bonusTix, bonusDone, created, items: [{ id, name, min, tix, cond, done, doneAt }] }
  // ---------- 进度型特别任务（一本书、一门课）----------
  // mode 'count'：按数量（页、题），每 step 个单位一格，每格奖励 stepMin / stepTix；marks 是章节，读到 at 时额外奖励
  // mode 'items'：按条目（第几章、第几节课），每一条单独打勾领奖励
  // date 是开始日期，due 是截止日期（只用来显示，过了不扣东西、不消失）；hist 记下每次进度和时间
  function isProgress(g) { return !!g && g.kind === 'progress'; }
  function progCells(g) { return g.mode === 'count' ? Math.ceil(g.total / Math.max(1, g.step)) : g.items.length; }
  function progReached(g, cur) { return cur >= g.total ? progCells(g) : Math.floor(cur / Math.max(1, g.step)); }
  function progDone(g) { return g.mode === 'count' ? g.cur >= g.total : g.items.length > 0 && g.items.every(x => x.done); }
  function progFields(g, spec) {
    g.name = spec.name || ''; g.unit = spec.unit || (g.mode === 'count' ? '页' : '');
    g.total = Math.max(1, Math.round(spec.total || 1)); g.step = Math.max(1, Math.round(spec.step || 1));
    g.stepMin = spec.stepMin || 0; g.stepTix = spec.stepTix || 0;
    g.bonusMin = spec.bonusMin || 0; g.bonusTix = spec.bonusTix || 0;
    g.date = spec.date || null; g.due = spec.due || null;
  }
  function newProgress(state, spec, now) {
    if (!Array.isArray(state.specials)) state.specials = [];
    state.seq = (state.seq || 0) + 1;
    const g = { id: 's' + state.seq, kind: 'progress', mode: spec.mode === 'items' ? 'items' : 'count', cur: 0, paid: 0, marks: [], items: [], hist: [], bonusDone: false, created: dayKey(now), doneAt: null, repeat: null };
    progFields(g, spec);
    let n = 0;
    (spec.marks || []).forEach(m => { n++; g.marks.push({ id: g.id + '-m' + n, name: m.name, at: Math.round(m.at), min: m.min || 0, tix: m.tix || 0, doneAt: null }); });
    (spec.items || []).forEach(it => { n++; g.items.push({ id: g.id + '-' + n, name: it.name, min: it.min || 0, tix: it.tix || 0, done: false, doneAt: null }); });
    g.marks.sort((a, b) => a.at - b.at);
    state.specials.push(g); return g;
  }
  function updateProgress(g, spec) {
    progFields(g, spec);
    let n = [...g.marks, ...g.items].reduce((a, x) => Math.max(a, parseInt(String(x.id).split(/-m?/).pop(), 10) || 0), 0);
    g.marks = (spec.marks || []).map(m => { const o = m.id && g.marks.find(x => x.id === m.id); if (o) { o.name = m.name; o.at = Math.round(m.at); o.min = m.min || 0; o.tix = m.tix || 0; return o; } n++; return { id: g.id + '-m' + n, name: m.name, at: Math.round(m.at), min: m.min || 0, tix: m.tix || 0, doneAt: null }; }).sort((a, b) => a.at - b.at);
    if (g.mode === 'items') g.items = (spec.items || []).map(it => { const o = it.id && g.items.find(x => x.id === it.id); if (o) { o.name = it.name; o.min = it.min || 0; o.tix = it.tix || 0; return o; } n++; return { id: g.id + '-' + n, name: it.name, min: it.min || 0, tix: it.tix || 0, done: false, doneAt: null }; });
    if (g.mode === 'count') { g.cur = Math.min(g.cur, g.total); g.paid = Math.min(g.paid, progReached(g, g.cur)); }
    if (!progDone(g)) g.doneAt = null; else if (!g.doneAt) g.doneAt = Date.now();
    return g;
  }
  // 按数量：进度推到 to（只能往前），把中间跨过的格子、章节奖励一起发
  function progressAdvance(state, gid, to, now) {
    const ev = [], g = (state.specials || []).find(x => x.id === gid);
    if (!isProgress(g) || g.mode !== 'count') return ev;
    to = Math.max(0, Math.min(g.total, Math.round(to)));
    if (to <= g.cur) return ev;
    const reached = progReached(g, to), k = reached - g.paid;
    if (k > 0) give(state, ev, '特别任务：' + g.name + ' ' + to + '/' + g.total + g.unit, k * g.stepMin, k * g.stepTix);
    g.paid = Math.max(g.paid, reached);
    g.marks.forEach(m => { if (!m.doneAt && m.at <= to) { m.doneAt = now; give(state, ev, '特别任务：' + g.name + ' · ' + m.name, m.min, m.tix); } });
    g.cur = to; (g.hist = g.hist || []).push({ t: now, to });
    progFinish(state, g, ev, now);
    return ev;
  }
  // 按条目：勾掉一条
  function progressTick(state, gid, iid, now) {
    const ev = [], g = (state.specials || []).find(x => x.id === gid);
    if (!isProgress(g) || g.mode !== 'items') return ev;
    const it = g.items.find(x => x.id === iid); if (!it || it.done) return ev;
    it.done = true; it.doneAt = now;
    give(state, ev, '特别任务：' + g.name + ' · ' + it.name, it.min, it.tix);
    progFinish(state, g, ev, now);
    return ev;
  }
  function progFinish(state, g, ev, now) {
    if (!progDone(g) || g.doneAt) return;
    g.doneAt = now;
    if (!g.bonusDone && (g.bonusMin || g.bonusTix)) { g.bonusDone = true; give(state, ev, '特别任务全部完成：' + g.name, g.bonusMin, g.bonusTix); }
  }
  // 还剩几项（用来显示"还剩 N 项"）：进度任务没完成算 1 项
  function specialLeft(g, now) { return isProgress(g) ? (progDone(g) || !specialStarted(g, now) ? 0 : 1) : (specialStarted(g, now) ? g.items.filter(x => !specialDone(g, x, now)).length : 0); }

  function newSpecial(state, spec, now) {
    if (spec.kind === 'progress') return newProgress(state, spec, now);
    state.seq = (state.seq || 0) + 1;
    const g = { id: 's' + state.seq, name: spec.name || '', date: spec.date || null, repeat: spec.repeat || null, bonusMin: spec.bonusMin || 0, bonusTix: spec.bonusTix || 0, bonusDone: false, bonusDay: null, created: dayKey(now), items: [] };
    if (g.repeat === 'gap') { g.gapDays = spec.gapDays || 3; g.gapMin = spec.gapMin || 0; g.gapTix = spec.gapTix || 0; g.lastDay = null; }
    spec.items.forEach((it, i) => g.items.push({ id: g.id + '-' + (i + 1), name: it.name, min: it.min || 0, tix: it.tix || 0, cond: it.cond || '', sec: it.sec || 0, done: false, doneAt: null }));
    if (!Array.isArray(state.specials)) state.specials = [];
    state.specials.push(g); return g;
  }
  // 显示规则：有日期的显示到当天结束；没日期的显示到全部完成后的那一天结束。过期不扣任何东西
  function findSpecialItem(state, id) {
    for (const g of state.specials || []) { const it = g.items.find(x => x.id === id); if (it) return it; }
    return null;
  }
  // 每天重复的特别任务：date 表示从哪天开始，完成状态按天记（doneDay），第二天自动重新出现
  // 重复类特别任务有两种：'daily' 每天一次；'gap' 也是每天最多一次，但奖励按"距上次完成隔了几天"分档：在 gapDays 天之内再次完成拿高档，超过了拿基本档
  function perDay(g) { return g.repeat === 'daily' || g.repeat === 'gap'; }
  function specialDone(g, it, now) { return perDay(g) ? it.doneDay === dayKey(now) : !!it.done; }
  function specialStarted(g, now) { return (!perDay(g) && !isProgress(g)) || !g.date || g.date <= dayKey(now); }
  function specialVisible(g, now) {
    if (isProgress(g)) return !g.doneAt || dayKey(g.doneAt) >= dayKey(now);
    const today = dayKey(now);
    if (perDay(g)) return true;
    if (g.date) return g.date >= today;
    if (!g.items.every(x => x.done)) return true;
    const last = Math.max(...g.items.map(x => x.doneAt || 0));
    return dayKey(last) >= today;
  }
  // 距上次完成过了几天；还没完成过返回 null
  function specialGap(g, now) {
    if (!g.lastDay) return null;
    return Math.round((Date.parse(dayKey(now)) - Date.parse(g.lastDay)) / DAY);
  }
  // 这一次完成能拿到的奖励：'gap' 任务里，距上次不超过 gapDays 天（或第一次）拿高档，否则拿基本档
  function specialReward(g, it, now) {
    if (g.repeat === 'gap') {
      const gap = specialGap(g, now);
      if (gap === null || gap <= (g.gapDays || 0)) return { min: g.gapMin || 0, tix: g.gapTix || 0 };
    }
    return { min: it.min || 0, tix: it.tix || 0 };
  }
  function completeSpecial(state, gid, iid, now) {
    const ev = [], g = (state.specials || []).find(x => x.id === gid); if (!g) return ev;
    const it = g.items.find(x => x.id === iid); if (!it || specialDone(g, it, now) || !specialStarted(g, now)) return ev;
    const r = specialReward(g, it, now);
    if (perDay(g)) it.doneDay = dayKey(now); else it.done = true;
    if (g.repeat === 'gap') g.lastDay = dayKey(now);
    it.doneAt = now;
    give(state, ev, '特别任务：' + it.name, r.min, r.tix);
    const bonusTaken = perDay(g) ? g.bonusDay === dayKey(now) : g.bonusDone;
    if (g.items.length > 1 && !bonusTaken && g.items.every(x => specialDone(g, x, now)) && (g.bonusMin || g.bonusTix)) {
      if (perDay(g)) g.bonusDay = dayKey(now); else g.bonusDone = true;
      give(state, ev, '特别任务全部完成' + (g.name ? '：' + g.name : ''), g.bonusMin, g.bonusTix);
    }
    return ev;
  }

  // 修改已建好的特别任务：保留每一项的编号、完成状态、已学时间；新增的项给新编号
  function updateSpecial(state, gid, spec, now) {
    const g = (state.specials || []).find(x => x.id === gid); if (!g) return null;
    if (isProgress(g)) return updateProgress(g, spec);
    const wasPer = perDay(g), today = dayKey(now), old = g.items;
    g.name = spec.name || ''; g.date = spec.date || null; g.repeat = spec.repeat || null;
    g.bonusMin = spec.bonusMin || 0; g.bonusTix = spec.bonusTix || 0;
    if (g.repeat === 'gap') { g.gapDays = spec.gapDays || 3; g.gapMin = spec.gapMin || 0; g.gapTix = spec.gapTix || 0; if (!g.lastDay) g.lastDay = null; }
    let n = old.reduce((a, x) => Math.max(a, parseInt(String(x.id).split('-').pop(), 10) || 0), 0);
    g.items = spec.items.map(it => {
      const o = it.id && old.find(x => x.id === it.id);
      if (o) { o.name = it.name; o.min = it.min || 0; o.tix = it.tix || 0; o.cond = it.cond || ''; return o; }
      n++; return { id: g.id + '-' + n, name: it.name, min: it.min || 0, tix: it.tix || 0, cond: it.cond || '', sec: 0, done: false, doneAt: null };
    });
    const nowPer = perDay(g);
    g.items.forEach(o => {
      if (nowPer && !wasPer && o.done && o.doneAt) o.doneDay = dayKey(o.doneAt);
      if (!nowPer && wasPer && o.doneDay === today) o.done = true;
    });
    return g;
  }

  const api = { migrate, bankRoom, GROUPS, dayKey, weekKey, nextDayKey, nextWeekKey, defaultSettings, newTask, initialState, groupOf, periodOf, isActive, taskSec, taskCount, taskDone, rollover, addStudy, settle, manualCheck, completeTemp, draw, playCost, spend, elapsedSec, settingsError, newSpecial, specialVisible, completeSpecial, findSpecialItem, specialDone, specialStarted, specialGap, specialReward, updateSpecial, isEnded, schedule, cancelScheduled, applyScheduled, ensureCredit, creditTier, updateCredit, canBorrow, creditCfg, creditError, CREDIT_PRESETS, isProgress, progCells, progReached, progDone, progressAdvance, progressTick, specialLeft };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Logic = api;
})(typeof window !== 'undefined' ? window : globalThis);
