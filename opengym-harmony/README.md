# 智练场（openGym 鸿蒙版）

openGym 是开源的健身与体重记录工具，官方提供 Android（Capacitor）与 iOS（Swift）两套原生外壳。
**智练场**是它的鸿蒙版：用 ArkUI 的 `Web` 组件承载同一套 React 前端，旁边一层 ArkTS 桥接把
Capacitor 插件调用接到鸿蒙系统能力上。品牌显示名「智练场」只改展示文本，openGym 的版权、
NOTICE、源码链接与 AGPL 归属保持不变。

当前交付：**1.4.5 / versionCode 10007 / r12**，HarmonyOS 7（API 26）、DevEco Studio 26.0.0 Release。
r12 未签名 HAP 已发布在 [harmony-v1.4.5 Release](https://github.com/zhiqiuyan/openGym/releases/tag/harmony-v1.4.5)。

---

## 一、架构选择

HarmonyOS 没有官方 Capacitor 运行时。三条路的取舍：

| 方案 | 工作量 | 结论 |
| --- | --- | --- |
| **ArkUI Web 组件 + ArkTS 桥接** | 中等 | ✅ 采用，前端零改写 |
| react-native-harmony 重写 | 极大 | UI 层全部废弃，React DOM 与 RN 组件模型不兼容 |
| 全原生 ArkTS 重写 | 极大 | 9 个视图 + 图表 + 大量动作文案，以月计 |

这也符合华为对 Web 迁移的第一阶段建议：先用 Web 组件加载现有 Web 应用上架，再逐步原生化关键页面。

**前端复用**：整个 `openGym/frontend` 保持上游代码，仅新增 `frontend/src/lib/harmony/` 作为
Capacitor 兼容层（`VITE_HARMONY=1` 时由 alias 生效）。其他 web / Android / iOS 构建不受影响。

**已知架构偏差**（如实登记，见 `../交付文档/合规自检表.md`）：转场是前端路由而非 ArkUI Navigation，
字阶走 Web CSS 而非系统 fp，栅格走媒体查询而非官方 4/8/12 列。这是单 Web 组件壳的固有约束，
不是遗漏；若立项原生化需重写主界面。

---

## 二、目录结构

```
opengym-harmony/
├── AppScope/                          应用级配置（包名、版本、分层图标、应用名）
├── build-profile.json5                product / SDK 版本（target = compatible = 26.0.0）
├── oh-package.json5                   工程依赖（无三方 UI 库）
├── entry/src/main/
│   ├── module.json5                   权限、UIAbility
│   ├── ets/
│   │   ├── entryability/EntryAbility.ets
│   │   ├── pages/Index.ets            Web 容器 + 13 个插件注册 + 请求拦截
│   │   ├── common/                    HarmonyBridge / PluginRegistry / PluginHandler /
│   │   │                              Json / LocalAssets
│   │   └── plugins/                   13 个原生插件（含 scale/ 蓝牙秤协议栈）
│   └── resources/
│       ├── base/element/string.json   app_name = 智练场
│       ├── base/media/                foreground / background（各 1024×1024）
│       └── rawfile/                   前端产物（由脚本生成，不入库）
├── tools/                             13 个 .mjs 工具：构建同步 / 版本 / 校验 / 翻译 / 图标
├── CHANGELOG.md                       版本记录与发版规则
└── README.md                          本文件
```

活跃工程在 `C:/HUAWEI/openGym/opengym-harmony/`，仓库内快照在
`C:/HUAWEI/openGym/openGym/opengym-harmony/`（rawfile 按 `.gitignore` 不入库）。两者源码保持一致。

---

## 三、版本与发版

`1.0.0`–`1.3.0` 是鸿蒙独立版本线；**从 `1.4.5` 起 `versionName` 与上游对齐**。
`AppScope/app.json5` 是唯一版本来源：

- `versionName 1.4.5` — 显示给用户，与上游一致
- `versionCode 10007` — 鸿蒙自有序列，严格递增才能覆盖安装，不与 Android 共用数字
- `buildVersion 8`

发版流程：

```bash
node tools/bump-version.mjs patch --note "修复了什么"
node tools/sync-web.mjs                 # 重建前端、同步 rawfile
# assembleHap → 新建 tag harmony-v<版本> → 独立 Release
```

每个版本对应唯一 Release，附件带版本号，附 `.sha256` 与 `SHA256SUMS`。应用内「检查更新」与
仓库链接都指向 `/releases/latest`。历史版本包不删除，但只推荐最新版。

---

## 四、运行与构建

### 环境

- DevEco Studio **26.0.0 Release**（HarmonyOS 7 / API 26）；**不要用 26.0.1 Beta 构建，Beta 包无法上架**
- Node.js 20+；本机 SDK：`C:/Program Files/Huawei/DevEco Studio/sdk/default`

### DevEco Studio

用 DevEco Studio 打开本目录，等依赖同步完成，选真机或模拟器点运行。rawfile 已在包内，一般无需重建前端。

### 命令行出包（三个已验证的坑）

```bash
# 坑 1：工程路径必须纯 ASCII。中文路径会让 hvigorw.bat 参数解析出错。
#      复制到一个全新的干净目录，例如 C:/ogsrc-clean（不要用增量 robocopy 复用旧目录——
#      它会残留已删除的 chunk 和资源，把不该进包的文件编进去）。
robocopy C:\HUAWEI\openGym\opengym-harmony C:\ogsrc-clean /E /XD build .hvigor node_modules oh_modules .git

cd C:/ogsrc-clean
export JAVA_HOME="C:/Program Files/Huawei/DevEco Studio/jbr"
export DEVECO_SDK_HOME="C:/Program Files/Huawei/DevEco Studio/sdk"
# 坑 2：PATH 必须是 Unix 风格；Windows 风格 C:/... 在 PackageHap 的 spawn java 阶段会 ENOENT。
export PATH="/c/Program Files/Huawei/DevEco Studio/jbr/bin:$PATH"

node hvigorw.js assembleHap --mode module -p product=default
```

> 在 Git Bash 中调用 robocopy 还要 `export MSYS_NO_PATHCONV=1`，否则 `/E` 被转成 `E:/` 而报无效参数。
> 若必须增量同步，用 `/MIR` 镜像；但安全策略可能拦截删除 `.hvigor`，此时**换全新目录**最稳。

产物在 `entry/build/default/outputs/default/entry-default-unsigned.hap`。

### 只改 Web 前端时

```bash
cd C:/HUAWEI/openGym/openGym/frontend
VITE_MOBILE=1 VITE_HARMONY=1 VITE_HARMONY_VERSION=1.4.5 npx vite build --emptyOutDir false
cd C:/HUAWEI/openGym
node _reachable.mjs --prune    # 清掉增量构建累积的哈希 chunk
node _sync_min.mjs             # 同步 dist → rawfile
python _repack.py <基座.hap> <输出.hap>   # 仅替换 rawfile，带不进原生资源改动
```

改了 `.ets` 或 `resources/base/**` 必须走完整编译（`_repack.py` 带不进资源改动）。

### 校验

```bash
node tools/verify-harmony.mjs    # 静态校验：当前 42 项，0 提醒
node tools/test-bridge.mjs       # 桥接协议、Promise 语义、事件
node tools/test-assets.mjs       # 资源映射、MIME、包内容
node tools/check-translations.mjs# 语言包覆盖度
```

`test-assets.mjs` 直接从 `LocalAssets.ets` 读映射规则，防的是白屏那个坑：脚本以错误 MIME 返回会被
浏览器拒绝加载，编译器发现不了。

---

## 五、桥接如何工作

Capacitor 插件方法是 Promise 形态，鸿蒙 `registerJavaScriptProxy` 是 void 形态。桥接自己加了一层请求-响应：

```
页面                                    原生侧
 │ Filesystem.readFile(opts)
 │ └ nativeCall('Filesystem','readFile',opts)
 │    └ window.JSBridgeHandle.call(ticket,method,payload)
 │                                  │ 按插件名分发、执行
 │                                  │ runJavaScript('window.__ogResolve(ticket,result)')
 │ ← Promise resolve(result) ←──────┘
```

- **ticket**：每次调用一个，原生侧凭它找回 Promise
- **超时 15 秒**：原生不答则 reject，不挂起
- **事件**：原生 → 页面走 `window.__ogEmit(name,payload)`

前端适配层在 `frontend/src/lib/harmony/`：`bridge.js`（传输）、`core.js`（Capacitor 核心）、
`plugins.js`（插件 shim）、`index.js`（装到全局）。

---

## 六、四个关键设计决定

### 1. 对前端报告的平台是 `android`

openGym 的平台判断严格二分，返回第三个值 `harmony` 会让本地提醒、安全存储、文件镜像全落到 Web
降级分支。选 `android`（同样是 WebView + 原生插件层）复用既有分支，真实平台通过
`window.__ogNative.platform` 单独提供。代价：`channel.js` 认为是侧载 APK 而开启自更新检查，
鸿蒙版没有自更新实现，那条分支不做任何事。

### 2. `registerPlugin` 的 proxy 必须屏蔽 `then`

Capacitor proxy 对任何属性都返回原生方法，`then` 也不例外。装着 proxy 的 Promise 被当成 thenable，
调原生 `then()` 后永不 settle——历史上导致 AI 教练「保存并使用」一直灰着（issue #42）。
兼容层明确让 `then`/`catch`/`finally` 返回 `undefined`，`test-bridge.mjs` 有专门一项。

### 3. 本地资源走虚拟域名 + 拦截

Vite 产物是 `<script type="module">` + 动态 import，ArkWeb 内核禁止 `file://` / `resource://`
跨域加载模块，页面会白屏。`customizeSchemes` 解决不了——它开的是自定义协议，恰好不是这两个。

做法：用 `https://localhost` 加载页面，`onInterceptRequest` 拦下所有请求，从包里读文件回答。
`common/LocalAssets.ets` 负责路径映射与 MIME。**域名必须是 `https://localhost`**：应用 API 服务器
只接受 `https://localhost` / `capacitor://localhost` / `http://localhost` 三个 Origin
（拿 `Access-Control-Allow-Private-Network`），换域名页面能开但首次 API 调用就失败。
域名不会真解析到网络，请求从不离开手机。

### 4. 动作动画读进内存播

Resource 地址每次 seek 都慢读，循环跳回 0 会卡 1–5 秒。上游 `components/Media.jsx` 的
`useClipInMemory` 在 MOBILE 构建下把 clip 读进内存（20–40 KB）再用 `blob:` 播放。鸿蒙构建带
`VITE_MOBILE=1`，自动生效。前提是 MIME 正确：`.mp4` 以 `application/octet-stream` 返回浏览器会拒绝播放。

---

## 七、原生能力对照

| Capacitor 插件 | 鸿蒙实现 | Kit |
| --- | --- | --- |
| `SecureStorage` | AI 教练 API Key 持久化 | `@kit.ArkData` |
| `Filesystem` | 应用私有目录、状态镜像、导入导出 | `@kit.CoreFileKit` |
| `LocalNotifications` | 训练提醒 | `@kit.NotificationKit` |
| `BarcodeScanner` | 扫码配对服务器 | `@kit.ScanKit` |
| `Share` | 系统分享面板 | `@kit.AbilityKit` |
| `App` | 返回键、应用状态、退出 | `@kit.AbilityKit` |
| `SplashScreen` | 启动屏交接 | — |
| `CapacitorHttp` | 原生 HTTP，绕开 WebView CORS | `@kit.NetworkKit` |
| `GymReminder` | 健身房位置提醒 | `@kit.LocationKit` |
| `HealthConnect` | 华为运动健康本机读写 | `@kit.HealthServiceKit` |
| `Scale` | 蓝牙体重秤直读 | `@kit.ConnectivityKit` |
| `Channel` | 返回 `sideload` | — |
| `Capacitor` | Capacitor 核心兼容 | — |

**明确不支持**（shim 返回 reject，特性关闭但不挂起）：Apple Watch、桌面小组件、实况窗、
iOS 健康、MLKit 下载模块。上游 `live-activity.js` / `widgets.js` 是 iOS/Android 共用代码，
在鸿蒙平台自动降级，不影响训练主流程。

**已按用户决定删除的鸿蒙专属能力**：实况窗（Live View Kit）与桌面卡片（Form Kit）
曾于 r8 引入，2026-11-20 移除。r12 包内无 `LiveViewKit` / `FormKit` 代码与资源，
不再依赖 AGC 场景权限。详见 `CHANGELOG.md` 与 `../交付文档/新特性落地与降级清单.md`。

---

## 八、权限

`entry/src/main/module.json5` 声明 10 项，每条带用户可读的理由（商店审核会看）：

| 权限 | 用途 |
| --- | --- |
| `INTERNET` / `GET_NETWORK_INFO` | 连接 openGym 服务器 |
| `KEEP_BACKGROUND_RUNNING` | 后台保持连接 |
| `ACCESS_BLUETOOTH` | 蓝牙体重秤 |
| `LOCATION` / `APPROXIMATELY_LOCATION` | 健身房位置提醒 |
| `CAMERA` | 扫码配对 |
| `MEDIA_LOCATION` / `READ_IMAGEVIDEO` / `WRITE_IMAGEVIDEO` | 进度照片、自定义动作视频 |

---

## 九、体积

r12 未签名 HAP 约 **235 MiB**（246,258,324 字节）：

| 部分 | 体积 | 说明 |
| --- | --- | --- |
| Web 产物 | ~43 MB | 25 个语言包 + 前端 chunk，与 Android/iOS mobile 构建同源 |
| 动作媒体 | 13109 个文件 | 静帧 + clip，由 `catalogue/media/` stage 进包 |

动作媒体不在前端构建里：Vite 只拷 `public/`，`sync-web.mjs` 要在 build 后调
`scripts/catalogue/stage-media.mjs` 把它们拷进 `dist/exercise-media/` 再进 rawfile。
漏这步的后果很隐蔽：页面正常，但每个动作位置显示哑铃占位图。

> 许可：媒体由 Gym visual 授权给 openGym，**仅限应用内使用**，随包分发允许，
> 不得导出、热链或喂给 AI 系统。见 `catalogue/media/NOTICE.md`。

---

## 十、图标与启动屏

应用图标分层：`AppScope/resources/base/media/background.png` 与 `foreground.png`
均为 1024×1024，背景层无透明像素，不自裁圆角、不加内边距。图形与网页版图标同源，
`app.json5` 引用 `$media:layered_image`。

```bash
node tools/make-app-icon.mjs
node tools/preview-icon.mjs AppScope/resources/base/media
```

启动屏不显示图标：`startWindowIcon` 指向全透明图，打开应用直接看到网页自己的启动画面。
静态校验会检查透明性与 1024×1024 尺寸。

---

## 十一、签名与上架

**交付的 HAP 未签名，不能直接安装。** 上架前需：

1. DevEco Studio：`File → Project Structure → Signing Configs` 登录华为账号，自动签名；
   或手动在 AGC 申请证书与 profile 填入 `build-profile.json5` 的 `signingConfigs`
2. 重新 `assembleHap`，`hdc install <已签名.hap>` 或直接 Run 到真机
3. 真机验证：ArkWeb 在真机与模拟器有差异，返回键、扫码、通知、位置都要过一遍
4. Health Service Kit：AGC 申请 scopes / client_id / 公钥指纹 / HUAWEI ID 授权
5. 隐私政策说明位置、相册、相机用途；上架材料含截图、简介、软件备案

HarmonyOS 7 起 AGC 支持上传后自动重签，用于发布；不解决本地调试直装。

---

## 十二、已知限制与验收状态

- **设备验证未执行**：HAP 已由 hvigor 完整编译并通过 42 项静态校验，但**未在 Previewer /
  模拟器 / 真机跑过**。深/浅色、动态字阶 1.3、安全区、开合连续性、断点均待验证。
  详见 `../交付文档/合规自检表.md`。
- 兼容范围 `compatibleSdkVersion 26.0.0`，即只支持 API 26+；低版本设备无法安装，
  不是功能降级。若需覆盖存量设备见 `../交付文档/新特性落地与降级清单.md` 第 6 节两个备选。
- AI 教练原生 HTTP 路径已实现，TLS 与超时行为未在真机验证。
- 健身提醒的 nudge check 只实现配置与存储，实际网络询问待接。

签名装机后按 `../交付文档/运行与验收一页纸.md` 的 5 个画面点验。

---

## 十三、与上游的关系

前端仅三处鸿蒙改动：`frontend/src/lib/harmony/`（新增兼容层）、
`frontend/vite.config.js`（alias 仅在 `VITE_HARMONY=1` 生效）、`frontend/src/main.jsx`（同开关）。
其他构建一行代码不受影响。上游 v1.4.5 于 2026-11-18 三方合并进来，中文语料与动作描述保留鸿蒙版翻译。

完整改动历史见 `CHANGELOG.md`；官方复用出处见 `../交付文档/官方复用清单.md`；
版本基线与拍板项见 `../交付文档/复用与合规基线.md`。
