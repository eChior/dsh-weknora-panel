// ── Word / Excel / PDF 各用自己的解析器，定位与高亮全部照 WeKnora ─────────────
// 对照源码：WeKnora-src/frontend/src/components/document-preview.vue
//   renderDocx  (:270)  docx-preview 的 options
//   renderExcel (:301)  XLSX.utils.sheet_to_html
//   locateDocx  (:689)  section > article 的 P/TABLE 列表 + locator.block（1 起）
//   locateExcel (:786)  单元格 id 反推行号 → 整行标记
// 高亮与滚动走 43-locate.js（sourceLocator.ts / sourceLocatorDom.ts 的移植）。
// 命中位置来自 WeKnora 入库时写好的 source_locators，前端不自己猜。

// docx-preview 运行时 171 KB，只有真的要看 Word 时才加载。
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

// 取这个分块的 locators（WeKnora 算好的命中坐标）。
function loadLocators(chunkId) {
  if (!chunkId) return Promise.resolve({ locators: [], content: '' })
  return api('/locators?chunk=' + encodeURIComponent(chunkId))
    .then(function (r) { return (r && r.ok) ? r : { locators: [], content: '' } })
    .catch(function () { return { locators: [], content: '' } })
}

// Word：docx-preview 原生渲染，版式/字体/字号一律不改；
// 窄侧栏靠整体缩放适配，和 PDF 的「适合页宽」同一个思路。
function DocxView(props) {
  var boxRef = React.useRef(null)
  var scaleRef = React.useRef(null)
  var stS = React.useState({ loading: true, err: '', marks: 0 })
  var s = stS[0], setS = stS[1]
  var zs = React.useState(0)            // 0 = 适合宽度
  var zoom = zs[0], setZoom = zs[1]
  var natS = React.useState(0)
  var natW = natS[0], setNatW = natS[1]
  var undoRef = React.useRef(null)

  React.useEffect(function () {
    var alive = true
    setS({ loading: true, err: '', marks: 0 })
    ;(async function () {
      var lib = await loadDocxRuntime()
      var loc = await loadLocators(props.chunkId)
      var resp = await fetch(API + '/content?id=' + encodeURIComponent(props.id || ''))
      if (!resp.ok) throw new Error('取原件失败 HTTP ' + resp.status)
      var buf = await resp.arrayBuffer()
      var el = scaleRef.current
      if (!alive || !el) return
      el.innerHTML = ''
      // options 照 WeKnora renderDocx；className 用 'docx' 以匹配本插件的样式表。
      await lib.renderAsync(buf, el, null, {
        className: 'docx',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        ignoreLastRenderedPageBreak: true,
        experimental: false,
        trimXmlDeclaration: true,
        useBase64URL: true,
      })
      if (!alive) return
      var sec = el.querySelector('section.docx, .docx')
      if (sec && sec.offsetWidth) setNatW(sec.offsetWidth)
      var n = locateDocx(el, loc, props.needle, undoRef)
      setS({ loading: false, err: '', marks: n })
    })().catch(function (e) {
      if (alive) setS({ loading: false, err: String((e && e.message) || e), marks: 0 })
    })
    return function () {
      alive = false
      if (undoRef.current) { try { undoRef.current() } catch (e) {} undoRef.current = null }
    }
  }, [props.id, props.chunkId, props.needle])

  function effectiveZoom() {
    if (zoom > 0) return zoom
    var box = boxRef.current
    if (!box || !natW) return 1
    return Math.max(0.2, Math.min(3, (box.clientWidth - 8) / natW))
  }
  var z = effectiveZoom()
  React.useEffect(function () {
    var el = scaleRef.current
    if (el) el.style.zoom = String(z)
  }, [z, s.loading, natW])

  function step(d) {
    var cur = effectiveZoom()
    setZoom(Math.max(0.2, Math.min(3, Math.round((cur + d) * 100) / 100)))
  }

  return h('div', { className: 'dsh-wk-docx' },
    h('div', { className: 'dsh-wk-pdfbar' },
      h('button', { className: 'dsh-wk-zbtn', onClick: function () { step(-0.1) }, title: '缩小' }, '−'),
      h('button', { className: 'dsh-wk-zbtn dsh-wk-zbtn-w', onClick: function () { setZoom(0) }, title: '适合宽度' },
        Math.round(z * 100) + '%'),
      h('button', { className: 'dsh-wk-zbtn', onClick: function () { step(0.1) }, title: '放大' }, '＋')),
    s.loading ? h('div', { className: 'dsh-wk-note' }, '正在渲染 Word 原件…') : null,
    s.err ? h('div', { className: 'dsh-wk-err' }, 'Word 渲染失败：' + s.err) : null,
    h('div', { className: 'dsh-wk-docxbox', ref: boxRef },
      h('div', { ref: scaleRef })))
}

