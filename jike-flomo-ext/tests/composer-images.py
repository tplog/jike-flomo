# Run in an empty, disposable Jike tab:
# JF_TAB_ID=<target_id> browser-harness < tests/composer-images.py
# Does not click Send or publish anything.
import os
import time

switch_tab(os.environ['JF_TAB_ID'])
assert js("location.hostname === 'web.okjike.com'")
assert js("!document.querySelector('.jf-composer-input').innerText.trim() && !document.querySelector('.jf-image-item')"), '请使用没有草稿的测试页'


def state():
    return js('''(() => {
      const box = document.querySelector('#jf-composer');
      const post = document.querySelector('[class*=_post_]');
      return {
        images: box.querySelectorAll('.jf-image-item').length,
        inline: box.querySelectorAll('.jf-composer-input img').length,
        text: box.querySelector('.jf-composer-input').innerText,
        height: box.getBoundingClientRect().height,
        gap: post.getBoundingClientRect().top - box.getBoundingClientRect().bottom,
        status: box.querySelector('.jf-composer-status').innerText
      };
    })()''')


def paste(count=1, text=''):
    js(f'''(() => {{
      const input = document.querySelector('.jf-composer-input');
      input.focus();
      const data = new DataTransfer();
      for(let i=0;i<{count};i++) data.items.add(window.__jfImageTestFile);
      data.setData('text/plain', {text!r});
      input.dispatchEvent(new ClipboardEvent('paste', {{ clipboardData: data, bubbles: true, cancelable: true }}));
      return true;
    }})()''')
    time.sleep(.3)


def remove_all():
    while js("!!document.querySelector('.jf-image-remove')"):
        r = js("document.querySelector('.jf-image-remove').getBoundingClientRect().toJSON()")
        click_at_xy(r['left'] + 10, r['top'] + 10)


js('''(async () => {
  const canvas = document.createElement('canvas'); canvas.width=64; canvas.height=128;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#30cf79';ctx.fillRect(0,0,64,128);
  window.__jfImageTestFile=new File([await new Promise(r=>canvas.toBlob(r))], 'fixture.png', {type:'image/png'});
  return true;
})()''')
paste(1, '图片草稿测试')
s = state()
assert s['images'] == 1 and s['inline'] == 0 and s['text'] == '图片草稿测试', s
assert s['height'] == 320 and abs(s['gap'] - 10) < 1, s
print('图片与正文分离', s)
paste(10)
s = state()
assert s['images'] == 9 and '9' in s['status'] and s['inline'] == 0, s
print('多图上限', s)
remove_all()
assert state()['images'] == 0 and state()['text'] == '图片草稿测试'
paste(2)
js('(async()=>{await window.JF_COMPOSER.flush();return true;})()')
cdp('Page.reload')
wait_for_load()
time.sleep(.4)
s = state()
assert s['images'] == 2 and s['inline'] == 0 and s['text'] == '图片草稿测试', s
assert abs(s['gap'] - 10) < 1, s
print('刷新恢复图文草稿', s)
remove_all()
js("(() => {const e=document.querySelector('.jf-composer-input');e.textContent='';e.dispatchEvent(new InputEvent('input',{bubbles:true}));return true;})()")
js('(async()=>{await window.JF_COMPOSER.flush();return true;})()')
assert state()['images'] == 0 and state()['text'] == ''
print('测试草稿已清理；未发布动态')
