#!/usr/bin/env node
/*
 * quantum-demos-mcp — an MCP server for authoring Quantum customer demos.
 *
 * A thin proxy over the platform demo API. It lets Claude Code (from any folder,
 * no repo to clone) list a rep's demos, fetch a demo's document, read the
 * authoring guide, and save changes — which go live on the share link instantly.
 *
 * Auth + target come from the environment (set once by the `claude mcp add`
 * command the platform generates under Settings → Demo Authoring):
 *   QUANTUM_API_KEY   — the rep's demos-scoped key (qd_…)
 *   QUANTUM_DEMOS_URL — the platform base URL (e.g. https://app.quantum…)
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.QUANTUM_DEMOS_URL || "").replace(/\/$/, "");
const KEY = process.env.QUANTUM_API_KEY || "";

async function api(path, init = {}) {
  if (!BASE) throw new Error("QUANTUM_DEMOS_URL is not set.");
  if (!KEY) throw new Error("QUANTUM_API_KEY is not set.");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${KEY}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = Array.isArray(body?.errors)
      ? `: ${body.errors.join("; ")}`
      : body?.error
        ? `: ${body.error}`
        : text
          ? `: ${text}`
          : "";
    throw new Error(`${init.method || "GET"} ${path} → ${res.status}${detail}`);
  }
  return body;
}

/** Run a tool body, turning thrown errors into an MCP error result so the model
 * can read + recover (e.g. fix validation errors and retry update_demo). */
async function tool(fn) {
  try {
    const data = await fn();
    return {
      content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
    };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: String(err?.message ?? err) }] };
  }
}

const server = new McpServer({ name: "quantum-demos", version: "0.1.0" });

/* ---- Tools ---- */
server.tool(
  "list_demos",
  "List your demos (id, customer, status, share token, updated). Start here to find a demo by customer name.",
  {},
  () => tool(() => api("/api/demos")),
);

server.tool(
  "get_demo",
  "Fetch a demo's current DemoDocument by id. Always load this before editing.",
  { id: z.string().describe("The demo id") },
  ({ id }) => tool(() => api(`/api/demos/${id}`)),
);

server.tool(
  "update_demo",
  "Validate + save a demo's DemoDocument. On success the change is live on the share link immediately; on failure the validation errors are returned so you can fix and retry.",
  {
    id: z.string().describe("The demo id"),
    document: z.any().describe("The full, updated DemoDocument object"),
  },
  ({ id, document }) =>
    tool(() => api(`/api/demos/${id}`, { method: "PUT", body: JSON.stringify({ document }) })),
);

server.tool(
  "get_guide",
  "Get the demo authoring guide: the document shape, every widget type + fields, the 12-column grid, and the available color schemes.",
  {},
  () => tool(() => api("/api/demos/guide")),
);

/* ---- Resources ---- */
server.resource(
  "authoring-guide",
  "guide://authoring",
  { mimeType: "text/markdown", description: "How to author a Quantum demo (widgets, grid, schemes, workflow)." },
  async (uri) => {
    const data = await api("/api/demos/guide");
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: data.guide }] };
  },
);

server.resource(
  "demo",
  new ResourceTemplate("demo://{id}", { list: undefined }),
  { description: "A demo's current DemoDocument, by id." },
  async (uri, { id }) => {
    const data = await api(`/api/demos/${id}`);
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data.document, null, 2) }],
    };
  },
);

/* ---- Prompt ---- */
server.prompt(
  "author-demo",
  "Build out a Quantum demo end-to-end.",
  { id: z.string().describe("The demo id"), instructions: z.string().optional() },
  ({ id, instructions }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Use the quantum-demos tools to build out demo ${id}.\n\n` +
            `1. Call get_demo(${JSON.stringify(id)}) to load the current document, and read the guide://authoring resource (or call get_guide).\n` +
            `2. ${instructions || "Extend it into a compelling, believable AI-first BI dashboard tailored to this customer — add pages, prebuilt insights, and the assistant as needed."}\n` +
            `3. Save with update_demo. Changes go live on the share link immediately.`,
        },
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
