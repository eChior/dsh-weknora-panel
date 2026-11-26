const path = require('path'), fs = require('fs'), vm = require('vm')
const jsdomPath = path.join(__dirname, '..', '..', 'tmp', 'node_modules', 'jsdom')
const { JSDOM } = require(jsdomPath)
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { runScripts: 'outside-only' })
const { window } = dom
global.window = window; global.document = window.document
global.Node = window.Node; global.NodeFilter = window.NodeFilter
global.HTMLElement = window.HTMLElement; global.Element = window.Element
global.navigator = window.navigator; global.location = window.location
global.MutationObserver = window.MutationObserver
global.Event = window.Event; global.CustomEvent = window.CustomEvent

const React = require(path.join(__dirname, '..', '..', 'tmp', 'node_modules', 'react'))
const ReactDOMServer = require(path.join(__dirname, '..', '..', 'tmp', 'node_modules', 'react-dom', 'server'))

let mod
window.__ModuleLoader__ = { load: (e) => { mod = e.factory((name) => (name === 'react' ? React : {})) } }
const code = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')
vm.runInThisContext(code, { filename: 'client.js' })

const dev = mod.__dev
console.log('exports:', Object.keys(dev).join(','))

// 1) extOf 对 xlsx
console.log('extOf(xlsx):', dev.extOf({ file_name: '费用类报账单附件要求.xlsx', title: 'x' }))

// 2) highlightQuote：只标一处、重复调用不叠加
const box = document.createElement('div')
box.innerHTML = '<p>前面一段话。</p><p>员工报销时对应的职级、手机号码以公司人力资源系统登记的相关信息为准。</p><p>后面一段。</p>'
const q = '员工报销时对应的职级、手机号码以公司人力资源系统登记的相关信息为准。'
const n1 = dev.highlightQuote(box, q)
const marks1 = box.querySelectorAll('mark.dsh-wk-hl').length
const n2 = dev.highlightQuote(box, q)
const marks2 = box.querySelectorAll('mark.dsh-wk-hl').length
console.log('highlight hits1=', n1, 'marks1=', marks1, '| 第二次 hits2=', n2, 'marks2=', marks2)
const mk = box.querySelector('mark.dsh-wk-hl')
console.log('mark 文本:', mk ? JSON.stringify(mk.textContent) : '(none)')

// 3) SheetView 渲染（mock fetch /sheet）
const hasSheetView = typeof dev.SheetView === 'function'
console.log('SheetView 可用:', hasSheetView)
