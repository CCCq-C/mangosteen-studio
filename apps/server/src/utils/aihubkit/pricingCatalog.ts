import { getAihubkitPricingSession } from "@/utils/aihubkit/account";
import { AihubkitServiceError, requestAihubkitJson } from "@/utils/aihubkit/client";
import conf from "@/utils/conf";

export type AihubkitPricingMediaType = "image" | "video";

export interface AihubkitPricingVendor {
  id: number;
  name: string;
  icon?: string;
}

export interface AihubkitRawPricingModel {
  modelId: string;
  mediaType?: AihubkitPricingMediaType;
  description?: string;
  icon?: string;
  vendor?: AihubkitPricingVendor;
  tags: string[];
  supportedEndpointTypes: string[];
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
  groupLabels: Record<string, string>;
  models: ReadonlyMap<string, AihubkitRawPricingModel>;
}

interface StoredPricingSnapshot {
  pricingVersion: string;
  syncedAt: number;
  groupRatios: Record<string, number>;
  groupLabels: Record<string, string>;
  models: AihubkitRawPricingModel[];
}

type StoredPricingCatalogs = Record<string, StoredPricingSnapshot>;

const pricingUrl = "https://model.aihubkit.com/api/pricing";
const pricingMaxAge = 10 * 60_000;
const maxStoredUsers = 10;
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

