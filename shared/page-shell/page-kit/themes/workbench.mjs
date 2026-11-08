/**
 * 主题 B · 工作台型：左路线 + 中正文 + 右速查/图示，两侧 sticky。
 * 目标：高密度、可扫读的复习工作台，图示和速查是工具而不是主角。
 */

export const WORKBENCH_CSS = `
.pg-page[data-pg-theme="workbench"] {
  --pg-body-size: 16px;
  --pg-body-lh: 1.75;
  --pg-content: 46rem;
  --pg-rail-w: 20rem;
  grid-template-columns: 11rem minmax(0, 1fr) 20rem;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  grid-template-areas:
    "head head head"
    "outline main rail"
    "outline main rail"
    "foot foot foot";
  column-gap: clamp(16px, 2vw, 28px);
  row-gap: var(--pg-gap);
  padding-top: 22px;
}

html[data-mp-scroll="fit"] .pg-page[data-pg-theme="workbench"] {
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-areas:
    "head head head"
    "outline main rail"
    "foot foot foot";
}

.pg-page[data-pg-theme="workbench"] .pg-head {
  gap: 7px;
  max-width: none;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--mp-border);
}
.pg-page[data-pg-theme="workbench"] .pg-title { font-size: clamp(30px, 2.7vw, 38px); }
.pg-page[data-pg-theme="workbench"] .pg-prose-title,
.pg-page[data-pg-theme="workbench"] .pg-callout h2 {
  font-family: var(--pg-font-display);
  font-weight: 600;
  letter-spacing: 0;
}
.pg-page[data-pg-theme="workbench"] .pg-lede { font-size: 15.5px; line-height: 1.7; max-width: 48rem; }

.pg-page[data-pg-theme="workbench"] .pg-outline {
  position: sticky;
  top: 18px;
  align-self: start;
  z-index: 5;
  padding: 14px 16px;
  border: 1px solid var(--pg-glass-border);
  border-radius: 16px;
  background: var(--pg-glass-bg);
  -webkit-backdrop-filter: var(--pg-glass-blur);
  backdrop-filter: var(--pg-glass-blur);
  box-shadow: var(--pg-glass-shadow);
}
.pg-page[data-pg-theme="workbench"] .pg-outline-link { font-size: 13px; line-height: 1.6; }
.pg-page[data-pg-theme="workbench"] .pg-outline-index { font-size: 12px; }

.pg-page[data-pg-theme="workbench"] .pg-flow { gap: 16px; max-width: 46rem; }
.pg-page[data-pg-theme="workbench"] .pg-prose p { font-size: 16px; line-height: 1.82; }
.pg-page[data-pg-theme="workbench"] .pg-rail { position: sticky; top: 20px; align-self: start; gap: 12px; }

/* 工作台用紧凑卡片承载讲解块 */
.pg-page[data-pg-theme="workbench"] .pg-callout-key,
.pg-page[data-pg-theme="workbench"] .pg-callout-definition,
.pg-page[data-pg-theme="workbench"] .pg-callout-theorem,
.pg-page[data-pg-theme="workbench"] .pg-callout-pitfall {
  padding: 12px 14px;
  border: 1px solid var(--mp-border);
  border-left: 2px solid var(--mp-ink);
  border-radius: 12px;
  background: var(--mp-panel);
}
.pg-page[data-pg-theme="workbench"] .pg-callout-key { border-left: 2px solid var(--mp-ink); }
.pg-page[data-pg-theme="workbench"] .pg-callout h2 { font-size: 17px; }
.pg-page[data-pg-theme="workbench"] .pg-callout p { font-size: 15px; line-height: 1.78; }

.pg-page[data-pg-theme="workbench"] .pg-example {
  padding: 16px 18px;
  border-radius: 14px;
}
.pg-page[data-pg-theme="workbench"] .pg-example-problem { font-size: 16px; margin: 6px 0 12px; }
.pg-page[data-pg-theme="workbench"] .pg-step-title { font-size: 15px; }
.pg-page[data-pg-theme="workbench"] .pg-step-text { font-size: 15px; line-height: 1.78; }
.pg-page[data-pg-theme="workbench"] .pg-steps { gap: 12px; }
.pg-page[data-pg-theme="workbench"] .pg-step { scroll-margin-top: 24px; }
.pg-page[data-pg-theme="workbench"] .pg-step:not(:last-child)::after { bottom: -12px; }

.pg-page[data-pg-theme="workbench"] .pg-check { padding: 16px 18px; border-radius: 14px; }
.pg-page[data-pg-theme="workbench"] .pg-question { font-size: 16.5px; line-height: 1.65; }
.pg-page[data-pg-theme="workbench"] .pg-option { font-size: 15px; line-height: 1.65; padding: 9px 11px; }

.pg-page[data-pg-theme="workbench"] .pg-figure { padding: 8px; border-radius: 14px; }
.pg-page[data-pg-theme="workbench"] .pg-figure-svg { max-height: 240px; }
.pg-page[data-pg-theme="workbench"] .pg-figure-caption { font-size: 13px; line-height: 1.6; }
.pg-page[data-pg-theme="workbench"] .pg-figure-takeaway { font-size: 13px; line-height: 1.6; }
.pg-page[data-pg-theme="workbench"] .pg-quickfacts { padding: 12px 14px; border-radius: 14px; }
.pg-page[data-pg-theme="workbench"] .pg-quickfacts ul { font-size: 13px; line-height: 1.65; }

/* 亚克力：右栏、题解、检查与核心卡浮在纸面上，而不是嵌进页面 */
.pg-page[data-pg-theme="workbench"] .pg-figure,
.pg-page[data-pg-theme="workbench"] .pg-quickfacts,
.pg-page[data-pg-theme="workbench"] .pg-example,
.pg-page[data-pg-theme="workbench"] .pg-check,
.pg-page[data-pg-theme="workbench"] .pg-callout-key {
  border: 1px solid var(--pg-glass-border);
  background: var(--pg-glass-bg);
  -webkit-backdrop-filter: var(--pg-glass-blur);
  backdrop-filter: var(--pg-glass-blur);
  box-shadow: var(--pg-glass-shadow);
}
.pg-page[data-pg-theme="workbench"] .pg-example,
.pg-page[data-pg-theme="workbench"] .pg-check,
.pg-page[data-pg-theme="workbench"] .pg-callout-key {
  background: var(--pg-glass-bg-strong);
}
.pg-page[data-pg-theme="workbench"] .pg-callout-key { border-left: 2px solid var(--mp-ink); }

.pg-page[data-pg-theme="workbench"] .pg-summary-grid { grid-template-columns: 1fr; gap: 8px; }
.pg-page[data-pg-theme="workbench"] .pg-summary-card { padding: 10px 12px; }
.pg-page[data-pg-theme="workbench"] .pg-foot { font-size: 12px; }

/* 矮屏下右栏高于视口，吸顶会让底部内容永远看不到；改为随正文滚动 */
@media (max-height: 860px) and (min-width: 961px) {
  .pg-page[data-pg-theme="workbench"] .pg-rail { position: static; }
}

@media (max-width: 1240px) {
  .pg-page[data-pg-theme="workbench"] {
    grid-template-columns: 9rem minmax(0, 1fr) 17rem;
    --pg-body-size: 15.5px;
  }
  .pg-page[data-pg-theme="workbench"] .pg-figure-svg { max-height: 210px; }
}
@media (max-width: 1060px) {
  .pg-page[data-pg-theme="workbench"] {
    grid-template-columns: minmax(0, 1fr) 15rem;
    grid-template-areas:
      "head head"
      "main rail"
      "main rail"
      "foot foot";
  }
  .pg-page[data-pg-theme="workbench"] .pg-outline { display: none; }
}
@media (max-width: 960px) {
  .pg-page[data-pg-theme="workbench"] .pg-outline {
    position: sticky !important;
    top: 8px !important;
    z-index: 9;
    padding: 10px 12px;
    border-radius: 14px;
    background: var(--pg-glass-bg-strong);
    -webkit-backdrop-filter: var(--pg-glass-blur);
    backdrop-filter: var(--pg-glass-blur);
    box-shadow: var(--pg-glass-shadow);
  }
  .pg-page[data-pg-theme="workbench"] .pg-block { scroll-margin-top: 150px; }
  .pg-page[data-pg-theme="workbench"] .pg-step { scroll-margin-top: 150px; }
}
@media (max-width: 600px) {
  .pg-page[data-pg-theme="workbench"] .pg-outline ol {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 12px;
  }
}
`;
