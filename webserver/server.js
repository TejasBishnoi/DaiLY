const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8000);
function readPrompt(argv) {
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '-prompt' || argv[i] === '--prompt') return argv[i + 1] || '';
    if (argv[i].startsWith('--prompt=')) return argv[i].slice('--prompt='.length);
  }
  return '';
}
const SYSTEM_PROMPT = readPrompt(process.argv);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function decodeHtml(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[lower] || match;
  });
}
function textOnly(html) { return decodeHtml(html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()); }
function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'));
  return match ? decodeHtml(match[1]) : '';
}
function parseDuckDuckGo(html) {
  const anchors = [...html.matchAll(/<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)];
  return anchors.slice(0, 6).map(match => {
    const tag = match[0].slice(0, match[0].indexOf('>') + 1);
    let url = attr(tag, 'href');
    try {
      const parsed = new URL(url, 'https://duckduckgo.com');
      const redirected = parsed.searchParams.get('uddg');
      if (redirected) url = redirected;
    } catch {}
    const tail = html.slice(match.index + match[0].length, match.index + match[0].length + 1800);
    const snippetMatch = tail.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|td|div)>/i);
    return { title: textOnly(match[1]), url, snippet: snippetMatch ? textOnly(snippetMatch[1]) : '' };
  }).filter(result => result.title && /^https?:\/\//i.test(result.url));
}
async function search(query) {
  const upstream = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DaiLY/1.0; +local chat app)' },
    signal: AbortSignal.timeout(12000)
  });
  if (!upstream.ok) throw new Error(`Search provider returned HTTP ${upstream.status}.`);
  const html = await upstream.text();
  const results = parseDuckDuckGo(html);
  if (!results.length) throw new Error('The search provider returned no results. Try again in a moment.');
  return { query, results };
}
async function readJson(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 16_384) throw new Error('Request body is too large.');
  }
  return JSON.parse(data || '{}');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/config' && req.method === 'GET') {
    return send(res, 200, { prompt: SYSTEM_PROMPT });
  }
  if (url.pathname === '/api/search' && req.method === 'POST') {
    try {
      const { query } = await readJson(req);
      if (typeof query !== 'string' || !query.trim()) return send(res, 400, { error: 'Enter a search query.' });
      if (query.length > 500) return send(res, 400, { error: 'Search query is too long.' });
      return send(res, 200, await search(query.trim()));
    } catch (error) {
      return send(res, 502, { error: error.message || 'Web search failed.' });
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' });
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: 'Invalid path.' }); }
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(ROOT, `.${pathname}`);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'Not found.' });
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`DaiLY is available at http://localhost:${PORT}`);
});
