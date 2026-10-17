import { getAihubkitAccess } from "@/utils/aihubkit/account";
import { AihubkitServiceError, requestAihubkitEnvelope } from "@/utils/aihubkit/client";
import type { AihubkitRawPricingModel } from "@/utils/aihubkit/pricingCatalog";
import {
  emptyAihubkitPricingDimensions,
  type AihubkitPricingDimensions,
} from "@/utils/aihubkit/pricingExpression";
import conf from "@/utils/conf";

export interface AihubkitPriceSample {
  modelId: string;
  groupId: string;
  amount: number;
  createdAt: number;
  tier: string;
  dimensions: AihubkitPricingDimensions;
}

interface StoredUserHistory {
  updatedAt: number;
  samples: AihubkitPriceSample[];
}

type StoredHistory = Record<string, StoredUserHistory>;

const quotaPerUnit = 500_000;
const historyMaxAge = 10 * 60_000;
const scheduledRefreshDelay = 5_000;
const maxSamplesPerUser = 500;
let historyRequest: Promise<void> | undefined;
let scheduledRefresh: ReturnType<typeof setTimeout> | undefined;
let latestModels: ReadonlyMap<string, AihubkitRawPricingModel> | undefined;

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown, maxLength = 256) {
  if (typeof value !== "string") return "";
  const result = value.trim();
  return result && result.length <= maxLength ? result : "";
}

function nonnegative(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1_000_000 ? number : fallback;
}

function dimensions(value: unknown) {
  const data = object(value);
  if (!data) return;
  const recognized = [
    "resolution_tier",
    "seconds",
    "units",
    "input_image_count",
    "input_video_count",
    "input_video_seconds",
    "input_audio_count",
    "input_audio_seconds",
    "reference_image_count",
    "reference_video_count",
    "reference_audio_count",
  ];
  if (!recognized.some(key => Object.hasOwn(data, key))) return;
  return {
    ...emptyAihubkitPricingDimensions,
    resolutionTier: text(data.resolution_tier, 100),
    seconds: nonnegative(data.seconds),
    units: nonnegative(data.units, 1),
    inputImageCount: nonnegative(data.input_image_count),
    inputVideoCount: nonnegative(data.input_video_count),
    inputVideoSeconds: nonnegative(data.input_video_seconds),
    inputAudioCount: nonnegative(data.input_audio_count),
    inputAudioSeconds: nonnegative(data.input_audio_seconds),
    referenceImageCount: nonnegative(data.reference_image_count),
    referenceVideoCount: nonnegative(data.reference_video_count),
    referenceAudioCount: nonnegative(data.reference_audio_count),
  } satisfies AihubkitPricingDimensions;
}

function storedDimensions(value: unknown) {
  const data = object(value);
  if (!data) return;
  return {
    resolutionTier: text(data.resolutionTier, 100),
    seconds: nonnegative(data.seconds),
    units: nonnegative(data.units, 1),
    inputImageCount: nonnegative(data.inputImageCount),
    inputVideoCount: nonnegative(data.inputVideoCount),
    inputVideoSeconds: nonnegative(data.inputVideoSeconds),
    inputAudioCount: nonnegative(data.inputAudioCount),
    inputAudioSeconds: nonnegative(data.inputAudioSeconds),
    referenceImageCount: nonnegative(data.referenceImageCount),
    referenceVideoCount: nonnegative(data.referenceVideoCount),
    referenceAudioCount: nonnegative(data.referenceAudioCount),
  } satisfies AihubkitPricingDimensions;
}

function dimensionSignature(value: AihubkitPricingDimensions) {
  return JSON.stringify([
    value.resolutionTier,
    value.seconds,
    value.units,
    value.inputImageCount,
    value.inputVideoCount,
    value.inputVideoSeconds,
    value.inputAudioCount,
    value.inputAudioSeconds,
    value.referenceImageCount,
    value.referenceVideoCount,
    value.referenceAudioCount,
  ]);
}

function sampleKey(sample: AihubkitPriceSample) {
  return JSON.stringify([sample.modelId, sample.groupId, dimensionSignature(sample.dimensions)]);
}

function storedSample(value: unknown) {
  const data = object(value);
  const modelId = text(data?.modelId);
  const groupId = text(data?.groupId, 200);
  const amount = Number(data?.amount);
  const createdAt = Number(data?.createdAt);
  const sampleDimensions = storedDimensions(data?.dimensions);
  if (!modelId || !groupId || !Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(createdAt) || createdAt <= 0 || !sampleDimensions) return;
  return {
    modelId,
    groupId,
    amount,
    createdAt,
    tier: text(data?.tier, 200),
    dimensions: sampleDimensions,
  } satisfies AihubkitPriceSample;
}

