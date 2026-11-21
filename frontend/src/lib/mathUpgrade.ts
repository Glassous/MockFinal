import katex from 'katex'

const PLACEHOLDER = /<span class="mf-tex" data-tex="([^"]*)" data-display="([01])">[\s\S]*?<\/span>/g

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
}

function decodeEntities(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => ENTITIES[name] ?? _)
}

/**
 * 服务端 page-kit 只输出 `.mf-tex` 占位；阅读器在组装 shell 前用 KaTeX
 * 升级为 MathML（零字体、零外部 CSS），失败时保留公式原文。
 */
export function upgradeMath(html: string): string {
  if (!html.includes('mf-tex')) return html
  return html.replace(PLACEHOLDER, (_match, encoded: string, display: string) => {
    const tex = decodeEntities(encoded)
    try {
      return katex.renderToString(tex, {
        throwOnError: false,
        strict: 'ignore',
        trust: false,
        output: 'mathml',
        displayMode: display === '1',
      })
    } catch {
      return `<span class="mf-tex-error">${encoded}</span>`
    }
  })
}
