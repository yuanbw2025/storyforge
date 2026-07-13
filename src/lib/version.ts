import packageMetadata from '../../package.json'

/** 应用展示版本直接读取 package.json，避免 Release、构建产物和界面版本分叉。 */
export const APP_VERSION = `v${packageMetadata.version}`
