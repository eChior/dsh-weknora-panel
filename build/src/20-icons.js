// 类型样式表、图标与图标组件
// 由 build/src 拼接后注入 factory，和同目录其它片段共享作用域（不要加 import/export）。
var TYPE_STYLE = {
  pdf:  { c1: '#ff7b72', c2: '#e5484d', label: 'PDF', small: 1 },
  doc:  { c1: '#6a99e8', c2: '#2b579a', label: 'W' },
  docx: { c1: '#6a99e8', c2: '#2b579a', label: 'W' },
  docm: { c1: '#6a99e8', c2: '#2b579a', label: 'W' },
  rtf:  { c1: '#6a99e8', c2: '#2b579a', label: 'W' },
  odt:  { c1: '#6a99e8', c2: '#2b579a', label: 'W' },
  xls:  { c1: '#43b97a', c2: '#217346', label: 'X' },
  xlsx: { c1: '#43b97a', c2: '#217346', label: 'X' },
  xlsm: { c1: '#43b97a', c2: '#217346', label: 'X' },
  ods:  { c1: '#43b97a', c2: '#217346', label: 'X' },
  csv:  { c1: '#43b97a', c2: '#217346', label: 'C' },
  ppt:  { c1: '#f58254', c2: '#d24726', label: 'P' },
  pptx: { c1: '#f58254', c2: '#d24726', label: 'P' },
  pptm: { c1: '#f58254', c2: '#d24726', label: 'P' },
  odp:  { c1: '#f58254', c2: '#d24726', label: 'P' },
  md:   { c1: '#9aa8b8', c2: '#5b6b7c', label: 'M' },
  markdown: { c1: '#9aa8b8', c2: '#5b6b7c', label: 'M' },
  txt:  { c1: '#b9bfc9', c2: '#8a8f98', label: 'T' },
  log:  { c1: '#b9bfc9', c2: '#8a8f98', label: 'T' },
  tsv:  { c1: '#b9bfc9', c2: '#8a8f98', label: 'T' },
  json: { c1: '#c9b06a', c2: '#a8862b', label: '{' },
  yaml: { c1: '#c9b06a', c2: '#a8862b', label: 'Y' },
  yml:  { c1: '#c9b06a', c2: '#a8862b', label: 'Y' },
  xml:  { c1: '#c9b06a', c2: '#a8862b', label: '<' },
  html: { c1: '#4aa8f0', c2: '#1e7fe0', globe: 1 },
  htm:  { c1: '#4aa8f0', c2: '#1e7fe0', globe: 1 },
  png:  { c1: '#39cdbd', c2: '#0f9b8e', image: 1 },
  jpg:  { c1: '#39cdbd', c2: '#0f9b8e', image: 1 },
  jpeg: { c1: '#39cdbd', c2: '#0f9b8e', image: 1 },
  gif:  { c1: '#39cdbd', c2: '#0f9b8e', image: 1 },
  webp: { c1: '#39cdbd', c2: '#0f9b8e', image: 1 },
  bmp:  { c1: '#39cdbd', c2: '#0f9b8e', image: 1 },
  svg:  { c1: '#39cdbd', c2: '#0f9b8e', image: 1 },
  ico:  { c1: '#39cdbd', c2: '#0f9b8e', image: 1 },
  xmind: { c1: '#b18cfa', c2: '#7c5cff', mind: 1 },
  epub: { c1: '#9aa8b8', c2: '#5b6b7c', label: 'E' },
  mp3:  { c1: '#f27ab5', c2: '#e0518f', mic: 1 },
  wav:  { c1: '#f27ab5', c2: '#e0518f', mic: 1 },
  m4a:  { c1: '#f27ab5', c2: '#e0518f', mic: 1 },
  aac:  { c1: '#f27ab5', c2: '#e0518f', mic: 1 },
  ogg:  { c1: '#f27ab5', c2: '#e0518f', mic: 1 },
  flac: { c1: '#f27ab5', c2: '#e0518f', mic: 1 },
  mp4:  { c1: '#ff9c66', c2: '#ff6b35', play: 1 },
  webm: { c1: '#ff9c66', c2: '#ff6b35', play: 1 },
  mov:  { c1: '#ff9c66', c2: '#ff6b35', play: 1 },
  m4v:  { c1: '#ff9c66', c2: '#ff6b35', play: 1 },
}

var _icoSeq = 0
function gradId(prefix) { return prefix + (++_icoSeq) }

function icoSvg(size, kids) {
  return h('svg', { width: size, height: size, viewBox: '0 0 32 32', style: { flexShrink: 0, display: 'block' } }, kids)
}

