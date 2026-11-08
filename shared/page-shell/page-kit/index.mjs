/**
 * page-kit 2.0 入口：基础样式 + 三个主题 + 通用交互运行时。
 * shell.mjs 在 manifest.design_system === "2.0" 时注入。
 */

import { PAGE_KIT_BASE_CSS } from './base.mjs';
import { EDITORIAL_CSS } from './themes/editorial.mjs';
import { WORKBENCH_CSS } from './themes/workbench.mjs';
import { PROBLEM_CSS } from './themes/problem.mjs';
import { PAGE_KIT_JS } from './kit-js.mjs';

export const PAGE_KIT_VERSION = '2.0.0';
export const PAGE_KIT_THEMES = Object.freeze(['editorial', 'workbench', 'problem']);
export const PAGE_KIT_CSS = [PAGE_KIT_BASE_CSS, EDITORIAL_CSS, WORKBENCH_CSS, PROBLEM_CSS].join('\n');
export { PAGE_KIT_BASE_CSS, EDITORIAL_CSS, WORKBENCH_CSS, PROBLEM_CSS, PAGE_KIT_JS };
