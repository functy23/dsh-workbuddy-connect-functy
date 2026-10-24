> [!IMPORTANT]
> **本仓库已归档（archived），不再维护。**
>
> 上游风控还在持续加强：除了已有的渠道校验，UA 与请求头格式也在反复变动（`X-Conversation-*`、`acp-connection-id`、`X-No-*` 的取值与组合一再调整，每次变动都得重新对齐）。继续跟着官方客户端做字节级模仿已经越来越难，失效速度超过了可维护的节奏。
>
> **后续开发已移步至 [functy23/dsh-workbuddy-panel](https://github.com/functy23/dsh-workbuddy-panel)** —— 把 workbuddy2api 网关托管进 DSH：进程托管、模型自动发现、账号与登录管理全部收在插件内。
>
> 本仓库的代码、文档与 Release 仅作历史存档保留：不再接受 Issue / PR，不再发新版，也不保证仍然可用。

---

<div align="center">

<img src="icon.svg" width="150" alt="dsh-workbuddy-connect-functy"/>

# dsh-workbuddy-connect-functy

**corrinehu/dsh-workbuddy-connect 的 Functy 分支：仪表盘界面、多账号轮换与额度展示，把 WorkBuddy 桌面 App 的模型接到 DeepSeek Harness。**

[![dsh-workbuddy-connect-functy](https://img.shields.io/badge/dsh--workbuddy--connect--functy-0.13.17-4F46E5)](https://github.com/functy23/dsh-workbuddy-connect-functy)
[![Language](https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Top Language](https://img.shields.io/github/languages/top/functy23/dsh-workbuddy-connect-functy)](https://github.com/functy23/dsh-workbuddy-connect-functy)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](https://github.com/functy23/dsh-workbuddy-connect-functy)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[![Downloads](https://img.shields.io/github/downloads/functy23/dsh-workbuddy-connect-functy/total)](https://github.com/functy23/dsh-workbuddy-connect-functy/releases)
[![Stars](https://img.shields.io/github/stars/functy23/dsh-workbuddy-connect-functy)](https://github.com/functy23/dsh-workbuddy-connect-functy/stargazers)
[![Repo Size](https://img.shields.io/github/repo-size/functy23/dsh-workbuddy-connect-functy)](https://github.com/functy23/dsh-workbuddy-connect-functy)
[![Contributors](https://img.shields.io/github/contributors/functy23/dsh-workbuddy-connect-functy)](https://github.com/functy23/dsh-workbuddy-connect-functy/graphs/contributors)

[Issues](https://github.com/functy23/dsh-workbuddy-connect-functy/issues) • [Changelog](CHANGELOG.md) • [中文](README.md) / [English](README.en.md)

</div>

---

> ## ⚠️ 先说风险：上游正在收紧，随时可能用不了
>
> **2026-10-20 起，WorkBuddy 对话网关启用了针对第三方客户端的渠道校验**，本插件（以及所有同类第三方接入）都可能被直接拒绝。
>
> - 典型报错：`400 / code 11128 / Illegal API invocation from an unapproved channel`，中文提示「请求被拦截，请重新发送」「这次调用没通过渠道校验，可能不是官方客户端发出的」。
> - 校验维度在持续增加：已确认的有**系统提示词开头的固定句**（DSH 核心注入的 `You are an AI agent powered by DeepSeek Harness.`），以及**请求头格式**（`X-Conversation-*` 系列、`acp-connection-id`、`X-No-*` 的用法）。历史版本已经因为漏掉 `X-Conversation-*` 三件套、发错 `X-No-*` 而各被拦过一次。
> - **本插件是跟着官方客户端做字节级模仿**，属于猫鼠游戏：上游改一次，插件就可能失效一次，直到有人再适配。**没有任何版本能保证长期可用。**
> - **账号风险真实存在**：本轮排查中，一个 CN 账号的 refresh token 被上游吊销（`invalid_grant: User disabled`），另一个被判定「账号存在异常行为，已被限制使用」（`403 / 11140`）。频繁重试、批量轮换、异常调用节奏都可能加速这一判定。
> - 上游 [corrinehu/dsh-workbuddy-connect](https://github.com/corrinehu/dsh-workbuddy-connect) 已于 2026-10-20 **停止维护**，明确表示「尊重这一边界，不再继续适配」此类校验，仓库计划 2026-10-22 下线。本仓库曾是这个方向的独立分支，**现已归档停止维护**（见顶部说明），这条路到这里为止。
>
> **请自行评估是否值得用你的账号承担这个风险。** 介意的话，直接用官方 WorkBuddy 客户端。

---

这是 [corrinehu/dsh-workbuddy-connect](https://github.com/corrinehu/dsh-workbuddy-connect) 的分支，不是上游本体。上游 npm 包仍叫 `dsh-workbuddy-connect`（当前 `0.7.8`，只认 DSH `0.2.1-rc.2`）。本仓库发在 **`dsh-workbuddy-connect-functy`**，界面和账号模型都走了另一条线。

国内版 **WorkBuddy** 与国际版 **WorkBuddy AI** 同时支持：装哪个 App 就出现哪个模型分组，两个都装就两组并存，各自用自己的账号与积分。

## 和上游差在哪

对照上游稳定版 **0.7.8**（2026-10-17）。两边都有的不写进「本仓库才有」。

| | 上游 `dsh-workbuddy-connect` 0.7.8 | 本仓库 0.13.17 |
|---|---|---|
| 界面 | 设置里两张旧插件卡片 | 侧栏额度卡 + 中栏仪表盘 + 设置分区页（账号按产品合并成卡片，额度/用量/token/恢复时间都在名字下一行） |
| 账号 | 跟桌面 App 当前这一份登录 | 多账号池：轮换、扫码、令牌、桌面凭证；删除后不会被 30 秒扫描加回来；同一产品的账号合并在一张卡片里 |
| 额度 | 只在设置卡片上 | 侧栏一眼可见，可切「剩余 / 用量」样式，可关掉；设置页每账号显示剩余 / 已用 / 请求数 / token / 恢复时间 |
| DSH | **只** `0.2.0-rc.2` | **只** `0.2.1-rc.x`（见下方「支持的 DSH 版本」） |
| 更新提醒 | 右下角更新条 | 无（未移植） |
| npm | `dsh-workbuddy-connect` | `dsh-workbuddy-connect-functy` |

两边都有：国内/国际分组、图片输入、推理档位检测、模型显隐、国内企业额度、选择器里的倍率与促销徽章、Windows Electron 发现、按区域识别 effort 拒绝码。

**请求身份**：chat 送出的是 `WorkBuddy/<v> WorkBuddy/<v> CLI/<v>` 的 UA（**两服都是 `WorkBuddy`，不带 `AI`**——两个官方包的网关代理都这么拼）、`X-IDE-*` 归属头、`X-Agent-Intent: craft` / `X-Agent-Purpose: conversation` / `X-Agent-Type: main` / `x-codebuddy-request: 1` / `X-Private-Data: true`，以及共享同一 traceId 的 `traceparent` + B3 + `X-Trace-ID`。会话头按官方规则分三层生命周期：`X-Conversation-ID` 一次会话稳定、`X-Conversation-Request-ID` 一轮稳定、`X-Conversation-Message-ID` 每请求新；空闲 30 分钟换会话、10 分钟换轮。chat 不带 `Origin`/`Referer`（官方原生客户端也不带），控制台接口仍然带。两服的 chat 头**完全相同**，只有 URL、`X-Domain` 和版本号按区域取；请求体差异也只有国际服补 system 消息、去掉 `reasoning_effort: off` 两条。

## 展示

对话里直接用 WorkBuddy 模型（输入框显示倍率与推理档位，底栏有用量和额度）：

<img src="assets/chat.png" width="1000" alt="对话里使用 WorkBuddy 模型，底栏显示用量与额度">

模型选择器按 WorkBuddy / WorkBuddy AI 分组，带倍率与免费标记：

<img src="assets/model-picker.png" width="1000" alt="模型选择器里的 WorkBuddy 与 WorkBuddy AI 分组">

设置页管账号池、周期额度与模型列表：

<img src="assets/settings-accounts.png" width="1000" alt="设置页：多账号、周期额度、模型列表">

勾选要出现在选择器里的模型：

<img src="assets/settings-models.png" width="1000" alt="设置页：只显示勾选的模型">

## 功能

- **开箱即用**：装上并启用后，对话里直接选 WorkBuddy 模型。插件复用桌面 App 的登录，账号切换会跟。
- **仪表盘**：侧栏底部一张额度卡，点开中栏看完整面板；设置 → **DSH-WorkBuddy** 管账号、模型、上下文长度和推理档位检测。卡片本身可以关掉。
- **多账号轮换**：同一产品可放多个账号。请求在可用账号之间轮换；被上游限流的会暂时搁置，稍后自动重试。添加方式：扫码、网页令牌、桌面端凭证。
- **额度**：侧栏可显示剩余额度或「已用 / 总量」；国内企业账号走企业计费接口。
- **图片输入**：多数模型支持粘贴或拖入图片。
- **推理档位**：上游声明了的直接显示。没声明的，Web / Desktop 可在选择器里点「推理等级」手动检测（会发少量请求，可能扣积分）。
- **模型显隐**：按登录账号分别保存。隐藏只影响选择器，已有会话不受影响。

## 安装

前置：已安装并登录 WorkBuddy 桌面 App（国际版同理）。核心必须对上，否则 DSH 起不来。

> **⚠️ 此次更新跨度较大，并未经过充分测试，更新后可能出现显示问题以及其他更严重的问题。**
> 升级前建议备份 `~/.dsh`（尤其 `.workbuddy-*.json` 状态文件与 `profiles/<profile>/cordis.patch.yml`）。
>
> 本版另有两处**不兼容变化**：entry id 改为 `llm-workbuddy-functy`；locale 命名空间改为
> `settings.workbuddy.functy` / `panel.workbuddy.functy`。与上游 `dsh-workbuddy-connect` 同时安装会
> 因 provider id 冲突导致发消息失败，请只保留一个。
### 支持的 DSH 版本（**只此一条线**）

| 版本 | 是否支持 | 说明 |
|---|---|---|
| `0.2.1-rc.x`（实测 `0.2.1-rc.2`） | ✅ **支持** | 本版按这条线的 kernel 与 `pi-ai 1.1.0` 编译并实测 |
| `0.2.0-rc.x` | ❌ 不支持 | 其 `dsh-llm-pi-ai` 基于 `pi-ai ^0.87.1`，与本版锁定的 `1.1.0` 冲突，进程里会同时存在两代 pi-ai，**请求在发出 HTTP 之前就报 `PI_AI_ERROR`** |
| `0.1.7-alpha.x` | ❌ 不支持 | 同上，那一线基于 `pi-ai ^0.85.1` |
| `0.2.1` 之后的 prerelease | ⚠️ 未验证 | peer range 不接受，需要显式改动 |

`peerDependencies` 已收窄到 `^0.2.1-rc.1` 与 `@earendil-works/pi-ai ^1.1.0`，所以在装错的宿主上**包管理器会直接拒绝安装**，而不是装完才发现模型不能用。


**本版 `0.13.17` 只支持 DSH `0.2.1-rc.x`**（实测 `0.2.1-rc.2`）。**不要装在 `0.1.7-alpha.x` 或 `0.2.0-rc.x` 上** —— 原因见下。

> **不要装 npm 上的 `dsh-workbuddy-connect`。** 那是上游包，和本仓库不是同一条线。

### 从界面安装

DSH 的 **添加插件** 对话框接受：npm 包名（可带版本）、Git 地址、tarball、或本机绝对路径。

1. 打开 **设置 → 插件**（有的客户端写「扩展管理」）。
2. 选 **添加插件**。
3. 填下面任一标识，确认：

```text
dsh-workbuddy-connect-functy
```

或：

```text
github:functy23/dsh-workbuddy-connect-functy
```

4. 装完**刷新页面**；没生效就**重启 DSH 客户端**。桌面 App 由它自己拉起 profile，不要用 `dsh --profile desktop` 当启动命令。

### 从命令行安装

把 `<profile>` 换成实际 profile（`web` / `desktop`）。

从 npm（推荐）：

```sh
dsh plugin --profile <profile> add dsh-workbuddy-connect-functy
```

从 GitHub（仓库里已有预构建 `lib/`，git 安装不会跑 `prepack`）：

```sh
dsh plugin --profile <profile> add github:functy23/dsh-workbuddy-connect-functy
```

```sh
# Web
dsh plugin --profile web add dsh-workbuddy-connect-functy
dsh web
```

```sh
# Desktop（DSH 0.2+ 才让 CLI 管 desktop profile）
dsh plugin --profile desktop add dsh-workbuddy-connect-functy
```

DSH 0.2 之前 CLI 不接受 `desktop` profile，请走上面的界面安装。套壳桌面 App（如 DSH NEXT）的 CLI 入口是自带的 `desktop-cli`，它要求 PATH 上有 `pnpm`。

配置入口：

```text
设置 → 模型                         ← 不显示 WorkBuddy 两行（有意如此）
设置 → 内置插件 → workbuddy-connect  ← 只读运行状态，不是配置入口
侧栏底部                             ← 额度卡，点开中栏仪表盘
设置 → DSH-WorkBuddy                 ← 账号、模型、侧栏显示
聊天模型选择器                       ← WorkBuddy / WorkBuddy AI 分组
```

## 命令行

CLI 二进制仍叫 `dsh-workbuddy-connect`（和 provider id 一样没改，避免已装用户的脚本对不上）：

```sh
dsh plugin --profile <profile> exec dsh-workbuddy-connect status
dsh plugin --profile <profile> exec dsh-workbuddy-connect accounts
dsh plugin --profile <profile> exec dsh-workbuddy-connect doctor
```

默认国内版；加 `--provider workbuddy-ai` 走国际版。`accounts` 只读。`logout` 只删插件自留副本，不动桌面 App 的登录。

## 已知限制

- 在 macOS 的 Web / Desktop 下验证过（DSH `0.2.1-rc.2`，Node 22+）。Windows 依次探 Local 与 Roaming AppData；WSL 优先读挂载的 Windows 用户目录。用户名不一致时用 `WORKBUDDY_AUTH_FILE` / `WORKBUDDY_AI_AUTH_FILE`。
- 侧栏两个显示偏好要宿主能写设置；状态文档没有对应字段时，设置页不画开关。
- 国际版模型目录来自 App 界面接口，属私有实现，可能失效；届时按「本账号上次成功目录 → 内置目录」降级。
- 国际版企业计费未验证；无凭据时该版模型分组不再显示。
- 依赖 WorkBuddy 客户端接口，App 更新后插件可能要跟。
- **网关的渠道校验是最容易失效的一环**：它按「请求是否像官方客户端」判定，判定维度在增加（系统提示词开头、`X-Conversation-*` 三件套、`acp-connection-id`、`X-No-*` 的用法）。上游改一次，插件就可能整体不可用，直到有人再适配。
- 本插件当前按官方客户端的字节级特征做对齐，**不做任何风控规避**（不改 IP、不伪造设备指纹、不做批量注册）。因此上游若引入新的维度（设备、频率、签名），本插件不会尝试绕过。

## 免责声明

仅供个人学习研究，只驱动使用者自己的账号在本机调用。遵守 WorkBuddy 服务条款；后果自负。与腾讯、WorkBuddy、DeepSeek 均无关联。

**关于封禁与稳定性的明确说明**（不重复上方风险框，只补可操作的部分）：

- 本插件通过模仿官方客户端的请求特征来通过网关校验。这类校验属于**对方单方面随时可变**的机制，本仓库无法承诺任何可用性期限，也不保证你的账号不会因此被限制或封禁。
- 上游自 2026-10-20 起收紧后，社区里已出现账号被限制的实例（含本仓库排查过程中的两个）。**建议只用自己的账号、控制调用频率、不要用于批量或多开场景。**
- 如果出现 `400 / 11128`，先确认是不是上游又换了校验维度，而不是急着反复重试 —— 重试本身可能加速风控判定。把 `requestId` 附在 issue 里比反复试更有用。
- 不提供任何规避风控、批量注册、多账号池规模化使用的支持。

## 致谢

- [corrinehu/dsh-workbuddy-connect](https://github.com/corrinehu/dsh-workbuddy-connect)（MIT）— 上游本体。
- [Mars-Sea/dsh-commandcode-provider](https://github.com/Mars-Sea/dsh-commandcode-provider)（MIT）— 设置页、仪表盘与账号行的布局。
- [franksong2702/dsh-codex-connect](https://github.com/franksong2702/dsh-codex-connect)（Apache-2.0）— 插件结构与输入框「推理等级」控件的参照。
- [Sliverkiss/workbuddy2api](https://github.com/Sliverkiss/workbuddy2api)（MIT）— 上游协议参照。

## 许可证

[MIT](./LICENSE) © 2026 Corrine Hu and Functy
