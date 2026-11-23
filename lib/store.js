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
  const v = citeShort[k]
  return v ? { chunkId: v.c, doc: v.d || '' } : null
}


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

module.exports = {
  loadCites, saveCitesSoon, shortFor, resolveCite, CITES_PATH,
  citeIndex, getCiteSeq: () => citeSeq, setCiteSeq: (n) => { citeSeq = n },
  addCite: (n, v) => { citeIndex.set(n, v); if (n > citeSeq) citeSeq = n },
  saveCiteIndexSoon, CITE_INDEX_PATH,
}
