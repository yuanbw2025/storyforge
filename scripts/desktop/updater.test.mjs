import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { installUpdater } from './updater.mjs'
/** @param {NodeJS.Platform} [platform] */
function fixture(platform = 'win32') {
  const handlers = new Map(), calls = []
  const autoUpdater = Object.assign(new EventEmitter(), {
    checkForUpdates: async () => { calls.push('check'); autoUpdater.emit('update-available', { version: '4.0.1' }) },
    downloadUpdate: async () => { calls.push('download'); autoUpdater.emit('update-downloaded') },
    quitAndInstall: () => calls.push('install'),
    openInstaller: async () => { calls.push('open-installer') },
    autoDownload: true, autoInstallOnAppQuit: true, allowDowngrade: true, allowPrerelease: true,
  })
  const mainFrame = { url: 'http://localhost:17831/storyforge/' }
  const window = { isDestroyed: () => false, webContents: { mainFrame, send() {} } }
  let response = 0
  installUpdater({
    app: { isPackaged: true, getVersion: () => '4.0.0', quit: () => calls.push('quit') }, window, origin: 'http://localhost:17831',
    ipcMain: { handle: (key, callback) => handlers.set(key, callback) },
    dialog: { showMessageBox: async () => ({ response }) }, approveExit: () => calls.push('approve-exit'), autoUpdater, platform,
  })
  const event = { sender: window.webContents, senderFrame: mainFrame }
  return { autoUpdater, calls, event, allow: () => { response = 1 }, invoke: (method, sender = event) => handlers.get('client-update:' + method)(sender) }
}
test('no automatic download, exit installation, downgrade or prerelease', () => {
  const { autoUpdater } = fixture()
  for (const key of /** @type {const} */ (['autoDownload', 'autoInstallOnAppQuit', 'allowDowngrade', 'allowPrerelease'])) assert.equal(autoUpdater[key], false)
})
test('OS confirmation gates download and install; unavailable installs have no effect', async () => {
  const f = fixture()
  await f.invoke('install'); assert.deepEqual(f.calls, [])
  assert.equal((await f.invoke('check')).status, 'available')
  await f.invoke('download'); assert.deepEqual(f.calls, ['check'])
  f.allow(); assert.equal((await f.invoke('download')).status, 'downloaded')
  await f.invoke('install'); assert.deepEqual(f.calls, ['check', 'download', 'approve-exit', 'install'])
})
test('foreign frames cannot invoke privileged updater', async () => {
  const f = fixture()
  assert.throws(() => f.invoke('state', { ...f.event, senderFrame: { url: 'http://localhost:17831/storyforge/' } }), /Untrusted/)
  await assert.rejects(() => f.invoke('check', { ...f.event, sender: {} }), /Untrusted/)
})
test('network errors leave the old installation usable and expose no provider secrets', async () => {
  const f = fixture()
  f.autoUpdater.emit('error', new Error('secret upstream details'))
  const state = await f.invoke('state')
  assert.equal(state.status, 'error'); assert.doesNotMatch(state.error, /secret/)
  assert.equal((await f.invoke('check')).status, 'available')
})

test('Arch confirms a verified package handoff without invoking the Windows installer', async () => {
  const f = fixture('linux')
  assert.equal((await f.invoke('state')).platform, 'linux')
  await f.invoke('check')
  f.allow()
  await f.invoke('download')
  await f.invoke('install')
  assert.deepEqual(f.calls, ['check', 'download', 'open-installer', 'approve-exit', 'quit'])
})
