/**
 * UDP discovery responder — lets MCP servers announce themselves to the Beacon aggregator.
 * Ported from ../beacon/sdk/node/mcp-announce.js to ESM.
 */
import * as dgram from "dgram";

export interface DiscoveryResponderOptions {
  name: string;
  description: string;
  tools: unknown[];
  port: number;
  path?: string;
  listenPort?: number;
  auth?: { type: string; token: string };
}

export function createDiscoveryResponder(opts: DiscoveryResponderOptions): dgram.Socket {
  const payload: Record<string, unknown> = {
    type: "announce",
    name: opts.name,
    description: opts.description,
    tools: opts.tools,
    port: opts.port,
  };
  if (opts.path) payload.path = opts.path;
  if (opts.auth) payload.auth = opts.auth;
  const manifest = JSON.stringify(payload);

  const listenPort = opts.listenPort ?? 9099;
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

  socket.on("message", (data, rinfo) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "discovery") {
        console.log(`Discovery request from ${rinfo.address}:${rinfo.port}, announcing`);
        socket.send(manifest, rinfo.port, rinfo.address);
      }
    } catch {
      /* ignore malformed */
    }
  });

  socket.on("error", (err) => {
    console.error("Announce socket error:", err.message);
  });

  socket.bind(listenPort, "0.0.0.0", () => {
    try {
      socket.addMembership("239.255.99.1");
    } catch (err) {
      console.warn("Failed to join multicast group (continuing):", err);
    }
    console.log(
      `Discovery responder listening on UDP :${listenPort} (multicast 239.255.99.1) for ${opts.name}`,
    );
  });

  return socket;
}
