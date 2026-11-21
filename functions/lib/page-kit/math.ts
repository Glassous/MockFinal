/**
 * 服务端只输出占位标记，由阅读器用 KaTeX 升级为 MathML：
 * 函数运行时因此不需要任何第三方包，CSP 也无需放开外部资源。
 */
export function renderMath(tex: string, display: boolean): string {
  const source = String(tex ?? '').trim();
  if (!source) return '';
  const safe = escapeHtml(source);
  return `<span class="mf-tex" data-tex="${safe}" data-display="${display ? '1' : '0'}">${safe}</span>`;
}

/** 纯结构校验；真正的 TeX 解析交给阅读器里的 KaTeX。 */
export function mathTexError(tex: string): string | null {
  const source = String(tex ?? '').trim();
  if (!source) return '公式为空';
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(source)) return '公式包含控制字符';
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth < 0) return '花括号不匹配';
    }
  }
  if (depth !== 0) return '花括号不匹配';
  const left = source.match(/\\left\b/g)?.length ?? 0;
  const right = source.match(/\\right\b/g)?.length ?? 0;
  if (left !== right) return '\\left 与 \\right 数量不一致';
  const begins = [...source.matchAll(/\\begin\{([^}]+)\}/g)].map((match) => match[1]);
  const ends = [...source.matchAll(/\\end\{([^}]+)\}/g)].map((match) => match[1]);
  if (begins.length !== ends.length) return '\\begin 与 \\end 数量不一致';
  for (let index = 0; index < begins.length; index += 1) {
    if (begins[index] !== ends[index]) return 'LaTeX 环境嵌套不匹配';
  }
  if (/\\$/.test(source)) return '公式以未完成的反斜杠结尾';
  return null;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPlain(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // 模型偶尔写出不成对的 ** 或 `，清掉残留标记，避免把源码符号带上页面
  out = out.replace(/\*\*/g, '').replace(/`/g, '');
  return out.replace(/\r?\n/g, '<br>');
}

/**
 * 行内格式：只允许 **加粗**、`code` 和 $...$ 公式；其余一律转义。
 * 不解析链接、图片、HTML，避免模型输出变成可执行片段。
 */
export function renderInline(text: string): string {
  const source = String(text ?? '');
  if (!source) return '';
  const parts = source.split(/(\$[^$]+\$)/g);
  return parts
    .map((part) => {
      if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
        return renderMath(part.slice(1, -1), false);
      }
      return formatPlain(part);
    })
    .join('');
}

export function renderParagraphs(text: string): string {
  const source = String(text ?? '').trim();
  if (!source) return '';
  return source
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${renderInline(paragraph.trim())}</p>`)
    .join('');
}

/** manifest / teaching 字段用纯文本（保留 $...$ 与 ** 供学习面板渲染）。 */
export function stripInline(text: string): string {
  return String(text ?? '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\r?\n+/g, ' ')
    .trim();
}
