import { secrets } from "bun";
import {
  AihubkitServiceError,
  aihubkitApiBase,
  readableAihubkitMessage,
  requestAihubkitEnvelope,
} from "@/utils/aihubkit/client";

export { AihubkitServiceError as AccountServiceError } from "@/utils/aihubkit/client";

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
  groupApiKeys: Record<string, string>;
}

const keychainService = "com.mangosteen.studio";
const keychainName = "aihubkitSession";
const affiliateCode = "DlQa";
const tokenRefreshMaxAge = 60_000;
let refreshedUserId = 0;
let refreshedAt = 0;
let sessionEpoch = 0;
let sessionRefreshRequest: Promise<StoredSession | null> | undefined;

function markTokenFresh(userId = 0) {
  refreshedUserId = userId;
  refreshedAt = userId ? Date.now() : 0;
}

function sessionCookie(response: Response) {
  const header = response.headers.get("set-cookie") ?? "";
  const match = header.match(/(?:^|,\s*)session=([^;,\s]+)/i);
  if (!match?.[1]) throw new AihubkitServiceError(502, "账户服务返回异常，请稍后重试");
  return "session=" + match[1];
}

function loginAccountData(data: unknown): PublicAccount {
  if (!data || typeof data !== "object") {
    throw new AihubkitServiceError(502, "账户服务返回异常，请稍后重试");
  }
  const value = data as { id?: unknown; display_name?: unknown; username?: unknown };
  const displayName = readableAihubkitMessage(value.display_name) ?? readableAihubkitMessage(value.username);
  if (!Number.isSafeInteger(value.id) || (value.id as number) <= 0 || !displayName) {
    throw new AihubkitServiceError(502, "账户服务返回异常，请稍后重试");
  }
  return { id: value.id as number, displayName };
}

function accessToken(data: unknown) {
  if (typeof data !== "string" || !data.trim()) {
    throw new AihubkitServiceError(502, "账户服务返回异常，请稍后重试");
  }
  return data;
}

function groupApiKeys(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([group, key]) => {
    const name = group.trim();
    return name && name.length <= 200 && typeof key === "string" && key.trim() ? [[name, key.trim()]] : [];
  }).slice(0, 500));
}

function storedSession(value: unknown): StoredSession | undefined {
  if (!value || typeof value !== "object") return;
  const session = value as Partial<StoredSession>;
  const valid = Number.isSafeInteger(session.userId)
    && (session.userId as number) > 0
    && typeof session.displayName === "string"
    && Boolean(session.displayName)
    && typeof session.sessionCookie === "string"
    && session.sessionCookie.startsWith("session=")
    && typeof session.accessToken === "string"
    && Boolean(session.accessToken);
  if (!valid) return;
  return { ...session as StoredSession, groupApiKeys: groupApiKeys(session.groupApiKeys) };
}

async function deleteStoredSession() {
  try {
    await secrets.delete({ service: keychainService, name: keychainName });
  } catch {
    throw new AihubkitServiceError(500, "无法删除系统钥匙串中的登录信息");
  }
}

async function readStoredSession() {
  let value: string | null;
  try {
    value = await secrets.get({ service: keychainService, name: keychainName });
  } catch {
    throw new AihubkitServiceError(500, "无法读取系统钥匙串中的登录信息");
  }
  if (!value) return null;

  try {
    const session: unknown = JSON.parse(value);
    const normalized = storedSession(session);
    if (normalized) return normalized;
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
    throw new AihubkitServiceError(500, "无法把登录信息写入系统钥匙串");
  }
}

async function refreshToken(session: Pick<StoredSession, "userId" | "sessionCookie">) {
  const { envelope } = await requestAihubkitEnvelope("/api/user/token", {
    headers: {
      Cookie: session.sessionCookie,
      "New-Api-User": String(session.userId),
    },
  }, 401);
  return accessToken(envelope.data);
}

export async function requestVerification(email: string) {
  const url = new URL("/api/verification", aihubkitApiBase);
  url.searchParams.set("email", email);
  await requestAihubkitEnvelope(url.href);
}

export async function registerAccount(input: RegistrationInput) {
  await requestAihubkitEnvelope("/api/user/register", {
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
  const { envelope, response } = await requestAihubkitEnvelope("/api/user/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  }, 401);
  const user = loginAccountData(envelope.data);
  const cookie = sessionCookie(response);
  const token = await refreshToken({ userId: user.id, sessionCookie: cookie });
  const previousSession = await readStoredSession();
  sessionEpoch++;
  sessionRefreshRequest = undefined;
  await writeStoredSession({
    userId: user.id,
    displayName: user.displayName,
    sessionCookie: cookie,
    accessToken: token,
    groupApiKeys: previousSession?.userId === user.id ? previousSession.groupApiKeys : {},
  });
  markTokenFresh(user.id);
  return user;
}

async function synchronizeStoredSession(epoch: number) {
  const session = await readStoredSession();
  if (!session) {
    markTokenFresh();
    return null;
  }
  if (session.userId === refreshedUserId && Date.now() - refreshedAt < tokenRefreshMaxAge) return session;
  try {
    const token = await refreshToken(session);
    if (epoch !== sessionEpoch) return readStoredSession();
    session.accessToken = token;
    await writeStoredSession(session);
    markTokenFresh(session.userId);
    return session;
  } catch (cause) {
    if (cause instanceof AihubkitServiceError && cause.status === 401) {
      await deleteStoredSession();
      markTokenFresh();
      return null;
    }
    throw cause;
  }
}

async function refreshStoredSession() {
  if (sessionRefreshRequest) return sessionRefreshRequest;
  const request = synchronizeStoredSession(sessionEpoch);
  const tracked = request.finally(() => {
    if (sessionRefreshRequest === tracked) sessionRefreshRequest = undefined;
  });
  sessionRefreshRequest = tracked;
  return tracked;
}

export async function restoreAccount() {
  const session = await refreshStoredSession();
  return session ? { id: session.userId, displayName: session.displayName } satisfies PublicAccount : null;
}

export async function getAihubkitAccess() {
  const session = await refreshStoredSession();
  if (!session) throw new AihubkitServiceError(401, "登录已失效，请重新登录");
  return {
    userId: session.userId,
    accessToken: session.accessToken,
    groupApiKeys: { ...session.groupApiKeys },
  };
}

export async function getAihubkitPricingSession() {
  const session = await refreshStoredSession();
  if (!session) throw new AihubkitServiceError(401, "登录已失效，请重新登录");
  return { userId: session.userId, sessionCookie: session.sessionCookie };
}

export async function saveGroupApiKeys(userId: number, keys: Record<string, string>) {
  const session = await readStoredSession();
  if (!session || session.userId !== userId) throw new AihubkitServiceError(401, "登录已切换，请重新获取模型");
  session.groupApiKeys = groupApiKeys(keys);
  await writeStoredSession(session);
}

export async function logoutAccount() {
  sessionEpoch++;
  sessionRefreshRequest = undefined;
  markTokenFresh();
  await deleteStoredSession();
}
