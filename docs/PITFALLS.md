# 踩坑记录

改这个插件前先读一遍。每条都是真实付出过代价的，带证据，不是泛泛的"要小心"。

---

## 一、构建与产物

### 1. CSS 有两个数组，插入时按变量名定位，不要用"最后一个 `].join`"

**症状**：新加的预览容器样式完全不生效，容器高度一会儿 24600px 一会儿 0，表现为白屏 / 一直加载 / 界面被顶高。

**根因**：`build/src/00-css.js` 里有两个数组：

| 数组 | 注入方式 | 用途 |
|---|---|---|
| `var CSS = [...]`（第 24 行起） | `injectCss()` → `injectStyle(CSS_TAG_ID, CSS)` | **面板布局** |
| `var CITE_CSS = [...]`（第 290 行起） | `injectCiteStyles()` → head + 各 shadowRoot | 会话角标 |

用 `c.rfind('].join')` 找插入点，命中的是**后者**。14 条布局规则进了角标数组，面板拿不到 `display:flex` / `overflow` / 高度约束。

**正确做法**：按变量名定位区间再插；插完立刻验证产物里有没有：

```bash
node tmp/dump-css.cjs      # 打印 __dev.css，逐个 key 查 indexOf
```

`.dsh-wk-docxbox @-1` 就是没进去。**改 CSS 后必须查产物，不能只 `node --check`**（JS 语法对 ≠ CSS 进了正确的数组）。

### 2. 回退到已发布版本要连 `build` 根一起 checkout，且别急着重build

`git checkout <commit> -- build/src lib` 之后重建，产物与发布版 **md5 不同** —— 因为 `build/build.mjs`、`build/viewer.src.js` 也被改过。

```bash
git checkout f4755f7 -- build lib      # 注意是 build，不是 build/src
```

验证过：这样重建能精确复现发布版 md5 `9f7040be`（9,901,534 B）。**最稳的是直接用 commit 里的 `lib/client.js`，不重建。**

另：`core.autocrlf=true` 时工作区产物比 commit 里多 13,984 字节（每行一个 CR），md5 自然不同，别把这个当成逻辑差异。

### 3. 整包回退会把已修好的护栏一起退掉

`min-height` 那道护栏修过三次，每次整包 checkout 都把它带回坑里，于是"这个 bug 你不是早就知道了吗"。

**回退前先 `git diff <target> -- <path>` 看清要丢掉什么**，或者只 checkout 真正要退的文件。

### 4. 删目录时配套路由会一起没，引用就悬空

删 `reader/` 时把 `/api/weknora/r` 路由一起删了，而 `ReaderFrame` 还在请求 `/r?p=/pdf&...` → 预览永远转圈。

**删任何目录/路由后，全局搜一遍它的引用**：`grep -rn "'/r?p=" build/src lib`。

---

## 二、Node / 宿主半

### 5. 插件安装目录没有 `node_modules`，裸名 require 必然失败

**报错**：`Cannot find module 'xlsx'  Require stack: .../profiles/desktop/node_modules/dsh-weknora-panel/lib/index.js`

开发目录有 `node_modules`，所以本机测试全过；装到 profile 后解析不到。

```js
// 错
const XLSX = require('xlsx')
// 对
const XLSX = require(path.join(__dirname, '..', 'vendor', 'xlsx'))
```

**验证必须站在 profile 目录跑**（`tmp/verify-profile-sheet.cjs` 就是干这个的），在开发目录跑过了不算。

### 6. 批量字符串替换会改到被替换函数自己的函数体

为兼容老 Node 把 `AbortSignal.timeout(` 全量替换成 `timeoutSignal(`，**函数体内那一行也被换了**：

```js
function timeoutSignal(ms) {
  if (typeof AbortSignal.timeout === 'function') {
    return timeoutSignal(ms)   // ← 自己调自己，每个 HTTP 调用立刻栈溢出
  }
}
```

面板红字 `Maximum call stack size exceeded`、列表 0 个库。

**批量替换后回头读一遍那个函数本身。**

### 7. `downloadFile()` 返回的是 fetch `Response`，不是 Buffer

直接喂 `XLSX.read` 永远解析成空表（`{"totalRows":0,"rows":[]}`）。

```js
const resp = await state.client.downloadFile(id)
const buf = Buffer.from(await resp.arrayBuffer())
```

修完同一文件从 0 行变 59 行。

### 8. JS 正则字面量里 `/\\./` 匹配的是字面反斜杠

