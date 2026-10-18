import axios from "axios";
import { readonly, ref, shallowRef } from "vue";
import { invalidateNodeModels } from "@toonflow/nodes-scaffold/nodeAi";

export type AihubkitCatalogModelType = "image" | "video" | "language";
export type AihubkitPriceSummary = {
  label: string;
  tips: string;
  kind: "fixed" | "perSecond" | "tokenEstimate" | "inputAudioSecond" | "dynamic";
  billingLabel: string;
  tiers: { name: string; label: string }[];
  pricingVersion: string;
};
export type AihubkitCatalogGroup = { id: string; label: string; ratio: number; price?: AihubkitPriceSummary };
export type AihubkitCatalogModel = {
  id: string;
  label: string;
  type: AihubkitCatalogModelType;
  description?: string;
  icon?: string;
  vendor?: { id: number; name: string; icon?: string };
  tags: string[];
  supportedEndpointTypes: string[];
  groups: AihubkitCatalogGroup[];
};
export type AihubkitCatalog = {
  revision: number;
  syncedAt: number;
  groups: AihubkitCatalogGroup[];
  models: AihubkitCatalogModel[];
  unknownModelCount: number;
  partial: boolean;
  pricingAvailable: boolean;
  pricingStale: boolean;
  pricingVersion?: string;
  pricingSyncedAt?: number;
};

type ApiResponse<T> = { code: number; data: T | null; message: string };

const client = axios.create({
  baseURL: "/api/desktop/account",
  timeout: 120_000,
  headers: { "x-toonflow-desktop": "1" },
});
const catalog = shallowRef<AihubkitCatalog>();
const loading = ref(false);
const errorMessage = ref("");
const catalogRefreshInterval = 10 * 60_000;
let pending: Promise<AihubkitCatalog> | undefined;
let syncTimer: ReturnType<typeof setInterval> | undefined;
let stateEpoch = 0;

function requestError(error: unknown) {
  if (axios.isAxiosError<{ message?: unknown }>(error)) {
    const message = error.response?.data?.message;
    if (typeof message === "string" && message.trim()) return message;
    if (error.code === "ECONNABORTED") return "模型目录同步超时，请重试";
  }
  return error instanceof Error && error.message ? error.message : "模型目录同步失败，请重试";
}

export const aihubkitCatalog = readonly(catalog);
export const aihubkitCatalogLoading = readonly(loading);
export const aihubkitCatalogError = readonly(errorMessage);

function catalogSignature(value: AihubkitCatalog | undefined) {
  if (!value) return "";
  return JSON.stringify([
    value.pricingVersion ?? "",
    value.groups.map(group => [group.id, group.label, group.ratio]),
    value.models.map(model => [model.id, model.type, model.groups.map(group => [
      group.id,
      group.ratio,
      group.price?.kind ?? "",
      group.price?.label ?? "",
      group.price?.tiers.map(tier => [tier.name, tier.label]) ?? [],
    ])]),
  ]);
}

export function loadAihubkitCatalog(refresh = false) {
  if (pending) return pending;
  const epoch = stateEpoch;
  loading.value = true;
  errorMessage.value = "";
  const request = client.post<ApiResponse<AihubkitCatalog>>("/catalog", { refresh })
    .then(({ data }) => {
      if (data.code !== 200 || !data.data || !Array.isArray(data.data.groups) || !Array.isArray(data.data.models)) {
        throw new Error(data.message || "模型目录返回格式不正确");
      }
      if (epoch !== stateEpoch) return data.data;
      const changed = catalogSignature(catalog.value) !== catalogSignature(data.data);
      catalog.value = data.data;
      if (changed) {
        invalidateNodeModels("language");
        invalidateNodeModels("media");
      }
      return data.data;
    })
    .catch((error) => {
      if (epoch === stateEpoch) errorMessage.value = requestError(error);
      throw error;
    })
    .finally(() => {
      if (pending === request) pending = undefined;
      if (epoch === stateEpoch) loading.value = false;
    });
  pending = request;
  return request;
}

export function stopAihubkitCatalogSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = undefined;
}

export function startAihubkitCatalogSync() {
  stopAihubkitCatalogSync();
  void loadAihubkitCatalog().catch(() => {});
  syncTimer = setInterval(() => {
    void loadAihubkitCatalog(true).catch(() => {});
  }, catalogRefreshInterval);
}

export function clearAihubkitCatalogState() {
  stateEpoch++;
  stopAihubkitCatalogSync();
  pending = undefined;
  catalog.value = undefined;
  loading.value = false;
  errorMessage.value = "";
  invalidateNodeModels("language");
  invalidateNodeModels("media");
}
