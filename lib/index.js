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

// ── 拆出去的模块 ────────────────────────────────────────
const config = require('./config')
const store = require('./store')
const httpUtil = require('./http')
const cite = require('./cite')
const { loadDefineTool, loadCreateUserMessage, localDefineTool, textOutput, jsonText, fail } = require('./util/tools')
const {
  CONFIG_PATH, BUNDLED_CONFIG_PATH, CONTEXT_STATE_PATH, CONTEXT_LOG_PATH, envAny, readJsonQuiet,
  readSavedConfig, readBundledConfig, writeSavedConfig, readConfig, mask,
} = config
const {
  loadCites, saveCitesSoon, shortFor, resolveCite, CITES_PATH,
} = store
const { sendJson, readRawBody, readBody, MIME, mimeOf, pipeUpstream } = httpUtil
const { citeLink, PLACEHOLDER_RE, restorePlaceholders, inlineCitations, liveStreams, askLedger, liveKeyFor, pumpSse } = cite

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
              // 库级 chunk_count 常常是 0/空，和单篇文档的 chunks 对不上；为 0 时给 null，避免用户误判"未解析"
              chunkCount: (Number(k.chunk_count) || 0) > 0 ? Number(k.chunk_count) : null,
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
          const topScore = hits.reduce((m, h) => Math.max(m, Number(h.score) || 0), 0)
          const lowRelevance = hits.length > 0 && topScore < 0.45
          return jsonText({
            ok: true, query, scope: kbId ? 'knowledge_base' : 'all', count: hits.length,
            lowRelevance,
            hits: hits.map((h, i) => ({
              rank: i + 1,
              knowledge_id: h.knowledge_id,
              title: h.knowledge_title || h.knowledge_filename || '',
              fileName: h.knowledge_filename || '',
              score: Number(h.score) || 0,
              matchType: h.match_type === 1 ? 'keyword' : 'vector',
              chunk_id: h.id || '',
              chunkIndex: h.chunk_index ?? null,
              snippet: String(h.matched_content || h.content || '').slice(0, 600),
              // 引用这个片段时，把 cite 原样贴在句末 —— 会话里会渲染成可点的蓝色角标
              cite: h.id ? citeLink(i + 1, h.id, h.knowledge_title || h.knowledge_filename || '') : '',
            })),
            next: hits.length
              ? (lowRelevance
                ? '注意：这些命中相关度偏低（top1 score ' + topScore.toFixed(3) + '），很可能库里没有覆盖这个问题。'
                  + '回答前先跟用户说明“知识库可能没有直接相关的内容”，不要硬凑成制度依据。'
                : '回答里引用某条命中时，把它那行的 cite 值原样放在句末（如「…规定[1](dsh-weknora:c/…)。」），'
                  + '会话里就会显示可点角标。需要完整上下文时，用 ' + TOOL_PREFIX + 'read_document 传 hits[].knowledge_id 读整篇原文。')
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
            // 逐段引用要用 chunk_id：给出分块清单（最多 200 条，避免工具输出过长）
            items: chunks.slice(0, 200).map((ck) => ({
              chunk_id: ck.id,
              chunkIndex: ck.chunk_index ?? null,
              chars: String(ck.content || '').length,
              preview: String(ck.content || '').replace(/\s+/g, ' ').slice(0, 60),
            })),
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
    // DSH 会话 id → WeKnora 会话 id：同一会话在 WeKnora 侧复用同一个 session，
    // 追问能带上上文（原来每次问答都新建会话，导致「那第二条呢」这类指代没有上下文）。
    const QA_SESSIONS_PATH = path.join(path.dirname(CONFIG_PATH), 'dsh-weknora-sessions.json')
    const QA_LOG_PATH = path.join(path.dirname(CONFIG_PATH), 'dsh-weknora-qa.log')
    const qaSessions = new Map()
    let qaSessionsTimer = null
    try {
      const rawQs = fs.readFileSync(QA_SESSIONS_PATH, 'utf8')
      const objQs = JSON.parse(rawQs)
      Object.keys(objQs || {}).forEach((k) => { if (objQs[k]) qaSessions.set(k, String(objQs[k])) })
    } catch (e) { /* 首次运行没有文件 */ }
    function saveQaSessionsSoon() {
      if (qaSessionsTimer) return
      qaSessionsTimer = setTimeout(() => {
        qaSessionsTimer = null
        try {
          const obj = {}
          for (const [k, v] of qaSessions) obj[k] = v
          fs.writeFileSync(QA_SESSIONS_PATH, JSON.stringify(obj, null, 2), { mode: 0o600 })
        } catch (e) { /* 落盘失败不影响问答 */ }
      }, 2000)
      if (qaSessionsTimer.unref) qaSessionsTimer.unref()
    }
    // 把「这一轮实际发出去的问题」记一行，用来核对有没有被 agent 改写
    function logQaTurn(info) {
      try {
        fs.appendFileSync(QA_LOG_PATH, new Date().toISOString() + ' ' + JSON.stringify(info) + '\n')
      } catch (e) { /* 日志失败忽略 */ }
    }
    // 本会话是否已经「直接放行」过一次问答（第一次直出，之后交给模型结合上下文）
    const askAnswered = new Set()
    // 快答直出：开着时本会话第一次问答不再让模型复述（答案只在工具卡片里）；
    // 关着时（默认）模型照常输出一次，正文里就有完整答案。
    function directAnswerNow() {
      const v = readConfig().directAnswer
      // 默认关：直出（concludeTurn）后本轮直接结束，DSH 不会生成正文 ——
      // 用户明确要求「答案要出现在正文里」，所以交回模型复述。
      // 为了防止模型把短码抄坏，短码已从 8 位 hex 缩到 5 位 base36，且装饰器会隐藏抄坏的标记。
      if (v === undefined || v === null || v === '') return false
      return v === true || v === '1' || v === 'true' || v === 'on'
    }

    register({
      name: TOOL_PREFIX + 'ask',
      description: '用 WeKnora 服务端直接回答知识库问题：检索、生成、引用在服务端一次跑完，'
        + '只占一次工具往返，比「先 search、再 read_document、再自己写答案」快数倍。'
        + '用户问制度/产品/文档内容类问题时**优先用这个**。'
        + '**这个工具返回的正文就是最终答案本身**：里面已经有完整标题层级、表格、列表、加粗和每句后面的出处标记，'
        + '把它们原样交给用户即可 —— 不要改写、不要概括、不要压缩、不要重排、不要省略表格或任何一段，'
        + '最多在开头加一句「以下是知识库的回答：」。'
        + '如果答案本身自称「WeKnora」「腾讯开发的智能助手」，回答时不要照抄这个身份，'
        + '用「知识库」或「益办公知识库」代替。'
        + '返回正文里每句/每段后面带着**纯文本**出处编号 [1]、[2]、[3]…（这是插件认得出的角标，'
        + '不是给人看的脚注）。**必须原样保留这些 [n] 标记**：不要删、不要改成（《文件名》）、不要挪到末尾集中列，'
        + '保留后插件会在会话里把它们渲染成可点角标，点一下在右侧栏打开原文并标黄。'
        + '**query 参数会被忽略**：插件始终把用户这一轮的原话原样发给 WeKnora，'
        + '你不要改写、缩写或补充用户的问题（改写会让检索跑偏）。'
        + '要逐字原文时把编号对应的 chunk 交给 ' + TOOL_PREFIX + 'read_chunk（用 ' + TOOL_PREFIX + 'search 或 read_document 拿 chunk_id）。',
      parameters: {
        query: { type: 'string', description: '可留空。插件会自动改用用户这一轮的原话（agent 改写过的问句会让检索跑偏）' },
        knowledge_base_id: { type: 'string', description: '限定某个知识库 id；省略则查当前全部库' },
      },
      output: textOutput(),
      async execute(args, exec) {
        const miss = requireConfigured()
        if (miss) return miss
        // 用户的原话优先：agent 常把问题改写成更"技术"的问句，那会让 WeKnora 搜偏。
        // 只有本轮没有记录到用户原话（例如非会话场景）才退回 agent 给的 query。
        const rawUser = (qaState.lastUserText || '').trim()
        const argQuery = String((args && args.query) || '').trim()
        // agent 明确传的 query 是它理解后的问题，比 pre-step 从消息流里猜的可靠；
        // 原话只作兜底（子代理等旁路消息已在上游被过滤）。
        const query = sanitizeText(argQuery || rawUser)
        if (query) console.log('[dsh-weknora] ask query=' + query.slice(0, 80) + (argQuery ? '（来自参数）' : '（来自原话兜底）'))
        // DSH 会话 id（本会话复用同一个 WeKnora session 用它做键）
        let dsSid = ''
        try {
          const ag = exec && exec.agent
          const s1 = ag && ag.session
          dsSid = String((s1 && (s1.id || s1.sessionId)) || (ag && ag.sessionId) || '')
        } catch (e) { dsSid = '' }
        const wkSid = dsSid ? (qaSessions.get(dsSid) || '') : ''
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
            let started
            try {
              started = await state.client.askStream({
                query: String(query).trim(),
                knowledgeBaseIds: kbIds,
                sessionId: wkSid || undefined,
              })
            } catch (e1) {
              // 复用的会话在 WeKnora 侧不存在了（服务重启/被删）：丢掉映射，重新建一个再问
              if (!wkSid) throw e1
              if (dsSid) { qaSessions.delete(dsSid); saveQaSessionsSoon() }
              started = await state.client.askStream({ query: String(query).trim(), knowledgeBaseIds: kbIds })
            }
            if (dsSid && started && started.sessionId) {
              if (qaSessions.get(dsSid) !== started.sessionId) {
                qaSessions.set(dsSid, String(started.sessionId))
                saveQaSessionsSoon()
              }
            }
            logQaTurn({ dsSid: dsSid, wkSid: started && started.sessionId, reused: !!wkSid, rawUser: rawUser.slice(0, 200), argQuery: argQuery.slice(0, 200), sent: String(query).trim().slice(0, 200) })
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
          if (!cites.length) {
            // 不给最终用户追加内部提示：答案里出现工具名会显得是机器拼的。
            text = answer
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

    // 用户这一轮的原话（跳过我们注入的知识库说明），用于「原样发给 WeKnora」
    // 用户输入里可能出现「孤立代理字符」（U+DC80–U+DCFF）：这是某个环节把 UTF-8 字节
    // 按单字节解码的残留，比如「住」→ "\udcae\udcae"。它会让 WeKnora 侧收到坏文本，
    // 回答里再回显成 ~ / ? 这类替换字符。发出去之前统一清洗掉。
    function sanitizeText(s) {
      if (typeof s !== 'string') return ''
      let out = ''
      for (const ch of s) {
        const cp = ch.codePointAt(0)
        if (cp >= 0xd800 && cp <= 0xdfff) continue   // 孤立代理，直接丢
        out += ch
      }
      return out
    }

    function lastUserTextOf(payload) {
      const msgs = (payload && payload.messages) || []
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i]
        if (!m || m.role !== 'user') continue
        const src = m.source || {}
        if (src.kind === CONTEXT_KIND) continue
        // 子代理的 spawn/编排消息也会以 user 角色落进父会话，取到它就会把子代理 prompt
        // 当成用户原话发给 WeKnora（表现为「知识库问答返回子代理的答案」）。
        const srcKind = String(src.kind || '')
        if (/subagent|spawn|delegate|parallel|workflow/i.test(srcKind)) continue
        const c = m.content
        const peek = typeof c === 'string' ? c : ''
        if (peek && /Your parent agent id is|你是(一个)?(测试)?子代理|subagent task/i.test(peek.slice(0, 400))) continue
        if (typeof c === 'string') {
          const t = c.trim()
          if (t) return sanitizeText(t)
        } else if (Array.isArray(c)) {
          const t = c
            .filter((p) => p && (p.type === 'text' || p.type === 'input_text') && typeof p.text === 'string')
            .map((p) => p.text)
            .join('\n')
            .trim()
          if (t) return sanitizeText(t)
        }
      }
      return ''
    }

    ctx.on('agent/pre-step', async (payload, next) => {
      try { const raw = lastUserTextOf(payload); if (raw) qaState.lastUserText = raw } catch (e) { /* 取不到就算了 */ }
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


    // ── 极简 PDF 阅读器（pdfjs 官方 PDFViewer 组件，无论文功能）──
    // 页面地址就是 /api/weknora/vw/index.html，所以页面里的 ./xxx 相对路径
    // 天然解析到 /api/weknora/vw/xxx，不需要再重写 HTML。
    const VIEWER_DIR = path.join(__dirname, '..', 'viewer-official')
    const VIEWER_MIME = {
      '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
      '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif',
      '.bcmap': 'application/octet-stream', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
      '.wasm': 'application/wasm',
    }

    function sendViewerAsset(res, rel) {
      const clean = String(rel || '').replace(/\.\./g, '').replace(/^\/+/, '') || 'index.html'
      const file = path.join(VIEWER_DIR, clean)
      if (!file.startsWith(VIEWER_DIR)) { sendJson(res, { error: 'forbidden' }, 403); return { __sent: true } }
      return new Promise((resolve) => {
        fs.readFile(file, (err, buf) => {
          if (err) { sendJson(res, { error: 'not found: ' + clean }, 404); return resolve({ __sent: true }) }
          const ext = path.extname(file).toLowerCase()
          res.writeHead(200, {
            'content-type': VIEWER_MIME[ext] || 'application/octet-stream',
            'content-length': buf.length,
            'cache-control': ext === '.html' ? 'no-store' : 'private, max-age=86400',
          })
          res.end(buf)
          resolve({ __sent: true })
        })
      })
    }

    // 表格解析结果缓存：同一份 xlsx 反复点开不必重复解压
const SHEET_CACHE = new Map()

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

      // 可切换的智能体（面板问答的下拉框）

      // 会话历史（WeKnora 左侧历史列表用的同一批接口）



      // 新会话欢迎页的推荐问题（走 WeKnora 自己的推荐接口）

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


      // 表格原件：直接解析 xlsx/csv 成二维数组，前端渲染成真表格（比转 PDF 好读得多）
      '/api/weknora/sheet': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) return { ok: false, message: JSON.parse(miss.text).message }
        const id = (url.searchParams.get('id') || '').trim()
        if (!id) return { ok: false, message: '缺少 id' }
        const key = 'sheet|' + id
        if (SHEET_CACHE.has(key)) return SHEET_CACHE.get(key)
        try {
          // downloadFile 返回的是 fetch Response（不是 Buffer）——直接丢给 XLSX.read
          // 会永远解析出空表。
          const resp = await state.client.downloadFile(id)
          const buf = Buffer.from(await resp.arrayBuffer())
          const XLSX = require(path.join(__dirname, '..', 'vendor', 'xlsx'))
          const wb = XLSX.read(buf, { type: 'buffer' })
          const sheetNames = (wb.SheetNames || []).map(String)
          // 照 WeKnora：sheet_to_html 保留合并单元格，并给每个单元格 id（sheet-0-A1），
          // 前端靠这个 id 把 locator 的行号映射到 <tr>。
          const sheets = sheetNames.slice(0, 8).map((name, i) => ({
            name,
            html: XLSX.utils.sheet_to_html(wb.Sheets[name], { id: 'sheet-' + i }),
          }))
          const out = { ok: true, sheetNames, sheets }
          SHEET_CACHE.set(key, out)
          return out
        } catch (e) {
          return { ok: false, message: String((e && e.message) || e) }
        }
      },

      // 定位/高亮的实现（WeKnora sourceLocator*.ts 的移植）也给 PDF viewer 页面用，
      // 三种预览共用同一份逻辑，避免各写一套。
      '/api/weknora/locatejs': async (req, res) => {
        try {
          const js = fs.readFileSync(path.join(__dirname, '..', 'build', 'src', '43-locate.js'))
          res.writeHead(200, {
            'content-type': 'text/javascript; charset=utf-8',
            'content-length': js.length,
            'cache-control': 'private, max-age=600',
          })
          res.end(js)
          return { __sent: true }
        } catch (e) {
          return { ok: false, message: String((e && e.message) || e) }
        }
      },

      // 命中位置由 WeKnora 入库时算好（internal/types/source_locator.go）：
      // pdf 给 page/bbox、docx 给 block、sheet 给 sheet/row_start/row_end，都带 quote。
      // 前端只负责按这些坐标去 DOM 里找，不再自己猜页码或段落。
      '/api/weknora/locators': async (req, res, url) => {
        const miss = requireConfigured()
        if (miss) return { ok: false, message: JSON.parse(miss.text).message }
        const chunkId = (url.searchParams.get('chunk') || '').trim()
        if (!chunkId) return { ok: false, message: '缺少 chunk' }
        try {
          const ch = await state.client.getChunk(chunkId)
          if (!ch) return { ok: false, message: '找不到这个分块' }
          return {
            ok: true,
            locators: ch.source_locators || [],
            content: String(ch.content || ''),
            knowledgeId: ch.knowledge_id || '',
            kbId: ch.knowledge_base_id || '',
          }
        } catch (e) {
          return { ok: false, message: String((e && e.message) || e) }
        }
      },

      // Office 原件：用 DSH 的 LibreOffice 套件把 docx/xlsx/pptx 渲成 PDF，浏览器直接内嵌

      // docx-preview 运行时：浏览器端把 .docx 渲染成保留排版的 HTML
      '/api/weknora/docxjs': async (req, res) => {
        try {
          const js = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'docx', 'docx-preview.bundle.js'))
          res.writeHead(200, {
            'content-type': 'text/javascript; charset=utf-8',
            'content-length': js.length,
            'cache-control': 'private, max-age=86400',
          })
          res.end(js)
        } catch (e) {
          sendJson(res, { ok: false, message: 'docx 运行时缺失：' + e.message }, 500)
        }
        return { __sent: true }
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

      // 面板问答（流式）：把 WeKnora 的 SSE 字节原样转给浏览器。
      // 面板拿到的是逐帧的 answer，能边生成边渲染；agent 工具走的还是上面那个一次性 /ask。

      // 前端把诊断写到这里：DSH 的界面我看不到，只能让现场留痕。
      '/api/weknora/diag': async (req, res) => {
        try {
          const buf = await readRawBody(req)
          const bodyText = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '')
          const line = new Date().toISOString() + ' ' + String(bodyText).slice(0, 2000) + '\n'
          fs.appendFileSync(path.join(path.dirname(CONFIG_PATH), 'dsh-weknora-diag.log'), line)
        } catch { /* 诊断失败不影响功能 */ }
        return sendJson(res, { ok: true })
      },
      '/api/weknora/cite': async (req, res, url) => {
        const k = (url.searchParams.get('k') || '').trim()
        if (!k) return { ok: false, message: '缺少 k' }
        const hit = resolveCite(k)
        if (!hit) return { ok: false, message: '这条出处已经失效（插件重装过？），请重新提问' }
        return { ok: true, chunkId: hit.chunkId, doc: hit.doc }
      },

      // 角标原文：<kb chunk_id="..."> 直接取那一段
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

    ctx.inject(['webServer'], (webCtx) => {
      webCtx.effect(() => webCtx.webServer.register({
        path: '/api/weknora',
        handler: async (req, res) => {
          let url
          try { url = new URL(req.url || '/', 'http://x') } catch { return sendJson(res, { error: 'bad url' }, 400) }


          const VENDOR_PREFIX = '/api/weknora/pdfjs/'
          if (url.pathname.indexOf(VENDOR_PREFIX) === 0) {
            return serveVendorPdfjs(res, url.pathname.slice(VENDOR_PREFIX.length))
          }

          // 极简阅读器（官方 PDFViewer 组件）：页面 + 它自己的 js/css/cmaps/图片
          if (url.pathname.indexOf('/api/weknora/vw/') === 0) {
            return sendViewerAsset(res, url.pathname.slice('/api/weknora/vw/'.length))
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


      console.log('[dsh-weknora] HTTP 路由已注册：/api/weknora/{config,status,redact-test,diag,knowledgeBases,folders,files,upload,download,file,text,content,resource,search,chunk,cite,pdf,pdfpage,pdfjs}')
    })

    ctx.effect(() => () => { console.log('[dsh-weknora] 插件卸载') })
  },
}
