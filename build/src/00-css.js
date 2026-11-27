// 常量、CSS 变量与样式注入
// 由 build/src 拼接后注入 factory，和同目录其它片段共享作用域（不要加 import/export）。
/**
 * 插件主逻辑（被 build.mjs 嵌进 DSH 的闭包工厂里）
 *
 * 可用变量：
 *   require            DSH 模块加载器
 *   __VIEWER_CSS__     预览引擎的样式（构建时注入的 JSON 字符串）
 *   window.__DSH_WK_VIEWER__  预览引擎（构建时注入的 IIFE 设置）
 *
 * ⚠️ sidebar.panellist 注册的组件只能是「图标」：
 *    侧边栏自己渲染 <button aria-label={label}><span class=glyph>{组件}</span><span class=title>{label}</span></button>
 *    组件里再写文字会重复出现。
 */

var react = require('react')
var React = react
var h = react.createElement

var PANEL_ID = 'dsh-weknora-panel'
var API = '/api/weknora'

// ── 样式 ─────────────────────────────────────────────────
var CSS = [
  '.dsh-wk-root{display:flex;flex-direction:column;height:100%;max-height:100%;min-height:0;overflow:hidden;font-size:var(--dsw-font-base-font-size,14px);line-height:1.65;color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dsw-alias-bg-primary,#fff);font-family:var(--dsw-font-family,inherit)}',
  '.dsh-wk-head{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08));flex-shrink:0}',
  '.dsh-wk-title{font-size:1.08em;font-weight:500}',
  '.dsh-wk-spacer{flex:1;min-width:0}',
  '.dsh-wk-badge{font-size:.88em;color:var(--dsw-alias-label-secondary,#666)}',
  '.dsh-wk-stamp{font-size:.85em;color:var(--dsw-alias-label-tertiary,#999);white-space:nowrap}',
  '.dsh-wk-btn{display:inline-flex;align-items:center;gap:5px;font-size:.92em;padding:5px 11px;border-radius:6px;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.12));background:transparent;color:var(--dsw-alias-label-primary,#1a1a1a);cursor:pointer;font-family:inherit;line-height:1.45;white-space:nowrap;text-decoration:none}',
  // ⚠️ 主按钮必须单独写 hover：.dsh-wk-btn:hover 的优先级高于 .dsh-wk-btn-p，
  //    不覆盖的话悬停时蓝底会被换成浅色，而文字仍是白色 → 白字白底看不见
  '.dsh-wk-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}',
  '.dsh-wk-btn-p{background:var(--dsw-alias-interactive-bg-primary,#3b6cf6);border-color:var(--dsw-alias-interactive-bg-primary,#3b6cf6);color:#fff}',
  '.dsh-wk-btn-p:hover{background:var(--dsw-alias-interactive-bg-primary,#3b6cf6);border-color:var(--dsw-alias-interactive-bg-primary,#3b6cf6);color:#fff;filter:brightness(.9)}',
  '.dsh-wk-btn-p:active{filter:brightness(.82)}',
  '.dsh-wk-btn-d{color:var(--dsw-alias-status-danger,#d93838)}',
  '.dsh-wk-btn-d:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-status-danger,#d93838)}',
  '.dsh-wk-btn:disabled{opacity:.45;cursor:default;filter:none}',
  '.dsh-wk-btn-p:disabled{background:var(--dsw-alias-interactive-bg-primary,#3b6cf6);color:#fff}',
  '.dsh-wk-ibtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;flex-shrink:0}',
  '.dsh-wk-ibtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}',
  '.dsh-wk-body{flex:1;display:flex;min-height:0;min-width:0;overflow:hidden}',
  '.dsh-wk-kbs{width:200px;border-right:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08));overflow:auto;padding:10px;flex-shrink:0}',
  '.dsh-wk-kb{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:2px}',
  '.dsh-wk-kb:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}',
  '.dsh-wk-kb-on{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}',
  '.dsh-wk-kb-name{flex:1;font-size:1em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-wk-tag{font-size:.8em;padding:2px 6px;border-radius:4px;flex-shrink:0}',
  '.dsh-wk-tag-s{background:#e1f5ee;color:#085041}',
  '.dsh-wk-tag-m{background:#e6f1fb;color:#0c447c}',
  '.dsh-wk-main{flex:1;overflow:auto;padding:14px 18px;min-width:0;display:flex;flex-direction:column}',
  '.dsh-wk-center{flex:1;display:flex;align-items:center;justify-content:center;padding:24px;overflow:auto}',
  '.dsh-wk-dlg{width:460px;max-width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-primary,#fff);border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.1));border-radius:12px;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,.10);font-size:var(--dsw-font-base-font-size,14px)}',
  '.dsh-wk-crumb{font-size:1em;color:var(--dsw-alias-label-secondary,#666);margin-bottom:12px;display:flex;align-items:center;gap:8px;min-width:0;flex-shrink:0}',
  '.dsh-wk-crumb a{color:inherit;cursor:pointer;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-wk-crumb a:hover{text-decoration:underline}',
  '.dsh-wk-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:6px;cursor:pointer;flex-shrink:0}',
  // 左侧分组（对齐 ima 自己的「个人知识库 / 共享知识库」折叠分组）
  '.dsh-wk-kbsec{margin-bottom:4px}',
  '.dsh-wk-kbsec-h{display:flex;align-items:center;gap:5px;padding:6px 6px 4px;font-size:.92em;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;user-select:none;border-radius:6px}',
  '.dsh-wk-kbsec-h:hover{color:var(--dsw-alias-label-primary,#1a1a1a)}',
  '.dsh-wk-kbsec-t{font-weight:500}',
  '.dsh-wk-chev{display:inline-flex;color:var(--dsw-alias-label-tertiary,#999);transition:transform .15s ease}',
  '.dsh-wk-chev-off{transform:rotate(-90deg)}',
  '.dsh-wk-kbsec-add{width:20px;height:20px;padding:0;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#999);font-size:1.15em;line-height:1;border-radius:5px;cursor:pointer;font-family:inherit}',
  '.dsh-wk-kbsec-add:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#1a1a1a)}',
  '.dsh-wk-folds{margin-top:14px;border-top:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08));padding-top:8px}',
  '.dsh-wk-fold-h{font-size:.82em;color:var(--dsw-alias-label-tertiary,#999);padding:2px 6px 6px;letter-spacing:.04em}',
  '.dsh-wk-fold{display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:6px;cursor:pointer;font-size:.92em;color:var(--dsw-alias-label-secondary,#555)}',
  '.dsh-wk-fold:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}',
  '.dsh-wk-fold-on{background:var(--dsw-alias-interactive-bg-selected,rgba(43,108,176,.1));color:var(--dsw-alias-label-primary,#1a1a1a);font-weight:500}',
  '.dsh-wk-fold-t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-wk-up{position:absolute;right:14px;bottom:14px;width:300px;max-height:42%;overflow:auto;background:var(--dsw-alias-bg-elevated,#fff);border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.1));border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.14);padding:10px 12px;z-index:30}',
  '.dsh-wk-up-h{display:flex;align-items:center;justify-content:space-between;font-size:.86em;color:var(--dsw-alias-label-secondary,#666);margin-bottom:8px}',
  '.dsh-wk-up-item{margin-bottom:9px}',
  '.dsh-wk-up-name{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:.86em;margin-bottom:4px}',
  '.dsh-wk-up-t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#1a1a1a)}',
  '.dsh-wk-up-s{flex-shrink:0;color:var(--dsw-alias-label-tertiary,#999);font-variant-numeric:tabular-nums}',
  '.dsh-wk-up-bar{height:4px;border-radius:2px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.08));overflow:hidden}',
  '.dsh-wk-up-fill{height:100%;background:#2b6cb0;border-radius:2px;transition:width .18s ease}',
  '.dsh-wk-up-fill-err{background:#c53030}',
  '.dsh-wk-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}',
  '.dsh-wk-item-t{flex:1;font-size:1em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
  '.dsh-wk-item-y{font-size:.85em;color:var(--dsw-alias-label-tertiary,#999);flex-shrink:0}',
  // 行内操作：图标+文字，常驻显示（之前只显示图标且要悬停才出现，太不显眼）
  '.dsh-wk-act{display:flex;gap:4px;flex-shrink:0;margin-left:4px;opacity:.35;transition:opacity .15s}',
  '.dsh-wk-item:hover .dsh-wk-act{opacity:1}',
  '.dsh-wk-actbtn{padding:2px 6px;font-size:11px}',
  '.dsh-wk-actbtn{display:inline-flex;align-items:center;gap:5px;font-size:.86em;padding:4px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.14));background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;font-family:inherit;line-height:1.45;white-space:nowrap}',
  '.dsh-wk-actbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary,#1a1a1a)}',
  '.dsh-wk-actbtn-p{color:var(--dsw-alias-interactive-bg-primary,#3b6cf6);border-color:var(--dsw-alias-interactive-bg-primary,#3b6cf6);font-weight:500}',
  '.dsh-wk-actbtn-p:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-interactive-bg-primary,#3b6cf6)}',
  '.dsh-wk-empty{padding:48px 20px;text-align:center;color:var(--dsw-alias-label-tertiary,#999);font-size:1em}',
  '.dsh-wk-err{font-size:.92em;color:var(--dsw-alias-status-danger,#d93838);padding:10px 16px;line-height:1.6;flex-shrink:0}',
  '.dsh-wk-pre{white-space:pre-wrap;word-break:break-word;font-size:1em;line-height:1.75;background:var(--dsw-alias-bg-secondary,#f5f5f5);border-radius:8px;padding:16px;margin-top:12px;overflow:auto;font-family:var(--dsw-font-family,inherit)}',
  '.dsh-wk-vbox{margin-top:12px;border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-secondary,#f5f5f5)}',
  '.dsh-wk-vbox>div{height:100%}',
  '.dsh-wk-md h1{font-size:1.45em;font-weight:500;margin:1em 0 .5em}',
  '.dsh-wk-md h2{font-size:1.25em;font-weight:500;margin:1em 0 .5em}',
  '.dsh-wk-md h3{font-size:1.1em;font-weight:500;margin:.9em 0 .5em}',
  '.dsh-wk-md h4,.dsh-wk-md h5,.dsh-wk-md h6{font-size:1em;font-weight:500;margin:.8em 0 .4em}',
  '.dsh-wk-md p{margin:.55em 0}',
  '.dsh-wk-md code{font-size:.92em;background:var(--dsw-alias-bg-tertiary,rgba(0,0,0,.06));padding:1px 5px;border-radius:4px;font-family:ui-monospace,Menlo,Consolas,monospace}',
  '.dsh-wk-md pre{background:var(--dsw-alias-bg-tertiary,rgba(0,0,0,.06));border-radius:6px;padding:10px 12px;overflow:auto;margin:.6em 0}',
  '.dsh-wk-md pre code{background:none;padding:0}',
  '.dsh-wk-md strong{font-weight:500}',
  '.dsh-wk-md em{font-style:italic}',
  '.dsh-wk-md ul,.dsh-wk-md ol{padding-left:1.5em;margin:.5em 0}',
  '.dsh-wk-md li{margin:.22em 0}',
  '.dsh-wk-md a{color:var(--dsw-alias-interactive-bg-primary,#3b6cf6);text-decoration:none;word-break:break-all}',
  '.dsh-wk-md a:hover{text-decoration:underline}',
  '.dsh-wk-md hr{border:none;border-top:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.12));margin:1em 0}',
  '.dsh-wk-md blockquote{margin:.6em 0;padding:.1em 0 .1em .9em;border-left:2px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.16));color:var(--dsw-alias-label-secondary,#666)}',
  // 会议听记的发言人行（ima 听记类笔记展平后靠「发言人N 时间戳」还原）
  '.dsh-wk-spk{display:inline-block;margin:.9em 0 .15em;padding:1px 8px;border-radius:5px;background:var(--dsw-alias-bg-tertiary,rgba(0,0,0,.06));color:var(--dsw-alias-label-secondary,#666);font-size:.88em;line-height:1.6;font-variant-numeric:tabular-nums}',
  '.dsh-wk-md>:first-child{margin-top:0}',
  '.dsh-wk-md>:last-child{margin-bottom:0}',
  '.dsh-wk-rawhint{font-size:.85em;color:var(--dsw-alias-label-tertiary,#999);line-height:1.7;margin-top:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08))}',
  '.dsh-wk-dlg h3{margin:0 0 8px;font-size:1.12em;font-weight:500}',
  '.dsh-wk-f{margin-top:14px}',
  '.dsh-wk-f label{display:block;font-size:.92em;color:var(--dsw-alias-label-secondary,#666);margin-bottom:6px}',
  '.dsh-wk-f input{width:100%;box-sizing:border-box;font-size:.95em;padding:9px 11px;border-radius:6px;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.12));background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font-family:inherit}',
  '.dsh-wk-acts{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:20px}',
  '.dsh-wk-link{background:none;border:none;padding:0;font-size:.88em;color:var(--dsw-alias-label-tertiary,#999);cursor:pointer;font-family:inherit;text-decoration:underline;text-underline-offset:2px}',
  '.dsh-wk-link:hover{color:var(--dsw-alias-label-secondary,#666)}',
  '.dsh-wk-step{display:flex;gap:10px;margin-top:16px;align-items:flex-start}',
  '.dsh-wk-stepno{flex-shrink:0;width:20px;height:20px;border-radius:50%;background:var(--dsw-alias-bg-secondary,#f0f0f0);color:var(--dsw-alias-label-secondary,#666);font-size:.85em;display:inline-flex;align-items:center;justify-content:center;margin-top:2px}',
  '.dsh-wk-tip2{font-size:.9em;color:var(--dsw-alias-status-success,#1a9e6a);background:var(--dsw-alias-bg-secondary,#f5f5f5);border-radius:6px;padding:8px 12px;margin-top:14px;line-height:1.6}',
  '.dsh-wk-big{width:100%;box-sizing:border-box;padding:12px;font-size:1.05em;margin-top:18px;border-radius:8px}',
  '.dsh-wk-waitbar{display:flex;align-items:center;gap:8px;font-size:.92em;color:var(--dsw-alias-label-secondary,#666);margin-top:14px}',
  '.dsh-wk-spin{display:inline-block;width:13px;height:13px;border:2px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.15));border-top-color:var(--dsw-alias-interactive-bg-primary,#3b6cf6);border-radius:50%;animation:dsh-wk-rot .8s linear infinite}',
  '@keyframes dsh-wk-rot{to{transform:rotate(360deg)}}',
  '.dsh-wk-filled{font-size:.9em;color:var(--dsw-alias-label-secondary,#666);background:var(--dsw-alias-bg-secondary,#f5f5f5);border-radius:6px;padding:10px 12px;margin-top:14px;line-height:1.9;font-family:ui-monospace,Menlo,Consolas,monospace}',
  '.dsh-wk-note{font-size:.92em;color:var(--dsw-alias-label-secondary,#666);line-height:1.7}',
  '.dsh-wk-toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.82);color:#fff;font-size:.92em;padding:9px 18px;border-radius:8px;z-index:3000;pointer-events:none}',
  '.dsh-wk-input{flex:1;min-width:0;font-size:.95em;padding:6px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.12));background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font-family:inherit}',
  '.dsh-wk-hit{border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.1));border-radius:8px;padding:10px 12px;margin-bottom:10px}',
  '.dsh-wk-hit-h{display:flex;align-items:center;gap:8px;margin-bottom:6px;min-width:0}',
  '.dsh-wk-hit-b{font-size:.94em;line-height:1.7;color:var(--dsw-alias-label-secondary,#666);white-space:pre-wrap;word-break:break-word;max-height:8.5em;overflow:hidden}',
  '.dsh-wk-gist{font-size:.95em;line-height:1.7;color:var(--dsw-alias-label-secondary,#666);background:var(--dsw-alias-bg-secondary,#f5f5f5);border-radius:8px;padding:10px 12px;margin-bottom:8px}',
  '.dsh-wk-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}',
  '.dsh-wk-chip{font-size:.82em;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-tertiary,rgba(0,0,0,.06));color:var(--dsw-alias-label-secondary,#666)}',
  '.dsh-wk-tag-e{background:#fdecec;color:#a32020}',
  '.dsh-wk-media{margin-top:12px;max-width:100%;max-height:70vh;border-radius:8px;display:block}',
  '.dsh-wk-root{position:relative;min-width:0;overflow:hidden}',
  '.dsh-wk-overlay{position:absolute;inset:0;background:rgba(0,0,0,.30);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px;overflow:auto}',
  '.dsh-wk-lbl{display:block;font-size:.85em;color:var(--dsw-alias-label-secondary,#666);margin:14px 0 5px}',
  '.dsh-wk-inp{width:100%;box-sizing:border-box;font-size:.95em;padding:8px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.14));background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font-family:inherit}',
  '.dsh-wk-inp:focus{outline:2px solid var(--dsw-alias-interactive-bg-primary,#3b6cf6);outline-offset:-1px}',
  '.dsh-wk-frame{width:100%;height:100%;min-height:360px;flex:1;border:none;background:#fff;border-radius:4px}',
  '.dsh-wk-live{border:1px solid #e2e8f0;border-radius:8px;margin:6px 0;background:#fbfcfe;overflow:hidden}',
  '.dsh-wk-live-h{display:flex;align-items:center;gap:6px;padding:6px 10px;font-size:12px;color:#4a5568;background:#f1f5f9;border-bottom:1px solid #e2e8f0}',
  '.dsh-wk-live-dot{width:7px;height:7px;border-radius:50%;background:#38a169;box-shadow:0 0 0 3px rgba(56,161,105,.15)}',
  '.dsh-wk-live-dot-off{background:#a0aec0;box-shadow:none}',
  '.dsh-wk-live-err{color:#c53030;margin-left:auto}',
  '.dsh-wk-live-b{max-height:420px;overflow:auto;padding:10px 12px;font-size:13px;line-height:1.75}',
  '.dsh-wk-live-wait{color:#718096;font-size:12px}',
  '.dsh-wk-img{max-width:100%;height:auto;display:block;margin:6px 0;border-radius:4px}',
  '.dsh-wk-hitsnip{margin:0 0 8px;padding:8px 10px;background:#fff3bf;border-radius:6px;font-size:12px;line-height:1.7;color:#3d3320;max-height:110px;overflow:auto}',
  '.dsh-wk-hitsnip-h{display:block;font-weight:600;margin-bottom:2px;color:#8a6d1d}',
  '.dsh-wk-loading{display:flex;align-items:center;justify-content:center;color:#888;font-size:12px;border:1px dashed #ddd;border-radius:4px}',
  '.dsh-wk-pdfframe{flex:1 1 auto;width:100%;height:100%;min-height:0;border:0;background:#fff}',
  '.dsh-wk-pdf{position:relative;display:flex;flex-direction:column;height:100%;min-height:420px}',
  '.dsh-wk-pdfbar{display:flex;align-items:center;gap:8px;padding:0 0 6px}',
  '.dsh-wk-pdfno{font-size:12px;color:#666}',
  '.dsh-wk-pdfno-float{position:absolute;right:12px;bottom:10px;z-index:3;padding:2px 8px;border-radius:10px;background:rgba(0,0,0,.5);color:#fff;font-size:11px;line-height:16px;pointer-events:none}',
  '.dsh-wk-pdfbox{position:relative;flex:1;min-height:0;overflow:auto;background:#f5f5f5;border:1px solid #e2e2e2;border-radius:4px;scroll-behavior:auto}',
  '.dsh-wk-pdfbar{display:flex;align-items:center;gap:6px;padding:0 0 6px;flex-shrink:0}',
  '.dsh-wk-zbtn{height:24px;min-width:24px;padding:0 8px;border:1px solid rgba(0,0,0,.14);background:transparent;border-radius:5px;color:inherit;font-size:12px;line-height:1;cursor:pointer}',
  '.dsh-wk-zbtn:hover{background:rgba(0,0,0,.05)}',
  '.dsh-wk-zbtn-w{min-width:66px}',
  '.dsh-wk-pdf,.dsh-wk-pdfbox{overflow-anchor:none}',
  '.dsh-wk-pdfpage{position:relative;margin:8px auto;max-width:100%}',
  '.dsh-wk-pdfcanvas{display:block;max-width:100%;height:auto;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.12)}',
  '.dsh-wk-pdfhl{position:absolute;background:rgba(255,214,10,.45);border-radius:2px;pointer-events:none}',
  '.dsh-wk-tl{position:absolute;inset:0;overflow:clip;opacity:1;line-height:1;text-align:initial;transform-origin:0 0;z-index:1;pointer-events:none;--min-font-size:1;--text-scale-factor:calc(var(--scale-factor) * var(--min-font-size));--min-font-size-inv:calc(1 / var(--min-font-size))}',
  '.dsh-wk-tl span{color:transparent;position:absolute;white-space:pre;transform-origin:0% 0%}',
  '.dsh-wk-tl > :not(.markedContent),.dsh-wk-tl .markedContent span:not(.markedContent){z-index:1;--font-height:0;font-size:calc(var(--text-scale-factor) * var(--font-height));--scale-x:1;--rotate:0deg;transform:rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))}',
  '.dsh-wk-tl .markedContent{display:contents}',
    '.dsh-wk-ovl{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.35)}',
  '.dsh-wk-ovl-card{display:flex;flex-direction:column;width:min(1100px,92vw);height:min(88vh,900px);background:#fff;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.24);overflow:hidden}',
  '.dsh-wk-ovl-h{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid rgba(0,0,0,.08);flex-shrink:0}',
  '.dsh-wk-ovl-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:13px}',
  '.dsh-wk-ovl-b{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
'.dsh-wk-citetab-b.dsh-wk-nos,.dsh-wk-nos{flex:1 1 auto;height:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;padding:0}',
  '.dsh-wk-x{width:20px;height:20px;padding:0;border:none;border-radius:4px;background:transparent;color:#888;font-size:12px;line-height:20px;cursor:pointer;flex-shrink:0}',
  '.dsh-wk-x:hover{background:rgba(0,0,0,.08);color:#333}',
  // ── 右侧边栏「知识库原文」tab ──
  '.dsh-wk-citetab{display:flex;flex-direction:column;min-height:0;min-width:0;overflow:hidden;box-sizing:border-box;font-size:13px;line-height:1.75;color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dsw-alias-bg-primary,#fff)}',
  // 右侧栏 tab 的容器在 DSH 里可能是 auto 高度，height:100% 会塌成 0 → 预览一片白。
  '.dsh-wk-citetab-b>div{min-height:0}',
  '.dsh-wk-citetab-h{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08));flex-shrink:0}',
  '.dsh-wk-citetab-t{font-size:.95em;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%}',
  '.dsh-wk-citetab-b{flex:1;min-height:0;overflow:auto;padding:12px 14px}',
  '.dsh-wk-citetab .dsh-wk-hl{background:#fff3bf;box-shadow:0 0 0 5px #fff3bf;border-radius:3px}',
  // ── 问答页 ──
  '.dsh-wk-tabs{display:flex;gap:2px;padding:0 10px;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.1))}',
  '.dsh-wk-split{display:flex;flex:1;min-height:0;gap:0}',
  '.dsh-wk-qa-pane{width:50%;min-width:300px;display:flex;min-height:0;overflow:hidden;border-right:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.1))}',
  '.dsh-wk-kb-pane{flex:1;min-width:0;display:flex;min-height:0;overflow:hidden}',
  '.dsh-wk-qa{padding:10px 12px;display:flex;flex-direction:column;min-height:0;flex:1;width:100%}',
  '.dsh-wk-qa-top{display:flex;align-items:center;gap:6px;margin-bottom:8px}',
  '.dsh-wk-qa-lbl{font-size:11.5px;opacity:.65;flex:none}',
  '.dsh-wk-sel{height:26px;border-radius:6px;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.14));background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;font-size:12px;padding:0 6px;max-width:200px}',
  '.dsh-wk-sel:focus{outline:none;border-color:var(--dsw-alias-border-brand,#3b82f6)}',
  '.dsh-wk-qa-hint{font-size:11px;opacity:.45;margin-left:auto}',
  // 问答区（照 WeKnora 聊天页：消息流 + 底部 composer）
  '.dsh-wk-chat{flex:1;display:flex;flex-direction:column;min-height:0;min-width:0;padding:0}',
  '.dsh-wk-chat-inner{flex:1;display:flex;min-height:0;min-width:0}',
  '.dsh-wk-hist{width:158px;flex:none;border-right:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08));overflow:auto;padding:10px 8px}',
  '.dsh-wk-new{width:100%;height:28px;border-radius:7px;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;font-size:12px;cursor:pointer;margin-bottom:10px}',
  '.dsh-wk-new:hover{border-color:var(--dsw-alias-border-brand,#3b82f6)}',
  '.dsh-wk-hist-g{margin-bottom:10px}',
  '.dsh-wk-hist-h{font-size:11px;opacity:.45;padding:0 4px 4px}',
  '.dsh-wk-hist-i{font-size:12px;line-height:1.45;padding:5px 7px;border-radius:6px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.8}',
  '.dsh-wk-hist-i:hover{background:var(--dsw-alias-bg-layer-2,#f2f4f8);opacity:1}',
  '.dsh-wk-hist-on{background:var(--dsw-alias-bg-layer-3,#e8f0fe);opacity:1;font-weight:500}',
  '.dsh-wk-qa-empty{display:flex;align-items:center;justify-content:center;opacity:.5;font-size:13px}',
  '.dsh-wk-chat-main{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0;padding:10px 12px 12px}',
  '.dsh-wk-chat-top{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex:none}',
  '.dsh-wk-chat-hint{font-size:11px;opacity:.45;margin-left:auto}',
  '.dsh-wk-msgs{flex:1;min-height:0;overflow:auto;padding:0 20px 12px;display:flex;flex-direction:column;gap:16px}',
  '.dsh-wk-msgs>*{width:100%;max-width:960px;margin:0 auto}',
  '.dsh-wk-msg{display:flex;flex-direction:column;gap:4px;max-width:100%}',
  '.dsh-wk-msg-u{align-items:flex-end}',
  '.dsh-wk-msg-u .dsh-wk-bubble{width:max-content;max-width:min(76%,820px);margin-left:auto;background:#f3f3f3;border-radius:9px;padding:8px 12px;font-size:15px;line-height:1.6;white-space:pre-wrap;word-break:break-word}',
  '.dsh-wk-msg-a{align-items:stretch}',
  '.dsh-wk-ans{font-size:15px;line-height:1.75;max-width:100%}',
  '.dsh-wk-msg-bar{display:flex;align-items:center;gap:10px;margin-top:2px}',
  '.dsh-wk-typing{display:inline-flex;align-items:center;gap:6px;font-size:12px;opacity:.6}',
  '.dsh-wk-typing:before{content:"";width:10px;height:10px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;animation:dsh-wk-spin .8s linear infinite}',
  '@keyframes dsh-wk-spin{to{transform:rotate(360deg)}}',
  '.dsh-wk-welcome{margin:auto;max-width:460px;text-align:center;padding:24px 12px}',
  '.dsh-wk-welcome-t{font-size:20px;font-weight:600;margin-bottom:8px}',
  '.dsh-wk-welcome-s{font-size:14px;opacity:.6;line-height:1.7;margin-bottom:20px}',
  '.dsh-wk-sq{display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:left}',
  '.dsh-wk-sq-card{border:1px solid #dcdcdc;background:#fff;color:inherit;border-radius:9px;padding:10px 12px;font-size:14px;line-height:1.5;text-align:left;cursor:pointer;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
  '.dsh-wk-sq-card:hover{border-color:#0052d9;color:#0052d9}',
  '.dsh-wk-composer{flex:none;display:flex;gap:8px;align-items:flex-end;padding-top:8px;border-top:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08))}',
  '.dsh-wk-ta{flex:1;min-height:46px;max-height:180px;resize:none;border-radius:9px;border:1px solid #dcdcdc;background:#fff;color:inherit;font-size:15px;line-height:1.6;padding:10px 12px;font-family:inherit}',
  '.dsh-wk-ta:focus{outline:none;border-color:#0052d9}',
  '.dsh-wk-send{flex:none;height:34px;padding:0 16px;border-radius:9px;border:none;background:#0052d9;color:#fff;font-size:14px;cursor:pointer}',
  '.dsh-wk-send:disabled{opacity:.45;cursor:default}',
  '.dsh-wk-stop{background:#ef4444}',
  '.dsh-wk-tab{border:0;background:none;font:inherit;font-size:.9em;color:var(--dsw-alias-label-secondary,#666);padding:7px 12px;cursor:pointer;border-radius:6px 6px 0 0}',
  '.dsh-wk-tab:hover{background:var(--dsw-alias-bg-secondary,rgba(0,0,0,.04))}',
  '.dsh-wk-tab-on{color:var(--dsw-alias-label-primary,#1a1a1a);font-weight:600;box-shadow:inset 0 -2px 0 var(--dsw-alias-interactive-bg-primary,#3b6cf6)}',
  '.dsh-wk-qa{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;padding:10px;gap:8px}',
  '.dsh-wk-qa-body{flex:1;min-height:0;overflow:auto;padding-right:2px}',
  '.dsh-wk-cite{display:inline-block;min-width:15px;height:15px;padding:0 3px;margin:0 1px;border:0;border-radius:8px;background:#e6effb;color:#2b6cb0;font-size:10px;font-weight:700;line-height:15px;cursor:pointer;position:relative;top:-.35em;font-family:inherit;text-align:center}',
  '.dsh-wk-cite:hover{background:#2b6cb0;color:#fff}',
  '.dsh-wk-citebox{position:absolute;inset:0;background:rgba(15,23,42,.32);display:flex;align-items:flex-end;justify-content:center;z-index:60}',
  '.dsh-wk-citecard{background:var(--dsw-alias-bg-primary,#fff);border-radius:10px 10px 0 0;max-height:86%;height:86%;width:100%;display:flex;flex-direction:column;box-shadow:0 -6px 24px rgba(0,0,0,.2);overflow:hidden}',
  '.dsh-wk-cite-h{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.1));min-width:0}',
  '.dsh-wk-cite-doc{font-size:.92em;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-wk-cite-n{font-size:11px;color:var(--dsw-alias-text-secondary,#6b7280);background:var(--dsw-alias-bg-secondary,#f3f4f6);border-radius:8px;padding:1px 7px;white-space:nowrap;flex:none}',
  '.dsh-wk-cite-b{overflow:auto;padding:12px 14px;flex:1}',
  '.dsh-wk-chunk{font-size:13px;line-height:1.8;color:var(--dsw-alias-text-primary,#1f2328);margin:0 0 12px;white-space:pre-wrap;word-break:break-word}',
  '.dsh-wk-hl{background:#fff3bf;box-shadow:0 0 0 5px #fff3bf;border-radius:3px}',
  '.dsh-wk-actbtn-on{background:var(--dsw-alias-bg-secondary,#eef2f7);color:var(--dsw-alias-text-primary,#1f2328);border-color:var(--dsw-alias-border-secondary,rgba(0,0,0,.14))}',
  '.dsh-wk-office{flex:1;overflow:hidden;background:var(--dsw-alias-bg-secondary,#f3f4f6)}',
  '.dsh-wk-office-frame{width:100%;height:100%;border:0;background:#fff}',
  '.dsh-wk-ans table{border-collapse:collapse;margin:10px 0;font-size:.88em;max-width:100%}',
  '.dsh-wk-ans th,.dsh-wk-ans td{border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.12));padding:5px 8px;text-align:left;vertical-align:top}',
  '.dsh-wk-ans th{background:var(--dsw-alias-bg-secondary,#f7f9fc);font-weight:600}',
  '.dsh-wk-ans h1,.dsh-wk-ans h2,.dsh-wk-ans h3,.dsh-wk-ans h4{font-size:1em;margin:14px 0 6px}',
  '.dsh-wk-reader-frame{display:block;width:100%;height:100%;min-height:420px;border:0;background:#fff;border-radius:4px}',
  '.dsh-wk-big{position:fixed;inset:0;z-index:99998;background:#fff;color:#222;display:flex;flex-direction:column;font-size:13px}',
  '.dsh-wk-big-h{display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid #e6e6e6;flex-shrink:0}',
  '.dsh-wk-big-t{font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-wk-big-b{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;padding:10px 14px;overflow:hidden}',
  '.dsh-wk-big{position:fixed;inset:0;z-index:99998;background:#fff;color:#222;display:flex;flex-direction:column;font-size:13px}',
  '.dsh-wk-big-h{display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid #e6e6e6;flex-shrink:0}',
  '.dsh-wk-big-t{font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-wk-big-b{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;padding:10px 14px;overflow:hidden}',
  '.dsh-wk-docx{display:flex;flex-direction:column;flex:1 1 auto;height:0;min-height:0;overflow:hidden;min-width:0}',
  '.dsh-wk-docxbox{flex:1 1 auto;height:0;min-height:0;overflow:auto;background:#fff;padding:10px 12px}',
  '.dsh-wk-docxbox .docx-wrapper{background:#fff;padding:0;display:block}',
  '.dsh-wk-docxbox .docx{box-shadow:none;margin:0 auto 14px}',
  // Word：把 docx-preview 写死的 A4 宽度压到容器宽度（WeKnora 的 docx-preview-wrapper 规则）。
  // 不靠缩放，字号保持原值，所以「打开就能看全」而不是「局部放大」。
  '.dsh-wk-docxbox .docx-wrapper{max-width:100%;width:100%;box-sizing:border-box;overflow-x:auto}',
  '.dsh-wk-docxbox .docx-wrapper *{max-width:100%!important;box-sizing:border-box}',
  '.dsh-wk-docxbox section.docx{width:100%!important;min-width:0!important;padding:24px 20px!important;margin:0 auto 12px!important}',
  '.dsh-wk-docxbox section.docx [style*="width"]{max-width:100%!important}',
  '.dsh-wk-docxbox table{width:100%!important;table-layout:auto;word-wrap:break-word}',
  '.dsh-wk-docxbox img{max-width:100%;height:auto}',
  // 只留命中处的黄底：docx 自带的段间/表格底色全部抹掉，否则看起来是一堆杂色块
  '.dsh-wk-docxbox *:not(mark){background-color:transparent!important;background-image:none!important}',
  'mark.dsh-wk-hl{background:#ffe58f!important;color:inherit!important;padding:0 1px;border-radius:2px}',
  '.dsh-wk-sheetwrap{flex:1 1 auto;height:0;min-height:0;overflow:auto;padding:8px 10px}',
  '.dsh-wk-sheetone{margin-bottom:16px}',
  '.dsh-wk-sheetname{font-size:12px;font-weight:600;color:#666;margin-bottom:6px}',
  '.dsh-wk-sheetwrap{min-width:0;max-width:100%;display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:hidden}',
  '.dsh-wk-sheetone{min-width:0;max-width:100%;display:flex;flex-direction:column;min-height:0}',
  // overflow-x:scroll 而不是 auto：滚动条常驻，否则用户不知道右边还有列。
  '.dsh-wk-sheetbox{min-width:0;max-width:100%;overflow:auto;overflow-x:scroll;border:1px solid #e3e3e3;border-radius:4px;max-height:none}',
  '.dsh-wk-sheetbox::-webkit-scrollbar{width:12px;height:12px}',
  '.dsh-wk-sheetbox::-webkit-scrollbar-track{background:#f1f1f1;border-radius:6px}',
  '.dsh-wk-sheetbox::-webkit-scrollbar-thumb{background:#c1c1c1;border-radius:6px}',
  '.dsh-wk-sheetbox::-webkit-scrollbar-thumb:hover{background:#a8a8a8}',
  // 横向滚动时表头行仍然可见
  '.dsh-wk-sheetbox tr:first-child td,.dsh-wk-sheetbox tr:first-child th{position:sticky;top:0;z-index:2;background:#f5f7fa}',
  '.dsh-wk-sheettable,.dsh-wk-sheetbox table{border-collapse:collapse;font-size:12px}',
  // 照 WeKnora document-preview.vue:1703 —— nowrap 必须配 max-width，
  // 否则一个装了整段制度的单元格就有几千像素宽。
  '.dsh-wk-sheettable td,.dsh-wk-sheetbox td,.dsh-wk-sheetbox th{border:1px solid #ececec;padding:3px 8px;vertical-align:top;white-space:nowrap;max-width:300px;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box}',
  '.dsh-wk-sheethead{background:#f5f7fa!important;font-weight:600}',
].join('')

