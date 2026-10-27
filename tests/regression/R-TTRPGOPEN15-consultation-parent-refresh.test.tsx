import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import TtrpgOpenPlayTable from '../../src/components/ttrpg/TtrpgOpenPlayTable'
import {seedManualTableV1} from '../helpers/open-ttrpg-manual'
import {OPEN_HUMAN_VIEWER} from '../helpers/open-ttrpg-session'
import {readProductRuntimeState} from '../../src/lib/product/runtime-core'
globalThis.IS_REACT_ACT_ENVIRONMENT=true
let host,root
beforeEach(async()=>{await db.delete();await db.open();host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();db.close()})
async function until(check){for(let n=0;n<1000;n++){await act(async()=>{await new Promise(r=>setTimeout(r,5))});if(check())return}throw Error('Normal consultation controls did not remain expanded after saved epoch refresh')}
const button=name=>[...host.querySelectorAll('button')].find(b=>b.textContent===name)
it('keeps the real consultation panel open after starting its saved window and clears it on identity handoff',async()=>{
 const {f}=await seedManualTableV1();const props={session:(await db.productRuntimeSessions.get(f.sessionId)),scope:f.scope,state:await readProductRuntimeState(f.sessionId),onChanged:vi.fn(async()=>{}),onCheckpoint:vi.fn(async()=>{})}
 const render=()=>root.render(createElement(TtrpgOpenPlayTable,props));props.onChanged.mockImplementation(async()=>{props.state=await readProductRuntimeState(f.sessionId);props.session=await db.productRuntimeSessions.get(f.sessionId);render()})
 await act(async()=>render());await until(()=>!!host.querySelector('select[aria-label="我的角色"]'))
 await act(async()=>{const s=host.querySelector('select[aria-label="我的角色"]');s.value=OPEN_HUMAN_VIEWER;s.dispatchEvent(new Event('change',{bubbles:true}))});await act(async()=>button('确认身份并进入').click());await until(()=>!!host.querySelector('[data-testid="ttrpg-open-consultation-desk"]'))
 await act(async()=>{const p=host.querySelector('[data-testid="ttrpg-open-consultation-desk"]');p.open=true;p.dispatchEvent(new Event('toggle'))});await until(()=>!!button('开始本次咨询与交流')&&!button('开始本次咨询与交流').disabled)
 const before=props.state.lastSequence;await act(async()=>button('开始本次咨询与交流').click());await until(()=>props.state.lastSequence>before)
 await until(()=>!!host.querySelector('select[aria-label="Oracle 咨询表"]'))
 expect(host.querySelector('[data-testid="ttrpg-open-consultation-desk"]').open).toBe(true)
 expect((await readProductRuntimeState(f.sessionId)).ttrpg.openRun.coordination.activeEpochKey).not.toBeNull();expect(await db.agentRuns.count()).toBe(0)
 await act(async()=>button('交接给另一位玩家').click());await until(()=>!!host.querySelector('select[aria-label="我的角色"]'));expect(host.querySelector('[data-testid="ttrpg-open-consultation-desk"]')).toBeNull()
 await act(async()=>{const s=host.querySelector('select[aria-label="我的角色"]');s.value=OPEN_HUMAN_VIEWER;s.dispatchEvent(new Event('change',{bubbles:true}))});await act(async()=>button('确认身份并进入').click());await until(()=>!!host.querySelector('[data-testid="ttrpg-open-consultation-desk"]'));expect(host.querySelector('[data-testid="ttrpg-open-consultation-desk"]').open).toBe(false)
},30000)
