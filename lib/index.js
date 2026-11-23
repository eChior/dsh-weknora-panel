/**
 * dsh-weknora-panel — Host 半
 *
 * 做三件事：
 *   1. 注册 5 个 agent 工具（inject: ['tools'] + ctx.tools.register）
 *      —— 名字统一带 `weknora_panel_` 前缀，和已装的 @wxg-prc-cpg/dsh-weknora 不打架
 *   2. 注册 /api/weknora/* HTTP 路由（inject: ['webServer']）
 *      —— 浏览器半拿不到 API Key，所有请求都由宿主代理
 *   3. agent/pre-step 注入知识库清单，让 agent 知道"有资料可查"
 *
 * ⚠️ 为什么检索工具要带 knowledge_id：
 *    WeKnora 的 hybrid-search 返回的是「分块片段 + knowledge_id」，
 *    agent 拿到片段往往不够答问题，必须能再按 knowledge_id 把原文整篇读出来
 *    —— 这就是"知识库问答自动调出原文"的关键一步。
 */

const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const http = require('http')
const { execFile } = require('child_process')
const { WeKnoraClient, WeKnoraError, WeKnoraAuthError, unquote } = require('./weknora-client')

const CONTEXT_KIND = 'dsh-weknora-context'
const CONTEXT_REFRESH_MS = 10 * 60 * 1000
const TOOL_PREFIX = 'weknora_panel_'

// ── 框架能力加载（拿不到就用本地等价实现） ───────────────
function loadDefineTool() {
  const candidates = [
    '@deepseek-ai/dsh-tools',
    path.join(process.env.APPDATA || '', 'npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools'),
  ]
  for (const c of candidates) {
    try {
      const m = require(c)
      if (m && typeof m.defineTool === 'function') {
        console.log('[dsh-weknora] 使用框架自带 defineTool')
        return m.defineTool
      }
    } catch { /* 试下一个 */ }
  }
  console.log('[dsh-weknora] 未找到框架 defineTool，使用本地等价实现')
  return localDefineTool
}

function loadCreateUserMessage() {
  const candidates = [
    '@deepseek-ai/dsh-llm',
    path.join(process.env.APPDATA || '', 'npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm'),
  ]
  for (const c of candidates) {
    try {
      const m = require(c)
      if (m && typeof m.createUserMessage === 'function') {
        console.log('[dsh-weknora] 使用框架自带 createUserMessage')
        return m.createUserMessage
      }
    } catch { /* 试下一个 */ }
  }
  console.log('[dsh-weknora] 未找到框架 createUserMessage，使用本地等价实现')
  return function localCreateUserMessage(options) {
    return {
      role: 'user',
      content: options.content,
      source: options.source,
      id: 'weknora-ctx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    }
  }
}

function localDefineTool(options) {
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(options.parameters || {})) {
    if (!spec || typeof spec !== 'object') continue
    const prop = { type: spec.type === 'integer' ? 'integer' : spec.type }
    if (spec.description) prop.description = spec.description
    if (spec.items) prop.items = spec.items
    properties[key] = prop
    if (spec.required) required.push(key)
  }
  return {
    name: options.name,
    description: options.description,
    parameters: { type: 'object', properties, ...(required.length ? { required } : {}) },
    output: { schema: options.output.schema, render: options.output.render },
    ...(typeof options.execute === 'function' ? { execute: options.execute } : {}),
  }
}

// ── 输出格式 ─────────────────────────────────────────────
function textOutput() {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string', required: true } },
    },
    render: (_args, value) => [{ type: 'text', text: value.text }],
  }
}

function jsonText(obj) {
  return { text: JSON.stringify(obj, null, 2) }
}

function fail(e) {
  return jsonText({
    error: (e && e.message) || String(e),
    code: (e && e.code) || 'unknown',
    ...(e instanceof WeKnoraAuthError ? { hint: '检查 WEKNORA_API_KEY 是否有效、是否有该租户权限' } : {}),
  })
}

// ── 配置 ────────────────────────────────────────────────
const CONFIG_PATH = path.join(
  (process.env.DSH_HOME && String(process.env.DSH_HOME).trim()) || path.join(os.homedir(), '.dsh'),
  'dsh-weknora-panel.json',
)

/**
 * 包里预置的默认配置（`<包根>/config.json`）。
 * 发给同事时把知识库地址一起打进去，装上就能用；用户自己在面板里保存的配置优先级更高。
 */
const BUNDLED_CONFIG_PATH = path.join(__dirname, '..', 'config.json')

/**
 * 已注入过知识库说明的会话，落盘保存：
 * 插件重载、DSH 重启都不会让同一个会话重复注入。
 */
const CONTEXT_STATE_PATH = path.join(path.dirname(CONFIG_PATH), 'dsh-weknora-context.json')
/** 注入决策日志，排查「为什么又注入了」时直接看这个文件。 */
const CONTEXT_LOG_PATH = path.join(path.dirname(CONFIG_PATH), 'dsh-weknora-context.log')

function envAny(...names) {
  for (const n of names) {
    const v = process.env[n]
    if (v && String(v).trim()) return String(v).trim()
  }
  return ''
}

function readJsonQuiet(p) {
  try {
    const o = JSON.parse(fs.readFileSync(p, 'utf8'))
    return o && typeof o === 'object' ? o : null
  } catch {
    return null
  }
}

/** 面板里手填、保存到 CONFIG_PATH 的配置（优先于环境变量） */
function readSavedConfig() {
  const o = readJsonQuiet(CONFIG_PATH) || {}
  return {
    baseUrl: String(o.baseUrl || '').trim(),
    apiKey: String(o.apiKey || '').trim(),
    tenantId: String(o.tenantId || '').trim(),
    maskerUrl: String(o.maskerUrl || '').trim(),
    contextMode: String(o.contextMode || '').trim(),
    directAnswer: o.directAnswer === undefined ? undefined : !!o.directAnswer,
    embedUrl: String(o.embedUrl || '').trim(),
  }
}

/** 包内自带的默认连接配置 */
function readBundledConfig() {
  const o = readJsonQuiet(BUNDLED_CONFIG_PATH) || {}
  return {
    baseUrl: String(o.baseUrl || '').trim(),
    apiKey: String(o.apiKey || '').trim(),
    tenantId: String(o.tenantId || '').trim(),
    maskerUrl: String(o.maskerUrl || '').trim(),
    contextMode: String(o.contextMode || '').trim(),
    directAnswer: o.directAnswer === undefined ? undefined : !!o.directAnswer,
    embedUrl: String(o.embedUrl || '').trim(),
  }
}

// ── 角标短码表 ──────────────────────────────────────────
// 短码只用于会话正文里的链接，浏览器半用 /api/weknora/cite?k= 换回 chunk id。
// 落盘是为了重启后历史消息里的角标仍然可点。
const CITES_PATH = path.join(path.dirname(CONFIG_PATH), 'dsh-weknora-cites.json')
let citeShort = null
let citeBack = null
let citeDirty = false
let citeTimer = null

function loadCites() {
  if (citeShort) return
  const raw = readJsonQuiet(CITES_PATH) || {}
  citeShort = {}
  citeBack = {}
  for (const k of Object.keys(raw)) {
    const v = raw[k]
    if (!v || !v.c) continue
    citeShort[k] = { c: String(v.c), d: String(v.d || '') }
    citeBack[String(v.c)] = k
  }
}

function saveCitesSoon() {
  citeDirty = true
  if (citeTimer) return
  citeTimer = setTimeout(() => {
    citeTimer = null
    if (!citeDirty || !citeShort) return
    citeDirty = false
    try {
      const keys = Object.keys(citeShort)
      // 太大就丢掉最早的一半，避免无限增长
      if (keys.length > 8000) {
        const drop = keys.slice(0, Math.floor(keys.length / 2))
        for (const k of drop) {
          const v = citeShort[k]
          delete citeShort[k]
          if (v && citeBack[v.c] === k) delete citeBack[v.c]
        }
      }
      fs.mkdirSync(path.dirname(CITES_PATH), { recursive: true })
      fs.writeFileSync(CITES_PATH, JSON.stringify(citeShort), { mode: 0o600 })
    } catch {
      /* 落盘失败不影响当前会话 */
    }
  }, 2000)
  if (citeTimer.unref) citeTimer.unref()
}

function shortFor(chunkId, doc) {
  loadCites()
  const hit = citeBack[chunkId]
  if (hit) return hit
  let k = ''
  do {
    k = crypto.randomBytes(4).toString('hex')
  } while (citeShort[k])
  citeShort[k] = { c: chunkId, d: String(doc || '') }
  citeBack[chunkId] = k
  saveCitesSoon()
  return k
}

function resolveCite(k) {
  loadCites()
  const v = citeShort[k]
  return v ? { chunkId: v.c, doc: v.d || '' } : null
}

function writeSavedConfig(patch) {
  const next = { ...readSavedConfig(), ...patch }
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { mode: 0o600 })
  return next
}

function readConfig(config) {
  const cfg = config || {}
  const saved = readSavedConfig()
  const bundled = readBundledConfig()
  return {
    // 优先级：explicit config > 用户保存的文件 > 包里预置的 config.json > 环境变量
    baseUrl: String(cfg.baseUrl || saved.baseUrl || bundled.baseUrl || envAny('WEKNORA_BASE_URL', 'WEKNORA_BASE')).trim(),
    apiKey: String(cfg.apiKey || saved.apiKey || bundled.apiKey || envAny('WEKNORA_API_KEY')).trim(),
    tenantId: String(cfg.tenantId || saved.tenantId || bundled.tenantId || envAny('WEKNORA_TENANT_ID')).trim(),
    maskerUrl: String(cfg.maskerUrl || saved.maskerUrl || bundled.maskerUrl || envAny('WEKNORA_MASKER_URL')).trim(),
    // WeKnora 原生界面（embed 渠道）地址；填了就用它的前端渲染，不再自绘
    embedUrl: String(cfg.embedUrl || saved.embedUrl || bundled.embedUrl || envAny('WEKNORA_EMBED_URL')).trim(),
    // context injection mode: once | always | off (UI setting, persisted in config file)
    contextMode: String(cfg.contextMode || saved.contextMode || bundled.contextMode || envAny('WEKNORA_PANEL_CONTEXT') || 'once').trim().toLowerCase(),
      directAnswer: cfg.directAnswer !== undefined ? cfg.directAnswer
        : (saved.directAnswer !== undefined ? saved.directAnswer
          : (bundled.directAnswer !== undefined ? bundled.directAnswer : envAny('WEKNORA_PANEL_DIRECT_ANSWER'))),
    // 知识库问答总开关：关掉之后 pre-step 不再注入、模型也就不会去调
    kbQa: (function () {
      const v = cfg.kbQa !== undefined ? cfg.kbQa : (saved.kbQa !== undefined ? saved.kbQa : bundled.kbQa)
      if (v === undefined || v === null || v === '') return true
      return !(v === false || v === '0' || v === 'false' || v === 'off')
    })(),
    timeoutMs: Number(cfg.timeoutMs) || undefined,
  }
}

function mask(s) {
  if (!s) return ''
  return s.length <= 10 ? s.slice(0, 3) + '****' : s.slice(0, 5) + '****' + s.slice(-4)
}

// ── HTTP 辅助 ────────────────────────────────────────────
function sendJson(res, obj, status) {
  const body = JSON.stringify(obj)
  res.writeHead(status || 200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** 原始字节（上传用）：不能走 readBody —— 那里按 JSON 解析，二进制文件必然报「请求体不是合法 JSON」 */
function readRawBody(req, maxBytes) {
  const limit = maxBytes || 200 * 1024 * 1024
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('文件太大（上限 ' + Math.round(limit / 1024 / 1024) + 'MB）')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 1024 * 1024) { reject(new Error('请求体过大')); req.destroy() }
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch { reject(new Error('请求体不是合法 JSON')) }
    })
    req.on('error', reject)
  })
}

