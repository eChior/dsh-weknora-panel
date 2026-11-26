// api 调用、时间/复制/发送到对话等工具函数
// 由 build/src 拼接后注入 factory，和同目录其它片段共享作用域（不要加 import/export）。
function api(path, opts) {
  return fetch(API + path, opts).then(function (r) { return r.json() })
}
function fmtTime(d) {
  if (!d) return ''
  var p = function (n) { return String(n).padStart(2, '0') }
  return p(d.getHours()) + ':' + p(d.getMinutes())
}
/** 文件最后更新时间：有就显示（今年省略年份），没有就留空 —— 绝不造假数据 */
function fmtDate(v) {
  if (!v) return ''
  var n = Number(v)
  var d = isNaN(n) || v === '' ? new Date(v) : new Date(n > 1e12 ? n : n * 1000)
  if (isNaN(d.getTime())) return ''
  var p = function (x) { return String(x).padStart(2, '0') }
  var now = new Date()
  return d.getFullYear() === now.getFullYear()
    ? p(d.getMonth() + 1) + '-' + p(d.getDate())
    : d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
// 下载原件：不能直接 <a target=_blank>，Electron 里会被当成 window.open 拦掉。
// 先取回字节，优先用系统保存对话框，退回到 Blob + a[download]。
async function downloadOriginal(id, name) {
  var fileName = String(name || 'download')
  try {
    var res = await fetch(API + '/download?id=' + encodeURIComponent(id))
    if (!res.ok) { toast('下载失败：HTTP ' + res.status); return }
    var blob = await res.blob()
    if (window.showSaveFilePicker) {
      try {
        var handle = await window.showSaveFilePicker({ suggestedName: fileName })
        var w = await handle.createWritable()
        await w.write(blob)
        await w.close()
        return
      } catch (e) {
        if (e && e.name === 'AbortError') return
      }
    }
    var u = URL.createObjectURL(blob)
    var a = document.createElement('a')
    a.href = u
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(function () { URL.revokeObjectURL(u) }, 4000)
  } catch (e) {
    toast('下载失败：' + ((e && e.message) || e))
  }
}

function toast(msg) {
  try {
    var el = document.createElement('div')
    el.className = 'dsh-wk-toast'
    el.textContent = msg
    document.body.appendChild(el)
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el) }, 1800)
  } catch (e) {}
}
/**
 * 复制到剪贴板。
 * @param {boolean} silent 静默模式：不弹「已复制」提示。
 *        调用方自己会弹更具体的提示时用它，避免两个 toast 叠在一起糊成一团。
 */
function copyText(text, silent) {
  var onOk = function () { if (!silent) toast('已复制') }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onOk, function () { fallbackCopy(text, silent) })
      return
    }
  } catch (e) {}
  fallbackCopy(text, silent)
}
function fallbackCopy(text, silent) {
  try {
    var ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    if (!silent) toast('已复制')
  } catch (e) { toast('复制失败，请手动选中') }
}
function sendToConversation(text) {
  try {
    var el = document.querySelector('textarea[placeholder]') ||
             document.querySelector('[contenteditable="true"]')
    if (el) {
      if (el.tagName === 'TEXTAREA') {
        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        setter.call(el, text)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.focus()
        toast('已填入对话框')
        return true
      }
      if (el.isContentEditable) {
        el.focus()
        document.execCommand('insertText', false, text)
        toast('已填入对话框')
        return true
      }
    }
  } catch (e) {}
  // 兜底：放进剪贴板。这里用静默复制，只弹下面这一条提示
  copyText(text, true)
  toast('已复制，粘贴到对话框即可')
  return false
}

/** 极简 Markdown 渲染（笔记/纯文本兜底用） */
/**
 * WeKnora 正文里的图片是 provider 资源地址 resource://<key>，
 * 浏览器拿不到，换成插件的代理路由（带 kbId，服务端才知道去哪个库取）。
 */
function fixResourceUrls(text, kbId) {
  if (!text || String(text).indexOf('resource://') < 0) return text
  return String(text).replace(/resource:\/\/[A-Za-z0-9_\-]+/g, function (m) {
    return API + '/resource?kbId=' + encodeURIComponent(kbId || '') + '&filePath=' + encodeURIComponent(m)
  })
}

// scrollIntoView 会滚动「所有」可滚祖先，包括整页 —— 在 DSH 里点一次角标
// 就会把 document 往下滚一截（表现为「界面整体上移」，点得越多越明显）。
// 这里只滚离目标最近的那个溢出容器，绝不触碰祖先页面。
function scrollParentOf(el) {
  var p = el && el.parentElement
  while (p && p.nodeType === 1) {
    var ov = ''
    try { ov = window.getComputedStyle(p).overflowY } catch (e) { ov = '' }
    if ((ov === 'auto' || ov === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p
    p = p.parentElement
  }
  return null
}

function scrollIntoBox(el, block) {
  if (!el) return
  var box = scrollParentOf(el)
  if (!box) return
  var r = el.getBoundingClientRect()
  var br = box.getBoundingClientRect()
  var offset = block === 'center' ? (box.clientHeight - r.height) / 2 : 8
  var next = box.scrollTop + (r.top - br.top) - offset
  box.scrollTop = Math.max(0, next)
}

// 在某个元素里按引文标黄：整段匹配优先，退化成 12 字滑窗。
function highlightQuote(root, quote) {
  try {
    var needle = String(quote || '').replace(/\s+/g, '')
    if (!root || needle.length < 6) return 0
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
    var nodes = []
    var full = ''
    var pos = []
    var n
    while ((n = walker.nextNode())) {
      if (!n.nodeValue || !n.nodeValue.trim()) continue
      nodes.push(n)
      pos.push(full.length)
      full += n.nodeValue.replace(/\s+/g, '')
    }
    var at = full.indexOf(needle)
    var len = needle.length
    if (at < 0) {
      var probe = needle.slice(0, 12)
      at = full.indexOf(probe)
      len = probe.length
    }
    if (at < 0) return 0
    var end = at + len
    var hits = 0
    for (var i = 0; i < nodes.length; i++) {
      var start = pos[i]
      var stop = start + nodes[i].nodeValue.replace(/\s+/g, '').length
      if (stop <= at || start >= end) continue
      var frag = document.createRange()
      frag.selectNodeContents(nodes[i])
      var mark = document.createElement('mark')
      mark.className = 'dsh-wk-hl'
      try { frag.surroundContents(mark); hits++ } catch (e) { /* 跨节点时放弃 */ }
    }
    return hits
  } catch (e) { return 0 }
}
