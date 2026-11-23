/**
 * HTTP 辅助：JSON 响应、请求体读取、MIME、上游流转发。
 */
const path = require('path')
const fs = require('fs')

// ── HTTP 辅助 ────────────────────────────────────────────
function sendJson(res, obj, status) {
  const body = JSON.stringify(obj)
  res.writeHead(status || 200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** 原始字节（上传用）：不能走 readBody —— 那里按 JSON 解析，二进制文件必然报「请求体不是合法 JSON」 */
function readRawBody(req, maxBytes) {
  const limit = maxBytes || 200 * 1024 * 1024
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('文件太大（上限 ' + Math.round(limit / 1024 / 1024) + 'MB）')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 1024 * 1024) { reject(new Error('请求体过大')); req.destroy() }
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch { reject(new Error('请求体不是合法 JSON')) }
    })
    req.on('error', reject)
  })
}

const MIME = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8', json: 'application/json; charset=utf-8',
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
}

function mimeOf(fileName, fallback) {
  const m = /\.([A-Za-z0-9]{1,6})$/.exec(String(fileName || ''))
  const ext = m ? m[1].toLowerCase() : ''
  return MIME[ext] || fallback || 'application/octet-stream'
}


/** 把上游 Response 原样转给浏览器（图片 / 音视频 / 下载都会走这里） */

async function pipeUpstream(res, upstream, { fileName, fallbackType, inline } = {}) {  const buf = Buffer.from(await upstream.arrayBuffer())
  const type = fileName ? mimeOf(fileName, fallbackType) : (upstream.headers.get('content-type') || fallbackType)
  const name = String(fileName || '').replace(/["\\\r\n]/g, '')
  res.writeHead(200, {
    'content-type': type || 'application/octet-stream',
    'content-length': buf.length,
    'cache-control': 'private, max-age=120',
    ...(name
      ? { 'content-disposition': `${inline === false ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}` }
      : {}),
  })
  res.end(buf)
}

module.exports = { sendJson, readRawBody, readBody, MIME, mimeOf, pipeUpstream }
