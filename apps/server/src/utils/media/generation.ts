import { t, translateMessage } from "@/lib/i18n";
import { mkdir, readFile, realpath, stat, unlink } from "@toonflow/file";
import { join, relative } from "node:path";
import { aiHubKit, type Provider } from "@toonflow/providers";
import type { GeneratedMedia, MediaGenerationRequest, MediaModel, MediaReference } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { getMediaProvider, listMediaProviders, loadMediaProviderDefinition, loadMediaProviderSource } from "@/utils/media/provider";
import { getAihubkitCatalog, getAihubkitModelCandidate } from "@/utils/aihubkit/catalog";
import { estimateAihubkitMediaPrice, scheduleAihubkitPriceHistoryRefresh } from "@/utils/aihubkit/pricing";
import { lockWorkspaceFiles, resolveWorkspacePath, writeWorkspaceFile } from "@/utils/workspace/files";
import { beginGeneration, getProviderPrice } from "@/utils/media/billing";
import { detectMimeType, readPriceReference } from "@/utils/media/priceReference";

const maxMediaSize = 100 * 1024 * 1024;
const mediaExtensions: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "image/avif": "avif", "image/bmp": "bmp", "image/tiff": "tiff",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/ogg": "ogv",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm",
  "audio/flac": "flac", "audio/aac": "aac", "audio/mp4": "m4a", "audio/opus": "opus", "audio/pcm": "pcm",
};

function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function seconds(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_value, index) => from + index);
}

function aihubkitVideoCapabilities(modelId: string): Pick<MediaModel, "mode" | "durationResolutionMap" | "audio"> {
  const id = modelId.toLowerCase();
  if (/(?:seedance[-_. ]?2[._-]?5|^sd-2\.5)/i.test(id)) {
    return { mode: ["text"], durationResolutionMap: [{ duration: seconds(4, 30), resolution: ["480p", "720p", "1080p"] }], audio: "optional" };
  }
  if (/(?:seedance[-_. ]?2[._-]?0|^sd-(?:2\.0|fast|mini))/i.test(id)) {
    const limited = /(?:fast|mini)/i.test(id);
    return { mode: ["text"], durationResolutionMap: [{ duration: seconds(4, 15), resolution: limited ? ["480p", "720p"] : ["480p", "720p", "1080p", "4k"] }], audio: "optional" };
  }
  if (/kling/i.test(id)) {
    return { mode: ["text"], durationResolutionMap: [{ duration: seconds(3, 15), resolution: ["720p", "1080p", "4k"] }] };
  }
  if (/minimax[-_. ]?h3/i.test(id)) {
    return { mode: ["text"], durationResolutionMap: [{ duration: seconds(4, 15), resolution: ["768p", "2k"] }] };
  }
  if (/wan[-_. ]?3/i.test(id)) {
    return { mode: ["text"], durationResolutionMap: [{ duration: seconds(2, 30), resolution: ["480p", "720p", "1080p"] }] };
  }
  return { mode: ["text"], durationResolutionMap: [{ duration: [5], resolution: ["720p"] }] };
}

export async function listMediaModels(): Promise<MediaModel[]> {
  const installedProviders = await listMediaProviders();
  const installed = installedProviders.flatMap(provider => provider.models.flatMap(model => {
    // ACT: 图片和视频由当前登录账户的 AIHubKit 目录唯一提供；旧供应商只保留音频兼容。
    if (model.type !== "audio") return [];
    return [{
      providerId: provider.id, providerLabel: provider.label, modelId: model.id, label: model.label, type: model.type,
      supportsPrice: "supportsPrice" in provider && provider.supportsPrice === true,
      mode: model.mode, durationResolutionMap: model.durationResolutionMap, audio: model.audio,
      voices: model.voices,
    } as MediaModel];
  }));
  const catalog = await getAihubkitCatalog();
  const dynamic = catalog.groups.flatMap(group => catalog.models.flatMap(model => {
    const relation = model.groups.find(item => item.id === group.id);
    if ((model.type !== "image" && model.type !== "video") || !relation) return [];
    const common = {
      providerId: aiHubKit.id,
      providerLabel: aiHubKit.label,
      groupId: group.id,
      groupLabel: group.label,
      groupRatio: relation.ratio,
      modelId: model.id,
      label: model.label,
      type: model.type,
      supportsPrice: Boolean(relation.price),
      priceLabel: relation.price?.label,
      priceTips: relation.price?.tips,
    } satisfies Pick<MediaModel, "providerId" | "providerLabel" | "groupId" | "groupLabel" | "groupRatio" | "modelId" | "label" | "type" | "supportsPrice" | "priceLabel" | "priceTips">;
    return [model.type === "image" ? {
      ...common,
      mode: ["text", "singleImage", "multiReference"],
      imageSizes: ["1024x1024"],
      imageRatios: ["1:1"],
    } : { ...common, ...aihubkitVideoCapabilities(model.id) }];
  }));
  return [...dynamic, ...installed.filter(model => model.providerId !== aiHubKit.id)];
}