var CSS_TAG_ID = 'dsh-weknora/panel.css'
function injectStyle(tagId, css, plugin) {
  if (typeof document === 'undefined' || !css) return
  if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']')) return
  var tag = document.createElement('style')
  tag.dataset.plugin = plugin
  tag.dataset.pluginCss = tagId
  tag.textContent = css
  document.head.appendChild(tag)
}
function injectCss() {
  injectStyle(CSS_TAG_ID, CSS, 'dsh-weknora')
  injectStyle('dsh-weknora/viewer.css', window.__DSH_WK_VIEWER_CSS__, 'dsh-weknora')
  injectCiteStyles()
  // 布局 CSS 也必须进每个 shadowRoot：DSH 的右侧栏跑在 shadow root 里，
  // 只注 head 的话预览容器一条高度规则都拿不到，内容会被裁成白屏。
  injectIntoShadowRoots(CSS_TAG_ID, CSS)
  injectIntoShadowRoots('dsh-weknora/viewer.css', window.__DSH_WK_VIEWER_CSS__ || '')
}

// 把一份样式补进当前所有 shadowRoot（head 由 injectStyle 负责）。
function injectIntoShadowRoots(tagId, css) {
  if (typeof document === 'undefined' || !css) return
  var seen = weakSet()
  var stack = [document]
  var guard = 0
  while (stack.length && guard++ < 4000) {
    var node = stack.pop()
    var all = node.querySelectorAll ? node.querySelectorAll('*') : []
    for (var i = 0; i < all.length; i++) {
      var sr = all[i].shadowRoot
      if (!sr || seen.has(sr)) continue
      seen.add(sr)
      putStyle(sr, tagId, css)
      stack.push(sr)
    }
  }
}

