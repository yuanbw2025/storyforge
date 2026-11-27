import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { expect, test } from '@playwright/test'

let bundle = ''
test.beforeAll(async () => {
  const source = JSON.stringify(fileURLToPath(new URL('../../src/components/shared/CompositionInput.tsx', import.meta.url)))
  const entry = 'virtual:textarea-native-capture'
  const code = `
import {createElement as h,useState} from 'react';
import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {CTextarea} from ${source};
const observed={captures:[],changes:[]};window.__captureFixture=observed;
function App(){
 const [value,setValue]=useState('模型原候选'),[paint,setPaint]=useState(0);
 return h('main',null,h('output',{id:'paint'},paint),h(CTextarea,{
  'aria-label':'正在编辑的候选',value,
  onInputCapture:event=>{const area=event.currentTarget,before=area.value;
   // Force a permitted parent-state update in the native capture/bubble gap.
   // This does not change the candidate, input, scope or callback contract.
   flushSync(()=>setPaint(current=>current+1));observed.captures.push({before,after:area.value});},
  onChange:event=>{observed.changes.push(event.target.value);setValue(event.target.value)}
 }),h('output',{id:'reported'},value));
}createRoot(document.getElementById('fixture')).render(h(App));`
  const built = await build({configFile:false,publicDir:false,logLevel:'silent',plugins:[{
    name:'textarea-native-capture',resolveId(id){if(id===entry)return '\0'+entry},load(id){if(id==='\0'+entry)return code},
  }],build:{write:false,minify:false,rollupOptions:{input:entry,output:{format:'iife'}}}})
  bundle=(Array.isArray(built)?built:[built]).flatMap(output=>'output' in output?output.output:[])
    .filter(output=>output.type==='chunk').map(output=>output.code).join('\n')
  expect(bundle).not.toBe('')
})

test('native author input survives a real parent render before its change callback', async ({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>route.request().url()==='https://capture.fixture.invalid/'
    ?route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><div id="fixture"></div>'})
    :route.abort('blockedbyclient'))
  await page.goto('https://capture.fixture.invalid/')
  await page.addScriptTag({content:bundle})
  const area=page.getByRole('textbox',{name:'正在编辑的候选',exact:true})
  await expect(area).toHaveValue('模型原候选')
  const edited='作者确认版：神谕必须由两名见证者共同记录。🌊'
  await area.fill(edited)
  await expect(area).toHaveValue(edited)
  await expect(page.locator('#reported')).toHaveText(edited)
  expect(await page.evaluate(()=>Reflect.get(window,'__captureFixture'))).toEqual({
    captures:[{before:edited,after:edited}],changes:[edited],
  })
  expect(errors).toEqual([])
})
