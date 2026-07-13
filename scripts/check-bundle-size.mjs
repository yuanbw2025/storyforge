import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const KIB = 1024
const MIB = 1024 * KIB

export const BUNDLE_BUDGETS = {
  entryScript: { raw: 700 * KIB, gzip: 230 * KIB },
  scriptChunk: { raw: 600 * KIB, gzip: 180 * KIB },
  stylesheet: { raw: 100 * KIB, gzip: 25 * KIB },
  pdfWorker: { raw: 2.4 * MIB, gzip: 550 * KIB },
}

function formatKiB(bytes) {
  return `${(bytes / KIB).toFixed(1)} KiB`
}

function readAsset(assetPath) {
  const content = fs.readFileSync(assetPath)
  return {
    raw: content.byteLength,
    gzip: gzipSync(content).byteLength,
  }
}

function findEntryScript(distDir) {
  const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8')
  const source = html.match(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i)?.[1]
  if (!source) throw new Error('dist/index.html 中未找到 module 入口脚本')
  return path.basename(source)
}

function classifyAsset(filename, entryScript) {
  if (filename === entryScript) return 'entryScript'
  if (/^pdf\.worker-.*\.mjs$/.test(filename)) return 'pdfWorker'
  if (/\.(?:js|mjs)$/.test(filename)) return 'scriptChunk'
  if (filename.endsWith('.css')) return 'stylesheet'
  return null
}

export function checkBundleBudget(distDir, budgets = BUNDLE_BUDGETS) {
  const assetsDir = path.join(distDir, 'assets')
  if (!fs.existsSync(assetsDir)) {
    throw new Error(`构建产物不存在: ${assetsDir}，请先运行 npm run build`)
  }

  const entryScript = findEntryScript(distDir)
  const measured = []
  const violations = []

  for (const filename of fs.readdirSync(assetsDir).sort()) {
    const category = classifyAsset(filename, entryScript)
    if (!category) continue

    const size = readAsset(path.join(assetsDir, filename))
    const budget = budgets[category]
    const record = { filename, category, ...size, budget }
    measured.push(record)

    if (size.raw > budget.raw || size.gzip > budget.gzip) {
      violations.push(record)
    }
  }

  if (!measured.some(asset => asset.category === 'entryScript')) {
    throw new Error(`入口脚本未出现在 dist/assets: ${entryScript}`)
  }

  return { entryScript, measured, violations }
}

function runCli() {
  const distDir = path.resolve(process.argv[2] ?? 'dist')
  const result = checkBundleBudget(distDir)

  if (result.violations.length > 0) {
    console.error('[bundle-size] 以下构建产物超过预算:')
    for (const item of result.violations) {
      console.error(
        `  - ${item.filename}: raw ${formatKiB(item.raw)} / ${formatKiB(item.budget.raw)}, `
        + `gzip ${formatKiB(item.gzip)} / ${formatKiB(item.budget.gzip)}`,
      )
    }
    process.exitCode = 1
    return
  }

  const entry = result.measured.find(asset => asset.category === 'entryScript')
  const largestChunk = result.measured
    .filter(asset => asset.category === 'scriptChunk')
    .sort((a, b) => b.raw - a.raw)[0]
  const pdfWorker = result.measured.find(asset => asset.category === 'pdfWorker')

  console.log(
    `[bundle-size] ok: entry ${formatKiB(entry.raw)} (${formatKiB(entry.gzip)} gzip)`,
  )
  if (largestChunk) {
    console.log(
      `[bundle-size] largest async/vendor chunk: ${largestChunk.filename} ${formatKiB(largestChunk.raw)} `
      + `(${formatKiB(largestChunk.gzip)} gzip)`,
    )
  }
  if (pdfWorker) {
    console.log(
      `[bundle-size] pdf worker: ${formatKiB(pdfWorker.raw)} (${formatKiB(pdfWorker.gzip)} gzip)`,
    )
  }
}

const isCli = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCli) runCli()
