const apiUrl = "https://apimodel.aihubkit.com";
const version = "0.3.0";
const rules = [] as const;
const maxReferenceImageSize = 100 * 1024 * 1024;
const imageExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function apiKeys(config: Record<string, unknown>) {
  return Object.entries(config)
    .filter(([name, value]) => /^apiKey\d+$/.test(name) && typeof value === "string" && value.trim())
    .sort(([left], [right]) => Number(left.slice(6)) - Number(right.slice(6)))
    .map(([, value]) => (value as string).trim().replace(/^Bearer\s+/i, "").trim());
}

function accountAccessToken(config: Record<string, unknown>) {
  const value = text(config.accountAccessToken).replace(/^Bearer\s+/i, "").trim();
  if (!value) throw new Error("登录授权已失效，请重新登录后再上传参考图");
  return value;
}

function normalizedImageMimeType(value: unknown) {
  const mimeType = text(value).split(";", 1)[0]!.toLowerCase();
  return mimeType.startsWith("image/") ? mimeType : "";
}

function imageMimeTypeFromUrl(value: string) {
  let pathname = value;
  try { pathname = new URL(value).pathname; }
  catch { return ""; }
  const extension = /\.([a-zA-Z0-9]+)$/.exec(pathname)?.[1]?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension && ["png", "webp", "gif", "bmp", "avif"].includes(extension)) return `image/${extension}`;
  return "";
}

function checkedImageBytes(data: Uint8Array) {
  if (!data.byteLength) throw new Error("参考图不能为空");
  if (data.byteLength > maxReferenceImageSize) throw new Error("单张参考图不能超过 100 MB");
  return data;
}

function decodeBase64Image(input: Extract<MediaInput, { type: "base64" }>) {
  const source = input.data.trim();
  const embedded = /^data:([^;,]+)(?:;[^,]*)?;base64,([\s\S]+)$/i.exec(source);
  if (source.startsWith("data:") && !embedded) throw new Error("参考图的 Data URL 无效");
  const encoded = (embedded?.[2] ?? source).replace(/\s/g, "");
  if (!encoded || encoded.length > Math.ceil(maxReferenceImageSize / 3) * 4 + 4
    || !/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new Error("参考图的 Base64 数据无效或超过 100 MB");
  }
  const mimeType = normalizedImageMimeType(input.mimeType) || normalizedImageMimeType(embedded?.[1]);
  if (!mimeType) throw new Error("参考图必须提供有效的图片类型");
  return { bytes: checkedImageBytes(new Uint8Array(Buffer.from(encoded, "base64"))), mimeType };
}

async function imageContent(context: ProviderContext, input: MediaInput, index: number) {
  let bytes: Uint8Array;
  let mimeType: string;
  if (input.type === "base64") ({ bytes, mimeType } = decodeBase64Image(input));
  else if (input.type === "binary") {
    bytes = checkedImageBytes(new Uint8Array(input.data));
    mimeType = normalizedImageMimeType(input.mimeType);
    if (!mimeType) throw new Error("参考图必须提供有效的图片类型");
  } else {
    let url: URL;
    try { url = new URL(input.url); }
    catch { throw new Error("参考图地址无效，只支持 HTTP 或 HTTPS 地址"); }
    if (!/^https?:$/.test(url.protocol)) throw new Error("参考图地址无效，只支持 HTTP 或 HTTPS 地址");
    const response = await context.tool.fetch(url, { signal: context.signal });
    if (!response.ok) throw new Error(`读取参考图失败（HTTP ${response.status}）`);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxReferenceImageSize) {
      await response.body?.cancel();
      throw new Error("单张参考图不能超过 100 MB");
    }
    bytes = checkedImageBytes(new Uint8Array(await response.arrayBuffer()));
    const responseMimeType = normalizedImageMimeType(response.headers.get("content-type"));
    mimeType = normalizedImageMimeType(input.mimeType) || responseMimeType || imageMimeTypeFromUrl(input.url);
    if (!mimeType) throw new Error("下载的参考素材不是可识别的图片");
  }
  const extension = imageExtensions[mimeType] ?? "img";
  return { bytes, mimeType, filename: `reference-${index + 1}.${extension}` };
}

