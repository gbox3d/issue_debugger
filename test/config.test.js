import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const configUrl = new URL("../src/config.js", import.meta.url).href;

function loadConfig(envFile, env = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "marbas-config-test-"));
  try {
    writeFileSync(join(cwd, ".env"), envFile);
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { config } from ${JSON.stringify(configUrl)};
      console.log(JSON.stringify({ provider: config.llm.provider, anthropic: config.anthropic }));
    `], { cwd, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("defaults select Anthropic Opus with an adaptive-thinking token budget", () => {
  const config = loadConfig("");
  assert.equal(config.provider, "anthropic");
  assert.equal(config.anthropic.model, "claude-opus-5-5");
  assert.equal(config.anthropic.maxTokens, 8192);
});

test("dotenv values accept matching double and single quotes", () => {
  const config = loadConfig('ANTHROPIC_API_KEY="test-api-key"\nANTHROPIC_MODEL=\'test-model\'\n');
  assert.equal(config.anthropic.apiKey, "test-api-key");
  assert.equal(config.anthropic.model, "test-model");
});

test("a quoted empty model selects the Opus default", () => {
  const config = loadConfig('ANTHROPIC_MODEL=""\n');
  assert.equal(config.anthropic.model, "claude-opus-5-5");
});

test("environment values take precedence over the dotenv file", () => {
  const config = loadConfig('LLM_PROVIDER=anthropic\nANTHROPIC_API_KEY="file-key"\nANTHROPIC_MODEL="file-model"\n', {
    LLM_PROVIDER: "openai",
    ANTHROPIC_API_KEY: "environment-key",
    ANTHROPIC_MODEL: "environment-model",
  });
  assert.equal(config.provider, "openai");
  assert.equal(config.anthropic.apiKey, "environment-key");
  assert.equal(config.anthropic.model, "environment-model");
});
