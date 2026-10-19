/** Actual browser decoders and production commands. All images/PCM are original
 * engineering samples, and do not represent commercial art, speech or listening QA. */
import { createAvgDraftV1, selectAvgWorldV1 } from '../../src/lib/avg/draft-service';
import { importAvgMediaForAssemblyV1, saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service';
import { createMistHarborWorld } from '../../src/lib/world-engine/mist-harbor-preset';
import { createAvgAuthoringPresetV1 } from '../../src/lib/avg/authoring-presets';
import { prepareAvgAssemblyBriefV1, runAvgAssemblyV1 } from '../../src/lib/avg/assembly-service';
import { startNativeAvgAssembly, confirmNativeAvgInputs } from './avg-production-assembly-fixture';
import { avgReadingAudioFixture } from './avg-reading-fixture';
import { startProductProductionPreviewV1 } from '../../src/lib/product-production/service';
export async function prepareAvgMediaReleasePreview(customize?: (workspace:ReturnType<typeof createAvgAuthoringPresetV1>, context:{scope:Parameters<typeof importAvgMediaForAssemblyV1>[0]['scope']})=>void|Promise<void>) {
    const owner = await createAvgDraftV1('原生 AVG 本地原型版本验收'), world = await createMistHarborWorld();
    const draft = await selectAvgWorldV1(owner.scope, 0, world.worldReleaseId);
    const workspace = createAvgAuthoringPresetV1('linear');
    const base = { scope: owner.scope, license: 'CC0-1.0 原创工程校准媒资', altText: '系统与舞台工程样本', characterTag: '' };
    const image = async (name: string, color: string) => {
        const canvas = document.createElement('canvas');
        canvas.width = 960;
        canvas.height = 540;
        const ctx = canvas.getContext('2d')!;
        const gradient = ctx.createLinearGradient(0, 0, 960, 540);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, '#bd9870');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 960, 540);
        ctx.fillStyle = '#263345';
        ctx.fillRect(180, 150, 600, 300);
        ctx.fillStyle = '#d4c3a0';
        ctx.fillRect(220, 190, 520, 220);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'));
        return importAvgMediaForAssemblyV1({ ...base, name, kind: 'background', data: await blob.arrayBuffer(), mimeType: 'image/png' });
    };
    const dark = await image('夜色校准图', '#122347'), light = await image('日光校准图', '#b4c6d8'), audio = await avgReadingAudioFixture(700);
    const music = await importAvgMediaForAssemblyV1({ ...base, name: '原创背景校准音（非人声）', kind: 'bgm', data: audio.data, mimeType: 'audio/wav' });
    const voice = await importAvgMediaForAssemblyV1({ ...base, name: '原创台词校准音（非人声）', kind: 'voice', data: audio.data, mimeType: 'audio/wav' });
    workspace.presentation.stage.assets = [dark, light, music, voice];
    workspace.presentation.stage.cues.push(...[dark, light].map((asset, index) => ({ cueKey: `background.${index}`, beatKey: index ? 'line.light' : 'line.dark', type: 'set-background' as const, assetKey: asset.assetKey, phase: 'before' as const, durationMs: 0, order: 2 + index, easing: 'linear' as const })), { cueKey: 'music', beatKey: 'line.dark', type: 'play-audio', assetKey: music.assetKey, phase: 'before', durationMs: 0, order: 4, easing: 'linear', loop: true, volume: 0.3 });
    workspace.presentation.reading = { schema: 'storyforge.avg.reading-plan', version: 1, manualVoice: 'wait', voiceFailure: 'pause', maximumVoiceWaitMs: 10000, autoDelayMs: 200,
        voices: workspace.scripts.flatMap(script => script.lines.map(line => ({ lineKey: line.lineKey, text: line.text, textRevision: 1, speakerKey: line.speakerKey, locale: 'zh-CN', assetKey: voice.assetKey }))) };
    await customize?.(workspace, {scope:owner.scope})
    await saveAvgAuthorWorkspaceV1(owner.scope, draft.revision, workspace);
    const details = await prepareAvgAssemblyBriefV1({ scope: owner.scope, expectedDraftRevision: draft.revision + 1 });
    const s = await startNativeAvgAssembly({ ...owner, productionId: details.production.id!, details });
    await confirmNativeAvgInputs(s);
    await runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId });
    const preview = await startProductProductionPreviewV1({ scope: s.scope, productionId: s.productionId });
    return { scope: s.scope, productionId: s.productionId, buildId: s.buildId, sessionId: preview.sessionId, assets: [dark, light, music, voice] };
}
