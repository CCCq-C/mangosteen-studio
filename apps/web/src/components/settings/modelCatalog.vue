<template>
  <section class="modelCatalog" :aria-busy="aihubkitCatalogLoading">
    <header class="catalogHeader">
      <div class="catalogHeading">
        <div class="catalogTitle">
          <img :src="logoUrl" alt="" />
          <strong>AIHubKit 动态模型</strong>
          <el-tag size="small" type="success" effect="plain">当前账号</el-tag>
        </div>
        <el-text v-if="aihubkitCatalog" size="small" type="info">
          {{ totalModels }} 个模型 · {{ totalGroups }} 个分组 · {{ formatTime(aihubkitCatalog.syncedAt) }}同步
        </el-text>
      </div>
      <el-button :icon="IconRefresh" :loading="aihubkitCatalogLoading" :disabled="aihubkitCatalogLoading" @click="refreshCatalog">同步模型</el-button>
    </header>

    <el-alert v-if="notice" :title="notice" type="info" :closable="false" showIcon />
    <el-alert v-if="aihubkitCatalog?.partial" title="部分分组同步失败，当前展示其余已成功同步的模型。" type="warning" :closable="false" showIcon />
    <el-alert v-if="aihubkitCatalog && !aihubkitCatalog.pricingAvailable" title="价格暂未同步，模型仍可正常使用；稍后点击“同步模型”即可重试。" type="warning" :closable="false" showIcon />
    <el-alert v-if="aihubkitCatalog?.unknownModelCount" :title="`${aihubkitCatalog.unknownModelCount} 个模型暂未识别类型，已从列表隐藏。`" type="warning" :closable="false" showIcon />
    <el-alert v-if="aihubkitCatalogError" :title="aihubkitCatalogError" type="error" :closable="false" showIcon />

    <el-skeleton v-if="aihubkitCatalogLoading && !aihubkitCatalog" :rows="5" animated />
    <template v-else-if="aihubkitCatalog">
      <el-tabs v-if="types.length > 1" v-model="activeType" class="catalogTabs">
        <el-tab-pane v-for="type in types" :key="type" :name="type" :label="`${typeLabels[type]}（${modelCount(type)}）`" />
      </el-tabs>
      <el-collapse v-if="activeGroups.length" class="groupList">
        <el-collapse-item v-for="group in activeGroups" :key="group.id" :name="`${activeType}:${group.id}`">
          <template #title>
            <div class="groupTitle">
              <div class="groupName">
                <strong>{{ group.label }}</strong>
                <el-text size="small" type="info">{{ group.id }}</el-text>
              </div>
              <div class="groupMeta">
                <el-tag size="small" effect="plain">{{ group.ratio }}×</el-tag>
                <el-text size="small" type="info">{{ group.models.length }} 个模型</el-text>
              </div>
            </div>
          </template>
          <div class="modelGrid">
            <div v-for="model in group.models" :key="model.id" class="modelItem">
              <div class="modelName">
                <modelIcon :model="model.id" :size="18" />
                <span>{{ model.label }}</span>
              </div>
              <el-tooltip v-if="model.price" :content="model.price.tips" placement="top" :showAfter="300">
                <el-tag size="small" type="success" effect="plain">{{ model.price.label }}</el-tag>
              </el-tooltip>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
      <el-empty v-else :description="`当前没有可用的${typeLabels[activeType]}模型`" :imageSize="72" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { IconRefresh } from "@tabler/icons-vue";
import { modelIcon } from "@toonflow/model-icons";
import logoUrl from "@toonflow/assets/mangosteenAvatar.png";
import {
  aihubkitCatalog,
  aihubkitCatalogError,
  aihubkitCatalogLoading,
  loadAihubkitCatalog,
  type AihubkitCatalogModelType,
} from "@/lib/aihubkitCatalog";

const props = withDefaults(defineProps<{
  types: AihubkitCatalogModelType[];
  visible?: boolean;
  notice?: string;
}>(), { visible: true, notice: "" });
const typeLabels: Record<AihubkitCatalogModelType, string> = { language: "文本", image: "图片", video: "视频" };
const activeType = ref<AihubkitCatalogModelType>(props.types[0] ?? "language");
const activeGroups = computed(() => (aihubkitCatalog.value?.groups ?? []).flatMap(group => {
  const models = (aihubkitCatalog.value?.models ?? []).filter(model => model.type === activeType.value && model.groups.some(item => item.id === group.id))
    .map(model => ({ ...model, price: model.groups.find(item => item.id === group.id)?.price }));
  return models.length ? [{ ...group, models }] : [];
}));
const totalModels = computed(() => props.types.reduce((count, type) => count + modelCount(type), 0));
const totalGroups = computed(() => new Set(props.types.flatMap(type => (aihubkitCatalog.value?.models ?? [])
  .filter(model => model.type === type).flatMap(model => model.groups.map(group => group.id)))).size);

function modelCount(type: AihubkitCatalogModelType) {
  return (aihubkitCatalog.value?.models ?? []).filter(model => model.type === type).length;
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(value);
}

async function refreshCatalog() {
  try {
    await loadAihubkitCatalog(true);
    ElMessage.success("模型目录已同步");
  } catch {
    ElMessage.error(aihubkitCatalogError.value || "模型目录同步失败，请重试");
  }
}

watch(() => props.visible, (visible) => {
  if (visible) void loadAihubkitCatalog().catch(() => {});
}, { immediate: true });
</script>

<style scoped lang="scss">
.modelCatalog {
  display: grid;
  gap: 14px;

  .catalogHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px;
    border: 1px solid var(--el-border-color-light);
    border-radius: var(--el-border-radius-base);
    background: var(--el-fill-color-extra-light);

    .catalogHeading {
      display: grid;
      gap: 6px;
      min-width: 0;

      .catalogTitle {
        display: flex;
        align-items: center;
        gap: 8px;

        img {
          width: 28px;
          height: 28px;
          border-radius: 8px;
        }
      }
    }
  }

  .catalogTabs {
    :deep(.el-tabs__header) {
      margin-bottom: 10px;
    }
  }

  .groupList {
    border-top: 0;

    :deep(.el-collapse-item__header) {
      height: auto;
      min-height: 56px;
      padding: 8px 12px;
      line-height: 1.4;
    }

    .groupTitle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
      padding-right: 8px;

      .groupName {
        display: grid;
        gap: 3px;
        min-width: 0;

        strong,
        .el-text {
          overflow-wrap: anywhere;
        }
      }

      .groupMeta {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
      }
    }

    .modelGrid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
      gap: 8px;
      padding: 2px 12px 14px;

      .modelItem {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
        padding: 9px 10px;
        border-radius: var(--el-border-radius-base);
        background: var(--el-fill-color-light);

        .modelName {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;

          span {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
        }

        .el-tag {
          flex-shrink: 0;
        }
      }
    }
  }

  @media (max-width: 600px) {
    .catalogHeader,
    .groupTitle {
      align-items: flex-start;
      flex-direction: column;
    }
  }
}
</style>
