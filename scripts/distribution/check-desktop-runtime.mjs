import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import policy from './desktop-runtime.cjs'

const version = policy.lockedRuntimeVersion(process.cwd())
const installed = JSON.parse(readFileSync(resolve('node_modules/electron/package.json'), 'utf8'))
policy.assertRuntimeVersion(installed.version, version)
console.log(JSON.stringify({ check: 'desktop-runtime-package-and-lock', electronVersion: version, minimumVersion: policy.minimumVersion, advisory: policy.advisory }))
