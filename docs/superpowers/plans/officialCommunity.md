# Official Community Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a no-login official Skill/template/workflow community fed from Gitee with GitHub and local-cache fallback.

**Architecture:** A focused server module owns manifest validation, remote fallback, caching, checksums and content retrieval. Three narrow routes expose the catalog, Skill installation and canvas import; a dedicated Vue panel renders the official catalog while the existing installed-plugin management remains unchanged.

**Tech Stack:** TypeScript, Bun fetch, Zod, `@toonflow/file`, Express, Vue 3, Element Plus.

---

**Spec:** `docs/superpowers/specs/officialCommunityDesign.md`

**Global constraint:** Do not add test modules. Verify with existing typecheck/build commands and isolated temporary-data HTTP requests.

### Task 1: Define and publish the official catalog contract

**Files:**
- Create: `community/catalog.json`
- Create: `community/README.md`
- Create: `apps/server/src/utils/community/catalog.ts`
- Modify: `apps/server/src/utils.ts`

- [ ] **Step 1: Add an empty, valid official catalog**

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-10-20T00:00:00.000Z",
  "items": []
}
```

- [ ] **Step 2: Document the publishing fields and checksum command**

The README documents `id`, `type`, `name`, `description`, `version`, `author`, `fileName`, `urls`, `sha256`, `minAppVersion`, `tags`, plus `shasum -a 256 <file>`.

- [ ] **Step 3: Implement manifest validation and Gitee/GitHub/cache fallback**

`catalog.ts` exports `getCommunityCatalog(force?: boolean)`, `getCommunityItem(id)` and `downloadCommunityItem(item)`. Cache writes use `writeAtomic`; a failed refresh never replaces the cache. Remote manifest limit is 2 MB and content limits are 20 MB for Skills and 5 MB for canvases.

- [ ] **Step 4: Run Server type checking and commit**

Run: `bun run --filter @toonflow/server typecheck`

Expected: exit code 0.

```bash
git add community apps/server/src/utils/community/catalog.ts apps/server/src/utils.ts
git commit -m "feat: add official community catalog"
```

### Task 2: Add narrow official content routes

**Files:**
- Create: `apps/server/src/routes/community/catalog.ts`
- Create: `apps/server/src/routes/community/install.ts`
- Create: `apps/server/src/routes/community/importCanvas.ts`
- Modify generated: `apps/server/src/router.ts`

- [ ] **Step 1: Add the catalog route**

`GET /api/community/catalog` returns the validated public catalog with `source: "gitee" | "github" | "cache"` and `stale`.

- [ ] **Step 2: Add Skill installation by official ID**

`POST /api/community/install` accepts `{ id }`, rejects non-Skill items, downloads and verifies the official package, then calls `u.pluginInstall.installSkill(item.fileName, bytes)`.

- [ ] **Step 3: Add canvas import by official ID**

`POST /api/community/importCanvas` accepts `{ id, directory }`, rejects non-template/workflow items, validates the JSON shape, resolves the local workspace and atomically creates a non-conflicting `.json` file.

- [ ] **Step 4: Regenerate routes and verify**

Run:

```bash
bun run --cwd apps/server routes
bun run --filter @toonflow/server typecheck
```

Expected: router includes the three new community files and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/community apps/server/src/router.ts
git commit -m "feat: add official community endpoints"
```

### Task 3: Replace the hidden TF market with the official community panel

**Files:**
- Create: `apps/web/src/components/settings/panels/pluginMarket/communityPanel.vue`
- Modify: `apps/web/src/components/settings/panels/pluginMarket/index.vue`

- [ ] **Step 1: Add the dedicated panel**

The panel fetches `/api/community/catalog`, filters `all/skill/template/workflow`, compares `minAppVersion` against `import.meta.env.appVersion`, and calls the official install/import routes. It displays source, cache state, loading, retry and a truthful empty state.

- [ ] **Step 2: Add the visible “官方社区” tab**

Render `<communityPanel v-if="activeTab === 'community'" :visible />`; keep “已安装” and “FFmpeg”. Remove dormant TF-Router marketplace state, key form, collections and API calls from this component.

- [ ] **Step 3: Run Web checks**

Run:

```bash
bun run --filter @toonflow/web typecheck
bun run --filter @toonflow/web build
```

Expected: both commands exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/settings/panels/pluginMarket
git commit -m "feat: add official plugin community"
```

### Task 4: Verify fallback and import boundaries

**Files:**
- Modify only if validation exposes a production defect.

- [ ] **Step 1: Start the Server with a temporary data directory**

Request the catalog route from localhost and confirm the returned schema and source without writing the user's real settings.

- [ ] **Step 2: Verify invalid IDs and missing workspaces are rejected in Chinese**

Use HTTP requests against the local temporary server. Expected: 400/404 responses and no created files.

- [ ] **Step 3: Run combined build**

Run: `bun run --filter @toonflow/server --filter @toonflow/web build`

Expected: both workspaces exit 0.

- [ ] **Step 4: Commit any validated correction**

Use `git commit -m "fix: harden official community delivery"` only if production code changed.
