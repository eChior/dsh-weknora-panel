# dsh-weknora-panel 重构设计（B 方案：重新分层）

日期：2026-11-23
状态：待评审

## 1. 为什么做

插件在 20 多轮迭代里长成了「功能都对、实现打架」的状态：多套角标编号表并存、死代码占三成、
两个巨型函数（宿主 2200 行单文件、前端 `WeKnoraPage` 570 行 20+ 个 useState）。
功能要全保留，实现按「数据访问 → 服务 → 路由 → 前端状态」四层切干净。

## 2. 现状账（实测）

| 项 | 数字 | 说明 |
|---|---|---|
| 宿主 `lib/index.js` | 2200 行 | 31 条路由 + 7 个工具 + pre-step，一个文件 |
| 死路由 | 12 条 | `/ask` `/ask-stream` `/live` `/messages` `/sessions` `/session` `/suggested` `/agents` `/embed` `/ui` `/reader` `/r`（前端已不调用，`reader/` 目录已删） |
| 前端 `build/client.src.js` | 3195 行 | 单文件，构建时整体塞进 IIFE |
| 死组件 | 4 个 | `QaPanel`(291 行) `QaPane` `LiveAnswer` `ReaderFrame`，`apply()` 不渲染 |
| 最大组件 | `WeKnoraPage` 570 行 | 20+ useState、4 个 useEffect |
| 角标表 | 3 套 | `askLedger`（内存 Map）、`citeIndex`（落盘 json）、`sessionStorage['dsh-weknora:last-cite']` |

用户确认保留的功能：库/分组/文件浏览、上传（进度+解析状态）、下载、
预览（PDF 跳页标黄、Excel 走下载原件）、会话工具 `weknora_panel_*` + 角标、
右侧栏原文、快答直出、脱敏还原。

## 3. 目标结构

### 3.1 宿主（`lib/`）

```
lib/
  index.js            入口：工具定义(7)、agent/pre-step、webServer 注册、apply
  config.js           配置：显式 > 保存文件 > 包内 config.json > env；字段白名单
  state.js            落盘状态：cites 短码表、citeIndex、injectedSessions、diag 日志
  services/
    weknora.js        数据访问层（= 现 weknora-client.js，几乎不动）
    cache.js          listFiles 60s 缓存、folders 合并、kb 列表缓存
    preview.js        原件 → PDF（LibreOffice）、stamp 缓存、页码定位、pdfjs 句柄
    cite.js           短码分配、inlineCitations、restorePlaceholders
    upload.js         二进制接收、multipart 转发、解析状态推断
  routes/
    config.js         /config /status /redact-test
    kb.js             /knowledgeBases /folders /files /file /search
    content.js        /text /content /resource /download /upload
    preview.js        /pdf /pdfpage /pdfjs/<file>
    cite.js           /cite /chunk /ledger
  tools.js             7 个工具的 defineTool 定义（从 index.js 挪出）
```

约束：`index.js` ≤ 300 行；每个 `routes/*.js` ≤ 200 行；`services/*` 不 import `routes/*`。

### 3.2 前端（`build/src/` → `build.mjs` 拼接）

```
build/src/
  00-css.js        CSS 字符串（含角标、面板、预览、设置）
  10-util.js       api / fmtTime / toast / copyText / sendToConversation / fixResourceUrls
  20-icons.js      图标组件
  30-markdown.js   renderMarkdown(src, {onCite})
  40-preview.js    PdfView（pdfjs 渲染 + TextLayer 高亮 + 滚轮翻页）、sheet 提示
  50-cite.js       decorateCiteMarks / observeCiteMarks / bindCiteLinks / CiteTabBody / citeTabParams
  60-panel.js      面板：hooks(useKbs/useFolders/useFiles) + KbPane + FileList + UploadTray
  70-settings.js   SetupDialog（含脱敏自检、开关）
  80-apply.js      apply(ctx)：注册 slot / tab / 监听
  _dev.js          exports.__dev（仅测试用）
```

`build/build.mjs` 按文件名排序拼接 → `lib/client.js`。行数预算：`60-panel.js` ≤ 450 行。

### 3.3 状态管理

面板状态收成两个 hook：

- `useKbData()` → `{ kbs, curKb, setCurKb, folders, curFolder, files, loading, error, refresh, loadMore }`
- `usePreview()` → `{ preview, openFile, openCite, officeOn, setOfficeOn, page }`

`WeKnoraPage` 只负责布局与组合，目标 ≤ 200 行。

## 4. 关键链路（重构后）

