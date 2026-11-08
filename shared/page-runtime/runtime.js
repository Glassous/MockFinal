/*!
 * MockFinal 页面运行时 runtime_version = "1.1.0"
 * 契约：docs/pageref/PAGE_CONTRACT.md §6、§8
 *
 * 宿主（前端阅读器与 Validator）把本文件内联进 sandbox iframe 的 shell，
 * 页面只能通过 window.MockFinal 与宿主通信。本文件是纯浏览器 IIFE：
 * - 不提供网络（fetch/XHR/WebSocket）、存储（cookie/localStorage）、父窗口读取能力；
 * - 所有宿主消息使用 { channel, type, payload } 信封，channel 从 window.__MP_CHANNEL__ 读取后从全局删除；
 * - 接收宿主消息时校验 event.source === window.parent 与 channel；
 * - 单条消息 payload 超过 4 KB 直接丢弃并上报 runtime_error（MESSAGE_TOO_LARGE）。
 */
(function () {
  'use strict';

  var RUNTIME_VERSION = '1.1.0';
  var MAX_PAYLOAD_BYTES = 4096;
  var MAX_TEXT_BYTES = 2048;
  var MAX_ERROR_BYTES = 1024;
  var SELECTION_DEBOUNCE_MS = 220;
  var RESIZE_DEBOUNCE_MS = 160;
  var THEME_TOKENS = [
    'surface',
    'panel',
    'raised',
    'border',
    'border-strong',
    'ink',
    'muted',
    'faint',
    'invert',
    'invert-ink',
    'code-bg',
    'font-sans',
    'font-mono'
  ];
  var HOST_MESSAGE_TYPES = ['theme', 'pause', 'resume', 'quote', 'focus_block'];
  var EMIT_TYPES = ['interaction', 'progress', 'complete'];

  var CHANNEL = typeof window.__MP_CHANNEL__ === 'string' ? window.__MP_CHANNEL__ : '';
  // channel 只保存在闭包里，不留在全局，也不写入 DOM 属性（契约 §8.2）
  try {
    delete window.__MP_CHANNEL__;
  } catch (err) {
    window.__MP_CHANNEL__ = undefined;
  }

  var readyCalled = false;
  var subscribers = [];
  var reportingError = false;
  var lastSelectionText = '';
  var selectionTimer = 0;
  var resizeTimer = 0;
  var lastResize = { width: 0, height: 0 };
  var state = { mode: 'light', reducedMotion: false, tokens: {} };

  var root = document.documentElement;
  // page-kit 2.0 的 flow 页允许页内滚动：Space/PageDown 交给浏览器滚动，只保留左右方向键翻页。
  var scrollMode = false;
  try {
    scrollMode = root.getAttribute('data-mp-scroll') === 'flow';
  } catch (err) {
    scrollMode = false;
  }

  function utf8Length(text) {
    if (typeof text !== 'string') return 0;
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
    return text.length;
  }

  function truncateBytes(text, limit) {
    if (typeof text !== 'string') return '';
    if (utf8Length(text) <= limit) return text;
    var out = '';
    for (var i = 0; i < text.length; i += 1) {
      var next = out + text.charAt(i);
      if (utf8Length(next) > limit) break;
      out = next;
    }
    return out;
  }

  function warn(message) {
    if (window.console && typeof window.console.warn === 'function') {
      window.console.warn('[MockFinal] ' + message);
    }
  }

  function isHostSource(source) {
    // 顶层窗口（宿主没有包 iframe）时 window.parent === window，此时不接受任何“宿主消息”，避免自环
    return !!source && source === window.parent && window.parent !== window;
  }

  function post(type, payload) {
    var body = {
      channel: CHANNEL,
      type: type,
      payload: payload === undefined ? {} : payload
    };
    var text;
    try {
      text = JSON.stringify(body);
    } catch (err) {
      text = null;
    }
    if (text === null) {
      reportError('消息 payload 无法序列化', 'runtime');
      return false;
    }
    if (utf8Length(text) > MAX_PAYLOAD_BYTES) {
      reportError('MESSAGE_TOO_LARGE', 'runtime');
      return false;
    }
    try {
      window.parent.postMessage(body, '*');
    } catch (err) {
      return false;
    }
    return true;
  }

  function reportError(message, source, line, column) {
    if (reportingError) return;
    reportingError = true;
    try {
      post('runtime_error', {
        message: truncateBytes(String(message || '未知错误'), MAX_ERROR_BYTES),
        source: typeof source === 'string' ? truncateBytes(source, 512) : 'runtime',
        line: typeof line === 'number' && isFinite(line) ? line : 0,
        column: typeof column === 'number' && isFinite(column) ? column : 0
      });
    } finally {
      reportingError = false;
    }
  }

  function readTokens() {
    var tokens = {};
    var computed = null;
    try {
      computed = window.getComputedStyle(root);
    } catch (err) {
      computed = null;
    }
    for (var i = 0; i < THEME_TOKENS.length; i += 1) {
      var name = THEME_TOKENS[i];
      var value = '';
      if (computed) value = computed.getPropertyValue('--mp-' + name);
      tokens[name] = typeof value === 'string' ? value.trim() : '';
    }
    return Object.freeze(tokens);
  }

  function readMode() {
    var attr = root.getAttribute('data-mp-theme');
    return attr === 'dark' ? 'dark' : 'light';
  }

  function applyMode(mode) {
    if (mode !== 'dark' && mode !== 'light') return;
    root.setAttribute('data-mp-theme', mode);
    state.mode = mode;
    state.tokens = readTokens();
  }

  function applyReducedMotion(value) {
    var reduced = typeof value === 'boolean' ? value : state.reducedMotion;
    state.reducedMotion = reduced;
    root.setAttribute('data-mp-reduced-motion', reduced ? 'true' : 'false');
  }

  function getTheme() {
    state.mode = readMode();
    state.tokens = readTokens();
    return Object.freeze({
      mode: state.mode,
      tokens: state.tokens,
      reducedMotion: state.reducedMotion
    });
  }

  function notify(message) {
    var list = subscribers.slice();
    for (var i = 0; i < list.length; i += 1) {
      try {
        list[i](message);
      } catch (err) {
        reportError(err && err.message ? err.message : String(err), 'host-message');
      }
    }
  }

  function onHostMessage(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('MockFinal.onHostMessage(fn) 需要函数');
    }
    subscribers.push(fn);
    return function unsubscribe() {
      var index = subscribers.indexOf(fn);
      if (index >= 0) subscribers.splice(index, 1);
    };
  }

  function setupHostListener() {
    window.addEventListener('message', function (event) {
      if (!CHANNEL) return;
      if (!isHostSource(event.source)) return;
      var data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.channel !== CHANNEL) return;
      var type = data.type;
      if (HOST_MESSAGE_TYPES.indexOf(type) < 0) return;
      var payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
      if (type === 'theme') {
        if (payload.mode === 'light' || payload.mode === 'dark') applyMode(payload.mode);
        if (typeof payload.reducedMotion === 'boolean') applyReducedMotion(payload.reducedMotion);
      } else if (type === 'pause') {
        root.setAttribute('data-mp-paused', 'true');
      } else if (type === 'resume') {
        root.setAttribute('data-mp-paused', 'false');
      } else if (type === 'focus_block') {
        highlightBlock(payload.block_id);
      }
      notify({ type: type, payload: payload });
    });
  }

  var focusTimer = null;
  function highlightBlock(blockId) {
    if (typeof blockId !== 'string' || blockId === '') return;
    var target = null;
    var nodes = document.querySelectorAll('[data-mp-block]');
    for (var i = 0; i < nodes.length; i += 1) {
      if (nodes[i].getAttribute('data-mp-block') === blockId) {
        target = nodes[i];
        break;
      }
    }
    if (!target) return;
    if (focusTimer) window.clearTimeout(focusTimer);
    var previous = document.querySelector('[data-mp-focus]');
    if (previous) previous.removeAttribute('data-mp-focus');
    target.setAttribute('data-mp-focus', 'true');
    focusTimer = window.setTimeout(function () {
      focusTimer = null;
      target.removeAttribute('data-mp-focus');
    }, 1800);
  }

  function setupSelection() {
    document.addEventListener('selectionchange', function () {
      if (selectionTimer) window.clearTimeout(selectionTimer);
      selectionTimer = window.setTimeout(reportSelection, SELECTION_DEBOUNCE_MS);
    });
  }

  function blockTextOf(node) {
    var element = node;
    if (element && element.nodeType === 3) element = element.parentElement;
    while (element && element !== document.body && element !== root) {
      var tag = element.tagName ? element.tagName.toLowerCase() : '';
      if (tag === 'p' || tag === 'li' || tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'blockquote' || tag === 'figcaption' || tag === 'td') {
        break;
      }
      element = element.parentElement;
    }
    if (!element) return '';
    var text = element.textContent || '';
    return truncateBytes(String(text).replace(/\s+/g, ' ').trim(), MAX_TEXT_BYTES);
  }

  function reportSelection() {
    var selection = window.getSelection ? window.getSelection() : null;
    if (!selection || selection.rangeCount === 0) return;
    var text = truncateBytes(String(selection.toString() || '').replace(/\s+/g, ' ').trim(), MAX_TEXT_BYTES);
    if (!text) {
      if (lastSelectionText) {
        lastSelectionText = '';
        post('selection', { text: '', rect: null, blockText: '' });
      }
      return;
    }
    if (text === lastSelectionText) return;
    lastSelectionText = text;
    var rect = null;
    try {
      var box = selection.getRangeAt(0).getBoundingClientRect();
      rect = {
        x: Math.round(box.left),
        y: Math.round(box.top),
        width: Math.round(box.width),
        height: Math.round(box.height)
      };
    } catch (err) {
      rect = null;
    }
    post('selection', { text: text, rect: rect, blockText: blockTextOf(selection.anchorNode) });
  }

  function isEditableTarget(target) {
    var element = target;
    while (element && element !== document.body) {
      var tag = element.tagName ? element.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable) {
        return true;
      }
      element = element.parentElement;
    }
    return false;
  }

  function isControlTarget(target) {
    var element = target;
    while (element && element !== document.body) {
      var tag = element.tagName ? element.tagName.toLowerCase() : '';
      var role = element.getAttribute ? element.getAttribute('role') : null;
      if (tag === 'button' || tag === 'a' || role === 'button') return true;
      element = element.parentElement;
    }
    return false;
  }

  function setupKeyboard() {
    // 焦点进入 iframe 后宿主收不到键事件；转发页面未处理的导航键。
    document.addEventListener('keydown', function (event) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (isEditableTarget(event.target)) return;
      if (scrollMode) {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          post('request_next', {});
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          post('request_prev', {});
        }
        // Space / PageDown / PageUp / 上下箭头保持浏览器默认滚动
        return;
      }
      if (event.key === ' ' && isControlTarget(event.target)) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        post('request_next', {});
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        post('request_prev', {});
      }
    });
  }

  function setupResize() {    if (typeof window.ResizeObserver !== 'function') return;
    var observer = new window.ResizeObserver(function () {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        var width = Math.round(window.innerWidth);
        var height = Math.round(window.innerHeight);
        if (width === lastResize.width && height === lastResize.height) return;
        lastResize = { width: width, height: height };
        post('resize', { width: width, height: height });
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(root);
  }

  function setupReducedMotion() {
    var query = null;
    try {
      query = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    } catch (err) {
      query = null;
    }
    state.reducedMotion = !!(query && query.matches);
    applyReducedMotion(state.reducedMotion);
    if (query && typeof query.addEventListener === 'function') {
      query.addEventListener('change', function (event) {
        applyReducedMotion(!!event.matches);
        notify({ type: 'theme', payload: { reducedMotion: state.reducedMotion } });
      });
    }
  }

  function setupErrorReporting() {
    window.addEventListener('error', function (event) {
      if (event && event.target && event.target !== window && event.target.tagName) {
        // 资源加载失败（如 data: 图片损坏）同样上报，便于宿主定位
        reportError('资源加载失败：' + event.target.tagName.toLowerCase(), 'resource', 0, 0);
        return;
      }
      reportError(event && event.message ? event.message : '未捕获错误', event && event.filename ? event.filename : 'window', event ? event.lineno : 0, event ? event.colno : 0);
    });
    window.addEventListener('unhandledrejection', function (event) {
      var reason = event && event.reason;
      var message = reason && reason.message ? reason.message : String(reason || '未处理的 Promise 拒绝');
      reportError(message, 'unhandledrejection', 0, 0);
    });
  }

  function ready(options) {
    if (readyCalled) {
      warn('MockFinal.ready 只能调用一次，重复调用已忽略');
      return false;
    }
    readyCalled = true;
    var title = options && typeof options.title === 'string' ? truncateBytes(options.title.trim(), 200) : '';
    if (title) {
      try {
        document.title = title;
      } catch (err) {
        /* 标题写入失败不影响就绪 */
      }
    }
    root.setAttribute('data-mp-ready', 'true');
    post('ready', { title: title });
    return true;
  }

  function emit(type, payload) {
    if (typeof type !== 'string' || !type) {
      throw new TypeError('MockFinal.emit(type, payload) 需要非空字符串 type');
    }
    if (EMIT_TYPES.indexOf(type) < 0) {
      warn('未登记的 emit 类型：' + type);
    }
    return post('event', { type: type, payload: payload === undefined ? {} : payload });
  }

  function next() {
    return post('request_next', {});
  }

  function prev() {
    return post('request_prev', {});
  }

  function requestAssistant(quote) {
    var payload = {};
    if (typeof quote === 'string' && quote) {
      payload.quote = truncateBytes(quote, MAX_TEXT_BYTES);
    }
    return post('request_assistant', payload);
  }

  function install() {
    var api = {
      version: RUNTIME_VERSION,
      ready: ready,
      emit: emit,
      next: next,
      prev: prev,
      requestAssistant: requestAssistant,
      getTheme: getTheme,
      onHostMessage: onHostMessage
    };
    Object.freeze(api);
    try {
      Object.defineProperty(window, 'MockFinal', {
        value: api,
        writable: false,
        configurable: false,
        enumerable: true
      });
    } catch (err) {
      window.MockFinal = api;
    }
    state.mode = readMode();
    state.tokens = readTokens();
    setupReducedMotion();
    setupHostListener();
    setupSelection();
    setupKeyboard();
    setupResize();
    setupErrorReporting();
    // 供宿主与 Validator 诊断的只读标记（不含任何页面数据）
    root.setAttribute('data-mp-runtime', RUNTIME_VERSION);
    return api;
  }

  if (window.MockFinal && window.MockFinal.version) {
    // 已注入过：不重复安装，避免 defineProperty 冲突
    return;
  }
  install();
})();
