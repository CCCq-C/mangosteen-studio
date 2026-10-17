import type { ProviderPrice, ProviderPriceRequest } from "@toonflow/providers";
import {
  clearAihubkitPricingCatalog,
  getAihubkitPricingCatalog,
  type AihubkitPricingCatalogSnapshot,
  type AihubkitRawPricingModel,
} from "@/utils/aihubkit/pricingCatalog";
import {
  clearAihubkitPriceHistoryRuntime,
  getAihubkitPriceSample,
  getLatestAihubkitPriceSample,
  refreshAihubkitPriceHistory,
  scheduleAihubkitPriceHistoryRefresh as scheduleHistoryRefresh,
} from "@/utils/aihubkit/pricingHistory";
import {
  emptyAihubkitPricingDimensions,
  evaluateAihubkitExpression,
  summarizeAihubkitExpression,
  type AihubkitPricingDimensions,
} from "@/utils/aihubkit/pricingExpression";

export interface AihubkitPriceSummary {
  label: string;
  tips: string;
  kind: "fixed" | "perSecond" | "tokenEstimate" | "dynamic";
  pricingVersion: string;
}

export type AihubkitPricingSnapshot = AihubkitPricingCatalogSnapshot;

function amount(value: number) {
  return Number(value.toFixed(6)).toString();
}

function ratio(snapshot: AihubkitPricingCatalogSnapshot, model: AihubkitRawPricingModel, groupId: string) {
  const value = model.salesRatios[groupId] ?? snapshot.groupRatios[groupId];
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function actualTip(snapshot: AihubkitPricingCatalogSnapshot, modelId: string, groupId: string) {
  const sample = getLatestAihubkitPriceSample(snapshot.userId, modelId, groupId);
  if (!sample) return "";
  const dimensions = [
    sample.dimensions.seconds > 0 ? `${amount(sample.dimensions.seconds)}秒` : "",
    sample.dimensions.resolutionTier,
  ].filter(Boolean).join(" · ");
  return `最近实际扣费 ${amount(sample.amount)} 额度${dimensions ? `（${dimensions}）` : ""}。`;
}

export function getAihubkitPriceSummary(snapshot: AihubkitPricingCatalogSnapshot, modelId: string, groupId: string): AihubkitPriceSummary | undefined {
  const model = snapshot.models.get(modelId);
  const groupRatio = model && ratio(snapshot, model, groupId);
  if (!model?.mediaType || !model.groups.includes(groupId) || groupRatio === undefined) return;
  const observed = actualTip(snapshot, modelId, groupId);
  if (model.billingMode === "legacy") {
    if (model.quotaType !== 1) return;
    return {
      label: `${amount(model.modelPrice * groupRatio)}/次`,
      tips: `按张计费；当前账号分组倍率 ${amount(groupRatio)}×；${observed || "最终以实际扣费为准。"}`,
      kind: "fixed",
      pricingVersion: model.pricingVersion,
    };
  }
  if (!model.billingExpression) return;
  const summary = summarizeAihubkitExpression(model.billingExpression, groupRatio);
  return summary ? {
    ...summary,
    tips: `${summary.tips}${observed ? ` ${observed}` : ""}`,
    pricingVersion: model.pricingVersion,
  } : undefined;
}

function referenceSeconds(items: { duration?: number }[] | undefined) {
  return items?.reduce((total, item) => total + (Number.isFinite(item.duration) && item.duration! > 0 ? item.duration! : 0), 0) ?? 0;
}

function pricingDimensions(request: ProviderPriceRequest): AihubkitPricingDimensions | undefined {
  if (request.type === "image") {
    const units = Number.isFinite(request.n) && request.n! > 0 ? Math.floor(request.n!) : 1;
    return {
      ...emptyAihubkitPricingDimensions,
      resolutionTier: request.size?.trim() || request.quality?.trim() || "",
      units,
      inputImageCount: (request.images?.length ?? 0) + (request.mask ? 1 : 0),
      referenceImageCount: request.images?.length ?? 0,
    };
  }
  if (request.type !== "video" || !Number.isFinite(request.duration) || request.duration! <= 0 || !request.resolution?.trim()) return;
  const imageCount = (request.images?.length ?? 0) + (request.firstFrame ? 1 : 0) + (request.lastFrame ? 1 : 0);
  return {
    ...emptyAihubkitPricingDimensions,
    resolutionTier: request.resolution.trim(),
    seconds: request.duration!,
    inputImageCount: imageCount,
    inputVideoCount: request.videos?.length ?? 0,
    inputVideoSeconds: referenceSeconds(request.videos),
    inputAudioCount: request.audios?.length ?? 0,
    inputAudioSeconds: referenceSeconds(request.audios),
    referenceImageCount: request.images?.length ?? 0,
    referenceVideoCount: request.videos?.length ?? 0,
    referenceAudioCount: request.audios?.length ?? 0,
  };
}

export async function getAihubkitPricing(force = false) {
  const snapshot = await getAihubkitPricingCatalog(force);
  void refreshAihubkitPriceHistory(snapshot.models, force).catch(() => undefined);
  return snapshot;
}

export async function estimateAihubkitMediaPrice(modelId: string, groupId: string, request: ProviderPriceRequest): Promise<ProviderPrice | null> {
  const snapshot = await getAihubkitPricing();
  const model = snapshot.models.get(modelId);
  const groupRatio = model && ratio(snapshot, model, groupId);
  if (!model?.mediaType || model.mediaType !== request.type || !model.groups.includes(groupId) || groupRatio === undefined) return null;
  const dimensions = pricingDimensions(request);
  if (!dimensions) return null;
  if (model.billingMode === "legacy") {
    if (model.quotaType !== 1) return null;
    const price = model.modelPrice * groupRatio * dimensions.units;
    return {
      price: `预计 ${amount(price)} 额度`,
      tips: `按 ${dimensions.units} 张计算；当前账号分组倍率 ${amount(groupRatio)}×；最终以实际扣费为准。`,
    };
  }
  if (!model.billingExpression) return null;
  const evaluated = evaluateAihubkitExpression(model.billingExpression, dimensions);
  if (!evaluated) return null;
  const observed = evaluated.deferred ? getAihubkitPriceSample(snapshot.userId, modelId, groupId, dimensions) : undefined;
  const price = observed?.amount ?? evaluated.amount * groupRatio;
  return {
    price: `预计 ${amount(price)} 额度`,
    tips: observed
      ? `参考当前用户最近一次同配置实际扣费；${evaluated.tier}；最终以本次实际扣费为准。`
      : `${evaluated.deferred ? "上游按 Token 结算，当前使用参考公式" : `按 ${evaluated.tier} 档计算`}；当前账号分组倍率 ${amount(groupRatio)}×；最终以实际扣费为准。`,
  };
}

export function scheduleAihubkitPriceHistoryRefresh() {
  scheduleHistoryRefresh();
}

export function clearAihubkitPricing() {
  clearAihubkitPricingCatalog();
  clearAihubkitPriceHistoryRuntime();
}
