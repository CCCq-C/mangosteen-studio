<template>
  <section class="communityPanel" :aria-busy="loading">
    <header class="communityToolbar">
      <div class="communityFilters" role="group" aria-label="社区内容类型">
        <button
          v-for="(label, type) in typeLabels"
          :key="type"
          class="filterButton"
          type="button"
          :aria-pressed="selectedType === type"
          @click="selectedType = type">
          {{ label }}
        </button>
      </div>
      <el-input v-model="searchQuery" class="communitySearch" size="small" placeholder="搜索 Skill、模板或工作流" clearable />
      <el-button size="small" :icon="IconRefresh" :loading="loading" @click="loadCatalog(true)">更新目录</el-button>
    </header>

    <div v-if="catalog" class="sourceStatus">
      <el-tag size="small" :type="catalog.source === 'cache' ? 'warning' : 'success'" effect="plain">
        {{ sourceLabels[catalog.source] }}
      </el-tag>
      <el-text size="small" type="info">目录更新：{{ formatTime(catalog.updatedAt) }}</el-text>
    </div>
    <el-alert
      v-if="catalog?.stale"
      title="在线目录暂时不可用，当前显示本机最近一次成功同步的内容。"
      type="warning"
      :closable="false"
      showIcon />
    <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" showIcon>
      <el-button size="small" @click="loadCatalog(true)">重试</el-button>
    </el-alert>

    <el-skeleton v-if="loading && !catalog" :rows="6" animated />
    <div v-else-if="filteredItems.length" class="communityGrid">
      <el-card v-for="item in filteredItems" :key="item.id" class="communityCard" shadow="never">
        <header class="cardHeader">
          <div class="cardTitle">
            <strong>{{ item.name }}</strong>
            <el-text size="small" type="info">{{ item.author }} · v{{ item.version }}</el-text>
          </div>
          <el-tag size="small" :type="tagTypes[item.type]">{{ itemTypeLabels[item.type] }}</el-tag>
        </header>
        <p class="description">{{ item.description }}</p>
        <div v-if="item.tags.length" class="tags">
          <el-tag v-for="tag in item.tags" :key="tag" size="small" effect="plain">{{ tag }}</el-tag>
        </div>
        <footer class="cardFooter">
          <div class="links">
            <a :href="item.urls.gitee" target="_blank" rel="noopener noreferrer">Gitee</a>
            <a :href="item.urls.github" target="_blank" rel="noopener noreferrer">GitHub</a>
          </div>
          <el-button
            size="small"
            type="primary"
            :loading="pendingItems.has(item.id)"
            :disabled="pendingItems.has(item.id) || incompatible(item) || item.type === 'skill' && skillAction(item) === '已安装' || item.type !== 'skill' && !workspace.project"
            @click="installItem(item)">
            {{ actionLabel(item) }}
          </el-button>
        </footer>
      </el-card>
    </div>
    <el-empty
      v-else-if="catalog && !errorMessage"
      :description="catalog.items.length ? '没有符合筛选条件的内容' : '官方社区暂未发布内容'"
      :imageSize="72" />
  </section>
</template>

<script setup lang="ts">
import axios from "axios";
import parse from "semver/functions/parse";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { IconRefresh } from "@tabler/icons-vue";
import { ElMessage } from "element-plus";
import { useWorkspaceStore } from "@/stores/workspace";

type CommunityType = "skill" | "template" | "workflow";
type CommunityItem = {
  id: string;
  type: CommunityType;
  name: string;
  description: string;
  version: string;
  author: string;
  fileName: string;
  urls: { gitee: string; github: string };
  sha256: string;
  minAppVersion: string;
  tags: string[];
};
type CommunityCatalog = {
  schemaVersion: 1;
  updatedAt: string;
  items: CommunityItem[];
  source: "gitee" | "github" | "cache";
  stale: boolean;
};
type ApiResponse<T> = { code: number; data: T | null; message: string };

const props = withDefaults(defineProps<{ visible?: boolean }>(), { visible: true });
const workspace = useWorkspaceStore();
const typeLabels = { all: "全部", skill: "Skill", template: "模板", workflow: "工作流" } as const;
const itemTypeLabels = { skill: "Skill", template: "模板", workflow: "工作流" } as const;
const tagTypes = { skill: "success", template: "primary", workflow: "warning" } as const;
const sourceLabels = { gitee: "Gitee 在线目录", github: "GitHub 在线目录", cache: "本地缓存" } as const;
const selectedType = ref<CommunityType | "all">("all");
const searchQuery = ref("");
const catalog = ref<CommunityCatalog>();
const installedSkills = ref(new Map<string, string>());
const loading = ref(false);
const errorMessage = ref("");
const pendingItems = ref(new Set<string>());
let controller: AbortController | undefined;
const requestHeaders = { "x-toonflow-workspace": "1" };
const appVersion = parse(import.meta.env.appVersion || (import.meta.env.DEV ? "999.0.0" : "0.0.0"));

const filteredItems = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return (catalog.value?.items ?? []).filter(item => (selectedType.value === "all" || item.type === selectedType.value)
    && (!query || [item.name, item.description, item.author, item.id, ...item.tags].some(value => value.toLowerCase().includes(query))));
});

function requestError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.message === "string") return error.response.data.message;
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date) : value;
}

function installedSkill(item: CommunityItem) {
  const fileName = item.fileName.replace(/\.(?:tar\.gz|tar|tgz|zip|md)$/i, "");
  for (const name of [item.id, fileName]) {
    if (installedSkills.value.has(name)) return { name, version: installedSkills.value.get(name) ?? "" };
  }
}

