// 数据管理：近半年初始化、完整历史重建、统计缓存清除。分页复用页面已有的 React 回调。
(function () {
  'use strict';
  const LIMIT = 60;
  const LOCK = 'jike-flomo-data-sync';
  const PENDING = 'jf-pending-sync';
  const NOTICE = 'jf-sync-complete';
  const aborted = signal => { if (signal.aborted) throw new DOMException('同步已暂停', 'AbortError'); };
  function sixMonthsAgo(now = new Date()) {
    const date = new Date(now), day = date.getDate();
    date.setDate(1); date.setMonth(date.getMonth() - 6);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(day, lastDay)); date.setHours(0, 0, 0, 0);
    return date.getTime();
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(check, signal, timeout = 20000) {
    const start = Date.now();
    while (true) {
      aborted(signal);
      const result = check();
      if (result) return result;
      if (Date.now() - start > timeout) throw new Error('即刻页面加载超时，请稍后重新同步');
      await sleep(100);
    }
  }
  async function loadPage(feed, signal) {
    // 页面回调的网络请求不由扩展接管；超时/暂停后不提交采集结果。
    let finished = false, error;
    Promise.resolve().then(() => feed.onLoadMore()).catch(e => { error = e; }).finally(() => { finished = true; });
    await waitFor(() => finished, signal);
    if (error) throw error;
  }

  async function collect({ getFeed, serialize, uid, mode, signal, onProgress = () => {}, pageLimit = LIMIT, now = new Date() }) {
    const cutoff = mode === 'all' ? null : sixMonthsAgo(now);
    const records = new Map();
    let pages = 1, stagnant = 0;
    while (true) {
      const feed = await waitFor(() => {
        const f = getFeed(); if (f?.error) throw f.error;
        return f && !f.isLoading && f;
      }, signal);
      pages = Math.max(pages, feed.pageCount || 1);
      const own = feed.data.filter(p => p.user?.id === uid && p.id && Number.isFinite(new Date(p.createdAt).getTime()));
      if (feed.data.length && !own.length) throw new Error('未能确认主页作者，同步已停止，请从自己的主页重试');
      for (const post of own) {
        const record = serialize(post, true);
        if (cutoff === null || record.ts >= cutoff) records.set(record.key, record);
      }
      const tail = own.slice(-3);
      const reachedCutoff = cutoff !== null && tail.length > 0 && tail.every(p => new Date(p.createdAt).getTime() < cutoff);
      onProgress({ pages, count: records.size, oldest: own.at(-1)?.createdAt });
      aborted(signal);
      if (reachedCutoff || feed.hasNextPage === false || !feed.onLoadMore) {
        return { posts: [...records.values()], cutoff, pages, limited: false, reason: reachedCutoff ? 'cutoff' : 'end' };
      }
      if (stagnant >= 2) throw new Error('分页没有继续推进，未替换原缓存，请稍后重试');
      if (mode !== 'all' && pages >= pageLimit) {
        return { posts: [...records.values()], cutoff, pages, limited: true, reason: 'limit' };
      }
      const before = feed.data.map(p => p.id).join('|');
      await loadPage(feed, signal);
      // React 在分页 Promise resolve 后提交 DOM；等 props 变更，避免误判最后一页。
      const started = Date.now();
      while (Date.now() - started < 900) {
        aborted(signal);
        const next = getFeed();
        if (next && !next.isLoading && next.data.map(p => p.id).join('|') !== before) break;
        await sleep(100);
      }
      const next = getFeed();
      if (!next || next.isLoading) { await waitFor(() => getFeed() && !getFeed().isLoading, signal); }
      const changed = getFeed()?.data.map(p => p.id).join('|') !== before;
      stagnant = changed ? 0 : stagnant + 1;
      if (changed) pages++;
    }
  }

  function create({ signal, getProfile, ownProfilePath, isMyPage, getFeed, serialize, refresh, drainScan, resetScanned }) {
    let state = { loaded: false, initialized: false, running: false, cleared: false, meta: null };
    let account = '', autoAttempted = false, checking = false, active = null;
    const channel = new BroadcastChannel('jike-flomo-data-updates');
    const $ = s => document.querySelector(s);
    const on = (el, event, fn) => el.addEventListener(event, fn, { signal });
    function summary() {
      const el = $('.jf-sync-summary');
      if (!el) return;
      const meta = state.meta;
      el.textContent = state.running ? '正在同步动态…' : state.cleared ? '缓存已清除 · 下次打开时初始化' :
        !meta ? '首次同步将读取近半年动态' : meta.limited ? `已同步最近 ${meta.pages} 页 · 可全量刷新` :
        meta.scope === 'all' ? '已同步完整历史' : '已同步近半年动态';
      el.title = meta ? `上次同步：${new Date(meta.syncedAt).toLocaleString('zh-CN')} · 本次读取 ${meta.postCount} 条动态` : '';
    }
    function toast(text) {
      $('.jf-data-toast')?.remove();
      const el = document.createElement('div'); el.className = 'jf-data-toast'; el.role = 'status'; el.textContent = text;
      document.body.append(el);
      const timer = setTimeout(() => el.remove(), 5500);
      signal.addEventListener('abort', () => { clearTimeout(timer); el.remove(); }, { once: true });
    }
    function dialog({ title, body, confirm = '确认', danger = false }) {
      return new Promise(resolve => {
        const d = document.createElement('dialog'); d.className = 'jf-data-dialog';
        d.innerHTML = '<h2></h2><p class="jf-dialog-body"></p><div class="jf-dialog-actions"><button type="button" data-cancel>取消</button><button type="button" data-confirm></button></div>';
        d.querySelector('h2').textContent = title;
        d.querySelector('p').textContent = body;
        const yes = d.querySelector('[data-confirm]'); yes.textContent = confirm; yes.className = danger ? 'jf-danger' : 'jf-primary';
        let done = false;
        const finish = value => { if (done) return; done = true; signal.removeEventListener('abort', cancel); d.close(); d.remove(); resolve(value); };
        const cancel = () => finish(false);
        d.querySelector('[data-cancel]').onclick = cancel; yes.onclick = () => finish(true);
        d.oncancel = e => { e.preventDefault(); cancel(); };
        signal.addEventListener('abort', cancel, { once: true });
        document.body.append(d); d.showModal(); d.querySelector('[data-cancel]').focus();
      });
    }
    function progress(mode, controller) {
      const d = document.createElement('dialog'); d.className = 'jf-data-dialog jf-data-progress';
      d.innerHTML = '<div class="jf-sync-spinner" aria-hidden="true"></div><h2></h2><p class="jf-dialog-body"></p><div class="jf-sync-track"><span></span></div><p class="jf-sync-detail" role="status" aria-live="polite">正在读取你的主页…</p><p class="jf-sync-hint">同步期间暂不可操作页面，可随时暂停。</p><div class="jf-dialog-actions"><button type="button" data-stop>暂停同步</button></div>';
      d.querySelector('h2').textContent = mode === 'all' ? '正在全量刷新' : state.initialized ? '正在刷新数据' : '正在初始化你的数据';
      d.querySelector('.jf-dialog-body').textContent = mode === 'all' ? '正在逐页读取完整历史，重建热力图和统计。动态较多时会需要较长时间。' : `只读取最近半年动态，最多 ${LIMIT} 页，为你准备热力图和统计。`;
      const stop = d.querySelector('[data-stop]');
      stop.onclick = () => { if (!stop.disabled) controller.abort(); };
      d.oncancel = e => { e.preventDefault(); if (!stop.disabled) controller.abort(); };
      document.body.append(d); d.showModal();
      return {
        update({ pages, count, oldest }) {
          d.querySelector('.jf-sync-detail').textContent = `已读取 ${count} 条动态 · ${pages} 页${oldest ? `\n读取到 ${new Date(oldest).toLocaleDateString('zh-CN')}` : ''}`;
        },
        saving() { stop.disabled = true; d.querySelector('.jf-sync-detail').textContent = '正在保存动态并更新热力图和统计…'; },
        close() { d.close(); d.remove(); },
      };
    }
    async function exclusive(fn) {
      return navigator.locks.request(LOCK, { ifAvailable: true }, async lock => {
        if (!lock) { toast('另一个即刻页面正在同步，请稍后再试'); return false; }
        await fn(); return true;
      });
    }
    async function request(mode) {
      try {
        await window.JF_COMPOSER?.flush();
        sessionStorage.setItem(PENDING, mode);
        const path = ownProfilePath() || '/me';
        if (location.pathname === path) location.reload();
        else location.assign(path);
      } catch (error) { toast(`无法开始同步：${error.message}`); }
    }
    async function run(mode) {
      if (state.running || signal.aborted) return;
      await exclusive(async () => {
        state.running = true; summary();
        const scroller = document.querySelector('[class*=mantine-ScrollArea-viewport]');
        const originalScroll = scroller?.scrollTop || 0;
        const controller = new AbortController(); active = controller;
        const cancel = () => controller.abort(); signal.addEventListener('abort', cancel, { once: true });
        const ui = progress(mode, controller);
        let failure = null, paused = false;
        try {
          await drainScan();
          const user = getProfile();
          if (!user?.id || !isMyPage()) throw new Error('请打开自己的主页后重新同步');
          const result = await collect({ getFeed, serialize, uid: user.id, mode, signal: controller.signal, onProgress: ui.update });
          aborted(controller.signal); ui.saving();
          const effectiveCutoff = result.limited && result.posts.length
            ? Math.max(result.cutoff, Math.min(...result.posts.map(p => p.ts))) : result.cutoff;
          if (!result.limited || result.posts.length) await window.JF_DB.replacePosts(result.posts, { uid: user.id, cutoff: effectiveCutoff });
          const meta = { initialized: true, scope: mode === 'all' || state.meta?.scope === 'all' ? 'all' : 'recent',
            syncedAt: Date.now(), postCount: result.posts.length, pages: result.pages, limited: result.limited, coverageStart: effectiveCutoff };
          await window.JF_DB.setSyncState(account, meta);
          state.initialized = true; state.cleared = false; state.meta = meta;
          resetScanned(); await refresh();
          channel.postMessage({ type: 'updated', account });
        } catch (error) {
          if (error.name === 'AbortError') paused = true; else failure = error;
        } finally {
          // 原生虚拟列表在追加数据时可能调整滚动锚点，在蒙层关闭前恢复阅读位置。
          if (scroller?.isConnected) {
            scroller.scrollTop = originalScroll; await sleep(100); scroller.scrollTop = originalScroll;
          }
          ui.close(); active = null; state.running = false; summary(); signal.removeEventListener('abort', cancel);
        }
        if (signal.aborted) return;
        if (failure) {
          console.error('[jike-flomo] 数据同步失败', failure);
          if (await dialog({ title: '同步暂未完成', body: `${failure.message}\n原有缓存已保留，可以稍后重新同步。`, confirm: '重新同步' })) request(mode);
        } else if (paused) toast('同步已暂停，原有缓存保留。可从菜单重新同步。');
        else if (mode === 'all') {
          // 释放完整历史在原生列表中的内存，刷新后仅加载首屏，不再重复初始化。
          sessionStorage.setItem(NOTICE, JSON.stringify({ account, count: state.meta.postCount }));
          location.reload();
        } else toast(state.meta.limited ? `已同步最近 ${state.meta.pages} 页，更多历史可从「全量刷新」读取。` : '热力图和统计已更新');
      });
    }
    async function clear() {
      if (!await dialog({ title: '清除本地数据？', body: '将清除本扩展缓存的动态、热力图和统计。\n即刻上的动态、图片草稿和开关设置都会保留。\n下次打开即刻时，会重新同步最近半年数据。', confirm: '清除数据', danger: true })) return;
      await exclusive(async () => {
        state.running = true;
        try {
          await drainScan(); await window.JF_DB.clearData();
          autoAttempted = true;
          state = { loaded: true, initialized: false, running: true, cleared: true, meta: null };
          resetScanned(); await refresh(); channel.postMessage({ type: 'cleared' });
          toast('本地统计缓存已清除，下次打开时会重新初始化');
        } catch (error) { toast(`清除失败：${error.message}`); }
        finally { state.running = false; summary(); }
      });
    }
    function mountPanel(panel) {
      const button = panel.querySelector('.jf-data-trigger'), menu = panel.querySelector('.jf-data-dropdown');
      const close = () => { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); };
      on(button, 'click', () => { menu.hidden = !menu.hidden; button.setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) menu.querySelector('button').focus(); });
      on(document, 'click', e => { if (!e.target.closest('.jf-data-menu')) close(); });
      on(document, 'keydown', e => { if (e.key === 'Escape' && !menu.hidden) { close(); button.focus(); } });
      on(menu, 'keydown', e => {
        const items = [...menu.querySelectorAll('button')], index = items.indexOf(document.activeElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items[next].focus();
        }
      });
      on(menu, 'click', async e => {
        const action = e.target.closest('[data-sync-action]')?.dataset.syncAction; if (!action) return; close();
        if (action === 'clear') clear();
        else if (action === 'recent') request('recent');
        else if (await dialog({ title: '全量刷新完整历史？', body: '将从最新动态逐页读取到最早的动态，重建完整历史的统计和热力图。\n动态较多时可能需要几分钟或更久，请保持页面打开。\n完成后才替换本地缓存，中途暂停会保留原数据。', confirm: '开始全量刷新' })) request('all');
      });
      summary();
    }
    async function maybeInitialize() {
      if (checking || state.running || signal.aborted) return;
      checking = true;
      try {
        const key = ownProfilePath(); if (!key) return;
        if (key !== account || !state.loaded) {
          if (key !== account) autoAttempted = false;
          account = key; state.loaded = false;
          state.meta = await window.JF_DB.getSyncState(account);
          state.initialized = !!state.meta?.initialized; state.loaded = true; summary();
          const notice = JSON.parse(sessionStorage.getItem(NOTICE) || 'null');
          if (notice?.account === account) {
            sessionStorage.removeItem(NOTICE); toast(`全量刷新完成，已同步 ${notice.count} 条动态`);
          }
        }
        if (autoAttempted) return;
        const pending = sessionStorage.getItem(PENDING);
        if (pending || !state.initialized) {
          if (!isMyPage()) { autoAttempted = true; await request(pending === 'all' ? 'all' : 'recent'); return; }
          if (!getProfile()?.id) return;
          autoAttempted = true; sessionStorage.removeItem(PENDING);
          run(pending === 'all' ? 'all' : 'recent').catch(error => toast(`无法同步：${error.message}`));
        }
      } catch (error) { autoAttempted = true; toast(`无法读取同步状态：${error.message}`); }
      finally { checking = false; }
    }
    channel.onmessage = async event => {
      if (event.data.type === 'cleared') {
        autoAttempted = true; state.initialized = false; state.cleared = true; state.meta = null; resetScanned();
      } else if (event.data.account === account) {
        state.meta = await window.JF_DB.getSyncState(account); state.initialized = !!state.meta?.initialized; state.cleared = false;
      }
      summary(); await refresh();
    };
    signal.addEventListener('abort', () => { active?.abort(); channel.close(); }, { once: true });
    return { mountPanel, maybeInitialize, canCache: post => state.loaded && state.initialized && !state.running && !state.cleared &&
      (state.meta?.scope === 'all' || !post || new Date(post.createdAt).getTime() >= state.meta.coverageStart) };
  }
  window.JF_SYNC = { create, collect, sixMonthsAgo };
})();
