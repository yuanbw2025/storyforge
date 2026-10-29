import { withTestDirectory } from './test-temp-directory.mjs'

const args = process.argv.slice(2)
if (args[0] === '--') args.shift()
if (!args.length) {
  console.error('Usage: node scripts/run-test-workspace.mjs -- <executable> [args...]')
  process.exitCode = 1
} else {
  try {
    process.exitCode = await withTestDirectory('validation', temporary => temporary.run(args[0], args.slice(1), {
      cwd: process.cwd(),
      env: { ...process.env, STORYFORGE_TEST_WORKSPACE: temporary.path },
    }))
  } catch (error) {
    console.error('[validation] ' + error.message)
    process.exitCode = error.exitCode ?? 1
  }
}
