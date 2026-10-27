const JIKE_URL = 'https://web.okjike.com/*';
const isJike = url => typeof url === 'string' && url.startsWith('https://web.okjike.com/');
const isEnabled = async () => (await chrome.storage.local.get('enabled')).enabled !== false;

async function updateAction(enabled) {
  await Promise.all([
    chrome.action.setBadgeText({ text: '' }),
    chrome.action.setIcon({ path: {
      16: `icons/${enabled ? 'on' : 'off'}-16.png`,
      32: `icons/${enabled ? 'on' : 'off'}-32.png`,
    } }),
    chrome.action.setTitle({ title: `Jike → Flomo：已${enabled ? '开启，点击关闭' : '关闭，点击开启'}` }),
  ]);
}

async function initialize(tabId) {
  if (!await isEnabled()) return;
  const target = { tabId };
  await chrome.scripting.insertCSS({ target, files: ['styles/flomo.css'] });
  await chrome.scripting.executeScript({
    target,
    world: 'MAIN',
    files: ['db.js', 'native-services.js', 'composer-rich.js', 'composer.js', 'data-sync.js', 'content.js'],
  });
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'JF_INIT' || sender.frameId !== 0 || !sender.tab?.id || !isJike(sender.url)) return;
  initialize(sender.tab.id).then(() => respond({ ok: true })).catch(error => {
    console.warn('[jike-flomo] 注入失败', error);
    respond({ ok: false, error: error.message });
  });
  return true;
});

async function toggle() {
  const enabled = await isEnabled();
  const tabs = await chrome.tabs.query({ url: JIKE_URL });
  if (enabled) {
    // 刷新前等待已排队的图文草稿写入完成。
    for (const tab of tabs) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: async () => {
            try {
              await window.JF_COMPOSER?.flush?.();
              return { ok: true };
            } catch (error) { return { ok: false, error: error.message }; }
          },
        });
        if (!results[0]?.result?.ok) throw new Error(results[0]?.result?.error || '草稿保存失败');
      } catch (error) {
        // 导航中或已关闭的标签页不阻止开关；仍在即刻页时保留现场以免丢草稿。
        const current = await chrome.tabs.get(tab.id).catch(() => null);
        if (current && isJike(current.url)) throw error;
      }
    }
  }
  await chrome.storage.local.set({ enabled: !enabled });
  await updateAction(!enabled);
  await Promise.allSettled(tabs.map(tab => chrome.tabs.reload(tab.id)));
}

// 连续点击按顺序处理，避免两次点击都读到同一个旧状态。
let toggles = Promise.resolve();
chrome.action.onClicked.addListener(() => {
  toggles = toggles.then(toggle).catch(async error => {
    console.error('[jike-flomo] 切换失败', error);
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setTitle({ title: `Jike → Flomo：切换失败（${error.message}），点击重试` });
  });
});
chrome.runtime.onInstalled.addListener(async () => {
  const enabled = await isEnabled();
  await chrome.storage.local.set({ enabled });
  await updateAction(enabled);
});
chrome.runtime.onStartup.addListener(async () => updateAction(await isEnabled()));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) updateAction(changes.enabled.newValue !== false);
});
