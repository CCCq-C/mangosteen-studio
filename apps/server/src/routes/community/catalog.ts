import { Router } from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().get("/", async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(success(await u.communityCatalog.getCommunityCatalog(req.query.refresh === "true")));
});
