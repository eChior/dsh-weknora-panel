// 极简 PDF 阅读器：pdfjs 官方 PDFViewer 组件负责渲染/连续滚动/虚拟化/文本层，
// 这里只补三件事 —— 工具栏、命中跳页、命中段黄块。
// 没有翻译/笔记/公式这类论文功能，界面里只有页码、缩放、适应宽度。

import * as pdfjsLib from './pdf.mjs'
import { PDFViewer, EventBus, PDFLinkService, PDFFindController } from './pdf_viewer.mjs'

pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.mjs'

const $ = (id) => document.getElementById(id)
const params = new URLSearchParams(location.search)
const KB = params.get('topic') || params.get('kbId') || ''
const NAME = params.get('name') || ''
const START_PAGE = Math.max(1, parseInt(params.get('page') || '1', 10) || 1)
const NEEDLE = String(params.get('q') || '').replace(/\s+/g, ' ').trim()

const eventBus = new EventBus()
const linkService = new PDFLinkService({ eventBus })
const findController = new PDFFindController({ eventBus, linkService })
const pdfViewer = new PDFViewer({
  container: $('viewer'),
  eventBus,
  linkService,
  findController,
  removePageBorders: true,
  annotationMode: pdfjsLib.AnnotationMode ? pdfjsLib.AnnotationMode.DISABLE : 0,
})
linkService.setViewer(pdfViewer)

let pdfDoc = null
let hits = []          // { page, rects: [{left,top,width,height}] } —— 相对页面容器
let hlEls = []

function tip(msg) {
  const el = $('tip')
  if (!msg) { el.style.display = 'none'; return }
  el.textContent = msg
  el.style.display = 'block'
}

// ── 文本归一化与定位 ────────────────────────────────────────────────
function norm(s) {
  return String(s || '').normalize('NFC').replace(/\s+/g, '').toLowerCase()
}

// 把整页文本层摊平成一条字符串，同时记下每个字符属于哪个 span 的哪个偏移，
// 这样命中后能精确落回 span 上做 Range 选区。
function buildIndex(textLayerDiv) {
  const spans = Array.from(textLayerDiv.querySelectorAll('span'))
  let flat = ''
  const map = [] // 每个字符 -> { span, offset }
  for (const sp of spans) {
    const t = sp.textContent || ''
    for (let i = 0; i < t.length; i++) {
      const ch = t[i]
      if (/\s/.test(ch)) continue
      flat += ch.toLowerCase()
      map.push({ span: sp, offset: i })
    }
  }
  return { flat, map }
}

function rangeOf(idx, start, end) {
  const a = idx.map[start]
  const b = idx.map[end - 1]
  if (!a || !b) return null
  try {
    const r = document.createRange()
    r.setStart(a.span.firstChild || a.span, a.offset)
    r.setEnd(b.span.firstChild || b.span, b.offset + 1)
    return r
  } catch (e) {
    return null
  }
}

// 把相邻的矩形按行合并，避免一句话被行距切成十几块小黄片
function mergeRects(rects) {
  const out = []
  for (const r of rects) {
    const hit = out.find((o) => Math.abs(o.top - r.top) < 4 && Math.abs(o.height - r.height) < 4 &&
      (r.left >= o.left + o.width - 8 || o.left >= r.left + r.width - 8))
    if (hit) {
      const right = Math.max(hit.left + hit.width, r.left + r.width)
      const left = Math.min(hit.left, r.left)
      hit.left = left
      hit.width = right - left
    } else {
      out.push({ ...r })
    }
  }
  return out
}

