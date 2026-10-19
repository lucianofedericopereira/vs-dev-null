// Shared by feed.js and composer.js. DOM is built with textContent only: nothing from the API is parsed as HTML.
const vscode = acquireVsCodeApi();

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function relativeTime(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return iso.slice(0, 10);
}

function link(url, text = url) {
  return el('a', { href: url, onclick: e => { e.preventDefault(); vscode.postMessage({ type: 'browser', url }); } }, text);
}

// dev-null.sh CodeSpans::PATTERN: fenced blocks and inline code; odd split indexes are code.
const CODE = /((?<![^\n])`{3,}[^`\r\n]*\r?\n(?:[\s\S]*?\r?\n)?`{3,}[ \t]*(?![^\r\n])|`[^`\r\n]+`)/;
const URL_RE = /https?:\/\/[^\s<>"]+/g;

function prose(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,!?;:)\]]+$/, '');
    out.push(text.slice(last, m.index), link(url));
    last = m.index + url.length;
  }
  out.push(text.slice(last));
  return out;
}

function body(text) {
  const parts = text.split(CODE);
  const isBlock = p => p !== undefined && p.startsWith('```');
  const nodes = parts.map((part, i) => {
    if (i % 2 === 1) {
      if (!isBlock(part)) return el('code', {}, part.slice(1, -1));
      const lines = part.replace(/\r\n/g, '\n').split('\n');
      const lang = lines[0].replace(/^`+/, '').trim();
      return el('pre', { 'data-lang': lang || undefined }, el('code', {}, lines.slice(1, -1).join('\n')));
    }
    if (isBlock(parts[i - 1])) part = part.replace(/^\r?\n/, '');
    if (isBlock(parts[i + 1])) part = part.replace(/\r?\n$/, '');
    return prose(part);
  });
  return el('div', { class: 'body' }, nodes);
}

function mark() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('class', 'mark');
  svg.innerHTML = '<path class="ink" d="M8 42h9L32 6h-9Z"/><rect class="cursor" x="30.5" y="29.5" width="11" height="11" rx="1"/>';
  return svg;
}
