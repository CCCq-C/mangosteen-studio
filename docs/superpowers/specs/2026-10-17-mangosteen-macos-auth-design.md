# 山竹漫剧 macOS 客户端：登录与底座改造设计

- 状态：已确认
- 确认日期：2026-10-17
- 产品名称：山竹漫剧
- 私有仓库：`CCCq-C/mangosteen-studio`
- 上游底座：`HBAI-Ltd/Toonflow-app` 的 `v2.0.6` 标签（提交 `c6756b9`）
- 首发平台：macOS

## 1. 目标

第一批交付把 Toonflow 变成可独立启动的“山竹漫剧”macOS 客户端。用户必须先通过 AIHubKit 注册或登录，验证成功后才能进入 Toonflow 原生工作台。

本批次只建立账户入口和客户端底座，不接入生图、生视频、多模态、数字人、余额提醒等业务接口。后续功能按独立批次逐项设计、实现和验收，避免一次性改造全部系统。

## 2. 方案选择

采用“原生工作台改造”方案：保留 Toonflow 已有 Electrobun、Vue 3、Pinia、Express、本地工作区和画布结构，只替换品牌、账户入口和访问控制。

未采用的方案：

- 不在 Toonflow 外再套一层旧版 Layout A，避免两套导航和状态管理。
- 不改成公网 Web 服务，macOS 客户端继续使用内置本地服务。
- 不重写画布、剧本、角色、场景和分镜组件。

## 3. 首批范围

### 3.1 包含

1. 将可见产品名称、macOS 应用名称、Bundle Identifier、URL Scheme 和基础品牌资源替换为山竹漫剧。
2. 复用 Toonflow 现有欢迎页的双栏布局，将 TF-Router iframe 登录替换为 AIHubKit 原生登录与注册表单。
3. 增加邮箱验证码、注册、登录、会话恢复和退出登录。
4. 增加全局路由守卫，未认证用户不能访问首页和工作台。
5. 使用操作系统安全凭据存储保存会话；密码不落盘。

首版品牌图标复用已有的山竹头像资产，不另做视觉设计。

### 3.2 不包含

- 不实现任何生成节点或模型参数表单。
- 不创建 AIHubKit 模型 API Key；后续在首次使用相应模型分组时按需创建并缓存。
- 不实现充值、余额、消费日志或余额提醒。
- 不实现 Windows、Android 或 iOS 客户端适配。
- 不配置 Apple 签名和公证；本地可安装构建属于本批验收，正式签名发布需要单独提供 Apple Developer 凭据。

## 4. 系统边界

```text
登录/注册页面
    ↓ 同源请求
Toonflow 内置本地服务
    ├── AIHubKit 账户适配器 ── HTTPS ──> apimodel.aihubkit.com
    └── Bun.secrets ──> macOS Keychain

认证状态 ──> Vue Router 全局守卫 ──> Toonflow 原生首页/工作台
```

### 4.1 Web 界面

- 复用 `apps/web/src/pages/hello/index.vue` 的成熟布局，不新增另一套欢迎页。
- 使用独立 Pinia 账户 Store 管理 `unknown`、`authenticated`、`unauthenticated` 三种状态，避免启动时短暂显示工作台。
- 登录页只接收用户名和密码；注册页接收用户名、密码、邮箱和邮箱验证码。
- 前端只获得公开账户信息，不获得 Session Cookie 或 Access Token。

### 4.2 路由访问控制

- 应用启动先读取本地会话状态，完成前保持加载状态。
- 未认证时，所有业务页面统一重定向到欢迎页。
- 已认证时，访问欢迎页自动进入现有首页。
- 会话验证返回未授权时立即清除本地账户状态并回到欢迎页。
- 登录成功后将现有 `helloCompleted` 标记写为完成，跳过原 TF-Router 配置引导。

### 4.3 本地账户接口

账户接口沿用 `apps/server` 的既有 Express、Zod、`validateFields`、`success` 和 `error` 结构。每个接口一个文件：

- 发送邮箱验证码。
- 注册。
- 登录。
- 查询当前会话。
- 退出登录。

本地服务负责远程请求、Cookie 解析、Token 换取、错误归一化和安全存储。远程地址固定为 `https://apimodel.aihubkit.com`，界面不能更改 Base URL。

### 4.4 安全存储

- 使用 Bun 1.3 提供的 `Bun.secrets`，在 macOS 上落到登录钥匙串。
- Service 名固定为 `com.mangosteen.studio`，凭据名固定为 `aihubkitSession`。
- 存储 `userId`、显示名称、Session Cookie 和 Access Token；每次登录或会话刷新时整体覆盖。
- 密码只在单次登录或注册请求的内存中存在，不写入 `settings.json`、Local Storage、日志或工作区文件。
- 退出登录删除钥匙串条目；删除失败时不切换为已退出状态，并向用户显示错误，防止误以为凭据已清除。

