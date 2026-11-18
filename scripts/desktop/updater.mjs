export function installUpdater({ app, window, ipcMain, dialog, origin, approveExit, autoUpdater, platform = process.platform }) {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false
  let state = { platform: { darwin: 'macos', linux: 'linux', win32: 'windows' }[platform], currentVersion: app.getVersion(), status: 'idle' }
  const set = patch => {
    state = { ...state, error: undefined, ...patch }
    if (!window.isDestroyed()) window.webContents.send('client-update:changed', state)
  }
  autoUpdater.on('checking-for-update', () => set({ status: 'checking' }))
  autoUpdater.on('update-available', info => set({ status: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => set({ status: 'current', version: undefined }))
  autoUpdater.on('download-progress', progress => set({ status: 'downloading', progress: Math.floor(progress.percent) }))
  autoUpdater.on('update-downloaded', () => set({ status: 'downloaded', progress: 100 }))
  autoUpdater.on('error', () => set({ status: 'error', error: '无法读取或下载 GitHub 更新，请检查网络后重试。当前版本仍可使用。' }))
  function trusted(event) {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || !event.senderFrame.url.startsWith(origin + '/storyforge/')) throw new Error('Untrusted update request')
  }
  ipcMain.handle('client-update:state', event => { trusted(event); return state })
  ipcMain.handle('client-update:check', async event => {
    trusted(event)
    if (!app.isPackaged || !['win32', 'darwin', 'linux'].includes(platform)) return { ...state, status: 'error', error: '更新检查只在已安装的桌面发行版中启用。' }
    if (['checking', 'downloading', 'downloaded'].includes(state.status)) return state
    try { await autoUpdater.checkForUpdates() } catch { /* The error event reports a sanitized message. */ }
    return state
  })
  ipcMain.handle('client-update:download', async event => {
    trusted(event)
    if (state.status !== 'available') return state
    const { response } = await dialog.showMessageBox(window, {
      type: 'question', buttons: ['取消', '下载更新'], defaultId: 0, cancelId: 0,
      message: `下载 StoryForge ${state.version}？`, detail: '从项目 GitHub Release 下载。下载期间可以继续使用，安装需要另行确认。',
    })
    if (response !== 1 || state.status !== 'available') return state
    set({ status: 'downloading', progress: 0 })
    try { await autoUpdater.downloadUpdate() } catch { /* Reported by the error event. */ }
    return state
  })
  ipcMain.handle('client-update:install', async event => {
    trusted(event)
    if (state.status !== 'downloaded') return state
    const { response } = await dialog.showMessageBox(window, {
      type: 'warning', buttons: ['稍后安装', platform === 'linux' ? '退出并打开安装包文件夹' : '退出并安装'], defaultId: 0, cancelId: 0,
      message: '保存完成后安装更新？', detail: platform === 'darwin'
        ? '请先结束生成任务并导出重要作品的完整备份。客户端将退出并打开安装镜像，请将 StoryForge 拖入“应用程序”替换旧版本；保留原有数据。'
        : platform === 'linux'
          ? `请先保存作品并结束生成任务。客户端将退出并打开安装包文件夹，请在该目录的终端运行 sudo pacman -U StoryForge-${state.version}-arch-x64.pkg.tar.zst，按系统提示确认安装。`
          : '请先结束生成任务并导出重要作品的完整备份。安装会退出客户端；不会清除客户端数据。',
    })
    if (response === 1 && state.status === 'downloaded') {
      if (platform === 'darwin' || platform === 'linux') {
        try { await autoUpdater.openInstaller(); approveExit(); app.quit() }
        catch { set({ status: 'error', error: '无法打开已校验的安装包，请重新检查并下载更新。当前版本仍可使用。' }) }
      } else { approveExit(); autoUpdater.quitAndInstall(false, true) }
    }
    return state
  })
}
