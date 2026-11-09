import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const js=readFileSync(new URL('../web/main.js',import.meta.url),'utf8');
test('proactive suggestions render in chat without cloud calls or automatic submissions',()=>{
 assert.match(js,/api\('\/api\/soul\/outreach'\)/);
 assert.match(js,/const suggestion=proactiveSuggestions\[0\]/);
 assert.match(js,/Цукирэй · предложение/);
 assert.match(js,/Не сейчас/);
 assert.match(js,/api\('\/api\/soul\/outreach\/dismiss'/);
 assert.match(js,/void refreshProactiveChat\(\)/);
 assert.doesNotMatch(js,/shownProactive/);
});
