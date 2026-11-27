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
  // 渲染完成计数：定位 effect 依赖它，渲染一完成就立刻定位一次。
  var readyS = React.useState(0)
  var ready = readyS[0], setReady = readyS[1]

  // 渲染只看文件 id：同一篇文档换角标位置时绝不能重新下载、重新排版，
  // 否则每次点角标都像重新打开文件（用户的原话）。
  React.useEffect(function () {
    var alive = true
    setS({ loading: true, err: '', marks: 0 })
    ;(async function () {
      var lib = await loadDocxRuntime()
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
      setS({ loading: false, err: '', marks: 0 })
      setReady(function (v) { return v + 1 })
    })().catch(function (e) {
      if (alive) setS({ loading: false, err: String((e && e.message) || e), marks: 0 })
    })
    return function () {
      alive = false
      if (undoRef.current) { try { undoRef.current() } catch (e) {} undoRef.current = null }
    }
  }, [props.id])

  // 定位只看 chunkId / needle，复用已经排版好的 DOM。
  React.useEffect(function () {
    if (!ready) return undefined
    var alive = true
    var el = scaleRef.current
    if (!el) return undefined
    ;(async function () {
      var loc = await loadLocators(props.chunkId)
      if (!alive) return
      var n = locateDocx(el, loc, props.needle, undoRef)
      setS(function (prev) { return Object.assign({}, prev, { marks: n }) })
      // renderAsync 刚返回时字体/图片/zoom 都还没落定，rect 可能是 0 或者算在
      // 旧布局上；zoom 又是 el.style.zoom（会整体改变文档高度），一次滚动很容易
      // 被后续布局变化作废。所以分几个时间点重试，并且只在命中处不在可视区时滚。
      if (n) {
        ;[450, 1200, 2500].forEach(function (delay) {
          setTimeout(function () {
            if (!alive) return
            try {
              var first = undoRef.lastRange
              if (!first) return
              var r = first.getBoundingClientRect()
              if (!r || (!r.width && !r.height)) return
              var sc = srcScrollParent(first.startContainer && first.startContainer.parentElement, el) || el
              var sb = sc.getBoundingClientRect()
              // 已经在可视区里就别再滚，免得把用户手动滚动的位置抢回去
              if (r.top >= sb.top && r.bottom <= sb.bottom) return
              srcReveal(el, first)
            } catch (e) { /* 忽略 */ }
          }, delay)
        })
      }
    })().catch(function () { /* 定位失败不影响查看 */ })
    return function () { alive = false }
  }, [props.chunkId, props.needle, ready])

  function effectiveZoom() {
    if (zoom > 0) return zoom
    // 默认按原尺寸显示（以前就是这样），窄侧栏要整页看全时点「适合宽度」。
    return 1
  }
  function fitWidthZoom() {
    var box = boxRef.current
    if (!box || !natW) return 1
    return Math.max(0.2, Math.min(1, (box.clientWidth - 8) / natW))
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
      h('button', { className: 'dsh-wk-zbtn dsh-wk-zbtn-w', onClick: function () { setZoom(fitWidthZoom()) }, title: '适合宽度' },
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
  try {
    logDiag('locate-docx', {
      locs: list.length,
      docxLocs: list.filter(function (x) { return x && x.type === 'docx' }).length,
      blocks: blocks.length,
      ranges: ranges.length,
      hlApi: !!srcHighlightRegistry(),
      samples: list.slice(0, 3).map(function (x) {
        return { t: x && x.type, m: x && x.mapping, b: x && x.block, q: String((x && x.quote) || '').slice(0, 24) }
      }),
      firstText: ranges.length ? String(ranges[0].toString()).slice(0, 40) : '',
    }, true)
  } catch (e) { /* 忽略 */ }
  if (!ranges.length) return 0
  if (undoRef) undoRef.lastRange = ranges[0]   // 供定位 effect 延迟再滚一次
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
  var zs = React.useState(0)            // 0 = 适合宽度
  var zoom = zs[0], setZoom = zs[1]
  var zw = React.useState(0)            // 表格原始宽度，用来算适合宽度
  var natW = zw[0], setNatW = zw[1]

  // 表格数据只看文件 id：同一张表换角标位置不重新取、不重建表格。
  React.useEffect(function () {
    var alive = true
    setS({ loading: true })
    api('/sheet?id=' + encodeURIComponent(props.id || '')).then(function (r) {
      if (!alive) return
      if (!r || !r.ok) { setS({ loading: false, error: (r && r.message) || '读不到表格' }); return }
      setS({ loading: false, sheets: r.sheets || [], sheetNames: r.sheetNames || [] })
    }).catch(function (e) {
      if (alive) setS({ loading: false, error: String((e && e.message) || e) })
    })
    return function () {
      alive = false
      if (undoRef.current) { try { undoRef.current() } catch (e) {} undoRef.current = null }
    }
  }, [props.id])

  // 定位只看 chunkId：表格已经在 DOM 里就只换高亮。
  React.useEffect(function () {
    var box = boxRef.current
    if (!box || !s.sheets) return undefined
    var alive = true
    ;(async function () {
      var loc = await loadLocators(props.chunkId)
      if (!alive) return
      var b = boxRef.current
      if (!b) return
      var n = locateExcel(b, loc, s.sheetNames || [], undoRef)
      setS(function (prev) { return Object.assign({}, prev, { marks: n }) })
    })().catch(function () { /* 忽略 */ })
    return function () { alive = false }
  }, [s.sheets, props.chunkId])

  // 表格进 DOM 后量一次原始宽度（表格是 nowrap 的，宽度不随容器变）。
  React.useEffect(function () {
    if (!s.sheets || !s.sheets.length) return
    var box = boxRef.current
    if (!box) return
    var t = box.querySelector('.dsh-wk-sheetbox table')
    if (t && t.scrollWidth) setNatW(t.scrollWidth)
  }, [s.sheets])

  function effectiveZoom() {
    if (zoom > 0) return zoom
    // 默认 100%：13 列的表格缩到「适合宽度」只有 35%，字看不清。
    return 1
  }
  function fitSheetZoom() {
    var box = boxRef.current
    if (!box || !natW) return 1
    return Math.max(0.25, Math.min(1, (box.clientWidth - 10) / natW))
  }
  var z = effectiveZoom()

  // zoom 走 CSS zoom：它参与布局，滚动范围会跟着变，不用手算容器高度。
  React.useEffect(function () {
    var box = boxRef.current
    if (!box) return
    var boxes = box.querySelectorAll('.dsh-wk-sheetbox')
    for (var i = 0; i < boxes.length; i++) {
      try { boxes[i].style.zoom = String(z) } catch (e) { /* 忽略 */ }
    }
  }, [z, s.sheets])

  if (s.loading) return h('div', { className: 'dsh-wk-note' }, '正在读表格…')
  if (s.error) return h('div', { className: 'dsh-wk-err' }, s.error)
  if (!s.sheets || !s.sheets.length) return h('div', { className: 'dsh-wk-note' }, '这个表格里没有可显示的内容')
  return h('div', { className: 'dsh-wk-sheetwrap', ref: boxRef },
    h('div', { className: 'dsh-wk-pdfbar' },
      h('button', { className: 'dsh-wk-zbtn', title: '缩小', onClick: function () { setZoom(Math.max(0.25, z - 0.15)) } }, '−'),
      h('button', {
        className: 'dsh-wk-zbtn dsh-wk-zbtn-w',
        title: '适合宽度',
        onClick: function () { setZoom(fitSheetZoom()) },
      }, Math.round(z * 100) + '%'),
      h('button', { className: 'dsh-wk-zbtn', title: '放大', onClick: function () { setZoom(Math.min(3, z + 0.15)) } }, '＋')),
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
  try {
    var probeRows = []
    for (var pi = 0; pi < list.length && probeRows.length < 4; pi++) {
      var pl = list[pi]
      if (!pl || pl.type !== 'sheet') continue
      probeRows.push({ sheet: pl.sheet, rs: pl.row_start, re: pl.row_end, m: pl.mapping, partial: !!pl.partial })
    }
    logDiag('locate-excel', {
      locs: list.length,
      sheetNames: (sheetNames || []).slice(0, 4),
      targets: targets.length,
      rows: sheetRows(box.querySelector('#sheet-0') || box).size,
      probe: probeRows,
      firstRowText: targets.length ? String(targets[0].textContent || '').replace(/\s+/g, ' ').slice(0, 60) : '',
    }, true)
  } catch (e) { /* 忽略 */ }
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
