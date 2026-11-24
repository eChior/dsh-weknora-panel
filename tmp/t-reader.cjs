const http=require('http'), path=require('path'), os=require('os'), fs=require('fs')
process.env.DSH_HOME = path.join(os.tmpdir(),'dsh-wk-test')
const plugin = require('../lib/index.js')
const routes=[]
const ctx={ logger:{info(){},warn(){},error(){}}, effect(fn){try{fn()}catch(e){}}, inject(n,f){ if(n.includes('webServer')) f({ effect(fn){try{fn()}catch(e){}}, webServer:{ register(o){ routes.push(o) } } }) }, tools:{register(){}}, slots:{inject(){},register(){}}, sidebarRightTabs:{register(){}}, sidebarRight:{openTab(){},isExpanded(){return true},toggleExpanded(){}} , on(){} }
plugin.apply(ctx, {})
console.log('routes registered:', routes.length, routes.map(r=>r.path))
const h=routes[0].handler
const srv=http.createServer(async (req,res)=>{ const u=new URL(req.url,'http://x'); req.url=u.pathname+u.search; await h(req,res) })
srv.listen(8099, async () => {
  const get=(u)=>new Promise(r=>{http.get('http://127.0.0.1:8099'+u,res=>{let b=[];res.on('data',d=>b.push(d));res.on('end',()=>r({s:res.statusCode,ct:res.headers['content-type'],n:Buffer.concat(b).length,body:Buffer.concat(b).toString('utf8').slice(0,200)}))})})
  const p1=await get('/api/weknora/reader?topic=4a9dadf8-b79b-4945-be95-55c3783e3e05&name=x')
  console.log('PAGE', p1.s, p1.ct, p1.n, /api\/weknora\/r\?p=/.test(p1.body))
  const p2=await get('/api/weknora/vendor/pdf.min.mjs')
  console.log('VENDOR', p2.s, p2.ct, p2.n)
  const p3=await get('/api/weknora/r?p=%2Flibrary')
  console.log('LIB', p3.s, p3.body.slice(0,120))
  srv.close(); process.exit(0)
})
