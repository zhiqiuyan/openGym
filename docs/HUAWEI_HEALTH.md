# 华为运动健康数据互通（HarmonyOS edition）

设置 → 集成 → **Health Connect**（鸿蒙版显示为「华为运动健康」），以及设置 → **个人信息** 里的入口，
构成本 fork 的鸿蒙健康后端。

上游已有 iOS 的 Apple Health 与 Android 的 Health Connect；HarmonyOS 不提供这两个系统服务，
但设备自带**华为运动健康**，可由系统 **Health Service Kit（`@kit.HealthServiceKit`）** 直接读写。
本版把鸿蒙的健康后端从「云中转」改为「本机直连」：数据全程留在手机，不经过任何中转服务器。

## 1. 鸿蒙版为什么是「Health Connect」而不是 Android 的

- 鸿蒙构建在 `frontend/src/lib/harmony/plugins.js` 里把 `HealthConnect` 暴露为一个**真实的桥接**，
  每一次调用都经 `nativeCall('HealthConnect', method, opts)` 转发到原生 `HealthConnectPlugin`。
- 原生插件 `entry/src/main/ets/plugins/HealthConnectPlugin.ets` 用 `@kit.HealthServiceKit`
  **本地**读写设备上的华为运动健康数据（体重、身高、心率、步数、睡眠、训练记录）。
- 页面侧**完全复用**上游的 `lib/health-sync.js` / `lib/health-read.js` / `lib/health-connect.js`，
  它们调用的方法名（`status` / `requestPermissions` / `write` / `remove` /
  `readWeights` / `readHeartRate` / `openSettings` / `setEnabled`）与 Android 端一致，
  所以鸿蒙版不需要任何平台分支就能直接读回体重与心率、写回训练与体重。
- 也就是说：在鸿蒙版里，**Health Connect = 华为运动健康**，是本机直连，不是 Google Health Connect。

> Android 的 Health Connect 入口在鸿蒙版不存在（鸿蒙不运行 Android 的 Health Connect 应用）。
> 取而代之的是上面这个本机 Health Service Kit 后端。

## 2. 本机直连的前置条件（缺任何一项都无法真正读写）

HUAWEI Health Kit 是系统能力，但要被第三方应用调用，仍需要在华为侧完成开发者配置：

1. 在华为开发者联盟 / AppGallery Connect 创建应用，拿到 **App ID（client_id）**。
2. 为该应用**开通 Health Service Kit（Health Kit）**，并申请所需数据权限且通过审核
   （体重、身高、心率、步数、睡眠、运动记录等读写权限）。
3. 在 `module.json5` 声明健康权限（`ohos.permission.health.READ_HEALTH_DATA`、
   `ohos.permission.health.WRITE_HEALTH_DATA`）以及所使用的数据类型。
4. 在 DevEco Studio 中对应用完成**签名**并构建；Health Kit 在签名与 AGC 配置齐全时才会放行。
   本仓库发布的 HAP 是未签名包，真机部署前需自行签名。

> 没有这些配置时，原生插件会拒绝调用，`lib/health-sync.js` 把健康后端视为「不可用」，
> 界面据此显示「本设备暂未启用华为运动健康的数据读写能力」，不会假装已连接。

## 3. 读写范围（与上游 Health Connect / Apple Health 同一套）

| 方向 | 数据 | 落点 |
| --- | --- | --- |
| 写回 | 已完成训练、称重 | 经 `health-connect.js` 生成记录 → 原生 `insert` 写入华为运动健康 |
| 读回 | 体重（其他 App/体脂秤写入的） | `S.bodyweight` 的一条 reading，复用 `addWeighIn`，带 `src: 'health'` 与 `sid` 去重 |
| 读回 | 心率（训练期间） | 每条训练、每个 set 的心率，来自 `readHeartRate` 的样本 |
| 读回 | 身高、步数、睡眠、运动记录 | 个人信息页直接读取身高；其余为只读快照，不参与训练图表与渐进超负荷计算 |

## 4. 原生插件与桥接

| 文件 | 职责 |
| --- | --- |
| `entry/src/main/ets/plugins/HealthConnectPlugin.ets` | 本机 Health Service Kit 实现：权限、读写、移除、读体重/心率、打开设置 |
| `entry/src/main/ets/pages/Index.ets` | 以 `'HealthConnect'` 名字注册该插件到桥 |
| `frontend/src/lib/harmony/plugins.js` | `HealthConnect` 桥接（转发到原生），`AppleHealth` 仍 `UNSUPPORTED` |
| `frontend/src/lib/health-sync.js` / `health-read.js` / `health-connect.js` | 上游复用，无需改动 |
| `frontend/src/views/Settings.jsx` | Health Connect 卡片/页面，鸿蒙版文案与标题为「华为运动健康」 |
| `frontend/src/views/ProfilePage.jsx` | 个人信息页，可跳到 Health Connect 连接页 |

## 5. 关于此前「云中转」实现（可选脚手架，已不再是主路径）

早期本 fork 还提供过一套**云端 OAuth 中转**方案（`frontend/src/lib/huawei-health.js`
以及已移除的 `HuaweiHealthPage.jsx`）：通过 HUAWEI Health Kit 的云 OAuth 与自建中转服务读写。
该方案需要服务端持有 `client_secret`、自建 HTTPS 中转，且要 Health Kit 权限审批，
并不「本机直连」。

本版以**本机 Health Service Kit** 为主路径后，云端中转库 `huawei-health.js` 保留为可选脚手架
（其单元测试仍在），但默认界面不再提供该入口。若某台设备因 AGC 配置暂时无法使用本机 Health Kit，
可参考该库自行搭建中转作为补充，但这并非推荐路径。

## 6. 已知限制

- **本机 Health Kit 仍需要 AGC 应用与权限审批 + 签名构建**，才能实际读写；本仓库不提供服务端实现、
  AGC 凭据或签名证书。
- `HealthConnectPlugin.ets` 已于 2026-11-07 对照本机 SDK 声明
  （`sdk/default/hms/ets/api/@hms.health.store.d.ts`）重写并通过 DevEco 完整编译验证：
  使用 `init` / `requestAuthorizations` / `getAuthorizations` / `readData` / `saveData` /
  `deleteData` / `insertDataSource`，数据类型取自 `healthStore.healthDataTypes`，时间单位为
  **毫秒**。编译产物 `ets/modules.abc` 中已确认包含该插件。
  早期按公开接口结构猜测的 `healthDataTypes` / `healthPermission` Kit 顶层导出与纳秒换算均已移除。
- 步数、心率、睡眠只展示最近一次同步的数值，不画趋势图，也不参与训练建议。
- BMI 采用中国成人标准（18.5 / 24 / 28），WHO 标准（18.5 / 25 / 30）在界面脚注中说明；
  基础代谢率为 Mifflin–St Jeor 估算，均不构成医疗建议。
