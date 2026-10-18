import { AihubkitServiceError, requestAihubkitEnvelope, requestAihubkitJson } from "@/utils/aihubkit/client";
import { getAihubkitAccess, saveGroupApiKeys } from "@/utils/aihubkit/account";
import {
  clearAihubkitPricing,
  getAihubkitPriceSummary,
  getAihubkitPricing,
  type AihubkitPriceSummary,
  type AihubkitPricingSnapshot,
} from "@/utils/aihubkit/pricing";

export type AihubkitModelType = "image" | "video" | "language" | "unknown";

export interface AihubkitCatalogGroup {
  id: string;
  label: string;
  ratio: number;
  price?: AihubkitPriceSummary;
}

export interface AihubkitCatalogModel {
  id: string;
  label: string;
  type: Exclude<AihubkitModelType, "unknown">;
  description?: string;
  icon?: string;
  vendor?: { id: number; name: string; icon?: string };
  tags: string[];
  supportedEndpointTypes: string[];
  groups: AihubkitCatalogGroup[];
}

export interface AihubkitCatalog {
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
}

type GroupInfo = AihubkitCatalogGroup;

interface GroupCatalog {
  info: GroupInfo;
  apiKey: string;
  models: string[];
}

interface CatalogState extends AihubkitCatalog {
  userId: number;
  groupCatalogs: Map<string, GroupCatalog>;
  candidates: Map<string, { group: string; apiKey: string }[]>;
}

const catalogMaxAge = 10 * 60_000;
let currentCatalog: CatalogState | undefined;
let refreshRequest: Promise<AihubkitCatalog> | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let catalogEpoch = 0;

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeGroups(value: unknown) {
  const groups = object(value);
  if (!groups) throw new AihubkitServiceError(502, "AIHubKit 分组响应格式不正确");
  return Object.entries(groups).flatMap(([id, detail]) => {
    const groupId = id.trim();
    if (!groupId || groupId.length > 200) return [];
    const data = object(detail) ?? {};
    const ratio = Number(data.ratio);
    return [{ id: groupId, label: text(data.desc) || groupId, ratio: Number.isFinite(ratio) ? ratio : 1 } satisfies GroupInfo];
  });
}

function normalizeModels(value: unknown) {
  const payload = object(value);
  const items = Array.isArray(value) ? value : payload?.data;
  if (!Array.isArray(items)) throw new AihubkitServiceError(502, "AIHubKit 模型响应格式不正确");
  const seen = new Set<string>();
  return items.flatMap((item) => {
    const id = text(object(item)?.id);
    if (!id || id.length > 200 || seen.has(id)) return [];
    seen.add(id);
    return [id];
  });
}

function groupType(group: GroupInfo): AihubkitModelType {
  const value = `${group.id} ${group.label}`;
  if (/(?:video|seedance|sora|veo|kling|hailuo|海螺|可灵|视频)/i.test(value)) return "video";
  if (/(?:image|seedream|draw|绘图|生图|图片|图像)/i.test(value)) return "image";
  if (/(?:language|chat|gpt|claude|deepseek|gemini|qwen|codex|grok|国模|语言|对话|文本)/i.test(value)) return "language";
  return "unknown";
}

function modelType(model: string, group: GroupInfo): AihubkitModelType {
  if (/(?:gpt[-_. ]?image|image|imagen|seedream|flux|dall|recraft|midjourney|mj-|banana|wanx|cogview|kolors|hunyuanimage|qwen[-_. ]?image|ideogram|stable[-_. ]?diffusion|sdxl)/i.test(model)) return "image";
  if (/(?:video|seedance|sora|veo|kling|hailuo|minimax[-_. ]?h3|vidu|runway|luma|wan[-_. ]?\d)/i.test(model)) return "video";
  if (/(?:gpt|claude|deepseek|gemini|qwen|glm|moonshot|kimi|codex|grok|mimo|^hy\d|llama|mistral|command[-_. ]?r|doubao|minimax)/i.test(model)) return "language";
  return groupType(group);
}

async function createGroupKey(accessToken: string, userId: number, group: string) {
  const { envelope } = await requestAihubkitEnvelope("/api/token/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "New-Api-User": String(userId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: `山竹漫剧-${group}`, group, unlimited_quota: true }),
  });
  const key = text(object(envelope.data)?.key);
  if (!key) throw new AihubkitServiceError(502, "AIHubKit 未返回分组密钥");
  return key;
}

