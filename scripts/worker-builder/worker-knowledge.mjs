/**
 * Worker Knowledge Store
 *
 * Lets users teach their workers company-specific knowledge: text snippets,
 * URLs, files, Q&A pairs. Stored per-worker and injected into the system
 * prompt so the LLM actually knows the business context.
 *
 * No external dependencies — Node.js built-ins only.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = os.homedir();
const NOOTERRA_DIR = path.join(HOME, '.nooterra');
const WORKERS_DIR = path.join(NOOTERRA_DIR, 'workers');

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const MAX_ITEMS = 50;
const MAX_ITEM_BYTES = 100 * 1024;   // 100KB per item
const MAX_CONTEXT_CHARS = 500 * 1024; // 500KB total context

// ---------------------------------------------------------------------------
// HTML stripping (same logic as built-in-tools.mjs)
// ---------------------------------------------------------------------------

function stripHtml(html) {
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function truncateWithWarning(content, maxBytes) {
  if (content.length <= maxBytes) return { content, truncated: false };
  return {
    content: content.slice(0, maxBytes) + '\n\n[truncated — original was ' + content.length + ' characters]',
    truncated: true
  };
}

function csvToTable(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length === 0) return csv;

  const rows = lines.map(line => {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { cells.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    cells.push(current.trim());
    return cells;
  });

  if (rows.length < 2) return csv;

  const header = rows[0];
  const dataRows = rows.slice(1);
  const colWidths = header.map((h, i) => {
    const vals = [h, ...dataRows.map(r => r[i] || '')];
    return Math.max(...vals.map(v => v.length));
  });

  const headerLine = header.map((h, i) => h.padEnd(colWidths[i])).join(' | ');
  const separator = colWidths.map(w => '-'.repeat(w)).join('-+-');
  const bodyLines = dataRows.map(row =>
    row.map((cell, i) => (cell || '').padEnd(colWidths[i] || 0)).join(' | ')
  );

  return [headerLine, separator, ...bodyLines].join('\n');
}

async function fetchUrlText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Nooterra-Worker/1.0 (https://nooterra.com)',
        'Accept': 'text/html,application/json,*/*'
      },
      redirect: 'follow',
      signal: controller.signal
    });
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await response.json();
      return JSON.stringify(json, null, 2);
    }
    const html = await response.text();
    if (contentType.includes('text/html')) {
      return stripHtml(html);
    }
    return html;
  } finally {
    clearTimeout(timeout);
  }
}

function readFileContent(filePath) {
  const resolved = path.resolve(filePath.replace(/^~/, HOME));
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    throw new Error(`Cannot add directory as knowledge: ${resolved}`);
  }

  const ext = path.extname(resolved).toLowerCase();

  switch (ext) {
    case '.csv': {
      const raw = fs.readFileSync(resolved, 'utf-8');
      return csvToTable(raw);
    }
    case '.json': {
      const raw = fs.readFileSync(resolved, 'utf-8');
      try {
        return JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        return raw;
      }
    }
    case '.html':
    case '.htm': {
      const raw = fs.readFileSync(resolved, 'utf-8');
      return stripHtml(raw);
    }
    case '.pdf': {
      // Best-effort text extraction from PDF without external deps.
      // Looks for text between BT/ET markers and parenthesized strings.
      const buf = fs.readFileSync(resolved);
      const raw = buf.toString('latin1');
      const textChunks = [];
      const re = /\(([^)]*)\)/g;
      let m;
      // Extract parenthesized strings from text objects
      const btBlocks = raw.split(/\bBT\b/);
      for (let i = 1; i < btBlocks.length; i++) {
        const block = btBlocks[i].split(/\bET\b/)[0] || '';
        while ((m = re.exec(block)) !== null) {
          const text = m[1].replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\\(/g, '(').replace(/\\\)/g, ')');
          if (text.trim()) textChunks.push(text.trim());
        }
      }
      if (textChunks.length === 0) {
        return '[PDF text extraction found no readable text. Consider converting to .txt first.]';
      }
      return textChunks.join(' ');
    }
    default: {
      // .txt, .md, and everything else — read as UTF-8
      return fs.readFileSync(resolved, 'utf-8');
    }
  }
}

