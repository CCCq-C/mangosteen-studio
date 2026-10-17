import { getAihubkitPricingSession } from "@/utils/aihubkit/account";
import { AihubkitServiceError, requestAihubkitJson } from "@/utils/aihubkit/client";

export type AihubkitPricingMediaType = "image" | "video";

export interface AihubkitRawPricingModel {
  modelId: string;
  mediaType?: AihubkitPricingMediaType;
  tags: string[];
  groups: string[];
  salesRatios: Record<string, number>;
  quotaType: 0 | 1;
  modelPrice: number;
  billingMode: "legacy" | "tiered_expr";
  billingExpression?: string;
  pricingVersion: string;
}

export interface AihubkitPricingCatalogSnapshot {
  userId: number;
  pricingVersion: string;
  syncedAt: number;
  groupRatios: Record<string, number>;
  models: ReadonlyMap<string, AihubkitRawPricingModel>;
}

const pricingUrl = "https://model.aihubkit.com/api/pricing";
const pricingMaxAge = 10 * 60_000;
let currentPricing: AihubkitPricingCatalogSnapshot | undefined;
let pricingRequest: Promise<AihubkitPricingCatalogSnapshot> | undefined;
let pricingEpoch = 0;

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown, maxLength = 200) {
  if (typeof value !== "string") return "";
  const result = value.trim();
  return result.length <= maxLength ? result : "";
}

function nonnegative(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1_000_000 ? number : undefined;
}

function ratios(value: unknown) {
  const entries = object(value);
  if (!entries) return {};
  return Object.fromEntries(Object.entries(entries).flatMap(([id, raw]) => {
    const groupId = text(id);
    const ratio = nonnegative(raw);
    return groupId && ratio !== undefined ? [[groupId, ratio]] : [];
  }).slice(0, 500));
}

function groups(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap(item => {
    const id = text(item);
    return id ? [id] : [];
  }))].slice(0, 100);
}

function tags(value: unknown) {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(items.flatMap(item => {
    const tag = text(item, 100);
    return tag ? [tag] : [];
  }))].slice(0, 100);
}

function mediaType(items: string[]): AihubkitPricingMediaType | undefined {
  if (items.some(tag => /图片|图像|生图/i.test(tag))) return "image";
  if (items.some(tag => /视频|数字人/i.test(tag))) return "video";
}

function normalizeModel(value: unknown, groupRatios: Record<string, number>, fallbackVersion: string) {
  const data = object(value);
  if (!data) return;
  const modelId = text(data.model_name, 256);
  const modelGroups = groups(data.enable_groups);
  const modelPrice = nonnegative(data.model_price);
  if (!modelId || !modelGroups.length || modelPrice === undefined) return;
  const modelTags = tags(data.tags);
  const explicitRatios = ratios(data.model_sales_ratios);
  const salesRatios = Object.fromEntries(modelGroups.map(group => [group, explicitRatios[group] ?? groupRatios[group] ?? 1]));
  const billingMode = data.billing_mode === "tiered_expr" ? "tiered_expr" : "legacy";
  const expression = text(data.billing_expr, 20_000);
  if (billingMode === "tiered_expr" && !expression) return;
  return {
    modelId,
    mediaType: mediaType(modelTags),
    tags: modelTags,
    groups: modelGroups,
    salesRatios,
    quotaType: data.quota_type === 1 ? 1 : 0,
    modelPrice,
    billingMode,
    ...(expression ? { billingExpression: expression } : {}),
    pricingVersion: text(data.pricing_version) || fallbackVersion,
  } satisfies AihubkitRawPricingModel;
}

function normalizePricing(payload: unknown, userId: number) {
  const data = object(payload);
  const pricingVersion = text(data?.pricing_version);
  const items = data?.data;
  if (data?.success !== true || !pricingVersion || !Array.isArray(items)) {
    throw new AihubkitServiceError(502, "AIHubKit 定价响应格式不正确");
  }
  const groupRatios = ratios(data.group_ratio);
  const models = new Map<string, AihubkitRawPricingModel>();
  for (const item of items.slice(0, 5000)) {
    const model = normalizeModel(item, groupRatios, pricingVersion);
    if (model) models.set(model.modelId, model);
  }
  if (!models.size) throw new AihubkitServiceError(502, "AIHubKit 暂未返回定价模型");
  return { userId, pricingVersion, syncedAt: Date.now(), groupRatios, models } satisfies AihubkitPricingCatalogSnapshot;
}

async function synchronizePricing(epoch: number) {
  const session = await getAihubkitPricingSession();
  const { payload } = await requestAihubkitJson(pricingUrl, {
    headers: {
      Cookie: session.sessionCookie,
      "New-Api-User": String(session.userId),
    },
  });
  const snapshot = normalizePricing(payload, session.userId);
  if (epoch !== pricingEpoch) throw new AihubkitServiceError(409, "价格同步已失效，请重新刷新");
  currentPricing = snapshot;
  return snapshot;
}

export function refreshAihubkitPricingCatalog() {
  if (pricingRequest) return pricingRequest;
  const request = synchronizePricing(pricingEpoch);
  const tracked = request.finally(() => {
    if (pricingRequest === tracked) pricingRequest = undefined;
  });
  pricingRequest = tracked;
  return tracked;
}

export async function getAihubkitPricingCatalog(force = false) {
  const session = await getAihubkitPricingSession();
  if (!force && currentPricing?.userId === session.userId && Date.now() - currentPricing.syncedAt < pricingMaxAge) return currentPricing;
  try {
    return await refreshAihubkitPricingCatalog();
  } catch (error) {
    if (!force && currentPricing?.userId === session.userId) return currentPricing;
    throw error;
  }
}

export function clearAihubkitPricingCatalog() {
  pricingEpoch++;
  pricingRequest = undefined;
  currentPricing = undefined;
}
