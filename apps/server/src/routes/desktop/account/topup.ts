import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({
  key: z.string().trim().min(1).max(512),
}), async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(success(await u.aihubkitUsage.redeemAihubkitCode(req.body.key)));
});
