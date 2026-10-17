import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

export default Router().post("/", async (_req, res) => {
  const user = await u.aihubkitAccount.restoreAccount();
  u.aihubkitCatalog.clearAihubkitCatalog();
  if (user) void u.aihubkitCatalog.refreshAihubkitCatalog().catch(() => {});
  res.json(success({ authenticated: Boolean(user), user }));
});
