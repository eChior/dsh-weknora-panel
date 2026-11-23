/**
 * 角标与脱敏兜底：<kb> 标签 → 短码标记；占位符还原；会话内实时流。
 */
const crypto = require('crypto')
const { readConfig } = require('./config')
const { shortFor, getCiteSeq, setCiteSeq, addCite, saveCiteIndexSoon } = require('./store')

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

function inlineCitations(text) {
  const cites = []
  if (!text || text.indexOf('<kb ') < 0) return { text: String(text || ''), cites }
  const seen = new Map()
  // 编号必须「全局唯一」：正文里的 [3] 指向哪个 chunk 只能由这张表决定。
  // 曾经缩成「每条回答从 [1] 开始 + 整表覆盖」，结果历史消息里的 [1][2]
  // 被新回答的同号覆盖，点开看到的是别的文件 —— 那才是「角标和内容没关联」的真因。
  let n = getCiteSeq()
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
      addCite(n, { chunkId: cid, doc })
    }
    // 正文里写短码而不是纯数字：短码由 chunkId 稳定派生、全局唯一，
    // 所以每条回答的角标天然互不干扰，不需要"全局编号表"也不会串到别的回答上。
    // 前端装饰时按「本条消息内出现的先后」把短码显示成 1、2、3…
    return '[#' + shortFor(cid, doc) + ']'
  })
  setCiteSeq(n)
  if (cites.length) {
    // 只追加、不清表：历史消息的角标还要靠老编号解析。
    for (const c of cites) addCite(c.n, { chunkId: c.chunkId, doc: c.doc })
    saveCiteIndexSoon()
  }
  return { text: out, cites }
}

module.exports = { citeLink, PLACEHOLDER_RE, restorePlaceholders, inlineCitations, liveStreams, askLedger, liveKeyFor, pumpSse }
