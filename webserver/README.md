# DaiLY

Minimal chat frontend for a llama.cpp server, with image upload and an embedded `web_search` function. It does not require an MCP server, SearXNG, API key, or llama.cpp tool configuration.

## Start DaiLY

From this folder, run (quote the prompt so spaces stay together):

```sh
node server.js -prompt "You are a concise research assistant."
```

The `-prompt` argument is optional. If omitted, DaiLY uses its built-in system instructions. The startup prompt is never shown as an editable setting in the UI.

Open `http://localhost:8000`, then use the gear icon to set the base URL for your llama.cpp server. The model must support function/tool calling for web search; start llama.cpp with `--jinja` if needed.

## Search behavior

DaiLY's small Node server provides `/api/search`. It fetches DuckDuckGo's public HTML search page and returns parsed titles, links, and snippets to the frontend. This avoids browser CORS restrictions and does not require a separate search service or paid API key.

Search queries are sent to DuckDuckGo. The search provider is external, free to use, and not an open-source component; the DaiLY integration itself is open source. Search results depend on the provider's availability and HTML format.
