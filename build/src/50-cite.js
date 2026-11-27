// 角标：点击、装饰器、右侧栏原文 tab
// 由 build/src 拼接后注入 factory，和同目录其它片段共享作用域（不要加 import/export）。
function openCiteDetail(ctx, detail) {
  try { window.sessionStorage.setItem('dsh-weknora:last-cite', JSON.stringify(detail)) } catch (err) { /* 隐私模式忽略 */ }
  // 优先在右侧边栏开一个原文 tab；只有右侧栏打不开时才退回面板，
  // 否则点角标会顺带把左侧知识库面板切到那个文件，打扰正在看的东西。
  var opened = false
  // 原文在右侧栏打开（用户要的是侧边栏，不是浮层）。
  try { opened = openCiteInSidebar(ctx, detail) } catch (e) { opened = false }
  // 无论右侧栏有没有开，都通知面板：面板正在预览时，点下一个角标要跟着切文件 / 跳页。
  try { window.dispatchEvent(new CustomEvent('dsh-weknora:open-cite', { detail: detail })) } catch (e) { /* 忽略 */ }
  console.log('[dsh-weknora] 角标点击 →', opened ? '右侧栏原文' : '面板原文', detail.chunkId)
}

/**
 * 会话里 agent 回答带的角标是 <a href="dsh-weknora:c/<短码>">（或旧版的
 * dsh-weknora:chunk/<id>?doc=...）。在 capture 阶段拦下，别让浏览器去导航，
 * 改成在右侧边栏把原文渲染出来。
 */