`extOf()` 写成 `/\\.([A-Za-z0-9]{1,6})$/`（两个反斜杠），永远取不到扩展名 → Excel 被当普通 Office 转 PDF。

正确：`/\.([A-Za-z0-9]{1,6})$/`。**用 python 脚本生成 JS 代码时特别容易多一层转义。**

### 9. 路由日志别硬编码

`console.log('路由已注册：/api/weknora/{config,status,...}')` 写死名单，新增 `sheet`/`docxjs` 后日志里看不到，排查时误判"路由没注册"。改成 `Object.keys(routes)` 拼。

---

## 三、CSS 布局

### 10. `flex:1` + `min-height:420px` 只能涨不能收

在确定高的父容器里，`flex:1` 的 basis 是 auto，内容 24600px 会整个撑开；`min-height` 只保底不封顶。

```css
/* 错：内容撑爆 */  flex:1; min-height:420px;
/* 对：能收缩 */    flex:1 1 auto; height:0; min-height:0; overflow:auto;
```

**但 `height:0` 生效的前提是父链每一层都有确定高度**。父级是 auto 时它会塌成 0（白屏）。真实 DSH 右侧栏中间就有 auto 层，靠 `fixHeightChain()` 补。

实测对照（420×700 容器）：

| 写法 | nos | box |
|---|---|---|
| `min-height:420px` | 420×24600 | 420×24600 |
| `height:0` 但样式没进主数组 | 420×0 | 420×20 |
| 样式进主数组 + `height:0` | **420×700** | **420×700** |

### 11. 别用 `max-width:100%` 压 Word 页宽

docx-preview 给 section 的是文档真实页宽（A4 = 595.3pt ≈ 794px），页边距 padding 也按原文（约 96px×2）。压到 396px 后正文只剩 204px，每行 14 字，看着"字很小、和以前不一样"。

**去掉 `max-width`，保留原页宽，让容器横向滚动。** 实测 `sec` 从 396×24566 变 794×12128，字号仍 14px。

### 12. `overflow:hidden` 挡不住页面被撑高，`overflow:clip` 才行

右侧栏 `position:absolute` 面板底边超出视口 21px，`documentElement.scrollHeight` 从 912 变 933，用户能往下滚 —— 这就是"界面整体上移"。

`overflow:hidden` 只是不让滚，`scrollHeight` 仍是 933；`overflow-y:clip` 让那 21px 根本不进 `scrollHeight`，实测 `over=0`。

---

## 四、DSH 宿主机制

### 13. shadow root 里 `e.target` 被 retarget 成 host

会话正文在 shadow root 内，事件冒泡到 `document` 时 `e.target` 是 shadow host，`while (el = el.parentElement)` 永远找不到那个 `<a>` → 不 `preventDefault` → 浏览器去导航未知协议 → 角标点不动。

**先走 `e.composedPath()`**，再退回 `parentElement`。

### 14. 跨插件调 `registry.register()` 时它的 `ctx.effect` 不执行

`SidebarRightTabRegistry.register()` 把 `this.ids.add(id)` / `this.enter(kind, entry)` 写在**registry 自己所属插件**的 `ctx.effect` 里，别的插件调它时那个 effect 不跑，注册表始终为空 → `placeTab` 报 `no tab type is registered as "weknora-cite"`。

兜底：直接写 `reg.kinds.set(kind, { inForce: entry })` + `reg.ids.add(id)` + `reg.refresh()`。真正的 registry 挂在 `ctx.sidebarRight.tabs`，注入名 `sidebarRightTabs` 可能取不到。

### 15. `tab.navigation` 是 snapshot store，`.params` 恒 undefined

```js
var snap = nav && typeof nav.getSnapshot === 'function' ? nav.getSnapshot() : nav
return (snap && snap.params) || (tab && tab.params) || {}
```

另外 slot props **不保证有 `useTabInfo`**，别依赖它。

### 16. 同一个 kind + 不同 params = 不同 tab

`contentId = pageAddress(kind, params)`。每点一个角标传不同 `{chunkId, doc}` 就新建一个 tab，每个 tab 一个近屏高的容器 → **点得越多界面被顶得越高**。

内容用模块级 `PENDING_CITE` + 事件推给 tab 自己更新，`openTab` 的 params 保持恒定。

### 17. 正文（assistant markdown）没有可注册 slot，也没有 `agent/post-step`

`assistant-step` 由 `AssistantNodeView` 直接渲染 `<AssistantMarkdown>`，插件无法拦截模型改写。所以角标走「纯文本短码 + 前端 DOM 装饰」，不靠模型输出 markdown 链接。

### 18. 工具没有执行中推送通道

