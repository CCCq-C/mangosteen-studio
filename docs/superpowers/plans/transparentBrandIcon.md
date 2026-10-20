# Transparent Brand Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the square-backed logo with one circular mangosteen mark on a transparent background across all packaged clients.

**Architecture:** Use the existing raster as the reference for one transparent master, then derive every platform size from that master with built-in macOS tools and the already-installed FFmpeg. Existing imports remain unchanged.

**Tech Stack:** OpenAI image editing, PNG RGBA, `sips`, FFmpeg, Electrobun assets.

---

**Spec:** `docs/superpowers/specs/transparentBrandIconDesign.md`

### Task 1: Produce the transparent master

**Files:**
- Modify: `packages/assets/mangosteenAvatar.png`

- [ ] **Step 1: Edit the existing image**

Use the image generation editor with the exact existing asset as reference. Preserve the fruit design, center it, remove the square background, keep all outside pixels transparent and output a 1:1 PNG.

- [ ] **Step 2: Inspect the result visually and technically**

Run: `sips -g pixelWidth -g pixelHeight -g hasAlpha packages/assets/mangosteenAvatar.png`

Expected: square dimensions and `hasAlpha: yes`.

### Task 2: Derive packaged icon assets

**Files:**
- Modify: `packages/assets/logo.iconset/*.png`
- Modify: `packages/assets/logo.ico`
- Delete: `packages/assets/logo.svg`

- [ ] **Step 1: Generate all iconset sizes from the master**

Use `sips -z` for the existing 16, 32, 128, 256, 512 and 1024 targets. Do not redraw individual sizes.

- [ ] **Step 2: Generate the Windows ICO with existing FFmpeg**

Run: `ffmpeg -y -i packages/assets/mangosteenAvatar.png -vf scale=256:256 packages/assets/logo.ico`

Expected: exit code 0 and `file` recognizes an MS Windows icon resource.

- [ ] **Step 3: Remove the unused old SVG and verify alpha**

Run `sips -g hasAlpha packages/assets/logo.iconset/*.png`; every result must be `yes`.

- [ ] **Step 4: Commit**

```bash
git add packages/assets
git commit -m "style: use transparent round brand icon"
```

### Task 3: Verify application packaging

**Files:**
- Modify only if packaging exposes a production defect.

- [ ] **Step 1: Build Web and desktop assets**

Run:

```bash
bun run --filter @toonflow/web build
bun run build:desktop
```

Expected: both commands exit 0.

- [ ] **Step 2: Inspect the built application icon and visible screens**

Open the packaged macOS app and confirm the Dock icon plus home, login, assistant and About surfaces use the transparent round mark.

- [ ] **Step 3: Commit any packaging correction**

Use `git commit -m "fix: package transparent brand icon"` only if production assets or config changed.
