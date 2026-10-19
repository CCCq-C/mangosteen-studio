<template>
  <div class="modelSettings">
    <el-collapse v-model="advancedSections" class="advancedSettings">
      <el-collapse-item name="providers">
        <template #title>
          <div class="advancedTitle">
            <strong>高级供应商</strong>
            <el-text size="small" type="info">保留原有第三方与自定义配置</el-text>
          </div>
        </template>
        <div class="providerList">
          <div class="itemList">
            <el-card v-for="item in sortedProviders" :key="item.id" class="providerItem" shadow="never">
              <div class="providerHeader">
                <div v-if="item.icon" class="providerMark" aria-hidden="true">
                  <img class="providerLogo" :src="item.icon" alt="" />
                </div>
                <div class="providerInfo">
                  <div class="providerHeading">
                    <el-text class="providerName" tag="strong">{{ item.label }}</el-text>
                  </div>
                  <el-text class="providerId" size="small" type="info" :title="item.id">{{ item.id }}</el-text>
                </div>
              </div>
              <div class="providerFooter">
                <div class="providerMeta">
                  <el-tag v-if="getProviderVersion(item)" size="small" type="info" effect="plain">v{{ getProviderVersion(item) }}</el-tag>
                  <el-text size="small" type="info">{{ item.models.length }} 个模型</el-text>
                </div>
                <el-space class="itemActions" wrap>
                  <el-button text :icon="IconEdit" :disabled="!!deletingId" @click="openCustomProvider(item)">编辑</el-button>
                  <el-popconfirm title="确定删除此供应商及其模型？" confirmButtonText="删除" cancelButtonText="取消" @confirm="deleteProvider(item.id)">
                    <template #reference><el-button text type="danger" :icon="IconTrash" :loading="deletingId === item.id" :disabled="!!deletingId">删除</el-button></template>
                  </el-popconfirm>
                </el-space>
              </div>
            </el-card>
          </div>
          <div class="providerActions">
            <el-button class="addButton" :icon="IconPlus" @click="openCustomProvider()">添加供应商</el-button>
          </div>
          <component :is="addCustomProviderDialog" v-model="customProviderDialogVisible" :provider="editingProvider" />
        </div>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, shallowRef, type Component } from "vue";
import { ElMessage } from "element-plus";
import { customProviders, saveSettings, type CustomProvider } from "@/stores/settings";
import { IconPlus, IconEdit, IconTrash } from "@tabler/icons-vue";
import { languageProviders } from "@toonflow/providers";
import { isTfRouterProvider } from "@/lib/tf";

const addCustomProviderDialog = shallowRef<Component>();
const customProviderDialogVisible = ref(false);
const editingProvider = ref<CustomProvider>();
const deletingId = ref("");
const advancedSections = ref<string[]>(["providers"]);
const sortedProviders = computed(() => customProviders.value
  .filter(provider => !isTfRouterProvider(provider))
  .sort((left, right) => left.label.localeCompare(right.label)));

function getProviderVersion(provider: CustomProvider) {
  const version = languageProviders.find(item => item.id.toLowerCase() === provider.id.toLowerCase())?.version ?? provider.version;
  return typeof version === "string" ? version.trim() : "";
}

function openCustomProvider(provider?: CustomProvider) {
  addCustomProviderDialog.value ??= defineAsyncComponent(() => import("./addCustomProviderDialog.vue"));
  editingProvider.value = provider;
  customProviderDialogVisible.value = true;
}

async function deleteProvider(id: string) {
  if (deletingId.value) return;
  deletingId.value = id;
  try {
    await saveSettings(settings => {
      const current = settings.customProviders;
      if (!Array.isArray(current)) throw new Error("配置格式错误");
      return { customProviders: current.filter(item => item?.id !== id) };
    });
  } catch { ElMessage.error("删除失败，请重试"); }
  finally { deletingId.value = ""; }
}

</script>

<style lang="scss" scoped src="../../providerList.scss"></style>
<style scoped lang="scss">
.modelSettings {
  .advancedSettings {
    .advancedTitle {
      display: flex;
      align-items: baseline;
      gap: 10px;
    }

    .providerList {
      padding-top: 12px;
    }
  }
}
</style>
