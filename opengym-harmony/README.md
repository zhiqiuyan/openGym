# openGym 鸿蒙版（HarmonyOS NEXT）

openGym 是一个开源的健身与体重记录工具，官方提供 Android（Capacitor）与 iOS（Swift）两个原生外壳。
本目录是它的**鸿蒙版外壳**：用 ArkUI 的 Web 组件承载同一套 React 前端，旁边放一个 ArkTS 原生桥接，
把 Capacitor 插件的调用接到鸿蒙的系统能力上。

---

## 一、为什么是这个架构

HarmonyOS NEXT 没有官方 Capacitor 运行时。摆在面前的三条路：

| 方案 | 工作量 | 结论 |
|------|--------|------|
| **ArkUI Web 组件 + ArkTS 桥接** | 中等 | ✅ 采用。前端 818 个源文件零改动 |
| react-native-harmony 重写 | 极大 | UI 层全部废弃，React DOM 与 RN 组件模型不兼容 |
| 全原生 ArkTS 重写 | 极大 | 9 个视图 + 图表 + 热力图 + passkey，以月计 |

这也是华为官方对 Web 迁移给出的第一阶段建议（[华为开发者问答](https://developer.huawei.com/consumer/cn/forum/topic/0203199390574763281)）：
用 Web 组件加载现有 Web 应用先上架，再逐步把关键页面原生化。

**前端复用了什么**：整个 `openGym/frontend`，一行 UI 代码没改。只加了一层
`frontend/src/lib/harmony/`——把 `@capacitor/*` 的导入重定向到兼容层。

---

## 二、目录结构

```
opengym-harmony/
├── AppScope/                          应用级配置（包名、版本、图标）
├── build-profile.json5                工程构建配置
├── oh-package.json5                   工程依赖
├── entry/
│   ├── src/main/
│   │   ├── module.json5               模块配置（权限声明在此）
│   │   ├── ets/
│   │   │   ├── entryability/
│   │   │   │   └── EntryAbility.ets   入口 Ability
│   │   │   ├── pages/
│   │   │   │   └── Index.ets           Web 容器页 + 桥接注册
│   │   │   ├── common/
│   │   │   │   ├── HarmonyBridge.ets   桥接调度中心
│   │   │   │   ├── PluginRegistry.ets  插件表
│   │   │   │   ├── PluginHandler.ets   插件接口
│   │   │   │   └── Json.ets            JSON 读取辅助
│   │   │   └── plugins/                8 个原生插件
│   │   └── resources/rawfile/           前端产物（由脚本生成）
├── CHANGELOG.md                       鸿蒙版版本记录与发版规则
└── tools/
    ├── sync-web.mjs                   构建前端并同步到 rawfile
    ├── bump-version.mjs               升版本号（patch / minor / major）
    ├── verify-harmony.mjs             静态校验（37 项）
    └── test-bridge.mjs                桥接运行时测试（22 项）
```

---

## 二之一、版本与发版

鸿蒙版从 `1.0.0` 起有独立的 semver 版本线，与上游 Android / Web / iOS 无关。
`AppScope/app.json5` 是**唯一版本来源**：`versionName` 显示给用户，`versionCode` 每版 +1
（鸿蒙要求严格递增才能覆盖安装），`buildVersion` 每版 +1。`tools/sync-web.mjs` 把
`versionName` 传给前端，`vite.config.js` 也会在缺少环境变量时直接读这份清单，所以「设置里
显示的版本」和「安装包版本」不会各说各话。

每次发版一条命令起头：

```bash
node tools/bump-version.mjs patch --note "修复了什么"   # 或 minor / major
node tools/sync-web.mjs                                # 重建前端并同步 rawfile
# 然后 assembleHap，新建 tag harmony-v<版本> 与独立 Release
```

**不要覆盖已有 Release 的附件**：每个版本号必须对应唯一的包。附件名带版本号，另附
`.sha256` 与 `SHA256SUMS`；应用内「检查更新」和仓库 README 都指向 `/releases/latest`，
发新版无需改代码。完整规则与历史见 `CHANGELOG.md`。

---

## 三、怎么跑起来

### 前提
- DevEco Studio 5.0 或更新（HarmonyOS NEXT，API 12+）
- Node.js 20+（构建前端用）

### 用 DevEco Studio

```bash
# 1. 构建前端并放进包里（一次就够，之后用 DevEco 打开即可）
node tools/sync-web.mjs

# 2. 用 DevEco Studio 打开本目录，等它同步完依赖

# 3. 选一台鸿蒙设备或模拟器，点运行
```

### 用命令行编译（可选，用于出包）

DevEco Studio 里点运行最省事。但如果要脚本化出包，注意三个坑：

```bash
# 1. 工程路径必须是纯 ASCII
#    hvigor 会把 C:\Users\<中文用户名> 按错误编码读成乱码，工程路径含中文时
#    hvigorw.bat 的参数也会乱。先复制到 D:\ogsrc 这样的纯 ASCII 路径再编译。

# 2. HOME 指向纯 ASCII 路径，让 hvigor 缓存不落在中文用户目录下
export JAVA_HOME="C:/Program Files/Huawei/DevEco Studio/jbr"
export DEVECO_SDK_HOME="C:/Program Files/Huawei/DevEco Studio/sdk"
export OHOS_SDK_HOME="C:/Program Files/Huawei/DevEco Studio/sdk/default"
export NODE_HOME="C:\Program Files\Huawei\DevEco Studio\tools\node"
export HOME="C:\oghome"
export USERPROFILE="C:\oghome"
export PATH="$JAVA_HOME/bin:$NODE_HOME:$PATH"

# 3. @ohos/hvigor 在华为私有源，不在 npm 上，工程根需要 .npmrc：
#    registry=https://repo.huaweicloud.com/repository/npm/
#    @ohos:registry=https://repo.harmonyos.com/npm/
#    然后先跑 ohpm install，再跑 hvigorw。
./hvigorw.bat --mode module -p product=default -p module=entry@default \
  -p buildMode=debug assembleHap --no-daemon
```

产物在 `entry/build/default/outputs/default/entry-default-unsigned.hap`。
本工程自带的 `build/` 目录里放了一份编好的。

### 校验与测试

```bash
node tools/verify-harmony.mjs    # 静态校验：配置、权限、插件表、ArkTS 约束、产物完整性
node tools/test-bridge.mjs        # 运行时测试：桥接协议、Promise 语义、事件、插件契约
node tools/test-assets.mjs        # 资源映射测试：路径映射、MIME 类型、包内容一致性
node tools/check-translations.mjs # 翻译覆盖度：界面文案、动作描述、动作步骤
```

`check-translations.mjs` 报告中文（简体与繁体）的翻译覆盖情况。它从语言包本身统计，
所以跟着代码走：界面文案有没有缺键、动作详情页会不会露出英文、动作步骤翻译了多少。
数字是实时的，不写死在文档里。

`test-assets.mjs` 管的是本地资源这条链路——白屏那个坑就是它防住的：映射错了文件，
或者 MIME 类型不对让浏览器拒绝加载，编译器都发现不了。它直接从 `LocalAssets.ets` 源文件里
读规则（而不是另抄一份），所以源文件改了这里会跟着发现。

---

## 四、桥接是怎么工作的

Capacitor 的插件方法是 **Promise** 形态的（`Filesystem.readFile(...)` 返回一个 Promise）。
而鸿蒙的 `registerJavaScriptProxy` 是 **void** 形态的——原生侧没法直接把值返回给调用方。

所以桥接自己加了一层请求-响应：

```
页面                          原生侧
 │  Filesystem.readFile(opts)   │
 │  └ nativeCall('Filesystem', 'readFile', opts)
 │       └ window.JSBridgeHandle.call(ticket, method, payload)
 │                                │  按插件名分发
 │                                │  执行插件逻辑
 │                                │  runJavaScript(`window.__ogResolve(ticket, result)`)
 │  ← Promise resolve(result) ←──┘
```

- **票据**（ticket）：每次调用一个，原生侧凭它找回对应的 Promise
- **超时**：15 秒。原生调用不答，Promise 会 reject 而不是永远挂着
- **事件**（原生 → 页面）：`window.__ogEmit(name, payload)`，页面的 `addListener()` 收

前端适配层在 `openGym/frontend/src/lib/harmony/`：

| 文件 | 作用 |
|------|------|
| `bridge.js` | 传输层：票据、超时、事件分发 |
| `core.js` | Capacitor 核心 API（`Capacitor`、`registerPlugin`、`CapacitorHttp`） |
| `plugins.js` | 各插件的 shim |
| `index.js` | 入口：把 `window.Capacitor` 装到全局 |

---

## 五、三个关键设计决定

### 1. 对前端报告的平台是 `android`，不是 `harmony`

openGym 的平台判断是**严格二分**：

```js
// lib/mobile.js、lib/platform-now.js
return p === 'ios' || p === 'android' ? p : null
```

返回第三个值 `harmony`，本地提醒、安全存储、文件镜像会**全部落到 Web 降级分支**——
手机上就只剩一个网页。`android` 是两者中更接近鸿蒙外壳的那个（同样是 WebView + 原生插件层），
所以复用既有的 Android 分支。真实平台通过 `window.__ogNative.platform` 单独提供。

代价：`channel.js` 会认为这是侧载的 APK 版本，因此开启自更新检查——鸿蒙版没有自更新实现，
那条分支不做任何事。

### 2. `registerPlugin` 的 proxy 必须屏蔽 `then`

Capacitor 的 proxy 对**任何**属性名都返回一个原生方法，`then` 也不例外。于是一个装着 proxy 的
Promise 被当成 thenable，去调原生侧的 `then()`——那个方法永不返回，Promise 永远不 settle。

项目里踩过这个坑（issue #42：AI 教练的「保存并使用」按钮一直灰着，"保存了但没生效"）。
兼容层里 `then`/`catch`/`finally` 明确返回 `undefined`。`tools/test-bridge.mjs` 有一项专门盯这个。

### 3. 本地资源必须走虚拟域名 + 拦截，不能靠 `customizeSchemes`

前端是 Vite 产物，`<script type="module">` + 动态 import。ArkWeb 内核**禁止 `file://` 和
`resource://` 协议访问跨域资源**，模块导入一律被拦，页面永远白屏。

真机上的报错长这样：

```
Could not load resource://rawfile/assets/index-Kr6mHU6B.js
```

（`index.html` 本身加载成功了——它内嵌的看门狗脚本跑起来，才用 openGym 自己的措辞报了这个错。）

**`customizeSchemes` 解决不了。** 它开的是**自定义**协议，`file` 和 `resource` 不是自定义协议，
恰恰是内核刻意关掉的两个。而且 `$rawfile('index.html')` 走的是 `resource://rawfile/`，
跟配的 `file` 也不是一个协议。

官方给的路子是**方法一**：用 https 域名加载页面，再用 `onInterceptRequest` 把请求拦下来，
从包里读文件回答：

```typescript
// Index.ets
Web({ src: APP_ORIGIN + '/index.html', controller: this.controller })
  .onInterceptRequest((event: OnInterceptRequestEvent): WebResourceResponse | null => {
    return this.intercept(event);   // 返回 null = 放行
  })
```

`common/LocalAssets.ets` 负责映射：`https://localhost/<path>` → `rawfile/<path>`，
并给出正确的 MIME 类型。**MIME 类型不能错**——脚本以 `text/plain` 返回会被浏览器直接拒绝
（"the MIME type ... is not a supported JavaScript MIME type"），模块图照样起不来。

**域名必须是 `https://localhost`**，这不是随便选的。应用自己的 API 服务器只接受三个
WebView Origin：

```javascript
// api/server.js
const APP_ORIGINS = new Set(['https://localhost', 'capacitor://localhost', 'http://localhost']);
```

只有这三个才拿得到 `Access-Control-Allow-Private-Network`——手机配对局域网服务器时必需。
换个域名，页面能打开，但第一次 API 调用就失败。

这个域名不会真的解析到网络：所有请求都被应用自己回答，请求从不离开手机。

---

### 4. 动作动画要读进内存播，不能直接给 URL

Android 版踩过一个坑：clip 从包里通过 Capacitor 的本地服务器读出，那个服务器**对每次 seek
都重新慢读**，循环一圈跳回 0 就卡住 1-5 秒，用户看到的是「慢且卡」的动画。

鸿蒙版是同一个坑：`https://localhost` 的资源也是应用自己从包里喂的，一样慢。
好在**前端已经处理了**——`components/Media.jsx` 的 `useClipInMemory` 在 MOBILE 构建下
把 clip 一次性读进内存（20-40 KB）再从 `blob:` URL 播放，绕开 seek。
鸿蒙构建带 `VITE_MOBILE=1`，这条路径自动生效，不需要改前端。

**代价是 MIME 类型必须对**：`.mp4` 以 `application/octet-stream` 返回，浏览器会拒绝播放，
动画永远不出现——页面看不出哪里错了，只会显示静帧。
`common/LocalAssets.ets` 的 `mimeOf` 里有 `video/mp4` 这一条，是这个原因。

---

## 六、原生能力对照表

| Capacitor 插件 | 鸿蒙实现 | Kit |
|----------------|---------|-----|
| `SecureStorage` | AI 教练的 API Key 存进加密偏好设置 | `@kit.ArkData` |
| `Filesystem` | 应用私有目录，状态镜像与导入导出 | `@kit.CoreFileKit` |
| `LocalNotifications` | 训练提醒 | `@kit.NotificationKit` |
| `GymReminder` | 健身房位置提醒（含配置、服务器配对、位置） | `@kit.LocationKit` |
| `BarcodeScanner` | 系统扫码（扫码配对服务器） | `@kit.ArkScan` |
| `Share` | 系统分享面板 | `@kit.AbilityKit` |
| `App` | 返回键、应用状态、退出 | `@kit.AbilityKit` |
| `SplashScreen` | 启动屏交接 | — |
| `CapacitorHttp` | 原生 HTTP，绕开 WebView 的 CORS | `@kit.NetworkKit` |
| `Channel` | 返回 `sideload`（鸿蒙由应用商店更新） | — |

**明确不支持**（调用会明确 reject，特性自动关闭，不会挂起）：
Apple Watch、桌面小组件、实时活动、iOS 健康、Health Connect、MLKit 下载模块。

---

## 七、权限

`entry/src/main/module.json5` 里声明，每一条都带用户看得懂的理由（商店审核会看这个）：

| 权限 | 用途 |
|------|------|
| `INTERNET` / `GET_NETWORK_INFO` | 连接 openGym 服务器 |
| `KEEP_BACKGROUND_RUNNING` | 后台保持连接 |
| `POST_NOTIFICATIONS` | 训练提醒 |
| `LOCATION` / `APPROXIMATELY_LOCATION` | 判断是否在健身房附近 |
| `CAMERA` | 扫码配对 |
| `MEDIA_LOCATION` / `READ_IMAGEVIDEO` / `WRITE_IMAGEVIDEO` | 进度照片、自定义动作视频 |

---

## 八、体积

| 部分 | 体积 | 说明 |
|------|------|------|
| 前端产物 | 26 MB | 19 个语言包 + 练习资源，与 Android/iOS 的 mobile 构建**完全一致**——不是鸿蒙适配带来的 |
| 动作静帧 | 33 MB | 6554 个 `.webp`（180 px），`exercise-media/still/` |
| 动作动画 | 157 MB | 6554 个 `.mp4`，`exercise-media/clip/` |
| **HAP 合计** | **218 MB** | 手机/平板的 HAP 上限是 4 GB，不构成问题 |

**动作媒体不在前端构建里。** vite 只拷贝 `public/`，而动作图画在 `catalogue/media/`，
所以 `tools/sync-web.mjs` 要在 `vite build` 之后调 `scripts/catalogue/stage-media.mjs`
把它们拷进 `dist/exercise-media/`，再一起进 `rawfile/`。

漏掉这一步的后果很隐蔽：页面照常打开、所有功能都正常，只是**每个动作位置显示一个哑铃占位图标**
——因为每个 `<img>` 指的文件都不在包里。仓库里的媒体是 180 px 的那一份（`APP_MEDIA_DIR`
指向的私有素材目录只有发布者有，仓库里没有）。

> 许可：这些媒体由 Gym visual 授权给 openGym，**仅限在应用内使用**，随包分发是允许的，
> 但不得导出、不得热链、不得喂给任何 AI 系统。见 `catalogue/media/NOTICE.md`。

---

## 九、上架前还需要做的

本工程交付的是**源码**。以下几步需要真机与账号：

1. **签名配置**：`AppScope/app.json5` 之外，还要在 DevEco 里配置证书与 profile
2. **真机验证**：ArkWeb 的行为与模拟器有差异，返回键、扫码、通知、位置都要在真机上过一遍
3. **隐私政策**：位置、相册、相机三项权限需要在商店页面说明用途
4. **上架材料**：截图、简介、备案（鸿蒙要求软件备案）

---

## 九之一、图标与启动屏

**应用图标**是分层图：`AppScope/resources/base/media/background.png`（1024×1024，被系统遮罩）
加 `foreground.png`（1024×1024，杠铃图形画在中央 288×288 的安全区内）。图形与网页版图标
（`openGym/frontend/resources/icon.svg`）同源，手机、PWA 与网站上是同一个标记。

重新生成：

```bash
node tools/make-app-icon.mjs                  # 写进 AppScope/resources/base/media/
node tools/preview-icon.mjs AppScope/resources/base/media  # 合成一张看看效果
```

**启动屏不显示图标**。鸿蒙的 `startWindowIcon` 是必填字段，省略不了，所以指向一张全透明的图
（`entry/src/main/resources/base/media/start_window_icon.png`）。这样打开应用时看到的是网页自己的
启动画面（那个弹跳的杠铃，在 `frontend/index.html` 里），而不是先闪一下应用图标。

静态校验会检查这两件事：启动图标必须**全透明**（只看第一个像素不算，图形可能在中央），分层图标
的两张图都必须是 1024×1024。

---

## 十、已知限制

- **真机运行只验证到"能装上"这一步**：HAP 已在本机用 DevEco Studio 26 的 hvigor 编译成功
  （`build/entry-default-unsigned.hap`），但写这套代码的机器上没有连着手机，
  ArkWeb 的实际行为没有在真机上跑过。**装到手机上后第一件事是确认应用能打开并进入主界面**——
  本地资源这条链路是纯运行时行为，三道自动化校验都覆盖不到 ArkWeb 本身的行为。
  遇到白屏或资源加载失败，看 `hdc hilog` 里 `[Index]` 和 `[LocalAssets]` 的输出。
- **AI 教练的原生 HTTP 路径**已实现，但 `http` 的 TLS 与超时行为未在真机验证。
- **健身提醒的 nudge check**（问服务器"今天是否已在别的设备练过"）只实现了配置与存储，
  实际的网络询问待接。
- **`print` / `restAlert` 等少数能力**在鸿蒙侧明确不支持。

---

## 十一、与上游的关系

前端改动只有三处：

| 文件 | 改动 | 影响 |
|------|------|------|
| `frontend/src/lib/harmony/` | 新增 | 仅鸿蒙构建使用 |
| `frontend/vite.config.js` | +17 行 | alias 仅在 `VITE_HARMONY=1` 时生效 |
| `frontend/src/main.jsx` | +8 行 | 同样由 `VITE_HARMONY` 开关控制 |

其他构建（web / Android / iOS）**一行代码都不受影响**——已实测三种构建均正常，
项目测试套件 6537 项中 6525 项通过，剩余 12 项失败经 stash 对比确认为**仓库原有问题**，
与本次改动无关。
