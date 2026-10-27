// 独立图片附件 + 按标签页保存的本地草稿。图片不进入 contenteditable。
(function () {
  'use strict';
  let draft = { text: '', files: [] };
  let writes = Promise.resolve();
  const ready = window.JF_DB.loadDraft().then(value => { draft = value; });
  const persist = () => (writes = writes.catch(() => {}).then(() => window.JF_DB.saveDraft(draft)));
  const MAX_IMAGES = 9;

  async function imageFile(file) {
    if (!file?.type.startsWith('image/')) throw new Error('请选择图片文件');
    const bitmap = await createImageBitmap(file);
    try {
      if (/^image\/(png|jpeg)$/.test(file.type)) return file;
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('图片转换失败');
      return new File([blob], `${file.name.replace(/\.[^.]*$/, '') || 'image'}.png`, { type: 'image/png' });
    } finally { bitmap.close(); }
  }

  async function mount(box, { signal: parentSignal, post }) {
    if (parentSignal.aborted) return;
    const controller = new AbortController();
    const signal = controller.signal;
    const $ = s => box.querySelector(s);
    const input = $('.jf-composer-input');
    const send = $('.jf-composer-send');
    const sendIcon = send.innerHTML;
    const images = $('.jf-attachments');
    const fileInput = $('.jf-file-input');
    const status = $('.jf-composer-status');
    let busy = false, importing = 0, urls = [], rich = null;
    const dispose = () => {
      controller.abort();
      urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
      parentSignal.removeEventListener('abort', dispose);
    };
    box._jfDispose = dispose;
    parentSignal.addEventListener('abort', dispose, { once: true });
    let imports = Promise.resolve();
    const on = (el, event, fn) => el.addEventListener(event, fn, { signal });
    const message = text => { status.textContent = text; status.hidden = !text; };
    const save = () => persist().catch(() => message('草稿保存失败，请保留当前页面'));
    const update = () => {
      if (signal.aborted || !box.isConnected) return;
      $('[data-count]').textContent = draft.text.trim().length;
      box.classList.toggle('jf-active', !!draft.text.trim() || draft.files.length > 0);
      box.classList.toggle('jf-has-images', draft.files.length > 0);
      send.disabled = busy || importing > 0 || (!draft.text.trim() && !draft.files.length);
      input.contentEditable = String(!busy);
      fileInput.disabled = busy;
      box.querySelectorAll('.jf-image-remove, .jf-image-add, [data-k="img"], [data-k="at"], [data-k="tag"]').forEach(el => { el.disabled = busy; });
      rich?.setDisabled(busy);
    };
    const renderImages = () => {
      if (signal.aborted || !box.isConnected) return;
      urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
      images.replaceChildren();
      images.hidden = !draft.files.length;
      draft.files.forEach((file, index) => {
        const item = document.createElement('div'); item.className = 'jf-image-item';
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file); urls.push(img.src);
        img.alt = file.name || `图片 ${index + 1}`;
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'jf-image-remove';
        remove.setAttribute('aria-label', `删除图片 ${index + 1}`); remove.title = '删除图片'; remove.textContent = '×';
        on(remove, 'click', () => {
          draft.files.splice(index, 1); message(''); renderImages(); update(); save();
        });
        item.append(img, remove); images.append(item);
      });
      if (draft.files.length < MAX_IMAGES) {
        const add = document.createElement('button'); add.type = 'button'; add.className = 'jf-image-add';
        add.textContent = '+'; add.title = '添加图片'; add.setAttribute('aria-label', '添加图片');
        on(add, 'click', () => fileInput.click()); images.append(add);
      }
    };
    const addImages = files => {
      importing++; update(); message('正在读取图片…');
      imports = imports.then(async () => {
        for (const file of files) {
          if (draft.files.length >= MAX_IMAGES) throw new Error(`最多添加 ${MAX_IMAGES} 张图片`);
          draft.files.push(await imageFile(file));
        }
        message('');
      }).catch(error => message(error.message || '图片读取失败')).finally(() => {
        importing--; renderImages(); update(); save();
      });
      return imports;
    };
    const insertText = text => {
      if (!text) return;
      input.focus();
      document.execCommand('insertText', false, text);
      syncInput();
    };
    input.contentEditable = 'false'; send.disabled = true;
    try { await ready; } catch { message('无法读取本地草稿'); }
    if (signal.aborted || !box.isConnected) return;
    input.textContent = draft.text;
    const syncInput = () => {
      Object.assign(draft, rich ? rich.read() : { text: input.innerText });
      update(); save();
    };
    rich = window.JF_RICH.mount(box, { signal, getDraft: () => draft, change: syncInput });
    renderImages(); update();
    on(input, 'input', syncInput);
    on(box, 'focusin', () => box.classList.add('jf-focus'));
    on(box, 'focusout', e => { if (!box.contains(e.relatedTarget)) box.classList.remove('jf-focus'); });
    on(box, 'click', e => { if (e.target === box) input.focus(); });
    // 折叠状态下直接点按钮时，避免 mousedown 聚焦触发展开、按钮移位导致 click 丢失。
    on(send, 'mousedown', e => e.preventDefault());
    on($('[data-k="img"]'), 'mousedown', e => e.preventDefault());
    on($('[data-k="img"]'), 'click', () => fileInput.click());
    on(fileInput, 'change', () => { addImages([...fileInput.files]); fileInput.value = ''; });
    on(input, 'paste', e => {
      e.preventDefault();
      const data = e.clipboardData;
      const files = [...(data?.items || [])].filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
      const text = data?.getData('text/plain') || '';
      insertText(text);
      if (files.length) { addImages(files); return; }
      const html = data?.getData('text/html');
      if (!html) return;
      const sources = [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('img')].map(i => i.getAttribute('src')).filter(Boolean);
      if (sources.length) {
        // HTML 图片也先转换成文件；不允许图片标签直接进入正文。
        importing++; update();
        Promise.all(sources.slice(0, MAX_IMAGES).map(async src => {
          const url = new URL(src, location.href);
          if (!['data:', 'blob:', 'https:', 'http:'].includes(url.protocol)) throw new Error('无法读取这张图片，请复制图片本身再粘贴');
          const response = await fetch(url);
          if (!response.ok) throw new Error('图片读取失败');
          const blob = await response.blob();
          return new File([blob], `paste-${Date.now()}.png`, { type: blob.type });
        })).then(addImages).catch(() => message('无法读取这张图片，请复制图片本身再粘贴')).finally(() => { importing--; update(); });
      }
    });
    on(box, 'dragover', e => {
      if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = busy ? 'none' : 'copy'; }
    });
    on(box, 'drop', e => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault(); if (!busy) addImages([...e.dataTransfer.files]);
    });
    const submit = async () => {
      if (busy || importing || (!draft.text.trim() && !draft.files.length)) return;
      busy = true; update(); message('');
      send.textContent = '…';
      try {
        await persist();
        const result = await post(draft.text.trim(), [...draft.files], message, { editorState: draft.editorState, topic: draft.topic });
        if (result === 'sent') {
          draft = { text: '', files: [] }; input.textContent = '';
          rich.reset(); renderImages(); await persist(); message('');
        }
      } catch (error) { message(error.message || '发送失败，草稿已保留'); }
      finally { busy = false; send.innerHTML = sendIcon; update(); }
    };
    box._jfSubmit = submit;
    on(send, 'click', submit);
    on(input, 'keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); }
    });
  }
  window.JF_COMPOSER = { mount, flush: async () => { await ready; await writes; } };
})();
