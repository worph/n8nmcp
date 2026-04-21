/**
 * Query the wrapped upstream MCP server over JSON-RPC for its tool catalog.
 *
 * The upstream (ghcr.io/czlonkowski/n8n-mcp) speaks streamable HTTP MCP at /mcp,
 * which requires an `initialize` handshake before `tools/list` can be called.
 * Responses may come back as plain JSON or as a single-event SSE stream depending
 * on the transport's content negotiation — this client handles both.
 */

export interface FetchToolsOptions {
  port: number;
  authToken: string;
  timeoutMs?: number;
  host?: string;
  path?: string;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  [key: string]: unknown;
}

const PROTOCOL_VERSION = "2024-11-05";

export async function fetchUpstreamTools(opts: FetchToolsOptions): Promise<McpTool[]> {
  const {
    port,
    authToken,
    timeoutMs = 8000,
    host = "127.0.0.1",
    path = "/mcp",
  } = opts;
  const url = `http://${host}:${port}${path}`;

  const baseHeaders: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (authToken) baseHeaders["authorization"] = `Bearer ${authToken}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const initRes = await fetch(url, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "n8nmcp-wrapper", version: "0.1.0" },
        },
      }),
      signal: ctrl.signal,
    });

    if (!initRes.ok) {
      throw new Error(`initialize returned HTTP ${initRes.status}`);
    }

    const sessionId = initRes.headers.get("mcp-session-id") ?? undefined;
    await initRes.text();

    const sessionHeaders: Record<string, string> = { ...baseHeaders };
    if (sessionId) sessionHeaders["mcp-session-id"] = sessionId;

    // Some servers require the initialized notification before tool calls.
    // Fire-and-forget — errors here are non-fatal.
    try {
      const notifRes = await fetch(url, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
        signal: ctrl.signal,
      });
      await notifRes.text();
    } catch {
      /* ignore */
    }

    const listRes = await fetch(url, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      }),
      signal: ctrl.signal,
    });

    if (!listRes.ok) {
      throw new Error(`tools/list returned HTTP ${listRes.status}`);
    }

    const rawBody = await listRes.text();
    const parsed = parseJsonRpcBody(rawBody);
    if (parsed && "error" in parsed && parsed.error) {
      const msg =
        typeof parsed.error === "object" && parsed.error && "message" in parsed.error
          ? String((parsed.error as { message?: unknown }).message ?? "")
          : JSON.stringify(parsed.error);
      throw new Error(`tools/list JSON-RPC error: ${msg}`);
    }

    const tools = (parsed?.result as { tools?: unknown } | undefined)?.tools;
    if (!Array.isArray(tools)) {
      throw new Error("tools/list response missing result.tools array");
    }

    return tools as McpTool[];
  } finally {
    clearTimeout(timer);
  }
}

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: unknown;
};

function parseJsonRpcBody(body: string): JsonRpcResponse | null {
  const trimmed = body.trim();
  if (!trimmed) return null;

  // Plain JSON response — the common case when the server doesn't stream.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as JsonRpcResponse;
    } catch {
      /* fall through to SSE parsing */
    }
  }

  // SSE: lines beginning with `data:` carry the payload. A single response may
  // span multiple `data:` lines concatenated with newlines; we keep the last
  // parseable JSON object — that's the JSON-RPC response we care about.
  let lastParsed: JsonRpcResponse | null = null;
  let buffer = "";
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith("data:")) {
      buffer += line.slice(5).trimStart();
      continue;
    }
    if (line === "" && buffer) {
      try {
        lastParsed = JSON.parse(buffer) as JsonRpcResponse;
      } catch {
        /* ignore malformed event */
      }
      buffer = "";
    }
  }
  if (buffer) {
    try {
      lastParsed = JSON.parse(buffer) as JsonRpcResponse;
    } catch {
      /* ignore */
    }
  }
  return lastParsed;
}