// 照 WeKnora locateDocx：block 是 1 起的段落序号，
// 先在指定段落里找 quote，找不到再全局找（分页可能把段落切开）。
function docxBlocks(root) {
  var out = []
  var arts = root.querySelectorAll('section > article')
  for (var i = 0; i < arts.length; i++) {
    var kids = arts[i].children
    for (var j = 0; j < kids.length; j++) {
      var tag = kids[j].tagName
      if (tag === 'P' || tag === 'TABLE') out.push(kids[j])
    }
  }
  return out
}

function locateDocx(root, loc, needle, undoRef) {
  var list = (loc && loc.locators) || []
  var blocks = docxBlocks(root)
  var ranges = []
  for (var i = 0; i < list.length; i++) {
    var l = list[i]
    if (l.type !== 'docx' || l.mapping !== 'exact' || !l.block) continue
    var el = blocks[l.block - 1]
    var quote = String(l.quote || '')
    if (!quote) continue
    var r = (el ? srcFindTextRange(el, quote) : null) || srcFindTextRange(root, quote)
    if (r) ranges.push(r)
  }
  // 没有可用 locator 时退回按引文/分块正文整篇找（唯一命中才标）。
  if (!ranges.length) {
    var text = String(needle || (loc && loc.content) || '')
    var one = text ? srcFindTextRange(root, text) : null
    if (one) ranges.push(one)
  }
  if (!ranges.length) return 0
  if (undoRef.current) { try { undoRef.current() } catch (e) {} }
  undoRef.current = srcHighlightRanges(ranges)
  srcReveal(root, ranges[0])
  return ranges.length
}

// Excel：照 WeKnora renderExcel —— sheet_to_html 的表格直接用，
// 合并单元格与单元格 id 都保留，定位才能按行号落到 <tr>。
function SheetView(props) {
  var boxRef = React.useRef(null)
  var st = React.useState({ loading: true })
  var s = st[0], setS = st[1]
  var undoRef = React.useRef(null)

  React.useEffect(function () {
    var alive = true
    setS({ loading: true })
    Promise.all([
      api('/sheet?id=' + encodeURIComponent(props.id || '')),
      loadLocators(props.chunkId),
    ]).then(function (rs) {
      if (!alive) return
      var r = rs[0], loc = rs[1]
      if (!r || !r.ok) { setS({ loading: false, error: (r && r.message) || '读不到表格' }); return }
      setS({ loading: false, sheets: r.sheets || [], sheetNames: r.sheetNames || [], loc: loc })
    }).catch(function (e) {
      if (alive) setS({ loading: false, error: String((e && e.message) || e) })
    })
    return function () {
      alive = false
      if (undoRef.current) { try { undoRef.current() } catch (e) {} undoRef.current = null }
    }
  }, [props.id, props.chunkId])

  // 表格 HTML 由 SheetJS 生成（单元格文本已转义）。这里再过一遍：
  // 只留表格结构，去掉脚本/样式/事件属性，等价 WeKnora 的 sanitizeHTML。
  React.useEffect(function () {
    var box = boxRef.current
    if (!box || !s.sheets) return
    var loc = s.loc || { locators: [] }
    var n = locateExcel(box, loc, s.sheetNames || [], undoRef)
    setS(function (prev) { return Object.assign({}, prev, { marks: n }) })
  }, [s.sheets])

  if (s.loading) return h('div', { className: 'dsh-wk-note' }, '正在读表格…')
  if (s.error) return h('div', { className: 'dsh-wk-err' }, s.error)
  if (!s.sheets || !s.sheets.length) return h('div', { className: 'dsh-wk-note' }, '这个表格里没有可显示的内容')
  return h('div', { className: 'dsh-wk-sheetwrap', ref: boxRef },
    s.sheets.map(function (sh, si) {
      return h('div', { key: si, className: 'dsh-wk-sheetone' },
        s.sheets.length > 1 ? h('div', { className: 'dsh-wk-sheetname' }, String(sh.name || ('Sheet' + (si + 1)))) : null,
        h('div', {
          className: 'dsh-wk-sheetbox',
          dangerouslySetInnerHTML: { __html: sanitizeSheetHtml(sh.html || '') },
        }))
    }))
}

