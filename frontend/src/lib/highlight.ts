// highlight.js 深浅两套主题，随 html.dark 动态切换 <link>（避免两套样式同时生效）
import lightUrl from 'highlight.js/styles/github.css?url'
import darkUrl from 'highlight.js/styles/github-dark.css?url'

const LINK_ID = 'mockfinal-hljs-theme'

export function applyHighlightTheme(dark: boolean): void {
  let link = document.getElementById(LINK_ID) as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.id = LINK_ID
    link.rel = 'stylesheet'
    document.head.appendChild(link)
  }
  const target = dark ? darkUrl : lightUrl
  if (link.getAttribute('href') !== target) {
    link.href = target
  }
}