function skillAction(item: CommunityItem) {
  const installed = installedSkill(item);
  if (!installed) return "安装";
  const current = parse(installed.version);
  const incoming = parse(item.version);
  return current && incoming && incoming.compare(current) > 0 ? "更新" : "已安装";
}

function incompatible(item: CommunityItem) {
  const minimum = parse(item.minAppVersion);
  return !appVersion || !minimum || appVersion.compare(minimum) < 0;
}

function actionLabel(item: CommunityItem) {
  if (incompatible(item)) return `需要 v${item.minAppVersion}`;
  if (item.type === "skill") return skillAction(item);
  return workspace.project ? "导入当前项目" : "请先打开项目";
}

async function loadInstalledSkills(signal: AbortSignal) {
  try {
    const { data } = await axios.get<ApiResponse<{ name: string; version?: string }[]>>("/api/skills/get", { signal, headers: requestHeaders });
    if (data.code === 200 && Array.isArray(data.data)) installedSkills.value = new Map(data.data.map(item => [item.name, item.version ?? ""]));
  } catch {
    // 已安装状态读取失败不阻塞社区目录。
  }
}

async function loadCatalog(refresh = false) {
  controller?.abort();
  const requestController = new AbortController();
  controller = requestController;
  loading.value = true;
  errorMessage.value = "";
  try {
    const [{ data }] = await Promise.all([
      axios.get<ApiResponse<CommunityCatalog>>("/api/community/catalog", { params: refresh ? { refresh: "true" } : {}, signal: requestController.signal }),
      loadInstalledSkills(requestController.signal),
    ]);
    if (data.code !== 200 || !data.data || data.data.schemaVersion !== 1 || !Array.isArray(data.data.items)) {
      throw new Error(data.message || "官方社区目录格式不正确");
    }
    catalog.value = data.data;
  } catch (error) {
    if (!requestController.signal.aborted) errorMessage.value = requestError(error, "官方社区加载失败，请重试");
  } finally {
    if (!requestController.signal.aborted) loading.value = false;
  }
}

async function installItem(item: CommunityItem) {
  if (pendingItems.value.has(item.id) || incompatible(item)) return;
  if (item.type !== "skill" && !workspace.project) return;
  pendingItems.value.add(item.id);
  try {
    if (item.type === "skill") {
      const action = skillAction(item);
      const { data } = await axios.post<ApiResponse<{ name: string }>>("/api/community/install", { id: item.id }, { headers: requestHeaders });
      if (data.code !== 200 || !data.data?.name) throw new Error(data.message || "官方 Skill 安装失败");
      installedSkills.value.set(data.data.name, item.version);
      window.dispatchEvent(new CustomEvent("toonflow:plugin-installed", { detail: { type: "skill", name: data.data.name } }));
      ElMessage.success(`${item.name}已${action === "更新" ? "更新" : "安装"}`);
    } else {
      const { data } = await axios.post<ApiResponse<{ fileName: string }>>("/api/community/importCanvas", {
        id: item.id,
        directory: workspace.project!.directory,
      }, { headers: requestHeaders });
      if (data.code !== 200 || !data.data?.fileName) throw new Error(data.message || "官方画布导入失败");
      ElMessage.success(`已导入 ${data.data.fileName}`);
    }
  } catch (error) {
    ElMessage.error(requestError(error, item.type === "skill" ? "官方 Skill 安装失败，请重试" : "官方画布导入失败，请重试"));
  } finally {
    pendingItems.value.delete(item.id);
  }
}

watch(() => props.visible, (visible) => {
  if (visible && !catalog.value) void loadCatalog();
  if (!visible) controller?.abort();
}, { immediate: true });
onBeforeUnmount(() => controller?.abort());
</script>

<style scoped lang="scss">
.communityPanel {
  display: grid;
  gap: 12px;

  .communityToolbar,
  .communityFilters,
  .sourceStatus,
  .cardHeader,
  .cardFooter,
  .links,
  .tags {
    display: flex;
    align-items: center;
  }

  .communityToolbar {
    flex-wrap: wrap;
    gap: 8px;

    .communityFilters {
      gap: 6px;
    }

    .communitySearch {
      min-width: min(100%, 260px);
      flex: 1;
    }
  }

  .filterButton {
    padding: 5px 12px;
    border: 0;
    border-radius: var(--el-border-radius-base);
    background: transparent;
    color: var(--el-text-color-secondary);
    font: inherit;
    font-size: 12px;
    cursor: pointer;

    &:hover,
    &[aria-pressed="true"] {
      background: var(--el-color-primary-light-9);
      color: var(--el-color-primary);
    }
  }

  .sourceStatus,
  .links,
  .tags {
    flex-wrap: wrap;
    gap: 8px;
  }

  .communityGrid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
    gap: 10px;
  }

  .communityCard {
    :deep(.el-card__body) {
      display: flex;
      flex-direction: column;
      height: 100%;
      box-sizing: border-box;
    }

    .cardHeader,
    .cardFooter {
      justify-content: space-between;
      gap: 12px;
    }

    .cardTitle {
      display: grid;
      gap: 4px;
    }

    .description {
      margin: 12px 0;
      color: var(--el-text-color-regular);
      font-size: 13px;
      line-height: 1.6;
      overflow-wrap: anywhere;
    }

    .cardFooter {
      margin-top: auto;
      padding-top: 14px;

      a {
        color: var(--el-color-primary);
        font-size: 12px;
      }
    }
  }
}
</style>
