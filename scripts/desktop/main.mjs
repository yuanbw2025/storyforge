import { app, BrowserWindow, dialog, ipcMain, shell, session } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPortableServer } from '../distribution/server.mjs'
import { installUpdater } from './updater.mjs'
import updater from 'electron-updater'
import { desktopDiagnostics } from './diagnostics.mjs'
import { createMacUpdater } from './mac-updater.mjs'

const root = dirname(fileURLToPath(import.meta.url))
// This identity, profile and origin are part of the data contract. Never randomize them.
const origin = 'http://localhost:17831'
app.setName('StoryForge')
app.setPath('userData', process.env.STORYFORGE_TEST_USER_DATA || join(app.getPath('appData'), 'StoryForge'))
app.setAppUserModelId('com.storyforge.client')
/** @type {import('electron').BrowserWindow | undefined} */
let window
let server
let exitApproved = false
if (!app.requestSingleInstanceLock()) app.quit()
else {
  const diagnostics = desktopDiagnostics(app.getPath('userData'), `v${app.getVersion()}+local`)
  diagnostics.start()
  process.on('uncaughtExceptionMonitor', () => diagnostics.record('NativeCrash', { process: 'browser', reason: 'uncaught' }))
  app.on('render-process-gone', (_event, _contents, details) => {
    if (details.reason === 'crashed') diagnostics.record('NativeCrash', { process: 'renderer', reason: 'crashed', exitCode: details.exitCode })
    if (details.reason === 'oom') diagnostics.record('NativeOutOfMemory', { process: 'renderer', reason: 'oom', exitCode: details.exitCode })
  })
  app.on('child-process-gone', (_event, details) => {
    if (details.reason === 'crashed') diagnostics.record('NativeCrash', { process: details.type, reason: 'crashed', exitCode: details.exitCode })
    if (details.reason === 'oom') diagnostics.record('NativeOutOfMemory', { process: details.type, reason: 'oom', exitCode: details.exitCode })
  })
  app.on('second-instance', () => { window?.restore(); window?.focus() })
  app.whenReady().then(async () => {
    server = createPortableServer({ webRoot: join(root, '../../dist'),
      ...(app.isPackaged ? { localTtsRoot: join(process.resourcesPath, 'local-tts') } : {}) })
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(17831, '127.0.0.1', resolve) })
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'persistent-storage'))
    const mainWindow = new BrowserWindow({
      width: 1440, height: 960, minWidth: 800, minHeight: 600, show: false,
      autoHideMenuBar: true, title: 'StoryForge',
      webPreferences: { preload: join(root, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    })
    window = mainWindow
    ipcMain.handle('client-diagnostics:read', event => {
      if (!event.senderFrame || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || new URL(event.senderFrame.url).origin !== origin) throw new Error('Invalid diagnostics caller')
      return diagnostics.read()
    })
    ipcMain.handle('client-diagnostics:context', (event, value) => {
      if (!event.senderFrame || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || new URL(event.senderFrame.url).origin !== origin) throw new Error('Invalid diagnostics caller')
      diagnostics.setContext(value)
    })
    ipcMain.handle('client-diagnostics:allowed', event => {
      if (!event.senderFrame || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || new URL(event.senderFrame.url).origin !== origin) throw new Error('Invalid diagnostics caller')
      return app.isPackaged && !process.env.STORYFORGE_TEST_USER_DATA
    })
    function openExternal(url) {
      try {
        const target = new URL(url)
        if (['https:', 'http:'].includes(target.protocol) && !target.username && !target.password) void shell.openExternal(target.href)
      } catch { /* Invalid links have no OS effect. */ }
    }
    mainWindow.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' } })
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(origin + '/storyforge/')) { event.preventDefault(); openExternal(url) }
    })
    mainWindow.webContents.on('will-attach-webview', event => event.preventDefault())
    mainWindow.on('close', event => {
      if (exitApproved) return
      event.preventDefault()
      void dialog.showMessageBox(mainWindow, {
        type: 'question', buttons: ['继续使用', '退出'], defaultId: 0, cancelId: 0,
        message: '退出 StoryForge？', detail: '请先确认编辑已保存、生成任务已结束。退出会中断仍在运行的任务。',
      }).then(({ response }) => { if (response === 1) { exitApproved = true; app.quit() } })
    })
    const autoUpdater = process.platform === 'darwin' ? createMacUpdater({ app, shell }) : updater.autoUpdater
    installUpdater({ app, window: mainWindow, ipcMain, dialog, origin, autoUpdater, approveExit: () => { exitApproved = true } })
    mainWindow.on('unresponsive', () => diagnostics.record('NativeUnresponsive', { process: 'renderer', reason: 'unresponsive' }))
    mainWindow.once('ready-to-show', () => mainWindow.show())
    await mainWindow.loadURL(origin + '/storyforge/')
  }).catch(() => {
    dialog.showErrorBox('StoryForge 无法启动', '无法启动客户端本地服务。请检查端口 17831 是否被占用；为保留作品数据，客户端不会更换地址。')
    exitApproved = true
    app.quit()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => { diagnostics.cleanExit(); server?.close(); server?.closeAllConnections() })
}
