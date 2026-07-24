import packageMetadata from '../../package.json'

/** 应用展示版本直接读取 package.json，避免 Release、构建产物和界面版本分叉。 */
export const APP_VERSION = `v${packageMetadata.version}`

/** 每次 main 构建都可区分；语义版本仍由 package.json / Release tag 管理。 */
export const APP_BUILD_ID = `${APP_VERSION}+${
  typeof __STORYFORGE_BUILD_SHA__ === 'string' && __STORYFORGE_BUILD_SHA__
    ? __STORYFORGE_BUILD_SHA__
    : 'local'
}`
