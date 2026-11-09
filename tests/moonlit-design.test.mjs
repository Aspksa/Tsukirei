import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const web=join(import.meta.dirname,'../web');
const app=readFileSync(join(web,'index.html'),'utf8');
const css=readFileSync(join(web,'styles.css'),'utf8');
const studio=readFileSync(join(web,'studio.html'),'utf8');
const main=readFileSync(join(web,'main.js'),'utf8');
test('Moonlit Sanctuary tokens are consistent between app and studio',()=>{
 for(const token of ['--bg:#0b0b13','--panel:#15141f','--panel2:#1e1b2b','--gold:#e6bf78','--text:#f4eff8','--muted:#b8b0c4']){
  assert.ok(css.includes(token),'app '+token);
  assert.ok(studio.includes(token),'studio '+token);
 }
});
test('global navigation is keyboard accessible',()=>{
 assert.match(app,/class="moon-skip" href="#app-main"/);
 assert.match(app,/id="app-main" tabindex="-1"/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(studio,/class="skip-link" href="#main-content"/);
});
test('Moonlit Sanctuary remains a CSS-only design change',()=>{
 assert.match(css,/Moonlit Sanctuary/);
 assert.match(studio,/Moonlit Sanctuary/);
 assert.match(app,/src="\/main.js"/);
 assert.match(app,/href="\/styles.css"/);
});

test('Moonlit Sanctuary II standardizes interaction states across pages',()=>{
 for(const selector of ['.ghost-button:hover:not(:disabled)','.empty-state{','.toast.is-error{','input::placeholder','@media(hover:none)']){
  assert.ok(css.includes(selector),'app '+selector);
 }
 for(const selector of ['.btn:hover:not(:disabled)','.empty{','dialog::backdrop{','.form-field:focus-visible','@media(hover:none)']){
  assert.ok(studio.includes(selector),'studio '+selector);
 }
 assert.match(css,/--moon-focus:#f6dda6/);
 assert.match(studio,/--moon-focus:#f6dda6/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(studio,/prefers-reduced-motion:reduce/);
});

test('Moonlit Sanctuary III protects narrow viewports and dialogs',()=>{
 for(const rule of ['.workspace,.main,.page','.rag-search-controls{flex-wrap:wrap}', '.inline-form{flex-wrap:wrap}', '.topbar-section{overflow:hidden', '@media(max-width:360px)']){
  assert.ok(css.includes(rule),'app '+rule);
 }
 for(const rule of ['.nav{min-width:0;max-width:calc(100vw - 160px);overflow-x:auto','dialog{max-height:calc(100dvh - 30px);overflow-y:auto','@media(max-width:390px)']){
  assert.ok(studio.includes(rule),'studio '+rule);
 }
});

test('mobile navigation is accessible and dismissible',()=>{
 assert.match(app,/id="app-sidebar" aria-label="Навигация"/);
 assert.match(app,/id="mobile-menu"[^>]*aria-controls="app-sidebar" aria-expanded="false"/);
 assert.match(main,/function setMobileMenu\(open\)/);
 assert.match(main,/setAttribute\('aria-expanded',String\(open\)\)/);
 assert.match(main,/event\.target\.closest\('#app-sidebar, #mobile-menu'\)/);
 assert.match(main,/event\.key!=='Escape'/);
 assert.match(main,/matchMedia\('\(min-width: 521px\)'\)/);
 assert.match(css,/\.sidebar\{visibility:hidden;pointer-events:none/);
 assert.match(css,/\.menu-open \.sidebar\{visibility:visible;pointer-events:auto/);
});

test('chat and mobile navigation never stay open together',()=>{
 assert.match(main,/if \(open && el\('shell'\)\.classList\.contains\('menu-open'\)\) setMobileMenu\(false\)/);
 assert.match(main,/if\(open && !el\('chat-panel'\)\.hidden\) \{ toggleChat\(false\); el\('mobile-menu'\)\.focus\(\); \}/);
 assert.match(main,/event\.stopImmediatePropagation\(\)/);
 assert.match(main,/if \(event\.key === 'Escape' && !el\('chat-panel'\)\.hidden\)/);
});

test('mobile drawer cycles keyboard focus and initially focuses navigation',()=>{
 assert.match(main,/if\(opening\) el\('app-sidebar'\)\.querySelector\('\.nav-button'\)\?\.focus\(\)/);
 assert.match(main,/event\.key!=='Tab'/);
 assert.match(main,/focusable\.indexOf\(document\.activeElement\)/);
 assert.match(main,/event\.shiftKey && \(index<=0\)/);
 assert.match(main,/focusable\.at\(-1\)\.focus\(\)/);
 assert.match(main,/focusable\[0\]\.focus\(\)/);
});

test('brain growth chart uses actual local event timestamps and accessible labels',()=>{
 assert.match(app,/id="brain-growth-chart" role="img"/);
 assert.match(app,/id="brain-growth-svg"/);
 assert.match(app,/id="brain-chart-caption" aria-live="polite"/);
 assert.match(main,/function renderBrainGrowthChart\(records,period\)/);
 assert.match(main,/records\.map\(item=>Date\.parse\(item\.at\)\)/);
 assert.match(main,/renderBrainGrowthChart\(visibleRecords,brainGrowthPeriod\)/);
 assert.match(main,/wrap\.setAttribute\('aria-label'/);
 assert.match(css,/\.brain-chart-bar\{/);
 assert.match(css,/prefers-contrast:more/);
});

test('live brain request inspector records only API route metadata',()=>{
 assert.match(app,/id="brain-trace-list" role="log"/);
 assert.match(app,/id="brain-trace-clear"/);
 assert.match(main,/const BRAIN_TRACE_LIMIT=40/);
 assert.match(main,/recordBrainRequest\(path,method,res\.status/);
 assert.match(main,/recordBrainRequest\(path,method,0/);
 assert.match(main,/String\(path\)\.split\('\?'\)\[0\]/);
 assert.match(main,/brainRequestTrace\.unshift\(\{route,method,status,duration,at:new Date\(\)\}\)/);
 assert.match(css,/\.brain-trace-entry\{/);
});

test('live API monitor is a dedicated sidebar page, not embedded in brain',()=>{
 assert.match(app,/data-page="monitor" data-label="Монитор"/);
 assert.match(app,/id="page-monitor" hidden aria-labelledby="monitor-title"/);
 assert.match(app,/id="brain-trace-list" role="log"/);
 assert.match(main,/monitor: 'Монитор'/);
 const monitorStart=app.indexOf('id="page-monitor"');
 const brainStart=app.indexOf('id="page-brain"');
 const traceStart=app.indexOf('id="brain-trace-list"');
 assert.ok(monitorStart>=0 && monitorStart<brainStart);
 assert.ok(traceStart>monitorStart && traceStart<brainStart);
});

test('monitor insights derive only from actual local request trace',()=>{
 assert.match(app,/id="monitor-stats"/);
 assert.match(app,/id="monitor-filter"/);
 assert.match(app,/id="monitor-timeline"/);
 assert.match(main,/const failures=brainRequestTrace\.filter/);
 assert.match(main,/brainRequestTrace\.reduce\(\(sum,e\)=>sum\+e\.duration/);
 assert.match(main,/const filtered=brainRequestTrace\.filter/);
 assert.match(main,/el\('monitor-filter'\)\.addEventListener\('change',renderBrainRequestTrace\)/);
 assert.match(main,/bar\.dataset\.error=String/);
 assert.match(css,/\.monitor-timeline-bar\{/);
});

test('monitor server stage UI is separate and fetches confirmed server records',()=>{
 assert.match(app,/id="monitor-server-steps"/);
 assert.match(app,/id="monitor-server-refresh"/);
 assert.match(main,/api\('\/api\/monitor\/steps'\)/);
 assert.match(main,/function refreshMonitorServerSteps\(/);
 assert.match(main,/if\(page==='monitor'\)void refreshMonitorServerSteps\(\)/);
 assert.match(css,/\.monitor-server-step\{/);
});

test('chat request trace IDs correlate browser and server stages',()=>{
 assert.match(app,/id="monitor-trace-select"/);
 assert.match(main,/res\.headers\.get\('X-Tsukirei-Trace-Id'\)/);
 assert.match(main,/function renderMonitorServerSteps\(/);
 assert.match(main,/item\.traceId===selected/);
 assert.match(css,/\.monitor-trace-picker\{/);
});

test('monitor trace graph uses actual server stage items and accessible buttons',()=>{
 assert.match(app,/id="monitor-trace-graph"/);
 assert.match(app,/id="monitor-graph-detail"[^>]*aria-live="polite"/);
 assert.match(main,/function renderMonitorTraceGraph\(items\)/);
 assert.match(main,/renderMonitorTraceGraph\(items\)/);
 assert.match(main,/button\.setAttribute\('aria-pressed','false'\)/);
 assert.match(main,/chain\.sort\(\(a,b\)=>Number\(a\.id\)-Number\(b\.id\)\)/);
 assert.match(css,/\.monitor-graph-node:focus-visible/);
});
