// @ 用户与 # 圈子：保留真实用户节点和圈子 id，使用即刻原生搜索/推荐。
(function () {
  'use strict';
  const textNode = text => ({ detail: 0, format: 0, mode: 'normal', style: '', text, type: 'text', version: 1 });
  function read(input) {
    const children = [];
    const newline = () => children.push({ type: 'linebreak', version: 1 });
    function walk(parent) {
      for (const node of parent.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (node.textContent) children.push(textNode(node.textContent));
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.dataset.jfMention) {
            const value = node.dataset.name;
            children.push({ trigger: '@', value, data: { id: node.dataset.jfMention, screenName: value, avatar: node.dataset.avatar || '' }, type: 'custom-beautifulMention', version: 1 });
          } else if (node.tagName === 'BR') newline();
          else {
            const block = /^(DIV|P|LI)$/.test(node.tagName);
            if (block && children.length && children.at(-1).type !== 'linebreak') newline();
            walk(node);
            if (block && node.nextSibling && children.at(-1)?.type !== 'linebreak') newline();
          }
        }
      }
    }
    walk(input);
    const text = children.map(n => n.type === 'text' ? n.text : n.type === 'linebreak' ? '\n' : '@' + n.value).join('');
    return { text, editorState: { root: { children: [{ children, direction: null, format: '', indent: 0, type: 'paragraph', version: 1, textFormat: 0, textStyle: '' }], direction: null, format: '', indent: 0, type: 'root', version: 1 } } };
  }
  function mention(user) {
    const el = document.createElement('span'); el.className = 'jf-mention'; el.contentEditable = 'false';
    el.dataset.jfMention = user.id; el.dataset.name = user.screenName || user.value; el.dataset.avatar = user.avatar || '';
    el.textContent = '@' + el.dataset.name; return el;
  }
  function restore(input, draft) {
    if (!draft.editorState?.root?.children) { input.textContent = draft.text || ''; return; }
    input.replaceChildren();
    draft.editorState.root.children.forEach((paragraph, index) => {
      if (index) input.append(document.createElement('br'));
      for (const node of paragraph.children || []) {
        if (node.type === 'custom-beautifulMention' && node.data?.id) input.append(mention({ ...node.data, value: node.value }));
        else if (node.type === 'linebreak') input.append(document.createElement('br'));
        else if (node.type === 'text') input.append(document.createTextNode(node.text || ''));
      }
    });
  }
  function mount(box, { signal, getDraft, change }) {
    const input = box.querySelector('.jf-composer-input');
    const row = box.querySelector('.jf-topic-row');
    const menu = document.createElement('div'); menu.className = 'jf-suggestions'; menu.hidden = true;
    menu.id = 'jf-suggestions'; menu.role = 'listbox'; menu.setAttribute('aria-label', '搜索结果');
    document.body.append(menu);
    const on = (el, event, fn, extra = {}) => el.addEventListener(event, fn, { signal, ...extra });
    let services, timer, recTimer, idleTimer, sequence = 0, selected = 0, items = [], active = null, lastRange = null;
    let composing = false, disabled = false, recommendations = [], recVersion = 0, focused = false;
    const service = () => services || (services = window.JF_NATIVE.create(signal));
    function close() {
      sequence++; menu.hidden = true; menu.replaceChildren(); items = []; active = null;
      input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
    }
    function focusEnd() {
      input.focus();
      if (lastRange && input.contains(lastRange.startContainer) && input.contains(lastRange.endContainer)) {
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(lastRange.cloneRange());
      } else {
        const range = document.createRange(); range.selectNodeContents(input); range.collapse(false);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      }
    }
    function currentTrigger() {
      const selection = window.getSelection();
      if (!selection?.isCollapsed || !selection.rangeCount) return null;
      const range = selection.getRangeAt(0);
      if (!input.contains(range.startContainer) || range.startContainer.nodeType !== Node.TEXT_NODE || range.startContainer.parentElement.closest('[data-jf-mention]')) return null;
      const before = range.startContainer.textContent.slice(0, range.startOffset);
      const match = /(?:^|[^\w@])([@#])([^\s@#]{0,40})$/u.exec(before);
      if (!match) return null;
      const replace = range.cloneRange(); replace.setStart(range.startContainer, range.startOffset - match[1].length - match[2].length);
      return { trigger: match[1], query: match[2], range: replace };
    }
    function position() {
      if (menu.hidden || !active) return;
      const rect = active.range.getBoundingClientRect(), fallback = input.getBoundingClientRect();
      const x = rect.width || rect.height ? rect.left : fallback.left;
      const bottom = rect.width || rect.height ? rect.bottom : fallback.top + 26;
      const height = Math.min(menu.scrollHeight, 280);
      const top = bottom + height + 8 > innerHeight ? Math.max(8, (rect.top || fallback.top) - height - 6) : bottom + 6;
      menu.style.left = Math.max(8, Math.min(x, innerWidth - 288)) + 'px'; menu.style.top = top + 'px';
    }
    function highlight() {
      [...menu.querySelectorAll('[role=option]')].forEach((el, index) => {
        el.setAttribute('aria-selected', String(index === selected));
        if (index === selected) { input.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); }
      });
    }
    function choose(item) {
      if (!active || disabled) return;
      const range = active.range;
      if (!input.contains(range.startContainer)) { close(); return; }
      range.deleteContents();
      if (active.trigger === '@') {
        const token = mention(item), space = document.createTextNode(' ');
        range.insertNode(token); token.after(space); range.setStartAfter(space); range.collapse(true);
      } else {
        getDraft().topic = JSON.parse(JSON.stringify(item)); range.collapse(true);
      }
      input.focus(); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      lastRange = range.cloneRange(); close(); change(); renderTopics(); scheduleRecommendations();
    }
    function show(result, trigger, text) {
      menu.replaceChildren(); items = result.slice(0, 20); selected = 0; active = trigger;
      if (text || !items.length) {
        const note = document.createElement('div'); note.className = 'jf-suggestions-note'; note.textContent = text || '没有找到匹配结果'; menu.append(note);
      } else items.slice(0, 20).forEach((item, index) => {
        const button = document.createElement('button'); button.type = 'button'; button.role = 'option'; button.id = `jf-suggestion-${index}`;
        if (trigger.trigger === '@' && item.avatar) { const image = document.createElement('img'); image.src = item.avatar; image.alt = ''; button.append(image); }
        const label = document.createElement('span'); label.textContent = trigger.trigger === '@' ? item.screenName || item.value : '# ' + item.content;
        button.append(label); on(button, 'mousedown', e => e.preventDefault()); on(button, 'click', () => choose(item));
        on(button, 'mouseenter', () => { selected = index; highlight(); }); menu.append(button);
      });
      menu.hidden = false; input.setAttribute('aria-expanded', 'true'); position(); highlight();
    }
    function scheduleSearch() {
      clearTimeout(timer);
      if (disabled || composing) return;
      const trigger = currentTrigger();
      if (!trigger) { close(); return; }
      const version = ++sequence;
      show([], trigger, '正在搜索…');
      timer = setTimeout(async () => {
        try {
          const result = trigger.trigger === '@' ? await service().users(trigger.query) : await service().topics(trigger.query);
          if (version === sequence && !signal.aborted && currentTrigger()?.query === trigger.query) show(result, trigger);
        } catch (error) {
          if (version === sequence && !signal.aborted) show([], trigger, '搜索暂不可用，请稍后重试');
        }
      }, 180);
    }
    function setTopic(topic) {
      getDraft().topic = topic ? JSON.parse(JSON.stringify(topic)) : null;
      change(); renderTopics();
    }
    function renderTopics() {
      row.replaceChildren();
      const topic = getDraft().topic;
      row.hidden = !topic && (!focused || !recommendations.length);
      if (topic) {
        const chip = document.createElement('span'); chip.className = 'jf-topic-selected'; chip.append(document.createTextNode('# ' + topic.content));
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = '移除圈子'; remove.setAttribute('aria-label', '移除圈子'); remove.disabled = disabled;
        on(remove, 'mousedown', e => e.preventDefault()); on(remove, 'click', () => setTopic(null)); chip.append(remove); row.append(chip);
      } else if (focused) {
        recommendations.slice(0, 5).forEach(topic => {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'jf-topic-suggestion'; button.textContent = '# ' + topic.content; button.disabled = disabled;
          on(button, 'mousedown', e => e.preventDefault()); on(button, 'click', () => setTopic(topic)); row.append(button);
        });
      }
    }
    function scheduleRecommendations(immediate = false) {
      clearTimeout(recTimer);
      const version = ++recVersion;
      if (disabled || composing || !focused || currentTrigger()) return;
      recTimer = setTimeout(async () => {
        if (disabled || composing || !focused || currentTrigger()) return;
        try {
          const result = await service().recommendations(read(input).text);
          if (version === recVersion && !signal.aborted) { recommendations = result; renderTopics(); }
        } catch { /* 自动推荐不可用时仍可手动输入 # 发起搜索并查看错误提示。 */ }
      }, immediate ? 0 : 500);
    }
    on(input, 'input', () => { scheduleSearch(); scheduleRecommendations(); });
    on(input, 'compositionstart', () => { composing = true; close(); clearTimeout(recTimer); });
    on(input, 'compositionend', () => { composing = false; scheduleSearch(); scheduleRecommendations(); });
    on(input, 'keydown', e => {
      if (menu.hidden || e.isComposing || e.metaKey || e.ctrlKey) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
      else if (items.length && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(e.key)) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (e.key === 'Enter' || e.key === 'Tab') choose(items[selected]);
        else { selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; highlight(); }
      }
    }, { capture: true });
    on(document, 'selectionchange', () => {
      const selection = window.getSelection();
      if (selection?.rangeCount && input.contains(selection.anchorNode)) {
        lastRange = selection.getRangeAt(0).cloneRange();
        const trigger = currentTrigger();
        if (document.activeElement === input && (trigger?.trigger !== active?.trigger || trigger?.query !== active?.query)) scheduleSearch();
      }
    });
    on(input, 'click', scheduleSearch);
    on(box, 'focusin', () => {
      clearTimeout(idleTimer); focused = true; renderTopics();
      service().prepare().catch(() => {}); scheduleRecommendations(true);
    });
    on(box, 'focusout', e => {
      if (box.contains(e.relatedTarget) || menu.contains(e.relatedTarget)) return;
      focused = false; close(); renderTopics(); clearTimeout(recTimer);
      idleTimer = setTimeout(() => { services?.dispose(); services = null; }, 30000);
    });
    for (const [key, character] of [['at', '@'], ['tag', '#']]) {
      const button = box.querySelector(`[data-k="${key}"]`);
      on(button, 'mousedown', e => e.preventDefault());
      on(button, 'click', () => { if (disabled) return; focusEnd(); document.execCommand('insertText', false, character); scheduleSearch(); });
    }
    on(document, 'mousedown', e => { if (!box.contains(e.target) && !menu.contains(e.target)) close(); });
    on(window, 'resize', position); on(input, 'scroll', position);
    restore(input, getDraft());
    input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', menu.id); input.setAttribute('aria-expanded', 'false');
    renderTopics();
    signal.addEventListener('abort', () => { clearTimeout(timer); clearTimeout(recTimer); clearTimeout(idleTimer); services?.dispose(); menu.remove(); }, { once: true });
    return {
      read: () => read(input),
      reset() { recommendations = []; close(); renderTopics(); },
      setDisabled(value) { disabled = value; if (value) close(); renderTopics(); },
    };
  }
  window.JF_RICH = { mount, read, restore };
})();
