// 插件入口 apply 与导出
// 由 build/src 拼接后注入 factory，和同目录其它片段共享作用域（不要加 import/export）。
var inject = ['slots', 'sidebarRightTabs', 'sidebarRight']
var applied = false

/**
 * 会话里 agent 回答带的角标是 <a href="dsh-weknora:chunk/<id>">：
 * 在 capture 阶段拦下，别让浏览器去导航，改成在右侧边栏把原文渲染出来。
 */
/** 打开一条出处的原文（会写 sessionStorage，供面板回退路径补跳） */

function apply(ctx) {
  // 布局采样默认不跑：原来每 5 秒一次共 12 次，日志里刷屏。
  // 需要定位高度问题时，把下面这行取消注释，或在控制台执行 __DSH_WK_LAYOUT_WATCH__=false 后手动调用。
  // try { startLayoutWatch() } catch (e) { /* 忽略 */ }
  if (applied) {
    console.log('[dsh-weknora] apply 已执行过，跳过重复注册')
    return
  }
  applied = true
  __wkCtx = ctx
  try {
  injectCss()
  console.log('[dsh-weknora] 浏览器半初始化，预览引擎:', window.__DSH_WK_VIEWER__ ? '已加载' : '缺失')

  registerCiteTab(ctx)
  bindCiteLinks(ctx)
  observeCiteMarks()
  // 工具卡片不再接管（registerLiveView）：DSH 默认渲染在 result 阶段认的是
  // block.call.name，命名空间一变就命中不到我们的 slot，卡片会退化成一段 JSON/代码。
  // 默认卡片本身就能把工具返回的 text 显示出来，且不会再"变成代码"。

  ctx.slots.inject('sidebar.panellist', function () {
    return ctx.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: 0,
      label: '知识库',
    }, PanelGlyph)
  })

  ctx.slots.inject('main', function () {
    return ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
    }, function WeKnoraPageGuarded(props) {
      return h(PanelBoundary, null, h(WeKnoraPage, props))
    })
  })

  console.log('[dsh-weknora] UI 注册完成：sidebar.panellist + main[' + PANEL_ID + ']')
  ctx.effect(function () { return function () { console.log('[dsh-weknora] 浏览器半卸载') } })
  } catch (e) {
    // 任何注册异常都不能让整个插件 entry 变 failed —— 那会让 DSH 起不来。
    console.error('[dsh-weknora] 初始化失败（已降级，不影响 DSH 启动）:', e)
  }
}

exports.apply = apply
exports.inject = inject

// 本地渲染自测用的钩子（DSH 加载时不会碰它）
exports.__dev = {
  renderMarkdown: renderMarkdown,
  PdfView: PdfView,
  ReaderFrame: ReaderFrame,
  SheetView: SheetView,
  DocxView: DocxView,
  highlightQuote: highlightQuote,
  extOf: extOf,
  WeKnoraPage: WeKnoraPage,
  SetupDialog: SetupDialog,
  bindCiteLinks: bindCiteLinks,
  decorateCiteMarks: decorateCiteMarks,
  citeTabParams: citeTabParams, openCiteDetail: openCiteDetail,
  CiteOverlay: CiteOverlay, openCiteOverlay: openCiteOverlay,
  CiteTabBody: CiteTabBody, openCiteInSidebar: openCiteInSidebar,
  css: CSS,
}
