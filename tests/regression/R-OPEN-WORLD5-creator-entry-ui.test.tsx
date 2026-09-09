import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const productHub = readFileSync(
  resolve(process.cwd(), 'src/pages/ProductHubPage.tsx'),
  'utf8',
)

function section(start: string, end: string): string {
  const startIndex = productHub.indexOf(start)
  const endIndex = productHub.indexOf(end, startIndex)
  expect(startIndex, `missing source section: ${start}`).toBeGreaterThanOrEqual(0)
  expect(endIndex, `missing source boundary: ${end}`).toBeGreaterThan(startIndex)
  return productHub.slice(startIndex, endIndex)
}

describe('OPEN-WORLD-5 · creator product entry wiring', () => {
  it('keeps world and novel owners separate and lets novel-only production reach the creator studio', () => {
    const textGamePage = section('function TextGamePage(', 'function CreatePanel(')

    expect(textGamePage).toContain('const worldScope = project ? scopeForProject(project) : undefined')
    expect(textGamePage).toContain('const novelScope = novelProject ? scopeForProject(novelProject) : undefined')
    expect(textGamePage).toContain("const isOpenWorldProduction = isOpenWorld && mode === 'production'")
    expect(textGamePage).toContain('if (!isOpenWorldProduction && (!project || !world))')
    expect(textGamePage).toContain('<TextOpenWorldCreatorWorkflow')
    expect(textGamePage).toContain('worldScope={worldScope ?? null}')
    expect(textGamePage).toContain('novelScope={novelScope ?? null}')
    expect(textGamePage).toContain('initialSourceKind={initialOpenWorldSource}')
    expect(textGamePage).toContain('小说或世界来源工作区归属尚未就绪')
  })

  it('routes the novel CTA to a novel-prefilled source step without creating product lifecycle rows', () => {
    const novelPage = section('function NovelPage(', 'function NodesPage(')
    const renderSwitch = section('const renderPage = () =>', '\n  return <div className="sf-product-shell"')

    expect(novelPage).toContain('制作文字开放世界')
    expect(novelPage).toContain('onOpenTextOpenWorldProduction(project)')
    expect(renderSwitch).toContain("setTextGameProduct('text-open-world')")
    expect(renderSwitch).toContain("setTextGameInitialMode('production')")
    expect(renderSwitch).toContain('setTextProductProductionHandoff(null)')
    expect(renderSwitch).toContain("setTextOpenWorldEntrySource('novel')")
    expect(renderSwitch).toContain('novelProject={activeWorkProject}')
    expect(renderSwitch).not.toMatch(/create(?:Product)?(?:Production|Build|Release|Session)/)
  })

  it('revalidates world handoff in the dedicated studio and cannot switch there through the legacy studio', () => {
    const textGamePage = section('function TextGamePage(', 'function CreatePanel(')
    const renderSwitch = section('const renderPage = () =>', '\n  return <div className="sf-product-shell"')

    expect(renderSwitch).toContain('const parsed = parseProductProductionHandoffV1(handoff)')
    expect(renderSwitch).toContain("if (parsed.productType === 'text-open-world') setTextOpenWorldEntrySource('world-release')")
    expect(textGamePage).toContain("initialProductionHandoff?.productType === 'text-open-world'")
    expect(textGamePage).toContain("availableProducts.filter(kind => kind !== 'text-open-world')")
    expect(textGamePage).toContain('allowedProducts={genericProductionProducts}')
    expect(textGamePage).not.toContain('allowedProducts={availableProducts}')
  })
})
