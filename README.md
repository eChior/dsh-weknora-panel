# dsh-weknora-panel

> 本项目基于 [**ikevss/dsh-ima**](https://github.com/ikevss/dsh-ima)（MIT License，Copyright (c) 2026 ikevss）修改：把 ima 的数据层整体换成 WeKnora，并新增角标、右侧栏原文、pdfjs 定位等能力。来源与逐项改动见 [NOTICE](./NOTICE)，许可见 [LICENSE](./LICENSE)。

把 [WeKnora](https://weknora.weixin.qq.com) 知识库接进 DeepSeek Harness（DSH）。

- **左侧栏「知识库」面板**：库 → 分组 → 文件列表 → 正文/原件预览。
- **会话里可点角标**：agent 回答里的出处角标点一下，右侧栏打开原文并跳到命中处标黄。
- **原件按格式用对应解析器**：Word 用 docx-preview（保版式）、Excel 用真表格、PDF 用 pdf.js 官方 viewer，三者共用 WeKnora 自己的定位逻辑。
- **7 个 agent 工具**：服务端一次问答（快）、逐段读原文、检索、看库里有什么。
- **不改 DSH 本体**：只通过 `dsh.client` 注入界面、`cordis.patch.yml` 挂载自己，出问题从 `bundles` 去掉即可。

## 文档

| 文档 | 内容 |
| --- | --- |
| [INSTALL.md](./INSTALL.md) | 安装、升级、换地址、常见问题 |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 架构、模块职责、数据流、调试手段、改代码的规矩 |
| [docs/PITFALLS.md](./docs/PITFALLS.md) | 30+ 条真实踩过的坑，每条带症状/根因/证据 |

**改代码前先读 PITFALLS 和 ARCHITECTURE。**

## 配置

优先级：**面板保存 > 包内 `config.json` > 环境变量**

| 来源 | 位置 | 说明 |
| --- | --- | --- |
| 面板保存 | `~/.dsh/dsh-weknora-panel.json` | 面板右上角 ⚙ 填写，保存即生效，不用重启 |
| 包内预置 | `<包目录>/config.json` | 随包分发，装好就有；换地址改这个 |
| 环境变量 | `WEKNORA_BASE_URL` / `WEKNORA_API_KEY` / `WEKNORA_TENANT_ID` | 兜底；Windows 下别用 `setx "带引号"`，会把引号存进值 |

`baseUrl` 形如 `http://<你的服务器>:8088/api/v1`（没写 `/api/v1` 会自动补），Key 走 `X-API-Key`。

## agent 工具

| 工具 | 用途 |
| --- | --- |
| `weknora_panel_ask` | **首选**。WeKnora 服务端一次做完检索+生成+引用，13~20 秒，正文自带 `<kb doc=… chunk_id=… />` 内联出处；插件把它压成 `[#短码]`，会话里渲染成可点角标 |
| `weknora_panel_read_chunk` | 按 `chunk_id` 读单段逐字原文 |
| `weknora_panel_read_document` | 按 `knowledge_id` 读整篇（分块拼接，可 `offset` / `max_chars`） |
| `weknora_panel_search` | 混合检索片段；每条命中带 `cite` 字段（`[#短码]`），agent 贴在句末就有角标 |
| `weknora_panel_list_knowledge_bases` | 看有哪些库 |
| `weknora_panel_list_files` | 看某个库里有哪些文件 |
| `weknora_panel_find_documents` | 跨库按文件名/标题搜 |

插件在会话开头注入一段「知识库清单 + 库内文档样本 + 用法」，agent 因此知道优先走 `ask`，也能判断问题是否超出知识库范围。注入频率在设置里可切换（每会话一次 / 每轮 / 关闭）。

## 角标是怎么来的

WeKnora 的回答正文里本来就内联 `<kb doc="…" chunk_id="…" kb_id="…" />`。插件分两步处理：

1. **宿主**把每个 `<kb>` 压成纯文本短码 `[#a1b2c3d4]`，映射表落在 `~/.dsh/dsh-weknora-cites.json`。
   不用 markdown 链接的原因：流式输出时未闭合的链接会把 36 位 UUID 和 URL 编码的中文文件名原样显示出来，而且模型二次复述时容易把长链接改坏。
2. **浏览器半**用 MutationObserver 扫新出现的文本节点，把短码装饰成角标 `<a href="dsh-weknora:c/…">`，按本条消息内的先后编号（每条回答都从 1 开始）。

点角标的链路：

```
capture 阶段拦截（用 composedPath 找 <a>，chat 在 shadow root 里）
  → /cite?k=短码 换回 chunkId
  → sidebarRight.openTab('weknora-cite')
  → 右侧栏取 /chunk、/file、/locators、/text
  → 按真实扩展名分派到 Word / Excel / PDF 预览
  → 用 WeKnora 的 source_locators 定位命中处，标黄，滚过去
```

左侧会话栏**完全不动**。

## 原件预览

| 格式 | 渲染 | 定位与高亮 |
| --- | --- | --- |
| `docx doc odt rtf` | docx-preview，保留原版式与分页，`zoom` 适合宽度 + 手动缩放 | locator 给 `block`（第 N 段）+ `quote`，在对应块里找引文 → 高亮 → 滚到可视区 |
| `xlsx xls csv` | 宿主 `sheet_to_html` → 真表格（限宽 300px、超长省略号、可横向滚） | locator 给 `sheet` + `row_start/row_end`，整行标黄 |
| `pdf` | pdf.js 官方 viewer（iframe，`#zoom=page-width`，滚轮翻页） | locator 给 `page` 直接跳页；无 locator 时用引文在文本层里找页 |
| 图片 / 音视频 | 原生标签 | — |

高亮用 CSS Custom Highlight API（`::highlight(source-locate)`），**不改 DOM**，所以不会破坏原件结构。

## 开发

```bash
npm install                 # devDependencies（esbuild / docx-preview / xlsx / pdfjs-dist）
node build/build.mjs        # 把 build/src/*.js 拼起来，产出 lib/client.js
node test/smoke.js          # 冒烟：连真实 WeKnora 跑一遍全部 API
```

浏览器半的源码在 `build/src/`，按数字前缀切片（`00-css` … `80-apply`），**文件名顺序就是拼接顺序**。

改完的检查顺序：

```bash
Get-ChildItem build/src/*.js | ForEach-Object { node --check $_.FullName }
node build/build.mjs
node tmp/dom-cite-test.cjs     # 角标装饰 + 幂等
```

> **产物必须一起提交**：`package.json` 的 `exports["./client"]` 指向 `lib/client.js`，DSH 启动时直接读它、不现场构建，缺了会 `client bundles not found` 起不来。

部署到本机 profile：

```
lib/client.js、lib/index.js → C:\Users\Chior\.dsh\profiles\desktop\node_modules\dsh-weknora-panel\lib\
```

重启 DSH 后生效。没变化就先看 profile 里的 `cordis.patch.yml` 是不是被改成了 `- insert: []`（那等于禁用插件）。

## 已知限制

- **扫描件/纯图片 PDF 没有黄块**：没有文字层，WeKnora 也不给它 `source_locators`。
- **Word 的黄块按「块」定位**：docx locator 只有 `block` + `quote`，没有「段落 → 页」映射，所以是标在段落上而不是纸上。
- **首次打开 Office 原件慢**：要走 LibreOffice 转 PDF（3~8 秒），之后按 `updated_at|file_size` 命中缓存。
- **历史消息的编号不会自适应**：装饰器只认 `[#短码]`；旧式 `[1]` 不会被装饰（裸数字会被正文里的 `m[1]` 之类误伤）。
- **Office 转换依赖宿主 LibreOffice**：DSH 桌面版自带 `@deepseek-ai/libreoffice-kit`；纯 Node 环境下 `/pdf` 会返回错误而不是崩进程。
- 图片类附件按 WeKnora 的 `resource://` 代理转发，正文里的 `![](...)` 会渲染成图。
