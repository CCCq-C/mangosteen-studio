import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";

const canvasSchema = z.object({
  toonflowCanvas: z.literal(true),
  nodes: z.array(z.object({}).passthrough()),
  edges: z.array(z.object({}).passthrough()),
  viewport: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    zoom: z.number().finite().positive(),
  }).passthrough(),
}).passthrough();

function canvasBaseName(name: string) {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").trim().replace(/[. ]+$/g, "").slice(0, 80) || "社区画布";
}

export default Router().post("/", validateFields({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  directory: z.string().min(1).max(4096),
}), async (req, res) => {
  if (!u.workspace.isLocalWorkspaceRequest(req)) return res.status(403).json(error("请在桌面客户端导入官方画布", null, 403));
  const item = await u.communityCatalog.getCommunityItem(req.body.id);
  if (item.type === "skill") return res.status(400).json(error("这个社区内容是 Skill，请使用安装功能", null, 400));
  const bytes = await u.communityCatalog.downloadCommunityItem(item);
  try {
    canvasSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch {
    return res.status(400).json(error("官方画布文件格式无效，请等待官方修复", null, 400));
  }

  const root = await u.workspace.resolveWorkspace(req, req.body.directory);
  const baseName = canvasBaseName(item.name);
  for (let index = 1; index <= 999; index++) {
    const fileName = `${baseName}${index === 1 ? "" : ` ${index}`}.json`;
    const { path } = await u.workspaceFile.resolveWorkspacePath(root, fileName);
    let release: (() => void) | undefined;
    try {
      release = u.workspaceFile.lockWorkspaceFiles([path]);
      await u.workspaceFile.writeWorkspaceFile(path, bytes, true);
      return res.json(success({ fileName }, "官方画布已导入当前项目"));
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EBUSY") throw cause;
    } finally {
      release?.();
    }
  }
  throw Object.assign(new Error("同名画布过多，请先整理当前项目"), { status: 409 });
});
