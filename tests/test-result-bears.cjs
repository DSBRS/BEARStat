const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (!/\bsrc=|application\/json/.test(match[1])) new vm.Script(match[2]);
}
const helpers = html.slice(html.indexOf('const OB_BEAR_IMAGES='), html.indexOf('function gameCard('));
const ctx = vm.createContext({
  S: x => x == null ? '' : String(x),
  esc: x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
  isCancelled: e => !!(e && (e.cancelled === true || e.status === 'cancelled' || e.cancelReason)),
  isLiveGame: e => ['live', 'inprogress'].includes(String(e?.status).toLowerCase()),
  hasScore: e => e?.score && typeof e.score === 'object' && String(e.score.d ?? '') !== '' && String(e.score.v ?? '') !== '' && !isNaN(+e.score.d) && !isNaN(+e.score.v),
  bearsTeamKeyForEvent: e => Number(String(e?.date ?? '').slice(0, 4)) <= 1998 ? 'ob' : 'doosan',
  RL: { W: '승', L: '패', D: '무' }
});
vm.runInContext(helpers, ctx);
let checks = 0;
for (const type of ['kbo', 'national']) for (const homeAway of ['home', 'away']) for (const win of [true, false]) {
  const event = { type, homeAway, date: '2026-05-01', score: type === 'national' ? (win ? '5-3' : '3-5') : { d: win ? 5 : 3, v: win ? 3 : 5 } };
  const rendered = ctx.resultBearHTML(event);
  const name = `${type === 'national' ? 'national' : 'doosan'}-${win ? 'win' : 'loss'}-${homeAway}.svg`;
  assert.ok(rendered.includes(name), name);
  const svg = fs.readFileSync(path.join(__dirname, '..', 'assets', 'result-bears', name), 'utf8');
  assert.ok(svg.includes('<path') && svg.includes('viewBox='));
  assert.ok(!/<image|data:image/.test(svg), 'SVG must contain vector paths, not an embedded PNG');
  checks++;
}
for (const [event, token] of [
  [{ type: 'kbo', score: { d: 5, v: 3 } }, ''],
  [{ type: 'national', homeAway: 'unknown', score: '5-3' }, 'national-win-home.svg'],
  [{ type: 'national', homeAway: 'home', score: '3-3' }, 'data:image/png;base64'],
  [{ type: 'national', homeAway: 'away', score: '5-3', status: 'live' }, ''],
  [{ type: 'kbo', homeAway: 'home', score: { d: 5, v: 3 }, cancelled: true }, ''],
  [{ type: 'national', homeAway: 'home', score: '' }, '']
]) { const rendered = ctx.resultBearHTML(event); token ? assert.ok(rendered.includes(token), token) : assert.equal(rendered, ''); checks++; }
for (const [score, label] of [['3-2', '3:2 승'], ['5-6', '5:6 패'], ['0-0', '0:0 무'], [{ d: 5, v: 3 }, '5:3 승']]) {
  assert.ok(ctx.nationalScoreHTML({ type: 'national', score }).includes(label)); checks++;
}
assert.ok(ctx.nationalScoreHTML({ type: 'national', score: '5-3', status: 'live' }).includes('진행 중'));
assert.equal(ctx.nationalScoreHTML({ type: 'national', score: '5-3', cancelled: true }), '');
assert.ok(html.includes('const NATIONAL_BEAR_IMAGES') && html.includes('const DOOSAN_BEAR_IMAGES'), 'Keep existing title mascots');
// Regression: the exact completed game reported as missing must render its away-loss mascot.
const nationalGames = JSON.parse(html.match(/const NATIONAL_TEAM_GAMES=(\[[^\n]*\])/)[1]);
const japanGame = nationalGames.find(e => e.id === 'nat-u23-2026-1');
assert.equal(japanGame.homeAway, 'away');
assert.equal(japanGame.score, '5-6');
assert.ok(japanGame.venue.includes('소베라니아'));
const japanScore = ctx.nationalScoreHTML(japanGame);
assert.equal(japanScore, '5:6 패', 'the national subtitle keeps only the score text, like KBO');
checks++;
const cubaScore = ctx.nationalScoreHTML(nationalGames.find(e => e.id === 'nat-u23-2026-0'));
assert.equal(cubaScore, '3:2 승');
checks++;
// Regression: the national detail panel mirrors the KBO scoreboard row and box.
const nationalDetailSource = html.slice(html.indexOf('function nationalDetail('), html.indexOf('function evRow('));
vm.runInContext(nationalDetailSource, ctx);
assert.match(ctx.nationalDetail(japanGame), /^<div class="dt"><div class="big2">한국 <img[^>]+national-loss-away\.svg[^>]*> 5 : 6 일본<\/div><div class="national-detail"><div class="meta">/);
checks++;
assert.ok(!ctx.nationalDetail({ type: 'national', score: '5-3', cancelled: true, opp: '일본' }).includes('big2'), 'A cancelled national game keeps no scoreboard');
checks++;
// Regression: the scoreboard row keeps only the win/loss mascot, like KBO — no second name mascot.
assert.equal((ctx.nationalDetail(japanGame).match(/<img/g) || []).length, 1, 'the national scoreboard row holds exactly one mascot');
checks++;
// The national name mascot decoration must skip the scoreboard row while the title keeps it.
const nationalNameScript = html.slice(html.indexOf('const NATIONAL_BEAR_IMAGES'), html.lastIndexOf('scan(document.body);'));
assert.ok(nationalNameScript.includes('.dt .big2'), 'the national name mascot skips the scoreboard row');
assert.ok(nationalNameScript.includes('.national-bear-name'), 'the national name mascot is still applied elsewhere');
checks++;
const gameCardSource = html.slice(html.indexOf('function gameCard('), html.indexOf('function showUpcomingScheduleTime('));
assert.ok(gameCardSource.includes('${RL[r]||esc(e.statusText||\'진행 중\')}</span>${resultBearHTML(e)}'), 'Doosan mascot follows the result label');
console.log(`Passed ${checks} checks and all inline JavaScript syntax checks`);
module.exports = ctx;