async function imageUpload(context: ProviderContext, input: MediaInput, index: number) {
  const { bytes, mimeType, filename } = await imageContent(context, input, index);
  return { blob: new Blob([Uint8Array.from(bytes).buffer], { type: mimeType }), filename };
}

type ImageUploads = { images: Awaited<ReturnType<typeof imageUpload>>[]; mask?: Awaited<ReturnType<typeof imageUpload>> };

async function prepareImageUploads(context: ProviderContext, request: ImageRequest): Promise<ImageUploads> {
  const images = await Promise.all((request.images ?? []).map((input, index) => imageUpload(context, input, index)));
  const mask = request.mask ? await imageUpload(context, request.mask, images.length) : undefined;
  return { images, mask };
}

function httpsUrl(value: unknown, label: string) {
  const source = text(value);
  let url: URL;
  try { url = new URL(source); }
  catch { throw new Error(`AIHubKit 临时文件接口返回的${label}无效`); }
  if (url.protocol !== "https:") throw new Error(`AIHubKit 临时文件接口返回的${label}不是 HTTPS 地址`);
  return url.href;
}

function temporaryUploadHeaders(value: unknown, fallbackMimeType: string) {
  const headers = new Headers();
  for (const [name, headerValue] of Object.entries(object(value))) {
    if (!/^(?:content-type|content-md5|x-(?:amz|oss|cos|goog|ms)-[a-z0-9-]+)$/i.test(name) || typeof headerValue !== "string") continue;
    headers.set(name, headerValue);
  }
  if (!headers.has("Content-Type")) headers.set("Content-Type", fallbackMimeType);
  return headers;
}

async function uploadTemporaryImage(context: ProviderContext, input: MediaInput, index: number) {
  if (input.type === "url") {
    try {
      const url = new URL(input.url);
      if (url.protocol === "https:") return url.href;
    } catch {
      throw new Error("参考图地址无效，只支持 HTTP 或 HTTPS 地址");
    }
  }
  const { bytes, mimeType, filename } = await imageContent(context, input, index);
  const created = await fetchJson(context, accountAccessToken(context.config), "/v1/temporary-files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content_type: mimeType, size: bytes.byteLength }),
  });
  if (!created.response.ok || object(created.payload).success === false) {
    throw requestError(context, created.payload, created.response.status);
  }
  const data = object(object(created.payload).data);
  const uploadUrl = httpsUrl(data.upload_url, "上传地址");
  const publicUrl = httpsUrl(data.url, "访问地址");
  const headers = temporaryUploadHeaders(data.headers, normalizedImageMimeType(data.content_type) || mimeType);
  const uploaded = await context.tool.fetch(uploadUrl, {
    method: "PUT",
    headers,
    body: Uint8Array.from(bytes).buffer,
    signal: context.signal,
  });
  if (!uploaded.ok) throw new Error(`上传参考图失败（HTTP ${uploaded.status}）`);
  await uploaded.body?.cancel();
  return publicUrl;
}

function imageReferenceLimit(mode: VideoRequest["mode"]) {
  if (!Array.isArray(mode)) return 0;
  const value = mode.find(item => item.startsWith("imageReference:"))?.split(":")[1];
  const limit = Number(value);
  return Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 0;
}

async function prepareVideoReferenceImages(context: ProviderContext, request: VideoRequest) {
  const images = request.images ?? [];
  if (!images.length) return undefined;
  const limit = imageReferenceLimit(request.mode);
  if (!limit) throw new Error("当前模型没有声明参考图能力，请刷新模型或更换模型");
  if (images.length > limit) throw new Error(`当前模型最多支持 ${limit} 张参考图`);
  const urls: string[] = [];
  // ACT: 临时上传顺序执行，避免一次把多张 100 MB 图片同时保留在请求队列中。
  for (let index = 0; index < images.length; index++) {
    urls.push(await uploadTemporaryImage(context, images[index]!, index));
  }
  return urls;
}

