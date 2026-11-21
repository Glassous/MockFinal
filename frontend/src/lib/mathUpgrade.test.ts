import { describe, expect, it } from 'vitest'
import { upgradeMath } from './mathUpgrade'

describe('upgradeMath', () => {
  it('把 mf-tex 占位升级为 MathML', () => {
    const html = '<p>令 <span class="mf-tex" data-tex="z^2+1" data-display="0">z^2+1</span></p>'
    const upgraded = upgradeMath(html)
    expect(upgraded).not.toContain('mf-tex')
    expect(upgraded).toContain('<math')
  })

  it('还原被转义的公式源码', () => {
    const html = '<span class="mf-tex" data-tex="a &lt; b" data-display="1">a &lt; b</span>'
    const upgraded = upgradeMath(html)
    expect(upgraded).toContain('<math')
    expect(upgraded).toContain('a')
  })

  it('没有占位时原样返回', () => {
    expect(upgradeMath('<p>纯文本</p>')).toBe('<p>纯文本</p>')
  })
})
