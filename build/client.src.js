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
  '.dsh-ima-root{display:flex;flex-direction:column;height:100%;font-size:var(--dsw-font-base-font-size,14px);line-height:1.65;color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dsw-alias-bg-primary,#fff);font-family:var(--dsw-font-family,inherit)}',
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
  '.dsh-ima-citetab{display:flex;flex-direction:column;height:100%;min-height:360px;min-width:0;font-size:13px;line-height:1.75;color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dsw-alias-bg-primary,#fff)}',
  // 右侧栏 tab 的容器在 DSH 里可能是 auto 高度，height:100% 会塌成 0 → 预览一片白。
  '.dsh-ima-citetab-b>div,.dsh-ima-citetab .dsh-ima-pdf{min-height:320px}',,
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

var TYPE_STYLE = {
  pdf:  { c1: '#ff7b72', c2: '#e5484d', label: 'PDF', small: 1 },
  doc:  { c1: '#6a99e8', c2: '#2b579a', label: 'W' },
  docx: { c1: '#6a99e8', c2: '#2b579a', label: 'W' },
  docm: { c1: '#6a99e8', c2: '#2b579a', label: 'W' },
  rtf:  { c1: '#6a99e8', c2: '#2b579a', label: 'W' },
  odt:  { c1: '#6a99e8', c2: '#2b579a', label: 'W' },
  xls:  { c1: '#43b97a', c2: '#217346', label: 'X' },
  xlsx: { c1: '#43b97a', c2: '#217346', label: 'X' },
  xlsm: { c1: '#43b97a', c2: '#217346', label: 'X' },
  ods:  { c1: '#43b97a', c2: '#217346', label: 'X' },
  csv:  { c1: '#43b97a', c2: '#217346', label: 'C' },
  ppt:  { c1: '#f58254', c2: '#d24726', label: 'P' },
  pptx: { c1: '#f58254', c2: '#d24726', label: 'P' },
  pptm: { c1: '#f58254', c2: '#d24726', label: 'P' },
  odp:  { c1: '#f58254', c2: '#d24726', label: 'P' },
  md:   { c1: '#9aa8b8', c2: '#5b6b7c', label: 'M' },
  markdown: { c1: '#9aa8b8', c2: '#5b6b7c', label: 'M' },
  txt:  { c1: '#b9bfc9', c2: '#8a8f98', label: 'T' },
  log:  { c1: '#b9bfc9', c2: '#8a8f98', label: 'T' },
  tsv:  { c1: '#b9bfc9', c2: '#8a8f98', label: 'T' },
  json: { c1: '#c9b06a', c2: '#a8862b', label: '{' },
  yaml: { c1: '#c9b06a', c2: '#a8862b', label: 'Y' },
  yml:  { c1: '#c9b06a', c2: '#a8862b', label: 'Y' },
  xml:  { c1: '#c9b06a', c2: '#a8862b', label: '<' },
  html: { c1: '#4aa8f0', c2: '#1e7fe0', globe: 1 },
  htm:  { c1: '#4aa8f0', c2: '#1e7fe0', globe: 1 },
  png:  { c1: '#39cdbd', c2: '#0f9b8e', image: 1 },
  jpg:  { c1: '#39cdbd', c2: '#0f9b8e', image: 1 },
  jpeg: { c1: '#39cdbd', c2: '#0f9b8e', image: 1 },
  gif:  { c1: '#39cdbd', c2: '#0f9b8e', image: 1 },
  webp: { c1: '#39cdbd', c2: '#0f9b8e', image: 1 },
  bmp:  { c1: '#39cdbd', c2: '#0f9b8e', image: 1 },
  svg:  { c1: '#39cdbd', c2: '#0f9b8e', image: 1 },
  ico:  { c1: '#39cdbd', c2: '#0f9b8e', image: 1 },
  xmind: { c1: '#b18cfa', c2: '#7c5cff', mind: 1 },
  epub: { c1: '#9aa8b8', c2: '#5b6b7c', label: 'E' },
  mp3:  { c1: '#f27ab5', c2: '#e0518f', mic: 1 },
  wav:  { c1: '#f27ab5', c2: '#e0518f', mic: 1 },
  m4a:  { c1: '#f27ab5', c2: '#e0518f', mic: 1 },
  aac:  { c1: '#f27ab5', c2: '#e0518f', mic: 1 },
  ogg:  { c1: '#f27ab5', c2: '#e0518f', mic: 1 },
  flac: { c1: '#f27ab5', c2: '#e0518f', mic: 1 },
  mp4:  { c1: '#ff9c66', c2: '#ff6b35', play: 1 },
  webm: { c1: '#ff9c66', c2: '#ff6b35', play: 1 },
  mov:  { c1: '#ff9c66', c2: '#ff6b35', play: 1 },
  m4v:  { c1: '#ff9c66', c2: '#ff6b35', play: 1 },
}

var _icoSeq = 0
function gradId(prefix) { return prefix + (++_icoSeq) }

function icoSvg(size, kids) {
  return h('svg', { width: size, height: size, viewBox: '0 0 32 32', style: { flexShrink: 0, display: 'block' } }, kids)
}

var ICON_FONT = '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'

/** 圆角方块里的白色符号（每种类型一个手绘小图形） */
function glyphFor(st, key) {
  if (st.label) {
    return h('text', { key: key, x: 16, y: 16.5, textAnchor: 'middle', dominantBaseline: 'central',
      fill: '#fff', fontWeight: 600, fontSize: st.small ? 9 : 14,
      fontFamily: ICON_FONT, letterSpacing: 0.5 }, st.label)
  }
  if (st.globe) {
    return h('g', { key: key },
      h('circle', { cx: 16, cy: 16, r: 8.5, fill: 'none', stroke: '#fff', strokeWidth: 1.8 }),
      h('ellipse', { cx: 16, cy: 16, rx: 3.8, ry: 8.5, fill: 'none', stroke: '#fff', strokeWidth: 1.3 }),
      h('path', { d: 'M8 13.2h16M8 18.8h16', stroke: '#fff', strokeWidth: 1.3, fill: 'none', strokeLinecap: 'round' }))
  }
  if (st.wechat) {
    return h('path', { key: key, d: 'M16 7.5c-5 0-9 3.1-9 7 0 2.3 1.3 4.3 3.3 5.6l-.7 3.4 3.8-1.9c.8.2 1.7.3 2.6.3 5 0 9-3.1 9-7.1s-4-7.3-9-7.3z', fill: '#fff' })
  }
  if (st.image) {
    return h('g', { key: key },
      h('circle', { cx: 11.5, cy: 11.5, r: 2, fill: '#fff' }),
      h('path', { d: 'M7 23.5l6-7 4 4.5 3.5-3.5 4.5 6', stroke: '#fff', strokeWidth: 2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }))
  }
  if (st.note) {
    return h('path', { key: key, d: 'M10 22l1-3.6 8.2-8.2a1.7 1.7 0 012.4 0l.2.2a1.7 1.7 0 010 2.4L13.6 21z', fill: '#fff' })
  }
  if (st.chat) {
    return h('g', { key: key },
      h('path', { d: 'M8 10.5A3.5 3.5 0 0111.5 7h9A3.5 3.5 0 0124 10.5v5a3.5 3.5 0 01-3.5 3.5H14l-4 3.5v-3.5h-.5A3.5 3.5 0 016 15.5z', fill: '#fff' }),
      h('circle', { cx: 12.5, cy: 13, r: 1.1, fill: st.c2, key: 'd1' }),
      h('circle', { cx: 16, cy: 13, r: 1.1, fill: st.c2, key: 'd2' }),
      h('circle', { cx: 19.5, cy: 13, r: 1.1, fill: st.c2, key: 'd3' }))
  }
  if (st.mind) {
    return h('g', { key: key },
      h('circle', { cx: 10.5, cy: 16, r: 2.6, fill: '#fff' }),
      h('path', { d: 'M13 14.5L20 10M13.5 17.5l7 4.5M13.5 16h7', stroke: '#fff', strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round' }),
      h('circle', { cx: 22.5, cy: 9.5, r: 2, fill: '#fff', key: 'm1' }),
      h('circle', { cx: 22.5, cy: 22.5, r: 2, fill: '#fff', key: 'm2' }),
      h('circle', { cx: 23.5, cy: 16, r: 2, fill: '#fff', key: 'm3' }))
  }
  if (st.mic) {
    return h('g', { key: key },
      h('rect', { x: 12.8, y: 7.5, width: 6.4, height: 11, rx: 3.2, fill: '#fff' }),
      h('path', { d: 'M9.5 15.5a6.5 6.5 0 0013 0M16 22v3M12.5 25.2h7', stroke: '#fff', strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round' }))
  }
  if (st.play) {
    return h('path', { key: key, d: 'M12.5 9.8l10 6.2-10 6.2z', fill: '#fff' })
  }
  return h('path', { key: key, d: 'M10 6.5h8L23 11v14a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 019 25V8a1.5 1.5 0 011-1.5z', fill: '#fff' })
}

/** 文件类型图标（macOS Big Sur 风格的渐变圆角方块） */
function FileTypeIcon(props) {
  var size = (props && props.size) || 22
  var st = TYPE_STYLE[String((props && props.type) || '').toLowerCase()]
  if (!st) {
    var id0 = gradId('digu')
    return icoSvg(size, [
      h('defs', { key: 'd' }, h('linearGradient', { id: id0, x1: 0, y1: 0, x2: 0, y2: 1 },
        h('stop', { offset: 0, stopColor: '#c3c9d1' }), h('stop', { offset: 1, stopColor: '#9aa2ad' }))),
      h('rect', { key: 'r', x: 2, y: 2, width: 28, height: 28, rx: 7.5, fill: 'url(#' + id0 + ')' }),
      h('path', { key: 'g', d: 'M11 9h7l4 4v10.5a1 1 0 01-1 1H11a1 1 0 01-1-1V10a1 1 0 011-1z', fill: '#fff', opacity: 0.92 }),
    ])
  }
  var id = gradId('dig')
  return icoSvg(size, [
    h('defs', { key: 'd' }, h('linearGradient', { id: id, x1: 0, y1: 0, x2: 0, y2: 1 },
      h('stop', { offset: 0, stopColor: st.c1 }), h('stop', { offset: 1, stopColor: st.c2 }))),
    h('rect', { key: 'r', x: 2, y: 2, width: 28, height: 28, rx: 7.5, fill: 'url(#' + id + ')' }),
    h('rect', { key: 'h', x: 2, y: 2, width: 28, height: 15, rx: 7.5, fill: '#fff', opacity: 0.16 }),
    glyphFor(st, 'g'),
  ])
}

/** 文件夹图标（访达同款蓝色立体文件夹） */
function MacFolderIcon(props) {
  var s = (props && props.size) || 20
  var id = gradId('dif')
  return h('svg', { width: s, height: s, viewBox: '0 0 48 48', style: { flexShrink: 0, display: 'block' } },
    h('defs', null, h('linearGradient', { id: id, x1: 0, y1: 0, x2: 0, y2: 1 },
      h('stop', { offset: 0, stopColor: '#7db9f2' }), h('stop', { offset: 1, stopColor: '#3f8ef7' }))),
    h('path', { d: 'M5 12a4 4 0 014-4h9.4c1 0 2 .4 2.7 1.1l3.2 3.4H39a4 4 0 014 4v3.5H5z', fill: '#2e7cd6' }),
    h('rect', { x: 5, y: 15, width: 38, height: 25, rx: 4.5, fill: 'url(#' + id + ')' }),
    h('rect', { x: 5, y: 15, width: 38, height: 12, rx: 4.5, fill: '#fff', opacity: 0.18 }),
  )
}

/**
 * 知识库图标：统一用 macOS 访达同款蓝色文件夹。
 * 之前给每个库按名称哈希配色 + 首字，颜色太杂反而干扰识别；
 * 分组标题已经说明「个人/共享」，这里统一单色更干净。
 */
function KbIcon(props) {
  return h(MacFolderIcon, { size: (props && props.size) || 18 })
}

function ChevGlyph() {
  return h('svg', { width: 10, height: 10, viewBox: '0 0 10 10', fill: 'none' },
    h('path', { d: 'M2.5 3.8L5 6.3l2.5-2.5', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }))
}



function FolderGlyph(props) {
  var s = (props && props.size) || 18
  return h('svg', { width: s, height: s, viewBox: '0 0 20 20', fill: 'none' },
    h('path', {
      d: 'M2.5 5A1.8 1.8 0 014.3 3.2h3.1c.5 0 .9.2 1.2.6l1 1.3c.3.4.7.6 1.2.6h4.9A1.8 1.8 0 0117.5 7.5v7.7a1.8 1.8 0 01-1.8 1.8H4.3a1.8 1.8 0 01-1.8-1.8V5z',
      stroke: 'currentColor', strokeWidth: 1.45,
    }),
  )
}
function RefreshIcon(props) {
  var s = (props && props.size) || 15
  return h('svg', { width: s, height: s, viewBox: '0 0 16 16', fill: 'none' },
    h('path', {
      d: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3.2h-3.2',
      stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
    }),
  )
}
function CopyGlyph() {
  return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' },
    h('rect', { x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.1 }),
    h('path', { d: 'M10.5 3.5H4a1.5 1.5 0 00-1.5 1.5v6.5', stroke: 'currentColor', strokeWidth: 1.1 }),
  )
}
function QuoteGlyph() {
  return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' },
    h('path', {
      d: 'M6 9.5L10 5.5M6.8 4.2l1.5-1.5a2.6 2.6 0 013.7 3.7l-1.5 1.5M9.2 11.8l-1.5 1.5a2.6 2.6 0 01-3.7-3.7l1.5-1.5',
      stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round',
    }),
  )
}
function ExternalGlyph() {
  return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' },
    h('path', {
      d: 'M9.5 2.5h4v4M13.5 2.5L7.5 8.5M12 9.5v3a1.5 1.5 0 01-1.5 1.5h-6A1.5 1.5 0 013 12.5v-6A1.5 1.5 0 014.5 5h3',
      stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round', strokeLinejoin: 'round',
    }),
  )
}

// ── 工具 ─────────────────────────────────────────────────
function api(path, opts) {
  return fetch(API + path, opts).then(function (r) { return r.json() })
}
function fmtTime(d) {
  if (!d) return ''
  var p = function (n) { return String(n).padStart(2, '0') }
  return p(d.getHours()) + ':' + p(d.getMinutes())
}
/** 文件最后更新时间：有就显示（今年省略年份），没有就留空 —— 绝不造假数据 */
function fmtDate(v) {
  if (!v) return ''
  var n = Number(v)
  var d = isNaN(n) || v === '' ? new Date(v) : new Date(n > 1e12 ? n : n * 1000)
  if (isNaN(d.getTime())) return ''
  var p = function (x) { return String(x).padStart(2, '0') }
  var now = new Date()
  return d.getFullYear() === now.getFullYear()
    ? p(d.getMonth() + 1) + '-' + p(d.getDate())
    : d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
// 下载原件：不能直接 <a target=_blank>，Electron 里会被当成 window.open 拦掉。
// 先取回字节，优先用系统保存对话框，退回到 Blob + a[download]。
async function downloadOriginal(id, name) {
  var fileName = String(name || 'download')
  try {
    var res = await fetch(API + '/download?id=' + encodeURIComponent(id))
    if (!res.ok) { toast('下载失败：HTTP ' + res.status); return }
    var blob = await res.blob()
    if (window.showSaveFilePicker) {
      try {
        var handle = await window.showSaveFilePicker({ suggestedName: fileName })
        var w = await handle.createWritable()
        await w.write(blob)
        await w.close()
        return
      } catch (e) {
        if (e && e.name === 'AbortError') return
      }
    }
    var u = URL.createObjectURL(blob)
    var a = document.createElement('a')
    a.href = u
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(function () { URL.revokeObjectURL(u) }, 4000)
  } catch (e) {
    toast('下载失败：' + ((e && e.message) || e))
  }
}

function toast(msg) {
  try {
    var el = document.createElement('div')
    el.className = 'dsh-ima-toast'
    el.textContent = msg
    document.body.appendChild(el)
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el) }, 1800)
  } catch (e) {}
}
/**
 * 复制到剪贴板。
 * @param {boolean} silent 静默模式：不弹「已复制」提示。
 *        调用方自己会弹更具体的提示时用它，避免两个 toast 叠在一起糊成一团。
 */
