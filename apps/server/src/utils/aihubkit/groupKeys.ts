import { AihubkitServiceError, aihubkitApiBase, requestAihubkitEnvelope } from "@/utils/aihubkit/client";

interface ManagedToken {
  id: number;
  group: string;
}

const tokenPageSize = 100;
const tokenPageLimit = 5;

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function headers(accessToken: string, userId: number) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "New-Api-User": String(userId),
  };
}

function managedToken(value: unknown, expectedGroups: Set<string>) {
  const data = object(value);
  const id = Number(data?.id);
  const group = text(data?.group);
  const name = text(data?.name);
  const status = Number(data?.status);
  if (!Number.isSafeInteger(id) || id <= 0 || !expectedGroups.has(group)) return;
  if (name !== `山竹漫剧-${group}` || status !== 1) return;
  return { id, group } satisfies ManagedToken;
}

function tokenPage(value: unknown) {
  const data = object(value);
  const items = Array.isArray(value) ? value : data?.items;
  if (!Array.isArray(items)) throw new AihubkitServiceError(502, "AIHubKit 密钥列表响应格式不正确");
  const total = Number(data?.total ?? items.length);
  if (!Number.isSafeInteger(total) || total < 0) throw new AihubkitServiceError(502, "AIHubKit 密钥列表响应格式不正确");
  return { items, total };
}

function fullKey(value: unknown) {
  const key = text(value);
  return key && key.length <= 500 ? key : "";
}

async function readManagedTokens(accessToken: string, userId: number, groups: string[]) {
  const expectedGroups = new Set(groups);
  const tokens = new Map<string, ManagedToken>();
  for (let page = 1; page <= tokenPageLimit; page++) {
    const url = new URL("/api/token/", aihubkitApiBase);
    url.searchParams.set("p", String(page));
    url.searchParams.set("page_size", String(tokenPageSize));
    const { envelope } = await requestAihubkitEnvelope(url.href, {
      headers: headers(accessToken, userId),
    }, 502);
    const result = tokenPage(envelope.data);
    for (const item of result.items) {
      const token = managedToken(item, expectedGroups);
      if (!token) continue;
      const current = tokens.get(token.group);
      if (!current || token.id > current.id) tokens.set(token.group, token);
    }
    if (page * tokenPageSize >= result.total || result.items.length < tokenPageSize) return [...tokens.values()];
  }
  throw new AihubkitServiceError(502, "AIHubKit 密钥数量过多，暂时无法安全查重");
}

async function readOneKey(accessToken: string, userId: number, id: number) {
  const { envelope } = await requestAihubkitEnvelope(`/api/token/${id}/key`, {
    method: "POST",
    headers: headers(accessToken, userId),
  }, 502);
  const key = fullKey(object(envelope.data)?.key);
  if (!key) throw new AihubkitServiceError(502, "AIHubKit 未返回完整分组密钥");
  return key;
}

async function readTokenKeys(accessToken: string, userId: number, tokens: ManagedToken[]): Promise<Record<string, string>> {
  if (!tokens.length) return {};
  try {
    const { envelope } = await requestAihubkitEnvelope("/api/token/batch/keys", {
      method: "POST",
      headers: {
        ...headers(accessToken, userId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids: tokens.map(token => token.id) }),
    }, 502);
    const keys = object(object(envelope.data)?.keys);
    if (!keys) throw new AihubkitServiceError(502, "AIHubKit 批量密钥响应格式不正确");
    return Object.fromEntries(tokens.map((token) => {
      const key = fullKey(keys[String(token.id)]);
      if (!key) throw new AihubkitServiceError(502, "AIHubKit 未返回完整分组密钥");
      return [token.group, key];
    }));
  } catch (error) {
    if (!(error instanceof AihubkitServiceError) || ![400, 404, 405].includes(error.status)) throw error;
    const entries: [string, string][] = [];
    for (const token of tokens) entries.push([token.group, await readOneKey(accessToken, userId, token.id)]);
    return Object.fromEntries(entries);
  }
}

export async function recoverManagedGroupKeys(
  accessToken: string,
  userId: number,
  groups: string[],
): Promise<Record<string, string>> {
  const normalizedGroups = [...new Set(groups.map(group => group.trim()).filter(group => group && group.length <= 200))];
  if (!normalizedGroups.length) return {};
  const tokens = await readManagedTokens(accessToken, userId, normalizedGroups);
  return readTokenKeys(accessToken, userId, tokens);
}

export async function createManagedGroupKey(accessToken: string, userId: number, group: string) {
  const { envelope } = await requestAihubkitEnvelope("/api/token/", {
    method: "POST",
    headers: {
      ...headers(accessToken, userId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: `山竹漫剧-${group}`, group, unlimited_quota: true }),
  });
  const returnedKey = fullKey(object(envelope.data)?.key);
  if (returnedKey) return returnedKey;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, attempt * 250));
    const recovered = await recoverManagedGroupKeys(accessToken, userId, [group]);
    if (recovered[group]) return recovered[group];
  }
  throw new AihubkitServiceError(502, "AIHubKit 已创建分组密钥，但暂时无法读取，请稍后继续同步");
}