const MIME = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8', json: 'application/json; charset=utf-8',
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
}

function mimeOf(fileName, fallback) {
  const m = /\.([A-Za-z0-9]{1,6})$/.exec(String(fileName || ''))
  const ext = m ? m[1].toLowerCase() : ''
  return MIME[ext] || fallback || 'application/octet-stream'
}

/** 把上游 Response 原样转给浏览器（图片 / 音视频 / 下载都会走这里） */
/**
 * 生成一个内联出处角标的 markdown 片段：`[n](dsh-weknora:c/<短码>)`。
 *
 * 为什么用短码而不是直接写 chunk id：回答是流式渲染的，链接还没闭合时正文里
 * 会短暂显示原始 markdown，把 36 位 uuid + URL 编码的中文文件名塞进去会闪出一大坨；
 * 换成 8 位短码后中间态只有 `[1](dsh-weknora:c/a1b2c3d4)`，肉眼几乎看不到。
 */
function citeLink(n, chunkId, doc) {
  if (!chunkId) return ''
  const short = shortFor(chunkId, doc)
  return '[' + n + '](dsh-weknora:c/' + short + ')'
}

// ── 占位符还原（兜底） ───────────────────────────────────
// WeKnora 在送模型前把敏感词换成 [公司1-1] 这样的占位符，流式还原偶尔会漏
// （占位符正好被切在两帧之间）。这里拿完整答案再整段还原一次：
// 命中 masker 就换回原文，连不上就原样返回，不影响主链路。
const PLACEHOLDER_RE = /\[[\u4e00-\u9fffA-Za-z][^\[\]\n]{0,14}\]/

// ── 会话内的实时流：ask 工具边收边把片段推给前端工具卡片 ──
const liveStreams = new Map()

// 每次 ask 的角标编号表：{ [liveKey]: { cites: [{n, chunkId, doc}], at } }。
// 浏览器半用它把正文里的纯文本标记 [1] 装饰成可点的上标角标。
const askLedger = new Map()
let liveLastKey = null

function liveKeyFor(q) {
  return crypto.createHash('sha1').update('wk|' + String(q || '').trim()).digest('hex').slice(0, 12)
}

async function pumpSse(response, onEvent) {
  if (!response || !response.body) return
  const reader = response.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const step = await reader.read()
    if (step.done) break
    buf += dec.decode(step.value, { stream: true })
    let cut
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, cut)
      buf = buf.slice(cut + 2)
      const line = raw.split('\n').map((l) => l.trim()).find((l) => l.startsWith('data:'))
      if (!line) continue
      let ev
      try { ev = JSON.parse(line.slice(5).trim()) } catch (e) { continue }
      try { onEvent(ev) } catch (e) { /* 单帧出错不影响后续 */ }
    }
  }
}

async function restorePlaceholders(text) {
  if (!text || !PLACEHOLDER_RE.test(text)) return text
  const url = String(readConfig().maskerUrl || '').replace(/\/+$/, '')
  if (!url) return text
  try {
    const r = await fetch(url + '/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts: [String(text)] }),
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok) return text
    const j = await r.json()
    const out = j && Array.isArray(j.texts) ? j.texts[0] : ''
    return typeof out === 'string' && out ? out : text
  } catch {
    return text
  }
}


/**
 * 把答案正文里的 `<kb doc="..." chunk_id="..." />` 换成**纯文本**角标标记 `[1]`。
 *
 * 为什么不用 markdown 链接：链接语法 `[1](dsh-weknora:...)` 在模型转述答案时
 * 极容易被简化成「（《文件名》）」或直接丢掉；而 `[1]` 是正文内容的一部分，
 * 模型基本会原样保留。浏览器半再按 ledger 把 `[1]` 装饰成可点角标。
 */
// 角标编号在全进程内单调递增：多轮对话里第 2 条的角标接着第 1 条往下排，
// 这样正文里任意一个 [N] 都能在全局表里唯一对上，前端装饰不必知道它属于哪一轮。
let citeSeq = 0
const citeIndex = new Map() // n -> { chunkId, doc }

// 编号表必须落盘：否则插件一重启 citeSeq 归零，会话里历史消息的 [14] 就再也对不上，
// 前端装饰找不到映射 → 数字留在正文里点不动（用户就是这么撞上的）。
const CITE_INDEX_PATH = path.join(path.dirname(CONFIG_PATH), 'dsh-weknora-cites-index.json')
try {
  const saved = JSON.parse(fs.readFileSync(CITE_INDEX_PATH, 'utf8'))
  if (saved && Array.isArray(saved.items)) {
    for (const it of saved.items) {
      if (it && it.n) citeIndex.set(Number(it.n), { chunkId: String(it.chunkId || ''), doc: String(it.doc || '') })
    }
  }
  if (saved && typeof saved.next === 'number' && saved.next > citeSeq) citeSeq = saved.next
} catch { /* 首次运行没有文件 */ }
let citeSaveTimer = null
function saveCiteIndexSoon() {
  if (citeSaveTimer) return
  citeSaveTimer = setTimeout(() => {
    citeSaveTimer = null
    try {
      let items = [...citeIndex.entries()].sort((a, b) => a[0] - b[0])
      if (items.length > 5000) items = items.slice(items.length - 5000)
      const data = { next: citeSeq, items: items.map(([n, v]) => ({ n, chunkId: v.chunkId, doc: v.doc })) }
      fs.writeFileSync(CITE_INDEX_PATH, JSON.stringify(data), { mode: 0o600 })
    } catch { /* 写失败不影响问答 */ }
  }, 2000)
  if (citeSaveTimer.unref) citeSaveTimer.unref()
}

function inlineCitations(text) {
  const cites = []
  if (!text || text.indexOf('<kb ') < 0) return { text: String(text || ''), cites }
  const seen = new Map()
  let n = citeSeq
  const out = String(text).replace(/<kb\s+([^>]*?)\/?>/gi, (whole, attrs) => {
    const attr = (name) => {
      const m = new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i').exec(attrs)
      return m ? m[1] : ''
    }
    const cid = attr('chunk_id')
    const doc = attr('doc')
    if (!cid) return doc ? '（《' + doc + '》）' : ''
    if (!seen.has(cid)) {
      seen.set(cid, ++n)
      cites.push({ n, chunkId: cid, doc })
      citeIndex.set(n, { chunkId: cid, doc })
    }
    return '[' + seen.get(cid) + ']'
  })
  citeSeq = n
  if (cites.length) saveCiteIndexSoon()
  return { text: out, cites }
}

