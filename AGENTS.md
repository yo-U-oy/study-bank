# 给 AI 助手的项目说明（AGENTS.md）

接手这个项目前请先读完本文件。适用于任何 AI 编程助手（Claude、ChatGPT/Codex 等）。

## 1. 项目是什么

「学习抽卡银行」：学习换抽奖券，抽奖换游戏时间的个人网页应用。
作者的主要困难是开始学习和坚持学习。这个应用是为了用奖励把"想玩游戏"的动力接到学习上。

**设计原则（改功能时必须遵守）**
- 以奖励为主。已经拿到的奖励不会过期，不做连续打卡、排行榜，不出现责备性的文字。
- 唯一的"扣分"是游戏超时会记成欠账（作者自己要求的），之后的奖励先还账。
- 界面有简体中文和英文两种（1.9.0 起），语气温和、直接。**不要使用任何 emoji。**
- 作者是编程新手。向作者解释时用日常语言，少用术语；需要作者操作时给出一步一步的说明。

## 2. 技术栈

- 纯 HTML + CSS + JavaScript，**没有框架、没有构建步骤、没有 npm 依赖**。改完文件直接就能运行。
- 唯一外部资源：Google Fonts（加载失败会回退到系统字体）。

| 文件 | 内容 |
|---|---|
| `index.html` | 页面骨架、全部 CSS（暗黑奇幻主题，颜色集中在开头的 CSS 变量里）、PWA 标签、Service Worker 注册与"新版本"提示 |
| `logic.js` | 纯规则：结算奖励、抽奖、跨日跨周、旧数据升级（`migrate`）。**不碰界面、不碰存储**，可以在 Node 里直接测试 |
| `app.js` | 界面渲染、按钮事件（`ACT` 对象）、计时器、撤销、统计、闹铃、存储读写、备份导入导出 |
| `voices.js` / `voices-en.js` | 11 位同伴的台词，中文 `window.VOICES`、英文 `window.VOICES_EN`，顺序一致，加台词时两边都要加 |
| `i18n.js` | 界面语言：`tt('中文')` 在英文模式下把中文片段换成英文；`ttLabel()` 只在提示里翻译流水标签；语言存在 localStorage 的 `bank-lang` |
| `i18n-en.js` | 英文词典 `window.I18N_EN`，键是中文片段（去掉首尾空格），值是英文 |
| `sw.js` | Service Worker：离线缓存与更新 |
| `manifest.webmanifest`、`icons/` | PWA（添加到主屏幕）用的名称和图标 |
| `sprites/c1..c11.png` | 同伴立绘，顺序与 `voices.js` 一致 |

## 3. 两个运行环境

同一份 `app.js` 在两个地方运行：

1. **Claude 版（已停止更新，停在 1.8.0）**：作为 Claude artifact 发布（slug `e395d7a6-f249-4970-bdf7-9e060d4ba4c0`）。通过 `window.claude.use('db')` 使用云端数据库，路径 `data/users/<uid>/state` 和 `.../state/logs/<YYYY-MM-DD>`。作者已经搬到独立版，**不要再把新版本发布到这个 artifact**，那里的旧数据保持原样。
2. **独立版（作者日常使用）**：GitHub Pages，`https://yo-u-oy.github.io/study-bank/`。没有 `window.claude` 时自动改用 `localStorage`（键：`bank-local-state`、`bank-local-logs`）。数据只在这台设备的浏览器里。

3. **同步到 GitHub（只在独立版，1.7.0 起）**：设置里填入作者自己的私有仓库和钥匙（fine-grained token，只给那一个仓库的 Contents 读写权限）后，记账约 30 秒后把 `{app, v, exported, state, logs}`（与导出备份同格式）上传为仓库里的 `data.json`，每次上传是一个提交。配置存在 localStorage 的 `bank-gh-sync`，不进 state、不进备份。AI 需要看独立版的流水时，读那个私有仓库的 `data.json`。目前只上传，不从仓库下载。

`app.js` 里用变量 `cloud` 区分两者。界面文字要对两种情况都成立。
Claude 版的 `index.html` 没有 PWA 部分，其余与独立版相同。

## 3.5 界面文字与翻译（1.9.0 起）

- 新加的界面文字一律写成 `tt('中文')`，并在 `i18n-en.js` 里补上英文。检查漏翻：在页面里设 `window.I18N_MISSING = new Set()`，切到英文点一遍，看里面收集到的片段。
- **不要翻译数据**：写进流水的标签（`logAppend` 的 `label`、`logic.js` 的 `give()`）、计时记录的名字、用户自己起的任务名，一律保持原样，不包 `tt()`。流水页显示原文；提示气泡里用 `ttLabel()` 翻译。
- 句子里夹数字时，英文语序不同就用占位符：`tt('第 # 项').replace('#', n)`。
- `app.js` 里已有局部变量叫 `t` 和 `T`，所以翻译函数叫 `tt`。
- 切换语言会重新加载页面（`setLang`）。

