// pdf.js 加载、文本索引、PdfView
// 由 build/src 拼接后注入 factory，和同目录其它片段共享作用域（不要加 import/export）。
function loadPdfjs() {
  if (__pdfjs) return __pdfjs
  var load = new Function('u', 'return import(u)')
  __pdfjs = load(API + '/pdfjs/pdf.mjs').then(function (mod) {
    try { mod.GlobalWorkerOptions.workerSrc = API + '/pdfjs/pdf.worker.mjs' } catch (e) { /* 忽略 */ }
    return mod
  })
  return __pdfjs
}

// ── 文本层定位 ─────────────────────────────────────────
// 移植自 WeKnora 前端 PdfSourceViewer.vue + sourceLocatorDom.ts：
// 黄块不是用 page.transform 手算出来的，而是把 pdfjs 的 TextLayer 渲染成真实
// DOM，再用 Range.getClientRects() 取浏览器排好版的矩形 —— 这样才和文字严丝合缝。
function normForMatch(text) {
  return String(text || '').normalize('NFC').replace(/\s+/g, '').toLowerCase()
}

function buildTextIndex(root) {
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  var nodes = []
  var text = ''
  var flat = ''
  var fmap = []
  var n = walker.nextNode()
  while (n) {
    var v = n.nodeValue || ''
    if (v) {
      var base = text.length
      nodes.push({ node: n, start: base })
      text += v
      for (var i = 0; i < v.length; i++) {
        var ch = v.charAt(i)
        if (/\s/.test(ch)) continue
        fmap.push(base + i)
        flat += ch.toLowerCase()
      }
    }
    n = walker.nextNode()
  }
  return { text: text, flat: flat, fmap: fmap, nodes: nodes }
}

function rangeAtOffset(idx, from, to) {
  if (!idx.nodes.length || from < 0 || to <= from) return null
  var a = idx.fmap[from]
  var b = idx.fmap[to - 1]
  if (a === undefined || b === undefined) return null
  function pointAt(off) {
    var lo = 0
    var hi = idx.nodes.length - 1
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1
      if (idx.nodes[mid].start <= off) lo = mid
      else hi = mid - 1
    }
    var e = idx.nodes[lo]
    var len = (e.node.nodeValue || "").length
    return { node: e.node, offset: Math.max(0, Math.min(len, off - e.start)) }
  }
  var from2 = pointAt(a)
  var to2 = pointAt(b + 1)
  if (!from2 || !to2) return null
  try {
    var r = document.createRange()
    r.setStart(from2.node, from2.offset)
    r.setEnd(to2.node, to2.offset)
    return r
  } catch (e) { return null }
}

// 同一行上的多个字形矩形合并成一条，避免黄块被切成碎片
function mergeRects(rects) {
  var out = []
  rects.forEach(function (r) {
    if (!r || r.width < 0.5 || r.height < 0.5) return
    var line = null
    for (var i = 0; i < out.length; i++) {
      var l = out[i]
      var ov = Math.min(l.top + l.height, r.top + r.height) - Math.max(l.top, r.top)
      var gap = Math.max(r.left - l.left - l.width, l.left - r.left - r.width)
      if (ov > Math.min(l.height, r.height) * 0.5 && gap <= Math.min(l.height, r.height) * 2) { line = l; break }
    }
    if (line) {
      var right = Math.max(line.left + line.width, r.left + r.width)
      var bottom = Math.max(line.top + line.height, r.top + r.height)
      line.left = Math.min(line.left, r.left)
      line.top = Math.min(line.top, r.top)
      line.width = right - line.left
      line.height = bottom - line.top
    } else {
      out.push({ left: r.left, top: r.top, width: r.width, height: r.height })
    }
  })
  return out
}

// 打开过的 PDF 文档留在内存里复用：反复点不同角标看同一份文档时，
// 不用每次都重新下载 + 解析（大文档这一步就是"打开原件极慢"的主因）。
// 只留最近 3 份，超出的销毁，别把内存吃光。
var PDF_DOCS = []
var PDF_DOC_LIMIT = 3

