import { BRAVE_SEARCH_API_KEY, BROWSER_UA } from './shared.js';

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(match[1]).trim() : '';
}

function buildSelectorPattern(selector) {
  if (selector.startsWith('#')) {
    const id = selector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`<[^>]+id=["']${id}["'][^>]*>[\\s\\S]*?<\\/[^>]+>`, 'i');
  }
  if (selector.startsWith('.')) {
    const cls = selector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`<[^>]+class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>[\\s\\S]*?<\\/[^>]+>`, 'i');
  }
  const tag = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'i');
}

function detectFormat(url, contentType) {
  if (contentType.includes('application/pdf')) return 'pdf';
  if (contentType.includes('text/csv')) return 'csv';
  if (contentType.includes('application/json')) return 'json';
  if (contentType.includes('text/markdown')) return 'md';
  if (contentType.includes('text/plain')) return 'txt';

  const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'csv') return 'csv';
  if (ext === 'json') return 'json';
  if (ext === 'md' || ext === 'markdown') return 'md';
  return 'txt';
}

function extractPdfText(bytes) {
  let raw = '';
  for (let i = 0; i < bytes.length; i++) {
    raw += String.fromCharCode(bytes[i]);
  }

  const textChunks = [];
  const btEtRegex = /BT\s([\s\S]*?)ET/g;
  let match;
  while ((match = btEtRegex.exec(raw)) !== null) {
    const block = match[1];
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      textChunks.push(tjMatch[1]);
    }

    const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
    let tjArr;
    while ((tjArr = tjArrayRegex.exec(block)) !== null) {
      const inner = tjArr[1];
      const parts = /\(([^)]*)\)/g;
      let part;
      while ((part = parts.exec(inner)) !== null) {
        textChunks.push(part[1]);
      }
    }
  }

  if (textChunks.length === 0) {
    const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
    while ((match = streamRegex.exec(raw)) !== null) {
      const stream = match[1];
      const readable = stream.replace(/[^\x20-\x7e\n\r]/g, ' ').replace(/\s{3,}/g, ' ').trim();
      if (readable.length > 20) {
        textChunks.push(readable);
      }
    }
  }

  return textChunks
    .join(' ')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function webSearchBrave(query, count) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const resp = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': BRAVE_SEARCH_API_KEY,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    throw new Error(`Brave Search API returned ${resp.status}: ${resp.statusText}`);
  }

  const data = await resp.json();
  const results = (data.web?.results || []).slice(0, count).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.description || '',
  }));

  return { results };
}

async function webSearchDuckDuckGo(query, count) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    throw new Error(`DuckDuckGo returned ${resp.status}: ${resp.statusText}`);
  }

  const html = await resp.text();
  const results = [];
  const resultBlocks = html.split(/class="result\s/);
  for (let i = 1; i < resultBlocks.length && results.length < count; i++) {
    const block = resultBlocks[i];
    const linkMatch = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;

    let resultUrl = linkMatch[1] || '';
    const uddgMatch = resultUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) resultUrl = decodeURIComponent(uddgMatch[1]);

    const title = stripHtml(linkMatch[2]);
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : '';

    if (resultUrl && title) {
      results.push({ title, url: resultUrl, snippet });
    }
  }

  return { results };
}

export async function webSearch({ query, count = 5 }) {
  const normalizedCount = Math.min(Math.max(count, 1), 10);
  if (BRAVE_SEARCH_API_KEY) return webSearchBrave(query, normalizedCount);
  return webSearchDuckDuckGo(query, normalizedCount);
}

export async function browseWebpage({ url, selector }) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: ${resp.status} ${resp.statusText}`);
  }

  const html = await resp.text();
  const title = extractTitle(html);

  let content;
  if (selector) {
    const selectorPattern = buildSelectorPattern(selector);
    content = selectorPattern ? (html.match(selectorPattern) ? stripHtml(html.match(selectorPattern)[0]) : stripHtml(html)) : stripHtml(html);
  } else {
    const mainMatch = html.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i);
    content = mainMatch ? stripHtml(mainMatch[2]) : stripHtml(html);
  }

  const MAX_LENGTH = 15000;
  if (content.length > MAX_LENGTH) {
    content = `${content.slice(0, MAX_LENGTH)}\n\n[Content truncated at 15KB]`;
  }

  return { url, title, content, length: content.length };
}

export async function readDocument({ url, format = 'auto' }) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: ${resp.status} ${resp.statusText}`);
  }

  const contentType = resp.headers.get('content-type') || '';
  const resolvedFormat = format === 'auto' ? detectFormat(url, contentType) : format;
  const MAX_LENGTH = 20000;

  if (resolvedFormat === 'pdf') {
    const buffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const content = extractPdfText(bytes).slice(0, MAX_LENGTH);
    return {
      url,
      format: 'pdf',
      content: content || '[Could not extract text from PDF — may be image-based or encrypted]',
      length: content.length,
    };
  }

  let content = await resp.text();
  if (content.length > MAX_LENGTH) {
    content = `${content.slice(0, MAX_LENGTH)}\n\n[Content truncated at 20KB]`;
  }

  return { url, format: resolvedFormat, content, length: content.length };
}
