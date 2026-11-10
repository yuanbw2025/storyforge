import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopDiagnostics } from './diagnostics.mjs'
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
