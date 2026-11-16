import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";

export default Router().post("/", validateFields({ allow: z.boolean() }), (req, res) => {
  u.desktop.getDesktopRuntime(req).respondToClose(req.body.allow);
  res.sendStatus(204);
});