function putStyle(root, tagId, css) {
  if (!root || !css) return
  var sel = 'style[data-plugin-css=' + JSON.stringify(tagId) + ']'
  if (root.querySelector && root.querySelector(sel)) return
  var tag = document.createElement('style')
  tag.setAttribute('data-plugin-css', tagId)
  tag.dataset.plugin = 'dsh-weknora'
  tag.textContent = css
  ;(root.head || root).appendChild(tag)
}

// 就地确保 el 所在的那棵树里有我们的全部样式。
// 组件挂载时调用 —— 右侧栏的 shadowRoot 可能在 apply 之后才建出来。
function ensureStylesHere(el) {
  if (!el || typeof document === 'undefined') return
  var root = typeof el.getRootNode === 'function' ? el.getRootNode() : document
  if (!root || root === document) return
  putStyle(root, CSS_TAG_ID, CSS)
  putStyle(root, 'dsh-weknora/viewer.css', window.__DSH_WK_VIEWER_CSS__ || '')
  putStyle(root, 'dsh-weknora/cite.css', CITE_CSS)
}

// 会话里 agent 回答的角标是 a[href^="dsh-weknora:"]，
// 这里把它做成 WeKnora 网页那种上标小方块（浅蓝底、圆角、无下划线）。
var CITE_CSS = [
  'a[href^="dsh-weknora:"]{display:inline-block;min-width:15px;height:15px;padding:0 3px;margin:0 2px;border-radius:8px;background:#e7f0fd;color:#2b6cb0!important;font-size:10px;font-weight:700;line-height:15px;text-align:center;text-decoration:none!important;vertical-align:super;position:relative;top:-.15em;cursor:pointer;font-family:inherit;font-style:normal}',
  'a[href^="dsh-weknora:"]:hover{background:#d3e5fb;color:#1e4e8c!important}',
  'a[href^="dsh-weknora:"]:visited{color:#2b6cb0!important}',
  // 命中高亮：照 WeKnora document-preview.vue 的非 scoped 样式段。
  // 优先走 CSS Custom Highlight API（不改 DOM），色值取 theme.css 亮色主题。
  '::highlight(source-locate){background-color:rgba(250,204,75,.34)}',
  'mark.source-locate-mark{background-color:rgba(250,204,75,.34);color:inherit;border-radius:2px;box-decoration-break:clone;-webkit-box-decoration-break:clone}',
  '.source-locate-block{background-color:rgba(250,204,75,.09)!important;box-shadow:inset 3px 0 rgba(183,130,22,.5)}',
  // 单元格自己的底色会盖住整行的标记，所以逐格上色，强调只留在首列左侧。
  'tr.source-locate-block{background-color:transparent!important;box-shadow:none}',
  'tr.source-locate-block>td{background-color:rgba(250,204,75,.09)!important}',
  'tr.source-locate-block>td:first-child{box-shadow:inset 3px 0 rgba(183,130,22,.5)}',
  'img.source-locate-block{outline:1px solid rgba(183,130,22,.5);outline-offset:2px}',
].join('')

