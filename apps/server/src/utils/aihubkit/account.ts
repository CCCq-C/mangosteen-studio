import { secrets } from "bun";

export interface PublicAccount {
  id: number;
  displayName: string;
}

export interface RegistrationInput {
  username: string;
  password: string;
  email: string;
  code: string;
}

interface StoredSession {
  userId: number;
  displayName: string;
  sessionCookie: string;
  accessToken: string;
}

interface ApiEnvelope {
  success: boolean;
  message?: unknown;
  data?: unknown;
}

export class AccountServiceError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AccountServiceError";
    this.status = status;
  }
}

const apiBase = "https://apimodel.aihubkit.com";
const keychainService = "com.mangosteen.studio";
const keychainName = "aihubkitSession";
const requestTimeout = 20_000;
const affiliateCode = "DlQa";

function readableMessage(value: unknown) {
  if (typeof value !== "string") return;
  const message = value.trim();
  return message && message.length <= 300 ? message : undefined;
}

function statusFor(response: Response) {
  if (response.status === 401 || response.status === 403) return 401;
  if (response.status >= 400 && response.status < 500) return response.status;
  return 502;
}

async function requestJson(
  path: string,
  init: RequestInit = {},
  businessErrorStatus = 400,
) {
  let response: Response;
  try {
    response = await fetch(new URL(path, apiBase), {
      ...init,
      headers: {
        Accept: "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(requestTimeout),
    });
  } catch (cause) {
    if (cause instanceof DOMException && ["AbortError", "TimeoutError"].includes(cause.name)) {
      throw new AccountServiceError(504, "账户服务请求超时，请稍后重试");
    }
    throw new AccountServiceError(503, "账户服务网络不可用，请检查网络后重试");
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    if (!response.ok) {
      throw new AccountServiceError(statusFor(response), "账户服务暂时不可用，请稍后重试");
    }
    throw new AccountServiceError(502, "账户服务返回异常，请稍后重试");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AccountServiceError(502, "账户服务返回异常，请稍后重试");
  }
  if (!payload || typeof payload !== "object" || typeof (payload as Partial<ApiEnvelope>).success !== "boolean") {
    throw new AccountServiceError(502, "账户服务返回异常，请稍后重试");
  }

  const envelope = payload as ApiEnvelope;
  if (!response.ok) {
    throw new AccountServiceError(
      statusFor(response),
      readableMessage(envelope.message) ?? "账户服务请求失败，请稍后重试",
    );
  }
  if (!envelope.success) {
    throw new AccountServiceError(
      businessErrorStatus,
      readableMessage(envelope.message) ?? "账户服务未完成请求，请检查输入后重试",
    );
  }
  return { envelope, response };
}

function sessionCookie(response: Response) {
  const header = response.headers.get("set-cookie") ?? "";
  const match = header.match(/(?:^|,\s*)session=([^;,\s]+)/i);
  if (!match?.[1]) throw new AccountServiceError(502, "账户服务返回异常，请稍后重试");
  return "session=" + match[1];
}

function loginAccountData(data: unknown): PublicAccount {
  if (!data || typeof data !== "object") {
    throw new AccountServiceError(502, "账户服务返回异常，请稍后重试");
  }
  const value = data as { id?: unknown; display_name?: unknown; username?: unknown };
  const displayName = readableMessage(value.display_name) ?? readableMessage(value.username);
  if (!Number.isSafeInteger(value.id) || (value.id as number) <= 0 || !displayName) {
    throw new AccountServiceError(502, "账户服务返回异常，请稍后重试");
  }
  return { id: value.id as number, displayName };
}

function accessToken(data: unknown) {
  if (typeof data !== "string" || !data.trim()) {
    throw new AccountServiceError(502, "账户服务返回异常，请稍后重试");
  }
  return data;
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<StoredSession>;
  return Number.isSafeInteger(session.userId)
    && (session.userId as number) > 0
    && typeof session.displayName === "string"
    && Boolean(session.displayName)
    && typeof session.sessionCookie === "string"
    && session.sessionCookie.startsWith("session=")
    && typeof session.accessToken === "string"
    && Boolean(session.accessToken);
}

async function deleteStoredSession() {
  try {
    await secrets.delete({ service: keychainService, name: keychainName });
  } catch {
    throw new AccountServiceError(500, "无法删除系统钥匙串中的登录信息");
  }
}

async function readStoredSession() {
  let value: string | null;
  try {
    value = await secrets.get({ service: keychainService, name: keychainName });
  } catch {
    throw new AccountServiceError(500, "无法读取系统钥匙串中的登录信息");
  }
  if (!value) return null;

  try {
    const session: unknown = JSON.parse(value);
    if (isStoredSession(session)) return session;
  } catch {
    // 损坏的历史数据在下方统一清理。
  }
  await deleteStoredSession();
  return null;
}

async function writeStoredSession(session: StoredSession) {
  try {
    await secrets.set({
      service: keychainService,
      name: keychainName,
      value: JSON.stringify(session),
    });
  } catch {
    throw new AccountServiceError(500, "无法把登录信息写入系统钥匙串");
  }
}

async function refreshToken(session: Pick<StoredSession, "userId" | "sessionCookie">) {
  const { envelope } = await requestJson("/api/user/token", {
    headers: {
      Cookie: session.sessionCookie,
      "New-Api-User": String(session.userId),
    },
  }, 401);
  return accessToken(envelope.data);
}

export async function requestVerification(email: string) {
  const url = new URL("/api/verification", apiBase);
  url.searchParams.set("email", email);
  await requestJson(url.href);
}

export async function registerAccount(input: RegistrationInput) {
  await requestJson("/api/user/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: input.username,
      password: input.password,
      email: input.email,
      verification_code: input.code,
      aff_code: affiliateCode,
    }),
  });
}

export async function loginAccount(username: string, password: string) {
  const { envelope, response } = await requestJson("/api/user/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  }, 401);
  const user = loginAccountData(envelope.data);
  const cookie = sessionCookie(response);
  const token = await refreshToken({ userId: user.id, sessionCookie: cookie });
  await writeStoredSession({
    userId: user.id,
    displayName: user.displayName,
    sessionCookie: cookie,
    accessToken: token,
  });
  return user;
}

export async function restoreAccount() {
  const session = await readStoredSession();
  if (!session) return null;
  try {
    session.accessToken = await refreshToken(session);
    await writeStoredSession(session);
    return { id: session.userId, displayName: session.displayName } satisfies PublicAccount;
  } catch (cause) {
    if (cause instanceof AccountServiceError && cause.status === 401) {
      await deleteStoredSession();
      return null;
    }
    throw cause;
  }
}

export async function logoutAccount() {
  await deleteStoredSession();
}