function bindCiteLinks(ctx) {
  if (window.__DSH_WK_CLICK_BOUND__) return
  window.__DSH_WK_CLICK_BOUND__ = true
  document.addEventListener('click', function (e) {
    // 角标在 DSH 的 shadow root 里：事件冒泡到 document 时 e.target 已被 retarget 成
    // shadow host，顺着 parentElement 永远找不到那个 <a>。必须用 composedPath() 取原始路径。
    var el = null
    var path = []
    try { path = (e.composedPath && e.composedPath()) || [] } catch (err) { path = [] }
    for (var pi = 0; pi < path.length; pi++) {
      var pn = path[pi]
      if (pn && pn.nodeType === 1 && pn.tagName === 'A' && /^dsh-weknora:/i.test(pn.getAttribute('href') || '')) {
        el = pn
        break
      }
    }
    if (!el) {
      var cur = e.target
      while (cur && cur.nodeType === 1 && !(cur.tagName === 'A' && /^dsh-weknora:/i.test(cur.getAttribute('href') || ''))) {
        cur = cur.parentElement
      }
      el = cur
    }
    if (!el || el.nodeType !== 1) return
    var href = el.getAttribute('href') || ''

    // 新格式：短码，先问宿主把 chunk id 换回来
    var sc = /^dsh-weknora:c\/([0-9a-z]+)$/i.exec(href)
    if (sc) {
      e.preventDefault()
      e.stopPropagation()
      api('/cite?k=' + encodeURIComponent(sc[1])).then(function (r) {
        if (!r || !r.ok || !r.chunkId) {
          toast((r && r.message) || '这条出处已失效，请重新提问')
          return
        }
        openCiteDetail(ctx, { chunkId: r.chunkId, doc: r.doc || '' })
      }).catch(function (err) {
        toast('出处解析失败：' + ((err && err.message) || err))
      })
      return
    }

    // 旧格式：chunk/<id>?doc=<文件名>（历史消息里可能还留着）
    var m = /^dsh-weknora:chunk\/([^?#]+)(?:\?(.*))?$/i.exec(href)
    if (!m) return
    e.preventDefault()
    e.stopPropagation()
    var q = {}
    ;(m[2] || '').split('&').forEach(function (kv) {
      if (!kv) return
      var i = kv.indexOf('=')
      q[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1))
    })
    openCiteDetail(ctx, { chunkId: decodeURIComponent(m[1]), doc: q.doc || '' })
  }, true)
}

// ── 正文角标装饰：把 [1] [2] 变成可点角标 ────────────────────────────
// agent 转述 WeKnora 答案时，markdown 链接会被它简化掉；但 `[1]` 这种纯文本标记
// 基本会原样保留。这里在 DOM 层把 `[1]` 换成 <a href="dsh-weknora:chunk/...">，
// 复用 bindCiteLinks 的 capture 点击拦截，点一下就在右侧栏打开原文并标黄。

function decorateSkip(node) {
  for (var el = node && node.parentElement; el; el = el.parentElement) {
    var t = el.tagName
    if (t === 'PRE' || t === 'CODE' || t === 'A' || t === 'TEXTAREA' || t === 'SCRIPT' || t === 'STYLE') return true
    if (t === 'INPUT' || t === 'SELECT' || t === 'OPTION') return true
    // 关键：输入框/编辑器里的 [1] 绝不能碰。之前只挡住了 textarea，
    // 富文本编辑器（contenteditable 的 div）被误装饰，正在输入的拼音被拆散、
    // 提交时还会把 <a> 一起发出去。
    if (el.isContentEditable) return true
    try {
      if (el.getAttribute) {
        var ce = el.getAttribute('contenteditable')
        if (ce === '' || ce === 'true' || ce === 'plaintext-only') return true
        if (el.getAttribute('role') === 'textbox') return true
      }
    } catch (e) { /* 忽略 */ }
  }
  return false
}

// DSH 的消息区可能挂在 shadow root 里（插件样式都要往每个 shadowRoot 塞一份），
// 所以装饰器不能只看 document.body，得把所有 shadow root 一起扫。
function citeRoots() {
  // 原来用递归收集 shadow root：DSH 的组件树很深，每个组件几乎都有 shadowRoot，
  // 递归层数直接跟着 DOM 深度走 → 深会话里就抛 Maximum call stack size exceeded。
  // 改成显式栈迭代，并给收集数量设上限，任何页面结构都不会把这里撑爆。
  var out = []
  var stack = []
  var seen = new Set()
  var budget = 400
  try { if (document.body) stack.push(document.body) } catch (e) { return out }
  while (stack.length && out.length < budget) {
    var root = stack.pop()
    if (!root || seen.has(root)) continue
    seen.add(root)
    out.push(root)
    var els
    try { els = root.querySelectorAll('*') } catch (e) { continue }
    var n = els.length
    if (n > 4000) n = 4000           // 超大 DOM 只扫前 4000 个，避免长时间阻塞
    for (var i = 0; i < n; i++) {
      var el = els[i]
      var sr = el && el.shadowRoot
      if (sr && !seen.has(sr)) stack.push(sr)
    }
  }
  return out
}

function decorateCiteMarks() {
  var __n = _doDecorate()
  if (__n > 0) { try { logDiag('decorate', { n: __n }) } catch (e) {} }
  return __n
}
function _doDecorate() {
  var roots = citeRoots()
  if (!roots.length) return 0
  var total = 0
  roots.forEach(function (root) { total += decorateOneRoot(root) })
  return total
}

// 只认短码 [#ab12cd34]。裸 [1] 一律不装饰：
// 正文示例、代码里的 m[1]、思考过程里的编号都会被误伤，
// 之前把推理区里的 m[1] 染成蓝角标就是这么来的。
// 只认规范短码 [#8位小写hex]。模型复述时会把 [#cb6ea94c] 抄成 [#C~hn]、[#?R]，
// 这类脏标记既点不了又不该显示，由 MARK_JUNK 直接隐藏掉。
var MARK_RE = /[\[【]#([0-9a-z]{4,12})[\]】]/g
var MARK_JUNK = /[\[【]#[^\[\]【】\n]{1,14}[\]】]/g

function decorateOneRoot(root) {
  var localSeq = { __n: 0 }

  // 先清掉「脏标记」：模型把 [#cb6ea94c] 抄成 [#C~hn]、[#?R] 这种情况，
  // 既点不了也不该出现在正文里。含合法短码的文本节点跳过，交给下面正常装饰。
  try {
    var junkWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
    var junkNodes = []
    var jn
    while ((jn = junkWalker.nextNode())) {
      var jt = jn.nodeValue
      if (!jt || (jt.indexOf('[#') < 0 && jt.indexOf('【#') < 0)) continue
      if (decorateSkip(jn)) continue
      MARK_RE.lastIndex = 0
      if (MARK_RE.test(jt)) continue
      MARK_JUNK.lastIndex = 0
      if (MARK_JUNK.test(jt)) junkNodes.push(jn)
    }
    for (var ji = 0; ji < junkNodes.length; ji++) {
      var nn = junkNodes[ji]
      MARK_JUNK.lastIndex = 0
      nn.nodeValue = String(nn.nodeValue).replace(MARK_JUNK, '')
    }
  } catch (e) { /* 清不掉就保持原样，不影响下面的装饰 */ }

  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  var nodes = []
  var node
  var guard = 0
  while ((node = walker.nextNode())) {
    if (++guard > 20000) break   // 单个 root 最多扫 2 万个文本节点
    var txt = node.nodeValue
    if (!txt || (txt.indexOf('[') < 0 && txt.indexOf('【') < 0)) continue
    // 新格式 [#ab12cd34]（短码，全局唯一）；旧格式 [1] / 【1】（历史消息）
    MARK_RE.lastIndex = 0
    if (!MARK_RE.test(txt)) continue
    if (decorateSkip(node)) continue
    nodes.push(node)
  }
  var done = 0
  for (var j = 0; j < nodes.length; j++) {
    var src = nodes[j]
    var text = src.nodeValue
    var re = MARK_RE
    re.lastIndex = 0
    var frag = document.createDocumentFragment()
    var last = 0
    var m
    var changed = false
    while ((m = re.exec(text))) {
      var short = m[1] || ''
      var a
      if (short) {
        // 短码：不需要编号表，短码本身就指向唯一 chunk。
        // 显示编号按「本条消息内第几次出现」算，所以每条回答都从 1 开始。
        var seq = localSeq[short]
        if (!seq) { seq = (++localSeq.__n); localSeq[short] = seq }
        var doc = ''
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)))
        a = document.createElement('a')
        a.className = 'dsh-wk-cite dsh-wk-cite-dom'
        a.setAttribute('href', 'dsh-weknora:c/' + short)
        a.setAttribute('title', (doc ? doc + ' · ' : '') + '第 ' + seq + ' 处出处')
        a.setAttribute('data-wk-cite', short)
        a.textContent = String(seq)
        frag.appendChild(a)
        last = m.index + m[0].length
        changed = true
        done++
        continue
      }
    }
    if (!changed || !src.parentNode) continue
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
    src.parentNode.replaceChild(frag, src)
  }
  return done
}

function logDiag(evt, data) {
  if (!window.__DSH_WK_DIAG__) return
  if (window.__WK_DIAG_BUSY__) return   // 防止「记录日志本身出错 → 又触发错误上报」的递归
  try {
    window.__WK_DIAG_BUSY__ = true
    var s = evt + ' ' + safeJson(data || {})
    var p = fetch(API + '/diag', { method: 'POST', body: s })
    if (p && typeof p.catch === 'function') p.catch(function () { /* 诊断端点不可用时静默 */ })
  } catch (e) { /* 忽略 */ }
  finally { try { window.__WK_DIAG_BUSY__ = false } catch (e2) {} }
}