function copyText(text, silent) {
  var onOk = function () { if (!silent) toast('已复制') }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onOk, function () { fallbackCopy(text, silent) })
      return
    }
  } catch (e) {}
  fallbackCopy(text, silent)
}
function fallbackCopy(text, silent) {
  try {
    var ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    if (!silent) toast('已复制')
  } catch (e) { toast('复制失败，请手动选中') }
}
function sendToConversation(text) {
  try {
    var el = document.querySelector('textarea[placeholder]') ||
             document.querySelector('[contenteditable="true"]')
    if (el) {
      if (el.tagName === 'TEXTAREA') {
        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        setter.call(el, text)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.focus()
        toast('已填入对话框')
        return true
      }
      if (el.isContentEditable) {
        el.focus()
        document.execCommand('insertText', false, text)
        toast('已填入对话框')
        return true
      }
    }
  } catch (e) {}
  // 兜底：放进剪贴板。这里用静默复制，只弹下面这一条提示
  copyText(text, true)
  toast('已复制，粘贴到对话框即可')
  return false
}

/** 极简 Markdown 渲染（笔记/纯文本兜底用） */
/**
 * WeKnora 正文里的图片是 provider 资源地址 resource://<key>，
 * 浏览器拿不到，换成插件的代理路由（带 kbId，服务端才知道去哪个库取）。
 */
function fixResourceUrls(text, kbId) {
  if (!text || String(text).indexOf('resource://') < 0) return text
  return String(text).replace(/resource:\/\/[A-Za-z0-9_\-]+/g, function (m) {
    return API + '/resource?kbId=' + encodeURIComponent(kbId || '') + '&filePath=' + encodeURIComponent(m)
  })
}

function renderMarkdown(src, opts) {
  opts = opts || {}
  var lines = String(src).split('\n')
  var out = []
  var listBuf = []
  var key = 0
  // 角标编号：同一个 chunk 重复出现用同一个号
  var citeIndex = {}
  var citeOrder = 0

  var URL_RE = /https?:\/\/[A-Za-z0-9\-._~:\/?#\[\]@!$&'()*+,;=%]+/g
  // WeKnora 原生的内联出处标记：<kb doc="文件名" chunk_id="..." kb_id="..." />
  var KB_ALL = /<kb\s+([^>]*?)\/?>/gi
  var KB_ATTR = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"/g
  var BR_RE = /<br\s*\/?>/gi
  // 段落开头的序号/小标题标记 —— 保留原样并加粗。
  // ⚠️ 故意不把「1.」「（一）」转成 <ol>：相邻的「（一）…」和「1.…」会被浏览器
  //    当成同一个列表重新编号，原来的 1. 会被显示成 2.，那是篡改语义。
  var LEAD_MARK = /^([（(][0-9一二三四五六七八九十]{1,3}[）)]|[一二三四五六七八九十]{1,3}、|[0-9]{1,3}[.、](?=[\u3400-\u4dbf\u4e00-\u9fff])|【[^】\n]{1,40}】)/

  function parseAttrs(s) {
    var o = {}
    var m
    KB_ATTR.lastIndex = 0
    while ((m = KB_ATTR.exec(s))) o[m[1]] = m[2]
    return o
  }

  function inline(t) {
    // 先把 ![图](地址) / **加粗** / `代码` / [文字](链接) / 裸链接 抠出来
    var re = /(!\[[^\]\n]*\]\([^)\s]+\)|\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]*\]\([^)\s]+\))/g
    var parts = []
    var last = 0
    var m

    function plainText(chunk) {
      // <br> 先按硬换行切
      var segs = []
      var cut0 = 0
      BR_RE.lastIndex = 0
      var bm
      while ((bm = BR_RE.exec(chunk))) {
        segs.push(chunk.slice(cut0, bm.index))
        segs.push(null) // null = 换行
        cut0 = bm.index + bm[0].length
      }
      segs.push(chunk.slice(cut0))

      segs.forEach(function (seg) {
        if (seg === null) { parts.push(h('br', { key: 'br' + (key++) })); return }
        if (!seg) return
        // 裸链接：笔记里经常直接贴 URL（实测有些还和前后汉字粘在一起，只能尽力切）
        URL_RE.lastIndex = 0
        var cut = 0
        var mm
        while ((mm = URL_RE.exec(seg))) {
          if (mm.index > cut) parts.push(seg.slice(cut, mm.index))
          parts.push(h('a', { key: 'a' + (key++), href: mm[0], target: '_blank', rel: 'noreferrer' }, mm[0]))
          cut = mm.index + mm[0].length
        }
        if (cut < seg.length) parts.push(seg.slice(cut))
      })
    }

    function plain(chunk) {
      // 出处标记切成可点角标，其余照常
      var cut = 0
      var km
      KB_ALL.lastIndex = 0
      while ((km = KB_ALL.exec(chunk))) {
        if (km.index > cut) plainText(chunk.slice(cut, km.index))
        var kv = parseAttrs(km[1])
        var cid = kv.chunk_id || kv.doc || ('x' + km.index)
        var n = citeIndex[cid]
        if (!n) { n = ++citeOrder; citeIndex[cid] = n }
        var after = km.index + km[0].length
        // 角标紧跟在句末时，把句读挪到角标前面，免得句号被挤到下一行
        var punct = /^[。，、；：！？)]/.exec(chunk.slice(after))
        if (punct) { parts.push(punct[0]); after += punct[0].length }
        ;(function (kv2, n2) {
          parts.push(h('button', {
            key: 'cite' + (key++),
            className: 'dsh-ima-cite',
            title: (kv2.doc ? '《' + kv2.doc + '》' : '出处') + ' · 点开看原文',
            onClick: function (e) {
              e.stopPropagation()
              if (opts.onCite) opts.onCite(kv2)
            },
          }, String(n2)))
        })(kv, n)
        cut = after
      }
      if (cut < chunk.length) plainText(chunk.slice(cut))
    }

    while ((m = re.exec(t))) {
      if (m.index > last) plain(t.slice(last, m.index))
      var tok = m[0]
      if (tok.slice(0, 2) === '![') {
        var im = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(tok)
        parts.push(h('img', {
          key: 'img' + (key++),
          className: 'dsh-ima-img',
          src: im ? im[2] : '',
          alt: (im && im[1]) || '图片',
          loading: 'lazy',
        }))
      } else if (tok.slice(0, 2) === '**') parts.push(h('strong', { key: 'b' + (key++) }, tok.slice(2, -2)))
      else if (tok.charAt(0) === '`') parts.push(h('code', { key: 'c' + (key++) }, tok.slice(1, -1)))
      else {
        var mm2 = /^\[([^\]]*)\]\(([^)\s]+)\)$/.exec(tok)
        parts.push(h('a', { key: 'k' + (key++), href: mm2[2], target: '_blank', rel: 'noreferrer' }, mm2[1] || mm2[2]))
      }
      last = m.index + tok.length
    }
    if (last < t.length) plain(t.slice(last))
    if (!parts.length) return t
    return parts
  }

  function flushList() {
    if (!listBuf.length) return
    out.push(h('ul', { key: 'u' + (key++) },
      listBuf.map(function (t, i) { return h('li', { key: i }, inline(t)) })))
    listBuf = []
  }

  /** 段首的序号标记加粗，其余照旧 */
  function para(line) {
    var m = LEAD_MARK.exec(line)
    if (!m) return inline(line)
    var rest = line.slice(m[0].length)
    return [h('strong', { key: 'm' + (key++) }, m[0])].concat(rest ? inline(rest) : [])
  }

  function splitRow(line) {
    var t = line.trim().replace(/^\|/, '').replace(/\|$/, '')
    return t.split('|').map(function (s) { return s.trim() })
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    var m
    // GFM 表格：表头 + 分隔行 + 若干数据行
    if (/^\s*\|.*\|\s*$/.test(line)
      && i + 1 < lines.length
      && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])
      && /-/.test(lines[i + 1])) {
      flushList()
      var head = splitRow(line)
      var rows = []
      var j = i + 2
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) { rows.push(splitRow(lines[j])); j++ }
      out.push(h('table', { key: 't' + (key++) },
        h('thead', { key: 'th' }, h('tr', { key: 'tr' },
          head.map(function (c, ci) { return h('th', { key: ci }, inline(c)) }))),
        h('tbody', { key: 'tb' },
          rows.map(function (r, ri) {
            return h('tr', { key: ri },
              r.map(function (c, ci) { return h('td', { key: ci }, inline(c)) }))
          }))))
      i = j - 1
      continue
    }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flushList()
      out.push(h('h' + m[1].length, { key: 'h' + (key++) }, inline(m[2])))
    } else if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushList()
      out.push(h('hr', { key: 'r' + (key++) }))
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flushList()
      out.push(h('blockquote', { key: 'q' + (key++) }, inline(m[1])))
    } else if (/^(发言人|说话人|说话者|Speaker)\s*\d{1,2}\s+\d{1,2}:\d{2}$/i.test(line.trim())) {
      flushList()
      out.push(h('div', { key: 's' + (key++) }, h('span', { className: 'dsh-ima-spk' }, line.trim())))
    } else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
      // 真 Markdown 的项目符号（.md 类文件才有，展平后的笔记不会有）
      listBuf.push(m[1])
    } else if (line.trim() === '') {
      flushList()
    } else {
      flushList()
      out.push(h('p', { key: 'p' + (key++) }, para(line)))
    }
  }
  flushList()
  return h('div', { className: 'dsh-ima-md' }, out)
}

// ── 预览挂载器（真正用 open-file-viewer 渲染） ────────────
// 引擎认不出的格式（比如 PDF —— 我们没打 pdfPlugin，它有 Node 原生依赖）
// 自动退回浏览器原生 iframe，不让用户看到空白
function ViewerBox(props) {
  var ref = React.useRef(null)
  var instRef = React.useRef(null)
  var fs = React.useState(false)
  var fallback = fs[0], setFallback = fs[1]

  React.useEffect(function () { setFallback(false) }, [props.source])

  React.useEffect(function () {
    var V = window.__DSH_WK_VIEWER__
    if (fallback || !ref.current || !V) return
    var destroyed = false

    try {
      if (instRef.current) { try { instRef.current.destroy() } catch (e) {} instRef.current = null }
      instRef.current = V.createViewer({
        container: ref.current,
        file: props.source,
        fileName: props.fileName,
        height: '100%',
        width: '100%',
        fit: 'contain',
        toolbar: true,
        theme: 'auto',
        plugins: V.makePlugins(),
        onUnsupported: function () { if (!destroyed) setFallback(true) },
        onError: function () { if (!destroyed) setFallback(true) },
      })
    } catch (e) {
      setFallback(true)
    }

    return function () {
      destroyed = true
      if (instRef.current) { try { instRef.current.destroy() } catch (e) {} instRef.current = null }
    }
  }, [props.source, props.fileName, fallback])

  if (fallback) {
    // 原生兜底：PDF / 图片 / 音视频浏览器都能直接渲染
    var ext = String(props.fileName || '').split('.').pop().toLowerCase()
    if (ext === 'pdf') {
      return h('iframe', {
        className: 'dsh-ima-frame',
        src: props.source,
        title: props.fileName,
        style: { flex: 1, minHeight: '60vh', width: '100%', border: 'none' },
      })
    }
    if (/^(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/.test(ext)) {
      return h('img', { className: 'dsh-ima-media', src: props.source, alt: props.fileName })
    }
    if (/^(mp4|webm|mov|m4v)$/.test(ext)) {
      return h('video', { className: 'dsh-ima-media', src: props.source, controls: true })
    }
    if (/^(mp3|wav|m4a|ogg|aac|flac)$/.test(ext)) {
      return h('audio', { className: 'dsh-ima-media', src: props.source, controls: true })
    }
    return h('div', { className: 'dsh-ima-note', style: { marginTop: '12px' } },
      '这个格式没法内联预览，点右上角「下载原件」拿原文件。')
  }

  return h('div', { ref: ref, className: 'dsh-ima-vbox', style: { flex: 1, minHeight: '60vh' } })
}

// ── 侧边栏入口（⚠️ 只返回图标） ──────────────────────────
function PanelGlyph(props) {
  return h(FolderGlyph, { size: (props && props.size) || 18 })
}

// ── 错误边界 ─────────────────────────────────────────────
class PanelBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { err: null }
  }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err) {
    console.error('[dsh-weknora] 界面渲染出错：', err)
  }
  render() {
    if (this.state.err) {
      return h('div', { className: 'dsh-ima-root' },
        h('div', { className: 'dsh-ima-head' }, h('span', { className: 'dsh-ima-title' }, '知识库 WeKnora')),
        h('div', { className: 'dsh-ima-main' },
          h('div', { className: 'dsh-ima-err' },
            '界面出了点问题：' + String((this.state.err && this.state.err.message) || this.state.err)),
          h('div', { className: 'dsh-ima-note', style: { marginTop: '10px' } },
            '可以点下面的按钮重试；如果反复出现，重启 DSH 再看看。'),
          h('button', {
            className: 'dsh-ima-btn dsh-ima-btn-p', style: { marginTop: '14px' },
            onClick: function () { this.setState({ err: null }) }.bind(this),
          }, '重试'),
        ),
      )
    }
    return this.props.children
  }
}

// ── 解析状态徽标 ─────────────────────────────────────────
var STATUS_TEXT = {
  completed: '已解析', processing: '解析中', pending: '排队中',
  failed: '解析失败', cancelled: '已取消',
}
function StatusTag(props) {
  var s = props.status
  if (!s) return null
  var cls = 'dsh-ima-tag '
  if (s === 'completed') cls += 'dsh-ima-tag-s'
  else if (s === 'failed') cls += 'dsh-ima-tag-e'
  else cls += 'dsh-ima-tag-m'
  return h('span', { className: cls, title: props.title || s }, STATUS_TEXT[s] || s)
}

// ── 类型判定 ─────────────────────────────────────────────
/** 走「分块拼全文 + Markdown 渲染」的文本类 */
var TEXT_TYPES = {
  md: 1, markdown: 1, txt: 1, csv: 1, json: 1, html: 1, htm: 1,
  xml: 1, yaml: 1, yml: 1, log: 1, tsv: 1, ini: 1, conf: 1,
}
/** 走预览引擎（office / pdf / 图片 / 音视频）的类型 */
var OFFICE_TYPES = {
  doc: 1, docx: 1, docm: 1, odt: 1, rtf: 1,
  xls: 1, xlsx: 1, xlsm: 1, ods: 1,
  ppt: 1, pptx: 1, pptm: 1, odp: 1,
  pdf: 1, epub: 1, xmind: 1,
}
var IMAGE_TYPES = { png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1, bmp: 1, svg: 1, avif: 1, ico: 1 }
var MEDIA_TYPES = { mp3: 1, wav: 1, m4a: 1, ogg: 1, aac: 1, flac: 1, mp4: 1, webm: 1, mov: 1, m4v: 1 }

function extOf(f) {
  if (!f) return ''
  var n = String(f.file_name || f.title || '')
  var m = /\\.([A-Za-z0-9]{1,6})$/.exec(n)
  if (m) return m[1].toLowerCase()
  return String(f.file_type || '').toLowerCase()
}
function previewKindOf(f) {
  var ext = extOf(f)
  // WeKnora 入库的是「解析后的文本分块」，原件排版并不保证能完整还原，
  // 所以除图片/音视频外一律走「分块拼全文」的文本视图 —— 不强求显示原 Word/PDF。
  if (IMAGE_TYPES[ext] || MEDIA_TYPES[ext]) return 'viewer'
  return 'text'
}
/** 给预览引擎一个带扩展名的文件名（WeKnora 的 file_name 本来就有，兜底时才补） */
function fileNameForFile(f) {
  var n = String((f && (f.file_name || f.title)) || '')
  if (/\\.([A-Za-z0-9]{1,6})$/.test(n)) return n
  var ext = extOf(f)
  return ext ? n + '.' + ext : n
}
function sizeText(n) {
  var v = Number(n)
  if (!v || isNaN(v)) return ''
  if (v < 1024) return v + ' B'
  if (v < 1024 * 1024) return (v / 1024).toFixed(0) + ' KB'
  return (v / 1024 / 1024).toFixed(1) + ' MB'
}
/** 命中片段里的高亮：截断到 length 且把查询词包起来（WeKnora 不给 matched_content 时用） */
function snippet(text, limit) {
  var s = String(text || '').replace(/\\s+/g, ' ').trim()
  if (!s) return ''
  var max = limit || 320
  return s.length > max ? s.slice(0, max) + '…' : s
}

