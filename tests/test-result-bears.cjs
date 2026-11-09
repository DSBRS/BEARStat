const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (!/\bsrc=|application\/json/.test(match[1])) new vm.Script(match[2]);
}
const helpers = html.slice(html.indexOf('function resultBearHTML('), html.indexOf('function gameCard('));
const ctx = vm.createContext({
  S: x => x == null ? '' : String(x),
  esc: x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
  isCancelled: e => !!(e && (e.cancelled === true || e.status === 'cancelled' || e.cancelReason)),
  isLiveGame: e => ['live', 'inprogress'].includes(String(e?.status).toLowerCase()),
  hasScore: e => e?.score && typeof e.score === 'object' && String(e.score.d ?? '') !== '' && String(e.score.v ?? '') !== '' && !isNaN(+e.score.d) && !isNaN(+e.score.v),
  RL: { W: '승', L: '패', D: '무' }
});
vm.runInContext(helpers, ctx);
let checks = 0;
for (const type of ['kbo', 'national']) for (const homeAway of ['home', 'away']) for (const win of [true, false]) {
  const event = { type, homeAway, score: type === 'national' ? (win ? '5-3' : '3-5') : { d: win ? 5 : 3, v: win ? 3 : 5 } };
  const rendered = ctx.resultBearHTML(event);
  const name = `${type === 'national' ? 'national' : 'doosan'}-${win ? 'win' : 'loss'}-${homeAway}.svg`;
  assert.ok(rendered.includes(name), name);
  const svg = fs.readFileSync(path.join(__dirname, '..', 'assets', 'result-bears', name), 'utf8');
  assert.ok(svg.includes('<path') && svg.includes('viewBox='));
  assert.ok(!/<image|data:image/.test(svg), 'SVG must contain vector paths, not an embedded PNG');
  checks++;
}
for (const event of [
  { type: 'kbo', score: { d: 5, v: 3 } },
  { type: 'national', homeAway: 'unknown', score: '5-3' },
  { type: 'national', homeAway: 'home', score: '3-3' },
  { type: 'national', homeAway: 'away', score: '5-3', status: 'live' },
  { type: 'kbo', homeAway: 'home', score: { d: 5, v: 3 }, cancelled: true },
  { type: 'national', homeAway: 'home', score: '' }
]) { assert.equal(ctx.resultBearHTML(event), ''); checks++; }
for (const [score, label] of [['3-2', '3:2 승'], ['5-6', '5:6 패'], ['0-0', '0:0 무'], [{ d: 5, v: 3 }, '5:3 승']]) {
  assert.ok(ctx.nationalScoreHTML({ type: 'national', score }).includes(label)); checks++;
}
assert.ok(ctx.nationalScoreHTML({ type: 'national', score: '5-3', status: 'live' }).includes('진행 중'));
assert.equal(ctx.nationalScoreHTML({ type: 'national', score: '5-3', cancelled: true }), '');
assert.ok(html.includes('const NATIONAL_BEAR_IMAGES') && html.includes('const DOOSAN_BEAR_IMAGES'), 'Keep existing title mascots');
// Regression: the exact completed game reported as missing must render its away-loss mascot.
const nationalGames = JSON.parse(html.match(/const NATIONAL_TEAM_GAMES=(\[.*?\]);/)[1]);
const japanGame = nationalGames.find(e => e.id === 'nat-u23-2026-1');
assert.equal(japanGame.homeAway, 'away');
assert.equal(japanGame.score, '5-6');
assert.ok(japanGame.venue.includes('소베라니아'));
const japanScore = ctx.nationalScoreHTML(japanGame);
assert.match(japanScore, /5:6 패<\/span><img[^>]+national-loss-away\.svg/);
const cubaScore = ctx.nationalScoreHTML(nationalGames.find(e => e.id === 'nat-u23-2026-0'));
assert.match(cubaScore, /3:2 승<\/span><img[^>]+national-win-home\.svg/);
const gameCardSource = html.slice(html.indexOf('function gameCard('), html.indexOf('function showUpcomingScheduleTime('));
assert.ok(gameCardSource.includes('${RL[r]||esc(e.statusText||\'진행 중\')}</span>${resultBearHTML(e)}'), 'Doosan mascot follows the result label');
console.log(`Passed ${checks + 9} checks and all inline JavaScript syntax checks`);
module.exports = ctx;
