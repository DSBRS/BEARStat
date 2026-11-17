const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const data = JSON.parse(html.match(/<template id="jersey_number_data">([\s\S]*?)<\/template>/)[1]);
const ctx = vm.createContext({
  jerseyData: () => data,
  jerseySeason: 'current', jerseyQuery: '', jerseyRange: 'all',
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
for (const season of ['current', ...Array.from({length:data.maxYear-data.minYear+1}, (_,i)=>String(data.minYear+i))]) {
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
