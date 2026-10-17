import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

export default Router().post("/", async (_req, res) => {
  await u.aihubkitAccount.logoutAccount();
  u.aihubkitCatalog.clearAihubkitCatalog();
  res.json(success({ authenticated: false }));
});
