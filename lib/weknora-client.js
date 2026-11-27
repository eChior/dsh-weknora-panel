/**
 * dsh-weknora — WeKnora REST 客户端（宿主半专用）
 *
 * 只跑在 Node 侧：API Key 永远不出宿主进程，浏览器半一律走 /api/weknora/* 代理。
 *
 * 接口依据 WeKnora v0.6.x 实机验证结果：
 *   GET  /knowledge-bases                        库列表
 *   GET  /knowledge-bases/:id/knowledge          文件列表（keyword / page / page_size）
 *   GET  /knowledge/:id                          文件详情
 *   GET  /chunks/:knowledge_id                   分块（page / page_size）
 *   POST /knowledge-bases/:id/hybrid-search      单库混合检索
 *   POST /knowledge-search                       跨库混合检索
 *   GET  /knowledge/search?keyword=&limit=       按名搜文件
 *   GET  /knowledge/:id/download                 下载原件
 *   GET  /knowledge-bases/:id/files?file_path=   图片资源代理
 */

const DEFAULT_TIMEOUT_MS = 20000
const MAX_CHUNK_PAGES = 200

class WeKnoraError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'WeKnoraError'
    this.code = options.code || 'unknown'
    this.status = options.status || 0
    this.body = options.body
  }
}

class WeKnoraAuthError extends WeKnoraError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 'auth' })
    this.name = 'WeKnoraAuthError'
    this.needRebind = true
  }
}

/** 剥掉成对包裹的引号：setx "..." 会把引号一起存进环境变量，new URL 会直接报 Invalid URL */
// Node < 17.3 没有 AbortSignal.timeout；Win7 上常见的兼容 Node 可能是 14/16。
// 自己包一层，两个平台、新旧版本都能用。
function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)     // 注意：这里必须是 AbortSignal.timeout，不能是 timeoutSignal（会无限递归）
  }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(new Error('timeout after ' + ms + 'ms')), ms)
  if (t.unref) t.unref()
  return ctrl.signal
}

function unquote(raw) {
  let s = String(raw == null ? '' : raw).trim()
  for (let i = 0; i < 3; i++) {
    const a = s[0]
    const b = s[s.length - 1]
    if (s.length >= 2 && (a === '"' || a === "'" || a === '`') && a === b) {
      s = s.slice(1, -1).trim()
    } else break
  }
  return s
}

/** 规范化 baseUrl：剥引号、去尾斜杠；没有 /api/v1 就补上（用户可能只填到端口） */
function normalizeBaseUrl(raw) {
  let s = unquote(raw)
  if (!s) return ''
  s = s.replace(/\/+$/, '')
  if (!/\/api\/v\d+$/i.test(s)) s += '/api/v1'
  return s
}

