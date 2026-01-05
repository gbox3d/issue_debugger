import express from "express";
import { config } from "./config.js";
import { verifyRouter } from "./routes/verify.js";
import { logInfo } from "./utils/logger.js";
import { getOllamaInfo } from "./services/llm/ollamaClient.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

// version check endpoint
app.get("/version", async (req, res) => {
  const ollama = await getOllamaInfo();

  res.json({
    app: {
      name: "issue-debugger",
      version: config.version
    },
    ollama
  });
});

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/api", verifyRouter);

app.listen(config.port, () => {
  logInfo(`Issue-Debugger server listening on http://localhost:${config.port}`);
});