export async function readReference(cwd: string, reference: MediaReference, mediaType: string, signal?: AbortSignal): Promise<Extract<MediaInput, { type: "base64" }>> {
  signal?.throwIfAborted();
  const { path } = await resolveWorkspacePath(cwd, reference.path);
  const info = await stat(path);
  if (!info.isFile() || info.size > maxMediaSize) invalid("参考媒体须为不超过 100 MB 的文件");
  const bytes = await readFile(path, { signal });
  if (!bytes.length || bytes.length > maxMediaSize) invalid("参考媒体为空或超过 100 MB");
  const mimeType = detectMimeType(bytes, reference.mimeType);
  if (!mimeType.startsWith(`${mediaType}/`)) invalid(t`参考媒体类型须为 ${mediaType}`);
  return { type: "base64", data: bytes.toString("base64"), mimeType, name: reference.path };
}

async function downloadAsset(url: string, signal?: AbortSignal) {
  if (!/^https?:\/\//i.test(url)) invalid("生成结果必须使用 HTTP 或 HTTPS 地址");
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(t`下载生成结果失败（HTTP ${response.status}）`);
  if (Number(response.headers.get("content-length")) > maxMediaSize) {
    await response.body?.cancel();
    invalid("生成文件不能超过 100 MB");
  }
  const reader = response.body?.getReader();
  if (!reader) invalid("生成结果为空");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxMediaSize) invalid("生成文件不能超过 100 MB");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return { bytes: Buffer.concat(chunks, size), mimeType: response.headers.get("content-type") ?? "" };
}

async function assetBytes(asset: MediaAsset, mediaType: "image" | "video" | "audio", signal?: AbortSignal) {
  if (!asset || asset.mediaType !== mediaType) invalid("供应商返回的媒体类型不正确");
  let bytes: Uint8Array;
  let mimeType = asset.mimeType ?? "";
  if (asset.type === "url") {
    const result = await downloadAsset(asset.url, signal);
    bytes = result.bytes;
    const responseMimeType = result.mimeType.split(";")[0].trim().toLowerCase();
    mimeType = responseMimeType && responseMimeType !== "application/octet-stream" ? result.mimeType : mimeType;
  } else if (asset.type === "base64") {
    const data = /^data:([^;,]+);base64,([\s\S]+)$/.exec(asset.data);
    const content = (data?.[2] ?? asset.data).replace(/\s/g, "");
    if (content.length > Math.ceil(maxMediaSize / 3) * 4 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(content) || content.length % 4 === 1) invalid("生成结果的 base64 内容无效或超过 100 MB");
    bytes = Buffer.from(content, "base64");
    mimeType = data?.[1] ?? mimeType;
  } else if (asset.type === "binary" && ArrayBuffer.isView(asset.data) && asset.data.BYTES_PER_ELEMENT === 1) {
    bytes = asset.data;
  } else { return invalid("供应商返回了无效的媒体结果"); }
  if (!bytes.byteLength || bytes.byteLength > maxMediaSize) invalid("生成文件为空或超过 100 MB");
  mimeType = detectMimeType(bytes, mimeType);
  if (!mimeType.startsWith(`${mediaType}/`) || !mediaExtensions[mimeType]) invalid("生成结果不是支持的图片、视频或音频格式");
  return { bytes, mimeType };
}

async function prepareRequest<T>(directory: string | undefined, mediaType: "image" | "video" | "audio", request: MediaGenerationRequest,
  read: (cwd: string, reference: MediaReference, type: string, signal?: AbortSignal) => Promise<T>, signal?: AbortSignal) {
  const references = async (items: MediaReference[] | undefined, type: string) => {
    if (!items?.length) return items ? [] : undefined;
    if (!directory) invalid("参考媒体需要工作目录");
    // ACT: 单次请求顺序处理引用，避免数十个参考媒体同时启动探测进程。
    const result: T[] = [];
    for (const item of items) result.push(await read(directory, item, type, signal));
    return result;
  };
  const images = await references(request.images, "image");
  if (mediaType === "audio") return {
    type: "audio" as const, model: request.modelId, text: request.prompt, images, audios: await references(request.audios, "audio"),
    voice: request.voice, speed: request.speed, volume: request.volume, pitch: request.pitch, language: request.language, format: request.format, sampleRate: request.sampleRate,
  };
  if (mediaType === "image") return { type: "image" as const, model: request.modelId, prompt: request.prompt, images, ratio: request.ratio, size: request.size };
  return {
    type: "video" as const, model: request.modelId, prompt: request.prompt, images,
    videos: await references(request.videos, "video"), audios: await references(request.audios, "audio"),
    firstFrame: (await references(request.firstFrame ? [request.firstFrame] : undefined, "image"))?.[0],
    lastFrame: (await references(request.lastFrame ? [request.lastFrame] : undefined, "image"))?.[0],
    ratio: request.ratio, resolution: request.resolution, duration: request.duration, generateAudio: request.generateAudio, mode: request.mode,
  };
}