// 只序列化「能安全展开的纯数据」：DOM 节点、window 这类带循环引用的对象一律换成短标签，
// 否则 JSON.stringify 会抛 circular，错误上报再触发上报，最终就是 Maximum call stack size exceeded。
function safeJson(v, depth) {
  var d = depth || 0
  try {
    if (v === null || v === undefined) return 'null'
    var t = typeof v
    if (t === 'string') return JSON.stringify(v.length > 400 ? v.slice(0, 400) + '…' : v)
    if (t === 'number' || t === 'boolean') return String(v)
    if (t === 'function') return '"[function]"'
    if (d >= 3) return '"[deep]"'
    if (v.nodeType || v === window || v === document) return '"[dom]"'
    if (Array.isArray(v)) {
      var arr = []
      for (var i = 0; i < v.length && i < 40; i++) arr.push(safeJson(v[i], d + 1))
      return '[' + arr.join(',') + ']'
    }
    var parts = []
    var keys = Object.keys(v).slice(0, 30)
    for (var k = 0; k < keys.length; k++) parts.push(JSON.stringify(keys[k]) + ':' + safeJson(v[keys[k]], d + 1))
    return '{' + parts.join(',') + '}'
  } catch (e) {
    return '"[unserializable]"'
  }
}

// 启动后自动采样一轮（每 5 秒一次，共 12 次），不需要用户刻意操作，
// 用来抓「点角标把页面越撑越高」的时间序列。
function startLayoutWatch() {
  try {
    if (window.__DSH_WK_LAYOUT_WATCH__) return
    window.__DSH_WK_LAYOUT_WATCH__ = true
    var n = 0
    var t = setInterval(function () {
      n += 1
      probeLayout('tick' + n)
      if (n >= 12) clearInterval(t)
    }, 5000)
  } catch (e) { /* 忽略 */ }
}

function observeCiteMarks() {
  if (window.__DSH_WK_CITE_OBS__) return
  window.__DSH_WK_CITE_OBS__ = true
  var timer = null
  var run = function () {
    if (timer) return
    timer = setTimeout(function () {
      timer = null
      try { decorateCiteMarks() } catch (e) { /* 忽略 */ }
    }, 400)
  }
  // 只对「非编辑区」的变化做装饰：输入框里打字也会触发 MutationObserver，
  // 之前每个字符都触发一次全文档扫描，正在输入的拼音被拆散、提交时还带着 <a>。
  try {
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        if (!decorateSkip(muts[i].target)) { run(); return }
      }
    })
    mo.observe(document.body, { childList: true, subtree: true, characterData: true })
  } catch (e) { /* 忽略 */ }
  try { decorateCiteMarks() } catch (e) { /* 忽略 */ }
  setInterval(run, 4000)
}

// 角标样式一定要在会话正文第一次渲染前就位，否则用户会先看到一个蓝色下划线链接，
// 紧接着才被 CSS 改成上标角标（肉眼可见的闪烁）。
try { injectCiteStyles() } catch (e) { /* 忽略 */ }

// ── 右侧边栏里的「知识库原文」tab ─────────────────────────
var CITE_TAB_ID = 'dsh-weknora-panel/cite'
var citeTabTypeDispose = null
var CITE_TAB_KIND = 'weknora-cite'
var __wkCtx = null

/** 关掉原文 tab：直接把整列收起，不留下一个空的默认页 */
function closeCiteTab() {
  try {
    if (__wkCtx && __wkCtx.sidebarRight && typeof __wkCtx.sidebarRight.toggleExpanded === 'function') {
      if (typeof __wkCtx.sidebarRight.isExpanded !== 'function' || __wkCtx.sidebarRight.isExpanded()) {
        __wkCtx.sidebarRight.toggleExpanded()
      }
    }
  } catch (e) { /* 忽略 */ }
}

/**
 * 打开右侧栏原文 tab。左侧会话栏完全不动 —— 之前会顺手收起左侧栏，
 * 导致用户正在看的会话被关掉、还留下一个空的「开始」页。
 */
/**
 * 最近一次角标点击的 { chunkId, doc }。
 *
 * 为什么要这个全局变量：`sidebarRight.openTab(kind, {params})` 传进去的 params
 * 在 tab 正文里能不能取到，取决于 DSH 版本（0.2.2-rc.1 的 `tab.navigation` 是
 * snapshot store，且 slot 组件的 props 里不保证有 useTabInfo）。点击和打开发生在
 * 同一个前端上下文里，直接记一份最稳；params 仅作为刷新/恢复时的兜底。
 */
var PENDING_CITE = null

// 布局探针：点角标后量一次「谁把页面撑高了」，落宿主 diag 日志。
// 用来定位「点得越多、界面越往上跑」这种累积性撑高，不参与任何功能逻辑。
function probeLayout(tag) {
  try {
    var de = document.documentElement
    var bd = document.body
    var all = document.querySelectorAll('*')
    var list = []
    var n = Math.min(all.length, 8000)
    for (var i = 0; i < n; i++) {
      var el = all[i]
      var h = el.offsetHeight || 0
      if (h < 800) continue
      var cls = ''
      try { cls = String(el.className || '').slice(0, 48) } catch (e) { cls = '' }
      list.push({ tag: el.tagName + (cls ? '.' + cls : ''), h: h })
    }
    list.sort(function (x, y) { return y.h - x.h })
    // 记下 body 直接子元素的位置：上移时哪一层的 top 变了，一眼能看出来
    var kids = []
    try {
      var ch = (bd && bd.children) || []
      for (var j = 0; j < ch.length && j < 12; j++) {
        var k = ch[j]
        var kr = k.getBoundingClientRect()
        var kc = ''
        try { kc = String(k.className || '').slice(0, 36) } catch (e8) { kc = '' }
        kids.push({ t: k.tagName + (kc ? '.' + kc : ''), top: Math.round(kr.top), h: Math.round(kr.height) })
      }
    } catch (e9) {}
    var overX = null
    try {
      var de2 = document.documentElement
      if (de2 && (de2.scrollWidth || 0) > (window.innerWidth || 0) + 1) {
        var wide = []
        var all = document.querySelectorAll('body *')
        for (var z = 0; z < all.length && wide.length < 6; z++) {
          var q = all[z].getBoundingClientRect()
          if (q.width > (window.innerWidth || 0) + 1) {
            var qc = ''
            try { qc = String(all[z].className || '').slice(0, 40) } catch (e7) { qc = '' }
            wide.push(all[z].tagName + (qc ? '.' + qc : '') + ' w=' + Math.round(q.width))
          }
        }
        overX = { scrollW: de2.scrollWidth, innerW: window.innerWidth, wide: wide }
      }
    } catch (e6) {}
    logDiag('layout', {
      tag: tag,
      scrollY: window.scrollY || 0,
      overX: overX,
      bodyTop: bd ? Math.round(bd.getBoundingClientRect().top) : 0,
      kids: kids,
      docScrollH: de ? de.scrollHeight : 0,
      bodyScrollH: bd ? bd.scrollHeight : 0,
      bodyOffsetH: bd ? bd.offsetHeight : 0,
      innerH: window.innerHeight || 0,
      tall: list.slice(0, 8)
    })
  } catch (e) { /* 探针失败不影响功能 */ }
}

