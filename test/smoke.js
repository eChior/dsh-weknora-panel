/**
 * smoke.js — WeKnora 客户端冒烟测试（不碰浏览器半）
 *
 * 运行：node test/smoke.js
 * 需要先设置环境变量：
 *   WEKNORA_BASE_URL=http://<你的服务器>:8088/api/v1
 *   WEKNORA_API_KEY=sk-...
 *
 * 覆盖：库列表 → 文件列表 → 混合检索 → 跨库检索 → 分块拼全文 → 原件下载
 */
const { WeKnoraClient, WeKnoraAuthError } = require('../lib/weknora-client')

const baseUrl = String(process.env.WEKNORA_BASE_URL || '').trim()
const apiKey = String(process.env.WEKNORA_API_KEY || '').trim()

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name, extra || '') }
  else { fail++; console.log('  FAIL', name, extra || '') }
}

async function main() {
  if (!baseUrl || !apiKey) {
    console.log('FAIL: 需要 WEKNORA_BASE_URL 与 WEKNORA_API_KEY')
    process.exit(1)
  }

  const client = new WeKnoraClient({ baseUrl, apiKey })
  console.log('baseUrl:', client.baseUrl, '| key:', apiKey.slice(0, 5) + '****')
  console.log('')

  // 1. 库列表
  let kbs = []
  try {
    kbs = await client.listKnowledgeBases()
    check('listKnowledgeBases', kbs.length > 0, `${kbs.length} 个库`)
  } catch (e) {
    check('listKnowledgeBases', false, e.message)
    if (e instanceof WeKnoraAuthError) process.exit(1)
    return
  }

  const target = kbs.find((k) => (k.knowledge_count || 0) > 0) || kbs[0]
  if (!target) { console.log('FAIL: 没有可测试的知识库'); process.exit(1) }
  console.log(`\n目标库：${target.name}（${target.knowledge_count || 0} 篇 / ${target.chunk_count || 0} 分块）\n`)

  // 2. 文件列表
  let firstFile = null
  try {
    const r = await client.listFiles(target.id, { pageSize: 20 })
    check('listFiles', r.items.length > 0, `${r.items.length} 条，total=${r.total}`)
    firstFile = r.items.find((it) => it.parse_status === 'completed') || r.items[0]
    if (firstFile) console.log('  样本文件：', firstFile.title || firstFile.file_name, '·', firstFile.file_type)
  } catch (e) {
    check('listFiles', false, e.message)
  }

  // 3. 单库混合检索
  const q = '报销标准'
  try {
    const hits = await client.hybridSearch(target.id, { queryText: q, matchCount: 3 })
    check('hybridSearch', hits.length > 0, `"${q}" 命中 ${hits.length} 条`)
    if (hits[0]) {
      console.log('  首条：', hits[0].knowledge_title, '· score', hits[0].score)
      console.log('  片段：', String(hits[0].matched_content || hits[0].content).slice(0, 80).replace(/\s+/g, ' '), '…')
    }
  } catch (e) {
    check('hybridSearch', false, e.message)
  }

  // 4. 跨库检索
  try {
    const hits = await client.searchKnowledge({
      query: q,
      knowledgeBaseIds: kbs.map((k) => k.id),
      matchCount: 3,
    })
    check('searchKnowledge(跨库)', Array.isArray(hits), `命中 ${hits.length} 条`)
  } catch (e) {
    check('searchKnowledge(跨库)', false, e.message)
  }

  // 5. 分块拼全文
  if (firstFile) {
    try {
      const chunks = await client.readAllChunks(firstFile.id)
      const text = chunks.map((c) => c.content || '').join('\n')
      check('readAllChunks', chunks.length > 0 && text.length > 0,
        `${chunks.length} 块 / ${text.length} 字`)
      console.log('  开头：', text.slice(0, 80).replace(/\s+/g, ' '), '…')
    } catch (e) {
      check('readAllChunks', false, e.message)
    }

    // 6. 原件下载（只看状态码与字节数）
    try {
      const res = await client.downloadFile(firstFile.id)
      const buf = Buffer.from(await res.arrayBuffer())
      check('downloadFile', buf.length > 0, `${(buf.length / 1024).toFixed(0)} KB · ${res.headers.get('content-type')}`)
    } catch (e) {
      check('downloadFile', false, e.message)
    }
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('未捕获错误：', e); process.exit(1) })