function imageEditBody(request: ImageRequest, uploads: ImageUploads) {
  const body = new FormData();
  body.append("model", request.model);
  body.append("prompt", request.prompt.trim());
  if (request.size?.trim()) body.append("size", request.size.trim());
  for (const image of uploads.images) body.append("image", image.blob, image.filename);
  if (uploads.mask) body.append("mask", uploads.mask.blob, `mask.${uploads.mask.filename.split(".").pop()}`);
  return body;
}

function taskId(value: unknown) {
  const data = object(value);
  const nested = object(data.data);
  const task = object(nested.task);
  const id = text(data.task_id) || text(data.id) || text(nested.task_id) || text(nested.id) || text(task.id);
  return id && id.length <= 300 ? id : "";
}

function taskState(value: unknown) {
  const data = object(value);
  const nested = object(data.data);
  return (text(data.status) || text(data.state) || text(nested.status) || text(nested.state) || text(object(nested.task).status)).toLowerCase();
}

function outputAvailability(value: unknown) {
  const data = object(value);
  const nested = object(data.data);
  return (text(object(data.output).availability) || text(object(nested.output).availability)).toLowerCase();
}

function imageItems(value: unknown) {
  const data = object(value);
  const nested = object(data.data);
  const result = object(data.result);
  const nestedResult = object(nested.result);
  const output = object(data.output);
  const nestedOutput = object(nested.output);
  return [
    data.data, data.images, data.result, data.output,
    nested.data, nested.images, nested.result, nested.output,
    result.data, result.images, nestedResult.data, nestedResult.images,
    output.data, output.images, nestedOutput.data, nestedOutput.images,
  ].find(Array.isArray) as unknown[] | undefined;
}