async function wait(milliseconds: number) {
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function readGroupModels(apiKey: string, retryPropagation: boolean) {
  const attempts = retryPropagation ? 5 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await wait(attempt * 350);
    try {
      const { payload } = await requestAihubkitJson("/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const models = normalizeModels(payload);
      if (models.length || attempt === attempts - 1) return models;
    } catch (error) {
      lastError = error;
      if (!(error instanceof AihubkitServiceError) || !retryPropagation || ![400, 401, 404, 429, 502, 503, 504].includes(error.status)) throw error;
    }
  }
  throw lastError ?? new AihubkitServiceError(502, "AIHubKit 暂未返回模型");
}

function publicCatalog(state: CatalogState): AihubkitCatalog {
  return {
    revision: state.revision,
    syncedAt: state.syncedAt,
    groups: state.groups.map(group => ({ ...group })),
    models: state.models.map(model => ({
      ...model,
      tags: [...model.tags],
      supportedEndpointTypes: [...model.supportedEndpointTypes],
      ...(model.vendor ? { vendor: { ...model.vendor } } : {}),
      groups: model.groups.map(group => ({
        ...group,
        ...(group.price ? { price: { ...group.price, tiers: group.price.tiers.map(tier => ({ ...tier })) } } : {}),
      })),
    })),
    unknownModelCount: state.unknownModelCount,
    partial: state.partial,
    pricingAvailable: state.pricingAvailable,
    pricingStale: state.pricingStale,
    ...(state.pricingVersion ? { pricingVersion: state.pricingVersion } : {}),
    ...(state.pricingSyncedAt ? { pricingSyncedAt: state.pricingSyncedAt } : {}),
  };
}

function buildCatalog(userId: number, groupCatalogs: Map<string, GroupCatalog>, partial: boolean, pricing?: AihubkitPricingSnapshot) {
  const models = new Map<string, AihubkitCatalogModel>();
  const candidates = new Map<string, { group: string; apiKey: string }[]>();
  const unknownModels = new Set<string>();
  for (const group of groupCatalogs.values()) {
    for (const id of group.models) {
      const type = modelType(id, group.info);
      if (type === "unknown") {
        unknownModels.add(id);
        continue;
      }
      const key = `${type}\u0000${id}`;
      const pricingModel = pricing?.models.get(id);
      const model = models.get(key) ?? {
        id,
        label: id,
        type,
        ...(pricingModel?.description ? { description: pricingModel.description } : {}),
        ...(pricingModel?.icon ? { icon: pricingModel.icon } : {}),
        ...(pricingModel?.vendor ? { vendor: { ...pricingModel.vendor } } : {}),
        tags: [...(pricingModel?.tags ?? [])],
        supportedEndpointTypes: [...(pricingModel?.supportedEndpointTypes ?? [])],
        groups: [],
      };
      const pricingRatio = pricingModel?.salesRatios[group.info.id] ?? pricing?.groupRatios[group.info.id];
      const pricingLabel = pricing?.groupLabels[group.info.id];
      const relation = {
        ...group.info,
        ...(pricingLabel ? { label: pricingLabel } : {}),
        ...(pricingRatio === undefined ? {} : { ratio: pricingRatio }),
      };
      const price = pricing && getAihubkitPriceSummary(pricing, id, group.info.id);
      model.groups.push({ ...relation, ...(price ? { price } : {}) });
      models.set(key, model);
      const entries = candidates.get(key) ?? [];
      entries.push({ group: group.info.id, apiKey: group.apiKey });
      candidates.set(key, entries);
    }
  }
  return {
    userId,
    revision: (currentCatalog?.userId === userId ? currentCatalog.revision : 0) + 1,
    syncedAt: Date.now(),
    groups: [...groupCatalogs.values()].map(group => ({
      ...group.info,
      ...(pricing?.groupLabels[group.info.id] ? { label: pricing.groupLabels[group.info.id] } : {}),
      ratio: pricing?.groupRatios[group.info.id] ?? group.info.ratio,
    })),
    models: [...models.values()].sort((left, right) => left.type.localeCompare(right.type) || left.label.localeCompare(right.label)),
    unknownModelCount: unknownModels.size,
    partial,
    pricingAvailable: Boolean(pricing),
    pricingStale: Boolean(pricing && Date.now() - pricing.syncedAt >= catalogMaxAge),
    ...(pricing ? { pricingVersion: pricing.pricingVersion, pricingSyncedAt: pricing.syncedAt } : {}),
    groupCatalogs,
    candidates,
  } satisfies CatalogState;
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    void refreshAihubkitCatalog().catch(() => {});
  }, catalogMaxAge);
  refreshTimer.unref?.();
}

