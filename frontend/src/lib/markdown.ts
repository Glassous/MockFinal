import MarkdownIt from 'markdown-it'
import { katex } from '@mdit/plugin-katex'
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'

// markdown-it：禁用原始 HTML（防注入）、开启链接自动识别
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight(str: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
      } catch {
        /* 回退到默认转义 */
      }
    }
    return ''
  },
})

// KaTeX 数学公式（$...$ 行内、$$...$$ 块级），出错时不抛异常
md.use(katex, {
  throwOnError: false,
  delimiters: 'dollars',
})

/** 渲染 Markdown 为经过 DOMPurify 清洗的安全 HTML */
export function renderMarkdown(source: string): string {
  const raw = md.render(source ?? '')
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ['style', 'class', 'aria-hidden', 'target', 'rel'],
  })
}
