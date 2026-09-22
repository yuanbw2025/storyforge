import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const developmentPage = readFileSync(
  resolve(process.cwd(), 'src/pages/TextGameDevelopmentPage.tsx'),
  'utf8',
)
const settingsRoute = readFileSync(resolve(process.cwd(), 'src/pages/SettingsRoutePage.tsx'), 'utf8')
const settingsPage = readFileSync(resolve(process.cwd(), 'src/components/settings/SettingsPage.tsx'), 'utf8')

describe('OPEN-WORLD-5 · creator product entry wiring', () => {
  it('keeps world and novel owners separate and lets novel-only production reach the creator studio', () => {
    expect(developmentPage).toContain("project?.workspacePurpose === 'independent-work' ? 'novel' : 'world-release'")
    expect(developmentPage).toContain('<TextOpenWorldCreatorWorkflow')
    expect(developmentPage).toContain('worldScope={worldScope ?? null}')
    expect(developmentPage).toContain('novelScope={novelScope ?? null}')
    expect(developmentPage).toContain('initialSourceKind={initialCreatorSource}')
    expect(developmentPage).toContain('小说或世界来源工作区归属尚未就绪')
  })

  it('uses the dedicated creator workflow instead of the generic producer for open-world production', () => {
    expect(developmentPage).toContain("? openWorld\n            ? <TextOpenWorldCreatorWorkflow")
    expect(developmentPage).toContain(': productionDecision.enabled')
    expect(developmentPage).toContain('<ProductProductionStudio')
    expect(developmentPage).toContain('initialSource={handoff}')
  })

  it('preserves the exact creator identity through the current settings route and back', () => {
    expect(developmentPage).toContain('parseTextOpenWorldSettingsReturnV1(location.state)')
    expect(developmentPage).toContain('initialResumeTarget={settingsReturn}')
    expect(developmentPage).toContain("navigate('/settings', { state: { storyforgeProductHubReturn: creatorReturn } })")
    expect(settingsRoute).toContain('state={creatorReturn ? { storyforgeProductHubReturn: creatorReturn } : null}')
    expect(settingsPage).toContain('aria-label="返回开放世界制作"')
    expect(settingsPage).toContain("navigate(`/openworld/runtime?${params}`")
  })
})
