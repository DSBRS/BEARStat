const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// Every inline script must still parse before anything else is checked.
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (!/\bsrc=|application\/json/.test(match[1])) new vm.Script(match[2]);
}

let checks = 0;

// 1. 11/21 선예매(10:00) and 일반 예매(11:00) both live in the built-in schedule.
const clubSource = html.slice(html.indexOf('const CLUB_EVENTS=['), html.indexOf('const NATIONAL_TEAM_GAMES='));
const club = vm.runInNewContext(clubSource.replace(/^const CLUB_EVENTS=/, '').trim().replace(/;$/, ''));
const presale = club.find(e => e.id === 'ticket-bearsmeeting-20261121-presale-40');
const general = club.find(e => e.id === 'ticket-bearsmeeting-20261121-39');
assert.ok(presale, '선예매 일정이 CLUB_EVENTS에 있어야 합니다');
assert.ok(general, '일반 예매 일정이 유지되어야 합니다');
assert.equal(presale.date, '2026-11-21');
assert.equal(presale.time, '10:00');
assert.equal(presale.type, 'ticket');
assert.equal(presale.notificationCategory, 'ticket');
assert.equal(general.time, '11:00');
assert.notEqual(presale.title, general.title);
assert.notEqual(presale.desc, general.desc);
assert.ok(!general.desc.includes('유료회원 선예매'), '일반 예매 설명에 선예매 안내가 겹치면 안 됩니다');
checks += 8;

