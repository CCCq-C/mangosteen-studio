# AIHubKit 动态定价与实际扣费校准 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让当前账号的 AIHubKit 图片、视频模型同步真实分组价格，在生成前按节点参数显示预计额度，并用当前用户使用日志保存最近实际价格。

**Architecture:** Server 使用登录 Cookie 获取账号专属定价 JSON，安全解释媒体公式并与现有动态目录合并；现有媒体报价接口调用 AIHubKit estimator；实际日志按用户和完整参数签名保存在本地，作为 Token 模型的优先参考。

**Tech Stack:** Bun、TypeScript、Express、Vue 3、Element Plus、`@babel/parser`、现有 AIHubKit catalog、现有 mediaPrice 组件与 `conf`

**Spec:** `docs/superpowers/specs/aihubkitPricingSyncDesign.md`

---

## Global Constraints

- 不执行上游 `billing_expr`，只解释白名单 AST。
- 不把 Cookie、Token、API Key、原始公式或完整日志返回 Web。
- 定价失败不能阻断模型同步或生成。
- 不新增测试、自检文件或测试依赖；按仓库规则使用既有 typecheck、build 和真实只读接口/界面验证。
- 不实现文本计费、跨用户汇总、支付或新的生成能力。

### Task 1: 账户专属定价会话边界

**Files:**
- Modify: `apps/server/src/utils/aihubkit/account.ts`
- Create: `apps/server/src/utils/aihubkit/pricingCatalog.ts`

**Interface:**

```ts
export interface AihubkitPricingSession {
  userId: number;
  sessionCookie: string;
}

export interface AihubkitRawPricingModel {
  modelId: string;
  tags: string[];
  groups: string[];
  salesRatios: Record<string, number>;
  quotaType: 0 | 1;
  modelPrice: number;
  billingMode: "legacy" | "tiered_expr";
  billingExpression?: string;
  pricingVersion: string;
}
```

- [ ] **Step 1:** 在 `account.ts` 增加只供 Server 使用的 `getAihubkitPricingSession()`；复用会话刷新，只返回用户 ID 与 Cookie。
- [ ] **Step 2:** 在 `pricingCatalog.ts` 使用完整 URL请求登录态 `/api/pricing`，严格校验模型、分组倍率、销售倍率、版本和表达式长度。
- [ ] **Step 3:** 缓存当前用户最近成功快照 10 分钟；强制刷新失败时保留旧快照，首次失败向调用方抛出可读错误。
- [ ] **Step 4:** 执行 `bun run --filter '@toonflow/server' typecheck`，期望退出码 0。
- [ ] **Step 5:** 提交 `feat: sync account AIHubKit pricing`。

### Task 2: 安全媒体公式解释器

**Files:**
- Create: `apps/server/src/utils/aihubkit/pricingExpression.ts`

**Interface:**

```ts
export interface AihubkitPricingDimensions {
  resolutionTier: string;
  seconds: number;
  units: number;
  inputImageCount: number;
  inputVideoCount: number;
  inputVideoSeconds: number;
  inputAudioCount: number;
  inputAudioSeconds: number;
  referenceImageCount: number;
  referenceVideoCount: number;
  referenceAudioCount: number;
}

export interface AihubkitExpressionPrice {
  amount: number;
  tier: string;
  deferred: boolean;
}

export function evaluateAihubkitExpression(expression: string, dimensions: AihubkitPricingDimensions): AihubkitExpressionPrice | null;
export function summarizeAihubkitExpression(expression: string, ratio: number): { label: string; tips: string; kind: "fixed" | "perSecond" | "tokenEstimate" | "dynamic" } | null;
```

- [ ] **Step 1:** 用 `@babel/parser.parseExpression` 解析去掉 `v1:`/`v2:`/`v3:` 前缀后的表达式。
- [ ] **Step 2:** 递归解释白名单字面量、标识符、算术、比较、逻辑与条件节点；拒绝属性访问、赋值、模板、数组、对象和未知节点。
- [ ] **Step 3:** 只允许 `tier`、`usd`、`deferred`、`max`，并限制递归深度、表达式长度、数值必须有限且非负。
- [ ] **Step 4:** 从所有可达 `tier` 分支提取定价摘要；Token 延迟结算使用 `deferred` 的 USD 回退值并标记为预计。
- [ ] **Step 5:** 使用临时命令对当前真实表达式执行只读样例：`sd-2.0-720p` 5 秒基础值应为 3.65，`MiniMax-H3` 4 秒 768p 基础值应为 0.792；不保留测试文件。
- [ ] **Step 6:** 执行 Server typecheck 并提交 `feat: evaluate AIHubKit media pricing`。

### Task 3: 当前用户实际价格历史

**Files:**
- Create: `apps/server/src/utils/aihubkit/pricingHistory.ts`

**Interface:**

```ts
export interface AihubkitPriceSample {
  modelId: string;
  groupId: string;
  amount: number;
  createdAt: number;
  tier: string;
  dimensions: AihubkitPricingDimensions;
}

export function refreshAihubkitPriceHistory(models: ReadonlyMap<string, AihubkitRawPricingModel>): Promise<void>;
export function getAihubkitPriceSample(userId: number, modelId: string, groupId: string, dimensions: AihubkitPricingDimensions): AihubkitPriceSample | undefined;
export function scheduleAihubkitPriceHistoryRefresh(): void;
```

