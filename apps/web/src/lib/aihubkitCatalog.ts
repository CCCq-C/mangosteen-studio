import axios from "axios";
import { readonly, ref, shallowRef } from "vue";
import { invalidateNodeModels } from "@toonflow/nodes-scaffold/nodeAi";

export type AihubkitCatalogModelType = "image" | "video" | "language";
export type AihubkitCatalogGroup = { id: string; label: string; ratio: number };
export type AihubkitCatalogModel = {
  id: string;
  label: string;
  type: AihubkitCatalogModelType;
  groups: AihubkitCatalogGroup[];
};
export type AihubkitCatalog = {
  revision: number;
  syncedAt: number;
  groups: AihubkitCatalogGroup[];
  models: AihubkitCatalogModel[];
  unknownModelCount: number;
  partial: boolean;
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
let pending: Promise<AihubkitCatalog> | undefined;

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

export function loadAihubkitCatalog(refresh = false) {
  if (pending) return pending;
  loading.value = true;
  errorMessage.value = "";
  const request = client.post<ApiResponse<AihubkitCatalog>>("/catalog", { refresh })
    .then(({ data }) => {
      if (data.code !== 200 || !data.data || !Array.isArray(data.data.groups) || !Array.isArray(data.data.models)) {
        throw new Error(data.message || "模型目录返回格式不正确");
      }
      catalog.value = data.data;
      if (refresh) {
        invalidateNodeModels("language");
        invalidateNodeModels("media");
      }
      return data.data;
    })
    .catch((error) => {
      errorMessage.value = requestError(error);
      throw error;
    })
    .finally(() => {
      if (pending === request) pending = undefined;
      loading.value = false;
    });
  pending = request;
  return request;
}
