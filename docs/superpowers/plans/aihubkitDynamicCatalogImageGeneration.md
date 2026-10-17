# 山竹漫剧 AIHubKit 动态目录与文生图实施计划

> **执行要求：** 使用 superpowers:executing-plans 按任务顺序实施。仓库明确禁止新增测试文件、测试脚本、CI 和测试依赖，因此使用既有 typecheck、build、只读 HTTP 检查与客户端手动验收。

**目标：** 建立 AIHubKit 动态分组/模型目录，打通图片节点异步文生图，并让首页快速生图复用同一画布节点和生成链路。

**架构：** Keychain 中的账户会话是凭据唯一来源；Server 的 catalog 生成公开模型目录与私有密钥映射；现有通用媒体宿主加载内置 AIHubKit Provider；Web 只选择模型和提交生成参数。

**技术栈：** Bun、TypeScript、Express、Vue 3、Pinia、Vue Flow、现有 Toonflow Media Provider 协议、Bun.secrets。

**范围边界：** 本批实现共享动态目录和异步文生图；视频、语言调用、图生图、数字人、临时上传、余额与提醒只保留清晰扩展边界，不在本批创建半成品界面或请求。

---

## Task 1：建立隔离工作区并确认基线

**检查文件：**

- `AGENTS.md`
- `apps/server/src/utils/aihubkit/account.ts`
- `apps/server/src/utils/media/generation.ts`
- `packages/providers/src/media/index.ts`
- `packages/nodes/imageGenerationNode/src/index.vue`

**步骤 1：提交设计和计划**

在主分支检查文档没有占位符、差异没有空白错误，提交并推送私有仓库。

**步骤 2：创建功能工作树**

使用 Codex 托管工作树从 `main` 创建 `aihubkit-image-generation`，所有源码改动只在该目录完成。

**步骤 3：安装依赖并跑基线**

使用仓库既有 Bun 版本锁定安装，执行 Server、Web 和 Desktop 的既有 typecheck。记录上游既有失败，不能把它算成本次回归。

---

## Task 2：拆出共享 AIHubKit 请求与会话边界

**文件：**

- 新建：`apps/server/src/utils/aihubkit/client.ts`
- 修改：`apps/server/src/utils/aihubkit/account.ts`

**步骤 1：提取统一请求原语**

把 Base URL、超时、JSON 响应解析、错误消息提取和 `AccountServiceError` 等通用逻辑移动到 `client.ts`。函数接收调用方提供的 Header，不自行读取 Keychain。

**步骤 2：保持账户行为不变**

让登录、注册、恢复和退出继续通过原有公开函数工作。不要更改固定 `aff_code: "DlQa"`，不要改变前端账户响应结构。

**步骤 3：扩展安全会话结构**

在 `StoredSession` 中增加按分组保存的 API Key 映射。读取旧版 Keychain JSON 时把缺失映射规范化为空对象，保证已登录用户无迁移操作也能继续进入客户端。

**步骤 4：验证**

执行 Server typecheck，并通过现有会话端点确认自动登录仍返回公开账户且不暴露新增字段。

---

## Task 3：实现动态分组与模型目录

**文件：**

- 新建：`apps/server/src/utils/aihubkit/catalog.ts`
- 修改：`apps/server/src/utils/aihubkit/account.ts`
- 修改：`apps/server/src/utils.ts`

**步骤 1：定义公开目录类型**

目录项只包含模型 ID、显示名称、媒体类型和公开分组描述。私有候选项另外包含分组 ID 与 API Key，只能由 Server 内部读取。

**步骤 2：同步分组**

使用 Access Token 调用 `/api/user/self/groups`。对每个分组复用 Keychain 中已有 Key；没有时通过 `POST /api/token/` 创建无限额度分组 Key，并在拿到完整有效目录后原子更新会话。

**步骤 3：同步模型**

按分组顺序调用 `/v1/models`。新 Key 若传播延迟，只对明确的授权/渠道未就绪结果做有限重试。规范化不同响应外壳并去重相同模型 ID。

**步骤 4：分类模型**

复用成熟山竹插件已经验证的分组名与模型 ID 分类规则，输出 `image`、`video`、`language`、`unknown`。未知模型不进入运行列表，但保留数量供诊断。

**步骤 5：缓存与并发**

使用单一进行中 Promise 合并并发刷新；成功后替换完整目录并增加版本，失败保留最近成功目录。提供立即刷新、超过 10 分钟刷新和 Server 内部候选密钥解析函数。

**步骤 6：验证**

执行 Server typecheck。用当前已登录会话做只读目录同步，检查公开结果不含 Key、Cookie、Token 或签名 URL；不创建付费生成任务。

---

## Task 4：增加内置 AIHubKit 图片 Provider

**文件：**

- 新建：`packages/providers/src/media/aiHubKit.ts`
- 修改：`packages/providers/src/media/index.ts`
- 修改：`packages/providers/index.ts`

**步骤 1：实现请求与兼容提取器**

