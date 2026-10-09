(() => {
  const $ = (s) => document.querySelector(s);
  const conversation = $('#conversation');
  const welcome = $('#welcome');
  const messagesEl = $('#messages');
  const input = $('#messageInput');
  const form = $('#chatForm');
  const sendButton = $('#sendButton');
  const fileInput = $('#imageInput');
  const preview = $('#attachmentPreview');
  const composerWrap = $('.composer-wrap');
  const settingsDialog = $('#settingsDialog');
  const urlInput = $('#serverUrl');
  const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant in DaiLY. Use web_search whenever current facts, news, or research would help. Cite sourced claims inline using markdown links to the exact result URLs. Do not invent citations. If the user shares an image, describe or reason about it when relevant.';
  const SEARCH_TOOL = { type: 'function', function: { name: 'web_search', description: 'Search the public web for current information. Use when the user asks for recent facts, news, or information that may have changed. Return results with titles, URLs, and snippets.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'A concise web search query' } }, required: ['query'] } } };
  let serverUrl = localStorage.getItem('llamaServerUrl') || 'http://localhost:8080';
  let attachment = null;
  let busy = false;
  let history = [];
  urlInput.value = serverUrl;

  function setStatus(state, text) {
    ['#statusDot', '#dialogStatusDot'].forEach(s => { const el = $(s); el.className = `status-dot ${state}`; });
    $('#statusText').textContent = text;
    $('#dialogStatusText').textContent = text === 'connected' ? 'Connected to llama-server' : text === 'checking server' ? 'Checking server…' : 'Not connected';
  }
  async function checkConnection() {
    setStatus('', 'checking server');
    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(3500) });
      if (!response.ok) throw new Error('Server is not ready');
      setStatus('online', 'connected');
      return true;
    } catch (error) {
      setStatus('offline', 'not connected');
      return false;
    }
  }
  async function getModelId() {
    const response = await fetch(`${serverUrl.replace(/\/$/, '')}/v1/models`, { signal: AbortSignal.timeout(3500) });
    if (!response.ok) throw new Error('Could not read the model list from llama-server.');
    const data = await response.json();
    const model = data.data?.[0]?.id;
    if (!model) throw new Error('No model is loaded in llama-server. Load a model, then try again.');
    return model;
  }
  checkConnection();
  $('#settingsButton').addEventListener('click', () => settingsDialog.showModal());
  $('#headerSettings').addEventListener('click', () => settingsDialog.showModal());
  $('#checkConnection').addEventListener('click', async () => { serverUrl = urlInput.value.trim().replace(/\/$/, ''); await checkConnection(); });
  $('#saveSettings').addEventListener('click', () => {
    serverUrl = urlInput.value.trim().replace(/\/$/, '') || 'http://localhost:8080';
    urlInput.value = serverUrl;
    localStorage.setItem('llamaServerUrl', serverUrl);
    setTimeout(checkConnection, 0);
  });
  $('#newChatButton').addEventListener('click', resetChat);
  function resetChat() {
    history = [];
    messagesEl.replaceChildren();
    welcome.hidden = false;
    input.value = '';
    clearAttachment();
    resizeInput();
    input.focus();
  }
  document.querySelectorAll('.suggestion').forEach(button => button.addEventListener('click', () => {
    input.value = button.dataset.prompt;
    resizeInput();
    input.focus();
  }));
  $('#uploadButton').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) setAttachment(fileInput.files[0]); fileInput.value = ''; });
  function setAttachment(file) {
    if (!file.type.startsWith('image/')) return toast('Choose an image file.', true);
    if (file.size > 20 * 1024 * 1024) return toast('Images must be smaller than 20 MB.', true);
    const reader = new FileReader();
    reader.onload = () => {
      attachment = { name: file.name, url: reader.result };
      preview.hidden = false;
      preview.innerHTML = '';
      const chip = document.createElement('span'); chip.className = 'attachment-chip';
      const image = document.createElement('img'); image.src = attachment.url; image.alt = '';
      const name = document.createElement('span'); name.textContent = attachment.name;
      const remove = document.createElement('button'); remove.type = 'button'; remove.setAttribute('aria-label', 'Remove image'); remove.textContent = '×'; remove.addEventListener('click', clearAttachment);
      chip.append(image, name, remove); preview.append(chip);
    };
    reader.readAsDataURL(file);
  }
  function clearAttachment() { attachment = null; preview.replaceChildren(); preview.hidden = true; }
  function resizeInput() { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; }
  input.addEventListener('input', resizeInput);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
  });
  ['dragenter', 'dragover'].forEach(type => composerWrap.addEventListener(type, event => { event.preventDefault(); composerWrap.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(type => composerWrap.addEventListener(type, event => { event.preventDefault(); composerWrap.classList.remove('dragging'); }));
  composerWrap.addEventListener('drop', event => { const file = [...(event.dataTransfer?.files || [])].find(f => f.type.startsWith('image/')); if (file) setAttachment(file); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = input.value.trim();
    if ((!text && !attachment) || busy) return;
    const image = attachment;
    clearAttachment();
    input.value = ''; resizeInput();
    welcome.hidden = true;
    addMessage('user', text, image?.url);
    const content = [];
    if (text) content.push({ type: 'text', text });
    if (image) content.push({ type: 'image_url', image_url: { url: image.url } });
    history.push({ role: 'user', content: content.length === 1 && content[0].type === 'text' ? text : content });
    await runAssistant();
  });

  async function runAssistant() {
    busy = true; sendButton.disabled = true;
    const assistant = addMessage('assistant', '');
    const body = assistant.querySelector('.message-body');
    let typing = document.createElement('div'); typing.className = 'typing'; typing.innerHTML = '<i></i><i></i><i></i>'; body.append(typing);
    let didSearch = false;
    const sources = [];
    try {
      for (let turn = 0; turn < 5; turn++) {
        const payload = {
          model: await getModelId(), messages: [
            { role: 'system', content: [(await getServerSystemPrompt()).trim(), DEFAULT_SYSTEM_PROMPT].filter(Boolean).join('\n\n') },
            ...history
          ], stream: false,
          tools: [SEARCH_TOOL], tool_choice: 'auto'
        };
        const response = await fetch(`${serverUrl.replace(/\/$/, '')}/v1/chat/completions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const detail = await response.text();
          throw new Error(explainError(response.status, detail));
        }
        const data = await response.json();
        const message = data.choices?.[0]?.message;
        if (!message) throw new Error('The server returned an empty response.');
        if (message.tool_calls?.length) {
          history.push({ role: 'assistant', content: message.content || '', tool_calls: message.tool_calls });
          const traces = [];
          for (const call of message.tool_calls) {
            const args = safeJson(call.function.arguments);
            const result = call.function?.name === 'web_search'
              ? await webSearch(args.query || '')
              : { error: 'Only web search is enabled.' };
            didSearch = true;
            traces.push(result);
            for (const source of result.results || []) {
              if (source.url && /^https?:\/\//i.test(source.url) && !sources.some(item => item.url === source.url)) sources.push(source);
            }
            history.push({ role: 'tool', tool_call_id: call.id, content: result.plain_text_response || JSON.stringify(result) });
          }
          typing.remove();
          renderToolTraces(body, traces);
          typing = document.createElement('div'); typing.className = 'typing'; typing.innerHTML = '<i></i><i></i><i></i>'; body.append(typing);
          if (turn === 4) throw new Error('Web search tool loop exceeded the maximum number of rounds.');
          continue;
        }
        history.push({ role: 'assistant', content: message.content || '' });
        typing.remove();
        body.insertAdjacentHTML('beforeend', markdownToHtml(message.content || 'I couldn’t come up with a response.'));
        if (didSearch) { const badge = document.createElement('div'); badge.className = 'search-badge'; badge.textContent = 'Searched the web'; body.prepend(badge); }
        if (sources.length) renderCitations(body, sources);
        break;
      }
    } catch (error) {
      typing.remove();
      const p = document.createElement('p'); p.className = 'stream-error'; p.textContent = error.message || 'Something went wrong.';
      body.append(p);
      toast(error.message || 'Something went wrong.', true);
    } finally {
      typing.remove();
      busy = false; sendButton.disabled = false; input.focus(); conversation.scrollTop = conversation.scrollHeight;
    }
  }
  async function webSearch(query) {
    try {
      const response = await fetch('/api/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(15000)
      });
      const result = await response.json();
      if (!response.ok) return { error: result.error || `Search failed (${response.status}).` };
      return result;
    } catch {
      return { error: 'Could not reach DaiLY’s local search service. Start the app with `node server.js` and open it at http://localhost:8000.' };
    }
  }
  async function getServerSystemPrompt() {
    try {
      const response = await fetch('/api/config');
      if (!response.ok) return '';
      const config = await response.json();
      return typeof config.prompt === 'string' ? config.prompt : '';
    } catch {
      return '';
    }
  }
  function renderToolTraces(parent, traces) {
    traces.forEach(trace => {
      const details = document.createElement('details'); details.className = 'tool-trace'; details.open = true;
      const summary = document.createElement('summary'); summary.textContent = trace.error ? 'Web search unavailable' : `Web search · ${trace.results?.length || 'tool'} results`;
      const content = document.createElement('div'); content.className = 'tool-trace-content';
      if (trace.results?.length) trace.results.forEach(result => {
        const row = document.createElement('div');
        const link = document.createElement('a'); link.href = result.url || '#'; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = result.title;
        row.append(link, document.createTextNode(` — ${result.snippet}`)); content.append(row);
      }); else content.textContent = trace.plain_text_response || trace.error || JSON.stringify(trace);
      details.append(summary, content); parent.append(details);
    });
  }
  function renderCitations(parent, sources) {
    const section = document.createElement('details'); section.className = 'citations';
    const heading = document.createElement('summary'); heading.textContent = `Sources · ${sources.length}`;
    const list = document.createElement('ol');
    sources.forEach(source => {
      const item = document.createElement('li');
      const link = document.createElement('a'); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = source.title || source.url;
      item.append(link);
      if (source.snippet) { const snippet = document.createElement('p'); snippet.textContent = source.snippet; item.append(snippet); }
      list.append(item);
    });
    section.append(heading, list); parent.append(section);
  }
  function addMessage(role, text, imageUrl) {
    const row = document.createElement('article'); row.className = `message ${role}`;
    const mark = document.createElement('div'); mark.className = 'message-mark'; mark.textContent = role === 'assistant' ? '✳' : 'Y';
    const body = document.createElement('div'); body.className = 'message-body';
    if (imageUrl) { const image = document.createElement('img'); image.src = imageUrl; image.className = 'message-image'; image.alt = 'Uploaded image'; body.append(image); }
    if (text) body.insertAdjacentHTML('beforeend', markdownToHtml(text));
    row.append(mark, body); messagesEl.append(row); conversation.scrollTop = conversation.scrollHeight;
    return row;
  }
  function markdownToHtml(value) {
    const escape = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let text = escape(String(value));
    text = text.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return text.split(/\n{2,}/).map(block => block.startsWith('<pre>') ? block : `<p>${block.replace(/\n/g, '<br>')}</p>`).join('');
  }
  function safeJson(text) { try { return JSON.parse(text || '{}'); } catch { return {}; } }
  function explainError(status, detail) {
    if (status === 0) return 'Could not reach llama-server.';
    if (status === 404) return 'Chat endpoint not found. Check that this is a llama.cpp server URL.';
    if (status === 501) return 'This model does not support image input. Try a multimodal model with its projector loaded.';
    if (status === 400) return 'The server rejected the request. Your model may not support tool calling; try starting llama-server with --jinja.';
    try { const parsed = JSON.parse(detail); return parsed.error?.message || parsed.message || `llama-server returned ${status}.`; } catch { return `llama-server returned ${status}.`; }
  }
  function toast(message, error = false) {
    const old = document.querySelector('.toast'); if (old) old.remove();
    const el = document.createElement('div'); el.className = `toast${error ? ' error' : ''}`; el.textContent = message; document.body.append(el);
    setTimeout(() => el.remove(), 3800);
  }
})();