// ── 主面板 ───────────────────────────────────────────────
// ── 问答页：服务端直答 + 内联角标 ─────────────────────────
// WeKnora 生成的答案正文里本来就带 <kb doc="..." chunk_id="..." />，
// 这里把它渲染成可点角标，点开就是那一段的逐字原文（和 WeKnora 网页端一致）。
function QaPanel(props) {
  props = props || {}
  var ms = React.useState([]); var msgs = ms[0], setMsgs = ms[1]
  var ss = React.useState(''); var sid = ss[0], setSid = ss[1]
  var bs = React.useState(false); var busy = bs[0], setBusy = bs[1]
  var es = React.useState(''); var err = es[0], setErr = es[1]
  var qs = React.useState(''); var q = qs[0], setQ = qs[1]
  var sqs = React.useState([]); var sq = sqs[0], setSq = sqs[1]
  var ses = React.useState([]); var sessions = ses[0], setSessions = ses[1]
  var boxRef = React.useRef(null)
  var ctrlRef = React.useRef(null)

  var agentList = (props.agents && props.agents.length)
    ? props.agents
    : [{ id: 'builtin-quick-answer', name: '快速问答', builtin: true }]

  // 有新内容就滚到底（对应 WeKnora 的 scrollToBottom）
  React.useEffect(function () {
    var el = boxRef.current
    if (!el) return
    var near = el.scrollHeight - el.scrollTop - el.clientHeight < 160
    if (near || msgs.length <= 2) el.scrollTop = el.scrollHeight
  }, [msgs.length, msgs.length ? String(msgs[msgs.length - 1].content || '').length : 0])

  var loadSuggested = function () {
    return api('/suggested?agentId=' + encodeURIComponent(props.agentId || 'builtin-quick-answer')
      + (props.kbId ? '&kbId=' + encodeURIComponent(props.kbId) : ''))
      .then(function (r) { setSq((r && r.ok && r.questions) || []) })
      .catch(function () { setSq([]) })
  }

  React.useEffect(function () { loadSuggested() }, [props.agentId, props.kbId])

  // 会话历史：和 WeKnora 左侧列表同一个接口（GET /sessions）
  var loadSessions = function () {
    return api('/sessions?pageSize=40')
      .then(function (r) { setSessions((r && r.ok && r.sessions) || []) })
      .catch(function () { setSessions([]) })
  }
  React.useEffect(function () { loadSessions() }, [])

  var openSession = function (s) {
    if (!s || !s.id) return
    if (ctrlRef.current) { try { ctrlRef.current.abort() } catch (e) { /* 忽略 */ } }
    setErr('')
    setSid(s.id)
    setMsgs([{ id: 'loading', role: 'assistant', content: '', streaming: true, elapsedMs: 0 }])
    return api('/messages?sid=' + encodeURIComponent(s.id) + '&limit=50')
      .then(function (r) {
        var list = (r && r.ok && r.messages) || []
        setMsgs(list.map(function (m, i) {
          return {
            id: m.id || ('h' + i),
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content || '',
            streaming: false,
            elapsedMs: 0,
          }
        }))
      })
      .catch(function (e) { setErr(String((e && e.message) || e)); setMsgs([]) })
  }

  var sessionGroups = (function () {
    var now = Date.now()
    var buckets = [
      { label: '今天', test: function (t) { return now - t < 86400000 } },
      { label: '近 7 天', test: function (t) { return now - t < 7 * 86400000 } },
      { label: '近 30 天', test: function (t) { return now - t < 30 * 86400000 } },
      { label: '更早', test: function () { return true } },
    ]
    var out = buckets.map(function (b) { return { label: b.label, items: [] } })
    sessions.forEach(function (s2) {
      var t = s2.updatedAt ? new Date(s2.updatedAt).getTime() : 0
      for (var i = 0; i < buckets.length; i++) {
        if (buckets[i].test(t)) { out[i].items.push(s2); break }
      }
    })
    return out.filter(function (g) { return g.items.length })
  })()

  var openCite = function (cite) {
    if (!cite || !cite.chunkId) return
    if (__wkCtx && typeof openCiteInSidebar === 'function'
      && openCiteInSidebar(__wkCtx, { chunkId: cite.chunkId, doc: cite.doc || '' })) return
    toast('没能打开右侧栏；可以在「文件」里手动找这篇文档')
  }

  var newChat = function () {
    if (ctrlRef.current) { try { ctrlRef.current.abort() } catch (e) { /* 忽略 */ } }
    setMsgs([]); setSid(''); setErr(''); setBusy(false); setQ('')
    loadSuggested()
  }

  var send = function (text) {
    var query = String(text === undefined ? q : text).trim()
    if (!query || busy) return
    var startedAt = Date.now()
    setQ(''); setErr('')
    setMsgs(function (prev) {
      return prev.concat([
        { id: 'u' + startedAt, role: 'user', content: query },
        { id: 'a' + startedAt, role: 'assistant', content: '', streaming: true, elapsedMs: 0 },
      ])
    })
    setBusy(true)

    var acc = ''
    var tick = null
    var patch = function (extra) {
      setMsgs(function (prev) {
        var out = prev.slice()
        var last = out[out.length - 1]
        if (!last || last.role !== 'assistant') return prev
        out[out.length - 1] = Object.assign({}, last, { content: acc, elapsedMs: Date.now() - startedAt }, extra || {})
        return out
      })
    }
    var url = API + '/ask-stream?q=' + encodeURIComponent(query)
      + (props.kbId ? '&kbId=' + encodeURIComponent(props.kbId) : '')
      + (props.agentId ? '&agentId=' + encodeURIComponent(props.agentId) : '')
      + (sid ? '&sessionId=' + encodeURIComponent(sid) : '')
    var ctrl = (typeof AbortController === 'function') ? new AbortController() : null
    ctrlRef.current = ctrl

    return fetch(url, { signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        if (!res.ok || !res.body) throw new Error('HTTP ' + res.status)
        var next = res.headers.get('x-weknora-session')
        if (next) setSid(next)
        var reader = res.body.getReader()
        var dec = new TextDecoder()
        var buf = ''
        var pump = function () {
          return reader.read().then(function (r) {
            if (r.done) return null
            buf += dec.decode(r.value, { stream: true })
            var cut = buf.indexOf('\n\n')
            while (cut >= 0) {
              var frame = buf.slice(0, cut)
              buf = buf.slice(cut + 2)
              cut = buf.indexOf('\n\n')
              var lines = frame.split('\n')
              for (var i = 0; i < lines.length; i++) {
                var line = lines[i]
                if (line.indexOf('data:') !== 0) continue
                var raw = line.slice(5).trim()
                if (!raw) continue
                var ev = null
                try { ev = JSON.parse(raw) } catch (e) { ev = null }
                if (!ev) continue
                if (ev.response_type === 'answer' && ev.content) {
                  acc += ev.content
                  if (!tick) {
                    tick = setTimeout(function () { tick = null; patch({ streaming: true }) }, 60)
                  }
                } else if (ev.response_type === 'error') {
                  throw new Error(ev.content || 'WeKnora 返回错误')
                }
              }
            }
            return pump()
          })
        }
        return pump()
      })
      .then(function () {
        if (tick) { clearTimeout(tick); tick = null }
        patch({ streaming: false, elapsedMs: Date.now() - startedAt })
        setBusy(false)
        loadSessions()
      })
      .catch(function (e) {
        if (tick) { clearTimeout(tick); tick = null }
        setBusy(false)
        var aborted = e && (e.name === 'AbortError')
        patch({ streaming: false, elapsedMs: Date.now() - startedAt })
        if (aborted) { if (!acc) patch({ content: '（已停止）' }); return }
        setErr(String((e && e.message) || e))
      })
  }

  var stop = function () {
    if (ctrlRef.current) { try { ctrlRef.current.abort() } catch (e) { /* 忽略 */ } }
  }

  var onKey = function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent && e.nativeEvent.isComposing)) {
      e.preventDefault()
      send()
    }
  }

  var empty = msgs.length === 0

  return h('div', { className: 'dsh-ima-chat' },
    h('div', { className: 'dsh-ima-chat-inner' },
      h('div', { className: 'dsh-ima-hist' },
        h('button', { className: 'dsh-ima-new', onClick: newChat }, '＋ 新对话'),
        sessionGroups.map(function (g) {
          return h('div', { key: g.label, className: 'dsh-ima-hist-g' },
            h('div', { className: 'dsh-ima-hist-h' }, g.label),
            g.items.map(function (s2) {
              return h('div', {
                key: s2.id,
                className: 'dsh-ima-hist-i' + (s2.id === sid ? ' dsh-ima-hist-on' : ''),
                title: s2.title,
                onClick: function () { openSession(s2) },
              }, s2.title)
            }))
        })
      ),
      h('div', { className: 'dsh-ima-chat-main' },
    h('div', { className: 'dsh-ima-chat-top' },
      h('select', {
        className: 'dsh-ima-sel',
        value: props.agentId || agentList[0].id,
        title: '换一个 WeKnora 智能体回答',
        onChange: function (e) { if (props.onAgent) props.onAgent(e.target.value) },
      }, agentList.map(function (a) {
        return h('option', { key: a.id, value: a.id }, a.name + (a.builtin ? '' : ' · 自定义'))
      })),
      h('span', { className: 'dsh-ima-chat-hint' },
        sid ? '多轮对话（带上下文）' : '新对话'),
      h('button', { className: 'dsh-ima-ibtn', title: '开一个新对话', onClick: newChat }, '＋'),
    ),
    h('div', { className: 'dsh-ima-msgs', ref: boxRef },
      empty
        ? h('div', { className: 'dsh-ima-welcome' },
          h('div', { className: 'dsh-ima-welcome-t' }, '有什么可以帮你？'),
          h('div', { className: 'dsh-ima-welcome-s' },
            (props.kbName ? '在「' + props.kbName + '」里提问。' : '在所有知识库里提问。')
            + '答案由 WeKnora 直接生成，句末的角标点开就是出处原文。'),
          sq.length
            ? h('div', { className: 'dsh-ima-sq' }, sq.slice(0, 6).map(function (it, i) {
              return h('button', {
                key: 'sq' + i,
                className: 'dsh-ima-sq-card',
                title: it.question,
                onClick: function () { send(it.question) },
              }, it.question)
            }))
            : null,
        )
        : msgs.map(function (m) {
          if (m.role === 'user') {
            return h('div', { key: m.id, className: 'dsh-ima-msg dsh-ima-msg-u' },
              h('div', { className: 'dsh-ima-bubble' }, m.content))
          }
          return h('div', { key: m.id, className: 'dsh-ima-msg dsh-ima-msg-a' },
            h('div', { className: 'dsh-ima-ans' },
              m.content
                ? renderMarkdown(m.content, { onCite: openCite })
                : h('span', { className: 'dsh-ima-typing' }, '正在检索知识库…')),
            m.streaming
              ? null
              : h('div', { className: 'dsh-ima-msg-bar' },
                h('span', { className: 'dsh-ima-stamp' },
                  ((m.elapsedMs || 0) / 1000).toFixed(1) + ' 秒 · WeKnora 服务端直答'),
                h('button', {
                  className: 'dsh-ima-actbtn',
                  onClick: function () { sendToConversation('【WeKnora 问答】\n' + m.content) },
                }, h(QuoteGlyph), '引用到对话'),
              ),
          )
        }),
      err ? h('div', { className: 'dsh-ima-err' }, err) : null,
    ),
    h('div', { className: 'dsh-ima-composer' },
      h('textarea', {
        className: 'dsh-ima-ta',
        rows: 2,
        value: q,
        placeholder: empty ? '问点什么…（Enter 发送，Shift+Enter 换行）' : '继续追问…',
        onChange: function (e) { setQ(e.target.value) },
        onKeyDown: onKey,
      }),
      busy
        ? h('button', { className: 'dsh-ima-send dsh-ima-stop', onClick: stop }, '停止')
        : h('button', {
          className: 'dsh-ima-send',
          onClick: function () { send() },
          disabled: !String(q).trim(),
        }, '发送'),
    ),
      ),
    ),
  )
}

// 问答区：直接用 WeKnora 的接口渲染（不自造数据层）。
function QaPane(props) {
  return h(QaPanel, props)
}

