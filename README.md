# quantum-demos-mcp

An [MCP](https://modelcontextprotocol.io) server for authoring **Quantum customer
collateral** from Claude Code — from any folder, with no repo to clone. It's a
thin, authenticated proxy over the platform's demo API.

## Two kinds

Every row carries a `kind`, fixed when the rep creates it, that decides its
document shape, its renderer, and which guide applies:

| kind | What it is | Document |
| --- | --- | --- |
| `bi` | A visuals-first AI-first BI dashboard demo | `DemoDocument` — branding + pages of widget cells |
| `proposal` | A customer-facing sales proposal | `ProposalDocument` — pages of `prose` / `lineItems` / `careMatrix` / `featureMatrix` / `timeline` elements |

Read the `kind` from `list_demos`/`get_demo` and fetch the matching guide before
editing. The platform validates against the **row's** kind, never against
anything the payload claims, so sending the wrong shape is rejected rather than
silently stored.

On a **proposal**, the priced elements are not yours: the rep owns the
`lineItems` table and the `careMatrix` (Quantum Care) in the dashboard, so that
SKUs trace to the price book and Care plans come from the shared template. Write
the narrative around them.

## Connect

Generate your connect command in the platform under **Settings → Demo
Authoring**. It looks like this (the key + URL are filled in for you):

```bash
claude mcp add quantum-demos \
  --env QUANTUM_API_KEY=qd_xxxxxxxx \
  --env QUANTUM_DEMOS_URL=https://your-quantum-app \
  -- npx -y github:quantumtechnologies876/quantum-demos-mcp
```

Run it once (in your terminal, or paste it into Claude Code and let it set up).
The key is a **demos-scoped** key — it can only touch demos, never quotes.

## Use

Then, from any Claude Code session:

> List my demos, then open the Acme one and add a Finance page with cash-flow
> forecasting and an insight about the three slow-paying customers.

> Open the Northwind proposal and spine the middle pages on the three problems
> they raised on the call.

Or open a demo in the dashboard and copy its ready-made authoring prompt.

## What it exposes

**Tools**
- `list_demos` — your demos and proposals (id, customer, title, **kind**, status, share token)
- `get_demo(id)` — its `kind` + current document
- `update_demo(id, document)` — validate + save against the row's kind (goes live immediately)
- `get_guide(kind?)` — the authoring guide for `bi` (default) or `proposal`

**Resources**
- `guide://authoring` — the BI demo guide (markdown)
- `guide://proposal` — the proposal guide (markdown)
- `demo://{id}` — the current document of a demo or proposal

**Prompts**
- `author-demo(id, instructions?)` — build out a BI dashboard demo
- `author-proposal(id, instructions?)` — write out a sales proposal

## Environment

| Var | Meaning |
| --- | --- |
| `QUANTUM_API_KEY` | Your demos-scoped key (`qd_…`) |
| `QUANTUM_DEMOS_URL` | The platform base URL |

## Requirements

Node ≥ 18 (uses the built-in `fetch`). No build step — plain ESM.
