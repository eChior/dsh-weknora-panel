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
  '.dsh-ima-root{display:flex;flex-direction:column;height:100%;max-height:100%;min-height:0;overflow:hidden;font-size:var(--dsw-font-base-font-size,14px);line-height:1.65;color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dsw-alias-bg-primary,#fff);font-family:var(--dsw-font-family,inherit)}',
  '.dsh-ima-head{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08));flex-shrink:0}',
  '.dsh-ima-title{font-size:1.08em;font-weight:500}',
  '.dsh-ima-spacer{flex:1;min-width:0}',
  '.dsh-ima-badge{font-size:.88em;color:var(--dsw-alias-label-secondary,#666)}',
  '.dsh-ima-stamp{font-size:.85em;color:var(--dsw-alias-label-tertiary,#999);white-space:nowrap}',
  '.dsh-ima-btn{display:inline-flex;align-items:center;gap:5px;font-size:.92em;padding:5px 11px;border-radius:6px;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.12));background:transparent;color:var(--dsw-alias-label-primary,#1a1a1a);cursor:pointer;font-family:inherit;line-height:1.45;white-space:nowrap;text-decoration:none}',
  // ⚠️ 主按钮必须单独写 hover：.dsh-ima-btn:hover 的优先级高于 .dsh-ima-btn-p，
  //    不覆盖的话悬停时蓝底会被换成浅色，而文字仍是白色 → 白字白底看不见
  '.dsh-ima-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}',
  '.dsh-ima-btn-p{background:var(--dsw-alias-interactive-bg-primary,#3b6cf6);border-color:var(--dsw-alias-interactive-bg-primary,#3b6cf6);color:#fff}',
  '.dsh-ima-btn-p:hover{background:var(--dsw-alias-interactive-bg-primary,#3b6cf6);border-color:var(--dsw-alias-interactive-bg-primary,#3b6cf6);color:#fff;filter:brightness(.9)}',
  '.dsh-ima-btn-p:active{filter:brightness(.82)}',
  '.dsh-ima-btn-d{color:var(--dsw-alias-status-danger,#d93838)}',
  '.dsh-ima-btn-d:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-status-danger,#d93838)}',
  '.dsh-ima-btn:disabled{opacity:.45;cursor:default;filter:none}',
  '.dsh-ima-btn-p:disabled{background:var(--dsw-alias-interactive-bg-primary,#3b6cf6);color:#fff}',
  '.dsh-ima-ibtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;flex-shrink:0}',
  '.dsh-ima-ibtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}',
  '.dsh-ima-body{flex:1;display:flex;min-height:0;min-width:0;overflow:hidden}',
  '.dsh-ima-kbs{width:200px;border-right:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08));overflow:auto;padding:10px;flex-shrink:0}',
  '.dsh-ima-kb{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:2px}',
  '.dsh-ima-kb:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}',
  '.dsh-ima-kb-on{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}',
  '.dsh-ima-kb-name{flex:1;font-size:1em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-ima-tag{font-size:.8em;padding:2px 6px;border-radius:4px;flex-shrink:0}',
  '.dsh-ima-tag-s{background:#e1f5ee;color:#085041}',
  '.dsh-ima-tag-m{background:#e6f1fb;color:#0c447c}',
  '.dsh-ima-main{flex:1;overflow:auto;padding:14px 18px;min-width:0;display:flex;flex-direction:column}',
  '.dsh-ima-center{flex:1;display:flex;align-items:center;justify-content:center;padding:24px;overflow:auto}',
  '.dsh-ima-dlg{width:460px;max-width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-primary,#fff);border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.1));border-radius:12px;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,.10);font-size:var(--dsw-font-base-font-size,14px)}',
  '.dsh-ima-crumb{font-size:1em;color:var(--dsw-alias-label-secondary,#666);margin-bottom:12px;display:flex;align-items:center;gap:8px;min-width:0;flex-shrink:0}',
  '.dsh-ima-crumb a{color:inherit;cursor:pointer;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-ima-crumb a:hover{text-decoration:underline}',
  '.dsh-ima-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:6px;cursor:pointer;flex-shrink:0}',
  // 左侧分组（对齐 ima 自己的「个人知识库 / 共享知识库」折叠分组）
  '.dsh-ima-kbsec{margin-bottom:4px}',
  '.dsh-ima-kbsec-h{display:flex;align-items:center;gap:5px;padding:6px 6px 4px;font-size:.92em;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;user-select:none;border-radius:6px}',
  '.dsh-ima-kbsec-h:hover{color:var(--dsw-alias-label-primary,#1a1a1a)}',
  '.dsh-ima-kbsec-t{font-weight:500}',
  '.dsh-ima-chev{display:inline-flex;color:var(--dsw-alias-label-tertiary,#999);transition:transform .15s ease}',
  '.dsh-ima-chev-off{transform:rotate(-90deg)}',
  '.dsh-ima-kbsec-add{width:20px;height:20px;padding:0;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#999);font-size:1.15em;line-height:1;border-radius:5px;cursor:pointer;font-family:inherit}',
  '.dsh-ima-kbsec-add:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#1a1a1a)}',
  '.dsh-ima-folds{margin-top:14px;border-top:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08));padding-top:8px}',
  '.dsh-ima-fold-h{font-size:.82em;color:var(--dsw-alias-label-tertiary,#999);padding:2px 6px 6px;letter-spacing:.04em}',
  '.dsh-ima-fold{display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:6px;cursor:pointer;font-size:.92em;color:var(--dsw-alias-label-secondary,#555)}',
  '.dsh-ima-fold:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}',
  '.dsh-ima-fold-on{background:var(--dsw-alias-interactive-bg-selected,rgba(43,108,176,.1));color:var(--dsw-alias-label-primary,#1a1a1a);font-weight:500}',
  '.dsh-ima-fold-t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-ima-up{position:absolute;right:14px;bottom:14px;width:300px;max-height:42%;overflow:auto;background:var(--dsw-alias-bg-elevated,#fff);border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.1));border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.14);padding:10px 12px;z-index:30}',
  '.dsh-ima-up-h{display:flex;align-items:center;justify-content:space-between;font-size:.86em;color:var(--dsw-alias-label-secondary,#666);margin-bottom:8px}',
  '.dsh-ima-up-item{margin-bottom:9px}',
  '.dsh-ima-up-name{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:.86em;margin-bottom:4px}',
  '.dsh-ima-up-t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#1a1a1a)}',
  '.dsh-ima-up-s{flex-shrink:0;color:var(--dsw-alias-label-tertiary,#999);font-variant-numeric:tabular-nums}',
  '.dsh-ima-up-bar{height:4px;border-radius:2px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.08));overflow:hidden}',
  '.dsh-ima-up-fill{height:100%;background:#2b6cb0;border-radius:2px;transition:width .18s ease}',
  '.dsh-ima-up-fill-err{background:#c53030}',
  '.dsh-ima-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}',
  '.dsh-ima-item-t{flex:1;font-size:1em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
  '.dsh-ima-item-y{font-size:.85em;color:var(--dsw-alias-label-tertiary,#999);flex-shrink:0}',
  // 行内操作：图标+文字，常驻显示（之前只显示图标且要悬停才出现，太不显眼）
  '.dsh-ima-act{display:flex;gap:4px;flex-shrink:0;margin-left:4px;opacity:.35;transition:opacity .15s}',
  '.dsh-ima-item:hover .dsh-ima-act{opacity:1}',
  '.dsh-ima-actbtn{padding:2px 6px;font-size:11px}',
  '.dsh-ima-actbtn{display:inline-flex;align-items:center;gap:5px;font-size:.86em;padding:4px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.14));background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;font-family:inherit;line-height:1.45;white-space:nowrap}',
  '.dsh-ima-actbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary,#1a1a1a)}',
  '.dsh-ima-actbtn-p{color:var(--dsw-alias-interactive-bg-primary,#3b6cf6);border-color:var(--dsw-alias-interactive-bg-primary,#3b6cf6);font-weight:500}',
  '.dsh-ima-actbtn-p:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-interactive-bg-primary,#3b6cf6)}',
  '.dsh-ima-empty{padding:48px 20px;text-align:center;color:var(--dsw-alias-label-tertiary,#999);font-size:1em}',
  '.dsh-ima-err{font-size:.92em;color:var(--dsw-alias-status-danger,#d93838);padding:10px 16px;line-height:1.6;flex-shrink:0}',
  '.dsh-ima-pre{white-space:pre-wrap;word-break:break-word;font-size:1em;line-height:1.75;background:var(--dsw-alias-bg-secondary,#f5f5f5);border-radius:8px;padding:16px;margin-top:12px;overflow:auto;font-family:var(--dsw-font-family,inherit)}',
  '.dsh-ima-vbox{margin-top:12px;border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-secondary,#f5f5f5)}',
  '.dsh-ima-vbox>div{height:100%}',
  '.dsh-ima-md h1{font-size:1.45em;font-weight:500;margin:1em 0 .5em}',
  '.dsh-ima-md h2{font-size:1.25em;font-weight:500;margin:1em 0 .5em}',
  '.dsh-ima-md h3{font-size:1.1em;font-weight:500;margin:.9em 0 .5em}',
  '.dsh-ima-md h4,.dsh-ima-md h5,.dsh-ima-md h6{font-size:1em;font-weight:500;margin:.8em 0 .4em}',
  '.dsh-ima-md p{margin:.55em 0}',
  '.dsh-ima-md code{font-size:.92em;background:var(--dsw-alias-bg-tertiary,rgba(0,0,0,.06));padding:1px 5px;border-radius:4px;font-family:ui-monospace,Menlo,Consolas,monospace}',
  '.dsh-ima-md pre{background:var(--dsw-alias-bg-tertiary,rgba(0,0,0,.06));border-radius:6px;padding:10px 12px;overflow:auto;margin:.6em 0}',
  '.dsh-ima-md pre code{background:none;padding:0}',
  '.dsh-ima-md strong{font-weight:500}',
  '.dsh-ima-md em{font-style:italic}',
  '.dsh-ima-md ul,.dsh-ima-md ol{padding-left:1.5em;margin:.5em 0}',
  '.dsh-ima-md li{margin:.22em 0}',
  '.dsh-ima-md a{color:var(--dsw-alias-interactive-bg-primary,#3b6cf6);text-decoration:none;word-break:break-all}',
  '.dsh-ima-md a:hover{text-decoration:underline}',
  '.dsh-ima-md hr{border:none;border-top:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.12));margin:1em 0}',
  '.dsh-ima-md blockquote{margin:.6em 0;padding:.1em 0 .1em .9em;border-left:2px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.16));color:var(--dsw-alias-label-secondary,#666)}',
  // 会议听记的发言人行（ima 听记类笔记展平后靠「发言人N 时间戳」还原）
  '.dsh-ima-spk{display:inline-block;margin:.9em 0 .15em;padding:1px 8px;border-radius:5px;background:var(--dsw-alias-bg-tertiary,rgba(0,0,0,.06));color:var(--dsw-alias-label-secondary,#666);font-size:.88em;line-height:1.6;font-variant-numeric:tabular-nums}',
  '.dsh-ima-md>:first-child{margin-top:0}',
  '.dsh-ima-md>:last-child{margin-bottom:0}',
  '.dsh-ima-rawhint{font-size:.85em;color:var(--dsw-alias-label-tertiary,#999);line-height:1.7;margin-top:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08))}',
  '.dsh-ima-dlg h3{margin:0 0 8px;font-size:1.12em;font-weight:500}',
  '.dsh-ima-f{margin-top:14px}',
  '.dsh-ima-f label{display:block;font-size:.92em;color:var(--dsw-alias-label-secondary,#666);margin-bottom:6px}',
  '.dsh-ima-f input{width:100%;box-sizing:border-box;font-size:.95em;padding:9px 11px;border-radius:6px;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.12));background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font-family:inherit}',
  '.dsh-ima-acts{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:20px}',
  '.dsh-ima-link{background:none;border:none;padding:0;font-size:.88em;color:var(--dsw-alias-label-tertiary,#999);cursor:pointer;font-family:inherit;text-decoration:underline;text-underline-offset:2px}',
  '.dsh-ima-link:hover{color:var(--dsw-alias-label-secondary,#666)}',
  '.dsh-ima-step{display:flex;gap:10px;margin-top:16px;align-items:flex-start}',
  '.dsh-ima-stepno{flex-shrink:0;width:20px;height:20px;border-radius:50%;background:var(--dsw-alias-bg-secondary,#f0f0f0);color:var(--dsw-alias-label-secondary,#666);font-size:.85em;display:inline-flex;align-items:center;justify-content:center;margin-top:2px}',
  '.dsh-ima-tip2{font-size:.9em;color:var(--dsw-alias-status-success,#1a9e6a);background:var(--dsw-alias-bg-secondary,#f5f5f5);border-radius:6px;padding:8px 12px;margin-top:14px;line-height:1.6}',
  '.dsh-ima-big{width:100%;box-sizing:border-box;padding:12px;font-size:1.05em;margin-top:18px;border-radius:8px}',
  '.dsh-ima-waitbar{display:flex;align-items:center;gap:8px;font-size:.92em;color:var(--dsw-alias-label-secondary,#666);margin-top:14px}',
  '.dsh-ima-spin{display:inline-block;width:13px;height:13px;border:2px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.15));border-top-color:var(--dsw-alias-interactive-bg-primary,#3b6cf6);border-radius:50%;animation:dsh-ima-rot .8s linear infinite}',
  '@keyframes dsh-ima-rot{to{transform:rotate(360deg)}}',
  '.dsh-ima-filled{font-size:.9em;color:var(--dsw-alias-label-secondary,#666);background:var(--dsw-alias-bg-secondary,#f5f5f5);border-radius:6px;padding:10px 12px;margin-top:14px;line-height:1.9;font-family:ui-monospace,Menlo,Consolas,monospace}',
  '.dsh-ima-note{font-size:.92em;color:var(--dsw-alias-label-secondary,#666);line-height:1.7}',
  '.dsh-ima-toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.82);color:#fff;font-size:.92em;padding:9px 18px;border-radius:8px;z-index:3000;pointer-events:none}',
  '.dsh-ima-input{flex:1;min-width:0;font-size:.95em;padding:6px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.12));background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font-family:inherit}',
  '.dsh-ima-hit{border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.1));border-radius:8px;padding:10px 12px;margin-bottom:10px}',
  '.dsh-ima-hit-h{display:flex;align-items:center;gap:8px;margin-bottom:6px;min-width:0}',
  '.dsh-ima-hit-b{font-size:.94em;line-height:1.7;color:var(--dsw-alias-label-secondary,#666);white-space:pre-wrap;word-break:break-word;max-height:8.5em;overflow:hidden}',
  '.dsh-ima-gist{font-size:.95em;line-height:1.7;color:var(--dsw-alias-label-secondary,#666);background:var(--dsw-alias-bg-secondary,#f5f5f5);border-radius:8px;padding:10px 12px;margin-bottom:8px}',
  '.dsh-ima-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}',
  '.dsh-ima-chip{font-size:.82em;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-tertiary,rgba(0,0,0,.06));color:var(--dsw-alias-label-secondary,#666)}',
  '.dsh-ima-tag-e{background:#fdecec;color:#a32020}',
  '.dsh-ima-media{margin-top:12px;max-width:100%;max-height:70vh;border-radius:8px;display:block}',
  '.dsh-ima-root{position:relative}',
  '.dsh-ima-overlay{position:absolute;inset:0;background:rgba(0,0,0,.30);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px;overflow:auto}',
  '.dsh-ima-lbl{display:block;font-size:.85em;color:var(--dsw-alias-label-secondary,#666);margin:14px 0 5px}',
  '.dsh-ima-inp{width:100%;box-sizing:border-box;font-size:.95em;padding:8px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.14));background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font-family:inherit}',
  '.dsh-ima-inp:focus{outline:2px solid var(--dsw-alias-interactive-bg-primary,#3b6cf6);outline-offset:-1px}',
  '.dsh-ima-frame{width:100%;height:100%;min-height:360px;flex:1;border:none;background:#fff;border-radius:4px}',
  '.dsh-ima-live{border:1px solid #e2e8f0;border-radius:8px;margin:6px 0;background:#fbfcfe;overflow:hidden}',
  '.dsh-ima-live-h{display:flex;align-items:center;gap:6px;padding:6px 10px;font-size:12px;color:#4a5568;background:#f1f5f9;border-bottom:1px solid #e2e8f0}',
  '.dsh-ima-live-dot{width:7px;height:7px;border-radius:50%;background:#38a169;box-shadow:0 0 0 3px rgba(56,161,105,.15)}',
  '.dsh-ima-live-dot-off{background:#a0aec0;box-shadow:none}',
  '.dsh-ima-live-err{color:#c53030;margin-left:auto}',
  '.dsh-ima-live-b{max-height:420px;overflow:auto;padding:10px 12px;font-size:13px;line-height:1.75}',
  '.dsh-ima-live-wait{color:#718096;font-size:12px}',
  '.dsh-ima-img{max-width:100%;height:auto;display:block;margin:6px 0;border-radius:4px}',
  '.dsh-ima-hitsnip{margin:0 0 8px;padding:8px 10px;background:#fff3bf;border-radius:6px;font-size:12px;line-height:1.7;color:#3d3320;max-height:110px;overflow:auto}',
  '.dsh-ima-hitsnip-h{display:block;font-weight:600;margin-bottom:2px;color:#8a6d1d}',
  '.dsh-ima-loading{display:flex;align-items:center;justify-content:center;color:#888;font-size:12px;border:1px dashed #ddd;border-radius:4px}',
  '.dsh-ima-pdf{position:relative;display:flex;flex-direction:column;height:100%;min-height:0}',
  '.dsh-ima-pdfbar{display:flex;align-items:center;gap:8px;padding:0 0 6px}',
  '.dsh-ima-pdfno{font-size:12px;color:#666}',
  '.dsh-ima-pdfno-float{position:absolute;right:12px;bottom:10px;z-index:3;padding:2px 8px;border-radius:10px;background:rgba(0,0,0,.5);color:#fff;font-size:11px;line-height:16px;pointer-events:none}',
  '.dsh-ima-pdfbox{position:relative;flex:1;min-height:0;overflow:auto;background:#f5f5f5;border:1px solid #e2e2e2;border-radius:4px;scroll-behavior:auto}',
  '.dsh-ima-pdfpage{position:relative;margin:8px auto}',
  '.dsh-ima-pdfcanvas{display:block;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.12)}',
  '.dsh-ima-pdfhl{position:absolute;background:rgba(255,214,10,.45);border-radius:2px;pointer-events:none}',
  '.dsh-ima-tl{position:absolute;inset:0;overflow:clip;opacity:1;line-height:1;text-align:initial;transform-origin:0 0;z-index:1;pointer-events:none;--min-font-size:1;--text-scale-factor:calc(var(--scale-factor) * var(--min-font-size));--min-font-size-inv:calc(1 / var(--min-font-size))}',
  '.dsh-ima-tl span{color:transparent;position:absolute;white-space:pre;transform-origin:0% 0%}',
  '.dsh-ima-tl > :not(.markedContent),.dsh-ima-tl .markedContent span:not(.markedContent){z-index:1;--font-height:0;font-size:calc(var(--text-scale-factor) * var(--font-height));--scale-x:1;--rotate:0deg;transform:rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))}',
  '.dsh-ima-tl .markedContent{display:contents}',
  '.dsh-ima-citetab-b.dsh-ima-nos,.dsh-ima-nos{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;padding:0}',
  '.dsh-ima-x{width:20px;height:20px;padding:0;border:none;border-radius:4px;background:transparent;color:#888;font-size:12px;line-height:20px;cursor:pointer;flex-shrink:0}',
  '.dsh-ima-x:hover{background:rgba(0,0,0,.08);color:#333}',
  // ── 右侧边栏「知识库原文」tab ──
  '.dsh-ima-citetab{display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;font-size:13px;line-height:1.75;color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dsw-alias-bg-primary,#fff)}',
  // 右侧栏 tab 的容器在 DSH 里可能是 auto 高度，height:100% 会塌成 0 → 预览一片白。
  '.dsh-ima-citetab-b>div{min-height:0}',
  '.dsh-ima-citetab-h{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08));flex-shrink:0}',
  '.dsh-ima-citetab-t{font-size:.95em;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%}',
  '.dsh-ima-citetab-b{flex:1;min-height:0;overflow:auto;padding:12px 14px}',
  '.dsh-ima-citetab .dsh-ima-hl{background:#fff3bf;box-shadow:0 0 0 5px #fff3bf;border-radius:3px}',
  // ── 问答页 ──
  '.dsh-ima-tabs{display:flex;gap:2px;padding:0 10px;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.1))}',
  '.dsh-ima-split{display:flex;flex:1;min-height:0;gap:0}',
  '.dsh-ima-qa-pane{width:50%;min-width:300px;display:flex;min-height:0;overflow:hidden;border-right:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.1))}',
  '.dsh-ima-kb-pane{flex:1;min-width:0;display:flex;min-height:0;overflow:hidden}',
  '.dsh-ima-qa{padding:10px 12px;display:flex;flex-direction:column;min-height:0;flex:1;width:100%}',
  '.dsh-ima-qa-top{display:flex;align-items:center;gap:6px;margin-bottom:8px}',
  '.dsh-ima-qa-lbl{font-size:11.5px;opacity:.65;flex:none}',
  '.dsh-ima-sel{height:26px;border-radius:6px;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.14));background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;font-size:12px;padding:0 6px;max-width:200px}',
  '.dsh-ima-sel:focus{outline:none;border-color:var(--dsw-alias-border-brand,#3b82f6)}',
  '.dsh-ima-qa-hint{font-size:11px;opacity:.45;margin-left:auto}',
  // 问答区（照 WeKnora 聊天页：消息流 + 底部 composer）
  '.dsh-ima-chat{flex:1;display:flex;flex-direction:column;min-height:0;min-width:0;padding:0}',
  '.dsh-ima-chat-inner{flex:1;display:flex;min-height:0;min-width:0}',
  '.dsh-ima-hist{width:158px;flex:none;border-right:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08));overflow:auto;padding:10px 8px}',
  '.dsh-ima-new{width:100%;height:28px;border-radius:7px;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;font-size:12px;cursor:pointer;margin-bottom:10px}',
  '.dsh-ima-new:hover{border-color:var(--dsw-alias-border-brand,#3b82f6)}',
  '.dsh-ima-hist-g{margin-bottom:10px}',
  '.dsh-ima-hist-h{font-size:11px;opacity:.45;padding:0 4px 4px}',
  '.dsh-ima-hist-i{font-size:12px;line-height:1.45;padding:5px 7px;border-radius:6px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.8}',
  '.dsh-ima-hist-i:hover{background:var(--dsw-alias-bg-layer-2,#f2f4f8);opacity:1}',
  '.dsh-ima-hist-on{background:var(--dsw-alias-bg-layer-3,#e8f0fe);opacity:1;font-weight:500}',
  '.dsh-ima-qa-empty{display:flex;align-items:center;justify-content:center;opacity:.5;font-size:13px}',
  '.dsh-ima-chat-main{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0;padding:10px 12px 12px}',
  '.dsh-ima-chat-top{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex:none}',
  '.dsh-ima-chat-hint{font-size:11px;opacity:.45;margin-left:auto}',
  '.dsh-ima-msgs{flex:1;min-height:0;overflow:auto;padding:0 20px 12px;display:flex;flex-direction:column;gap:16px}',
  '.dsh-ima-msgs>*{width:100%;max-width:960px;margin:0 auto}',
  '.dsh-ima-msg{display:flex;flex-direction:column;gap:4px;max-width:100%}',
  '.dsh-ima-msg-u{align-items:flex-end}',
  '.dsh-ima-msg-u .dsh-ima-bubble{width:max-content;max-width:min(76%,820px);margin-left:auto;background:#f3f3f3;border-radius:9px;padding:8px 12px;font-size:15px;line-height:1.6;white-space:pre-wrap;word-break:break-word}',
  '.dsh-ima-msg-a{align-items:stretch}',
  '.dsh-ima-ans{font-size:15px;line-height:1.75;max-width:100%}',
  '.dsh-ima-msg-bar{display:flex;align-items:center;gap:10px;margin-top:2px}',
  '.dsh-ima-typing{display:inline-flex;align-items:center;gap:6px;font-size:12px;opacity:.6}',
  '.dsh-ima-typing:before{content:"";width:10px;height:10px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;animation:dsh-ima-spin .8s linear infinite}',
  '@keyframes dsh-ima-spin{to{transform:rotate(360deg)}}',
  '.dsh-ima-welcome{margin:auto;max-width:460px;text-align:center;padding:24px 12px}',
  '.dsh-ima-welcome-t{font-size:20px;font-weight:600;margin-bottom:8px}',
  '.dsh-ima-welcome-s{font-size:14px;opacity:.6;line-height:1.7;margin-bottom:20px}',
  '.dsh-ima-sq{display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:left}',
  '.dsh-ima-sq-card{border:1px solid #dcdcdc;background:#fff;color:inherit;border-radius:9px;padding:10px 12px;font-size:14px;line-height:1.5;text-align:left;cursor:pointer;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
  '.dsh-ima-sq-card:hover{border-color:#0052d9;color:#0052d9}',
  '.dsh-ima-composer{flex:none;display:flex;gap:8px;align-items:flex-end;padding-top:8px;border-top:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08))}',
  '.dsh-ima-ta{flex:1;min-height:46px;max-height:180px;resize:none;border-radius:9px;border:1px solid #dcdcdc;background:#fff;color:inherit;font-size:15px;line-height:1.6;padding:10px 12px;font-family:inherit}',
  '.dsh-ima-ta:focus{outline:none;border-color:#0052d9}',
  '.dsh-ima-send{flex:none;height:34px;padding:0 16px;border-radius:9px;border:none;background:#0052d9;color:#fff;font-size:14px;cursor:pointer}',
  '.dsh-ima-send:disabled{opacity:.45;cursor:default}',
  '.dsh-ima-stop{background:#ef4444}',
  '.dsh-ima-tab{border:0;background:none;font:inherit;font-size:.9em;color:var(--dsw-alias-label-secondary,#666);padding:7px 12px;cursor:pointer;border-radius:6px 6px 0 0}',
  '.dsh-ima-tab:hover{background:var(--dsw-alias-bg-secondary,rgba(0,0,0,.04))}',
  '.dsh-ima-tab-on{color:var(--dsw-alias-label-primary,#1a1a1a);font-weight:600;box-shadow:inset 0 -2px 0 var(--dsw-alias-interactive-bg-primary,#3b6cf6)}',
  '.dsh-ima-qa{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;padding:10px;gap:8px}',
  '.dsh-ima-qa-body{flex:1;min-height:0;overflow:auto;padding-right:2px}',
  '.dsh-ima-cite{display:inline-block;min-width:15px;height:15px;padding:0 3px;margin:0 1px;border:0;border-radius:8px;background:#e6effb;color:#2b6cb0;font-size:10px;font-weight:700;line-height:15px;cursor:pointer;position:relative;top:-.35em;font-family:inherit;text-align:center}',
  '.dsh-ima-cite:hover{background:#2b6cb0;color:#fff}',
  '.dsh-ima-citebox{position:absolute;inset:0;background:rgba(15,23,42,.32);display:flex;align-items:flex-end;justify-content:center;z-index:60}',
  '.dsh-ima-citecard{background:var(--dsw-alias-bg-primary,#fff);border-radius:10px 10px 0 0;max-height:86%;height:86%;width:100%;display:flex;flex-direction:column;box-shadow:0 -6px 24px rgba(0,0,0,.2);overflow:hidden}',
  '.dsh-ima-cite-h{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.1));min-width:0}',
  '.dsh-ima-cite-doc{font-size:.92em;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-ima-cite-n{font-size:11px;color:var(--dsw-alias-text-secondary,#6b7280);background:var(--dsw-alias-bg-secondary,#f3f4f6);border-radius:8px;padding:1px 7px;white-space:nowrap;flex:none}',
  '.dsh-ima-cite-b{overflow:auto;padding:12px 14px;flex:1}',
  '.dsh-ima-chunk{font-size:13px;line-height:1.8;color:var(--dsw-alias-text-primary,#1f2328);margin:0 0 12px;white-space:pre-wrap;word-break:break-word}',
  '.dsh-ima-hl{background:#fff3bf;box-shadow:0 0 0 5px #fff3bf;border-radius:3px}',
  '.dsh-ima-actbtn-on{background:var(--dsw-alias-bg-secondary,#eef2f7);color:var(--dsw-alias-text-primary,#1f2328);border-color:var(--dsw-alias-border-secondary,rgba(0,0,0,.14))}',
  '.dsh-ima-office{flex:1;overflow:hidden;background:var(--dsw-alias-bg-secondary,#f3f4f6)}',
  '.dsh-ima-office-frame{width:100%;height:100%;border:0;background:#fff}',
  '.dsh-ima-ans table{border-collapse:collapse;margin:10px 0;font-size:.88em;max-width:100%}',
  '.dsh-ima-ans th,.dsh-ima-ans td{border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.12));padding:5px 8px;text-align:left;vertical-align:top}',
  '.dsh-ima-ans th{background:var(--dsw-alias-bg-secondary,#f7f9fc);font-weight:600}',
  '.dsh-ima-ans h1,.dsh-ima-ans h2,.dsh-ima-ans h3,.dsh-ima-ans h4{font-size:1em;margin:14px 0 6px}',
  '.dsh-ima-reader-frame{width:100%;height:100%;min-height:420px;border:0;background:#fff;border-radius:4px}',
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
}

// 会话里 agent 回答的角标是 a[href^="dsh-weknora:"]，
// 这里把它做成 WeKnora 网页那种上标小方块（浅蓝底、圆角、无下划线）。
var CITE_CSS = [
  'a[href^="dsh-weknora:"]{display:inline-block;min-width:15px;height:15px;padding:0 3px;margin:0 2px;border-radius:8px;background:#e7f0fd;color:#2b6cb0!important;font-size:10px;font-weight:700;line-height:15px;text-align:center;text-decoration:none!important;vertical-align:super;position:relative;top:-.15em;cursor:pointer;font-family:inherit;font-style:normal}',
  'a[href^="dsh-weknora:"]:hover{background:#d3e5fb;color:#1e4e8c!important}',
  'a[href^="dsh-weknora:"]:visited{color:#2b6cb0!important}',
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