function WeKnoraPage(props) {
  var panelActive = !props || props.active !== false
  var st = React.useState(null); var status = st[0], setStatus = st[1]
  var ks = React.useState([]); var kbs = ks[0], setKbs = ks[1]
  var cs = React.useState(null); var curKb = cs[0], setCurKb = cs[1]
  var is = React.useState([]); var items = is[0], setItems = is[1]
  var ls = React.useState(false); var loading = ls[0], setLoading = ls[1]
  var es = React.useState(''); var error = es[0], setError = es[1]
  var vs = React.useState(null); var preview = vs[0], setPreview = vs[1]
  var hs = React.useState([]); var hits = hs[0], setHits = hs[1]
  var qs = React.useState(''); var query = qs[0], setQuery = qs[1]
  var kws = React.useState(''); var keyword = kws[0], setKeyword = kws[1]
  var us = React.useState(null); var updatedAt = us[0], setUpdatedAt = us[1]
  var ss = React.useState(false); var showSetup = ss[0], setShowSetup = ss[1]
  var ds = React.useState(null); var detail = ds[0], setDetail = ds[1]
  var tb = React.useState('files'); var tab = tb[0], setTab = tb[1]
  // Office 文档默认用原件（宿主 LibreOffice 转 PDF）展示，切换「看文本」时才用分块正文
  var ob = React.useState(true); var officeOn = ob[0], setOfficeOn = ob[1]
  // 分组：'__all__' 全部 / '__root__' 未分组的根目录 / 其它为 folder_path
  var fds = React.useState([]); var folders = fds[0], setFolders = fds[1]
  var cfd = React.useState('__all__'); var curFolder = cfd[0], setCurFolder = cfd[1]
  var ups = React.useState([]); var uploads = ups[0], setUploads = ups[1]
  var ags = React.useState([]); var agents = ags[0], setAgents = ags[1]
  var aid = React.useState('builtin-quick-answer'); var agentId = aid[0], setAgentId = aid[1]
  var fileRef = React.useRef(null)

  var msg = function (e) { return String((e && e.message) || e) }

  var refreshStatus = function () {
    return api('/status').then(function (s) {
      setStatus(s)
      if (!s || !s.configured) { setKbs([]); setCurKb(null); setItems([]); setPreview(null); setHits([]) }
      return s
    }).catch(function (e) { setError(msg(e)) })
  }
  var loadKbs = function () {
    setLoading(true); setError('')
    return api('/knowledgeBases').then(function (r) {
      if (!r || !r.ok) { setError((r && r.message) || '取不到知识库列表'); return }
      var list = (r && r.knowledgeBases) || []
      setKbs(list); setUpdatedAt(new Date())
      // 没选库就默认选第一个，右侧知识库区不至于空着
      if (list.length && !curKb) {
        setCurKb(list[0])
        loadFolders(list[0])
        loadFiles(list[0], keyword, '__all__')
      }
    }).catch(function (e) { setError(msg(e)) })
      .then(function () { setLoading(false) })
  }
  var loadAgents = function () {
    return api('/agents').then(function (r) {
      if (r && r.ok && r.agents && r.agents.length) {
        setAgents(r.agents)
        var has = r.agents.some(function (a) { return a.id === agentId })
        if (!has) setAgentId(r.defaultAgentId || r.agents[0].id)
      }
    }).catch(function () { /* 拿不到就用内置快速问答 */ })
  }
  var loadFolders = function (kb) {
    if (!kb) { setFolders([]); return Promise.resolve() }
    return api('/folders?kbId=' + encodeURIComponent(kb.id)).then(function (r) {
      setFolders((r && r.ok && r.folders) || [])
    }).catch(function () { setFolders([]) })
  }
  var folderQuery = function (fp) {
    if (fp === '__all__') return ''
    return '&folderPath=' + encodeURIComponent(fp === '__root__' ? '' : fp)
  }
  var loadFiles = function (kb, kw, fp) {
    if (!kb) return
    var useFp = fp === undefined ? curFolder : fp
    setLoading(true); setError(''); setPreview(null); setHits([]); setDetail(null)
    return api('/files?kbId=' + encodeURIComponent(kb.id)
      + '&keyword=' + encodeURIComponent(kw || '')
      + folderQuery(useFp)
      + '&page=1&pageSize=100').then(function (r) {
        if (!r || !r.ok) { setError((r && r.message) || '取不到文件列表'); return }
        setItems(r.items || []); setUpdatedAt(new Date())
      }).catch(function (e) { setError(msg(e)) })
      .then(function () { setLoading(false) })
  }

  var patchUpload = function (key, patch) {
    setUploads(function (prev) {
      return prev.map(function (u) { return u.key === key ? Object.assign({}, u, patch) : u })
    })
  }
  var PARSE_TEXT = {
    pending: '排队中', processing: '解析中', finalizing: '收尾中（摘要/问题生成）',
    completed: '已入库', failed: '解析失败', cancelled: '已取消',
  }
  // 上传只是把字节交给 WeKnora，解析是后台异步的。这里按 /file?id= 轮询状态，
  // 让用户看到走到哪一步，失败时能直接看到 error_message（不用回 WeKnora 网页端查）。
  var trackParse = function (key, kid) {
    var tick = 0
    var step = function () {
      tick++
      api('/file?id=' + encodeURIComponent(kid)).then(function (r) {
        var f = (r && r.file) || r || {}
        var st = String(f.parse_status || '')
        if (st === 'failed' || st === 'cancelled') {
          patchUpload(key, { status: 'error', stage: st, err: f.error_message || PARSE_TEXT[st] || '解析失败' })
        } else if (st === 'completed') {
          patchUpload(key, { status: 'done', stage: 'completed' })
        } else {
          patchUpload(key, { status: 'parsing', stage: st || 'pending' })
        }
        var over = st === 'completed' || st === 'failed' || st === 'cancelled'
        if (over || tick > 60) {
          if (curKb) loadFiles(curKb, keyword, curFolder)
          return
        }
        window.setTimeout(step, 3000)
      }).catch(function () {
        if (tick <= 3) window.setTimeout(step, 3000)
      })
    }
    window.setTimeout(step, 2000)
  }
  var doUpload = function (fileList) {
    if (!curKb || !fileList || !fileList.length) return
    var arr = Array.prototype.slice.call(fileList)
    arr.forEach(function (f) {
      var key = f.name + '|' + Date.now() + '|' + Math.random()
      setUploads(function (prev) { return prev.concat([{ key: key, name: f.name, pct: 0, status: 'uploading' }]) })
      var xhr = new XMLHttpRequest()
      xhr.open('POST', API + '/upload?kbId=' + encodeURIComponent(curKb.id)
        + '&name=' + encodeURIComponent(f.name)
        + folderQuery(curFolder))
      xhr.upload.onprogress = function (ev) {
        if (ev.lengthComputable) patchUpload(key, { pct: Math.round(ev.loaded / ev.total * 100) })
      }
      xhr.onload = function () {
        var r = null
        try { r = JSON.parse(xhr.responseText) } catch (e) {}
        if (xhr.status >= 200 && xhr.status < 300 && r && r.ok) {
          var f = (r && (r.file || r.data)) || r || {}
          var kid = f.id || f.knowledge_id || ''
          patchUpload(key, { status: 'parsing', pct: 100, stage: f.parse_status || 'pending', kid: kid })
          if (kid) trackParse(key, kid)
        } else {
          patchUpload(key, { status: 'error', err: (r && r.message) || ('HTTP ' + xhr.status) })
        }
      }
      xhr.onerror = function () { patchUpload(key, { status: 'error', err: '网络错误' }) }
      xhr.send(f)
    })
    // 传完等解析入口建好再刷一次列表（解析本身是后台异步的）
    window.setTimeout(function () {
      if (curKb) { loadFiles(curKb, keyword, curFolder); loadFolders(curKb) }
    }, 1500)
  }

  React.useEffect(function () { refreshStatus(); loadAgents() }, [])
  React.useEffect(function () {
    if (status && status.configured) loadKbs()
  }, [status && status.configured])

  // 只有右侧栏打不开时，才由事件把面板切到原文（bindCiteLinks 里的兜底路径）。
  // 不再读 sessionStorage 做「面板挂载后补跳」—— 那会让每次打开知识库面板都被上一次
  // 点过的角标劫持，把用户正在看的文件顶掉。
  React.useEffect(function () {
    var onCite = function (e) { showCite(e && e.detail) }
    window.addEventListener('dsh-weknora:open-cite', onCite)
    return function () { window.removeEventListener('dsh-weknora:open-cite', onCite) }
  }, [])

  // 命中段滚到视野中间
  React.useEffect(function () {
    if (!preview || !preview.focusId) return
    var el = document.querySelector('.dsh-ima-main .dsh-ima-hl')
    if (el && el.scrollIntoView) {
      try { el.scrollIntoView({ block: 'center' }) } catch (e2) { /* 老浏览器忽略 */ }
    }
  }, [preview && preview.focusId])

  /** 点文件：先拿详情，文本类再拿分块全文 */
  var openFile = function (item) {
    setLoading(true); setError(''); setHits([]); setDetail(null)
    return api('/file?id=' + encodeURIComponent(item.id)).then(function (r) {
      if (!r || !r.ok) { setError((r && r.message) || '取不到文件详情'); return null }
      var f = r.file || item
      var kind = previewKindOf(f)
      if (kind === 'text') {
        var kbForText = (curKb && curKb.id) || f.knowledge_base_id || ''
        return api('/text?id=' + encodeURIComponent(f.id)
          + '&kbId=' + encodeURIComponent(kbForText)).then(function (t) {
          setPreview({
            file: f,
            kind: 'text',
            content: (t && t.content) || '',
            chunks: (t && t.chunks) || 0,
          })
        })
      }
      setPreview({ file: f, kind: kind, content: '' })
    }).catch(function (e) { setError(msg(e)) })
      .then(function () { setLoading(false) })
  }

  /** 会话里点了角标：打开整篇原文，并把命中的那一段标黄（同文件跳页、不同文件直接切） */
  var showCite = function (detail) {
    var cid = String((detail && detail.chunkId) || '')
    if (!cid) return null
    setError(''); setHits([]); setDetail(null); setLoading(true)
    return api('/chunk?id=' + encodeURIComponent(cid)).then(function (r) {
      if (!r || !r.ok) { setError((r && r.message) || '取不到这段原文'); return null }
      var kid = r.knowledge_id || ''
      var kbId = r.knowledge_base_id || (curKb && curKb.id) || ''
      var chunkText = String(r.content || '')
      // 三个请求并行：文件详情（判断是不是 Office）、命中页码、整篇分块
      return Promise.all([
        api('/file?id=' + encodeURIComponent(kid)).catch(function () { return null }),
        api('/pdfpage?id=' + encodeURIComponent(kid) + '&chunk=' + encodeURIComponent(cid)).catch(function () { return null }),
        api('/text?id=' + encodeURIComponent(kid) + '&kbId=' + encodeURIComponent(kbId)).catch(function () { return null }),
      ]).then(function (arr) {
        var fr = arr[0]
        var pr = arr[1]
        var t = arr[2]
        var file = (fr && fr.ok && fr.file) || {}
        var items = (t && (t.items || t.chunks)) || []
        if (!Array.isArray(items)) items = []
        setPreview({
          file: {
            id: kid,
            title: file.title || file.file_name || (detail && detail.doc) || '',
            file_name: file.file_name || (detail && detail.doc) || '',
            file_type: file.file_type || '',
            knowledge_base_id: kbId,
          },
          kind: 'text',
          content: (t && t.content) || '',
          chunks: items.length,
          items: items,
          focusId: cid,
          // 原件模式用：命中段原文（标黄）+ 所在页（跳页）
          focusContent: chunkText,
          page: (pr && pr.ok && Number(pr.page)) || 0,
        })
      })
    }).catch(function (e) { setError(msg(e)) })
      .then(function () { setLoading(false) })
  }

  /** 检索：有选中库就单库，否则跨库 */
  var doSearch = function () {
    var q = String(query || '').trim()
    if (!q) return
    setLoading(true); setError(''); setPreview(null)
    return api('/search?q=' + encodeURIComponent(q)
      + (curKb ? '&kbId=' + encodeURIComponent(curKb.id) : '')
      + '&matchCount=10').then(function (r) {
        if (!r || !r.ok) { setError((r && r.message) || '检索失败'); return }
        setHits(r.results || [])
      }).catch(function (e) { setError(msg(e)) })
      .then(function () { setLoading(false) })
  }

  var quoteFile = function (f) {
    sendToConversation('请读取我 WeKnora 知识库中的文件：' + (f.title || f.file_name)
      + '（knowledge_id: ' + f.id + '）')
  }
  var quoteHit = function (hit) {
    var body = snippet(hit.matched_content || hit.content, 600)
    sendToConversation('【' + (hit.knowledge_title || '知识库片段') + '】\\n'
      + body + '\\n—— WeKnora 知识库')
  }
  var openInWeKnora = function (kb) {
    try { window.open((status && status.webUrl) || (status && status.baseUrl) || '', '_blank', 'noopener') } catch (e) {}
  }

  // ── 未配置 ──
  if (!status || !status.configured) {
    return h('div', { className: 'dsh-ima-root' },
      h('div', { className: 'dsh-ima-head' },
        h('span', { className: 'dsh-ima-title' }, '知识库 WeKnora'),
        h('span', { className: 'dsh-ima-spacer' }),
        h('button', { className: 'dsh-ima-ibtn', title: '重新检测配置', onClick: refreshStatus }, h(RefreshIcon)),
      ),
      h('div', { className: 'dsh-ima-body' },
        h('div', { className: 'dsh-ima-center' },
          h(SetupDialog, {
            status: status,
            error: error,
            onSaved: function () { setError(''); refreshStatus() },
          }),
        ),
      ),
    )
  }

  // ── 预览区 ──
  var previewExt = preview && preview.file ? extOf(preview.file) : ''
  var previewIsOffice = !!(previewExt && OFFICE_TYPES[previewExt])
  // 表格类不走 PDF：LibreOffice 转出来的表格 PDF 没有列宽与分页可言，读起来是灾难。
  // DSH 自己就能打开 Excel，这里只负责把文件交出去（下载 / 在 DSH 里打开）。
  var previewIsSheet = /^(xls|xlsx|xlsm|ods|csv)$/.test(previewExt || '')
  var previewBody = null
  if (preview) {
    if (preview.kind === 'text') {
      // Office 文档默认走「原件」：宿主用 DSH 自带的 LibreOffice 套件把它转成 PDF，
      // 和右侧栏用同一个 pdfjs 渲染器：连续滚动翻页，滚轮就是翻页。
      // 换成 iframe 会带上浏览器自带的「上一页/下一页」工具条，样式也不一致。
      if (previewIsSheet) {
        previewBody = h('div', { className: 'dsh-ima-note dsh-ima-sheetnote' },
          h('div', null, '表格文件不在面板里渲染（PDF 化会丢列宽，还不如 DSH 自己的表格预览）。'),
          h('div', { className: 'dsh-ima-sheetrow' },
            h('button', { className: 'dsh-ima-btn', onClick: function () { downloadOriginal(preview.file.id, preview.file.file_name || preview.file.title) } }, '下载原件'),
            h('button', { className: 'dsh-ima-btn', onClick: function () { sendToConversation('请打开这个表格文件：' + (preview.file.title || preview.file.file_name || '')) } }, '交给对话')))
      } else if (previewIsOffice && officeOn) {
        previewBody = h('div', { className: 'dsh-ima-nos' },
          h(PdfView, {
            id: preview.file.id,
            page: preview.page || 0,
            needle: preview.focusContent || '',
          }))
      } else {
        previewBody = h('div', { className: 'dsh-ima-pre' },
          (preview.items && preview.items.length)
            ? preview.items.map(function (c, i) {
              var hit = preview.focusId && c.id === preview.focusId
              return h('div', {
                className: 'dsh-ima-chunk' + (hit ? ' dsh-ima-hl' : ''),
                key: c.id || ('p' + i),
              }, renderMarkdown(fixResourceUrls(c.content || '', preview.kbId || (curKb && curKb.id))))
            })
            : renderMarkdown(fixResourceUrls(preview.content || '（没有可读正文）', preview.kbId || (curKb && curKb.id))))
      }
    } else if (preview.kind === 'viewer') {
      previewBody = h(ViewerBox, {
        source: API + '/content?id=' + encodeURIComponent(preview.file.id),
        fileName: fileNameForFile(preview.file),
      })
    } else {
      previewBody = h('div', { className: 'dsh-ima-note', style: { marginTop: '12px' } },
        '这个格式没法内联预览，点「下载原件」拿原文件。')
    }
  }

  return h('div', { className: 'dsh-ima-root' },
    h('div', { className: 'dsh-ima-head' },
      h('span', { className: 'dsh-ima-title' }, '知识库 WeKnora'),
      h('span', { className: 'dsh-ima-badge' }, (kbs.length || 0) + ' 个库'),
      h('span', { className: 'dsh-ima-spacer' }),
      updatedAt ? h('span', { className: 'dsh-ima-stamp' }, '更新于 ' + fmtTime(updatedAt)) : null,
      curKb ? h('button', {
        className: 'dsh-ima-ibtn', title: '上传文件到当前分组',
        onClick: function () { if (fileRef.current) fileRef.current.click() },
      }, h('span', { style: { fontSize: '16px', lineHeight: 1 } }, '＋')) : null,
      h('input', {
        type: 'file', multiple: true, ref: fileRef,
        style: { display: 'none' },
        onChange: function (ev) { doUpload(ev.target.files); ev.target.value = '' },
      }),
      h('button', { className: 'dsh-ima-ibtn', onClick: function () { loadKbs() }, title: '重新获取知识库列表' }, h(RefreshIcon)),
      h('button', { className: 'dsh-ima-ibtn', onClick: function () { setShowSetup(!showSetup) }, title: '连接设置' }, h('span', { style: { fontSize: '15px' } }, '⚙')),
    ),
    error ? h('div', { className: 'dsh-ima-err' }, error) : null,
    uploads.length ? h('div', { className: 'dsh-ima-up' },
      h('div', { className: 'dsh-ima-up-h' },
        h('span', null, '上传 / 解析 · ' + uploads.filter(function (u) { return u.status === 'done' }).length + ' / ' + uploads.length),
        h('button', { className: 'dsh-ima-x', onClick: function () { setUploads([]) } }, '✕'),
      ),
      uploads.map(function (u) {
        return h('div', { key: u.key, className: 'dsh-ima-up-item' },
          h('div', { className: 'dsh-ima-up-name' },
            h('span', { className: 'dsh-ima-up-t' }, u.name),
            h('span', { className: 'dsh-ima-up-s' },
              u.status === 'done' ? '已入库'
                : (u.status === 'error' ? (u.err || '失败')
                  : (u.status === 'parsing' ? (PARSE_TEXT[u.stage] || '解析中') : u.pct + '%'))),
          ),
          h('div', { className: 'dsh-ima-up-bar' },
            h('div', {
              className: 'dsh-ima-up-fill' + (u.status === 'error' ? ' dsh-ima-up-fill-err' : ''),
              style: { width: (u.status === 'done' ? 100 : u.pct) + '%' },
            }),
          ),
        )
      }),
    ) : null,
    h('div', { className: 'dsh-ima-body' },
      // 左：知识库
      h('div', { className: 'dsh-ima-kbs' },
        kbs.length === 0 && !loading ? h('div', { className: 'dsh-ima-note' }, '没有知识库') : null,
        kbs.map(function (kb) {
          return h('div', {
            key: kb.id,
            className: 'dsh-ima-kb' + (curKb && curKb.id === kb.id ? ' dsh-ima-kb-on' : ''),
            title: (kb.description ? kb.description + '\\n' : '')
              + (kb.knowledge_count || 0) + ' 个文件 · ' + (kb.chunk_count || 0) + ' 个分块',
            onClick: function () {
              setCurKb(kb); setDetail(null); setCurFolder('__all__')
              loadFolders(kb); loadFiles(kb, keyword, '__all__')
            },
          },
            h(KbIcon, { size: 18 }),
            h('span', { className: 'dsh-ima-kb-name' }, kb.name),
            kb.knowledge_count ? h('span', { className: 'dsh-ima-item-y' }, String(kb.knowledge_count)) : null,
          )
        }),
        curKb && folders && folders.length
          ? h('div', { className: 'dsh-ima-folds' },
            h('div', { className: 'dsh-ima-fold-h' }, '分组'),
            h('div', {
              className: 'dsh-ima-fold' + (curFolder === '__all__' ? ' dsh-ima-fold-on' : ''),
              onClick: function () { setCurFolder('__all__'); loadFiles(curKb, keyword, '__all__') },
            }, h(FolderGlyph, { size: 13 }), h('span', { className: 'dsh-ima-fold-t' }, '全部')),
            folders.map(function (fo) {
              return h('div', {
                key: fo.path,
                className: 'dsh-ima-fold' + (curFolder === fo.path ? ' dsh-ima-fold-on' : ''),
                title: fo.path,
                onClick: function () { setCurFolder(fo.path); loadFiles(curKb, keyword, fo.path) },
              },
                h(FolderGlyph, { size: 13 }),
                h('span', { className: 'dsh-ima-fold-t' }, fo.name || fo.path),
                h('span', { className: 'dsh-ima-item-y' }, String(fo.document_count || 0)),
              )
            }),
          )
          : null,
      ),
      // 右：检索 / 预览 / 文件列表
      h('div', { className: 'dsh-ima-main' },
        h('div', { className: 'dsh-ima-crumb' },
          h('input', {
            className: 'dsh-ima-input',
            value: query,
            placeholder: curKb ? '在这个库里搜…' : '在所有库里搜…',
            onChange: function (e) { setQuery(e.target.value) },
            onKeyDown: function (e) { if (e.key === 'Enter') doSearch() },
          }),
          h('button', { className: 'dsh-ima-btn dsh-ima-btn-p', onClick: doSearch, disabled: !query.trim() }, '检索'),
          h('span', { className: 'dsh-ima-spacer' }),
          curKb ? h('button', {
            className: 'dsh-ima-btn',
            title: '在 WeKnora 网页版打开',
            onClick: function () { openInWeKnora(curKb) },
          }, h(ExternalGlyph), '打开 WeKnora') : null,
        ),

        hits.length > 0
          ? h('div', { key: 'hits', style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
              h('div', { className: 'dsh-ima-crumb' },
                h('button', { className: 'dsh-ima-btn', onClick: function () { setHits([]) } }, '返回列表'),
                h('span', { style: { flex: 1 } }, '检索命中 ' + hits.length + ' 条'),
              ),
              h('div', { style: { overflow: 'auto', flex: 1 } },
                hits.map(function (hit, i) {
                  return h('div', { key: hit.id || i, className: 'dsh-ima-hit' },
                    h('div', { className: 'dsh-ima-hit-h' },
                      h('span', { className: 'dsh-ima-item-t', title: hit.knowledge_title }, hit.knowledge_title || '未命名'),
                      hit.knowledge_base_id ? h('span', { className: 'dsh-ima-item-y' }, hit.knowledge_filename || '') : null,
                      h('span', { className: 'dsh-ima-item-y' }, '相关度 ' + (Number(hit.score) || 0).toFixed(2)),
                    ),
                    h('div', { className: 'dsh-ima-hit-b' }, snippet(hit.matched_content || hit.content, 420)),
                    h('div', { className: 'dsh-ima-act' },
                      h('button', { className: 'dsh-ima-actbtn dsh-ima-actbtn-p', onClick: function () { quoteHit(hit) } },
                        h(QuoteGlyph), '引用到对话'),
                      h('button', {
                        className: 'dsh-ima-actbtn',
                        onClick: function () {
                          var f = { id: hit.knowledge_id, title: hit.knowledge_title, file_name: hit.knowledge_filename, file_type: '' }
                          openFile(f)
                        },
                      }, '读全文'),
                    ),
                  )
                }),
              ),
            )
          : preview
            ? h('div', { key: 'pv', style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
                h('div', { className: 'dsh-ima-crumb' },
                  h('button', { className: 'dsh-ima-btn', onClick: function () { setPreview(null) } }, '返回列表'),
                  h('span', {
                    style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, minWidth: 0 },
                    title: preview.file.file_name || preview.file.title,
                  }, preview.file.title || preview.file.file_name),
                  preview.file.parse_status ? h(StatusTag, { status: preview.file.parse_status }) : null,
                  previewIsOffice
                    ? h('button', {
                      className: 'dsh-ima-btn' + (officeOn ? ' dsh-ima-actbtn-on' : ''),
                      title: officeOn ? '切到分块文本（可选中复制）' : '切到原件排版',
                      onClick: function () { setOfficeOn(!officeOn) },
                    }, officeOn ? '看文本' : '看原件')
                    : null,
                  h('button', {
                    className: 'dsh-ima-btn',
                    onClick: function () {
                      downloadOriginal(preview.file.id, preview.file.file_name || preview.file.title)
                    },
                  }, '下载原件'),
                  h('button', {
                    className: 'dsh-ima-btn dsh-ima-btn-p',
                    title: '把它交给对话里的 agent 读取',
                    onClick: function () { quoteFile(preview.file) },
                  }, h(QuoteGlyph), '引用到对话'),
                ),
                preview.file.error_message
                  ? h('div', { className: 'dsh-ima-err', style: { marginBottom: '8px' } }, '解析失败：' + preview.file.error_message)
                  : null,
                preview.file.description
                  ? h('div', { className: 'dsh-ima-note', style: { marginBottom: '8px' } }, preview.file.description)
                  : null,
                (preview.file.profile && preview.file.profile.gist)
                  ? h('div', { className: 'dsh-ima-gist' }, preview.file.profile.gist)
                  : null,
                (preview.file.profile && preview.file.profile.topics && preview.file.profile.topics.length)
                  ? h('div', { className: 'dsh-ima-tags' },
                      preview.file.profile.topics.map(function (t, i) {
                        return h('span', { key: i, className: 'dsh-ima-chip' }, t)
                      }))
                  : null,
                previewBody,
                preview.kind === 'text' && !(previewIsOffice && officeOn)
                  ? h('div', { className: 'dsh-ima-stamp', style: { marginTop: '8px' } },
                      OFFICE_TYPES[extOf(preview.file)]
                        ? 'WeKnora 已把该文档解析成文本，上面是 ' + (preview.chunks || 0) + ' 个分块拼出的内容（不含原始排版）。'
                        : '正文由 ' + (preview.chunks || 0) + ' 个分块拼接。')
                  : null,
              )
            : items.length === 0
              ? h('div', { key: 'e', className: 'dsh-ima-empty' },
                  loading ? '加载中…' : (curKb ? '这个库里还没有文件' : '从左侧选择一个知识库'))
              : h('div', { key: 'list', style: { flex: 1, minHeight: 0, overflow: 'auto' } },
                  items.map(function (it) {
                    return h('div', {
                      key: it.id,
                      className: 'dsh-ima-item',
                      title: (it.file_name || it.title) + ' · ' + (it.file_type || ''),
                      onClick: function () { openFile(it) },
                    },
                      h(FileTypeIcon, { type: extOf(it), size: 22 }),
                      h('span', { className: 'dsh-ima-item-t' }, it.title || it.file_name),
                      it.parse_status ? h(StatusTag, { status: it.parse_status, title: it.error_message || '' }) : null,
                      h('span', { className: 'dsh-ima-item-y' }, fmtDate(it.updated_at || it.created_at)),
                      h('span', { className: 'dsh-ima-act' },
                        h('button', {
                          className: 'dsh-ima-actbtn dsh-ima-actbtn-p',
                          title: '把它交给对话里的 agent 读取',
                          onClick: function (e) { e.stopPropagation(); quoteFile(it) },
                        }, h(QuoteGlyph), '引用到对话'),
                        h('button', {
                          className: 'dsh-ima-actbtn',
                          title: '复制文件名',
                          onClick: function (e) { e.stopPropagation(); copyText(it.title || it.file_name) },
                        }, h(CopyGlyph), '复制名称'),
                      ),
                    )
                  }),
                ),
      ),
    ),
    showSetup ? h('div', {
      className: 'dsh-ima-overlay',
      onClick: function (e) { if (e.target === e.currentTarget) setShowSetup(false) },
    }, h(SetupDialog, {
      status: status,
      onClose: function () { setShowSetup(false) },
      onSaved: function () { refreshStatus() },
    })) : null,
  )
}

// ── 连接设置（在面板里直接填写，替代 ima 的绑定弹窗） ───────
// WeKnora 用 API Key，不需要 OAuth：这里就是两个输入框 + 保存，
// 保存后经宿主写进 ~/.dsh/dsh-weknora-panel.json，立即生效。
function SetupDialog(props) {
  var s = props.status || {}
  var reachable = s.reachable
  var bs = React.useState(s.baseUrl || ''); var baseUrl = bs[0], setBaseUrl = bs[1]
  var ks = React.useState(''); var apiKey = ks[0], setApiKey = ks[1]
  var sv = React.useState(false); var saving = sv[0], setSaving = sv[1]
  var es = React.useState(''); var err = es[0], setErr = es[1]
  var ms = React.useState(''); var note = ms[0], setNote = ms[1]
  var cms = React.useState(s.contextMode || 'once'); var contextMode = cms[0], setContextMode = cms[1]
  var das = React.useState(!!s.directAnswer); var directAnswer = das[0], setDirectAnswer = das[1]
  var kqs = React.useState(s.kbQa !== false); var kbQa = kqs[0], setKbQa = kqs[1]
  var rts = React.useState(''); var rtText = rts[0], setRtText = rts[1]
  var rto = React.useState(null); var rtOut = rto[0], setRtOut = rto[1]
  var rtb = React.useState(false); var rtBusy = rtb[0], setRtBusy = rtb[1]
  var runTest = function () {
    if (rtBusy) return
    setRtBusy(true); setRtOut(null)
    api('/redact-test?text=' + encodeURIComponent(String(rtText || '').trim()))
      .then(function (r) { setRtOut(r || { ok: false, message: '无响应' }) })
      .catch(function (e) { setRtOut({ ok: false, message: String((e && e.message) || e) }) })
      .then(function () { setRtBusy(false) })
  }

  React.useEffect(function () {
    if (s.baseUrl) setBaseUrl(s.baseUrl)
  }, [s.baseUrl])

  React.useEffect(function () {
    if (s.contextMode) setContextMode(s.contextMode)
    setDirectAnswer(!!s.directAnswer)
    setKbQa(s.kbQa !== false)
  }, [s.contextMode])

  var save = function () {
    if (saving) return
    var b = String(baseUrl || '').trim()
    var k = String(apiKey || '').trim()
    if (!b) { setErr('Base URL 不能为空'); return }
    if (!k && !s.keyMasked) { setErr('API Key 不能为空'); return }
    setSaving(true); setErr(''); setNote('')
    api('/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseUrl: b, apiKey: k, contextMode: contextMode, directAnswer: directAnswer, kbQa: kbQa }),
    }).then(function (r) {
      if (!r || !r.ok) { setErr((r && r.message) || '保存失败'); return }
      setApiKey('')
      setNote(r.reachable
        ? '已保存，连接正常（' + (r.kbCount || 0) + ' 个知识库）'
        : ('已保存，但连不上：' + (r.error || '未知原因')))
      if (props.onSaved) props.onSaved()
    }).catch(function (e) { setErr(String((e && e.message) || e)) })
      .then(function () { setSaving(false) })
  }

  var tone = s.configured
    ? (reachable ? 'var(--dsw-alias-status-success,#1a9e6a)' : 'var(--dsw-alias-status-danger,#d93838)')
    : 'var(--dsw-alias-label-secondary,#666)'
  var statusText = s.configured
    ? (reachable ? '● 已连接' + (s.kbCount ? '（' + s.kbCount + ' 个知识库）' : '') : '● 连接异常')
    : '○ 未连接'

  return h('div', { className: 'dsh-ima-dlg' },
    h('h3', null, s.configured ? 'WeKnora 连接设置' : '连接 WeKnora'),
    h('div', { className: 'dsh-ima-note', style: { marginTop: '6px', color: 'var(--dsw-alias-label-tertiary,#999)' } },
      '填好下面两项点保存，立刻生效 —— 不用重启，也不用配环境变量。'),

    h('label', { className: 'dsh-ima-lbl' }, 'Base URL'),
    h('input', {
      className: 'dsh-ima-inp',
      value: baseUrl,
      spellCheck: false,
      placeholder: 'http://localhost:8080/api/v1',
      onChange: function (e) { setBaseUrl(e.target.value) },
    }),

    h('label', { className: 'dsh-ima-lbl' },
      s.keyMasked ? 'API Key（当前 ' + s.keyMasked + '，留空表示不改）' : 'API Key'),
    h('input', {
      className: 'dsh-ima-inp',
      type: 'password',
      value: apiKey,
      spellCheck: false,
      placeholder: s.keyMasked ? '保持原值请留空' : 'sk-...',
      onChange: function (e) { setApiKey(e.target.value) },
      onKeyDown: function (e) { if (e.key === 'Enter') save() },
    }),

    h('label', { className: 'dsh-ima-lbl' }, '会话上下文注入'),
    h('select', {
      className: 'dsh-ima-inp',
      value: contextMode,
      onChange: function (e) { setContextMode(e.target.value) },
    },
      h('option', { value: 'once' }, '每个会话只注入一次（推荐）'),
      h('option', { value: 'always' }, '每轮对话都注入（更主动，但吃上下文）'),
      h('option', { value: 'off' }, '完全不注入（工具照常可用）')
    ),
    h('div', { className: 'dsh-ima-note', style: { marginTop: '4px', fontSize: '.85em' } },
      '这段说明只影响 agent 会不会被提醒“优先用 weknora_panel_ask”，不影响 7 个工具本身。'),

    h('label', { className: 'dsh-ima-lbl', style: { marginTop: '10px' } }, '知识库问答'),
    h('label', { style: { display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: '.9em', lineHeight: 1.5 } },
      h('input', {
        type: 'checkbox',
        checked: kbQa !== false,
        onChange: function (e) { setKbQa(e.target.checked) },
        style: { marginTop: '3px' },
      }),
      h('span', null, '关掉之后不再给模型任何知识库提示，它也就不会去查（工具仍然可用，你在对话里点名要求才会用）。'
        + '适合“只想聊代码/通用问题”的时段。')
    ),

    h('label', { className: 'dsh-ima-lbl', style: { marginTop: '10px' } }, '快答直出'),
    h('label', { style: { display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: '.9em', lineHeight: 1.5 } },
      h('input', {
        type: 'checkbox',
        checked: !!directAnswer,
        onChange: function (e) { setDirectAnswer(e.target.checked) },
        style: { marginTop: '3px' },
      }),
      h('span', null, '本会话第一次提问时，WeKnora 的答案直接作为回复（不让模型再复述一遍）。'
        + '关掉时模型会照常输出一次，正文里有完整答案，但会多几秒、也可能被轻微改写。')
    ),

    h('div', { style: { borderTop: '1px solid rgba(0,0,0,.08)', marginTop: '12px', paddingTop: '10px' } },
      h('label', { className: 'dsh-ima-lbl' }, '脱敏自检'),
      h('div', { className: 'dsh-ima-note', style: { fontSize: '.85em', marginBottom: '6px' } },
        '库里的文档、WeKnora 会话历史、最终答案都是原文 —— 这是设计。脱敏只作用于「送给大模型的那一份上下文」。输一句含敏感词的话点试一下，能看到它被换成什么，再还原回来。'),
      h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
        h('input', {
          className: 'dsh-ima-inp',
          style: { flex: 1 },
          value: rtText,
          spellCheck: false,
          placeholder: '例如：差旅费报销标准',
          onChange: function (e) { setRtText(e.target.value) },
          onKeyDown: function (e) { if (e.key === 'Enter') runTest() },
        }),
        h('button', { className: 'dsh-ima-btn', style: { whiteSpace: 'nowrap' }, disabled: rtBusy, onClick: runTest }, rtBusy ? '测试中…' : '试一下')
      ),
      rtOut ? (rtOut.ok
        ? h('div', { className: 'dsh-ima-note', style: { marginTop: '8px', fontSize: '.85em' } },
            h('div', null, '脱敏服务：' + (rtOut.ready ? '就绪' : '未就绪') + ' · ' + (rtOut.terms || 0) + ' 个词条 · 当前 ' + (rtOut.placeholders || 0) + ' 个占位符'),
            rtOut.redacted ? h('div', { style: { marginTop: '4px' } }, '脱敏后：', h('code', null, rtOut.redacted)) : null,
            rtOut.restored ? h('div', { style: { marginTop: '2px' } }, '还原后：', h('code', null, rtOut.restored)) : null
          )
        : h('div', { className: 'dsh-ima-err', style: { marginTop: '8px' } }, rtOut.message || '测试失败')) : null
    ),

    err ? h('div', { className: 'dsh-ima-err', style: { padding: '8px 0 0' } }, err) : null,
    note ? h('div', { className: 'dsh-ima-note', style: { marginTop: '8px' } }, note) : null,
    (s.error && s.configured) ? h('div', { className: 'dsh-ima-err', style: { padding: '8px 0 0' } }, s.error) : null,

    h('div', { className: 'dsh-ima-acts' },
      h('span', { style: { fontSize: '.9em', color: tone, marginRight: 'auto' } }, statusText),
      props.onClose ? h('button', { className: 'dsh-ima-btn', onClick: props.onClose }, '关闭') : null,
      h('button', { className: 'dsh-ima-btn dsh-ima-btn-p', onClick: save, disabled: saving },
        saving ? '保存中…' : '保存'),
    ),
  )
}