function labels(value: unknown) {
  const entries = object(value);
  if (!entries) return {};
  return Object.fromEntries(Object.entries(entries).flatMap(([id, raw]) => {
    const groupId = text(id);
    const label = text(raw, 2_000);
    return groupId && label ? [[groupId, label]] : [];
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

function endpoints(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap(item => {
    const endpoint = text(item, 100);
    return endpoint ? [endpoint] : [];
  }))].slice(0, 20);
}

function vendorId(value: unknown) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= 0 && id <= 1_000_000 ? id : undefined;
}

function normalizeVendor(value: unknown) {
  const data = object(value);
  const id = vendorId(data?.id);
  const name = text(data?.name, 200);
  const icon = text(data?.icon, 256);
  if (id === undefined || !name) return;
  return { id, name, ...(icon ? { icon } : {}) } satisfies AihubkitPricingVendor;
}

function vendors(value: unknown) {
  const result = new Map<number, AihubkitPricingVendor>();
  if (!Array.isArray(value)) return result;
  for (const item of value.slice(0, 500)) {
    const vendor = normalizeVendor(item);
    if (vendor) result.set(vendor.id, vendor);
  }
  return result;
}

function mediaType(items: string[]): AihubkitPricingMediaType | undefined {
  if (items.some(tag => /图片|图像|生图/i.test(tag))) return "image";
  if (items.some(tag => /视频|数字人/i.test(tag))) return "video";
}

function normalizeModel(value: unknown, groupRatios: Record<string, number>, fallbackVersion: string, vendorCatalog: ReadonlyMap<number, AihubkitPricingVendor>) {
  const data = object(value);
  if (!data) return;
  const modelId = text(data.model_name, 256);
  const modelGroups = groups(data.enable_groups);
  const modelPrice = nonnegative(data.model_price);
  if (!modelId || !modelGroups.length || modelPrice === undefined) return;
  const modelTags = tags(data.tags);
  const explicitRatios = ratios(data.model_sales_ratios);
  const salesRatios = Object.fromEntries(modelGroups.flatMap(group => {
    const ratio = explicitRatios[group] ?? groupRatios[group];
    return ratio === undefined ? [] : [[group, ratio]];
  }));
  const billingMode = data.billing_mode === "tiered_expr" ? "tiered_expr" : "legacy";
  const expression = text(data.billing_expr, 20_000);
  const description = text(data.description, 5_000);
  const icon = text(data.icon, 256);
  const modelVendorId = vendorId(data.vendor_id);
  const vendor = modelVendorId === undefined ? undefined : vendorCatalog.get(modelVendorId);
  if (billingMode === "tiered_expr" && !expression) return;
  return {
    modelId,
    mediaType: mediaType(modelTags),
    ...(description ? { description } : {}),
    ...(icon ? { icon } : {}),
    ...(vendor ? { vendor: { ...vendor } } : {}),
    tags: modelTags,
    supportedEndpointTypes: endpoints(data.supported_endpoint_types),
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
  const groupLabels = labels(data.usable_group);
  const vendorCatalog = vendors(data.vendors);
  const models = new Map<string, AihubkitRawPricingModel>();
  for (const item of items.slice(0, 5000)) {
    const model = normalizeModel(item, groupRatios, pricingVersion, vendorCatalog);
    if (model) models.set(model.modelId, model);
  }
  if (!models.size) throw new AihubkitServiceError(502, "AIHubKit 暂未返回定价模型");
  return { userId, pricingVersion, syncedAt: Date.now(), groupRatios, groupLabels, models } satisfies AihubkitPricingCatalogSnapshot;
}

function storedModel(value: unknown) {
  const data = object(value);
  const modelId = text(data?.modelId, 256);
  const modelGroups = groups(data?.groups);
  const modelPrice = nonnegative(data?.modelPrice);
  const pricingVersion = text(data?.pricingVersion);
  const billingMode = data?.billingMode === "tiered_expr" ? "tiered_expr" : data?.billingMode === "legacy" ? "legacy" : undefined;
  const billingExpression = text(data?.billingExpression, 20_000);
  const storedVendor = normalizeVendor(data?.vendor);
  if (!modelId || !modelGroups.length || modelPrice === undefined || !pricingVersion || !billingMode || billingMode === "tiered_expr" && !billingExpression) return;
  return {
    modelId,
    ...(data?.mediaType === "image" || data?.mediaType === "video" ? { mediaType: data.mediaType } : {}),
    ...(text(data?.description, 5_000) ? { description: text(data?.description, 5_000) } : {}),
    ...(text(data?.icon, 256) ? { icon: text(data?.icon, 256) } : {}),
    ...(storedVendor ? { vendor: storedVendor } : {}),
    tags: tags(data?.tags),
    supportedEndpointTypes: endpoints(data?.supportedEndpointTypes),
    groups: modelGroups,
    salesRatios: ratios(data?.salesRatios),
    quotaType: data?.quotaType === 1 ? 1 : 0,
    modelPrice,
    billingMode,
    ...(billingExpression ? { billingExpression } : {}),
    pricingVersion,
  } satisfies AihubkitRawPricingModel;
}

function storedCatalogs(value = conf.get("aihubkitPricingCatalog")): StoredPricingCatalogs {
  const data = object(value);
  if (!data) return {};
  return Object.fromEntries(Object.entries(data).flatMap(([userId, raw]) => {
    if (!/^\d+$/.test(userId)) return [];
    const catalog = object(raw);
    const pricingVersion = text(catalog?.pricingVersion);
    const syncedAt = Number(catalog?.syncedAt);
    const storedModels = Array.isArray(catalog?.models) ? catalog.models.flatMap(item => {
      const model = storedModel(item);
      return model ? [model] : [];
    }).slice(0, 5000) : [];
    if (!pricingVersion || !Number.isSafeInteger(syncedAt) || syncedAt <= 0 || !storedModels.length) return [];
    return [[userId, {
      pricingVersion,
      syncedAt,
      groupRatios: ratios(catalog?.groupRatios),
      groupLabels: labels(catalog?.groupLabels),
      models: storedModels,
    } satisfies StoredPricingSnapshot]];
  }).slice(0, maxStoredUsers));
}

function storedSnapshot(userId: number) {
  const stored = storedCatalogs()[String(userId)];
  if (!stored) return;
  return {
    userId,
    pricingVersion: stored.pricingVersion,
    syncedAt: stored.syncedAt,
    groupRatios: stored.groupRatios,
    groupLabels: stored.groupLabels,
    models: new Map(stored.models.map(model => [model.modelId, model])),
  } satisfies AihubkitPricingCatalogSnapshot;
}

function saveSnapshot(snapshot: AihubkitPricingCatalogSnapshot) {
  const catalogs = storedCatalogs();
  catalogs[String(snapshot.userId)] = {
    pricingVersion: snapshot.pricingVersion,
    syncedAt: snapshot.syncedAt,
    groupRatios: snapshot.groupRatios,
    groupLabels: snapshot.groupLabels,
    models: [...snapshot.models.values()],
  };
  const recent = Object.fromEntries(Object.entries(catalogs)
    .sort(([, left], [, right]) => right.syncedAt - left.syncedAt)
    .slice(0, maxStoredUsers));
  conf.set("aihubkitPricingCatalog", recent);
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
  saveSnapshot(snapshot);
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
  if (currentPricing?.userId !== session.userId) currentPricing = storedSnapshot(session.userId);
  if (!force && currentPricing && Date.now() - currentPricing.syncedAt < pricingMaxAge) return currentPricing;
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
