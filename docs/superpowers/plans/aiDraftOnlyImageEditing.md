# New Conversation Draft-Only and Image Editing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让新对话只能搭建图片/视频节点而不能提交生成，并让全部 AIHubKit 图片模型在用户手动发送时支持本地参考图直传。

**Architecture:** 在 Agent 工具装配边界过滤直接媒体生成工具，并包装 CanvasContext 隐藏和拒绝图片/视频生成节点函数；手动节点路径保持不变。在 AIHubKit 供应商内部根据 `request.images` 分流 JSON 文生图与 multipart 图生图，继续复用现有分组密钥、异步轮询、结果解析和文件落盘链路。

**Tech Stack:** TypeScript、Bun、Express、Vue 3、FormData/Blob、现有 Provider 与 Canvas 工具协议。

**Spec:** `docs/superpowers/specs/aiDraftOnlyImageEditingDesign.md`

**Repository constraint:** 根目录 `AGENTS.md` 禁止新增测试或自检文件，因此本计划不创建测试模块；每项使用现有 typecheck/build 与只读或无付费的运行验证。该仓库约束优先于通用 TDD 模板。

---

### Task 1: Enforce the draft-only Agent boundary

**Files:**
- Modify: `apps/server/src/agent/tools/index.ts`
- Modify: `apps/server/src/agent/runtime/prompt.ts`

**Step 1: Add the CanvasContext guard**

新增一个聚焦的包装函数，过滤 `node:generateImage`、`node:generateVideo`，同时覆盖初始 `tools`、`getNodeTools` 返回值和 `nodeTools` 实际调用。拒绝信息明确告诉 Agent 已完成画布准备、需要用户手动发送。

**Step 2: Disable direct image/video generation tools**

在 Agent 装配 `mediaGeneration` 工具时强制 `allowImage: false`、`allowVideo: false`，保留本次范围之外的音频设置。用户保存的工具配置不被覆盖。

**Step 3: Align the runtime prompt**

把“生成前询问后可执行”改为“只完成节点、提示词、参考连线和推荐配置；等待用户点击节点发送”。明确禁止直接媒体工具和节点生成函数。

**Step 4: Verify**

Run: `bun run --filter '@toonflow/server' typecheck`

Expected: exit 0，且不改动设置文件。

**Step 5: Commit**

```bash
git add apps/server/src/agent/tools/index.ts apps/server/src/agent/runtime/prompt.ts
git commit -m "feat: keep agent media generation draft only"
```

### Task 2: Advertise image editing for every synced image model

**Files:**
- Modify: `apps/server/src/utils/media/generation.ts`
- Modify: `packages/skills/canvas/SKILL.md`
- Modify: `packages/skills/workflow/references/canvasExecution.md`

**Step 1: Expand dynamic image modes**

把 AIHubKit 图片模型的能力从 `mode: ["text"]` 改为 `mode: ["text", "singleImage", "multiReference"]`。继续按实时目录决定模型与分组是否存在。

**Step 2: Align Skill instructions**

Skill 只允许搭建和填写，不再授权 Agent 调用节点生成；所有付费执行交给用户点击。说明参考图必须真实连线，不能只写进提示词。

**Step 3: Verify**

Run: `bun run --filter '@toonflow/server' typecheck && bun run --filter '@toonflow/node-image-generation' typecheck`

Expected: exit 0。

**Step 4: Commit**

```bash
git add apps/server/src/utils/media/generation.ts packages/skills/canvas/SKILL.md packages/skills/workflow/references/canvasExecution.md
git commit -m "feat: expose image reference modes for account models"
```

### Task 3: Submit local references through the image edit API

**Files:**
- Modify: `packages/providers/src/media/aiHubKit.ts`

**Step 1: Add MediaInput-to-Blob conversion**

支持 provider 已有的 `base64`、`binary` 和 `url` 输入。工作区本地图片通常由服务端转换为 base64；适配器解码后创建带 MIME 和安全文件名的 Blob。URL 输入仅在确实由调用方提供时下载，不把 URL 字符串冒充文件。

**Step 2: Add multipart edit submission**

构造 FormData：`model`、`prompt`、可选 `size`，以及每张图片一个 `image` 字段。优先提交 `/v1/images/edits/tasks`；404/405 时回退 `/v1/images/edits`。异步结果沿用生图任务查询、归档等待和结果解析。

**Step 3: Route by actual references**

`request.images` 非空时调用图生图；为空时保持现有文生图。删除当前主动拒绝参考图的分支。任何图生图失败直接抛出上游可读错误，不重试为文生图。

**Step 4: Verify**

Run: `bun run --filter '@toonflow/server' typecheck && bun run build:tools && bun run build:nodes`

Expected: exit 0，且构建产物包含更新后的供应商与节点协议。

**Step 5: Commit**

```bash
git add packages/providers/src/media/aiHubKit.ts
git commit -m "feat: send local references to image edit api"
```

### Task 4: Integrate, package, and install locally

**Files:**
- Modify only if required by compilation: directly affected source files above
- Preserve: `/Applications/data`

**Step 1: Run repository verification**

Run: `bun run typecheck && bun run build`

Expected: exit 0。

**Step 2: Review the whole branch**

检查 Agent 是否仍有任何图片/视频生成旁路、图生图是否可能把本地路径发给上游、FormData 是否错误设置 Content-Type、失败是否会静默改模型或降级。

**Step 3: Package the macOS client**

Run: `bun run package:desktop`

Expected: exit 0，生成新的 `Mangosteen Studio.app`。

**Step 4: Replace and launch the app**

退出正在运行的旧进程，保留 `/Applications/data`，用新构建替换 `/Applications/Mangosteen Studio.app` 后重新启动。

**Step 5: Manual acceptance without paid generation**

确认登录会话恢复、图片模型目录仍来自当前账号、图片节点可连接本地参考图、对话 Agent 能设置节点但其工具清单不再提供图片/视频生成入口。付费图生图留给用户亲自点击验证。

**Step 6: Commit any compilation-only fixes**

```bash
git add <only-the-affected-files>
git commit -m "fix: complete draft only image editing integration"
```

## Review Focus

- Agent 直接媒体工具与 Canvas `nodeTools` 两条生成路径必须同时封死。
- 手动节点点击必须仍能调用原来的生成接口。
- multipart 由运行时生成边界，不手写 `Content-Type`，避免缺失 boundary。
- 本地路径、钥匙串凭据、临时上传令牌和预签名 URL 不得进入日志、文档或提交。
- 全图片模型开放属于明确产品决定；上游模型拒绝参考图时必须保留原配置并展示错误。