// ── 原文浮层（shell.overlay）──────────────────────────────
// 为什么是浮层而不是右侧栏 tab：
//   tab 的内容是文档流里的普通元素，高度会参与宿主布局，PDF 一多就把整页顶高；
//   shell.overlay 是 fixed 的整页浮层，完全不占文档流，从机制上不可能撑高宿主。
var CITE_OVL = { visible: false, chunkId: '', doc: '', subs: [] }
var CITE_OVL_READY = false

function citeOvlSet(patch) {
  if (patch) {
    for (var k in patch) { if (Object.prototype.hasOwnProperty.call(patch, k)) CITE_OVL[k] = patch[k] }
  }
  var subs = CITE_OVL.subs.slice()
  for (var i = 0; i < subs.length; i++) { try { subs[i]() } catch (e) { /* 单个订阅者出错忽略 */ } }
}

function openCiteOverlay(detail) {
  citeOvlSet({ visible: true, chunkId: String(detail.chunkId || ''), doc: String(detail.doc || '') })
}

function CiteOverlay() {
  var st = React.useState(0)
  var bump = st[1]
  React.useEffect(function () {
    CITE_OVL.subs.push(bump)
    function onKey(ev) { if (ev && ev.key === 'Escape') citeOvlSet({ visible: false }) }
    window.addEventListener('keydown', onKey)
    return function () {
      var i = CITE_OVL.subs.indexOf(bump)
      if (i >= 0) CITE_OVL.subs.splice(i, 1)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  if (!CITE_OVL.visible || !CITE_OVL.chunkId) return null
  return h('div', {
    className: 'dsh-wk-ovl',
    onClick: function (e) { if (e.target === e.currentTarget) citeOvlSet({ visible: false }) }
  },
    h('div', { className: 'dsh-wk-ovl-card' },
      h('div', { className: 'dsh-wk-ovl-h' },
        h('span', { className: 'dsh-wk-ovl-t', title: CITE_OVL.doc }, CITE_OVL.doc || '原文'),
        h('button', {
          className: 'dsh-wk-x',
          onClick: function () { citeOvlSet({ visible: false }) }
        }, '✕')),
      h('div', { className: 'dsh-wk-ovl-b' },
        h(CiteTabBodyInner, { chunkId: CITE_OVL.chunkId, doc: CITE_OVL.doc }))))
}

function registerCiteOverlay(ctx) {
  try {
    if (!ctx || !ctx.slots) return false
    ctx.effect(function () {
      return ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({ name: 'shell.overlay', id: 'dsh-weknora-cite-overlay' }, CiteOverlay)
      })
    }, 'dsh-weknora: 原文浮层')
    CITE_OVL_READY = true
    console.log('[dsh-weknora] 原文浮层已注册（shell.overlay）')
    return true
  } catch (e) {
    console.warn('[dsh-weknora] 原文浮层注册失败：', e && e.message)
    return false
  }
}

// ── 右侧栏 tab 类型注册 ─────────────────────────────────────────────
// SidebarRightTabRegistry.register() 的副作用写在它自己所属插件（ui-sidebar-right）的
// ctx.effect 里，跨插件调用时不会执行，所以只调 register() 不会让 placeTab 找得到类型。
// 另外 sidebarRightTabs 不一定是注入服务名，controller 上也挂着同一份 registry（controller.tabs）。
// 这里两头都试，并把类型直接写进 kinds/ids（不走 ctx.effect），点击前也再兜一次。
var citeTabTypeDispose = null

function citeTabsOf(ctx) {
  if (!ctx) return null
  try { if (ctx.sidebarRightTabs) return ctx.sidebarRightTabs } catch (e) {}
  try { if (ctx.sidebarRight && ctx.sidebarRight.tabs) return ctx.sidebarRight.tabs } catch (e) {}
  return null
}

function ensureCiteTabType(ctx) {
  var reg = citeTabsOf(ctx)
  if (!reg) {
    try { logDiag('cite-tab-no-registry', { hasRight: !!(ctx && ctx.sidebarRight) }) } catch (e) {}
    return false
  }
  var definition = {
    id: CITE_TAB_ID,
    kind: CITE_TAB_KIND,
    priority: 'extension',
    title: function () { return '知识库原文' },
  }
  try {
    if (!citeTabTypeDispose && typeof reg.register === 'function') citeTabTypeDispose = reg.register(definition)
  } catch (eReg) {
    var m = String((eReg && eReg.message) || '')
    if (m.indexOf('already registered') < 0) {
      try { logDiag('register-cite-tab-type-fail', { msg: m }) } catch (e) {}
    }
  }
  try {
    var has = !!(reg.kinds && typeof reg.kinds.get === 'function' && reg.kinds.get(CITE_TAB_KIND))
    if (!has && reg.kinds && typeof reg.kinds.set === 'function') {
      var entry = {
        definition: definition,
        band: 'extension',
        matchers: [],
        order: (reg.registrations = (reg.registrations || 0) + 1),
      }
      try { if (reg.ids && reg.ids.add) reg.ids.add(CITE_TAB_ID) } catch (e2) {}
      reg.kinds.set(CITE_TAB_KIND, { inForce: entry, shadowed: undefined })
      try { if (typeof reg.refresh === 'function') reg.refresh() } catch (e3) {}
      try { logDiag('cite-tab-manual-register', { ok: true, via: reg === (ctx.sidebarRight && ctx.sidebarRight.tabs) ? 'controller' : 'inject' }) } catch (e4) {}
    }
    return true
  } catch (e5) {
    try { logDiag('cite-tab-manual-register-fail', { msg: e5 && e5.message }) } catch (e6) {}
    return false
  }
}

function openCiteInSidebar(ctx, detail) {
  if (window.__DSH_WK_DIAG__) { try { probeLayout('before-open') } catch (eB) {} }
  try { ensureCiteTabType(ctx) } catch (e0) {}
  try {
    if (!ctx || !ctx.sidebarRight || typeof ctx.sidebarRight.openTab !== 'function') return false
    PENDING_CITE = { chunkId: String(detail.chunkId || ''), doc: String(detail.doc || ''), at: Date.now() }
    if (typeof ctx.sidebarRight.isExpanded === 'function' && !ctx.sidebarRight.isExpanded()) {
      ctx.sidebarRight.toggleExpanded()
    }
    // revealIfOpened：同 kind 的 tab 已经开着就复用，不要每点一次角标就再开一个
    // （之前连续点不同角标会堆出好几个 tab，右侧栏高度被挤乱、整个会话区跟着错位）。
    // 不带 params：DSH 用 pageAddress(kind, params) 当 contentId，参数不同就会被当成另一个 tab，
    // 于是每点一次角标就多开一个（右侧栏高度叠一层、整页被顶高）。
    // 内容走 PENDING_CITE + 'dsh-weknora:open-cite' 事件，tab 自己更新。
    // params 用「恒定值」：contentId = pageAddress(kind, params)，恒定的 params 让同一个
    // kind 永远复用同一个 tab（不会每点一次多开一个），内容仍由 PENDING_CITE 推给 tab 自己更新。
    ctx.sidebarRight.openTab(CITE_TAB_KIND, { params: { mode: 'cite' }, revealIfOpened: true })
    if (window.__DSH_WK_DIAG__) { try { setTimeout(function () { probeLayout('after-open') }, 700) } catch (e) { /* 忽略 */ } }
    return true
  } catch (e) {
    console.warn('[dsh-weknora] 右侧栏打开失败，退回面板:', e && e.message)
    try { logDiag('open-cite-fail', { msg: e && e.message, stack: e && e.stack }) } catch (e2) {}
    return false
  }
}

function citeTabParams(props) {
  // 浮层直接把参数放在 props 上；右侧栏 tab 则是从 tab 快照里取。
  if (props && props.chunkId) return { chunkId: String(props.chunkId), doc: String(props.doc || '') }
  // 1) 刚刚点过角标：直接用内存里那份（最可靠，绕开 DSH 各版本 params 传递差异）
  if (PENDING_CITE && PENDING_CITE.chunkId) return PENDING_CITE
  // 2) 内存丢了（tab 在另一个渲染周期被重建、插件被热重载过）就读上次点击落下的那份
  try {
    var last = window.sessionStorage.getItem('dsh-weknora:last-cite')
    if (last) {
      var parsed = JSON.parse(last)
      if (parsed && parsed.chunkId) return parsed
    }
  } catch (e) { /* 忽略 */ }
  // 3) 兜底：从 tab 的 navigation snapshot 里取（刷新后恢复 tab 时用得到）
  try {
    var info = props && props.useTabInfo ? props.useTabInfo() : null
    var tab = info && info.tab
    var nav = tab && tab.navigation
    var snap = nav && typeof nav.getSnapshot === 'function' ? nav.getSnapshot() : nav
    return (snap && snap.params) || (tab && tab.params) || {}
  } catch (e) { return {} }
}

/** 右侧栏 tab 的标题：优先文件名 */
function CiteTabTitle(props) {
  var p = citeTabParams(props)
  return p.doc || '知识库原文'
}

/** 右侧栏 tab 的正文：整篇按分块渲染，命中段标黄 */
// ── 客户端 PDF 渲染（pdfjs 画 canvas，命中段叠黄框）──
var __pdfjs = null

var __wkChainAt = 0
function fixHeightChain() {
  // 会被 120/700/1600ms 三次定时器 + open-cite 调用；短时间重复跑会和 DSH 的
  // ResizeObserver 互相触发（日志里成片的 "loop completed with undelivered notifications"）。
  var now = Date.now()
  if (now - __wkChainAt < 400) return
  __wkChainAt = now
  // 数据（parent-chain 探针）：我们的容器 h=834、tabBody h=834，但**中间那层 DIV h=0**。
  // 也就是说 DSH 的 wrapper 把高度链断掉了 —— 我们的 height:100% 解析成 0（白屏），
  // 之前一直靠 min-height 硬造高度，造过头就把整页顶高。
  // 正确做法：只把断掉的那一层接回 100%，之后完全由父级高度决定，不再猜像素。
  try {
    var el = document.querySelector('.dsh-wk-citetab')
    for (var i = 0; el && i < 4; i++) {
      var p = el.parentElement
      if (!p) break
      var cs = window.getComputedStyle(p)
      if (p.clientHeight === 0 && (cs.height === 'auto' || cs.height === '0px')) {
        p.style.height = '100%'
        p.style.minHeight = '0'
        p.style.display = 'flex'
        p.style.flexDirection = 'column'
        p.style.overflow = 'hidden'
      }
      el = p
    }
    // 高度链接上了，但页面仍多出 21px：探测数据里 acoR2W_panel 是 position:absolute、
    // 高 872、top≈61 → 底边 933 > 视口 912，absolute 元素超出会撑大 documentElement.scrollHeight，
    // 于是整页可滚、用户看到「界面整体上移」。把它收到视口底部即可，别动它的其他样式。
    try {
      // 先复位滚动再量：页面已经滚下去 21px 时，panel 的 rect.bottom 恰好等于视口高，
      // 用「bottom > innerHeight」判断会永远不成立，导致 max-height 一次都没设上。
      var sc = document.scrollingElement
      if (sc && sc.scrollTop) sc.scrollTop = 0
      var panels = document.querySelectorAll('.acoR2W_panel, [class*="_pane_"][class*="_tabHost_"]')
      for (var pi = 0; pi < panels.length; pi++) {
        var pn = panels[pi]
        var r = pn.getBoundingClientRect()
        var avail = Math.round(window.innerHeight - Math.max(0, r.top))
        if (avail > 200 && Math.abs(r.height - avail) > 1) {
          pn.style.maxHeight = avail + 'px'
        }
      }
      if (sc && sc.scrollTop) sc.scrollTop = 0
      // 用 overflow: clip 而不是 hidden —— clip 不建立滚动容器、不改变布局高度，
      // 不会像 hidden 那样把 DSH 的高度链算塌（之前锁 body 白屏就是这个原因）。
      var de = document.documentElement
      var bd = document.body
      if (de.getAttribute('data-wk-locked') === null) {
        de.setAttribute('data-wk-locked', de.style.overflowY || '')
        de.style.overflowY = 'clip'
      }
      if (bd && bd.getAttribute('data-wk-locked') === null) {
        bd.setAttribute('data-wk-locked', bd.style.overflowY || '')
        bd.style.overflowY = 'clip'
      }
    } catch (e2) {}
    logDiag('height-chain-fixed', {
      over: document.documentElement.scrollHeight - window.innerHeight,
      htmlOverflow: document.documentElement.style.overflowY,
      bodyOverflow: document.body && document.body.style.overflowY,
      scrollY: window.scrollY,
    })
  } catch (e) {}
}

function citeChainDump() {
  // 量「我们的容器 → 右栏容器 → ... → body」每一层的实际高度：
  // 只有看清哪一层是 auto，才知道该把约束加在哪。
  try {
    var el = document.querySelector('.dsh-wk-citetab')
    var out = []
    var n = 0
    while (el && n < 10) {
      out.push({
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 40),
        h: el.clientHeight,
        sh: el.scrollHeight,
        pos: window.getComputedStyle(el).position,
        flex: window.getComputedStyle(el).flex,
      })
      el = el.parentElement
      n++
    }
    logDiag('parent-chain', { chain: out, over: document.documentElement.scrollHeight - window.innerHeight })
  } catch (e) {}
}

