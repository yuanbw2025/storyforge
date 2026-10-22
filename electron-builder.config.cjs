const { localTtsResourceFiles } = require('./scripts/distribution/local-tts-files.cjs')

module.exports = {
  appId: 'com.storyforge.client', productName: 'StoryForge',
  toolsets: { nsis: '1.2.1' },
  directories: { output: 'release/windows', buildResources: 'public' },
  extraMetadata: { main: 'scripts/desktop/main.mjs' },
  files: ['dist/**', 'scripts/desktop/**', 'scripts/distribution/server.mjs', 'scripts/distribution/proxies.mjs', 'scripts/distribution/diagnostics.mjs', 'scripts/local-codex/**', 'package.json', 'LICENSE'],
  extraResources: localTtsResourceFiles().map(file => ({ from: file, to: `local-tts/${file}` })),
  asar: true,
  win: { target: [{ target: 'nsis', arch: ['x64'] }], artifactName: 'StoryForge-${version}-windows-x64-setup.${ext}', icon: 'public/icon-512.png' },
  mac: { target: ['dmg'], category: 'public.app-category.productivity', identity: '-', notarize: false, artifactName: 'StoryForge-${version}-macos-${arch}.${ext}', icon: 'public/icon-512.png' },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false },
  publish: [{ provider: 'github', owner: 'yuanbw2025', repo: 'storyforge', releaseType: 'release' }],
}
