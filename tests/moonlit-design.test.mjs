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
