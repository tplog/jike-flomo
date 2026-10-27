# Run after loading the extension in a Jike tab:
# JF_TAB_ID=<target_id> browser-harness < tests/composer-rich.py
# Tests detached DOM only; does not change drafts, search, or publish.
import os
if os.environ.get('JF_TAB_ID'):
    switch_tab(os.environ['JF_TAB_ID'])
result = js('''(() => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const input = document.createElement('div');
  input.innerHTML = '第一行<div>第二行<br>第三行</div>';
  let parsed = window.JF_RICH.read(input);
  assert(parsed.text === '第一行\\n第二行\\n第三行', 'multiline serialization');
  const state = {root:{children:[{children:[
    {type:'text',text:'你好 '},
    {type:'custom-beautifulMention',value:'用户 <A>',data:{id:'test-user',screenName:'用户 <A>',avatar:''}},
    {type:'text',text:' '}, {type:'linebreak'}, {type:'text',text:'正文'}
  ]}]}};
  window.JF_RICH.restore(input, {text:'',editorState:state});
  parsed = window.JF_RICH.read(input);
  assert(parsed.text === '你好 @用户 <A> \\n正文', 'mention display and line breaks');
  const mention = parsed.editorState.root.children[0].children.find(n=>n.type==='custom-beautifulMention');
  assert(mention.data.id === 'test-user' && mention.value === '用户 <A>', 'mention identity roundtrip');
  assert(!input.querySelector('a'), 'mention names are text');
  assert(input.querySelector('.jf-mention').contentEditable === 'false', 'mention is atomic');
  window.JF_RICH.restore(input, {text:'@普通文字'});
  parsed = window.JF_RICH.read(input);
  assert(parsed.text === '@普通文字' && !parsed.editorState.root.children[0].children.some(n=>n.data?.id), 'legacy draft stays plain text');
  window.JF_RICH.restore(input, {text:'',editorState:{root:{children:[{children:[{type:'text',text:'A'}]},{children:[{type:'text',text:'B'}]}]}}});
  assert(window.JF_RICH.read(input).text === 'A\\nB', 'paragraph import');
  return 'PASS: 多行、用户引用与 id 恢复、安全渲染、原子节点、旧草稿、段落导入';
})()''')
print(result)
