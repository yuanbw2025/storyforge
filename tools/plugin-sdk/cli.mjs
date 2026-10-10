#!/usr/bin/env node
import process from 'node:process'
import console from 'node:console'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import JSZip from 'jszip'
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import ts from 'typescript'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const [command, folderArg, outputArg] = process.argv.slice(2)
if (!['create', 'check', 'pack'].includes(command) || !folderArg) {
  console.log('Usage: node tools/plugin-sdk/cli.mjs create <folder> | check <folder> | pack <folder> [output.sfplugin]')
  process.exit(1)
}
let folder = path.resolve(folderArg)
if (command === 'create') {
  await fs.mkdir(folder, { recursive: false })
  await fs.cp(path.join(repo, 'examples/plugins/writing-notes'), folder, { recursive: true })
  const sdkPath = path.relative(folder, path.join(repo, 'tools/plugin-sdk'))
  await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({ name: path.basename(folder), private: true, type: 'module', devDependencies: { '@storyforge/plugin-sdk': `file:${sdkPath}`, '@types/react': '^19.0.0', typescript: '^5.6.0' } }, null, 2) + '\n')
  console.log(`Created plugin source: ${folder}; edit manifest id/name, then run check and pack`)

  process.exit(0)
}
folder = await fs.realpath(folder)
const raw = JSON.parse(await fs.readFile(path.join(folder, 'manifest.json'), 'utf8'))
// Bundle the host's exact validator, so author checks and installation cannot drift.
const checker = await build({ entryPoints: [path.join(repo, 'src/lib/extensions/package.ts')], bundle: true, platform: 'node', format: 'esm', write: false, packages: 'external' })
const checkerPath = path.join(repo, `tools/plugin-sdk/.validator-${process.pid}-${Date.now()}.generated.mjs`)
await fs.writeFile(checkerPath, checker.outputFiles[0].contents)
let manifest, validatePackage
try { const { parseManifest, readPackage } = await import(`${pathToFileURL(checkerPath)}?t=${Date.now()}`); manifest = parseManifest(raw); validatePackage = readPackage } finally { await fs.unlink(checkerPath) }
const zip = new JSZip()
const date = new Date('2026-01-01T00:00:00Z')
zip.file('manifest.json', JSON.stringify(manifest, null, 2), { date, createFolders: false })
if (manifest.entry) {
  const input = path.join(folder, 'src/index.tsx')
  const program = ts.createProgram([input], { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, allowSyntheticDefaultImports: true, paths: { '@storyforge/plugin-sdk': [path.join(repo, 'tools/plugin-sdk/index.d.ts')], react: [path.join(repo, 'node_modules/@types/react/index.d.ts')], 'react/jsx-runtime': [path.join(repo, 'node_modules/@types/react/jsx-runtime.d.ts')] } })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: file => file, getCurrentDirectory: () => folder, getNewLine: () => '\n' }))
  const result = await build({ entryPoints: [input], bundle: true, write: false, format: 'iife', globalName: '__sfPlugin', target: 'es2020', jsx: 'automatic', metafile: true, plugins: [{
    name: 'storyforge-shared-runtime', setup(builder) {
      builder.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'sf-runtime' }))
      builder.onLoad({ filter: /.*/, namespace: 'sf-runtime' }, args => {
        const name = args.path === 'react' ? '__sfReact' : '__sfJSX', exports = Object.keys(args.path === 'react' ? react : jsx).filter(key => key !== 'default' && /^[A-Za-z_$][\w$]*$/.test(key))
        return { contents: `export default ${name}; ${exports.map(key => `export const ${key}=${name}.${key};`).join('\n')}`, loader: 'js' }
      })
      builder.onResolve({ filter: /.*/ }, args => {
        if (args.kind === 'dynamic-import') throw new Error('Runtime imports are not supported; bundle dependencies and use SDK resources')
        if (args.path.includes('storyforge/src') || (args.path.startsWith('.') && !path.resolve(args.resolveDir, args.path).startsWith(folder + path.sep))) throw new Error('Plugin cannot import private host files or files outside its source folder')
      })
    },
  }] })
  const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports)
  if (imports.some(entry => entry.external)) throw new Error('External runtime dependency is not allowed')
  const sourceRoot = await fs.realpath(folder)
  for (const source of Object.keys(result.metafile.inputs)) {
    if (source.startsWith('sf-runtime:')) continue
    const actual = await fs.realpath(path.resolve(source))
    if (!actual.startsWith(sourceRoot + path.sep) && !actual.split(path.sep).includes('node_modules')) {
      throw new Error('Plugin cannot bundle private host files or source outside its own folder')
    }
  }
  const code = `export default function(__sfRuntime){\nconst __sfReact=__sfRuntime.react,__sfJSX=__sfRuntime.jsxRuntime;\n${result.outputFiles[0].text}\nreturn __sfPlugin.default;\n}\n`
  zip.file(manifest.entry, code, { date, createFolders: false })
}
try {
  const assets = path.join(folder, 'assets')
  async function addFiles(dir) { for (const entry of await fs.readdir(dir, { withFileTypes: true })) { const filename = path.join(dir, entry.name); if (entry.isSymbolicLink()) throw new Error('Symlinks are not permitted'); if (entry.isDirectory()) await addFiles(filename); else zip.file(`assets/${path.relative(assets, filename).split(path.sep).join('/')}`, await fs.readFile(filename), { date, createFolders: false }) } }
  await addFiles(assets)
} catch (error) { if (error.code !== 'ENOENT') throw error }
const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
// Validate the actual archive too: missing declared assets and package limits
// must fail here, rather than surprising an author only after installation.
await validatePackage(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
const digest = createHash('sha256').update(bytes).digest('hex')
if (command === 'pack') {
  const output = path.resolve(outputArg ?? `${manifest.id}-${manifest.version}.sfplugin`)
  await fs.writeFile(output, bytes)
  console.log(JSON.stringify({ id: manifest.id, version: manifest.version, bytes: bytes.length, digest, output }))
} else console.log(`${manifest.id}@${manifest.version}: manifest and standalone bundle passed (${bytes.length} bytes)`)