var ICON_FONT = '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'

/** 圆角方块里的白色符号（每种类型一个手绘小图形） */
function glyphFor(st, key) {
  if (st.label) {
    return h('text', { key: key, x: 16, y: 16.5, textAnchor: 'middle', dominantBaseline: 'central',
      fill: '#fff', fontWeight: 600, fontSize: st.small ? 9 : 14,
      fontFamily: ICON_FONT, letterSpacing: 0.5 }, st.label)
  }
  if (st.globe) {
    return h('g', { key: key },
      h('circle', { cx: 16, cy: 16, r: 8.5, fill: 'none', stroke: '#fff', strokeWidth: 1.8 }),
      h('ellipse', { cx: 16, cy: 16, rx: 3.8, ry: 8.5, fill: 'none', stroke: '#fff', strokeWidth: 1.3 }),
      h('path', { d: 'M8 13.2h16M8 18.8h16', stroke: '#fff', strokeWidth: 1.3, fill: 'none', strokeLinecap: 'round' }))
  }
  if (st.wechat) {
    return h('path', { key: key, d: 'M16 7.5c-5 0-9 3.1-9 7 0 2.3 1.3 4.3 3.3 5.6l-.7 3.4 3.8-1.9c.8.2 1.7.3 2.6.3 5 0 9-3.1 9-7.1s-4-7.3-9-7.3z', fill: '#fff' })
  }
  if (st.image) {
    return h('g', { key: key },
      h('circle', { cx: 11.5, cy: 11.5, r: 2, fill: '#fff' }),
      h('path', { d: 'M7 23.5l6-7 4 4.5 3.5-3.5 4.5 6', stroke: '#fff', strokeWidth: 2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }))
  }
  if (st.note) {
    return h('path', { key: key, d: 'M10 22l1-3.6 8.2-8.2a1.7 1.7 0 012.4 0l.2.2a1.7 1.7 0 010 2.4L13.6 21z', fill: '#fff' })
  }
  if (st.chat) {
    return h('g', { key: key },
      h('path', { d: 'M8 10.5A3.5 3.5 0 0111.5 7h9A3.5 3.5 0 0124 10.5v5a3.5 3.5 0 01-3.5 3.5H14l-4 3.5v-3.5h-.5A3.5 3.5 0 016 15.5z', fill: '#fff' }),
      h('circle', { cx: 12.5, cy: 13, r: 1.1, fill: st.c2, key: 'd1' }),
      h('circle', { cx: 16, cy: 13, r: 1.1, fill: st.c2, key: 'd2' }),
      h('circle', { cx: 19.5, cy: 13, r: 1.1, fill: st.c2, key: 'd3' }))
  }
  if (st.mind) {
    return h('g', { key: key },
      h('circle', { cx: 10.5, cy: 16, r: 2.6, fill: '#fff' }),
      h('path', { d: 'M13 14.5L20 10M13.5 17.5l7 4.5M13.5 16h7', stroke: '#fff', strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round' }),
      h('circle', { cx: 22.5, cy: 9.5, r: 2, fill: '#fff', key: 'm1' }),
      h('circle', { cx: 22.5, cy: 22.5, r: 2, fill: '#fff', key: 'm2' }),
      h('circle', { cx: 23.5, cy: 16, r: 2, fill: '#fff', key: 'm3' }))
  }
  if (st.mic) {
    return h('g', { key: key },
      h('rect', { x: 12.8, y: 7.5, width: 6.4, height: 11, rx: 3.2, fill: '#fff' }),
      h('path', { d: 'M9.5 15.5a6.5 6.5 0 0013 0M16 22v3M12.5 25.2h7', stroke: '#fff', strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round' }))
  }
  if (st.play) {
    return h('path', { key: key, d: 'M12.5 9.8l10 6.2-10 6.2z', fill: '#fff' })
  }
  return h('path', { key: key, d: 'M10 6.5h8L23 11v14a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 019 25V8a1.5 1.5 0 011-1.5z', fill: '#fff' })
}

/** 文件类型图标（macOS Big Sur 风格的渐变圆角方块） */
function FileTypeIcon(props) {
  var size = (props && props.size) || 22
  var st = TYPE_STYLE[String((props && props.type) || '').toLowerCase()]
  if (!st) {
    var id0 = gradId('digu')
    return icoSvg(size, [
      h('defs', { key: 'd' }, h('linearGradient', { id: id0, x1: 0, y1: 0, x2: 0, y2: 1 },
        h('stop', { offset: 0, stopColor: '#c3c9d1' }), h('stop', { offset: 1, stopColor: '#9aa2ad' }))),
      h('rect', { key: 'r', x: 2, y: 2, width: 28, height: 28, rx: 7.5, fill: 'url(#' + id0 + ')' }),
      h('path', { key: 'g', d: 'M11 9h7l4 4v10.5a1 1 0 01-1 1H11a1 1 0 01-1-1V10a1 1 0 011-1z', fill: '#fff', opacity: 0.92 }),
    ])
  }
  var id = gradId('dig')
  return icoSvg(size, [
    h('defs', { key: 'd' }, h('linearGradient', { id: id, x1: 0, y1: 0, x2: 0, y2: 1 },
      h('stop', { offset: 0, stopColor: st.c1 }), h('stop', { offset: 1, stopColor: st.c2 }))),
    h('rect', { key: 'r', x: 2, y: 2, width: 28, height: 28, rx: 7.5, fill: 'url(#' + id + ')' }),
    h('rect', { key: 'h', x: 2, y: 2, width: 28, height: 15, rx: 7.5, fill: '#fff', opacity: 0.16 }),
    glyphFor(st, 'g'),
  ])
}

/** 文件夹图标（访达同款蓝色立体文件夹） */
function MacFolderIcon(props) {
  var s = (props && props.size) || 20
  var id = gradId('dif')
  return h('svg', { width: s, height: s, viewBox: '0 0 48 48', style: { flexShrink: 0, display: 'block' } },
    h('defs', null, h('linearGradient', { id: id, x1: 0, y1: 0, x2: 0, y2: 1 },
      h('stop', { offset: 0, stopColor: '#7db9f2' }), h('stop', { offset: 1, stopColor: '#3f8ef7' }))),
    h('path', { d: 'M5 12a4 4 0 014-4h9.4c1 0 2 .4 2.7 1.1l3.2 3.4H39a4 4 0 014 4v3.5H5z', fill: '#2e7cd6' }),
    h('rect', { x: 5, y: 15, width: 38, height: 25, rx: 4.5, fill: 'url(#' + id + ')' }),
    h('rect', { x: 5, y: 15, width: 38, height: 12, rx: 4.5, fill: '#fff', opacity: 0.18 }),
  )
}

/**
 * 知识库图标：统一用 macOS 访达同款蓝色文件夹。
 * 之前给每个库按名称哈希配色 + 首字，颜色太杂反而干扰识别；
 * 分组标题已经说明「个人/共享」，这里统一单色更干净。
 */
function KbIcon(props) {
  return h(MacFolderIcon, { size: (props && props.size) || 18 })
}




function FolderGlyph(props) {
  var s = (props && props.size) || 18
  return h('svg', { width: s, height: s, viewBox: '0 0 20 20', fill: 'none' },
    h('path', {
      d: 'M2.5 5A1.8 1.8 0 014.3 3.2h3.1c.5 0 .9.2 1.2.6l1 1.3c.3.4.7.6 1.2.6h4.9A1.8 1.8 0 0117.5 7.5v7.7a1.8 1.8 0 01-1.8 1.8H4.3a1.8 1.8 0 01-1.8-1.8V5z',
      stroke: 'currentColor', strokeWidth: 1.45,
    }),
  )
}
function RefreshIcon(props) {
  var s = (props && props.size) || 15
  return h('svg', { width: s, height: s, viewBox: '0 0 16 16', fill: 'none' },
    h('path', {
      d: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3.2h-3.2',
      stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
    }),
  )
}
function CopyGlyph() {
  return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' },
    h('rect', { x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.1 }),
    h('path', { d: 'M10.5 3.5H4a1.5 1.5 0 00-1.5 1.5v6.5', stroke: 'currentColor', strokeWidth: 1.1 }),
  )
}
function QuoteGlyph() {
  return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' },
    h('path', {
      d: 'M6 9.5L10 5.5M6.8 4.2l1.5-1.5a2.6 2.6 0 013.7 3.7l-1.5 1.5M9.2 11.8l-1.5 1.5a2.6 2.6 0 01-3.7-3.7l1.5-1.5',
      stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round',
    }),
  )
}
function ExternalGlyph() {
  return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' },
    h('path', {
      d: 'M9.5 2.5h4v4M13.5 2.5L7.5 8.5M12 9.5v3a1.5 1.5 0 01-1.5 1.5h-6A1.5 1.5 0 013 12.5v-6A1.5 1.5 0 014.5 5h3',
      stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round', strokeLinejoin: 'round',
    }),
  )
}

// ── 工具 ─────────────────────────────────────────────────