`defineTool` 只有 `execute` + 执行后的 `projectContent`/`finalizeContent`。要在会话里边生成边显示，只能用 `tool.call.toolview` keyed slot（key = 工具注册名）自己订阅 SSE。

`exec.concludeTurn()` 可以让工具结果直接结束本轮（不再请求模型），但那样正文就没有 assistant 消息了 —— 这是"直出"开关的取舍。

---

## 五、DOM 装饰

### 19. 装饰器必须跳过编辑区，否则打断输入法

只挡 `PRE/CODE/A/TEXTAREA/SCRIPT/STYLE` 不够，DSH 输入框是 contenteditable。用户反馈"输入的拼音被保留了"。

必须跳：`INPUT/SELECT/OPTION`、`el.isContentEditable`、`contenteditable` 属性（`''`/`true`/`plaintext-only`）、`role="textbox"`。`MutationObserver` 回调也要先过滤编辑区变化，否则打字每个字符触发一次全文档扫描。

### 20. `surroundContents` 逐节点包裹会叠加

effect 重跑就再包一层，页面上好几块黄。先 `clearQuoteMarks()` 清旧标，再只标第一处。

### 21. docx 把一句话拆成多个 run，单节点 `indexOf` 找不全

`marks=0` 的真因。用与 PDF 同一套 `buildTextIndex()` + `fmap` 定位字符区间，收集各节点子区间后**倒序**包裹 —— 倒序保证 `splitText` 不影响尚未处理的更早节点。实测 `marks=3` 连成一处黄条。

### 22. 递归收集 shadowRoot 会爆栈

12000 层 shadow 链实测 `RangeError: Maximum call stack size exceeded`。改显式栈迭代 + 预算（最多 400 个 root、单 root 4000 元素、TreeWalker 2 万文本节点）。

---

## 六、测试方法（这一类最贵）

### 23. harness 忘了注入产品 CSS，量到的全是无样式布局

第一版 `panel-harness` 只 `entry.factory()` 拿 `__dev` 就渲染，**没调 `injectCss()`**。于是 computed style 全是默认值（`flex=0 1 auto`、`disp=block`），据此做的三轮判断全是废的。

```js
var st = document.createElement('style')
st.textContent = dev.css
document.head.appendChild(st)
```

**测布局前先确认样式真的注入了**（打印 `css injected len=`）。

### 24. 假 DOM 测不了 DOM 操作

最小 DOM shim 里 `splitText()` 返回空 span、`createTreeWalker()` 返回 `nextNode: () => null`，于是高亮断言必然 FAIL —— 那是环境缺陷，不是产品 bug。

**DOM 行为用 jsdom 或真浏览器**；假 DOM 只断言"函数存在""分派到哪个组件"这类纯逻辑。

### 25. 靠截图读小字不可靠，让页面把数据 POST 回来

`oil_ui_shoot` 的 `size` 不约束布局宽度（设 430 量到 `box w=948`），缩放后对不上。

正确：页面里 `say()` 累计日志并 `fetch('/report', {method:'POST', body})`，服务端落盘，用 `read` 读精确文本。

### 26. 一次只改一处，否则无法归因

有一轮同时把 `PdfView` 换成 `ReaderFrame` **并**改 `min-height`，结果还是白屏，到底谁造成的看不出来。

**两个独立指标可以一起改**（如页宽看 `sec` 宽度、高亮看 `marks` 数），但同一指标的多处改动必须分开验。

### 27. 测试脚本会随实现漂移，"通过"可能是假的

改短码格式后 `host-cite-test` 还在数旧 `[N]`、`cite-e2e` 还在调已删的 `setLedger`。**改实现就同步改脚本**，否则绿灯没意义。

---

## 七、协议与兼容

### 28. 短码格式是已落库的协议，换格式必须新旧并存

把 8 位 hex 改成纯数字递增，历史消息里的旧码全解不出来。用户："不要改字符串生成方式，你这是破坏性更新"。

同理：给旧码加校验位再硬校验，会把 120+ 条无校验位的旧码全判成脏标记。

### 29. 编号表按回答整体覆盖会让历史角标错指

`citeIndex.clear()` 后重建 → 上一条回答的 `[3]` 指向新回答的第 3 条。最终方案：**只保留「短码 → {chunkId, doc}」一张只追加的表**，显示编号由前端按本条消息内出现顺序算。

---

## 八、Windows / 工具

### 30. PowerShell 里别写中文 here-doc

`python - <<'PY'` 在 pwsh 里报 `ParserError: 重定向运算符后面缺少文件规范`；命令里带中文还会编码错乱。

