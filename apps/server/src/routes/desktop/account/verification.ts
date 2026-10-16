import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({
  email: z.email().max(254),
}), async (req, res) => {
  await u.aihubkitAccount.requestVerification(req.body.email);
  res.json(success(null, "验证码已发送"));
});