实现有限的任务 ID、状态、错误和图片 URL 提取。任何无法识别的成功响应都报协议错误，不把空响应当作完成。

**步骤 2：实现异步文生图**

调用 `POST /v1/images/generations/tasks`，每 3 秒查询 `GET /v1/images/generations/tasks/{taskId}`，最长 30 分钟，响应 AbortSignal。

**步骤 3：实现受控同步回退**

创建异步任务只有在返回 404 或 405 时才调用 `POST /v1/images/generations`。超时、参数、额度和服务错误不回退，防止重复扣费。

**步骤 4：验证包边界**

执行 Providers 的既有 typecheck/build。确认 Provider 只接受宿主注入的候选 Key，不导入 Keychain、Express、Vue 或工作区文件模块。

---

## Task 5：把动态目录接入通用媒体宿主

**文件：**

- 修改：`apps/server/src/utils/media/generation.ts`
- 修改：`apps/server/src/utils/media/provider.ts`
- 按实际导出结构修改：`apps/server/src/utils.ts`

**步骤 1：合并公开动态目录**

`listMediaModels()` 保留现有 Provider 模型，并加入 AIHubKit 公开图片/视频目录。AIHubKit 条目带稳定 Provider ID，不把分组 Key 放进返回值。

**步骤 2：注入私有运行配置**

当选择 AIHubKit 模型时，Server 从 catalog 获取有序候选 Key 并注入 Provider VM。现有第三方 Provider 加载和设置结构保持不变。

**步骤 3：处理候选渠道**

Provider 只在远端明确表示无可用渠道时请求宿主切换下一个候选；普通业务错误直接结束。实现应复用现有生成错误传播，不新增第二套状态系统。

**步骤 4：验证**

执行 Server typecheck/build，并调用既有模型列表端点检查动态图片模型可见、响应无秘密字段。

---

## Task 6：落实图片节点的模型删除行为

**文件：**

- 修改：`packages/nodes/imageGenerationNode/src/index.vue`

**步骤 1：区分新节点与旧节点**

模型列表首次加载时，新节点且模型为空可以选择第一个有效图片模型；已有非空模型若不再存在，必须清空，不能替换为第一个模型。

**步骤 2：运行前本地校验**

模型为空时停止生成，并显示“这个节点的模型已失效，请重新选择模型”。下拉列表不创建“不可用”选项。

**步骤 3：响应目录刷新**

每次打开模型选择器时请求宿主执行过期检查；成功目录变化后重复有效性判断。网络刷新失败时保留最近成功列表和节点选择，不误清空。

**步骤 4：验证**

执行节点包和 Web 的既有 typecheck/build。手动构造旧模型 ID，刷新成功后确认值为空；刷新失败时确认值仍保留。

---

## Task 7：实现首页快速生图到画布的单次交接

**文件：**

- 修改：`apps/web/src/pages/home/index.vue`
- 修改：`apps/web/src/stores/workspace.ts`
- 修改：实际承载画布节点工具上下文的工作台组件

**步骤 1：定义一次性待执行请求**

在 Workspace Store 增加只含提示词的 `pendingImageGeneration`，并提供设置与消费方法。它不持久化，不包含密钥，也不写入画布 JSON。

**步骤 2：首页创建并跳转**

首页快速生图提交后沿用现有项目创建逻辑，保存待执行请求并进入工作台；目录选择失败时不保留待执行请求。

**步骤 3：画布消费请求**

工作台就绪后消费请求，新增 `remote-imageGenerationNode`，设置提示词与当前第一个有效图片模型，然后调用节点既有 `generateImage` 工具。消费发生在调用前，避免异常恢复时重复付费。

**步骤 4：错误归位**

没有可用图片模型时仍创建节点但模型留空，节点显示重新选择模型提示，不发送请求。生成失败由该节点现有错误区域显示。

**步骤 5：验证**

执行 Web typecheck/build。手动检查首页提交后只创建一个项目和一个节点，刷新或重新打开项目不会再次自动生成。

---

## Task 8：全链路验证、版本与私有备份

**文件：**

- 按现有版本策略修改相关 `package.json`
- 更新：本设计与计划中的实际验证结果

**步骤 1：静态检查**

执行改动包及 Server、Web、Desktop 的既有 typecheck；执行仓库既有 build；检查 Git diff 和秘密扫描结果。

**步骤 2：非付费实际检查**

使用已登录会话恢复账户、同步目录、读取模型端点。模拟被删除模型只在本地状态完成，不创建远程任务。

**步骤 3：用户付费验收**

启动 macOS 客户端，由用户从图片节点或首页明确提交一次真实文生图。验收任务创建、轮询、产物下载和画布展示；开发过程不自动代用户触发付费生成。

**步骤 4：提交与推送**

检查工作树干净和提交范围，合并回 `main`，推送私有 GitHub，并核对远端 SHA。只有构建和真实客户端验收均完成后才把该功能描述为可用。

