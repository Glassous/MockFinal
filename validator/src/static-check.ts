/**
 * 静态检查（PAGE_CONTRACT.md §5、§10.1；Plan §7.6）
 *
 * 全部规则基于 AST：
 * - HTML 用 parse5 解析成节点树后按标签/属性/URL 判断；
 * - JS 用 acorn 解析、acorn-walk 遍历（`window['parent']`、`document['cookie']` 这类计算属性同样命中）；
 * - CSS 用规则扫描（CSS 没有可在无构建依赖下稳定解析的 AST，规则只覆盖契约列出的属性与函数）。
 *
 * 本文件不执行页面代码，也不做任何“静默清洗”；问题全部以 Issue[] 返回。
 */
import { parseFragment } from 'parse5';
import { parse as parseJs } from 'acorn';
import { fullAncestor } from 'acorn-walk';

import {
  BUNDLE_SCHEMA_VERSION,
  MAX_BUNDLE_BYTES,
  RUNTIME_VERSION,
  type Bundle,
  type Issue,
  type StaticCheckResult
} from './types.js';

/** Manifest 字段长度上限（O-2 在 P2 冻结；变更需同步 PAGE_CONTRACT 第 13 节）。 */
export const MANIFEST_LIMITS = Object.freeze({
  pageIdMax: 128,
  knowledgePointIdMax: 64,
  titleMax: 200,
  subtitleMax: 300,
  layoutMax: 64,
  labelMax: 200,
  quoteMax: 2000,
  summaryMax: 2000,
  keyFactMax: 300,
  questionMax: 300,
  maxInteractions: 20,
  maxSourceRefs: 50,
  maxKeyFacts: 12,
  maxQuestions: 10,
  minEstimatedMinutes: 1,
  maxEstimatedMinutes: 600
});

const HTML_FORBIDDEN_TAGS = new Set([
  'html',
  'head',
  'body',
  'script',
  'style',
  'link',
  'base',
  'iframe',
  'object',
  'embed',
  'meta',
  'form'
]);

const SVG_FORBIDDEN_TAGS = new Set(['script', 'foreignobject']);

const HTML_FORBIDDEN_ATTRS = new Set(['target', 'srcdoc', 'download', 'ping']);

const URL_ATTRS = new Set(['href', 'src', 'srcset', 'poster', 'action', 'formaction', 'xlink:href']);

const INLINE_DATA_URL = /^data:(image\/|font\/|application\/font|application\/x-font)/i;

const JS_GLOBAL_FORBIDDEN = new Set([
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'eval',
  'importScripts',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'Worker',
  'SharedWorker',
  'Function',
  'postMessage',
  'parent',
  'top',
  'opener',
  'frames'
]);

const JS_GLOBAL_FORBIDDEN_CALLS = new Set([
  'fetch',
  'eval',
  'open',
  'postMessage',
  'importScripts',
  'Worker',
  'SharedWorker',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource'
]);

const JS_DYNAMIC_ELEMENT_TAGS = new Set(['script', 'link', 'iframe', 'object', 'embed']);

const JS_DOCUMENT_FORBIDDEN = new Set(['cookie', 'write', 'writeln', 'domain', 'open']);
const JS_NAVIGATOR_FORBIDDEN = new Set(['sendBeacon', 'credentials', 'clipboard', 'serviceWorker']);
const JS_WINDOW_OBJECTS = new Set(['window', 'globalThis', 'self', 'top', 'parent', 'frames']);
const JS_WINDOW_FORBIDDEN = new Set([
  'parent',
  'top',
  'opener',
  'name',
  'open',
  'frames',
  'postMessage',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'eval',
  'Function',
  'Worker',
  'SharedWorker'
]);

const JS_LOCATION_METHODS = new Set(['assign', 'replace', 'reload']);

