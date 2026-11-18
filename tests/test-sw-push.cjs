const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

// Minimal service worker environment: only the push event is exercised here.
function loadWorker() {
  const listeners = new Map();
  const shown = [];
  const self = {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
    registration: {
      scope: 'https://dsbrs.github.io/BEARStat/',
      showNotification: async (title, options) => { shown.push({ title, options }); }
    }
  };
  vm.runInContext(source, vm.createContext({ self, URL, Date, String, Number, JSON }));
  return {
    shown,
    async push(raw) {
      let pending;
      const event = {
        data: raw === null ? null : { json: () => JSON.parse(raw) },
        waitUntil: promise => { pending = promise; }
      };
      for (const handler of listeners.get('push') || []) handler(event);
      if (pending) await pending;
      return shown.length;
    }
  };
}

const iso = ms => new Date(ms).toISOString();
const base = { title: 'BEARStat · 생일', body: '오늘 생일이에요', tag: 'bearstat-birthday' };

(async () => {
  let checks = 0;
  const now = Date.now();
  const cases = [
    // Birthday: the worker sends 00:00 KST as startAt and 15 hours later as expiresAt,
    // so the cron usually delivers a few seconds after startAt. It must still show.
    ['birthday delivered after its start time', { ...base, startAt: iso(now - 5000), expiresAt: iso(now + 15 * 3600e3) }, 1],
    // On-time start notice: startAt is that minute, expiresAt is +60s.
    ['on-time start delivered after its start time', { title: 'BEARStat · 티켓 지금 예매 시작', startAt: iso(now - 3000), expiresAt: iso(now + 57e3) }, 1],
    // A lead-time reminder is still ahead of its start time when it is pushed.
    ['reminder ahead of its start time', { title: 'BEARStat · 야구 5분 전', startAt: iso(now + 300e3), expiresAt: iso(now + 300e3) }, 1],
    // Expired payloads stay dropped.
    ['payload past its expiresAt', { ...base, startAt: iso(now - 15 * 3600e3), expiresAt: iso(now - 1000) }, 0],
    // Servers that send no expiresAt keep the startAt guard.
    ['startAt only, still upcoming', { title: 'BEARStat · 야구 5분 전', startAt: iso(now + 60e3) }, 1],
    ['startAt only, already past', { title: 'BEARStat · 야구 5분 전', startAt: iso(now - 1000) }, 0],
    // An unreadable expiry is not trusted.
    ['unparseable expiresAt', { ...base, startAt: iso(now + 60e3), expiresAt: 'not-a-date' }, 0],
    // Malformed payloads never notify.
    ['payload without a title', { body: 'no title', startAt: iso(now + 60e3) }, 0],
    ['payload that is not JSON', 'not json{', 0]
  ];
  for (const [name, payload, expected] of cases) {
    const worker = loadWorker();
    const count = await worker.push(typeof payload === 'string' ? payload : JSON.stringify(payload));
    assert.equal(count, expected, name);
    assert.equal(worker.shown.length, expected, name);
    checks++;
  }

  // Same-origin links from the payload are kept; foreign ones fall back to the scope.
  const links = loadWorker();
  await links.push(JSON.stringify({ ...base, url: 'https://dsbrs.github.io/BEARStat/?date=2026-05-01#/roster', startAt: iso(now + 60e3) }));
  await links.push(JSON.stringify({ ...base, url: 'https://example.com/phish', startAt: iso(now + 60e3) }));
  assert.equal(links.shown[0].options.data.url, 'https://dsbrs.github.io/BEARStat/?date=2026-05-01#/roster');
  assert.equal(links.shown[1].options.data.url, 'https://dsbrs.github.io/BEARStat/');
  checks += 2;

  console.log(`Passed ${checks} push notification checks`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
