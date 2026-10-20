<template>
  <div class="about">
    <header class="brand">
      <img class="brandLogo" :src="logoUrl" alt="山竹漫剧" />
      <div>
        <h3>山竹漫剧</h3>
        <p>短剧与漫剧创作工作台</p>
      </div>
    </header>

    <el-card class="infoCard" shadow="never">
      <dl class="productInfo">
        <div>
          <dt>当前版本</dt>
          <dd>v{{ desktopUpdateSnapshot?.version || currentVersion }}</dd>
        </div>
        <div>
          <dt>数据位置</dt>
          <dd>项目素材保存在你选择的本地工作目录</dd>
        </div>
      </dl>
    </el-card>

    <el-card class="updateCard" shadow="never">
      <template #header>
        <div class="cardHeader">
          <div>
            <h3>软件更新</h3>
            <p>{{ updateStatus }}</p>
          </div>
          <el-tag v-if="desktopUpdateSnapshot?.latestVersion" type="primary" effect="plain">
            最新 v{{ desktopUpdateSnapshot.latestVersion }}
          </el-tag>
        </div>
      </template>

      <div class="updateSourceRow">
        <div class="sourceDescription">
          <strong>更新来源</strong>
          <span>自动模式优先使用 Gitee，访问失败时切换到 GitHub。</span>
        </div>
        <el-select
          :modelValue="desktopUpdateSource"
          aria-label="更新来源"
          :disabled="changingSource || !!desktopUpdateAction || !isDesktop || isRemoteConnection"
          @change="changeUpdateSource">
          <el-option label="自动（Gitee 优先）" value="auto" />
          <el-option label="仅 Gitee" value="gitee" />
          <el-option label="仅 GitHub" value="github" />
          <el-option label="自定义" value="custom" :disabled="!desktopUpdateCustomUrl" />
        </el-select>
      </div>

      <dl v-if="desktopUpdateSnapshot?.resolvedUpdateSource" class="updateDetails">
        <div>
          <dt>本次实际来源</dt>
          <dd>{{ sourceLabels[desktopUpdateSnapshot.resolvedUpdateSource] }}</dd>
        </div>
        <div v-if="desktopUpdateSnapshot.latestHash">
          <dt>目标构建</dt>
          <dd><code>{{ desktopUpdateSnapshot.latestHash }}</code></dd>
        </div>
      </dl>

      <el-progress
        v-if="desktopUpdateSnapshot?.updateProgress"
        class="updateProgress"
        :percentage="updateProgressPercent ?? 50"
        :indeterminate="updateProgressPercent === undefined"
        :showText="updateProgressPercent !== undefined" />
      <el-alert v-if="updateError" class="updateError" type="error" :closable="false" showIcon :title="updateError" />

      <div class="updateActions">
        <el-button
          type="primary"
          :loading="!!desktopUpdateAction"
          :disabled="updateDisabled"
          @click="runUpdateAction">
          {{ updateActionLabel }}
        </el-button>
        <el-button
          v-if="desktopUpdateSnapshot?.downloadUrl"
          tag="a"
          :href="desktopUpdateSnapshot.downloadUrl"
          target="_blank"
          rel="noopener noreferrer">
          手动下载
        </el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import type { DesktopUpdateSource, ResolvedDesktopUpdateSource } from "@toonflow/server/desktop";
import logoUrl from "@toonflow/assets/mangosteenAvatar.png";
import { isDesktop, isRemoteConnection } from "@/lib/platform";
import { saveSettings } from "@/stores/settings";
import {
  checkDesktopUpdate,
  desktopUpdateAction,
  desktopUpdateCustomUrl,
  desktopUpdateError,
  desktopUpdateSnapshot,
  desktopUpdateSource,
  runDesktopUpdate,
} from "@/stores/desktopUpdate";

const currentVersion = import.meta.env.appVersion || "0.1.2";
const changingSource = ref(false);
const sourceLabels: Record<ResolvedDesktopUpdateSource, string> = { gitee: "Gitee", github: "GitHub", custom: "自定义来源" };

