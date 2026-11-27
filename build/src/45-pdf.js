// pdf.js 加载、文本索引、PdfView
// 由 build/src 拼接后注入 factory，和同目录其它片段共享作用域（不要加 import/export）。
function ReaderFrame(props) {
  var kbId = props.kbId || ''
  var name = props.name || ''
  var page = props.page || 1
  var needle = String(props.needle || '').replace(/\s+/g, ' ').slice(0, 300)
  // 直接用 knowledge_id 取 PDF：/api/weknora/pdf?id=…
  // （原来走 /r?p=/pdf&topic=&name=，那条路由和 reader/ 一起删掉了，
  //   预览于是一直白屏转圈 —— 2026-11-26 修）
  var fid = String(props.id || '')
  var fileUrl = fid
    ? API + '/pdf?id=' + encodeURIComponent(fid)
    : API + '/r?p=' + encodeURIComponent('/pdf') +
      '&topic=' + encodeURIComponent(kbId) + '&name=' + encodeURIComponent(name)
  // 页宽自适应：页宽 = 侧栏宽度，整页能看全；命中处靠 viewer 里的滚动居中定位
  var hash = 'page=' + (page > 0 ? page : 1) + '&zoom=page-width'
  if (needle) hash += '&search=' + encodeURIComponent(needle.slice(0, 120))
  var src = API + '/vw/web/viewer.html?file=' + encodeURIComponent(fileUrl)
  if (needle) src += '&q=' + encodeURIComponent(needle)
  return h('iframe', {
    className: 'dsh-wk-reader-frame',
    src: src + '#' + hash,
    title: '原件预览',
    onLoad: function () { try { logDiag('frame-load', { u: src.slice(0, 120) }) } catch (e1) {} },
    onError: function () { try { logDiag('frame-error', { u: src.slice(0, 120) }) } catch (e2) {} },
  })
}