**把 python 写成 `.py` 文件再 `python tmp\xxx.py`**，命令本身保持纯 ASCII。

### 31. `CON` 是 Windows 保留设备名

git 凭据提示重定向会生成删不掉的 `CON` 文件，`git add -A` 报 `fatal: unable to stat 'CON'`。

```powershell
Remove-Item -LiteralPath '\\?\D:\DSH Work\...\CON' -Force
```

之后改用精确 `git add <path>`。

### 32. `edit` 工具写多行 Dockerfile 续行会变成 `\\`

必须 python 后处理 `s.replace('; \\\\\n', '; \\\n')` 才符合 Dockerfile 语法。

### 33. 长期后台 node 服务用 `run_in_background`，别用 `Start-Process`

`Start-Process` 起的进程会被清掉（下次请求就连不上）；`ops_bash` 的后台 job 会触发 dsh-ops 的 `winuxcmd.exe` link-count bug，`job_kill` 后恢复。pwsh 的 `run_in_background` 稳定。

---

## 附：可复用的验证脚本

都在会话目录 `tmp/` 下：

| 脚本 | 作用 |
|---|---|
| `dump-css.cjs` | 打印产物里真正注入的 CSS，查某条规则在不在 |
| `panel-harness.cjs` | 420×700 flex 容器模拟侧栏，量三种预览的尺寸并 POST 落盘 |
| `verify-profile-sheet.cjs` | **站在 profile 目录**加载宿主半，验 require 解析 |
| `verify-views.cjs` | 三种解析器分派（假 DOM 只测纯逻辑） |
| `verify-hl.cjs` | jsdom 真 DOM 验高亮只标一处 |
| `asar-find.cjs` | 在 `app.asar` 里按字符串搜文件（`meta.offset` 可能是字符串，要 `Number()`） |
| `asar-extract.cjs` | 按路径后缀提取 asar 内文件 |

截图走 `oil_ui_shoot`（浏览器 CDP 在 Web GUI 下不可用）。

---

## 九、照搬 WeKnora 预览逻辑时踩的坑（2026-11-27）

### 34. `var CSS` 遮蔽浏览器全局 `CSS`，Custom Highlight API 永远走回退

**症状**：探测到 `CSS.highlights=object`、`Highlight=function`（API 明明可用），
但代码还是走了 `<mark>` 包裹分支，`CSS.highlights.has('source-locate')` 恒 false。

**根因**：`build/src/00-css.js` 里有 `var CSS = [...].join('')`。
所有片段拼进同一个 IIFE，模块作用域的 `CSS` 是**我们自己的样式字符串**，
把浏览器全局 `CSS` 遮蔽了。`typeof CSS !== 'undefined'` 为真，但 `CSS.highlights` 是 undefined。

**正确做法**：访问浏览器全局一律显式走 `window.`：
```js
var css = typeof window !== 'undefined' ? window.CSS : null
var H = typeof window !== 'undefined' ? window.Highlight : null
```

**同类前科**：之前写过 `CSS.join('')`，那次是反过来 —— 以为拿到数组，实际拿到 CSSOM 对象。
**只要 bundle 里有和浏览器全局同名的变量（CSS / name / status / location / top / self…），
访问全局就必须加 `window.`。**

### 35. `XLSX.utils.sheet_to_html` 返回的是整份 HTML 文档

**症状**：Excel 预览里出现 `<title>SheetJS</title>` 之类的节点，字体测量第一项是 title。

**根因**：`sheet_to_html` 输出 `<html><head><title>SheetJS</title></head><body><table>…`，
直接 `innerHTML` 会把 head 里的东西一起塞进面板。

**正确做法**：`DOMParser` 解析后**只取 `<table>`**，克隆进一个 div 再序列化。
WeKnora 那边靠 `sanitizeHTML` 达到同样效果。

### 36. PowerShell `git show … | Set-Content -NoNewline` 会把文件毁成一行

**症状**：为了做对照实验把 HEAD 版 viewer.html 写回工作区，结果 664 行的文件变成 1 行 47135 字节，
HTML 全挤在一起。

**根因**：PowerShell 管道按**行**传字符串，`-NoNewline` 只是不在末尾补换行，
行与行之间的分隔全丢了。

**正确做法**：导出 git 里的文件用 python 写**字节**：
```python
old = subprocess.run(['git','show','HEAD:path/to/file'], capture_output=True).stdout
io.open(dst,'wb').write(old)
```

### 37. harness 的 iframe 里官方 pdf.js viewer 不渲染 —— 是环境局限，不是回归

