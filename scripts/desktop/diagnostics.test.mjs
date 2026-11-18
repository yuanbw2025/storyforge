import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopDiagnostics } from './diagnostics.mjs'
test('records abnormal native exits without labeling them as crashes or recording intentional termination', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sf-native-exit-'))
  try {
    const d = desktopDiagnostics(directory, 'v4.0.8+local'); d.start()
    d.setContext({ enabled: true, trail: [] })
    d.recordExit({ process: 'renderer', reason: 'abnormal-exit', exitCode: 134 })
    d.recordExit({ process: 'renderer', reason: 'crashed', exitCode: 139 })
    d.recordExit({ process: 'GPU', reason: 'oom', exitCode: 137 })
    for (const reason of ['clean-exit', 'killed', 'unknown']) d.recordExit({ process: 'renderer', reason, exitCode: 0 })
    assert.deepEqual(d.read().map(row => row.name), ['NativeInterrupted', 'NativeCrash', 'NativeOutOfMemory'])
    assert.deepEqual(d.read()[0].details?.native, { process: 'renderer', reason: 'interrupted', exitCode: 134 })
    d.cleanExit()
    const restarted = desktopDiagnostics(directory, 'v4.0.8+local'); restarted.start()
    assert.deepEqual(restarted.read()[0], d.read()[0])
    restarted.setContext({ enabled: false })
    restarted.recordExit({ process: 'renderer', reason: 'abnormal-exit', exitCode: 134 })
    assert.ok(restarted.read().every(row => !row.details))
  } finally { rmSync(directory, { recursive: true }) }
})
test('native summaries are bounded, omit raw errors, and distinguish unclean exits from confirmed crashes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sf-native-diagnostics-'))
  try {
    const d = desktopDiagnostics(directory, 'v4.0.1+local'); d.start(); d.record('SECRET key or manuscript')
    assert.equal(d.read().length, 0)
    desktopDiagnostics(directory, 'v4.0.1+local').start()
    assert.equal(d.read()[0].name, 'NativeInterrupted')
    d.cleanExit(); d.start(); assert.equal(d.read().length, 1)
    for (let i = 0; i < 8; i++) d.record('NativeCrash')
    assert.equal(d.read().length, 5)
    assert.equal(readFileSync(join(directory, 'native-diagnostics.json'), 'utf8').includes('SECRET'), false)
    d.cleanExit()
  } finally { rmSync(directory, { recursive: true }) }
})
test('only opt-in allowlisted prior actions bind to native crash, survive restart and clear on revocation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sf-native-context-'))
  try {
    const d = desktopDiagnostics(directory, 'v4.0.5+1234567'); d.start()
    d.setContext({enabled:true,trail:[{at:new Date().toISOString(),area:'longform',action:'save',text:'SECRET'}, {at:new Date().toISOString(),area:'SECRET',action:'save'}],key:'SECRET'})
    d.record('NativeCrash',{process:'renderer',reason:'crashed',exitCode:139,message:'SECRET'})
    const row = d.read().at(-1)
    assert.ok(row?.details); assert.equal(row.details.trail.length,1)
    assert.deepEqual(row.details.native,{process:'renderer',reason:'crashed',exitCode:139})
    const restarted = desktopDiagnostics(directory,'v4.0.5+1234567');restarted.start()
    const interruption = restarted.read().at(-1); assert.ok(interruption?.details)
    assert.equal(interruption.name,'NativeInterrupted')
    assert.equal(interruption.details.trail[0].action,'save')
    assert.equal(readFileSync(join(directory,'native-diagnostics.json'),'utf8').includes('SECRET'),false)
    restarted.setContext({enabled:false,trail:[]})
    assert.ok(restarted.read().every(row => !row.details))
    restarted.record('NativeCrash',{process:'renderer',reason:'crashed'})
    assert.equal(restarted.read().at(-1)?.details,undefined)
  } finally { rmSync(directory,{recursive:true}) }
})
