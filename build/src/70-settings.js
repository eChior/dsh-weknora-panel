// 设置对话框
// 由 build/src 拼接后注入 factory，和同目录其它片段共享作用域（不要加 import/export）。
function SetupDialog(props) {
  var s = props.status || {}
  var reachable = s.reachable
  var bs = React.useState(s.baseUrl || ''); var baseUrl = bs[0], setBaseUrl = bs[1]
  var ks = React.useState(''); var apiKey = ks[0], setApiKey = ks[1]
  var sv = React.useState(false); var saving = sv[0], setSaving = sv[1]
  var es = React.useState(''); var err = es[0], setErr = es[1]
  var ms = React.useState(''); var note = ms[0], setNote = ms[1]
  var cms = React.useState(s.contextMode || 'once'); var contextMode = cms[0], setContextMode = cms[1]
  var das = React.useState(!!s.directAnswer); var directAnswer = das[0], setDirectAnswer = das[1]
  var kqs = React.useState(s.kbQa !== false); var kbQa = kqs[0], setKbQa = kqs[1]
  var rts = React.useState(''); var rtText = rts[0], setRtText = rts[1]
  var rto = React.useState(null); var rtOut = rto[0], setRtOut = rto[1]
  var rtb = React.useState(false); var rtBusy = rtb[0], setRtBusy = rtb[1]
  var runTest = function () {
    if (rtBusy) return
    setRtBusy(true); setRtOut(null)
    api('/redact-test?text=' + encodeURIComponent(String(rtText || '').trim()))
      .then(function (r) { setRtOut(r || { ok: false, message: '无响应' }) })
      .catch(function (e) { setRtOut({ ok: false, message: String((e && e.message) || e) }) })
      .then(function () { setRtBusy(false) })
  }

  React.useEffect(function () {
    if (s.baseUrl) setBaseUrl(s.baseUrl)
  }, [s.baseUrl])

  React.useEffect(function () {
    if (s.contextMode) setContextMode(s.contextMode)
    setDirectAnswer(!!s.directAnswer)
    setKbQa(s.kbQa !== false)
  }, [s.contextMode])

  var save = function () {
    if (saving) return
    var b = String(baseUrl || '').trim()
    var k = String(apiKey || '').trim()
    if (!b) { setErr('Base URL 不能为空'); return }
    if (!k && !s.keyMasked) { setErr('API Key 不能为空'); return }
    setSaving(true); setErr(''); setNote('')
    api('/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseUrl: b, apiKey: k, contextMode: contextMode, directAnswer: directAnswer, kbQa: kbQa }),
    }).then(function (r) {
      if (!r || !r.ok) { setErr((r && r.message) || '保存失败'); return }
      setApiKey('')
      setNote(r.reachable
        ? '已保存，连接正常（' + (r.kbCount || 0) + ' 个知识库）'
        : ('已保存，但连不上：' + (r.error || '未知原因')))
      if (props.onSaved) props.onSaved()
    }).catch(function (e) { setErr(String((e && e.message) || e)) })
      .then(function () { setSaving(false) })
  }

  var tone = s.configured
    ? (reachable ? 'var(--dsw-alias-status-success,#1a9e6a)' : 'var(--dsw-alias-status-danger,#d93838)')
    : 'var(--dsw-alias-label-secondary,#666)'
  var statusText = s.configured
    ? (reachable ? '● 已连接' + (s.kbCount ? '（' + s.kbCount + ' 个知识库）' : '') : '● 连接异常')
    : '○ 未连接'

  return h('div', { className: 'dsh-ima-dlg' },
    h('h3', null, s.configured ? 'WeKnora 连接设置' : '连接 WeKnora'),
    h('div', { className: 'dsh-ima-note', style: { marginTop: '6px', color: 'var(--dsw-alias-label-tertiary,#999)' } },
      '填好下面两项点保存，立刻生效 —— 不用重启，也不用配环境变量。'),

    h('label', { className: 'dsh-ima-lbl' }, 'Base URL'),
    h('input', {
      className: 'dsh-ima-inp',
      value: baseUrl,
      spellCheck: false,
      placeholder: 'http://localhost:8080/api/v1',
      onChange: function (e) { setBaseUrl(e.target.value) },
    }),

    h('label', { className: 'dsh-ima-lbl' },
      s.keyMasked ? 'API Key（当前 ' + s.keyMasked + '，留空表示不改）' : 'API Key'),
    h('input', {
      className: 'dsh-ima-inp',
      type: 'password',
      value: apiKey,
      spellCheck: false,
      placeholder: s.keyMasked ? '保持原值请留空' : 'sk-...',
      onChange: function (e) { setApiKey(e.target.value) },
      onKeyDown: function (e) { if (e.key === 'Enter') save() },
    }),

    h('label', { className: 'dsh-ima-lbl' }, '会话上下文注入'),
    h('select', {
      className: 'dsh-ima-inp',
      value: contextMode,
      onChange: function (e) { setContextMode(e.target.value) },
    },
      h('option', { value: 'once' }, '每个会话只注入一次（推荐）'),
      h('option', { value: 'always' }, '每轮对话都注入（更主动，但吃上下文）'),
      h('option', { value: 'off' }, '完全不注入（工具照常可用）')
    ),
    h('div', { className: 'dsh-ima-note', style: { marginTop: '4px', fontSize: '.85em' } },
      '这段说明只影响 agent 会不会被提醒“优先用 weknora_panel_ask”，不影响 7 个工具本身。'),

    h('label', { className: 'dsh-ima-lbl', style: { marginTop: '10px' } }, '知识库问答'),
    h('label', { style: { display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: '.9em', lineHeight: 1.5 } },
      h('input', {
        type: 'checkbox',
        checked: kbQa !== false,
        onChange: function (e) { setKbQa(e.target.checked) },
        style: { marginTop: '3px' },
      }),
      h('span', null, '关掉之后不再给模型任何知识库提示，它也就不会去查（工具仍然可用，你在对话里点名要求才会用）。'
        + '适合“只想聊代码/通用问题”的时段。')
    ),

    h('label', { className: 'dsh-ima-lbl', style: { marginTop: '10px' } }, '快答直出'),
    h('label', { style: { display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: '.9em', lineHeight: 1.5 } },
      h('input', {
        type: 'checkbox',
        checked: !!directAnswer,
        onChange: function (e) { setDirectAnswer(e.target.checked) },
        style: { marginTop: '3px' },
      }),
      h('span', null, '本会话第一次提问时，WeKnora 的答案直接作为回复（不让模型再复述一遍）。'
        + '关掉时模型会照常输出一次，正文里有完整答案，但会多几秒、也可能被轻微改写。')
    ),

    h('div', { style: { borderTop: '1px solid rgba(0,0,0,.08)', marginTop: '12px', paddingTop: '10px' } },
      h('label', { className: 'dsh-ima-lbl' }, '脱敏自检'),
      h('div', { className: 'dsh-ima-note', style: { fontSize: '.85em', marginBottom: '6px' } },
        '库里的文档、WeKnora 会话历史、最终答案都是原文 —— 这是设计。脱敏只作用于「送给大模型的那一份上下文」。输一句含敏感词的话点试一下，能看到它被换成什么，再还原回来。'),
      h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
        h('input', {
          className: 'dsh-ima-inp',
          style: { flex: 1 },
          value: rtText,
          spellCheck: false,
          placeholder: '例如：差旅费报销标准',
          onChange: function (e) { setRtText(e.target.value) },
          onKeyDown: function (e) { if (e.key === 'Enter') runTest() },
        }),
        h('button', { className: 'dsh-ima-btn', style: { whiteSpace: 'nowrap' }, disabled: rtBusy, onClick: runTest }, rtBusy ? '测试中…' : '试一下')
      ),
      rtOut ? (rtOut.ok
        ? h('div', { className: 'dsh-ima-note', style: { marginTop: '8px', fontSize: '.85em' } },
            h('div', null, '脱敏服务：' + (rtOut.ready ? '就绪' : '未就绪') + ' · ' + (rtOut.terms || 0) + ' 个词条 · 当前 ' + (rtOut.placeholders || 0) + ' 个占位符'),
            rtOut.redacted ? h('div', { style: { marginTop: '4px' } }, '脱敏后：', h('code', null, rtOut.redacted)) : null,
            rtOut.restored ? h('div', { style: { marginTop: '2px' } }, '还原后：', h('code', null, rtOut.restored)) : null
          )
        : h('div', { className: 'dsh-ima-err', style: { marginTop: '8px' } }, rtOut.message || '测试失败')) : null
    ),

    err ? h('div', { className: 'dsh-ima-err', style: { padding: '8px 0 0' } }, err) : null,
    note ? h('div', { className: 'dsh-ima-note', style: { marginTop: '8px' } }, note) : null,
    (s.error && s.configured) ? h('div', { className: 'dsh-ima-err', style: { padding: '8px 0 0' } }, s.error) : null,

    h('div', { className: 'dsh-ima-acts' },
      h('span', { style: { fontSize: '.9em', color: tone, marginRight: 'auto' } }, statusText),
      props.onClose ? h('button', { className: 'dsh-ima-btn', onClick: props.onClose }, '关闭') : null,
      h('button', { className: 'dsh-ima-btn dsh-ima-btn-p', onClick: save, disabled: saving },
        saving ? '保存中…' : '保存'),
    ),
  )
}

// ── 插件入口 ─────────────────────────────────────────────
// 右侧栏 tab 要用 sidebarRightTabs / sidebarRight，必须在这里声明成依赖，
// 否则 cordis 访问未注入的服务会直接抛错，整个插件 entry 变成 failed。
// 注意：不要 inject 'layout'。点角标绝不能动左侧会话栏，收起左边栏会让用户
// 正在看的会话消失，还会留下一个空的「开始」页。
