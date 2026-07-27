#!/usr/bin/env node
/*
 * quantum-demos-mcp — an MCP server for authoring Quantum customer collateral.
 *
 * A thin proxy over the platform demo API. It lets Claude Code (from any folder,
 * no repo to clone) list a rep's demos, fetch a demo's document, read the
 * authoring guide, and save changes — which go live on the share link instantly.
 *
 * TWO KINDS, one API. Every row carries a `kind` that decides its document shape,
 * its renderer, and which authoring guide applies:
 *   bi       — a visuals-first AI-first BI dashboard demo (a DemoDocument:
 *              branding + pages of widget cells).
 *   proposal — a customer-facing sales proposal (a ProposalDocument: pages of
 *              prose / lineItems / careMatrix / featureMatrix / timeline
 *              elements). Its priced elements can be pulled into a real quote.
 * `kind` is fixed at creation and the platform validates the document against the
 * ROW's kind, never against anything the payload claims — so always read the kind
 * from get_demo/list_demos and fetch the matching guide before editing.
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

const server = new McpServer({ name: "quantum-demos", version: "0.2.0" });

/* ---- Tools ---- */
server.tool(
  "list_demos",
  "List your demos and proposals (id, customer, title, kind, status, share token, updated). Start here to find one by customer name — and note its `kind` ('bi' or 'proposal'), which tells you the document shape and which guide to fetch.",
  {},
  () => tool(() => api("/api/demos")),
);

server.tool(
  "get_demo",
  "Fetch one by id: its `kind` plus the current document (a DemoDocument for kind 'bi', a ProposalDocument for kind 'proposal'). Always load this before editing, and match the guide to the kind you get back.",
  { id: z.string().describe("The demo id") },
  ({ id }) => tool(() => api(`/api/demos/${id}`)),
);

server.tool(
  "update_demo",
  "Validate + save the document. It is validated against the row's OWN kind (a proposal document on a BI demo is rejected, and vice versa). On success the change is live on the share link immediately; on failure the validation errors are returned so you can fix and retry.",
  {
    id: z.string().describe("The demo id"),
    // Must be a typed object (not z.any()): an untyped property has no JSON
    // Schema "type", which makes some MCP clients stringify the value before it
    // reaches the server. passthrough() keeps the full nested document.
    document: z
      .object({})
      .passthrough()
      .describe("The full, updated document object (DemoDocument or ProposalDocument, matching the row's kind)"),
  },
  ({ id, document }) =>
    tool(() => api(`/api/demos/${id}`, { method: "PUT", body: JSON.stringify({ document }) })),
);

server.tool(
  "get_guide",
  "Get the authoring guide for a kind. kind='bi' (default): the DemoDocument shape, every widget type + fields, the 12-column grid, and the color scheme. kind='proposal': the ProposalDocument shape, every element type, and which elements are yours to author versus the rep's to own in the dashboard.",
  {
    kind: z
      .enum(["bi", "proposal"])
      .optional()
      .describe("Which kind's guide to fetch — pass the kind from get_demo. Defaults to 'bi'."),
  },
  ({ kind }) =>
    tool(() => api(`/api/demos/guide${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`)),
);

/* ---- Resources ---- */
server.resource(
  "authoring-guide",
  "guide://authoring",
  {
    mimeType: "text/markdown",
    description: "How to author a BI dashboard demo (widgets, grid, scheme, workflow). For a proposal, read guide://proposal.",
  },
  async (uri) => {
    const data = await api("/api/demos/guide");
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: data.guide }] };
  },
);

server.resource(
  "proposal-authoring-guide",
  "guide://proposal",
  {
    mimeType: "text/markdown",
    description: "How to author a sales proposal (elements, page structure, voice, and which elements the rep owns).",
  },
  async (uri) => {
    const data = await api("/api/demos/guide?kind=proposal");
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: data.guide }] };
  },
);

server.resource(
  "demo",
  new ResourceTemplate("demo://{id}", { list: undefined }),
  { description: "The current document of a demo or proposal, by id." },
  async (uri, { id }) => {
    const data = await api(`/api/demos/${id}`);
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data.document, null, 2) }],
    };
  },
);

/* ---- Prompts ----
 * One per kind rather than one that branches: the useful default instruction is
 * completely different for a dashboard demo and a sales proposal, and a prompt
 * cannot know the row's kind without a network call. Pick by the kind that
 * list_demos/get_demo reports. */
server.prompt(
  "author-demo",
  "Build out a BI dashboard demo (kind 'bi') end-to-end.",
  { id: z.string().describe("The demo id"), instructions: z.string().optional() },
  ({ id, instructions }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Use the quantum-demos tools to build out BI demo ${id}.\n\n` +
            `1. Call get_demo(${JSON.stringify(id)}) to load the current document and CONFIRM its kind is "bi" (if it is "proposal", use the author-proposal prompt instead). Read the guide://authoring resource (or call get_guide).\n` +
            `2. ${instructions || "Extend it into a compelling, believable AI-first BI dashboard tailored to this customer — add pages, prebuilt insights, and the assistant as needed."}\n` +
            `3. Save with update_demo. Changes go live on the share link immediately.`,
        },
      },
    ],
  }),
);

server.prompt(
  "author-proposal",
  "Write out a sales proposal (kind 'proposal') end-to-end.",
  { id: z.string().describe("The proposal id"), instructions: z.string().optional() },
  ({ id, instructions }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Use the quantum-demos tools to write proposal ${id}.\n\n` +
            `1. Call get_demo(${JSON.stringify(id)}) to load the current document and CONFIRM its kind is "proposal" (if it is "bi", use the author-demo prompt instead). Read the guide://proposal resource (or call get_guide with kind="proposal").\n` +
            `2. ${instructions || "Build out the narrative for this deal: spine the middle pages on the prospect's own stated priorities, one page each, titled in their words, then close with a comparison and a rollout timeline."}\n` +
            `3. Leave the PRICED elements alone. The rep owns the lineItems table and the careMatrix (Quantum Care) in the dashboard — Care rows are real service ids you cannot invent, and the shell computes the pricing summary itself. Read them for context and write around them; never restate their figures in prose, because a proposal's Care matrix is interactive and its numbers move as the prospect adjusts the seat count.\n` +
            `4. Save with update_demo. Changes go live on the share link immediately.`,
        },
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
