const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const data = JSON.parse(html.match(/<template id="jersey_number_data">([\s\S]*?)<\/template>/)[1]);
const ctx = vm.createContext({
  jerseyData: () => data,
  jerseySeason: String(data.maxYear), jerseyQuery: '', jerseyRange: 'all',
  S: x => String(x ?? ''),
  jerseyMatchesPlayerFilter: () => true,
  jerseyHistory: number => data.records.filter(row => row.number === number)
});
for (const name of ['jerseyNumbers', 'jerseyAssignments', 'jerseyRetirement', 'jerseySelectedNumbers', 'jerseyMarkingName']) {
  const start = html.indexOf(`function ${name}(`);
  const end = html.indexOf('\nfunction ', start + 1);
  vm.runInContext(html.slice(start, end), ctx);
}
let checks = 0;
// Check real records across every supported year, not just one hard-coded example.
const years = Array.from({length:data.maxYear-data.minYear+1}, (_,i)=>String(data.minYear+i));
for (const season of years) {
  ctx.jerseySeason = season; ctx.jerseyRange = 'all'; ctx.jerseyQuery = '';
  const visible = Array.from(ctx.jerseySelectedNumbers());
  const expected = Array.from(ctx.jerseyNumbers()).filter(number => ctx.jerseyAssignments(number).length || ctx.jerseyRetirement(number));
  assert.deepEqual(visible, expected, season);
  assert.ok(!visible.includes('199'), `${season}: unused high number`);
  for (const number of visible) assert.ok(ctx.jerseyAssignments(number).length || ctx.jerseyRetirement(number), `${season}: ${number}`);
  const absent = Array.from(ctx.jerseyNumbers()).find(n => !expected.includes(n));
  if (absent) { ctx.jerseyQuery = absent; assert.deepEqual(Array.from(ctx.jerseySelectedNumbers()), [], `${season}: searching an unassigned number`); }
  checks++;
}
// '현재 · 자료 기준' 선택지는 없어지고, 최신 자료 연도가 기본 시즌이 된다.
assert.ok(!html.includes('value="current"'), 'no current option');
assert.ok(!html.includes('현재 · 자료 기준'), 'no current label');
assert.ok(html.includes('<select id="jersey-season">${Array.from({length:data.maxYear-data.minYear+1}'), 'year options start at the latest year');
const latest = String(data.maxYear);
ctx.jerseySeason = latest; ctx.jerseyRange = 'all'; ctx.jerseyQuery = '';
assert.deepEqual(Array.from(ctx.jerseyAssignments('24')).map(row => row.name), ['다즈 카메론', '손아섭'], 'latest season keeps players who left during it');
assert.deepEqual(Array.from(ctx.jerseyAssignments('14')).map(row => row.name), ['박계범', '류승민']);
assert.deepEqual(Array.from(ctx.jerseyAssignments('1')).map(row => row.name), ['박치국'], 'current owner is still assigned in the latest season');
const latestVisible = Array.from(ctx.jerseySelectedNumbers());
ctx.jerseySeason = '';
assert.deepEqual(Array.from(ctx.jerseySelectedNumbers()), latestVisible, 'empty season falls back to the latest year');
ctx.jerseySeason = 'current';
assert.deepEqual(Array.from(ctx.jerseySelectedNumbers()), latestVisible, 'a legacy current value falls back to the latest year');
ctx.jerseySeason = '2006'; ctx.jerseyQuery = '랜들'; ctx.jerseyRange = 'all';
assert.ok(Array.from(ctx.jerseySelectedNumbers()).includes('30'));
assert.equal(ctx.jerseyMarkingName('맷 랜들'), '랜들');
ctx.jerseyQuery = ''; ctx.jerseyRange = 'high';
assert.ok(Array.from(ctx.jerseySelectedNumbers()).every(n => Number(n) >= 100 && ctx.jerseyAssignments(n).length));
ctx.jerseyRange = 'retired';
assert.ok(Array.from(ctx.jerseySelectedNumbers()).includes('21'));
assert.ok(Array.from(ctx.jerseySelectedNumbers()).includes('54'));
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (!/\bsrc=|application\/json/.test(match[1])) new vm.Script(match[2]);
}
console.log(`Passed ${checks} season checks, number/name/range regressions and inline JavaScript syntax`);
