import katex from 'katex';

const KATEX_OPTIONS = {
  throwOnError: false,
  strict: 'ignore' as const,
  trust: false,
  output: 'mathml' as const,
};

/** 构建时把 LaTeX 转成 MathML：零字体、零外部 CSS、暗色自动继承。 */
export function renderMath(tex: string, display: boolean): string {
  const source = String(tex ?? '').trim();
  if (!source) return '';
  return katex.renderToString(source, {
    ...KATEX_OPTIONS,
    displayMode: Boolean(display),
  });
}

/** 用于内容校验：返回第一条 KaTeX 解析错误，合法时返回 null。 */
export function mathTexError(tex: string): string | null {
  const source = String(tex ?? '').trim();
  if (!source) return '公式为空';
  try {
    katex.renderToString(source, {
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      output: 'mathml',
      displayMode: true,
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
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
