# Empty Media Provider Presets Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop showing packaged media-provider presets in Developer Options while keeping user-added providers and legacy runtime adapters intact.

**Architecture:** Filter the four packaged provider filenames at the media settings presentation boundary. The server-side provider store, saved credentials, adapter sources, and AIHubKit model catalog remain unchanged, so this is a low-coupling UI-only change.

**Tech Stack:** Vue 3, TypeScript, Element Plus, Bun workspace scripts.

---

### Task 1: Filter packaged media providers

**Files:**
- Modify: `apps/web/src/components/settings/panels/mediaModel/index.vue:64-67`

**Step 1: Define the packaged filenames**

Add one file-local set next to the provider state:

```ts
const builtInProviderFiles = new Set(["tfRouter.ts", "apiMart.ts", "metaso.ts", "compshare.ts"]);
```

**Step 2: Apply the filter once at the presentation boundary**

Replace the existing TF Router-only filter with:

```ts
const sortedProviders = computed(() => providers.value
  .filter(provider => !builtInProviderFiles.has(provider.fileName))
  .sort((left, right) => left.label.localeCompare(right.label)));
```

This keeps API responses and runtime loading unchanged while hiding only the packaged cards.

**Step 3: Inspect the focused diff**

Run: `git diff --check && git diff -- apps/web/src/components/settings/panels/mediaModel/index.vue`

Expected: one local filename set and one replacement filter; no unrelated changes.

### Task 2: Verify the existing application build

**Files:**
- No new test files; repository policy assigns tests to QA and forbids adding test modules.

**Step 1: Run the web type check**

Run: `bun --filter @toonflow/web typecheck`

Expected: command exits with code 0.

**Step 2: Run the web production build**

Run: `bun --filter @toonflow/web build`

Expected: Vite production build exits with code 0.

**Step 3: Confirm change boundaries**

Run: `git status --short && git diff --stat`

Expected: only the plan and media settings component are changed.

### Task 3: Commit and integrate

**Files:**
- Commit: `docs/plans/emptyMediaProviderPresets.md`
- Commit: `apps/web/src/components/settings/panels/mediaModel/index.vue`

**Step 1: Commit the implementation**

Run: `git add docs/plans/emptyMediaProviderPresets.md apps/web/src/components/settings/panels/mediaModel/index.vue && git commit -m "fix: hide bundled media provider presets"`

Expected: one focused implementation commit.

**Step 2: Merge the isolated branch into main**

Run from the primary checkout: `git merge --ff-only codex/empty-media-provider-presets`

Expected: `main` advances without a merge conflict.

**Step 3: Push and verify both remotes**

Run: `git push origin main && git push gitee main`

Expected: GitHub and Gitee remote `main` resolve to the same commit as local `main`.