// ── 插件入口 ─────────────────────────────────────────────
// 右侧栏 tab 要用 sidebarRightTabs / sidebarRight，必须在这里声明成依赖，
// 否则 cordis 访问未注入的服务会直接抛错，整个插件 entry 变成 failed。
// 注意：不要 inject 'layout'。点角标绝不能动左侧会话栏，收起左边栏会让用户
// 正在看的会话消失，还会留下一个空的「开始」页。
var inject = ['slots', 'sidebarRightTabs', 'sidebarRight']
var applied = false

/**
 * 会话里 agent 回答带的角标是 <a href="dsh-weknora:chunk/<id>">：
 * 在 capture 阶段拦下，别让浏览器去导航，改成在右侧边栏把原文渲染出来。
 */
/** 打开一条出处的原文（会写 sessionStorage，供面板回退路径补跳） */
function openCiteDetail(ctx, detail) {
  try { window.sessionStorage.setItem('dsh-weknora:last-cite', JSON.stringify(detail)) } catch (err) { /* 隐私模式忽略 */ }
  // 优先在右侧边栏开一个原文 tab；只有右侧栏打不开时才退回面板，
  // 否则点角标会顺带把左侧知识库面板切到那个文件，打扰正在看的东西。
  var opened = openCiteInSidebar(ctx, detail)
  // 无论右侧栏有没有开，都通知面板：面板正在预览时，点下一个角标要跟着切文件 / 跳页。
  try { window.dispatchEvent(new CustomEvent('dsh-weknora:open-cite', { detail: detail })) } catch (e) { /* 忽略 */ }
  console.log('[dsh-weknora] 角标点击 →', opened ? '右侧栏原文' : '面板原文', detail.chunkId)
}

