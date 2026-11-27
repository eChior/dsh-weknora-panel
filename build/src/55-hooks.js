/** 面板的唯一状态容器。
 *
 *  本来按「数据 / 预览」拆成两个 hook，试过之后发现它们共享得太深：加载列表时要清预览、
 *  检索要用当前库、上传后要按检索词刷新 —— 拆开只能靠层层传参或隐式全局，反而更难懂。
 *  现在合成一个 usePanelState()，好处是 WeKnoraPage 仍然只做渲染，改动也只发生在这里。
 */
function usePanelState() {

  var st = React.useState(null); var status = st[0], setStatus = st[1]
  var ks = React.useState([]); var kbs = ks[0], setKbs = ks[1]
  var cs = React.useState(null); var curKb = cs[0], setCurKb = cs[1]
  var is = React.useState([]); var items = is[0], setItems = is[1]
  var ls = React.useState(false); var loading = ls[0], setLoading = ls[1]
  var es = React.useState(''); var error = es[0], setError = es[1]
  var fds = React.useState([]); var folders = fds[0], setFolders = fds[1]
  var cfd = React.useState('__all__'); var curFolder = cfd[0], setCurFolder = cfd[1]
  var ups = React.useState([]); var uploads = ups[0], setUploads = ups[1]
  var us = React.useState(null); var updatedAt = us[0], setUpdatedAt = us[1]
  var ags = React.useState([]); var agents = ags[0], setAgents = ags[1]
  var aid = React.useState('builtin-quick-answer'); var agentId = aid[0], setAgentId = aid[1]
  var fileRef = React.useRef(null)
  var msg = function (e) { return String((e && e.message) || e) }

  var refreshStatus = function () {
    return api('/status').then(function (s) {
      setStatus(s)
      if (!s || !s.configured) { setKbs([]); setCurKb(null); setItems([]); setPreview(null); setHits([]) }
      return s
    }).catch(function (e) { setError(msg(e)) })
  }
  var loadKbs = function () {
    setLoading(true); setError('')
    return api('/knowledgeBases').then(function (r) {
      if (!r || !r.ok) { setError((r && r.message) || '取不到知识库列表'); return }
      var list = (r && r.knowledgeBases) || []
      setKbs(list); setUpdatedAt(new Date())
      // 没选库就默认选第一个，右侧知识库区不至于空着
      if (list.length && !curKb) {
        setCurKb(list[0])
        loadFolders(list[0])
        loadFiles(list[0], keyword, '__all__')
      }
    }).catch(function (e) { setError(msg(e)) })
      .then(function () { setLoading(false) })
  }
  var loadAgents = function () {
    return api('/agents').then(function (r) {
      if (r && r.ok && r.agents && r.agents.length) {
        setAgents(r.agents)
        var has = r.agents.some(function (a) { return a.id === agentId })
        if (!has) setAgentId(r.defaultAgentId || r.agents[0].id)
      }
    }).catch(function () { /* 拿不到就用内置快速问答 */ })
  }
  var loadFolders = function (kb) {
    if (!kb) { setFolders([]); return Promise.resolve() }
    return api('/folders?kbId=' + encodeURIComponent(kb.id)).then(function (r) {
      setFolders((r && r.ok && r.folders) || [])
    }).catch(function () { setFolders([]) })
  }
  var folderQuery = function (fp) {
    if (fp === '__all__') return ''
    return '&folderPath=' + encodeURIComponent(fp === '__root__' ? '' : fp)
  }
  var loadFiles = function (kb, kw, fp) {
    if (!kb) return
    var useFp = fp === undefined ? curFolder : fp
    setLoading(true); setError(''); setPreview(null); setHits([]); setDetail(null)
    return api('/files?kbId=' + encodeURIComponent(kb.id)
      + '&keyword=' + encodeURIComponent(kw || '')
      + folderQuery(useFp)
      + '&page=1&pageSize=100').then(function (r) {
        if (!r || !r.ok) { setError((r && r.message) || '取不到文件列表'); return }
        setItems(r.items || []); setUpdatedAt(new Date())
      }).catch(function (e) { setError(msg(e)) })
      .then(function () { setLoading(false) })
  }

  var patchUpload = function (key, patch) {
    setUploads(function (prev) {
      return prev.map(function (u) { return u.key === key ? Object.assign({}, u, patch) : u })
    })
  }
  var PARSE_TEXT = {
    pending: '排队中', processing: '解析中', finalizing: '收尾中（摘要/问题生成）',
    completed: '已入库', failed: '解析失败', cancelled: '已取消',
  }
  // 上传只是把字节交给 WeKnora，解析是后台异步的。这里按 /file?id= 轮询状态，
  // 让用户看到走到哪一步，失败时能直接看到 error_message（不用回 WeKnora 网页端查）。
  var trackParse = function (key, kid) {
    var tick = 0
    var step = function () {
      tick++
      api('/file?id=' + encodeURIComponent(kid)).then(function (r) {
        var f = (r && r.file) || r || {}
        var st = String(f.parse_status || '')
        if (st === 'failed' || st === 'cancelled') {
          patchUpload(key, { status: 'error', stage: st, err: f.error_message || PARSE_TEXT[st] || '解析失败' })
        } else if (st === 'completed') {
          patchUpload(key, { status: 'done', stage: 'completed' })
        } else {
          patchUpload(key, { status: 'parsing', stage: st || 'pending' })
        }
        var over = st === 'completed' || st === 'failed' || st === 'cancelled'
        if (over || tick > 60) {
          if (curKb) loadFiles(curKb, keyword, curFolder)
          return
        }
        window.setTimeout(step, 3000)
      }).catch(function () {
        if (tick <= 3) window.setTimeout(step, 3000)
      })
    }
    window.setTimeout(step, 2000)
  }
  var doUpload = function (fileList) {
    if (!curKb || !fileList || !fileList.length) return
    var arr = Array.prototype.slice.call(fileList)
    arr.forEach(function (f) {
      var key = f.name + '|' + Date.now() + '|' + Math.random()
      setUploads(function (prev) { return prev.concat([{ key: key, name: f.name, pct: 0, status: 'uploading' }]) })
      var xhr = new XMLHttpRequest()
      xhr.open('POST', API + '/upload?kbId=' + encodeURIComponent(curKb.id)
        + '&name=' + encodeURIComponent(f.name)
        + folderQuery(curFolder))
      xhr.upload.onprogress = function (ev) {
        if (ev.lengthComputable) patchUpload(key, { pct: Math.round(ev.loaded / ev.total * 100) })
      }
      xhr.onload = function () {
        var r = null
        try { r = JSON.parse(xhr.responseText) } catch (e) {}
        if (xhr.status >= 200 && xhr.status < 300 && r && r.ok) {
          var f = (r && (r.file || r.data)) || r || {}
          var kid = f.id || f.knowledge_id || ''
          patchUpload(key, { status: 'parsing', pct: 100, stage: f.parse_status || 'pending', kid: kid })
          if (kid) trackParse(key, kid)
        } else {
          patchUpload(key, { status: 'error', err: (r && r.message) || ('HTTP ' + xhr.status) })
        }
      }
      xhr.onerror = function () { patchUpload(key, { status: 'error', err: '网络错误' }) }
      xhr.send(f)
    })
    // 传完等解析入口建好再刷一次列表（解析本身是后台异步的）
    window.setTimeout(function () {
      if (curKb) { loadFiles(curKb, keyword, curFolder); loadFolders(curKb) }
    }, 1500)
  }
  React.useEffect(function () { refreshStatus(); loadAgents() }, [])
  React.useEffect(function () {
    if (status && status.configured) loadKbs()
  }, [status && status.configured])

  var vs = React.useState(null); var preview = vs[0], setPreview = vs[1]
  var hs = React.useState([]); var hits = hs[0], setHits = hs[1]
  var qs = React.useState(''); var query = qs[0], setQuery = qs[1]
  var kws = React.useState(''); var keyword = kws[0], setKeyword = kws[1]
  var ss = React.useState(false); var showSetup = ss[0], setShowSetup = ss[1]
  var ds = React.useState(null); var detail = ds[0], setDetail = ds[1]
  var tb = React.useState('files'); var tab = tb[0], setTab = tb[1]
  var ob = React.useState(true); var officeOn = ob[0], setOfficeOn = ob[1]
  // 不再读 sessionStorage 做「面板挂载后补跳」—— 那会让每次打开知识库面板都被上一次
  // 点过的角标劫持，把用户正在看的文件顶掉。
  React.useEffect(function () {
    var onCite = function (e) { showCite(e && e.detail) }
    window.addEventListener('dsh-weknora:open-cite', onCite)
    return function () { window.removeEventListener('dsh-weknora:open-cite', onCite) }
  }, [])

  // 命中段滚到视野中间
  React.useEffect(function () {
    if (!preview || !preview.focusId) return
    var el = document.querySelector('.dsh-wk-main .dsh-wk-hl')
    if (el) {
      try { scrollIntoBox(el, 'center') } catch (e2) { /* 忽略 */ }
    }
  }, [preview && preview.focusId])

  var openFile = function (item) {
    setLoading(true); setError(''); setHits([]); setDetail(null)
    return api('/file?id=' + encodeURIComponent(item.id)).then(function (r) {
      if (!r || !r.ok) { setError((r && r.message) || '取不到文件详情'); return null }
      var f = r.file || item
      var kind = previewKindOf(f)
      if (kind === 'text') {
        var kbForText = (curKb && curKb.id) || f.knowledge_base_id || ''
        return api('/text?id=' + encodeURIComponent(f.id)
          + '&kbId=' + encodeURIComponent(kbForText)).then(function (t) {
          setPreview({
            file: f,
            kind: 'text',
            content: (t && t.content) || '',
            chunks: (t && t.chunks) || 0,
          })
        })
      }
      setPreview({ file: f, kind: kind, content: '' })
    }).catch(function (e) { setError(msg(e)) })
      .then(function () { setLoading(false) })
  }

  /** 会话里点了角标：打开整篇原文，并把命中的那一段标黄（同文件跳页、不同文件直接切） */
  var showCite = function (detail) {
    var cid = String((detail && detail.chunkId) || '')
    if (!cid) return null
    setError(''); setHits([]); setDetail(null); setLoading(true)
    return api('/chunk?id=' + encodeURIComponent(cid)).then(function (r) {
      if (!r || !r.ok) { setError((r && r.message) || '取不到这段原文'); return null }
      var kid = r.knowledge_id || ''
      var kbId = r.knowledge_base_id || (curKb && curKb.id) || ''
      var chunkText = String(r.content || '')
      // 三个请求并行：文件详情（判断是不是 Office）、命中页码、整篇分块
      return Promise.all([
        api('/file?id=' + encodeURIComponent(kid)).catch(function () { return null }),
        api('/pdfpage?id=' + encodeURIComponent(kid) + '&chunk=' + encodeURIComponent(cid)).catch(function () { return null }),
        api('/text?id=' + encodeURIComponent(kid) + '&kbId=' + encodeURIComponent(kbId)).catch(function () { return null }),
      ]).then(function (arr) {
        var fr = arr[0]
        var pr = arr[1]
        var t = arr[2]
        var file = (fr && fr.ok && fr.file) || {}
        var items = (t && (t.items || t.chunks)) || []
        if (!Array.isArray(items)) items = []
        setPreview({
          file: {
            id: kid,
            title: file.title || file.file_name || (detail && detail.doc) || '',
            file_name: file.file_name || (detail && detail.doc) || '',
            file_type: file.file_type || '',
            knowledge_base_id: kbId,
          },
          kind: 'text',
          content: (t && t.content) || '',
          chunks: items.length,
          items: items,
          focusId: cid,
          // 原件模式用：命中段原文（标黄）+ 所在页（跳页）
          focusContent: chunkText,
          page: (pr && pr.ok && Number(pr.page)) || 0,
        })
      })
    }).catch(function (e) { setError(msg(e)) })
      .then(function () { setLoading(false) })
  }

  /** 检索：有选中库就单库，否则跨库 */
  var doSearch = function () {
    var q = String(query || '').trim()
    if (!q) return
    setLoading(true); setError(''); setPreview(null)
    return api('/search?q=' + encodeURIComponent(q)
      + (curKb ? '&kbId=' + encodeURIComponent(curKb.id) : '')
      + '&matchCount=10').then(function (r) {
        if (!r || !r.ok) { setError((r && r.message) || '检索失败'); return }
        setHits(r.results || [])
      }).catch(function (e) { setError(msg(e)) })
      .then(function () { setLoading(false) })
  }

  var quoteFile = function (f) {
    sendToConversation('请读取我 WeKnora 知识库中的文件：' + (f.title || f.file_name)
      + '（knowledge_id: ' + f.id + '）')
  }
  var quoteHit = function (hit) {
    var body = snippet(hit.matched_content || hit.content, 600)
    sendToConversation('【' + (hit.knowledge_title || '知识库片段') + '】\\n'
      + body + '\\n—— WeKnora 知识库')
  }
  var openInWeKnora = function (kb) {
    try { window.open((status && status.webUrl) || (status && status.baseUrl) || '', '_blank', 'noopener') } catch (e) {}
  }
  // ── 预览区 ──
  var previewExt = preview && preview.file ? extOf(preview.file) : ''
  var previewIsOffice = !!(previewExt && OFFICE_TYPES[previewExt])
  // 表格类不走 PDF：LibreOffice 转出来的表格 PDF 没有列宽与分页可言，读起来是灾难。
  // DSH 自己就能打开 Excel，这里只负责把文件交出去（下载 / 在 DSH 里打开）。
  var previewIsSheet = /^(xls|xlsx|xlsm|ods|csv)$/.test(previewExt || '')
  var previewIsWord = /^(doc|docx|docm|odt|rtf)$/.test(previewExt || '')
  var previewBody = null
  if (preview) {
    if (preview.kind === 'text') {
      // Office 文档默认走「原件」：宿主用 DSH 自带的 LibreOffice 套件把它转成 PDF，
      // 和右侧栏用同一个 pdfjs 渲染器：连续滚动翻页，滚轮就是翻页。
      // 换成 iframe 会带上浏览器自带的「上一页/下一页」工具条，样式也不一致。
      if (previewIsSheet || previewIsWord) {
        // Excel 走 SheetView（xlsx 解析成真表格），Word 走 DocxView（docx-preview 保留排版），
        // 都不再先转 PDF —— 转出来的表格/Word 丢了列宽和分页，看着像截图。
        previewBody = fileView({
          id: preview.file.id || '',
          kbId: preview.file.knowledge_base_id || (curKb && curKb.id) || '',
          name: preview.file.title || preview.file.file_name || preview.file.id,
          ext: previewExt,
          page: preview.page || 1,
          needle: preview.focusContent || '',
        })
      } else if (previewIsOffice && officeOn) {
        // 和右侧栏用同一个阅读器（paper-reader 的 pdf.js 页面）：
        // 缩放、翻页、搜索、命中跳页都在里面，比浏览器原生 PDF 多出黄块定位。
        previewBody = fileView({
          id: preview.file.id || '',
          kbId: preview.file.knowledge_base_id || (curKb && curKb.id) || '',
          name: preview.file.title || preview.file.file_name || preview.file.id,
          ext: previewExt,
          page: preview.page || 1,
          needle: preview.focusContent || '',
        })
      } else {
        previewBody = h('div', { className: 'dsh-wk-pre' },
          (preview.items && preview.items.length)
            ? preview.items.map(function (c, i) {
              var hit = preview.focusId && c.id === preview.focusId
              return h('div', {
                className: 'dsh-wk-chunk' + (hit ? ' dsh-wk-hl' : ''),
                key: c.id || ('p' + i),
              }, renderMarkdown(fixResourceUrls(c.content || '', preview.kbId || (curKb && curKb.id))))
            })
            : renderMarkdown(fixResourceUrls(preview.content || '（没有可读正文）', preview.kbId || (curKb && curKb.id))))
      }
    } else if (preview.kind === 'viewer') {
      previewBody = h(ViewerBox, {
        source: API + '/content?id=' + encodeURIComponent(preview.file.id),
        fileName: fileNameForFile(preview.file),
      })
    } else {
      previewBody = h('div', { className: 'dsh-wk-note', style: { marginTop: '12px' } },
        '这个格式没法内联预览，点「下载原件」拿原文件。')
    }
  }

  return {
    // 数据
    status: status, kbs: kbs, curKb: curKb, items: items, loading: loading, error: error,
    folders: folders, curFolder: curFolder, uploads: uploads, agents: agents, agentId: agentId, fileRef: fileRef,
    updatedAt: updatedAt, setUpdatedAt: setUpdatedAt, msg: msg, PARSE_TEXT: PARSE_TEXT,
    setCurKb: setCurKb, setItems: setItems, setCurFolder: setCurFolder, setUploads: setUploads,
    setLoading: setLoading, setError: setError, setKbs: setKbs, setFolders: setFolders,
    refreshStatus: refreshStatus, loadKbs: loadKbs, loadAgents: loadAgents,
    loadFolders: loadFolders, loadFiles: loadFiles, patchUpload: patchUpload,
    trackParse: trackParse, doUpload: doUpload,
    // 预览与检索
    preview: preview, hits: hits, query: query, keyword: keyword,
    showSetup: showSetup, detail: detail, tab: tab, officeOn: officeOn,
    setPreview: setPreview, setHits: setHits, setQuery: setQuery, setKeyword: setKeyword,
    setShowSetup: setShowSetup, setDetail: setDetail, setTab: setTab, setOfficeOn: setOfficeOn,
    openFile: openFile, showCite: showCite, doSearch: doSearch,
    quoteFile: quoteFile, quoteHit: quoteHit, openInWeKnora: openInWeKnora,
    previewExt: previewExt, previewIsOffice: previewIsOffice,
    previewIsSheet: previewIsSheet, previewBody: previewBody,
  }
}
