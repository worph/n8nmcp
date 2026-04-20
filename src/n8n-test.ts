import { normalizeBaseUrl } from "./config.js";

export interface N8nTestResult {
  ok: boolean;
  workflowCount?: number;
  error?: string;
  status?: number;
}

export async function testN8nConnection(
  baseUrlRaw: string,
  apiKey: string,
): Promise<N8nTestResult> {
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  if (!baseUrl) return { ok: false, error: "Base URL is empty" };
  if (!apiKey) return { ok: false, error: "API key is empty" };

  const url = `${baseUrl}/workflows?limit=1`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-N8N-API-KEY": apiKey,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        error: `${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`,
      };
    }
    const body = (await res.json().catch(() => ({}))) as { data?: unknown[]; count?: number };
    const count = Array.isArray(body.data)
      ? body.data.length
      : typeof body.count === "number"
        ? body.count
        : 0;
    return { ok: true, workflowCount: count };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
