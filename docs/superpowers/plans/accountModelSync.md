# Account Model Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate AIHubKit group keys per account and reduce cold model-catalog sync time while preserving account isolation and live `/v1/models` authority.

**Architecture:** Store group keys in a per-user Keychain record, recover app-owned keys from the current upstream account before creating, then process at most three new groups per round and query model lists with bounded concurrency. The existing catalog remains the only source consumed by node selectors.

**Tech Stack:** Bun secrets, TypeScript, Express, Vue 3, Axios, AIHubKit/New API endpoints.

---

**Spec:** `docs/superpowers/specs/accountModelSyncDesign.md`

**Global constraint:** Repository rules forbid adding test modules. Each task uses existing typecheck/build commands and read-only or isolated manual validation instead of adding `.test.ts`, `.spec.ts`, fixtures, mocks, or check scripts.

### Task 1: Persist group keys per account

**Files:**
- Modify: `apps/server/src/utils/aihubkit/account.ts`

- [ ] **Step 1: Add a user-scoped Keychain name and safe read/write helpers**

```ts
function groupKeychainName(userId: number) {
  return `aihubkitGroupApiKeys.${userId}`;
}

async function readGroupKeyVault(userId: number) {
  const value = await secrets.get({ service: keychainService, name: groupKeychainName(userId) });
  if (!value) return {};
  try { return groupApiKeys(JSON.parse(value)); }
  catch { await secrets.delete({ service: keychainService, name: groupKeychainName(userId) }); return {}; }
}

async function writeGroupKeyVault(userId: number, keys: Record<string, string>) {
  await secrets.set({ service: keychainService, name: groupKeychainName(userId), value: JSON.stringify(groupApiKeys(keys)) });
}
```

- [ ] **Step 2: Load only the logging-in user's vault and preserve it across logout**

`loginAccount` merges a same-user active session with `readGroupKeyVault(user.id)`. `saveGroupApiKeys` writes both the active session and that user's vault. `logoutAccount` continues deleting only `aihubkitSession`.

- [ ] **Step 3: Run focused type checking**

Run: `bun run --filter @toonflow/server typecheck`

Expected: exit code 0 and `@toonflow/server typecheck: Exited with code 0`.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/utils/aihubkit/account.ts
git commit -m "fix: preserve account group keys"
```

### Task 2: Recover existing upstream keys before creation

**Files:**
- Create: `apps/server/src/utils/aihubkit/groupKeys.ts`
- Modify: `apps/server/src/utils/aihubkit/catalog.ts`

- [ ] **Step 1: Implement strict token inventory normalization**

`groupKeys.ts` must expose:

```ts
export async function recoverManagedGroupKeys(
  accessToken: string,
  userId: number,
  groups: string[],
): Promise<Record<string, string>>;

export async function createManagedGroupKey(
  accessToken: string,
  userId: number,
  group: string,
): Promise<string>;
```

Inventory accepts only safe integer IDs, exact `山竹漫剧-${group}` names, exact group matches and active status. It retrieves full keys through `/api/token/batch/keys`, with `/api/token/:id/key` fallback for an unsupported batch endpoint. Failure to inventory throws; it never silently creates.

- [ ] **Step 2: Replace direct key creation in the catalog**

At the beginning of a catalog epoch, recover missing keys once, merge them into the current user's keys and persist immediately. A 401 from `/v1/models` removes that key and defers replacement to the next inventory round.

- [ ] **Step 3: Run focused type checking**

Run: `bun run --filter @toonflow/server typecheck`

Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/utils/aihubkit/groupKeys.ts apps/server/src/utils/aihubkit/catalog.ts
git commit -m "fix: recover existing group keys"
```

### Task 3: Batch catalog synchronization and expose progress

**Files:**
- Modify: `apps/server/src/utils/aihubkit/catalog.ts`
- Modify: `apps/web/src/lib/aihubkitCatalog.ts`
- Modify: `apps/web/src/components/settings/modelCatalog.vue`

- [ ] **Step 1: Select a three-group creation batch**

Use existing `groupType` to pick the first missing language, image and video group, then append remaining groups in upstream order until the batch contains three. Existing-key groups are always eligible in the same round.

- [ ] **Step 2: Read model lists with bounded concurrency**

Add a small local helper that consumes selected groups with four workers. Key creation remains serial with a 300 ms gap; only `/v1/models` reads are concurrent.

- [ ] **Step 3: Shorten healthy partial continuation and update copy**

Set both server and Web partial intervals to `3_000`. The alert says `正在补全模型渠道：已同步 X / Y，约 3 秒后继续。`; the retry button is visible for partial catalogs as `继续同步`.

- [ ] **Step 4: Run focused verification**

Run:

```bash
bun run --filter @toonflow/server typecheck
bun run --filter @toonflow/web typecheck
bun run --filter @toonflow/server build
bun run --filter @toonflow/web build
```

Expected: all four commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/utils/aihubkit/catalog.ts apps/web/src/lib/aihubkitCatalog.ts apps/web/src/components/settings/modelCatalog.vue
git commit -m "perf: accelerate account model sync"
```

### Task 4: Validate account isolation and duplicate prevention

**Files:**
- Modify only if validation exposes a production defect.

- [ ] **Step 1: Run the existing application against the current account**

Inspect only counts, group IDs, token names and HTTP statuses; never print API keys, cookies or access tokens. Confirm an existing app-owned token is recovered without a new POST.

- [ ] **Step 2: Run full repository type checking**

Run: `bun run typecheck`

Expected: every workspace exits with code 0.

- [ ] **Step 3: Commit any validated correction, otherwise record no-code completion**

If a correction is required, use `git commit -m "fix: harden account model synchronization"`. Do not add test-only files.
