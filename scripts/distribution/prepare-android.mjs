import { cp } from 'node:fs/promises'
import { writeAndroidBuildSource } from './android-build-source.mjs'
// Keep /storyforge/ routes and asset paths identical, including history fallback.
await cp('dist-android/storyforge/index.html', 'dist-android/index.html')
await writeAndroidBuildSource()
