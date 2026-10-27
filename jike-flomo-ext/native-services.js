// 复用即刻现有的 @ 搜索、圈子搜索和推荐回调，不自行请求私有 API。
(function () {
  'use strict';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const fiber = el => el?.[Object.keys(el).find(k => k.startsWith('__reactFiber'))];
  function ancestor(el, test, hops = 35) {
    for (let node = fiber(el), i = 0; node && i < hops; node = node.return, i++) {
      if (test(node.memoizedProps || {}, node)) return node;
    }
    return null;
  }
  function descendant(root, test) {
    const stack = [root]; let count = 0;
    while (stack.length && count++ < 1500) {
      const node = stack.pop(); if (!node) continue;
      if (test(node.memoizedProps || {}, node)) return node;
      for (let child = node.child; child; child = child.sibling) stack.push(child);
    }
    return null;
  }
  function mentionSearch(doc) {
    const root = ancestor(doc.querySelector('[data-lexical-editor]'), p => !!p.initialConfig);
    return descendant(root, p => p.triggers?.includes('@') && typeof p.onSearch === 'function')?.memoizedProps.onSearch;
  }
  function topicParts(doc) {
    const input = doc.querySelector('[class*=_postForm] input[placeholder="未选择圈子"]');
    const picker = ancestor(input, p => typeof p.onSearch === 'function');
    const owner = ancestor(input, p => p.name === 'topic' && typeof p.onChange === 'function');
    const list = owner && descendant(owner, p => Array.isArray(p.data) && typeof p.onSelect === 'function');
    let observer;
    for (let node = owner, i = 0; node && i < 3 && !observer; node = node.return, i++) {
      for (let hook = node.memoizedState, j = 0; hook && j < 40; hook = hook.next, j++) {
        const value = hook.memoizedState;
        if (typeof value?.getCurrentResult === 'function' && value.options?.queryKey?.[0] === 'SUGGEST') { observer = value; break; }
      }
    }
    return { search: picker?.memoizedProps.onSearch, items: list?.memoizedProps.data || [], observer };
  }
  function form(doc) {
    return ancestor(doc.querySelector('[class*=_postForm] input[type=file]'), p => typeof p.getValues === 'function')?.memoizedProps;
  }
  function create(signal) {
    let frame, context, disposed = false, queue = Promise.resolve(), topicVersion = 0;
    const check = () => { if (disposed || signal.aborted) throw new DOMException('已停止搜索', 'AbortError'); };
    async function wait(test, timeout = 18000) {
      const start = Date.now();
      while (true) {
        check(); const result = test(); if (result) return result;
        if (Date.now() - start > timeout) throw new Error('即刻搜索暂未就绪，请稍后重试');
        await sleep(80);
      }
    }
    async function isolated() {
      check();
      if (!context) context = (async () => {
        frame = document.createElement('iframe'); frame.src = new URL('/following', location.origin).href;
        frame.title = '即刻发帖功能'; frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
        frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:750px;height:1px;border:0;pointer-events:none;visibility:hidden;';
        document.body.append(frame);
        const doc = await wait(() => frame?.contentDocument?.querySelector('[data-lexical-editor]') && frame.contentDocument);
        const style = doc.createElement('style'); style.textContent = '[class*=_desktopStack],[class*=_post_],[class*=_viewport_1mtxv]{display:none!important}';
        doc.head.append(style);
        const nativeForm = await wait(() => form(doc));
        nativeForm.setValue('topic', undefined);
        await wait(() => mentionSearch(doc) && form(doc) && topicParts(doc).search);
        return doc;
      })().catch(error => { frame?.remove(); frame = null; context = null; throw error; });
      return context;
    }
    const serial = fn => {
      const version = ++topicVersion;
      const task = queue.catch(() => {}).then(async () => { check(); return version === topicVersion ? fn() : []; });
      queue = task; return task;
    };
    return {
      prepare: isolated,
      async users(query) {
        // 只读 @ 回调优先使用当前页，个人主页则按需初始化独立的原生表单。
        const handler = mentionSearch(document) || mentionSearch(await isolated());
        check(); return (await handler('@', query) || []).filter(item => item.id && item.value);
      },
      topics(query) {
        return serial(async () => {
          const doc = await isolated();
          await wait(() => !topicParts(doc).observer?.getCurrentResult().isFetching);
          const before = topicParts(doc).items;
          topicParts(doc).search(query);
          const items = await wait(() => { const items = topicParts(doc).items; return items !== before && items; });
          return items.filter(item => item.id && item.content);
        });
      },
      recommendations(text) {
        return serial(async () => {
          const doc = await isolated(); form(doc).setValue('content', text);
          const observer = await wait(() => {
            const observer = topicParts(doc).observer;
            return observer?.options.queryKey[1] === text && observer;
          });
          if (observer.options.enabled === false) return [];
          const result = await wait(() => {
            const result = observer.getCurrentResult();
            if (result.isError) throw result.error || new Error('圈子推荐暂不可用');
            return !result.isFetching && result.isSuccess && result;
          });
          return (result.data || []).filter(item => item.id && item.content);
        });
      },
      dispose() { disposed = true; topicVersion++; frame?.remove(); frame = null; context = null; },
    };
  }
  window.JF_NATIVE = { create };
})();
