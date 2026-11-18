import express from "express";
import { createVerificationService } from "../services/verification/service.js";
import { validId } from "../services/verification/store.js";

export function createVerifyRouter(options = {}) {
  const router = express.Router();
  const service = createVerificationService(options);
  router.post("/verify", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try { res.json(await service.verify(req.body)); }
    catch (error) {
      const status = [400, 404, 502].includes(error.status) ? error.status : 500;
      res.status(status).json({ error: status === 500 ? "검증 기록을 처리하지 못했습니다. 잠시 후 다시 시도하세요." : error.message });
    }
  });
  router.get("/reports/:id", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!validId(req.params.id)) return res.status(400).json({ error: "보고서 ID가 유효하지 않습니다." });
    try {
      const report = await service.readReport(req.params.id);
      if (!report) return res.status(404).json({ error: "보고서를 찾을 수 없습니다." });
      res.json(report);
    } catch { res.status(500).json({ error: "저장된 보고서를 읽지 못했습니다." }); }
  });
  return router;
}

export const verifyRouter = createVerifyRouter();
