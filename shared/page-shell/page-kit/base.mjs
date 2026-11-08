/**
 * page-kit 2.0 · 基础样式（结构 + 排版 + 组件）
 *
 * 只使用 shell 的 --mp-* token；三个主题只覆盖布局、字号与少量边界，
 * 不改变 DOM 结构。设计实验室通过 data-pg-theme 切换主题。
 */

export const PAGE_KIT_BASE_CSS = `
.pg-page {
  --pg-body-size: 16px;
  --pg-body-lh: 1.75;
  --pg-content: 44rem;
  --pg-rail-w: 18rem;
  --pg-gap: clamp(16px, 2.2vh, 26px);
  --pg-pad-y: clamp(22px, 3.2vh, 44px);
  --pg-pad-x: clamp(22px, 3.4vw, 56px);
  --pg-radius: 16px;
  --pg-font-display: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", "Songti SC", "STSong", "SimSun", Georgia, serif;
  --pg-glass-bg: rgba(255, 255, 255, .58);
  --pg-glass-bg-strong: rgba(255, 255, 255, .78);
  --pg-glass-border: rgba(255, 255, 255, .65);
  --pg-glass-shadow:
    0 24px 60px -30px rgba(15, 15, 20, .45),
    0 2px 8px rgba(15, 15, 20, .05),
    inset 0 1px 0 rgba(255, 255, 255, .85);
  --pg-glass-blur: blur(24px) saturate(120%);

  width: 100%;
  max-width: 1500px;
  margin: 0 auto;
  min-height: 100dvh;
  padding: var(--pg-pad-y) var(--pg-pad-x);
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--pg-rail-w);
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  grid-template-areas:
    "head head"
    "outline outline"
    "main rail"
    "foot foot";
  gap: var(--pg-gap);
  background: var(--mp-panel);
  background:
    radial-gradient(900px 620px at 5% -10%, rgba(20, 20, 26, .09), transparent 62%),
    radial-gradient(680px 480px at 100% 4%, rgba(20, 20, 26, .07), transparent 60%),
    radial-gradient(760px 540px at 86% 62%, rgba(20, 20, 26, .055), transparent 64%),
    linear-gradient(180deg, #fbfbfc, #f0f0f3);
  color: var(--mp-ink);
  font-family: var(--mp-font-sans);
  font-size: var(--pg-body-size);
  line-height: var(--pg-body-lh);
  font-feature-settings: "kern" 1, "liga" 1, "tnum" 1;
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

html[data-mp-theme="dark"] .pg-page {
  --pg-glass-bg: rgba(30, 30, 35, .56);
  --pg-glass-bg-strong: rgba(38, 38, 44, .76);
  --pg-glass-border: rgba(255, 255, 255, .12);
  --pg-glass-shadow:
    0 24px 70px -30px rgba(0, 0, 0, .9),
    0 2px 10px rgba(0, 0, 0, .3),
    inset 0 1px 0 rgba(255, 255, 255, .08);
  background:
    radial-gradient(900px 620px at 5% -10%, rgba(255, 255, 255, .06), transparent 64%),
    radial-gradient(700px 500px at 100% 4%, rgba(255, 255, 255, .05), transparent 62%),
    radial-gradient(760px 540px at 86% 62%, rgba(255, 255, 255, .035), transparent 66%),
    linear-gradient(180deg, #111114, #0b0b0d);
}

html[data-mp-scroll="fit"] .pg-page { height: 100dvh; overflow: hidden; }
html[data-mp-scroll="flow"] .pg-page { height: auto; overflow: visible; }
/* 移动端 shell 会给 #mp-root 直接子元素强制 overflow-x:hidden，会把 overflow-y 计算成 auto；flow 页需覆盖回 visible 以保住 sticky */
html[data-mp-scroll="flow"] #mp-root > .pg-page { overflow: visible !important; }
html[data-mp-scroll="flow"] { scrollbar-width: thin; scrollbar-color: var(--mp-border-strong) transparent; }

.pg-page ::selection { background: var(--mp-invert); color: var(--mp-invert-ink); }
.pg-page :focus-visible { outline: 2px solid var(--mp-invert); outline-offset: 2px; }
.pg-page [data-mp-focus="true"] {
  outline: 2px solid var(--mp-invert);
  outline-offset: 6px;
  border-radius: 8px;
}

/* ---------- 页头 ---------- */
.pg-head { grid-area: head; display: grid; gap: 9px; max-width: 64rem; }
.pg-eyebrow {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .14em;
  color: var(--mp-faint);
}
.pg-title {
  margin: 0;
  font-family: var(--pg-font-display);
  font-size: clamp(30px, 3.1vw, 42px);
  line-height: 1.12;
  letter-spacing: -.018em;
  font-weight: 700;
  color: var(--mp-ink);
  text-wrap: balance;
}
.pg-lede {
  margin: 0;
  max-width: 56ch;
  font-size: clamp(15px, 1.2vw, 17.5px);
  line-height: 1.65;
  color: var(--mp-muted);
  text-wrap: pretty;
}
.pg-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 0;
  margin: 1px 0 0;
  padding: 0;
  list-style: none;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--mp-faint);
}
.pg-meta li { display: inline-flex; align-items: center; gap: 7px; }
.pg-meta li + li::before {
  content: "";
  width: 1px;
  height: 11px;
  margin: 0 12px;
  background: var(--mp-border-strong);
}

/* ---------- 本页路线 ---------- */
.pg-outline {
  grid-area: outline;
  display: grid;
  gap: 7px;
  align-content: start;
  padding: 2px 0 2px 14px;
  border-left: 1px solid var(--mp-border);
  min-width: 0;
}
.pg-outline-label {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .12em;
  color: var(--mp-faint);
}
.pg-outline ol {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 3px;
}
.pg-outline-link {
  display: grid;
  grid-template-columns: 1.2em minmax(0, 1fr);
  gap: 6px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--mp-muted);
  font: inherit;
  font-size: 13px;
  line-height: 1.55;
  text-align: left;
  cursor: pointer;
}
.pg-outline-link:hover { color: var(--mp-ink); }
.pg-outline-link[data-pg-current="true"] { color: var(--mp-ink); font-weight: 600; }
.pg-outline-link[data-pg-current="true"] .pg-outline-index { color: var(--mp-ink); }
.pg-outline-index { color: var(--mp-faint); font-family: var(--mp-font-mono); font-size: 12px; font-variant-numeric: tabular-nums; }

/* ---------- 正文与侧栏 ---------- */
.pg-flow {
  grid-area: main;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: clamp(17px, 2.2vh, 26px);
}
.pg-rail {
  grid-area: rail;
  min-width: 0;
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 14px;
}
html[data-mp-scroll="flow"] .pg-rail { position: sticky; top: 22px; align-self: start; }
.pg-block { min-width: 0; }

/* ---------- 页脚 ---------- */
.pg-foot {
  grid-area: foot;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  padding-top: 12px;
  border-top: 1px solid var(--mp-border);
  font-size: 12px;
  line-height: 1.55;
  color: var(--mp-faint);
}
.pg-source { margin: 0; max-width: 74ch; }
.pg-controls { display: flex; gap: 8px; flex-shrink: 0; }
.pg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 6px 14px;
  border: 1px solid var(--mp-border);
  border-radius: 10px;
  background: var(--mp-panel);
  color: var(--mp-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.pg-btn:hover { border-color: var(--mp-border-strong); background: var(--mp-raised); }
.pg-btn-primary { border-color: var(--mp-invert); background: var(--mp-invert); color: var(--mp-invert-ink); }
.pg-btn-primary:hover { background: var(--mp-invert); color: var(--mp-invert-ink); opacity: .9; }
.pg-btn-sm { min-height: 27px; padding: 3px 10px; border-radius: 8px; font-size: 12px; }
.pg-btn[disabled] { opacity: .4; cursor: not-allowed; }

/* ---------- 文本块 ---------- */
.pg-label {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .11em;
  color: var(--mp-faint);
}
.pg-prose p {
  margin: 0 0 12px;
  max-width: var(--pg-content);
  font-size: var(--pg-body-size);
  line-height: var(--pg-body-lh);
  letter-spacing: .008em;
  overflow-wrap: break-word;
  text-wrap: pretty;
}
.pg-prose-title { margin: 0 0 7px; font-size: 19px; line-height: 1.35; font-weight: 650; letter-spacing: -.012em; }
.pg-prose p:last-child { margin-bottom: 0; }
.pg-prose strong { font-weight: 650; }
.pg-prose code {
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--mp-code-bg);
  font-family: var(--mp-font-mono);
  font-size: .92em;
}

/* ---------- 公式 ---------- */
.pg-formula-wrap { min-width: 0; }
.pg-formula { max-width: 100%; overflow-wrap: anywhere; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin; -webkit-overflow-scrolling: touch; }
.pg-formula-hint { display: none; margin: 5px 0 0; font-size: 12px; line-height: 1.5; color: var(--mp-faint); }
.pg-formula math { font-size: 1.08em; }
.pg-formula math[display="block"] { display: block; margin: 11px 0; }
.pg-formula-block { max-width: var(--pg-content); }
.pg-example-formula,
.pg-check-formula {
  margin: 10px 0 12px;
  padding: 10px 12px;
  border: 1px solid var(--pg-glass-border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--mp-raised) 55%, transparent);
}
.pg-check-formula { margin: 8px 0 10px; }
.pg-page math { font-size: 1.02em; }
.pg-page .pg-formula math { font-size: 1.08em; }
.pg-formula-label { margin-left: 10px; font-size: 12px; color: var(--mp-faint); }

/* ---------- 提示块 ---------- */
.pg-callout {
  max-width: var(--pg-content);
  padding: 10px 0 10px 16px;
  border-left: 2px solid var(--mp-border-strong);
}
.pg-callout h2 { margin: 0 0 6px; font-size: 18px; line-height: 1.35; font-weight: 650; letter-spacing: -.01em; }
.pg-callout p { margin: 0; font-size: calc(var(--pg-body-size) - 1px); line-height: 1.75; }
.pg-callout-key,
.pg-callout-definition,
.pg-callout-theorem {
  padding: 14px 16px;
  border: 1px solid var(--mp-border);
  border-left: 2px solid var(--mp-ink);
  border-radius: 12px;
  background: var(--mp-raised);
}
.pg-callout-pitfall { border-left: 2px solid var(--mp-ink); }
.pg-callout-note { border-left: 1px solid var(--mp-border-strong); }
.pg-callout-note p { color: var(--mp-muted); font-size: 13.5px; }

/* ---------- 例题 ---------- */
.pg-example {
  max-width: calc(var(--pg-content) + 2rem);
  padding: 17px 19px;
  border: 1px solid var(--mp-border);
  border-radius: var(--pg-radius);
  background: var(--mp-panel);
}
.pg-example-problem {
  margin: 8px 0 14px;
  font-size: calc(var(--pg-body-size) + .5px);
  line-height: 1.75;
  font-weight: 550;
}
.pg-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
.pg-step { position: relative; display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 10px; }
.pg-step-index {
  width: 26px; height: 26px;
  display: grid; place-items: center;
  border: 1px solid var(--mp-border-strong);
  border-radius: 50%;
  background: var(--mp-panel);
  color: var(--mp-muted);
  font-family: var(--mp-font-mono);
  font-size: 12px;
}
.pg-step-body { min-width: 0; }
.pg-step-title { margin: 0 0 4px; font-size: 15px; line-height: 1.45; font-weight: 650; }
.pg-step-text { margin: 0; font-size: calc(var(--pg-body-size) - 1px); line-height: 1.75; }
.pg-step-formula { margin: 6px 0 0; }
.pg-step:not(:last-child)::after {
  content: "";
  position: absolute;
  left: 12.5px;
  top: 30px;
  bottom: -14px;
  width: 1px;
  background: var(--mp-border);
}
.pg-answer {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-top: 14px;
  padding: 10px 12px;
  border: 1px solid var(--mp-border-strong);
  border-radius: 10px;
  background: var(--mp-raised);
  font-size: 15px;
  line-height: 1.7;
}
.pg-answer-label { flex-shrink: 0; font-size: 12px; font-weight: 600; letter-spacing: .1em; color: var(--mp-faint); }
.pg-pitfall {
  margin: 12px 0 0;
  padding-left: 12px;
  border-left: 2px solid var(--mp-border-strong);
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--mp-muted);
}

/* ---------- 对照 / 表格 / 小结 ---------- */
.pg-compare { display: grid; gap: 12px; max-width: calc(var(--pg-content) + 2rem); }
.pg-compare-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
.pg-compare-col { min-width: 0; padding: 12px 14px; border: 1px solid var(--mp-border); border-radius: 12px; }
.pg-compare-col h3 { margin: 0 0 7px; font-size: 15.5px; line-height: 1.4; }
.pg-compare-col ul { margin: 0; padding-left: 1.1em; display: grid; gap: 4px; font-size: 14px; line-height: 1.65; color: var(--mp-muted); }
.pg-verdict { margin: 0; padding: 9px 12px; border: 1px solid var(--mp-ink); border-radius: 10px; font-size: 14px; line-height: 1.65; font-weight: 600; }

.pg-table { width: 100%; max-width: calc(var(--pg-content) + 2rem); border-collapse: collapse; table-layout: fixed; font-size: 14px; line-height: 1.6; }
.pg-table th, .pg-table td { padding: 7px 8px; border-bottom: 1px solid var(--mp-border); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.pg-table th { font-size: 12px; font-weight: 600; letter-spacing: .06em; color: var(--mp-faint); }
.pg-table caption { caption-side: bottom; padding-top: 6px; font-size: 12px; color: var(--mp-muted); text-align: left; }

.pg-summary { display: grid; gap: 12px; }
.pg-summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.pg-summary-card { min-width: 0; padding: 12px 14px; border: 1px solid var(--mp-border); border-radius: 12px; }
.pg-summary-card h3 { margin: 0 0 6px; font-size: 14px; line-height: 1.4; }
.pg-summary-card ul { margin: 0; padding-left: 1.1em; display: grid; gap: 4px; font-size: 13.5px; line-height: 1.65; color: var(--mp-muted); }
/* summary 页把「记住/易错/下一步」放进右栏，正文只保留公式与表格，保证 fit 一屏 */
.pg-rail .pg-summary-grid { grid-template-columns: 1fr; }
.pg-rail .pg-summary { gap: 8px; }
.pg-rail .pg-summary-card { padding: 9px 11px; }
.pg-rail .pg-summary-card h3 { margin-bottom: 3px; font-size: 13px; }
.pg-rail .pg-summary-card ul { gap: 2px; font-size: 12.5px; line-height: 1.55; }

/* ---------- 检查 ---------- */
.pg-check {
  max-width: calc(var(--pg-content) + 2rem);
  padding: 16px 18px;
  border: 1px solid var(--mp-border);
  border-radius: var(--pg-radius);
  background: var(--mp-panel);
}
.pg-question { margin: 8px 0 10px; font-size: calc(var(--pg-body-size) + .5px); line-height: 1.7; font-weight: 550; }
.pg-options { display: grid; gap: 8px; }
.pg-option {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--mp-border);
  border-radius: 10px;
  background: var(--mp-panel);
  color: var(--mp-ink);
  font: inherit;
  font-size: 14.5px;
  line-height: 1.6;
  text-align: left;
  cursor: pointer;
}
.pg-option:hover { border-color: var(--mp-border-strong); background: var(--mp-raised); }
.pg-option[data-pg-state="correct"] { border-color: var(--mp-ink); background: var(--mp-raised); }
.pg-option[data-pg-state="wrong"] { border-style: dashed; color: var(--mp-muted); }
.pg-option[data-pg-state="correct"]::after { content: "✓"; margin-left: auto; font-weight: 600; color: var(--mp-ink); }
.pg-option[data-pg-state="wrong"]::after { content: "✕"; margin-left: auto; color: var(--mp-faint); }
.pg-option-key {
  flex-shrink: 0;
  width: 20px; height: 20px;
  display: grid; place-items: center;
  border: 1px solid var(--mp-border-strong);
  border-radius: 6px;
  color: var(--mp-muted);
  font-family: var(--mp-font-mono);
  font-size: 12px;
}
.pg-option[data-pg-state="correct"] .pg-option-key { border-color: var(--mp-ink); background: var(--mp-ink); color: var(--mp-invert-ink); }
.pg-check-result { margin: 10px 0 0; font-size: 13.5px; font-weight: 600; line-height: 1.6; color: var(--mp-ink); }
.pg-explanation {
  margin: 12px 0 0;
  padding: 10px 12px;
  border-left: 2px solid var(--mp-ink);
  background: var(--mp-raised);
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--mp-muted);
}

/* ---------- 图示 ---------- */
.pg-figure {
  margin: 0;
  min-width: 0;
  padding: 12px;
  display: grid;
  gap: 8px;
  border: 1px solid var(--mp-border);
  border-radius: var(--pg-radius);
  background: var(--mp-raised);
}
.pg-figure-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pg-figure-label { font-size: 12px; font-weight: 600; letter-spacing: .1em; color: var(--mp-faint); }
.pg-figure-controls { display: flex; align-items: center; gap: 6px; }
.pg-figure-state { min-width: 2.2em; text-align: center; font-family: var(--mp-font-mono); font-size: 12px; color: var(--mp-faint); }
.pg-figure-svg { display: block; width: 100%; height: auto; max-height: 250px; color: var(--mp-ink); }
.pg-figure svg text { fill: var(--mp-ink); font-family: var(--mp-font-sans); font-size: 14px; }
.pg-figure svg .pg-fig-muted { fill: var(--mp-muted); }
.pg-figure svg .pg-fig-faint { fill: var(--mp-muted); }
.pg-figure svg .pg-fig-line { fill: none; stroke: var(--mp-border-strong); }
.pg-figure svg .pg-fig-ink { fill: none; stroke: var(--mp-ink); stroke-width: 1.4; }
.pg-figure svg .pg-fig-ink-fill { fill: var(--mp-ink); stroke: none; }
.pg-figure svg .pg-fig-grid { fill: none; stroke: var(--mp-border); stroke-width: .6; }
.pg-figure svg .pg-fig-axis { fill: none; stroke: var(--mp-border-strong); stroke-width: 1; }
.pg-figure svg .pg-fig-arrow { fill: var(--mp-ink); stroke: none; }
.pg-figure svg .pg-fig-dashed { stroke-dasharray: 4 4; }
.pg-figure svg .pg-fig-raised { fill: var(--mp-raised); }
.pg-figure svg .pg-fig-panel { fill: var(--mp-panel); }
.pg-figure svg .pg-fig-invert { fill: var(--mp-invert); }
.pg-figure svg .pg-fig-invert-text { fill: var(--mp-invert-ink); }
.pg-figure svg .pg-fig-panel { fill: var(--mp-panel); }
.pg-figure svg circle, .pg-figure svg line, .pg-figure svg path { vector-effect: non-scaling-stroke; }
.pg-figure g[data-pg-state-group] { display: none; }
.pg-figure g[data-pg-state-group][data-pg-active="true"] { display: inline; }
.pg-figure-caption { margin: 0; font-size: 13px; line-height: 1.55; color: var(--mp-muted); }
.pg-figure-takeaway { margin: 0; padding-top: 8px; border-top: 1px dashed var(--mp-border); font-size: 13px; line-height: 1.6; }
.pg-figure-note { margin: 0; font-size: 13px; line-height: 1.6; color: var(--mp-muted); }
.pg-figure-note[hidden] { display: none !important; }

/* ---------- 速查 ---------- */
.pg-quickfacts { padding: 12px 14px; border: 1px solid var(--mp-border); border-radius: var(--pg-radius); background: var(--mp-panel); }
.pg-quickfacts ul { margin: 6px 0 0; padding-left: 1.1em; display: grid; gap: 6px; font-size: 13px; line-height: 1.65; color: var(--mp-muted); }
.pg-quickfacts ul + .pg-label { margin-top: 12px; }
.pg-quickfacts li::marker { color: var(--mp-faint); }
.pg-quick-answer { margin: 6px 0 0; font-size: 13px; line-height: 1.65; color: var(--mp-ink); }

/* ---------- 动效 / 响应式 ---------- */
html[data-mp-reduced-motion="true"] .pg-page *,
html[data-mp-reduced-motion="true"] .pg-page *::before,
html[data-mp-reduced-motion="true"] .pg-page *::after {
  transition: none !important;
  animation: none !important;
}
@media (prefers-reduced-motion: reduce) {
  .pg-page *, .pg-page *::before, .pg-page *::after {
    transition: none !important;
    animation: none !important;
  }
}

@media (max-width: 1120px) {
  .pg-page { --pg-rail-w: 16rem; grid-template-columns: minmax(0, 1fr) var(--pg-rail-w); }
  .pg-title { font-size: clamp(27px, 3.2vw, 36px); }
  .pg-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 960px) {
  .pg-page {
    grid-template-columns: minmax(0, 1fr) !important;
    grid-template-rows: auto auto auto auto auto !important;
    grid-template-areas: "head" "outline" "main" "rail" "foot" !important;
    height: auto !important;
    min-height: 100dvh;
    overflow: visible !important;
    padding: 20px 18px 28px;
    row-gap: 16px;
  }
  .pg-rail, .pg-flow, .pg-outline { position: static !important; }
  .pg-rail { grid-template-columns: 1fr; }
  .pg-outline { display: grid !important; padding-left: 12px; }
  .pg-title { font-size: clamp(26px, 7vw, 34px); }
  .pg-lede { font-size: 15px; }
  .pg-summary-grid, .pg-compare-grid { grid-template-columns: 1fr; }
  .pg-figure-svg { max-height: 300px; }
  .pg-foot { flex-wrap: wrap; align-items: center; }
}

@media (max-width: 600px) {
  .pg-page { --pg-body-size: 16px; --pg-body-lh: 1.8; padding: 18px 14px 24px; }
  .pg-title { font-size: 23px; word-break: keep-all; overflow-wrap: anywhere; }
  .pg-meta { font-size: 12px; gap: 4px 12px; }
  .pg-meta li + li::before { content: none; }
  .pg-formula-wrap[data-pg-scrollable] .pg-formula-hint { display: block; }
  .pg-example { padding: 14px 14px; }
  .pg-check { padding: 14px 14px; }
  .pg-option { font-size: 14px; }
}
`;