// 2. The push feed the worker reads carries the same two ticket openings.
const feeds = ['data/schedules.json', 'data/notification-events.json'].map(file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')));
for (const feed of feeds) {
  const tickets = feed.events.filter(e => e.id.startsWith('ticket-bearsmeeting-20261121-'));
  assert.equal(tickets.length, 2, '두 예매 일정이 모두 들어가야 합니다');
  assert.deepEqual(tickets.map(e => e.time).sort(), ['10:00', '11:00']);
  checks++;
}

// The app, the public feed and the push feed must carry the same notice text.
for (const id of ['ticket-bearsmeeting-20261121-presale-40', 'ticket-bearsmeeting-20261121-39', 'club-bearsmeeting-20261128-38']) {
  const builtin = club.find(e => e.id === id).desc;
  assert.equal(feeds[0].events.find(e => e.id === id).desc, builtin, id + ' 공개 피드 설명이 앱과 같아야 합니다');
  assert.equal(feeds[1].events.find(e => e.id === id).desc, builtin, id + ' 푸시 피드 설명이 앱과 같아야 합니다');
  checks++;
}

// Each seat price sits on its own line, so the box reads as a price list.
for (const event of [presale, general]) {
  const rows = event.desc.split('\n').filter(line => /^\S+ \d{1,3},\d{3}원$/.test(line));
  assert.equal(rows.length, 6, '좌석별 가격이 한 줄씩 있어야 합니다: ' + event.id);
  assert.ok(!event.desc.includes(' / 익사이팅존'), '가격은 빗금으로 이어 붙이지 않습니다');
  checks += 2;
}

// 3. The calendar draws the ticket icon, and no longer the generic dot for a ticket day.
const markSource = html.slice(html.indexOf('function ticketMarkSVG('), html.indexOf('let calendarCategory='));
const markCtx = vm.createContext({
  S: x => (x == null ? '' : String(x)),
  esc: x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
  isCancelled: () => false
});
vm.runInContext(markSource, markCtx);
const marks = markCtx.calendarMarks([presale, general], true);
assert.ok(marks.includes('cal-mark ticket-mark'), '티켓 아이콘이 달력 칸에 그려져야 합니다');
assert.ok(marks.includes('<path d="M4 5.6h16a1.4 1.4 0 0 1 1.4 1.4v3'), '확정한 티켓 SVG 경로가 쓰여야 합니다');
assert.ok(!marks.includes('cal-mark circle'), '티켓 아이콘이 있으면 회색 점은 붙지 않아야 합니다');
assert.equal((marks.match(/ticket-mark/g) || []).length, 1, '같은 날 티켓 일정 여러 건은 아이콘 하나로 표시합니다');
checks += 4;

// 4. The list card keeps the long 안내문 closed until the card is tapped.
const rowSource = html.slice(html.indexOf('function showUpcomingScheduleTime('), html.indexOf('function calendarIconSVG('));
const openIds = new Set();
const rowCtx = vm.createContext({
  S: x => (x == null ? '' : String(x)),
  esc: x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
  isCancelled: () => false,
  hasScore: () => false,
  isLiveGame: () => false,
  rescheduleNoticeHTML: () => '',
  result: () => 'W',
  RL: { W: '승', L: '패', D: '무' },
  gameTitleWithHeader: e => e.title,
  starterDisplayName: x => (x == null ? '' : String(x)),
  nationalScoreHTML: () => '',
  openIds,
  TS: '2026-11-19',
  TODAY: new Date('2026-11-19T00:00:00'),
  TYPES: { ticket: '티켓 예매', club: '클럽 행사' }
});
vm.runInContext(rowSource, rowCtx);
const collapsed = rowCtx.evRow(presale);
assert.ok(collapsed.includes(`data-x="${presale.id}"`), '카드는 눌러서 열 수 있어야 합니다');
assert.ok(collapsed.includes('role="button"') && collapsed.includes('tabindex="0"'));
assert.ok(collapsed.includes('aria-expanded="false"'));
assert.ok(collapsed.includes('상세 보기 ▾'));
assert.ok(!collapsed.includes('테이블석'), '접힌 카드에는 긴 안내문이 나오면 안 됩니다');
assert.ok(!collapsed.includes('ev-info-lines'));
assert.ok(collapsed.includes('두산베어스 홈페이지·앱 / NOL(야놀자)'), '예매처는 카드에 그대로 보입니다');
checks += 6;

openIds.add(presale.id);
const opened = rowCtx.evRow(presale);
assert.ok(opened.includes('aria-expanded="true"'));
assert.ok(opened.includes('접기 ▴'));
assert.ok(opened.includes('ev-info-lines'));
assert.ok(opened.includes('<span>시간</span><span>10:00</span>'), '상세에는 시간이 표시됩니다');
assert.ok(opened.includes('베어스클럽 유료회원 선예매'), '상세에 선예매 안내가 보입니다');
assert.ok(opened.includes('테이블석 20,000'));
checks += 5;

// 4-1. 날짜·시간·장소와 안내문이 같은 회색 박스 안에 들어가고, 가격은 한 줄에 하나씩.
const boxStart = opened.indexOf('<div class="ev-info-box">');
const linesStart = opened.indexOf('<div class="ev-info-lines">');
const detailEnd = opened.lastIndexOf('</div></div>');
assert.ok(boxStart > -1, '회색 네모 박스가 있어야 합니다');
assert.ok(linesStart > boxStart, '안내문은 박스 안, 날짜/시간/장소 아래에 있어야 합니다');
assert.ok(linesStart < detailEnd, '안내문까지 박스 안에서 끝나야 합니다');
assert.ok(opened.slice(boxStart, linesStart).includes('<span>장소</span>'), '장소 줄도 같은 박스 안에 있습니다');
assert.ok(!opened.includes('regular-detail'), '공지형 상세는 경기 상세 박스를 따로 두지 않습니다');
for (const row of ['테이블석 20,000원', '익사이팅존 18,000원', '블루·오렌지석 15,000원', '레드석 12,000원', '네이비석 10,000원', '외야석 5,000원']) {
  assert.ok(opened.includes(`<div>${row}</div>`), '가격은 좌석별 한 줄로 나뉘어야 합니다: ' + row);
}
assert.ok(opened.includes('<div>수수료 매수당 1,000원</div>'), '수수료 안내도 자기 줄에 섭니다');
assert.ok(opened.includes('베어스클럽 유료회원 선예매 11/21(토) 10:00 (성인 2매 / 두린이 4매)'), '예매 조건은 첫 줄에 남습니다');
assert.ok(!/<div>[^<]*\n/.test(opened), '줄바꿈은 화면 줄로 바뀌어야 합니다');
checks += 12;

// 5. The club event's schedule notice is closed the same way, while game cards keep their own detail.
openIds.clear();

const clubEvent = club.find(e => e.id === 'club-bearsmeeting-20261128-38');
const clubRow = rowCtx.evRow(clubEvent);
assert.ok(clubRow.includes('상세 보기 ▾'));
assert.ok(!clubRow.includes('울랄라세션'));
checks += 2;

openIds.add(clubEvent.id);
const clubOpened = rowCtx.evRow(clubEvent);
assert.ok(clubOpened.indexOf('<div class="ev-info-box">') > -1 && clubOpened.indexOf('<div class="ev-info-box">') < clubOpened.indexOf('<div class="ev-info-lines">'), '곰들의 모임 타임라인도 같은 박스 안에 들어갑니다');
assert.ok(clubOpened.includes('<div>12:00 선수단 팬 사인회</div>'), '타임라인은 한 줄에 하나씩 섭니다');
assert.ok(clubOpened.includes('<div>중계: SPOTV2·BEARSTV 유튜브</div>'), '중계 안내도 박스 안에 남습니다');
checks += 3;
openIds.clear();

// 5-1. A notice written as one line with 가운뎃점 still splits into rows inside the box.
openIds.add('legacy-notice');
const legacyRow = rowCtx.evRow({ id: 'legacy-notice', type: 'etc', date: '2026-11-22', title: '안내', place: '잠실야구장', desc: '첫 안내 · 둘째 안내' });
assert.ok(legacyRow.includes('<div class="ev-info-box">'));
assert.ok(legacyRow.includes('<div>첫 안내</div>') && legacyRow.includes('<div>둘째 안내</div>'));
openIds.clear();
checks += 3;

// 5-2. The boxed detail keeps its own styling in light and dark mode.
assert.ok(/\.ev-info-box\{[^}]*background:var\(--chip\)/.test(html), '박스는 회색 배경을 씁니다');
assert.ok(/\.ev-info-lines\{[^}]*border-top:1px solid var\(--divider\)/.test(html), '박스 안쪽은 가는 선으로 나눕니다');
assert.ok(/:root\{[^}]*--divider:/.test(html) && /:root\[data-theme="dark"\]\{[^}]*--divider:/.test(html), '어두운 테마에도 구분선 색이 있습니다');
checks += 3;

const game = { id: 'game-1', type: 'kbo', date: '2026-11-21', time: '14:00', title: '두산 vs 한화', opp: '한화', place: '잠실야구장' };
const gameRow = rowCtx.evRow(game);
assert.ok(gameRow.includes('경기 상세 ▾'), '경기 카드의 문구는 그대로여야 합니다');
checks++;

// 6. A one-line greeting such as a birthday stays on the card, as it was before.
const birthdayRow = rowCtx.evRow({ id: 'birthday-2026-11-21', type: 'birthday', date: '2026-11-21', time: '00:00', title: '이주호 선수 생일', desc: '이주호 선수의 생일입니다!' });
assert.ok(birthdayRow.includes('이주호 선수의 생일입니다!'), '생일 인사는 카드에 그대로 보여야 합니다');
assert.ok(!birthdayRow.includes('상세 보기'), '생일 카드에는 펼치기 안내가 붙으면 안 됩니다');
checks += 2;

// 7. 한일 드림 플레이어즈 게임과 더 제너레이션 매치의 예매·경기 일정 (2026-11-23 ~ 12-06).
const upcoming = {
  'ticket-hanildream-20261123-41': ['2026-11-23', '14:00', 'ticket', '2026 한일 드림 플레이어즈 게임 일반 예매 오픈'],
  'club-hanildream-20261204-42': ['2026-12-04', '18:30', 'club', '2026 한일 드림 플레이어즈 게임 전야제'],
  'club-hanildream-20261205-43': ['2026-12-05', '14:00', 'club', '2026 한일 드림 플레이어즈 게임 본경기'],
  'ticket-generationmatch-20261126-44': ['2026-11-26', '14:00', 'ticket', '2026 더 제너레이션 매치 티켓 예매 오픈'],
  'club-generationmatch-20261206-45': ['2026-12-06', '18:30', 'club', '2026 더 제너레이션 매치']
};
for (const [id, expected] of Object.entries(upcoming)) {
  const event = club.find(e => e.id === id);
  assert.ok(event, id + ' 일정이 CLUB_EVENTS에 있어야 합니다');
  assert.deepEqual([event.date, event.time, event.type, event.title], expected, id + ' 일정 정보가 어긋납니다');
  assert.equal(event.place || event.ticketSite, event.type === 'ticket' ? 'NOL 티켓' : '서울 고척스카이돔', id + ' 장소가 어긋납니다');
  checks += 3;
}

// 같은 일정과 안내문이 공개 피드와 푸시 피드에도 들어갑니다.
for (const feed of feeds) {
  for (const id of Object.keys(upcoming)) {
    const event = feed.events.find(e => e.id === id);
    assert.ok(event, id + ' 일정이 피드에 있어야 합니다');
    assert.equal(event.desc, club.find(e => e.id === id).desc, id + ' 안내문이 앱과 같아야 합니다');
    checks++;
  }
}

// 8. 예매일에는 티켓 아이콘, 행사일에는 구단 행사 표시가 달력 칸에 그려집니다.
const clubMarkCtx = vm.createContext({
  S: x => (x == null ? '' : String(x)),
  esc: x => String(x),
  isCancelled: () => false,
  calendarIconSVG: () => '<svg></svg>'
});
vm.runInContext(markSource, clubMarkCtx);
for (const [date, mark] of [['2026-11-23', 'ticket-mark'], ['2026-11-26', 'ticket-mark'], ['2026-12-04', 'club-mark'], ['2026-12-05', 'club-mark'], ['2026-12-06', 'club-mark']]) {
  const markHtml = clubMarkCtx.calendarMarks(club.filter(e => e.date === date), true);
  assert.ok(markHtml.includes('cal-mark ' + mark), date + ' 달력에 ' + mark + ' 표시가 있어야 합니다');
  assert.ok(!markHtml.includes('cal-mark circle'), '분류된 일정에는 기타 일정 점을 붙이지 않습니다');
  checks += 2;
}
// 곰들의 모임 날짜는 예전처럼 곰모 아이콘 하나만 씁니다.
const meetingMarks = clubMarkCtx.calendarMarks(club.filter(e => e.date === '2026-11-28'), true);
assert.ok(meetingMarks.includes('bears-meeting') && !meetingMarks.includes('club-mark'), '곰모 날짜의 아이콘은 그대로여야 합니다');
checks++;

// 9. 좌석별 가격은 전야제 11줄·본경기 13줄로 한 줄에 하나씩 섭니다.
const priceRows = club.find(e => e.id === 'ticket-hanildream-20261123-41').desc.split('\n')
  .filter(line => /^.+ \d{1,3}(,\d{3})*(~\d{1,3}(,\d{3})*)?원$/.test(line));
assert.equal(priceRows.length, 24, '좌석별 가격은 모두 자기 줄에 있어야 합니다');
assert.ok(club.find(e => e.id === 'ticket-hanildream-20261123-41').desc.includes('\n\n[본경기 12/5]'), '전야제와 본경기 가격표는 빈 줄로 나눕니다');
checks += 2;

console.log(`ticket schedule: ${checks} checks passed`);
