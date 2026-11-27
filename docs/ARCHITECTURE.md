# 架构与实现说明

这份文档写给要改这个插件的人。它说明代码为什么长成这样、每个文件管什么、一次点击会经过哪些层，以及哪些坑已经踩过了（后者的完整清单在 [PITFALLS.md](./PITFALLS.md)，改代码前请先扫一眼）。

---

## 1. 全景

插件是 DSH（DeepSeek Harness）的一个 bundle，分两半跑在两个进程里：

```
┌─ Electron 主进程 ───────────────────────────────────────────────┐
│ lib/index.js        宿主半：注册 5 个 agent 工具 + 22 条 HTTP 路由 │
│   lib/config.js     配置读写（显式 > 保存文件 > 包内 > 环境变量）  │
│   lib/store.js      短码 ↔ chunkId 的映射表（落盘，重启不丢）      │
│   lib/cite.js       把 WeKnora 答案里的 <kb> 标签压成 [#短码]      │
│   lib/http.js       读 body / 转发二进制 / SSRF 与超时             │
│   lib/util/tools.js defineTool 的输出包装                          │
│   lib/weknora-client.js  WeKnora REST 客户端（唯一出门的地方）     │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTP  /api/weknora/*
┌──────────────────────────────┴──────────────────────────────────┐
│ 浏览器半（lib/client.js，由 build/src/*.js 拼出来）               │
│   00-css  10-util  20-icons  30-markdown  40-preview             │
│   42-views（Word/Excel/PDF 三种预览）  43-locate（定位与高亮）     │
│   45-pdf（官方 pdf.js viewer 的 iframe 壳）                       │
│   50-cite（角标装饰 + 右侧栏原文 tab）  55-hooks（面板状态）       │
│   60-panel（主面板）  70-settings（设置）  80-apply（注册入口）    │
└──────────────────────────────────────────────────────────────────┘
                               │ iframe
┌──────────────────────────────┴──────────────────────────────────┐
│ viewer-official/    pdf.js 官方 dist（web + build，370 个文件）    │
└──────────────────────────────────────────────────────────────────┘
```

数据源是 WeKnora（Lite 版），插件自己不存知识，只做「取、展示、定位」。

---

## 2. 宿主半

### 2.1 为什么拆成 6 个文件

`index.js` 一度是 2200 行的单文件，改一处要在里面翻半天。现在按职责切：

| 文件 | 行数 | 职责 | 边界 |
|---|---|---|---|
| `index.js` | ~1560 | 工具定义 + 路由实现 + 上下文注入 | 只做「接线」，具体逻辑尽量下放 |
| `weknora-client.js` | ~486 | 所有出网的 HTTP | 除它以外任何文件都不该 `fetch` WeKnora |
| `config.js` | ~119 | 配置的四层优先级与默认值 | 同步读，允许被路由每次调用 |
| `store.js` | ~155 | 短码映射的读写与防抖落盘 | 只有 `shortFor` / `resolveCite` 两个入口 |
| `cite.js` | ~114 | `<kb …>` → `[#短码]` | 纯函数，不碰网络不碰磁盘 |
| `http.js` | ~89 | body 读取、二进制转发、错误 JSON | 被路由复用 |
| `util/tools.js` | ~97 | `defineTool` 兼容层 | DSH 版本差异收在这里 |

### 2.2 配置优先级

```
config.js:readConfig()
  1. 显式传入的 config（cordis.patch.yml 里写 config 时）
  2. ~/.dsh/dsh-weknora-panel.json      ← 面板「设置」写这里
  3. <插件目录>/config.json             ← 打包时预置，改一次全端一致
  4. 环境变量 WEKNORA_BASE_URL / WEKNORA_API_KEY / WEKNORA_TENANT_ID
  5. 默认值
```

四层都读不到时 `state.client` 为 `null`，`/status` 返回 `bound:false`，面板显示设置表单而不是报错。

### 2.3 路由清单

22 条，全部挂在 `/api/weknora` 一个入口下（DSH 一个插件只认一个前缀，曾经注册两个把前一个挤掉过，见 PITFALLS「DSH 宿主机制」）。

