# MCP server (opencode + Claude Code + any MCP host)

The `playwright-search-mcp` binary exposes three tools over the standard MCP stdio protocol — usable by opencode, Claude Code, Cursor, Continue, or any other MCP-compatible host. Works with any LLM behind those hosts (LM Studio, Ollama, Anthropic, OpenAI, …).

## Tools exposed

| Tool | Inputs | Returns |
|------|--------|---------|
| `web_research` | `query`, `top` (1–20, default 5), `engines` (default `["ddg","brave","bing"]`), `max_chars_per_source` (500–12000, default 3000), `headless` (default true) | One formatted text block with `[Source N: title — site — url]` markers and extracted main content per source |
| `web_search` | `query`, `limit` (1–20, default 10), `engines`, `headless` | Numbered list of titles + URLs + snippets, deduped across engines |
| `web_fetch` | `url`, `max_chars` (500–12000, default 8000), `no_cache` | Header (title/byline/site/url) + extracted main article text |

## Why these specific tools

**`web_research` is the recommended primary** — local LLMs are much better at making one well-formed tool call than chaining `search → fetch → fetch → fetch`. One call, formatted output, citations baked in.

`web_search` and `web_fetch` exist for power-user flows where the agent wants to triage URLs first or has a known URL it wants to read.

## Build + run

```bash
cd /Users/bmatthews/Code/playwright-search
npm install
npm run build
# Then one of:
node dist/mcp.js                      # production entry (used by opencode.json)
npm run mcp                           # dev (tsx, no build needed)
npm run mcp:start                     # production (built)
```

Verify it works:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"x","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node dist/mcp.js
```

You should see the `tools/list` response with all three tools.

## Register in opencode

Add to your project's `opencode.json` (a working example is in `bpm-opencode-experts/examples/opencode.json`):

```json
{
  "mcp": {
    "playwright-search": {
      "type": "local",
      "command": ["node", "/Users/bmatthews/Code/playwright-search/dist/mcp.js"],
      "enabled": true
    }
  }
}
```

For dev (no build step needed), use tsx:

```json
"command": ["npx", "tsx", "/Users/bmatthews/Code/playwright-search/src/mcp.ts"]
```

opencode is **LLM-agnostic** — once registered, the same tools work whether you're running LM Studio (Qwen, Gemma, Nemotron), Ollama, Anthropic API, or OpenAI.

## Register in Claude Code

Project-level: add `.mcp.json` at the repo root:

```json
{
  "mcpServers": {
    "playwright-search": {
      "command": "node",
      "args": ["/Users/bmatthews/Code/playwright-search/dist/mcp.js"]
    }
  }
}
```

User-level (all projects): add to `~/.claude.json` or via `claude mcp add playwright-search node /Users/bmatthews/Code/playwright-search/dist/mcp.js`.

## Recommended pairing: register the memory MCP alongside

To close the **search → research → remember** loop, register both this MCP and a memory MCP (`claude-memory` or `mempalace`). The agent uses `web_research` for findings, then `memory_store` / `fact_store` to persist them with the source URL.

```json
{
  "mcp": {
    "playwright-search": { ... },
    "claude-memory": {
      "type": "local",
      "command": ["node", "/Users/bmatthews/Code/claude-memory/mcp/memory-server/dist/index.js"],
      "enabled": true
    }
  }
}
```

The researcher agent prompts in both `bpm-opencode-experts/agents/researcher.md` and `claude-experts/agents/researcher.md` are already updated to expect this surface.

## Local-LLM tuning

- **Token budget**: default `max_chars_per_source=3000` per source × 5 sources ≈ 15k tokens of context. Comfortable for a 45k budget. Drop to 1500 for tight budgets, raise to 6000 for premium-context models.
- **Engine selection**: `["ddg","brave","bing"]` is the headless-stable default. Add `"google"` only when running headed (and accept it may be skipped on captcha).
- **Caching**: 24h disk cache at `~/.playwright-search/cache/` — repeat queries within a day are zero-cost. Pass `no_cache: true` on `web_fetch` if you need fresh.
- **Response shape**: all tools return one `text` content block — no JSON-in-JSON, no nested structures. Friendlier for smaller models.

## Operational notes

- Server runs over stdio; no network port to manage.
- One MCP process per host (opencode/Claude Code spawns it on demand and pipes stdin/stdout).
- The persistent Chromium profile at `~/.playwright-search/profile/` is shared across CLI and MCP runs — cookies and consent persist.
- Per-domain rate limit (2–4s) and robots.txt respect are unconditional — no flag to disable in MCP mode (CLI has `--no-robots` for emergencies; MCP doesn't expose it on purpose).
