# quantum-demos-mcp

An [MCP](https://modelcontextprotocol.io) server for authoring **Quantum customer
demos** from Claude Code — from any folder, with no repo to clone. It's a thin,
authenticated proxy over the platform's demo API.

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

Or open a demo in the dashboard and copy its ready-made authoring prompt.

## What it exposes

**Tools**
- `list_demos` — your demos (id, customer, status, share token)
- `get_demo(id)` — a demo's current `DemoDocument`
- `update_demo(id, document)` — validate + save (goes live immediately)
- `get_guide` — the authoring guide, widget types, and color schemes

**Resources**
- `guide://authoring` — the authoring guide (markdown)
- `demo://{id}` — a demo's current document

**Prompt**
- `author-demo(id, instructions?)` — a ready task to build out a demo

## Environment

| Var | Meaning |
| --- | --- |
| `QUANTUM_API_KEY` | Your demos-scoped key (`qd_…`) |
| `QUANTUM_DEMOS_URL` | The platform base URL |

## Requirements

Node ≥ 18 (uses the built-in `fetch`). No build step — plain ESM.
