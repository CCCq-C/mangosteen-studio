import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { mkdir, readFile, writeAtomic } from "@toonflow/file";
import { z } from "zod";
import conf from "@/utils/conf";

export type CommunitySource = "gitee" | "github" | "cache";

const manifestMaxBytes = 2 * 1024 * 1024;
const skillMaxBytes = 20 * 1024 * 1024;
const canvasMaxBytes = 5 * 1024 * 1024;
const requestTimeout = 20_000;
const catalogUrls = [
  { source: "gitee", url: "https://gitee.com/Chance-Ccc/mangosteen-studio/raw/main/community/catalog.json" },
  { source: "github", url: "https://raw.githubusercontent.com/CCCq-C/mangosteen-studio/main/community/catalog.json" },
] as const;

const httpsUrl = (host: string) => z.url().max(4096).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === host && !url.username && !url.password;
}, `地址必须来自 ${host}`);
const semver = z.string().trim().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "版本号格式不正确");
const itemSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  type: z.enum(["skill", "template", "workflow"]),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(1000),
  version: semver,
  author: z.string().trim().min(1).max(80),
  fileName: z.string().trim().min(1).max(128).refine(value => !/[\\/]/.test(value), "文件名不能包含路径"),
  urls: z.object({
    gitee: httpsUrl("gitee.com"),
    github: httpsUrl("raw.githubusercontent.com"),
  }).strict(),
  sha256: z.string().trim().regex(/^[a-fA-F0-9]{64}$/).transform(value => value.toLowerCase()),
  minAppVersion: semver,
  tags: z.array(z.string().trim().min(1).max(24)).max(10).default([]),
}).strict().superRefine((item, context) => {
  const valid = item.type === "skill"
    ? /\.(?:md|zip|tar|tar\.gz|tgz)$/i.test(item.fileName)
    : /\.json$/i.test(item.fileName);
  if (!valid) context.addIssue({ code: "custom", path: ["fileName"], message: "文件扩展名与内容类型不匹配" });
});
const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.iso.datetime(),
  items: z.array(itemSchema).max(1000),
}).strict().superRefine((manifest, context) => {
  const ids = new Set<string>();
  for (const [index, item] of manifest.items.entries()) {
    if (ids.has(item.id)) context.addIssue({ code: "custom", path: ["items", index, "id"], message: "条目 ID 重复" });
    ids.add(item.id);
  }
});

export type CommunityItem = z.infer<typeof itemSchema>;
export type CommunityCatalog = z.infer<typeof manifestSchema> & { source: CommunitySource; stale: boolean };

export class CommunityCatalogError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CommunityCatalogError";
    this.status = status;
  }
}

const cacheDirectory = resolve(dirname(conf.path), "community");
const cachePath = resolve(cacheDirectory, "catalog.json");
let currentCatalog: CommunityCatalog | undefined;
let catalogRequest: Promise<CommunityCatalog> | undefined;

async function responseBytes(response: Response, maxBytes: number, label: string) {
  if (!response.ok) throw new CommunityCatalogError(502, `${label}请求失败（HTTP ${response.status}）`);
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new CommunityCatalogError(413, `${label}超过大小限制`);
  if (!response.body) throw new CommunityCatalogError(502, `${label}返回内容为空`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new CommunityCatalogError(413, `${label}超过大小限制`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseManifest(bytes: Uint8Array) {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new CommunityCatalogError(502, "官方社区目录不是有效的 UTF-8 JSON"); }
  const result = manifestSchema.safeParse(value);
  if (!result.success) throw new CommunityCatalogError(502, "官方社区目录格式不正确");
  return result.data;
}

async function fetchBytes(url: string, maxBytes: number, label: string) {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json, application/octet-stream" }, signal: AbortSignal.timeout(requestTimeout) });
  } catch {
    throw new CommunityCatalogError(503, `${label}网络不可用`);
  }
  return responseBytes(response, maxBytes, label);
}

async function refreshCatalog() {
  for (const remote of catalogUrls) {
    try {
      const bytes = await fetchBytes(remote.url, manifestMaxBytes, "官方社区目录");
      const manifest = parseManifest(bytes);
      await mkdir(cacheDirectory, { recursive: true });
      await writeAtomic(cachePath, JSON.stringify(manifest), { mode: 0o600 }).catch(error => console.warn("官方社区目录缓存写入失败", error));
      return { ...manifest, source: remote.source, stale: false } satisfies CommunityCatalog;
    } catch {
      // 按 Gitee、GitHub 的顺序回退；在线源都失败后再读取缓存。
    }
  }
  try {
    const bytes = new Uint8Array(await readFile(cachePath));
    if (bytes.byteLength > manifestMaxBytes) throw new CommunityCatalogError(413, "官方社区目录缓存超过大小限制");
    return { ...parseManifest(bytes), source: "cache", stale: true } satisfies CommunityCatalog;
  } catch {
    throw new CommunityCatalogError(503, "官方社区暂时无法连接，且没有可用缓存");
  }
}

export function getCommunityCatalog(force = false) {
  if (!force && currentCatalog) return Promise.resolve(currentCatalog);
  if (catalogRequest) return catalogRequest;
  const request = refreshCatalog().then((catalog) => {
    currentCatalog = catalog;
    return catalog;
  });
  const tracked = request.finally(() => {
    if (catalogRequest === tracked) catalogRequest = undefined;
  });
  catalogRequest = tracked;
  return tracked;
}

export async function getCommunityItem(id: string) {
  const catalog = await getCommunityCatalog();
  const item = catalog.items.find(candidate => candidate.id === id);
  if (!item) throw new CommunityCatalogError(404, "官方社区中没有这个内容");
  return item;
}

export async function downloadCommunityItem(item: CommunityItem) {
  const maxBytes = item.type === "skill" ? skillMaxBytes : canvasMaxBytes;
  let checksumError: CommunityCatalogError | undefined;
  for (const url of [item.urls.gitee, item.urls.github]) {
    try {
      const bytes = await fetchBytes(url, maxBytes, "社区内容");
      const checksum = createHash("sha256").update(bytes).digest("hex");
      if (checksum !== item.sha256) throw new CommunityCatalogError(502, "社区内容校验失败，请等待官方修复");
      return bytes;
    } catch (error) {
      if (error instanceof CommunityCatalogError && error.message.includes("校验失败")) checksumError = error;
      // 单个下载源失败后尝试同一内容的备用源。
    }
  }
  if (checksumError) throw checksumError;
  throw new CommunityCatalogError(503, "社区内容暂时无法下载，请稍后重试");
}