/**
 * 会话里 agent 回答带的角标是 <a href="dsh-weknora:c/<短码>">（或旧版的
 * dsh-weknora:chunk/<id>?doc=...）。在 capture 阶段拦下，别让浏览器去导航，
 * 改成在右侧边栏把原文渲染出来。
 */
function bindCiteLinks(ctx) {
  if (window.__DSH_WK_CLICK_BOUND__) return
  window.__DSH_WK_CLICK_BOUND__ = true
  document.addEventListener('click', function (e) {
    // 角标在 DSH 的 shadow root 里：事件冒泡到 document 时 e.target 已被 retarget 成
    // shadow host，顺着 parentElement 永远找不到那个 <a>。必须用 composedPath() 取原始路径。
    var el = null
    var path = []
    try { path = (e.composedPath && e.composedPath()) || [] } catch (err) { path = [] }
    for (var pi = 0; pi < path.length; pi++) {
      var pn = path[pi]
      if (pn && pn.nodeType === 1 && pn.tagName === 'A' && /^dsh-weknora:/i.test(pn.getAttribute('href') || '')) {
        el = pn
        break
      }
    }
    if (!el) {
      var cur = e.target
      while (cur && cur.nodeType === 1 && !(cur.tagName === 'A' && /^dsh-weknora:/i.test(cur.getAttribute('href') || ''))) {
        cur = cur.parentElement
      }
      el = cur
    }
    if (!el || el.nodeType !== 1) return
    var href = el.getAttribute('href') || ''

    // 新格式：短码，先问宿主把 chunk id 换回来
    var sc = /^dsh-weknora:c\/([0-9a-z]+)$/i.exec(href)
    if (sc) {
      e.preventDefault()
      e.stopPropagation()
      api('/cite?k=' + encodeURIComponent(sc[1])).then(function (r) {
        if (!r || !r.ok || !r.chunkId) {
          toast((r && r.message) || '这条出处已失效，请重新提问')
          return
        }
        openCiteDetail(ctx, { chunkId: r.chunkId, doc: r.doc || '' })
      }).catch(function (err) {
        toast('出处解析失败：' + ((err && err.message) || err))
      })
      return
    }

    // 旧格式：chunk/<id>?doc=<文件名>（历史消息里可能还留着）
    var m = /^dsh-weknora:chunk\/([^?#]+)(?:\?(.*))?$/i.exec(href)
    if (!m) return
    e.preventDefault()
    e.stopPropagation()
    var q = {}
    ;(m[2] || '').split('&').forEach(function (kv) {
      if (!kv) return
      var i = kv.indexOf('=')
      q[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1))
    })
    openCiteDetail(ctx, { chunkId: decodeURIComponent(m[1]), doc: q.doc || '' })
  }, true)
}

// ── 正文角标装饰：把 [1] [2] 变成可点角标 ────────────────────────────
// agent 转述 WeKnora 答案时，markdown 链接会被它简化掉；但 `[1]` 这种纯文本标记
// 基本会原样保留。这里在 DOM 层把 `[1]` 换成 <a href="dsh-weknora:chunk/...">，
// 复用 bindCiteLinks 的 capture 点击拦截，点一下就在右侧栏打开原文并标黄。
var CITE_LEDGER = { cites: [], at: 0 }

function fetchCiteLedger(key) {
  return fetch(API + '/ledger' + (key ? '?k=' + encodeURIComponent(key) : ''), { headers: { accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (j) {
      if (j && j.ok && j.cites && j.cites.length) CITE_LEDGER = { cites: j.cites, at: Date.now() }
      return CITE_LEDGER
    })
    .catch(function () { return CITE_LEDGER })
}

function citeLedgerMap() {
  var m = {}
  for (var i = 0; i < CITE_LEDGER.cites.length; i++) {
    var c = CITE_LEDGER.cites[i]
    if (c && c.n) m[Number(c.n)] = c
  }
  return m
}

function decorateSkip(node) {
  for (var el = node && node.parentElement; el; el = el.parentElement) {
    var t = el.tagName
    if (t === 'PRE' || t === 'CODE' || t === 'A' || t === 'TEXTAREA' || t === 'SCRIPT' || t === 'STYLE') return true
    if (t === 'INPUT' || t === 'SELECT' || t === 'OPTION') return true
    // 关键：输入框/编辑器里的 [1] 绝不能碰。之前只挡住了 textarea，
    // 富文本编辑器（contenteditable 的 div）被误装饰，正在输入的拼音被拆散、
    // 提交时还会把 <a> 一起发出去。
    if (el.isContentEditable) return true
    try {
      if (el.getAttribute) {
        var ce = el.getAttribute('contenteditable')
        if (ce === '' || ce === 'true' || ce === 'plaintext-only') return true
        if (el.getAttribute('role') === 'textbox') return true
      }
    } catch (e) { /* 忽略 */ }
  }
  return false
}

// DSH 的消息区可能挂在 shadow root 里（插件样式都要往每个 shadowRoot 塞一份），
// 所以装饰器不能只看 document.body，得把所有 shadow root 一起扫。
function citeRoots() {
  var out = []
  var seen = []
  var walk = function (root) {
    if (!root || seen.indexOf(root) >= 0) return
    seen.push(root)
    out.push(root)
    var els
    try { els = root.querySelectorAll('*') } catch (e) { return }
    for (var i = 0; i < els.length; i++) {
      var sr = els[i] && els[i].shadowRoot
      if (sr) walk(sr)
    }
  }
  try { if (document.body) walk(document.body) } catch (e) { /* 忽略 */ }
  return out
}

function decorateCiteMarks() {
  var __n = _doDecorate()
  if (__n > 0) { try { logDiag('decorate', { n: __n, ledger: (CITE_LEDGER && CITE_LEDGER.cites || []).length }) } catch (e) {} }
  return __n
}
function _doDecorate() {
  var map = citeLedgerMap()
  if (!Object.keys(map).length) return 0
  var roots = citeRoots()
  if (!roots.length) return 0
  var total = 0
  roots.forEach(function (root) { total += decorateOneRoot(root, map) })
  return total
}

// 只认短码 [#ab12cd34]。裸 [1] 一律不装饰：
// 正文示例、代码里的 m[1]、思考过程里的编号都会被误伤，
// 之前把推理区里的 m[1] 染成蓝角标就是这么来的。
var MARK_RE = /[\[【]#([0-9a-z]{6,12})[\]】]/g
var CITE_SHORT = Object.create(null)

function decorateOneRoot(root, map) {
  var localSeq = { __n: 0 }
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  var nodes = []
  var node
  while ((node = walker.nextNode())) {
    var txt = node.nodeValue
    if (!txt || (txt.indexOf('[') < 0 && txt.indexOf('【') < 0)) continue
    // 新格式 [#ab12cd34]（短码，全局唯一）；旧格式 [1] / 【1】（历史消息）
    if (!MARK_RE.test(txt)) continue
    if (decorateSkip(node)) continue
    nodes.push(node)
  }
  var done = 0
  for (var j = 0; j < nodes.length; j++) {
    var src = nodes[j]
    var text = src.nodeValue
    var re = MARK_RE
    re.lastIndex = 0
    var frag = document.createDocumentFragment()
    var last = 0
    var m
    var changed = false
    while ((m = re.exec(text))) {
      var short = m[1] || ''
      var a
      if (short) {
        // 短码：不需要编号表，短码本身就指向唯一 chunk。
        // 显示编号按「本条消息内第几次出现」算，所以每条回答都从 1 开始。
        var seq = localSeq[short]
        if (!seq) { seq = (++localSeq.__n); localSeq[short] = seq }
        var info = (CITE_SHORT && CITE_SHORT[short]) || null
        var doc = info ? info.doc : ''
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)))
        a = document.createElement('a')
        a.className = 'dsh-ima-cite dsh-ima-cite-dom'
        a.setAttribute('href', 'dsh-weknora:c/' + short)
        a.setAttribute('title', (doc ? doc + ' · ' : '') + '第 ' + seq + ' 处出处')
        a.setAttribute('data-wk-cite', short)
        a.textContent = String(seq)
        frag.appendChild(a)
        last = m.index + m[0].length
        changed = true
        done++
        continue
      }
    }
    if (!changed || !src.parentNode) continue
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
    src.parentNode.replaceChild(frag, src)
  }
  return done
}

function logDiag(evt, data) {
  try {
    var s = evt + ' ' + JSON.stringify(data || {})
    fetch(API + '/diag', { method: 'POST', body: s })
  } catch (e) { /* 忽略 */ }
}

function observeCiteMarks() {
  if (window.__DSH_WK_CITE_OBS__) return
  window.__DSH_WK_CITE_OBS__ = true
  var timer = null
  var run = function () {
    if (timer) return
    timer = setTimeout(function () {
      timer = null
      try { decorateCiteMarks() } catch (e) { /* 忽略 */ }
    }, 400)
  }
  // 只对「非编辑区」的变化做装饰：输入框里打字也会触发 MutationObserver，
  // 之前每个字符都触发一次全文档扫描，正在输入的拼音被拆散、提交时还带着 <a>。
  try {
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        if (!decorateSkip(muts[i].target)) { run(); return }
      }
    })
    mo.observe(document.body, { childList: true, subtree: true, characterData: true })
  } catch (e) { /* 忽略 */ }
  fetchCiteLedger('').then(function () { try { decorateCiteMarks() } catch (e) { /* 忽略 */ } })
  setInterval(run, 4000)
}

// 角标样式一定要在会话正文第一次渲染前就位，否则用户会先看到一个蓝色下划线链接，
// 紧接着才被 CSS 改成上标角标（肉眼可见的闪烁）。
try { injectCiteStyles() } catch (e) { /* 忽略 */ }

// ── 右侧边栏里的「知识库原文」tab ─────────────────────────
var CITE_TAB_ID = 'dsh-weknora-panel/cite'
var CITE_TAB_KIND = 'weknora-cite'
var __wkCtx = null

/** 关掉原文 tab：直接把整列收起，不留下一个空的默认页 */
function closeCiteTab() {
  try {
    if (__wkCtx && __wkCtx.sidebarRight && typeof __wkCtx.sidebarRight.toggleExpanded === 'function') {
      if (typeof __wkCtx.sidebarRight.isExpanded !== 'function' || __wkCtx.sidebarRight.isExpanded()) {
        __wkCtx.sidebarRight.toggleExpanded()
      }
    }
  } catch (e) { /* 忽略 */ }
}

/**
 * 打开右侧栏原文 tab。左侧会话栏完全不动 —— 之前会顺手收起左侧栏，
 * 导致用户正在看的会话被关掉、还留下一个空的「开始」页。
 */
/**
 * 最近一次角标点击的 { chunkId, doc }。
 *
 * 为什么要这个全局变量：`sidebarRight.openTab(kind, {params})` 传进去的 params
 * 在 tab 正文里能不能取到，取决于 DSH 版本（0.2.2-rc.1 的 `tab.navigation` 是
 * snapshot store，且 slot 组件的 props 里不保证有 useTabInfo）。点击和打开发生在
 * 同一个前端上下文里，直接记一份最稳；params 仅作为刷新/恢复时的兜底。
 */
var PENDING_CITE = null

function openCiteInSidebar(ctx, detail) {
  try {
    if (!ctx || !ctx.sidebarRight || typeof ctx.sidebarRight.openTab !== 'function') return false
    PENDING_CITE = { chunkId: String(detail.chunkId || ''), doc: String(detail.doc || ''), at: Date.now() }
    if (typeof ctx.sidebarRight.isExpanded === 'function' && !ctx.sidebarRight.isExpanded()) {
      ctx.sidebarRight.toggleExpanded()
    }
    // revealIfOpened：同 kind 的 tab 已经开着就复用，不要每点一次角标就再开一个
    // （之前连续点不同角标会堆出好几个 tab，右侧栏高度被挤乱、整个会话区跟着错位）。
    ctx.sidebarRight.openTab(CITE_TAB_KIND, { params: { chunkId: detail.chunkId, doc: detail.doc || '' }, revealIfOpened: true })
    return true
  } catch (e) {
    console.warn('[dsh-weknora] 右侧栏打开失败，退回面板:', e && e.message)
    return false
  }
}

function citeTabParams(props) {
  // 1) 刚刚点过角标：直接用内存里那份（最可靠，绕开 DSH 各版本 params 传递差异）
  if (PENDING_CITE && PENDING_CITE.chunkId) return PENDING_CITE
  // 2) 内存丢了（tab 在另一个渲染周期被重建、插件被热重载过）就读上次点击落下的那份
  try {
    var last = window.sessionStorage.getItem('dsh-weknora:last-cite')
    if (last) {
      var parsed = JSON.parse(last)
      if (parsed && parsed.chunkId) return parsed
    }
  } catch (e) { /* 忽略 */ }
  // 3) 兜底：从 tab 的 navigation snapshot 里取（刷新后恢复 tab 时用得到）
  try {
    var info = props && props.useTabInfo ? props.useTabInfo() : null
    var tab = info && info.tab
    var nav = tab && tab.navigation
    var snap = nav && typeof nav.getSnapshot === 'function' ? nav.getSnapshot() : nav
    return (snap && snap.params) || (tab && tab.params) || {}
  } catch (e) { return {} }
}

/** 右侧栏 tab 的标题：优先文件名 */
function CiteTabTitle(props) {
  var p = citeTabParams(props)
  return p.doc || '知识库原文'
}

