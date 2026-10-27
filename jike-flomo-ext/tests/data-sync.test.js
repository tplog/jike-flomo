const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { window: {}, Date, DOMException, setTimeout, clearTimeout };
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../data-sync.js'), 'utf8'), context);
const { collect, sixMonthsAgo } = context.window.JF_SYNC;
const now = new Date(2026, 9, 27);
const post = (id, date, uid = 'me') => ({ id, createdAt: date, user: { id: uid } });
const recent = post('new', '2026-10-26T00:00:00Z');
const old = post('old', '2025-01-01T00:00:00Z');
function source(pages) {
  let index = 0, calls = 0;
  return {
    get calls() { return calls; },
    getFeed: () => ({ data: pages.slice(0, index + 1).flat(), isLoading: false,
      hasNextPage: index < pages.length - 1, onLoadMore: async () => { index++; calls++; } }),
  };
}
const serialize = p => ({ key: p.id, ts: new Date(p.createdAt).getTime() });
const options = s => ({ getFeed: s.getFeed, serialize, uid: 'me', mode: 'recent', now, signal: new AbortController().signal });
(async () => {
  const feb = new Date(sixMonthsAgo(new Date(2026, 7, 31)));
  assert.equal(feb.getMonth(), 1); assert.equal(feb.getDate(), 28);
  // 老置顶不能让初始化提前停止；到达半年边界后不再加载更早页。
  const mixed = source([[old, recent], [post('spring', '2026-05-01T00:00:00Z')],
    [post('a', '2026-04-01'), post('b', '2026-03-01'), post('c', '2026-02-01')], [post('never', '2020-01-01')]]);
  let result = await collect(options(mixed));
  assert.deepEqual(Array.from(result.posts, p => p.key), ['new', 'spring']);
  assert.equal(result.reason, 'cutoff'); assert.equal(mixed.calls, 2);
  // 全量模式跨过半年边界，按 id 去重并等待明确的末页。
  const all = source([[recent], [recent, old], [post('earliest', '2019-01-01')]]);
  result = await collect({ ...options(all), mode: 'all' });
  assert.equal(result.posts.length, 3); assert.equal(all.calls, 2); assert.equal(result.cutoff, null);
  const cap = source([[recent], [post('second', '2026-10-25')], [post('third', '2026-10-24')]]);
  result = await collect({ ...options(cap), pageLimit: 2 });
  assert.equal(result.limited, true); assert.equal(cap.calls, 1);
  const controller = new AbortController();
  await assert.rejects(collect({ ...options(source([[recent], [old]])), signal: controller.signal,
    onProgress: () => controller.abort() }), error => error.name === 'AbortError');
  await assert.rejects(collect(options(source([[post('foreign', '2026-10-01', 'other')]]))), /主页作者/);
  await assert.rejects(collect({ ...options(source([[recent]])), getFeed: () => ({ error: new Error('offline') }) }), /offline/);
  await assert.rejects(collect({ ...options(source([[recent]])), getFeed: () => ({ data: [recent], hasNextPage: true,
    onLoadMore: async () => { throw new Error('page failed'); } }) }), /page failed/);
  await assert.rejects(collect({ ...options(source([[recent]])), getFeed: () => ({ data: [recent], hasNextPage: true,
    onLoadMore: async () => {} }) }), /没有继续推进/);
  const inFlight = new AbortController();
  const timer = setTimeout(() => inFlight.abort(), 150);
  await assert.rejects(collect({ ...options(source([[recent]])), signal: inFlight.signal,
    getFeed: () => ({ data: [recent], hasNextPage: true, onLoadMore: () => new Promise(() => {}) }) }), error => error.name === 'AbortError');
  clearTimeout(timer);
  const empty = await collect(options(source([[]])));
  assert.equal(empty.posts.length, 0); assert.equal(empty.reason, 'end');
  console.log('PASS: 半年边界/置顶、完整历史/去重、页数限制、取消/在途取消、账号校验、网络失败/分页停滞、空账号');
})().catch(error => { console.error(error); process.exitCode = 1; });
