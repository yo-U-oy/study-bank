# 学习抽卡银行：独立部署迁移说明

导出时间：2026-11-18 20:40 (JST)
来源：Claude artifact `e395d7a6-f249-4970-bdf7-9e060d4ba4c0`，版本 `1794992541-ba60`
本目录中每个文件的 SHA-256 与线上版本逐一核对一致（见文末）。

---

## 1. 技术栈

| 项目 | 内容 |
|---|---|
| 语言 | HTML5、CSS3、JavaScript（ES2020，浏览器原生，无 TypeScript） |
| 框架 | 无。手写的"状态 → 拼接 HTML 字符串 → innerHTML"渲染方式 |
| 构建工具 | 无。不需要 npm、打包或编译，文件可直接用浏览器打开 |
| 第三方库 | 无 JS 库。唯一外部资源是 Google Fonts（Cinzel、Noto Serif SC），加载失败会回退到系统字体 |
| 浏览器 API | localStorage、Web Audio（提示音）、Vibration API（震动）、Pointer Events（拉袋子）、matchMedia（减少动画） |
| 数据存储 | Claude 环境下：artifact 自带的云端文档数据库（类 Firestore 接口）。<br>非 Claude 环境下：自动降级为浏览器 localStorage |

### 文件结构

```
index.html     页面骨架 + 全部 CSS（暗黑奇幻主题）+ 引入下面三个脚本
logic.js       纯规则：奖励结算、抽奖、跨日/跨周、迁移旧数据（不碰界面、不碰存储，可在 Node 中测试）
voices.js      11 位同伴的台词数据（window.VOICES）
app.js         界面渲染、按钮事件、计时器、撤销、统计、存储读写、备份导入导出
sprites/c1..c11.png   同伴立绘（透明背景）
```

### 数据模型

- `state`（一个文档）：余额 `bank`（分钟，可为负）、`tickets`、`pity`、`tasks[]`、`settings`、`pendingSettings`、`today`、`week`、`timer`、`timerBase`、`undo`、`act`、`created`、`v`(=4)
- `logs/<YYYY-MM-DD>`（每天一个文档）：`entries[]`（流水：label/min/tix/t/a）与 `sessions[]`（学习记录：name/taskId/start/sec/a）
- 日界线为东京时间 04:00，每周从周一开始。

---

## 2. 依赖 Claude Artifacts 的部分

全部集中在 `app.js`，共约 14 处，分三类：

| 依赖 | 代码位置 | 用途 | 离开 Claude 后的状况 |
|---|---|---|---|
| `window.claude.use('db')` | `boot()`、`save()`、`logRef()`、`openLedger()`、`exportBackup()`、`create` | 云端读写 state 与每日流水；`onSnapshot` 实时同步；`snap.metadata.fromCache` 防止旧缓存覆盖 | **必须替换**。没有它时程序已自动改用 localStorage，单设备可直接使用 |
| `window.claude.use('user')` → `user.id()` | `boot()` | 取得用户 ID，作为数据路径 `data/users/<uid>/state` | 换成新的登录系统（如 Supabase Auth）提供的 ID |
| `window.claude.use('downloads')` | `exportBackup()` | 让 artifact 宿主保存备份文件 | 已有回退：用 `<a download>` 下载，独立网页直接可用 |
| AI 服务 | — | **没有使用**任何 Claude AI 接口。台词是预先写好的静态数据 | 无影响 |

不依赖 Claude 的部分（可原样搬走）：全部规则（logic.js）、界面与 CSS、计时、抽奖动画、撤销、统计图、台词、立绘、提醒音、备份导入导出。

---

## 3. 部署为独立网页

### 第一步：静态托管（不改代码即可运行）

本目录直接上传到任一静态托管即可：GitHub Pages、Cloudflare Pages、Netlify、Vercel（都有免费额度）。
此时程序会显示"没有连上云端"提示并使用 localStorage，功能完整，但数据只在该浏览器里。
用"设置 → 导入备份"导入自己导出的备份文件（`study-bank-data-日期.json`）即可恢复全部数据。

建议顺带做的小改动（属于迁移工作，本次未做）：
- 把 Google Fonts 下载为本地字体文件，避免外网依赖。
- 把"没有连上云端"提示改成"本机模式"。

### 第二步：PWA（可添加到主屏幕、离线打开）

需新增：
- `manifest.webmanifest`：名称、图标（192/512px）、`display: standalone`、主题色 `#120f0d`
- `sw.js`：Service Worker，缓存 index.html、三个 JS、sprites 与字体，实现离线启动
- `index.html` 中加 `<link rel="manifest">`、`apple-touch-icon` 与注册 Service Worker 的几行代码

限制：iOS 上 PWA 的后台通知能力有限，游戏超时提醒仍需页面保持打开（与现在相同）。

### 第三步：跨设备云端同步

现有存储层的接口刚好是"文档 + 子集合 + 实时监听"，替换成本最低的选择：

| 方案 | 优点 | 注意 |
|---|---|---|
| **Firebase（Firestore + Auth）** | 接口与现有代码几乎一一对应（`doc().set/get/onSnapshot`、`collection('logs')`、`metadata.fromCache`），改动最小；免费额度足够个人用 | Google 服务，需要 Google 账号建项目 |
| Supabase（Postgres + Auth + Realtime） | 开源、可导出 SQL | 需把 state 存为一行 JSONB、logs 存为按日期的行，并改写监听逻辑 |
| 自建（Cloudflare Workers + D1/KV） | 完全自主 | 工作量最大，需自己做登录 |

做法：写一个 `storage.js` 适配层，提供 `loadState / saveState / watchState / loadLog / saveLog / listLogs` 六个函数，`app.js` 只调用它；登录后用新系统的 uid 替代 `user.id()`。
**必须保留**现有的"云端确认前不写入"保护（`confirmed` 标志），这是之前防止旧缓存覆盖余额的修复。

### 迁移数据

新云端上线后：登录 → 设置 → 导入备份 → 选择本次导出的 JSON。导入会覆盖新环境中的余额、任务与设置，并写入全部流水。

---

## 4. 已知问题（导出时发现，未修改）

1. **流水与余额可能对不上**：外部补记的一条奖励流水被网页的本地流水缓存覆盖掉了（余额本身是正确的）。原因是外部直接写数据库时，网页里 `logCache` 仍是旧内容，之后追加流水时整份写回。今后补记应通过网页本身完成，或迁移后加上"写入前重新读取"的逻辑。
2. **导出时如果有游戏计时在进行**，导入时它会被丢弃，请在原网页中先结束或放弃它。
3. **立绘与角色名**来自《博德之门 3》（Larian Studios）的角色同人图。个人使用没问题；若公开部署或分享给他人，建议换成原创角色。

---

## 5. 文件校验（SHA-256，与线上版本一致）

```
ec056394a8d6c9ac347b98b3da1f913dc72eaebc792616e40f7baee0b70fe277  app.js
5415ada42a178c83bbff69676a0d0fa891856c22f86f0f041d0f1197e7ab4de0  index.html
57043b63162c090c0b81003ec27938073c3d6b61b6ef07f50a559ae06d67439b  logic.js
fa4936d70e793dc05565384f261a9eaf516b42e965a41f5e1e259c90246d8cde  voices.js
```
sprites/c1..c11.png 的校验值见 checksums.txt。
