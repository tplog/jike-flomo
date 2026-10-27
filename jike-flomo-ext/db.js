// IndexedDB 本地库：记录浏览过的即刻动态，供热力图/统计使用
// key: 即刻动态 id；统计同步状态与图片草稿各自独立存储。
(function () {
  const DB_NAME = 'jike-flomo';
  const STORE = 'posts';
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'key' });
          s.createIndex('day', 'day', { unique: false });
          s.createIndex('ts', 'ts', { unique: false });
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  async function savePost(post) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.get(post.key);
      req.onsuccess = () => store.put({ ...req.result, ...post, mine: !!(post.mine || req.result?.mine) });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function allPosts() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // { 'YYYY-MM-DD': count }
  async function countByDay() {
    const posts = await allPosts();
    const map = {};
    for (const p of posts) map[p.day] = (map[p.day] || 0) + 1;
    return map;
  }

  // 成功采集后一次性替换同步范围，删除已从即刻移除的动态；失败时不动旧缓存。
  async function replacePosts(posts, { uid, cutoff = null }) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        for (const post of req.result) {
          if (post.uid === uid && (cutoff === null || post.ts >= cutoff)) store.delete(post.key);
        }
        posts.forEach(post => store.put(post));
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('同步保存已取消'));
    });
  }

  let stateDb;
  function openState() {
    if (!stateDb) stateDb = new Promise((resolve, reject) => {
      const req = indexedDB.open('jike-flomo-state', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('sync');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return stateDb;
  }
  async function getSyncState(account) {
    const db = await openState();
    return new Promise((resolve, reject) => {
      const req = db.transaction('sync').objectStore('sync').get(account);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
  async function setSyncState(account, state) {
    const db = await openState();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sync', 'readwrite');
      tx.objectStore('sync').put(state, account);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  async function clearData() {
    const db = await open();
    const state = await openState();
    for (const [database, store] of [[db, STORE], [state, 'sync']]) {
      await new Promise((resolve, reject) => {
        const tx = database.transaction(store, 'readwrite');
        tx.objectStore(store).clear();
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  // 图片草稿单独存储，不升级帖子库；File/Blob 由 IndexedDB 原样保存。
  let draftDb;
  const draftKey = sessionStorage.getItem('jf-draft-key') || crypto.randomUUID();
  sessionStorage.setItem('jf-draft-key', draftKey);
  function openDrafts() {
    if (!draftDb) draftDb = new Promise((resolve, reject) => {
      const req = indexedDB.open('jike-flomo-drafts', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('drafts');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return draftDb;
  }
  async function saveDraft(draft) {
    const db = await openDrafts();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').put(draft, draftKey);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  async function loadDraft() {
    const db = await openDrafts();
    return new Promise((resolve, reject) => {
      const req = db.transaction('drafts').objectStore('drafts').get(draftKey);
      req.onsuccess = () => resolve(req.result || { text: '', files: [] });
      req.onerror = () => reject(req.error);
    });
  }
  window.JF_DB = { savePost, allPosts, countByDay, replacePosts, clearData, getSyncState, setSyncState, saveDraft, loadDraft };
})();
