import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({
  username: z.string().min(1).max(254),
  password: z.string().min(1).max(128),
}), async (req, res) => {
  const user = await u.aihubkitAccount.loginAccount(req.body.username, req.body.password);
  u.aihubkitCatalog.clearAihubkitCatalog();
  void u.aihubkitCatalog.refreshAihubkitCatalog().catch(() => {});
  res.json(success({ authenticated: true, user }));
});
