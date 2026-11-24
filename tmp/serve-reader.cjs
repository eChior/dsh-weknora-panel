const http=require('http'),path=require('path'),os=require('os')
process.env.DSH_HOME=path.join(os.tmpdir(),'dsh-wk-serve')
const plugin=require('../lib/index.js')
const routes=[]
const ctx={logger:{info(){},warn(){},error(){}},effect(fn){try{fn()}catch(e){}},inject(n,f){if(n.includes('webServer'))f({effect(fn){try{fn()}catch(e){}},webServer:{register(o){routes.push(o)}}})},tools:{register(){}},slots:{inject(){},register(){}},sidebarRightTabs:{register(){}},sidebarRight:{openTab(){},isExpanded(){return true},toggleExpanded(){}},on(){}}
plugin.apply(ctx,{})
http.createServer(async(req,res)=>{try{await routes[0].handler(req,res)}catch(e){res.writeHead(500);res.end(String(e))}}).listen(8095,()=>console.log('reader test server on 8095'))
