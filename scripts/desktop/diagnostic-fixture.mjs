import { build } from 'esbuild'

/** Test-only compatibility input. Compile the actual preference API, not a
 * second implementation of cleanup. Only isolated smoke/browser profiles use it. */
export async function buildDiagnosticOptOutFixture() {
  const result = await build({
    absWorkingDir: process.cwd(),
    stdin: {
      contents: "import { setDiagnosticContextEnabled } from './src/lib/diagnostics/operation-trail'; export const disable = () => setDiagnosticContextEnabled(false);",
      resolveDir: process.cwd(), loader: 'ts',
    },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
    globalName: '__storyforgeDiagnosticFixture',
  })
  return result.outputFiles[0].text
}