## 4. 发布新版本（每次都要做，不能漏）

1. 改 `app.js` 开头的 `APP_VERSION` 和 `APP_DATE`。
2. 改 `sw.js` 开头的 `VERSION`，**必须与 `APP_VERSION` 相同**。不改的话，已经安装在主屏幕的 App 不会更新。
3. 如果新增了需要离线使用的文件，加进 `sw.js` 的 `SHELL` 列表。
4. 在 `CHANGELOG.md` 最上面写这次改了什么。
5. 版本号规则：功能性改动升第二位（1.1.0 → 1.2.0），小修正升第三位（1.1.0 → 1.1.1）。

## 5. 不能破坏的地方

- **云端确认保护（`confirmed` 标志）**：Claude 版读取云端数据时，必须等服务器确认过的快照（`snap.metadata.fromCache === false`）才显示和保存。之前因为旧缓存覆盖新数据丢过一次余额。不要删掉这个逻辑。
- **数据结构向后兼容**：state 有版本号 `v`（当前 7；第 5 版加入特别任务 `state.specials`，第 6 版把临时任务并入特别任务，第 7 版加入修改排队 `state.scheduled` 和任务的 `startDate / endDate`，去掉了 `pendingSettings`、任务的 `pending / activeFrom / endAt`）。改数据结构时在 `logic.js` 的 `migrate()` 里加升级步骤，不要让旧数据读不出来。
- **日界线**：东京时间凌晨 4:00 算新的一天，每周从周一开始（`dayKey` / `weekKey`）。
- **修改都要问生效时间（1.12.0 起）**：改奖励数值 / 奖池、增删改任务、增删改特别任务时，都要显示「什么时候生效？」（`whenHtml` / `readWhen`），选项是立即（默认）、下周一、自选日期。以后的日子用 `L.schedule()` 放进 `state.scheduled` 排队，换日时 `applyScheduled()` 按日期先后执行，可以排多条，设置页「准备生效的修改」可以取消。这是作者要求的：给自己时间适应新规则，防止一时冲动改规则。新增可修改的东西时也要接上这套。
- **撤销**：每个操作前保存快照（`S.undo`），流水条目带操作编号 `a`。抽奖不能撤销。
- **任务分组**：每日、每周、非必要三组在 `logic.js` 的 `GROUPS`；特别任务单独存放在 `state.specials`，在学习页显示在每日下面。
- **特别任务**：规则在 `logic.js` 的 `newSpecial / specialVisible / completeSpecial`；每天重复的特别任务用 `repeat: 'daily'`，完成状态按天记在 `doneDay`，`date` 表示开始日期。完成必须经过两步确认（点完成 → 同伴询问 + 滑动到底），这是作者特意要求的，不要简化成一键完成。
- **同人声明**：设置页"关于"、`index.html` 开头注释、`README.md` 里的非官方同人声明不要删。同伴角色来自《博德之门 3》，只能免费、非商业使用。

## 6. 修改数据（不是功能）

- 独立版：请作者在设置里"导出备份"，把 JSON 发给你，你改好后发回新的 JSON，作者"导入备份"。改之前提醒作者保留原文件。
- 修改时余额 `state.bank` 和流水 `logs[日期].entries` 要一起改，保持一致。
- Claude 版：只有 Claude 能直接改数据库。从外部直接写数据库后，要提醒作者刷新所有打开的页面，否则页面里的旧流水缓存会把修改覆盖掉。
- **个人数据备份文件不要提交到仓库**（`.gitignore` 已排除）。

## 7. 测试

- 规则：`node -e "const L=require('./logic.js'); ..."` 直接调用 `logic.js` 的函数。
- 界面：用浏览器打开 `index.html`（本地会进入 localStorage 模式），点"开始使用"后测试。Playwright 的 `page.clock` 可以快进时间测试计时和闹铃。
- 测试 Service Worker 需要用 `python3 -m http.server` 在 localhost 打开。
- 发布前确认浏览器控制台没有报错。

## 8. 路线图（作者的计划）

1. 自己用得非常顺手：流水修正功能、Firebase 云端同步、正式从 Claude 版搬到独立版（进行中）。
2. 像 Anki 一样高度自定义 + 最基本的新 UI：奖励货币可自定义（分钟、小星星、奶茶等实物奖励），规则开关化，基础主题，iPad 与电脑的大屏排版。
3. 新手引导 + 复杂精致的 UI：原创角色与动画、多档案（家长与孩子）、推送通知，之后作为作品集放到简历上。

完整计划见 `ROADMAP.md`，更早的迁移分析见 `MIGRATION.md`，版本历史见 `CHANGELOG.md`。
