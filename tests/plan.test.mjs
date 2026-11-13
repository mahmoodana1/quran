// node --test tests/   (the plans: revision, days kept, a khatma's portion, the Hijri calendar, calendar files)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const Plan = createRequire(import.meta.url)('../plan.js');
const DAY = 864e5, NOW = new Date(2026, 10, 13, 18).getTime();

// 20 pages of 10 ayas: aya i on page floor(i/10)+1, surah 1
const ayas = Array.from({ length: 200 }, (_, i) => [1, i + 1, Math.floor(i / 10) + 1]);
const all = (t, n = 200) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i, t]));

test('near: memorized this week; far: the rest by page', () => {
  const said = all(NOW - 30 * DAY), first = all(NOW - 30 * DAY);
  for (let i = 190; i < 200; i++) said[i] = first[i] = NOW - 2 * DAY;
  const r = Plan.revision({ ayas, said, first, days: 7, now: NOW });
  assert.equal(r.near.length, 10);
  assert.equal(r.total, 19);
  assert.equal(r.pages.length, Math.ceil(19 / 7));
  assert.ok(r.part.every(ai => ai < 190));
});

test('the pages least recently recited come first (a day missed is not lost)', () => {
  const said = all(NOW - 3 * DAY), first = all(NOW - 60 * DAY);
  for (let i = 50; i < 60; i++) said[i] = NOW - 20 * DAY; // page 6, long not recited
  const r = Plan.revision({ ayas, said, first, days: 10, now: NOW });
  assert.ok(r.pages.includes(6));
});

test('weak pages come back sooner and add to the load', () => {
  const said = all(NOW - 4 * DAY), first = all(NOW - 60 * DAY);
  said[75] = NOW - 4 * DAY; // all equally old
  const plain = Plan.revision({ ayas, said, first, days: 12, now: NOW });
  const r = Plan.revision({ ayas, said, first, weak: new Set([75]), days: 12, now: NOW });
  assert.ok(r.pages.includes(8), 'the weak page (8) is due');
  assert.ok(r.weakPages === 1);
  assert.ok(r.pages.length >= plain.pages.length);
});

test('every page is revised within the cycle', () => {
  let said = all(NOW - 40 * DAY);
  const first = all(NOW - 90 * DAY), seen = new Set(), days = 5;
  for (let d = 0; d < days; d++) {
    const t = NOW + d * DAY, r = Plan.revision({ ayas, said, first, days, now: t });
    r.pages.forEach(p => seen.add(p));
    said = { ...said, ...Object.fromEntries(r.part.map(ai => [ai, t])) };
  }
  assert.equal(seen.size, 20);
});

test('the lesson is not revised', () => {
  const r = Plan.revision({ ayas, said: all(NOW - 30 * DAY), first: all(NOW - 30 * DAY), skip: ai => ai < 100, days: 1, now: NOW });
  assert.ok(r.part.every(ai => ai >= 100));
});

test('page runs', () => {
  assert.equal(Plan.pageRuns([3, 4, 5, 9, 11, 12]), '3–5، 9، 11–12');
});

test('streak: today or yesterday counts on', () => {
  const k = t => Plan.dayKey(t);
  const s = Plan.streak(new Set([k(NOW - DAY), k(NOW - 2 * DAY), k(NOW - 3 * DAY), k(NOW - 10 * DAY)]), NOW);
  assert.equal(s.now, 3); assert.equal(s.today, false); assert.equal(s.best, 3);
  assert.equal(Plan.streak(new Set([k(NOW - 2 * DAY)]), NOW).now, 0);
  assert.equal(Plan.lastDays(28, new Set(), new Set(), NOW).length, 28);
});

test("a khatma's portion of the day", () => {
  const k = { goal: { days: 30, start: NOW - 10 * DAY }, day: { d: Plan.dayKey(NOW), n0: 200 } };
  const unread = Array.from({ length: 394 }, (_, i) => 211 + i);
  const w = Plan.ward(k, 604, 210, unread, NOW);
  assert.equal(w.left, 20);
  assert.equal(w.target, Math.ceil(404 / 20));
  assert.equal(w.today, 10);
  assert.equal(w.rest, w.target - 10);
  assert.equal(w.from, 211);
  assert.ok(w.behind <= 2);
  assert.equal(Plan.ward({}, 604, 0, [], NOW), null);
  const late = Plan.ward({ goal: { days: 30, start: NOW - 15 * DAY } }, 604, 100, unread, NOW);
  assert.ok(late.behind > 150);
});

test('Hijri dates and occasions (Umm al-Qura)', () => {
  assert.deepEqual(Plan.hijri(new Date(2026, 2, 20, 12).getTime()), { y: 1447, m: 10, d: 1 });
  const occ = Plan.occasions(new Date(2026, 2, 10, 12).getTime(), 30);
  assert.ok(occ.some(o => o.name === 'عيد الفطر' && o.in === 10));
  const m = Plan.month(NOW);
  assert.ok(m.days.length >= 29 && m.days.length <= 30);
  assert.ok(m.days.some(d => d.today));
});

test('calendar file: lines folded, events and alarms', () => {
  const text = Plan.ics([
    { uid: 'a@x', start: new Date(Date.UTC(2026, 10, 14, 3, 30)), title: 'صلاة الفجر', alarm: 0, desc: 'طويل '.repeat(40) },
    { uid: 'b@x', start: new Date(2026, 10, 14, 20, 0), daily: true, title: 'الحفظ', alarm: 5 },
  ]);
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\n') && text.endsWith('END:VCALENDAR\r\n'));
  assert.equal((text.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(text.includes('DTSTART:20261114T033000Z'));
  assert.ok(text.includes('DTSTART:20261114T200000\r\n') && text.includes('RRULE:FREQ=DAILY'));
  assert.ok(text.includes('TRIGGER:PT0M') && text.includes('TRIGGER:-PT5M'));
  for (const line of text.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
});
