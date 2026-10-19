# Dual Update Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让山竹漫剧从下一次完整发布开始自动检查更新，国内网络优先使用 Gitee，失败时回退 GitHub，并保证两个平台发布的是同一提交、同一套安装包与更新文件。

**Architecture:** 桌面服务端把 `auto/gitee/github/custom` 解析成 Electrobun 可读的实际目录；`auto` 只在“检查”阶段按 Gitee→GitHub 回退，一旦检查成功就在后续下载与安装阶段固定该目录。Web 在桌面端启动后静默检查一次，并在“关于”页复用现有更新流程。GitHub Actions 只构建一次，将同一批产物发布到 GitHub 与 Gitee。

**Tech Stack:** Bun、TypeScript、Express、Vue 3、Element Plus、Electrobun updater、GitHub Actions、Gitee Releases API

**Spec:** `docs/superpowers/specs/dualUpdateSourcesDesign.md`

## Global Constraints

- `v0.1.1` 继续作为手动安装基线；自动更新仅在下一次同时包含清单与归档的正式版本生效。
- Gitee Token、Apple 签名证书和公证私钥只能存在于仓库 Secret，不进入源码、日志、产物或客户端设置。
- 只有 `auto` 模式允许检查阶段回退；显式选择 Gitee、GitHub 或自定义源时不得暗中改用其他来源。
- 检查成功后固定实际源，下载与安装阶段不得重新解析“最新版本”，避免混用两个平台的文件。
- 仓库禁止新增测试、自检模块；验证使用现有 typecheck、build、真实公开 API 与发布产物检查。

## Review Focus

- Gitee 最新 Release 缺失、超时、标签非法或更新清单无效时，`auto` 必须继续尝试 GitHub。
- 切换更新源后，旧源的版本、错误、下载状态必须失效，不能继续下载旧源文件。
- 启动检查不得阻塞登录或画布，也不得因为无 Release、离线或开发模式弹出错误提示。
- GitHub 与 Gitee 的发布标签、目标提交、附件名称及 SHA-256 必须来自同一次构建。
- 更新失败时保留旧版本可启动，并提供当前实际源对应的手动下载页。

---

### Task 1: 实现双源解析与事务固定

**Files:**
- Modify: `apps/server/src/utils/desktop/index.ts`
- Modify: `apps/server/src/types/desktop.ts`
- Modify: `apps/server/src/routes/settings/save.ts`

**Interfaces:**
- Consumes: `desktopUpdateSource = auto | gitee | github | custom`
- Produces: Gitee Release 解析、检查阶段回退、下载/安装阶段固定源、当前实际来源快照

- [ ] **Step 1:** 把默认来源从旧 `official` 归一化为 `auto`，保留旧值兼容迁移，并扩展设置校验枚举。
- [ ] **Step 2:** 调用 Gitee 公开 latest Release 接口，只接受正式 `vX.Y.Z` 标签并生成固定下载目录；设置连接和响应超时。
- [ ] **Step 3:** 检查更新时按逻辑源生成候选目录；`auto` 依次尝试 Gitee、GitHub，其余来源只尝试一次。
- [ ] **Step 4:** 在状态中同时记录逻辑源键与实际目录；下载、安装和快照校验只使用检查成功时固定的目录。
- [ ] **Step 5:** 在更新快照中返回当前实际来源及手动下载页，安装失败提示不再写死 GitHub。
- [ ] **Step 6:** 执行 `bun run --filter '@toonflow/server' typecheck`，期望退出码 0。
- [ ] **Step 7:** 提交 `feat: add resilient desktop update sources`。

### Task 2: 接入启动检查与更新源界面

**Files:**
- Modify: `apps/web/src/stores/desktopUpdate.ts`
- Modify: `apps/web/src/App.vue`
- Modify: `apps/web/src/components/settings/panels/about.vue`
- Modify: `apps/web/src/components/settings/panels/developer/index.vue`

**Interfaces:**
- Consumes: Task 1 的来源枚举和更新快照
- Produces: 桌面端启动静默检查、关于页手动检查/下载/安装、开发者自定义来源

- [ ] **Step 1:** 将 Web 侧来源归一化为 `auto/gitee/github/custom`，切源时立即清空旧源状态。
- [ ] **Step 2:** 为检查流程增加静默模式；启动自动检查失败只记录状态，不弹错误，也不影响后续手动检查。
- [ ] **Step 3:** 在 `App.vue` 初始化完成后仅对本地桌面端触发一次静默检查，开发模式和远程连接由现有边界拒绝。
- [ ] **Step 4:** 在“关于”页增加更新源选择、当前实际来源、检查/下载/安装按钮与进度提示，复用现有 store，避免重复状态机。
- [ ] **Step 5:** 开发者页只保留自定义 URL 编辑；清空正在使用的自定义 URL 时自动切回 `auto`。
- [ ] **Step 6:** 执行 `bun run --filter '@toonflow/web' typecheck`，期望退出码 0。
- [ ] **Step 7:** 提交 `feat: check desktop updates on startup`。

### Task 3: 一次构建发布 GitHub 与 Gitee

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `GITEE_TOKEN` 仓库 Secret 与现有构建产物
- Produces: 同一提交/标签、GitHub Release、Gitee Release、双端附件和 SHA-256 清单

- [ ] **Step 1:** 在上传前为所有构建产物生成唯一 `SHA256SUMS`，并把校验文件加入同一批 Release 附件。
- [ ] **Step 2:** GitHub Release 完成后，用临时凭据助手将构建提交与正式标签推送到 Gitee，不把 Token 写入 remote URL 或日志。
- [ ] **Step 3:** 通过 Gitee Releases API 幂等创建或读取同名正式 Release，重跑时只补齐或替换不一致附件。
- [ ] **Step 4:** 上传同一批产物和 `SHA256SUMS` 到 Gitee，并核对标签提交、附件名称、大小及校验清单。
- [ ] **Step 5:** 任一 Gitee 步骤失败时让工作流明确失败，但不删除已经成功发布的 GitHub Release，便于安全重跑。
- [ ] **Step 6:** 用 GitHub Actions 的 YAML/表达式检查和本地脚本语法检查验证工作流结构。
- [ ] **Step 7:** 提交 `ci: mirror releases to Gitee`。

### Task 4: 文档、整体验证与双仓同步

**Files:**
- Modify: `README.md`
- Modify: `docs/development.md`

**Interfaces:**
- Consumes: Tasks 1–3 的客户端与发布链路
- Produces: 用户下载说明、维护者 Secret/发布/回滚说明、双仓同提交交付

- [ ] **Step 1:** README 同时列出 GitHub 与 Gitee 下载入口，明确 `v0.1.1` 仍需手动安装、自动更新从完整后续版本开始。
- [ ] **Step 2:** 开发文档记录来源策略、`GITEE_TOKEN` 最小权限、发布重跑、双端校验与回滚流程。
- [ ] **Step 3:** 执行全仓 `bun run typecheck`，期望退出码 0；再执行 `bun run build`，期望退出码 0。
- [ ] **Step 4:** 用 Gitee 公开 latest Release 接口和 GitHub latest Release 页面做非付费真实网络验证；没有完整更新产物时必须安全回退或显示无更新。
- [ ] **Step 5:** 检查 Git diff、提交记录和工作树，确认未包含 Token、证书、构建产物及无关的 `packages/startup/assets/startup 2.json`。
- [ ] **Step 6:** 推送工作分支到 GitHub 与 Gitee，核对两个远端分支 SHA 完全一致；没有 `GITEE_TOKEN` 时明确标记 Release 自动镜像尚未激活。
