/* 界面语言：中文 / English。
   用法：tt('中文原文')。英文模式下，把原文里每一段中文按 I18N_EN 词典换成英文；词典里没有的保持原样。
   注意：流水标签、用户自己起的名字不经过 tt()，所以不会被翻译。
   语言保存在本机 localStorage 的 bank-lang；切换语言后重新加载页面。 */
(function () {
  let lang = null;
  try { lang = localStorage.getItem('bank-lang'); } catch (e) { }
  if (lang !== 'zh' && lang !== 'en') {
    let existing = false; try { existing = !!localStorage.getItem('bank-local-state'); } catch (e) { }
    const sys = (navigator.languages || [navigator.language || '']).join(',');
    lang = existing || /^zh|,zh/i.test(sys) ? 'zh' : 'en'; // 老用户继续用中文；新用户按手机系统语言
    try { localStorage.setItem('bank-lang', lang); } catch (e) { }
  }
  window.LANG = lang;
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  const SEG = /[^<>"]*?[　-〿一-鿿＀-￯][^<>"]*/g;
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function seg(m) {
    const D = window.I18N_EN || {};
    if (has(D, m)) return D[m];
    const a = m.match(/^ */)[0], b = m.match(/ *$/)[0], core = m.slice(a.length, m.length - b.length);
    if (has(D, core)) return a + D[core] + b;
    if (window.I18N_MISSING) window.I18N_MISSING.add(core);
    return m;
  }
  window.tt = function (s) { return lang === 'en' && typeof s === 'string' ? s.replace(SEG, seg) : s; };
  // 流水标签等"数据里的文字"只在提示里显示时翻译（流水页本身保持原样）
  const LABELS = [
    [/^学习满 (\d+) 分钟（今日第 (\d+) 张时长券）$/, 'Studied $1 min (time ticket #$2 today)'],
    [/^启动奖：今天开始学习了$/, 'Starter bonus: you started today'],
    [/^每日任务完成：(.*)$/, 'Daily task done: $1'],
    [/^每日任务全部完成$/, 'All daily tasks done'],
    [/^每周任务全部完成$/, 'All weekly tasks done'],
    [/^临时任务完成：(.*)$/, 'Quick task done: $1'],
    [/^特别任务全部完成：(.*)$/, 'All special tasks done: $1'],
    [/^特别任务全部完成$/, 'All special tasks done'],
    [/^特别任务：(.*)$/, 'Special task: $1'],
    [/^玩游戏 (\d+) 分钟$/, 'Played $1 min'],
    [/^手动扣除游戏时间$/, 'Manual game time deduction'],
    [/^测试礼包$/, 'Welcome gift'],
    [/^各奖项概率加起来是 (.+)%，需要正好 100%。$/, 'The prize chances add up to $1%. They need to total exactly 100%.'],
    [/^有一项数值为空或为负数，请检查。$/, 'One of the values is empty or negative. Please check.'],
    [/^每段分钟数、启动分钟数、取整分钟数至少为 1，保底抽数至少为 2。$/, 'Minutes per block, starter minutes and rounding must be at least 1; pity count at least 2.'],
    [/^奖项的概率和分钟数不能为负数。$/, 'Prize chances and minutes cannot be negative.'],
  ];
  window.ttLabel = function (s) {
    if (lang !== 'en' || typeof s !== 'string') return s;
    for (const [re, en] of LABELS) if (re.test(s)) return s.replace(re, en);
    return s;
  };
  // 英文单复数：页面写到屏幕前统一修正（1 ticket / 2 tickets）
  window.ttPlural = function (html) {
    if (lang !== 'en' || typeof html !== 'string') return html;
    return html.replace(/(^|[^\d.,])1 (ticket|draw|day)s\b/g, '$11 $2');
  };
  window.setLang = function (l) { try { localStorage.setItem('bank-lang', l); } catch (e) { } location.reload(); };
})();
