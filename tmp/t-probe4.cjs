const http = require('http')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { WeKnoraClient } = require('../lib/weknora-client')
const cfgPath = path.join(os.homedir(), '.dsh', 'dsh-weknora-panel.json')
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
const client = new WeKnoraClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, tenantId: cfg.tenantId || '' })

const tools = require('../lib/util/tools')
const host = require('../lib/index.js')
const regs = {}
const ctx = {
  logger: { info(){}, warn(){}, error(){} },
  effect: (fn) => { try { fn() } catch (e) { console.error('effect err', e.message) } },
  inject: (names, fn) => { try { fn({ ...ctx, effect: ctx.effect, webServer: { register: (r) => { regs[r.path] = r.handler; return { dispose(){} } } } }) } catch (e) { console.error('inject err', e.message) } },
  on: () => ({ dispose(){} }),
  tools: { register(){ return { dispose(){} } } },
  agents: {},
  webServer: { register: (r) => { regs[r.path] = r.handler; return { dispose(){} } } },
}
host.apply(ctx, {})

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  const h = regs['/api/weknora']
  if (!h) { res.writeHead(500); return res.end('no handler') }
  const out = await h(req, res)
  if (out && !out.__sent) { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(out)) }
})
srv.listen(8095, async () => {
  const get = (p) => new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:8095' + p, (r) => { const cs = []; r.on('data', (d) => cs.push(d)); r.on('end', () => resolve({ status: r.statusCode, type: r.headers['content-type'], body: Buffer.concat(cs).toString('utf8') })) }).on('error', reject)
  })
  try {
    const kbs = await client.listKnowledgeBases()
    const kb = kbs[0]
    const files = await client.listFiles(kb.id, { page: 1, pageSize: 100 })
    const list = files.items || files || []
    const xlsx = list.find((f) => /\.xlsx?$/i.test(String(f.file_name || f.title || '')))
    const docx = list.find((f) => /\.docx?$/i.test(String(f.file_name || f.title || '')))
    console.log('xlsx:', xlsx && (xlsx.file_name || xlsx.title), '| docx:', docx && (docx.file_name || docx.title))
    if (xlsx) {
      const r = await get('/api/weknora/sheet?id=' + encodeURIComponent(xlsx.id))
      console.log('SHEET status=', r.status, 'len=', r.body.length)
      console.log('SHEET head=', r.body.slice(0, 240))
    }
    if (docx) {
      const r = await get('/api/weknora/content?id=' + encodeURIComponent(docx.id))
      console.log('CONTENT status=', r.status, 'type=', r.type, 'len=', r.body.length)
      const ch = await client.listChunks(docx.id, { page: 1, pageSize: 1 })
      const cid = (ch.items || ch || [])[0] && (ch.items || ch)[0].id
      if (cid) {
        const rr = await get('/api/weknora/pdfpage?id=' + encodeURIComponent(docx.id) + '&chunk=' + encodeURIComponent(cid))
        console.log('PDFPAGE', rr.body.slice(0, 200))
      }
    }
  } catch (e) { console.error('ERR', e.message) }
  srv.close(); process.exit(0)
})
