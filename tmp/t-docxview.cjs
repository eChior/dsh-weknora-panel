const http = require('http'), path = require('path')
const regs = {}
const ctx = {
  logger: { info(){}, warn(){}, error(){} },
  effect: (fn) => { try { fn() } catch (e) {} },
  inject: (names, fn) => { try { fn({ ...ctx, effect: ctx.effect, webServer: { register: (r) => { regs[r.path] = r.handler; return { dispose(){} } } } }) } catch (e) { console.error('inject', e.message) } },
  on: () => ({ dispose(){} }), tools: { register(){ return { dispose(){} } } }, agents: {},
  webServer: { register: (r) => { regs[r.path] = r.handler; return { dispose(){} } } },
}
require('../lib/index.js').apply(ctx, {})
console.log('routes:', Object.keys(regs))
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  const h = regs['/api/weknora']
  const out = await h(req, res)
  if (out && !out.__sent) { res.writeHead(200, {'content-type':'text/plain'}); res.end(String(out)) }
})
srv.listen(8094, async () => {
  const get = (p) => new Promise((ok, no) => http.get('http://127.0.0.1:8094' + p, (r) => { const cs=[]; r.on('data',d=>cs.push(d)); r.on('end',()=>ok({s:r.statusCode,t:r.headers['content-type'],b:Buffer.concat(cs)})) }).on('error',no))
  const a = await get('/api/weknora/docxview?id=abc&block=3&quote=%E5%91%98%E5%B7%A5')
  console.log('DOCXVIEW', a.s, a.t, a.b.length)
  console.log(a.b.toString('utf8').slice(0, 160).replace(/\n/g,' '))
  const b = await get('/api/weknora/vendor-docx/docx-preview.min.mjs')
  console.log('VENDOR', b.s, b.t, b.b.length)
  srv.close(); process.exit(0)
})