// ---------------------------------------------------------------------------
// KnowledgeStore
// ---------------------------------------------------------------------------

export class KnowledgeStore {
  constructor(workerId) {
    if (!workerId) throw new Error('workerId is required');
    this.workerId = workerId;
    this.knowledgeDir = path.join(WORKERS_DIR, workerId, 'knowledge');
    this.indexPath = path.join(this.knowledgeDir, '_index.json');
    this._ensureDir();
  }

  _ensureDir() {
    ensureDir(this.knowledgeDir);
  }

  _readIndex() {
    if (!fs.existsSync(this.indexPath)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
    } catch {
      return [];
    }
  }

  _writeIndex(items) {
    fs.writeFileSync(this.indexPath, JSON.stringify(items, null, 2));
  }

  _checkItemLimit() {
    const items = this._readIndex();
    if (items.length >= MAX_ITEMS) {
      throw new Error(`Knowledge limit reached: max ${MAX_ITEMS} items per worker. Remove some items first.`);
    }
  }

  _addItem(item, content) {
    this._checkItemLimit();

    const { content: stored, truncated } = truncateWithWarning(content, MAX_ITEM_BYTES);
    const filename = item.filename;
    const filePath = path.join(this.knowledgeDir, filename);

    fs.writeFileSync(filePath, stored, 'utf-8');

    const items = this._readIndex();
    items.push({
      id: item.id,
      type: item.type,
      label: item.label,
      source: item.source || null,
      filename,
      chars: stored.length,
      truncated,
      addedAt: new Date().toISOString()
    });
    this._writeIndex(items);

    return { id: item.id, truncated, chars: stored.length };
  }

  // -------------------------------------------------------------------------
  // Add knowledge
  // -------------------------------------------------------------------------

  async addText(text, label) {
    if (!text || !text.trim()) throw new Error('Text cannot be empty');
    const ts = Date.now();
    const id = `text_${ts}`;
    const filename = `${id}.md`;
    const displayLabel = label || text.slice(0, 60).replace(/\n/g, ' ').trim();

    return this._addItem(
      { id, type: 'text', label: displayLabel, filename },
      text.trim()
    );
  }

  async addUrl(url) {
    if (!url) throw new Error('URL is required');
    const ts = Date.now();
    const slug = slugify(new URL(url).hostname + '-' + new URL(url).pathname);
    const id = `url_${slug}_${ts}`;
    const filename = `${id}.md`;

    const content = await fetchUrlText(url);
    if (!content || !content.trim()) {
      throw new Error(`No readable content found at ${url}`);
    }

    return this._addItem(
      { id, type: 'url', label: url, source: url, filename },
      content.trim()
    );
  }

  async addFile(filePath) {
    if (!filePath) throw new Error('File path is required');
    const resolved = path.resolve(filePath.replace(/^~/, HOME));
    const basename = path.basename(resolved, path.extname(resolved));
    const ts = Date.now();
    const slug = slugify(basename);
    const id = `file_${slug}_${ts}`;
    const filename = `${id}.md`;

    const content = readFileContent(filePath);
    if (!content || !content.trim()) {
      throw new Error(`No readable content in ${filePath}`);
    }

    return this._addItem(
      { id, type: 'file', label: path.basename(resolved), source: resolved, filename },
      content.trim()
    );
  }

  async addQA(question, answer) {
    if (!question || !question.trim()) throw new Error('Question is required');
    if (!answer || !answer.trim()) throw new Error('Answer is required');
    const ts = Date.now();
    const id = `qa_${ts}`;
    const filename = `${id}.md`;

    const content = `Q: ${question.trim()}\nA: ${answer.trim()}`;
    const label = question.slice(0, 60).replace(/\n/g, ' ').trim();

    return this._addItem(
      { id, type: 'qa', label, filename },
      content
    );
  }

  // -------------------------------------------------------------------------
  // Retrieve knowledge
  // -------------------------------------------------------------------------

  getAll() {
    const items = this._readIndex();
    const parts = [];
    for (const item of items) {
      const fp = path.join(this.knowledgeDir, item.filename);
      if (!fs.existsSync(fp)) continue;
      parts.push(fs.readFileSync(fp, 'utf-8'));
    }
    return parts.join('\n\n---\n\n');
  }

