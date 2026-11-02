import { spawnSync } from 'node:child_process'
import { readFile, mkdir, copyFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { assertCleanAndroidBuildSource } from './android-build-source.mjs'
const release = process.argv.includes('--release')
if (release) await assertCleanAndroidBuildSource()
const result = spawnSync(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', [release ? ':app:assembleRelease' : ':app:assembleDebug', ':app:testDebugUnitTest', '--no-daemon'], { cwd: 'android', stdio: 'inherit', shell: process.platform === 'win32' })
if (result.status !== 0) process.exit(result.status ?? 1)
const { version } = JSON.parse(await readFile('package.json', 'utf8'))
await mkdir('release/android', { recursive: true })
await copyFile(`android/app/build/outputs/apk/${release ? 'release/app-release' : 'debug/app-debug'}.apk`, `release/android/StoryForge-${version}-android${release ? '' : '-debug'}.apk`, constants.COPYFILE_FICLONE)