function sanitizeSheetHtml(html) {
  try {
    var doc = new DOMParser().parseFromString(html, 'text/html')
    // sheet_to_html 给的是整份 HTML 文档，只要里面的表格；
    // 否则 <title>SheetJS</title> 之类的节点会被塞进面板。
    var tables = doc.querySelectorAll('table')
    if (!tables.length) return ''
    var root = doc.createElement('div')
    for (var t = 0; t < tables.length; t++) root.appendChild(tables[t].cloneNode(true))
    var bad = root.querySelectorAll('script,style,iframe,object,embed,link,meta')
    for (var i = 0; i < bad.length; i++) bad[i].parentNode.removeChild(bad[i])
    var all = root.querySelectorAll('*')
    for (var j = 0; j < all.length; j++) {
      var attrs = all[j].attributes
      for (var k = attrs.length - 1; k >= 0; k--) {
        var nm = attrs[k].name
        if (/^on/i.test(nm) || nm === 'srcdoc') all[j].removeAttribute(nm)
      }
    }
    return root.innerHTML
  } catch (e) { return '' }
}

// 照 WeKnora locateExcel + sheetRows：单元格 id 形如 sheet-0-B12，
// 末尾数字就是 Excel 行号；命中行整行标记（不是逐字高亮）。
function sheetRows(table) {
  var rows = new Map()
  var cells = table.querySelectorAll('td[id]')
  for (var i = 0; i < cells.length; i++) {
    var m = /-[A-Z]+(\d+)$/.exec(cells[i].id)
    if (!m) continue
    var tr = cells[i].closest('tr')
    var num = Number(m[1])
    if (tr && !rows.has(num)) rows.set(num, tr)
  }
  return rows
}

function locateExcel(box, loc, sheetNames, undoRef) {
  var list = (loc && loc.locators) || []
  var targets = []
  for (var i = 0; i < list.length; i++) {
    var l = list[i]
    if (l.type !== 'sheet' || l.mapping !== 'exact' || l.partial || !l.row_start) continue
    var idx = l.sheet ? sheetNames.indexOf(l.sheet) : -1
    if (idx < 0) continue
    var table = box.querySelector('#sheet-' + idx)
    if (!table) continue
    var rows = sheetRows(table)
    var last = Math.min(l.row_end || l.row_start || 0, (l.row_start || 0) + 200)
    for (var r = l.row_start; r <= last; r++) {
      var tr = rows.get(r)
      if (tr) targets.push(tr)
    }
  }
  if (!targets.length) return 0
  if (undoRef.current) { try { undoRef.current() } catch (e) {} }
  undoRef.current = srcHighlightElements(targets)
  srcReveal(box, targets[0])
  return targets.length
}

// 一个入口决定用哪个解析器，三处预览都调它。
var SHEET_RE = /^(xls|xlsx|xlsm|ods|csv)$/
var WORD_RE = /^(doc|docx|docm|odt|rtf)$/
function fileView(props) {
  var p = props || {}
  var ext = String(p.ext || '').toLowerCase()
  var box = 'dsh-wk-nos'
  if (SHEET_RE.test(ext)) {
    return h('div', { className: box }, h(SheetView, { id: p.id, chunkId: p.chunkId || '' }))
  }
  if (WORD_RE.test(ext)) {
    return h('div', { className: box }, h(DocxView, { id: p.id, chunkId: p.chunkId || '', needle: p.needle || '' }))
  }
  return h('div', { className: box }, h(ReaderFrame, {
    id: p.id || '',
    kbId: p.kbId || '',
    name: p.name || p.id || '',
    page: p.page || 1,
    needle: p.needle || '',
  }))
}
