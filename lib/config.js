/**
 * 配置：显式参数 > 用户保存的配置 > 包内 config.json > 环境变量。
 */
const path = require('path')
const fs = require('fs')
const os = require('os')

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


module.exports = {
  CONFIG_PATH, BUNDLED_CONFIG_PATH, CONTEXT_STATE_PATH, CONTEXT_LOG_PATH, envAny, readJsonQuiet,
  readSavedConfig, readBundledConfig, writeSavedConfig, readConfig, mask,
}