const CSS_EXTERNAL_URL = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
const CSS_OVERFLOW = /(?:^|[;{\s])overflow(?:-[xy])?\s*:\s*(auto|scroll)\b/gi;
const CSS_POSITION_FIXED = /position\s*:\s*fixed\b/gi;
const CSS_SCRIPTING = [/\bexpression\s*\(/gi, /\bbehavior\s*:/gi, /-moz-binding\s*:/gi];

const MAX_REPORTED_PER_RULE = 12;

/* ------------------------------------------------------------------ */
/* HTML                                                                */
/* ------------------------------------------------------------------ */

interface P5NodeLike {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: P5NodeLike[];
  content?: { childNodes?: P5NodeLike[] };
}

interface ElementInfo {
  tag: string;
  attrs: Map<string, string>;
  parent: ElementInfo | null;
}

function pushCapped(issues: Issue[], issue: Issue, code: string): void {
  const seen = issues.filter((item) => item.code === code).length;
  if (seen < MAX_REPORTED_PER_RULE) {
    issues.push(issue);
  } else if (seen === MAX_REPORTED_PER_RULE) {
    issues.push({
      severity: issue.severity,
      code,
      message: `${code} 同类问题过多，仅展示前 ${MAX_REPORTED_PER_RULE} 条`
    });
  }
}

function collectElements(root: P5NodeLike): ElementInfo[] {
  const out: ElementInfo[] = [];
  const visit = (node: P5NodeLike, parent: ElementInfo | null): void => {
    let current = parent;
    if (node.tagName) {
      const attrs = new Map<string, string>();
      for (const attr of node.attrs ?? []) {
        attrs.set(attr.name.toLowerCase(), attr.value);
      }
      const info: ElementInfo = { tag: node.tagName.toLowerCase(), attrs, parent };
      out.push(info);
      current = info;
    }
    const children = node.childNodes ?? node.content?.childNodes ?? [];
    for (const child of children) visit(child, current);
  };
  visit(root, null);
  return out;
}

function urlIssues(
  attrs: Map<string, string>,
  tag: string,
  issues: Issue[]
): void {
  for (const [name, rawValue] of attrs) {
    if (!URL_ATTRS.has(name)) continue;
    const value = rawValue.trim();
    if (value === '') continue;
    if (name === 'href' && value.startsWith('#')) continue;
    if ((name === 'xlink:href' || name === 'href') && value.startsWith('#')) continue;
    if (/^data:text\/html/i.test(value)) {
      pushCapped(issues, {
        severity: 'error',
        code: 'HTML_EXTERNAL_URL',
        message: `<${tag}> 的 ${name} 使用了 data:text/html（等同内联页面）`
      }, 'HTML_EXTERNAL_URL');
      continue;
    }
    if (/^data:/i.test(value)) {
      if (name === 'href' || name === 'action' || name === 'formaction') {
        pushCapped(issues, {
          severity: 'error',
          code: 'HTML_EXTERNAL_URL',
          message: `<${tag}> 的 ${name} 不得使用 data: URI`
        }, 'HTML_EXTERNAL_URL');
        continue;
      }
      if (!INLINE_DATA_URL.test(value)) {
        pushCapped(issues, {
          severity: 'error',
          code: 'HTML_EXTERNAL_URL',
          message: `<${tag}> 的 ${name} 只允许 data:image/* 或 data:font/*`
        }, 'HTML_EXTERNAL_URL');
      }
      continue;
    }
    if (name === 'srcset') {
      const candidates = value.split(',').map((item) => item.trim()).filter(Boolean);
      const bad = candidates.find((candidate) => {
        const url = candidate.split(/\s+/)[0] ?? '';
        return url !== '' && !/^data:(image\/|font\/)/i.test(url);
      });
      if (bad) {
        pushCapped(issues, {
          severity: 'error',
          code: 'HTML_EXTERNAL_URL',
          message: `<${tag}> 的 srcset 含外部资源：${bad.slice(0, 80)}`
        }, 'HTML_EXTERNAL_URL');
      }
      continue;
    }
    if (/^javascript:/i.test(value) || /^vbscript:/i.test(value)) {
      pushCapped(issues, {
        severity: 'error',
        code: 'HTML_EXTERNAL_URL',
        message: `<${tag}> 的 ${name} 使用了脚本化 URL`
      }, 'HTML_EXTERNAL_URL');
      continue;
    }
    pushCapped(issues, {
      severity: 'error',
      code: 'HTML_EXTERNAL_URL',
      message: `<${tag}> 的 ${name} 不允许外部或相对地址：${value.slice(0, 80)}`
    }, 'HTML_EXTERNAL_URL');
  }
}

function checkHtml(html: string, issues: Issue[]): void {
  if (/<\/script/i.test(html) || /<\/style/i.test(html)) {
    pushCapped(issues, {
      severity: 'error',
      code: 'SHELL_ESCAPE_SEQUENCE',
      message: 'html 片段包含 </script 或 </style 序列，会提前闭合 shell 结构'
    }, 'SHELL_ESCAPE_SEQUENCE');
  }
  if (html.includes('<!--')) {
    pushCapped(issues, {
      severity: 'error',
      code: 'SHELL_ESCAPE_SEQUENCE',
      message: 'html 片段包含 HTML 注释起始序列 <!--'
    }, 'SHELL_ESCAPE_SEQUENCE');
  }

  let fragment: P5NodeLike;
  try {
    fragment = parseFragment(html) as unknown as P5NodeLike;
  } catch (error) {
    pushCapped(issues, {
      severity: 'error',
      code: 'BUNDLE_SCHEMA_INVALID',
      message: `html 片段无法解析：${error instanceof Error ? error.message : String(error)}`
    }, 'BUNDLE_SCHEMA_INVALID');
    return;
  }

  const elements = collectElements(fragment);
  for (const element of elements) {
    const { tag, attrs } = element;
    const insideSvg = (() => {
      let current = element.parent;
      while (current) {
        if (current.tag === 'svg') return true;
        current = current.parent;
      }
      return false;
    })();

    if (HTML_FORBIDDEN_TAGS.has(tag) || (insideSvg && SVG_FORBIDDEN_TAGS.has(tag))) {
      pushCapped(issues, {
        severity: 'error',
        code: 'HTML_FORBIDDEN_TAG',
        message: `禁止使用标签 <${tag}>（页面只能是 body 片段）`,
        selector: tag
      }, 'HTML_FORBIDDEN_TAG');
      continue;
    }

    for (const [name, value] of attrs) {
      if (name.startsWith('on')) {
        pushCapped(issues, {
          severity: 'error',
          code: 'HTML_FORBIDDEN_ATTR',
          message: `<${tag}> 使用了内联事件属性 ${name}，请改用 data-mp-* 与 page.js 监听`,
          selector: `${tag}[${name}]`
        }, 'HTML_FORBIDDEN_ATTR');
        continue;
      }
      if (HTML_FORBIDDEN_ATTRS.has(name)) {
        pushCapped(issues, {
          severity: 'error',
          code: 'HTML_FORBIDDEN_ATTR',
          message: `<${tag}> 不允许使用属性 ${name}`,
          selector: `${tag}[${name}]`
        }, 'HTML_FORBIDDEN_ATTR');
        continue;
      }
      if (name === 'style' && /\burl\s*\(/i.test(value) && !/url\(\s*['"]?(data:|#)/i.test(value)) {
        pushCapped(issues, {
          severity: 'error',
          code: 'HTML_EXTERNAL_URL',
          message: `<${tag}> 的内联 style 含外部 url()`,
          selector: `${tag}[style]`
        }, 'HTML_EXTERNAL_URL');
      }
    }

    urlIssues(attrs, tag, issues);
  }
}

/* ------------------------------------------------------------------ */
/* CSS                                                                 */
/* ------------------------------------------------------------------ */

function scanPattern(
  css: string,
  pattern: RegExp,
  issues: Issue[],
  build: (match: RegExpExecArray) => Issue
): void {
  pattern.lastIndex = 0;
  let match = pattern.exec(css);
  while (match) {
    const issue = build(match);
    pushCapped(issues, issue, issue.code);
    match = pattern.exec(css);
  }
}

function checkCss(css: string, issues: Issue[]): void {
  if (/<\/style/i.test(css)) {
    pushCapped(issues, {
      severity: 'error',
      code: 'SHELL_ESCAPE_SEQUENCE',
      message: 'css 包含 </style 序列，会提前闭合 shell 结构'
    }, 'SHELL_ESCAPE_SEQUENCE');
  }

  if (/@import\b/i.test(css)) {
    pushCapped(issues, {
      severity: 'error',
      code: 'CSS_EXTERNAL_URL',
      message: 'css 禁止 @import，请内联所需样式'
    }, 'CSS_EXTERNAL_URL');
  }

  CSS_EXTERNAL_URL.lastIndex = 0;
  let urlMatch = CSS_EXTERNAL_URL.exec(css);
  while (urlMatch) {
    const value = (urlMatch[2] ?? '').trim();
    const allowed = value === '' || value.startsWith('data:') || value.startsWith('#');
    if (!allowed) {
      pushCapped(issues, {
        severity: 'error',
        code: 'CSS_EXTERNAL_URL',
        message: `css 的 url() 不允许外部或相对地址：${value.slice(0, 80)}`
      }, 'CSS_EXTERNAL_URL');
    }
    urlMatch = CSS_EXTERNAL_URL.exec(css);
  }

  scanPattern(css, CSS_OVERFLOW, issues, () => ({
    severity: 'error',
    code: 'CSS_OVERFLOW_SCROLL',
    message: 'css 禁止在可见元素上声明 overflow: auto|scroll（零滚动要求）'
  }));

  scanPattern(css, CSS_POSITION_FIXED, issues, () => ({
    severity: 'warning',
    code: 'POSITION_FIXED',
    message: 'css 使用了 position: fixed，可能遮挡宿主导航；请确认固定在页面 stage 内'
  }));

  for (const pattern of CSS_SCRIPTING) {
    scanPattern(css, pattern, issues, (match) => ({
      severity: 'error',
      code: 'CSS_FORBIDDEN_PROPERTY',
      message: `css 使用了历史脚本化写法：${match[0].slice(0, 40)}`
    }));
  }
}

/* ------------------------------------------------------------------ */
/* JS                                                                  */
/* ------------------------------------------------------------------ */

interface AstNode {
  type: string;
  [key: string]: unknown;
}

function asAst(node: unknown): AstNode {
  return node as unknown as AstNode;
}

function propertyName(node: AstNode): string | null {
  const property = node.property as AstNode | undefined;
  if (!property) return null;
  if (!node.computed && property.type === 'Identifier') return String(property.name);
  if (node.computed && property.type === 'Literal' && typeof property.value === 'string') {
    return property.value;
  }
  return null;
}

function objectRootName(node: AstNode): string | null {
  const object = node.object as AstNode | undefined;
  if (!object) return null;
  if (object.type === 'Identifier') return String(object.name);
  if (object.type === 'MemberExpression') return propertyName(object);
  if (object.type === 'ThisExpression') return 'this';
  return null;
}

function stringLiteralValue(node: AstNode | undefined): string | null {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral') {
    const expressions = node.expressions as unknown[];
    const quasis = node.quasis as Array<{ value?: { cooked?: string | null } }>;
    if (expressions.length === 0 && quasis[0]?.value?.cooked != null) {
      return quasis[0].value.cooked;
    }
  }
  return null;
}

function addPatternNames(pattern: AstNode | undefined, out: Set<string>): void {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier':
      out.add(String(pattern.name));
      break;
    case 'ObjectPattern':
      for (const property of pattern.properties as AstNode[]) {
        if (property.type === 'RestElement') {
          addPatternNames(property.argument as AstNode, out);
        } else {
          addPatternNames(property.value as AstNode, out);
        }
      }
      break;
    case 'ArrayPattern':
      for (const element of pattern.elements as Array<AstNode | null>) {
        if (element) addPatternNames(element, out);
      }
      break;
    case 'RestElement':
      addPatternNames(pattern.argument as AstNode, out);
      break;
    case 'AssignmentPattern':
      addPatternNames(pattern.left as AstNode, out);
      break;
    default:
      break;
  }
}

function isLocationRef(node: AstNode | undefined): boolean {
  if (!node) return false;
  if (node.type === 'Identifier') return String(node.name) === 'location';
  if (node.type === 'MemberExpression') return propertyName(node) === 'location';
  return false;
}

const JS_URL_ATTRS = new Set(['href', 'src', 'srcset', 'poster', 'action', 'formaction']);

function isSafeStaticUrl(value: string): boolean {
  const text = value.trim();
  return text === '' || text.startsWith('#') || text.startsWith('data:');
}

function collectStaticStrings(node: AstNode | undefined, out: string[] = []): string[] {
  if (!node) return out;
  if (node.type === 'Literal' && typeof node.value === 'string') {
    out.push(node.value);
    return out;
  }
  if (node.type === 'TemplateLiteral') {
    for (const quasi of (node.quasis as Array<{ value?: { cooked?: string | null } }>) ?? []) {
      if (quasi.value?.cooked) out.push(quasi.value.cooked);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'range' || key === 'parent') continue;
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === 'object' && typeof (child as AstNode).type === 'string') {
          collectStaticStrings(child as AstNode, out);
        }
      }
    } else if (value && typeof value === 'object' && typeof (value as AstNode).type === 'string') {
      collectStaticStrings(value as AstNode, out);
    }
  }
  return out;
}

