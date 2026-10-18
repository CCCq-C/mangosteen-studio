import conf from "@/utils/conf";

export interface AihubkitVideoReferenceLimits {
  images?: number;
  videos?: number;
  audios?: number;
}

export interface AihubkitVideoCapabilityRules {
  seedance20?: AihubkitVideoReferenceLimits;
  seedance25?: AihubkitVideoReferenceLimits;
}

interface StoredVideoCapabilities {
  syncedAt: number;
  rules: AihubkitVideoCapabilityRules;
}

const videoDocumentationUrl = "https://86bdknokqu.apifox.cn/9260936m0.md";
const refreshInterval = 10 * 60_000;
const maxDocumentationSize = 256 * 1024;
let currentRules: AihubkitVideoCapabilityRules | undefined;
let checkedAt = 0;
let refreshRequest: Promise<AihubkitVideoCapabilityRules> | undefined;

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function count(value: unknown, maximum: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= maximum ? number : undefined;
}

function normalizeLimits(value: unknown) {
  const record = object(value);
  if (!record) return;
  const limits = {
    images: count(record.images, 100),
    videos: count(record.videos, 50),
    audios: count(record.audios, 50),
  } satisfies AihubkitVideoReferenceLimits;
  if (Object.values(limits).every(item => item === undefined)) return;
  return limits;
}

function normalizeRules(value: unknown): AihubkitVideoCapabilityRules {
  const record = object(value);
  if (!record) return {};
  const seedance20 = normalizeLimits(record.seedance20);
  const seedance25 = normalizeLimits(record.seedance25);
  return {
    ...(seedance20 ? { seedance20 } : {}),
    ...(seedance25 ? { seedance25 } : {}),
  };
}

function storedRules() {
  const stored = object(conf.get("aihubkitVideoCapabilities"));
  return normalizeRules(stored?.rules);
}

function descriptionCount(description: string, media: "图" | "视频" | "音频", maximum: number) {
  const suffix = media === "图" ? "(?:张\\s*)?图(?:片)?" : `(?:段\\s*)?${media}`;
  return count(new RegExp(`(?:支持\\s*)?(\\d+)\\s*${suffix}`, "i").exec(description)?.[1], maximum);
}

function descriptionLimits(description: string) {
  if (!description.trim()) return;
  const limits = {
    images: descriptionCount(description, "图", 100),
    videos: descriptionCount(description, "视频", 50),
    audios: descriptionCount(description, "音频", 50),
  } satisfies AihubkitVideoReferenceLimits;
  if (Object.values(limits).every(item => item === undefined)) return;
  return limits;
}

function family(modelId: string): keyof AihubkitVideoCapabilityRules | undefined {
  const id = modelId.toLowerCase();
  if (/(?:seedance[-_. ]?2[._-]?5|^sd-2\.5)/i.test(id)) return "seedance25";
  if (/(?:seedance[-_. ]?2[._-]?0|^sd-(?:2\.0|fast|mini))/i.test(id)) return "seedance20";
}

function documentationLimit(markdown: string, field: "referenceImages" | "referenceVideos" | "referenceAudios", version: "2.0" | "2.5", maximum: number) {
  const line = markdown.split("\n").find(item => new RegExp(`^\\|\\s*${field}\\s*\\|`, "i").test(item));
  if (!line) return;
  const plain = line.replace(/[*_`]/g, "");
  return count(new RegExp(`Seedance\\s*${version.replace(".", "[.．]")}(?:系列)?[^|]*?最多\\s*(\\d+)`, "i").exec(plain)?.[1], maximum);
}

function documentationRules(markdown: string) {
  const build = (version: "2.0" | "2.5") => normalizeLimits({
    images: documentationLimit(markdown, "referenceImages", version, 100),
    videos: documentationLimit(markdown, "referenceVideos", version, 50),
    audios: documentationLimit(markdown, "referenceAudios", version, 50),
  });
  return normalizeRules({ seedance20: build("2.0"), seedance25: build("2.5") });
}

async function refreshRules() {
  checkedAt = Date.now();
  try {
    const response = await fetch(videoDocumentationUrl, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const markdown = await response.text();
    if (!markdown || markdown.length > maxDocumentationSize) throw new Error("视频能力文档大小异常");
    const rules = documentationRules(markdown);
    if (!rules.seedance20?.images || !rules.seedance25?.images) throw new Error("视频能力文档格式异常");
    currentRules = rules;
    conf.set("aihubkitVideoCapabilities", { syncedAt: Date.now(), rules } satisfies StoredVideoCapabilities);
  } catch {
    currentRules ??= storedRules();
  }
  return currentRules ?? {};
}

export async function getAihubkitVideoCapabilityRules() {
  if (currentRules && Date.now() - checkedAt < refreshInterval) return currentRules;
  if (refreshRequest) return refreshRequest;
  const request = refreshRules();
  const tracked = request.finally(() => {
    if (refreshRequest === tracked) refreshRequest = undefined;
  });
  refreshRequest = tracked;
  return tracked;
}

export function resolveAihubkitVideoReferenceLimits(
  modelId: string,
  description: string | undefined,
  rules: AihubkitVideoCapabilityRules,
) {
  const specific = descriptionLimits(description ?? "");
  const familyName = family(modelId);
  const defaults = familyName ? rules[familyName] : undefined;
  if (!specific && !defaults) return;
  return {
    images: specific?.images ?? defaults?.images,
    videos: specific?.videos ?? defaults?.videos,
    audios: specific?.audios ?? defaults?.audios,
  } satisfies AihubkitVideoReferenceLimits;
}
