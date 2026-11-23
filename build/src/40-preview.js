// 预览容器、状态标签、文件类型判定
// 由 build/src 拼接后注入 factory，和同目录其它片段共享作用域（不要加 import/export）。
function ViewerBox(props) {
  var ref = React.useRef(null)
  var instRef = React.useRef(null)
  var fs = React.useState(false)
  var fallback = fs[0], setFallback = fs[1]

  React.useEffect(function () { setFallback(false) }, [props.source])

  React.useEffect(function () {
    var V = window.__DSH_WK_VIEWER__
    if (fallback || !ref.current || !V) return
    var destroyed = false

    try {
      if (instRef.current) { try { instRef.current.destroy() } catch (e) {} instRef.current = null }
      instRef.current = V.createViewer({
        container: ref.current,
        file: props.source,
        fileName: props.fileName,
        height: '100%',
        width: '100%',
        fit: 'contain',
        toolbar: true,
        theme: 'auto',
        plugins: V.makePlugins(),
        onUnsupported: function () { if (!destroyed) setFallback(true) },
        onError: function () { if (!destroyed) setFallback(true) },
      })
    } catch (e) {
      setFallback(true)
    }

    return function () {
      destroyed = true
      if (instRef.current) { try { instRef.current.destroy() } catch (e) {} instRef.current = null }
    }
  }, [props.source, props.fileName, fallback])

  if (fallback) {
    // 原生兜底：PDF / 图片 / 音视频浏览器都能直接渲染
    var ext = String(props.fileName || '').split('.').pop().toLowerCase()
    if (ext === 'pdf') {
      return h('iframe', {
        className: 'dsh-wk-frame',
        src: props.source,
        title: props.fileName,
        style: { flex: 1, minHeight: '60vh', width: '100%', border: 'none' },
      })
    }
    if (/^(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/.test(ext)) {
      return h('img', { className: 'dsh-wk-media', src: props.source, alt: props.fileName })
    }
    if (/^(mp4|webm|mov|m4v)$/.test(ext)) {
      return h('video', { className: 'dsh-wk-media', src: props.source, controls: true })
    }
    if (/^(mp3|wav|m4a|ogg|aac|flac)$/.test(ext)) {
      return h('audio', { className: 'dsh-wk-media', src: props.source, controls: true })
    }
    return h('div', { className: 'dsh-wk-note', style: { marginTop: '12px' } },
      '这个格式没法内联预览，点右上角「下载原件」拿原文件。')
  }

  return h('div', { ref: ref, className: 'dsh-wk-vbox', style: { flex: 1, minHeight: '60vh' } })
}

// ── 侧边栏入口（⚠️ 只返回图标） ──────────────────────────
function PanelGlyph(props) {
  return h(FolderGlyph, { size: (props && props.size) || 18 })
}

// ── 错误边界 ─────────────────────────────────────────────
class PanelBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { err: null }
  }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err) {
    console.error('[dsh-weknora] 界面渲染出错：', err)
  }
  render() {
    if (this.state.err) {
      return h('div', { className: 'dsh-wk-root' },
        h('div', { className: 'dsh-wk-head' }, h('span', { className: 'dsh-wk-title' }, '知识库 WeKnora')),
        h('div', { className: 'dsh-wk-main' },
          h('div', { className: 'dsh-wk-err' },
            '界面出了点问题：' + String((this.state.err && this.state.err.message) || this.state.err)),
          h('div', { className: 'dsh-wk-note', style: { marginTop: '10px' } },
            '可以点下面的按钮重试；如果反复出现，重启 DSH 再看看。'),
          h('button', {
            className: 'dsh-wk-btn dsh-wk-btn-p', style: { marginTop: '14px' },
            onClick: function () { this.setState({ err: null }) }.bind(this),
          }, '重试'),
        ),
      )
    }
    return this.props.children
  }
}

// ── 解析状态徽标 ─────────────────────────────────────────
var STATUS_TEXT = {
  completed: '已解析', processing: '解析中', pending: '排队中',
  failed: '解析失败', cancelled: '已取消',
}
function StatusTag(props) {
  var s = props.status
  if (!s) return null
  var cls = 'dsh-wk-tag '
  if (s === 'completed') cls += 'dsh-wk-tag-s'
  else if (s === 'failed') cls += 'dsh-wk-tag-e'
  else cls += 'dsh-wk-tag-m'
  return h('span', { className: cls, title: props.title || s }, STATUS_TEXT[s] || s)
}

// ── 类型判定 ─────────────────────────────────────────────
/** 走「分块拼全文 + Markdown 渲染」的文本类 */
var TEXT_TYPES = {
  md: 1, markdown: 1, txt: 1, csv: 1, json: 1, html: 1, htm: 1,
  xml: 1, yaml: 1, yml: 1, log: 1, tsv: 1, ini: 1, conf: 1,
}
/** 走预览引擎（office / pdf / 图片 / 音视频）的类型 */
var OFFICE_TYPES = {
  doc: 1, docx: 1, docm: 1, odt: 1, rtf: 1,
  xls: 1, xlsx: 1, xlsm: 1, ods: 1,
  ppt: 1, pptx: 1, pptm: 1, odp: 1,
  pdf: 1, epub: 1, xmind: 1,
}
var IMAGE_TYPES = { png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1, bmp: 1, svg: 1, avif: 1, ico: 1 }
var MEDIA_TYPES = { mp3: 1, wav: 1, m4a: 1, ogg: 1, aac: 1, flac: 1, mp4: 1, webm: 1, mov: 1, m4v: 1 }

function extOf(f) {
  if (!f) return ''
  var n = String(f.file_name || f.title || '')
  var m = /\\.([A-Za-z0-9]{1,6})$/.exec(n)
  if (m) return m[1].toLowerCase()
  return String(f.file_type || '').toLowerCase()
}
function previewKindOf(f) {
  var ext = extOf(f)
  // WeKnora 入库的是「解析后的文本分块」，原件排版并不保证能完整还原，
  // 所以除图片/音视频外一律走「分块拼全文」的文本视图 —— 不强求显示原 Word/PDF。
  if (IMAGE_TYPES[ext] || MEDIA_TYPES[ext]) return 'viewer'
  return 'text'
}
/** 给预览引擎一个带扩展名的文件名（WeKnora 的 file_name 本来就有，兜底时才补） */
function fileNameForFile(f) {
  var n = String((f && (f.file_name || f.title)) || '')
  if (/\\.([A-Za-z0-9]{1,6})$/.test(n)) return n
  var ext = extOf(f)
  return ext ? n + '.' + ext : n
}
function sizeText(n) {
  var v = Number(n)
  if (!v || isNaN(v)) return ''
  if (v < 1024) return v + ' B'
  if (v < 1024 * 1024) return (v / 1024).toFixed(0) + ' KB'
  return (v / 1024 / 1024).toFixed(1) + ' MB'
}
/** 命中片段里的高亮：截断到 length 且把查询词包起来（WeKnora 不给 matched_content 时用） */
function snippet(text, limit) {
  var s = String(text || '').replace(/\\s+/g, ' ').trim()
  if (!s) return ''
  var max = limit || 320
  return s.length > max ? s.slice(0, max) + '…' : s
}

// ── 主面板 ───────────────────────────────────────────────
// ── 问答页：服务端直答 + 内联角标 ─────────────────────────
// WeKnora 生成的答案正文里本来就带 <kb doc="..." chunk_id="..." />，
// 这里把它渲染成可点角标，点开就是那一段的逐字原文（和 WeKnora 网页端一致）。

// 问答区：直接用 WeKnora 的接口渲染（不自造数据层）。