/** 右侧栏 tab 的正文：整篇按分块渲染，命中段标黄 */
// ── 客户端 PDF 渲染（pdfjs 画 canvas，命中段叠黄框）──
var __pdfjs = null
function loadPdfjs() {
  if (__pdfjs) return __pdfjs
  var load = new Function('u', 'return import(u)')
  __pdfjs = load(API + '/pdfjs/pdf.mjs').then(function (mod) {
    try { mod.GlobalWorkerOptions.workerSrc = API + '/pdfjs/pdf.worker.mjs' } catch (e) { /* 忽略 */ }
    return mod
  })
  return __pdfjs
}

// ── 文本层定位 ─────────────────────────────────────────
// 移植自 WeKnora 前端 PdfSourceViewer.vue + sourceLocatorDom.ts：
// 黄块不是用 page.transform 手算出来的，而是把 pdfjs 的 TextLayer 渲染成真实
// DOM，再用 Range.getClientRects() 取浏览器排好版的矩形 —— 这样才和文字严丝合缝。
function normForMatch(text) {
  return String(text || '').normalize('NFC').replace(/\s+/g, '').toLowerCase()
}

function buildTextIndex(root) {
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  var nodes = []
  var text = ''
  var flat = ''
  var fmap = []
  var n = walker.nextNode()
  while (n) {
    var v = n.nodeValue || ''
    if (v) {
      var base = text.length
      nodes.push({ node: n, start: base })
      text += v
      for (var i = 0; i < v.length; i++) {
        var ch = v.charAt(i)
        if (/\s/.test(ch)) continue
        fmap.push(base + i)
        flat += ch.toLowerCase()
      }
    }
    n = walker.nextNode()
  }
  return { text: text, flat: flat, fmap: fmap, nodes: nodes }
}

function rangeAtOffset(idx, from, to) {
  if (!idx.nodes.length || from < 0 || to <= from) return null
  var a = idx.fmap[from]
  var b = idx.fmap[to - 1]
  if (a === undefined || b === undefined) return null
  function pointAt(off) {
    var lo = 0
    var hi = idx.nodes.length - 1
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1
      if (idx.nodes[mid].start <= off) lo = mid
      else hi = mid - 1
    }
    var e = idx.nodes[lo]
    var len = (e.node.nodeValue || "").length
    return { node: e.node, offset: Math.max(0, Math.min(len, off - e.start)) }
  }
  var from2 = pointAt(a)
  var to2 = pointAt(b + 1)
  if (!from2 || !to2) return null
  try {
    var r = document.createRange()
    r.setStart(from2.node, from2.offset)
    r.setEnd(to2.node, to2.offset)
    return r
  } catch (e) { return null }
}

// 同一行上的多个字形矩形合并成一条，避免黄块被切成碎片
function mergeRects(rects) {
  var out = []
  rects.forEach(function (r) {
    if (!r || r.width < 0.5 || r.height < 0.5) return
    var line = null
    for (var i = 0; i < out.length; i++) {
      var l = out[i]
      var ov = Math.min(l.top + l.height, r.top + r.height) - Math.max(l.top, r.top)
      var gap = Math.max(r.left - l.left - l.width, l.left - r.left - r.width)
      if (ov > Math.min(l.height, r.height) * 0.5 && gap <= Math.min(l.height, r.height) * 2) { line = l; break }
    }
    if (line) {
      var right = Math.max(line.left + line.width, r.left + r.width)
      var bottom = Math.max(line.top + line.height, r.top + r.height)
      line.left = Math.min(line.left, r.left)
      line.top = Math.min(line.top, r.top)
      line.width = right - line.left
      line.height = bottom - line.top
    } else {
      out.push({ left: r.left, top: r.top, width: r.width, height: r.height })
    }
  })
  return out
}

// 打开过的 PDF 文档留在内存里复用：反复点不同角标看同一份文档时，
// 不用每次都重新下载 + 解析（大文档这一步就是"打开原件极慢"的主因）。
// 只留最近 3 份，超出的销毁，别把内存吃光。
var PDF_DOCS = []
var PDF_DOC_LIMIT = 3

function loadPdfDoc(id) {
  for (var i = 0; i < PDF_DOCS.length; i++) {
    if (PDF_DOCS[i].id === id) {
      var hit = PDF_DOCS.splice(i, 1)[0]
      PDF_DOCS.push(hit)
      return hit.promise
    }
  }
  var promise = loadPdfjs().then(function (pdfjs) {
    if (!pdfjs) throw new Error('pdfjs 没加载上')
    return pdfjs.getDocument({ url: API + '/pdf?id=' + encodeURIComponent(id) }).promise
  })
  var entry = { id: id, promise: promise }
  PDF_DOCS.push(entry)
  while (PDF_DOCS.length > PDF_DOC_LIMIT) {
    var old = PDF_DOCS.shift()
    try {
      Promise.resolve(old.promise).then(function (d) { try { d.destroy() } catch (e) { /* 忽略 */ } },
        function () { /* 加载失败过，无需销毁 */ })
    } catch (e) { /* 忽略 */ }
  }
  return promise
}

function PdfView(props) {
  var id = props.id
  var wantPage = props.page || 0
  var needle = String(props.needle || '').replace(/\s+/g, '')
  var holder = React.useRef(null)
  var docRef = React.useRef(null)
  var wrapsRef = React.useRef([])
  var obsRef = React.useRef(null)
  var targetRef = React.useRef(wantPage || 1)
  targetRef.current = wantPage || targetRef.current
  var vs = React.useState({ loading: true, error: '', num: 0, cur: 1, ready: false })
  var s = vs[0], setS = vs[1]

  // 1) 打开文档
  React.useEffect(function () {
    var alive = true
    setS({ loading: true, error: '', num: 0, cur: 1, ready: false })
    loadPdfDoc(id).then(function (doc) {
      if (!alive) return
      docRef.current = doc
      setS({ loading: false, error: '', num: doc.numPages, cur: 1, ready: true })
    }).catch(function (e) {
      if (alive) setS({ loading: false, error: msg(e), num: 0, cur: 1, ready: false })
    })
    return function () {
      // 文档本体交给上面的 PDF_DOCS 缓存管理，这里只断开引用
      alive = false
      docRef.current = null
    }
  }, [id])

  // 2) 铺满所有页的占位块 → 滚到哪画到哪（滚轮翻页，不用上一页/下一页）
  React.useEffect(function () {
    var doc = docRef.current
    var box = holder.current
    if (!doc || !s.ready || !box) return undefined
    var alive = true
    var wraps = []
    var ratio = 1.414

    box.innerHTML = ''
    doc.getPage(1).then(function (p1) {
      if (!alive) return
      var base = p1.getViewport({ scale: 1 })
      if (base.width > 0) ratio = base.height / base.width
      build()
    }).catch(function () { if (alive) build() })

    function build() {
      if (!alive || !box) return
      var width = Math.max(300, (box.clientWidth || 560) - 16)
      var h = Math.round(width * ratio)
      for (var i = 0; i < s.num; i++) {
        var w = document.createElement('div')
        w.className = 'dsh-ima-pdfpage'
        w.style.width = width + 'px'
        w.style.height = h + 'px'
        w.setAttribute('data-page', String(i + 1))
        box.appendChild(w)
        wraps.push(w)
      }
      wrapsRef.current = wraps
      var target = Math.min(Math.max(1, targetRef.current || 1), s.num)
      if (target > 1 && wraps[target - 1]) {
        try { wraps[target - 1].scrollIntoView({ block: 'start' }) } catch (e) { /* 忽略 */ }
      }
      if (typeof IntersectionObserver === 'function') {
        var ob = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            var k = wraps.indexOf(en.target)
            if (en.isIntersecting) { draw(k); return }
            // 滚远的页把画布和文本层清掉：25 页全留着会吃掉大量内存，滚动也跟着卡
            if (Math.abs(k - (targetRef.current - 1)) > 6) unload(en.target)
          })
        }, { root: box, rootMargin: '240px 0px' })
        wraps.forEach(function (w) { ob.observe(w) })
        obsRef.current = ob
      } else {
        wraps.forEach(function (_, i) { draw(i) })
      }
      // 命中页和它的前一页先画出来，滚动到位时已经有内容
      draw(target - 1)
      draw(target - 2)
    }

    function unload(w) {
      if (!w || w.getAttribute('data-done') !== '1') return
      w.innerHTML = ''
      w.removeAttribute('data-done')
    }

    function draw(idx) {
      var wrap = wraps[idx]
      var doc2 = docRef.current
      if (!wrap || !doc2 || wrap.getAttribute('data-done') === '1') return
      wrap.setAttribute('data-done', '1')
      // 命中页先藏起来：等文本层算完、黄块落位，再和页面一起亮相，
      // 否则用户先看到一页白纸，几百毫秒后黄块才蹦出来
      var hitPageNow = needle ? Math.min(Math.max(1, targetRef.current || 1), s.num) : 0
      var hideUntilMarked = hitPageNow > 0 && idx + 1 === hitPageNow
      if (hideUntilMarked) wrap.style.visibility = 'hidden'
      doc2.getPage(idx + 1).then(function (page) {
        if (!alive || !wrap.isConnected) return null
        return loadPdfjs().then(function (pdfjs) {
          var base = page.getViewport({ scale: 1 })
          var width = Math.max(300, wrap.clientWidth || (box && box.clientWidth) || 560)
          var viewport = page.getViewport({ scale: width / base.width })
          var dpr = Math.min(1.5, window.devicePixelRatio || 1)
          wrap.style.height = Math.floor(viewport.height) + 'px'
          var canvas = document.createElement('canvas')
          canvas.className = 'dsh-ima-pdfcanvas'
          canvas.width = Math.floor(viewport.width * dpr)
          canvas.height = Math.floor(viewport.height * dpr)
          canvas.style.width = Math.floor(viewport.width) + 'px'
          canvas.style.height = Math.floor(viewport.height) + 'px'
          wrap.appendChild(canvas)
          var c2d = canvas.getContext('2d')
          c2d.scale(dpr, dpr)
          return page.render({ canvasContext: c2d, viewport: viewport }).promise.then(function () {
            if (!alive) return
            // 只有命中页需要文本层：其余页留一个 canvas 就够。
            // 每页都建文本层要排 700 多个 span，25 页就是一万八，卡在这里。
            var hitPage = Math.min(Math.max(1, targetRef.current || 1), s.num)
            if (!needle || idx + 1 !== hitPage) {
              if (hideUntilMarked) wrap.style.visibility = ''
              return
            }
            // 文本层必须先于高亮：黄块坐标全部来自它
            if (typeof pdfjs.TextLayer !== "function") {
              return page.getTextContent().then(function (tc) {
                if (alive && needle) marksItems(pdfjs, viewport, (tc && tc.items) || [], wrap)
              })
            }
            var textDiv = document.createElement("div")
            textDiv.className = "dsh-ima-tl"
            wrap.style.setProperty("--scale-factor", String(viewport.scale))
            wrap.appendChild(textDiv)
            var tl = new pdfjs.TextLayer({
              textContentSource: page.streamTextContent(),
              container: textDiv,
              viewport: viewport
            })
            return tl.render().then(function () {
              if (!alive || !needle || !textDiv.isConnected) return
              marks(pdfjs, viewport, wrap, textDiv)
            }).catch(function () {
              /* 文本层失败不影响看图 */
              if (hideUntilMarked) wrap.style.visibility = ''
            }).then(function () {
              if (hideUntilMarked) wrap.style.visibility = ''
            })
          })
        })
      }).catch(function () {
        /* 单页失败不影响其它页 */
        if (hideUntilMarked) wrap.style.visibility = ''
      })
    }

    function marksItems(pdfjs, viewport, items, wrap) {
      var list = items.filter(function (it) { return it && it.str })
      var full = ''
      var flat = ''
      var fmap = []
      var spans = []
      list.forEach(function (it) {
        var st = full.length
        full += it.str
        spans.push({ start: st, end: full.length, item: it })
        for (var c = 0; c < it.str.length; c++) {
          var ch = it.str[c]
          if (/\s/.test(ch)) continue
          fmap.push(st + c)
          flat += ch
        }
      })

      // PDF 里的文字常被拆成单元格 / 多行，整段精确匹配经常落空。
      // 先试整段；不行就把 needle 切成 10 字片段逐页找，找到几处标几处。
      var clean = String(needle || "").replace(/\s+/g, "")
      var pieces = []
      if (clean && flat.indexOf(clean) >= 0) {
        pieces.push(clean)
      } else {
        for (var i = 0; i < clean.length && pieces.length < 10; i += 8) {
          var seg = clean.slice(i, i + 10)
          if (seg.length < 8) break
          pieces.push(seg)
        }
      }
      if (!pieces.length) return

      var ranges = []
      pieces.forEach(function (pc) {
        var at = flat.indexOf(pc)
        while (at >= 0) {
          var fs = fmap[at]
          var fe = fmap[at + pc.length - 1]
          if (fs !== undefined && fe !== undefined) ranges.push({ start: fs, end: fe + 1 })
          at = flat.indexOf(pc, at + pc.length)
        }
      })
      if (!ranges.length) return

      spans.forEach(function (sp) {
        var hit = false
        for (var i = 0; i < ranges.length; i++) {
          if (sp.end > ranges[i].start && sp.start < ranges[i].end) { hit = true; break }
        }
        if (!hit) return
        var tx = pdfjs.Util.transform(viewport.transform, sp.item.transform)
        var hgt = (sp.item.height || 0) * viewport.scale
        if (!(hgt > 0)) hgt = Math.hypot(tx[2], tx[3]) || 12
        var w = Math.max(8, (sp.item.width || 0) * viewport.scale)
        var mark = document.createElement('div')
        mark.className = 'dsh-ima-pdfhl'
        mark.style.left = tx[4] + 'px'
        mark.style.top = (tx[5] - hgt) + 'px'
        mark.style.width = w + 'px'
        mark.style.height = hgt + 'px'
        wrap.appendChild(mark)
      })
    }

    function marks(pdfjs, viewport, wrap, layer) {
      var idx = buildTextIndex(layer)
      if (!idx.flat) return
      // 先把 chunk 里的图片占位 ![](resource://...) 去掉，它不会出现在 PDF 文字里
      var raw = String(needle || "").replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      var whole = normForMatch(raw)
      if (!whole) return
      var pieces = []
      if (idx.flat.indexOf(whole) >= 0) {
        pieces.push(whole)
      } else {
        // 整段匹配不上（分块可能跨页、或与 PDF 文字有细微差异）：按句找。
        // 句子通常完整躺在某一页里，比“只取开头 10 个字”能覆盖得多得多。
        var parts = raw.split(/[。；！？\n\r]+/)
        var hitAny = false
        parts.forEach(function (pt) {
          var chunks = pt.length > 80 ? pt.split(/[，,、]+/) : [pt]
          chunks.forEach(function (cn) {
            var s2 = normForMatch(cn)
            if (s2.length < 8) return
            if (s2.length > 240) {
              for (var k = 0; k < s2.length; k += 120) pieces.push(s2.slice(k, k + 140))
            } else {
              pieces.push(s2)
            }
            if (idx.flat.indexOf(s2) >= 0) hitAny = true
          })
        })
        if (!hitAny) {
          // 连句子都对不上（表格被拆成单元格等），退化成 12 字滑窗
          pieces = []
          for (var i = 0; i < whole.length && pieces.length < 24; i += 6) {
            var seg = whole.slice(i, i + 12)
            if (seg.length < 8) break
            pieces.push(seg)
          }
        }
        pieces = pieces.filter(function (pc) { return idx.flat.indexOf(pc) >= 0 })
      }
      if (!pieces.length) return
      var pageBox = wrap.getBoundingClientRect()
      if (!pageBox.width || !pageBox.height) return
      var seen = []
      pieces.forEach(function (pc) {
        var at = idx.flat.indexOf(pc)
        while (at >= 0) {
          var range = rangeAtOffset(idx, at, at + pc.length)
          if (range) {
            var rs = mergeRects([].slice.call(range.getClientRects()))
            rs.forEach(function (r) {
              if (r.width < 1 || r.height < 1) return
              for (var k = 0; k < seen.length; k++) {
                var sn = seen[k]
                if (Math.abs(sn.left - r.left) < 2 && Math.abs(sn.top - r.top) < 2) return
              }
              seen.push(r)
              var mark = document.createElement("div")
              mark.className = "dsh-ima-pdfhl"
              mark.style.left = ((r.left - pageBox.left) / pageBox.width * 100) + "%"
              mark.style.top = ((r.top - pageBox.top) / pageBox.height * 100) + "%"
              mark.style.width = (r.width / pageBox.width * 100) + "%"
              mark.style.height = (r.height / pageBox.height * 100) + "%"
              wrap.appendChild(mark)
            })
          }
          at = idx.flat.indexOf(pc, at + pc.length)
        }
      })
    }

    return function () {
      alive = false
      var ob = obsRef.current
      obsRef.current = null
      if (ob) { try { ob.disconnect() } catch (e) { /* 忽略 */ } }
    }
  }, [s.ready, s.num, id, needle])

  // 3) 页码跟着滚动走（右下角浮着，不占版面）
  React.useEffect(function () {
    var box = holder.current
    if (!box) return undefined
    function onScroll() {
      var wraps = wrapsRef.current
      if (!wraps.length) return
      var top = box.getBoundingClientRect().top
      var cur = 1
      for (var i = 0; i < wraps.length; i++) {
        var r = wraps[i].getBoundingClientRect()
        if (r.top - top <= 40) cur = i + 1
      }
      setS(function (old) { return old.cur === cur ? old : Object.assign({}, old, { cur: cur }) })
    }
    box.addEventListener('scroll', onScroll, { passive: true })
    return function () { box.removeEventListener('scroll', onScroll) }
  }, [s.ready])

  return h('div', { className: 'dsh-ima-pdf' },
    s.error ? h('div', { className: 'dsh-ima-err' }, s.error) : null,
    s.loading ? h('div', { className: 'dsh-ima-note' }, '正在打开原件…') : null,
    h('div', { className: 'dsh-ima-pdfbox', ref: holder }),
    s.num ? h('div', { className: 'dsh-ima-pdfno dsh-ima-pdfno-float' }, s.cur + ' / ' + s.num) : null)
}

