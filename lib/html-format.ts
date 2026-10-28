const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

interface Token {
  type: 'tag' | 'text' | 'comment' | 'raw';
  value: string;
  tagName?: string;
  closing?: boolean;
  selfClosing?: boolean;
}

function parseTag(tag: string) {
  const closing = /^<\//.test(tag);
  const selfClosing = /\/>\s*$/.test(tag);
  const nameMatch = tag.match(/^<\/?([\w-]+)/);
  const tagName = nameMatch ? nameMatch[1].toLowerCase() : '';
  return { tagName, closing, selfClosing };
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const s = html.trim();
  let i = 0;

  while (i < s.length) {
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      const stop = end === -1 ? s.length : end + 3;
      tokens.push({ type: 'comment', value: s.slice(i, stop) });
      i = stop;
      continue;
    }

    if (s[i] === '<' && s[i + 1] === '!') {
      const end = s.indexOf('>', i);
      const stop = end === -1 ? s.length : end + 1;
      tokens.push({ type: 'comment', value: s.slice(i, stop) });
      i = stop;
      continue;
    }

    if (s[i] === '<') {
      const tagEnd = s.indexOf('>', i);
      if (tagEnd === -1) {
        tokens.push({ type: 'text', value: s.slice(i) });
        break;
      }
      const tagContent = s.slice(i, tagEnd + 1);
      const nameMatch = tagContent.match(/^<([\w-]+)/);
      const name = nameMatch ? nameMatch[1].toLowerCase() : '';

      if (name === 'script' || name === 'style') {
        const closeTag = `</${name}`;
        const lower = s.toLowerCase();
        const closeIdx = lower.indexOf(closeTag, tagEnd + 1);
        const contentEnd = closeIdx === -1 ? s.length : closeIdx;
        const closeEnd = closeIdx === -1 ? s.length : lower.indexOf('>', closeIdx) + 1;

        tokens.push({ type: 'tag', value: tagContent, tagName: name, closing: false, selfClosing: false });
        const content = s.slice(tagEnd + 1, contentEnd);
        if (content.trim()) tokens.push({ type: 'raw', value: content });
        if (closeIdx !== -1) {
          tokens.push({ type: 'tag', value: s.slice(closeIdx, closeEnd), tagName: name, closing: true, selfClosing: false });
        }
        i = closeEnd === -1 ? s.length : closeEnd;
        continue;
      }

      const parsed = parseTag(tagContent);
      tokens.push({ type: 'tag', value: tagContent, ...parsed });
      i = tagEnd + 1;
      continue;
    }

    const next = s.indexOf('<', i);
    const val = next === -1 ? s.slice(i) : s.slice(i, next);
    if (val.trim()) tokens.push({ type: 'text', value: val.trim() });
    i = next === -1 ? s.length : next;
  }

  return tokens;
}

export function formatHtml(input: string): string {
  const tokens = tokenize(input);
  const lines: string[] = [];
  let indent = 0;
  const push = (text: string) => lines.push('  '.repeat(Math.max(0, indent)) + text);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (t.type === 'comment') {
      push(t.value);
      continue;
    }

    if (t.type === 'text') {
      push(t.value);
      continue;
    }

    if (t.type === 'raw') {
      const content = t.value.replace(/^\n+|\n+$/g, '');
      const rawLines = content.split('\n');
      let minIndent = Infinity;
      for (const rl of rawLines) {
        if (rl.trim()) {
          const ind = rl.length - rl.trimStart().length;
          if (ind < minIndent) minIndent = ind;
        }
      }
      if (minIndent === Infinity) minIndent = 0;
      for (const rl of rawLines) {
        if (!rl.trim()) continue;
        lines.push('  '.repeat(Math.max(0, indent)) + rl.slice(minIndent));
      }
      continue;
    }

    // tag
    if (t.closing) {
      indent = Math.max(0, indent - 1);
      push(t.value);
      continue;
    }

    if (t.selfClosing || VOID_ELEMENTS.has(t.tagName || '')) {
      push(t.value);
      continue;
    }

    const next = tokens[i + 1];
    const after = tokens[i + 2];

    if (
      next && next.type === 'text' && next.value.trim() &&
      after && after.type === 'tag' && after.closing && after.tagName === t.tagName
    ) {
      push(`${t.value}${next.value}${after.value}`);
      i += 2;
      continue;
    }

    if (next && next.type === 'tag' && next.closing && next.tagName === t.tagName) {
      push(`${t.value}${next.value}`);
      i += 1;
      continue;
    }

    push(t.value);
    indent++;
  }

  return lines.join('\n');
}