function imageAssets(value: unknown): MediaAsset[] {
  const data = object(value);
  const candidates = imageItems(value) ?? [];
  const assets: MediaAsset[] = [];
  for (const candidate of candidates) {
    const item = object(candidate);
    const url = typeof candidate === "string" ? candidate.trim() : text(item.url) || text(item.image_url);
    const base64 = text(item.b64_json);
    if (/^https?:\/\//i.test(url)) assets.push({ mediaType: "image", type: "url", url });
    else {
      const embedded = /^data:(image\/[^;,]+);base64,([\s\S]+)$/i.exec(url);
      if (embedded) assets.push({ mediaType: "image", type: "base64", mimeType: embedded[1]!, data: embedded[2]! });
      else if (base64) assets.push({ mediaType: "image", type: "base64", mimeType: "image/png", data: base64 });
    }
  }
  const directUrl = text(data.url);
  const directBase64 = text(data.b64_json);
  if (!assets.length && /^https?:\/\//i.test(directUrl)) assets.push({ mediaType: "image", type: "url", url: directUrl });
  if (!assets.length && directBase64) assets.push({ mediaType: "image", type: "base64", mimeType: "image/png", data: directBase64 });
  return assets;
}

function videoAsset(value: unknown): MediaAsset | undefined {
  const data = object(value);
  const nested = object(data.data);
  const result = object(data.result);
  const nestedResult = object(nested.result);
  const output = object(data.output);
  const nestedOutput = object(nested.output);
  const url = [data.url, data.video_url, nested.url, nested.video_url, result.url, result.video_url,
    nestedResult.url, nestedResult.video_url, output.url, output.video_url, nestedOutput.url, nestedOutput.video_url]
    .map(text).find(value => /^https:\/\//i.test(value));
  return url ? { mediaType: "video", type: "url", url } : undefined;
}

function wait(signal: AbortSignal, milliseconds = 3000) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function fetchJson(context: ProviderContext, apiKey: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${apiKey}`);
  const response = await context.tool.fetch(`${apiUrl}${path}`, { ...init, headers, signal: context.signal });
  let payload: unknown;
  try { payload = await response.json(); }
  catch {
    if (!response.ok) return { response, payload: {} };
    throw new Error("AIHubKit 返回了无法识别的响应");
  }
  return { response, payload };
}

function requestError(context: ProviderContext, payload: unknown, status: number) {
  return new Error(context.tool.errorMessage(payload) || (status >= 400 ? `AIHubKit 请求失败（HTTP ${status}）` : "AIHubKit 未完成请求"));
}

function unavailableChannel(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:no\s+available\s+channel|无可用渠道|没有可用渠道|暂无可用渠道)/i.test(message);
}

async function resolveImageTask(context: ProviderContext, apiKey: string, created: { response: Response; payload: unknown }) {
  if (!created.response.ok) throw requestError(context, created.payload, created.response.status);
  const createdData = object(created.payload);
  const createdNested = object(createdData.data);
  if (createdData.success === false || createdNested.success === false
    || ["failed", "failure", "error", "cancelled", "canceled", "rejected"].includes(taskState(created.payload))) {
    throw requestError(context, created.payload, created.response.status);
  }
  const direct = imageAssets(created.payload);
  if (direct.length) return direct;
  const id = taskId(created.payload);
  if (!id) throw new Error("AIHubKit 已接收生图请求，但未返回任务编号");

  while (true) {
    await wait(context.signal!);
    const result = await fetchJson(context, apiKey, `/v1/images/generations/tasks/${encodeURIComponent(id)}`);
    if (!result.response.ok) throw requestError(context, result.payload, result.response.status);
    const assets = imageAssets(result.payload);
    if (assets.length) return assets;
    const state = taskState(result.payload);
    if (["failed", "failure", "error", "cancelled", "canceled", "rejected"].includes(state)) {
      throw new Error(context.tool.errorMessage(result.payload) || "AIHubKit 图片任务执行失败");
    }
    if (["completed", "succeeded", "success"].includes(state)) {
      // ACT: AIHubKit 会先把任务标记成功，再异步归档图片；归档完成前继续轮询。
      if (outputAvailability(result.payload) === "archiving") continue;
      throw new Error("AIHubKit 图片任务已完成，但没有返回图片");
    }
  }
}

async function createImage(context: ProviderContext, apiKey: string, body: Record<string, unknown>) {
  const created = await fetchJson(context, apiKey, "/v1/images/generations/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (created.response.status === 404 || created.response.status === 405) {
    const synchronous = await fetchJson(context, apiKey, "/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!synchronous.response.ok) throw requestError(context, synchronous.payload, synchronous.response.status);
    const assets = imageAssets(synchronous.payload);
    if (!assets.length) throw new Error("AIHubKit 同步生图未返回图片");
    return assets;
  }
  return resolveImageTask(context, apiKey, created);
}

async function createImageEdit(context: ProviderContext, apiKey: string, request: ImageRequest, uploads: ImageUploads) {
  const created = await fetchJson(context, apiKey, "/v1/images/edits/tasks", {
    method: "POST",
    body: imageEditBody(request, uploads),
  });
  if (created.response.status === 404 || created.response.status === 405) {
    const synchronous = await fetchJson(context, apiKey, "/v1/images/edits", {
      method: "POST",
      body: imageEditBody(request, uploads),
    });
    if (!synchronous.response.ok) throw requestError(context, synchronous.payload, synchronous.response.status);
    const assets = imageAssets(synchronous.payload);
    if (!assets.length) throw new Error("AIHubKit 同步图生图未返回图片");
    return assets;
  }
  return resolveImageTask(context, apiKey, created);
}

async function createVideo(context: ProviderContext, apiKey: string, body: Record<string, unknown>) {
  const created = await fetchJson(context, apiKey, "/v1/videos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!created.response.ok) throw requestError(context, created.payload, created.response.status);
  if (["failed", "failure", "error", "cancelled", "canceled", "rejected"].includes(taskState(created.payload))) {
    throw requestError(context, created.payload, created.response.status);
  }
  const direct = videoAsset(created.payload);
  if (direct) return [direct];
  const id = taskId(created.payload);
  if (!id) throw new Error("AIHubKit 已接收生视频请求，但未返回任务编号");

  while (true) {
    await wait(context.signal!, 5000);
    const result = await fetchJson(context, apiKey, `/v1/videos/${encodeURIComponent(id)}`);
    if (!result.response.ok) throw requestError(context, result.payload, result.response.status);
    const asset = videoAsset(result.payload);
    if (asset) return [asset];
    const state = taskState(result.payload);
    if (["failed", "failure", "error", "cancelled", "canceled", "rejected"].includes(state)) {
      throw new Error(context.tool.errorMessage(result.payload) || "AIHubKit 视频任务执行失败");
    }
    if (["completed", "succeeded", "success"].includes(state)) throw new Error("AIHubKit 视频任务已完成，但没有返回视频");
  }
}

export default {
  id: "aiHubKit" as const,
  label: "账号模型",
  version,
  apiUrl,
  readme: "由山竹账号自动同步可用分组和模型，无需手工填写 API Key。",
  rules,
  models: [] satisfies ProviderModel[],
  async generateImage(this: ProviderContext, request: ImageRequest): Promise<MediaAsset[]> {
    if (!request.prompt.trim()) throw new Error("请输入图片生成提示词");
    if (request.mask && !request.images?.length) throw new Error("遮罩必须和至少一张参考图一起使用");
    const keys = apiKeys(this.config);
    if (!keys.length) throw new Error("没有找到当前模型的 AIHubKit 授权，请刷新模型后重试");
    const signal = AbortSignal.any([AbortSignal.timeout(30 * 60_000), ...(this.signal ? [this.signal] : [])]);
    const context = { ...this, signal };
    const body = {
      model: request.model,
      prompt: request.prompt.trim(),
      n: Math.max(1, Math.min(7, Math.floor(request.n ?? 1))),
      ...(request.size?.trim() ? { size: request.size.trim() } : {}),
    };
    const uploads = request.images?.length ? await prepareImageUploads(context, request) : undefined;
    let lastError: unknown;
    for (const key of keys) {
      try { return uploads ? await createImageEdit(context, key, request, uploads) : await createImage(context, key, body); }
      catch (error) {
        lastError = error;
        if (!unavailableChannel(error)) throw error;
      }
    }
    throw lastError ?? new Error("当前模型暂时没有可用图片线路");
  },
  async generateVideo(this: ProviderContext, request: VideoRequest): Promise<MediaAsset[]> {
    if (!request.prompt.trim()) throw new Error("请输入视频生成提示词");
    if (request.videos?.length) throw new Error("当前版本暂不支持参考视频，请先只使用图片参考");
    if (request.audios?.length) throw new Error("当前版本暂不支持参考音频，请先只使用图片参考");
    if (request.firstFrame || request.lastFrame) throw new Error("当前版本暂不支持首尾帧，请改用普通图片参考");
    if (!Number.isInteger(request.duration) || request.duration! <= 0) throw new Error("请选择视频时长");
    const resolution = request.resolution?.trim();
    if (!resolution) throw new Error("请选择视频分辨率");
    const keys = apiKeys(this.config);
    if (!keys.length) throw new Error("没有找到当前模型的 AIHubKit 授权，请刷新模型后重试");
    const signal = AbortSignal.any([AbortSignal.timeout(30 * 60_000), ...(this.signal ? [this.signal] : [])]);
    const context = { ...this, signal };
    const referenceImages = await prepareVideoReferenceImages(context, request);
    const body = {
      model: request.model,
      prompt: request.prompt.trim(),
      duration: request.duration,
      resolution,
      ...(request.ratio?.trim() ? { ratio: request.ratio.trim() } : {}),
      ...(referenceImages ? { referenceImages } : {}),
    };
    let lastError: unknown;
    for (const key of keys) {
      try { return await createVideo(context, key, body); }
      catch (error) {
        lastError = error;
        if (!unavailableChannel(error)) throw error;
      }
    }
    throw lastError ?? new Error("当前模型暂时没有可用视频线路");
  },
} satisfies ProviderDefinition<typeof rules>;
