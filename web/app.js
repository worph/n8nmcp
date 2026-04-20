/* global document, window, fetch, location */

const $ = (sel) => document.querySelector(sel);

let currentConfig = null;
let statusTimer = null;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

document.addEventListener("DOMContentLoaded", async () => {
  bindUi();
  await loadConfig();
  await refreshStatus();
  renderSnippets();
  statusTimer = setInterval(refreshStatus, 2000);
});

function bindUi() {
  $("#btn-test").addEventListener("click", onTest);
  $("#btn-save").addEventListener("click", onSave);
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.copy);
      if (!target) return;
      navigator.clipboard.writeText(target.textContent || "").then(() => toast("Copied"));
    });
  });
}

async function loadConfig() {
  try {
    currentConfig = await api("/api/config");
    $("#base-url").value = currentConfig.n8n?.baseUrl || "";
    const key = currentConfig.n8n?.apiKey || "";
    $("#api-key").value = key;
    $("#api-key").placeholder = key ? "key saved — leave blank to keep" : "paste key here";
  } catch (e) {
    toast("Failed to load config: " + e.message, true);
  }
}

async function refreshStatus() {
  try {
    const s = await api("/api/status");
    const pill = $("#status-pill");
    if (!s.configured) {
      pill.textContent = "not configured";
      pill.className =
        "px-3 py-1 rounded-full text-xs font-semibold bg-amber-200 text-amber-900";
    } else if (s.upstreamHealthy) {
      pill.textContent = "connected";
      pill.className =
        "px-3 py-1 rounded-full text-xs font-semibold bg-emerald-200 text-emerald-900";
    } else {
      pill.textContent = "upstream down";
      pill.className = "px-3 py-1 rounded-full text-xs font-semibold bg-red-200 text-red-900";
    }
  } catch (e) {
    console.warn("status failed", e);
  }
}

function renderSnippets() {
  const origin = location.origin;
  $("#mcp-url").textContent = `${origin}/mcp`;
  $("#snippet-claude").textContent =
    `claude mcp add-json n8n-mcp '{"type":"url","url":"${origin}/mcp"}'`;
}

async function onTest() {
  const baseUrl = $("#base-url").value.trim();
  const apiKey = $("#api-key").value;
  const out = $("#test-result");
  out.textContent = "testing…";
  out.className = "text-sm text-slate-500";
  try {
    const r = await api("/api/test", {
      method: "POST",
      body: JSON.stringify({ baseUrl, apiKey }),
    });
    if (r.ok) {
      out.textContent = `✓ connected (${r.workflowCount ?? 0} workflow${
        r.workflowCount === 1 ? "" : "s"
      })`;
      out.className = "text-sm text-emerald-700 font-medium";
    } else {
      out.textContent = `✗ ${r.error || "failed"}`;
      out.className = "text-sm text-red-700 font-medium";
    }
  } catch (e) {
    out.textContent = `✗ ${e.message}`;
    out.className = "text-sm text-red-700 font-medium";
  }
}

async function onSave() {
  const baseUrl = $("#base-url").value.trim();
  const apiKey = $("#api-key").value;
  if (!baseUrl) return toast("Base URL is required", true);
  try {
    await api("/api/config", {
      method: "POST",
      body: JSON.stringify({ n8n: { baseUrl, apiKey } }),
    });
    toast("Saved — upstream restarting");
    // Clear the typed key; the server now holds it masked.
    await loadConfig();
  } catch (e) {
    toast("Save failed: " + e.message, true);
  }
}

function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `fixed bottom-4 right-4 max-w-sm p-3 rounded shadow-lg text-sm ${
    isError ? "bg-red-600 text-white" : "bg-slate-900 text-white"
  }`;
  setTimeout(() => t.classList.add("hidden"), 2500);
}
