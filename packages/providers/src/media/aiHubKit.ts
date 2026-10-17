const apiUrl = "https://apimodel.aihubkit.com";
const version = "0.1.0";
const rules = [] as const;

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

function imageItems(value: unknown) {
  const data = object(value);
  const nested = object(data.data);
  const result = object(data.result);
  const nestedResult = object(nested.result);
  return [
    data.data, data.images, data.result, data.output,
    nested.data, nested.images, nested.result, nested.output,
    result.data, result.images, nestedResult.data, nestedResult.images,
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
    if (!response.ok) throw new Error(`AIHubKit 请求失败（HTTP ${response.status}）`);
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
    if (["completed", "succeeded", "success"].includes(state)) throw new Error("AIHubKit 图片任务已完成，但没有返回图片");
  }
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
  label: "AIHubKit",
  version,
  apiUrl,
  readme: "由山竹账号自动同步可用分组和模型，无需手工填写 API Key。",
  rules,
  models: [] satisfies ProviderModel[],
  async generateImage(this: ProviderContext, request: ImageRequest): Promise<MediaAsset[]> {
    if (!request.prompt.trim()) throw new Error("请输入图片生成提示词");
    if (request.images?.length) throw new Error("当前版本先支持文生图，图生图将在下一批接入");
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
    let lastError: unknown;
    for (const key of keys) {
      try { return await createImage(context, key, body); }
      catch (error) {
        lastError = error;
        if (!unavailableChannel(error)) throw error;
      }
    }
    throw lastError ?? new Error("当前模型暂时没有可用图片线路");
  },
  async generateVideo(this: ProviderContext, request: VideoRequest): Promise<MediaAsset[]> {
    if (!request.prompt.trim()) throw new Error("请输入视频生成提示词");
    if (request.images?.length || request.videos?.length || request.audios?.length || request.firstFrame || request.lastFrame) {
      throw new Error("AIHubKit 参考素材需要先上传为临时公网地址，当前版本先支持文生视频");
    }
    if (!Number.isInteger(request.duration) || request.duration! <= 0) throw new Error("请选择视频时长");
    const resolution = request.resolution?.trim();
    if (!resolution) throw new Error("请选择视频分辨率");
    const keys = apiKeys(this.config);
    if (!keys.length) throw new Error("没有找到当前模型的 AIHubKit 授权，请刷新模型后重试");
    const signal = AbortSignal.any([AbortSignal.timeout(30 * 60_000), ...(this.signal ? [this.signal] : [])]);
    const context = { ...this, signal };
    const body = {
      model: request.model,
      prompt: request.prompt.trim(),
      duration: request.duration,
      resolution,
      ...(request.ratio?.trim() ? { ratio: request.ratio.trim() } : {}),
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