// 子组件 render 阶段抛错时，React 会卸载整棵 root（容器变空 = 白屏）。
// 必须有真正的 ErrorBoundary 才能把错误显示成一行字。
class CiteBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { err: null }
  }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err) { console.error('[dsh-weknora] 原文预览渲染出错：', err) }
  render() {
    if (this.state.err) {
      return h('div', { className: 'dsh-wk-citetab' },
        h('div', { className: 'dsh-wk-err' }, '打开原文出错：' + String((this.state.err && this.state.err.message) || this.state.err)))
    }
    return this.props.children
  }
}

function CiteTabBody(props) {
  // 挂载后量两次父链高度（700ms / 2500ms），看哪一层是 auto 高度、PDF 画完后溢出多少
  React.useEffect(function () {
    // 注意：t0/t3/t4 必须接住 —— 之前写成了裸 setTimeout，
    // cleanup 里 clearTimeout(t0) 抛 ReferenceError，后面的「还原 overflow」再也执行不到，
    // 于是页面被永久锁成 clip（用户看到的就是「上移之后回不来」）。
    var t0 = setTimeout(fixHeightChain, 120)
    // iframe 里是整套 pdf.js，加载完成后才把容器撑到真实高度；
    // 只在 120ms 时夹一次会被它顶开，所以几个时间点都重新夹一遍。
    var t3 = setTimeout(fixHeightChain, 700)
    var t4 = setTimeout(fixHeightChain, 1600)
    var t1 = setTimeout(citeChainDump, 700)
    var t2 = setTimeout(citeChainDump, 2500)
    return function () {
      clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4)
      try {
        var de = document.documentElement
        var bd = document.body
        if (de.getAttribute('data-wk-locked') !== null) {
          de.style.overflowY = de.getAttribute('data-wk-locked') || ''
          de.removeAttribute('data-wk-locked')
        }
        if (bd && bd.getAttribute('data-wk-locked') !== null) {
          bd.style.overflowY = bd.getAttribute('data-wk-locked') || ''
          bd.removeAttribute('data-wk-locked')
        }
      } catch (e) {}
    }
  }, [])
  // 这里必须是 ErrorBoundary，不能是 try/catch：h() 只创建 element，
  // 子组件 render 阶段抛的错它一个也捕不到，React 会直接卸载整棵 root（= 纯白）。
  return h(CiteBoundary, null, h(CiteTabBodyInner, props))
}

