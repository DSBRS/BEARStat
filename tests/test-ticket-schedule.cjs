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

// 5. The club event's schedule notice is closed the same way, while game cards keep their own detail.
openIds.clear();

const clubEvent = club.find(e => e.id === 'club-bearsmeeting-20261128-38');
const clubRow = rowCtx.evRow(clubEvent);
assert.ok(clubRow.includes('상세 보기 ▾'));
assert.ok(!clubRow.includes('울랄라세션'));
checks += 2;

const game = { id: 'game-1', type: 'kbo', date: '2026-11-21', time: '14:00', title: '두산 vs 한화', opp: '한화', place: '잠실야구장' };
const gameRow = rowCtx.evRow(game);
assert.ok(gameRow.includes('경기 상세 ▾'), '경기 카드의 문구는 그대로여야 합니다');
checks++;

console.log(`ticket schedule: ${checks} checks passed`);