function hasUnsafeStaticUrl(node: AstNode | undefined): boolean {
  const values = collectStaticStrings(node);
  return values.some((value) => !isSafeStaticUrl(value));
}

function checkJs(js: string, issues: Issue[]): void {
  if (/<\/script/i.test(js)) {
    pushCapped(issues, {
      severity: 'error',
      code: 'SHELL_ESCAPE_SEQUENCE',
      message: 'js 包含 </script 序列，会提前闭合 shell 结构'
    }, 'SHELL_ESCAPE_SEQUENCE');
  }

  const source = js.trim();
  if (source === '') return;

  let ast: AstNode;
  try {
    ast = parseJs(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true
    }) as unknown as AstNode;
  } catch (error) {
    pushCapped(issues, {
      severity: 'error',
      code: 'JS_PARSE_ERROR',
      message: `js 无法解析（只支持经典脚本，不支持模块语法）：${error instanceof Error ? error.message : String(error)}`
    }, 'JS_PARSE_ERROR');
    return;
  }

  const declared = new Set<string>();
  fullAncestor(ast as never, (node) => {
    const current = asAst(node);
    switch (current.type) {
      case 'VariableDeclarator':
        addPatternNames(current.id as AstNode, declared);
        break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (current.id) addPatternNames(current.id as AstNode, declared);
        for (const param of current.params as AstNode[]) addPatternNames(param, declared);
        break;
      case 'ClassDeclaration':
      case 'ClassExpression':
        if (current.id) addPatternNames(current.id as AstNode, declared);
        break;
      case 'CatchClause':
        addPatternNames(current.param as AstNode | undefined, declared);
        break;
      default:
        break;
    }
  });

  const report = (message: string, selector?: string): void => {
    pushCapped(issues, {
      severity: 'error',
      code: 'JS_FORBIDDEN_API',
      message,
      ...(selector ? { selector } : {})
    }, 'JS_FORBIDDEN_API');
  };

  const isUnresolved = (node: AstNode): boolean => {
    if (node.type !== 'Identifier') return false;
    return !declared.has(String(node.name));
  };

  fullAncestor(ast as never, (node) => {
    const current = asAst(node);

    if (current.type === 'ImportExpression') {
      report('js 禁止动态 import()');
      return;
    }

    if (current.type === 'Identifier' && isUnresolved(current)) {
      const name = String(current.name);
      if (JS_GLOBAL_FORBIDDEN.has(name)) {
        report(`js 禁止使用 ${name}（网络/存储/动态代码/父窗口）`);
      }
    }

    if (current.type === 'CallExpression' || current.type === 'NewExpression') {
      const callee = current.callee as AstNode | undefined;
      if (callee && callee.type === 'Identifier') {
        const name = String(callee.name);
        if (JS_GLOBAL_FORBIDDEN_CALLS.has(name) && !declared.has(name)) {
          report(`js 禁止调用 ${name}()`);
        }
        if (name === 'Function' && !declared.has(name)) {
          report('js 禁止使用 new Function()/Function() 动态生成代码');
        }
        if ((name === 'setTimeout' || name === 'setInterval') && !declared.has(name)) {
          const first = (current.arguments as AstNode[])[0];
          if (stringLiteralValue(first) !== null) {
            report(`js 禁止 ${name}('字符串') 形式的动态代码`);
          }
        }
      }
      if (callee && callee.type === 'MemberExpression') {
        const name = propertyName(callee);
        if (name === 'postMessage') {
          report('js 禁止直接调用 postMessage，请使用 MockFinal 封装的 API');
        }
        if (name === 'eval') {
          report('js 禁止调用 eval()');
        }
        if (name === 'createElement' || name === 'createElementNS') {
          const args = (current.arguments as AstNode[]) ?? [];
          const tagIndex = name === 'createElement' ? 0 : 1;
          const tag = stringLiteralValue(args[tagIndex]);
          if (tag && JS_DYNAMIC_ELEMENT_TAGS.has(tag.toLowerCase())) {
            report(`js 禁止动态创建 <${tag}> 元素`);
          }
        }
        if (name && JS_LOCATION_METHODS.has(name) && isLocationRef(callee.object as AstNode)) {
          report(`js 禁止通过 location.${name}() 导航`);
        }
        if (name === 'sendBeacon') {
          report('js 禁止调用 navigator.sendBeacon');
        }
        if (name === 'setAttribute' || name === 'setAttributeNS') {
          const args = (current.arguments as AstNode[]) ?? [];
          const attrIndex = name === 'setAttribute' ? 0 : 1;
          const valueIndex = name === 'setAttribute' ? 1 : 2;
          const attr = stringLiteralValue(args[attrIndex]);
          if (attr && JS_URL_ATTRS.has(attr.toLowerCase()) && hasUnsafeStaticUrl(args[valueIndex])) {
            report(`js 禁止通过 ${name} 写入外部 URL`);
          }
        }
        if ((name === 'assign' || name === 'replace') && hasUnsafeStaticUrl((current.arguments as AstNode[])[0])) {
          report(`js 禁止通过 ${name}() 使用外部 URL 导航`);
        }
      }
    }

    if (current.type === 'MemberExpression') {
      const name = propertyName(current);
      if (!name) return;
      const root = objectRootName(current);
      if (root === 'document' && JS_DOCUMENT_FORBIDDEN.has(name)) {
        report(`js 禁止访问 document.${name}`);
      }
      if (root === 'navigator' && JS_NAVIGATOR_FORBIDDEN.has(name)) {
        report(`js 禁止访问 navigator.${name}`);
      }
      if (root && (JS_WINDOW_OBJECTS.has(root) || root === 'this')) {
        if (JS_WINDOW_FORBIDDEN.has(name)) {
          report(`js 禁止访问 window.${name}（父窗口/网络/存储/动态代码）`);
        }
      }
      if (name === 'postMessage' && root !== 'MockFinal') {
        report('js 禁止直接使用 postMessage，请使用 MockFinal 封装的 API');
      }
    }

    if (current.type === 'AssignmentExpression' || current.type === 'UpdateExpression') {
      const left = (current.type === 'AssignmentExpression' ? current.left : current.argument) as AstNode;
      if (isLocationRef(left)) {
        report('js 禁止给 location 赋值');
      }
      if (left.type === 'MemberExpression') {
        const name = propertyName(left);
        if (name === 'innerHTML' || name === 'outerHTML') {
          const right = current.type === 'AssignmentExpression' ? (current.right as AstNode) : undefined;
          const value = stringLiteralValue(right);
          if (value && /<\s*(script|style|iframe|object|embed|link|form|base|meta)\b/i.test(value)) {
            report('js 禁止通过 innerHTML/outerHTML 注入 script/style/iframe/object/embed/link/form/base/meta');
          }
        }
        if (name === 'href' && isLocationRef(left.object as AstNode)) {
          report('js 禁止给 location.href 赋值');
        }
        if (name && JS_URL_ATTRS.has(name)) {
          const right = current.type === 'AssignmentExpression' ? (current.right as AstNode) : undefined;
          if (hasUnsafeStaticUrl(right)) {
            report(`js 禁止把外部 URL 赋给 ${name}`);
          }
        }
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Smoke 选择器                                                        */
/* ------------------------------------------------------------------ */

interface SelectorStep {
  tag: string | null;
  ids: string[];
  classes: string[];
  attrs: Array<{ name: string; op: string | null; value: string | null }>;
  unsupported: boolean;
}

interface ParsedSelector {
  steps: SelectorStep[];
  combinators: string[];
}

const IDENT_START = /[A-Za-z_\u00a0-\uffff]/;
const IDENT_PART = /[A-Za-z0-9_\-\u00a0-\uffff]/;

/** 解析 CSS 选择器的子集；语法不合法时返回中文原因。 */
export function parseSelector(selector: string): ParsedSelector | string {
  const text = selector.trim();
  if (text === '') return '选择器不能为空';
  if (text.length > 300) return '选择器过长';

  let index = 0;
  const steps: SelectorStep[] = [];
  const combinators: string[] = [];

  const skipSpace = (): boolean => {
    let skipped = false;
    while (index < text.length && /\s/.test(text[index] ?? '')) {
      index += 1;
      skipped = true;
    }
    return skipped;
  };

  const readIdent = (): string | null => {
    const start = index;
    if (index >= text.length || !IDENT_START.test(text[index] ?? '')) return null;
    index += 1;
    while (index < text.length && IDENT_PART.test(text[index] ?? '')) index += 1;
    return text.slice(start, index);
  };

  const readCompound = (): SelectorStep | string => {
    const step: SelectorStep = { tag: null, ids: [], classes: [], attrs: [], unsupported: false };
    let consumed = false;
    if (text[index] === '*') {
      step.tag = '*';
      index += 1;
      consumed = true;
    } else if (index < text.length && IDENT_START.test(text[index] ?? '')) {
      step.tag = (readIdent() ?? '').toLowerCase();
      consumed = true;
    }
    while (index < text.length) {
      const char = text[index];
      if (char === '#') {
        index += 1;
        const ident = readIdent();
        if (!ident) return '“#” 后缺少 id';
        step.ids.push(ident);
        consumed = true;
      } else if (char === '.') {
        index += 1;
        const ident = readIdent();
        if (!ident) return '“.” 后缺少类名';
        step.classes.push(ident);
        consumed = true;
      } else if (char === '[') {
        index += 1;
        skipSpace();
        const name = readIdent();
        if (!name) return '属性选择器缺少属性名';
        skipSpace();
        let op: string | null = null;
        let value: string | null = null;
        const operatorMatch = /^(~=|\|=|\^=|\$=|\*=|=)/.exec(text.slice(index));
        if (operatorMatch) {
          op = operatorMatch[1] ?? null;
          index += op.length;
          skipSpace();
          const quote = text[index];
          if (quote === '"' || quote === "'") {
            index += 1;
            const start = index;
            while (index < text.length && text[index] !== quote) index += 1;
            if (index >= text.length) return '属性选择器引号未闭合';
            value = text.slice(start, index);
            index += 1;
          } else {
            const start = index;
            while (index < text.length && !/[\s\]]/.test(text[index] ?? '')) index += 1;
            value = text.slice(start, index);
          }
          skipSpace();
        }
        if (text[index] !== ']') return '属性选择器缺少 “]”';
        index += 1;
        step.attrs.push({ name: name.toLowerCase(), op, value });
        consumed = true;
      } else if (char === ':') {
        // 伪类/伪元素不参与静态匹配，标记为不可判定
        index += 1;
        if (text[index] === ':') index += 1;
        if (!readIdent()) return '伪类缺少名称';
        if (text[index] === '(') {
          let depth = 0;
          while (index < text.length) {
            if (text[index] === '(') depth += 1;
            if (text[index] === ')') {
              depth -= 1;
              if (depth === 0) {
                index += 1;
                break;
              }
            }
            index += 1;
          }
        }
        step.unsupported = true;
        consumed = true;
      } else {
        break;
      }
    }
    if (!consumed) return `无法识别的选择器片段：${text.slice(index, index + 12)}`;
    return step;
  };

  skipSpace();
  const first = readCompound();
  if (typeof first === 'string') return first;
  steps.push(first);

  for (;;) {
    const hadSpace = skipSpace();
    if (index >= text.length) break;
    const char = text[index];
    if (char === '>' || char === '+' || char === '~') {
      combinators.push(char);
      index += 1;
      skipSpace();
    } else if (hadSpace) {
      combinators.push(' ');
    } else {
      return `无法识别的选择器片段：${text.slice(index, index + 12)}`;
    }
    const next = readCompound();
    if (typeof next === 'string') return next;
    steps.push(next);
  }

  if (steps.length !== combinators.length + 1) return '选择器组合器数量不匹配';
  return { steps, combinators };
}

function matchesStep(element: ElementInfo, step: SelectorStep): boolean | null {
  if (step.unsupported) return null;
  if (step.tag && step.tag !== '*' && element.tag !== step.tag) return false;
  for (const id of step.ids) {
    if (element.attrs.get('id') !== id) return false;
  }
  if (step.classes.length > 0) {
    const classes = (element.attrs.get('class') ?? '').split(/\s+/);
    for (const name of step.classes) {
      if (!classes.includes(name)) return false;
    }
  }
  for (const attr of step.attrs) {
    const value = element.attrs.get(attr.name);
    if (value === undefined) return false;
    if (attr.op === '=' && attr.value !== null && value !== attr.value) return false;
    if (attr.op && attr.op !== '=') return null;
  }
  return true;
}

/**
 * 判断选择器能否在静态 HTML 中匹配到元素。
 * 返回 true / false；无法静态判定（伪类、兄弟组合器、动态创建）时返回 null。
 */
export function selectorExists(html: string, selector: string): boolean | null {
  const parsed = parseSelector(selector);
  if (typeof parsed === 'string') return null;
  if (parsed.combinators.some((combinator) => combinator === '+' || combinator === '~')) return null;

  let elements: ElementInfo[];
  try {
    elements = collectElements(parseFragment(html) as unknown as P5NodeLike);
  } catch {
    return null;
  }

  const matchAt = (element: ElementInfo, stepIndex: number): boolean | null => {
    const stepResult = matchesStep(element, parsed.steps[stepIndex] ?? { tag: null, ids: [], classes: [], attrs: [], unsupported: true });
    if (stepResult === null) return null;
    if (!stepResult) return false;
    if (stepIndex === 0) return true;
    const combinator = parsed.combinators[stepIndex - 1];
    if (combinator === '>') {
      if (!element.parent) return false;
      return matchAt(element.parent, stepIndex - 1);
    }
    let current = element.parent;
    while (current) {
      const result = matchAt(current, stepIndex - 1);
      if (result === null) return null;
      if (result) return true;
      current = current.parent;
    }
    return false;
  };

  let unknown = false;
  for (const element of elements) {
    const result = matchAt(element, parsed.steps.length - 1);
    if (result === null) {
      unknown = true;
      continue;
    }
    if (result) return true;
  }
  return unknown ? null : false;
}

/* ------------------------------------------------------------------ */
/* Manifest                                                            */
/* ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function checkManifest(manifest: unknown, issues: Issue[]): void {
  const report = (message: string, field?: string): void => {
    pushCapped(issues, {
      severity: 'error',
      code: 'MANIFEST_INVALID',
      message,
      ...(field ? { selector: field } : {})
    }, 'MANIFEST_INVALID');
  };

  if (!isPlainObject(manifest)) {
    report('manifest 必须是对象');
    return;
  }
  const limits = MANIFEST_LIMITS;

  if (manifest.schema_version !== BUNDLE_SCHEMA_VERSION) {
    report(`manifest.schema_version 必须为 "${BUNDLE_SCHEMA_VERSION}"`, 'schema_version');
  }
  if (!isNonEmptyString(manifest.page_id) || manifest.page_id.length > limits.pageIdMax) {
    report(`manifest.page_id 必须是非空字符串且长度 ≤ ${limits.pageIdMax}`, 'page_id');
  }
  if (!isNonEmptyString(manifest.title) || manifest.title.length > limits.titleMax) {
    report(`manifest.title 必须是非空纯文本且长度 ≤ ${limits.titleMax}`, 'title');
  } else if (/<[a-z!/]/i.test(manifest.title)) {
    report('manifest.title 不得包含 HTML 标签', 'title');
  }
  if (manifest.subtitle !== undefined) {
    if (typeof manifest.subtitle !== 'string' || manifest.subtitle.length > limits.subtitleMax) {
      report(`manifest.subtitle 必须是字符串且长度 ≤ ${limits.subtitleMax}`, 'subtitle');
    } else if (/<[a-z!/]/i.test(manifest.subtitle)) {
      report('manifest.subtitle 不得包含 HTML 标签', 'subtitle');
    }
  }

  const knowledgeIds = manifest.knowledge_point_ids;
  if (!Array.isArray(knowledgeIds) || knowledgeIds.length === 0) {
    report('manifest.knowledge_point_ids 必须是非空数组', 'knowledge_point_ids');
  } else {
    for (const id of knowledgeIds) {
      if (!isNonEmptyString(id) || id.length > limits.knowledgePointIdMax) {
        report(`manifest.knowledge_point_ids 每项必须是非空字符串且长度 ≤ ${limits.knowledgePointIdMax}`, 'knowledge_point_ids');
        break;
      }
    }
  }

  if (!isNonEmptyString(manifest.importance)) {
    report('manifest.importance 必须是非空字符串（已知取值 core）', 'importance');
  } else if (manifest.importance !== 'core') {
    pushCapped(issues, {
      severity: 'warning',
      code: 'MANIFEST_INVALID',
      message: `manifest.importance 使用了未知取值：${manifest.importance}`,
      selector: 'importance'
    }, 'MANIFEST_INVALID');
  }

  const minutes = manifest.estimated_minutes;
  if (
    typeof minutes !== 'number' ||
    !Number.isInteger(minutes) ||
    minutes < limits.minEstimatedMinutes ||
    minutes > limits.maxEstimatedMinutes
  ) {
    report(
      `manifest.estimated_minutes 必须是 ${limits.minEstimatedMinutes}–${limits.maxEstimatedMinutes} 的整数`,
      'estimated_minutes'
    );
  }

  if (!isNonEmptyString(manifest.layout) || manifest.layout.length > limits.layoutMax) {
    report(`manifest.layout 必须是非空字符串且长度 ≤ ${limits.layoutMax}`, 'layout');
  }

  const interactions = manifest.interactions;
  if (!Array.isArray(interactions) || interactions.length === 0) {
    report('manifest.interactions 必须是至少 1 项的数组（非交互页也要声明 type: "none"）', 'interactions');
  } else if (interactions.length > limits.maxInteractions) {
    report(`manifest.interactions 最多 ${limits.maxInteractions} 项`, 'interactions');
  } else {
    const ids = new Set<string>();
    interactions.forEach((raw, index) => {
      const prefix = `interactions[${index}]`;
      if (!isPlainObject(raw)) {
        report(`${prefix} 必须是对象`, prefix);
        return;
      }
      const id = raw.id;
      if (!isNonEmptyString(id) || !/^[a-z0-9-]+$/.test(id)) {
        report(`${prefix}.id 必须匹配 [a-z0-9-]+`, `${prefix}.id`);
      } else if (ids.has(id)) {
        report(`${prefix}.id 重复：${id}`, `${prefix}.id`);
      } else {
        ids.add(id);
      }
      if (!isNonEmptyString(raw.type)) {
        report(`${prefix}.type 必须是非空字符串`, `${prefix}.type`);
      }
      if (!isNonEmptyString(raw.label) || raw.label.length > limits.labelMax) {
        report(`${prefix}.label 必须是非空中文说明且长度 ≤ ${limits.labelMax}`, `${prefix}.label`);
      }

      const smoke = raw.smoke;
      if (smoke === undefined || smoke === null) {
        if (raw.type === 'none') {
          return;
        }
        report(`${prefix}.smoke 必须给出可执行的冒烟步骤`, `${prefix}.smoke`);
        return;
      }
      if (!isPlainObject(smoke)) {
        report(`${prefix}.smoke 必须是对象`, `${prefix}.smoke`);
        return;
      }
      const action = smoke.action;
      if (action !== 'click' && action !== 'input' && action !== 'step') {
        report(`${prefix}.smoke.action 只能是 click / input / step`, `${prefix}.smoke.action`);
      }
      const selector = smoke.selector;
      if (!isNonEmptyString(selector)) {
        report(`${prefix}.smoke.selector 必须是非空字符串`, `${prefix}.smoke.selector`);
      } else {
        const parsed = parseSelector(selector);
        if (typeof parsed === 'string') {
          report(`${prefix}.smoke.selector 不是合法 CSS 选择器：${parsed}`, `${prefix}.smoke.selector`);
        }
      }
      const expect = smoke.expect;
      if (!isNonEmptyString(expect)) {
        report(`${prefix}.smoke.expect 必须是非空选择器`, `${prefix}.smoke.expect`);
      } else {
        const parsedExpect = parseSelector(expect);
        if (typeof parsedExpect === 'string') {
          report(`${prefix}.smoke.expect 必须是合法选择器：${parsedExpect}`, `${prefix}.smoke.expect`);
        }
      }
      if (smoke.value !== undefined && typeof smoke.value !== 'string') {
        report(`${prefix}.smoke.value 必须是字符串`, `${prefix}.smoke.value`);
      }
    });
  }

  const sourceRefs = manifest.source_refs;
  if (!Array.isArray(sourceRefs)) {
    report('manifest.source_refs 必须是数组', 'source_refs');
  } else if (sourceRefs.length > limits.maxSourceRefs) {
    report(`manifest.source_refs 最多 ${limits.maxSourceRefs} 项`, 'source_refs');
  } else {
    sourceRefs.forEach((raw, index) => {
      const prefix = `source_refs[${index}]`;
      if (!isPlainObject(raw)) {
        report(`${prefix} 必须是对象`, prefix);
        return;
      }
      if (typeof raw.material_id !== 'number' || !Number.isInteger(raw.material_id)) {
        report(`${prefix}.material_id 必须是整数`, `${prefix}.material_id`);
      }
      if (typeof raw.section_id !== 'number' || !Number.isInteger(raw.section_id)) {
        report(`${prefix}.section_id 必须是整数`, `${prefix}.section_id`);
      }
      if (!isNonEmptyString(raw.quote) || raw.quote.length > limits.quoteMax) {
        report(`${prefix}.quote 必须是非空原文片段且长度 ≤ ${limits.quoteMax}`, `${prefix}.quote`);
      }
    });
  }

  if (manifest.assistant !== undefined) {
    const assistant = manifest.assistant;
    if (!isPlainObject(assistant)) {
      report('manifest.assistant 必须是对象', 'assistant');
    } else {
      if (assistant.summary !== undefined) {
        if (typeof assistant.summary !== 'string' || assistant.summary.length > limits.summaryMax) {
          report(`manifest.assistant.summary 必须是字符串且长度 ≤ ${limits.summaryMax}`, 'assistant.summary');
        }
      }
      if (assistant.key_facts !== undefined) {
        if (!Array.isArray(assistant.key_facts) || assistant.key_facts.length > limits.maxKeyFacts) {
          report(`manifest.assistant.key_facts 必须是最多 ${limits.maxKeyFacts} 项的数组`, 'assistant.key_facts');
        } else {
          for (const fact of assistant.key_facts) {
            if (typeof fact !== 'string' || fact.length > limits.keyFactMax) {
              report(`manifest.assistant.key_facts 每项必须是长度 ≤ ${limits.keyFactMax} 的字符串`, 'assistant.key_facts');
              break;
            }
          }
        }
      }
      if (assistant.suggested_questions !== undefined) {
        if (
          !Array.isArray(assistant.suggested_questions) ||
          assistant.suggested_questions.length > limits.maxQuestions
        ) {
          report(
            `manifest.assistant.suggested_questions 必须是最多 ${limits.maxQuestions} 项的数组`,
            'assistant.suggested_questions'
          );
        } else {
          for (const question of assistant.suggested_questions) {
            if (typeof question !== 'string' || question.length > limits.questionMax) {
              report(
                `manifest.assistant.suggested_questions 每项必须是长度 ≤ ${limits.questionMax} 的字符串`,
                'assistant.suggested_questions'
              );
              break;
            }
          }
        }
      }
    }
  }

  const a11y = manifest.a11y;
  if (!isPlainObject(a11y)) {
    report('manifest.a11y 必须是对象，且包含 reduced_motion: true', 'a11y');
  } else if (a11y.reduced_motion !== true) {
    report('manifest.a11y.reduced_motion 必须为 true', 'a11y.reduced_motion');
  }
}

/** 冒烟选择器是否真的存在于页面（静态可判定部分）。 */
function checkSmokeSelectors(manifest: unknown, html: string, js: string, issues: Issue[]): void {
  if (!isPlainObject(manifest) || !Array.isArray(manifest.interactions)) return;
  manifest.interactions.forEach((raw) => {
    if (!isPlainObject(raw)) return;
    const smoke = raw.smoke;
    if (!isPlainObject(smoke)) return;
    const selector = smoke.selector;
    if (!isNonEmptyString(selector)) return;
    if (typeof parseSelector(selector) === 'string') return;
    const found = selectorExists(html, selector);
    if (found !== false) return;
    const referencedInJs = js.includes(selector);
    pushCapped(issues, {
      severity: referencedInJs ? 'warning' : 'error',
      code: 'SMOKE_SELECTOR_NOT_FOUND',
      message: referencedInJs
        ? `冒烟选择器 ${selector} 未出现在静态 html 中，但 page.js 引用了它，可能由脚本动态创建，浏览器检查会最终判定`
        : `冒烟选择器 ${selector} 在静态 html 中不存在`,
      selector
    }, 'SMOKE_SELECTOR_NOT_FOUND');
  });
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * 对一个 unknown 的 bundle 执行全部静态检查（不执行页面代码）。
 * 结构不可用时返回 bundle: null，调用方应跳过浏览器检查。
 */
export function staticCheck(rawBundle: unknown): StaticCheckResult {
  const issues: Issue[] = [];
  const schemaOk = (() => {
    if (!isPlainObject(rawBundle)) {
      pushCapped(issues, {
        severity: 'error',
        code: 'BUNDLE_SCHEMA_INVALID',
        message: 'bundle 必须是 JSON 对象'
      }, 'BUNDLE_SCHEMA_INVALID');
      return false;
    }
    let ok = true;
    if (rawBundle.schema_version !== BUNDLE_SCHEMA_VERSION) {
      pushCapped(issues, {
        severity: 'error',
        code: 'BUNDLE_SCHEMA_INVALID',
        message: `bundle.schema_version 必须为 "${BUNDLE_SCHEMA_VERSION}"`
      }, 'BUNDLE_SCHEMA_INVALID');
      ok = false;
    }
    if (rawBundle.runtime_version !== RUNTIME_VERSION) {
      pushCapped(issues, {
        severity: 'error',
        code: rawBundle.runtime_version === undefined ? 'BUNDLE_SCHEMA_INVALID' : 'RUNTIME_VERSION_MISMATCH',
        message: `bundle.runtime_version 必须为 "${RUNTIME_VERSION}"，实际为 ${String(rawBundle.runtime_version)}`
      }, 'BUNDLE_SCHEMA_INVALID');
      ok = false;
    }
    for (const field of ['html', 'css', 'js']) {
      if (typeof rawBundle[field] !== 'string') {
        pushCapped(issues, {
          severity: 'error',
          code: 'BUNDLE_SCHEMA_INVALID',
          message: `bundle.${field} 必须是字符串`
        }, 'BUNDLE_SCHEMA_INVALID');
        ok = false;
      } else if ((rawBundle[field] as string).charCodeAt(0) === 0xfeff) {
        pushCapped(issues, {
          severity: 'error',
          code: 'BUNDLE_SCHEMA_INVALID',
          message: `bundle.${field} 不得以 BOM 开头`
        }, 'BUNDLE_SCHEMA_INVALID');
        ok = false;
      }
    }
    if (!isPlainObject(rawBundle.manifest)) {
      pushCapped(issues, {
        severity: 'error',
        code: 'BUNDLE_SCHEMA_INVALID',
        message: 'bundle.manifest 必须是对象'
      }, 'BUNDLE_SCHEMA_INVALID');
      ok = false;
    }
    try {
      const total = byteLength(JSON.stringify(rawBundle));
      if (total > MAX_BUNDLE_BYTES) {
        pushCapped(issues, {
          severity: 'error',
          code: 'BUNDLE_TOO_LARGE',
          message: `bundle 总字节数 ${total} 超过上限 ${MAX_BUNDLE_BYTES}`
        }, 'BUNDLE_TOO_LARGE');
        ok = false;
      }
    } catch {
      pushCapped(issues, {
        severity: 'error',
        code: 'BUNDLE_SCHEMA_INVALID',
        message: 'bundle 无法序列化'
      }, 'BUNDLE_SCHEMA_INVALID');
      ok = false;
    }
    return ok;
  })();

  const bundle = schemaOk ? (rawBundle as Bundle) : null;

  if (bundle) {
    checkHtml(bundle.html, issues);
    checkCss(bundle.css, issues);
    checkJs(bundle.js, issues);
    checkManifest(bundle.manifest as unknown, issues);
    checkSmokeSelectors(bundle.manifest as unknown, bundle.html, bundle.js, issues);
  }

  return { issues, bundle };
}
