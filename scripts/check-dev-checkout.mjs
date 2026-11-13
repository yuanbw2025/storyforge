import { statSync } from 'node:fs'
import { resolve } from 'node:path'

// npm runs lifecycle hooks from the package root. ZIP checkouts need no .git.
const required = ['vite.config.ts', 'vite.adventure-player.config.ts', 'tsconfig.json', 'tsconfig.tests.json', 'tsconfig.tooling.json', 'index.html', 'src/entry.ts', 'src/main.tsx']
const missing = required.filter(file => {
  try { return !statSync(resolve(file)).isFile() } catch { return true }
})
if (missing.length) {
  console.error('StoryForge: 源码工作区不完整 / Incomplete source checkout: ' + missing.join(', '))
  console.error('Vite 未启动 / Vite was not started. Check clone/extraction errors before continuing.')
  console.error('Windows: use a short, NEW folder and Git for Windows:')
  console.error('git clone -c core.longpaths=true https://github.com/yuanbw2025/storyforge.git storyforge-new')
  console.error('保留旧目录、本地修改和作品；不要覆盖或清除数据。Keep the old folder, local edits and work data.')
  process.exitCode = 1
}
