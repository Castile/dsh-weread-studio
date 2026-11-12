/**
 * dsh-weread — client half.
 *
 * 微信读书 Studio — two entry points onto one five-tab surface:
 *
 *  - a left-rail row (`sidebar.panellist`) paired with a centre panel
 *    (`main`, keyed by the same id) that takes over the main column, and
 *  - the original right-sidebar tab type ("微信读书") with its guide entry,
 *    which stays registered and usable.
 *
 * Both render 在读 / 书架 / 书城 / 笔记 / 设置 from the same components, plus a
 * local library (imported epub/txt) and an in-panel reader that paints the
 * account's highlights onto the chapter text. Every value comes from the host
 * half over the plugin's own `/weread` channel, so the panel and the agent
 * tools read the same state.
 *
 * The browser artifact is the hand-written loader format DSH expects: a
 * factory registered under the package name, with `react` taken from the
 * page's module table.
 */

window.__ModuleLoader__.load({
  id: 'dsh-weread-studio',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Identity of this tab type; also the key its body registers under. */
    const TAB_ID = 'weread-studio'
    /** The kind a caller names to open this page. */
    const TAB_KIND = 'weread'
    /** The sidebar tab kind the shipped Browser plugin registers. */
    const BROWSER_KIND = 'browser'
    /** Where a user collects an agent API key. */
    const API_KEY_URL = 'https://weread.qq.com/r/weread-skills'

    const CSS = [
      '.wr-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}',
      '.wr-tabs{display:flex;align-items:center;gap:2px;padding:6px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none}',
      '.wr-tab{border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:3px 9px;border-radius:var(--dsw-radius-sm,6px);cursor:pointer;font:inherit;font-size:12px}',
      '.wr-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.wr-tab[data-active="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.wr-spacer{flex:auto}',
      '.wr-icon{width:22px;height:22px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:var(--dsw-radius-sm,6px);cursor:pointer}',
      '.wr-icon:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.wr-body{flex:auto;min-height:0;overflow:auto;padding:10px}',
      '.wr-muted{color:var(--dsw-alias-label-secondary)}',
      '.wr-faint{color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.wr-card{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);padding:10px 12px;margin-bottom:8px;background:var(--dsw-alias-bg-layer-2)}',
      '.wr-title{margin:0 0 2px;font-weight:600;font-size:14px;line-height:20px}',
      '.wr-row{display:flex;gap:10px;align-items:flex-start}',
      '.wr-cover{width:46px;height:62px;object-fit:cover;border-radius:var(--dsw-radius-xs,4px);flex:none;background:var(--dsw-alias-bg-layer-1)}',
      '.wr-coverFlat{width:46px;height:62px;border-radius:var(--dsw-radius-xs,4px);flex:none;background:var(--dsw-alias-bg-layer-1)}',
      '.wr-progress{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;margin:7px 0 4px}',
      '.wr-progressFill{height:100%;background:var(--dsw-alias-brand-primary)}',
      '.wr-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
      '.wr-btn{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-sm,6px);padding:3px 10px;font:inherit;font-size:12px;cursor:pointer}',
      '.wr-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.wr-btnPrimary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1)}',
      '.wr-btnPrimary:hover{opacity:.9;background:var(--dsw-alias-brand-primary)}',
      '.wr-input{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);color:var(--dsw-alias-label-primary);padding:5px 8px;font:inherit;font-size:12px}',
      '.wr-input:focus{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:-1px}',
      '.wr-field{margin-bottom:8px}',
      '.wr-label{display:block;margin-bottom:4px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.wr-error{color:var(--dsw-alias-state-error-primary);font-size:12px;margin:6px 0 0;white-space:pre-wrap;word-break:break-word}',
      '.wr-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;margin:6px 0 0}',
      '.wr-warn{color:var(--dsw-alias-state-warn-primary);font-size:12px;margin:6px 0 0}',
      '.wr-list{list-style:none;margin:0;padding:0}',
      '.wr-item{padding:8px 10px;border-radius:var(--dsw-radius-sm,6px);cursor:pointer;border:.5px solid transparent}',
      '.wr-item:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.wr-quote{margin:6px 0;padding-left:9px;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
      '.wr-thought{margin:6px 0;padding:6px 9px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2)}',
      '.wr-chapter{margin:14px 0 6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
      '.wr-empty{padding:26px 14px;text-align:center;color:var(--dsw-alias-label-secondary)}',
      '.wr-steps{margin:6px 0 0;padding-left:18px;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.wr-steps li{margin:3px 0}',
      '.wr-sep{height:.5px;background:var(--dsw-alias-border-l1);margin:10px 0}',
      '.wr-tag{display:inline-block;padding:0 5px;border-radius:var(--dsw-radius-xs,4px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px;margin-left:5px}',
      '.wr-preview{white-space:pre-wrap;word-break:break-word;max-height:84px;overflow:hidden}',
      '.wr-toggle{display:flex;align-items:center;gap:7px;margin-top:8px;font-size:12px;cursor:pointer;color:var(--dsw-alias-label-primary)}',
      '.wr-toggle input{accent-color:var(--dsw-alias-brand-primary);cursor:pointer}',
      '.wr-reader{position:relative;display:flex;flex-direction:column;height:100%;min-height:0}',
      '.wr-readerBar{display:flex;align-items:center;gap:4px;padding:6px 8px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none;flex-wrap:wrap}',
      '.wr-readerMeta{font-size:11px;color:var(--dsw-alias-label-secondary);flex:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wr-readerBody{flex:auto;min-height:0;overflow:auto;padding:16px 18px 48px}',
      '.wr-readerText{white-space:pre-wrap;word-break:break-word;color:inherit}',
      '.wr-theme-follow{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}',
      '.wr-theme-light{background:#ffffff;color:#1c1c1e}',
      '.wr-theme-dark{background:#15171a;color:#c9ced3}',
      '.wr-theme-sepia{background:#f7f1e3;color:#3b3226}',
      '.wr-appearance{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:6px 10px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none}',
      '.wr-appearanceLabel{font-size:11px;color:var(--dsw-alias-label-secondary);margin-left:2px}',
      '.wr-chip{border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-family:inherit;cursor:pointer}',
      '.wr-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.wr-chip[data-on="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.wr-readerText p{margin:0 0 .95em}',
      '.wr-panelInner .wr-readerBody,.wr-panelReader .wr-readerBody{padding:26px clamp(18px,7vw,110px) 64px}',
      '.wr-panelReader .wr-readerBar{padding:8px 10px}',
      '.wr-readerText{max-width:720px;margin:0 auto}',
      '.wr-catalog{max-height:46%;overflow:auto;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none;padding:6px}',
      '.wr-catalogItem{padding:4px 8px;border-radius:var(--dsw-radius-sm,6px);cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.wr-catalogItem:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.wr-catalogItem[data-active="true"]{color:var(--dsw-alias-brand-primary)}',
      '.wr-qr{width:180px;height:180px;margin:8px auto;display:block;background:#fff;padding:8px;border-radius:8px}',
      '.wr-qr svg{width:100%;height:100%;display:block}',
      '.wr-banner{display:flex;align-items:center;gap:8px;padding:8px 10px;margin:8px 10px 0;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-state-warn-bg,rgba(180,120,20,.12));color:var(--dsw-alias-state-warn-primary);font-size:12px}',
      '.wr-bannerActions{margin-left:auto;flex:none}',
      '.wr-filters{display:flex;align-items:center;gap:4px;margin-bottom:10px;flex-wrap:wrap}',
      '.wr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:12px 8px;padding:2px 0 12px}',
      '.wr-coverCard{display:flex;flex-direction:column;gap:6px;cursor:pointer;border:0;background:transparent;padding:0;text-align:left;color:inherit;font:inherit}',
      '.wr-coverCard:hover .wr-coverHero{box-shadow:0 6px 16px rgba(0,0,0,.18)}',
      '.wr-coverHero{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:4px 6px 6px 4px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 4px rgba(0,0,0,.12);display:block}',
      '.wr-coverHeroFlat{width:100%;aspect-ratio:3/4;border-radius:4px 6px 6px 4px;background:linear-gradient(165deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-1));box-shadow:0 1px 4px rgba(0,0,0,.08)}',
      '.wr-coverMeta{min-width:0}',
      '.wr-coverTitle{font-size:11px;line-height:14px;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.wr-continue{padding:14px 14px 12px}',
      '.wr-continueCover{width:72px;height:96px;object-fit:cover;border-radius:4px 8px 8px 4px;flex:none;background:var(--dsw-alias-bg-layer-1);box-shadow:0 4px 12px rgba(0,0,0,.16)}',
      '.wr-continueCoverFlat{width:72px;height:96px;border-radius:4px 8px 8px 4px;flex:none;background:var(--dsw-alias-bg-layer-1)}',
      '.wr-dock{flex:none;padding:6px 10px 10px;border-top:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}',
      '.wr-dockRow{display:flex;align-items:center;gap:8px;margin-top:4px}',
      '.wr-panel{display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}',
      '.wr-panelScroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden}',
      '.wr-panelInner{width:100%;box-sizing:border-box;max-width:960px;margin:0 auto;padding:24px clamp(20px,3vw,40px) 40px}',
      '.wr-panelTitle{margin:0;font-size:19px;line-height:26px;font-weight:650;letter-spacing:.01em}',
      '.wr-section{display:flex;align-items:center;gap:8px;margin:4px 0 10px}',
      '.wr-sectionTitle{margin:0;font-size:14px;font-weight:650}',
      '.wr-sectionHint{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.wr-shelfGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:18px 14px;padding:2px 0 16px}',
      '.wr-localGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px}',
      '.wr-localCard{display:flex;flex-direction:column;gap:3px;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2)}',
      '.wr-localHead{display:flex;align-items:baseline;gap:6px;min-width:0}',
      '.wr-localTitle{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wr-localMeta{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.wr-localActions{display:flex;gap:6px;margin-top:7px}',
      '.wr-drop{display:flex;flex-direction:column;align-items:center;gap:6px;padding:18px;border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.7;cursor:pointer;text-align:center}',
      '.wr-drop:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}',
      '.wr-mark{border-radius:2px;padding:0 .5px;-webkit-box-decoration-break:clone;box-decoration-break:clone;color:inherit}',
      '.wr-mark[data-color="0"]{background:#ffd54f}',
      '.wr-mark[data-color="1"]{background:#ff8a80}',
      '.wr-mark[data-color="2"]{background:#80d8ff}',
      '.wr-mark[data-color="3"]{background:#b9f6ca}',
      '.wr-mark[data-color="4"]{background:#d1c4e9}',
      '.wr-theme-dark .wr-mark[data-color="0"]{background:rgba(255,213,79,.25);box-shadow:inset 0 2px 0 #ffd54f}',
      '.wr-theme-dark .wr-mark[data-color="1"]{background:rgba(255,138,128,.25);box-shadow:inset 0 2px 0 #ff8a80}',
      '.wr-theme-dark .wr-mark[data-color="2"]{background:rgba(128,216,255,.25);box-shadow:inset 0 2px 0 #80d8ff}',
      '.wr-theme-dark .wr-mark[data-color="3"]{background:rgba(185,246,202,.25);box-shadow:inset 0 2px 0 #b9f6ca}',
      '.wr-theme-dark .wr-mark[data-color="4"]{background:rgba(209,196,233,.25);box-shadow:inset 0 2px 0 #d1c4e9}',
      '.wr-markFocus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.wr-noteDot{display:inline-block;width:6px;height:6px;margin:0 2px 0 3px;padding:0;border:0;border-radius:50%;background:var(--dsw-alias-brand-primary);opacity:.55;cursor:pointer;vertical-align:super}',
      '.wr-noteDot:hover{opacity:1}',
      '.wr-notePop{position:absolute;right:14px;bottom:14px;z-index:20;max-width:min(380px,82%);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);box-shadow:0 8px 24px rgba(0,0,0,.18);padding:10px 12px;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-primary)}',
      '.wr-notePopText{white-space:pre-wrap;word-break:break-word;max-height:200px;overflow:auto;margin:2px 0 6px}',
      '.wr-marksDrawer{max-height:40%;overflow:auto;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none;padding:8px 10px;background:var(--dsw-alias-bg-layer-2)}',
      '.wr-marksItem{padding:5px 8px;border-radius:var(--dsw-radius-sm,6px);cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary);border:.5px solid transparent}',
      '.wr-marksItem:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}',
      '.wr-chapterEnd{display:flex;justify-content:center;padding:26px 0 8px}',
      '.wr-panelTabs{display:flex;align-items:center;gap:2px;padding:8px;padding-left:max(12px,calc((100% - 912px)/2));padding-right:max(12px,calc((100% - 912px)/2));border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none;flex-wrap:wrap;background:var(--dsw-alias-bg-base)}',
      '.wr-panelHeadRow{display:flex;align-items:baseline;gap:10px;margin:0 0 16px}',
      '.wr-panelHeadRow .wr-panelTitle{font-size:17px}',
      '.wr-panelHeadRow .wr-panelHint{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.wr-panelInner .wr-body{flex:none;min-height:0;overflow:visible;padding:0}',
      '.wr-panelReader{flex:auto;min-height:0;display:flex;flex-direction:column}',
      '.wr-panelReader>.wr-reader{flex:auto;min-height:0;height:auto}',
      '.wr-panelInner .wr-reader{height:100%}',
      '.wr-panelInner .wr-grid{grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:18px 14px}',
      '.wr-localBar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}',
      '.wr-notePopHead{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:2px}',
      '.wr-btn[data-on="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.wr-markList{max-height:34%;overflow:auto;flex:none;border-bottom:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}',
      '.wr-sidebarIcon{display:block}',
      '.wr-readerBody{position:relative}',
      '.wr-selBar{position:absolute;z-index:30;display:flex;align-items:center;gap:4px;padding:5px 6px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);box-shadow:0 8px 22px rgba(0,0,0,.2);font-size:12px;line-height:1.4;color:var(--dsw-alias-label-primary);white-space:nowrap}',
      '.wr-selBar .wr-btn{padding:3px 7px;font-size:12px;flex:none}',
      '.wr-dot{width:16px;height:16px;padding:0;border:1px solid rgba(0,0,0,.16);border-radius:50%;cursor:pointer;flex:none}',
      '.wr-dot[data-color="0"]{background:#ffd54f}',
      '.wr-dot[data-color="1"]{background:#ff8a80}',
      '.wr-dot[data-color="2"]{background:#80d8ff}',
      '.wr-dot[data-color="3"]{background:#b9f6ca}',
      '.wr-dot[data-color="4"]{background:#d1c4e9}',
      '.wr-dot[data-on="true"]{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary)}',
      '.wr-dot:disabled{opacity:.38;cursor:not-allowed}',
      '.wr-mark[data-hid]{cursor:pointer}',
      '.wr-menu{position:absolute;z-index:31;min-width:172px;padding:6px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);box-shadow:0 10px 26px rgba(0,0,0,.2);font-size:12px;color:var(--dsw-alias-label-primary)}',
      '.wr-menuRow{display:flex;align-items:center;gap:6px;padding:2px 4px 6px}',
      '.wr-menuItem{display:flex;align-items:center;gap:6px;width:100%;padding:5px 8px;border:0;background:none;border-radius:var(--dsw-radius-sm,6px);font-size:12px;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer}',
      '.wr-menuItem:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.wr-menuSep{height:.5px;margin:4px 0;background:var(--dsw-alias-border-l1)}',
      '.wr-markPop{position:absolute;right:auto;bottom:auto;z-index:22;max-width:min(400px,86%);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);box-shadow:0 8px 24px rgba(0,0,0,.18);padding:10px 12px;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-primary)}',
      '.wr-markPopText{white-space:pre-wrap;word-break:break-word;max-height:160px;overflow:auto;margin:4px 0 6px;padding-left:8px;border-left:3px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
      '.wr-markPopNote{white-space:pre-wrap;word-break:break-word;max-height:120px;overflow:auto;margin:0 0 6px;color:var(--dsw-alias-label-primary)}',
      '.wr-dictPop{position:absolute;right:auto;bottom:auto;z-index:23;max-width:min(420px,88%);max-height:62%;overflow:auto;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);box-shadow:0 8px 24px rgba(0,0,0,.18);padding:10px 12px;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-primary)}',
      '.wr-dictWord{font-size:15px;font-weight:600}',
      '.wr-dictPhonetic{font-size:11px;color:var(--dsw-alias-label-secondary);margin-left:6px}',
      '.wr-dictLine{margin:2px 0}',
      '.wr-dictSource{margin-top:6px;font-size:10px;color:var(--dsw-alias-label-secondary)}',
      '.wr-dictEmpty{color:var(--dsw-alias-label-secondary)}',
      '.wr-chatWrap{flex:auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
      '.wr-chatBar{display:flex;align-items:center;gap:8px;padding:6px 10px;flex:none;border-bottom:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.wr-chatBody{flex:auto;min-height:0;overflow:hidden;display:flex;flex-direction:column}',
      '.wr-chatEmpty{padding:18px 12px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.wr-split{flex:auto;min-height:0;display:flex;align-items:stretch}',
      '.wr-splitMain{flex:auto;min-width:0;min-height:0;display:flex;flex-direction:column}',
      '.wr-splitMain>.wr-reader{flex:auto;min-height:0;height:auto}',
      '.wr-splitSide{flex:none;width:min(430px,46%);min-height:0;display:flex;flex-direction:column;border-left:.5px solid var(--dsw-alias-border-l1)}',
    ].join('')

    // --- shared helpers ------------------------------------------------------

    /** One human-readable line for any thrown value. */
    function errorText(error) {
      if (error === null || error === undefined) return '未知错误'
      if (typeof error.message === 'string' && error.message.length > 0) return error.message
      return String(error)
    }

    /**
     * Call one host operation over the plugin's own `/api/weread` route.
     * The route carries a result envelope, so a business failure arrives as a
     * value and a carrier failure as a throw; both become one Error here.
     */
    async function callRemote(ctx, endpoint, payload, signal) {
      let response
      try {
        response = await fetch('/api/weread', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint, payload: payload || {} }),
          signal,
        })
      } catch (error) {
        throw new Error(`与宿主插件通信失败：${errorText(error)}`)
      }
      if (!response.ok) {
        throw new Error(
          response.status === 401 || response.status === 403
            ? '宿主插件拒绝了这次请求（浏览器会话未通过鉴权），请重新加载页面。'
            : `宿主插件返回 HTTP ${response.status}。`,
        )
      }
      let result
      try {
        result = await response.json()
      } catch {
        throw new Error('宿主插件返回了无法解析的响应。')
      }
      if (result !== null && result !== undefined && result.ok === true) return result.value
      const info = (result && result.error) || {}
      const failure = new Error(info.message || '宿主插件没有返回结果。')
      failure.code = info.code || 'weread/transport'
      throw failure
    }

    /** Run an async loader with loading/ready/error state and a manual reload. */
    function useLoader(loader, deps) {
      const [state, setState] = React.useState({ status: 'loading' })
      const [nonce, setNonce] = React.useState(0)
      const latest = React.useRef(loader)
      latest.current = loader
      const keys = deps === undefined ? [nonce] : [...deps, nonce]
      React.useEffect(() => {
        let cancelled = false
        setState((previous) => (previous.status === 'ready' ? previous : { status: 'loading' }))
        Promise.resolve()
          .then(() => latest.current())
          .then(
            (value) => {
              if (!cancelled) setState({ status: 'ready', value })
            },
            (error) => {
              if (!cancelled) setState({ status: 'error', error })
            },
          )
        return () => {
          cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, keys)
      const reload = React.useCallback(() => setNonce((value) => value + 1), [])
      return [state, reload]
    }

    /**
     * Reading appearance, mirrored from the host.
     *
     * These live in the plugin's own settings file rather than page storage,
     * so they survive an app restart and follow the profile.
     */
    const APPEARANCE_FALLBACK = { theme: 'follow', fontSize: 17, lineHeight: 1.9, fontFamily: 'system' }
    const THEME_LABELS = [
      ['follow', '跟随 DSH'],
      ['light', '浅色'],
      ['dark', '深色'],
      ['sepia', '羊皮纸'],
    ]
    const LINE_LABELS = [
      [1.5, '紧'],
      [1.9, '标准'],
      [2.3, '松'],
    ]
    const FAMILY_LABELS = [
      ['system', '默认'],
      ['serif', '宋体'],
      ['sans', '黑体'],
    ]
    const FAMILY_STACKS = {
      system: 'inherit',
      serif: "'Songti SC', 'SimSun', Georgia, serif",
      sans: "'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', sans-serif",
    }

    /** Progress bar with a numeric label. */
    function Progress(props) {
      const value = Math.max(0, Math.min(100, Number(props.value) || 0))
      return h(
        'div',
        null,
        h('div', { className: 'wr-progress' }, h('div', { className: 'wr-progressFill', style: { width: `${value}%` } })),
        h('div', { className: 'wr-faint' }, `阅读进度 ${value}%${props.hint ? ` · ${props.hint}` : ''}`),
      )
    }

    /** A cover that degrades to a flat block when the image cannot load. */
    function Cover(props) {
      const [failed, setFailed] = React.useState(false)
      const imageClass = props.variant === 'hero' ? 'wr-coverHero' : props.variant === 'continue' ? 'wr-continueCover' : 'wr-cover'
      const flatClass = props.variant === 'hero' ? 'wr-coverHeroFlat' : props.variant === 'continue' ? 'wr-continueCoverFlat' : 'wr-coverFlat'
      if (typeof props.src !== 'string' || props.src.length === 0 || failed) {
        return h('div', { className: flatClass })
      }
      return h('img', {
        className: imageClass,
        src: props.src,
        alt: '',
        loading: 'lazy',
        referrerPolicy: 'no-referrer',
        onError: () => setFailed(true),
      })
    }

    /**
     * Render a WeRead recommendation score: the service reports 0–1000 and
     * its own UI shows the same number as a 0–100% recommendation.
     */
    function formatRating(rating) {
      const value = Number(rating)
      if (!Number.isFinite(value)) return undefined
      return value > 100 ? `推荐值 ${(value / 10).toFixed(1)}%` : `推荐值 ${value}%`
    }

    /**
     * Turn the paragraph layout into a fraction of the chapter's text.
     *
     * The server derives the stored percentage from the reported position
     * rather than from the percentage we send, so the position is the part
     * worth getting right: a linear scroll fraction is badly wrong whenever
     * paragraphs differ in length, which in a Chinese book they always do.
     *
     * @param scrollTop - how far the reading surface is scrolled.
     * @param boxes - `{ top, height, start, length }` per paragraph, in order.
     */
    function measurePosition(scrollTop, boxes) {
      if (!Array.isArray(boxes) || boxes.length === 0) return 0
      let total = 0
      for (const box of boxes) total += box.length || 0
      if (total <= 0) return 0
      let chars = 0
      for (const box of boxes) {
        const height = box.height || 0
        const length = box.length || 0
        if (height > 0 && scrollTop < box.top + height) {
          const inside = scrollTop <= box.top ? 0 : (scrollTop - box.top) / height
          chars = box.start + length * Math.min(1, inside)
          break
        }
        chars = box.start + length
      }
      return Math.min(1, Math.max(0, chars / total))
    }

    /**
     * A reader that has not touched the page for this long is not reading.
     */
    const READING_IDLE_MS = 60_000
    /** Report accumulated reading time once this much has built up. */
    const READING_FLUSH_SECONDS = 120
    /** Below this, an automatic flush is not worth an account write. */
    const READING_MIN_SECONDS = 30
    /** How often the visible counter refreshes. */
    const READING_DISPLAY_MS = 15_000

    /**
     * Credit reading time for one tick.
     *
     * Wall-clock time is not reading time: the panel stays mounted while you
     * work elsewhere, and an open tab is not attention. WeRead's own reader
     * reports the same `rt` field, so a tick counts only when the page is
     * visible and the reader interacted inside the idle window.
     *
     * Pure, so the accounting is testable without timers or a DOM.
     *
     * @param state - `{ activeSeconds, lastCountedAt, lastInteractionAt }`.
     * @param now - the current clock.
     * @param visible - whether the page is visible.
     */
    function creditReadingTime(state, now, visible) {
      const elapsed = (now - state.lastCountedAt) / 1000
      const attentive = now - state.lastInteractionAt <= READING_IDLE_MS
      const credited = visible && attentive && elapsed > 0 ? elapsed : 0
      return { ...state, activeSeconds: state.activeSeconds + credited, lastCountedAt: now }
    }

    /**
     * Whether the reader is actually on screen.
     *
     * A mounted view is not a viewed one: DSH keeps this tab mounted while you
     * work elsewhere, so `document.visibilityState` stays "visible" and the
     * page keeps reporting interaction. Without this check the book accrues
     * reading time for as long as the tab is open.
     *
     * @param element - the reading surface.
     * @param viewport - the current viewport height.
     */
    function isOnScreen(element, viewport) {
      if (element === null || element === undefined) return false
      // A `display: none` ancestor leaves the element with no client rects.
      if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) return false
      if (typeof element.getBoundingClientRect !== 'function') return false
      const rect = element.getBoundingClientRect()
      if (!rect || rect.width <= 0 || rect.height <= 0) return false
      if (!(viewport > 0)) return false
      return rect.bottom > 0 && rect.top < viewport
    }

    /**
     * Which chapter a book should open at.
     *
     * Local and cloud positions are compared by recency. A report that has
     * not landed yet still wins, so reopening a book does not jump backwards.
     *
     * @param positions - remembered positions, keyed by book id.
     * @param bookId - the book being opened.
     * @param progress - WeRead's own progress record, or a chapterUid number.
     * @param firstUid - the first chapter with real text, as a last resort.
     */
    function resumeChapterUid(positions, bookId, progress, firstUid) {
      const remembered = positions === undefined || positions === null ? undefined : positions[String(bookId)]
      const localUid = remembered === undefined || remembered === null ? 0 : Number(remembered.chapterUid)
      const localAt = remembered === undefined || remembered === null ? 0 : Number(remembered.updatedAt) || 0
      const cloud =
        progress !== null && typeof progress === 'object'
          ? progress
          : Number.isFinite(Number(progress)) && Number(progress) > 0
            ? { chapterUid: Number(progress) }
            : undefined
      const cloudUid = Number(cloud?.chapterUid) || 0
      const cloudAt = (Number(cloud?.updateTime) || 0) * 1000
      if (localUid > 0 && (cloudUid <= 0 || localAt > cloudAt)) return localUid
      if (cloudUid > 0) return cloudUid
      return Number.isFinite(firstUid) && firstUid > 0 ? firstUid : 0
    }

    /** Seconds → a short Chinese duration label. */
    function formatReadingTime(seconds) {
      const value = Math.max(0, Math.floor(Number(seconds) || 0))
      if (value < 60) return value > 0 ? `${value} 秒` : ''
      const minutes = Math.round(value / 60)
      if (minutes < 60) return `${minutes} 分钟`
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      return rest > 0 ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
    }

    /** True when the panel should offer a one-tap re-login. */
    function isSessionError(error) {
      const code = error && error.code
      return code === 'weread/session-expired' || code === 'weread/needs-cookie'
    }

    /** The first chapter with real text: catalogs open with 封面/版权 entries. */
    function firstReadableChapterUid(chapters) {
      if (!Array.isArray(chapters) || chapters.length === 0) return 0
      const readable = chapters.find((chapter) => Number(chapter.wordCount) > 0)
      return (readable ?? chapters[0]).chapterUid
    }

    /** Standard loading / error / empty frame for one view. */
    function Loaded(props) {
      if (props.state.status === 'loading') {
        return h('div', { className: 'wr-empty' }, '正在读取微信读书数据…')
      }
      if (props.state.status === 'error') {
        const error = props.state.error
        const code = error && error.code
        const sessionExpired = code === 'weread/session-expired'
        const needsConfig =
          code === 'weread/needs-config' ||
          code === 'weread/bad-api-key' ||
          (code === 'weread/needs-cookie' && typeof props.onRelogin !== 'function')
        return h(
          'div',
          { className: 'wr-card' },
          h('div', { className: 'wr-title' }, sessionExpired ? '登录已过期' : needsConfig ? '还没有配置微信读书' : '读取失败'),
          h('p', { className: 'wr-error' }, errorText(error)),
          needsConfig
            ? h(
                'ol',
                { className: 'wr-steps' },
                h('li', null, '打开「设置」，用微信扫码登录'),
                h('li', null, '或粘贴已登录 weread.qq.com 的 Cookie'),
                h('li', null, '回到「在读」即可看到书架与进度'),
              )
            : null,
          h(
            'div',
            { className: 'wr-actions' },
            sessionExpired && typeof props.onRelogin === 'function'
              ? h('button', { className: 'wr-btn wr-btnPrimary', onClick: props.onRelogin }, '重新登录')
              : null,
            h('button', { className: 'wr-btn', onClick: props.reload }, '重试'),
          ),
        )
      }
      return props.render(props.state.value)
    }

    /** Setup instructions shown whenever credentials are missing. */
    function SetupHint(props) {
      return h(
        'div',
        { className: 'wr-card' },
        h('div', { className: 'wr-title' }, '让 DSH 连上你的微信读书'),
        h(
          'ol',
          { className: 'wr-steps' },
          h('li', null, '打开「设置」，用微信扫描二维码并确认'),
          h('li', null, '或从浏览器复制 weread.qq.com 的 Cookie（须含 wr_vid 与 wr_skey）'),
          h('li', null, '未登录时可以先读演示书，熟悉阅读器'),
        ),
        h(
          'div',
          { className: 'wr-actions' },
          h('button', { className: 'wr-btn wr-btnPrimary', onClick: props.onGoSettings }, '去设置'),
        ),
        h('p', { className: 'wr-faint' }, 'Cookie 只保存在本机，只发给 weread.qq.com。'),
      )
    }

    // --- 在读 -----------------------------------------------------------------

    function NowView(props) {
      const [state, reload] = useLoader(async () => {
        const current = await props.wrCall('current')
        if (current === null || current === undefined || current.book === undefined) {
          return { current: null }
        }
        let detail = null
        try {
          detail = await props.wrCall('book', { bookId: current.book.bookId })
        } catch {
          // The shelf entry is enough to render; book detail only adds links.
        }
        return { current, detail }
      })
      return h(
        'div',
        { className: 'wr-body' },
        h(
          Loaded,
          {
            state,
            reload,
            onRelogin: props.onRelogin,
            render: (value) =>
              value.current === null
                ? h(
                    'div',
                    { className: 'wr-empty' },
                    '书架上还没有在读的书。',
                    h(
                      'div',
                      { className: 'wr-actions', style: { justifyContent: 'center' } },
                      h('button', { className: 'wr-btn', onClick: () => props.wrGoShelf() }, '打开书架'),
                    ),
                  )
                : h(NowCard, {
                    data: value,
                    wrOpenReader: props.wrOpenReader,
                    wrGoNotes: props.wrGoNotes,
                    onRead: props.onRead,
                    readerReady: props.readerReady,
                    cookieReady: props.cookieReady,
                    positions: props.positions,
                    reload,
                  }),
          },
        ),
      )
    }

    function NowCard(props) {
      const { current, detail } = props.data
      const book = current.book
      const progress = current.progress
      const readerLink = detail === null || detail === undefined ? undefined : detail.readerLink
      const deepLink = detail === null || detail === undefined ? undefined : detail.deepLink
      const reading = progress !== undefined && progress !== null ? progress : undefined
      const chapters = detail !== null && detail !== undefined ? detail.chapters : []
      const firstChapterUid = firstReadableChapterUid(chapters)
      const chapterUid = resumeChapterUid(props.positions, book.bookId, reading, firstChapterUid)
      // A cloud chapter is decoded through the Cookie session, so an API key
      // alone cannot render it: offering the button would only produce an error.
      // The bundled demo book is the one exception, since its text ships locally.
      const demoBook = detail !== null && detail !== undefined && detail.demo === true
      const canReadInPanel =
        props.readerReady === true && chapterUid > 0 && (demoBook || props.cookieReady === true)
      const timeLabel = formatReadingTime(reading !== undefined ? reading.recordReadingTime : book.readingTime)
      return h(
        'div',
        { className: 'wr-card wr-continue' },
        h(
          'div',
          { className: 'wr-row' },
          h(Cover, {
            src: detail !== null && detail !== undefined && detail.cover ? detail.cover : book.cover,
            variant: 'continue',
          }),
          h(
            'div',
            { style: { minWidth: 0, flex: 'auto' } },
            h('div', { className: 'wr-faint' }, '继续阅读'),
            h('h3', { className: 'wr-title' }, `《${book.title}》`),
            book.author.length > 0 ? h('div', { className: 'wr-faint' }, book.author) : null,
            h(Progress, {
              value: reading !== undefined ? reading.progress : book.progress || 0,
              hint: [book.readUpdateDate !== undefined ? `上次 ${book.readUpdateDate}` : undefined, timeLabel ? `累计 ${timeLabel}` : undefined]
                .filter(Boolean)
                .join(' · '),
            }),
          ),
        ),
        h(
          'div',
          { className: 'wr-actions' },
          canReadInPanel
            ? h(
                'button',
                {
                  className: 'wr-btn wr-btnPrimary',
                  onClick: () => props.onRead({ bookId: book.bookId, chapterUid, firstChapterUid, title: book.title }),
                },
                '继续阅读',
              )
            : null,
          readerLink !== undefined
            ? h(
                'button',
                { className: canReadInPanel ? 'wr-btn' : 'wr-btn wr-btnPrimary', onClick: () => props.wrOpenReader(readerLink) },
                '官方阅读器',
              )
            : h(
                'button',
                { className: 'wr-btn', onClick: () => props.wrOpenReader('https://weread.qq.com/') },
                '打开微信读书',
              ),
          deepLink !== undefined
            ? h('button', { className: 'wr-btn', onClick: () => props.wrOpenReader(deepLink) }, '书籍详情')
            : null,
          h('button', { className: 'wr-btn', onClick: () => props.wrGoNotes(book) }, '看划线'),
          h('button', { className: 'wr-btn', onClick: props.reload }, '刷新'),
        ),
        h(
          'p',
          { className: 'wr-faint' },
          canReadInPanel
            ? '「在 DSH 里读」直接在面板里渲染正文；「官方阅读器」在 DSH 内置浏览器里打开微信读书官方页面。'
            : props.readerReady === true
              ? '云端正文要用 Cookie 解密：到「设置」里扫码或粘贴 Cookie 后就能在面板里直接读，现在可以用「官方阅读器」。'
              : '登录后即可在面板里直接读正文。',
        ),
      )
    }

    // --- 书架 -----------------------------------------------------------------

    function ShelfView(props) {
      const [selected, setSelected] = React.useState(null)
      const [state, reload] = useLoader(() => props.wrCall('shelf', { refresh: props.refresh === true }))
      if (selected !== null) {
        return h(BookDetail, {
          book: selected,
          wrCall: props.wrCall,
          wrOpenReader: props.wrOpenReader,
          onOpenNotes: props.onOpenNotes,
          onRead: props.onRead,
          readerReady: props.readerReady,
          cookieReady: props.cookieReady,
          positions: props.positions,
          onRelogin: props.onRelogin,
          onBack: () => setSelected(null),
        })
      }
      return h(
        'div',
        { className: 'wr-body' },
        h(
          'div',
          { className: 'wr-section' },
          h('h3', { className: 'wr-sectionTitle' }, '微信读书书架'),
          h('span', { className: 'wr-sectionHint' }, '来自你的微信读书账号，划线、想法随书同步'),
        ),
        h(Loaded, {
          state,
          reload,
          onRelogin: props.onRelogin,
          render: (shelf) => h(ShelfList, { shelf, onSelect: setSelected, reload }),
        }),
        h('div', { className: 'wr-sep' }),
        typeof props.wrCall === 'function'
          ? h(LocalLibrary, { wrCall: props.wrCall, onRead: props.onLocalRead, positions: props.positions })
          : null,
      )
    }

    function ShelfList(props) {
      const shelf = props.shelf
      const [filter, setFilter] = React.useState('all')
      const [layout, setLayout] = React.useState('cover')
      if (shelf === null || shelf === undefined) return h('div', { className: 'wr-empty' }, '书架为空。')
      const books = shelf.books.slice().sort((left, right) => right.readUpdateTime - left.readUpdateTime)
      const albums = shelf.albums
      const visible =
        filter === 'finished'
          ? books.filter((book) => book.finishReading === true)
          : filter === 'reading'
            ? books.filter((book) => book.finishReading !== true)
            : books
      const filters = [
        ['all', '全部', books.length],
        ['reading', '在读', books.filter((book) => book.finishReading !== true).length],
        ['finished', '已读完', books.filter((book) => book.finishReading === true).length],
      ]
      const renderMeta = (book) => {
        const timeLabel = formatReadingTime(book.readingTime)
        const bits = []
        if (Number.isFinite(Number(book.progress))) bits.push(`${Math.round(book.progress)}%`)
        if (timeLabel) bits.push(timeLabel)
        if (book.readUpdateDate !== undefined) bits.push(book.readUpdateDate)
        return bits.join(' · ')
      }
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'wr-filters' },
          filters.map(([id, label, count]) =>
            h(
              'button',
              { key: id, className: 'wr-chip', 'data-on': String(filter === id), onClick: () => setFilter(id) },
              `${label} ${count}`,
            ),
          ),
          h('div', { className: 'wr-spacer' }),
          h(
            'button',
            {
              className: 'wr-icon',
              title: layout === 'cover' ? '列表' : '封面',
              onClick: () => setLayout((value) => (value === 'cover' ? 'list' : 'cover')),
            },
            layout === 'cover'
              ? h(
                  'svg',
                  { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true },
                  h('path', { d: 'M3 5h10M3 11h10' }),
                )
              : h(
                  'svg',
                  { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': true },
                  h('rect', { x: 2.5, y: 2.5, width: 4.5, height: 4.5, rx: 0.8 }),
                  h('rect', { x: 9, y: 2.5, width: 4.5, height: 4.5, rx: 0.8 }),
                  h('rect', { x: 2.5, y: 9, width: 4.5, height: 4.5, rx: 0.8 }),
                  h('rect', { x: 9, y: 9, width: 4.5, height: 4.5, rx: 0.8 }),
                ),
          ),
          h('button', { className: 'wr-btn', onClick: props.reload }, '刷新'),
        ),
        visible.length === 0
          ? h('div', { className: 'wr-empty' }, filter === 'finished' ? '还没有读完的书。' : '这一栏是空的。')
          : layout === 'cover'
            ? h(
                'div',
                { className: 'wr-shelfGrid' },
                visible.map((book) =>
                  h(
                    'button',
                    { key: book.bookId, className: 'wr-coverCard', onClick: () => props.onSelect(book) },
                    h(Cover, { src: book.cover, variant: 'hero' }),
                    h(
                      'div',
                      { className: 'wr-coverMeta' },
                      h('div', { className: 'wr-coverTitle' }, book.title),
                      h('div', { className: 'wr-faint' }, renderMeta(book) || book.author),
                    ),
                  ),
                ),
              )
            : h(
                'ul',
                { className: 'wr-list' },
                visible.map((book) =>
                  h(
                    'li',
                    { key: book.bookId, className: 'wr-item', onClick: () => props.onSelect(book) },
                    h(
                      'div',
                      { className: 'wr-row' },
                      h(Cover, { src: book.cover }),
                      h(
                        'div',
                        { style: { minWidth: 0, flex: 'auto' } },
                        h('div', { style: { fontWeight: 600 } }, book.title, book.finishReading ? h('span', { className: 'wr-tag' }, '已读完') : null),
                        book.author.length > 0 ? h('div', { className: 'wr-faint' }, book.author) : null,
                        h('div', { className: 'wr-faint' }, renderMeta(book)),
                        Number.isFinite(Number(book.progress))
                          ? h('div', { className: 'wr-progress' }, h('div', { className: 'wr-progressFill', style: { width: `${Math.max(0, Math.min(100, book.progress))}%` } }))
                          : null,
                      ),
                    ),
                  ),
                ),
              ),
        albums.length > 0 && filter === 'all'
          ? h(
              'div',
              null,
              h('div', { className: 'wr-sep' }),
              h('div', { className: 'wr-faint' }, '有声书 / 专辑'),
              h(
                'ul',
                { className: 'wr-list' },
                albums.map((album) =>
                  h(
                    'li',
                    { key: album.bookId, className: 'wr-item' },
                    h('div', { style: { fontWeight: 600 } }, album.title),
                    h('div', { className: 'wr-faint' }, `${album.author}${album.trackCount > 0 ? ` · ${album.trackCount} 集` : ''}`),
                  ),
                ),
              ),
            )
          : null,
      )
    }

    function BookDetail(props) {
      const [state, reload] = useLoader(() => props.wrCall('book', { bookId: props.book.bookId }))
      return h(
        'div',
        { className: 'wr-body' },
        h('button', { className: 'wr-btn', onClick: props.onBack }, '← 返回书架'),
        h('div', { style: { height: 8 } }),
        h(Loaded, {
          state,
          reload,
          onRelogin: props.onRelogin,
          render: (detail) =>
            h(
              'div',
              { className: 'wr-card' },
              h(
                'div',
                { className: 'wr-row' },
                h(Cover, { src: detail.cover || props.book.cover }),
                h(
                  'div',
                  { style: { minWidth: 0, flex: 'auto' } },
                  h('h3', { className: 'wr-title' }, `《${detail.title || props.book.title}》`),
                  h('div', { className: 'wr-faint' }, detail.author || props.book.author),
                  formatRating(detail.rating) !== undefined
                    ? h('div', { className: 'wr-faint' }, formatRating(detail.rating))
                    : null,
                  detail.wordCount > 0
                    ? h('div', { className: 'wr-faint' }, `约 ${Math.round(detail.wordCount / 10000)} 万字`)
                    : null,
                  detail.progress !== undefined && detail.progress !== null
                    ? h(Progress, { value: detail.progress.progress })
                    : null,
                ),
              ),
              h(
                'div',
                { className: 'wr-actions' },
                (() => {
                  const firstChapterUid = firstReadableChapterUid(detail.chapters)
                  const chapterUid = resumeChapterUid(props.positions, props.book.bookId, detail.progress, firstChapterUid)
                  // Same rule as the continue card: an API key cannot decode
                  // chapter text, so only a Cookie session makes this readable.
                  const demoBook = detail.demo === true
                  if (props.readerReady !== true || chapterUid <= 0) return null
                  if (demoBook !== true && props.cookieReady !== true) return null
                  return h(
                    'button',
                    {
                      className: 'wr-btn wr-btnPrimary',
                      onClick: () =>
                        props.onRead({
                          bookId: props.book.bookId,
                          chapterUid,
                          firstChapterUid,
                          title: detail.title || props.book.title,
                        }),
                    },
                    '在 DSH 里读',
                  )
                })(),
                detail.readerLink !== undefined
                  ? h('button', { className: 'wr-btn', onClick: () => props.wrOpenReader(detail.readerLink) }, '官方阅读器')
                  : null,
                detail.deepLink !== undefined
                  ? h('button', { className: 'wr-btn', onClick: () => props.wrOpenReader(detail.deepLink) }, '书籍详情')
                  : null,
                h(
                  'button',
                  {
                    className: 'wr-btn',
                    onClick: () => props.onOpenNotes({ bookId: props.book.bookId, title: detail.title || props.book.title }),
                  },
                  '看划线',
                ),
              ),
              detail.intro.length > 0 ? h('div', { className: 'wr-sep' }) : null,
              detail.intro.length > 0 ? h('div', { className: 'wr-preview wr-muted' }, detail.intro) : null,
              detail.chapters.length > 0
                ? h('div', { className: 'wr-faint', style: { marginTop: 8 } }, `目录共 ${detail.chapters.length} 章`)
                : null,
            ),
        }),
      )
    }

    // --- 笔记 -----------------------------------------------------------------

    function NotesView(props) {
      const initial = props.initialBook === undefined ? null : props.initialBook
      const [selected, setSelected] = React.useState(initial)
      const [state, reload] = useLoader(() => props.wrCall('notebooks'))
      if (selected !== null) {
        return h(NotesDetail, { book: selected, wrCall: props.wrCall, onBack: () => setSelected(null), onRelogin: props.onRelogin })
      }
      return h(
        'div',
        { className: 'wr-body' },
        h(Loaded, {
          state,
          reload,
          onRelogin: props.onRelogin,
          render: (value) =>
            value.books.length === 0
              ? h('div', { className: 'wr-empty' }, '还没有任何划线或笔记。')
              : h(
                  'div',
                  null,
                  h(
                    'div',
                    { className: 'wr-faint', style: { marginBottom: 8 } },
                    `${value.totalBookCount} 本书 · ${value.totalNoteCount} 条笔记（划线 + 想法 + 书签）`,
                  ),
                  h(
                    'ul',
                    { className: 'wr-list' },
                    value.books.map((book) =>
                      h(
                        'li',
                        { key: book.bookId, className: 'wr-item', onClick: () => setSelected(book) },
                        h(
                          'div',
                          { className: 'wr-row' },
                          h(Cover, { src: book.cover }),
                          h(
                            'div',
                            { style: { minWidth: 0, flex: 'auto' } },
                            h('div', { style: { fontWeight: 600 } }, `《${book.title}》`),
                            book.author.length > 0 ? h('div', { className: 'wr-faint' }, book.author) : null,
                            h(
                              'div',
                              { className: 'wr-faint' },
                              `划线 ${book.noteCount} · 想法 ${book.reviewCount} · 书签 ${book.bookmarkCount} · 进度 ${book.readingProgress}%`,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
        }),
      )
    }

    function NotesDetail(props) {
      const [state, reload] = useLoader(() => props.wrCall('notes', { bookId: props.book.bookId }))
      return h(
        'div',
        { className: 'wr-body' },
        h('button', { className: 'wr-btn', onClick: props.onBack }, '← 返回笔记列表'),
        h('div', { style: { height: 8 } }),
        h(Loaded, {
          state,
          reload,
          onRelogin: props.onRelogin,
          render: (value) =>
            value.chapters.length === 0
              ? h('div', { className: 'wr-empty' }, '这本书里没有找到划线或想法。')
              : h(
                  'div',
                  null,
                  h('div', { className: 'wr-faint' }, `${value.highlightCount} 条划线 · ${value.thoughtCount} 条想法`),
                  value.chapters.map((chapter) =>
                    h(
                      'div',
                      { key: chapter.chapterUid || chapter.chapterTitle },
                      h('div', { className: 'wr-chapter' }, chapter.chapterTitle || '未归类'),
                      chapter.highlights.map((highlight, index) =>
                        h('div', { key: `h${index}`, className: 'wr-quote' }, highlight.text),
                      ),
                      chapter.thoughts.map((thought, index) =>
                        h(
                          'div',
                          { key: `t${index}`, className: 'wr-thought' },
                          h('div', null, thought.content),
                          thought.abstract.length > 0
                            ? h('div', { className: 'wr-faint' }, `原文：${thought.abstract}`)
                            : null,
                        ),
                      ),
                    ),
                  ),
                ),
        }),
      )
    }

    // --- 划线渲染 -------------------------------------------------------------

    /** 0 黄 / 1 红 / 2 蓝 / 3 绿 / 4 紫；越界或未设置一律按黄色。 */
    function normalizeMarkColor(value) {
      const index = Number(value)
      return Number.isInteger(index) && index >= 0 && index < 5 ? index : 0
    }

    /**
     * One paragraph's spans, turned into React children.
     *
     * The host slices a paragraph into runs and marks the ones that carry a
     * highlight, so the reading surface only has to paint them: <mark> for a
     * highlight, plain text otherwise. Never innerHTML — the text is a user's
     * own annotations and is escaped by React, not by string assembly.
     */
    function paragraphChildren(paragraph, spans, options) {
      const opts = options || {}
      const text = typeof paragraph === 'string' ? paragraph : ''
      if (!Array.isArray(spans) || spans.length === 0) return [text]
      // When every run carries offsets into this paragraph the runs are painted
      // by offset, and any gap between them is filled with the paragraph's own
      // characters — a gap is unmarked prose, not missing prose. A run whose
      // offsets do not line up falls back to its own copy of the text instead.
      const aligned = spans.every((span) => {
        const start = Number(span && span.start)
        const end = Number(span && span.end)
        return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start < end && end <= text.length
      })
      const nodes = []
      let cursor = 0
      for (let index = 0; index < spans.length; index += 1) {
        const span = spans[index] || {}
        const start = Number(span.start)
        const end = Number(span.end)
        if (aligned && start > cursor) nodes.push(text.slice(cursor, start))
        const clipped = aligned
          ? text.slice(start, end)
          : String(span.text === undefined || span.text === null ? '' : span.text)
        if (aligned) cursor = end
        const highlighted = span.highlightId !== undefined && span.highlightId !== null
        const highlightId = highlighted ? String(span.highlightId) : ''
        const hasNote = typeof span.note === 'string' && span.note.length > 0
        if (clipped.length > 0) {
          if (highlighted) {
            const focused = highlightId.length > 0 && opts.focusId === highlightId
            nodes.push(
              h(
                'mark',
                {
                  key: 'm' + index,
                  className: focused ? 'wr-mark wr-markFocus' : 'wr-mark',
                  'data-color': String(normalizeMarkColor(span.colorStyle)),
                  'data-hid': highlightId,
                  ref:
                    highlightId.length > 0 && typeof opts.registerMark === 'function'
                      ? (node) => opts.registerMark(highlightId, node)
                      : undefined,
                  // A mark is a button in disguise: clicking it opens its own
                  // bubble. ReaderView decides whether a live text selection
                  // should swallow the click instead.
                  onClick:
                    typeof opts.onMark === 'function'
                      ? (event) => {
                          event.stopPropagation()
                          opts.onMark(span, event)
                        }
                      : undefined,
                },
                clipped,
              ),
            )
          } else {
            nodes.push(clipped)
          }
        }
        if (hasNote) {
          nodes.push(
            h(
              'button',
              {
                key: 'n' + index,
                className: 'wr-noteDot',
                title: '查看想法',
                'aria-label': '查看想法',
                onClick: (event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (typeof opts.onNote === 'function') opts.onNote(span)
                },
              },
              '',
            ),
          )
        }
      }
      if (aligned && cursor < text.length) nodes.push(text.slice(cursor))
      if (nodes.length === 0) return [text]
      return nodes
    }

    /** A local chapter has no annotations: one plain span per paragraph. */
    function plainSpans(paragraphs) {
      return paragraphs.map((paragraph) => [
        { start: 0, end: String(paragraph === undefined || paragraph === null ? '' : paragraph).length, text: String(paragraph) },
      ])
    }

    // --- 选区、查词与 AI 提示词 -----------------------------------------------
    //
    // These four helpers are pure: they take a description of what the reader
    // selected and return what the UI should show. Keeping them out of the
    // component is what lets the interaction layer be tested without a DOM.

    /** 5 色划线的中文名，顺序与 normalizeMarkColor 的 0-4 一致。 */
    const MARK_COLOR_LABELS = ['黄', '红', '蓝', '绿', '紫']

    /** 查词只对单个词有意义：太长的选区、带空白的短语都不查。 */
    const DICT_MAX_WORD_LENGTH = 8

    /** 交给 AI 的原文上限；更长的选区截断后再加一句说明。 */
    const AI_TEXT_LIMIT = 2000

    /** 一条右键/工具条选区的最长长度，超过就不挂系统菜单。 */
    const SELECTION_MAX_LENGTH = 4000

    /**
     * What the reader currently has open, for surfaces registered outside it.
     *
     * The host's context-menu provider and the document-level right-click
     * listener live in apply(), where no component state is reachable; the
     * open book is mirrored here so a quoted selection can say where it is
     * from.
     */
    const readingContext = { bookId: '', bookTitle: '' }

    /** 字典来源的展示名；未知来源原样显示。 */
    const DICT_SOURCE_LABELS = {
      weread: '微信读书辞典',
      youdao: '有道词典',
      zdic: '汉典',
      dictionaryapi: 'Dictionary API',
      none: '',
    }

    /**
     * Describe one selection: the text, whether it can be marked, and the
     * paragraph offsets a mark needs.
     *
     * A highlight lives in one paragraph's character coordinates, so a range
     * that spans two <p> elements can be looked up and sent to the AI but not
     * marked. A local book has no account to write a mark into, and a cloud
     * book needs a logged-in Cookie: both are reported as a reason instead of
     * a silently disabled control.
     */
    function buildSelectionTarget(input) {
      const raw = input === null || input === undefined ? {} : input
      const text = String(raw.text === null || raw.text === undefined ? '' : raw.text)
      const trimmed = text.trim()
      const collapsed = trimmed.replace(/\s+/g, ' ')
      const paragraphIndex = Number(raw.paragraphIndex)
      const startOffset = Number(raw.startOffset)
      const endOffset = Number(raw.endOffset)
      // Offsets are only meaningful when the whole range sat inside one <p>.
      const sameParagraph =
        Number.isInteger(paragraphIndex) &&
        paragraphIndex >= 0 &&
        Number.isInteger(startOffset) &&
        Number.isInteger(endOffset) &&
        startOffset >= 0 &&
        endOffset > startOffset
      const local = raw.local === true
      const cookieReady = raw.cookieReady === true
      let reason = ''
      if (local) reason = '本地书不支持云端划线'
      else if (!cookieReady) reason = '先在设置里扫码或粘贴 Cookie'
      else if (!sameParagraph) reason = '请在同一段落内选择文字'
      else if (collapsed.length === 0) reason = '先选中要划线的文字'
      const canHighlight = reason.length === 0
      // A single word: no whitespace, short enough for the dictionary cascade.
      const word =
        collapsed.length > 0 && collapsed.length <= DICT_MAX_WORD_LENGTH && !/\s/.test(collapsed) ? collapsed : ''
      return {
        text: trimmed,
        collapsed,
        word,
        canHighlight,
        highlightTitle: reason,
        sameParagraph,
        paragraphIndex: sameParagraph ? paragraphIndex : -1,
        startOffset: sameParagraph ? startOffset : -1,
        endOffset: sameParagraph ? endOffset : -1,
        tooLong: collapsed.length > SELECTION_MAX_LENGTH,
        empty: collapsed.length === 0,
      }
    }

    /** Trim a quoted selection to what a prompt should carry. */
    function clipAiText(text) {
      const value = String(text === null || text === undefined ? '' : text).trim()
      if (value.length <= AI_TEXT_LIMIT) return value
      return value.slice(0, AI_TEXT_LIMIT) + '…（已截断）'
    }

    /**
     * The prompt an AI action sends.
     *
     * Two shapes only — 理解 and 讨论 — so the template stays predictable: the
     * quoted text is prefixed with "> " line by line, and the book title is a
     * provenance line rather than part of the question.
     */
    function buildAiPrompt(kind, input) {
      const raw = input === null || input === undefined ? {} : input
      const text = clipAiText(raw.text)
      const title = String(raw.bookTitle === null || raw.bookTitle === undefined ? '' : raw.bookTitle).trim()
      const source = title.length > 0 ? '（来自《' + title + '》）' : '（来自微信读书）'
      const quote = '> ' + text.split('\n').join('\n> ')
      if (kind === 'chat') return ['我想聊聊这段文字：', '', quote, '', source].join('\n')
      return [
        '请解释这段文字：',
        '',
        quote,
        '',
        source,
        '',
        '要求：先用一两句话说明它在说什么，再拆解关键词、典故与背景，最后说明它在全书论述中的作用。',
      ].join('\n')
    }

    /**
     * Flatten one lookupDict payload into display lines.
     *
     * The host cascades through several dictionaries, so readings and the
     * top-level definition list may repeat each other; duplicates are dropped
     * in first-seen order rather than trusted to be unique.
     */
    function dictLines(payload) {
      const raw = payload === null || payload === undefined ? {} : payload
      const word = String(raw.word === null || raw.word === undefined ? '' : raw.word)
      const readings = Array.isArray(raw.readings) ? raw.readings : []
      const lines = []
      const seen = {}
      const push = (line) => {
        const value = String(line === null || line === undefined ? '' : line).trim()
        if (value.length === 0 || seen[value] === true) return
        seen[value] = true
        lines.push(value)
      }
      const collect = (source) => {
        if (Array.isArray(source)) {
          for (const item of source) push(item)
        } else if (typeof source === 'string') {
          push(source)
        }
      }
      for (const reading of readings) collect(reading && reading.definitions)
      collect(raw.definitions)
      const phonetics = []
      const pushPhonetic = (value) => {
        const text = String(value === null || value === undefined ? '' : value).trim()
        if (text.length > 0 && phonetics.indexOf(text) < 0) phonetics.push(text)
      }
      pushPhonetic(raw.phonetic)
      for (const reading of readings) pushPhonetic(reading && reading.phonetic)
      const source = String(raw.source === null || raw.source === undefined ? '' : raw.source)
      return {
        word,
        phonetic: phonetics.join(' / '),
        lines,
        source,
        sourceLabel: DICT_SOURCE_LABELS[source] === undefined ? source : DICT_SOURCE_LABELS[source],
        empty: lines.length === 0,
      }
    }

    /**
     * Place a floating toolbar so it never leaves the reading surface.
     *
     * Coordinates are relative to the scrolling body. The bar prefers to sit
     * above the selection; when that would cross the top edge it flips below,
     * and the horizontal centre is clamped into [0, bodyWidth - width].
     */
    function clampToolbarPosition(input) {
      const raw = input === null || input === undefined ? {} : input
      const rect = raw.rect === null || raw.rect === undefined ? {} : raw.rect
      const body = raw.body === null || raw.body === undefined ? {} : raw.body
      const toolbar = raw.toolbar === null || raw.toolbar === undefined ? {} : raw.toolbar
      const gap = Number.isFinite(Number(raw.gap)) ? Number(raw.gap) : 8
      const width = Math.max(0, Number(toolbar.width) || 0)
      const height = Math.max(0, Number(toolbar.height) || 0)
      const bodyWidth = Math.max(0, Number(body.width) || 0)
      const bodyHeight = Math.max(0, Number(body.height) || 0)
      const rectLeft = Number(rect.left) || 0
      const rectTop = Number(rect.top) || 0
      const rectWidth = Number(rect.width) || 0
      const rectHeight = Number(rect.height) || 0
      const centred = rectLeft + rectWidth / 2 - width / 2
      const left = Math.min(Math.max(0, bodyWidth - width), Math.max(0, centred))
      let top = rectTop - height - gap
      let placement = 'above'
      if (top < 0) {
        top = rectTop + rectHeight + gap
        placement = 'below'
      }
      top = Math.min(Math.max(0, bodyHeight - height), Math.max(0, top))
      return { left: Math.round(left), top: Math.round(top), placement }
    }

    /**
     * The centre panel's own shell.
     *
     * A main-slot container does not always hand its child a height, so the
     * panel claims the full column explicitly and keeps the only scrolling
     * surface one level inside it.
     */
    const PANEL_STYLE = {
      height: '100%',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      overflow: 'hidden',
    }

    /**
     * Per-file ceiling. The whole base64 body travels in one JSON POST, so the
     * limit is set by what that transfer survives rather than by the parser:
     * a 154MB EPUB (206MB of base64) round-trips and parses in well under a
     * second. 100MB keeps the browser-side string at a sane size while still
     * admitting every normal trade edition.
     */
    const LOCAL_IMPORT_LIMIT = 100 * 1024 * 1024

    /** A short character-count label, the way a book's metadata reads. */
    function formatCharCount(count) {
      const value = Math.max(0, Math.floor(Number(count) || 0))
      if (value <= 0) return ''
      if (value < 10000) return value + ' 字'
      const wan = value / 10000
      return (wan >= 100 ? Math.round(wan) : Math.round(wan * 10) / 10) + ' 万字'
    }

    function isLocalBookId(bookId) {
      return typeof bookId === 'string' && bookId.indexOf('local-') === 0
    }

    function formatImportDate(value) {
      if (value === undefined || value === null || value === '') return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (part) => String(part).padStart(2, '0')
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    }

    // --- 本书划线 -------------------------------------------------------------

    /** The 「本书划线」 drawer: every highlight, click one to jump to its text. */
    function BookMarksView(props) {
      if (props.loading === true) {
        return h('div', { className: 'wr-marksDrawer' }, h('div', { className: 'wr-faint' }, '正在读取划线…'))
      }
      if (props.error !== null && props.error !== undefined) {
        return h(
          'div',
          { className: 'wr-marksDrawer' },
          h('div', { className: 'wr-error' }, errorText(props.error)),
          typeof props.onRetry === 'function'
            ? h('button', { className: 'wr-btn', onClick: props.onRetry }, '重试')
            : null,
        )
      }
      const marks = props.marks
      if (marks === null || marks === undefined) {
        return h('div', { className: 'wr-marksDrawer' }, h('div', { className: 'wr-faint' }, '还没有读到划线。'))
      }
      if (marks.configured === false) {
        return h(
          'div',
          { className: 'wr-marksDrawer' },
          h('div', { className: 'wr-faint' }, '配置 API Key 后可显示本书的划线。'),
        )
      }
      const chapters = Array.isArray(marks.chapters) ? marks.chapters : []
      const highlights = Number(marks.highlightCount) || 0
      const thoughts = Number(marks.thoughtCount) || 0
      if (chapters.length === 0) {
        return h('div', { className: 'wr-marksDrawer' }, h('div', { className: 'wr-faint' }, '这本书还没有划线。'))
      }
      return h(
        'div',
        { className: 'wr-marksDrawer' },
        h(
          'div',
          { className: 'wr-faint', style: { padding: '0 4px 6px' } },
          '共 ' + highlights + ' 条划线 · ' + thoughts + ' 条想法（点一条跳到原文）',
        ),
        chapters.map((chapter) =>
          h(
            'div',
            { key: String(chapter.chapterUid) },
            h(
              'div',
              { className: 'wr-sectionTitle', style: { fontSize: '12px', margin: '6px 4px 2px' } },
              chapter.chapterTitle || '第 ' + chapter.chapterUid + ' 章',
            ),
            (Array.isArray(chapter.highlights) ? chapter.highlights : []).map((item) =>
              h(
                'div',
                {
                  key: 'h' + String(item.bookmarkId) + String(item.range),
                  className: 'wr-marksItem',
                  onClick: () => props.onPick({ chapterUid: item.chapterUid, highlightId: item.bookmarkId }),
                },
                h('div', null, item.text),
                typeof item.note === 'string' && item.note.length > 0
                  ? h('div', { className: 'wr-faint' }, '想法：' + item.note)
                  : null,
              ),
            ),
            (Array.isArray(chapter.thoughts) ? chapter.thoughts : []).map((item) =>
              h(
                'div',
                {
                  key: 't' + String(item.reviewId),
                  className: 'wr-marksItem',
                  onClick: () => props.onPick({ chapterUid: item.chapterUid, highlightId: null }),
                },
                h('div', null, typeof item.abstract === 'string' && item.abstract.length > 0 ? '「' + item.abstract + '」' : '想法'),
                h('div', { className: 'wr-faint' }, item.content),
              ),
            ),
          ),
        ),
      )
    }

    /** The 「本书划线」 data, fetched only while the drawer is open. */
    function BookMarksLoader(props) {
      const [state, reload] = useLoader(() => props.wrCall('bookMarks', { bookId: props.bookId }), [props.bookId])
      return h(BookMarksView, {
        loading: state.status === 'loading',
        marks: state.status === 'ready' ? state.value : null,
        onPick: props.onPick,
        onRetry: reload,
        error: state.status === 'error' ? state.error : null,
      })
    }

    // --- 本地书库 -------------------------------------------------------------

    /** Files → base64 → the host's local library. One file at a time. */
    function LocalLibrary(props) {
      const [state, reload] = useLoader(() => props.wrCall('localList'))
      const [busy, setBusy] = React.useState(false)
      const [progress, setProgress] = React.useState(null)
      const [message, setMessage] = React.useState(null)

      const notice = (kind, text) => {
        setMessage({ kind, text })
      }

      const readBase64 = (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(new Error('读取「' + file.name + '」失败。'))
          reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : ''
            const comma = result.indexOf(',')
            if (comma < 0) {
              reject(new Error('读取「' + file.name + '」失败。'))
              return
            }
            resolve(result.slice(comma + 1))
          }
          reader.readAsDataURL(file)
        })

      const importFiles = async (fileList) => {
        const files = Array.from(fileList || [])
        const usable = files.filter((file) => /\.(epub|txt)$/i.test(file.name))
        if (usable.length === 0) {
          notice('error', '只支持导入 .epub 与 .txt 文件。')
          return
        }
        setBusy(true)
        setMessage(null)
        const imported = []
        const failed = []
        for (let index = 0; index < usable.length; index += 1) {
          const file = usable[index]
          setProgress({ done: index, total: usable.length, name: file.name })
          if (file.size > LOCAL_IMPORT_LIMIT) {
            if (typeof window !== 'undefined' && typeof window.alert === 'function') {
              window.alert('文件过大（上限 100MB），请先压缩图片或拆分后再导入')
            }
            failed.push('「' + file.name + '」超过 100MB')
            continue
          }
          try {
            const base64 = await readBase64(file)
            await props.wrCall('localImport', { filename: file.name, base64 })
            imported.push(file.name)
          } catch (error) {
            failed.push('「' + file.name + '」' + errorText(error))
          }
        }
        setProgress(null)
        setBusy(false)
        reload()
        if (failed.length === 0) {
          notice('ok', '已导入 ' + imported.length + ' 本：' + imported.join('、'))
        } else {
          notice(
            imported.length > 0 ? 'warn' : 'error',
            (imported.length > 0 ? '已导入 ' + imported.length + ' 本；' : '') + '未导入：' + failed.join('；'),
          )
        }
      }

      const open = async (book) => {
        setMessage(null)
        try {
          setBusy(true)
          const detail = await props.wrCall('localBook', { bookId: book.bookId })
          const chapters = Array.isArray(detail.chapters) ? detail.chapters : []
          const first = firstReadableChapterUid(chapters)
          if (!(Number(first) > 0)) {
            notice('error', '这本书没有可读的章节。')
            return
          }
          // Reopening an imported book resumes where it was left, exactly as a
          // cloud book does: the remembered positions cover local ids too.
          const resume = resumeChapterUid(props.positions, book.bookId, undefined, first)
          if (typeof props.onRead === 'function') {
            props.onRead({
              bookId: book.bookId,
              title: detail.title || book.title,
              chapterUid: resume > 0 ? resume : first,
              firstChapterUid: first,
              format: 'local',
            })
          }
        } catch (error) {
          notice('error', errorText(error))
        } finally {
          setBusy(false)
        }
      }

      const remove = async (book) => {
        if (!isLocalBookId(book.bookId)) return
        if (
          typeof window !== 'undefined' &&
          typeof window.confirm === 'function' &&
          !window.confirm('从本地书库删除《' + book.title + '》？')
        ) {
          return
        }
        try {
          setBusy(true)
          await props.wrCall('localRemove', { bookId: book.bookId })
          notice('ok', '已删除《' + book.title + '》。')
          reload()
        } catch (error) {
          notice('error', errorText(error))
        } finally {
          setBusy(false)
        }
      }

      const renderBooks = (value) => {
        const books = value !== null && value !== undefined && Array.isArray(value.books) ? value.books : []
        if (books.length === 0) {
          return h('div', { className: 'wr-empty' }, '还没有导入本地书。epub / txt，单个文件最大 100MB')
        }
        return h(
          'div',
          { className: 'wr-localGrid' },
          books.map((book) =>
            h(
              'div',
              { key: book.bookId, className: 'wr-localCard' },
              h(
                'div',
                { className: 'wr-localHead' },
                h('span', { className: 'wr-localTitle', title: book.title }, book.title),
                h('span', { className: 'wr-tag' }, String(book.format || 'txt').toUpperCase()),
              ),
              h(
                'div',
                { className: 'wr-localMeta' },
                [
                  book.author,
                  Number(book.chapterCount) > 0 ? book.chapterCount + ' 章' : '',
                  formatCharCount(book.charCount),
                  formatImportDate(book.importedAt),
                ]
                  .filter((part) => part !== '' && part !== undefined && part !== null)
                  .join(' · '),
              ),
              h(
                'div',
                { className: 'wr-localActions' },
                h('button', { className: 'wr-btn wr-btnPrimary', disabled: busy, onClick: () => open(book) }, '阅读'),
                h(
                  'button',
                  { className: 'wr-btn', disabled: busy || !isLocalBookId(book.bookId), onClick: () => remove(book) },
                  '删除',
                ),
              ),
            ),
          ),
        )
      }

      return h(
        'div',
        null,
        h(
          'div',
          { className: 'wr-section' },
          h('h3', { className: 'wr-sectionTitle' }, '本地导入'),
          h('span', { className: 'wr-sectionHint' }, '导入的 epub / txt 保存在本机，离线可读'),
        ),
        h(
          'label',
          { className: 'wr-drop' },
          h('input', {
            type: 'file',
            accept: '.epub,.txt',
            multiple: true,
            style: { display: 'none' },
            disabled: busy,
            onChange: (event) => {
              // FileList is live: clearing the input empties the very list the
              // import would read, so snapshot it first.
              const files = Array.from(event.target.files || [])
              event.target.value = ''
              void importFiles(files)
            },
          }),
          h('span', null, busy ? '导入中…' : '选择 .epub / .txt 文件（可多选）'),
          h('span', { className: 'wr-faint' }, '单个文件最大 100MB；导入后可在书架里直接阅读'),
        ),
        progress !== null
          ? h(
              'div',
              { className: 'wr-localBar' },
              h('span', { className: 'wr-faint' }, '导入中 ' + (progress.done + 1) + '/' + progress.total + ' · ' + progress.name),
            )
          : null,
        message !== null
          ? h(
              'p',
              { className: message.kind === 'error' ? 'wr-error' : message.kind === 'ok' ? 'wr-ok' : 'wr-warn' },
              message.text,
            )
          : null,
        h(Loaded, { state, reload, render: renderBooks }),
      )
    }

    // --- 侧栏入口 -------------------------------------------------------------

    /** The left sidebar's row glyph. Size comes from the shell. */
    function WereadSidebarIcon(props) {
      const size = props !== null && typeof props === 'object' && typeof props.size === 'number' ? props.size : 16
      return h(
        'svg',
        {
          className: 'wr-sidebarIcon',
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', {
          d: 'M12 6.5C10.4 5.2 8.4 4.6 5.5 4.6v12.9c2.9 0 4.9.6 6.5 1.9 1.6-1.3 3.6-1.9 6.5-1.9V4.6c-2.9 0-4.9.6-6.5 1.9Z',
        }),
        h('path', { d: 'M12 6.5v12.9' }),
      )
    }

    /** The main-area face: the same five tabs, sized for the centre column. */
    function WereadStudioPanel(props) {
      // The panel is the same five-tab studio as the sidebar tab, only wider.
      return h(WereadTab, Object.assign({}, props, { panel: true }))
    }

    // --- 面板内的 AI 对话 -------------------------------------------------------

    /**
     * The embedded conversation.
     *
     * It is registered as its own slot entry so the renderer seats it with the
     * session-scoped kit the conversation factory needs; the pane below only
     * supplies the binding. The phase computation mirrors the shell's own
     * sidebar chat: a Session that has not been prompted yet shows its hero,
     * anything further along shows the live transcript.
     */
    function ChatPanel(props) {
      const session = typeof props.useSession === 'function' ? props.useSession((value) => value) : undefined
      const conversation = typeof props.useConversation === 'function' ? props.useConversation((value) => value) : undefined
      const sessions = typeof props.useSessions === 'function' ? props.useSessions((value) => value) : undefined
      if (session === undefined || typeof props.renderFactorySlot !== 'function') {
        return h('div', { className: 'wr-chatEmpty' }, '这个外壳里没有可用的对话视图。')
      }
      const live = conversation !== undefined && conversation !== null && conversation.activeTargets !== undefined
        ? conversation.activeTargets.size > 0
        : false
      const active = live || (session.blank !== true && session.awaitingFirstTurn !== true) || session.running === true
      const shellPhase = active ? 'active' : session.promptAttempted === true ? 'engaging' : 'blank'
      const summary = sessions === undefined || sessions === null ? undefined : sessions.byId?.[session.sessionId]
      const summaryBlank = summary === undefined ? undefined : summary.blank
      const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true
      const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
      return props.renderFactorySlot(
        'conversation.content',
        { variant: 'embedded', phase: settling ? 'settling' : hero ? 'hero' : 'active', hero },
        { slots: { views: (viewProps) => viewProps.renderSlot('conversation.session', { view: 'chat' }) } },
      )
    }

    /**
     * The reader's chat face: one retained Session, mounted in place.
     *
     * The reference is held for exactly as long as the pane is on screen, so
     * the conversation stays open while the reader talks to it and is released
     * when they go back to the book.
     */
    function ChatPane(props) {
      const sessionId = props.sessionId
      const retain = props.wrRetain
      const [reference, setReference] = React.useState(null)
      const [failure, setFailure] = React.useState('')
      React.useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof retain !== 'function') {
          setFailure('没有可用的对话会话。')
          return undefined
        }
        let live = true
        let held
        Promise.resolve()
          .then(() => retain(sessionId))
          .then(async (value) => {
            held = value
            // The pane binds the Session through its reference; binding it
            // before the reference reports ready makes the slot renderer
            // resolve a binding the controller has not published yet.
            if (value !== null && value !== undefined && value.ready !== undefined) await value.ready
            if (live) setReference(value)
            else if (value !== null && value !== undefined && typeof value.release === 'function') value.release()
          })
          .catch((error) => {
            if (live) setFailure('打开对话失败：' + errorText(error))
          })
        return () => {
          live = false
          if (held !== null && held !== undefined && typeof held.release === 'function') held.release()
        }
      }, [sessionId])
      const SessionProvider = props.SessionProvider
      const renderSlot = props.renderSlot
      const body = failure.length > 0
        ? h('div', { className: 'wr-chatEmpty' }, failure)
        : reference === null
          ? h('div', { className: 'wr-chatEmpty' }, '正在打开对话…')
          : typeof SessionProvider === 'function' && typeof renderSlot === 'function'
            ? h(SessionProvider, { session: reference }, renderSlot('weread.chat', {}))
            : h('div', { className: 'wr-chatEmpty' }, '这个外壳里没有可用的对话视图。')
      return h(
        'div',
        { className: 'wr-chatWrap' },
        h(
          'div',
          { className: 'wr-chatBar' },
          h('span', null, 'AI 对话'),
          h('div', { className: 'wr-spacer' }),
          h('button', { className: 'wr-btn', onClick: () => props.onBack() }, '← 回到阅读'),
        ),
        h('div', { className: 'wr-chatBody' }, body),
      )
    }

    // --- 阅读器 ---------------------------------------------------------------

    function ReaderView(props) {
      const { wrCall, bookId, bookTitle, syncEnabled, onBack, onAppearance, onChapter } = props
      // A local book reads from the local library and carries no annotations.
      const local = props.bookFormat === 'local'
      // Writing a highlight needs the account's Cookie; the host knows whether
      // one is configured and hands the answer down rather than guessing here.
      const cookieReady = props.cookieReady === true
      // The interaction surfaces are described by the pure helpers above and
      // only placed here: the live selection, the open mark bubble, the
      // dictionary result and the panel's own context menu.
      const [selection, setSelection] = React.useState(null)
      const [selColor, setSelColor] = React.useState(0)
      const [markPop, setMarkPop] = React.useState(null)
      const [dict, setDict] = React.useState(null)
      const [ctxMenu, setCtxMenu] = React.useState(null)
      // When the marks for this chapter last landed, for the focus refresh.
      const marksFetchedRef = React.useRef(0)
      const [chapterUid, setChapterUid] = React.useState(props.chapterUid)
      const [appearance, setAppearance] = React.useState(() => ({
        ...APPEARANCE_FALLBACK,
        ...(props.readerSettings ?? {}),
      }))
      const [showCatalog, setShowCatalog] = React.useState(false)
      const [showAppearance, setShowAppearance] = React.useState(false)
      const [message, setMessage] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [chapterRatio, setChapterRatio] = React.useState(0)
      // Mirrors the host's 进度回写 switch so the toolbar reads back at once.
      const [syncLocal, setSyncLocal] = React.useState(syncEnabled === true)

      React.useEffect(() => {
        setSyncLocal(syncEnabled === true)
      }, [syncEnabled])

      const toggleSync = async () => {
        if (typeof props.onSyncToggle !== 'function') return
        setBusy(true)
        setMessage(null)
        try {
          await props.onSyncToggle(!syncLocal)
          setSyncLocal(!syncLocal)
        } catch (error) {
          setMessage({ kind: 'error', text: errorText(error) })
        } finally {
          setBusy(false)
        }
      }
      // How far through the chapter the reader has scrolled. The host turns
      // this into the book's own position units, because it owns the catalog.
      // A ref, not state: scrolling must not re-render the whole chapter.
      const positionRef = React.useRef({ chapterUid: props.chapterUid, ratio: 0 })
      const bodyRef = React.useRef(null)
      const paragraphRefs = React.useRef([])
      const layoutRef = React.useRef({ at: 0, boxes: [] })
      // Reading-time accounting: only attentive, visible time counts.
      const readingRef = React.useRef({
        activeSeconds: 0,
        lastCountedAt: Date.now(),
        lastInteractionAt: Date.now(),
      })
      const [activeSeconds, setActiveSeconds] = React.useState(0)
      const summaryRef = React.useRef('')
      const flushRef = React.useRef(null)
      const lastChapterRef = React.useRef(props.chapterUid)
      const [showMarks, setShowMarks] = React.useState(false)
      const [notePop, setNotePop] = React.useState(null)
      const [focusId, setFocusId] = React.useState(props.focusId === undefined || props.focusId === null ? '' : String(props.focusId))
      const markRefs = React.useRef({})
      const jumpedRef = React.useRef(false)
      const [state, reload] = useLoader(
        () => (local ? wrCall('localChapter', { bookId, chapterUid }) : wrCall('chapter', { bookId, chapterUid })),
        [bookId, chapterUid, local],
      )
      // Annotation runs arrive separately: the chapter call owns the text and
      // the catalog, the marks call owns the highlights that sit on top of it.
      const [markState, reloadMarks] = useLoader(
        () => (local ? null : wrCall('chapterMarks', { bookId, chapterUid })),
        [bookId, chapterUid, local],
      )

      React.useEffect(() => {
        // Leaving a chapter reports what was read in it, at its own position,
        // before the position ref moves on.
        if (lastChapterRef.current !== chapterUid) {
          void flushRef.current?.(false)
          lastChapterRef.current = chapterUid
          if (typeof onChapter === 'function') onChapter(chapterUid)
          positionRef.current = { chapterUid, ratio: 0 }
          readingRef.current = { ...readingRef.current, lastCountedAt: Date.now() }
          if (bodyRef.current !== null) bodyRef.current.scrollTop = 0
        }
        setMessage(null)
        setNotePop(null)
        setMarkPop(null)
        setDict(null)
        setSelection(null)
        setCtxMenu(null)
        layoutRef.current = { at: 0, boxes: [] }
        paragraphRefs.current = []
        markRefs.current = {}
      }, [chapterUid, appearance.fontSize, appearance.lineHeight, appearance.fontFamily])

      // The chapter text is only needed as a short "where you are" summary.
      React.useEffect(() => {
        summaryRef.current =
          state.status === 'ready' && state.value.paragraphs.length > 0
            ? state.value.paragraphs[0].slice(0, 20)
            : ''
      }, [state])

      /**
       * Report the position, carrying whatever reading time has built up.
       *
       * The manual button forces a report; the timer, a chapter change and
       * leaving the reader only send once the time is worth an account write.
       */
      const report = async (force) => {
        // A local book has no upstream account to write a position for.
        if (local) return undefined
        const seconds = Math.floor(readingRef.current.activeSeconds)
        if (!force && seconds < READING_MIN_SECONDS) return undefined
        const { chapterUid: uid, ratio } = positionRef.current
        readingRef.current = { ...readingRef.current, activeSeconds: 0, lastCountedAt: Date.now() }
        try {
          return await wrCall('reportProgress', {
            bookId,
            chapterUid: uid,
            positionRatio: ratio,
            summary: summaryRef.current,
            elapsedSeconds: seconds,
          })
        } catch (error) {
          // Hand the time back so a later report can retry it.
          readingRef.current = { ...readingRef.current, activeSeconds: readingRef.current.activeSeconds + seconds }
          throw error
        }
      }
      flushRef.current = report

      // The accounting ticker, plus the interaction and visibility it needs.
      React.useEffect(() => {
        if (syncEnabled !== true || local) return undefined
        const interact = () => {
          readingRef.current = { ...readingRef.current, lastInteractionAt: Date.now() }
        }
        const tick = () => {
          const now = Date.now()
          // Reading time belongs to the book you are looking at, not to the
          // app being open: the tab stays mounted while you work elsewhere.
          const watching = isOnScreen(bodyRef.current, window.innerHeight || 0)
          const next = creditReadingTime(readingRef.current, now, watching && document.visibilityState === 'visible')
          readingRef.current = next
          if (next.activeSeconds >= READING_FLUSH_SECONDS) void flushRef.current?.(false).catch(() => {})
        }
        const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']
        for (const type of events) document.addEventListener(type, interact, { capture: true, passive: true })
        const ticks = setInterval(tick, 1000)
        const display = setInterval(() => setActiveSeconds(Math.floor(readingRef.current.activeSeconds)), READING_DISPLAY_MS)
        return () => {
          clearInterval(ticks)
          clearInterval(display)
          for (const type of events) document.removeEventListener(type, interact, { capture: true })
          // Leaving the reader keeps what was read rather than dropping it.
          void flushRef.current?.(false).catch(() => {})
        }
      }, [syncEnabled, local])

      /** Measure each paragraph's box, in the reading surface's coordinates. */
      const measureLayout = () => {
        const element = bodyRef.current
        if (element === null) return []
        const containerTop = element.getBoundingClientRect().top
        const boxes = []
        for (const node of paragraphRefs.current) {
          if (node === null || node === undefined) continue
          const rect = node.getBoundingClientRect()
          boxes.push({
            top: rect.top - containerTop + element.scrollTop,
            height: rect.height,
            start: Number(node.dataset.start),
            length: Number(node.dataset.length),
          })
        }
        return boxes
      }

      /** Report how far through the chapter's text the reader actually is. */
      const trackPosition = () => {
        const element = bodyRef.current
        if (element === null) return
        readingRef.current = { ...readingRef.current, lastInteractionAt: Date.now() }
        const stamp = Date.now()
        if (layoutRef.current.boxes.length === 0 || stamp - layoutRef.current.at > 250) {
          layoutRef.current = { at: stamp, boxes: measureLayout() }
        }
        const ratio = measurePosition(element.scrollTop, layoutRef.current.boxes)
        positionRef.current = { chapterUid, ratio }
        setChapterRatio(ratio)
      }

      // The host is the source of truth; this only mirrors it back in, so a
      // saved appearance applies as soon as the status read lands.
      React.useEffect(() => {
        if (props.readerSettings !== undefined) {
          setAppearance({ ...APPEARANCE_FALLBACK, ...props.readerSettings })
        }
      }, [props.readerSettings])

      /** Apply one appearance change locally at once, then persist it. */
      const updateAppearance = (patch) => {
        const next = { ...appearance, ...patch }
        setAppearance(next)
        if (typeof onAppearance === 'function') onAppearance(next)
      }

      const changeFont = (delta) => {
        updateAppearance({ fontSize: Math.max(12, Math.min(30, appearance.fontSize + delta)) })
      }

      const sync = async () => {
        setBusy(true)
        setMessage(null)
        const seconds = Math.floor(readingRef.current.activeSeconds)
        try {
          const value = await report(true)
          setMessage({
            kind: 'ok',
            text: `已上报：进度按本地估算 ${value.progress}%，阅读时长 ${Math.max(1, Math.round(seconds / 60))} 分钟（面板显示的进度是官方数值；最终以微信读书为准）。`,
          })
          setActiveSeconds(0)
        } catch (error) {
          setMessage({ kind: 'error', text: errorText(error) })
        } finally {
          setBusy(false)
        }
      }

      /**
       * The runs of text to paint over the chapter.
       *
       * The host hands back one array per paragraph; a local book has none, so
       * its paragraphs are rendered as a single plain span each.
       */
      const marks = markState.status === 'ready' ? markState.value : null
      const markSpans =
        local && state.status === 'ready'
          ? plainSpans(state.value.paragraphs)
          : marks !== null && Array.isArray(marks.spans)
            ? marks.spans
            : []
      const highlightCount = marks !== null ? Number(marks.highlightCount) || 0 : 0
      const thoughtCount = marks !== null ? Number(marks.thoughtCount) || 0 : 0
      const unconfigured = !local && marks !== null && marks.configured === false
      // A Cookie-only account can read the text but not the notebook, and a
      // transient gateway error lands here too: the chapter stays readable,
      // so the failure is reported beside it instead of replacing it.
      const markFailed = !local && markState.status === 'error'

      // --- 阅读交互层 ---------------------------------------------------------
      //
      // Everything below turns a browser selection into one of four surfaces:
      // the floating bar, the mark bubble, the dictionary card and the panel's
      // own context menu. Only clampToolbarPosition is pure; the DOM reading
      // stays here because it needs this component's own refs.

      /** The <p> that owns a selection boundary, if it sits inside the text. */
      const paragraphOf = (root, container) => {
        if (root === null || container === null || container === undefined) return null
        const element = container.nodeType === 1 ? container : container.parentElement
        if (element === null || element === undefined || typeof element.closest !== 'function') return null
        const paragraph = element.closest('p')
        if (paragraph === null || paragraph === undefined) return null
        return root.contains(paragraph) ? paragraph : null
      }

      /** A paragraph element's index among the chapter's paragraphs. */
      const paragraphIndexOf = (root, node) => {
        if (root === null || node === null || node === undefined) return -1
        const children = root.children
        for (let index = 0; index < children.length; index += 1) {
          if (children[index] === node) return index
        }
        return -1
      }

      /** A boundary point's character offset inside its paragraph's text. */
      const offsetWithin = (paragraph, container, offset) => {
        try {
          const probe = document.createRange()
          probe.selectNodeContents(paragraph)
          probe.setEnd(container, offset)
          return String(probe.toString()).length
        } catch {
          return -1
        }
      }

      /**
       * Describe the live selection in the units a highlight needs.
       *
       * Returns null unless the selection sits inside .wr-readerText: a
       * selection in the toolbar or the marks drawer is not a quotation.
       */
      const describeSelection = () => {
        const body = bodyRef.current
        if (body === null) return null
        if (typeof window.getSelection !== 'function') return null
        const sel = window.getSelection()
        if (sel === null || sel === undefined) return null
        if (sel.rangeCount === 0 || sel.isCollapsed) return null
        const text = String(sel)
        if (text.trim().length === 0) return null
        let range
        try {
          range = sel.getRangeAt(0)
        } catch {
          return null
        }
        const common = range.commonAncestorContainer
        const element = common === null || common === undefined ? null : common.nodeType === 1 ? common : common.parentElement
        if (element === null || element === undefined) return null
        const root = typeof element.closest === 'function' ? element.closest('.wr-readerText') : null
        if (root === null || root === undefined) return null
        const startParagraph = paragraphOf(root, range.startContainer)
        const endParagraph = paragraphOf(root, range.endContainer)
        const same = startParagraph !== null && startParagraph === endParagraph
        const paragraphIndex = same ? paragraphIndexOf(root, startParagraph) : -1
        const startOffset = same ? offsetWithin(startParagraph, range.startContainer, range.startOffset) : undefined
        const endOffset = same ? offsetWithin(startParagraph, range.endContainer, range.endOffset) : undefined
        const target = buildSelectionTarget({
          text,
          local,
          cookieReady,
          paragraphIndex,
          startOffset,
          endOffset,
        })
        // Viewport coordinates: the floating surfaces are children of the
        // reader root, so they are converted once, where they are placed.
        const rect = range.getBoundingClientRect()
        target.rect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        return target
      }

      /** Re-read the selection, keeping the previous object when it is equal. */
      const refreshSelection = () => {
        const next = describeSelection()
        setSelection((prev) => {
          if (next === null) return prev === null ? prev : null
          if (prev !== null) {
            const sameText =
              prev.collapsed === next.collapsed &&
              prev.paragraphIndex === next.paragraphIndex &&
              prev.startOffset === next.startOffset &&
              prev.endOffset === next.endOffset
            const sameRect =
              Math.abs(prev.rect.left - next.rect.left) < 1 &&
              Math.abs(prev.rect.top - next.rect.top) < 1 &&
              Math.abs(prev.rect.width - next.rect.width) < 1
            if (sameText && sameRect) return prev
          }
          return next
        })
      }

      React.useEffect(() => {
        // Pointer-up and key-up cover the normal ways of selecting; the
        // selectionchange event covers double-click and keyboard extension.
        const onChange = () => refreshSelection()
        document.addEventListener('selectionchange', onChange)
        document.addEventListener('mouseup', onChange, true)
        document.addEventListener('keyup', onChange, true)
        return () => {
          document.removeEventListener('selectionchange', onChange)
          document.removeEventListener('mouseup', onChange, true)
          document.removeEventListener('keyup', onChange, true)
        }
      }, [local, cookieReady])

      // The floating surfaces close on Escape and on a press outside them,
      // the way every other popover in the shell does.
      React.useEffect(() => {
        if (ctxMenu === null && markPop === null && dict === null && selection === null) return undefined
        const onDown = (event) => {
          const node = event.target
          if (node !== null && node !== undefined && typeof node.closest === 'function') {
            if (node.closest('.wr-selBar') !== null) return
            if (node.closest('.wr-menu') !== null) return
            if (node.closest('.wr-markPop') !== null) return
            if (node.closest('.wr-dictPop') !== null) return
            if (node.closest('.wr-mark') !== null) return
            if (node.closest('.wr-notePop') !== null) return
            if (node.closest('.wr-noteDot') !== null) return
          }
          setCtxMenu(null)
          setMarkPop(null)
        }
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          setCtxMenu(null)
          setMarkPop(null)
          setDict(null)
          setSelection(null)
        }
        document.addEventListener('mousedown', onDown, true)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown, true)
          document.removeEventListener('keydown', onKey)
        }
      }, [ctxMenu, markPop, dict, selection])

      /** Drop the browser selection and the bar that follows it. */
      const clearSelection = () => {
        try {
          if (typeof window.getSelection === 'function') {
            const sel = window.getSelection()
            if (sel !== null && sel !== undefined) sel.removeAllRanges()
          }
        } catch {
          // A selection can already be gone; nothing to clear.
        }
        setSelection(null)
      }

      const copyText = async (text) => {
        const value = String(text === null || text === undefined ? '' : text)
        if (value.length === 0) return
        try {
          if (navigator.clipboard === undefined || typeof navigator.clipboard.writeText !== 'function') throw new Error('no clipboard')
          await navigator.clipboard.writeText(value)
          setMessage({ kind: 'ok', text: '已复制' })
        } catch {
          setMessage({ kind: 'error', text: '复制失败，请手动选中后复制。' })
        }
      }

      /**
       * Send a quoted passage to the AI workspace.
       *
       * The host owns that surface, so the prompt leaves through the injected
       * callback; a shell without it reports rather than silently doing
       * nothing.
       */
      const askAi = async (kind) => {
        const target = selection
        if (target === null) return
        const prompt = buildAiPrompt(kind, { text: target.text, bookTitle })
        setSelection(null)
        setCtxMenu(null)
        const ask = props.onAskAi
        if (typeof ask !== 'function') {
          setMessage({ kind: 'error', text: '当前环境不支持打开 AI 会话。' })
          return
        }
        setBusy(true)
        try {
          await ask(prompt)
        } catch (error) {
          setMessage({ kind: 'error', text: '无法打开会话：' + errorText(error) })
        } finally {
          setBusy(false)
        }
      }

      /**
       * Look one word up in the host's dictionary cascade.
       *
       * The card opens where the word is, so the rectangle of the text it was
       * asked about travels with it: the answer belongs beside the word, not
       * in a corner the eye has to hunt for.
       */
      const lookup = async (word, anchor) => {
        const query = String(word === null || word === undefined ? '' : word).trim()
        if (query.length === 0) return
        const at = anchor === undefined ? null : anchor
        setSelection(null)
        setCtxMenu(null)
        setMarkPop(null)
        setDict({ status: 'loading', word: query, payload: null, error: '', anchor: at })
        try {
          const payload = await wrCall('lookupDict', { word: query })
          setDict({ status: 'ready', word: query, payload, error: '', anchor: at })
        } catch (error) {
          setDict({ status: 'error', word: query, payload: null, error: errorText(error), anchor: at })
        }
      }

      /** Write one highlight for the current selection. */
      const applyHighlight = async (colorStyle) => {
        const target = selection
        if (target === null || typeof wrCall !== 'function') return
        if (!target.canHighlight) {
          setMessage({ kind: 'error', text: target.highlightTitle })
          return
        }
        setBusy(true)
        setMessage(null)
        try {
          await wrCall('addHighlight', {
            bookId,
            chapterUid,
            paragraphIndex: target.paragraphIndex,
            startOffset: target.startOffset,
            endOffset: target.endOffset,
            colorStyle,
          })
          // The write stands: only then is the selection spent. A failure
          // keeps it, so the same range can be retried without reselecting.
          setSelColor(colorStyle)
          clearSelection()
          setMarkPop(null)
          setCtxMenu(null)
          reloadMarks()
          setMessage({ kind: 'ok', text: '已划线' })
        } catch (error) {
          setMessage({ kind: 'error', text: errorText(error) })
        } finally {
          setBusy(false)
        }
      }

      /** Repaint one existing mark with another colour. */
      const changeMarkColor = async (colorStyle) => {
        const pop = markPop
        if (pop === null || typeof wrCall !== 'function') return
        setBusy(true)
        try {
          await wrCall('updateHighlight', { bookId, bookmarkId: pop.highlightId, colorStyle })
          setMarkPop({ ...pop, colorStyle })
          reloadMarks()
          setMessage({ kind: 'ok', text: '已改色' })
        } catch (error) {
          setMessage({ kind: 'error', text: errorText(error) })
        } finally {
          setBusy(false)
        }
      }

      /** Delete one mark. The bubble is already the confirmation. */
      const removeMark = async () => {
        const pop = markPop
        if (pop === null || typeof wrCall !== 'function') return
        setBusy(true)
        try {
          await wrCall('removeHighlight', { bookId, bookmarkId: pop.highlightId })
          setMarkPop(null)
          setNotePop(null)
          reloadMarks()
          setMessage({ kind: 'ok', text: '已删除划线' })
        } catch (error) {
          setMessage({ kind: 'error', text: errorText(error) })
        } finally {
          setBusy(false)
        }
      }

      // The host-level context menu is registered once, outside this
      // component, so the book it should quote is mirrored out here.
      React.useEffect(() => {
        readingContext.bookId = bookId
        readingContext.bookTitle = bookTitle
        return () => {
          if (readingContext.bookId === bookId) {
            readingContext.bookId = ''
            readingContext.bookTitle = ''
          }
        }
      }, [bookId, bookTitle])

      // Marks are cached upstream for minutes, so the reader only re-asks when
      // the window comes back into view and the copy it shows is stale.
      React.useEffect(() => {
        if (markState.status === 'ready') marksFetchedRef.current = Date.now()
      }, [markState])

      React.useEffect(() => {
        if (local) return undefined
        const maybeRefresh = () => {
          if (document.visibilityState !== 'visible') return
          const now = Date.now()
          if (now - marksFetchedRef.current < 20000) return
          marksFetchedRef.current = now
          reloadMarks()
        }
        window.addEventListener('focus', maybeRefresh)
        document.addEventListener('visibilitychange', maybeRefresh)
        return () => {
          window.removeEventListener('focus', maybeRefresh)
          document.removeEventListener('visibilitychange', maybeRefresh)
        }
      }, [local, reloadMarks])

      // The bar is measured after it mounts, so it can be clamped against its
      // real width instead of a guess.
      const selBarRef = React.useRef(null)
      const [selPos, setSelPos] = React.useState(null)
      React.useLayoutEffect(() => {
        const body = bodyRef.current
        const bar = selBarRef.current
        const root = body === null ? null : body.parentElement
        if (selection === null || body === null || bar === null || root === null) {
          setSelPos(null)
          return undefined
        }
        // The bar is absolutely positioned inside the reader root, so every
        // coordinate is taken in that element's space, not the page's.
        const place = () => {
          const box = root.getBoundingClientRect()
          const current = describeSelection()
          const rect = current === null ? selection.rect : current.rect
          setSelPos(
            clampToolbarPosition({
              rect: { left: rect.left - box.left, top: rect.top - box.top, width: rect.width, height: rect.height },
              body: { width: root.clientWidth, height: root.clientHeight },
              toolbar: { width: bar.offsetWidth || 280, height: bar.offsetHeight || 34 },
              gap: 8,
            }),
          )
        }
        place()
        // Scrolling moves the words, not the bar, so the bar is re-placed on
        // the text whenever the reading surface moves under it.
        body.addEventListener('scroll', place, { passive: true })
        window.addEventListener('resize', place)
        return () => {
          body.removeEventListener('scroll', place)
          window.removeEventListener('resize', place)
        }
      }, [selection])

      // The mark bubble and the dictionary card belong to the run of text they
      // describe, so they are placed against that run instead of the panel's
      // lower corner. Both are measured after mount, exactly like the bar.
      const markPopRef = React.useRef(null)
      const dictPopRef = React.useRef(null)
      const [markPos, setMarkPos] = React.useState(null)
      const [dictPos, setDictPos] = React.useState(null)

      /**
       * Place a floating card against a run of text.
       *
       * The live node is preferred over the rectangle captured when the card
       * opened, so a card follows its text while the chapter scrolls; the
       * captured rectangle is the fallback for text that has since re-rendered.
       */
      const placeAgainst = (popNode, measureNode, fallback) => {
        const body = bodyRef.current
        const root = body === null ? null : body.parentElement
        if (popNode === null || popNode === undefined || root === null) return null
        const live = measureNode === null || measureNode === undefined ? null : anchorOf(measureNode)
        const rect = live === null ? fallback : live
        if (rect === null || rect === undefined) return null
        const box = root.getBoundingClientRect()
        return clampToolbarPosition({
          rect: { left: rect.left - box.left, top: rect.top - box.top, width: rect.width, height: rect.height },
          body: { width: root.clientWidth, height: root.clientHeight },
          toolbar: { width: popNode.offsetWidth || 240, height: popNode.offsetHeight || 120 },
          gap: 8,
        })
      }

      React.useLayoutEffect(() => {
        const node = markPopRef.current
        if (markPop === null || node === null) {
          setMarkPos(null)
          return undefined
        }
        const measured = markPop.highlightId.length > 0 ? markRefs.current[markPop.highlightId] : undefined
        const place = () => setMarkPos(placeAgainst(node, measured, markPop.anchor))
        place()
        const body = bodyRef.current
        if (body !== null) body.addEventListener('scroll', place, { passive: true })
        window.addEventListener('resize', place)
        return () => {
          if (body !== null) body.removeEventListener('scroll', place)
          window.removeEventListener('resize', place)
        }
      }, [markPop])

      React.useLayoutEffect(() => {
        const node = dictPopRef.current
        if (dict === null || node === null) {
          setDictPos(null)
          return undefined
        }
        // The word no longer has a live selection behind it, so its captured
        // rectangle is shifted by however far the chapter has scrolled since.
        const body = bodyRef.current
        const startTop = body === null ? 0 : body.scrollTop
        const place = () => {
          const anchor = dict.anchor
          if (anchor === null) return setDictPos(null)
          const delta = body === null ? 0 : startTop - body.scrollTop
          return setDictPos(placeAgainst(node, null, { ...anchor, top: anchor.top + delta }))
        }
        place()
        if (body !== null) body.addEventListener('scroll', place, { passive: true })
        window.addEventListener('resize', place)
        return () => {
          if (body !== null) body.removeEventListener('scroll', place)
          window.removeEventListener('resize', place)
        }
      }, [dict])

      /** Bring the marked run into view once it exists on screen. */
      React.useEffect(() => {
        if (focusId.length === 0 || jumpedRef.current) return
        const node = markRefs.current[focusId]
        if (node === undefined || node === null) return
        jumpedRef.current = true
        if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' })
      }, [focusId, chapterUid, state.status, markState.status])

      /** Jump from the marks drawer to the paragraph that carries a highlight. */
      const jumpToMark = (pick) => {
        const uid = Number(pick && pick.chapterUid)
        const highlightId =
          pick && pick.highlightId !== undefined && pick.highlightId !== null ? String(pick.highlightId) : ''
        setShowMarks(false)
        setNotePop(null)
        const node = highlightId.length > 0 ? markRefs.current[highlightId] : undefined
        const sameChapter = uid > 0 && uid === Number(chapterUid)
        jumpedRef.current = false
        setFocusId(highlightId)
        if (sameChapter && node !== undefined && node !== null) {
          if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' })
          jumpedRef.current = true
          return
        }
        if (uid > 0 && !sameChapter) setChapterUid(uid)
      }

      /** The rectangle of the marked run, in viewport coordinates. */
      const anchorOf = (node) => {
        if (node === null || node === undefined || typeof node.getBoundingClientRect !== 'function') return null
        const rect = node.getBoundingClientRect()
        if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return null
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      }

      /** Open the bubble for an existing mark; a live selection wins. */
      const onMark = (span, event) => {
        if (typeof window.getSelection === 'function') {
          const live = String(window.getSelection())
          if (live.length > 0) return
        }
        const highlightId = span && span.highlightId !== undefined && span.highlightId !== null ? String(span.highlightId) : ''
        if (highlightId.length === 0) return
        // The bubble belongs to the run it describes, so the mark's own
        // rectangle pins it there.
        const target = event !== null && event !== undefined && event.currentTarget !== null ? event.currentTarget : null
        setSelection(null)
        setDict(null)
        setCtxMenu(null)
        setNotePop(null)
        setMarkPop({
          highlightId,
          text: String(span && span.text ? span.text : ''),
          note: String(span && typeof span.note === 'string' ? span.note : ''),
          colorStyle: normalizeMarkColor(span && span.colorStyle),
          anchor: anchorOf(target),
        })
      }

      /** The panel's own right-click menu, opened on a live selection. */
      const openContextMenu = (target, x, y) => {
        setSelection(target)
        setMarkPop(null)
        setDict(null)
        // Keep the menu inside the reader: a right-click near the lower edge
        // would otherwise open a menu that hangs off the panel.
        const root = bodyRef.current === null ? null : bodyRef.current.parentElement
        const limitX = root === null ? Number.POSITIVE_INFINITY : Math.max(0, root.clientWidth - 200)
        const limitY = root === null ? Number.POSITIVE_INFINITY : Math.max(0, root.clientHeight - 210)
        setCtxMenu({ x: Math.min(Math.max(0, x), limitX), y: Math.min(Math.max(0, y), limitY) })
      }

      const value = state.status === 'ready' ? state.value : undefined
      const readLabel =
        syncEnabled === true && activeSeconds >= 60 ? ` · 本次已读 ${Math.round(activeSeconds / 60)} 分钟` : ''
      const meta =
        value === undefined
          ? `《${bookTitle}》`
          : `《${bookTitle || value.bookId}》 · ${value.title}${value.chapterIdx >= 0 ? `（${value.chapterIdx + 1}/${value.chapterCount}）` : ''}${readLabel}`

      const turnPage = (direction) => {
        const element = bodyRef.current
        if (element === null) return
        const page = Math.max(80, Math.floor(element.clientHeight * 0.92))
        if (direction > 0) {
          if (element.scrollTop + element.clientHeight >= element.scrollHeight - 12) {
            if (value !== undefined && value.next !== undefined) setChapterUid(value.next.chapterUid)
            return
          }
          element.scrollBy({ top: page, behavior: 'smooth' })
        } else {
          if (element.scrollTop <= 12) {
            if (value !== undefined && value.previous !== undefined) setChapterUid(value.previous.chapterUid)
            return
          }
          element.scrollBy({ top: -page, behavior: 'smooth' })
        }
      }

      React.useEffect(() => {
        const onKey = (event) => {
          const tag = event.target && event.target.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA') return
          if (event.key === 'ArrowRight' || event.key === ' ') {
            event.preventDefault()
            turnPage(1)
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault()
            turnPage(-1)
          }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [chapterUid, state.status, value && value.next && value.next.chapterUid, value && value.previous && value.previous.chapterUid])

      const chapterPercent = Math.round(Math.max(0, Math.min(1, chapterRatio)) * 100)
      const bookPercent =
        value !== undefined && value.chapterCount > 0
          ? Math.round(((Math.max(0, value.chapterIdx) + chapterRatio) / value.chapterCount) * 100)
          : 0

      return h(
        'div',
        { className: 'wr-reader' },
        h(
          'div',
          { className: 'wr-readerBar' },
          h('button', { className: 'wr-btn', onClick: onBack }, '←'),
          h(
            'button',
            {
              className: 'wr-btn',
              disabled: value === undefined || value.previous === undefined,
              onClick: () => value !== undefined && value.previous !== undefined && setChapterUid(value.previous.chapterUid),
            },
            '上一章',
          ),
          h(
            'button',
            {
              className: 'wr-btn',
              disabled: value === undefined || value.next === undefined,
              onClick: () => value !== undefined && value.next !== undefined && setChapterUid(value.next.chapterUid),
            },
            '下一章',
          ),
          h('button', { className: 'wr-btn', onClick: () => setShowCatalog((shown) => !shown) }, '目录'),
          h('button', { className: 'wr-btn', onClick: () => setShowAppearance((shown) => !shown) }, '外观'),
          local
            ? null
            : h(
                'button',
                {
                  className: 'wr-btn',
                  'data-on': String(showMarks),
                  onClick: () => setShowMarks((shown) => !shown),
                },
                '划线',
              ),
          h('div', { className: 'wr-spacer' }),
          h('button', { className: 'wr-btn', title: '减小字号', onClick: () => changeFont(-1) }, 'A-'),
          h('button', { className: 'wr-btn', title: '增大字号', onClick: () => changeFont(1) }, 'A+'),
          !local && typeof props.onSyncToggle === 'function'
            ? h(
                'label',
                { className: 'wr-toggle', title: '把阅读进度回写到微信读书' },
                h('input', {
                  type: 'checkbox',
                  checked: syncLocal,
                  disabled: busy,
                  onChange: () => void toggleSync(),
                }),
                h('span', null, '进度同步'),
              )
            : null,
          !local && syncLocal
            ? h('button', { className: 'wr-btn', disabled: busy, onClick: sync }, busy ? '同步中…' : '同步进度')
            : null,
        ),
        h('div', { className: 'wr-readerMeta', style: { padding: '4px 10px', flex: 'none' } }, meta),
        unconfigured
          ? h('div', { className: 'wr-warn', style: { padding: '0 10px 4px', fontSize: '11px' } }, '配置 API Key 后可显示划线')
          : null,
        markFailed
          ? h(
              'div',
              { className: 'wr-warn', style: { padding: '0 10px 4px', fontSize: '11px' } },
              `划线读取失败：${errorText(markState.error)}`,
            )
          : null,
        showCatalog && value !== undefined
          ? h(CatalogList, {
              chapters: value.chapters,
              activeUid: chapterUid,
              onPick: (uid) => {
                setChapterUid(uid)
                setShowCatalog(false)
              },
            })
          : null,
        showAppearance
          ? h(
              'div',
              { className: 'wr-appearance' },
              h('span', { className: 'wr-appearanceLabel' }, '主题'),
              THEME_LABELS.map(([id, label]) =>
                h(
                  'button',
                  { key: id, className: 'wr-chip', 'data-on': String(appearance.theme === id), onClick: () => updateAppearance({ theme: id }) },
                  label,
                ),
              ),
              h('span', { className: 'wr-appearanceLabel' }, '字号'),
              h('button', { className: 'wr-chip', title: '减小字号', onClick: () => changeFont(-1) }, 'A-'),
              h('span', { className: 'wr-chip', 'data-on': 'true', style: { cursor: 'default' } }, String(appearance.fontSize) + 'px'),
              h('button', { className: 'wr-chip', title: '增大字号', onClick: () => changeFont(1) }, 'A+'),
              h('span', { className: 'wr-appearanceLabel' }, '行距'),
              LINE_LABELS.map(([value_, label]) =>
                h(
                  'button',
                  { key: label, className: 'wr-chip', 'data-on': String(appearance.lineHeight === value_), onClick: () => updateAppearance({ lineHeight: value_ }) },
                  label,
                ),
              ),
              h('span', { className: 'wr-appearanceLabel' }, '字体'),
              FAMILY_LABELS.map(([id, label]) =>
                h(
                  'button',
                  { key: id, className: 'wr-chip', 'data-on': String(appearance.fontFamily === id), onClick: () => updateAppearance({ fontFamily: id }) },
                  label,
                ),
              ),
            )
          : null,
        showMarks && !local
          ? h(BookMarksLoader, { wrCall, bookId, onPick: jumpToMark })
          : null,
        h(
          'div',
          {
            ref: bodyRef,
            onScroll: trackPosition,
            className: `wr-readerBody wr-theme-${appearance.theme}`,
            style: {
              fontSize: `${appearance.fontSize}px`,
              lineHeight: appearance.lineHeight,
              fontFamily: FAMILY_STACKS[appearance.fontFamily] ?? 'inherit',
            },
            onClick: (event) => {
              const live = typeof window.getSelection === 'function' ? String(window.getSelection()) : ''
              if (live.length > 0) return
              // A click on a mark or the bar is an interaction, not a page turn.
              const target = event.target
              if (target !== null && target !== undefined && typeof target.closest === 'function') {
                if (target.closest('.wr-mark') !== null || target.closest('.wr-selBar') !== null) return
                if (target.closest('.wr-menu') !== null || target.closest('.wr-noteDot') !== null) return
              }
              setMarkPop(null)
              setCtxMenu(null)
              const rect = event.currentTarget.getBoundingClientRect()
              const x = (event.clientX - rect.left) / rect.width
              if (x < 0.28) turnPage(-1)
              else if (x > 0.72) turnPage(1)
            },
            onContextMenu: (event) => {
              const live = describeSelection()
              if (live === null) return
              event.preventDefault()
              // The document-level listener in apply() defers to this menu, so
              // one right-click never opens two of them. The flag goes on the
              // native event: the listener is not a React handler.
              const native = event.nativeEvent === undefined || event.nativeEvent === null ? event : event.nativeEvent
              try {
                native.wereadMenuHandled = true
              } catch {
                // A frozen event object only costs the de-duplication flag.
              }
              // The menu is absolutely positioned inside the reader root, not
              // the scrolling body, so it is measured against that box.
              const root = event.currentTarget.parentElement
              const rect = root === null ? event.currentTarget.getBoundingClientRect() : root.getBoundingClientRect()
              openContextMenu(live, event.clientX - rect.left, event.clientY - rect.top)
            },
          },
          h(Loaded, {
            state,
            reload,
            onRelogin: props.onRelogin,
            render: (chapter) => {
              if (chapter.paragraphs.length === 0) {
                return h('div', { className: 'wr-empty' }, '这一章没有可显示的正文。')
              }
              let cursor = 0
              const offsets = chapter.paragraphs.map((paragraph) => {
                const start = cursor
                cursor += paragraph.length
                return start
              })
              const spans = markSpans
              const body = h(
                'div',
                { className: 'wr-readerText', key: 'body' },
                chapter.paragraphs.map((paragraph, index) =>
                  h(
                    'p',
                    {
                      key: index,
                      ref: (node) => {
                        paragraphRefs.current[index] = node
                      },
                      'data-start': offsets[index],
                      'data-length': paragraph.length,
                    },
                    // The paragraph is sliced into runs, never re-parsed as HTML:
                    // the reader's own annotations stay escaped text.
                    paragraphChildren(paragraph, spans[index], {
                      focusId,
                      registerMark: (id, node) => {
                        if (node === null || node === undefined) delete markRefs.current[id]
                        else markRefs.current[id] = node
                      },
                      onNote: (span) => setNotePop({ text: String(span.note || ''), highlightId: String(span.highlightId || '') }),
                      onMark,
                    }),
                  ),
                ),
              )
              const end = h(
                'div',
                { className: 'wr-chapterEnd', key: 'end' },
                chapter.next !== undefined
                  ? h(
                      'button',
                      { className: 'wr-btn wr-btnPrimary', onClick: () => setChapterUid(chapter.next.chapterUid) },
                      '下一章',
                    )
                  : h('span', { className: 'wr-faint' }, '已是最后一章'),
              )
              return [body, end]
            },
          }),
        ),
        h(
          'div',
          { className: 'wr-dock' },
          h(
            'div',
            { className: 'wr-progress' },
            h('div', { className: 'wr-progressFill', style: { width: `${chapterPercent}%` } }),
          ),
          h(
            'div',
            { className: 'wr-dockRow' },
            h(
              'div',
              { className: 'wr-faint' },
              value === undefined
                ? '本章'
                : `本章 ${chapterPercent}% · 全书约 ${bookPercent}%${value.chapterIdx >= 0 ? ` · ${value.chapterIdx + 1}/${value.chapterCount}` : ''}`,
            ),
            h('div', { className: 'wr-spacer' }),
            local
              ? h('span', { className: 'wr-faint' }, '本地书')
              : h('span', { className: 'wr-faint' }, '已勾选 ' + highlightCount + ' 条 · 划线 ' + (highlightCount + thoughtCount) + ' 条'),
            h('span', { className: 'wr-faint' }, '← → / 空格翻页'),
          ),
        ),
        notePop !== null
          ? h(
              'div',
              { className: 'wr-notePop' },
              h(
                'div',
                { className: 'wr-notePopHead' },
                h('span', null, '想法'),
                h('div', { className: 'wr-spacer' }),
                h(
                  'button',
                  { className: 'wr-btn', style: { padding: '0 6px', fontSize: '11px' }, onClick: () => setNotePop(null) },
                  '关闭',
                ),
              ),
              h('div', { className: 'wr-notePopText' }, notePop.text),
              h(
                'div',
                { className: 'wr-actions' },
                h('button', { className: 'wr-btn', onClick: () => setShowMarks(true) }, '本书划线'),
                notePop.highlightId.length > 0
                  ? h(
                      'button',
                      { className: 'wr-btn', onClick: () => jumpToMark({ chapterUid, highlightId: notePop.highlightId }) },
                      '定位原文',
                    )
                  : null,
              ),
            )
          : null,
        // The floating bar: colours first, then the one-shot actions. A bar
        // whose selection spans two paragraphs keeps every action but 划线.
        selection !== null
          ? h(
              'div',
              {
                ref: selBarRef,
                className: 'wr-selBar',
                style: selPos === null ? { left: -9999, top: -9999 } : { left: selPos.left, top: selPos.top },
                // The bar must not be torn down by the click that presses it.
                onMouseDown: (event) => event.preventDefault(),
              },
              MARK_COLOR_LABELS.map((label, color) =>
                h('button', {
                  key: 'c' + color,
                  type: 'button',
                  className: 'wr-dot',
                  'data-color': String(color),
                  'data-on': String(selColor === color),
                  title: '用' + label + '色划线',
                  'aria-label': '用' + label + '色划线',
                  disabled: !selection.canHighlight || busy,
                  onClick: () => void applyHighlight(color),
                }),
              ),
              h(
                'button',
                {
                  className: 'wr-btn',
                  title: selection.highlightTitle || '划线',
                  disabled: !selection.canHighlight || busy,
                  onClick: () => void applyHighlight(selColor),
                },
                '划线',
              ),
              selection.word.length > 0
                ? h('button', { className: 'wr-btn', disabled: busy, onClick: () => void lookup(selection.word, selection.rect) }, '查词')
                : null,
              h('button', { className: 'wr-btn', disabled: busy, onClick: () => void askAi('explain') }, 'AI 理解'),
              h('button', { className: 'wr-btn', disabled: busy, onClick: () => void askAi('chat') }, '问 AI'),
              h('button', { className: 'wr-btn', onClick: () => void copyText(selection.text) }, '复制'),
              h(
                'button',
                { className: 'wr-btn', title: '关闭', onClick: clearSelection },
                '×',
              ),
            )
          : null,
        // One existing mark: recolour it, delete it, or go to its source text.
        markPop !== null
          ? h(
              'div',
              {
                ref: markPopRef,
                className: 'wr-markPop wr-notePop',
                style: markPos === null ? { left: -9999, top: -9999 } : { left: markPos.left, top: markPos.top },
              },
              h(
                'div',
                { className: 'wr-notePopHead' },
                h('span', null, '划线'),
                h('div', { className: 'wr-spacer' }),
                h(
                  'button',
                  { className: 'wr-btn', style: { padding: '0 6px', fontSize: '11px' }, onClick: () => setMarkPop(null) },
                  '关闭',
                ),
              ),
              h('div', { className: 'wr-markPopText' }, markPop.text.length > 0 ? markPop.text : '（这一段划线）'),
              markPop.note.length > 0 ? h('div', { className: 'wr-markPopNote' }, markPop.note) : null,
              h(
                'div',
                { className: 'wr-actions', style: { marginBottom: '6px' } },
                MARK_COLOR_LABELS.map((label, color) =>
                  h('button', {
                    key: 'm' + color,
                    type: 'button',
                    className: 'wr-dot',
                    'data-color': String(color),
                    'data-on': String(markPop.colorStyle === color),
                    title: '改为' + label + '色',
                    'aria-label': '改为' + label + '色',
                    disabled: busy,
                    onClick: () => void changeMarkColor(color),
                  }),
                ),
              ),
              h(
                'div',
                { className: 'wr-actions' },
                h('button', { className: 'wr-btn', disabled: busy, onClick: () => void removeMark() }, '删除划线'),
                h('button', { className: 'wr-btn', onClick: () => setShowMarks(true) }, '本书划线'),
                markPop.highlightId.length > 0
                  ? h(
                      'button',
                      { className: 'wr-btn', onClick: () => jumpToMark({ chapterUid, highlightId: markPop.highlightId }) },
                      '定位原文',
                    )
                  : null,
              ),
            )
          : null,
        // The dictionary card, which is book-agnostic and works offline for
        // local books too.
        dict !== null
          ? h(
              'div',
              {
                ref: dictPopRef,
                className: 'wr-dictPop wr-notePop',
                style: dictPos === null ? { left: -9999, top: -9999 } : { left: dictPos.left, top: dictPos.top },
              },
              h(
                'div',
                { className: 'wr-notePopHead' },
                h('span', null, '查词'),
                h('div', { className: 'wr-spacer' }),
                h(
                  'button',
                  { className: 'wr-btn', style: { padding: '0 6px', fontSize: '11px' }, onClick: () => setDict(null) },
                  '关闭',
                ),
              ),
              dict.status === 'loading' ? h('div', { className: 'wr-dictEmpty' }, '查询中…') : null,
              dict.status === 'error' ? h('div', { className: 'wr-dictEmpty' }, dict.error) : null,
              dict.status === 'ready'
                ? (() => {
                    const view = dictLines(dict.payload)
                    if (view.empty) return h('div', { className: 'wr-dictEmpty' }, '没查到这个词')
                    return h(
                      'div',
                      null,
                      h('div', { className: 'wr-dictWord' }, view.word.length > 0 ? view.word : dict.word),
                      view.phonetic.length > 0 ? h('div', { className: 'wr-dictPhonetic' }, view.phonetic) : null,
                      view.lines.map((line, index) => h('div', { className: 'wr-dictLine', key: index }, line)),
                      view.sourceLabel.length > 0 ? h('div', { className: 'wr-dictSource' }, '来源：' + view.sourceLabel) : null,
                      h(
                        'div',
                        { className: 'wr-actions' },
                        h('button', { className: 'wr-btn', onClick: () => void copyText(view.lines.join('\n')) }, '复制'),
                        h('button', { className: 'wr-btn', onClick: () => setDict(null) }, '关闭'),
                      ),
                    )
                  })()
                : null,
            )
          : null,
        // The panel's own context menu. It is a surface inside the reader, so
        // the browser's own menu is never opened for a selection.
        ctxMenu !== null
          ? h(
              'div',
              {
                className: 'wr-menu',
                style: { left: ctxMenu.x, top: ctxMenu.y },
                onMouseDown: (event) => event.preventDefault(),
              },
              h(
                'div',
                { className: 'wr-menuRow' },
                MARK_COLOR_LABELS.map((label, color) =>
                  h('button', {
                    key: 'x' + color,
                    type: 'button',
                    className: 'wr-dot',
                    'data-color': String(color),
                    'data-on': String(selColor === color),
                    title: '用' + label + '色划线',
                    'aria-label': '用' + label + '色划线',
                    disabled: selection === null || !selection.canHighlight || busy,
                    onClick: () => void applyHighlight(color),
                  }),
                ),
              ),
              selection !== null && selection.word.length > 0
                ? h('button', { className: 'wr-menuItem', onClick: () => void lookup(selection.word, selection.rect) }, '查词')
                : null,
              h('button', { className: 'wr-menuItem', onClick: () => selection !== null && void copyText(selection.text) }, '复制'),
              h('div', { className: 'wr-menuSep' }),
              h('button', { className: 'wr-menuItem', onClick: () => void askAi('explain') }, 'AI 理解'),
              h('button', { className: 'wr-menuItem', onClick: () => void askAi('chat') }, '问 AI'),
            )
          : null,
        message !== null
          ? h('p', { className: message.kind === 'ok' ? 'wr-ok' : 'wr-error', style: { padding: '0 10px 8px' } }, message.text)
          : null,
      )
    }

    /** The chapter list the reader jumps through. */
    function CatalogList(props) {
      return h(
        'div',
        { className: 'wr-catalog' },
        props.chapters.map((chapter) =>
          h(
            'div',
            {
              key: chapter.chapterUid,
              className: 'wr-catalogItem',
              'data-active': String(chapter.chapterUid === props.activeUid),
              onClick: () => props.onPick(chapter.chapterUid),
            },
            chapter.title || `第 ${chapter.chapterIdx + 1} 章`,
          ),
        ),
      )
    }

    // --- 设置 -----------------------------------------------------------------

    function SearchView(props) {
      const [keyword, setKeyword] = React.useState('')
      const [submitted, setSubmitted] = React.useState('')
      const [selected, setSelected] = React.useState(null)
      const [state, reload] = useLoader(
        () => (submitted.length === 0 ? Promise.resolve({ keyword: '', count: 0, results: [] }) : props.wrCall('search', { keyword: submitted, count: 20 })),
        [submitted],
      )
      if (selected !== null) {
        return h(BookDetail, {
          book: selected,
          wrCall: props.wrCall,
          wrOpenReader: props.wrOpenReader,
          onOpenNotes: props.onOpenNotes,
          onRead: props.onRead,
          onRelogin: props.onRelogin,
          readerReady: props.readerReady,
          cookieReady: props.cookieReady,
          positions: props.positions,
          onBack: () => setSelected(null),
        })
      }
      return h(
        'div',
        { className: 'wr-body' },
        h(
          'div',
          { className: 'wr-field' },
          h('input', {
            className: 'wr-input',
            value: keyword,
            placeholder: '搜索书名、作者…',
            onChange: (event) => setKeyword(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && keyword.trim().length > 0) setSubmitted(keyword.trim())
            },
          }),
        ),
        h(
          'div',
          { className: 'wr-actions' },
          h(
            'button',
            {
              className: 'wr-btn wr-btnPrimary',
              onClick: () => keyword.trim().length > 0 && setSubmitted(keyword.trim()),
            },
            '搜索',
          ),
        ),
        submitted.length === 0
          ? h('div', { className: 'wr-empty' }, '在书城搜索一本书，点开后可看目录或直接阅读。')
          : h(Loaded, {
              state,
              reload,
              onRelogin: props.onRelogin,
              render: (found) =>
                found.results.length === 0
                  ? h('div', { className: 'wr-empty' }, `「${found.keyword}」没有结果。`)
                  : h(
                      'ul',
                      { className: 'wr-list' },
                      found.results.map((item) =>
                        h(
                          'li',
                          {
                            key: item.bookId,
                            className: 'wr-item',
                            onClick: () => setSelected(item),
                          },
                          h('div', { className: 'wr-title' }, `《${item.title}》`),
                          h('div', { className: 'wr-faint' }, [item.author, formatRating(item.rating)].filter(Boolean).join(' · ')),
                        ),
                      ),
                    ),
            }),
      )
    }

    function SettingsView(props) {
      const [state, reload] = useLoader(() => props.wrCall('status'))
      const [cookie, setCookie] = React.useState('')
      const [apiKey, setApiKey] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState(null)
      const [qr, setQr] = React.useState(null)
      const status = state.status === 'ready' ? state.value : undefined
      const autoQr = props.autoQr === true

      const run = async (operation) => {
        setBusy(true)
        setMessage(null)
        try {
          setMessage({ kind: 'ok', text: await operation() })
        } catch (error) {
          setMessage({ kind: 'error', text: errorText(error) })
        } finally {
          setBusy(false)
        }
      }

      const startQr = () =>
        run(async () => {
          const started = await props.wrCall('qrStart')
          setQr(started)
          void Promise.resolve(props.wrCall('qrComplete', { uid: started.uid }))
            .then(() => {
              setQr(null)
              reload()
              setMessage({ kind: 'ok', text: '扫码登录成功。' })
            })
            .catch((error) => {
              setMessage({ kind: 'error', text: errorText(error) })
            })
          return '请用微信扫描下方二维码。'
        })

      const save = () => {
        if (cookie.trim().length === 0) {
          setMessage({ kind: 'error', text: '请先粘贴 Cookie。' })
          return
        }
        return run(async () => {
          await props.wrCall('configure', { cookie: cookie.trim() })
          setCookie('')
          reload()
          return '已保存 Cookie。'
        })
      }

      const saveKey = () => {
        if (apiKey.trim().length === 0) {
          setMessage({ kind: 'error', text: '请先填入 API Key。' })
          return
        }
        return run(async () => {
          await props.wrCall('configure', { apiKey: apiKey.trim() })
          setApiKey('')
          reload()
          return '已保存 API Key。'
        })
      }

      const clearKey = () =>
        run(async () => {
          await props.wrCall('configure', { apiKey: '' })
          reload()
          return '已清除 API Key，划线不再显示。'
        })

      const logout = () =>
        run(async () => {
          await props.wrCall('logout')
          setQr(null)
          reload()
          return '已退出登录，回到演示模式。'
        })

      const toggleSync = (value) =>
        run(async () => {
          await props.wrCall('configure', { syncProgress: value })
          reload()
          return value ? '已开启进度回写。' : '已关闭进度回写。'
        })

      React.useEffect(() => {
        if (autoQr !== true || qr !== null || busy) return undefined
        startQr()
        if (typeof props.onAutoQrConsumed === 'function') props.onAutoQrConsumed()
        return undefined
      }, [autoQr])

      return h(
        'div',
        { className: 'wr-body' },
        h(
          'div',
          { className: 'wr-card' },
          h('h3', { className: 'wr-title' }, '连接状态'),
          state.status === 'loading'
            ? h('div', { className: 'wr-faint' }, '读取中…')
            : state.status === 'error'
              ? h('p', { className: 'wr-error' }, errorText(state.error))
              : h(
                  'ul',
                  { className: 'wr-list' },
                  h('li', { className: 'wr-faint' }, `登录：${status.cookieConfigured ? '已登录' : '未登录（演示模式）'}`),
                  status.cookieConfigured
                    ? h('li', { className: 'wr-faint' }, `Cookie：${status.cookieNames.join(', ')}`)
                    : null,
                  h(
                    'li',
                    { className: 'wr-faint' },
                    status.apiKeyConfigured
                      ? `API Key：已配置（${status.apiKeyHint}）`
                      : 'API Key：未配置（划线、想法与笔记需要它）',
                  ),
                  h('li', { className: 'wr-faint' }, `数据目录：${status.dataDir}`),
                ),
          h(
            'div',
            { className: 'wr-actions' },
            h('button', { className: 'wr-btn', disabled: busy, onClick: () => reload() }, '刷新状态'),
            status !== undefined && status.cookieConfigured
              ? h('button', { className: 'wr-btn', disabled: busy, onClick: logout }, '退出登录')
              : null,
          ),
        ),
        h(
          'div',
          { className: 'wr-card' },
          h('h3', { className: 'wr-title' }, '微信扫码登录'),
          h('p', { className: 'wr-faint' }, '用微信扫描二维码，在手机上确认后即可同步书架。'),
          h(
            'div',
            { className: 'wr-actions' },
            h('button', { className: 'wr-btn wr-btnPrimary', disabled: busy, onClick: startQr }, busy && qr === null ? '正在生成…' : '开始扫码'),
          ),
          qr !== null
            ? h('div', {
                className: 'wr-qr',
                dangerouslySetInnerHTML: { __html: qr.qrSvg },
              })
            : null,
        ),
        h(
          'div',
          { className: 'wr-card' },
          h('h3', { className: 'wr-title' }, 'API Key'),
          h(
            'p',
            { className: 'wr-faint' },
            '书架、进度用 Cookie；划线、想法与笔记统计走 Agent API，需要以 wrk- 开头的 Key。',
          ),
          h(
            'div',
            { className: 'wr-field' },
            h('input', {
              className: 'wr-input',
              type: 'password',
              value: apiKey,
              placeholder: 'wrk-…',
              spellCheck: false,
              autoComplete: 'off',
              onChange: (event) => setApiKey(event.target.value),
            }),
          ),
          h(
            'div',
            { className: 'wr-actions' },
            h('button', { className: 'wr-btn wr-btnPrimary', disabled: busy, onClick: saveKey }, '保存 API Key'),
            h(
              'button',
              {
                className: 'wr-btn',
                disabled: busy,
                onClick: () => {
                  if (typeof window !== 'undefined') window.open(API_KEY_URL, '_blank', 'noopener,noreferrer')
                },
              },
              '去领取',
            ),
            status !== undefined && status.apiKeyConfigured
              ? h('button', { className: 'wr-btn', disabled: busy, onClick: clearKey }, '清除')
              : null,
          ),
        ),
        h(
          'div',
          { className: 'wr-card' },
          h('h3', { className: 'wr-title' }, '粘贴 Cookie'),
          h(
            'p',
            { className: 'wr-faint' },
            '从已登录的 weread.qq.com 复制完整 Cookie 头（须含 wr_vid 与 wr_skey）。',
          ),
          h(
            'div',
            { className: 'wr-field' },
            h('textarea', {
              className: 'wr-input',
              rows: 3,
              value: cookie,
              placeholder: 'wr_vid=…; wr_skey=…; wr_rt=…',
              spellCheck: false,
              onChange: (event) => setCookie(event.target.value),
            }),
          ),
          h(
            'div',
            { className: 'wr-actions' },
            h('button', { className: 'wr-btn wr-btnPrimary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存 Cookie'),
          ),
        ),
        h(
          'div',
          { className: 'wr-card' },
          h('h3', { className: 'wr-title' }, '进度回写'),
          h('p', { className: 'wr-faint' }, '打开后，阅读器会把当前章节与阅读时长写回微信读书。'),
          h(
            'label',
            { className: 'wr-toggle' },
            h('input', {
              type: 'checkbox',
              checked: status !== undefined && status.syncProgress === true,
              disabled: busy,
              onChange: (event) => toggleSync(event.target.checked),
            }),
            h('span', null, status !== undefined && status.syncProgress === true ? '已开启' : '已关闭'),
          ),
        ),
        message !== null ? h('p', { className: message.kind === 'ok' ? 'wr-ok' : 'wr-error' }, message.text) : null,
        h('p', { className: 'wr-faint', style: { marginTop: 10 } }, '凭据以 0600 权限保存在本机，只发给 weread.qq.com。'),
      )
    }

    // --- 面板 -----------------------------------------------------------------

    function WereadTab(props) {
      const remoteCall = props.wrCall
      const wrOpenReader = props.wrOpenReader
      // The centre panel and the right sidebar render the same five tabs;
      // only the shell differs, so the panel does not fork the whole view.
      const panel = props.panel === true
      const [view, setView] = React.useState('now')
      const [notesBook, setNotesBook] = React.useState(undefined)
      const [nonce, setNonce] = React.useState(0)
      const [reader, setReader] = React.useState(null)
      // The reader's AI face is a conversation of its own, opened in place
      // instead of in the main column: the book stays where it is.
      const [chat, setChat] = React.useState(null)
      const [sessionExpired, setSessionExpired] = React.useState(false)
      const [autoQr, setAutoQr] = React.useState(false)
      // Mirrors the host's remembered positions, so opening a book resumes it
      // even before the next status read lands.
      const [positions, setPositions] = React.useState({})
      const wrCall = React.useCallback(
        async (endpoint, payload, signal) => {
          try {
            const value = await remoteCall(endpoint, payload, signal)
            return value
          } catch (error) {
            if (isSessionError(error) && endpoint !== 'status') setSessionExpired(true)
            throw error
          }
        },
        [remoteCall],
      )
      // One local status read decides whether the in-panel reader is offered
      // at all, so the views never show a button that can only fail.
      const [statusState, reloadStatus] = useLoader(() =>
        typeof wrCall === 'function'
          ? wrCall('status')
          : Promise.resolve({ cookieConfigured: false, syncProgress: false }),
      )
      const status = statusState.status === 'ready' ? statusState.value : undefined
      const readerReady =
        status !== undefined && (status.cookieConfigured === true || status.demoMode === true)
      // Only a Cookie session can decode cloud chapter text, so the views below
      // need that fact separately from whether a reader exists at all.
      const cookieReady = status !== undefined && status.cookieConfigured === true
      const syncEnabled = status !== undefined && status.syncProgress === true
      // Quoting a passage into the AI workspace needs a host service the tab
      // cannot reach itself; the injected face carries the callback, and a
      // shell without it simply leaves the button out of the reader.
      const askAi = typeof props.wrAskAi === 'function' ? props.wrAskAi : undefined

      /**
       * Hand a prompt to a conversation shown inside this panel.
       *
       * The host prepares the Session and returns its id; the pane below mounts
       * it here, so the reader never leaves the book for the main column.
       */
      const askInPanel = async (prompt) => {
        if (askAi === undefined) throw new Error('当前环境不支持打开 AI 会话。')
        const sessionId = await askAi(prompt)
        if (typeof sessionId !== 'string' || sessionId.length === 0) {
          throw new Error('会话没有建立起来，请重试。')
        }
        // A shell that seats this tab without a session kit has nowhere to put
        // a conversation; there the host reveals it in the column instead.
        if (typeof props.renderSlot === 'function' && typeof props.SessionProvider === 'function') {
          setChat({ sessionId })
        } else if (typeof props.wrReveal === 'function') {
          props.wrReveal(sessionId)
        }
        return sessionId
      }

      const relogin = () => {
        setReader(null)
        setView('settings')
        setAutoQr(true)
        setSessionExpired(false)
      }

      React.useEffect(() => {
        if (status !== undefined && status.positions !== undefined) setPositions(status.positions)
      }, [status])

      /** Remember the chapter a book is open at, here and on the host. */
      const remember = (bookId, chapterUid) => {
        const uid = Number(chapterUid)
        if (!Number.isFinite(uid) || uid <= 0) return
        // Functional update: two calls in one turn (open, then the first page
        // tick) must not both branch off the same stale snapshot.
        setPositions((previous) => ({ ...previous, [String(bookId)]: { chapterUid: uid, updatedAt: Date.now() } }))
        if (typeof wrCall === 'function') {
          void Promise.resolve(wrCall('rememberPosition', { bookId, chapterUid: uid })).catch(() => {})
        }
      }

      const openNotes = (book) => {
        setNotesBook(book)
        setView('notes')
      }

      /** Persist one reading-appearance change, then re-read the status. */
      const saveAppearance = (next) => {
        if (typeof wrCall !== 'function') return
        Promise.resolve(wrCall('configure', { reader: next }))
          .then(() => reloadStatus())
          .catch(() => {
            // The reader keeps the value it already applied; a failed write
            // only means it will not survive the next open.
          })
      }

      /** Flip the host's 进度回写 switch from inside the reader. */
      const setSyncProgress = (value) => {
        if (typeof wrCall !== 'function') return Promise.resolve()
        return Promise.resolve(wrCall('configure', { syncProgress: value === true })).then(() => reloadStatus())
      }

      /** Open the in-panel reader at a chapter, or at the book's first one. */
      const openReader = (request) => {
        if (request === null || request === undefined) return
        const chapterUid = Number(request.chapterUid) > 0 ? Number(request.chapterUid) : Number(request.firstChapterUid)
        if (!Number.isFinite(chapterUid) || chapterUid <= 0) return
        // A local book reads through the local library and carries no marks,
        // but its position is remembered the same way: the host keeps positions
        // in its own settings file, never in the account.
        const format = request.format === 'local' ? 'local' : 'cloud'
        remember(request.bookId, chapterUid)
        setReader({
          bookId: request.bookId,
          chapterUid,
          title: request.title ?? '',
          format,
          focusId: request.focusId === undefined || request.focusId === null ? '' : String(request.focusId),
        })
      }

      const tabs = [
        ['now', '在读'],
        ['shelf', '书架'],
        ['search', '书城'],
        ['notes', '笔记'],
        ['settings', '设置'],
      ]

      // A local book never touches the WeRead gateway, so a stale login must not
      // paint a warning over text that reads perfectly well offline.
      const banner = sessionExpired && !(reader !== null && reader.format === 'local')
        ? h(
            'div',
            { className: 'wr-banner' },
            h('span', null, '登录已过期'),
            h(
              'div',
              { className: 'wr-bannerActions' },
              h('button', { className: 'wr-btn wr-btnPrimary', onClick: relogin }, '重新登录'),
            ),
          )
        : null

      if (reader !== null) {
        const readerNode = h(ReaderView, {
          wrCall,
          bookId: reader.bookId,
          bookTitle: reader.title,
          bookFormat: reader.format,
          focusId: reader.focusId,
          chapterUid: reader.chapterUid,
          syncEnabled,
          readerSettings: status === undefined ? undefined : status.reader,
          onAppearance: saveAppearance,
          onSyncToggle: setSyncProgress,
          onChapter: (uid) => remember(reader.bookId, uid),
          onRelogin: relogin,
          cookieReady,
          onAskAi: askInPanel,
          onBack: () => setReader(null),
        })
        const chatNode = chat === null
          ? null
          : h(ChatPane, {
              sessionId: chat.sessionId,
              wrRetain: props.wrRetain,
              SessionProvider: props.SessionProvider,
              renderSlot: props.renderSlot,
              onBack: () => setChat(null),
            })
        // The panel is wide enough to keep the book beside the conversation, so
        // the passage stays in view while the answer arrives. The narrow sidebar
        // has no room for two columns: there the chat takes the reader's place.
        if (panel) {
          return h(
            'div',
            { className: 'wr-panel', style: PANEL_STYLE },
            banner,
            h(
              'div',
              { className: 'wr-split' },
              h('div', { className: 'wr-splitMain' }, h('div', { className: 'wr-panelReader' }, readerNode)),
              chatNode === null ? null : h('div', { className: 'wr-splitSide' }, chatNode),
            ),
          )
        }
        return h('div', { className: 'wr-root' }, banner, chatNode === null ? readerNode : chatNode)
      }

      let body
      if (typeof remoteCall !== 'function') {
        body = h('div', { className: 'wr-body' }, h('p', { className: 'wr-error' }, '客户端没有拿到宿主通道，请重新加载页面。'))
      } else if (view === 'shelf') {
        body = h(ShelfView, {
          key: `shelf${nonce}`,
          wrCall,
          wrOpenReader,
          onOpenNotes: openNotes,
          onRead: openReader,
          onLocalRead: openReader,
          onRelogin: relogin,
          readerReady,
          cookieReady,
          positions,
          refresh: false,
        })
      } else if (view === 'search') {
        body = h(SearchView, {
          key: `search${nonce}`,
          wrCall,
          wrOpenReader,
          onOpenNotes: openNotes,
          onRead: openReader,
          onRelogin: relogin,
          readerReady,
          cookieReady,
          positions,
        })
      } else if (view === 'notes') {
        body = h(NotesView, { key: `notes${nonce}`, wrCall, initialBook: notesBook, onRelogin: relogin })
      } else if (view === 'settings') {
        body = h(SettingsView, {
          key: `settings${nonce}`,
          wrCall,
          wrOpenReader,
          autoQr,
          onAutoQrConsumed: () => setAutoQr(false),
        })
      } else {
        body = h(NowView, {
          key: `now${nonce}`,
          wrCall,
          wrOpenReader,
          onRead: openReader,
          onRelogin: relogin,
          readerReady,
          cookieReady,
          positions,
          wrGoNotes: openNotes,
          wrGoShelf: () => setView('shelf'),
        })
      }

      const tabsBar = h(
        'div',
        { className: panel ? 'wr-panelTabs' : 'wr-tabs' },
          tabs.map(([id, label]) =>
            h('button', { key: id, className: 'wr-tab', 'data-active': String(view === id), onClick: () => setView(id) }, label),
          ),
          h('div', { className: 'wr-spacer' }),
          h(
            'button',
            { className: 'wr-icon', title: '重新加载', onClick: () => setNonce((value) => value + 1) },
            h(
              'svg',
              { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
              h('path', { d: 'M13 8a5 5 0 1 1-1.5-3.5' }),
              h('path', { d: 'M13 2.5V6H9.5' }),
            ),
          ),
      )

      // The centre panel takes over the whole main column, so it owns its own
      // scrolling surface; the sidebar tab keeps the compact 100%-height shell.
      if (panel === true) {
        return h(
          'div',
          { className: 'wr-panel', style: PANEL_STYLE },
          tabsBar,
          banner,
          h(
            'div',
            { className: 'wr-panelScroll' },
            h(
              'div',
              { className: 'wr-panelInner' },
              h(
                'div',
                { className: 'wr-panelHeadRow' },
                h('h1', { className: 'wr-panelTitle' }, '微信读书'),
                h('span', { className: 'wr-panelHint' }, '在读、书架、书城、笔记与设置，都在这一块面板里'),
              ),
              body,
            ),
          ),
        )
      }

      return h('div', { className: 'wr-root' }, tabsBar, banner, body)
    }

    /** Guide card artwork: an open book. */
    function WereadGuideIcon() {
      return h(
        'svg',
        { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': true },
        h('path', { d: 'M12 6.5C10.4 5.2 8.4 4.6 5.5 4.6v12.9c2.9 0 4.9.6 6.5 1.9 1.6-1.3 3.6-1.9 6.5-1.9V4.6c-2.9 0-4.9.6-6.5 1.9Z' }),
        h('path', { d: 'M12 6.5v12.9' }),
      )
    }

    return {
      inject: ['slots'],
      // The views are exposed for the offline test harness only: the loader
      // reads `inject` and `apply`, and nothing in the page touches this.
      // Without it the views are unreachable — every one of them sits behind a
      // slot body or a loader callback that no test can invoke.
      __views: {
        WereadTab,
        // Pure helpers are exposed here too, so the layout maths is testable
        // without a browser layout engine.
        measurePosition,
        creditReadingTime,
        isOnScreen,
        resumeChapterUid,
        formatReadingTime,
        isSessionError,
        Loaded,
        Progress,
        Cover,
        NowView,
        NowCard,
        ShelfView,
        SearchView,
        ShelfList,
        BookDetail,
        NotesView,
        NotesDetail,
        ReaderView,
        CatalogList,
        SettingsView,
        // Studio additions: the left-rail entry, the centre-panel shell, the
        // local library and the paragraph-level mark renderer.
        WereadSidebarIcon,
        WereadStudioPanel,
        LocalLibrary,
        BookMarksView,
        BookMarksLoader,
        paragraphChildren,
        ChatPanel,
        ChatPane,
        plainSpans,
        normalizeMarkColor,
        formatCharCount,
        isLocalBookId,
        formatImportDate,
        LOCAL_IMPORT_LIMIT,
        // Interaction layer: the selection maths, the prompt builders and the
        // overlay geometry all run without a DOM, so tests call them directly.
        buildSelectionTarget,
        clipAiText,
        buildAiPrompt,
        dictLines,
        clampToolbarPosition,
        MARK_COLOR_LABELS,
        SELECTION_MAX_LENGTH,
        DICT_MAX_WORD_LENGTH,
        AI_TEXT_LIMIT,
        DICT_SOURCE_LABELS,
        readingContext,
      },
      apply(ctx) {
        // The right-Sidebar face is only readable inside a scope that injected
        // it, so it is captured there rather than read off the plugin context.
        let sidebarRight

        /**
         * Hand a prompt to the AI workspace.
         *
         * startSession() opens a blank Session but cannot reliably seed its
         * composer: the draft is applied through the retained binding, and a
         * reused blank Session already carries a stored draft, so "append"
         * becomes "preserved" and the prompt never arrives. Creating the
         * Session first gives us its id, and an id lets us write the draft
         * through the same input shell the composer uses before revealing it.
         */
        const askAiSession = async (prompt) => {
          const host = (name) => (typeof ctx.get === 'function' ? ctx.get(name) : undefined)
          const workspace = host('uiWorkspace')
          if (workspace === undefined || workspace === null || typeof workspace.startSession !== 'function') {
            throw new Error('当前环境没有可用的 AI 工作区')
          }
          // The caller mounts the Session itself, so this path never reveals
          // one in the main column: it only prepares it and hands back its id.
          const seeded = await seedDraftSession(prompt, host)
          if (seeded !== false) return seeded
          // Last resort: the host's own path, which does reveal the Session.
          return workspace.startSession(undefined, { prompt, whenDraftExists: 'append' })
        }

        /** The Session the main view is showing, else the most recently active one. */
        const mainCwd = (sessions) => {
          try {
            const rows = Object.values(sessions.list.getSnapshot().byId ?? {})
            const main = rows.find((row) => row !== null && typeof row === 'object' && ((row.retainedBy ?? 0).mainView ?? 0) > 0)
            const pick = (row) => (row !== null && typeof row === 'object' && typeof row.cwd === 'string' ? row.cwd : undefined)
            return pick(main) ?? rows.map(pick).find((value) => value !== undefined)
          } catch {
            // A shell without the Session list simply gets no hint.
          }
          return undefined
        }

        /** The id of the Session the main view is showing, when the list reports one. */
        const mainSessionId = (sessions) => {
          try {
            const rows = Object.values(sessions.list.getSnapshot().byId ?? {})
            const main = rows.find((row) => row !== null && typeof row === 'object' && ((row.retainedBy ?? 0).mainView ?? 0) > 0)
            return main !== undefined && typeof main.id === 'string' ? main.id : undefined
          } catch {
            return undefined
          }
        }

        /**
         * The workspace a new Session belongs to.
         *
         * A Session created with only a cwd is attached to no workspace, and the
         * composer stays inert ("pick a workspace") even though the Session is
         * open. Creating through a workspace id is what makes the composer usable,
         * so the reader resolves one the same way the host's own "new session"
         * button does: the workspace of the visible Session, else one at the same
         * path, else the only workspace there is.
         */
        const preferredWorkspace = (sessions, workspaces) => {
          try {
            if (workspaces === undefined || workspaces === null || typeof workspaces.list?.getSnapshot !== 'function') return undefined
            const items = workspaces.list.getSnapshot().items
            if (!Array.isArray(items) || items.length === 0) return undefined
            const usable = (item) => item !== null && typeof item === 'object' && typeof item.workspaceId === 'string'
            const main = mainSessionId(sessions)
            if (main !== undefined) {
              const holder = items.find((item) => usable(item) && Array.isArray(item.sessionIds) && item.sessionIds.includes(main))
              if (holder !== undefined) return holder
            }
            const cwd = mainCwd(sessions)
            if (cwd !== undefined) {
              const same = items.find((item) => usable(item) && item.path === cwd)
              if (same !== undefined) return same
            }
            const usableItems = items.filter(usable)
            return usableItems.length === 1 ? usableItems[0] : undefined
          } catch {
            // Fall through to the caller's own retry path.
          }
          return undefined
        }

        /**
         * Create a Session and write the prompt into its composer.
         *
         * The Session is deliberately not revealed in the main column: the
         * caller mounts it in the panel it was asked from. Resolves the id, or
         * false when any step of that path is unavailable so the caller can
         * fall back to startSession().
         */
        const seedDraftSession = async (prompt, host) => {
          const sessions = host('sessions')
          const conversation = host('conversation')
          if (sessions === undefined || sessions === null || typeof sessions.create !== 'function') return false
          if (conversation === undefined || conversation === null) return false
          const input = conversation.input
          if (input === undefined || input === null || typeof input.shell !== 'function') return false
          const target = preferredWorkspace(sessions, host('workspaces'))
          if (target === undefined) return false
          const sessionId = await sessions.create({ workspaceId: target.workspaceId })
          if (typeof sessionId !== 'string' || sessionId.length === 0) return false
          const reference = sessions.retain(sessionId, { source: 'weread-studio' })
          try {
            await reference.ready
            // The shell is what the composer renders from, so writing here is
            // the same as typing: the mounted view seeds itself from this state
            // and then persists it, instead of overwriting it.
            input.shell(sessionId).setDraft(prompt)
          } finally {
            reference.release()
          }
          return sessionId
        }

        const notify = (text, success) => {
          try {
            const menus = typeof ctx.get === 'function' ? ctx.get('contextMenus') : undefined
            if (menus !== undefined && menus !== null && typeof menus.notify === 'function') menus.notify(text, success !== false)
          } catch {
            // A shell without notifications still got the action done.
          }
        }

        const face = {
          wrCall: (endpoint, payload) => callRemote(ctx, endpoint, payload),
          wrOpenReader: (url) => openInApp(sidebarRight, url),
          wrAskAi: askAiSession,
          // A shell whose tab cannot host the conversation itself still gets
          // the Session opened where the host would have opened it.
          wrReveal: (sessionId) => {
            const workspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
            if (workspace !== undefined && workspace !== null && typeof workspace.openSession === 'function') {
              workspace.openSession(sessionId)
            }
          },
          // The embedded conversation holds its own reference for as long as
          // it is on screen, so the pane can mount and release a Session.
          wrRetain: (sessionId) => {
            const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
            if (sessions === undefined || sessions === null || typeof sessions.retain !== 'function') {
              throw new Error('当前环境没有会话服务')
            }
            return sessions.retain(sessionId, { source: 'weread-studio' })
          },
        }

        // Styles live in one idempotent tag and are removed with the plugin.
        ctx.effect(() => {
          const tagId = 'dsh-weread/panel.css'
          const existing = document.querySelector(`style[data-plugin-css="${tagId}"]`)
          if (existing !== null) {
            existing.textContent = CSS
            return () => {}
          }
          const tag = document.createElement('style')
          tag.dataset.plugin = 'dsh-weread'
          tag.dataset.pluginCss = tagId
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => {
            tag.remove()
          }
        }, 'dsh-weread: styles')

        // A right-click on a selection inside the reader offers the same
        // actions as the floating bar, through the shell's own menu. The
        // service is optional: a shell without it still has the in-panel bar.
        ctx.inject(['contextMenus'], (scope) => {
          scope.effect(() => {
            const menus = scope.contextMenus
            if (menus === undefined || menus === null || typeof menus.register !== 'function') {
              return () => {}
            }
            const asObject = (candidate) => (candidate !== null && typeof candidate === 'object' ? candidate : {})
            // The shell hands over either the captured target or its value,
            // so both shapes are unwrapped before the payload is read.
            const resolve = (target) => {
              const wrapper = asObject(target)
              const value = wrapper.value !== null && typeof wrapper.value === 'object' ? asObject(wrapper.value) : wrapper
              const text = String(value.text === undefined || value.text === null ? '' : value.text)
              const title = String(value.bookTitle === undefined || value.bookTitle === null ? '' : value.bookTitle)
              if (text.trim().length === 0) return []
              const ask = (kind) => () => {
                askAiSession(buildAiPrompt(kind, { text, bookTitle: title })).catch((error) => {
                  notify('无法打开会话：' + errorText(error), false)
                })
              }
              return [
                { id: 'explain', label: '用 AI 理解这段文字', run: ask('explain') },
                { id: 'chat', label: '和 AI 讨论这段文字', run: ask('chat') },
                {
                  id: 'copy',
                  label: '复制',
                  run: () => {
                    try {
                      void navigator.clipboard.writeText(text)
                    } catch {
                      // Nothing else to offer from a menu item.
                    }
                  },
                },
              ]
            }
            return menus.register({ id: 'weread-selection', target: 'weread.selection', order: 40, resolve })
          }, 'dsh-weread: selection menu')
        })

        // The reader's own bar can only speak for the paragraph it renders in,
        // so the document-level listener mirrors a selection into the host
        // menu. Without the service the listener is never installed.
        try {
          const menus = typeof ctx.get === 'function' ? ctx.get('contextMenus') : undefined
          if (menus !== undefined && menus !== null && typeof menus.open === 'function') {
            ctx.effect(() => {
              const onContextMenu = (event) => {
                if (typeof window.getSelection !== 'function') return
                const sel = window.getSelection()
                if (sel === null || sel === undefined || sel.rangeCount === 0 || sel.isCollapsed) return
                const text = String(sel)
                if (text.trim().length === 0 || text.length > SELECTION_MAX_LENGTH) return
                const node = event.target
                const element = node !== null && node !== undefined && node.nodeType === 1 ? node : node && node.parentElement
                if (element === null || element === undefined || typeof element.closest !== 'function') return
                if (element.closest('.wr-readerText') === null) return
                // The reader draws its own menu and marks the event; opening
                // the host menu as well would stack two menus on one click.
                if (event.wereadMenuHandled === true) return
                event.preventDefault()
                try {
                  menus.open(
                    { kind: 'weread.selection', value: { text, bookTitle: readingContext.bookTitle, bookId: readingContext.bookId } },
                    { x: event.clientX, y: event.clientY },
                  )
                } catch {
                  // A menu that cannot open must not swallow the selection.
                }
              }
              document.addEventListener('contextmenu', onContextMenu)
              return () => document.removeEventListener('contextmenu', onContextMenu)
            }, 'dsh-weread: selection right-click')
          }
        } catch {
          // No context-menu service in this shell.
        }

        // The tab type and its body both wait for the sidebar registry, so
        // activation order never breaks the registration.
        ctx.inject(['sidebarRightTabs', 'sidebarRight'], (scope) => {
          scope.effect(() => {
            sidebarRight = scope.sidebarRight
            return () => {
              sidebarRight = undefined
            }
          }, 'dsh-weread: sidebar face')
          scope.effect(
            () =>
              scope.sidebarRightTabs.register({
                id: TAB_ID,
                kind: TAB_KIND,
                priority: 'extension',
                title: () => '微信读书',
                keepMounted: true,
                guide: [
                  {
                    id: 'open',
                    order: 40,
                    title: () => '微信读书',
                    description: () => '安静封面书架与章节阅读',
                    icon: WereadGuideIcon,
                  },
                ],
              }),
            'dsh-weread: tab type',
          )
        })

        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.pane.tab',
              key: TAB_ID,
              // Declaring the chat slot is what seats this body with the
              // session kit (SessionProvider, renderSlot); without it the
              // reader could only hand prompts to the main column.
              children: { 'weread.chat': { kind: 'single', scope: 'session' } },
              inject: () => face,
            },
            WereadTab,
          ),
        )

        // The conversation the reader opens in place. Its entry carries no
        // children of its own: the factory it renders brings its own.
        ctx.slots.inject('weread.chat', () => ctx.slots.register({ name: 'weread.chat' }, ChatPanel))

        // The left-rail button and the centre panel are a pair: the rail row
        // carries the same id the main slot is keyed by, so a click on it
        // switches the main column to this panel. Both slots are optional
        // (a narrow shell may ship neither), so each mount is probed and
        // unmounted when the slot goes away.
        const mountWhenAvailable = (slotName, mount) => {
          try {
            ctx.slots.inject(slotName, () => {
              const off = mount()
              return () => {
                if (typeof off === 'function') off()
              }
            })
          } catch {
            // Slot missing in this shell: the other entry point still works.
          }
        }

        mountWhenAvailable('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: TAB_ID,
              order: 6,
              label: () => '微信读书',
            },
            (ownerProps) =>
              h(WereadSidebarIcon, {
                size:
                  ownerProps !== null && typeof ownerProps === 'object' && Number.isFinite(ownerProps.size)
                    ? ownerProps.size
                    : 16,
              }),
          ),
        )

        mountWhenAvailable('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: TAB_ID,
              // Same seating as the sidebar body: the panel can hold a
              // conversation of its own instead of sending it to the column.
              children: { 'weread.chat': { kind: 'single', scope: 'session' } },
              inject: () => face,
            },
            // Merge the injected face in explicitly: some shells hand the slot
            // body only the owner props, and the panel cannot call the host
            // without wrCall.
            (ownerProps) =>
              h(WereadStudioPanel, Object.assign({}, ownerProps === null || typeof ownerProps !== 'object' ? {} : ownerProps, face)),
          ),
        )
      },
    }

    /**
     * Open a URL in the right sidebar's Browser tab, falling back to a new
     * browser tab when that plugin is not mounted (Web profiles ship it off).
     */
    function openInApp(sidebarRight, url) {
      if (typeof url !== 'string' || url.length === 0) return
      try {
        if (sidebarRight !== undefined && typeof sidebarRight.openTab === 'function') {
          sidebarRight.openTab(BROWSER_KIND, { params: { url } })
          return
        }
      } catch {
        // Fall through to the browser's own window.
      }
      try {
        window.open(url, '_blank', 'noopener,noreferrer')
      } catch {
        // Nothing else to try.
      }
    }
  },
})
