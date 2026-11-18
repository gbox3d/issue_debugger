import express from "express";
import { createPersonnelService } from "../services/personnel/service.js";
import { validId } from "../services/personnel/store.js";

export function createPersonnelRouter(options = {}) {
  const router = express.Router();
  const service = createPersonnelService(options);
  router.post("/personnel/verify", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      res.json(await service.verify(req.body));
    } catch (error) {
      res.status(error.status === 400 ? 400 : 500).json({ error: error.status === 400 ? error.message : "검증 기록을 처리하지 못했습니다. 잠시 후 다시 시도하세요." });
    }
  });
  router.get("/personnel/reports/:id", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!validId(req.params.id)) return res.status(400).json({ error: "보고서 ID가 유효하지 않습니다." });
    try {
      const report = await service.readReport(req.params.id);
      if (!report) return res.status(404).json({ error: "보고서를 찾을 수 없습니다." });
      return res.json(report);
    } catch {
      return res.status(500).json({ error: "저장된 보고서를 읽지 못했습니다." });
    }
  });
  return router;
}

export const personnelRouter = createPersonnelRouter();
