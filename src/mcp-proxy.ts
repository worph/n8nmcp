import { createProxyMiddleware, type Options } from "http-proxy-middleware";
import type { RequestHandler } from "express";
import type { Config } from "./types.js";

export function createMcpProxy(getConfig: () => Config): RequestHandler {
  const opts: Options = {
    target: "http://127.0.0.1:3000",
    changeOrigin: true,
    ws: true,
    xfwd: false,
    pathRewrite: () => "/mcp",
    router: (req) => {
      const cfg = getConfig();
      return `http://127.0.0.1:${cfg.server.upstreamPort}`;
    },
    on: {
      proxyReq: (proxyReq, _req, _res) => {
        const cfg = getConfig();
        const token = cfg.server.upstreamAuthToken;
        if (token) {
          proxyReq.setHeader("Authorization", `Bearer ${token}`);
        }
      },
      error: (err, _req, res) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("MCP proxy error:", msg);
        if (res && "writeHead" in res && !res.headersSent) {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: "upstream_unreachable",
              message:
                "The wrapped n8n-mcp process is not reachable. Check the config — did you save the n8n API key?",
            }),
          );
        }
      },
    },
  };

  return createProxyMiddleware(opts);
}