// 整段匹配不上时按句拆（PDF 里表格被切成单元格、换行都会让整段失配）
function piecesOf(text) {
  const raw = String(text || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  const whole = norm(raw)
  const out = [whole]
  if (!whole) return out
  const parts = raw.split(/[。；！？\n\r]+/).map((s) => s.trim()).filter(Boolean)
  for (const p0 of parts) {
    if (p0.length > 80) {
      for (const p1 of p0.split(/[，,、]+/)) {
        const q = norm(p1)
        if (q.length >= 8) out.push(q.length > 240 ? q.slice(0, 240) : q)
      }
    } else {
      const q = norm(p0)
      if (q.length >= 8) out.push(q)
    }
  }
  return out.filter((s, i, a) => s && a.indexOf(s) === i)
}

function clearHighlights() {
  for (const el of hlEls) el.remove()
  hlEls = []
}

// 在某一页渲染完文本层后调用：找命中 → 画黄块
function markPage(pageNumber, pageView) {
  if (!NEEDLE) return
  const tl = pageView.div && pageView.div.querySelector('.textLayer')
  if (!tl) return
  const idx = buildIndex(tl)
  if (!idx.flat) return

  const pieces = piecesOf(NEEDLE)
  const pageRect = pageView.div.getBoundingClientRect()
  const found = []
  for (const pc of pieces) {
    const k = idx.flat.indexOf(pc)
    if (k < 0) continue
    const r = rangeOf(idx, k, k + pc.length)
    if (!r) continue
    const rects = Array.from(r.getClientRects())
      .filter((b) => b.width > 1 && b.height > 1)
      .map((b) => ({
        left: b.left - pageRect.left,
        top: b.top - pageRect.top,
        width: b.width,
        height: b.height,
      }))
    if (!rects.length) continue
    found.push(...mergeRects(rects))
    if (found.length > 200) break
  }
  if (!found.length) return

  hits.push({ page: pageNumber, rects: found })
  for (const b of found) {
    const d = document.createElement('div')
    d.className = 'wk-hl'
    d.style.left = b.left + 'px'
    d.style.top = b.top + 'px'
    d.style.width = b.width + 'px'
    d.style.height = b.height + 'px'
    pageView.div.appendChild(d)
    hlEls.push(d)
  }
}

function gotoHitPage() {
  if (!hits.length) return
  const first = hits.sort((a, b) => a.page - b.page)[0]
  try {
    pdfViewer.currentPageNumber = first.page
    $('pageNum').value = first.page
  } catch (e) { /* 页号越界就算了 */ }
  tip('命中 ' + hits.length + ' 处，已跳到第 ' + first.page + ' 页')
}

// ── 工具栏 ─────────────────────────────────────────────────────────
function syncUi() {
  const t = pdfViewer.pagesCount
  $('pageCount').textContent = '/ ' + (t || '-')
  $('pageNum').max = String(t || 1)
  $('pageNum').value = String(pdfViewer.currentPageNumber || 1)
  const pct = Math.round((pdfViewer.currentScale || 1) * 100)
  $('zoomVal').textContent = pct + '%'
  $('prev').disabled = pdfViewer.currentPageNumber <= 1
  $('next').disabled = pdfViewer.currentPageNumber >= (t || 1)
}

function stepZoom(delta) {
  const cur = pdfViewer.currentScale || 1
  pdfViewer.currentScale = Math.max(0.25, Math.min(4, +(cur + delta).toFixed(2)))
  syncUi()
}

$('prev').addEventListener('click', () => { pdfViewer.currentPageNumber = pdfViewer.currentPageNumber - 1; syncUi() })
$('next').addEventListener('click', () => { pdfViewer.currentPageNumber = pdfViewer.currentPageNumber + 1; syncUi() })
$('pageNum').addEventListener('change', (e) => {
  const n = Math.max(1, Math.min(pdfViewer.pagesCount || 1, parseInt(e.target.value, 10) || 1))
  pdfViewer.currentPageNumber = n
  syncUi()
})
$('zoomIn').addEventListener('click', () => stepZoom(0.15))
$('zoomOut').addEventListener('click', () => stepZoom(-0.15))
$('fit').addEventListener('click', () => { pdfViewer.currentScaleValue = 'page-width'; syncUi() })

eventBus.on('pagesinit', () => {
  pdfViewer.currentScaleValue = 'page-width'
  if (START_PAGE > 1) pdfViewer.currentPageNumber = START_PAGE
  syncUi()
})
eventBus.on('pagechanging', syncUi)
eventBus.on('scalechanging', syncUi)

// 文本层渲染完成后才画黄块（pagerendered 时 textLayer 可能还没准备好）
eventBus.on('textlayerrendered', ({ pageNumber }) => {
  const pv = pdfViewer.getPageView(pageNumber - 1)
  if (pv) markPage(pageNumber, pv)
  if (!hits.length && NEEDLE && pageNumber === pdfViewer.pagesCount) {
    // 全部页都渲染完还没命中：不改页面，只在状态栏说一声
    $('stat').textContent = '未在原文里找到该段（可能扫描件无文本层）'
  }
})

// ── 启动 ───────────────────────────────────────────────────────────
async function boot() {
  if (!NAME) { tip('缺少 name 参数'); return }
  const url = '/api/weknora/r?p=%2Fpdf&topic=' + encodeURIComponent(KB) + '&name=' + encodeURIComponent(NAME)
  tip('正在打开原件…')
  try {
    pdfDoc = await pdfjsLib.getDocument({
      url,
      cMapUrl: './cmaps/',
      cMapPacked: true,
      enableXfa: false,
    }).promise
  } catch (e) {
    tip('打开失败：' + (e && e.message ? e.message : e))
    return
  }
  tip('')
  $('stat').textContent = pdfDoc.numPages + ' 页'
  pdfViewer.setDocument(pdfDoc)
  linkService.setDocument(pdfDoc, null)
  // 全书文本层渲染完后自动跳到命中页（先等第一轮渲染）
  setTimeout(() => { if (hits.length) gotoHitPage() }, 1200)
  setTimeout(() => { if (hits.length) gotoHitPage() }, 3200)
}

boot()
