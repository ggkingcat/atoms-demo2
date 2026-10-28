'use client';

import { useMemo, useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  Pencil,
  Code2,
  GitBranch,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatHtml as formatHtmlInline } from '@/lib/html-format';

type Mode = 'formatted' | 'dom' | 'edit';

interface DomNode {
  tag: string;
  attrs: { name: string; value: string }[];
  children: DomNode[];
  text?: string;
  comment?: boolean;
  raw?: string;
  isRaw?: boolean;
}

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

function parseAttrs(tagStr: string): { name: string; value: string }[] {
  const attrs: { name: string; value: string }[] = [];
  const re = /([\w-:]+)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)')?/g;
  let m: RegExpExecArray | null;
  const inner = tagStr.replace(/^<\/?/, '').replace(/\/?>$/, '').trim();
  const tagMatch = inner.match(/^[\w-]+/);
  const rest = tagMatch ? inner.slice(tagMatch[0].length) : inner;
  while ((m = re.exec(rest)) !== null) {
    if (m[1]) attrs.push({ name: m[1], value: m[2] ?? m[3] ?? '' });
  }
  return attrs;
}

function buildDom(html: string): DomNode[] {
  const nodes: DomNode[] = [];
  const stack: DomNode[] = [];
  let pos = 0;
  const s = html.trim();

  function pushChild(node: DomNode) {
    if (stack.length) stack[stack.length - 1].children.push(node);
    else nodes.push(node);
  }

  while (pos < s.length) {
    if (s.startsWith('<!--', pos)) {
      const end = s.indexOf('-->', pos + 4);
      const stop = end === -1 ? s.length : end + 3;
      pushChild({ tag: '#comment', attrs: [], children: [], comment: true, raw: s.slice(pos, stop) });
      pos = stop;
      continue;
    }

    if (s[pos] === '<' && s[pos + 1] === '!') {
      const end = s.indexOf('>', pos);
      const stop = end === -1 ? s.length : end + 1;
      pushChild({ tag: '#doctype', attrs: [], children: [], raw: s.slice(pos, stop) });
      pos = stop;
      continue;
    }

    if (s[pos] === '<') {
      const tagEnd = s.indexOf('>', pos);
      if (tagEnd === -1) {
        const txt = s.slice(pos);
        if (txt.trim()) pushChild({ tag: '#text', attrs: [], children: [], text: txt.trim() });
        break;
      }
      const tagStr = s.slice(pos, tagEnd + 1);
      const closing = /^<\//.test(tagStr);
      const selfClosing = /\/>\s*$/.test(tagStr);
      const nameMatch = tagStr.match(/^<\/?([\w-]+)/);
      const name = nameMatch ? nameMatch[1].toLowerCase() : '';

      if (name === 'script' || name === 'style') {
        const closeTag = `</${name}`;
        const lower = s.toLowerCase();
        const closeIdx = lower.indexOf(closeTag, tagEnd + 1);
        const contentEnd = closeIdx === -1 ? s.length : closeIdx;
        const closeEnd = closeIdx === -1 ? s.length : lower.indexOf('>', closeIdx) + 1;
        const rawContent = s.slice(tagEnd + 1, contentEnd);
        const node: DomNode = {
          tag: name,
          attrs: parseAttrs(tagStr),
          children: [],
          raw: rawContent,
          isRaw: true,
        };
        pushChild(node);
        pos = closeEnd === -1 ? s.length : closeEnd;
        continue;
      }

      if (closing) {
        const top = [...stack].reverse().find((n) => n.tag === name);
        if (top) {
          while (stack.length && stack[stack.length - 1] !== top) stack.pop();
          if (stack.length) stack.pop();
        }
        pos = tagEnd + 1;
        continue;
      }

      const node: DomNode = { tag: name, attrs: parseAttrs(tagStr), children: [] };
      pushChild(node);
      pos = tagEnd + 1;

      if (!selfClosing && !VOID.has(name)) {
        stack.push(node);
      }
      continue;
    }

    const next = s.indexOf('<', pos);
    const txt = (next === -1 ? s.slice(pos) : s.slice(pos, next)).trim();
    if (txt) pushChild({ tag: '#text', attrs: [], children: [], text: txt });
    pos = next === -1 ? s.length : next;
  }

  return nodes;
}

