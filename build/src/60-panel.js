function WeKnoraPage(props) {
  var panelActive = !props || props.active !== false
  var s = usePanelState()

  var status = s.status, kbs = s.kbs, curKb = s.curKb, items = s.items
  var loading = s.loading, error = s.error, folders = s.folders, curFolder = s.curFolder
  var uploads = s.uploads, agents = s.agents, agentId = s.agentId, fileRef = s.fileRef
  var updatedAt = s.updatedAt, refreshStatus = s.refreshStatus, loadKbs = s.loadKbs
  var loadFolders = s.loadFolders, loadFiles = s.loadFiles, doUpload = s.doUpload
  var PARSE_TEXT = s.PARSE_TEXT, trackParse = s.trackParse
  var setCurKb = s.setCurKb, setCurFolder = s.setCurFolder, setUploads = s.setUploads
  var setLoading = s.setLoading, setError = s.setError

  var preview = s.preview, hits = s.hits, query = s.query, keyword = s.keyword
  var showSetup = s.showSetup, detail = s.detail, tab = s.tab, officeOn = s.officeOn
  var previewBody = s.previewBody
  var openFile = s.openFile, showCite = s.showCite, doSearch = s.doSearch
  var quoteFile = s.quoteFile, quoteHit = s.quoteHit, openInWeKnora = s.openInWeKnora
  var setPreview = s.setPreview, setHits = s.setHits, setQuery = s.setQuery
  var setKeyword = s.setKeyword, setShowSetup = s.setShowSetup, setDetail = s.setDetail
  var setTab = s.setTab, setOfficeOn = s.setOfficeOn


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

  return h('div', { className: 'dsh-ima-root' },
    h('div', { className: 'dsh-ima-head' },
      h('span', { className: 'dsh-ima-title' }, '知识库 WeKnora'),
      h('span', { className: 'dsh-ima-badge' }, (kbs.length || 0) + ' 个库'),
      h('span', { className: 'dsh-ima-spacer' }),
      updatedAt ? h('span', { className: 'dsh-ima-stamp' }, '更新于 ' + fmtTime(updatedAt)) : null,
      // 上传入口已按用户要求禁用（2026-11-23）。要恢复：把下面注释掉的两段放回来，
      // 并把 useKbData 里的 doUpload/trackParse 一起启用即可（逻辑都在，只是不入口）。
      // curKb ? h('button', {
      //   className: 'dsh-ima-ibtn', title: '上传文件到当前分组',
      //   onClick: function () { if (fileRef.current) fileRef.current.click() },
      // }, h('span', { style: { fontSize: '16px', lineHeight: 1 } }, '＋')) : null,
      // h('input', {
      //   type: 'file', multiple: true, ref: fileRef,
      //   style: { display: 'none' },
      //   onChange: function (ev) { doUpload(ev.target.files); ev.target.value = '' },
      // }),
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

