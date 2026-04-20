import { createApi } from "./api.js";
import { loadConfig, saveConfig } from "./config.js";
import { createDiscoveryResponder } from "./mcp-announce.js";
import * as upstream from "./upstream.js";
import type { Config } from "./types.js";

async function main(): Promise<void> {
  console.log("Starting n8n-mcp wrapper...");

  let config: Config = loadConfig();
  // Persist so an auto-generated upstream auth token survives restarts.
  saveConfig(config);

  // Write the upstream env on boot so the supervised n8n-mcp process has what it needs,
  // then kick it off (supervisord has autostart=false for this program).
  if (config.n8n.baseUrl && config.n8n.apiKey) {
    await upstream.writeEnv({
      baseUrl: config.n8n.baseUrl,
      apiKey: config.n8n.apiKey,
      authToken: config.server.upstreamAuthToken,
    });
    await upstream.restart();
  } else {
    console.log("n8n credentials not set yet — open the Web UI to configure.");
  }

  const getConfig = () => config;

  const onConfigUpdated = async (next: Config): Promise<void> => {
    config = next;
    if (config.n8n.baseUrl && config.n8n.apiKey) {
      await upstream.writeEnv({
        baseUrl: config.n8n.baseUrl,
        apiKey: config.n8n.apiKey,
        authToken: config.server.upstreamAuthToken,
      });
      await upstream.restart();
    }
  };

  const app = createApi({ getConfig, onConfigUpdated });
  const port = config.server.port;
  const discoveryPort = config.server.discoveryPort;

  const server = app.listen(port, () => {
    console.log(`Web UI:       http://localhost:${port}`);
    console.log(`MCP endpoint: http://localhost:${port}/mcp`);
    createDiscoveryResponder({
      name: "n8n-mcp",
      description: "n8n workflow API exposed as MCP (wraps czlonkowski/n8n-mcp)",
      tools: [],
      port,
      path: "/mcp",
      listenPort: discoveryPort,
    });
  });

  const shutdown = (signal: string): void => {
    console.log(`\nReceived ${signal}, shutting down...`);
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
