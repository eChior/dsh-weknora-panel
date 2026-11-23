// Markdown 渲染（含 <kb> → [N]、表格、图片）
// 由 build/src 拼接后注入 factory，和同目录其它片段共享作用域（不要加 import/export）。
function renderMarkdown(src, opts) {
  opts = opts || {}
  var lines = String(src).split('\n')
  var out = []
  var listBuf = []
  var key = 0
  // 角标编号：同一个 chunk 重复出现用同一个号
  var citeIndex = {}
  var citeOrder = 0

  var URL_RE = /https?:\/\/[A-Za-z0-9\-._~:\/?#\[\]@!$&'()*+,;=%]+/g
  // WeKnora 原生的内联出处标记：<kb doc="文件名" chunk_id="..." kb_id="..." />
  var KB_ALL = /<kb\s+([^>]*?)\/?>/gi
  var KB_ATTR = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"/g
  var BR_RE = /<br\s*\/?>/gi
  // 段落开头的序号/小标题标记 —— 保留原样并加粗。
  // ⚠️ 故意不把「1.」「（一）」转成 <ol>：相邻的「（一）…」和「1.…」会被浏览器
  //    当成同一个列表重新编号，原来的 1. 会被显示成 2.，那是篡改语义。
  var LEAD_MARK = /^([（(][0-9一二三四五六七八九十]{1,3}[）)]|[一二三四五六七八九十]{1,3}、|[0-9]{1,3}[.、](?=[\u3400-\u4dbf\u4e00-\u9fff])|【[^】\n]{1,40}】)/

  function parseAttrs(s) {
    var o = {}
    var m
    KB_ATTR.lastIndex = 0
    while ((m = KB_ATTR.exec(s))) o[m[1]] = m[2]
    return o
  }

  function inline(t) {
    // 先把 ![图](地址) / **加粗** / `代码` / [文字](链接) / 裸链接 抠出来
    var re = /(!\[[^\]\n]*\]\([^)\s]+\)|\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]*\]\([^)\s]+\))/g
    var parts = []
    var last = 0
    var m

    function plainText(chunk) {
      // <br> 先按硬换行切
      var segs = []
      var cut0 = 0
      BR_RE.lastIndex = 0
      var bm
      while ((bm = BR_RE.exec(chunk))) {
        segs.push(chunk.slice(cut0, bm.index))
        segs.push(null) // null = 换行
        cut0 = bm.index + bm[0].length
      }
      segs.push(chunk.slice(cut0))

      segs.forEach(function (seg) {
        if (seg === null) { parts.push(h('br', { key: 'br' + (key++) })); return }
        if (!seg) return
        // 裸链接：笔记里经常直接贴 URL（实测有些还和前后汉字粘在一起，只能尽力切）
        URL_RE.lastIndex = 0
        var cut = 0
        var mm
        while ((mm = URL_RE.exec(seg))) {
          if (mm.index > cut) parts.push(seg.slice(cut, mm.index))
          parts.push(h('a', { key: 'a' + (key++), href: mm[0], target: '_blank', rel: 'noreferrer' }, mm[0]))
          cut = mm.index + mm[0].length
        }
        if (cut < seg.length) parts.push(seg.slice(cut))
      })
    }

    function plain(chunk) {
      // 出处标记切成可点角标，其余照常
      var cut = 0
      var km
      KB_ALL.lastIndex = 0
      while ((km = KB_ALL.exec(chunk))) {
        if (km.index > cut) plainText(chunk.slice(cut, km.index))
        var kv = parseAttrs(km[1])
        var cid = kv.chunk_id || kv.doc || ('x' + km.index)
        var n = citeIndex[cid]
        if (!n) { n = ++citeOrder; citeIndex[cid] = n }
        var after = km.index + km[0].length
        // 角标紧跟在句末时，把句读挪到角标前面，免得句号被挤到下一行
        var punct = /^[。，、；：！？)]/.exec(chunk.slice(after))
        if (punct) { parts.push(punct[0]); after += punct[0].length }
        ;(function (kv2, n2) {
          parts.push(h('button', {
            key: 'cite' + (key++),
            className: 'dsh-ima-cite',
            title: (kv2.doc ? '《' + kv2.doc + '》' : '出处') + ' · 点开看原文',
            onClick: function (e) {
              e.stopPropagation()
              if (opts.onCite) opts.onCite(kv2)
            },
          }, String(n2)))
        })(kv, n)
        cut = after
      }
      if (cut < chunk.length) plainText(chunk.slice(cut))
    }

    while ((m = re.exec(t))) {
      if (m.index > last) plain(t.slice(last, m.index))
      var tok = m[0]
      if (tok.slice(0, 2) === '![') {
        var im = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(tok)
        parts.push(h('img', {
          key: 'img' + (key++),
          className: 'dsh-ima-img',
          src: im ? im[2] : '',
          alt: (im && im[1]) || '图片',
          loading: 'lazy',
        }))
      } else if (tok.slice(0, 2) === '**') parts.push(h('strong', { key: 'b' + (key++) }, tok.slice(2, -2)))
      else if (tok.charAt(0) === '`') parts.push(h('code', { key: 'c' + (key++) }, tok.slice(1, -1)))
      else {
        var mm2 = /^\[([^\]]*)\]\(([^)\s]+)\)$/.exec(tok)
        parts.push(h('a', { key: 'k' + (key++), href: mm2[2], target: '_blank', rel: 'noreferrer' }, mm2[1] || mm2[2]))
      }
      last = m.index + tok.length
    }
    if (last < t.length) plain(t.slice(last))
    if (!parts.length) return t
    return parts
  }

  function flushList() {
    if (!listBuf.length) return
    out.push(h('ul', { key: 'u' + (key++) },
      listBuf.map(function (t, i) { return h('li', { key: i }, inline(t)) })))
    listBuf = []
  }

  /** 段首的序号标记加粗，其余照旧 */
  function para(line) {
    var m = LEAD_MARK.exec(line)
    if (!m) return inline(line)
    var rest = line.slice(m[0].length)
    return [h('strong', { key: 'm' + (key++) }, m[0])].concat(rest ? inline(rest) : [])
  }

  function splitRow(line) {
    var t = line.trim().replace(/^\|/, '').replace(/\|$/, '')
    return t.split('|').map(function (s) { return s.trim() })
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    var m
    // GFM 表格：表头 + 分隔行 + 若干数据行
    if (/^\s*\|.*\|\s*$/.test(line)
      && i + 1 < lines.length
      && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])
      && /-/.test(lines[i + 1])) {
      flushList()
      var head = splitRow(line)
      var rows = []
      var j = i + 2
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) { rows.push(splitRow(lines[j])); j++ }
      out.push(h('table', { key: 't' + (key++) },
        h('thead', { key: 'th' }, h('tr', { key: 'tr' },
          head.map(function (c, ci) { return h('th', { key: ci }, inline(c)) }))),
        h('tbody', { key: 'tb' },
          rows.map(function (r, ri) {
            return h('tr', { key: ri },
              r.map(function (c, ci) { return h('td', { key: ci }, inline(c)) }))
          }))))
      i = j - 1
      continue
    }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flushList()
      out.push(h('h' + m[1].length, { key: 'h' + (key++) }, inline(m[2])))
    } else if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushList()
      out.push(h('hr', { key: 'r' + (key++) }))
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flushList()
      out.push(h('blockquote', { key: 'q' + (key++) }, inline(m[1])))
    } else if (/^(发言人|说话人|说话者|Speaker)\s*\d{1,2}\s+\d{1,2}:\d{2}$/i.test(line.trim())) {
      flushList()
      out.push(h('div', { key: 's' + (key++) }, h('span', { className: 'dsh-ima-spk' }, line.trim())))
    } else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
      // 真 Markdown 的项目符号（.md 类文件才有，展平后的笔记不会有）
      listBuf.push(m[1])
    } else if (line.trim() === '') {
      flushList()
    } else {
      flushList()
      out.push(h('p', { key: 'p' + (key++) }, para(line)))
    }
  }
  flushList()
  return h('div', { className: 'dsh-ima-md' }, out)
}

// ── 预览挂载器（真正用 open-file-viewer 渲染） ────────────
// 引擎认不出的格式（比如 PDF —— 我们没打 pdfPlugin，它有 Node 原生依赖）
// 自动退回浏览器原生 iframe，不让用户看到空白
