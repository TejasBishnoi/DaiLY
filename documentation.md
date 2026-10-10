# DaiLY documentation

DaiLY is a lightweight HTML/CSS/JavaScript chat frontend for llama.cpp. `server.js` serves the site and provides DaiLY's local web-search API.

## Prompts used

the llama.cpp inference and the 2B para model was installed and initialised without the use of ai

for the UI/Web_serach Server:
**prompts**
1. *i wanna to make a webui type thingy for llama.cpp, very minimal. only few features required.like image upload, text chat, and tool support for only and only web search. (web seach should be default and not be togglable)*
2. *make a landing page, that shows ui like chat gpt upon landing (meaning center option to chat and nothing else like catch me up etc). remove the option of web search. no need to show that its on.*
3. *The plan has changed now, istead of using SearXNG now it will be a client sided web_search via server.js file*
4. *can you create a single python file that starts node server with arrg --prompt "sys prompt" in in web server folder and also start a command "cmd to start the llama server*

## Components

- `index.html` contains the chat interface and settings dialog.
- `style.css` styles the responsive interface.
- `app.js` manages chat history, image upload, llama.cpp requests, search tool calls, and source citations.
- `server.js` serves static files, exposes the local API routes below, and retrieves web results.

## Model inference and chat API

llama.cpp loads and performs inference on the selected **GGUF-format model**. For example:

```sh
llama serve -hf Openbmb/MiniCPM5-2B-GGUF
```

DaiLY communicates with llama.cpp using its OpenAI-compatible HTTP API:

1. `GET /health` checks server availability.
2. `GET /v1/models` retrieves the loaded model ID.
3. `POST /v1/chat/completions` sends the model ID, system message, conversation history, and the `web_search` tool definition. The request uses `stream: false`.
4. If the assistant response contains a tool call, DaiLY executes the search, appends the assistant tool call and a `role: "tool"` result to the history, and sends another chat completion request. This loop supports up to five model turns.

Example request shape:

```json
{
  "model": "model-id-from-v1-models",
  "messages": [
    { "role": "system", "content": "System instructions" },
    { "role": "user", "content": "What changed recently?" }
  ],
  "tools": [{ "type": "function", "function": { "name": "web_search" } }],
  "tool_choice": "auto",
  "stream": false
}
```

The actual `web_search` definition includes a required `query` string parameter. The model must support function/tool calling; use `--jinja` with llama.cpp when needed. DaiLY discovers the model ID rather than assuming a fixed model name.

Image uploads are converted by the browser to data URLs and sent as an OpenAI-compatible `image_url` content part alongside the user's text. Image understanding requires a multimodal GGUF model and its projector to be configured in llama.cpp.

## DaiLY local API

`server.js` listens on `127.0.0.1:8000` by default. Set `PORT` to choose a different port.

### `GET /api/config`

Returns the startup system prompt as JSON. `app.js` combines this prompt with DaiLY's built-in instructions for web search, citations, and image handling.

```json
{ "prompt": "You are a concise research assistant." }
```

### `POST /api/search`

Accepts a JSON body with a search query, limited to 500 characters:

```json
{ "query": "latest llama.cpp release" }
```

The server fetches DuckDuckGo's public HTML search page and extracts up to six results. Successful responses have this shape:

```json
{
  "query": "latest llama.cpp release",
  "results": [
    { "title": "Result title", "url": "https://example.com/page", "snippet": "Result summary" }
  ]
}
```

Invalid queries return HTTP 400; upstream search failures return HTTP 502 with an `error` field.

## Search and citations

DaiLY's `web_search` function is registered in the frontend and passed to llama.cpp with every chat request. When the model calls it, `app.js` sends the query to `POST /api/search`; `server.js` fetches and parses DuckDuckGo results; the results return to the model as a tool response. The model is instructed to cite sources inline with Markdown links, and DaiLY also shows a collapsible **Sources** list beneath the answer.

No MCP server, SearXNG, API key, or separate search service is required. Search needs internet access and sends queries to DuckDuckGo. The integration is free and keyless, but DuckDuckGo is an external, non-open-source search provider, and changes to its HTML may require updating the parser.

## Start DaiLY

Run the Node server from this folder. The startup prompt is optional:

```sh
node server.js --prompt "You are a concise research assistant."
```

Open `http://localhost:8000`, then set the llama.cpp base URL in the gear settings (default: `http://localhost:8080`). Keep llama.cpp running with the GGUF model you want to use.



```text



```