async function configuredProvider(request: MediaGenerationRequest, mediaType: "image" | "video" | "audio", signal?: AbortSignal, directory?: string) {
  if (request.providerId === aiHubKit.id) {
    if (mediaType === "audio") invalid("当前 AIHubKit 目录没有音频模型");
    const groupId = request.groupId?.trim();
    if (!groupId) invalid("这个节点的模型已失效，请重新选择模型");
    const candidate = await getAihubkitModelCandidate(request.modelId, mediaType, groupId);
    if (!candidate) invalid("这个节点的模型已失效，请重新选择模型");
    const config = { apiKey1: candidate.apiKey };
    return loadMediaProviderDefinition(aiHubKit as Provider, config, signal, fetch, directory);
  }
  const info = await getMediaProvider(request.providerId);
  if (!info.models.some(model => model.id === request.modelId && model.type === mediaType)) invalid("所选媒体模型不存在或类型不匹配，请重新选择");
  const configurations = record(conf.get("settings", {}).mediaProviderConfigs);
  return loadMediaProviderSource(info.source, record(configurations[info.id]), signal, undefined, directory);
}

async function preparePriceRequest(directory: string | undefined, mediaType: "image" | "video" | "audio", request: MediaGenerationRequest, signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(5000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try { return await prepareRequest(directory, mediaType, request, readPriceReference, combined); }
  catch (error) {
    signal?.throwIfAborted();
    if (deadline.aborted) throw new Error("读取参考媒体信息超时，请稍后重试");
    throw error;
  }
}

export async function getMediaPrice(directory: string | undefined, mediaType: "image" | "video" | "audio", request: MediaGenerationRequest, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (request.providerId === aiHubKit.id) {
    if (mediaType === "audio") invalid("当前 AIHubKit 目录没有音频模型");
    const groupId = request.groupId?.trim();
    if (!groupId || !await getAihubkitModelCandidate(request.modelId, mediaType, groupId)) invalid("这个节点的模型已失效，请重新选择模型");
    const prepared = await preparePriceRequest(directory, mediaType, request, signal);
    signal?.throwIfAborted();
    return estimateAihubkitMediaPrice(request.modelId, groupId, prepared);
  }
  const provider = await configuredProvider(request, mediaType, signal, directory);
  if (!provider.getPrice) return null;
  const prepared = await preparePriceRequest(directory, mediaType, request, signal);
  signal?.throwIfAborted();
  return getProviderPrice(provider, prepared);
}

export async function generateMedia(
  cwd: string,
  mediaType: "image" | "video" | "audio",
  request: MediaGenerationRequest,
  signal?: AbortSignal,
): Promise<GeneratedMedia[]> {
  signal?.throwIfAborted();
  if (!request.prompt.trim()) invalid("请输入生成提示词");
  const directory = await realpath(cwd);
  const outputDirectory = request.outputDirectory ?? "assets/generated";
  await resolveWorkspacePath(directory, outputDirectory, true);
  const provider = await configuredProvider(request, mediaType, signal, directory);
  const generate = mediaType === "image" ? provider.generateImage : mediaType === "video" ? provider.generateVideo : provider.generateAudio;
  if (typeof generate !== "function") invalid(t`此供应商不支持${translateMessage({ image: "图片", video: "视频", audio: "音频" }[mediaType])}生成`);
  const rules = Array.isArray(provider.rules) ? provider.rules : [];
  if (rules.some(rule => rule.field === "apiKey") && (typeof provider.config.apiKey !== "string" || !provider.config.apiKey.trim())) invalid("请先在媒体模型设置中配置供应商 API Key");
  const prepared = await prepareRequest(directory, mediaType, request, readReference, signal);
  signal?.throwIfAborted();
  const finish = beginGeneration(provider);
  const written: string[] = [];
  const result: GeneratedMedia[] = [];
  try {
    signal?.throwIfAborted();
    const { type, ...parameters } = prepared;
    const assets = type === "audio" ? await provider.generateAudio!(parameters as AudioRequest)
      : type === "image" ? await provider.generateImage!(parameters as ImageRequest) : await provider.generateVideo!(parameters as VideoRequest);
    if (!Array.isArray(assets) || !assets.length) invalid("供应商未返回生成结果");
    for (const asset of assets) {
      signal?.throwIfAborted();
      const { bytes, mimeType } = await assetBytes(asset, mediaType, signal);
      signal?.throwIfAborted();
      const output = await resolveWorkspacePath(directory, outputDirectory, true);
      const release = lockWorkspaceFiles([output.path]);
      try {
        await mkdir(output.path, { recursive: true });
        const file = join(outputDirectory, `${mediaType}${crypto.randomUUID()}.${mediaExtensions[mimeType]}`);
        const { path } = await resolveWorkspacePath(directory, file);
        signal?.throwIfAborted();
        await writeWorkspaceFile(path, bytes, true);
        written.push(path);
        result.push({ path: relative(directory, path).replace(/\\/g, "/"), mimeType, mediaType });
      } finally { release(); }
    }
    signal?.throwIfAborted();
    return result;
  } catch (err) {
    // ACT: 只回滚本次创建的文件，保留目录中已有的节点资源。
    await Promise.all(written.map(path => unlink(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; })));
    throw err;
  } finally {
    finish();
    if (request.providerId === aiHubKit.id) scheduleAihubkitPriceHistoryRefresh();
  }
}
