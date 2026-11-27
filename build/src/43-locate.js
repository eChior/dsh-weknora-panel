// 原文定位与高亮：整套照搬 WeKnora 前端
//   WeKnora-src/frontend/src/utils/sourceLocator.ts      归一化匹配
//   WeKnora-src/frontend/src/utils/sourceLocatorDom.ts   DOM Range + 高亮 + 滚动
// 关键设计（不要自己另发明一套）：
//   1. 高亮优先走 CSS Custom Highlight API —— 完全不改 DOM，
//      所以不会叠加、不会破坏 docx 版式、不会污染别处的文本节点；
//      只有浏览器不支持时才退回 <mark> 包裹。
//   2. 归一化只保留字母数字与数字之间的符号，因此标点/空白/全角差异不影响匹配。
//   3. findInText 只在**唯一命中**时返回。宁可不标，也不要在多个候选里瞎猜。
//   4. 滚动只动指定容器（scrollRectIntoContainer），绝不碰外层滚动祖先。

var SRC_HIGHLIGHT_NAME = 'source-locate'
var SRC_BLOCK_CLASS = 'source-locate-block'
var SRC_MARK_CLASS = 'source-locate-mark'
var SRC_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u
var SRC_GRAPHEMES = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : undefined
var SRC_SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1 }

function srcNormalizationSpans(raw) {
  var out = []
  if (SRC_GRAPHEMES) {
    var it = SRC_GRAPHEMES.segment(raw)
    var arr = it[Symbol.iterator]()
    for (var step = arr.next(); !step.done; step = arr.next()) out.push(step.value)
    return out
  }
  // 老浏览器没有 Intl.Segmenter：让组合标记跟着基字符，
  // 相邻 starter 只在能组合时才并成一段。
  var segment = '', index = 0
  var chars = Array.from(raw)
  for (var i = 0; i < chars.length; i++) {
    var ch = chars[i]
    if (segment && !/\p{M}/u.test(ch)) {
      var boundary = segment.normalize('NFC') + ch.normalize('NFC')
      if (boundary.normalize('NFC') === boundary) {
        out.push({ segment: segment, index: index })
        index += segment.length
        segment = ''
      }
    }
    segment += ch
  }
  if (segment) out.push({ segment: segment, index: index })
  return out
}

function srcFoldChar(ch) {
  if (!SRC_LETTER_OR_DIGIT.test(ch)) return ''
  return ch.normalize('NFKC').toLowerCase()
}

function srcNormalizeWithPositions(text) {
  var raw = String(text || '')
  var canonical = raw.normalize('NFC')
  var chars = Array.from(canonical)
  var starts = [], ends = []
  if (canonical !== raw || /\p{M}/u.test(raw)) {
    var spans = srcNormalizationSpans(raw)
    for (var s = 0; s < spans.length; s++) {
      var length = Array.from(spans[s].segment.normalize('NFC')).length
      for (var j = 0; j < length; j++) {
        starts.push(spans[s].index)
        ends.push(spans[s].index + spans[s].segment.length)
      }
    }
  }
  var norm = '', pos = [], endPos = [], offset = 0
  var digit = function (v) { return !!v && /^\p{N}$/u.test(v.normalize('NFKC')) }
  for (var i = 0; i < chars.length; i++) {
    var ch = chars[i]
    var value = ch.normalize('NFKC')
    var folded = srcFoldChar(ch)
    if (/^[.,/:+−%‰<>=≤≥≠-]$/u.test(value)) {
      var before = i - 1, after = i + 1
      while (before >= 0 && /^[ \t]$/.test(chars[before])) before--
      while (after < chars.length && /^[ \t]$/.test(chars[after])) after++
      var prev = digit(chars[before]), next = digit(chars[after])
      var symbol = (/[.,/:]/.test(value) && prev && next) ||
        (/^[+−-]$/.test(value) && next) || (/^[%‰]$/.test(value) && prev) || /^[<>=≤≥≠]$/.test(value)
      if (symbol) folded = value.replace('−', '-')
    }
    norm += folded
    // 偏移一律用 UTF-16 单位，和 Range 的 offset 一致。
    for (var k = 0; k < folded.length; k++) {
      pos.push(starts[i] !== undefined ? starts[i] : offset)
      endPos.push(ends[i] !== undefined ? ends[i] : offset + ch.length)
    }
    offset += ch.length
  }
  return { norm: norm, pos: pos, endPos: endPos }
}