async function synchronizeCatalog(epoch: number, forcePricing = false) {
  const access = await getAihubkitAccess();
  const pricingRequest = getAihubkitPricing(forcePricing).catch(() => forcePricing
    ? getAihubkitPricing().catch(() => undefined)
    : undefined);
  const { envelope } = await requestAihubkitEnvelope("/api/user/self/groups", {
    headers: {
      Authorization: `Bearer ${access.accessToken}`,
      "New-Api-User": String(access.userId),
    },
  });
  const groups = normalizeGroups(envelope.data);
  const keys = { ...access.groupApiKeys };
  const previous = currentCatalog?.userId === access.userId ? currentCatalog.groupCatalogs : new Map<string, GroupCatalog>();
  const next = new Map<string, GroupCatalog>();
  let successfulGroups = 0;
  let firstFailure: unknown;
  let partial = false;

  // ACT: 分组顺序同步，避免首次登录时并发创建大量令牌和模型请求。
  for (const info of groups) {
    let apiKey = keys[info.id] ?? "";
    let created = false;
    try {
      if (!apiKey) {
        apiKey = await createGroupKey(access.accessToken, access.userId, info.id);
        keys[info.id] = apiKey;
        created = true;
      }
      let models: string[];
      try {
        models = await readGroupModels(apiKey, created);
      } catch (error) {
        if (!(error instanceof AihubkitServiceError) || error.status !== 401 || created) throw error;
        apiKey = await createGroupKey(access.accessToken, access.userId, info.id);
        keys[info.id] = apiKey;
        models = await readGroupModels(apiKey, true);
      }
      next.set(info.id, { info, apiKey, models });
      successfulGroups++;
    } catch (error) {
      partial = true;
      firstFailure ??= error;
      const cached = previous.get(info.id);
      if (cached) next.set(info.id, { ...cached, info, apiKey: apiKey || cached.apiKey });
    }
  }

  if (groups.length && !successfulGroups) throw firstFailure ?? new AihubkitServiceError(502, "AIHubKit 暂未返回可用模型");
  if (epoch !== catalogEpoch) throw new AihubkitServiceError(409, "模型目录同步已失效，请重新刷新");
  if (JSON.stringify(keys) !== JSON.stringify(access.groupApiKeys)) await saveGroupApiKeys(access.userId, keys);
  if (epoch !== catalogEpoch) throw new AihubkitServiceError(409, "模型目录同步已失效，请重新刷新");
  const pricing: AihubkitPricingSnapshot | undefined = await pricingRequest;
  if (epoch !== catalogEpoch) throw new AihubkitServiceError(409, "模型目录同步已失效，请重新刷新");
  currentCatalog = buildCatalog(access.userId, next, partial, pricing);
  scheduleRefresh();
  return publicCatalog(currentCatalog);
}

export function refreshAihubkitCatalog(forcePricing = false) {
  if (refreshRequest) return refreshRequest;
  const request = synchronizeCatalog(catalogEpoch, forcePricing);
  const tracked = request.finally(() => {
    if (refreshRequest === tracked) refreshRequest = undefined;
  });
  refreshRequest = tracked;
  return tracked;
}

export async function getAihubkitCatalog(force = false) {
  if (!force && currentCatalog && Date.now() - currentCatalog.syncedAt < catalogMaxAge) return publicCatalog(currentCatalog);
  try {
    return await refreshAihubkitCatalog(force);
  } catch (error) {
    if (error instanceof AihubkitServiceError && error.status === 401) clearAihubkitCatalog();
    if (!force && currentCatalog) return publicCatalog(currentCatalog);
    throw error;
  }
}

export async function getAihubkitModelCandidates(modelId: string, type: Exclude<AihubkitModelType, "unknown">) {
  await getAihubkitCatalog();
  const key = `${type}\u0000${modelId}`;
  if (!currentCatalog?.models.some(model => model.id === modelId && model.type === type)) return [];
  return (currentCatalog.candidates.get(key) ?? []).map(candidate => ({ ...candidate }));
}

export async function getAihubkitModelCandidate(modelId: string, type: Exclude<AihubkitModelType, "unknown">, groupId: string) {
  return (await getAihubkitModelCandidates(modelId, type)).find(candidate => candidate.group === groupId);
}

export function clearAihubkitCatalog() {
  catalogEpoch++;
  clearTimeout(refreshTimer);
  refreshTimer = undefined;
  refreshRequest = undefined;
  currentCatalog = undefined;
  clearAihubkitPricing();
}
