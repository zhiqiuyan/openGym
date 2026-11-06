# 与上游保持同步（HarmonyOS edition）

这个仓库是 [DuarteSantos8/openGym](https://github.com/DuarteSantos8/openGym) 的公开 fork。上游迭代很快
（2026-10-28 到 11-06 之间又前进了 305 个提交），所以「保持同步」不是一次性动作，而是下面这套固定的
分支职责 + 每日自动同步 + 版本规则。

## 分支职责

| 分支 | 作用 | 是否可直接提交 |
| --- | --- | --- |
| `main` | 上游 `main` 的**纯镜像**，逐提交快进，内容与上游完全一致 | **否**。只由同步工作流写入 |
| `harmony` | 默认分支、`harmony-vX.Y.Z` 的发版分支 = 上游 `main` + 鸿蒙版补丁集 | 是 |
| `chinese-language-pack` | 给上游提中文语言包 PR 的分支（[PR #1008](https://github.com/DuarteSantos8/openGym/pull/1008)） | 是（只放纯数据文件） |
| `sync/*` | 一次性同步/验证用分支 | 是 |

`main` 与 `harmony` 的关系必须是 **merge**，不能 squash、不能 rebase：只有保留上游提交作为祖先，
GitHub 才会显示 `harmony` 与上游「0 commits behind」。

## 自动同步

> **启用状态（2026-11-06）**：工作流全文已随仓库保存在
> [`docs/sync-upstream.yml.example`](sync-upstream.yml.example)，但**尚未作为真正的 Actions 工作流运行**。
> 当前 `gh` 用的 OAuth token 只有 `repo, read:org, gist`，缺 `workflow` scope；GitHub 会拒绝任何写
> `.github/workflows/` 的请求（git push 报 `refusing to allow an OAuth App ... without workflow scope`，
> REST Contents / Git Data API 一律返回 404）。这只影响「每日自动」，**不影响已完成的 305 个提交同步
> 和 `main` 镜像**；在启用前按下面「手动同步一次」即可保持进度。
>
> 启用二选一：
>
> 1. **推荐 / 一步完成**：浏览器打开
>    <https://github.com/zhiqiuyan/openGym/edit/harmony/docs/sync-upstream.yml.example>，
>    把编辑框顶部的文件路径整个替换为 `.github/workflows/sync-upstream.yml`
>    （**内容一个字都不用改**），然后直接 Commit 到 `harmony`。GitHub 会把它当成一次移动；
>    Web 会话具备完整权限，不受 CLI token scope 限制，也不需要复制粘贴 YAML。
>    若该页面不接受跨目录改名，改用新建文件页
>    <https://github.com/zhiqiuyan/openGym/new/harmony?filename=.github/workflows/sync-upstream.yml>
>    粘贴示例全文提交，效果相同。
> 2. 给 CLI 补权限后由脚本推送（设备码有效期约 15 分钟，需当场在浏览器输入，否则会超时）：
>    ```bash
>    gh auth refresh -h github.com -s workflow          # 浏览器设备授权
>    git add .github/workflows/sync-upstream.yml
>    git commit -m "ci: enable daily upstream sync"
>    git push myfork harmony
>    ```
>
> 启用后到 Actions 手动 `Run workflow` 验一次：此刻 `harmony` 已含上游 `8fb98b16`，预期输出
> `harmony already contains upstream ...`，且 `main` 与上游同 SHA。

`.github/workflows/sync-upstream.yml`（只在 `zhiqiuyan/openGym` 运行）：

- 每天 03:23 UTC 定时执行，也可在 Actions 里手动 `Run workflow`。
- 拉取 `DuarteSantos8/openGym:main`，把本仓库 `main` **快进**到同一个提交（绝不强制推送）。
- 若 `harmony` 尚未包含该提交，就创建/刷新一个 `main → harmony` 的常驻 PR，正文列出本次新增提交；
  这个 PR 就是「还差多少进度」的看板，也可以用上游的 CI 检查补丁集是否仍然适配。
- 手动触发时把 `auto_merge` 设为 `true` 可对无冲突的 PR 开启 GitHub 自动合并（仍受所需检查约束）。
- **冲突从不自动解决**。冲突时按下面的补丁集清单人工合并。

## 手动同步一次

本地仓库的 remote 约定：`origin` = 上游，`myfork` = 本 fork。

```bash
git fetch origin main
# 1) 镜像分支快进
git switch main && git merge --ff-only origin/main && git push myfork main

# 2) 发版分支合并（保留 merge commit）
git switch harmony
git merge --no-edit --no-ff origin/main          # 有冲突就先解决再 git add / git commit
cd frontend && npm ci && npx vitest run && cd ..
node scripts/catalogue/build.mjs --check           # 语言数据没有被生成脚本甩下

# 3) 每次上游同步对应一个鸿蒙版补丁版本
cd ../opengym-harmony
node tools/bump-version.mjs patch --note "同步上游 <sha>（<n> 个提交）"
node tools/sync-web.mjs
# 4) 打包、校验、发新 Release（见该工程的 README「版本与发版」）
```

## 版本与迭代节奏

鸿蒙版是**独立 semver 版本线**（1.0.0 起），与上游的 1.4.x 不共享版本号，但共享迭代节奏：

- 每完成一次上游同步或一次自有修复 → `patch`（1.0.1 → 1.0.2 → …）；
- 上游带来了成片的新功能、或鸿蒙版自身有新功能 → `minor`；
- 不兼容改动 → `major`；
- `versionCode` 每版固定 +1（覆盖安装要求严格递增），与 semver 解耦；
- 每个版本号对应**唯一不可变的 HAP + 独立 Release**，绝不覆盖已发布附件；
- 应用内「检查更新」与 README 都指向 `/releases/latest`，发新版不用改代码。

版本唯一来源是 `opengym-harmony/AppScope/app.json5`；`frontend/vite.config.js` 在鸿蒙构建时读取它，
所以界面显示的版本号永远等于已安装包的版本。

## 补丁集清单（合并冲突时按此逐项重贴）

原则是**上游胜出**：先取上游版本，再把鸿蒙版增量重新贴上去。

| 文件 | 增量 |
| --- | --- |
| `frontend/src/lib/harmony/*`、`frontend/src/main.jsx` | 鸿蒙原生桥接层与启动注入（`VITE_HARMONY=1`） |
| `frontend/src/lib/channel.js` | 新增 `harmony` 渠道，避免误用 APK 自更新 |
| `frontend/vite.config.js` | `__APP_VERSION__` 取自鸿蒙清单，Capacitor 别名 |
| `api/coach/core/providers.js`、`api/coach/core/adapters/deepseek.js`、`api/coach/adapters/index.js`、`frontend/src/lib/coach-local.js` | DeepSeek 提供商 |
| `frontend/src/views/CoachSetup.jsx` 及两个测试 | 模型改为 `<input list="coach-models">`，支持任意自定义模型 |
| `frontend/src/views/Settings.jsx`、`settings-pages.js` | 关于页：品牌区、版本/更新入口、版权与许可证；**删掉捐赠区块** |
| `frontend/src/index.css` | 浅色二级设置页卡片融入背景、`about-*` 样式（字号必须用 `--fs-*` 令牌） |
| `frontend/src/locales/*.js` | 8 个关于页/部分翻译键；删除 4 个废弃捐赠键；19 个包键集合必须一致 |
| `frontend/src/lib/i18n-core.js`、`i18n.js`、`sheets.jsx` | `CJK_LANGS`（中文默认不加英文括注）、`instrPartial` |
| `frontend/src/instr/zh*.js`、`exercise-desc/zh*.js`、`exercise-names/zh*.js`、`catalogue/i18n/zh*.json` | 全量简体中文动作指导/描述，以及由 OpenCC 词表补齐的繁体包 |
| `README.md`、`COPYRIGHT.md`、根 `LICENSE`、`NOTICE.md` | 鸿蒙版说明、下载入口、版权与许可 |

每次合并后必跑：`frontend/scripts/check-locales.mjs`（19 包键集合一致）、
`src/lib/pt-br-locale.test.js`（指纹随 `pt.js` 变动要重算：
`node scripts/pt-br-inheritance-fingerprint.mjs`）、`src/lib/zh-tw-instructions.test.js`
（繁体包不允许残留英文步骤）、完整 `npx vitest run`。

## 同步台账

| 日期 | 上游基线 | 新增提交 | 鸿蒙版 | 说明 |
| --- | --- | --- | --- | --- |
| 2026-10-28 | `b6cfe2bb` | — | 1.0.0 | 初始快照（上游 1.4.3 线） |
| 2026-11-06 | `b6cfe2bb` | 0 | 1.0.1 | AI 教练 API key 修复、版本迭代机制 |
| 2026-11-06 | `8fb98b16`（v1.4.4 线） | 305 | **1.0.2** | 首次全量上游同步；上游新增 F-Droid 渠道、教程、Integrations、1.4.5 设计令牌、系统栏等；繁体中文包补齐为全量 |

> 注：HarmonyOS 原生工程（`opengym-harmony/`，含 ArkTS 壳、`app.json5`、打包脚本、CHANGELOG）
> 目前不在本仓库内，版本与发版记录在它的 `CHANGELOG.md`。含授权媒体的 HAP（约 220 MB）
> 只作为 Release 附件发布，不进 git tree。