class WeKnoraClient {
  constructor(config = {}) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl)
    this.apiKey = unquote(config.apiKey)
    this.tenantId = String(config.tenantId || '').trim()
    this.timeoutMs = Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : DEFAULT_TIMEOUT_MS
  }

  get configured() {
    return Boolean(this.baseUrl && this.apiKey)
  }

  headers(extra) {
    const h = { 'content-type': 'application/json' }
    if (this.apiKey) h['X-API-Key'] = this.apiKey
    if (this.tenantId) h['X-Tenant-ID'] = this.tenantId
    return { ...h, ...(extra || {}) }
  }

  /** 拼绝对 URL，query 里 undefined/null 一律丢掉 */
  url(path, query) {
    const u = new URL(this.baseUrl + path)
    for (const [k, v] of Object.entries(query || {})) {
      if (v === undefined || v === null || v === '') continue
      u.searchParams.set(k, String(v))
    }
    return u.toString()
  }

  /** 拿原始 Response（下载 / 图片流用，不做 JSON 解析） */
  async requestRaw(path, { method = 'GET', query, body, signal } = {}) {
    if (!this.configured) {
      throw new WeKnoraAuthError('WeKnora 未配置：需要 WEKNORA_BASE_URL 与 WEKNORA_API_KEY')
    }
    const timeout = timeoutSignal(this.timeoutMs)
    const res = await fetch(this.url(path, query), {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw this.toError(res.status, text)
    }
    return res
  }

  /** JSON 请求：统一解包 {data: ...} */
  async request(path, options = {}) {
    const res = await this.requestRaw(path, options)
    const text = await res.text()
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      throw new WeKnoraError('WeKnora 返回的不是 JSON', { code: 'bad-json', body: text.slice(0, 300) })
    }
  }

  toError(status, bodyText) {
    let message = bodyText || `HTTP ${status}`
    try {
      const parsed = JSON.parse(bodyText)
      message = parsed.error || parsed.message || message
      if (typeof message === 'object') message = JSON.stringify(message)
    } catch { /* 保持原文 */ }
    if (status === 401 || status === 403) {
      return new WeKnoraAuthError(message, { status, body: bodyText })
    }
    return new WeKnoraError(message, { status, body: bodyText })
  }

  // ── 知识库 ──────────────────────────────────────────────
  async listKnowledgeBases() {
    const r = await this.request('/knowledge-bases')
    return Array.isArray(r?.data) ? r.data : (Array.isArray(r) ? r : [])
  }

  // ── 文件 ────────────────────────────────────────────────
  async listFiles(kbId, { keyword = '', page = 1, pageSize = 30 } = {}) {
    const r = await this.request(`/knowledge-bases/${encodeURIComponent(kbId)}/knowledge`, {
      query: { keyword, page, page_size: pageSize },
    })
    const data = r?.data
    const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : [])
    return {
      items,
      total: r?.total ?? data?.total ?? items.length,
      page: r?.page ?? page,
      hasMore: Boolean(r?.has_more ?? data?.has_more ?? false),
    }
  }

  /** 知识库文件夹树（GET /knowledge-bases/:id/knowledge/folders） */
  async listFolders(kbId) {
    const r = await this.request(`/knowledge-bases/${encodeURIComponent(kbId)}/knowledge/folders`)
    const d = r?.data ?? {}
    return {
      folders: Array.isArray(d.folders) ? d.folders : [],
      rootDocumentCount: d.root_document_count ?? 0,
      totalDocumentCount: d.total_document_count ?? 0,
    }
  }

  /**
   * 上传一个文件。folderPath 用「相对路径」传给 WeKnora 的 fileName 表单字段，
   * 服务端 SplitKnowledgeRelativePath 会把它拆成 folder_path + 文件名，
   * 于是文件自动落到对应分组里。
   */
  async uploadFile(kbId, { name, folderPath = '', buffer }) {
    const fd = new FormData()
    const rel = folderPath ? `${folderPath}/${name}` : name
    fd.append('file', new Blob([buffer]), name)
    fd.append('fileName', rel)
    // FormData 的 boundary 必须由 fetch 自己生成：这里只能带认证头，
    // 一旦带上 content-type: application/json，服务端会报
    // "request Content-Type isn't multipart/form-data"。
    const auth = this.headers()
    delete auth['content-type']
    const res = await fetch(`${this.baseUrl}/knowledge-bases/${encodeURIComponent(kbId)}/knowledge/file`, {
      method: 'POST',
      headers: auth,
      body: fd,
      signal: timeoutSignal(600000),
    })
    const text = await res.text()
    let body = null
    try { body = JSON.parse(text) } catch { /* 非 JSON */ }
    if (!res.ok || (body && body.success === false)) {
      throw this.toError(res.status, text)
    }
    return body?.data ?? body
  }

  async getFile(id) {
    const r = await this.request(`/knowledge/${encodeURIComponent(id)}`)
    return r?.data ?? r
  }

  /** 按分块 id 读单段（答案里的 <kb chunk_id="..."/> 就是它的 id） */
  async getChunk(chunkId) {
    const r = await this.request('/chunks/by-id/' + encodeURIComponent(chunkId))
    return (r && r.data) || r || null
  }

  async listChunks(knowledgeId, { page = 1, pageSize = 50 } = {}) {
    const r = await this.request(`/chunks/${encodeURIComponent(knowledgeId)}`, {
      query: { page, page_size: pageSize },
    })
    const data = r?.data
    const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : [])
    return {
      items,
      total: r?.total ?? data?.total ?? items.length,
      hasMore: Boolean(r?.has_more ?? data?.has_more ?? items.length >= pageSize),
    }
  }

  /**
   * 分块拼全文。预览用 —— WeKnora 的 chunk 已经是脱敏后的正文，
   * 按 seq_id 排序后拼起来就是文档当前可读内容。
   */
  async readAllChunks(knowledgeId, { maxChunks = 2000 } = {}) {
    const out = []
    let page = 1
    while (page <= MAX_CHUNK_PAGES && out.length < maxChunks) {
      const r = await this.listChunks(knowledgeId, { page, pageSize: 50 })
      if (!r.items.length) break
      out.push(...r.items)
      if (!r.hasMore) break
      page += 1
    }
    out.sort((a, b) => (a.seq_id ?? a.chunk_index ?? 0) - (b.seq_id ?? b.chunk_index ?? 0))
    return out.slice(0, maxChunks)
  }

  // ── 检索 ────────────────────────────────────────────────
  async hybridSearch(kbId, { queryText, matchCount = 8, knowledgeIds } = {}) {
    const body = { query_text: queryText, match_count: matchCount }
    if (Array.isArray(knowledgeIds) && knowledgeIds.length) body.knowledge_ids = knowledgeIds
    const r = await this.request(`/knowledge-bases/${encodeURIComponent(kbId)}/hybrid-search`, {
      method: 'POST',
      body,
    })
    return Array.isArray(r?.data) ? r.data : []
  }

  async searchKnowledge({ query, knowledgeBaseIds, matchCount = 10 } = {}) {
    const body = { query, match_count: matchCount }
    if (Array.isArray(knowledgeBaseIds) && knowledgeBaseIds.length) {
      body.knowledge_base_ids = knowledgeBaseIds
    }
    const r = await this.request('/knowledge-search', { method: 'POST', body })
    return Array.isArray(r?.data) ? r.data : []
  }

  async findDocuments({ keyword, limit = 20 } = {}) {
    const r = await this.request('/knowledge/search', { query: { keyword, limit } })
    return Array.isArray(r?.data) ? r.data : (Array.isArray(r) ? r : [])
  }

  // ── 原件 ────────────────────────────────────────────────
  // ── 服务端问答（SSE：检索 + 生成 + 引用一次完成） ──────
  /** 建会话：WeKnora 的问答必须挂在 session 上 */
  async createSession(title = 'DSH 面板') {
    const r = await this.request('/sessions', { method: 'POST', body: { title } })
    const id = (r && r.data && r.data.id) || (r && r.id)
    if (!id) throw new WeKnoraError('创建会话失败：响应里没有 id', { code: 'no-session' })
    return id
  }

  /**
   * 一次服务端问答：检索 + 生成 + 引用全在 WeKnora 内部跑完。
   * 相比在 DSH 里「检索 → 读原文 → 自己生成」的多轮来回，往返从 3~5 次降到 1 次。
   * 返回 { answer, thinking, references:[{knowledgeId,title,chunkIndex,score,excerpt,length}], sessionId, events, elapsedMs }
   */
  /**
   * 起一个问答会话并返回**未解析的 SSE Response**（宿主把它的字节原样转给浏览器，
   * 面板就能边生成边显示，而不是等 20 秒一次性蹦出来）。
   */
  /** 会话列表（WeKnora 左侧历史用的同一个接口）。 */

  /** 历史消息（含 knowledge_references）。 */

  /** 新会话欢迎页的推荐问题（WeKnora 自己的推荐接口）。 */

  /** 可用的智能体（问答用的 agent_id 从这里挑）。 */

  async askStream({ query, knowledgeBaseIds, agentId = 'builtin-quick-answer', sessionId } = {}) {
    const q = String(query || '').trim()
    if (!q) throw new WeKnoraError('问题不能为空', { code: 'empty-query' })
    // 传了 sessionId 就接着这个会话问（多轮带上下文，和 WeKnora 网页端一致）
    const sid = sessionId || (await this.createSession(q.slice(0, 40)))
    const kbIds = Array.isArray(knowledgeBaseIds) && knowledgeBaseIds.length ? knowledgeBaseIds : undefined
    const res = await fetch(this.url('/agent-chat/' + encodeURIComponent(sid)), {
      method: 'POST',
      headers: { ...this.headers(), accept: 'text/event-stream' },
      body: JSON.stringify({
        query: q,
        knowledge_base_ids: kbIds,
        agent_id: agentId || undefined,
        agent_enabled: false,
        disable_title: true,
        channel: 'api',
      }),
      signal: timeoutSignal(300000),
    })
    if (!res.ok) throw this.toError(res.status, await res.text().catch(() => ''))
    return { sessionId: sid, response: res }
  }

  downloadFile(id) {
    return this.requestRaw(`/knowledge/${encodeURIComponent(id)}/download`)
  }

  getResource(kbId, filePath) {
    return this.requestRaw(`/knowledge-bases/${encodeURIComponent(kbId)}/files`, {
      query: { file_path: filePath },
    })
  }

  /** WeKnora Web UI 的库页面（深链） */

  /**
   * 把正文里的 `resource://xxx` 换成浏览器可取的代理地址。
   * 浏览器拿不到 API Key，所以必须走宿主的 /api/weknora/resource。
   */
  renderResourceUrls(kbId, text) {
    if (!text) return ''
    return String(text).replace(/resource:\/\/([A-Za-z0-9_\-.:]+)/g, (_m, id) =>
      `/api/weknora/resource?kbId=${encodeURIComponent(kbId || '')}&filePath=${encodeURIComponent('resource://' + id)}`
    )
  }
}

module.exports = {
  WeKnoraClient,
  WeKnoraError,
  WeKnoraAuthError,
  normalizeBaseUrl,
  unquote,
}
