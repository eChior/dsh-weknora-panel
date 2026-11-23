// 主面板 WeKnoraPage
// 由 build/src 拼接后注入 factory，和同目录其它片段共享作用域（不要加 import/export）。
function WeKnoraPage(props) {
  var panelActive = !props || props.active !== false
  var st = React.useState(null); var status = st[0], setStatus = st[1]
  var ks = React.useState([]); var kbs = ks[0], setKbs = ks[1]
  var cs = React.useState(null); var curKb = cs[0], setCurKb = cs[1]
  var is = React.useState([]); var items = is[0], setItems = is[1]
  var ls = React.useState(false); var loading = ls[0], setLoading = ls[1]
  var es = React.useState(''); var error = es[0], setError = es[1]
  var vs = React.useState(null); var preview = vs[0], setPreview = vs[1]
  var hs = React.useState([]); var hits = hs[0], setHits = hs[1]
  var qs = React.useState(''); var query = qs[0], setQuery = qs[1]
  var kws = React.useState(''); var keyword = kws[0], setKeyword = kws[1]
  var us = React.useState(null); var updatedAt = us[0], setUpdatedAt = us[1]
  var ss = React.useState(false); var showSetup = ss[0], setShowSetup = ss[1]
  var ds = React.useState(null); var detail = ds[0], setDetail = ds[1]
  var tb = React.useState('files'); var tab = tb[0], setTab = tb[1]
  // Office 文档默认用原件（宿主 LibreOffice 转 PDF）展示，切换「看文本」时才用分块正文
  var ob = React.useState(true); var officeOn = ob[0], setOfficeOn = ob[1]
  // 分组：'__all__' 全部 / '__root__' 未分组的根目录 / 其它为 folder_path
  var fds = React.useState([]); var folders = fds[0], setFolders = fds[1]
  var cfd = React.useState('__all__'); var curFolder = cfd[0], setCurFolder = cfd[1]
  var ups = React.useState([]); var uploads = ups[0], setUploads = ups[1]
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

  // 只有右侧栏打不开时，才由事件把面板切到原文（bindCiteLinks 里的兜底路径）。
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
    var el = document.querySelector('.dsh-ima-main .dsh-ima-hl')
    if (el && el.scrollIntoView) {
      try { el.scrollIntoView({ block: 'center' }) } catch (e2) { /* 老浏览器忽略 */ }
    }
  }, [preview && preview.focusId])

  /** 点文件：先拿详情，文本类再拿分块全文 */
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

  // ── 未配置 ──
  if (!status || !status.configured) {
    return h('div', { className: 'dsh-ima-root' },
      h('div', { className: 'dsh-ima-head' },
        h('span', { className: 'dsh-ima-title' }, '知识库 WeKnora'),
        h('span', { className: 'dsh-ima-spacer' }),
        h('button', { className: 'dsh-ima-ibtn', title: '重新检测配置', onClick: refreshStatus }, h(RefreshIcon)),
      ),
      h('div', { className: 'dsh-ima-body' },
        h('div', { className: 'dsh-ima-center' },
          h(SetupDialog, {
            status: status,
            error: error,
            onSaved: function () { setError(''); refreshStatus() },
          }),
        ),
      ),
    )
  }

  // ── 预览区 ──
  var previewExt = preview && preview.file ? extOf(preview.file) : ''
  var previewIsOffice = !!(previewExt && OFFICE_TYPES[previewExt])
  // 表格类不走 PDF：LibreOffice 转出来的表格 PDF 没有列宽与分页可言，读起来是灾难。
  // DSH 自己就能打开 Excel，这里只负责把文件交出去（下载 / 在 DSH 里打开）。
  var previewIsSheet = /^(xls|xlsx|xlsm|ods|csv)$/.test(previewExt || '')
  var previewBody = null
  if (preview) {
    if (preview.kind === 'text') {
      // Office 文档默认走「原件」：宿主用 DSH 自带的 LibreOffice 套件把它转成 PDF，
      // 和右侧栏用同一个 pdfjs 渲染器：连续滚动翻页，滚轮就是翻页。
      // 换成 iframe 会带上浏览器自带的「上一页/下一页」工具条，样式也不一致。
      if (previewIsSheet) {
        previewBody = h('div', { className: 'dsh-ima-note dsh-ima-sheetnote' },
          h('div', null, '表格文件不在面板里渲染（PDF 化会丢列宽，还不如 DSH 自己的表格预览）。'),
          h('div', { className: 'dsh-ima-sheetrow' },
            h('button', { className: 'dsh-ima-btn', onClick: function () { downloadOriginal(preview.file.id, preview.file.file_name || preview.file.title) } }, '下载原件'),
            h('button', { className: 'dsh-ima-btn', onClick: function () { sendToConversation('请打开这个表格文件：' + (preview.file.title || preview.file.file_name || '')) } }, '交给对话')))
      } else if (previewIsOffice && officeOn) {
        previewBody = h('div', { className: 'dsh-ima-nos' },
          h(PdfView, {
            id: preview.file.id,
            page: preview.page || 0,
            needle: preview.focusContent || '',
          }))
      } else {
        previewBody = h('div', { className: 'dsh-ima-pre' },
          (preview.items && preview.items.length)
            ? preview.items.map(function (c, i) {
              var hit = preview.focusId && c.id === preview.focusId
              return h('div', {
                className: 'dsh-ima-chunk' + (hit ? ' dsh-ima-hl' : ''),
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
      previewBody = h('div', { className: 'dsh-ima-note', style: { marginTop: '12px' } },
        '这个格式没法内联预览，点「下载原件」拿原文件。')
    }
  }

  return h('div', { className: 'dsh-ima-root' },
    h('div', { className: 'dsh-ima-head' },
      h('span', { className: 'dsh-ima-title' }, '知识库 WeKnora'),
      h('span', { className: 'dsh-ima-badge' }, (kbs.length || 0) + ' 个库'),
      h('span', { className: 'dsh-ima-spacer' }),
      updatedAt ? h('span', { className: 'dsh-ima-stamp' }, '更新于 ' + fmtTime(updatedAt)) : null,
      curKb ? h('button', {
        className: 'dsh-ima-ibtn', title: '上传文件到当前分组',
        onClick: function () { if (fileRef.current) fileRef.current.click() },
      }, h('span', { style: { fontSize: '16px', lineHeight: 1 } }, '＋')) : null,
      h('input', {
        type: 'file', multiple: true, ref: fileRef,
        style: { display: 'none' },
        onChange: function (ev) { doUpload(ev.target.files); ev.target.value = '' },
      }),
      h('button', { className: 'dsh-ima-ibtn', onClick: function () { loadKbs() }, title: '重新获取知识库列表' }, h(RefreshIcon)),
      h('button', { className: 'dsh-ima-ibtn', onClick: function () { setShowSetup(!showSetup) }, title: '连接设置' }, h('span', { style: { fontSize: '15px' } }, '⚙')),
    ),
    error ? h('div', { className: 'dsh-ima-err' }, error) : null,
    uploads.length ? h('div', { className: 'dsh-ima-up' },
      h('div', { className: 'dsh-ima-up-h' },
        h('span', null, '上传 / 解析 · ' + uploads.filter(function (u) { return u.status === 'done' }).length + ' / ' + uploads.length),
        h('button', { className: 'dsh-ima-x', onClick: function () { setUploads([]) } }, '✕'),
      ),
      uploads.map(function (u) {
        return h('div', { key: u.key, className: 'dsh-ima-up-item' },
          h('div', { className: 'dsh-ima-up-name' },
            h('span', { className: 'dsh-ima-up-t' }, u.name),
            h('span', { className: 'dsh-ima-up-s' },
              u.status === 'done' ? '已入库'
                : (u.status === 'error' ? (u.err || '失败')
                  : (u.status === 'parsing' ? (PARSE_TEXT[u.stage] || '解析中') : u.pct + '%'))),
          ),
          h('div', { className: 'dsh-ima-up-bar' },
            h('div', {
              className: 'dsh-ima-up-fill' + (u.status === 'error' ? ' dsh-ima-up-fill-err' : ''),
              style: { width: (u.status === 'done' ? 100 : u.pct) + '%' },
            }),
          ),
        )
      }),
    ) : null,
    h('div', { className: 'dsh-ima-body' },
      // 左：知识库
      h('div', { className: 'dsh-ima-kbs' },
        kbs.length === 0 && !loading ? h('div', { className: 'dsh-ima-note' }, '没有知识库') : null,
        kbs.map(function (kb) {
          return h('div', {
            key: kb.id,
            className: 'dsh-ima-kb' + (curKb && curKb.id === kb.id ? ' dsh-ima-kb-on' : ''),
            title: (kb.description ? kb.description + '\\n' : '')
              + (kb.knowledge_count || 0) + ' 个文件 · ' + (kb.chunk_count || 0) + ' 个分块',
            onClick: function () {
              setCurKb(kb); setDetail(null); setCurFolder('__all__')
              loadFolders(kb); loadFiles(kb, keyword, '__all__')
            },
          },
            h(KbIcon, { size: 18 }),
            h('span', { className: 'dsh-ima-kb-name' }, kb.name),
            kb.knowledge_count ? h('span', { className: 'dsh-ima-item-y' }, String(kb.knowledge_count)) : null,
          )
        }),
        curKb && folders && folders.length
          ? h('div', { className: 'dsh-ima-folds' },
            h('div', { className: 'dsh-ima-fold-h' }, '分组'),
            h('div', {
              className: 'dsh-ima-fold' + (curFolder === '__all__' ? ' dsh-ima-fold-on' : ''),
              onClick: function () { setCurFolder('__all__'); loadFiles(curKb, keyword, '__all__') },
            }, h(FolderGlyph, { size: 13 }), h('span', { className: 'dsh-ima-fold-t' }, '全部')),
            folders.map(function (fo) {
              return h('div', {
                key: fo.path,
                className: 'dsh-ima-fold' + (curFolder === fo.path ? ' dsh-ima-fold-on' : ''),
                title: fo.path,
                onClick: function () { setCurFolder(fo.path); loadFiles(curKb, keyword, fo.path) },
              },
                h(FolderGlyph, { size: 13 }),
                h('span', { className: 'dsh-ima-fold-t' }, fo.name || fo.path),
                h('span', { className: 'dsh-ima-item-y' }, String(fo.document_count || 0)),
              )
            }),
          )
          : null,
      ),
      // 右：检索 / 预览 / 文件列表
      h('div', { className: 'dsh-ima-main' },
        h('div', { className: 'dsh-ima-crumb' },
          h('input', {
            className: 'dsh-ima-input',
            value: query,
            placeholder: curKb ? '在这个库里搜…' : '在所有库里搜…',
            onChange: function (e) { setQuery(e.target.value) },
            onKeyDown: function (e) { if (e.key === 'Enter') doSearch() },
          }),
          h('button', { className: 'dsh-ima-btn dsh-ima-btn-p', onClick: doSearch, disabled: !query.trim() }, '检索'),
          h('span', { className: 'dsh-ima-spacer' }),
          curKb ? h('button', {
            className: 'dsh-ima-btn',
            title: '在 WeKnora 网页版打开',
            onClick: function () { openInWeKnora(curKb) },
          }, h(ExternalGlyph), '打开 WeKnora') : null,
        ),

        hits.length > 0
          ? h('div', { key: 'hits', style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
              h('div', { className: 'dsh-ima-crumb' },
                h('button', { className: 'dsh-ima-btn', onClick: function () { setHits([]) } }, '返回列表'),
                h('span', { style: { flex: 1 } }, '检索命中 ' + hits.length + ' 条'),
              ),
              h('div', { style: { overflow: 'auto', flex: 1 } },
                hits.map(function (hit, i) {
                  return h('div', { key: hit.id || i, className: 'dsh-ima-hit' },
                    h('div', { className: 'dsh-ima-hit-h' },
                      h('span', { className: 'dsh-ima-item-t', title: hit.knowledge_title }, hit.knowledge_title || '未命名'),
                      hit.knowledge_base_id ? h('span', { className: 'dsh-ima-item-y' }, hit.knowledge_filename || '') : null,
                      h('span', { className: 'dsh-ima-item-y' }, '相关度 ' + (Number(hit.score) || 0).toFixed(2)),
                    ),
                    h('div', { className: 'dsh-ima-hit-b' }, snippet(hit.matched_content || hit.content, 420)),
                    h('div', { className: 'dsh-ima-act' },
                      h('button', { className: 'dsh-ima-actbtn dsh-ima-actbtn-p', onClick: function () { quoteHit(hit) } },
                        h(QuoteGlyph), '引用到对话'),
                      h('button', {
                        className: 'dsh-ima-actbtn',
                        onClick: function () {
                          var f = { id: hit.knowledge_id, title: hit.knowledge_title, file_name: hit.knowledge_filename, file_type: '' }
                          openFile(f)
                        },
                      }, '读全文'),
                    ),
                  )
                }),
              ),
            )
          : preview
            ? h('div', { key: 'pv', style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
                h('div', { className: 'dsh-ima-crumb' },
                  h('button', { className: 'dsh-ima-btn', onClick: function () { setPreview(null) } }, '返回列表'),
                  h('span', {
                    style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, minWidth: 0 },
                    title: preview.file.file_name || preview.file.title,
                  }, preview.file.title || preview.file.file_name),
                  preview.file.parse_status ? h(StatusTag, { status: preview.file.parse_status }) : null,
                  previewIsOffice
                    ? h('button', {
                      className: 'dsh-ima-btn' + (officeOn ? ' dsh-ima-actbtn-on' : ''),
                      title: officeOn ? '切到分块文本（可选中复制）' : '切到原件排版',
                      onClick: function () { setOfficeOn(!officeOn) },
                    }, officeOn ? '看文本' : '看原件')
                    : null,
                  h('button', {
                    className: 'dsh-ima-btn',
                    onClick: function () {
                      downloadOriginal(preview.file.id, preview.file.file_name || preview.file.title)
                    },
                  }, '下载原件'),
                  h('button', {
                    className: 'dsh-ima-btn dsh-ima-btn-p',
                    title: '把它交给对话里的 agent 读取',
                    onClick: function () { quoteFile(preview.file) },
                  }, h(QuoteGlyph), '引用到对话'),
                ),
                preview.file.error_message
                  ? h('div', { className: 'dsh-ima-err', style: { marginBottom: '8px' } }, '解析失败：' + preview.file.error_message)
                  : null,
                preview.file.description
                  ? h('div', { className: 'dsh-ima-note', style: { marginBottom: '8px' } }, preview.file.description)
                  : null,
                (preview.file.profile && preview.file.profile.gist)
                  ? h('div', { className: 'dsh-ima-gist' }, preview.file.profile.gist)
                  : null,
                (preview.file.profile && preview.file.profile.topics && preview.file.profile.topics.length)
                  ? h('div', { className: 'dsh-ima-tags' },
                      preview.file.profile.topics.map(function (t, i) {
                        return h('span', { key: i, className: 'dsh-ima-chip' }, t)
                      }))
                  : null,
                previewBody,
                preview.kind === 'text' && !(previewIsOffice && officeOn)
                  ? h('div', { className: 'dsh-ima-stamp', style: { marginTop: '8px' } },
                      OFFICE_TYPES[extOf(preview.file)]
                        ? 'WeKnora 已把该文档解析成文本，上面是 ' + (preview.chunks || 0) + ' 个分块拼出的内容（不含原始排版）。'
                        : '正文由 ' + (preview.chunks || 0) + ' 个分块拼接。')
                  : null,
              )
            : items.length === 0
              ? h('div', { key: 'e', className: 'dsh-ima-empty' },
                  loading ? '加载中…' : (curKb ? '这个库里还没有文件' : '从左侧选择一个知识库'))
              : h('div', { key: 'list', style: { flex: 1, minHeight: 0, overflow: 'auto' } },
                  items.map(function (it) {
                    return h('div', {
                      key: it.id,
                      className: 'dsh-ima-item',
                      title: (it.file_name || it.title) + ' · ' + (it.file_type || ''),
                      onClick: function () { openFile(it) },
                    },
                      h(FileTypeIcon, { type: extOf(it), size: 22 }),
                      h('span', { className: 'dsh-ima-item-t' }, it.title || it.file_name),
                      it.parse_status ? h(StatusTag, { status: it.parse_status, title: it.error_message || '' }) : null,
                      h('span', { className: 'dsh-ima-item-y' }, fmtDate(it.updated_at || it.created_at)),
                      h('span', { className: 'dsh-ima-act' },
                        h('button', {
                          className: 'dsh-ima-actbtn dsh-ima-actbtn-p',
                          title: '把它交给对话里的 agent 读取',
                          onClick: function (e) { e.stopPropagation(); quoteFile(it) },
                        }, h(QuoteGlyph), '引用到对话'),
                        h('button', {
                          className: 'dsh-ima-actbtn',
                          title: '复制文件名',
                          onClick: function (e) { e.stopPropagation(); copyText(it.title || it.file_name) },
                        }, h(CopyGlyph), '复制名称'),
                      ),
                    )
                  }),
                ),
      ),
    ),
    showSetup ? h('div', {
      className: 'dsh-ima-overlay',
      onClick: function (e) { if (e.target === e.currentTarget) setShowSetup(false) },
    }, h(SetupDialog, {
      status: status,
      onClose: function () { setShowSetup(false) },
      onSaved: function () { refreshStatus() },
    })) : null,
  )
}

// ── 连接设置（在面板里直接填写，替代 ima 的绑定弹窗） ───────
// WeKnora 用 API Key，不需要 OAuth：这里就是两个输入框 + 保存，
// 保存后经宿主写进 ~/.dsh/dsh-weknora-panel.json，立即生效。
