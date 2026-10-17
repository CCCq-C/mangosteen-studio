import { Router } from "express";
import { z } from "zod";
import { audioGenerationSchema, imageGenerationSchema, videoGenerationSchema } from "@toonflow/tool-media-generation/runtime";
import { validateFields } from "@/lib/middleware";
import { success, error, errorFromCause } from "@/lib/responseFormat";
import u from "@/utils";
import { translateMessage, validationOptions } from "@/lib/i18n";

// ACT: Bun 不保证把长响应的 fetch.abort 传递给 Express；显式取消复用请求编号和单进程会话状态。
const requests = new Map<string, { controller: AbortController; finished: Promise<void> }>();

export default Router().post("/", validateFields({
  requestId: z.uuid(), operation: z.enum(["generate", "cancel"]),
  directory: z.string().min(1).max(4096), mediaType: z.enum(["image", "video", "audio"]),
}), async (req, res) => {
  const { requestId, operation, directory, mediaType, ...request } = req.body;
  const cwd = await u.workspace.resolveWorkspace(req, directory);
  const requestKey = `${cwd}\0${requestId}`;
  if (operation === "cancel") {
    const active = requests.get(requestKey);
    active?.controller.abort();
    await active?.finished;
    res.json(success({ cancellationRequested: Boolean(active) }));
    return;
  }
  const parsed = (mediaType === "image" ? imageGenerationSchema : mediaType === "video" ? videoGenerationSchema : audioGenerationSchema).safeParse(request, validationOptions());
  if (!parsed.success) {
    res.status(400).json(error("参数错误", parsed.error.issues.map(issue => ({ ...issue, message: translateMessage(issue.message) })), 400));
    return;
  }
  if (requests.has(requestKey)) throw Object.assign(new Error("媒体生成请求已在执行"), { status: 409 });
  const controller = new AbortController();
  const finished = Promise.withResolvers<void>();
  requests.set(requestKey, { controller, finished: finished.promise });
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const close = () => { clearInterval(heartbeat); controller.abort(); };
  res.once("close", close);
  req.once("aborted", close);
  req.socket.once("close", close);
  try {
    res.set({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    // ACT: JSON 允许前导空白，保活时保留现有 response.json() 契约。
    heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded && !res.writableNeedDrain) res.write("\n"); }, 20000);
    const files = await u.mediaGeneration.generateMedia(cwd, mediaType, parsed.data, controller.signal);
    if (!res.destroyed) res.write(JSON.stringify(success(files)));
  } catch (err) {
    if (!res.destroyed) res.write(JSON.stringify(errorFromCause(err)));
  } finally {
    if (requests.get(requestKey)?.controller === controller) requests.delete(requestKey);
    clearInterval(heartbeat);
    res.off("close", close);
    req.off("aborted", close);
    req.socket.off("close", close);
    res.end();
    finished.resolve();
  }
});