function CiteTabBodyInner(props) {
  var p = citeTabParams(props)
  // 这条 tab 会被复用：同一个 kind 再 openTab 时 DSH 不一定重新挂载组件，
  // 所以 chunkId 必须是 state，并订阅「角标被点」事件来换内容 —— 否则用户点了新角标，
  // 组件还端着第一次挂载时那份空参数，一直显示「没有传到 chunk id」。
  var cidSt = React.useState(p.chunkId || '')
  var chunkId = cidSt[0], setChunkId = cidSt[1]
  var docSt = React.useState(p.doc || '')
  var doc = docSt[0], setDoc = docSt[1]
  React.useEffect(function () {
    function onOpen(ev) {
      var d = ev && ev.detail
      if (d && d.chunkId) { setChunkId(String(d.chunkId)); setDoc(String(d.doc || '')) }
    }
    window.addEventListener('dsh-weknora:open-cite', onOpen)
    return function () { window.removeEventListener('dsh-weknora:open-cite', onOpen) }
  }, [])
  var st = React.useState({ loading: true, error: '', doc: doc, items: [], focusId: chunkId })
  var s = st[0], setS = st[1]
  // 这条 tab 可能在 apply 之后才创建的 shadowRoot 里，那时 head 的样式进不来。
  // 挂载即就地补一份，否则容器没有任何高度规则，内容被裁成白屏。
  var hostRef = React.useRef(null)
  React.useEffect(function () {
    try { ensureStylesHere(hostRef.current) } catch (e) { /* 忽略 */ }
    // 高度不靠父级：DSH 那层 wrapper 的高度可能是 auto，也可能是 0，
    // height:100% 在两种情况下分别是「撑满内容」和「塌成 0」。
    // 直接按视口量：底边落在视口内，既不会白屏也不会把文档撑高。
    function fit() {
      var el = hostRef.current
      if (!el) return
      var vh = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0
      if (!vh) return // 量不到视口就别钉死高度，交回 CSS
      var top = el.getBoundingClientRect().top
      var h = Math.max(240, Math.round(vh - top - 8))
      el.style.height = h + 'px'
      el.style.maxHeight = h + 'px'
    }
    fit()
    var t1 = setTimeout(fit, 120)
    var t2 = setTimeout(fit, 600)
    window.addEventListener('resize', fit)
    return function () {
      clearTimeout(t1); clearTimeout(t2)
      window.removeEventListener('resize', fit)
    }
  }, [])
  // 默认走「文本」：分块拼接 + 命中段标黄，纯 DOM 渲染，不依赖 pdfjs/canvas，
  // 因此不可能白屏。要看排版时点「原件」再切 PDF。
  var ob = React.useState(true); var officeOn = ob[0], setOfficeOn = ob[1]
  // 命中段在 PDF 的第几页 —— 拿到后给 iframe 加 #page=N，直接翻过去
  var pg = React.useState(0); var page = pg[0], setPage = pg[1]
  // 命中段的引文（WeKnora locator.quote）：比整段 chunk 更准，优先用它标黄
  var hq = React.useState(''); var hitQuote = hq[0], setHitQuote = hq[1]
  var rd = React.useState(false); var pageReady = rd[0], setPageReady = rd[1]

  React.useEffect(function () {
    var alive = true
    if (!chunkId) { setS({ loading: false, error: '没有传到 chunk id', doc: doc || '', items: [], focusId: '' }); return function () {} }
    setS({ loading: true, error: '', doc: doc || '', items: [], focusId: chunkId })
    api('/chunk?id=' + encodeURIComponent(chunkId)).then(function (r) {
      if (!alive) return null
      if (!r || !r.ok) throw new Error((r && r.message) || '取不到这段原文')
      var kid = r.knowledge_id || ''
      var kbId = r.knowledge_base_id || ''
      return api('/text?id=' + encodeURIComponent(kid) + '&kbId=' + encodeURIComponent(kbId)).then(function (t) {
        if (!alive) return
        var items = (t && (t.items || t.chunks)) || []
        if (!Array.isArray(items)) items = []
        setS({
          loading: false,
          error: '',
          doc: doc || (t && t.title) || '',
          items: items,
          focusId: chunkId,
          knowledgeId: kid,
          kbId: kbId,
        })
      })
    }).catch(function (e) {
      if (alive) setS({ loading: false, error: msg(e), doc: doc || '', items: [], focusId: chunkId })
    })
    return function () { alive = false }
  }, [chunkId])

  React.useEffect(function () {
    if (s.loading) return
    var box = document.querySelector('.dsh-wk-citetab .dsh-wk-hl')
    if (box) {
      try { scrollIntoBox(box, 'center') } catch (e) { /* 忽略 */ }
    }
  }, [s.loading, s.focusId])

  // 原件模式下问一下命中段在第几页（服务端用 pdfjs 逐页抽文本定位）
  React.useEffect(function () {
    if (!officeOn || !s.knowledgeId) { setPageReady(true); return undefined }
    var alive = true
    setPageReady(false)
    api('/pdfpage?id=' + encodeURIComponent(s.knowledgeId) + '&chunk=' + encodeURIComponent(chunkId))
      .then(function (r) { if (alive && r && r.ok) { if (r.page) setPage(r.page); if (r.quote) setHitQuote(String(r.quote)) } })
      .catch(function () { /* 定位失败就从第一页看 */ })
      .then(function () { if (alive) setPageReady(true) })
    return function () { alive = false }
  }, [officeOn, s.knowledgeId, chunkId])

  if (s.loading) return h('div', { className: 'dsh-wk-citetab', ref: hostRef }, h('div', { className: 'dsh-wk-note' }, '正在取原文…'))
  if (s.error) return h('div', { className: 'dsh-wk-citetab', ref: hostRef }, h('div', { className: 'dsh-wk-err' }, s.error))

  var body = s.items.length
    ? s.items.map(function (c, i) {
      var hit = c.id === s.focusId
      return h('div', {
        className: 'dsh-wk-chunk' + (hit ? ' dsh-wk-hl' : ''),
        key: c.id || ('p' + i),
      }, renderMarkdown(fixResourceUrls(c.content || '', s.kbId)))
    })
    : h('div', { className: 'dsh-wk-note' }, '这篇没有分块正文')

  var hitItem = null
  s.items.forEach(function (c) { if (c.id === s.focusId) hitItem = c })
  var hitIdx = hitItem ? s.items.indexOf(hitItem) + 1 : 0
  var kbOfCite = (hitItem && hitItem.knowledge_base_id) || s.kbId || ''

  // 定位没成功时不传 needle：宁可不标黄，也不要停在第一页乱标一屏黄框
  var located = page > 0
  return h('div', { className: 'dsh-wk-citetab', ref: hostRef },
    h('div', { className: 'dsh-wk-citetab-h' },
      h(FileTypeIcon, { type: extOf(s.doc || '') }),
      h('span', { className: 'dsh-wk-citetab-t', title: s.doc }, s.doc || '原文'),
      h('span', { className: 'dsh-wk-spacer' }),
      s.knowledgeId && OFFICE_TYPES[extOf(s.doc || '')]
        ? h('button', {
          className: 'dsh-wk-btn' + (officeOn ? ' dsh-wk-actbtn-on' : ''),
          title: officeOn ? '切到分块文本（可复制）' : '用 LibreOffice 原件排版打开',
          onClick: function () { setOfficeOn(!officeOn) },
        }, officeOn ? '看文本' : '原件')
        : null,
      h('span', { className: 'dsh-wk-badge' }, s.items.length + ' 段'),
      h('button', {
        className: 'dsh-wk-x',
        title: '关闭原文（收起右侧栏）',
        onClick: function () { closeCiteTab() },
      }, '✕'),
    ),
    officeOn && s.knowledgeId
      ? h('div', { className: 'dsh-wk-citetab-b dsh-wk-nos' },
          !pageReady
            ? h('div', { className: 'dsh-wk-note' }, '正在定位原文所在页…')
            : fileView({
              chunkId: chunkId || '',
              id: s.knowledgeId || '',
              kbId: s.kbId || '',
              name: s.doc || s.knowledgeId || '',
              ext: extOf({ file_name: s.doc, title: s.doc }),
              page: located ? page : 1,
              needle: located ? (hitQuote || (hitItem ? String(hitItem.content || '') : '')) : '',
            }))
      : h('div', { className: 'dsh-wk-citetab-b' }, body),
  )
}

