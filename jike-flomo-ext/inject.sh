#!/bin/bash
# 热更新注入到当前即刻页 —— 改完 css/js 跑一次，不用刷新
cd "$(dirname "$0")"
browser-harness <<'PY'
import os
css_src = open('styles/flomo.css').read()
content_src = open('content.js').read()
composer_src = open('composer.js').read()
sync_src = open('data-sync.js').read()
db_src = open('db.js').read()

# 找即刻 tab
tabs = [t for t in list_tabs() if 'web.okjike.com' in t['url']]
target = os.environ.get('JF_TAB_ID')
tab = next((t for t in tabs if t['target_id'] == target), None) if target else next(iter(tabs), None)
if not tab:
    raise SystemExit('没有找到目标即刻标签页')
switch_tab(tab['target_id'])

# 先保存草稿，兼容旧版把图片直接粘进 contenteditable 的情况。
js("(async () => { if (window.JF_COMPOSER) await window.JF_COMPOSER.flush(); return 'saved'; })()")
js(f"(() => {{ {db_src} ; return 'db'; }})()")
js("""
(async () => {
  if (window.JF_COMPOSER) return 'already saved';
  const input = document.querySelector('.jf-composer-input');
  if (!input) return 'no draft';
  const files = [];
  for (const image of input.querySelectorAll('img')) {
    const blob = await (await fetch(image.src)).blob();
    files.push(new File([blob], 'paste.png', { type: blob.type }));
  }
  if (input.innerText.trim() || files.length) await window.JF_DB.saveDraft({ text: input.innerText, files });
  return 'legacy draft saved';
})()
""")

# 清旧
js("""
(() => {
  window.__JF_CLEANUP__?.();
  ['jf-test-css','jf-sidebar','jf-topwrap','jf-composer','jf-composer-tail','jf-profile'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.remove();
  });
  document.querySelectorAll('[data-jf-scanned],[data-jf-abs]').forEach(el=>{delete el.dataset.jfScanned;delete el.dataset.jfAbs;});
  const l=document.querySelector('.jf-layout'); if(l) l.classList.remove('jf-layout');
  document.documentElement.classList.remove('jf-on'); delete document.body.dataset.jfRoute;
  ['--jf-main-left','--jf-main-w-real','--jf-composer-space'].forEach(p=>document.documentElement.style.removeProperty(p));
  return 'cleaned';
})()
""")

# 重新注
js(f"(() => {{ const s=document.createElement('style'); s.id='jf-test-css'; s.textContent={css_src!r}; document.head.appendChild(s); return 'css'; }})()")
js(f"(() => {{ {composer_src} ; return 'composer'; }})()")
js(f"(() => {{ {sync_src} ; return 'data sync'; }})()")
print(js(f"(() => {{ {content_src} ; return 'injected ✓'; }})()"))
PY
