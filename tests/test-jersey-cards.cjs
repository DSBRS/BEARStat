const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const data = JSON.parse(html.match(/<template id="jersey_number_data">([\s\S]*?)<\/template>/)[1]);
const career = JSON.parse(html.match(/<template id="career_catalog_data">([\s\S]*?)<\/template>/)[1]);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const ctx = vm.createContext({
  jerseyData: () => data,
  jerseySeason: String(data.maxYear), jerseyRange: 'all', jerseyQuery: '', addedCareerPlayers: [],
  careerCatalog: () => career,
  S: x => String(x ?? ''),
  esc,
  jerseySVG: () => '<svg class="jersey-icon"></svg>'
});
const start = html.indexOf('function jerseyAssignments(');
const end = html.indexOf('function jerseyModalHTML(');
assert.ok(start > 0 && end > start, 'jersey script block not found');
vm.runInContext(html.slice(start, end), ctx);

const cardsFor = (season, range = 'all', query = '') => {
  ctx.jerseySeason = season; ctx.jerseyRange = range; ctx.jerseyQuery = query;
  return ctx.jerseyDisplayCards();
};
const namesOf = (cards, number) => Array.from(cards).filter(card => card.number === number && card.row).map(card => card.row.name).sort();
let checks = 0;
const ok = (label, fn) => { fn(); checks++; };

// 한 시즌에 같은 번호를 쓴 선수 전원이 선수당 카드 한 장으로 펼쳐진다.
ok('2020 #112 3명', () => {
  const cards = cardsFor('2020');
  assert.deepEqual(namesOf(cards, '112'), ['김명신', '남경호', '박신지']);
  assert.equal(cards.filter(card => card.number === '112').length, 3);
});
ok('2018 #100 3명', () => {
  const cards = cardsFor('2018');
  assert.deepEqual(namesOf(cards, '100'), ['박성모', '박성환', '성영훈']);
});
ok('2024 #4 두 명', () => {
  const cards = cardsFor('2024');
  assert.deepEqual(namesOf(cards, '4'), ['박지호', '헨리 라모스']);
  const html4 = cards.filter(card => card.number === '4').map(card => ctx.jerseyCardHTML(card.number, card.row)).join('');
  assert.equal(html4.match(/data-jersey-open="4"/g).length, 2, 'both cards open the same number detail');
  assert.ok(html4.includes('2024 시즌'), 'caption keeps the season');
});

// 카드마다 (번호, 선수) 조합은 한 번만 나오고, 표시되는 번호는 선택 시즌 배정 번호와 같다.
for (const season of Array.from({length: data.maxYear - data.minYear + 1}, (_, i) => String(data.minYear + i))) {
  ok(`${season} uniqueness`, () => {
    const cards = cardsFor(season);
    const keys = cards.map(card => `${card.number}|${card.row ? ctx.jerseyPersonKey(card.row) : 'none'}`);
    assert.equal(new Set(keys).size, keys.length, `${season}: duplicate card`);
    assert.deepEqual([...new Set(cards.map(card => card.number))], Array.from(ctx.jerseySelectedNumbers()), `${season}: numbers`);
    assert.equal(ctx.jerseyResultCount(), cards.length);
    const people = cards.filter(card => card.row || card.retired).length;
    const label = ctx.jerseyResultCountLabel();
    assert.ok(label.includes(`${new Set(cards.map(card => card.number)).size}개 번호`), `${season}: ${label}`);
    if (people > new Set(cards.map(card => card.number)).size) assert.ok(label.includes(`${people}명`), `${season}: ${label}`);
    // 한 번호의 카드는 서로 붙어 있어야 한다(번호 순서 유지).
    const order = Array.from(ctx.jerseyNumbers());
    const positions = Array.from(cards, card => order.indexOf(card.number));
    assert.deepEqual(positions, positions.slice().sort((a, b) => a - b), `${season}: number order`);
  });
}
// 기본 시즌은 최신 자료 연도이고, 그해 여러 명이 쓴 번호는 선수마다 카드가 한 장씩 나온다.
ok('latest season is the default', () => {
  assert.ok(!html.includes('value="current"'), 'no current option');
  const cards = cardsFor(String(data.maxYear));
  assert.deepEqual(namesOf(cards, '24'), ['다즈 카메론', '손아섭']);
  assert.deepEqual(namesOf(cards, '20'), ['김성재', '김영현']);
  assert.deepEqual(namesOf(cards, '14'), ['류승민', '박계범']);
  assert.equal(ctx.jerseyCardStatus('24', cards.find(card => card.number === '24').row, false), `${data.maxYear} 시즌`);
  ctx.jerseySeason = '';
  assert.deepEqual(namesOf(ctx.jerseyDisplayCards(), '24'), ['다즈 카메론', '손아섭'], 'empty season falls back to the latest year');
  ctx.jerseySeason = 'current';
  assert.deepEqual(namesOf(ctx.jerseyDisplayCards(), '24'), ['다즈 카메론', '손아섭'], 'legacy current falls back to the latest year');
});

