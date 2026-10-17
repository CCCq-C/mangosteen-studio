# AIHubKit 分组模型设置实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 设置页实时按 AIHubKit 分组展示文本、图片和视频模型，并让已接通的图片生成严格使用用户选择的分组与模型。

**Architecture:** AIHubKit catalog 继续作为唯一目录来源，新增安全的公开分组契约和桌面目录接口；Web 使用共享目录组件渲染两个设置面板；通用媒体模型携带可选分组元数据，图片节点保存三元组并由 Server 精确解析一个分组密钥。

**Tech Stack:** Bun、TypeScript、Express、Vue 3、Element Plus、现有 AIHubKit catalog 与媒体 Provider 宿主

**Spec:** `docs/superpowers/specs/aihubkitGroupedModelSettingsDesign.md`

## Global Constraints

- 不硬编码当前分组或模型数量，全部来自当前登录账号实时目录。
- Web、画布和日志不得获得 Access Token、Cookie 或分组 API Key。
- 空分组直接隐藏；删除的分组或模型不显示，旧节点选择清空。
- 文本和视频本批只展示目录，不提前开放未实现的运行能力。
- 复用 Element Plus 与现有设置/provider 样式，不新增依赖。
- 仓库禁止新增测试、自检文件；只执行现有 typecheck、build 和真实接口/页面验证。

## Review Focus

- 同一模型属于多个分组时，每个分组选项必须拥有不同选择值，不能互相覆盖。
- AIHubKit 图片请求缺少或携带已删除 `groupId` 时必须拒绝，不能回退其他倍率渠道。
- 普通媒体供应商没有 `groupId` 时必须保持原有二元选择与生成行为。
- 强制同步失败时页面应保留上次成功数据，不能闪成空列表。
- 目录响应中不得出现 API Key、Access Token 或 Cookie 字段。

---

### Task 1: 公开分组目录与设置接口

**Files:**
- Modify: `apps/server/src/utils/aihubkit/catalog.ts`
- Create: `apps/server/src/routes/desktop/account/catalog.ts`
- Generated: `apps/server/src/router.ts`

**Interfaces:**
- Produces: `AihubkitCatalog.groups` 与 `POST /api/desktop/account/catalog { refresh?: boolean }`

- [ ] **Step 1:** 为公开目录增加 `AihubkitCatalogGroup` 和有序 `groups`，确保只含 ID、说明与倍率。
- [ ] **Step 2:** 新增受桌面中间件保护的目录 POST 接口，支持可选强制刷新。
- [ ] **Step 3:** 执行 `bun run --cwd apps/server routes` 生成路由。
- [ ] **Step 4:** 执行 `bun run --filter '@toonflow/server' typecheck`，期望退出码 0。
- [ ] **Step 5:** 提交 `feat: expose grouped AIHubKit catalog`。

### Task 2: 设置页动态分组目录

**Files:**
- Create: `apps/web/src/lib/aihubkitCatalog.ts`
- Create: `apps/web/src/components/settings/modelCatalog.vue`
- Modify: `apps/web/src/components/settings/panels/languageModel/index.vue`
- Modify: `apps/web/src/components/settings/panels/mediaModel/index.vue`

**Interfaces:**
- Consumes: Task 1 的目录接口与公开类型结构。
- Produces: `loadAihubkitCatalog(force)` 共享缓存和文本/媒体设置的分组视图。

- [ ] **Step 1:** 实现共享目录状态、并发去重、失败保留旧数据和强制刷新。
- [ ] **Step 2:** 使用 Element Plus 卡片、折叠区与页签实现共享目录组件，隐藏零模型分组。
- [ ] **Step 3:** 文本和媒体面板把 AIHubKit 目录置于首屏，现有供应商管理放进高级折叠区。
- [ ] **Step 4:** 执行 `bun run --filter '@toonflow/web' typecheck`，期望退出码 0。
- [ ] **Step 5:** 提交 `feat: show grouped models in settings`。

### Task 3: 图片节点精确分组选择

**Files:**
- Modify: `packages/toolScaffold/src/runtime.ts`
- Modify: `packages/tools/mediaGeneration/src/runtime.ts`
- Modify: `packages/nodeScaffold/src/nodeAi.ts`
- Modify: `packages/nodeShared/src/groupNodeModels.ts`
- Modify: `apps/server/src/utils/aihubkit/catalog.ts`
- Modify: `apps/server/src/utils/media/generation.ts`
- Modify: `packages/nodes/imageGenerationNode/src/index.vue`
- Modify: `apps/web/src/pages/workspace/index.vue`

**Interfaces:**
- Consumes: Task 1 的模型-分组关系和私有候选映射。
- Produces: `MediaModel.groupId/groupLabel/groupRatio`、`MediaGenerationRequest.groupId` 和严格分组图片请求。

- [ ] **Step 1:** 扩展媒体模型与生成请求类型，普通供应商字段保持可选。
- [ ] **Step 2:** AIHubKit 图片列表按分组-模型关系展开，并让分组辅助函数输出独立分组。
- [ ] **Step 3:** 图片节点保存三元选择，旧 AIHubKit 二元选择失效后清空；工具配置和快速生图透传 `groupId`。
- [ ] **Step 4:** Server 验证精确分组-模型关系并只注入该分组密钥。
- [ ] **Step 5:** 执行相关包 typecheck，期望全部退出码 0。
- [ ] **Step 6:** 提交 `feat: select exact AIHubKit model group`。

### Task 4: 整体验证与交付

**Files:**
- Verify only

**Interfaces:**
- Consumes: Tasks 1–3 的完整分组目录、设置页面和图片选择链路。

- [ ] **Step 1:** 执行全仓 `bun run typecheck`，期望退出码 0。
- [ ] **Step 2:** 执行 `bun run build`，期望退出码 0。
- [ ] **Step 3:** 使用当前登录会话读取真实目录，核对分组、模型数量和响应中无密钥字段。
- [ ] **Step 4:** 启动客户端检查文本设置、媒体设置和图片节点分组选择；不发起付费生成。
- [ ] **Step 5:** 检查 Git diff、提交记录和工作树，确认没有凭据、构建产物或无关改动。
