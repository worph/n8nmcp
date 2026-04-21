import { createApi } from "./api.js";
import { loadConfig, saveConfig } from "./config.js";
import { createDiscoveryResponder } from "./mcp-announce.js";
import { fetchUpstreamTools, type McpTool } from "./upstream-tools.js";
import * as upstream from "./upstream.js";
import type { Config } from "./types.js";

const TOOL_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const TOOL_FETCH_INITIAL_DELAY_MS = 1500;
const TOOL_FETCH_MAX_DELAY_MS = 60_000;

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

  let currentTools: McpTool[] = [];
  // Monotonic counter invalidates in-flight retry loops when config changes,
  // so we never race an old fetch against a new upstream auth token.
  let refreshGeneration = 0;
  let periodicRefreshTimer: NodeJS.Timeout | null = null;

  const refreshTools = async (generation: number): Promise<void> => {
    const cfg = config;
    if (!cfg.n8n.baseUrl || !cfg.n8n.apiKey) return;

    let delay = TOOL_FETCH_INITIAL_DELAY_MS;
    let attempt = 0;
    while (generation === refreshGeneration) {
      attempt++;
      try {
        const tools = await fetchUpstreamTools({
          port: cfg.server.upstreamPort,
          authToken: cfg.server.upstreamAuthToken,
        });
        if (generation !== refreshGeneration) return;
        currentTools = tools;
        console.log(
          `Fetched ${tools.length} tools from upstream MCP (attempt ${attempt}).`,
        );
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `Upstream tools/list attempt ${attempt} failed: ${msg}. Retrying in ${Math.round(delay / 1000)}s.`,
        );
        await sleep(delay);
        delay = Math.min(delay * 2, TOOL_FETCH_MAX_DELAY_MS);
      }
    }
  };

  const triggerRefresh = (): void => {
    refreshGeneration++;
    const generation = refreshGeneration;
    void refreshTools(generation);
  };

  triggerRefresh();

  // Periodic re-fetch catches upstream tool-catalog changes (e.g. after a
  // `search_nodes` cache warm-up) without needing a wrapper restart.
  periodicRefreshTimer = setInterval(() => {
    triggerRefresh();
  }, TOOL_REFRESH_INTERVAL_MS);
  periodicRefreshTimer.unref?.();

  const getConfig = () => config;
  const getTools = (): unknown[] => currentTools;

  const onConfigUpdated = async (next: Config): Promise<void> => {
    config = next;
    if (config.n8n.baseUrl && config.n8n.apiKey) {
      await upstream.writeEnv({
        baseUrl: config.n8n.baseUrl,
        apiKey: config.n8n.apiKey,
        authToken: config.server.upstreamAuthToken,
      });
      await upstream.restart();
      // Drop any cached tool list from the previous upstream before re-fetching
      // — a failed init with stale creds would otherwise keep the old list live.
      currentTools = [];
      triggerRefresh();
    } else {
      currentTools = [];
      refreshGeneration++;
    }
  };

  const app = createApi({ getConfig, onConfigUpdated, getTools });
  const port = config.server.port;
  const discoveryPort = config.server.discoveryPort;

  const server = app.listen(port, () => {
    console.log(`Web UI:       http://localhost:${port}`);
    console.log(`MCP endpoint: http://localhost:${port}/mcp`);
    createDiscoveryResponder({
      name: "n8n-mcp",
      description: "n8n workflow API exposed as MCP (wraps czlonkowski/n8n-mcp)",
      getTools,
      port,
      path: "/mcp",
      listenPort: discoveryPort,
    });
  });

  const shutdown = (signal: string): void => {
    console.log(`\nReceived ${signal}, shutting down...`);
    if (periodicRefreshTimer) clearInterval(periodicRefreshTimer);
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
