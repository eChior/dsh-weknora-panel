# dsh-weknora-panel

> 本项目基于 [**ikevss/dsh-ima**](https://github.com/ikevss/dsh-ima)（MIT License，Copyright (c) 2026 ikevss）修改：把 ima 的数据层整体换成 WeKnora，并新增角标、右侧栏原文、pdfjs 定位等能力。来源与逐项改动见 [NOTICE](./NOTICE)，许可见 [LICENSE](./LICENSE)。

把 [WeKnora](https://weknora.weixin.qq.com) 知识库接进 DeepSeek Harness（DSH）。

> **改代码前先读 [docs/PITFALLS.md](./docs/PITFALLS.md)** —— 33 条真实踩过的坑（CSS 数组插错、profile 下 require 解析、flex 高度塌陷、shadow root 事件 retarget、假 DOM 测试失真等），每条带证据与正确做法。

- **左侧栏「知识库」面板**：库列表 → 文件列表 → 正文预览；原件用 pdfjs 渲染，滚轮翻页。
- **会话里可点角标**：agent 回答里的出处角标点一下，右侧栏直接打开原文，PDF 自动定位到命中页并标黄。
- **7 个 agent 工具**：服务端一次问答（快）、逐段读原文、检索、看库里有什么。
- **不改 DSH 本体**：只通过 `dsh.client` 注入界面、`cordis.patch.yml` 挂载自己，出问题从 `bundles` 去掉即可。

> 安装步骤见 [INSTALL.md](./INSTALL.md)。首次使用在面板右上角 ⚙ 里填知识库地址与 API Key（模板见 `config.example.json`）。

## 配置

优先级：**面板里保存 > 包内 `config.json` > 环境变量**

| 来源 | 位置 | 说明 |
| --- | --- | --- |
| 面板保存 | `~/.dsh/dsh-weknora-panel.json` | 面板右上角 ⚙ 填写，保存即生效，不用重启 |
| 包内预置 | `<包目录>/config.json` | 随包分发，装好就有；换地址改这个 |
| 环境变量 | `WEKNORA_BASE_URL` / `WEKNORA_API_KEY` / `WEKNORA_TENANT_ID` | 兜底；Windows 下别用 `setx "带引号"`，会把引号存进值 |

`baseUrl` 形如 `http://<你的服务器>:8088/api/v1`（没写 `/api/v1` 会自动补），Key 走 `X-API-Key`。

## agent 工具

| 工具 | 用途 |
| --- | --- |
| `weknora_panel_ask` | **首选**。WeKnora 服务端一次做完检索+生成+引用，13~16 秒，正文自带 `<kb doc=... chunk_id=.../>` 内联出处 |
| `weknora_panel_read_chunk` | 按 `chunk_id` 读单段逐字原文 |
| `weknora_panel_read_document` | 按 `knowledge_id` 读整篇（分块拼接，可 `offset` / `max_chars`） |
| `weknora_panel_search` | 混合检索片段；每条命中带 `cite` 字段（`[N](dsh-weknora:chunk/<id>?doc=<文件名>)`） |
| `weknora_panel_list_knowledge_bases` | 看有哪些库 |
| `weknora_panel_list_files` | 看某个库里有哪些文件 |
| `weknora_panel_find_documents` | 跨库按文件名/标题搜 |

插件在每条用户消息开头注入一段「知识库清单 + 用法」，agent 因此知道优先走 `ask`。

## 角标是怎么来的

`weknora_panel_ask` 把 WeKnora 返回的 `<kb doc="…" chunk_id="…" />` 改写成 Markdown 链接
`[N](dsh-weknora:chunk/<chunk_id>?doc=<文件名>)`；浏览器半在 capture 阶段拦下点击，不导航、不换页，
直接 `sidebarRight.openTab('weknora-cite', { params })` 在右侧栏开原文：

- 服务端用 pdfjs 逐页抽文本，把命中分块定位到具体页号（表格类 PDF 用滑动片段打分）
- 前端 pdfjs 客户端渲染，连续滚动（滚轮即翻页），命中页标黄
- 左侧会话栏**完全不动**

## 开发

```bash
npm install                 # 只需 devDependencies（esbuild / @open-file-viewer/core）
node build/build.mjs        # 产出 lib/client.js（约 9.6 MB，含 pdfjs 预览引擎）
node test/smoke.js          # 冒烟：连真实 WeKnora 跑一遍全部 API
```

改完记得：`lib/client.js` 重新构建 → 复制到 profile 的 `node_modules/dsh-weknora-panel/lib/` → 重启 DSH。

> **产物体积**：`lib/client.js` 已随仓库提交（`dsh.client` 指向它，缺了 DSH 会启动失败）。改了 `build/client.src.js` 或 `build/viewer.src.js` 之后，务必 `node build/build.mjs` 并**把 `lib/client.js` 一起提交**，否则从仓库安装的人拿到的是旧界面。
如果重启后没变化，先看 profile 里的 `cordis.patch.yml` 是不是被改成了 `- insert: []`（那等于禁用插件）。

## 已知限制

- 历史会话里已经生成的回答补不了角标（正文是写死的纯文本），新提问才有。
- 扫描件/纯图片 PDF 没有文本层，定位不到具体页，会停在第 1 页。
- Office 原件首次打开要 LibreOffice 转换（docx/xlsx → PDF），3~8 秒，结果缓存 6 小时。
- 图片类附件按 WeKnora 的 `resource://` 代理转发，正文里的 `![](...)` 会渲染成图。
