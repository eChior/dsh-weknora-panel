# dsh-weknora-panel 安装说明

把 WeKnora 知识库接进 DeepSeek Harness（DSH）：左侧栏浏览库与文件、pdfjs 原件预览（滚轮翻页，命中段自动跳到第几页并标黄）、会话里回答带可点角标，点角标在**右侧栏**打开原文。

## 一、包里有什么

```
dsh-weknora-panel/
├── config.json          ← 知识库地址 + API Key（已预置，装上就能用）
├── install.mjs          ← 安装脚本
├── install.cmd          ← Windows 双击安装
├── cordis.patch.yml     ← DSH 插件挂载声明
├── lib/index.js         ← 宿主半（工具 + /api/weknora/* 路由）
├── lib/client.js        ← 浏览器半（侧边栏面板 / 角标 / 右侧栏原文 tab）
├── vendor/pdfjs/        ← pdfjs 运行时（原件预览用，勿删）
└── README.md
```

## 二、安装

**方式 A：双击 `install.cmd`**（Windows）

它会自动找到 `%USERPROFILE%\.dsh\profiles\<profile>`，把插件复制进 `node_modules`，并在 profile 的 `package.json` 里登记依赖与 bundle。

**方式 B：命令行**

```bash
node install.mjs                 # 默认装到 desktop profile
node install.mjs --profile web   # 指定 profile
node install.mjs --list          # 先看有哪些 profile
```

**方式 D：从源码（仓库里没有 `lib/client.js`，需要构建一次）**

```bash
git clone <仓库地址> dsh-weknora-panel
cd dsh-weknora-panel
npm install          # 只装 esbuild + @open-file-viewer/core
npm run build        # 生成 lib/client.js（约 10 MB）
node install.mjs     # 复制到 profile
```

`lib/client.js` 是 esbuild 打出来的浏览器 bundle（10 MB），放在 `.gitignore` 里不进仓库；
`vendor/pdfjs/` 是运行时依赖，仓库里有，别删。

**方式 C：手动**

1. 整个目录复制到 `<DSH_HOME>/profiles/<profile>/node_modules/dsh-weknora-panel`
   （`DSH_HOME` 默认 `C:\Users\<你>\.dsh`）
2. 编辑 `<DSH_HOME>/profiles/<profile>/package.json`：
   - `dependencies` 里加 `"dsh-weknora-panel": "file:./node_modules/dsh-weknora-panel"`
   - `dsh.profile.bundles` 数组里加 `"dsh-weknora-panel"`
3. 重启 DSH。

## 三、装完怎么验

1. 重启 DSH，左侧应出现**「知识库」**图标，点开能看到库和文件列表。
2. 随便问一句制度类问题（例如「出差怎么走」），回答末尾会出现蓝色小角标。
3. 点角标 → 右侧栏弹出原文，PDF 自动滚到命中那一页，命中段黄色高亮。
4. 左侧会话栏不受影响；原文 tab 右上角 **✕** 直接收起右侧栏。

## 四、换知识库 / 换 Key

优先级：**面板里保存 > 包内 config.json > 环境变量**

- 面板右上角 **⚙** 直接填 Base URL 与 API Key，保存后立即生效（写到 `~/.dsh/dsh-weknora-panel.json`）。
- 或直接改包里的 `config.json`：

```json
{ "baseUrl": "http://<你的服务器>:8088/api/v1", "apiKey": "<你的 API Key>", "tenantId": "" }
```

- Base URL 要以 `/api/v1` 结尾（没写会自动补）；API Key 用的是 WeKnora 的 `X-API-Key`。

## 五、常见问题

| 现象 | 处理 |
| --- | --- |
| 侧边栏没有「知识库」图标 | 检查 profile 的 `package.json` 里 `dsh.profile.bundles` 有没有 `dsh-weknora-panel`，以及 `cordis.patch.yml` 是不是纯 `insert`（不要有 `- insert: []` 这种被禁用的写法） |
| 面板显示 0 个库 / Invalid URL | 地址写错了，或环境变量里带了引号。删掉环境变量改用面板填写 |
| 角标点开右侧栏空白 | 该文档没有解析出分块正文；切「看文本」看看，或回 WeKnora 重解析 |
| 原件一直转圈 | 首次打开要 LibreOffice 把 docx/xlsx 转成 PDF，3~8 秒；转换结果缓存 6 小时 |
| 有黄块但页码不对 | 极少数纯扫描件/图片版 PDF 没有文本层，定位不到具体页，会停在第一页 |

## 六、注意

- `config.json` 里是**明文 API Key**，这个包只发给可信的同事；外发前建议换成只读权限的 Key。
- 插件不改 DSH 本体，只通过 `dsh.client` 注入面板与 `cordis.patch.yml` 挂载自己；出问题把它从 `bundles` 里去掉即可恢复。
- 需要 DSH 0.2.x（web/desktop 均可）。pdfjs 已随包提供，不需要联网下载。
