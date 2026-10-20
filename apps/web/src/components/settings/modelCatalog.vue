<template>
  <section class="modelCatalog" :aria-busy="aihubkitCatalogLoading">
    <header class="catalogHeader">
      <div class="catalogHeading">
        <div class="catalogTitle">
          <strong>{{ account.user?.displayName || "当前账号" }}</strong>
          <el-tag size="small" type="success" effect="plain">自动同步</el-tag>
          <el-tag v-if="aihubkitCatalog?.pricingStale" size="small" type="warning" effect="plain">使用最近价格</el-tag>
        </div>
        <el-text v-if="aihubkitCatalog" size="small" type="info">
          {{ totalModels }} 个模型 · {{ syncedGroupCount }} / {{ totalGroupCount }} 个渠道 · {{ formatTime(aihubkitCatalog.syncedAt) }} 自动同步
        </el-text>
        <el-text v-else size="small" type="info">登录后自动同步当前账号可用的渠道、模型与价格。</el-text>
      </div>
      <el-button
        v-if="showRetry"
        :icon="IconRefresh"
        :loading="aihubkitCatalogLoading"
        :disabled="aihubkitCatalogLoading"
        @click="refreshCatalog">
        {{ aihubkitCatalog?.partial ? "继续同步" : "重新同步" }}
      </el-button>
    </header>

    <el-alert
      v-if="aihubkitCatalog?.partial"
      :title="`正在补全模型渠道：已同步 ${syncedGroupCount} / ${totalGroupCount}，约 3 秒后继续。`"
      type="warning"
      :closable="false"
      showIcon />
    <el-alert v-if="aihubkitCatalog && !aihubkitCatalog.pricingAvailable" title="价格暂未同步，模型仍可正常使用。" type="warning" :closable="false" showIcon />
    <el-alert
      v-else-if="aihubkitCatalog?.pricingStale"
      :title="`当前显示 ${formatTime(aihubkitCatalog.pricingSyncedAt)} 的最近成功价格。`"
      type="warning"
      :closable="false"
      showIcon />
    <el-alert v-if="aihubkitCatalog?.unknownModelCount" :title="`${aihubkitCatalog.unknownModelCount} 个模型暂未识别类型，已从目录隐藏。`" type="warning" :closable="false" showIcon />
    <el-alert v-if="aihubkitCatalogError" :title="aihubkitCatalogError" type="error" :closable="false" showIcon />

    <el-skeleton v-if="aihubkitCatalogLoading && !aihubkitCatalog" :rows="6" animated />
    <template v-else-if="aihubkitCatalog">
      <el-tabs v-model="activeType" class="catalogTabs">
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
                <el-tag size="small" type="success" effect="plain">当前账号可用</el-tag>
                <el-tag size="small" effect="plain">{{ group.ratio }}×</el-tag>
                <el-text size="small" type="info">{{ group.models.length }} 个模型</el-text>
              </div>
            </div>
          </template>
          <div class="modelGrid">
            <article v-for="model in group.models" :key="model.id" class="modelItem">
              <header class="modelHeader">
                <div class="modelIdentity">
                  <modelIcon :model="model.id" :size="22" />
                  <div class="modelHeading">
                    <strong :title="model.label">{{ model.label }}</strong>
                    <el-text v-if="model.vendor" size="small" type="info">{{ model.vendor.name }}</el-text>
                  </div>
                </div>
                <el-tooltip v-if="model.price" :content="model.price.tips" placement="top" :showAfter="300">
                  <el-tag size="small" :type="priceType(model.price.kind)" effect="plain">{{ model.price.billingLabel }}</el-tag>
                </el-tooltip>
                <el-tag v-else-if="model.type === 'language'" size="small" type="warning" effect="plain">按 Token</el-tag>
              </header>

              <p v-if="model.description" class="modelDescription">{{ model.description }}</p>

              <div v-if="model.tags.length" class="modelTags" aria-label="模型标签">
                <el-tag v-for="tag in model.tags" :key="tag" size="small" effect="plain">{{ tag }}</el-tag>
              </div>
              <el-text v-if="model.supportedEndpointTypes.length" size="small" type="info">
                接口：{{ model.supportedEndpointTypes.join("、") }}
              </el-text>

              <section v-if="model.price" class="priceDetails" aria-label="计费详情">
                <div class="priceSummary">
                  <strong>{{ model.price.label }}</strong>
                  <el-text size="small" type="info">最终以实际扣费为准</el-text>
                </div>
                <div v-if="model.price.tiers.length" class="priceTiers">
                  <div v-for="tier in model.price.tiers" :key="`${tier.name}:${tier.label}`" class="priceTier">
                    <span>{{ tier.name }}</span>
                    <strong>{{ tier.label }}</strong>
                  </div>
                </div>
              </section>
              <el-text v-else-if="model.type === 'language'" size="small" type="info">文本用量按 Token 结算，最终以使用日志为准</el-text>
              <el-text v-else size="small" type="info">价格暂未同步</el-text>
            </article>
          </div>
        </el-collapse-item>
      </el-collapse>
      <el-empty v-else :description="`当前账号没有可用的${typeLabels[activeType]}模型`" :imageSize="72" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { IconRefresh } from "@tabler/icons-vue";
