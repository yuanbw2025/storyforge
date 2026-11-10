import { beforeEach, expect, it, vi } from 'vitest'
import { diagnosticCode, parseDiagnosticDetails } from '../../src/lib/diagnostics/diagnostic-context'
import { DIAGNOSTIC_CONTEXT_KEY, installOperationTrail, readOperationTrail, recordOperation, setDiagnosticContextEnabled } from '../../src/lib/diagnostics/operation-trail'
import { parseFailureEvent, failureFeedbackLink } from '../../src/lib/diagnostics/failure-summary'
import { installRuntimeDiagnostics, readRuntimeDiagnosticErrors, recordRuntimeDiagnosticError, resetRuntimeDiagnostics } from '../../src/lib/diagnostics/runtime-errors'
import { diagnosticWireError } from '../../src/lib/feedback/diagnostic-wire'

beforeEach(() => { localStorage.clear(); setDiagnosticContextEnabled(false); resetRuntimeDiagnostics(); vi.restoreAllMocks() })
it('does not record before opt-in, records only closed codes, bounds history and clears on opt-out', () => {
  installOperationTrail(); recordOperation('save'); expect(readOperationTrail()).toEqual([])
  setDiagnosticContextEnabled(true)
  history.replaceState({}, '', '/storyforge/workspace/PRIVATE-WORK?key=SECRET')
  for (let n=0;n<30;n++) recordOperation('save')
  expect(readOperationTrail()).toHaveLength(20)
  expect(readOperationTrail()[0]).toMatchObject({area:'longform',action:'save'})
  expect(JSON.stringify(readOperationTrail())).not.toMatch(/PRIVATE|SECRET|workspace/)
  expect(readOperationTrail(Date.now()+300001)).toEqual([])
  setDiagnosticContextEnabled(false); expect(readOperationTrail()).toEqual([])
  expect(localStorage.getItem('storyforge-operation-trail-v1')).toBeNull()
})
it('reconstructs all nested fields and rejects arbitrary values, stale and future steps', () => {
  const now = new Date().toISOString()
  const row = parseDiagnosticDetails({version:1, code:'property-access', secret:'PRIVATE', trail:[{at:now,area:'longform',action:'save',label:'PRIVATE'},{at:now,area:'SECRET',action:'save'}],native:{process:'renderer',reason:'crashed',exitCode:139,path:'PRIVATE'}},now)
  expect(row?.trail).toHaveLength(1); expect(JSON.stringify(row)).not.toContain('PRIVATE')
  expect(parseDiagnosticDetails({version:1,code:'unknown',trail:[{at:new Date(Date.parse(now)-300001).toISOString(),area:'home',action:'button'}]},now)?.trail).toEqual([])
  expect(parseDiagnosticDetails({version:1,code:'unknown',trail:[{at:new Date(Date.parse(now)+1000).toISOString(),area:'home',action:'button'}]},now)?.trail).toEqual([])
})
it('classifies browser software errors without retaining raw messages and strips details from public handoff', () => {
  installRuntimeDiagnostics(); setDiagnosticContextEnabled(true); recordOperation('generate')
  const error = new TypeError('Cannot read properties of null SECRET MANUSCRIPT')
  error.stack = 'TypeError: SECRET\n at x (https://private.test/storyforge/assets/code-Abc.js:2:34?token=secret)'
  expect(diagnosticCode(error)).toBe('property-access')
  recordRuntimeDiagnosticError(error,'react')
  const row = readRuntimeDiagnosticErrors().slice(-1)[0]!
  expect(row.details?.code).toBe('property-access'); expect(row.details?.trail).toHaveLength(1)
  expect(JSON.stringify(row)).not.toMatch(/SECRET|MANUSCRIPT|private.test|token/)
  expect(diagnosticWireError(row,false).details).toBeUndefined()
  const link = failureFeedbackLink({format:'storyforge-failure-summary',version:1,application:row.build,platform:'Windows',browser:'Chrome 140',errors:[row],launcher:null})
  expect(decodeURIComponent(link)).not.toContain('details')
  setDiagnosticContextEnabled(false)
  expect(readRuntimeDiagnosticErrors()[0].details).toBeUndefined()
  expect(localStorage.getItem('storyforge-runtime-diagnostics-v1')).not.toContain('details')
})
it('captures resource errors and ErrorEvent code positions when the browser exposes no Error object', () => {
  installRuntimeDiagnostics(); setDiagnosticContextEnabled(true)
  window.dispatchEvent(new ErrorEvent('error',{filename:'https://private.test/storyforge/assets/code.js',lineno:4,colno:2,message:'PRIVATE'}))
  expect(readRuntimeDiagnosticErrors().slice(-1)[0]?.frames).toEqual(['/storyforge/assets/code.js:4:2'])
  const script = document.createElement('script');document.body.append(script);script.dispatchEvent(new Event('error',{bubbles:false}))
  expect(readRuntimeDiagnosticErrors().slice(-1)[0]?.details?.code).toBe('resource-load')
  script.remove()
})
it('storage denial fails closed, persisted objects cannot attach raw fields or invalid codes', () => {
  const set = vi.spyOn(localStorage,'setItem').mockImplementation(() => {throw new Error('denied')})
  expect(setDiagnosticContextEnabled(true)).toBe(false);recordOperation('save');expect(readOperationTrail()).toEqual([]);set.mockRestore()
  expect(parseFailureEvent({occurredAt:new Date().toISOString(),source:'react',name:'TypeError',frames:[],build:'unknown',details:{version:1,code:'SECRET',trail:[]}})?.details).toBeUndefined()
  expect(localStorage.getItem(DIAGNOSTIC_CONTEXT_KEY)).not.toBe('true')
})