function srcNormalizeForMatch(text) { return srcNormalizeWithPositions(text).norm }

function srcFindNormalizedMatches(haystack, quote) {
  var needle = srcNormalizeForMatch(quote)
  if (needle.length < 2 || !haystack) return []
  var search = function (key) {
    var matches = []
    var first = Array.from(key)[0], last = Array.from(key).slice(-1)[0]
    for (var from = 0; from <= haystack.length - key.length;) {
      var at = haystack.indexOf(key, from)
      if (at < 0) break
      var end = at + key.length
      // 引文里的数字不能是另一个数字的前缀/后缀。
      var before = haystack.slice(Math.max(0, at - 2), at), after = haystack.slice(end, end + 2)
      var startsInsideNumber = /\p{N}/u.test(first) && /[\p{N}.,:/+−-]$/u.test(before)
      var endsInsideNumber = /\p{N}/u.test(last) && /^[\p{N}.,:/%‰]/u.test(after)
      if (!startsInsideNumber && !endsInsideNumber) matches.push({ start: at, end: end, score: 1 })
      from = at + 1
    }
    return matches
  }
  var exact = search(needle)
  if (exact.length) return exact
  // 渲染器可能省掉列表标签，这是唯一容忍的前缀差异。
  var withoutLabel = quote.replace(/^\s*[（(][一二三四五六七八九十百\d]+[)）]\s*/u, '')
  if (withoutLabel === quote) return []
  needle = srcNormalizeForMatch(withoutLabel)
  return needle.length >= 8 ? search(needle) : []
}

function srcFindTextMatches(text, quote) {
  var n = srcNormalizeWithPositions(text)
  return srcFindNormalizedMatches(n.norm, quote).map(function (m) {
    return { start: n.pos[m.start], end: n.endPos[m.end - 1] }
  })
}

// 唯一命中才算找到；多个候选时返回 null（调用方再按结构定位收窄）。
function srcFindInText(text, quote) {
  var hits = srcFindTextMatches(text, quote)
  return hits.length === 1 ? hits[0] : null
}

function srcBuildTextIndex(root) {
  var nodes = [], text = ''
  var doc = root.ownerDocument || root
  var walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      var el = node.parentElement
      while (el && el !== root) {
        if (SRC_SKIP_TAGS[el.tagName]) return NodeFilter.FILTER_REJECT
        el = el.parentElement
      }
      return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  for (var n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n, start: text.length })
    // 分隔符避免相邻块的词粘在一起；它不是字母数字，匹配时会被忽略。
    text += n.nodeValue + ' '
  }
  return { text: text, nodes: nodes }
}

function srcPointAt(index, offset) {
  if (!index.nodes.length) return null
  var lo = 0, hi = index.nodes.length - 1
  while (lo < hi) {
    var mid = (lo + hi + 1) >> 1
    if (index.nodes[mid].start <= offset) lo = mid
    else hi = mid - 1
  }
  var entry = index.nodes[lo]
  var len = (entry.node.nodeValue || '').length
  return { node: entry.node, offset: Math.max(0, Math.min(len, offset - entry.start)) }
}

function srcRangeAt(root, hit, index) {
  var from = srcPointAt(index, hit.start)
  var to = srcPointAt(index, hit.end)
  if (!from || !to) return null
  var range = (root.ownerDocument || root).createRange()
  range.setStart(from.node, from.offset)
  range.setEnd(to.node, to.offset)
  return range
}

function srcFindTextRange(root, quote, index) {
  var idx = index || srcBuildTextIndex(root)
  var hit = srcFindInText(idx.text, quote)
  if (!hit) return null
  return srcRangeAt(root, hit, idx)
}