function injectCiteStyles() {
  if (typeof document === 'undefined') return
  var seen = weakSet()
  function into(root) {
    if (!root || seen.has(root)) return
    seen.add(root)
    if (root.querySelector && root.querySelector('style[data-plugin-css="dsh-weknora/cite.css"]')) return
    var tag = document.createElement('style')
    tag.setAttribute('data-plugin-css', 'dsh-weknora/cite.css')
    tag.dataset.plugin = 'dsh-weknora'
    tag.textContent = CITE_CSS
    ;(root.head || root).appendChild(tag)
  }
  into(document.head)
  // 会话区如果跑在 shadow root 里，全局样式进不去，逐个补一份
  var stack = [document]
  var guard = 0
  while (stack.length && guard++ < 4000) {
    var node = stack.pop()
    var all = node.querySelectorAll ? node.querySelectorAll('*') : []
    for (var i = 0; i < all.length; i++) {
      var sr = all[i].shadowRoot
      if (sr) { into(sr); stack.push(sr) }
    }
  }
}

function weakSet() {
  if (typeof WeakSet === 'function') return new WeakSet()
  var arr = []
  return {
    has: function (x) { return arr.indexOf(x) >= 0 },
    add: function (x) { arr.push(x) },
  }
}

// ── 图标（macOS 系统风格，全部内联 SVG，零外部依赖） ──────
// 文件夹画成访达同款蓝色立体文件夹；文件画成 Big Sur 风格的圆角方块
// （纵向渐变 + 顶部高光 + 白色符号）。
//   · 文件列表：按类型上色（PDF 红 / Word 蓝 / Excel 绿 …），便于一眼分辨
//   · 左侧知识库：统一用单色 macOS 文件夹（早期按库 id 哈希上色，五颜六色太乱，已废弃）
