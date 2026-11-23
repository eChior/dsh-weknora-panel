/**
 * 落盘状态：角标短码表、编号表。跨请求共享的可变状态集中在这里。
 */
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { CONFIG_PATH, readJsonQuiet } = require('./config')

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
  // 短码用「纯数字递增」而不是随机 hex：这段标记会经模型之手抄进正文，
  // 8 位随机十六进制很容易被抄坏（实测出现过 [#C~hn] 这种残码），
  // 而 1~4 位数字几乎不会被改。数字全局唯一，跨回答也不冲突。
  let n = 0
  Object.keys(citeShort).forEach(function (key) {
    if (/^\d+$/.test(key)) n = Math.max(n, parseInt(key, 10))
  })
  for (const key in citeBack) { /* noop */ }
  let k = String(n + 1)
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


// 只有一张表：短码 → { chunkId, doc }。短码由 chunkId 稳定派生，
// 所以不需要「第几号角标」这种全局序号，也就不会出现历史消息被新回答覆盖的错指。
module.exports = { loadCites, saveCitesSoon, shortFor, resolveCite, CITES_PATH }