**症状**：harness 里 PDF 预览 `canvas=0`、`.textLayer=0`、页码框显示 0，
手动调 `app.pdfViewer.update()` 后立刻出现 4 个 canvas。

**定性方法（对照实验）**：把 `viewer.html` 换回**已知能用的 HEAD 版本**，
在同一 harness 里同样 `canvas=0`。→ 说明是测试环境的问题，不是本次改动引入的。
**直接把 viewer.html 当页面打开**（不套 iframe）则一切正常：页码 1、canvas 3、textLayer 3。

**教训**：怀疑自己改坏了之前，先把旧版放回去跑同一个用例。
没有这个对照，就会去改根本没坏的东西 —— 这正是之前反复「越改越糟」的来源。

### 38. 命中位置不要自己算，WeKnora 入库时已经写好了

`chunk.source_locators`（`internal/types/source_locator.go`）：
`pdf` 给 `page`/`bbox`、`docx` 给 `block`（1 起的段落序号）、`sheet` 给 `sheet`/`row_start`/`row_end`，
都带 `quote`。前端只负责按这些坐标去 DOM 里找。

配套两条纪律（照 `sourceLocator.ts`）：
- **`findInText` 只在唯一命中时返回**。宁可不标，也不要在多个候选里挑一个 —— 以前「整段匹配不上就取前 10 字」正是错在这里。
- **滚动只动指定容器**（`scrollRectIntoContainer`），不用 `scrollIntoView` —— 后者会滚所有可滚祖先，把整个 DSH 页面顶上去。

---

## 十、白屏的头号成因：组件 render 抛错，React 卸载整棵 root

### 1. 一个未声明的变量 = 纯白，连一行状态字都不剩

**症状**：右侧栏点角标，tab 标题在、内容区**整片纯白**。没有「正在取原文…」，没有红字错误，什么都没有。后端四条路由全 200，CSS 怎么改都没用。

**根因**：`build/src/50-cite.js` 里用了 `hitQuote`，但**整个文件没有它的声明**（某次 `git checkout <commit> -- build` 把 state 声明退回去了，使用它的那行却留着）：

```js
needle: located ? (hitQuote || (hitItem ? String(hitItem.content || '') : '')) : '',
```

渲染到这一行抛 `ReferenceError`。**React 18 在没有 ErrorBoundary 时会卸载整棵 root** —— 容器变成空 div，所以是纯白而不是错误提示。

这一行只在 `officeOn && knowledgeId && pageReady` 时执行，所以恰好是「原件加载完成之后」才白；面板预览走 `55-hooks.js` 另一条路，一直是好的 —— 这个不对称正是最容易误导人的地方。

**正确做法**：

- 白屏 + 连状态字都没有 ⇒ **先怀疑 render 抛错，不要先怀疑高度 / CSS / 接口**。
- 取证：在 shadow root 里挂组件，看 mount 容器的 `childElementCount`。`kids=0` 就是 React 卸载了，不是没画出来。
- `git checkout` 回退某个文件后，**grep 一遍该文件里所有被引用但没声明的标识符**。跨文件同名变量会让产物的 grep 计数骗过你：`var hq` 在产物里 3 次，其中只有 1 次属于这个文件。

### 2. `try { return h(Child, props) } catch` 是假保护

`h()` 只创建 element，**子组件的 render 还没执行**，错误在 React 提交阶段才抛，try/catch 一个也捕不到。

必须是真正的 ErrorBoundary：

```js
class CiteBoundary extends React.Component {
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err) { console.error(...) }
  render() { return this.state.err ? h('div', { className: 'dsh-wk-err' }, ...) : this.props.children }
}
```

有了它，同类错误以后会显示成一行红字，而不是让人对着白屏猜一下午。

### 3. 量视口高度要防空

`window.innerHeight` 在后台 tab / 未布局的页面里是 **0**，`Math.max(240, 0 - top - 8)` 会把容器钉死成 240px。

```js
var vh = window.innerHeight || document.documentElement.clientHeight || 0
if (!vh) return   // 量不到就别设，交回 CSS
```

### 4. 这次的验证证据（shadow root + 真实视口）

```
innerH=796  tab=420x787  inlineH=787px  nos=420x748  iframe=420x748
err=""  docScrollH=781 < innerH=796      <- 无溢出，不会上移
iframe 内：pages=12 canvas=4 layers=3 ranges=1 marks=0 locateLoaded=function
```

`ranges=1 / marks=0` = CSS Custom Highlight API 生效（不改 DOM）。
