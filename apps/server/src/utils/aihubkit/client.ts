export interface ApiEnvelope {
  success: boolean;
  message?: unknown;
  data?: unknown;
}

export class AihubkitServiceError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AihubkitServiceError";
    this.status = status;
  }
}

export const aihubkitApiBase = "https://apimodel.aihubkit.com";
const requestTimeout = 20_000;

export function readableAihubkitMessage(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value == null) return;
  if (typeof value === "string") {
    const message = value.trim();
    return message && message.length <= 300 ? message : undefined;
  }
  if (Array.isArray(value)) {
    const message = value.slice(0, 5).map(item => readableAihubkitMessage(item, depth + 1)).filter(Boolean).join("；");
    return message || undefined;
  }
  if (typeof value !== "object") return;
  const data = value as Record<string, unknown>;
  for (const key of ["message", "msg", "detail", "error_description", "error"]) {
    const message = readableAihubkitMessage(data[key], depth + 1);
    if (message) return message;
  }
}

function responseStatus(response: Response) {
  if (response.status === 401 || response.status === 403) return 401;
  if (response.status >= 400 && response.status < 500) return response.status;
  return 502;
}

export async function requestAihubkitJson(path: string, init: RequestInit = {}) {
  let response: Response;
  const timeout = AbortSignal.timeout(requestTimeout);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  try {
    response = await fetch(new URL(path, aihubkitApiBase), {
      ...init,
      headers,
      redirect: "error",
      signal,
    });
  } catch (cause) {
    if (init.signal?.aborted) throw init.signal.reason;
    if (timeout.aborted || cause instanceof DOMException && ["AbortError", "TimeoutError"].includes(cause.name)) {
      throw new AihubkitServiceError(504, "AIHubKit 服务请求超时，请稍后重试");
    }
    throw new AihubkitServiceError(503, "AIHubKit 服务网络不可用，请检查网络后重试");
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    if (!response.ok) throw new AihubkitServiceError(responseStatus(response), "AIHubKit 服务暂时不可用，请稍后重试");
    throw new AihubkitServiceError(502, "AIHubKit 服务返回异常，请稍后重试");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AihubkitServiceError(502, "AIHubKit 服务返回异常，请稍后重试");
  }
  if (!response.ok) {
    throw new AihubkitServiceError(
      responseStatus(response),
      readableAihubkitMessage(payload) ?? `AIHubKit 服务请求失败（HTTP ${response.status}）`,
    );
  }
  return { payload, response };
}

export async function requestAihubkitEnvelope(
  path: string,
  init: RequestInit = {},
  businessErrorStatus = 400,
) {
  const { payload, response } = await requestAihubkitJson(path, init);
  if (!payload || typeof payload !== "object" || typeof (payload as Partial<ApiEnvelope>).success !== "boolean") {
    throw new AihubkitServiceError(502, "AIHubKit 服务返回异常，请稍后重试");
  }
  const envelope = payload as ApiEnvelope;
  if (!envelope.success) {
    throw new AihubkitServiceError(
      businessErrorStatus,
      readableAihubkitMessage(envelope.message) ?? "AIHubKit 服务未完成请求，请检查输入后重试",
    );
  }
  return { envelope, response };
}
