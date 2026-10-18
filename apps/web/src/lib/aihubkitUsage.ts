import axios from "axios";
import { readonly, ref } from "vue";

export interface AihubkitBalance {
  amount: number;
  unit: "额度";
  updatedAt: number;
}

export interface AihubkitUsageLog {
  id: number;
  createdAt: number;
  type: number;
  modelName: string;
  groupName: string;
  promptTokens: number;
  completionTokens: number;
  useTime: number;
  amount: number;
  requestId: string;
  detailMessage: string;
  errorCode: string;
  errorType: string;
  statusCode?: number;
}

export interface AihubkitUsageLogQuery {
  page: number;
  pageSize: number;
  startTimestamp?: number;
  endTimestamp?: number;
}

export interface AihubkitUsageLogPage {
  page: number;
  pageSize: number;
  total: number;
  items: AihubkitUsageLog[];
}

export interface AihubkitTopupResult {
  redeemedAt: number;
}

type ApiResponse<T> = { code: number; data: T | null; message: string };

const client = axios.create({
  baseURL: "/api/desktop/account",
  timeout: 25_000,
  headers: { "x-toonflow-desktop": "1" },
});
const balance = ref<AihubkitBalance>();
const balanceLoading = ref(false);
const balanceError = ref("");
let balanceRequest: Promise<AihubkitBalance> | undefined;
let usageRevision = 0;

function requestError(cause: unknown, fallback: string) {
  if (axios.isAxiosError<{ message?: unknown }>(cause)) {
    const message = cause.response?.data?.message;
    if (typeof message === "string" && message.trim()) return message;
    if (cause.code === "ECONNABORTED") return "账户服务请求超时，请重试";
  }
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

async function post<T>(path: string, body: unknown = {}) {
  const response = await client.post<ApiResponse<T>>(path, body);
  if (response.data.code !== 200 || response.data.data === null) {
    throw new Error(response.data.message || "账户用量读取失败，请重试");
  }
  return response.data.data;
}

function finiteNonnegative(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function safeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function usageBalance(value: unknown): AihubkitBalance {
  if (!value || typeof value !== "object") throw new Error("账户余额返回格式不正确");
  const data = value as Partial<AihubkitBalance>;
  if (!finiteNonnegative(data.amount) || data.unit !== "额度" || !safeInteger(data.updatedAt) || data.updatedAt === 0) {
    throw new Error("账户余额返回格式不正确");
  }
  return data as AihubkitBalance;
}

function usageLog(value: unknown): value is AihubkitUsageLog {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<AihubkitUsageLog>;
  return safeInteger(data.id)
    && safeInteger(data.createdAt) && data.createdAt !== 0
    && safeInteger(data.type)
    && typeof data.modelName === "string"
    && typeof data.groupName === "string"
    && safeInteger(data.promptTokens)
    && safeInteger(data.completionTokens)
    && finiteNonnegative(data.useTime)
    && finiteNonnegative(data.amount)
    && typeof data.requestId === "string"
    && typeof data.detailMessage === "string"
    && typeof data.errorCode === "string"
    && typeof data.errorType === "string"
    && (data.statusCode === undefined || safeInteger(data.statusCode) && data.statusCode <= 999);
}

function usageLogPage(value: unknown): AihubkitUsageLogPage {
  if (!value || typeof value !== "object") throw new Error("使用日志返回格式不正确");
  const data = value as Partial<AihubkitUsageLogPage>;
  if (!safeInteger(data.page) || data.page === 0
    || !safeInteger(data.pageSize) || data.pageSize === 0
    || !safeInteger(data.total)
    || !Array.isArray(data.items) || !data.items.every(usageLog)) {
    throw new Error("使用日志返回格式不正确");
  }
  return data as AihubkitUsageLogPage;
}

function topupResult(value: unknown): AihubkitTopupResult {
  if (!value || typeof value !== "object") throw new Error("兑换结果返回格式不正确");
  const data = value as Partial<AihubkitTopupResult>;
  if (!safeInteger(data.redeemedAt) || data.redeemedAt === 0) throw new Error("兑换结果返回格式不正确");
  return data as AihubkitTopupResult;
}

export const aihubkitBalance = readonly(balance);
export const aihubkitBalanceLoading = readonly(balanceLoading);
export const aihubkitBalanceError = readonly(balanceError);

export function loadAihubkitBalance() {
  if (balanceRequest) return balanceRequest;
  const revision = usageRevision;
  balanceLoading.value = true;
  balanceError.value = "";
  const request = post<AihubkitBalance>("/balance")
    .then(usageBalance)
    .then(result => {
      if (revision === usageRevision) balance.value = result;
      return result;
    })
    .catch(cause => {
      const message = requestError(cause, "账户余额读取失败，请重试");
      if (revision === usageRevision) balanceError.value = message;
      throw new Error(message);
    })
    .finally(() => {
      if (balanceRequest === request) balanceRequest = undefined;
      if (revision === usageRevision) balanceLoading.value = false;
    });
  balanceRequest = request;
  return request;
}

export async function refreshAihubkitBalance() {
  const pending = balanceRequest;
  if (pending) await pending.catch(() => {});
  return loadAihubkitBalance();
}

export async function redeemAihubkitCode(key: string) {
  try {
    return topupResult(await post<AihubkitTopupResult>("/topup", { key: key.trim() }));
  } catch (cause) {
    throw new Error(requestError(cause, "兑换码充值失败，请检查兑换码后重试"));
  }
}

export async function loadAihubkitUsageLogs(query: AihubkitUsageLogQuery) {
  try {
    return usageLogPage(await post<AihubkitUsageLogPage>("/logs", query));
  } catch (cause) {
    throw new Error(requestError(cause, "使用日志读取失败，请重试"));
  }
}

export function clearAihubkitUsage() {
  usageRevision++;
  balanceRequest = undefined;
  balance.value = undefined;
  balanceLoading.value = false;
  balanceError.value = "";
}