// 포지션 필터: 그 포지션 선수 카드만 남는다.
ok('pitcher/hitter filter', () => {
  const pitchers = cardsFor('2020', 'pitcher');
  assert.deepEqual(namesOf(pitchers, '100'), ['권휘']);
  assert.ok(pitchers.filter(card => card.row).every(card => ctx.jerseyRoleForRow(card.row).has('pitcher')));
  const hitters = cardsFor('2020', 'hitter');
  assert.ok(namesOf(hitters, '100').includes('김민혁'), '2020 #100 hitter');
  assert.ok(hitters.filter(card => card.row).every(card => ctx.jerseyRoleForRow(card.row).has('hitter')));
  // 포지션을 하나만 가진 동명이인은 그 포지션 카드에만 남는다.
  assert.deepEqual(namesOf(cardsFor('2024', 'pitcher'), '4'), ['박지호']);
  assert.deepEqual(namesOf(cardsFor('2024', 'hitter'), '4'), ['헨리 라모스']);
});
// 외국인 필터도 선수별 카드로 펼쳐진다.
ok('foreign filter', () => {
  const cards = cardsFor('2024', 'foreign');
  assert.deepEqual(namesOf(cards, '43'), ['라울 알칸타라', '조던 발라조빅']);
  assert.ok(cards.filter(card => card.row).every(card => ctx.jerseyIsForeignRow(card.row)));
});

// 이름 검색: 그 시즌 배정자가 검색어에 맞으면 그 선수 카드만 남는다.
ok('name search narrows to the person', () => {
  const cards = cardsFor('2024', 'all', '박지호');
  assert.deepEqual(namesOf(cards, '4'), ['박지호']);
  assert.ok(cards.every(card => card.number !== '11'), 'unrelated number without the name is hidden');
  const marked = cardsFor('2024', 'all', '라모스');
  assert.deepEqual(namesOf(marked, '4'), ['헨리 라모스']);
  assert.deepEqual(namesOf(cardsFor('2024', 'all', '발라조빅'), '43'), ['조던 발라조빅']);
});
// 검색한 선수가 그 시즌에는 다른 번호를 썼으면 카드 한 장만 남는다.
ok('name search fallback', () => {
  const cards = cardsFor('2024', 'all', '함덕주');
  const one = cards.filter(card => card.number === '1');
  assert.equal(one.length, 1);
  assert.equal(one[0].row.name, '박치국');
  // 시즌에 두 명이 쓴 번호라도 검색어에 맞는 선수가 없으면 최근 사용자 카드 한 장만.
  const eleven = cardsFor('2024', 'all', '남호').filter(card => card.number === '11');
  assert.equal(eleven.length, 1);
  assert.equal(eleven[0].row.name, '류현준');
  assert.equal(ctx.jerseyCardStatus('11', eleven[0].row, false), '2024 시즌');
  assert.equal(ctx.jerseyCardStatus('11', null, false), '사용 이력 일치');
});
// 영구결번은 시즌과 상관없이 금색 카드 한 장.
for (const season of [String(data.maxYear), '2020', '2019']) {
  ok(`retired ${season}`, () => {
    const cards = cardsFor(season);
    assert.equal(cards.filter(card => card.number === '21').length, 1);
    const card = cards.find(card => card.number === '21');
    assert.equal(card.retired, true);
    assert.equal(ctx.jerseyCardStatus('21', card.row, true), '영구결번');
    assert.ok(ctx.jerseyCardHTML('21', null).includes('is-retired'));
  });
}
// 상세 모달: 최신 시즌은 '시즌 사용자'로만, 과거 시즌은 현재 주인을 참고로 함께 보여 준다.
ok('modal keeps the current owner note for past seasons', () => {
  const modalStart = html.indexOf('function jerseyModalHTML(');
  const modalEnd = html.indexOf('\nfunction jerseyView(');
  assert.ok(modalStart > 0 && modalEnd > modalStart, 'jersey modal not found');
  vm.runInContext(html.slice(modalStart, modalEnd), ctx);
  ctx.jerseyOpen = '1';
  ctx.jerseySeason = '2020';
  const past = ctx.jerseyModalHTML();
  assert.ok(past.includes('2020 시즌 사용자'), 'past season label');
  assert.ok(past.includes('현재 · 박치국'), 'past season shows the current owner');
  ctx.jerseySeason = String(data.maxYear);
  const latest = ctx.jerseyModalHTML();
  assert.ok(latest.includes(`${data.maxYear} 시즌 사용자`), 'latest season label');
  assert.ok(!latest.includes('현재 · '), 'latest season needs no current note');
  ctx.jerseyOpen = null; ctx.jerseySeason = '2024';
});

// 배정 없는 시즌의 번호는 그리지 않는다(기존 동작).
ok('unassigned numbers stay hidden', () => {
  const cards = cardsFor('2026');
  assert.ok(!cards.some(card => card.number === '199'));
});

for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (!/\bsrc=|application\/json/.test(match[1])) new vm.Script(match[2]);
}
console.log(`Passed ${checks} multi-user jersey card checks and inline JavaScript syntax`);