function syntaxHighlight(html: string): { html: string } {
  const escaped = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const highlighted = escaped
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="text-slate-400 italic">$1</span>')
    .replace(/(&lt;\/?)([\w-]+)/g, '$1<span class="text-blue-600">$2</span>')
    .replace(/([\w-:]+)(=)(&quot;|&#39;|")/g, '<span class="text-emerald-700">$1</span>$2$3')
    .replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="text-amber-700">$1</span>')
    .replace(/(\/?&gt;)/g, '<span class="text-slate-400">$1</span>');

  return { html: highlighted };
}

function DomRow({ node, depth }: { node: DomNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);

  if (node.comment) {
    return (
      <div style={{ paddingLeft: depth * 20 }} className="py-0.5 font-mono text-xs italic text-slate-500">
        {node.raw}
      </div>
    );
  }

  if (node.tag === '#doctype') {
    return (
      <div style={{ paddingLeft: depth * 20 }} className="py-0.5 font-mono text-xs text-slate-500">
        {node.raw}
      </div>
    );
  }

  if (node.tag === '#text') {
    if (!node.text) return null;
    return (
      <div style={{ paddingLeft: depth * 20 }} className="py-0.5 font-mono text-xs text-slate-600">
        {node.text.length > 60 ? node.text.slice(0, 60) + '…' : node.text}
      </div>
    );
  }

  const hasChildren = node.children.length > 0 || node.isRaw;
  const attrStr = node.attrs
    .map((a) => `<span class="text-emerald-700">${a.name}</span><span class="text-slate-500">=</span><span class="text-amber-700">"${a.value}"</span>`)
    .join(' ');

  return (
    <div>
      <div
        style={{ paddingLeft: depth * 20 }}
        className="flex items-start gap-1 py-0.5 font-mono text-xs"
      >
        {hasChildren ? (
          <button
            onClick={() => setOpen((v) => !v)}
            className="mt-0.5 shrink-0 text-slate-400 hover:text-slate-700"
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="mt-0.5 inline-block w-3 shrink-0" />
        )}
        <span className="break-all">
          <span className="text-slate-500">&lt;</span>
          <span className="text-blue-600">{node.tag}</span>
          {attrStr && <span> {attrStr}</span>}
          <span className="text-slate-500">&gt;</span>
        </span>
      </div>

      {open && node.isRaw && node.raw && (
        <pre
          style={{ paddingLeft: (depth + 1) * 20 }}
          className="whitespace-pre-wrap py-1 font-mono text-[11px] leading-relaxed text-slate-600"
        >
          {node.raw.trim()}
        </pre>
      )}

      {open && hasChildren && !node.isRaw && (
        <div>
          {node.children.map((child, idx) => (
            <DomRow key={idx} node={child} depth={depth + 1} />
          ))}
        </div>
      )}

      {open && hasChildren && !node.isRaw && node.tag !== '#text' && (
        <div style={{ paddingLeft: depth * 20 }} className="py-0.5 font-mono text-xs">
          <span className="text-slate-500">&lt;/</span>
          <span className="text-blue-600">{node.tag}</span>
          <span className="text-slate-500">&gt;</span>
        </div>
      )}
    </div>
  );
}

interface Props {
  code: string;
  onChange: (val: string) => void;
  readOnly?: boolean;
}

export default function CodeView({ code, onChange, readOnly }: Props) {
  const [mode, setMode] = useState<Mode>('formatted');
  const [copied, setCopied] = useState(false);

  const formatted = useMemo(() => {
    if (!code.trim()) return '';
    try {
      return formatHtmlInline(code);
    } catch {
      return code;
    }
  }, [code]);

  const domNodes = useMemo(() => {
    if (!code.trim()) return [];
    try {
      return buildDom(code);
    } catch {
      return [];
    }
  }, [code]);

  const highlighted = useMemo(() => syntaxHighlight(formatted), [formatted]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatted || code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="inline-flex rounded-md bg-slate-100 p-0.5">
          <button
            onClick={() => setMode('formatted')}
            className={cn(
              'flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition',
              mode === 'formatted' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-800'
            )}
          >
            <Code2 className="h-3 w-3" /> 格式化
          </button>
          <button
            onClick={() => setMode('dom')}
            className={cn(
              'flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition',
              mode === 'dom' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-800'
            )}
          >
            <GitBranch className="h-3 w-3" /> DOM 树
          </button>
          <button
            onClick={() => setMode('edit')}
            className={cn(
              'flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition',
              mode === 'edit' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-800'
            )}
          >
            <Pencil className="h-3 w-3" /> 编辑
          </button>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={copy}
          className="h-7 gap-1 px-2 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? '已复制' : '复制'}
        </Button>
      </div>

      {mode === 'formatted' && (
        <pre
          className="flex-1 overflow-auto rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs leading-relaxed text-slate-800"
          dangerouslySetInnerHTML={{ __html: highlighted.html || '<span class="text-slate-400">暂无代码</span>' }}
        />
      )}

      {mode === 'dom' && (
        <div className="flex-1 overflow-auto rounded-lg border border-slate-200 bg-white p-3">
          {domNodes.length === 0 ? (
            <p className="font-mono text-xs text-slate-400">暂无代码</p>
          ) : (
            domNodes.map((node, idx) => <DomRow key={idx} node={node} depth={0} />)
          )}
        </div>
      )}

      {mode === 'edit' && (
        <Textarea
          value={code}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          spellCheck={false}
          className="flex-1 resize-none rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs leading-relaxed text-slate-800"
          placeholder="可直接编辑代码，编辑后点「重新预览」生效。"
        />
      )}
    </div>
  );
}


