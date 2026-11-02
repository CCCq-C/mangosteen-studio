# Mangosteen Studio v0.1.4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布包含在线视频模型时长同步能力的 Windows x64、macOS ARM64 与 macOS x64 v0.1.4，并让 GitHub/Gitee 提供同一批产物。

**Architecture:** 复用现有 Electrobun、NSIS、DMG、GitHub Actions 与 Gitee 镜像链路。版本与文档一次更新；正式工作流只选择三个桌面目标，并在当前没有 Apple 凭据时生成明确标注的未签名、未公证 Mac 安装包。

**Tech Stack:** Bun 1.3.14、TypeScript、Electrobun、NSIS、GitHub Actions、Gitee Release API

**Spec:** `docs/superpowers/specs/videoDurationCapabilitiesDesign.md`、`docs/superpowers/specs/dualUpdateSourcesDesign.md`

## Global Constraints

- 版本统一为 `0.1.4`，不移动或修改旧 `v0.1.2`、`v0.1.3` 标签和附件。
- 只发布 Windows x64、macOS ARM64 与 macOS x64，不发布 Android。
- Windows 不签名；Mac 不签名、不公证，README 与 Release 必须明确手动安装边界。
- 不新增框架、依赖、测试模块或测试入口。
- GitHub/Gitee 必须使用同一提交、标签、文件名、大小和 SHA-256。

## Review Focus

- 桌面矩阵不得包含 Android，三个桌面目标必须各出现一次；由工作流参数校验与产物集合核验覆盖。
- Apple 凭据为空时不得进入签名步骤，Mac 包仍须完成 DMG 与归档结构验证；由 macOS 构建日志覆盖。
- Windows 安装包名称必须为 `MangosteenStudio-Windows-x64-v0.1.4-Setup.exe`；由发布工作流精确匹配覆盖。
- Mac ARM64 与 x64 DMG 必须可区分且各一个；由发布工作流精确匹配覆盖。
- Gitee 网络中断不得触发重建或替换已验收产物；由幂等镜像工作流和远端哈希复核覆盖。

---

### Task 1: 统一版本与发布说明

**Files:**
- Modify: `package.json`
- Modify: `electrobun.config.ts`
- Modify: `apps/web/src/components/settings/panels/about.vue`
- Modify: `README.md`
- Create: `docs/releases/v0.1.4.md`

**Interfaces:**
- Consumes: 现有 `appVersion` 环境变量和关于页回退值。
- Produces: 全部桌面目标一致的 `0.1.4` 版本与人工安装说明。

- [ ] **Step 1:** 将三个版本回退值统一改为 `0.1.4`。
- [ ] **Step 2:** README 改为 Windows、Apple Silicon Mac、Intel Mac 均为 v0.1.4，并保留未签名警告。
- [ ] **Step 3:** 新增 v0.1.4 Release 说明，写明在线视频模型时长同步和 10 分钟目录刷新。
- [ ] **Step 4:** 执行 `git diff --check`，预期退出码 0。
- [ ] **Step 5:** 提交 `chore: prepare v0.1.4 release`。

### Task 2: 复用工作流发布三个桌面目标

**Files:**
- Modify: `.github/workflows/debug.yml`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `debug.yml` 的可复用构建矩阵与现有桌面产物上传步骤。
- Produces: `desktop` 目标，包含 `windowsX64`、`macArm64`、`macX64`；Mac 签名步骤由显式参数控制。

- [ ] **Step 1:** 为 `debug.yml` 增加 `desktop` 目标和 `macCodesign` 布尔输入，默认关闭签名。
- [ ] **Step 2:** 仅在 `macCodesign=true` 且目标为 ARM64 时准备证书、公证和来源校验。
- [ ] **Step 3:** `release.yml` 调用 `target: desktop`，移除 Android 产物要求和下载说明。
- [ ] **Step 4:** 对 YAML 和表达式做人工审阅，执行 `git diff --check`，预期退出码 0。
- [ ] **Step 5:** 提交 `ci: release desktop v0.1.4`。

### Task 3: 本地发布前验证与合并

**Files:**
- Verify only: repository

**Interfaces:**
- Consumes: Tasks 1–2 的提交。
- Produces: 可由默认分支精确构建的发布提交。

- [ ] **Step 1:** 使用 Bun 1.3.14 执行 `bun install --frozen-lockfile`。
- [ ] **Step 2:** 执行全仓 `bun run typecheck`、`bun run build`、桌面 `typecheck` 与 `git diff --check`，任何失败停止发布。
- [ ] **Step 3:** 推送分支、创建 PR、等待检查并合并到 `main`。
- [ ] **Step 4:** 核对 GitHub/Gitee `main` 指向同一合并提交。

### Task 4: 云端构建、发布与双站验收

**Files:**
- Release artifacts only

**Interfaces:**
- Consumes: GitHub 默认分支最新提交和 v0.1.4 版本参数。
- Produces: 三个平台安装包、更新清单、完整更新包、可选补丁与 `SHA256SUMS`。

- [ ] **Step 1:** 运行 `release.yml`，参数 `version=0.1.4`、`ref` 留空。
- [ ] **Step 2:** 核验 Windows Setup、Mac ARM64 DMG、Mac x64 DMG及各自更新文件；记录 Windows `NotSigned` 和 Mac 未签名/未公证。
- [ ] **Step 3:** 在 Windows 11 x64 验证覆盖安装、启动、模型接口、更新检查与卸载；不执行付费模型生成。
- [ ] **Step 4:** 以 GitHub Actions 的 `hdiutil verify`、DMG 挂载、应用结构和可执行文件检查作为 Mac 包验收；没有实体 Mac 运行验收时必须明确记录。
- [ ] **Step 5:** 分别从 GitHub/Gitee 重新读取提交、标签、附件名称、大小和 SHA-256，要求完全一致；失败时只幂等重跑镜像，不重建产物或移动标签。