// ── 会话里的工具卡片：订阅宿主推来的增量，边生成边显示 ──

// 卡片里的角标点击（没有 ctx 时退回右侧栏 tab 的全局事件）



// 前端异常上报：右侧栏白屏时，宿主侧的 ~/.dsh/dsh-weknora-diag.log 会留下堆栈，
// 不用让用户开开发者工具。
function installErrorReporter() {
  if (!window.__DSH_WK_DIAG__) return
  if (typeof window === 'undefined' || window.__WK_ERR_BOUND__) return
  window.__WK_ERR_BOUND__ = true
  window.addEventListener('error', function (ev) {
    try { logDiag('win-error', { message: String((ev && ev.message) || ''), src: String((ev && ev.filename) || ''), line: (ev && ev.lineno) || 0 }) } catch (e) {}
  })
  window.addEventListener('unhandledrejection', function (ev) {
    try {
      var r = ev && ev.reason
      logDiag('unhandled', { message: String((r && r.message) || r || '') })
    } catch (e) {}
  })
}

function registerCiteTab(ctx) {
  try { installErrorReporter() } catch (e) {}
  try {
    if (!citeTabsOf(ctx) || !ctx.sidebarRight) {
      console.warn('[dsh-weknora] 没有 sidebarRight / sidebarRightTabs，角标只开面板')
      return false
    }
    ensureCiteTabType(ctx)

    // 注册后立刻把注册表内部可见状态写进诊断日志：placeTab 报「no tab type」时，
    // 这里能直接看出注册到底进没进 registry（kinds / cached / ids）。
    try {
      var reg = citeTabsOf(ctx)
      var info = { keys: [], kinds: [], ids: [], cached: [] }
      try { info.keys = Object.keys(reg) } catch (e0) {}
      try { if (reg.kinds && reg.kinds.keys) info.kinds = Array.from(reg.kinds.keys()) } catch (e1) {}
      try { if (reg.ids && reg.ids.forEach) reg.ids.forEach(function (v) { info.ids.push(v) }) } catch (e2) {}
      try { info.cached = (reg.cached || []).map(function (d) { return d && d.kind }) } catch (e3) {}
      logDiag('cite-tab-registry', info)
    } catch (e4) {}

    // DSH 的 TabSlot 用 `entryKey = definition?.id ?? tab.kind` 找内容，正常命中
    // definition.id。这里按 id 注册一份即可；每个注册各自 try —— 任何一个 slot
    // 注册失败都不能让整个注册函数抛错，否则 apply 半途中断，连装饰器都不会跑
    // （表现就是「角标点不开」）。
    function regBody(k) {
      try {
        ctx.effect(function () {
          return ctx.slots.inject('sidebar.right.pane.tab', function () {
            var d = ctx.slots.register({ name: 'sidebar.right.pane.tab', key: k }, CiteTabBody)
            try { logDiag('cite-slot-body', { k: k, ok: typeof d === 'function' }) } catch (e5) {}
            return d
          })
        }, 'dsh-weknora: cite tab body ' + k)
      } catch (e) { console.warn('[dsh-weknora] body slot 注册失败 ' + k + ': ' + (e && e.message)) }
    }
    function regTitle(k) {
      try {
        ctx.effect(function () {
          return ctx.slots.inject('sidebar.right.pane.tab.title', function () {
            var d = ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: k }, CiteTabTitle)
            try { logDiag('cite-slot-title', { k: k, ok: typeof d === 'function' }) } catch (e6) {}
            return d
          })
        }, 'dsh-weknora: cite tab title ' + k)
      } catch (e) { console.warn('[dsh-weknora] title slot 注册失败 ' + k + ': ' + (e && e.message)) }
    }
    regBody(CITE_TAB_ID)
    regBody(CITE_TAB_KIND)
    regTitle(CITE_TAB_ID)
    regTitle(CITE_TAB_KIND)
  } catch (e) {
    console.warn('[dsh-weknora] 右侧栏原文 tab 注册失败，角标退回面板:', e && e.message)
    try { logDiag('register-cite-tab-fail', { msg: e && e.message }) } catch (e2) {}
    return false
  }
  console.log('[dsh-weknora] 右侧栏原文 tab 已注册 kind=' + CITE_TAB_KIND + '（id/kind 双 key）')
  return true
}