function storedHistory(value = conf.get("aihubkitPricingHistory")): StoredHistory {
  const data = object(value);
  if (!data) return {};
  return Object.fromEntries(Object.entries(data).flatMap(([userId, raw]) => {
    if (!/^\d+$/.test(userId)) return [];
    const user = object(raw);
    const updatedAt = Number(user?.updatedAt);
    const samples = Array.isArray(user?.samples) ? user.samples.flatMap(item => {
      const sample = storedSample(item);
      return sample ? [sample] : [];
    }).sort((left, right) => right.createdAt - left.createdAt).slice(0, maxSamplesPerUser) : [];
    if (!Number.isSafeInteger(updatedAt) || updatedAt <= 0) return [];
    return [[userId, { updatedAt, samples } satisfies StoredUserHistory]];
  }).slice(0, 100));
}

function parseOther(value: unknown) {
  if (object(value)) return object(value);
  if (typeof value !== "string" || value.length > 50_000) return;
  try {
    return object(JSON.parse(value));
  } catch {
    return;
  }
}

function createdAt(value: unknown) {
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return;
  const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}

function logSample(value: unknown, userId: number, models: ReadonlyMap<string, AihubkitRawPricingModel>) {
  const data = object(value);
  const modelId = text(data?.model_name);
  const groupId = text(data?.group, 200);
  const model = models.get(modelId);
  if (!data || Number(data.user_id) !== userId || !model?.mediaType || !groupId || !model.groups.includes(groupId)) return;
  const quota = Number(data.quota);
  const timestamp = createdAt(data.created_at);
  const other = parseOther(data.other);
  const sampleDimensions = dimensions(other?.actual_billing_dimensions) ?? dimensions(other?.estimated_billing_dimensions);
  if (!Number.isFinite(quota) || quota < 0 || !timestamp || !sampleDimensions) return;
  const amount = quota / quotaPerUnit;
  if (!Number.isFinite(amount) || amount < 0) return;
  return {
    modelId,
    groupId,
    amount,
    createdAt: timestamp,
    tier: text(other?.matched_tier, 200),
    dimensions: sampleDimensions,
  } satisfies AihubkitPriceSample;
}

async function synchronizeHistory(models: ReadonlyMap<string, AihubkitRawPricingModel>, force: boolean) {
  const access = await getAihubkitAccess();
  const history = storedHistory();
  const userKey = String(access.userId);
  if (!force && history[userKey] && Date.now() - history[userKey].updatedAt < historyMaxAge) return;
  const { envelope } = await requestAihubkitEnvelope("/api/log/self?p=1&page_size=100", {
    headers: {
      Authorization: `Bearer ${access.accessToken}`,
      "New-Api-User": String(access.userId),
    },
  }, 401);
  const data = object(envelope.data);
  if (!Array.isArray(data?.items)) throw new AihubkitServiceError(502, "AIHubKit 使用记录响应格式不正确");
  const currentSamples = data.items.flatMap(item => {
    const sample = logSample(item, access.userId, models);
    return sample ? [sample] : [];
  });
  const merged = new Map<string, AihubkitPriceSample>();
  for (const sample of [...currentSamples, ...(history[userKey]?.samples ?? [])].sort((left, right) => right.createdAt - left.createdAt)) {
    const key = sampleKey(sample);
    if (!merged.has(key)) merged.set(key, sample);
  }
  history[userKey] = {
    updatedAt: Date.now(),
    samples: [...merged.values()].slice(0, maxSamplesPerUser),
  };
  conf.set("aihubkitPricingHistory", history);
}

export function refreshAihubkitPriceHistory(models: ReadonlyMap<string, AihubkitRawPricingModel>, force = false) {
  latestModels = models;
  if (historyRequest) return historyRequest;
  const request = synchronizeHistory(models, force);
  const tracked = request.finally(() => {
    if (historyRequest === tracked) historyRequest = undefined;
  });
  historyRequest = tracked;
  return tracked;
}

export function getAihubkitPriceSample(userId: number, modelId: string, groupId: string, sampleDimensions: AihubkitPricingDimensions) {
  const signature = dimensionSignature(sampleDimensions);
  return storedHistory()[String(userId)]?.samples.find(sample => sample.modelId === modelId
    && sample.groupId === groupId
    && dimensionSignature(sample.dimensions) === signature);
}

export function getLatestAihubkitPriceSample(userId: number, modelId: string, groupId: string) {
  return storedHistory()[String(userId)]?.samples.find(sample => sample.modelId === modelId && sample.groupId === groupId);
}

export function scheduleAihubkitPriceHistoryRefresh() {
  if (!latestModels) return;
  if (scheduledRefresh) clearTimeout(scheduledRefresh);
  scheduledRefresh = setTimeout(() => {
    scheduledRefresh = undefined;
    if (latestModels) void refreshAihubkitPriceHistory(latestModels, true).catch(() => undefined);
  }, scheduledRefreshDelay);
  scheduledRefresh.unref();
}

export function clearAihubkitPriceHistoryRuntime() {
  latestModels = undefined;
  if (scheduledRefresh) clearTimeout(scheduledRefresh);
  scheduledRefresh = undefined;
}
