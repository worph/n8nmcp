import crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Config, ConfigSchema } from "./types.js";

const CONFIG_PATH = process.env.CONFIG_PATH || path.join(process.cwd(), "data/config.json");

export function generateAuthToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function defaultConfig(): Config {
  return {
    n8n: {
      baseUrl: process.env.N8N_BASE_URL ?? "",
      apiKey: process.env.N8N_API_KEY ?? "",
    },
    server: {
      port: Number(process.env.PORT ?? 9640),
      discoveryPort: Number(process.env.DISCOVERY_PORT ?? 9099),
      upstreamPort: Number(process.env.UPSTREAM_PORT ?? 3000),
      upstreamAuthToken: generateAuthToken(),
    },
  };
}

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.log(`Config file not found at ${CONFIG_PATH}, creating default...`);
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const cfg = defaultConfig();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
    return cfg;
  }

  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      "Invalid config:\n" +
        result.error.errors.map((e) => `  - ${e.path.join(".")}: ${e.message}`).join("\n"),
    );
  }
  if (!result.data.server.upstreamAuthToken) {
    result.data.server.upstreamAuthToken = generateAuthToken();
    saveConfig(result.data);
  }
  return result.data;
}

export function saveConfig(config: Config): void {
  const result = ConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(
      "Invalid config:\n" +
        result.error.errors.map((e) => `  - ${e.path.join(".")}: ${e.message}`).join("\n"),
    );
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(result.data, null, 2), "utf-8");
}

export function maskSecret(secret: string): string {
  if (!secret) return "";
  if (secret.length < 10) return "***";
  return `${secret.substring(0, 4)}${"*".repeat(12)}${secret.substring(secret.length - 4)}`;
}

export function getMaskedConfig(config: Config): Config {
  const masked: Config = JSON.parse(JSON.stringify(config));
  masked.n8n.apiKey = maskSecret(masked.n8n.apiKey);
  masked.server.upstreamAuthToken = maskSecret(masked.server.upstreamAuthToken);
  return masked;
}

export function unmaskIncoming(incoming: Config, current: Config): Config {
  const merged: Config = JSON.parse(JSON.stringify(incoming));
  if (!merged.n8n.apiKey || merged.n8n.apiKey.includes("*")) {
    merged.n8n.apiKey = current.n8n.apiKey;
  }
  merged.server = merged.server ?? current.server;
  merged.server.upstreamAuthToken = current.server.upstreamAuthToken;
  merged.server.port = current.server.port;
  merged.server.discoveryPort = current.server.discoveryPort;
  merged.server.upstreamPort = current.server.upstreamPort;
  return merged;
}

export function normalizeBaseUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  if (!u) return u;
  if (!/\/api\/v1$/.test(u)) u = `${u}/api/v1`;
  return u;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