async function pipeUpstream(res, upstream, { fileName, fallbackType, inline } = {}) {  const buf = Buffer.from(await upstream.arrayBuffer())
  const type = fileName ? mimeOf(fileName, fallbackType) : (upstream.headers.get('content-type') || fallbackType)
  const name = String(fileName || '').replace(/["\\\r\n]/g, '')
  res.writeHead(200, {
    'content-type': type || 'application/octet-stream',
    'content-length': buf.length,
    'cache-control': 'private, max-age=120',
    ...(name
      ? { 'content-disposition': `${inline === false ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}` }
      : {}),
  })
  res.end(buf)
}

// ── 插件主体 ─────────────────────────────────────────────
module.exports = {
  name: 'dsh-weknora-panel',
  // 故意不声明 webServer：headless / tui 里没有网页服务，但工具仍应可用。
  inject: ['tools', 'agents'],

  apply(ctx, pluginConfig) {
    const state = { client: new WeKnoraClient(readConfig(pluginConfig)) }
    const reloadClient = () => {
      state.client = new WeKnoraClient(readConfig(pluginConfig))
      console.log(state.client.configured
        ? `[dsh-weknora] 配置已更新：${state.client.baseUrl}（key ${mask(state.client.apiKey)}）`
        : '[dsh-weknora] 配置已清空')
    }
    console.log(state.client.configured
      ? `[dsh-weknora] 已配置：${state.client.baseUrl}（key ${mask(state.client.apiKey)}）`
      : '[dsh-weknora] 未配置：可在面板齿轮里直接填写，或设置 WEKNORA_BASE_URL / WEKNORA_API_KEY')

    const defineTool = loadDefineTool()
    const register = (def) => ctx.tools.register(defineTool(def))
    const requireConfigured = () => {
      if (state.client.configured) return null
      return jsonText({
        configured: false,
        message: 'WeKnora 尚未配置。请在「知识库」面板点右上角齿轮，直接填写 Base URL 与 API Key（保存即生效）；'
          + '也可以用环境变量 WEKNORA_BASE_URL / WEKNORA_API_KEY，改完重启 DSH。',
      })
    }

    // ── 工具 1：列知识库 ──
    register({
      name: TOOL_PREFIX + 'list_knowledge_bases',
      description: '列出 WeKnora 上的知识库（含文件数、分块数）。用户问“有哪些知识库/资料库”“某个库里有啥”时先调它拿 id。',
      parameters: {},
      output: textOutput(),
      async execute() {
        const miss = requireConfigured()
        if (miss) return miss
        try {
          const kbs = await state.client.listKnowledgeBases()
          return jsonText({
            configured: true, count: kbs.length,
            knowledgeBases: kbs.map((k) => ({
              id: k.id, name: k.name, description: k.description || '',
              documentCount: k.knowledge_count ?? null,
              chunkCount: k.chunk_count ?? null,
              updatedAt: k.updated_at || null,
            })),
          })
        } catch (e) { return fail(e) }
      },
    })

    // ── 工具 2：列库内文件 ──
    register({
      name: TOOL_PREFIX + 'list_files',
      description: '列出某个 WeKnora 知识库里的文档。knowledge_base_id 来自 weknora_panel_list_knowledge_bases。可传 keyword 按文件名过滤。返回的 id 就是 knowledge_id，可直接喂给 weknora_panel_read_document 读全文。',
      parameters: {
        knowledge_base_id: { type: 'string', required: true, description: '知识库 ID' },
        keyword: { type: 'string', description: '按文件名过滤的关键词，可空' },
        page: { type: 'integer', description: '页码，从 1 开始（默认 1）' },
        page_size: { type: 'integer', description: '每页条数（默认 30，最大 200）' },
      },
      output: textOutput(),
      async execute(args) {
        const miss = requireConfigured()
        if (miss) return miss
        const kbId = args && args.knowledge_base_id
        if (!kbId) return jsonText({ error: '缺少 knowledge_base_id，请先调 ' + TOOL_PREFIX + 'list_knowledge_bases' })
        try {
          const r = await state.client.listFiles(kbId, {
            keyword: (args && args.keyword) || '',
            page: Number(args && args.page) || 1,
            pageSize: Math.min(Number(args && args.page_size) || 30, 200),
          })
          return jsonText({
            ok: true, total: r.total, page: r.page, hasMore: r.hasMore,
            items: r.items.map((it) => ({
              knowledge_id: it.id,
              title: it.title || it.file_name,
              fileName: it.file_name || '',
              fileType: it.file_type || '',
              parseStatus: it.parse_status || '',
              sizeBytes: it.file_size ?? null,
              description: (it.description || '').slice(0, 160),
              updatedAt: it.updated_at || null,
            })),
          })
        } catch (e) { return fail(e) }
      },
    })

    // ── 工具 3：按文件名/描述找文档 ──
    register({
      name: TOOL_PREFIX + 'find_documents',
      description: '在 WeKnora 全部知识库里按文件名/标题关键词找文档（不搜正文）。适合“有没有叫 XXX 的文件”。要找正文内容用 weknora_panel_search。',
      parameters: {
        keyword: { type: 'string', required: true, description: '文件名关键词' },
        limit: { type: 'integer', description: '最多返回几条（默认 20，最大 50）' },
      },
      output: textOutput(),
      async execute(args) {
        const miss = requireConfigured()
        if (miss) return miss
        if (!args || !args.keyword) return jsonText({ error: '缺少 keyword' })
        try {
          const docs = await state.client.findDocuments({
            keyword: args.keyword,
            limit: Math.min(Number(args.limit) || 20, 50),
          })
          return jsonText({
            ok: true, count: docs.length,
            documents: docs.map((d) => ({
              knowledge_id: d.id,
              title: d.title || d.file_name,
              fileName: d.file_name || '',
              fileType: d.file_type || '',
              knowledgeBaseId: d.knowledge_base_id || null,
              parseStatus: d.parse_status || '',
            })),
          })
        } catch (e) { return fail(e) }
      },
    })

    // ── 工具 4：语义检索（核心） ──
    register({
      name: TOOL_PREFIX + 'search',
      description: '在 WeKnora 知识库里按**内容**做混合检索（向量 + 关键词），返回最相关的分块片段。'
        + '这是“知识库问答”的第一步：用户问任何问题，都先调它看看库里有没有依据。'
        + '每条命中都带 knowledge_id —— 片段不够回答时必须用 weknora_panel_read_document 把它整篇读出来再答，'
        + '不要只凭片段瞎猜，也不要回答“我看不到原文”。',
      parameters: {
        query: { type: 'string', required: true, description: '检索问题或关键词，自然语言即可' },
        knowledge_base_id: { type: 'string', description: '限定某个知识库（可选）；不传则跨全部库检索' },
        match_count: { type: 'integer', description: '返回条数（默认 8，最大 30）' },
      },
      output: textOutput(),
      async execute(args) {
        const miss = requireConfigured()
        if (miss) return miss
        const query = String((args && args.query) || '').trim()
        if (!query) return jsonText({ error: '缺少 query' })
        const matchCount = Math.min(Number(args.match_count) || 8, 30)
        try {
          let hits
          const kbId = args && args.knowledge_base_id
          if (kbId) {
            hits = await state.client.hybridSearch(kbId, { queryText: query, matchCount })
          } else {
            const kbs = await state.client.listKnowledgeBases()
            hits = await state.client.searchKnowledge({
              query,
              knowledgeBaseIds: kbs.map((k) => k.id),
              matchCount,
            })
          }
          return jsonText({
            ok: true, query, scope: kbId ? 'knowledge_base' : 'all', count: hits.length,
            hits: hits.map((h, i) => ({
              rank: i + 1,
              knowledge_id: h.knowledge_id,
              title: h.knowledge_title || h.knowledge_filename || '',
              fileName: h.knowledge_filename || '',
              score: Number(h.score) || 0,
              matchType: h.match_type === 1 ? 'keyword' : 'vector',
              chunkIndex: h.chunk_index ?? null,
              snippet: String(h.matched_content || h.content || '').slice(0, 600),
              // 引用这个片段时，把 cite 原样贴在句末 —— 会话里会渲染成可点的蓝色角标
              cite: h.id ? citeLink(i + 1, h.id, h.knowledge_title || h.knowledge_filename || '') : '',
            })),
            next: hits.length
              ? '回答里引用某条命中时，把它那行的 cite 值原样放在句末（如「…规定[1](dsh-weknora:c/…)。」），'
                + '会话里就会显示可点角标。需要完整上下文时，用 ' + TOOL_PREFIX + 'read_document 传 hits[].knowledge_id 读整篇原文。'
              : '没检索到相关内容；可换个说法、或先用 ' + TOOL_PREFIX + 'list_files 看看库里有哪些文档。',
          })
        } catch (e) { return fail(e) }
      },
    })

    // ── 工具 5：读原文（分块拼全文） ──
    register({
      name: TOOL_PREFIX + 'read_document',
      description: '按 knowledge_id 读取 WeKnora 文档的正文 —— 把该文档全部分块按顺序拼起来返回。'
        + 'knowledge_id 来自 weknora_panel_search 的命中或 weknora_panel_list_files。'
        + '这是“把原文调出来”的那一步：回答引用类问题时应该基于这里的内容。'
        + '超长文档可用 offset / max_chars 分段读。',
      parameters: {
        knowledge_id: { type: 'string', required: true, description: '文档 ID（knowledge_id）' },
        offset: { type: 'integer', description: '从第几个字符开始（默认 0）' },
        max_chars: { type: 'integer', description: '最多返回多少字符（默认 12000，最大 40000）' },
      },
      output: textOutput(),
      async execute(args) {
        const miss = requireConfigured()
        if (miss) return miss
        const id = args && args.knowledge_id
        if (!id) return jsonText({ error: '缺少 knowledge_id' })
        try {
          const file = await state.client.getFile(id).catch(() => null)
          const chunks = await state.client.readAllChunks(id)
          if (!chunks.length) {
            return jsonText({
              ok: false,
              message: '这篇文档还没有解析出分块（可能仍在解析，或解析失败）。',
              parseStatus: file && file.parse_status,
              errorMessage: file && file.error_message,
            })
          }
          const full = chunks.map((c) => String(c.content || '')).join('\n\n')
          const offset = Math.max(0, Number(args.offset) || 0)
          const maxChars = Math.min(Math.max(Number(args.max_chars) || 12000, 500), 40000)
          const body = full.slice(offset, offset + maxChars)
          return jsonText({
            ok: true,
            knowledge_id: id,
            title: (file && (file.title || file.file_name)) || '',
            fileName: (file && file.file_name) || '',
            fileType: (file && file.file_type) || '',
            parseStatus: (file && file.parse_status) || '',
            chunks: chunks.length,
            totalChars: full.length,
            offset,
            truncated: offset + body.length < full.length,
            content: body,
            // 引用这段原文时把 cite 贴到句末，会话里会显示可点角标
            cite: citeLink(1, chunks[0] && chunks[0].id, (file && (file.title || file.file_name)) || ''),
            next: '需要逐段精确引用时，用 ' + TOOL_PREFIX + 'read_chunk 传具体 chunk_id（readAllChunks 的 items 里），'
              + '或直接用 ' + TOOL_PREFIX + 'search 拿带 cite 的命中。',
          })
        } catch (e) { return fail(e) }
      },
    })

    // ── 工具 6：服务端问答（一次往返，最快） ──
    // 知识库 id 缓存（问答每次开新会话，不缓存 session）
    const qaState = { kbIds: null, kbAt: 0 }
    // 本会话是否已经「直接放行」过一次问答（第一次直出，之后交给模型结合上下文）
    const askAnswered = new Set()
    // 快答直出：开着时本会话第一次问答不再让模型复述（答案只在工具卡片里）；
    // 关着时（默认）模型照常输出一次，正文里就有完整答案。
    function directAnswerNow() {
      const v = readConfig().directAnswer
      // 默认关：关掉之后模型会把工具结果复述进正文，正文才有答案。
      // 打开则本轮直接结束，答案只留在工具卡片里。
      return v === true || v === '1' || v === 'true' || v === 'on'
    }

    register({
      name: TOOL_PREFIX + 'ask',
      description: '用 WeKnora 服务端直接回答知识库问题：检索、生成、引用在服务端一次跑完，'
        + '只占一次工具往返，比「先 search、再 read_document、再自己写答案」快数倍。'
        + '用户问制度/产品/文档内容类问题时**优先用这个**。'
        + '**这个工具返回的正文就是最终答案本身**：里面已经有完整标题层级、表格、列表、加粗和每句后面的出处标记，'
        + '把它们原样交给用户即可 —— 不要改写、不要概括、不要压缩、不要重排、不要省略表格或任何一段，'
        + '最多在开头加一句「以下是 WeKnora 的回答：」。'
        + '返回正文里每句/每段后面带着**纯文本**出处编号 [1]、[2]、[3]…（这是插件认得出的角标，'
        + '不是给人看的脚注）。**必须原样保留这些 [n] 标记**：不要删、不要改成（《文件名》）、不要挪到末尾集中列，'
        + '保留后插件会在会话里把它们渲染成可点角标，点一下在右侧栏打开原文并标黄。'
        + '要逐字原文时把编号对应的 chunk 交给 ' + TOOL_PREFIX + 'read_chunk（用 ' + TOOL_PREFIX + 'search 或 read_document 拿 chunk_id）。',
      parameters: {
        query: { type: 'string', required: true, description: '用户的问题，原样问句效果最好' },
        knowledge_base_id: { type: 'string', description: '限定某个知识库 id；省略则查当前全部库' },
      },
      output: textOutput(),
      async execute(args, exec) {
        const miss = requireConfigured()
        if (miss) return miss
        const query = args && args.query
        if (!query || !String(query).trim()) return jsonText({ error: '缺少 query' })
        try {
          let kbIds
          if (args && args.knowledge_base_id) {
            kbIds = [args.knowledge_base_id]
          } else {
            const now = Date.now()
            if (!qaState.kbIds || now - qaState.kbAt > 5 * 60 * 1000) {
              const kbs = await state.client.listKnowledgeBases()
              qaState.kbIds = kbs.map((k) => k.id)
              qaState.kbAt = now
            }
            kbIds = qaState.kbIds
          }
          // 走流式：一边收一边把片段推给会话里的工具卡片，用户不用干等二十几秒
          const live = { buf: '', done: false, error: null, subs: new Set(), startedAt: Date.now() }
          const liveKey = liveKeyFor(query)
          liveStreams.set(liveKey, live)
          liveLastKey = liveKey
          const notify = (ev) => {
            for (const fn of live.subs) { try { fn(ev) } catch (e) { /* 单个订阅者出错忽略 */ } }
          }
          let r
          try {
            const started = await state.client.askStream({ query: String(query).trim(), knowledgeBaseIds: kbIds })
            await pumpSse(started.response, (ev) => {
              if (ev.response_type === 'answer' && ev.content) {
                live.buf += ev.content
                notify({ type: 'chunk', text: ev.content })
              }
            })
            r = { answer: live.buf, references: [], thinking: '' }
          } catch (e) {
            live.error = msg(e) || String(e)
            throw e
          } finally {
            live.done = true
            notify({ type: 'done' })
          }

          // WeKnora 的答案正文本来就内联了出处标记（<kb doc="..." chunk_id="..." />）。
          // 变成 markdown 链接 dsh-weknora:chunk/<id>：会话里显示成上标角标，
          // 点一下由浏览器半的全局点击拦截接住，直接在侧边栏跳到原文并标黄。
          const restored = await restorePlaceholders(r.answer || '（服务端没有返回答案文本）')
          const cited = inlineCitations(restored)
          const answer = cited.text
          const cites = cited.cites
          if (cites.length) askLedger.set(liveKey, { cites, at: Date.now() })
          // WeKnora 的思考过程（agent 模式下会有）也带回去，让 agent 看到完整结构；
          // quick-answer 模式通常为空，不额外占位。
          let text = answer
          if (r.thinking && String(r.thinking).trim()) {
            const think = await restorePlaceholders(String(r.thinking).trim())
            text = '> **WeKnora 思考过程**\n> ' + think.split('\n').join('\n> ') + '\n\n' + answer
          } else if (!cites.length) {
            text = answer + '\n\n（本次没有命中引用，可换关键词再问，或先用 ' + TOOL_PREFIX + 'search 看看库里有没有相关内容。）'
          }
          // 快答放行：本轮到此为止。工具结果就是回答，不再让模型把 WeKnora 的答案重新加工一遍。
          // DSH 的 tools pipeline 会把 concludeTurn 过的调用标成 concludesTurn，
          // agent loop 收到后直接结束本回合（不请求模型）。
          // 只放行本会话的第一次问答：第二次起多半是「结合上文追问」，留给模型带着历史去整合。
          if (exec && typeof exec.concludeTurn === 'function' && directAnswerNow()) {
            let sid = ''
            try {
              const ag = exec.agent
              const s1 = ag && ag.session
              sid = String((s1 && (s1.id || s1.sessionId)) || (ag && ag.sessionId) || '')
            } catch (e) { sid = '' }
            const key = sid || '__anon__'
            if (!askAnswered.has(key)) {
              askAnswered.add(key)
              try { exec.concludeTurn() } catch (e) { /* 旧版 DSH 没有该方法，忽略 */ }
            }
          }
          return { text }
        } catch (e) { return fail(e) }
      },
    })

    // ── 工具 7：按 chunk_id 读单段原文 ──
    register({
      name: TOOL_PREFIX + 'read_chunk',
      description: '按 chunk_id 读取单个分块的逐字原文。答案正文里的 <kb doc="文件名" chunk_id="..." /> 就是出处，'
        + '想确认某一句背后到底怎么写的，就把那个 chunk_id 传进来；比读整篇 read_document 更精准也更快。',
      parameters: {
        chunk_id: { type: 'string', required: true, description: '分块 ID（答案里 <kb ... chunk_id="..."> 的那个值）' },
      },
      output: textOutput(),
      async execute(args) {
        const miss = requireConfigured()
        if (miss) return miss
        const id = args && args.chunk_id
        if (!id) return jsonText({ error: '缺少 chunk_id' })
        try {
          const c = await state.client.getChunk(String(id).trim())
          if (!c) return jsonText({ ok: false, message: '没有找到这个分块' })
          return jsonText({
            ok: true,
            chunk_id: c.id,
            knowledge_id: c.knowledge_id,
            knowledge_base_id: c.knowledge_base_id,
            chunk_index: c.chunk_index,
            seq_id: c.seq_id,
            content: c.content || '',
          })
        } catch (e) { return fail(e) }
      },
    })

    console.log(`[dsh-weknora] 已注册 7 个工具（前缀 ${TOOL_PREFIX}）`)

    // ── agent/pre-step：让 agent 知道有知识库可查 ──
    const createUserMessage = loadCreateUserMessage()
    let kbCache = { at: 0, text: null, count: 0 }
    // 注入频率：once（默认，每个会话只注入一次）| always（每轮都注入）| off（完全不注入）
    function contextModeNow() {
      const m = String(readConfig().contextMode || 'once').toLowerCase()
      return (m === 'always' || m === 'off') ? m : 'once'
    }
    const injectedSessions = new Set()
    let injectedFallback = false
    let injectedStateLoaded = false

    function loadInjectedState() {
      if (injectedStateLoaded) return
      injectedStateLoaded = true
      const o = readJsonQuiet(CONTEXT_STATE_PATH) || {}
      if (Array.isArray(o.sessions)) o.sessions.forEach((x) => injectedSessions.add(String(x)))
      if (o.fallback) injectedFallback = true
    }

    // 文件只有几百字节，直接同步写：进程随时被关掉也不会丢状态。
    function saveInjectedState() {
      try {
        fs.mkdirSync(path.dirname(CONTEXT_STATE_PATH), { recursive: true })
        fs.writeFileSync(CONTEXT_STATE_PATH, JSON.stringify({
          sessions: [...injectedSessions].slice(-500),
          fallback: injectedFallback,
        }), { mode: 0o600 })
      } catch { /* 写不了不影响功能 */ }
    }

    function logInject(rec) {
      try {
        fs.appendFileSync(CONTEXT_LOG_PATH, JSON.stringify(rec) + '\n')
        if (fs.statSync(CONTEXT_LOG_PATH).size > 64 * 1024) {
          const keep = fs.readFileSync(CONTEXT_LOG_PATH, 'utf8').split('\n').slice(-200).join('\n')
          fs.writeFileSync(CONTEXT_LOG_PATH, keep)
        }
      } catch { /* 日志写不了不影响功能 */ }
    }

    function sessionKeyOf(payload) {
      try {
        const s = payload && payload.agent && payload.agent.session
        if (!s) return ''
        return String(s.id || s.sessionId || (s.meta && s.meta.id) || '')
      } catch (e) {
        return ''
      }
    }

    async function buildKnowledgeContext() {
      const now = Date.now()
      if (kbCache.text && now - kbCache.at < 5 * 60 * 1000) return kbCache.text
      if (!state.client.configured) return null
      let kbs = []
      try { kbs = await state.client.listKnowledgeBases() } catch { return null }
      if (!kbs.length) return null

      const shown = kbs.slice(0, 15).map((k) => {
        const n = k.document_count ?? k.knowledge_count ?? 0
        return `· ${k.name}${n ? `（${n} 篇）` : ''}${k.description ? ' — ' + String(k.description).slice(0, 60) : ''}`
      })
      const lines = [...shown]
      if (kbs.length > shown.length) lines.push(`· …… 等共 ${kbs.length} 个`)

      // 给模型一份「库里到底有哪些文档」的样本，它才能在开口前判断
      // 这个问题是不是根本不在知识库覆盖范围内（比如问某个药的工艺，
      // 而库里只有财务/采购制度），从而不去白跑一次检索。
      const sample = []
      for (const k of kbs.slice(0, 3)) {
        try {
          const r = await state.client.listFiles(k.id, { page: 1, pageSize: 10 })
          const names = (r && (r.items || r.data) || [])
            .map((f) => String(f.title || f.file_name || '').replace(/\.[A-Za-z0-9]{1,6}$/, ''))
            .filter(Boolean)
            .slice(0, 8)
          if (names.length) sample.push(`· ${k.name}：${names.join('；')}`)
        } catch { /* 列不出来就算了，不影响主流程 */ }
      }
      if (sample.length) {
        lines.push('', '库内文档样本（判断范围用，不是全部）：', ...sample)
      }

      const text = [
        '[WeKnora 知识库] 用户已接入 WeKnora 知识库，里面的资料可以直接查，不必问用户要文件：',
        ...lines,
        '',
        '**先判断范围再决定要不要查**：看上面「库内文档样本」，如果用户问的东西明显不在这批文档里'
          + '（例如问某个药品的生产工艺、配方、质量标准，而库里只有财务/采购/报销制度），'
          + '**不要调用任何 weknora 工具**，直接回答并说明“知识库没有覆盖这部分”；宁可不查，也不要白跑一次检索。',
        '**别滥用**：只有用户确实在问公司制度、流程、标准、产品资料、或“文档里写了什么”时才用知识库；'
          + '写代码、闲聊、通用知识、时间日期、翻译、改文件这类，**不要调用**任何 weknora 工具，直接回答。',
        '**硬性规则**：用户只要在问公司制度、流程、标准、产品资料、文档里写了什么（哪怕问题很短），'
          + `**第一步就必须调用 ${TOOL_PREFIX}ask**，不要先自己检索、也不要凭记忆回答；除非用户明确说"接着刚才的说"，`
          + '否则每轮新问题都要先 ask 一次。',
        `1. **${TOOL_PREFIX}ask 是默认入口**：它让 WeKnora 在服务端一次把检索+生成+引用做完，只占一次往返，`
          + '比“先检索再读原文再自己写”快数倍；追问（“那 X 呢”“展开第 2 点”）也直接再 ask 一次，把 spuns 一起带上。',
        `1a. **拿到 ${TOOL_PREFIX}ask 的结果之后，下一步就是把这段 text 原样输出成你的回复**：`
          + '标题、表格、列表、加粗、[n] 出处编号都照抄，**不要总结、不要改口吻、不要补一句你自己的解释**；'
          + '这一步就是“把 WeKnora 的答案搬到正文”，越快越好。',
        `1b. **${TOOL_PREFIX}ask 返回的 text 就是最终答案**：标题层级、表格、列表、加粗、每句后面的出处标记都已在里面。`
          + '请原样作为回复输出（可在前面加一句「以下是 WeKnora 的回答：」），**不要改写、概括、压缩、重排或省略表格**；'
          + '用户要看的就是 WeKnora 网页端原样的回答。',
        '2. ask 返回的正文里，每句/每段后面带着**纯文本**出处编号 [1]、[2]、[3]… —— 这是插件识别的角标标记，'
          + '**必须原样保留在回答里**：不要删、不要改成（《文件名》）、不要挪到末尾集中列。保留后会话正文里会显示成可点角标，'
          + '点一下在右侧栏打开原文并标黄；',
        `3. 要逐字原文、或想核对某段表述，把那个 chunk_id 交给 ${TOOL_PREFIX}read_chunk 读单段；要整篇则用 ${TOOL_PREFIX}read_document 传 knowledge_id`,
        `4. 只想看库里有什么、或按文件名找，用 ${TOOL_PREFIX}list_knowledge_bases / ${TOOL_PREFIX}list_files / ${TOOL_PREFIX}find_documents`,
        `5. 需要原始分块做比对（比如要精确的条款编号）时，才用 ${TOOL_PREFIX}search 拿片段`,
        '**重要**：会话里要出现可点角标，只有两条路 —— 走 ' + TOOL_PREFIX + 'ask，**并把正文里的 [1][2]… 原样保留**；'
          + '或者用 ' + TOOL_PREFIX + 'search，把每条命中返回的 `cite` 值（形如 `[1](dsh-weknora:c/<短码>)`）原样贴在对应句末。'
          + '把 [n] 删掉、或改写成（《文件名》）之后，点开原文就没有依据了。',
        '回答里引用文档时，带上文档标题，方便用户回查。',
      ].join('\n')

      kbCache = { at: now, text, count: kbs.length }
      return text
    }

    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      const CONTEXT_MODE = contextModeNow()
      loadInjectedState()
      try {
        if (!decision || decision.kind === 'reject') return decision
        if (payload && payload.signal && payload.signal.aborted) return decision
        if (CONTEXT_MODE === 'off') return decision
        // 设置里关掉「知识库问答」后完全不注入，模型也就不会去调知识库
        if (readConfig().kbQa === false) {
          logInject({ at: new Date().toISOString(), sid: sessionKeyOf(payload) || '', injected: false, reason: 'kbQa-off' })
          return decision
        }
        if (CONTEXT_MODE !== 'always') {
          const sid = sessionKeyOf(payload)
          if (sid) {
            if (injectedSessions.has(sid)) {
              logInject({ at: new Date().toISOString(), sid, injected: false, reason: 'seen' })
              return decision
            }
          } else if (injectedFallback) {
            // 拿不到会话 id 时退化成「本机只注入一次」，也好过每轮都塞
            logInject({ at: new Date().toISOString(), sid: '', injected: false, reason: 'fallback' })
            return decision
          }
        }

        const text = await buildKnowledgeContext()
        if (!text) return decision

        if (CONTEXT_MODE !== 'always') {
          const sid = sessionKeyOf(payload)
          if (sid) {
            if (injectedSessions.size > 500) injectedSessions.clear()
            injectedSessions.add(sid)
          } else {
            injectedFallback = true
          }
        }
        saveInjectedState()
        logInject({ at: new Date().toISOString(), sid: sessionKeyOf(payload), injected: true, mode: CONTEXT_MODE })
        console.log('[dsh-weknora] 已注入知识库说明（' + kbCache.count + ' 个库，mode=' + CONTEXT_MODE + '）')
        return {
          ...decision,
          messages: [
            ...decision.messages,
            createUserMessage({
              content: [{ type: 'text', text }],
              source: {
                kind: CONTEXT_KIND,
                form: 'snapshot',
                sections: [{ name: CONTEXT_KIND, text }],
              },
            }),
          ],
        }
      } catch (e) {
        console.warn('[dsh-weknora] 上下文注入失败：', e.message)
        return decision
      }
    }, { prepend: true })

    // ── 浏览器半的 HTTP 路由 ──
    // ---- Office 原件预览：借 DSH 自带的 LibreOffice 套件把 docx/xlsx/pptx 转成 PDF ----
    const OFFICE_EXTS = new Set(['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp'])

    function officeCliCandidates() {
      const out = []
      if (process.env.WEKNORA_PANEL_OFFICE_CLI) out.push(process.env.WEKNORA_PANEL_OFFICE_CLI)
      const rel = ['app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'cli.js']
      if (process.resourcesPath) out.push(path.join(process.resourcesPath, ...rel))
      const here = path.dirname(process.execPath)
      out.push(path.join(here, 'resources', ...rel))
      out.push(path.join(here, ...rel))
      out.push(path.join(__dirname, 'vendor', 'libreoffice-kit', 'lib', 'cli.js'))
      return out
    }

    function findOfficeCli() {
      for (const p of officeCliCandidates()) {
        try { if (p && fs.existsSync(p)) return p } catch (e) { /* 跳过 */ }
      }
      return ''
    }

    function runNodeCli(cliPath, args, timeoutMs) {
      const env = Object.assign({}, process.env)
      if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1'
      return new Promise((resolve, reject) => {
        execFile(process.execPath, [cliPath].concat(args), {
          env, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
        }, (err, stdout, stderr) => {
          if (err) {
            const msg = String(stderr || err.message || '').trim().split('\n').slice(-3).join(' ')
            const e = new Error(msg || 'Office 转换失败')
            e.code = err.killed ? 'timeout' : 'convert-failed'
            reject(e)
            return
          }
          resolve(stdout)
        })
      })
    }

    async function ensureOfficePdf(id) {
      const meta = await state.client.getFile(id)
      const name = String(meta.file_name || meta.title || '')
      let ext = (path.extname(name) || '').replace('.', '').toLowerCase()
      if (!ext) ext = String(meta.file_type || '').toLowerCase()
      if (!OFFICE_EXTS.has(ext)) {
        const e = new Error('这个文件不是 Office 格式（' + (ext || '未知') + '），没有原件可渲染')
        e.code = 'not-office'
        throw e
      }
      const dir = path.join(os.tmpdir(), 'dsh-weknora-office')
      fs.mkdirSync(dir, { recursive: true })
      const key = crypto.createHash('sha1').update(id + '|' + ext).digest('hex').slice(0, 16)
      const pdfPath = path.join(dir, key + '.pdf')
      const metaPath = path.join(dir, key + '.meta.json')
      // 缓存判定用源文件的 updated_at + 大小：文件没变就一直命中，
      // 比"6 小时后重转一次"省掉大量等待（大文档一次转换要好几秒）。
      const stamp = String(meta.updated_at || meta.updatedAt || '') + '|' + String(meta.file_size || '')
      if (fs.existsSync(pdfPath) && fs.existsSync(metaPath)) {
        try {
          const cached = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
          if (cached && cached.stamp === stamp) return { pdfPath, ext, name }
        } catch (e) { /* 缓存元数据坏了就当没有 */ }
      }
      const srcPath = path.join(dir, key + '.' + ext)
      const upstream = await state.client.downloadFile(id)
      fs.writeFileSync(srcPath, Buffer.from(await upstream.arrayBuffer()))
      const cli = findOfficeCli()
      if (!cli) {
        const e = new Error('没找到 DSH 的 office 套件（@deepseek-ai/libreoffice-kit），可用 WEKNORA_PANEL_OFFICE_CLI 指过去')
        e.code = 'no-office'
        throw e
      }
      if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath)
      await runNodeCli(cli, ['convert', '--input', srcPath, '--output', pdfPath, '--timeout-ms', '120000'], 180000)
      try { fs.writeFileSync(metaPath, JSON.stringify({ stamp, ext, at: Date.now() })) } catch (e) { /* 写不进也不影响本次 */ }
      return { pdfPath, ext, name }
    }

    // /pdf 与 /pdfpage 可能同时进来：同一个 id 只跑一次转换，避免两个 LibreOffice 进程写同一个文件
    const PDF_INFLIGHT = new Map()
    function ensureOfficePdfOnce(id) {
      if (PDF_INFLIGHT.has(id)) return PDF_INFLIGHT.get(id)
      const p = ensureOfficePdf(id).finally(() => { PDF_INFLIGHT.delete(id) })
      PDF_INFLIGHT.set(id, p)
      return p
    }

    // ── PDF 页码定位：让内嵌的 PDF 直接翻到命中段那一页 ──
    // 用 vendor 里的 pdfjs 逐页抽文本，找命中段的前 24 个字落在第几页。
    const PAGE_CACHE = new Map()
    let pdfjsMod = null

    async function loadPdfjs() {
      if (pdfjsMod) return pdfjsMod
      const base = path.join(__dirname, '..', 'vendor', 'pdfjs')
      const entry = path.join(base, 'pdf.mjs')
      if (!fs.existsSync(entry)) return null
      const { pathToFileURL } = require('url')
      const mod = await import(pathToFileURL(entry).href)
      const worker = path.join(base, 'pdf.worker.mjs')
      if (mod.GlobalWorkerOptions && fs.existsSync(worker)) {
        mod.GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href
      }
      pdfjsMod = mod
      return mod
    }

    function normText(s) {
      return String(s || '').replace(/[\s\u3000]+/g, '')
    }

    async function pageText(doc, p) {
      const page = await doc.getPage(p)
      const tc = await page.getTextContent()
      return normText(tc.items.map((i) => (i && i.str) || '').join(''))
    }

    async function findChunkPage(pdfPath, chunkText) {
      return findChunkPageMulti(pdfPath, [chunkText])
    }

    // 把一段候选文本切成滑动小片段：表格类 PDF（xlsx 转出来）一格里就几个字，
    // 整段 24 字的 needle 永远匹配不上，必须按片段累计命中数来判页。
    function shingles(clean, size, step, limit) {
      const out = []
      const seen = new Set()
      for (let i = 0; i + size <= clean.length && out.length < limit; i += step) {
        const s = clean.slice(i, i + size)
        if (seen.has(s)) continue
        seen.add(s)
        out.push(s)
      }
      return out
    }

    // 依次用候选文本找页：命中段本身 → 相邻分块（图片段没有文字，就用前后段定位）
    async function findChunkPageMulti(pdfPath, candidates) {
      const cleans = []
      for (const raw of candidates) {
        // 去掉图片语法，只留文字，否则整段都是 ![](resource://...)
        const clean = normText(String(raw || '').replace(/!\[[^\]]*\]\([^)]*\)/g, ''))
        if (clean.length >= 6) cleans.push(clean)
      }
      if (!cleans.length) return 0
      const mod = await loadPdfjs()
      if (!mod) return 0
      const data = new Uint8Array(fs.readFileSync(pdfPath))
      const doc = await mod.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise
      try {
        const pages = []
        for (let p = 1; p <= doc.numPages; p++) pages.push(await pageText(doc, p))

        // 1) 整段（截 24 字）精确命中 —— 正文类文档几乎都走这条
        for (const clean of cleans) {
          const needle = clean.slice(0, 24)
          for (let i = 0; i < pages.length; i++) {
            if (pages[i].includes(needle)) return i + 1
          }
        }
        // 2) 滑动片段打分：每页统计命中的片段数，取最高分的那一页
        let best = 0
        let bestScore = 0
        cleans.forEach((clean, ci) => {
          const parts = shingles(clean, 8, 4, 40)
          if (!parts.length) return
          const weight = ci === 0 ? 1 : 0.5 // 命中段本身权重更高，相邻段只做兜底
          for (let i = 0; i < pages.length; i++) {
            let hit = 0
            for (const part of parts) if (pages[i].includes(part)) hit++
            const score = hit * weight
            if (score > bestScore) { bestScore = score; best = i + 1 }
          }
        })
        // 至少命中 2 个片段才算找到，否则宁可从第一页看，也不要把用户带到错的页
        if (bestScore >= (cleans.length > 1 ? 1.5 : 2)) return best
        return 0
      } finally {
        try { await doc.destroy() } catch { /* 忽略 */ }
      }
    }

    // ── WeKnora 原生界面同源代理 ────────────────────────────
    // embed 页面是跨域 iframe，WeKnora 用 CSP frame-ancestors 挡着，而它的
    // 允许来源又不许填 *。所以把它的静态资源与 /api/v1 反代到本插件路径下：
    // iframe 用相对地址加载 → 同源 → 'self' 天然成立；顺手删掉它的 CSP 与
    // X-Frame-Options（反代响应头是我们能改的）。
    const UI_PREFIX = '/api/weknora/ui'

    function weknoraRoot() {
      const base = String(readConfig().baseUrl || '').replace(/\/+$/, '')
      return base.replace(/\/api\/v1$/, '')
    }

    // 页面里的绝对路径（/assets/…、/api/v1/…）都要挪到本插件前缀下。
    // 静态标记直接改字符串；运行时拼出来的 URL 交给注入的 shim 劫持
    // fetch / XMLHttpRequest / EventSource —— 靠正则改 JS 是不够的。
    const UI_SHIM = '<script>(function(){var P=' + JSON.stringify(UI_PREFIX) + ';'
      + 'function fix(u){try{if(typeof u!=="string")return u;if(u.indexOf(P)===0)return u;'
      + 'if(u.charAt(0)==="/")return P+u;return u}catch(e){return u}}'
      + 'var of=window.fetch;if(of)window.fetch=function(i,o){if(typeof i==="string")i=fix(i);'
      + 'else if(i&&i.url){try{i=new Request(fix(i.url),i)}catch(e){}}return of.call(this,i,o)};'
      + 'var oo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){'
      + 'var a=[].slice.call(arguments);a[1]=fix(u);return oo.apply(this,a)};'
      + 'var oe=window.EventSource;if(oe){var ES=function(u,c){return new oe(fix(u),c)};'
      + 'ES.prototype=oe.prototype;window.EventSource=ES}})();<\/script>'

    function rewriteAssetRefs(text, isHtml) {
      var out = String(text)
        .replace(/(['"`(])\/(api\/v1\/)/g, '$1' + UI_PREFIX + '/$2')
        .replace(/(['"`(])\/(assets\/)/g, '$1' + UI_PREFIX + '/$2')
        .replace(/(src|href)="\/(?!\/|api\/weknora\/ui\/)/g, '$1="' + UI_PREFIX + '/')
      if (isHtml) {
        out = out.replace(/<head([^>]*)>/i, '<head$1>' + UI_SHIM)
      }
      return out
    }

    function proxyWeKnoraUi(req, res, url, keepPath) {
      const root = weknoraRoot()
      if (!root) return sendJson(res, { ok: false, message: '还没配置 Base URL' }, 400)
      // keepPath=true：原样转发（/embed/<id> 这种必须保留路径，Vue 路由按 /embed/:channelId 匹配）
      const rest = keepPath
        ? (url.pathname + (url.search || ''))
        : (url.pathname.slice(UI_PREFIX.length) + (url.search || ''))
      let target
      try { target = new URL(root + (rest || '/')) } catch (e) {
        return sendJson(res, { ok: false, message: 'Base URL 不合法：' + e.message }, 400)
      }
      const headers = { ...req.headers, host: target.host, 'accept-encoding': 'identity' }
      delete headers.connection
      const up = http.request({
        method: req.method,
        hostname: target.hostname,
        port: target.port || 80,
        path: target.pathname + target.search,
        headers,
      }, (upRes) => {
        const ct = String(upRes.headers['content-type'] || '')
        const headers2 = { ...upRes.headers }
        delete headers2['content-security-policy']
        delete headers2['content-security-policy-report-only']
        delete headers2['x-frame-options']
        delete headers2['content-length']
        delete headers2['content-encoding']
        delete headers2['transfer-encoding']
        delete headers2.connection
        const rewrite = /text\/html|javascript|text\/css/.test(ct)
        if (!rewrite) {
          res.writeHead(upRes.statusCode || 200, headers2)
          upRes.pipe(res)
          return
        }
        const chunks = []
        upRes.on('data', (c) => chunks.push(c))
        upRes.on('end', () => {
          const body = Buffer.from(rewriteAssetRefs(Buffer.concat(chunks).toString('utf8'), /text\/html/.test(ct)), 'utf8')
          headers2['content-length'] = String(body.length)
          res.writeHead(upRes.statusCode || 200, headers2)
          res.end(body)
        })
      })
      up.on('error', (e) => {
        if (!res.headersSent) sendJson(res, { ok: false, message: '代理失败：' + e.message }, 502)
      })
      if (req.method && req.method !== 'GET' && req.method !== 'HEAD') req.pipe(up)
      else up.end()
      return Promise.resolve({ __sent: true })
    }

    const routes = {
      // 脱敏自检：直观证明「送模型前脱敏、答案回来前还原」这条链路是通的。
      // 注意：库里的分块、WeKnora 会话历史、最终答案都是原文 —— 这是设计，不是没脱敏。
      '/api/weknora/redact-test': async (req, res, url) => {
        const text = String(url.searchParams.get('text') || '')
        const cfg = readConfig()
        const mUrl = String(cfg.maskerUrl || '').replace(/\/+$/, '')
        if (!mUrl) return { ok: false, message: '没有配置脱敏服务地址（maskerUrl），见上方说明' }
        const out = { ok: true, maskerUrl: mUrl }
        try {
          const h = await fetch(mUrl + '/health').then((r) => r.json())
          out.ready = Boolean(h.ready)
          out.terms = h.terms
          out.patterns = h.patterns
          out.placeholders = h.placeholders
          out.revision = h.revision
        } catch (e) {
          return { ok: false, message: '连不上脱敏服务 ' + mUrl + '：' + e.message }
        }
        if (!text) return out
        try {
          const r1 = await fetch(mUrl + '/redact', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ texts: [text] }),
          }).then((r) => r.json())
          const redacted = (r1.texts || [])[0] || ''
          const r2 = await fetch(mUrl + '/restore', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ texts: [redacted] }),
          }).then((r) => r.json())
          out.redacted = redacted
          out.restored = (r2.texts || [])[0] || ''
          out.changed = redacted !== text
        } catch (e) {
          out.message = '脱敏请求失败：' + e.message
        }
        return out
      },

      // 面板里直接读写连接配置（不用重启、不用环境变量）
      '/api/weknora/config': async (req) => {
        if ((req.method || 'GET').toUpperCase() === 'GET') {
          const saved = readSavedConfig()
          const bundled = readBundledConfig()
          const envBase = envAny('WEKNORA_BASE_URL', 'WEKNORA_BASE')
          const envKey = envAny('WEKNORA_API_KEY')
          const fromFile = Boolean(saved.baseUrl || saved.apiKey)
          const fromBundled = Boolean(!fromFile && (bundled.baseUrl || bundled.apiKey))
          const fromEnv = Boolean(!fromFile && !fromBundled && (envBase || envKey))
          const pick = fromFile ? saved : (fromBundled ? bundled : { baseUrl: envBase, apiKey: envKey })
          return {
            ok: true,
            baseUrl: pick.baseUrl || '',
            hasKey: Boolean(pick.apiKey),
            keyMasked: mask(pick.apiKey),
            source: fromFile ? 'file' : (fromBundled ? 'bundled' : (fromEnv ? 'env' : 'none')),
            configPath: CONFIG_PATH,
            bundledPath: BUNDLED_CONFIG_PATH,
            contextMode: readConfig().contextMode || 'once',
            directAnswer: !!readConfig().directAnswer,
            kbQa: readConfig().kbQa !== false,
            embedUrl: readConfig().embedUrl || '',
          }
        }
        const body = await readBody(req)
        if (body.clear) {
          try { fs.unlinkSync(CONFIG_PATH) } catch { /* 本来就没有 */ }
          reloadClient()
          return { ok: true, cleared: true, message: '已清除保存的配置' }
        }
        const saved = readSavedConfig()
        const patch = {}
        // 行为开关可以单独保存，不必带连接信息
        if (body.kbQa !== undefined) {
          patch.kbQa = !(body.kbQa === false || body.kbQa === 'false' || body.kbQa === '0' || body.kbQa === 'off')
        }
        if (body.directAnswer !== undefined) {
          patch.directAnswer = body.directAnswer === true || body.directAnswer === 'true' || body.directAnswer === 1
        }
        if (body.contextMode !== undefined) {
          const m = String(body.contextMode || '').toLowerCase()
          patch.contextMode = (m === 'always' || m === 'off') ? m : 'once'
        }
        if (body.embedUrl !== undefined) patch.embedUrl = String(body.embedUrl || '').trim()
        const baseUrl = unquote(body.baseUrl)
        const apiKey = unquote(body.apiKey)
        if (baseUrl) patch.baseUrl = baseUrl
        if (apiKey) patch.apiKey = apiKey
        if (!patch.baseUrl && !patch.apiKey && !patch.contextMode && patch.directAnswer === undefined && patch.embedUrl === undefined) {
          return { ok: false, message: '没有要保存的内容' }
        }
        const merged = { ...saved, ...patch }
        const onlyEmbed = Object.keys(patch).length === 1 && patch.embedUrl !== undefined
        if (!onlyEmbed && !merged.baseUrl) return { ok: false, message: 'Base URL 不能为空，例如 http://<你的服务器>:8088/api/v1' }
        if (!onlyEmbed && !merged.apiKey) return { ok: false, message: 'API Key 不能为空' }
        writeSavedConfig(patch)
        reloadClient()
        let reachable = false
        let kbCount = 0
        let error = ''
        try {
          const kbs = await state.client.listKnowledgeBases()
          reachable = true
          kbCount = kbs.length
        } catch (e) { error = e.message }
        return {
          ok: true,
          saved: true,
          baseUrl: merged.baseUrl,
          keyMasked: mask(merged.apiKey),
          reachable,
          kbCount,
          error,
          contextMode: merged.contextMode || 'once',
          directAnswer: !!merged.directAnswer,
          embedUrl: merged.embedUrl || '',
          configPath: CONFIG_PATH,
        }

      },

      // WeKnora 原生界面：填了 embed 渠道地址就整块 iframe 用它的前端渲染
      '/api/weknora/embed': async (req) => {
        if ((req.method || 'GET').toUpperCase() === 'POST') {
          const body = await readBody(req)
          const u = String((body && body.url) || '').trim()
          writeSavedConfig({ embedUrl: u })
          return { ok: true, saved: true, url: u }
        }
        const c = readConfig()
        return { ok: true, url: c.embedUrl || '', baseUrl: c.baseUrl || '' }
      },

      // 可切换的智能体（面板问答的下拉框）
      '/api/weknora/agents': async () => {
        const miss = requireConfigured()
        if (miss) return { ok: false, configured: false, message: JSON.parse(miss.text).message }
        try {
          const agents = await state.client.listAgents()
          return { ok: true, agents, defaultAgentId: 'builtin-quick-answer' }
        } catch (e) { return { ok: false, error: e.code || 'unknown', message: e.message } }
      },

      // 会话历史（WeKnora 左侧历史列表用的同一批接口）
      '/api/weknora/sessions': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) return JSON.parse(miss.text)
        try {
          const page = Number(url.searchParams.get('page') || 1)
          const pageSize = Number(url.searchParams.get('pageSize') || 40)
          const sessions = await state.client.listSessions({ page, pageSize })
          return { ok: true, sessions }
        } catch (e) { return { ok: false, sessions: [], message: e.message } }
      },

      '/api/weknora/messages': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) return JSON.parse(miss.text)
        try {
          const sid = url.searchParams.get('sid') || ''
          if (!sid) return { ok: false, messages: [], message: '缺 sid' }
          const limit = Number(url.searchParams.get('limit') || 50)
          const raw = await state.client.loadMessages(sid, { limit })
          // 历史里的 <kb ...> 也换成 [N]，编号走全局表 —— 打开旧会话一样有可点角标
          const messages = raw.map((m) => {
            if (m.role !== 'assistant') return m
            const cited = inlineCitations(m.content || '')
            return { ...m, content: cited.text, cites: cited.cites }
          })
          return { ok: true, sessionId: sid, messages }
        } catch (e) { return { ok: false, messages: [], message: e.message } }
      },

      '/api/weknora/session': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) return JSON.parse(miss.text)
        try {
          const id = url.searchParams.get('id') || ''
          const action = url.searchParams.get('action') || ''
          if (!id) return { ok: false, message: '缺 id' }
          if (action === 'delete') {
            await state.client.deleteSession(id)
            return { ok: true, deleted: id }
          }
          if (action === 'rename') {
            const title = url.searchParams.get('title') || ''
            await state.client.renameSession(id, title)
            return { ok: true, title }
          }
          return { ok: false, message: '未知 action' }
        } catch (e) { return { ok: false, message: e.message } }
      },

      // 新会话欢迎页的推荐问题（走 WeKnora 自己的推荐接口）
      '/api/weknora/suggested': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) return JSON.parse(miss.text)
        try {
          const agentId = url.searchParams.get('agentId') || 'builtin-quick-answer'
          const kbId = url.searchParams.get('kbId') || undefined
          const questions = await state.client.suggestedQuestions({ agentId, knowledgeBaseId: kbId })
          return { ok: true, questions }
        } catch (e) { return { ok: false, questions: [], message: e.message } }
      },

      '/api/weknora/status': async () => {
        const base = {
          ok: true,
          configured: state.client.configured,
          contextMode: readConfig().contextMode || 'once',
          baseUrl: state.client.baseUrl,
          keyMasked: mask(state.client.apiKey),
          webUrl: state.client.baseUrl ? state.client.baseUrl.replace(/\/api\/v\d+$/i, '') : '',
          reachable: false,
          kbCount: 0,
          error: '',
        }
        if (!state.client.configured) return { ...base, error: '' }
        try {
          const kbs = await state.client.listKnowledgeBases()
          return { ...base, reachable: true, kbCount: kbs.length }
        } catch (e) {
          return { ...base, error: e.message, code: e.code || 'unknown' }
        }
      },

      '/api/weknora/knowledgeBases': async () => {
        const miss = requireConfigured()
        if (miss) return { ok: false, configured: false, message: JSON.parse(miss.text).message }
        try {
          const kbs = await state.client.listKnowledgeBases()
          return { ok: true, knowledgeBases: kbs }
        } catch (e) { return { ok: false, error: e.code || 'unknown', message: e.message } }
      },

      '/api/weknora/files': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) return { ok: false, configured: false, message: JSON.parse(miss.text).message }
        const kbId = url.searchParams.get('kbId')
        if (!kbId) return { ok: false, message: '缺少 kbId' }
        const folderPath = url.searchParams.get('folderPath') || ''
        try {
          const r = await state.client.listFiles(kbId, {
            keyword: url.searchParams.get('keyword') || '',
            page: 1,
            pageSize: 200,
          })
          // 服务端这版没有按 folder_path 过滤的 query 参数（KnowledkiListFilter
          // 里有字段但 handler 没读），所以在宿主侧过滤 + 分页。
          let items = r.items || []
          if (url.searchParams.has('folderPath')) {
            const exact = url.searchParams.get('subtree') === '1'
            items = items.filter((k) => {
              const p = String(k.folder_path || '')
              return exact ? (p === folderPath || p.startsWith(folderPath + '/')) : p === folderPath
            })
          }
          const total = items.length
          const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
          const pageSize = Math.min(Number(url.searchParams.get('pageSize')) || 100, 200)
          const slice = items.slice((page - 1) * pageSize, page * pageSize)
          return { ok: true, items: slice, total, page, hasMore: page * pageSize < total }
        } catch (e) { return { ok: false, error: e.code || 'unknown', message: e.message } }
      },

      '/api/weknora/folders': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) return { ok: false, configured: false, message: JSON.parse(miss.text).message }
        const kbId = url.searchParams.get('kbId')
        if (!kbId) return { ok: false, message: '缺少 kbId' }
        try {
          const r = await state.client.listFolders(kbId)
          return { ok: true, folders: r.folders, rootDocumentCount: r.rootDocumentCount, totalDocumentCount: r.totalDocumentCount }
        } catch (e) { return { ok: false, error: e.code || 'unknown', message: e.message } }
      },

      // 上传：前端用 XHR 把文件字节直接 POST 过来（不走 multipart，省一次编码），
      // ?kbId=&name=&folderPath= 三个参数。进度条由前端 xhr.upload.onprogress 驱动。
      '/api/weknora/upload': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) { sendJson(res, JSON.parse(miss.text), 401); return { __sent: true } }
        const kbId = url.searchParams.get('kbId')
        const name = url.searchParams.get('name')
        const folderPath = url.searchParams.get('folderPath') || ''
        if (!kbId || !name) { sendJson(res, { ok: false, message: '缺少 kbId / name' }, 400); return { __sent: true } }
        try {
          const buf = await readRawBody(req)
          if (!buf || !buf.length) { sendJson(res, { ok: false, message: '文件是空的' }, 400); return { __sent: true } }
          const data = await state.client.uploadFile(kbId, { name, folderPath, buffer: buf })
          sendJson(res, { ok: true, file: data })
        } catch (e) {
          sendJson(res, { ok: false, error: e.code || 'unknown', message: e.message }, 400)
        }
        return { __sent: true }
      },

      // 下载原件：必须 attachment，否则 docx/xlsx 会被浏览器当内联内容处理，点了没反应。
      '/api/weknora/download': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) { sendJson(res, { ok: false, configured: false }); return { __sent: true } }
        const id = url.searchParams.get('id')
        if (!id) { sendJson(res, { ok: false, message: '缺少 id' }, 400); return { __sent: true } }
        const file = await state.client.getFile(id).catch(() => null)
        const upstream = await state.client.downloadFile(id)
        await pipeUpstream(res, upstream, {
          fileName: (file && (file.file_name || file.title)) || 'download',
          inline: false,
        })
        return { __sent: true }
      },

      '/api/weknora/file': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) return { ok: false, configured: false, message: JSON.parse(miss.text).message }
        const id = url.searchParams.get('id')
        if (!id) return { ok: false, message: '缺少 id' }
        try {
          return { ok: true, file: await state.client.getFile(id) }
        } catch (e) { return { ok: false, error: e.code || 'unknown', message: e.message } }
      },

      '/api/weknora/text': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) return { ok: false, configured: false, message: JSON.parse(miss.text).message }
        const id = url.searchParams.get('id')
        if (!id) return { ok: false, message: '缺少 id' }
        try {
          const file = await state.client.getFile(id).catch(() => null)
          const chunks = await state.client.readAllChunks(id)
          const kbId = url.searchParams.get('kbId')
            || (file && file.knowledge_base_id)
            || (chunks[0] && chunks[0].knowledge_base_id)
            || ''
          const raw = chunks.map((c) => String(c.content || '')).join('\n\n')
          return {
            ok: true,
            chunks: chunks.length,
            total: chunks.length,
            // 每段的 id 给前端做「命中段标黄」用
            items: chunks.map((c) => ({
              id: c.id,
              chunk_index: c.chunk_index,
              content: state.client.renderResourceUrls(kbId, String(c.content || '')),
            })),
            content: state.client.renderResourceUrls(kbId, raw),
          }
        } catch (e) { return { ok: false, error: e.code || 'unknown', message: e.message } }
      },

      // 下载/内联原件：图片、音视频、"下载原件"按钮都走这里
      '/api/weknora/content': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) { sendJson(res, { ok: false, configured: false }); return { __sent: true } }
        const id = url.searchParams.get('id')
        if (!id) { sendJson(res, { ok: false, message: '缺少 id' }, 400); return { __sent: true } }
        const file = await state.client.getFile(id).catch(() => null)
        const upstream = await state.client.downloadFile(id)
        await pipeUpstream(res, upstream, { fileName: file && (file.file_name || file.title) })
        return { __sent: true }
      },

      // 正文里的 resource:// 图片引用
      '/api/weknora/resource': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) { sendJson(res, { ok: false, configured: false }); return { __sent: true } }
        const kbId = url.searchParams.get('kbId')
        const filePath = url.searchParams.get('filePath')
        if (!kbId || !filePath) { sendJson(res, { ok: false, message: '缺少 kbId / filePath' }, 400); return { __sent: true } }
        const upstream = await state.client.getResource(kbId, filePath)
        await pipeUpstream(res, upstream, { fallbackType: 'application/octet-stream' })
        return { __sent: true }
      },

      '/api/weknora/search': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) return { ok: false, configured: false, message: JSON.parse(miss.text).message }
        const q = (url.searchParams.get('q') || '').trim()
        if (!q) return { ok: false, message: '缺少 q' }
        const matchCount = Math.min(Number(url.searchParams.get('matchCount')) || 10, 30)
        const kbId = url.searchParams.get('kbId')
        try {
          let hits
          if (kbId) {
            hits = await state.client.hybridSearch(kbId, { queryText: q, matchCount })
          } else {
            const kbs = await state.client.listKnowledgeBases()
            hits = await state.client.searchKnowledge({ query: q, knowledgeBaseIds: kbs.map((k) => k.id), matchCount })
          }
          return { ok: true, query: q, results: hits }
        } catch (e) { return { ok: false, error: e.code || 'unknown', message: e.message } }
      },

      // 面板问答：交给 WeKnora 服务端一次跑完（15 秒左右），答案正文里自带内联出处
      '/api/weknora/ask': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) return { ok: false, configured: false, message: JSON.parse(miss.text).message }
        const q = (url.searchParams.get('q') || '').trim()
        if (!q) return { ok: false, message: '缺少 q' }
        const kbId = url.searchParams.get('kbId')
        try {
          const r = await state.client.ask({
            query: q,
            knowledgeBaseIds: kbId ? [kbId] : undefined,
          })
          return {
            ok: true,
            answer: r.answer,
            references: r.references,
            sessionId: r.sessionId,
            elapsedMs: r.elapsedMs,
          }
        } catch (e) { return { ok: false, error: e.code || 'unknown', message: e.message } }
      },

      // 面板问答（流式）：把 WeKnora 的 SSE 字节原样转给浏览器。
      // 面板拿到的是逐帧的 answer，能边生成边渲染；agent 工具走的还是上面那个一次性 /ask。
      '/api/weknora/ask-stream': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) { sendJson(res, JSON.parse(miss.text), 401); return { __sent: true } }
        const q = (url.searchParams.get('q') || '').trim()
        if (!q) { sendJson(res, { ok: false, message: '缺少 q' }, 400); return { __sent: true } }
        const kbId = url.searchParams.get('kbId')
        try {
          const agentId = url.searchParams.get('agentId') || undefined
          const resumeSid = url.searchParams.get('sessionId') || undefined
          const { sessionId, response: upstream } = await state.client.askStream({
            query: q,
            knowledgeBaseIds: kbId ? [kbId] : undefined,
            agentId,
            sessionId: resumeSid,
          })
          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store, no-transform',
            connection: 'keep-alive',
            'x-weknora-session': sessionId,
            // 关掉 nginx 之类的缓冲，否则流会被攒成一坨
            'x-accel-buffering': 'no',
          })
          const { Readable } = require('stream')
          const body = Readable.fromWeb(upstream.body)
          body.on('error', () => { try { res.end() } catch { /* 忽略 */ } })
          body.pipe(res)
          await new Promise((resolve) => {
            res.on('close', resolve)
            res.on('finish', resolve)
            body.on('end', resolve)
            body.on('error', resolve)
          })
          return { __sent: true }
        } catch (e) {
          sendJson(res, { ok: false, error: e.code || 'unknown', message: e.message }, 400)
          return { __sent: true }
        }
      },

      // 角标短码 → chunk id（会话正文里只放 `[1](dsh-weknora:c/<短码>)`）
      '/api/weknora/ledger': async (req, res, url) => {
        // 返回某次 ask 的角标编号表（k 为空时返回最近一次），供浏览器半装饰 [1]。
        const cites = [...citeIndex.entries()]
          .map(([n, v]) => ({ n, chunkId: v.chunkId, doc: v.doc }))
          .sort((a, b) => a.n - b.n)
        sendJson(res, { ok: true, cites })
        return { __sent: true }
      },
      '/api/weknora/cite': async (req, res, url) => {
        const k = (url.searchParams.get('k') || '').trim()
        if (!k) return { ok: false, message: '缺少 k' }
        const hit = resolveCite(k)
        if (!hit) return { ok: false, message: '这条出处已经失效（插件重装过？），请重新提问' }
        return { ok: true, chunkId: hit.chunkId, doc: hit.doc }
      },

      // 角标原文：<kb chunk_id="..."> 直接取那一段
      '/api/weknora/live': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) { sendJson(res, JSON.parse(miss.text), 401); return { __sent: true } }
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        })
        const send = (obj) => {
          try { res.write('data: ' + JSON.stringify(obj) + '\n\n') } catch (e) { /* 客户端已断开 */ }
        }
        let closed = false
        req.on('close', () => { closed = true })
        const attach = (live) => {
          send({ type: 'init', done: live.done, text: live.buf, error: live.error })
          if (live.done) { send({ type: 'done' }); try { res.end() } catch (e) { /* 忽略 */ } return }
          const sub = (ev) => {
            send(ev)
            if (ev.type === 'done') { try { res.end() } catch (e) { /* 忽略 */ } }
          }
          live.subs.add(sub)
          req.on('close', () => { live.subs.delete(sub) })
        }
        const want = url.searchParams.get('k') || liveLastKey
        const live = want ? liveStreams.get(want) : null
        if (live) { attach(live); return { __sent: true } }

        // 工具卡片往往先渲染、后执行：这里等一会儿，别急着回空。
        let tries = 0
        const timer = setInterval(() => {
          tries += 1
          const hit = liveLastKey ? liveStreams.get(liveLastKey) : null
          if (hit) {
            clearInterval(timer)
            if (!closed) attach(hit)
            return
          }
          if (closed || tries > 100) {
            clearInterval(timer)
            if (!closed) { send({ type: 'empty' }); try { res.end() } catch (e) { /* 忽略 */ } }
          }
        }, 300)
        return { __sent: true }
      },
      '/api/weknora/chunk': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) return { ok: false, configured: false, message: JSON.parse(miss.text).message }
        const id = (url.searchParams.get('id') || '').trim()
        if (!id) return { ok: false, message: '缺少 id' }
        try {
          const c = await state.client.getChunk(id)
          if (!c) return { ok: false, message: '没有找到这个分块' }
          return {
            ok: true,
            chunk_id: c.id,
            knowledge_id: c.knowledge_id,
            knowledge_base_id: c.knowledge_base_id,
            chunk_index: c.chunk_index,
            content: c.content || '',
          }
        } catch (e) { return { ok: false, error: e.code || 'unknown', message: e.message } }
      },

      // 命中段在原件 PDF 的第几页：前端拿到后把 iframe 的 #page=N 带上
      '/api/weknora/pdfpage': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) return { ok: false, configured: false, message: JSON.parse(miss.text).message }
        const id = (url.searchParams.get('id') || '').trim()
        const chunk = (url.searchParams.get('chunk') || '').trim()
        if (!id) return { ok: false, message: '缺少 id' }
        try {
          const out = await ensureOfficePdfOnce(id)
          if (!chunk) return { ok: true, page: 0 }
          const key = id + '|' + chunk
          if (PAGE_CACHE.has(key)) return { ok: true, page: PAGE_CACHE.get(key) }
          const c = await state.client.getChunk(chunk).catch(() => null)
          const needles = [(c && c.content) || '']
          if (c && typeof c.chunk_index === 'number') {
            const all = await state.client.readAllChunks(id).catch(() => [])
            const prev = all.find((x) => x.chunk_index === c.chunk_index - 1)
            const next = all.find((x) => x.chunk_index === c.chunk_index + 1)
            if (prev && prev.content) needles.push(prev.content)
            if (next && next.content) needles.push(next.content)
          }
          const page = await findChunkPageMulti(out.pdfPath, needles)
          PAGE_CACHE.set(key, page)
          return { ok: true, page }
        } catch (e) { return { ok: false, error: e.code || 'unknown', message: e.message } }
      },

      // Office 原件：用 DSH 的 LibreOffice 套件把 docx/xlsx/pptx 渲成 PDF，浏览器直接内嵌
      '/api/weknora/pdf': async (req, res, url) => {
        const sendErr = (msg, status, code) => {
          const body = JSON.stringify({ ok: false, error: code || 'error', message: msg })
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
          res.end(body)
          return { __sent: true }
        }
        const miss = requireConfigured()
        if (miss) return sendErr(JSON.parse(miss.text).message, 400, 'not-configured')
        const id = (url.searchParams.get('id') || '').trim()
        if (!id) return sendErr('缺少 id', 400, 'bad-request')
        try {
          const out = await ensureOfficePdfOnce(id)
          const st = fs.statSync(out.pdfPath)
          res.writeHead(200, {
            'content-type': 'application/pdf',
            'content-length': st.size,
            'content-disposition': 'inline; filename="preview.pdf"',
            'cache-control': 'private, max-age=600',
          })
          fs.createReadStream(out.pdfPath).pipe(res)
          return { __sent: true }
        } catch (e) {
          return sendErr(String((e && e.message) || e), 500, (e && e.code) || 'convert-failed')
        }
      },
    }

    // ── 把 vendor 里的 pdfjs 交给浏览器（客户端渲染要用，不塞进 bundle）──
    function serveVendorPdfjs(res, name) {
      const safe = path.basename(String(name || ''))
      const file = path.join(__dirname, '..', 'vendor', 'pdfjs', safe)
      const ok = /^pdf(\.worker)?\.mjs$/.test(safe)
      if (!ok || !fs.existsSync(file)) {
        const body = 'not found'
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body) })
        res.end(body)
        return { __sent: true }
      }
      const st = fs.statSync(file)
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'content-length': st.size,
        'cache-control': 'private, max-age=3600',
      })
      fs.createReadStream(file).pipe(res)
      return { __sent: true }
    }

    // ── 内置阅读器：沿用 paper-reader 的 reader/index.html ──────────────
    // 页面只调四个接口：/api/library、/api/paper、/api/pdf、/api/theme。
    // 页面地址 = /api/weknora/reader/ ，它自己推出 PR_API_BASE = /api/weknora/reader/api
    const READER_PREFIX = '/api/weknora/reader'
    const READER_MIME = {
      '.mjs': 'text/javascript; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.ttf': 'font/ttf',
      '.wasm': 'application/wasm',
      '.json': 'application/json; charset=utf-8',
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
    }
    const readerDir = () => path.join(__dirname, '..', 'reader')
    const readerFilesCache = new Map()

    function sendText(res, text, status) {
      const buf = Buffer.from(String(text), 'utf8')
      res.writeHead(status || 200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': buf.length })
      res.end(buf)
      return { __sent: true }
    }

    function sendReaderAsset(res, rel) {
      const safe = String(rel || '').replace(/\\/g, '/').split('/').filter((x) => x && x !== '.' && x !== '..').join('/')
      if (!safe) return sendText(res, 'not found', 404)
      const file = path.join(readerDir(), 'vendor', safe)
      let st
      try { st = fs.statSync(file) } catch (e) { return sendText(res, 'not found', 404) }
      if (!st.isFile()) return sendText(res, 'not found', 404)
      res.writeHead(200, {
        'content-type': READER_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'content-length': st.size,
        'cache-control': 'private, max-age=86400',
      })
      fs.createReadStream(file).pipe(res)
      return { __sent: true }
    }

    async function readerFilesOf(kbId) {
      const hit = readerFilesCache.get(kbId)
      if (hit && Date.now() - hit.at < 60000) return hit.items
      const r = await state.client.listFiles(kbId, { page: 1, pageSize: 200 })
      const items = (r && r.items) || []
      readerFilesCache.set(kbId, { at: Date.now(), items })
      return items
    }

    async function readerResolveFile(kbId, name) {
      const items = await readerFilesOf(kbId).catch(() => [])
      const hit = items.find((f) => f.id === name || f.title === name || f.file_name === name || f.fileName === name)
      if (hit) return hit
      return state.client.getFile(name).catch(() => null)
    }

    async function serveReaderApi(res, url, rs) {
      // 新式：/api/weknora/r?p=/library（p 是接口名，其余 query 原样透传）
      // 旧式：/reader/api/library（保留兼容）
      const qp = url.searchParams.get('p') || ''
      const sub = qp
        ? ('/api' + (qp.charAt(0) === '/' ? qp : '/' + qp))
        : String(rs || url.pathname.slice(READER_PREFIX.length)).slice('/reader'.length)
      const miss = requireConfigured()
      if (miss) return sendJson(res, { ok: false, message: JSON.parse(miss.text).message }, 400)

      if (sub === '/api/library') {
        const kbs = (await state.client.listKnowledgeBases()) || []
        const topics = []
        const papers = []
        for (const kb of kbs) {
          const items = await readerFilesOf(kb.id).catch(() => [])
          const names = []
          for (const f of items) {
            const name = f.title || f.file_name || f.fileName || f.id
            names.push({ name })
            papers.push({ topic: kb.id, name, pdfPath: f.id, size: f.file_size || 0, mtime: 0 })
          }
          topics.push({ topic: kb.id, name: kb.name, papers: names })
        }
        return sendJson(res, { dataDir: readerDir(), topics, papers, tree: [] })
      }

      if (sub === '/api/paper') {
        const topic = url.searchParams.get('topic') || ''
        const name = url.searchParams.get('name') || ''
        const f = await readerResolveFile(topic, name)
        if (!f) return sendJson(res, { error: 'not found' }, 404)
        return sendJson(res, {
          topic,
          name: f.title || name,
          pdfPath: f.title || name,
          pdfBytes: f.file_size || 0,
          hasTranscript: false,
          chars: 0,
          hasPageIndex: false,
          pageCount: null,
        })
      }

      if (sub === '/api/pdf') {
        const topic = url.searchParams.get('topic') || ''
        const name = url.searchParams.get('name') || ''
        const f = await readerResolveFile(topic, name)
        if (!f) return sendText(res, '文档不存在', 404)
        let out
        try {
          out = await ensureOfficePdfOnce(f.id)
        } catch (e) {
          console.warn('[dsh-weknora] 原件转 PDF 失败：', e.message)
          return sendText(res, '原件转 PDF 失败：' + e.message, 500)
        }
        const st = fs.statSync(out.pdfPath)
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-length': st.size,
          'cache-control': 'private, max-age=600',
        })
        fs.createReadStream(out.pdfPath).pipe(res)
        return { __sent: true }
      }

      if (sub === '/api/theme') return sendJson(res, { ok: true })
      return sendJson(res, { ok: false, message: '未知的阅读器接口：' + sub }, 404)
    }

    function serveReaderPage(res, base) {
      const file = path.join(readerDir(), 'index.html')
      if (!fs.existsSync(file)) return sendText(res, '阅读器文件缺失（reader/index.html）', 404)
      const b = String(base || '/api/weknora/reader/')
      const html = fs.readFileSync(file, 'utf8')
        .replace(/__DPR_VERSION__/g, 'weknora')
        // 页面里写死的 /paper-reader/vendor/... 要在本插件前缀下才取得到
        .replace(/(href|src)="\/paper-reader\//g, '$1="' + b)
        // location 推导失败时的兜底也必须落回本插件
        .replace(/const fallback = '\/paper-reader\/';/, "const fallback = '" + b + "';")
        // 阅读器的接口前缀改成「两级 + ?p=」，避开宿主不转发三级路径的问题
        .replace("const PR_API_BASE = PR_ASSET_BASE + 'api';", "const PR_API_BASE = '/api/weknora/r?';")
        .replace('const api = (p, opts) => fetch(PR_API_BASE + p, opts)',
          "const api = (p, opts) => { const qi = p.indexOf('?'); const pth = qi >= 0 ? p.slice(0, qi) : p; const qs = qi >= 0 ? p.slice(qi + 1) + '&' : ''; return fetch(PR_API_BASE + qs + 'p=' + encodeURIComponent(pth), opts) }")
        .replace("return `${PR_API_BASE}/pdf?${q}${variant ? '&variant=' + variant : ''}`;",
          "return `/api/weknora/r?${q}${variant ? '&variant=' + variant : ''}&p=%2Fpdf`;")
      const buf = Buffer.from(html, 'utf8')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': buf.length, 'cache-control': 'no-store' })
      res.end(buf)
      return { __sent: true }
    }

    ctx.inject(['webServer'], (webCtx) => {
      webCtx.effect(() => webCtx.webServer.register({
        path: '/api/weknora',
        handler: async (req, res) => {
          let url
          try { url = new URL(req.url || '/', 'http://x') } catch { return sendJson(res, { error: 'bad url' }, 400) }

          if (url.pathname.indexOf(UI_PREFIX + '/') === 0) {
            return proxyWeKnoraUi(req, res, url)
          }

          const VENDOR_PREFIX = '/api/weknora/pdfjs/'
          if (url.pathname.indexOf(VENDOR_PREFIX) === 0) {
            return serveVendorPdfjs(res, url.pathname.slice(VENDOR_PREFIX.length))
          }

          // 阅读器全部落在 /api/weknora 之下，保持「两级路径」——
          // DSH 的一个插件只能注册一个入口前缀，多注册会把前面的挤掉。
          //   页面   /api/weknora/reader
          //   静态   /api/weknora/vendor/<file>
          //   接口   /api/weknora/r?p=/library&topic=..&name=..
          if (url.pathname === '/api/weknora/reader' || url.pathname === '/api/weknora/reader/') {
            return serveReaderPage(res, '/api/weknora/')
          }
          if (url.pathname.indexOf('/api/weknora/vendor/') === 0) {
            return sendReaderAsset(res, url.pathname.slice('/api/weknora/vendor/'.length))
          }
          if (url.pathname === '/api/weknora/r') {
            return serveReaderApi(res, url, '')
          }

          const fn = routes[url.pathname]
          if (!fn) {
            return sendJson(res, {
              ok: false,
              error: 'unknown_action',
              message: '这个接口不存在（' + url.pathname + '）。通常意味着插件更新后 DSH 还没重启。',
            }, 404)
          }
          try {
            const result = await fn(req, res, url)
            if (result && result.__sent) return
            return sendJson(res, result)
          } catch (e) {
            if (e instanceof WeKnoraAuthError) {
              return sendJson(res, { ok: false, error: 'auth', message: e.message }, 401)
            }
            console.warn('[dsh-weknora] 路由处理失败：', e.message)
            if (!res.headersSent) return sendJson(res, { ok: false, error: (e && e.code) || 'unknown', message: e.message })
            try { res.end() } catch { /* 已断开 */ }
          }
        },
      }), 'dsh-weknora-panel: /api/weknora routes')


      console.log('[dsh-weknora] HTTP 路由已注册：/api/weknora/{status,knowledgeBases,files,file,text,content,resource,search,ask,chunk,cite,pdf,pdfpage,pdfjs} + /embed 代理')
    })

    ctx.effect(() => () => { console.log('[dsh-weknora] 插件卸载') })
  },
}