`Bun.secrets` 的 macOS 实现使用 Keychain Services，见 [Bun Secrets 官方文档](https://bun.sh/docs/runtime/secrets)。打包后的 Electrobun 主进程必须实际验证该能力，不能只以类型检查通过作为验收。

## 5. AIHubKit 数据流

### 5.1 邮箱验证码

1. 前端提交邮箱到本地接口。
2. 本地服务校验邮箱格式。
3. 本地服务调用 `GET /api/verification?email=...`。
4. 成功后界面开始验证码冷却计时；失败时显示远程错误，不自动重试。

### 5.2 注册

1. 前端提交用户名、密码、邮箱和验证码。
2. 本地服务调用 `POST /api/user/register`。
3. 本地服务固定加入 `aff_code: "DlQa"`；前端不传入、不显示也不能覆盖该字段。
4. 注册成功后切换到登录状态，不自动假设已经建立会话。

### 5.3 登录

1. 本地服务调用 `POST /api/user/login`，从响应读取用户 ID、显示名称和 `Set-Cookie`。
2. 使用 Session Cookie 和 `New-Api-User` 请求头调用 `GET /api/user/token`。
3. 两步都成功后才把完整会话写入 macOS Keychain。
4. 本地接口只返回 `{ authenticated, user: { id, displayName } }`。
5. 前端更新账户 Store，写入引导完成标记，然后进入 Toonflow 首页。

### 5.4 启动恢复

1. 本地服务从 Keychain 读取会话。
2. 使用保存的 Cookie 和用户 ID 重新获取 Access Token。
3. 成功则更新 Keychain 中的 Token 并返回已认证。
4. 明确的未授权响应会删除失效会话；网络异常不会删除仍可能有效的会话，但本次启动保持锁定并提供重试。

### 5.5 退出登录

1. 前端请求本地退出接口。
2. 本地服务删除 Keychain 会话。
3. 前端清空账户 Store 并跳转欢迎页。
4. 当前版本不依赖远程注销接口；远程 Session 最长仍按服务端有效期处理。

远程字段与接口以 [AIHubKit 用户系统对接文档](https://86bdknokqu.apifox.cn/9446929m0.md) 为准。

## 6. 错误处理

错误按互斥类别处理：

| 类别 | 示例 | 客户端行为 |
| --- | --- | --- |
| 输入错误 | 邮箱无效、验证码为空、密码为空 | 表单内提示，不发送远程请求 |
| 账户错误 | 密码错误、验证码错误、账户被禁用 | 保留当前表单，显示 AIHubKit 可读信息 |
| 网络错误 | DNS、TLS、超时、连接失败 | 显示“网络不可用”并提供手动重试，不修改已有会话 |
| 协议错误 | 缺少用户 ID、Cookie 或 Token、非 JSON 响应 | 显示“账户服务返回异常”，不写入半成品会话 |
| 本地安全存储错误 | Keychain 不可用、写入或删除失败 | 读取或写入失败时保持工作台锁定；删除失败时保留登录状态并明确提示失败阶段 |

日志可以记录请求阶段、HTTP 状态和请求 ID，但禁止记录密码、验证码、Cookie、Access Token 或未来的 API Key。

## 7. 复用与改动原则

- 复用现有欢迎页布局、Element Plus 表单组件、Pinia、Axios、服务端校验和统一响应格式。
- 账户适配逻辑集中在 AIHubKit 账户工具中，不散落到 Vue 组件或多个路由。
- 现有 `tfAccount.vue`、余额和充值组件本批不删除；后续接入余额功能时再按 AIHubKit 账户模型改造。
- `tfRouter` 供应商本批不接线到 AIHubKit，也不删除，避免账户改造与模型改造耦合。
- 不新增第三方依赖，不新增测试框架或测试文件。

## 8. 品牌、更新与上游关系

- 私有仓库的 `origin` 指向 `CCCq-C/mangosteen-studio`。
- 公共仓库的 `upstream` 指向 `HBAI-Ltd/Toonflow-app`，便于后续人工评估升级。
- 基线固定在 `v2.0.6`，不直接跟随上游 `master` 自动变化。
- 保留 Toonflow 的 MIT LICENSE 和来源说明。
- 首批关闭指向 Toonflow 官方仓库的自动更新，防止定制客户端被上游安装包覆盖。私有发布渠道另行设计后再启用更新。

## 9. 验收标准

### 9.1 构建检查

- 依赖锁定安装成功。
- 现有 TypeScript 类型检查通过。
- Web、Server 和 macOS Desktop 构建通过。
- 生成本机架构可启动的 macOS 安装产物。

### 9.2 手动功能检查

1. 首次启动只能看到山竹漫剧登录/注册入口。
2. 注册请求包含固定 `aff_code: "DlQa"`，界面没有该字段。
3. 错误账号不能进入首页或工作台。
4. 有效账号登录后进入原生 Toonflow 首页，随后可以打开工作台。
5. 关闭并重新打开客户端后自动恢复登录；退出登录后重启仍停留在登录页。

成功登录的最终联调由用户使用自己的 AIHubKit 账号完成。开发过程不读取现有山竹插件中的账号密码，也不将用户凭据提交到 Git。

### 9.3 回归边界

- 登录后现有项目列表、剧本、资产、分镜和画布页面可以正常打开。
- 未改造的生成能力允许暂时不可用；登录引导不得再要求用户登录 TF-Router 或手工填写 TF-Router API Key。现有高级供应商设置留待后续模型接入批次改造。
- 本批只报告实际完成的构建和手动验证，不把类型检查或构建通过描述为登录功能已联调成功。

## 10. 后续批次边界

下一批只选择一个独立能力进入新的设计流程。候选能力包括生图、生视频、多模态、数字人、余额与提醒；本设计不规定其实现顺序或参数界面。
