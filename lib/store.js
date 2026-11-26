/**
 * 落盘状态：角标短码表（短码 → {chunkId, doc}）。
 *
 * 这张表曾经被写坏过：文件里出现过 `ƭ\n~`（多字节 + 换行）和 7 位 `cad0a7e` 这类键。
 * 原因不是 WeKnora —— 短码完全由本文件生成（8 位十六进制），坏值只能来自**并发写**：
 * 原来每个插件实例各持一份整表、每 2 秒 `writeFileSync` 覆盖同一个文件，两个实例
 * 互相覆盖 + 半截写入就会出现错位键。
 *
 * 现在的写入约定：
 *   1. 先写 `*.tmp-<pid>`，再 rename 覆盖 —— 读者要么看到旧文件，要么看到新文件，看不到半截；
 *   2. 写之前先读一遍磁盘，把别的实例新加的条目并进来，减少互相覆盖；
 *   3. 读的时候只认 `/^[0-9a-f]{8}$/`，非法键丢弃；
 *   4. 解析失败**不清空**：备份坏文件后保留内存表（宁可本次不写，也不让历史角标全失效）。
 */
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { CONFIG_PATH, readJsonQuiet } = require('./config')

const CITES_PATH = path.join(path.dirname(CONFIG_PATH), 'dsh-weknora-cites.json')
// 4~12 位小写字母数字：新码是 5 位 base36（模型容易抄对），旧码是 8 位 hex（继续兼容）
const SHORT_RE = /^[0-9a-z]{4,12}$/
const MAX_ENTRIES = 8000

let citeShort = null
let citeBack = null
let citeDirty = false
let citeTimer = null

function backupBroken() {
  try {
    if (!fs.existsSync(CITES_PATH)) return ''
    const dst = CITES_PATH + '.bad-' + Date.now()
    fs.copyFileSync(CITES_PATH, dst)
    return dst
  } catch {
    return ''
  }
}

function loadCites() {
  if (citeShort) return
  citeShort = {}
  citeBack = {}
  const raw = readJsonQuiet(CITES_PATH)
  if (!raw || typeof raw !== 'object') {
    // 解析失败 = 文件被写坏了（半截/错位）。备份一份供排查，但**不清空历史**：
    // 这次内存表是空的，能做的就是不要再把坏文件当成"空表"回写覆盖掉备份。
    const bad = backupBroken()
    if (bad) console.log('[dsh-weknora] 短码表损坏，已备份到 ' + bad + '，本次从空表开始')
    return
  }
  for (const k of Object.keys(raw)) {
    if (!SHORT_RE.test(k)) continue
    const v = raw[k]
    if (!v || !v.c) continue
    citeShort[k] = { c: String(v.c), d: String(v.d || '') }
    citeBack[String(v.c)] = k
  }
}

function mergeFromDisk() {
  // 多实例：别的进程可能刚写过。写前先并一遍，避免整表覆盖掉对方新增的条目。
  const disk = readJsonQuiet(CITES_PATH)
  if (!disk || typeof disk !== 'object') return
  for (const k of Object.keys(disk)) {
    if (!SHORT_RE.test(k) || citeShort[k]) continue
    const v = disk[k]
    if (!v || !v.c) continue
    citeShort[k] = { c: String(v.c), d: String(v.d || '') }
    citeBack[String(v.c)] = k
  }
}

function trim() {
  const keys = Object.keys(citeShort)
  if (keys.length <= MAX_ENTRIES) return
  for (const k of keys.slice(0, Math.floor(keys.length / 2))) {
    const v = citeShort[k]
    delete citeShort[k]
    if (v && citeBack[v.c] === k) delete citeBack[v.c]
  }
}

function saveNow() {
  if (!citeShort) return
  mergeFromDisk()
  trim()
  const tmp = CITES_PATH + '.' + process.pid + '.tmp'
  try {
    fs.mkdirSync(path.dirname(CITES_PATH), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(citeShort), { mode: 0o600 })
    try {
      fs.renameSync(tmp, CITES_PATH)
    } catch {
      // Windows 上目标被占用时 rename 会失败，退化成"删了再改名"（窗口极小）
      try { fs.rmSync(CITES_PATH, { force: true }) } catch { /* ignore */ }
      fs.renameSync(tmp, CITES_PATH)
    }
  } catch {
    try { fs.rmSync(tmp, { force: true }) } catch { /* ignore */ }
  }
}

function saveCitesSoon() {
  citeDirty = true
  if (citeTimer) return
  citeTimer = setTimeout(() => {
    citeTimer = null
    if (!citeDirty) return
    citeDirty = false
    saveNow()
  }, 2000)
  if (citeTimer.unref) citeTimer.unref()
}

function shortFor(chunkId, doc) {
  loadCites()
  const cid = String(chunkId || '')
  const hit = citeBack[cid]
  // 返回前再校验：内存里如果有历史遗留的坏值，不要继续外传（会渲染不出角标）。
  if (hit && SHORT_RE.test(hit) && citeShort[hit]) return hit
  if (hit && !SHORT_RE.test(hit)) {
    delete citeShort[hit]
    delete citeBack[cid]
  }
  // 5 位 base36（36^5 ≈ 6000 万）：模型复述时比 8 位 hex 容易抄对得多，
  // 同时够短，正文里不会显得像噪声。旧的 8 位 hex 仍然能被解析（SHORT_RE 4~12 位）。
  let k = ''
  do {
    k = crypto.randomInt(0, 36 ** 5).toString(36).padStart(5, '0')
  } while (citeShort[k])
  citeShort[k] = { c: cid, d: String(doc || '') }
  citeBack[cid] = k
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

module.exports = { loadCites, saveCitesSoon, shortFor, resolveCite, CITES_PATH, SHORT_RE }
