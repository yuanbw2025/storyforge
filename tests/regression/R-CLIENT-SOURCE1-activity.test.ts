import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {installClientTelemetry,stopClientTelemetry,TELEMETRY_KEY,recordClientActivity,flushClientTelemetry,setTelemetryPreferences} from '../../src/lib/feedback/client-telemetry'

beforeEach(()=>{vi.useFakeTimers();vi.stubEnv('MODE','development');vi.stubEnv('DEV',true);localStorage.clear();vi.spyOn(navigator,'webdriver','get').mockReturnValue(false);vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');vi.spyOn(navigator,'onLine','get').mockReturnValue(false)})
afterEach(()=>{stopClientTelemetry();vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers()})
it('starts source activity automatically without a native bridge, account or UI, persists one identity and one active event per day',async()=>{
  installClientTelemetry(false);const state=JSON.parse(localStorage.getItem(TELEMETRY_KEY)!);
  expect(state).toMatchObject({analytics:true,errors:false,queue:[{kind:'active',client:{distribution:'web'}}]});expect(state.id).toMatch(/^[a-f0-9-]{36}$/)
  installClientTelemetry(false);recordClientActivity();expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).queue).toHaveLength(1)
  stopClientTelemetry();installClientTelemetry(false);expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).id).toBe(state.id)
  vi.advanceTimersByTime(86400000);expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).queue).toHaveLength(2)
  const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{const b=JSON.parse(String(init?.body));return new Response(JSON.stringify({accepted:b.events.map((r:{id:string})=>r.id),discarded:[]}))});vi.spyOn(navigator,'onLine','get').mockReturnValue(true);await flushClientTelemetry()
  const sent=JSON.parse(String(fetcher.mock.calls[0][1]?.body));expect(Object.keys(sent).sort()).toEqual(['events','installationId','version']);expect(Object.keys(sent.events[0]).sort()).toEqual(['client','id','kind','occurredAt']);expect(Object.keys(sent.events[0].client).sort()).toEqual(['build','distribution','platform'])
})
it('does not overwrite a saved disabled choice or mutate works and configuration',()=>{
  localStorage.setItem('author-work','private manuscript');setTelemetryPreferences(false,false);installClientTelemetry(false);expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!)).toMatchObject({analytics:false,queue:[]});expect(localStorage.getItem('author-work')).toBe('private manuscript')
})
it.each(['test','showcase','adventure-player'])('does not collect from the %s profile',mode=>{vi.stubEnv('MODE',mode);installClientTelemetry(false);expect(localStorage.getItem(TELEMETRY_KEY)).toBeNull()})
it('does not collect from automated browsers, native development or unapproved packaged clients',()=>{
  vi.stubGlobal('navigator',{webdriver:true});installClientTelemetry(false);expect(localStorage.getItem(TELEMETRY_KEY)).toBeNull();vi.unstubAllGlobals();vi.stubEnv('MODE','portable');installClientTelemetry(false);expect(localStorage.getItem(TELEMETRY_KEY)).toBeNull()
})
it('keeps source activity in the offline queue, respects backoff and never counts hidden days',async()=>{
  vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');installClientTelemetry(false);expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).queue).toHaveLength(0)
  vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');recordClientActivity();vi.spyOn(navigator,'onLine','get').mockReturnValue(true);const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValue(new TypeError('offline'));await flushClientTelemetry();const state=JSON.parse(localStorage.getItem(TELEMETRY_KEY)!);expect(state.queue[0].attempts).toBe(1);await flushClientTelemetry();expect(fetcher).toHaveBeenCalledTimes(1)
})
it('does not upload if the installation identity cannot be persisted',()=>{
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota')});const fetcher=vi.spyOn(globalThis,'fetch');expect(()=>installClientTelemetry(false)).not.toThrow();expect(fetcher).not.toHaveBeenCalled()
})
