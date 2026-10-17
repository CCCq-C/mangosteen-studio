import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({
  page: z.number().int().min(1).max(1_000_000),
  pageSize: z.number().int().min(1).max(100),
  startTimestamp: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  endTimestamp: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
}), async (req, res) => {
  if (req.body.startTimestamp !== undefined
    && req.body.endTimestamp !== undefined
    && req.body.startTimestamp > req.body.endTimestamp) {
    res.status(400).json(error("开始时间不能晚于结束时间"));
    return;
  }
  res.set("Cache-Control", "no-store");
  res.json(success(await u.aihubkitUsage.getAihubkitUsageLogs(req.body)));
});