| 路由 | 作用 |
|---|---|
| `/status` `/config` | 连通性、配置读写（含脱敏自检） |
| `/knowledgeBases` `/folders` `/files` | 库 / 分组 / 文件列表 |
| `/file` `/download` `/content` | 单个文件的元信息 / 原件下载 / 原始字节 |
| `/text` `/chunk` `/locators` | 分块列表 / 单块 / 该块在原文中的位置 |
| `/search` `/cite` | 检索 / 短码反查 chunkId |
| `/sheet` `/docxjs` `/locatejs` | Excel 表格 HTML / Word 渲染器 / 定位脚本 |
| `/pdf` `/pdfpage` `/pdfjs/*` `/vw/*` | PDF 原件、页码定位、pdf.js 资源、官方 viewer |
| `/resource` `/redact-test` `/diag` | 图片代理、脱敏自检、前端错误上报 |

`/pdfpage` 的判定顺序值得记住：

1. `source_locators` 里有 `type==='pdf' && page>0` → 直接返回该页（`from:'locator'`，最准）
2. 文件本身就是 PDF → `{page:0, quote}`（不转 LibreOffice，也没有页码映射）
3. Office 文件 → 先用 `soffice` 转 PDF（6 小时缓存，按 `updated_at|file_size` 校验），再用 `quote` 在文本层里找页

### 2.4 角标为什么用短码

WeKnora 的回答正文里本来就内联 `<kb doc="…" chunk_id="…" kb_id="…" />`。直接把它转成 markdown 链接会有两个问题：

- URL 里有 36 位 UUID 和 URL 编码的中文文件名，**流式输出时未闭合前会把整串原样显示**；
- 模型会二次复述、改写、丢字符。

所以宿主把它压成 `[#a1b2c3d4]`（8 位 hex），映射表落在 `~/.dsh/dsh-weknora-cites.json`。浏览器半再把这个纯文本标记装饰成可点角标。**短码格式是已落库的协议，换格式必须新旧并存**（试过直接换成纯数字，历史消息全部错指）。

---

## 3. 浏览器半

### 3.1 构建方式

`build/build.mjs` 用 esbuild 把 `build/src/*.js` 按文件名排序拼起来，打成一个 IIFE，交给 `window.__ModuleLoader__`。**片段的顺序就是加载顺序**，`00-` 到 `80-` 的数字前缀是有意义的：

```bash
node build/build.mjs          # 产出 lib/client.js（约 9.6 MB）
```

产物要一起提交（`package.json` 的 `exports["./client"]` 指向它，DSH 启动时直接读，不会现场构建）。

### 3.2 三种预览怎么分派

`42-views.js` 的 `fileView({id, ext, kbId, name, page, needle, chunkId})` 是唯一入口：

| 扩展名 | 组件 | 渲染方式 |
|---|---|---|
| `xls xlsx xlsm ods csv` | `SheetView` | 宿主 `sheet_to_html` → 真表格（单元格限宽 300px，超出省略号） |
| `doc docx docm odt rtf` | `DocxView` | docx-preview（`ignoreLastRenderedPageBreak:true`，与 WeKnora 一致）+ `el.style.zoom` 适合宽度 |
| 其它（含 pdf） | `ReaderFrame` | iframe 指向 pdf.js **官方** viewer，`#zoom=page-width` |

三者共用同一份定位实现 `43-locate.js`，也就是把 WeKnora 前端 `utils/sourceLocator*.ts` 搬过来的那一套：`srcBuildTextIndex` 建字符索引 → `srcFindTextRange` 找唯一命中 → `srcHighlightRanges`（优先 CSS Custom Highlight API，不改 DOM）→ `srcReveal` 只滚最近的可滚祖先。

### 3.3 一次点击经过哪里

```
用户点会话里的角标（<a href="dsh-weknora:c/xxxx">）
  └─ bindCiteLinks：document 的 capture 阶段拦截
       · 用 e.composedPath() 找 <a>（chat 在 shadow root 里，e.target 会被 retarget 成 host）
       · preventDefault + stopPropagation
       · 写 sessionStorage['dsh-weknora:last-cite']（tab 重新挂载时的兜底）
       · 调 /cite?k=xxxx 换回 chunkId
  └─ openCiteInSidebar：确认 tab 类型存在 → sidebarRight.openTab('weknora-cite')
  └─ CiteTabBody 接到 chunkId
       · /chunk → knowledgeId / kbId
       · /file  → 真实 file_name，据此推扩展名（不能用标题推，标题常没有扩展名）
       · /locators → 该块的 source_locators（block / quote / sheet+row）
       · /text  → 全部分块（文本模式用）
       · 分派到三种预览之一，把 chunkId 和 quote 传下去
  └─ 预览组件：渲染原件 → 定位 → 画黄块 → 滚过去
```

