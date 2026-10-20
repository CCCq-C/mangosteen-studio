import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
}), async (req, res) => {
  if (!u.workspace.isLocalWorkspaceRequest(req)) return res.status(403).json(error("请在桌面客户端安装官方 Skill", null, 403));
  const item = await u.communityCatalog.getCommunityItem(req.body.id);
  if (item.type !== "skill") return res.status(400).json(error("这个社区内容不是 Skill，请使用导入功能", null, 400));
  const bytes = await u.communityCatalog.downloadCommunityItem(item);
  const result = await u.pluginInstall.installSkill(item.fileName, bytes);
  res.json(success(result, "官方 Skill 已安装"));
});
