# Run with: JF_TAB_ID=<target_id> browser-harness < tests/composer-layout.py
# Uses the existing logged-in tab; never submits a post.
import os
import time

if os.environ.get('JF_TAB_ID'):
    switch_tab(os.environ['JF_TAB_ID'])
assert js("location.hostname === 'web.okjike.com'")
assert js("!document.querySelector('.jf-composer-input')?.innerText.trim() && !sessionStorage.getItem('jf-pending-post')"), '请先保存草稿'


def click_selector(selector):
    rect = js(f'document.querySelector({selector!r}).getBoundingClientRect().toJSON()')
    click_at_xy(rect['left'] + min(rect['width'] / 2, 60),
                rect['top'] + min(rect['height'] / 2, 25))


def check(label, height=160):
    state = js('''(() => {
      const box = document.querySelector('#jf-composer');
      const post = document.querySelector('[class*=_post_]');
      const scroller = document.querySelector('[class*=mantine-ScrollArea-viewport]');
      return {
        height: box?.getBoundingClientRect().height,
        gap: box && post ? post.getBoundingClientRect().top - box.getBoundingClientRect().bottom : null,
        scroll: scroller?.scrollTop,
        composers: document.querySelectorAll('#jf-composer').length
      };
    })()''')
    assert state['composers'] == 1 and state['scroll'] == 0, (label, state)
    assert state['height'] == height, (label, state)
    assert state['gap'] is not None and abs(state['gap'] - 10) < 1, (label, state)
    print(label, state)


check('列表顶部')
click_selector('.jf-composer-input')
time.sleep(.4)
check('展开', 320)
rect = js("document.querySelector('#jf-composer').getBoundingClientRect().toJSON()")
click_at_xy(rect['left'] - 30, rect['top'] + 40)
time.sleep(.4)
check('收起')
for i in range(3):
    for route in ['/following', '/me']:
        click_selector(f'.jf-nav-item[data-route="{route}"]')
        time.sleep(1.2)
        check(f'路由切换 {i + 1} {route}')
for expanded in [False, True]:
    if expanded:
        click_selector('.jf-composer-input')
        time.sleep(.4)
        check('卸载前展开', 320)
    # 卸载会产生高度为 0 的 ResizeObserver 通知；重建后首帖仍必须可见。
    js("document.querySelector('#jf-topwrap').remove(); 'removed'")
    time.sleep(1.2)
    check(f'输入框卸载重建 expanded={expanded}')
