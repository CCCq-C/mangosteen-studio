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
        <div v-if="loaded" class="providerList">
          <div class="itemList">
            <el-card v-for="item in sortedProviders" :key="item.fileName" class="providerItem" shadow="never">
              <div class="providerHeader">
                <div v-if="item.icon" class="providerMark" aria-hidden="true">
                  <img class="providerLogo" :src="item.icon" alt="" />
                </div>
                <div class="providerInfo">
                  <div class="providerHeading">
                    <el-text class="providerName" tag="strong">{{ item.label }}</el-text>
                  </div>
                  <el-text class="providerId" size="small" type="info" :title="item.fileName">{{ item.fileName }}</el-text>
                </div>
              </div>
              <el-alert v-if="item.loadError" :title="item.loadError" type="error" :closable="false" showIcon />
              <div class="providerFooter">
                <div class="providerMeta">
                  <el-tag v-if="item.version" size="small" type="info" effect="plain">v{{ item.version }}</el-tag>
                  <el-text size="small" type="info">{{ item.models.length }} 个模型</el-text>
                </div>
                <el-space class="itemActions" wrap>
                  <el-button v-if="item.modelsUrl" text :icon="IconDownload" :loading="fetchingFile === item.fileName" :disabled="!!fetchingFile || !!deletingFile || !!item.loadError || !item.revision" @click="fetchModels(item)">获取模型</el-button>
                  <el-button text :icon="IconEdit" :disabled="!!fetchingFile || !!deletingFile || !!item.loadError" @click="editProvider(item)">编辑模型</el-button>
                  <el-popconfirm title="确定删除此供应商及其模型？" confirmButtonText="删除" cancelButtonText="取消" @confirm="deleteProvider(item)">
                    <template #reference><el-button text type="danger" :icon="IconTrash" :loading="deletingFile === item.fileName" :disabled="!!fetchingFile || !!deletingFile || !item.revision">删除</el-button></template>
                  </el-popconfirm>
                </el-space>
              </div>
            </el-card>
          </div>
          <div class="providerActions">
            <el-button class="addButton" :icon="IconPlus" @click="openAdd">添加供应商</el-button>
          </div>
          <component :is="mediaProviderDialog" v-model="providerDialogVisible" @added="saveProviderItem" />
          <component :is="editProviderDialog" v-model="editorVisible" :provider="editingProvider" @saved="saveProviderItem" />
        </div>
        <el-skeleton v-else :rows="3" animated />
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, defineAsyncComponent, onMounted, onBeforeUnmount, ref, shallowRef, type Component } from "vue";
import { ElMessage } from "element-plus";
import { IconPlus, IconEdit, IconTrash, IconDownload } from "@tabler/icons-vue";
import type { MediaProvider } from "./types";
import { saveSettings } from "@/stores/settings";
import { invalidateNodeModels } from "@toonflow/nodes-scaffold/nodeAi";

const mediaProviderDialog = shallowRef<Component>();
const editProviderDialog = shallowRef<Component>();
const providers = ref<MediaProvider[]>([]);
const sortedProviders = computed(() => providers.value
  .filter(provider => provider.id.toLowerCase() !== "tfrouter")
  .sort((left, right) => left.label.localeCompare(right.label)));
const loaded = ref(false);
const providerDialogVisible = ref(false);
const editorVisible = ref(false);
const editingProvider = ref<MediaProvider>();
const deletingFile = ref("");
const fetchingFile = ref("");
const advancedSections = ref<string[]>(["providers"]);
let loadRequest = 0;

function refreshInstalled(event: WindowEventMap["toonflow:plugin-installed"]) {
  if (event.detail.type === "provider") void loadProviders();
}
onMounted(() => {
  void loadProviders();
  window.addEventListener("toonflow:plugin-installed", refreshInstalled);
});
onBeforeUnmount(() => {
  loadRequest++;
  window.removeEventListener("toonflow:plugin-installed", refreshInstalled);
});

async function loadProviders() {
  const request = ++loadRequest;
  try {
    const { data } = await axios.get<{ data: MediaProvider[] }>("/api/providers/media/list");
    if (request === loadRequest) providers.value = data.data;
  } catch (error) {
    if (request === loadRequest) ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || error.message : "读取媒体供应商失败");
  } finally {
    if (request === loadRequest) loaded.value = true;
  }
}

function openAdd() {
  mediaProviderDialog.value ??= defineAsyncComponent(() => import("./addCustomProviderDialog.vue"));
  providerDialogVisible.value = true;
}

function editProvider(provider: MediaProvider) {
  if (fetchingFile.value || deletingFile.value || provider.loadError) return;
  editProviderDialog.value ??= defineAsyncComponent(() => import("./editProviderDialog.vue"));
  editingProvider.value = provider;
  editorVisible.value = true;
}

async function fetchModels(provider: MediaProvider) {
  if (fetchingFile.value || deletingFile.value || !provider.modelsUrl || !provider.revision || provider.loadError) return;
  fetchingFile.value = provider.fileName;
  try {
    const { data } = await axios.post<{ code: number; data: MediaProvider; message: string }>("/api/providers/media/models", {
      fileName: provider.fileName, revision: provider.revision,
    }, { timeout: 35000 });
    if (data.code !== 200 || !data.data) throw new Error(data.message || "获取模型失败");
    saveProviderItem(data.data);
    invalidateNodeModels("media");
    ElMessage.success("模型列表已更新");
  } catch (error) {
    ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "获取模型失败，请重试");
  } finally { fetchingFile.value = ""; }
}

async function deleteProvider(provider: MediaProvider) {
  if (fetchingFile.value || deletingFile.value || !provider.revision) return;
  deletingFile.value = provider.fileName;
  let deleted = false;
  try {
    await axios.delete("/api/providers/media/delete", { data: { fileName: provider.fileName, revision: provider.revision } });
    deleted = true;
    loadRequest++;
    invalidateNodeModels("media");
    providers.value = providers.value.filter(item => item.fileName !== provider.fileName);
    await saveSettings(settings => {
      const configs = settings.mediaProviderConfigs;
      if (!configs || typeof configs !== "object" || Array.isArray(configs) || !Object.hasOwn(configs, provider.id)) return;
      const current = { ...configs } as Record<string, unknown>;
      delete current[provider.id];
      return { mediaProviderConfigs: current };
    });
  } catch (error) {
    const message = axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "删除失败，请重试";
    ElMessage.error(deleted ? `供应商已删除，连接配置未清理：${message}` : message);
  } finally { deletingFile.value = ""; }
}

function saveProviderItem(provider: MediaProvider) {
  loadRequest++;
  const index = providers.value.findIndex(item => item.fileName === provider.fileName);
  if (index < 0) providers.value.push(provider);
  else providers.value.splice(index, 1, provider);
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
