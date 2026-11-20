# 学习抽卡银行 / Study Gacha Bank

学习换抽奖券、抽奖换游戏时间的个人网页应用。为"很难开始学习"的人设计：只有奖励，没有惩罚，已经拿到的奖励不会过期。

在线使用：https://yo-u-oy.github.io/study-bank/ （可以"添加到主屏幕"当 App 用，支持离线）

## 主要功能

- **学习计时**：每日 / 每周 / 非必要三组任务，正计时、倒计时、番茄钟；学够时间拿抽奖券
- **抽奖**：命运之骰，五种稀有度，保底、暴击；抽到的是游戏时间
- **游戏计时**：玩的时间从余额里扣；余额用完也可以"借着玩"，记成欠账，之后的奖励先还账
- **特别任务**：一次性、每天重复、按间隔天数给奖励；进度型任务（一本书按页数 / 章节，一门课按节数）
- **修改都可以排期**：改规则、改任务时可以选立即生效、下周一或指定日期
- **同伴**：11 位同伴陪你学习，每人 80 句台词（中文、英文各一套）
- **记录**：流水、撤销、统计（任务分布、学习日历、时段）
- **中文 / English** 界面切换

## 数据

- 数据保存在你自己设备的浏览器里，不会上传到任何服务器。
- 设置里可以"导出备份 / 导入备份"（JSON 文件）。
- 可选：在设置里填入自己的私有 GitHub 仓库和令牌，记账后自动备份一份过去。

## 文件

| 文件 | 内容 |
|---|---|
| `index.html` | 页面与样式 |
| `logic.js` | 奖励规则（不碰界面，可以单独测试） |
| `app.js` | 界面、计时、存储、备份 |
| `i18n.js`、`i18n-en.js` | 语言切换与英文词典 |
| `voices.js`、`voices-en.js` | 同伴台词 |
| `sw.js`、`manifest.webmanifest`、`icons/` | 离线与"添加到主屏幕" |
| `sprites/` | 同伴立绘 |

纯 HTML / CSS / JavaScript，没有构建步骤，直接作为静态网站部署即可。版本记录见 [CHANGELOG.md](CHANGELOG.md)，后续计划见 [ROADMAP.md](ROADMAP.md)，给 AI 助手的开发说明见 [AGENTS.md](AGENTS.md)。

这个项目最早是在 Claude 的 artifact 里开发的，1.8.0 之后迁出，成为现在的独立网页。

## 非官方同人声明 / Fan Content Notice

本项目为免费、非商业的非官方同人作品。同伴角色及名称来自《博德之门 3》，版权归 Larian Studios 及 Wizards of the Coast 所有；本项目与它们无关，也未经其批准或认可。

学习抽卡银行 (Study Gacha Bank) is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. Baldur's Gate 3 characters © Larian Studios. This project is free, non-commercial, and not affiliated with or endorsed by Larian Studios.

角色立绘为 AI 生成的同人图。代码可以自由参考，但角色素材不得用于商业用途。
