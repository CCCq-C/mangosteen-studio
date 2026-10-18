# AIHubKit Model Channel Directory Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an account-scoped, automatically refreshed, read-only model channel directory that maps AIHubKit pricing JSON into model introductions, vendors, billing types, resolution prices, and honest availability state.

**Architecture:** Keep account availability, pricing synchronization, expression interpretation, public catalog composition, and Vue rendering in separate modules. Persist only validated per-user pricing snapshots, merge them with the existing account model catalog on the server, and expose a safe view model shared by settings and generation surfaces.

**Tech Stack:** Bun, TypeScript, Express, Vue 3, Pinia, Element Plus, `@babel/parser`, existing AIHubKit catalog/pricing modules, existing `conf` storage

**Spec:** `docs/superpowers/specs/2026-10-18-aihubkit-model-channel-directory-design.md`

---

## Global Constraints

- Do not add test modules or test-only files; repository rules require existing typecheck, build, and read-only runtime verification instead.
- Do not expose Cookie, Access Token, group API keys, or raw `billing_expr` to Web code.
- Do not treat pricing JSON presence as account availability; only merge models returned by the account group catalog.
- Do not parse human descriptions to calculate price or mutate node capabilities.
- Preserve the unrelated untracked `packages/startup/assets/startup 2.json` file without editing or staging it.

### Task 1: Persist and enrich the account pricing snapshot

**Files:**
- Modify: `apps/server/src/utils/aihubkit/pricingCatalog.ts`

**Steps:**

1. Extend the normalized model with optional description, icon, vendor metadata, endpoint types, and safe tags while retaining the current formula fields for server-only use.
2. Normalize `vendors` and `usable_group` from the pricing root, then attach vendor information by `vendor_id` without trusting unknown or oversized fields.
3. Add a validated, per-user stored snapshot under the existing `conf` data directory. Store only normalized pricing data, `pricingVersion`, `syncedAt`, and group metadata; cap stored users and model counts.
4. Hydrate the current user’s snapshot before a network refresh and use it only as a same-user fallback. A failed or malformed refresh must never replace the last successful snapshot.
5. Run `bun run --filter '@toonflow/server' typecheck`; expected result: exit code 0.
6. Commit only Task 1 files with `feat: persist AIHubKit pricing catalog`.

### Task 2: Produce safe billing profiles and resolution tiers

**Files:**
- Modify: `apps/server/src/utils/aihubkit/pricingExpression.ts`
- Modify: `apps/server/src/utils/aihubkit/pricing.ts`

**Steps:**

1. Extend the summary kind with `inputAudioSecond` while preserving `fixed`, `perSecond`, `tokenEstimate`, and `dynamic` compatibility.
2. Detect output-second dependency, input-audio-second dependency, deferred Token billing, and other reference-material dependency by evaluating the existing safe AST with controlled dimension changes.
3. Extract resolution candidates from safe comparison/tier literals, evaluate the full formula with zero reference inputs, and return deduplicated display tiers without exposing the raw expression.
4. Format media-aware labels: image fixed prices use “按张”, video fixed prices use “按条”, output duration uses “按秒”, input audio uses “按输入音频时长”, and unknown compound rules use “复合计费”.
5. Keep generation estimates on the existing evaluator; only extend the public summary/profile returned to catalog consumers.
6. Run Server typecheck and a temporary read-only command against live JSON for `sd-2.0-v1`, `MiniMax-H3`, a Token model, and `digitalHuman`; do not add test files.
7. Commit Task 2 files with `feat: describe AIHubKit billing profiles`.

### Task 3: Compose the account-safe channel directory and parallel refresh

**Files:**
- Modify: `apps/server/src/utils/aihubkit/catalog.ts`
- Modify: `apps/server/src/routes/desktop/account/login.ts`
- Modify: `apps/server/src/routes/desktop/account/session.ts`
- Modify if required: `apps/server/src/utils.ts`

**Steps:**

1. Extend the public catalog model with optional description, icon, vendor, tags, endpoint types, and pricing profile. Keep secret group keys only in the private candidate map.
2. Prefer pricing JSON channel descriptions when present, but retain the account group response as the availability authority.
3. Start pricing refresh in parallel with group/model synchronization so detailed pricing does not wait for sequential group-key requests.
4. On login and restored session, start background refresh without blocking authentication. On logout, clear all current-user runtime catalog and pricing state.
5. Preserve current deletion semantics: missing account models are omitted, incomplete group sync retains successful/cached groups, and pricing failure does not block generation.
6. Run Server typecheck and inspect the desktop catalog JSON to confirm no raw formula or credential field is present.
7. Commit Task 3 files with `feat: expose AIHubKit channel directory`.

### Task 4: Add the frontend automatic-sync lifecycle

**Files:**
- Modify: `apps/web/src/lib/aihubkitCatalog.ts`
- Modify: `apps/web/src/stores/account.ts`

**Steps:**

1. Extend the Web-safe catalog types to match the new server directory fields and billing tiers.
2. Add one module-owned ten-minute timer with `startAihubkitCatalogSync`, `stopAihubkitCatalogSync`, and `clearAihubkitCatalogState`; prevent duplicate timers and in-flight requests.
3. After login or restored authentication, start the sync without blocking navigation. On logout or account change, stop the timer and clear reactive data before another account can render it.
4. Invalidate node model caches only when a successful response changes catalog revision or pricing version, not on every polling request.
5. Run `bun run --filter '@toonflow/web' typecheck`; expected result: exit code 0.
6. Commit Task 4 files with `feat: auto refresh AIHubKit catalog`.

### Task 5: Build the read-only settings board

**Files:**
- Modify: `apps/web/src/components/settings/index.vue`
- Modify: `apps/web/src/components/settings/modelCatalog.vue`
- Modify: `apps/web/src/components/settings/panels/languageModel/index.vue`
- Modify: `apps/web/src/components/settings/panels/mediaModel/index.vue`
- Create: `apps/web/src/components/settings/panels/modelChannelCatalog.vue`

**Steps:**

1. Add a standalone settings navigation item labeled “模型渠道大全” and pass it the dialog visibility prop.
2. Move the shared dynamic AIHubKit directory out of text/media provider configuration panels; keep those panels focused on third-party and custom provider configuration.
3. Refactor `modelCatalog.vue` into a read-only directory renderer with text/image/video filters, channel descriptions, account ratio, availability badge, model count, vendor, optional introduction, tags, billing badge, and resolution price tiers.
4. Remove the normal “同步模型” action. Show last automatic sync time during healthy operation and show one retry action only after an error or partial response.
5. Preserve loading, empty, stale-price, unknown-model, and partial-sync states without inventing offline status.
6. Run Web typecheck and build; expected result: exit code 0.
7. Commit Task 5 files with `feat: add model channel directory settings`.

### Task 6: Verify, package, and back up

**Files:**
- Verify only unless a discovered defect requires a focused fix

**Steps:**

1. Run the repository’s existing typecheck and production build commands; record exact results.
2. Start the local app/server with the existing account and inspect the real directory response for current-user groups, descriptions, vendor data, billing kinds, and tiers.
3. Open the macOS settings UI and verify the standalone board, automatic timestamp, filters, channel details, and absence of editing/API-key actions. Do not launch a paid generation.
4. Restart once to verify automatic session restoration and pricing snapshot fallback behavior; distinguish source/runtime checks from installed-client acceptance.
5. Build and replace the local macOS app only after source verification succeeds, then verify the installed app visually.
6. Inspect Git status and diff, ensuring `packages/startup/assets/startup 2.json` remains untouched; push the completed branch to the configured private remote and verify the remote SHA.
