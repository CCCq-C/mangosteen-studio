# 山竹漫剧 macOS 登录底座实施计划

> **执行要求：** 使用 superpowers:executing-plans 按任务顺序实施；仓库明确禁止新增测试文件，因此以既有 typecheck、build、实际接口检查和客户端手动验收替代测试代码。

**目标：** 把 Toonflow v2.0.6 改造成“山竹漫剧”macOS 客户端首版：必须通过 AIHubKit 注册或登录后才能进入原生工作台，并将会话安全保存在 macOS Keychain。

**架构：** 保留 Electrobun、Vue 3、Pinia、Express 和原生工作台。Web 仅持有公开用户状态；内置 Server 代理 AIHubKit 账户请求并使用 Bun.secrets 管理 Cookie 与 Token；Vue Router 统一执行强制登录守卫。

**技术栈：** Bun 1.3、Electrobun 2、Vue 3、Pinia、Vue Router、Element Plus、Axios、Express、Zod、Bun.secrets。

**范围边界：** 本计划只实现品牌、注册、登录、会话恢复、退出和 macOS 构建；生图、生视频、多模态、数字人、余额与提醒均留到后续独立批次。

---

## Task 1：创建隔离工作区并确认基线

**文件：**

- 检查：AGENTS.md
- 检查：package.json
- 检查：apps/server/package.json
- 检查：apps/web/package.json
- 检查：apps/desktop/package.json

**步骤 1：确认主工作区状态**

运行：

~~~bash
git status --short --branch
git rev-parse HEAD
git remote -v
~~~

预期：main 只包含已确认的设计与实施文档改动；origin 为私有仓库，upstream 为 Toonflow 公共仓库。

**步骤 2：阅读并执行工作树技能**

完整阅读 superpowers:using-git-worktrees，然后确认 .worktrees 已被 Git 忽略。

**步骤 3：提交并推送文档**

~~~bash
git add docs/superpowers/specs/2026-10-17-mangosteen-macos-auth-design.md docs/superpowers/plans/2026-10-17-mangosteen-macos-auth-foundation.md
git commit -m "docs: add macOS auth implementation plan"
git push origin main
~~~

**步骤 4：创建功能工作树**

~~~bash
git worktree add .worktrees/macos-auth-foundation -b feat/macos-auth-foundation
~~~

**步骤 5：安装锁定依赖并跑基线**

~~~bash
bun install --frozen-lockfile
bun run --cwd apps/server typecheck
bun run --cwd apps/web typecheck
bun run --cwd apps/desktop typecheck
~~~

记录任何基线失败；如果属于上游既有问题，不能把它算作本次回归。

---

## Task 2：实现 AIHubKit 账户适配器与 Keychain 会话

**文件：**

- 新建：apps/server/src/utils/aihubkit/account.ts
- 修改：apps/server/src/utils.ts

**步骤 1：定义最小公开类型和私有会话类型**

在 account.ts 定义：

- PublicAccount：id、displayName。
- RegistrationInput：username、password、email、code。
- StoredSession：userId、displayName、sessionCookie、accessToken。
- AccountServiceError：status、用户可读 message。

固定配置：

- apiBase = https://apimodel.aihubkit.com
- Keychain service = com.mangosteen.studio
- credential name = aihubkitSession
- 请求超时 = 20 秒
- 注册邀请码 = DlQa

**步骤 2：实现统一远程请求函数**

要求：

- 使用 AbortSignal.timeout 或 AbortController 实现 20 秒超时。
- 只在响应声明 JSON 时解析 JSON；非 JSON 或字段缺失归为 502 协议错误。
- 401/403 映射为 401；其他远端 4xx 保留状态；远端 5xx 映射为 502；超时映射为 504。
- 只暴露可读错误，不记录密码、验证码、Cookie、Token 或完整响应体。

**步骤 3：实现 Cookie 与响应字段提取**

从登录响应的 Set-Cookie 只提取第一个 session 键值对，不保存 Path、Expires 等属性。对用户 ID、显示名称和 Token 做结构检查，缺失即失败，不写入半成品会话。

**步骤 4：实现五个账户动作**

- requestVerification(email)：GET /api/verification?email=...
- registerAccount(input)：POST /api/user/register，并由服务端固定插入 aff_code: DlQa。
- loginAccount(username, password)：先 POST /api/user/login，再 GET /api/user/token；两步均成功后调用 Bun.secrets.set。
- restoreAccount()：从 Bun.secrets.get 读取并刷新 Token；明确 401 时删除失效凭据，网络错误保留凭据但抛错。
- logoutAccount()：调用 Bun.secrets.delete；删除失败必须抛错。

