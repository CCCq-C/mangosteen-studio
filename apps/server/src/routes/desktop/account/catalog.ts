import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({
  refresh: z.boolean().optional(),
}), async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(success(await u.aihubkitCatalog.getAihubkitCatalog(req.body.refresh === true)));
});
