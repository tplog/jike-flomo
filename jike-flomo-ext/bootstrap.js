// 只有隔离环境可以调用扩展 API；实际皮肤由后台在 MAIN 环境按开关状态注入。
chrome.runtime.sendMessage({ type: 'JF_INIT' }).catch(error => {
  console.warn('[jike-flomo] 初始化失败', error);
});