import { modelIcon } from "@toonflow/model-icons";
import {
  aihubkitCatalog,
  aihubkitCatalogError,
  aihubkitCatalogLoading,
  loadAihubkitCatalog,
  type AihubkitCatalogModelType,
  type AihubkitPriceSummary,
} from "@/lib/aihubkitCatalog";
import { useAccountStore } from "@/stores/account";

const props = withDefaults(defineProps<{
  types?: AihubkitCatalogModelType[];
  visible?: boolean;
}>(), { types: () => ["language", "image", "video"], visible: true });
const account = useAccountStore();
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
const syncedGroupCount = computed(() => aihubkitCatalog.value?.syncedGroupCount ?? totalGroups.value);
const totalGroupCount = computed(() => aihubkitCatalog.value?.totalGroupCount ?? totalGroups.value);
const showRetry = computed(() => Boolean(aihubkitCatalogError.value
  || aihubkitCatalog.value && (aihubkitCatalog.value.partial || !aihubkitCatalog.value.pricingAvailable || aihubkitCatalog.value.pricingStale)));

function modelCount(type: AihubkitCatalogModelType) {
  return (aihubkitCatalog.value?.models ?? []).filter(model => model.type === type).length;
}

function formatTime(value?: number) {
  if (!value) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(value);
}

function priceType(kind: AihubkitPriceSummary["kind"]) {
  if (kind === "tokenEstimate") return "warning";
  if (kind === "dynamic" || kind === "inputAudioSecond") return "info";
  return "success";
}

async function refreshCatalog() {
  try {
    const value = await loadAihubkitCatalog(true);
    ElMessage.success(value.partial ? `已同步 ${value.syncedGroupCount} / ${value.totalGroupCount} 个渠道，将自动继续` : "模型渠道已同步");
  } catch {
    ElMessage.error(aihubkitCatalogError.value || "模型渠道同步失败，请重试");
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
        flex-wrap: wrap;
        gap: 8px;
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
      min-height: 64px;
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
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
        flex-shrink: 0;
      }
    }

    .modelGrid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 10px;
      padding: 4px 12px 16px;

      .modelItem {
        display: grid;
        align-content: start;
        gap: 10px;
        min-width: 0;
        padding: 14px;
        border: 1px solid var(--el-border-color-lighter);
        border-radius: var(--el-border-radius-base);
        background: var(--el-fill-color-extra-light);

        .modelHeader,
        .modelIdentity,
        .priceSummary {
          display: flex;
          align-items: center;
        }

        .modelHeader {
          justify-content: space-between;
          gap: 10px;
        }

        .modelIdentity {
          gap: 9px;
          min-width: 0;

          .modelHeading {
            display: grid;
            gap: 2px;
            min-width: 0;

            strong {
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
          }
        }

        .modelDescription {
          margin: 0;
          color: var(--el-text-color-regular);
          font-size: 13px;
          line-height: 1.65;
          overflow-wrap: anywhere;
        }

        .modelTags,
        .priceTiers {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .priceDetails {
          display: grid;
          gap: 8px;
          padding-top: 10px;
          border-top: 1px solid var(--el-border-color-lighter);

          .priceSummary {
            justify-content: space-between;
            gap: 8px;
          }

          .priceTier {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 8px;
            border-radius: 6px;
            background: var(--el-fill-color-light);
            font-size: 12px;

            span {
              color: var(--el-text-color-secondary);
            }
          }
        }
      }
    }
  }

  @media (max-width: 700px) {
    .catalogHeader,
    .groupTitle {
      align-items: flex-start;
      flex-direction: column;
    }

    .groupList {
      .groupTitle .groupMeta {
        justify-content: flex-start;
      }

      .modelGrid {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  }
}
</style>
