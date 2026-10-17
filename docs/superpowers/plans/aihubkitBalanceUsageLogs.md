# AIHubKit 余额与使用日志 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用当前山竹登录会话在画布显示账户余额，并在设置中分页展示 AIHubKit 使用日志。

**Architecture:** Server 新增聚焦的 usage 模块，统一调用 `/api/user/self` 与 `/api/log/self` 并只返回安全字段；Web 新增账户用量读取模型，余额使用共享只读状态，日志页使用组件局部分页状态。

**Tech Stack:** Bun、TypeScript、Express、Vue 3、Element Plus、Axios、现有 AIHubKit Account/Client

**Spec:** `docs/superpowers/specs/aihubkitBalanceUsageLogsDesign.md`

---

## Global Constraints

- 不向 Web 返回 Access Token、Cookie、API Key、IP、Token ID 或日志 `other`。
- 不改造 `pricingHistory`，避免把价格样本缓存与日志界面耦合。
- 不新增测试、自检文件或依赖；按仓库规则执行 typecheck、build 和真实只读验证。
- 所有新文件、函数、变量、DOM 类名使用 lowerCamelCase。

### Task 1: Server 账户用量读取

**Files:**
- Create: `apps/server/src/utils/aihubkit/usage.ts`
- Modify: `apps/server/src/utils.ts`

**Interface:**

```ts
export interface AihubkitBalance {
  amount: number;
  unit: "额度";
  updatedAt: number;
}

export interface AihubkitUsageLogQuery {
  page: number;
  pageSize: number;
  startTimestamp?: number;
  endTimestamp?: number;
}

export async function getAihubkitBalance(): Promise<AihubkitBalance>;
export async function getAihubkitUsageLogs(query: AihubkitUsageLogQuery): Promise<AihubkitUsageLogPage>;
```

- [ ] **Step 1:** 复用 `getAihubkitAccess()` 构造只存在于 Server 的认证头。
- [ ] **Step 2:** 请求 `/api/user/self`，校验 `data.quota` 并返回 `quota / 500000`。
- [ ] **Step 3:** 请求 `/api/log/self`，传递分页与可选时间范围，逐项规范化安全字段并计算 `quota / 500000`。
- [ ] **Step 4:** 在 `utils.ts` 导出 `aihubkitUsage`，执行 Server typecheck，期望退出码 0。
- [ ] **Step 5:** 提交 `feat: read AIHubKit account usage`。

### Task 2: Desktop 余额与日志路由

**Files:**
- Create: `apps/server/src/routes/desktop/account/balance.ts`
- Create: `apps/server/src/routes/desktop/account/logs.ts`
- Regenerate: `apps/server/src/router.ts`

**Routes:**

```ts
POST /api/desktop/account/balance
body: {}

POST /api/desktop/account/logs
body: { page: number; pageSize: number; startTimestamp?: number; endTimestamp?: number }
```

- [ ] **Step 1:** 新增余额路由，设置 `Cache-Control: no-store` 并返回 `success(await u.aihubkitUsage.getAihubkitBalance())`。
- [ ] **Step 2:** 新增日志路由，使用 Zod 将页码限制为正整数、每页限制为 1–100、时间戳限制为非负安全整数。
- [ ] **Step 3:** 执行 `bun run --cwd apps/server routes`，不要手改自动生成路由。
- [ ] **Step 4:** 执行 Server typecheck 与 build，期望退出码 0。
- [ ] **Step 5:** 提交 `feat: expose desktop account usage`。

### Task 3: Web 用量读取模型与界面

**Files:**
- Create: `apps/web/src/lib/aihubkitUsage.ts`
- Create: `apps/web/src/components/settings/panels/usageLogs.vue`
- Modify: `apps/web/src/components/settings/index.vue`
- Modify: `apps/web/src/pages/workspace/panels/canvas/components/canvasMenu.vue`
- Modify: `apps/web/src/pages/workspace/index.vue`

**Interface:**

```ts
export const aihubkitBalance: Readonly<Ref<AihubkitBalance | undefined>>;
export const aihubkitBalanceLoading: Readonly<Ref<boolean>>;
export const aihubkitBalanceError: Readonly<Ref<string>>;
export function loadAihubkitBalance(): Promise<AihubkitBalance>;
export function loadAihubkitUsageLogs(query: AihubkitUsageLogQuery): Promise<AihubkitUsageLogPage>;
export function clearAihubkitUsage(): void;
```

- [ ] **Step 1:** 新建 Axios 读取模型，复用 `/api/desktop/account`、桌面请求头、统一响应校验与可读错误。
- [ ] **Step 2:** 画布菜单删除 provider balance/TF account 依赖，显示单个山竹余额按钮并在挂载时读取、点击时强制刷新。
- [ ] **Step 3:** 删除工作区对 `useProviderBalances()` 的调用；不删除仍被高级供应商设置复用的通用 provider billing 文件。
- [ ] **Step 4:** 新建使用日志面板，完成加载、错误、空状态、六列表格、20 条分页与刷新。
- [ ] **Step 5:** 设置侧栏新增“账户 / 使用日志”，使用 Tabler 现有图标，不引入依赖。
- [ ] **Step 6:** 执行 Web typecheck 与 build，期望退出码 0；提交 `feat: show balance and usage logs`。

### Task 4: 真实验证、安装与备份

**Files:**
- Verify only

- [ ] **Step 1:** 启动桌面开发版，真实调用余额和日志路由；核对余额与至少一条日志的 `quota / 500000`。
- [ ] **Step 2:** 检查路由响应不含 Access Token、Cookie、API Key、IP、Token ID 或原始 `other`。
- [ ] **Step 3:** 执行全仓 `bun run typecheck` 与 `bun run build`，期望退出码 0。
- [ ] **Step 4:** 执行 `bun run build:desktop` 与 macOS 打包，替换 `/Applications/Mangosteen Studio.app` 后检查余额与设置日志界面。
- [ ] **Step 5:** 检查 Git diff 与凭据，提交剩余修改，推送私有 GitHub 并核对本地与远端 SHA。
