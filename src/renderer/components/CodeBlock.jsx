import React, { useState, useMemo } from 'react';

/**
 * Code block with a copy button and lightweight highlighting.
 *
 * No highlighting library: highlight.js core plus a handful of grammars is ~30 kB gzipped
 * and shiki considerably more, against a renderer bundle currently around 60 kB gzipped.
 * A regex pass over strings, comments, numbers and keywords covers the languages that
 * actually turn up in an interview at zero bundle cost. See docs/BUILD-PLAN.md Phase 5.
 */

const KEYWORDS = [
  // JS/TS
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'new',
  'await', 'async', 'import', 'from', 'export', 'default', 'try', 'catch', 'finally', 'throw',
  'typeof', 'instanceof', 'interface', 'type', 'extends', 'implements', 'public', 'private',
  // Python
  'def', 'elif', 'lambda', 'None', 'True', 'False', 'self', 'yield', 'with', 'as', 'pass',
  'raise', 'except', 'in', 'not', 'and', 'or', 'is', 'global', 'nonlocal',
  // Go / Rust / Java / C-ish
  'func', 'package', 'struct', 'impl', 'fn', 'mut', 'pub', 'match', 'switch', 'case', 'break',
  'continue', 'static', 'void', 'int', 'string', 'bool', 'nil', 'null', 'true', 'false'
];

const KEYWORD_RE = new RegExp(`\\b(${KEYWORDS.join('|')})\\b`, 'g');
const STRING_RE = /("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`)/g;
const COMMENT_RE = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)/g;
const NUMBER_RE = /\b(\d+(\.\d+)?)\b/g;

/** Tokenise without letting one pass corrupt another: strings and comments win. */
function highlight(code) {
  const spans = [];
  const claim = (regex, kind) => {
    let match = regex.exec(code);
    while (match) {
      const start = match.index;
      const end = start + match[0].length;
      if (!spans.some((s) => start < s.end && end > s.start)) {
        spans.push({ start, end, kind });
      }
      match = regex.exec(code);
    }
    regex.lastIndex = 0;
  };

  claim(COMMENT_RE, 'comment');
  claim(STRING_RE, 'string');
  claim(KEYWORD_RE, 'keyword');
  claim(NUMBER_RE, 'number');
  spans.sort((a, b) => a.start - b.start);

  const parts = [];
  let cursor = 0;
  spans.forEach((span, i) => {
    if (span.start > cursor) parts.push(code.slice(cursor, span.start));
    parts.push(
      <span key={`t-${i}`} className={`tok-${span.kind}`}>{code.slice(span.start, span.end)}</span>
    );
    cursor = span.end;
  });
  if (cursor < code.length) parts.push(code.slice(cursor));
  return parts;
}

export default function CodeBlock({ code }) {
  const [copied, setCopied] = useState(false);
  const tokens = useMemo(() => highlight(code), [code]);

  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="code-block-wrap">
      <button type="button" className="code-copy-btn" onClick={copy}>
        {copied ? 'copied' : 'copy'}
      </button>
      <pre className="bubble-code-block"><code>{tokens}</code></pre>
    </div>
  );
}
