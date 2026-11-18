import { basename, isAbsolute } from 'node:path'

/** Install only the author-facing directory permissions needed by the desktop
 * workspace picker. Chromium still selects the directory and owns its grants;
 * this does not create a filesystem IPC bridge or override permission checks.
 * @param {{session:import('electron').Session,window:import('electron').BrowserWindow,dialog:Pick<import('electron').Dialog,'showMessageBox'>,origin:string}} options
 */
export function installFileSystemPermissions({ session, window, dialog, origin }) {
  const contents = window.webContents
  let navigation = 0
  contents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) navigation++ })
  /** @param {{requestingUrl?:unknown}} details */
  const trusted = details => {
    try {
      const frame = contents.mainFrame
      if (typeof details?.requestingUrl !== 'string') return false
      const url = new URL(details.requestingUrl)
      // fileSystem.isMainFrame is not reliable across Chromium versions. Do not
      // grant requests while a child frame could be the requesting document.
      return !window.isDestroyed() && !contents.isDestroyed() && frame.frames.length === 0
        && details.requestingUrl === frame.url && url.origin === origin
        && url.pathname.startsWith('/storyforge/') && !url.username && !url.password
    } catch { return false }
  }
  session.setPermissionRequestHandler((requester, permission, callback, details) => {
    if (permission === 'persistent-storage') { callback(true); return }
    if (permission !== 'fileSystem' || requester !== contents || !trusted(details)
        || !('isDirectory' in details) || details.isDirectory !== true
        || !('fileAccessType' in details) || typeof details.fileAccessType !== 'string' || !['readable', 'writable'].includes(details.fileAccessType)
        || !('filePath' in details) || typeof details.filePath !== 'string' || !isAbsolute(details.filePath)) {
      callback(false); return
    }
    const documentUrl = contents.mainFrame.url
    const documentFrame = contents.mainFrame
    const startedAtNavigation = navigation
    void dialog.showMessageBox(window, {
      type: 'question', title: '项目文件夹权限',
      message: `允许 StoryForge ${details.fileAccessType === 'writable' ? '读写' : '读取'}所选文件夹“${basename(details.filePath)}”？`,
      detail: '仅授权当前选定的文件夹。关联位置不会自动移动或写入作品；首次写入仍需在数据管理中核对确认。',
      buttons: ['取消', '允许'], defaultId: 0, cancelId: 0, noLink: true,
    }).then(({ response }) => callback(response === 1 && navigation === startedAtNavigation && trusted(details)
      && contents.mainFrame === documentFrame && contents.mainFrame.url === documentUrl),
      () => callback(false))
  })
  session.on('file-system-access-restricted', (_event, details, callback) => {
    // Never override Chromium's sensitive-directory blocklist. Missing a reply
    // here leaves its directory-picker promise pending indefinitely.
    if (!trusted({ requestingUrl: details.frame?.url }) || details.webContents !== contents
        || details.frame !== contents.mainFrame
        || (details.origin !== origin + '/' && details.origin !== origin)) { callback('deny'); return }
    const documentUrl = contents.mainFrame.url
    const documentFrame = contents.mainFrame
    const startedAtNavigation = navigation
    void dialog.showMessageBox(window, {
      type: 'warning', title: '请选择普通项目文件夹',
      message: '这个位置受系统保护，不能作为项目文件夹。',
      detail: '请选择专门的普通子文件夹。原绑定和文件不会改变。',
      buttons: ['重新选择', '取消'], defaultId: 1, cancelId: 1, noLink: true,
    }).then(({ response }) => callback(response === 0 && navigation === startedAtNavigation && trusted({ requestingUrl: documentUrl })
      && contents.mainFrame === documentFrame ? 'tryAgain' : 'deny'),
      () => callback('deny'))
  })
}
