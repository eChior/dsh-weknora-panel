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
  const key = String(k || '').trim().toLowerCase()
  if (!key) return null
  const exact = citeShort[key]
  if (exact) return { chunkId: exact.c, doc: exact.d || '' }
  // 模型会把 8 位短码抄短/抄坏（出现过 c/Uqu、c/څ7 这种）。
  // 只要还能唯一确定一条，就按前缀认；认不出就返回 null，让前端提示重新提问。
  const hits = Object.keys(citeShort).filter((s) => s.indexOf(key) === 0 || key.indexOf(s) === 0)
  if (hits.length === 1) {
    const v = citeShort[hits[0]]
    return { chunkId: v.c, doc: v.d || '' }
  }
  return null
}


// 只有一张表：短码 → { chunkId, doc }。短码由 chunkId 稳定派生，
// 所以不需要「第几号角标」这种全局序号，也就不会出现历史消息被新回答覆盖的错指。
module.exports = { loadCites, saveCitesSoon, shortFor, resolveCite, CITES_PATH }