### 3.4 右侧栏 tab 的三个坑

1. **tab 类型注册跨插件不生效**：`SidebarRightTabRegistry.register()` 的副作用写在 registry 自己所属插件的 `ctx.effect` 里，从我们插件调它不会执行。所以 `ensureCiteTabType()` 两头都试，必要时直接把 entry 写进 `kinds` 并 `refresh()`，而且**每次点击前都兜一次**。
2. **内容 slot 要注册两个 key**：`renderSlot` 用 `entryKey = definition?.id ?? tab.kind`，注册 `dsh-weknora-panel/cite` 和 `weknora-cite` 两个才稳。
3. **`openTab` 不要带会变的 params**：tab 身份是 `pageAddress(kind, params)`，每点一个不同角标就新建一个 tab，高度一路叠上去（这就是「点角标页面整体上移」的真因）。现在 params 恒定，内容靠事件推给已存在的 tab。

### 3.5 主面板

`60-panel.js` 只做渲染，状态全在 `55-hooks.js` 的 `usePanelState()` 里。**两个 hook 拆不开**：加载列表要清预览、检索要用当前库、上传后要按检索词刷新，共享太深，硬拆只能靠层层传参（试过，跨模块 `ReferenceError` 连环崩）。

---

## 4. 已知限制

| 现象 | 原因 |
|---|---|
| 扫描件 PDF 没有黄块 | 没有文字层，WeKnora 也不给它 `source_locators` |
| Word 的黄块按「块」定位 | docx locator 给的是 `block`（第 N 段）+ `quote`，没有「段落 → 页」映射 |
| 首次打开原件慢 | Office 要走 `soffice` 转 PDF，3~8 秒；之后按 `updated_at` 命中缓存 |
| Excel 单元格被截断 | 照抄 WeKnora 的 `max-width:300px`，超长文本显示省略号，横向可滚 |
| 历史消息里的旧 `[1]` 不会变成角标 | 装饰器只认 `[#短码]`；编号式会被正文里的 `m[1]` 之类误伤 |

---

## 5. 调试手段

### 5.1 诊断日志

前端 `logDiag(evt, data)` → `POST /api/weknora/diag` → `~/.dsh/dsh-weknora-diag.log`。

默认**关闭**（`window.__DSH_WK_DIAG__` 为假时 `logDiag` 直接 return）。排查时在 DSH 控制台执行：

```js
window.__DSH_WK_DIAG__ = true
```

`CiteBoundary` 的错误上报无视这个开关（渲染崩溃必须留证据）。日志包含 `locate-docx` / `locate-excel` / `layout` 等事件，是定位「命中数对不对」的第一手材料。

### 5.2 shadow root 复现环境

`tmp/shadow-harness.cjs`（端口 8082，`/s.html?mode=bare|tab&chunk=`）把预览渲染进 `attachShadow` 容器，模拟 DSH 右侧栏。**白屏这类问题必须在它上面复现**——直接开页面跑是查不出来的（CSS 注入、shadow root、高度链三者只在真实结构里才暴雷）。

### 5.3 宿主半单独起

`tmp/host-server.cjs <port>` 用假 cordis ctx 起真实宿主半，然后直接 curl 各路由。注意 `inject(names, fn)` 的回调必须收子 ctx，否则 `webServer` 是 undefined。

### 5.4 浏览器工具的边界

- 不能打开 DSH 自身（policy 拒绝 `BROWSER_URL_DENIED`），所以 UI 问题靠 harness + 截图 + DOM 测量，不靠「打开 DSH 看」。
- 含 pdf.js iframe 的页面**不要截图**，`captureScreenshot` 会超时并把 guest 搞挂；用 `dsh_browser_execute` 量 DOM。

---

## 6. 改代码的规矩

1. **一次只动一处**，改完立刻在 harness 上验证，再动下一处。
2. **没验证过的不提交**。产物（`lib/client.js`）要跟源码一起提交。
3. 回退到已发布版本时用 `git checkout <commit> -- build lib`（含 `build` 根，因为 `build.mjs` 和 `viewer.src.js` 也改过），并**不要重建**——直接用它提交的产物。
4. 改完跑一遍：`node --check build/src/*.js` → `node build/build.mjs` → `node tmp/dom-cite-test.cjs`（角标装饰 + 幂等）。
5. 踩到新坑就补进 [PITFALLS.md](./PITFALLS.md)，写清症状、根因、正确做法、证据。