损坏的 Keychain JSON 应删除并返回未登录，不能让解析异常永久锁死应用。

**步骤 5：从统一工具出口暴露适配器**

在 apps/server/src/utils.ts 复用现有默认导出模式，仅新增 aihubkitAccount 成员，不为单一业务增加额外 service/controller 层。

**步骤 6：类型检查并提交**

~~~bash
bun run --cwd apps/server typecheck
git add apps/server/src/utils/aihubkit/account.ts apps/server/src/utils.ts
git commit -m "feat: add secure AIHubKit account adapter"
~~~

---

## Task 3：增加受保护的本地账户路由

**文件：**

- 新建：apps/server/src/routes/desktop/account/verification.ts
- 新建：apps/server/src/routes/desktop/account/register.ts
- 新建：apps/server/src/routes/desktop/account/login.ts
- 新建：apps/server/src/routes/desktop/account/session.ts
- 新建：apps/server/src/routes/desktop/account/logout.ts
- 自动生成：apps/server/src/router.ts

**步骤 1：实现验证码路由**

POST /api/desktop/account/verification，使用 validateFields 校验 body.email 为最长 254 字符的邮箱。

**步骤 2：实现注册路由**

POST /api/desktop/account/register，校验：

- username：1–64 字符。
- password：8–128 字符。
- email：有效邮箱且不超过 254 字符。
- code：1–32 字符。

路由只能把四个公开字段交给适配器，不能接受 aff_code。

**步骤 3：实现登录路由**

POST /api/desktop/account/login，校验 username 1–254 字符、password 1–128 字符；成功仅返回 authenticated 和 PublicAccount。

**步骤 4：实现会话与退出路由**

- POST /api/desktop/account/session：返回 authenticated 与可选 user。
- POST /api/desktop/account/logout：只有 Keychain 删除成功后才返回 authenticated: false。

所有异常使用既有 success/error 响应格式并显式设置 HTTP 状态。五个路由全部使用 POST，从而复用既有 /api/desktop 桌面请求、回环地址、同源和 x-toonflow-desktop 保护。

**步骤 5：重新生成路由并检查**

~~~bash
bun run --cwd apps/server routes
bun run --cwd apps/server typecheck
~~~

确认生成路由包含五个新端点且没有手工修改自动生成结构。

**步骤 6：提交**

~~~bash
git add apps/server/src/routes/desktop/account apps/server/src/router.ts
git commit -m "feat: expose desktop account routes"
~~~

---

## Task 4：建立前端账户状态和强制路由守卫

**文件：**

- 新建：apps/web/src/stores/account.ts
- 修改：apps/web/src/router/index.ts
- 修改：apps/web/src/pages/hello/index.vue

**步骤 1：实现账户 Store**

状态保持互斥：

- status：unknown、authenticated、unauthenticated。
- user：PublicAccount 或 null。
- errorMessage：最近一次可读错误。

使用现有 Axios，固定前缀 /api/desktop/account、超时 25 秒，并发送 x-toonflow-desktop: 1。实现 restore、requestVerification、register、login、logout；不把 Cookie、Token 或密码写入 Pinia 持久化。

restore 使用单一进行中的 Promise，避免多个导航同时重复刷新会话。

**步骤 2：实现全局守卫**

在 router.beforeEach 中：

1. status 为 unknown 时先 await restore()。
2. 未认证访问非 /hello 路由时返回 /hello。
3. 已认证访问 /hello 时返回 /home。
4. 会话恢复因网络或 Keychain 错误失败时保持锁定在 /hello，并让页面显示重试入口。

**步骤 3：移除欢迎页旧重定向冲突**

删除或替换 /hello 现有基于 useHelloStore().load() 的 beforeEnter，避免它与新账户守卫形成循环。保留 useHelloStore().complete() 只用于登录成功后完成旧引导标记。

**步骤 4：类型检查并提交**

~~~bash
bun run --cwd apps/web typecheck
git add apps/web/src/stores/account.ts apps/web/src/router/index.ts apps/web/src/pages/hello/index.vue
git commit -m "feat: require account session for app routes"
~~~

---

## Task 5：把欢迎页改造成登录与注册入口

**文件：**

- 修改：apps/web/src/pages/hello/index.vue
- 使用：packages/assets/mangosteenAvatar.png

**步骤 1：保留成熟布局**

保留现有双栏背景、响应式结构和语言入口，移除 TF-Router iframe、自定义供应商输入和 API Key 引导。

**步骤 2：实现登录表单**

使用 Element Plus 既有组件：

