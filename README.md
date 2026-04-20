# n8n MCP

An MCP (Model Context Protocol) server that exposes the [n8n](https://n8n.io) API so an LLM can list, read, edit, create, and run workflows. Packaged as a single Docker image — CasaOS / Yundera compatible — with a small Web UI for setup and [Beacon](../beacon) auto-discovery.

Under the hood it wraps the upstream [`ghcr.io/czlonkowski/n8n-mcp`](https://github.com/czlonkowski/n8n-mcp) image and adds:

- **Web UI** for entering the n8n URL + API key (no hand-editing config).
- **Beacon responder** so the server auto-registers on the shared `mcp-net` network.
- **CasaOS-style compose** (`/DATA/AppData/$AppID/...` volume, `pcs` network, Caddy labels).

## Overview

```
┌─────────────┐        ┌────────────────────────────────────────────┐
│  n8n app    │◄──────►│              n8nmcp container              │
│ (REST API)  │  API   │  ┌──────────────────┐  ┌────────────────┐  │
│             │   key  │  │ Upstream MCP     │  │  Web UI + API  │  │
└─────────────┘        │  │ (czlonkowski/    │  │  :9640         │  │
                       │  │  n8n-mcp, HTTP)  │◄─┤  • setup guide │  │
                       │  │  :3000 internal  │  │  • API-key form│  │
                       │  └────────┬─────────┘  │  • /mcp proxy  │  │
                       │           │            │  • Beacon UDP  │  │
                       │           └─ /mcp ────►│    :9099       │  │
                       │                        └────────────────┘  │
                       └────────────────────────────────────────────┘
```

LLM clients (Claude Code, Claude Desktop, Cursor, …) connect to `http://<host>:9640/mcp` directly, or let Beacon aggregate it at `http://<host>:9300/mcp/`.

## Features

- **Full n8n workflow surface** via the upstream MCP tools: `list_workflows`, `get_workflow`, `create_workflow`, `update_workflow`, `delete_workflow`, `activate_workflow`, `execute_workflow`, `list_executions`, plus node-catalog search tools.
- **One-shot setup** — paste the n8n URL + API key once, hit **Save**, server hot-reloads.
- **CasaOS / Yundera ready** — drop the compose file into `YunderaAppStore/Apps/n8nmcp/` and go.
- **Beacon-discoverable** — shows up automatically in any Beacon aggregator on the same network.
- **Single container** — no sidecars, no extra services. Config persists on a mounted volume.

## Quick Start

### Prerequisites

- A running n8n instance (local or remote) reachable from the container.
- An n8n API key: in n8n, **Settings → n8n API → Create API Key**.
- Docker + Docker Compose.

### Run (standalone)

```bash
docker network create mcp-net   # shared with Beacon + other MCPs (once)
docker compose up -d
open http://localhost:9640
```

In the Web UI:

1. Paste the **n8n Base URL** (e.g. `http://n8n:80` on the same network, or `https://n8n-you.example.com`).
2. Paste the **n8n API Key**.
3. Click **Test connection** → **Save**.

Add to Claude Code:

```bash
claude mcp add-json n8n-mcp '{"type":"url","url":"http://localhost:9640/mcp"}'
```

Or via Beacon (recommended — one entry, every MCP):

```bash
claude mcp add beacon --transport http http://localhost:9300/mcp/
```

### Run on CasaOS / Yundera

Copy `casaos/docker-compose.yml` into `YunderaAppStore/Apps/n8nmcp/docker-compose.yml`. It follows the same conventions as the sibling `n8n` app:

- Uses the shared external `pcs` network.
- Mounts `/DATA/AppData/$AppID/data/` for config persistence.
- Caddy labels expose the Web UI at `n8nmcp-${APP_DOMAIN}`.
- The MCP endpoint lives at the same hostname under `/mcp`.

Install it from the Yundera store, open the app tile, and finish setup in the UI.

## MCP Tools Exposed

Exact tool list comes from the upstream `czlonkowski/n8n-mcp` image — this project forwards them unchanged. At the time of writing:

| Tool | Purpose |
|------|---------|
| `list_workflows` | List workflows (optionally filter by tag/active) |
| `get_workflow` | Fetch a workflow by ID, including nodes + connections |
| `create_workflow` | Create a new workflow from a JSON definition |
| `update_workflow` | Replace a workflow's nodes/connections/settings |
| `delete_workflow` | Remove a workflow |
| `activate_workflow` / `deactivate_workflow` | Toggle active state |
| `execute_workflow` | Trigger a manual execution, optionally with input data |
| `list_executions` | Recent executions with status/timing |
| `get_execution` | Full execution record, including per-node output |
| `search_nodes` | Browse the node catalog (types, descriptions, credentials) |
| `get_node_info` | Detailed schema for a single node type |

All of these run against the n8n REST API using the key you saved in the Web UI.

In addition, this wrapper exposes two meta-tools:

- `echo` — liveness check.
- `mcp_info` — returns `{ n8nBaseUrl, upstreamVersion, connected }` so the LLM can confirm routing.

## Configuration

The Web UI writes `data/config.json`:

```json
{
  "n8n": {
    "baseUrl": "https://n8n.example.com",
    "apiKey": "***redacted***"
  },
  "server": {
    "port": 9640,
    "discoveryPort": 9099
  }
}
```

The API key is **never** returned by `GET /api/config` — it's masked as `***redacted***`. Saving with the masked value preserves the existing key.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Web UI / API / MCP port | `9640` |
| `DISCOVERY_PORT` | Beacon UDP discovery port | `9099` |
| `CONFIG_PATH` | Config file path | `/app/data/config.json` |
| `N8N_BASE_URL` | Optional — pre-seeds `n8n.baseUrl` if config is empty | — |
| `N8N_API_KEY` | Optional — pre-seeds `n8n.apiKey` if config is empty | — |
| `UPSTREAM_PORT` | Port where the wrapped upstream MCP listens inside the container | `3000` |

Setting `N8N_BASE_URL` + `N8N_API_KEY` lets the stack come up fully configured with no UI click-through — useful for CasaOS install-tips that pass values from the parent n8n app.

## How It Relates to the Existing `n8n` CasaOS App

This project is a *companion* to the sibling `YunderaAppStore/Apps/n8n` app — it does not replace it. Install n8n first, create an API key there, then install `n8nmcp` and paste the key. Both apps share the `pcs` network, so the MCP can reach n8n at `http://n8n:80`.

## Security

- The API key lives in `data/config.json` (volume-mounted) and is never logged or returned via any API.
- The Web UI has no built-in auth — front it with the Caddy/Yundera reverse proxy for external access.
- Outbound traffic is limited to the configured n8n base URL.

## Project Layout

```
n8nmcp/
├── src/                # Node wrapper: Web UI, API, proxy, Beacon announce
├── web/                # Static UI (index.html, app.js)
├── casaos/             # CasaOS-flavored docker-compose.yml
├── Dockerfile
├── docker-compose.yml  # Standalone dev/testing variant
├── supervisord.conf    # Runs upstream MCP + wrapper together
├── package.json
├── IMPLEMENTATION.md
└── README.md
```

## License

MIT