function loadPdfDoc(id) {
  for (var i = 0; i < PDF_DOCS.length; i++) {
    if (PDF_DOCS[i].id === id) {
      var hit = PDF_DOCS.splice(i, 1)[0]
      PDF_DOCS.push(hit)
      return hit.promise
    }
  }
  var promise = loadPdfjs().then(function (pdfjs) {
    if (!pdfjs) throw new Error('pdfjs 没加载上')
    return pdfjs.getDocument({ url: API + '/pdf?id=' + encodeURIComponent(id) }).promise
  })
  var entry = { id: id, promise: promise }
  PDF_DOCS.push(entry)
  while (PDF_DOCS.length > PDF_DOC_LIMIT) {
    var old = PDF_DOCS.shift()
    try {
      Promise.resolve(old.promise).then(function (d) { try { d.destroy() } catch (e) { /* 忽略 */ } },
        function () { /* 加载失败过，无需销毁 */ })
    } catch (e) { /* 忽略 */ }
  }
  return promise
}

function PdfView(props) {
  var id = props.id
  var wantPage = props.page || 0
  var needle = String(props.needle || '').replace(/\s+/g, '')
  var holder = React.useRef(null)
  var docRef = React.useRef(null)
  var wrapsRef = React.useRef([])
  var obsRef = React.useRef(null)
  var targetRef = React.useRef(wantPage || 1)
  targetRef.current = wantPage || targetRef.current
  var vs = React.useState({ loading: true, error: '', num: 0, cur: 1, ready: false })
  var s = vs[0], setS = vs[1]
  // 0 = 适应宽度；>0 表示按容器宽度的倍数缩放
  var zs = React.useState(0)
  var zoom = zs[0], setZoom = zs[1]

  // 1) 打开文档
  React.useEffect(function () {
    var alive = true
    setS({ loading: true, error: '', num: 0, cur: 1, ready: false })
    loadPdfDoc(id).then(function (doc) {
      if (!alive) return
      docRef.current = doc
      setS({ loading: false, error: '', num: doc.numPages, cur: 1, ready: true })
    }).catch(function (e) {
      if (alive) setS({ loading: false, error: msg(e), num: 0, cur: 1, ready: false })
    })
    return function () {
      // 文档本体交给上面的 PDF_DOCS 缓存管理，这里只断开引用
      alive = false
      docRef.current = null
    }
  }, [id])

  // 2) 铺满所有页的占位块 → 滚到哪画到哪（滚轮翻页，不用上一页/下一页）
  React.useEffect(function () {
    var doc = docRef.current
    var box = holder.current
    if (!doc || !s.ready || !box) return undefined
    var alive = true
    var wraps = []
    var ratio = 1.414

    box.innerHTML = ''
    doc.getPage(1).then(function (p1) {
      if (!alive) return
      var base = p1.getViewport({ scale: 1 })
      if (base.width > 0) ratio = base.height / base.width
      build()
    }).catch(function () { if (alive) build() })

    function build() {
      if (!alive || !box) return
      var baseW = Math.max(300, (box.clientWidth || 560) - 16)
      var width = zoom > 0 ? Math.round(baseW * zoom) : baseW
      var h = Math.round(width * ratio)
      for (var i = 0; i < s.num; i++) {
        var w = document.createElement('div')
        w.className = 'dsh-wk-pdfpage'
        w.style.width = width + 'px'
        w.style.height = h + 'px'
        w.setAttribute('data-page', String(i + 1))
        box.appendChild(w)
        wraps.push(w)
      }
      wrapsRef.current = wraps
      var target = Math.min(Math.max(1, targetRef.current || 1), s.num)
      if (target > 1 && wraps[target - 1]) {
        try { scrollIntoBox(wraps[target - 1], 'start') } catch (e) { /* 忽略 */ }
      }
      if (typeof IntersectionObserver === 'function') {
        var ob = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            var k = wraps.indexOf(en.target)
            if (en.isIntersecting) { draw(k); return }
            // 滚远的页把画布和文本层清掉：25 页全留着会吃掉大量内存，滚动也跟着卡
            if (Math.abs(k - (targetRef.current - 1)) > 6) unload(en.target)
          })
        }, { root: box, rootMargin: '240px 0px' })
        wraps.forEach(function (w) { ob.observe(w) })
        obsRef.current = ob
      } else {
        wraps.forEach(function (_, i) { draw(i) })
      }
      // 命中页和它的前一页先画出来，滚动到位时已经有内容
      draw(target - 1)
      draw(target - 2)
    }

    function unload(w) {
      if (!w || w.getAttribute('data-done') !== '1') return
      w.innerHTML = ''
      w.removeAttribute('data-done')
    }

    function draw(idx) {
      var wrap = wraps[idx]
      var doc2 = docRef.current
      if (!wrap || !doc2 || wrap.getAttribute('data-done') === '1') return
      wrap.setAttribute('data-done', '1')
      // 命中页先藏起来：等文本层算完、黄块落位，再和页面一起亮相，
      // 否则用户先看到一页白纸，几百毫秒后黄块才蹦出来
      var hitPageNow = needle ? Math.min(Math.max(1, targetRef.current || 1), s.num) : 0
      var hideUntilMarked = hitPageNow > 0 && idx + 1 === hitPageNow
      if (hideUntilMarked) wrap.style.visibility = 'hidden'
      doc2.getPage(idx + 1).then(function (page) {
        if (!alive || !wrap.isConnected) return null
        return loadPdfjs().then(function (pdfjs) {
          var base = page.getViewport({ scale: 1 })
          var width = Math.max(300, wrap.clientWidth || (box && box.clientWidth) || 560)
          var viewport = page.getViewport({ scale: width / base.width })
          var dpr = Math.min(1.5, window.devicePixelRatio || 1)
          wrap.style.height = Math.floor(viewport.height) + 'px'
          var canvas = document.createElement('canvas')
          canvas.className = 'dsh-wk-pdfcanvas'
          canvas.width = Math.floor(viewport.width * dpr)
          canvas.height = Math.floor(viewport.height * dpr)
          canvas.style.width = Math.floor(viewport.width) + 'px'
          canvas.style.height = Math.floor(viewport.height) + 'px'
          wrap.appendChild(canvas)
          var c2d = canvas.getContext('2d')
          c2d.scale(dpr, dpr)
          return page.render({ canvasContext: c2d, viewport: viewport }).promise.then(function () {
            if (!alive) return
            // 只有命中页需要文本层：其余页留一个 canvas 就够。
            // 每页都建文本层要排 700 多个 span，25 页就是一万八，卡在这里。
            var hitPage = Math.min(Math.max(1, targetRef.current || 1), s.num)
            if (!needle || idx + 1 !== hitPage) {
              if (hideUntilMarked) wrap.style.visibility = ''
              return
            }
            // 文本层必须先于高亮：黄块坐标全部来自它
            if (typeof pdfjs.TextLayer !== "function") {
              return page.getTextContent().then(function (tc) {
                if (alive && needle) marksItems(pdfjs, viewport, (tc && tc.items) || [], wrap)
              })
            }
            var textDiv = document.createElement("div")
            textDiv.className = "dsh-wk-tl"
            wrap.style.setProperty("--scale-factor", String(viewport.scale))
            wrap.appendChild(textDiv)
            var tl = new pdfjs.TextLayer({
              textContentSource: page.streamTextContent(),
              container: textDiv,
              viewport: viewport
            })
            return tl.render().then(function () {
              if (!alive || !needle || !textDiv.isConnected) return
              marks(pdfjs, viewport, wrap, textDiv)
            }).catch(function () {
              /* 文本层失败不影响看图 */
              if (hideUntilMarked) wrap.style.visibility = ''
            }).then(function () {
              if (hideUntilMarked) wrap.style.visibility = ''
            })
          })
        })
      }).catch(function () {
        /* 单页失败不影响其它页 */
        if (hideUntilMarked) wrap.style.visibility = ''
      })
    }

    function marksItems(pdfjs, viewport, items, wrap) {
      var list = items.filter(function (it) { return it && it.str })
      var full = ''
      var flat = ''
      var fmap = []
      var spans = []
      list.forEach(function (it) {
        var st = full.length
        full += it.str
        spans.push({ start: st, end: full.length, item: it })
        for (var c = 0; c < it.str.length; c++) {
          var ch = it.str[c]
          if (/\s/.test(ch)) continue
          fmap.push(st + c)
          flat += ch
        }
      })

      // PDF 里的文字常被拆成单元格 / 多行，整段精确匹配经常落空。
      // 先试整段；不行就把 needle 切成 10 字片段逐页找，找到几处标几处。
      var clean = String(needle || "").replace(/\s+/g, "")
      var pieces = []
      if (clean && flat.indexOf(clean) >= 0) {
        pieces.push(clean)
      } else {
        for (var i = 0; i < clean.length && pieces.length < 10; i += 8) {
          var seg = clean.slice(i, i + 10)
          if (seg.length < 8) break
          pieces.push(seg)
        }
      }
      if (!pieces.length) return

      var ranges = []
      pieces.forEach(function (pc) {
        var at = flat.indexOf(pc)
        while (at >= 0) {
          var fs = fmap[at]
          var fe = fmap[at + pc.length - 1]
          if (fs !== undefined && fe !== undefined) ranges.push({ start: fs, end: fe + 1 })
          at = flat.indexOf(pc, at + pc.length)
        }
      })
      if (!ranges.length) return

      spans.forEach(function (sp) {
        var hit = false
        for (var i = 0; i < ranges.length; i++) {
          if (sp.end > ranges[i].start && sp.start < ranges[i].end) { hit = true; break }
        }
        if (!hit) return
        var tx = pdfjs.Util.transform(viewport.transform, sp.item.transform)
        var hgt = (sp.item.height || 0) * viewport.scale
        if (!(hgt > 0)) hgt = Math.hypot(tx[2], tx[3]) || 12
        var w = Math.max(8, (sp.item.width || 0) * viewport.scale)
        var mark = document.createElement('div')
        mark.className = 'dsh-wk-pdfhl'
        mark.style.left = tx[4] + 'px'
        mark.style.top = (tx[5] - hgt) + 'px'
        mark.style.width = w + 'px'
        mark.style.height = hgt + 'px'
        wrap.appendChild(mark)
      })
    }

    function marks(pdfjs, viewport, wrap, layer) {
      var idx = buildTextIndex(layer)
      if (!idx.flat) return
      // 先把 chunk 里的图片占位 ![](resource://...) 去掉，它不会出现在 PDF 文字里
      var raw = String(needle || "").replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      var whole = normForMatch(raw)
      if (!whole) return
      var pieces = []
      if (idx.flat.indexOf(whole) >= 0) {
        pieces.push(whole)
      } else {
        // 整段匹配不上（分块可能跨页、或与 PDF 文字有细微差异）：按句找。
        // 句子通常完整躺在某一页里，比“只取开头 10 个字”能覆盖得多得多。
        var parts = raw.split(/[。；！？\n\r]+/)
        var hitAny = false
        parts.forEach(function (pt) {
          var chunks = pt.length > 80 ? pt.split(/[，,、]+/) : [pt]
          chunks.forEach(function (cn) {
            var s2 = normForMatch(cn)
            if (s2.length < 8) return
            if (s2.length > 240) {
              for (var k = 0; k < s2.length; k += 120) pieces.push(s2.slice(k, k + 140))
            } else {
              pieces.push(s2)
            }
            if (idx.flat.indexOf(s2) >= 0) hitAny = true
          })
        })
        if (!hitAny) {
          // 连句子都对不上（表格被拆成单元格等），退化成 12 字滑窗
          pieces = []
          for (var i = 0; i < whole.length && pieces.length < 24; i += 6) {
            var seg = whole.slice(i, i + 12)
            if (seg.length < 8) break
            pieces.push(seg)
          }
        }
        pieces = pieces.filter(function (pc) { return idx.flat.indexOf(pc) >= 0 })
      }
      if (!pieces.length) return
      var pageBox = wrap.getBoundingClientRect()
      if (!pageBox.width || !pageBox.height) return
      var seen = []
      pieces.forEach(function (pc) {
        var at = idx.flat.indexOf(pc)
        while (at >= 0) {
          var range = rangeAtOffset(idx, at, at + pc.length)
          if (range) {
            var rs = mergeRects([].slice.call(range.getClientRects()))
            rs.forEach(function (r) {
              if (r.width < 1 || r.height < 1) return
              for (var k = 0; k < seen.length; k++) {
                var sn = seen[k]
                if (Math.abs(sn.left - r.left) < 2 && Math.abs(sn.top - r.top) < 2) return
              }
              seen.push(r)
              var mark = document.createElement("div")
              mark.className = "dsh-wk-pdfhl"
              mark.style.left = ((r.left - pageBox.left) / pageBox.width * 100) + "%"
              mark.style.top = ((r.top - pageBox.top) / pageBox.height * 100) + "%"
              mark.style.width = (r.width / pageBox.width * 100) + "%"
              mark.style.height = (r.height / pageBox.height * 100) + "%"
              wrap.appendChild(mark)
            })
          }
          at = idx.flat.indexOf(pc, at + pc.length)
        }
      })
    }

    return function () {
      alive = false
      var ob = obsRef.current
      obsRef.current = null
      if (ob) { try { ob.disconnect() } catch (e) { /* 忽略 */ } }
    }
  }, [s.ready, s.num, id, needle, zoom])

  // 3) 页码跟着滚动走（右下角浮着，不占版面）
  React.useEffect(function () {
    var box = holder.current
    if (!box) return undefined
    function onScroll() {
      var wraps = wrapsRef.current
      if (!wraps.length) return
      var top = box.getBoundingClientRect().top
      var cur = 1
      for (var i = 0; i < wraps.length; i++) {
        var r = wraps[i].getBoundingClientRect()
        if (r.top - top <= 40) cur = i + 1
      }
      setS(function (old) { return old.cur === cur ? old : Object.assign({}, old, { cur: cur }) })
    }
    box.addEventListener('scroll', onScroll, { passive: true })
    return function () { box.removeEventListener('scroll', onScroll) }
  }, [s.ready])

  function stepZoom(delta) {
    setZoom(function (z) {
      var cur = z > 0 ? z : 1
      var next = Math.round((cur + delta) * 100) / 100
      if (next < 0.5) next = 0.5
      if (next > 3) next = 3
      return next
    })
  }
  return h('div', { className: 'dsh-wk-pdf' },
    h('div', { className: 'dsh-wk-pdfbar' },
      h('button', { className: 'dsh-wk-zbtn', title: '缩小', onClick: function () { stepZoom(-0.15) } }, '−'),
      h('button', { className: 'dsh-wk-zbtn dsh-wk-zbtn-w', title: '点击恢复适应宽度', onClick: function () { setZoom(0) } }, zoom > 0 ? Math.round(zoom * 100) + '%' : '适应宽度'),
      h('button', { className: 'dsh-wk-zbtn', title: '放大', onClick: function () { stepZoom(0.15) } }, '＋')),
    s.error ? h('div', { className: 'dsh-wk-err' }, s.error) : null,
    s.loading ? h('div', { className: 'dsh-wk-note' }, '正在打开原件…') : null,
    h('div', { className: 'dsh-wk-pdfbox', ref: holder }),
    s.num ? h('div', { className: 'dsh-wk-pdfno dsh-wk-pdfno-float' }, s.cur + ' / ' + s.num) : null)
}


// paper-reader 的阅读器页面（vendor 里自带 pdf.js/katex/bcmap）。
// 缩放、翻页、搜索、命中高亮都由它负责 —— 比在这里重写一套 pdf.js 稳。
function ReaderFrame(props) {
  var kbId = props.kbId || ''
  var name = props.name || ''
  var page = props.page || 0
  var needle = String(props.needle || '').replace(/\s+/g, ' ').slice(0, 160)
  var qs = 'topic=' + encodeURIComponent(kbId) + '&name=' + encodeURIComponent(name)
  if (page > 1) qs += '&page=' + page
  if (needle) qs += '&q=' + encodeURIComponent(needle)
  return h('iframe', {
    className: 'dsh-wk-reader-frame',
    src: API + '/reader?' + qs,
    title: '原件预览',
  })
}
