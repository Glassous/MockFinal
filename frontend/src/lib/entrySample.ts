export interface EntryPagePoint {
  title: string
  text: string
  done?: boolean
}

export interface EntryPage {
  id: string
  role: string
  pageNo: string
  title: string
  lede: string
  formula?: string
  points: EntryPagePoint[]
  note: string
  takeaway: string
}

export const residueFormula =
  '\\oint_C f(z)\\,dz=2\\pi i\\sum_{k=1}^{n}\\operatorname{Res}(f,z_k)'

export const residueExampleFormula =
  'I=\\oint_{|z|=3}\\frac{z^2+1}{(z-1)(z+2)(z-4)}\\,dz'

export const samplePages: EntryPage[] = [
  {
    id: 'concept',
    role: '概念',
    pageNo: '02',
    title: '留数：圈内奇点的一个数',
    lede: '留数把奇点附近的局部行为压成一个系数；围道积分只关心圈内的那些。',
    formula:
      '\\operatorname{Res}(f,z_0)=\\frac{1}{2\\pi i}\\oint_{|z-z_0|=\\varepsilon} f(z)\\,dz',
    points: [
      { title: '先找奇点', text: '分母为零的点，先全部列出来。' },
      { title: '只看圈内', text: '曲线外面的奇点不贡献积分。', done: true },
      { title: '一阶极点', text: '用极限 (z−z₀)f(z) 直接求。' },
    ],
    note: '圈内才算',
    takeaway: '留数只看圈内。',
  },
  {
    id: 'mechanism',
    role: '机制',
    pageNo: '03',
    title: '为什么圈外不算？',
    lede: '围道把平面分成内外两部分；解析区内没有奇点，积分就不会留下贡献。',
    formula:
      '\\oint_C f(z)\\,dz=2\\pi i\\sum_{z_k\\in \\operatorname{int}C}\\operatorname{Res}(f,z_k)',
    points: [
      { title: '曲线定向', text: '正向是逆时针；反向要加负号。' },
      { title: '奇点在线上', text: '定理不适用，先绕开或换围道。' },
      { title: '圈外奇点', text: '不进入求和，直接划掉。', done: true },
    ],
    note: '方向别忘',
    takeaway: '圈外奇点，不贡献。',
  },
  {
    id: 'example',
    role: '例题',
    pageNo: '04',
    title: '留数定理：积分变留数求和',
    lede: '先找奇点，再判断谁在圈内；圈内的留数求和乘 2πi，圈外一律不算。',
    formula: residueExampleFormula,
    points: [
      { title: '找奇点', text: '1、−2、4 三个一阶极点。' },
      { title: '判内外', text: '1、−2 在 |z|=3 内；4 在圈外。', done: true },
      { title: '求圈内留数', text: 'Res(f,1)=−2/9，Res(f,−2)=5/18。' },
      { title: '求和乘 2πi', text: 'I=2πi·(1/18)=πi/9。' },
    ],
    note: '圈外不算',
    takeaway: '先判内外，再乘 2πi。',
  },
  {
    id: 'practice',
    role: '练习',
    pageNo: '05',
    title: '先判内外，再动笔',
    lede: '计算前先画圈；把圈外的奇点划掉，能少算一半。',
    formula: 'I=\\oint_{|z|=2}\\frac{1}{z(z-3)}\\,dz',
    points: [
      { title: '列奇点', text: 'z=0 与 z=3。' },
      { title: '判内外', text: '只有 z=0 在 |z|=2 内。', done: true },
      { title: '求留数', text: 'Res(f,0)=−1/3。' },
      { title: '写答案', text: 'I=2πi·(−1/3)=−2πi/3。' },
    ],
    note: '只算圈内',
    takeaway: '圈外划掉，少算一半。',
  },
  {
    id: 'summary',
    role: '小结',
    pageNo: '06',
    title: '离开这页前的三个检查',
    lede: '方向、内外、阶数，三件事都对，留数定理就不会用错。',
    points: [
      { title: '曲线方向', text: '反向加负号。' },
      { title: '奇点位置', text: '在曲线上时，定理不适用。', done: true },
      { title: '极点阶数', text: '二阶及以上用导数公式。' },
    ],
    note: '三查',
    takeaway: '方向、内外、阶数，三查。',
  },
]

export const processSteps = [
  {
    id: 'split',
    index: '01',
    title: '分节',
    desc: '按知识点切开长资料，每一节都留出处。',
    input: '1 份课程资料',
    output: '4 节 · 3 考点',
  },
  {
    id: 'mark',
    index: '02',
    title: '批注',
    desc: '标出目标、例题、易错点；圈外的东西划掉。',
    input: '4 节原文',
    output: '12 处批注',
  },
  {
    id: 'bind',
    index: '03',
    title: '装订',
    desc: '复习讲义与模拟卷分开装订，答案不混在一起。',
    input: '批注稿',
    output: '2 册成品',
  },
] as const

export type ProcessStepId = (typeof processSteps)[number]['id']

export const reviewOutline = [
  '考纲概览',
  '核心概念',
  '重点公式',
  '易错点',
  '记忆口诀',
  '复习优先级',
]

export const examOutline = ['选择题', '填空题', '简答题', '综合题', '参考答案与解析']

export interface EntryQuestionOption {
  id: string
  label: string
  text: string
}

export const sampleQuestion = {
  label: '模拟考试 · 第三大题 · 15 分',
  stem: '下列积分中，C 取正向；判断哪一项正确。',
  stemFormula: residueExampleFormula,
  options: [
    { id: 'a', label: 'A', text: 'z=4 也要计入留数' },
    { id: 'b', label: 'B', text: '只有 1 和 −2 的留数贡献，I=πi/9' },
    { id: 'c', label: 'C', text: '三个奇点都在圈内，I=2πi∑Res' },
  ] satisfies EntryQuestionOption[],
  answer: 'b',
  explanation:
    '|4|>3，z=4 在圈外；圈内留数和为 −2/9+5/18=1/18，所以 I=2πi·1/18=πi/9。',
}

export const sourceQuote = {
  text: '先判内外，再算留数；圈外奇点直接划掉。',
  source: '《复变函数攻略》3.3 留数定理',
}
