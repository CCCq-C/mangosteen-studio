import { getAihubkitAccess } from "@/utils/aihubkit/account";
import { AihubkitServiceError, requestAihubkitEnvelope } from "@/utils/aihubkit/client";

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

const quotaPerUnit = 500_000;

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function nonnegativeNumber(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= maximum ? number : undefined;
}

function nonnegativeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
  const number = nonnegativeNumber(value, maximum);
  return number !== undefined && Number.isSafeInteger(number) ? number : undefined;
}

function text(value: unknown, maximumLength = 256) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized.length <= maximumLength ? normalized : normalized.slice(0, maximumLength);
}

function scalarText(value: unknown, maximumLength = 256) {
  if (typeof value === "number" || typeof value === "boolean") return text(String(value), maximumLength);
  return text(value, maximumLength);
}

function jsonObject(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 20_000) return;
  try {
    return object(JSON.parse(value));
  } catch {
    return;
  }
}

function createdAt(value: unknown) {
  const timestamp = nonnegativeInteger(value);
  if (!timestamp) return;
  const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}

function usageLog(value: unknown, userId: number): AihubkitUsageLog | undefined {
  const data = object(value);
  if (!data || nonnegativeInteger(data.user_id) !== userId) return;
  const id = nonnegativeInteger(data.id);
  const timestamp = createdAt(data.created_at);
  const type = nonnegativeInteger(data.type, 10_000);
  const quota = nonnegativeNumber(data.quota);
  const promptTokens = nonnegativeInteger(data.prompt_tokens) ?? 0;
  const completionTokens = nonnegativeInteger(data.completion_tokens) ?? 0;
  const useTime = nonnegativeNumber(data.use_time, 31_536_000) ?? 0;
  if (id === undefined || timestamp === undefined || type === undefined || quota === undefined) return;
  const amount = quota / quotaPerUnit;
  if (!Number.isFinite(amount)) return;
  const errorDetails = type === 5 ? jsonObject(data.other) : undefined;
  return {
    id,
    createdAt: timestamp,
    type,
    modelName: text(data.model_name, 200),
    groupName: text(data.group, 200),
    promptTokens,
    completionTokens,
    useTime,
    amount,
    requestId: text(data.request_id, 300),
    detailMessage: type === 5 ? text(data.content, 4_000) : "",
    errorCode: scalarText(errorDetails?.error_code, 200),
    errorType: scalarText(errorDetails?.error_type, 200),
    statusCode: nonnegativeInteger(errorDetails?.status_code, 999),
  };
}

async function authenticatedRequest(path: string) {
  const access = await getAihubkitAccess();
  const { envelope } = await requestAihubkitEnvelope(path, {
    headers: {
      Authorization: `Bearer ${access.accessToken}`,
      "New-Api-User": String(access.userId),
    },
  }, 401);
  return { access, data: object(envelope.data) };
}

export async function getAihubkitBalance(): Promise<AihubkitBalance> {
  const { data } = await authenticatedRequest("/api/user/self");
  const quota = nonnegativeNumber(data?.quota);
  if (quota === undefined) throw new AihubkitServiceError(502, "AIHubKit 余额响应格式不正确");
  return {
    amount: quota / quotaPerUnit,
    unit: "额度",
    updatedAt: Date.now(),
  };
}

export async function getAihubkitUsageLogs(query: AihubkitUsageLogQuery): Promise<AihubkitUsageLogPage> {
  const parameters = new URLSearchParams({
    p: String(query.page),
    page_size: String(query.pageSize),
  });
  if (query.startTimestamp !== undefined) parameters.set("start_timestamp", String(query.startTimestamp));
  if (query.endTimestamp !== undefined) parameters.set("end_timestamp", String(query.endTimestamp));
  const { access, data } = await authenticatedRequest(`/api/log/self?${parameters}`);
  const total = nonnegativeInteger(data?.total);
  if (!data || total === undefined || !Array.isArray(data.items)) {
    throw new AihubkitServiceError(502, "AIHubKit 使用日志响应格式不正确");
  }
  return {
    page: nonnegativeInteger(data.page) || query.page,
    pageSize: nonnegativeInteger(data.page_size, 100) || query.pageSize,
    total,
    items: data.items.flatMap(item => {
      const normalized = usageLog(item, access.userId);
      return normalized ? [normalized] : [];
    }),
  };
}
