import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(128),
  email: z.email().max(254),
  code: z.string().min(1).max(32),
}), async (req, res) => {
  await u.aihubkitAccount.registerAccount({
    username: req.body.username,
    password: req.body.password,
    email: req.body.email,
    code: req.body.code,
  });
  res.json(success(null, "注册成功，请登录"));
});