- [ ] **Step 1:** 用 Access Token 与 `New-Api-User` 请求 `/api/log/self?p=1&page_size=100`，解析字符串或对象形式的 `other`。
- [ ] **Step 2:** 只接受当前媒体定价模型，使用 `quota / 500000`，规范化 `estimated_billing_dimensions` 并拒绝无效金额。
- [ ] **Step 3:** 按用户、分组、模型和完整维度签名保存最新样本到 `conf` 顶层 `aihubkitPricingHistory`，每用户最多 500 项。
- [ ] **Step 4:** 调度器合并并发刷新；生成成功后延迟触发一次，不等待日志刷新完成。
- [ ] **Step 5:** 执行 Server typecheck 并提交 `feat: remember AIHubKit actual prices`。

### Task 4: 定价编排与目录公开摘要

**Files:**
- Create: `apps/server/src/utils/aihubkit/pricing.ts`
- Modify: `apps/server/src/utils/aihubkit/catalog.ts`
- Modify: `apps/server/src/utils.ts`
- Modify: `apps/server/src/routes/desktop/account/login.ts`
- Modify: `apps/server/src/routes/desktop/account/session.ts`
- Modify: `apps/server/src/routes/desktop/account/logout.ts`

**Interface:**

```ts
export interface AihubkitPriceSummary {
  label: string;
  tips: string;
  kind: "fixed" | "perSecond" | "tokenEstimate" | "dynamic";
  pricingVersion: string;
}

export interface AihubkitPricingSnapshot {
  userId: number;
  pricingVersion: string;
  syncedAt: number;
  models: ReadonlyMap<string, AihubkitRawPricingModel>;
}

export function getAihubkitPricing(force?: boolean): Promise<AihubkitPricingSnapshot>;
export function estimateAihubkitMediaPrice(modelId: string, groupId: string, request: ProviderPriceRequest): Promise<ProviderPrice | null>;
export function clearAihubkitPricing(): void;
```

- [ ] **Step 1:** 组合当前规则、模型分组销售倍率、公式摘要和最近实际样本，生成不含原始公式的公开 `price`。
- [ ] **Step 2:** 固定图片按 `modelPrice × groupRatio × units`；确定性视频按公式结果乘销售倍率；Token 模型优先完全相同维度历史，否则使用 deferred 参考值。
- [ ] **Step 3:** `catalog.ts` 对当前可用的每个模型-分组关系附加可选 `price`；价格同步失败只令 `pricingAvailable=false`，不令模型目录失败。
- [ ] **Step 4:** 登录、恢复和退出时分别预热或清理价格缓存；不把失败升级成登录失败。
- [ ] **Step 5:** 导出模块、执行 Server typecheck，提交 `feat: attach pricing to AIHubKit catalog`。

### Task 5: 设置与节点价格展示

**Files:**
- Modify: `apps/web/src/lib/aihubkitCatalog.ts`
- Modify: `apps/web/src/components/settings/modelCatalog.vue`
- Modify: `packages/toolScaffold/src/runtime.ts`
- Modify: `packages/nodeShared/src/groupNodeModels.ts`
- Modify: `packages/nodes/imageGenerationNode/src/index.vue`
- Modify: `packages/nodes/videoGenerationNode/src/index.vue`
- Modify: `apps/server/src/utils/media/generation.ts`

**Interface:**

```ts
export interface MediaModelPriceSummary {
  label: string;
  tips: string;
}

export function nodeModelLabel(model: Pick<NodeMediaModel, "label" | "priceLabel">): string;
```

- [ ] **Step 1:** 扩展公开目录与 `MediaModel` 的可选 `priceLabel`、`priceTips`，不改变第三方供应商现有模型。
- [ ] **Step 2:** 设置模型卡显示价格标签，并用 Element Plus tooltip 展示计费方式和最近实际；没有价格时不显示空占位。
- [ ] **Step 3:** 图片和视频模型下拉统一通过 `nodeModelLabel` 显示“模型 · 价格摘要”。
- [ ] **Step 4:** 动态 AIHubKit 图片、视频模型设置 `supportsPrice: true`；`getMediaPrice` 对 AIHubKit 调用 estimator，对其他供应商保持现有路径。
- [ ] **Step 5:** AIHubKit 生成成功后调用历史刷新调度器；刷新失败不改变生成结果。已挂载的 `mediaPrice` 每 10 分钟重新报价，使上游价格变化无需重开节点。
- [ ] **Step 6:** 执行 Server、Web、nodeShared、image node、video node typecheck，提交 `feat: show AIHubKit price estimates`。

### Task 6: 实际验证、安装与备份

**Files:**
- Verify only

- [ ] **Step 1:** 执行全仓 `bun run typecheck`，期望退出码 0。
- [ ] **Step 2:** 执行 `bun run build` 与 `bun run build:desktop`，期望退出码 0。
- [ ] **Step 3:** 启动本地 Server，通过现有桌面接口读取真实目录；核对 94 个价格模型、当前账号倍率和公开响应无 Cookie/Token/API Key/原始公式。
- [ ] **Step 4:** 只读调用报价接口核对 `gemini-3-pro-image-preview = 0.225`、`sd-2.0-720p 5秒 = 4.015`，并检查 Token 模型提示来源。
- [ ] **Step 5:** 构建并替换本机 macOS 客户端，打开设置、图片节点和视频节点检查价格展示；不发起付费生成。
- [ ] **Step 6:** 检查 Git diff、凭据、构建产物和工作树；提交剩余验证记录并推送私有 GitHub，核对远端 SHA。
