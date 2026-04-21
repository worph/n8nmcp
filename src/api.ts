import express, { type Request, type Response, Router } from "express";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  getMaskedConfig,
  loadConfig,
  normalizeBaseUrl,
  saveConfig,
  unmaskIncoming,
} from "./config.js";
import { createMcpProxy } from "./mcp-proxy.js";
import { testN8nConnection } from "./n8n-test.js";
import * as upstream from "./upstream.js";
import { Config, ConfigSchema, type StatusResponse } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ApiDependencies {
  getConfig: () => Config;
  onConfigUpdated: (cfg: Config) => Promise<void>;
  getTools: () => unknown[];
}

export function createApi(deps: ApiDependencies): express.Application {
  const app = express();

  // Mount /mcp proxy BEFORE json body parser — proxy needs the raw stream.
  app.use("/mcp", createMcpProxy(deps.getConfig));

  app.use(express.json({ limit: "2mb" }));
  app.use(express.static(path.join(__dirname, "../web")));
  app.use("/api", createApiRouter(deps));

  app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "../web/index.html"));
  });

  return app;
}

function createApiRouter(deps: ApiDependencies): Router {
  const router = Router();

  router.get("/config", (_req: Request, res: Response) => {
    try {
      const cfg = loadConfig();
      res.json(getMaskedConfig(cfg));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post("/config", async (req: Request, res: Response) => {
    try {
      const current = loadConfig();
      const incoming = req.body as Partial<Config>;

      // Normalize the n8n base URL before validation.
      if (incoming.n8n?.baseUrl) {
        incoming.n8n.baseUrl = normalizeBaseUrl(incoming.n8n.baseUrl);
      } else {
        res.status(400).json({ error: "n8n.baseUrl is required" });
        return;
      }

      // Fill missing server block so unmaskIncoming can operate.
      const hydrated: Config = {
        n8n: {
          baseUrl: incoming.n8n?.baseUrl ?? current.n8n.baseUrl,
          apiKey: incoming.n8n?.apiKey ?? "",
        },
        server: current.server,
      };

      const merged = unmaskIncoming(hydrated, current);
      const validation = ConfigSchema.safeParse(merged);
      if (!validation.success) {
        res.status(400).json({
          error: "Invalid config",
          details: validation.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
        });
        return;
      }
      saveConfig(validation.data);
      await deps.onConfigUpdated(validation.data);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post("/test", async (req: Request, res: Response) => {
    try {
      const current = loadConfig();
      const body = req.body as { baseUrl?: string; apiKey?: string };
      const baseUrl = body.baseUrl ?? current.n8n.baseUrl;
      let apiKey = body.apiKey ?? "";
      if (!apiKey || apiKey.includes("*")) apiKey = current.n8n.apiKey;
      const result = await testN8nConnection(baseUrl, apiKey);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  router.get("/status", async (_req: Request, res: Response) => {
    const cfg = deps.getConfig();
    const configured = Boolean(cfg.n8n.baseUrl && cfg.n8n.apiKey);
    const upstreamHealthy = configured ? await upstream.health() : false;
    const response: StatusResponse = {
      configured,
      upstreamHealthy,
      n8nBaseUrl: cfg.n8n.baseUrl,
      toolCount: deps.getTools().length,
    };
    res.json(response);
  });

  router.get("/tools", (_req: Request, res: Response) => {
    res.json({ tools: deps.getTools() });
  });

  return router;
}