function ReaderFrame(props) {
  var kbId = props.kbId || ''
  var name = props.name || ''
  var qs = 'topic=' + encodeURIComponent(kbId) + '&name=' + encodeURIComponent(name)
  if (props.page) qs += '&page=' + props.page
  if (props.needle) qs += '&q=' + encodeURIComponent(String(props.needle).slice(0, 200))
  return h('iframe', {
    className: 'dsh-ima-reader-frame',
    src: API + '/reader?' + qs,
    title: name || '原件预览',
  })
}

function CiteTabBody(props) {
  var p = citeTabParams(props)
  // 这条 tab 会被复用：同一个 kind 再 openTab 时 DSH 不一定重新挂载组件，
  // 所以 chunkId 必须是 state，并订阅「角标被点」事件来换内容 —— 否则用户点了新角标，
  // 组件还端着第一次挂载时那份空参数，一直显示「没有传到 chunk id」。
  var cidSt = React.useState(p.chunkId || '')
  var chunkId = cidSt[0], setChunkId = cidSt[1]
  var docSt = React.useState(doc || '')
  var doc = docSt[0], setDoc = docSt[1]
  React.useEffect(function () {
    function onOpen(ev) {
      var d = ev && ev.detail
      if (d && d.chunkId) { setChunkId(String(d.chunkId)); setDoc(String(d.doc || '')) }
    }
    window.addEventListener('dsh-weknora:open-cite', onOpen)
    return function () { window.removeEventListener('dsh-weknora:open-cite', onOpen) }
  }, [])
  var st = React.useState({ loading: true, error: '', doc: doc, items: [], focusId: chunkId })
  var s = st[0], setS = st[1]
  // 侧边栏默认就用 PDF 原件（LibreOffice 转出来的排版），需要复制文字时才切「看文本」
  var ob = React.useState(true); var officeOn = ob[0], setOfficeOn = ob[1]
  // 命中段在 PDF 的第几页 —— 拿到后给 iframe 加 #page=N，直接翻过去
  var pg = React.useState(0); var page = pg[0], setPage = pg[1]
  var rd = React.useState(false); var pageReady = rd[0], setPageReady = rd[1]

  React.useEffect(function () {
    var alive = true
    if (!chunkId) { setS({ loading: false, error: '没有传到 chunk id', doc: doc || '', items: [], focusId: '' }); return function () {} }
    setS({ loading: true, error: '', doc: doc || '', items: [], focusId: chunkId })
    api('/chunk?id=' + encodeURIComponent(chunkId)).then(function (r) {
      if (!alive) return null
      if (!r || !r.ok) throw new Error((r && r.message) || '取不到这段原文')
      var kid = r.knowledge_id || ''
      var kbId = r.knowledge_base_id || ''
      return api('/text?id=' + encodeURIComponent(kid) + '&kbId=' + encodeURIComponent(kbId)).then(function (t) {
        if (!alive) return
        var items = (t && (t.items || t.chunks)) || []
        if (!Array.isArray(items)) items = []
        setS({
          loading: false,
          error: '',
          doc: doc || (t && t.title) || '',
          items: items,
          focusId: chunkId,
          knowledgeId: kid,
          kbId: kbId,
        })
      })
    }).catch(function (e) {
      if (alive) setS({ loading: false, error: msg(e), doc: doc || '', items: [], focusId: chunkId })
    })
    return function () { alive = false }
  }, [chunkId])

  React.useEffect(function () {
    if (s.loading) return
    var box = document.querySelector('.dsh-ima-citetab .dsh-ima-hl')
    if (box && box.scrollIntoView) {
      try { box.scrollIntoView({ block: 'center' }) } catch (e) { /* 忽略 */ }
    }
  }, [s.loading, s.focusId])

  // 原件模式下问一下命中段在第几页（服务端用 pdfjs 逐页抽文本定位）
  React.useEffect(function () {
    if (!officeOn || !s.knowledgeId) { setPageReady(true); return undefined }
    var alive = true
    setPageReady(false)
    api('/pdfpage?id=' + encodeURIComponent(s.knowledgeId) + '&chunk=' + encodeURIComponent(chunkId))
      .then(function (r) { if (alive && r && r.ok && r.page) setPage(r.page) })
      .catch(function () { /* 定位失败就从第一页看 */ })
      .then(function () { if (alive) setPageReady(true) })
    return function () { alive = false }
  }, [officeOn, s.knowledgeId, chunkId])

  if (s.loading) return h('div', { className: 'dsh-ima-citetab' }, h('div', { className: 'dsh-ima-note' }, '正在取原文…'))
  if (s.error) return h('div', { className: 'dsh-ima-citetab' }, h('div', { className: 'dsh-ima-err' }, s.error))

  var body = s.items.length
    ? s.items.map(function (c, i) {
      var hit = c.id === s.focusId
      return h('div', {
        className: 'dsh-ima-chunk' + (hit ? ' dsh-ima-hl' : ''),
        key: c.id || ('p' + i),
      }, renderMarkdown(fixResourceUrls(c.content || '', s.kbId)))
    })
    : h('div', { className: 'dsh-ima-note' }, '这篇没有分块正文')

  var hitItem = null
  s.items.forEach(function (c) { if (c.id === s.focusId) hitItem = c })
  var hitIdx = hitItem ? s.items.indexOf(hitItem) + 1 : 0
  var kbOfCite = (hitItem && hitItem.knowledge_base_id) || s.kbId || ''

  // 定位没成功时不传 needle：宁可不标黄，也不要停在第一页乱标一屏黄框
  var located = page > 0
  return h('div', { className: 'dsh-ima-citetab' },
    h('div', { className: 'dsh-ima-citetab-h' },
      h(FileTypeIcon, { type: extOf(s.doc || '') }),
      h('span', { className: 'dsh-ima-citetab-t', title: s.doc }, s.doc || '原文'),
      h('span', { className: 'dsh-ima-spacer' }),
      s.knowledgeId && OFFICE_TYPES[extOf(s.doc || '')]
        ? h('button', {
          className: 'dsh-ima-btn' + (officeOn ? ' dsh-ima-actbtn-on' : ''),
          title: officeOn ? '切到分块文本（可复制）' : '用 LibreOffice 原件排版打开',
          onClick: function () { setOfficeOn(!officeOn) },
        }, officeOn ? '看文本' : '原件')
        : null,
      h('span', { className: 'dsh-ima-badge' }, s.items.length + ' 段'),
      h('button', {
        className: 'dsh-ima-x',
        title: '关闭原文（收起右侧栏）',
        onClick: function () { closeCiteTab() },
      }, '✕'),
    ),
    officeOn && s.knowledgeId
      ? h('div', { className: 'dsh-ima-citetab-b dsh-ima-nos' },
          !pageReady
            ? h('div', { className: 'dsh-ima-note' }, '正在定位原文所在页…')
            : h(PdfView, {
              id: s.knowledgeId,
              page: located ? page : 0,
              needle: located && hitItem ? String(hitItem.content || '') : '',
            }))
      : h('div', { className: 'dsh-ima-citetab-b' }, body),
  )
}

// ── 会话里的工具卡片：订阅宿主推来的增量，边生成边显示 ──
function LiveAnswer(props) {
  var vs = React.useState({ text: '', done: false, err: '', started: Date.now() })
  var s = vs[0], setS = vs[1]
  var boxRef = React.useRef(null)
  var liveKey = ''
  try {
    var a = props && props.args
    if (!a && props && props.block) a = props.block.args
    if (typeof a === 'function') a = a()
    if (a && typeof a.text === 'function') {
      var q = a.text('query')
      if (q) liveKey = q
    } else if (a && typeof a.query === 'string') {
      liveKey = a.query
    }
  } catch (e) { /* 拿不到参数就订阅最近一次 */ }

  // 工具卡片默认是折起来的，这里挂载后立刻展开，用户才能看到正文在长出来
  var udHook = (props && props.useDisclosure) || null
  var disc = udHook ? udHook() : null
  React.useEffect(function () {
    if (disc && disc.expanded !== true) {
      try { disc.toggle() } catch (e) { /* 展开失败就保持原状 */ }
    }
  }, [])

  React.useEffect(function () {
    var es = new EventSource(API + '/live' + (liveKey ? '?k=' + encodeURIComponent(liveKey) : ''))
    logDiag('live-es', { k: liveKey || '' })
    es.onopen = function () { logDiag('live-open', { k: liveKey || '' }) }
    var __msgN = 0
    var alive = true
    es.onmessage = function (ev) {
      if (!alive) return
      var d
      try { d = JSON.parse(ev.data) } catch (e) { return }
      if (d.type === 'init') {
        setS(function (old) { return { text: d.text || old.text, done: !!d.done, err: d.error || '', started: old.started } })
        if (d.done) es.close()
      } else if (d.type === 'chunk') {
        setS(function (old) {
          return { text: old.text + (d.text || ''), done: false, err: '', started: old.started }
        })
      } else if (d.type === 'done') {
        logDiag('live-done', { k: liveKey || '', chars: (d.text || '').length })
        setS(function (old) { return { text: old.text, done: true, err: old.err, started: old.started } })
        es.close()
        // 生成结束时编号表才是全的：立刻拉一次并装饰，别等 4 秒轮询
        fetchCiteLedger('').then(function () {
          try { decorateCiteMarks() } catch (e) { /* 忽略 */ }
        })
      } else if (d.type === 'empty') {
        es.close()
      }
    }
    es.onerror = function () { logDiag('live-error', { k: liveKey || '', msgN: __msgN }); /* 断了就断了，卡片上还有最终答案 */ }
    return function () { alive = false; try { es.close() } catch (e) { /* 忽略 */ } }
  }, [liveKey])

  React.useEffect(function () {
    var el = boxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [s.text])

  var secs = Math.max(0, Math.round((Date.now() - s.started) / 1000))
  // 兜底：如果实时流没接上（比如宿主没把 /live 转发过来），就直接渲染工具结果里的正文，
  // 保证「直出」模式下答案一定看得见。
  var fallbackText = ''
  try {
    var blk = props && (props.block || props)
    var ct = blk && blk.content
    if (typeof ct === 'string') fallbackText = ct
    else if (Array.isArray(ct)) {
      fallbackText = ct.map(function (x) {
        return typeof x === 'string' ? x : ((x && (x.text || x.content)) || '')
      }).join('')
    } else if (ct && typeof ct.text === 'string') fallbackText = ct.text
  } catch (e) { fallbackText = '' }

  var body
  if (!s.text) {
    body = fallbackText
      ? renderMarkdown(fallbackText, { onCite: function (kv) { openCiteDetailFromEvent(kv) } })
      : h('div', { className: 'dsh-ima-live-wait' }, s.done ? '（这次没有拿到内容）' : '正在检索并生成…')
  } else {
    body = renderMarkdown(s.text, { onCite: function (kv) { openCiteDetailFromEvent(kv) } })
  }
  return h('div', { className: 'dsh-ima-live' },
    h('div', { className: 'dsh-ima-live-h' },
      h('span', { className: 'dsh-ima-live-dot' + (s.done ? ' dsh-ima-live-dot-off' : '') }),
      h('span', null, s.done ? ('已生成 · ' + (s.text.length || 0) + ' 字') : ('生成中… ' + secs + ' 秒')),
      s.err ? h('span', { className: 'dsh-ima-live-err' }, s.err) : null),
    h('div', { className: 'dsh-ima-live-b', ref: boxRef }, body))
}

// 卡片里的角标点击（没有 ctx 时退回右侧栏 tab 的全局事件）
function openCiteDetailFromEvent(detail) {
  try {
    if (__wkCtx) { openCiteDetail(__wkCtx, detail); return }
    window.dispatchEvent(new CustomEvent('dsh-weknora:open-cite', { detail: detail }))
  } catch (e) { /* 忽略 */ }
}

function registerLiveView(ctx) {
  try {
    if (!ctx || !ctx.slots) return false
    // 工具名在不同版本里可能带插件命名空间，两个 key 都注册一遍，
    // 命中哪个都能接管，没命中的那个永远不渲染，没有副作用。
    var keys = ['weknora_panel_ask', 'dsh-weknora-panel/weknora_panel_ask']
    keys.forEach(function (k) {
      ctx.slots.inject('tool.call.toolview', function () {
        return ctx.slots.register({ name: 'tool.call.toolview', key: k }, LiveAnswer)
      })
    })
    console.log('[dsh-weknora] 会话内工具卡片已接管 weknora_panel_ask')
    return true
  } catch (e) {
    console.warn('[dsh-weknora] 工具卡片注册失败（不影响其它功能）:', e)
    return false
  }
}

function registerCiteTab(ctx) {
  try {
    if (!ctx.sidebarRightTabs || !ctx.sidebarRight) {
      console.warn('[dsh-weknora] 没有 sidebarRight / sidebarRightTabs，角标只开面板')
      return false
    }
    ctx.effect(function () {
      return ctx.sidebarRightTabs.register({
        id: CITE_TAB_ID,
        kind: CITE_TAB_KIND,
        priority: 'extension',
        title: function () { return '知识库原文' },
      })
    }, 'dsh-weknora: cite tab type')
    ctx.effect(function () {
      return ctx.slots.inject('sidebar.right.pane.tab', function () {
        return ctx.slots.register({ name: 'sidebar.right.pane.tab', key: CITE_TAB_ID }, CiteTabBody)
      })
    }, 'dsh-weknora: cite tab body')
    ctx.effect(function () {
      return ctx.slots.inject('sidebar.right.pane.tab.title', function () {
        return ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: CITE_TAB_ID }, CiteTabTitle)
      })
    }, 'dsh-weknora: cite tab title')
  } catch (e) {
    console.warn('[dsh-weknora] 右侧栏原文 tab 注册失败，角标退回面板:', e && e.message)
    return false
  }
  console.log('[dsh-weknora] 右侧栏原文 tab 已注册 kind=' + CITE_TAB_KIND)
  return true
}

function apply(ctx) {
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
  QaPanel: QaPanel,
  WeKnoraPage: WeKnoraPage,
  SetupDialog: SetupDialog,
  bindCiteLinks: bindCiteLinks,
  decorateCiteMarks: decorateCiteMarks,
  citeTabParams: citeTabParams, openCiteDetail: openCiteDetail,
  CiteTabBody: CiteTabBody, openCiteInSidebar: openCiteInSidebar,
  setLedger: function (cites) { CITE_LEDGER = { cites: cites || [], at: Date.now() } },
  css: CSS,
}