  getItems() {
    return this._readIndex();
  }

  getItem(id) {
    const items = this._readIndex();
    const meta = items.find(i => i.id === id);
    if (!meta) return null;
    const fp = path.join(this.knowledgeDir, meta.filename);
    if (!fs.existsSync(fp)) return null;
    return {
      ...meta,
      content: fs.readFileSync(fp, 'utf-8')
    };
  }

  search(query) {
    if (!query || !query.trim()) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const items = this._readIndex();
    const results = [];

    for (const item of items) {
      const fp = path.join(this.knowledgeDir, item.filename);
      if (!fs.existsSync(fp)) continue;
      const content = fs.readFileSync(fp, 'utf-8').toLowerCase();
      const labelLower = (item.label || '').toLowerCase();
      const score = terms.reduce((acc, term) => {
        if (content.includes(term)) acc += 1;
        if (labelLower.includes(term)) acc += 2;
        return acc;
      }, 0);

      if (score > 0) {
        results.push({ ...item, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  // -------------------------------------------------------------------------
  // Manage
  // -------------------------------------------------------------------------

  remove(id) {
    const items = this._readIndex();
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) return false;

    const item = items[idx];
    const fp = path.join(this.knowledgeDir, item.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);

    items.splice(idx, 1);
    this._writeIndex(items);
    return true;
  }

  clear() {
    const items = this._readIndex();
    for (const item of items) {
      const fp = path.join(this.knowledgeDir, item.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    this._writeIndex([]);
    return items.length;
  }

  getStats() {
    const items = this._readIndex();
    let totalChars = 0;
    const sources = { text: 0, url: 0, file: 0, qa: 0 };

    for (const item of items) {
      totalChars += item.chars || 0;
      if (sources[item.type] !== undefined) sources[item.type]++;
    }

    return {
      itemCount: items.length,
      maxItems: MAX_ITEMS,
      totalChars,
      maxChars: MAX_CONTEXT_CHARS,
      sources,
      nearLimit: items.length >= MAX_ITEMS - 5 || totalChars >= MAX_CONTEXT_CHARS * 0.8
    };
  }

  // -------------------------------------------------------------------------
  // System prompt injection
  // -------------------------------------------------------------------------

  buildContext(maxChars) {
    const limit = maxChars || MAX_CONTEXT_CHARS;
    const items = this._readIndex();
    if (items.length === 0) return '';

    const sections = [];
    let totalChars = 0;
    let skippedCount = 0;

    for (const item of items) {
      const fp = path.join(this.knowledgeDir, item.filename);
      if (!fs.existsSync(fp)) continue;

      const content = fs.readFileSync(fp, 'utf-8');

      if (totalChars + content.length > limit) {
        skippedCount++;
        continue;
      }

      let heading = item.label || item.id;
      if (item.source) heading += ` (from ${item.source})`;

      sections.push(`### ${heading}\n${content}`);
      totalChars += content.length;
    }

    if (sections.length === 0) return '';

    let output = '## Company Knowledge\n\n' + sections.join('\n\n');

    if (skippedCount > 0) {
      output += `\n\n_[${skippedCount} additional knowledge item(s) omitted due to size limits]_`;
    }

    return output;
  }
}

// ---------------------------------------------------------------------------
// Input parser — determines type from raw user input
// ---------------------------------------------------------------------------

export async function addKnowledgeFromInput(store, input) {
  if (!input || !input.trim()) {
    throw new Error('No input provided');
  }

  const trimmed = input.trim();

  // URL detection
  if (/^https?:\/\//i.test(trimmed)) {
    return { type: 'url', result: await store.addUrl(trimmed) };
  }

  // File path detection (starts with /, ~/, or ./)
  if (/^(\/|~\/|\.\/)/.test(trimmed) || /\.(txt|md|pdf|csv|json|html|htm)$/i.test(trimmed)) {
    const resolved = path.resolve(trimmed.replace(/^~/, HOME));
    if (fs.existsSync(resolved)) {
      return { type: 'file', result: await store.addFile(trimmed) };
    }
  }

  // Otherwise treat as plain text
  return { type: 'text', result: await store.addText(trimmed) };
}

export default { KnowledgeStore, addKnowledgeFromInput };
