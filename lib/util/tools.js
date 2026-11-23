/**
 * 工具定义层的加载器：优先用 DSH 的 defineTool，拿不到就用等价实现，
 * 这样插件在非 DSH 环境（本地测试）里也能跑。
 */
const path = require('path')
const { WeKnoraAuthError } = require('../weknora-client')

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


module.exports = { loadDefineTool, loadCreateUserMessage, localDefineTool, textOutput, jsonText, fail }
