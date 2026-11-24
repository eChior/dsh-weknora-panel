const fs=require('fs'), os=require('os'), path=require('path')
const { WeKnoraClient } = require('../lib/weknora-client.js')
const { inlineCitations } = require('../lib/cite.js')
const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(),'.dsh','dsh-weknora-panel.json'),'utf8'))
const c = new WeKnoraClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey })
;(async()=>{
  const r = await c.ask({ query: '出差提前申请怎么填写', knowledgeBaseIds: ['4a9dadf8-b79b-4945-be95-55c3783e3e05'] })
  const raw = r.answer || ''
  console.log('RAW 里 [# 片段:', (raw.match(/\[#[^\]]{0,20}\]/g)||[]).slice(0,6))
  console.log('RAW 里 <kb 数量:', (raw.match(/<kb /g)||[]).length)
  const out = inlineCitations(raw)
  console.log('OUT 里标记:', (out.text.match(/\[#[^\]]{0,20}\]/g)||[]).slice(0,6))
})().catch(e=>{console.error('ERR', e.message)})