- 用户名。
- 密码。
- 提交按钮。
- 账户 Store 的可读错误。

提交成功后依次执行 login、useHelloStore().complete()、router.replace("/home")。失败时保留用户名，清空或保留密码以现有表单习惯为准，但不写日志。

**步骤 3：实现注册表单**

字段为用户名、邮箱、验证码、密码。密码前端最少 8 字符；验证码按钮成功请求后进入 60 秒倒计时，倒计时在组件卸载时清理。

注册成功后：

- 切换到登录标签。
- 回填注册用户名。
- 不自动登录。
- 不在界面、网络 body 或前端源码中出现 aff_code。

**步骤 4：应用已确认文案**

- 登录标题：登录山竹漫剧。
- 注册标题：注册山竹漫剧。
- 描述：登录后进入短剧与漫剧创作工作台。
- 页脚：基于 Toonflow v2.0.6 构建。

图标使用 @toonflow/assets/mangosteenAvatar.png。

**步骤 5：检查交互和类型**

~~~bash
bun run --cwd apps/web typecheck
~~~

手动检查窄窗口不遮挡表单、Enter 可提交、验证码冷却期间不可重复发送、错误提示不会泄露远端响应体。

**步骤 6：提交**

~~~bash
git add apps/web/src/pages/hello/index.vue
git commit -m "feat: add Mangosteen login and registration page"
~~~

---

## Task 6：在首页提供账户入口与可靠退出

**文件：**

- 修改：apps/web/src/pages/home/index.vue

**步骤 1：替换上游推广入口**

把右上角 GitHub 推广按钮替换为账户下拉菜单，显示当前 displayName，并提供“退出登录”。

**步骤 2：实现确认退出**

用户确认后调用 accountStore.logout()。只有后端确认 Keychain 删除成功时才清空状态并跳转 /hello；失败时保留当前登录状态并显示具体失败阶段。

**步骤 3：替换首页主品牌**

将首页可见 Toonflow 名称和主图标替换为“山竹漫剧”及山竹头像，不改项目列表、创建项目和工作台入口。

**步骤 4：类型检查并提交**

~~~bash
bun run --cwd apps/web typecheck
git add apps/web/src/pages/home/index.vue
git commit -m "feat: add account menu and secure logout"
~~~

---

## Task 7：完成 macOS 品牌与上游隔离

**文件：**

