import { Router } from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(success(await u.aihubkitUsage.getAihubkitBalance()));
});
