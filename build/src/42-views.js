// ── Word / Excel 各自的解析器 ───────────────────────────────────────────────
// 用户明确要求：word 用 word 的渲染器、pdf 用 pdf 的、excel 用 excel 的。
// 所以三种原件各走各的：
//   .docx  → docx-preview（保留分页/字体/表格，浏览器端渲染）
//   .pdf   → ReaderFrame（pdf.js 官方 viewer，见 45-pdf.js）
//   .xlsx  → SheetView（xlsx 解析成真表格，不是把表格 PDF 化）
// 三者都只多做一件事：把命中处标黄，而且只标一处、不留其他色块。

// docx-preview 运行时体积 171 KB，只有真的要看 Word 时才加载。
var DOCX_RUNTIME = null
function loadDocxRuntime() {
  if (window.DocxPreview) return Promise.resolve(window.DocxPreview)
  if (DOCX_RUNTIME) return DOCX_RUNTIME
  DOCX_RUNTIME = new Promise(function (resolve, reject) {
    var s = document.createElement('script')
    s.src = API + '/docxjs'
    s.onload = function () {
      if (window.DocxPreview) resolve(window.DocxPreview)
      else reject(new Error('docx 运行时没有暴露 DocxPreview'))
    }
    s.onerror = function () {
      DOCX_RUNTIME = null
      reject(new Error('docx 运行时加载失败'))
    }
    document.head.appendChild(s)
  })
  return DOCX_RUNTIME
}

// 高亮只做一处，而且先清旧的：
// 之前用 surroundContents 逐节点包，effect 重跑就叠一层，页面上出现好几块黄，
// 加上 docx 自带底纹，看起来就是「一堆杂色块」。
function clearQuoteMarks(root) {
  if (!root) return
  var old = root.querySelectorAll('mark.dsh-wk-hl')
  for (var k = 0; k < old.length; k++) {
    var mk = old[k]
    var pa = mk.parentNode
    if (pa) {
      pa.replaceChild(document.createTextNode(mk.textContent || ''), mk)
      pa.normalize()
    }
  }
}

function highlightQuote(root, quote) {
  if (!root) return 0
  clearQuoteMarks(root)
  var needle = String(quote || '').replace(/\s+/g, ' ').trim()
  if (needle.length < 4) return 0
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  var node
  while ((node = walker.nextNode())) {
    var t = node.nodeValue || ''
    if (t.length < 4 || !t.trim()) continue
    var at = t.indexOf(needle)
    var len = needle.length
    if (at < 0) {
      // 引文常被段落/换行切开，退一步用前 16 字找同一处
      var short = needle.slice(0, 16)
      if (short.length < 4) continue
      at = t.indexOf(short)
      len = short.length
    }
    if (at < 0) continue
    var mid = node.splitText(at)
    mid.splitText(len)
    var mk = document.createElement('mark')
    mk.className = 'dsh-wk-hl'
    mk.setAttribute('data-wk-hl', '1')
    mid.parentNode.replaceChild(mk, mid)
    mk.appendChild(mid)
    return 1
  }
  return 0
}

// Word：docx-preview 直接渲染成保留排版的 HTML。
function DocxView(props) {
  var boxRef = React.useRef(null)
  var stS = React.useState({ loading: true, err: '', marks: 0 })
  var s = stS[0], setS = stS[1]
  React.useEffect(function () {
    var alive = true
    setS({ loading: true, err: '', marks: 0 })
    ;(async function () {
      var lib = await loadDocxRuntime()
      var resp = await fetch(API + '/content?id=' + encodeURIComponent(props.id || ''))
      if (!resp.ok) throw new Error('取原件失败 HTTP ' + resp.status)
      var buf = await resp.arrayBuffer()
      var box = boxRef.current
      if (!alive || !box) return
      box.innerHTML = ''
      await lib.renderAsync(buf, box, null, { inWrapper: false, breakPages: true })
      if (!alive) return
      setS({ loading: false, err: '', marks: highlightQuote(box, props.needle) })
    })().catch(function (e) {
      if (alive) setS({ loading: false, err: String((e && e.message) || e), marks: 0 })
    })
    return function () { alive = false }
  }, [props.id, props.needle])

  return h('div', { className: 'dsh-wk-docx' },
    s.loading ? h('div', { className: 'dsh-wk-note' }, '正在渲染 Word 原件…') : null,
    s.err ? h('div', { className: 'dsh-wk-err' }, 'Word 渲染失败：' + s.err) : null,
    h('div', { className: 'dsh-wk-docxbox', ref: boxRef }))
}

function SheetView(props) {
  var st = React.useState({ loading: true })
  var s = st[0], setS = st[1]
  React.useEffect(function () {
    var alive = true
    api('/sheet?id=' + encodeURIComponent(props.id || ''))
      .then(function (r) {
        if (!alive) return
        if (r && r.ok) setS({ loading: false, sheets: r.sheets || [] })
        else setS({ loading: false, error: (r && r.message) || '读不到表格' })
      })
      .catch(function (e) { if (alive) setS({ loading: false, error: String((e && e.message) || e) }) })
    return function () { alive = false }
  }, [props.id])
  if (s.loading) return h('div', { className: 'dsh-wk-note' }, '正在读表格…')
  if (s.error) return h('div', { className: 'dsh-wk-err' }, s.error)
  if (!s.sheets || !s.sheets.length) return h('div', { className: 'dsh-wk-note' }, '这个表格里没有可显示的内容')
  return h('div', { className: 'dsh-wk-sheetwrap' },
    s.sheets.map(function (sh, si) {
      return h('div', { key: si, className: 'dsh-wk-sheetone' },
        h('div', { className: 'dsh-wk-sheetname' }, String(sh.name || ('Sheet' + (si + 1))) + ' · ' + (sh.totalRows || sh.rows.length) + ' 行'),
        h('div', { className: 'dsh-wk-sheetbox' },
          h('table', { className: 'dsh-wk-sheettable' },
            h('tbody', null, (sh.rows || []).map(function (r, ri) {
              return h('tr', { key: ri }, (r || []).map(function (cell, ci) {
                return h('td', { key: ci, className: ri === 0 ? 'dsh-wk-sheethead' : '' }, cell)
              }))
            })))))
    }))
}

// 一个入口决定用哪个解析器。三处预览（面板 / 右侧栏 / 后面的新入口）都调它，
// 免得每个地方各写一套 if，改一次要改三处。
var SHEET_RE = /^(xls|xlsx|xlsm|ods|csv)$/
var WORD_RE = /^(doc|docx|docm|odt|rtf)$/
function fileView(props) {
  var p = props || {}
  var ext = String(p.ext || '').toLowerCase()
  var box = 'dsh-wk-nos'
  if (SHEET_RE.test(ext)) {
    return h('div', { className: box }, h(SheetView, { id: p.id }))
  }
  if (WORD_RE.test(ext)) {
    return h('div', { className: box }, h(DocxView, { id: p.id, needle: p.needle || '' }))
  }
  return h('div', { className: box }, h(ReaderFrame, {
    id: p.id || '',
    kbId: p.kbId || '',
    name: p.name || p.id || '',
    page: p.page || 1,
    needle: p.needle || '',
  }))
}