- 新建：packages/assets/mangosteenAvatar.png
- 修改：packages/assets/logo.iconset/*
- 修改：electrobun.config.ts
- 修改：apps/desktop/src/index.ts
- 修改：apps/desktop/src/connection.ts
- 修改：apps/desktop/scripts/localizeMac.ts
- 修改：apps/web/src/pages/about/index.vue 或实际 About 组件
- 修改：apps/web/src/main.ts
- 修改：apps/server/src/utils/desktop/index.ts
- 修改：package.json

**步骤 1：复制已批准图标并生成 iconset**

从已有山竹插件资产复制：

~~~text
/Users/ziyan/mangosteen-obsidian-plugins/.work/5.3.8/mangosteen-image/assets/mangosteen-avatar.png
~~~

目标为 packages/assets/mangosteenAvatar.png。复制前后计算 SHA-256，必须完全一致。使用 macOS sips 从目标图生成既有 logo.iconset 需要的 16、32、128、256、512 和 1024 像素文件；不新增图片生成依赖。

**步骤 2：修改 Electrobun 元数据**

- 构建名：Mangosteen Studio。
- Bundle Identifier：com.mangosteen.studio。
- 初始版本回退：0.1.0。
- URL Scheme：mangosteen-studio。
- 更新地址回退到私有仓库 releases，不再指向 Toonflow 官方包。

**步骤 3：修改桌面可见品牌**

- macOS 菜单和窗口标题：山竹漫剧。
- 协议名称和设备名称前缀：山竹漫剧。
- 本地化脚本把 CFBundleName 与 CFBundleDisplayName 固定为山竹漫剧。
- 默认不播放带 Toonflow 字样的旧启动动画；只有显式开启时才允许播放。

**步骤 4：关闭上游遥测与自动更新**

在 apps/web/src/main.ts 移除 anonymousData 注册和启动时 checkDesktopUpdate 调用，不删除后续可能复用的底层模块。在 Server 更新工具中把兜底链接改为山竹漫剧私有 releases。

**步骤 5：简化 About 页面**

只保留：

- 山竹漫剧名称、图标与当前版本。
- “短剧与漫剧创作工作台”说明。
- “基于 Toonflow v2.0.6（MIT）”来源说明。

移除 Toonflow 官方更新按钮、仓库推广、二维码、群组和赞助入口；保留 MIT LICENSE 文件。

**步骤 6：修改根项目元数据**

更新根 package.json 的 name、description、author/repository 等产品级字段。工作区包名与内部 @toonflow/* import 本批不重命名，避免无业务价值的大范围回归。

**步骤 7：三端类型检查并提交**

~~~bash
bun run --cwd apps/server typecheck
bun run --cwd apps/web typecheck
bun run --cwd apps/desktop typecheck
git add packages/assets electrobun.config.ts apps/desktop apps/web/src/main.ts apps/web/src/pages/about apps/server/src/utils/desktop/index.ts package.json
git commit -m "feat: brand desktop app as Mangosteen Studio"
~~~

如果 About 实际路径不同，先用 rg 定位实际组件，只提交真实路径。

---

## Task 8：执行无凭据泄露的实际验证

**文件：**

- 不新增验证文件。

**步骤 1：验证 Bun.secrets 运行能力**

使用一次性 service 与随机值执行 set、get、delete。输出只允许布尔结果，不打印随机值。结束后确认凭据已删除。

**步骤 2：启动桌面开发版**

~~~bash
bun run dev:desktop
~~~

**步骤 3：验证强制登录边界**

在不使用用户真实凭据的情况下检查：

- 首次启动显示山竹漫剧登录/注册页。
- 直接访问 /home 和 /workspace 会回到 /hello。
- 无效邮箱、短密码和空验证码由本地表单拦截。
- 使用明确无效账号只产生可读错误，不能进入首页。
- 断网或账户服务失败时保持锁定，已有 Keychain 项不会被误删。
- 未登录调用退出后仍处于未登录。

为避免发送真实邮件，本步骤不点击有效邮箱的发送验证码按钮。

**步骤 4：检查敏感信息与残留品牌**

使用 rg 检查本次新增路径和运行日志：

- 不存在密码、验证码、Cookie、Token 的日志输出。
- 登录引导不再出现 TF-Router 或手填 API Key。
- 可见首屏、首页和 About 不再出现 Toonflow 主品牌；来源说明除外。

**步骤 5：记录验证边界**

明确区分：

- 已验证：构建、路由保护、输入错误、无效登录、Keychain 基本能力。
- 待用户验收：真实账号登录、重启恢复、退出后重启。

---

## Task 9：全量构建、打包、合并并推送

**文件：**

- 检查：build/desktop/artifacts/macArm64/*
- 检查：所有本批修改

**步骤 1：执行完整类型检查与构建**

~~~bash
bun run typecheck
bun run build
bun run build:desktop
bun run package:desktop
~~~

任何失败必须报告具体命令、位置、根因和修复；修复后重新执行失败命令及后续命令。

**步骤 2：检查 macOS 产物**

在 build/desktop/artifacts/macArm64 下定位产物，使用 plutil 与 codesign 检查：

- CFBundleDisplayName = 山竹漫剧。
- CFBundleIdentifier = com.mangosteen.studio。
- URL Scheme = mangosteen-studio。
- 未包含 Toonflow 官方更新 URL。
- 如无 Apple Developer 凭据，明确标注为未公证的本地安装包，不宣称正式签名。

**步骤 3：检查最终差异**

~~~bash
git status --short
git diff main...HEAD --stat
git log --oneline --decorate -10
~~~

确认没有依赖缓存、真实凭据、临时日志、验证文件或无关改动进入 Git。

**步骤 4：合并到 main**

在主工作区执行：

~~~bash
git merge --ff-only feat/macos-auth-foundation
git push origin main
~~~

**步骤 5：核对私有远端**

读取本地 main SHA 与 origin/main SHA，二者必须相同；确认仓库仍为 private。只有远端 SHA 相同才报告“已备份到 GitHub”。

**步骤 6：交付用户验收**

提供安装产物的绝对路径，并只请求两个真实凭据验收：

1. 登录成功后退出并重启，确认自动恢复登录。
2. 退出登录后重启，确认停留在登录页。

在用户完成这两项前，不宣称真实 AIHubKit 登录链路已验收。

---

## 完成定义

同时满足以下条件才算本批开发完成：

1. 未登录无法进入任何业务页面。
2. 注册请求的邀请码只能由本地服务固定为 DlQa。
3. 密码不落盘，Cookie 与 Token 只存在 macOS Keychain。
4. 山竹漫剧客户端完成类型检查、构建和本机 macOS 打包。
5. 本地 main 与私有 GitHub origin/main SHA 一致，并如实列出仍需用户凭据完成的两项验收。

