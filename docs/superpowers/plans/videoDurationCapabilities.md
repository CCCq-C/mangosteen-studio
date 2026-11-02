# Video Duration Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让视频模型时长下拉框自动采用模型广场在线详情，并保留现有家族兜底能力。

**Architecture:** 在 AIHubKit 视频能力模块解析在线模型详情，返回明确范围、固定秒数或跟随音频；媒体模型组装层把该结果覆盖到现有家族默认时长。前端继续消费已有 `durationResolutionMap`，无需改动。

**Tech Stack:** Bun、TypeScript、现有 AIHubKit 目录同步、现有视频生成节点

**Spec:** `docs/superpowers/specs/videoDurationCapabilitiesDesign.md`

## Global Constraints

- 不新增依赖、前端组件、远端服务或测试模块。
- 模型详情优先，模型家族默认值兜底。
- `video_特惠` 不设置分组级统一时长。
- 只修改时长能力，不扩展分辨率、参考素材和计价功能。

## Review Focus

- 价格文本中的“元/秒”不能被误判为固定时长。
- 范围上下限异常或倒置时必须忽略并回退。
- 中英文范围单位及常见分隔符必须得到相同结果。
- 固定时长必须压缩为单个下拉选项。
- 数字人详情不能让现有供应商的正整数时长校验失效。

---

### Task 1: 在线详情时长解析与模型能力应用

**Files:**
- Modify: `apps/server/src/utils/aihubkit/videoCapabilities.ts`
- Modify: `apps/server/src/utils/media/generation.ts`

**Interfaces:**
- Produces: `resolveAihubkitVideoDurations(description: string | undefined): number[] | undefined`
- Consumes: 模型广场同步得到的 `model.id` 与 `model.description`

- [ ] **Step 1: 记录修改前的真实差异**

运行只读命令，对照当前模型广场详情与现有家族规则，确认 12 个差异模型。

Expected: 输出包含 `MiniMax-H3-30s 4-15 -> 4-30`、三个固定 15 秒模型；数字人单独保留兼容行为。

- [ ] **Step 2: 实现在线详情解析**

在 `videoCapabilities.ts` 新增 `resolveAihubkitVideoDurations`：优先解析范围，再解析明确固定时长；无可靠信息返回 `undefined`。

- [ ] **Step 3: 应用解析结果**

在 `generation.ts` 的 `aihubkitVideoCapabilities` 中把解析结果用于现有家族映射；`undefined` 使用当前家族默认值，空数组保留无手动时长，未知模型有明确详情时使用解析值。

- [ ] **Step 4: 一次性验证解析结果**

Run: 使用 Bun 直接导入生产函数，校验范围、固定值、价格文本、异常范围和无详情输入，并确认数字人继续使用原兼容值。

Expected: 所有手工期望值相等，进程退出码为 0。

- [ ] **Step 5: 验证编译与构建**

Run: `bun run --filter '@toonflow/server' typecheck`，再运行 `bun run --filter '@toonflow/server' build` 与全仓 `bun run typecheck`。

Expected: 三个命令退出码均为 0。

- [ ] **Step 6: 提交源码**

```bash
git add apps/server/src/utils/aihubkit/videoCapabilities.ts apps/server/src/utils/media/generation.ts docs/superpowers
git commit -m "fix: sync video durations from model details"
```