**浏览**：`useKbData` → `/knowledgeBases` → `/folders` + `/files?kbId&folderPath&keyword&page`
**上传**：文件 input → `POST /upload?kbId&name&folderPath`（二进制）→ 轮询 `/file?id=` 得解析状态
**预览**：`openFile` → `/file` + `/text`（+ `/pdfpage` 定位）→ `PdfView` 或 sheet 提示
**角标**：`ask` 工具 → `inlineCitations` 把 `<kb>` 换成 `[#short]` → 写 `state.js` 的 cites 表
  → 前端 `decorateCiteMarks` 扫所有 shadow root → `[#short]` 变上标按钮（显示序号按消息内顺序）
  → 点击 → `bindCiteLinks`（`composedPath`）→ `openTab('weknora-cite',{params})` → `CiteTabBody` → `/chunk` + `/text` + `/pdfpage`
**快答直出**：`concludeTurn` + `directAnswer` 开关（默认关）
**脱敏**：`restorePlaceholders`（宿主侧，兜底）+ 服务端补丁

角标只保留**一套表**：`state.js` 里 `short → {chunkId, doc}`，落盘 `dsh-weknora-cites.json`。
删掉 `askLedger`、`citeIndex`、`sessionStorage` 三套并存（`sessionStorage` 只作为点击到 tab 的一次性传递，不参与编号）。

## 5. 迁移阶段（每步可独立验证、可回滚）

1. **删死代码**：12 条死路由、4 个死组件、`/embed` `/ui` 反代、reader 残留。行为零变化。
   → 验证：`node --check`、`tmp/test-reader3.cjs` 之外的现有测试全绿、手工点面板。
2. **宿主拆目录**：纯搬移，逻辑不改；`services/` 从 `index.js` 抽函数。
   → 验证：`tmp/test-citetab.cjs`、`tmp/host-cite-test.cjs` 走通。
3. **前端拆文件**：`client.src.js` 按 3.2 切块，build.mjs 拼接顺序固定。
   → 验证：`tmp/render-dom.cjs` 渲染快照与重构前一致（对比 html 长度与关键节点）。
4. **状态收 hook**：`WeKnoraPage` 拆分，行为不变。
   → 验证：同上 + 真浏览器点击链路（`test/shadow-cite.html`）。
5. **角标并一条链路**：删多余表，保留短码。
   → 验证：`tmp/cite-e2e.cjs` + 手工点击 3 个不同角标。
6. **全量回归**：8 项手工清单（见 §6），构建部署到 profile。

## 6. 验证清单

自动化（沿用现有脚本）：

- `node --check lib/index.js build/client.src.js`
- `node build/build.mjs` 产物可被 `__ModuleLoader__` 加载，`__dev` 导出齐全
- `tmp/test-citetab.cjs`：`/text` `/chunk` `/pdf` `/pdfjs` 全 200
- `tmp/cite-e2e.cjs`：装饰 3 个 → 点击 → `openTab` 参数正确 → `citeTabParams` 正确
- `tmp/render-dom.cjs`：面板渲染、库名、文件列表

手工（真 DSH，重启后）：

1. 左侧「知识库」出现，库/分组/文件能列
2. 上传一个文件，进度与解析状态正确
3. 点文件 → PDF 预览、命中段标黄、滚轮翻页
4. Excel 文件 → 显示「下载原件 / 交给对话」，不转 PDF
5. 会话里问制度问题 → 回答带角标 → 点角标右侧栏出原文并标黄
6. 追问 → 走模型（不进直出）
7. 设置里改 baseUrl/apiKey → 保存后立即生效
8. 脱敏自检 → 显示脱敏后/还原后

## 7. 风险

- `lib/client.js` 是构建产物，必须重建并复制到 `~/.dsh/profiles/desktop/node_modules/dsh-weknora-panel/lib/`，否则改了没效果。
- 前端拆文件后若拼接顺序错（依赖 `h`、`React` 的顶层引用），会 `ReferenceError`；用构建后冒烟 + `__dev` 导出校验。
- 面板 hook 化过程中容易把 `kbId` 依赖漏掉（切库不刷新）——手工清单第 1 项专门覆盖。
- 回滚：每阶段独立 commit，出问题 `git revert` 单阶段即可。

## 8. 非目标

- 不改 WeKnora 服务端（补丁不在本仓库）
- 不引入构建工具链（仍是 esbuild + 手写拼接）
- 不改工具对外的名字与参数（`weknora_panel_*` 保持不变，避免会话历史里的调用失效）
- 不做多语言