const updateError = computed(() => desktopUpdateError.value || desktopUpdateSnapshot.value?.error || "");
const updateProgressPercent = computed(() => {
  const progress = desktopUpdateSnapshot.value?.updateProgress;
  return progress?.total ? Math.min(100, Math.round(progress.received / progress.total * 100)) : undefined;
});
const updateDisabled = computed(() => !isDesktop || isRemoteConnection || desktopUpdateSnapshot.value?.channel === "dev" || changingSource.value);
const updateActionLabel = computed(() => desktopUpdateSnapshot.value?.updateReady ? "安装并重启"
  : desktopUpdateSnapshot.value?.updateAvailable ? "下载更新" : "检查更新");
const updateStatus = computed(() => {
  if (!isDesktop) return "请在桌面客户端中检查更新。";
  if (isRemoteConnection) return "远程连接模式不能更新本机客户端。";
  if (desktopUpdateSnapshot.value?.channel === "dev") return "开发模式不执行自动更新。";
  if (desktopUpdateAction.value === "check") return "正在检查新版本…";
  if (desktopUpdateAction.value === "download") return "正在下载更新…";
  if (desktopUpdateAction.value === "apply") return "正在安装并准备重启…";
  if (desktopUpdateSnapshot.value?.updateReady) return "更新已下载，确认后安装并重启。";
  if (desktopUpdateSnapshot.value?.updateAvailable) return "发现新版本，由你确认后才会下载和安装。";
  if (updateError.value) return "检查未完成，可重试或切换更新来源。";
  if (desktopUpdateSnapshot.value) return "当前已是最新版本。";
  return "尚未检查新版本。";
});

async function changeUpdateSource(value: DesktopUpdateSource) {
  if (value === desktopUpdateSource.value || changingSource.value) return;
  changingSource.value = true;
  try {
    await saveSettings(() => ({ desktopUpdateSource: value }));
  } catch {
    ElMessage.error("更新来源保存失败，请重试");
  } finally {
    changingSource.value = false;
  }
}

async function runUpdateAction() {
  try {
    const snapshot = desktopUpdateSnapshot.value;
    if (snapshot?.updateReady) await runDesktopUpdate("apply");
    else if (snapshot?.updateAvailable) await runDesktopUpdate("download");
    else {
      const result = await checkDesktopUpdate();
      if (!result.updateAvailable && !result.updateReady && !result.error) ElMessage.success("当前已是最新版本");
    }
  } catch {
    // Store 已保留中文错误，避免同时出现弹窗和页面错误两份提示。
  }
}
</script>

<style lang="scss" scoped>
.about {
  display: flex;
  flex-direction: column;
  gap: 14px;

  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 4px 0 12px;

    .brandLogo {
      width: 60px;
      height: 60px;
      flex-shrink: 0;
      border-radius: 18px;
      object-fit: cover;
      box-shadow: var(--el-box-shadow-light);
    }

    h3 {
      margin: 0 0 5px;
      color: var(--el-text-color-primary);
      font-size: 20px;
      font-weight: 600;
    }

    p { margin: 0; color: var(--el-text-color-secondary); font-size: 13px; }
  }

  .infoCard,
  .updateCard { border-radius: var(--ui-radius); }

  .infoCard :deep(.el-card__body) { padding: 16px; }

  .productInfo,
  .updateDetails {
    display: grid;
    gap: 14px;
    margin: 0;

    div { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 12px; }
    dt { color: var(--el-text-color-secondary); font-size: 13px; }
    dd { margin: 0; color: var(--el-text-color-primary); font-size: 13px; overflow-wrap: anywhere; }
  }

  .cardHeader {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;

    h3 { margin: 0 0 5px; font-size: 15px; }
    p { margin: 0; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.6; }
  }

  .updateSourceRow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 190px;
    align-items: center;
    gap: 16px;

    .sourceDescription {
      display: flex;
      flex-direction: column;
      gap: 5px;
      font-size: 13px;

      span { color: var(--el-text-color-secondary); line-height: 1.6; }
    }
  }

  .updateDetails { margin-top: 18px; }
  .updateProgress,
  .updateError { margin-top: 18px; }
  .updateActions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }

  @media (max-width: 620px) {
    .updateSourceRow { grid-template-columns: 1fr; }
    .updateSourceRow :deep(.el-select) { width: 100%; }
  }
}
</style>
