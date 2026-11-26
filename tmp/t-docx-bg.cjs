const path = require('path'), os = require('os'), fs = require('fs')
const { JSDOM } = require(path.join(__dirname, '..', '..', 'tmp', 'node_modules', 'jsdom'))
const dom = new JSDOM('<!doctype html><html><body><div id="c"></div></body></html>')
global.window = dom.window; global.document = dom.window.document
global.Node = dom.window.Node; global.HTMLElement = dom.window.HTMLElement
global.DOMParser = dom.window.DOMParser; global.Blob = dom.window.Blob
global.FileReader = dom.window.FileReader; global.XMLSerializer = dom.window.XMLSerializer
const { WeKnoraClient } = require('../lib/weknora-client')
const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'dsh-weknora-panel.json'), 'utf8'))
const c = new WeKnoraClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, tenantId: cfg.tenantId || '' })
;(async () => {
  const kbs = await c.listKnowledgeBases(); const kb = kbs[0]
  const files = await c.listFiles(kb.id, { page: 1, pageSize: 100 })
  const list = files.items || files || []
  const docx = list.find(f => /\.docx?$/i.test(String(f.file_name || f.title || '')))
  const resp = await c.downloadFile(docx.id)
  const buf = Buffer.from(await resp.arrayBuffer())
  const { renderAsync } = require('docx-preview')
  await renderAsync(buf, document.getElementById('c'), null, { inWrapper: true, ignoreWidth: false, ignoreHeight: true, breakPages: false, className: 'dsh-wk-docx' })
  const all = document.getElementById('c').querySelectorAll('*')
  const hits = []
  for (const el of all) {
    const s = el.getAttribute && el.getAttribute('style')
    if (s && /background|bgcolor/i.test(s)) hits.push(el.tagName + ' | ' + s.slice(0, 120))
  }
  console.log('带背景的元素数:', hits.length)
  console.log(hits.slice(0, 12).join('\n'))
})().catch(e => console.log('ERR', e.message))
