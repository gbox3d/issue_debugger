import express from "express";
import { config } from "./config.js";
import { verifyRouter } from "./routes/verify.js";
import { personnelRouter } from "./routes/personnel.js";
import { logInfo } from "./utils/logger.js";
import { getLlmInfo } from "./services/llm/index.js";

const app = express();

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "2mb" }));

// version check endpoint
app.get("/version", async (req, res) => {
  const llm = await getLlmInfo();

  res.json({
    app: {
      name: "marbas",
      version: config.version
    },
    llm
  });
});

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/api", verifyRouter);
app.use("/api", personnelRouter);

app.listen(config.port, config.host, () => {
  logInfo(`Marbas server listening on http://${config.host}:${config.port}`);
});
