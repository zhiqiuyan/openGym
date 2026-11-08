# 鸿蒙版版本记录

版本号遵循 semver，与 Android / Web / iOS 的版本线完全独立。`AppScope/app.json5` 是唯一来源：
`versionName` 显示给用户，`versionCode` 每版 +1（覆盖安装要求严格递增），`buildVersion` 每版 +1。

每次发版：`node tools/bump-version.mjs <patch|minor|major> --note "..."` → `node tools/sync-web.mjs`
→ `assembleHap` → 新建 tag `harmony-v<版本>` 与独立 Release（**不要覆盖已有 Release 的附件**）。
Release 附件名带版本号，另附 `.sha256` 与 `SHA256SUMS`。`/releases/latest` 始终指向最新版，
应用内「检查更新」与仓库 README 都用这个地址，发新版无需改代码。

## 1.1.0 (2026-11-06)

- 新增个人信息管理（身高/体重/BMI/健康体重范围/基础代谢率，鸿蒙 7.0 风格）
- 华为运动健康改为本机 Health Service Kit 直连：替代 Android 的 Health Connect 云中转方案，直接本地读写体重/身高/心率/步数/睡眠/训练记录；原生 `HealthConnectPlugin` 已写入工程，需 DevEco 完整重编译后随 HAP 生效（页面侧复用上游 `health-sync` 管线，无需平台分支）
- 主页左上角标题 `openGym` → 「开放健身房」

## 1.0.2 (2026-11-06)

- 同步上游 DuarteSantos8/openGym main 8fb98b16（305 个提交，v1.4.4 线），保留鸿蒙版中文包、DeepSeek/自定义模型、关于页与浅色二级页修复；繁体指令/描述补齐为全量

## 1.0.1 (2026-11-06)

- 修复 AI 教练 API key 无法持久化（SecureStorage 位置参数与原生载荷双向转换）；建立版本迭代机制，检查更新指向 /releases/latest

## 1.0.0 (2026-11-05)

首个鸿蒙版发行。独立版本线 `1.0.0`（versionCode 10000），自有更新通道，不读取上游 Android APK
的发布源。包含全量简体中文动作指导与动作描述、AI 教练 DeepSeek 提供商与自定义模型输入、
重设计的「关于与更新」页（版权与许可）、浅色模式二级菜单卡片融入背景的修复。

已知问题：安全存储的鸿蒙转发层只传一个参数，AI 教练的 API key 无法写入设备，聊天时报
`no API key configured for <provider>`。该问题在 1.0.1 修复；1.0.0 的 Release 附件后来被
同名热修复包覆盖，因此不再作为可安装的基线，请直接使用 1.0.1 及之后的版本。