function srcHighlightRegistry() {
  // 必须走 window：本模块所在 bundle 里有个同名的 `var CSS`（样式表字符串），
  // 直接写 CSS 会拿到那个字符串，于是永远退回 <mark> 包裹。
  var css = typeof window !== 'undefined' ? window.CSS : null
  var H = typeof window !== 'undefined' ? window.Highlight : null
  if (css && css.highlights && H) return { registry: css.highlights, Highlight: H }
  return null
}

function srcWrapRange(range) {
  var doc = range.startContainer.ownerDocument
  if (!doc) return []
  var texts = []
  var walker = doc.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT)
  for (var n = walker.currentNode; n; n = walker.nextNode()) {
    if (n.nodeType === 3 && range.intersectsNode(n)) texts.push(n)
  }
  var marks = []
  for (var i = 0; i < texts.length; i++) {
    var target = texts[i]
    var start = target === range.startContainer ? range.startOffset : 0
    var end = target === range.endContainer ? range.endOffset : target.length
    if (end <= start) continue
    if (end < target.length) target.splitText(end)
    if (start > 0) target = target.splitText(start)
    var mark = doc.createElement('mark')
    mark.className = SRC_MARK_CLASS
    if (target.parentNode) target.parentNode.insertBefore(mark, target)
    mark.appendChild(target)
    marks.push(mark)
  }
  return marks
}

// 高亮若干 Range，返回撤销函数。支持 Custom Highlight API 时完全不动 DOM。
function srcHighlightRanges(ranges) {
  var live = (ranges || []).filter(function (r) { return r && !r.collapsed })
  if (!live.length) return function () {}
  var api = srcHighlightRegistry()
  if (api) {
    api.registry.set(SRC_HIGHLIGHT_NAME, new api.Highlight(...live))
    return function () { api.registry.delete(SRC_HIGHLIGHT_NAME) }
  }
  var marks = []
  for (var i = 0; i < live.length; i++) marks = marks.concat(srcWrapRange(live[i]))
  return function () {
    for (var j = 0; j < marks.length; j++) {
      var mark = marks[j], parent = mark.parentNode
      if (!parent) continue
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
      parent.removeChild(mark)
      parent.normalize()
    }
  }
}

// 整块（段落 / 表格行 / 幻灯片）标记为被引用。
function srcHighlightElements(elements) {
  var list = (elements || []).filter(Boolean)
  for (var i = 0; i < list.length; i++) list[i].classList.add(SRC_BLOCK_CLASS)
  return function () {
    for (var j = 0; j < list.length; j++) list[j].classList.remove(SRC_BLOCK_CLASS)
  }
}

// 只滚这一个容器，让目标落在大约三分之一处；绝不动外层滚动祖先。
function srcScrollRectIntoContainer(container, rect) {
  var box = container.getBoundingClientRect()
  var target = container.scrollTop + (rect.top - box.top) - Math.max(24, box.height / 3)
  container.scrollTop = Math.max(0, target)
}

function srcScrollParent(el, fallback) {
  // 从 el 自身往上找：调用方传进来的 el 常常是「内容容器」，
  // 真正能滚的是它的父级，从 parentElement 起找会当场撞上 fallback 就 break。
  // 到 document.body 之前停，保证永远不会去滚整页。
  var stop = document.body || null
  for (var node = el; node && node !== stop; node = node.parentElement) {
    var style = getComputedStyle(node)
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node
  }
  return fallback
}

// 把 Range 或元素滚进视野：容器取最近的可滚祖先，滚动只发生在它身上。
function srcReveal(container, target) {
  if (!target) return
  var rect = typeof target.getBoundingClientRect === 'function'
    ? target.getBoundingClientRect()
    : target.getBoundingClientRect()
  if (!rect || (!rect.width && !rect.height)) return
  var box = srcScrollParent(
    target.nodeType === 1 ? target : target.startContainer && target.startContainer.parentElement,
    container)
  srcScrollRectIntoContainer(box || container, rect)
}
