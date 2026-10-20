import type { AnyProductRuntimePackage, ProductBuildQualityReportV1, ProductProductionBriefV3 } from '../types';
import { avgExecutableModule } from './executable-module';
import { avgVoiceProductionEnabledV3, parseAvgAssemblyBriefV2, type AvgAssemblyBrief } from './assembly-contract';
import { assertAvgVisualProductionPolicyV2 } from './media-production-policy';
import { parseAvgStoredAssemblyBriefV3 } from './voice-assembly-storage';
import { assertAvgVoiceProductionPolicyV3 } from './voice-production-policy';
import { assertAvgSoundProductionPolicyV1 } from './sound-production-policy';
import { avgSoundProductionExecutionReadyV1 } from './sound-production-brief';
import { parseAvgVisualPlanningBriefV5, avgVisualPlanningExecutionReadyV5 } from './visual-planning-brief-v5';
import { assertAvgVisualPlanningPolicyV5 } from './visual-planning-policy-v5';
/** This identifies a closed author-owned engineering route. It cannot admit
 * commercial candidates, legacy AVG or arbitrary V2 modules. */
export function isAvgAuthorPrototypeBriefV1(brief: ProductProductionBriefV3): brief is ProductProductionBriefV3 & {
    avgAssembly: AvgAssemblyBrief;
} {
    if (brief.intent.productType !== 'avg' || brief.qualityProfile !== 'prototype' || !brief.avgAssembly) return false;
    if (brief.avgAssembly.version === 1) return true;
    if (brief.avgAssembly.version === 3) {
        try {
            const { assembly } = parseAvgStoredAssemblyBriefV3(brief.avgAssembly);
            assertAvgVoiceProductionPolicyV3({ ...brief, avgAssembly: assembly });
            return true;
        } catch { return false; }
    }
    if (brief.avgAssembly.version !== 2) return false;
    try {
        parseAvgAssemblyBriefV2(brief.avgAssembly);
        assertAvgVisualProductionPolicyV2(brief);
        return true;
    } catch { return false; }
}
/** Classification adds original Sound and professional V5 contracts without granting the
 * avgAssembly field promised by the legacy predicate above. It never rewrites
 * a Brief or supplies producer, author, route or decoder evidence. */
export function classifyAvgAuthorPrototypeBriefV1(brief: ProductProductionBriefV3): 'assembly' | 'sound' | 'visual-v5' | null {
    if (brief.avgVisualPlanning !== undefined) {
        if (brief.intent.productType !== 'avg' || brief.qualityProfile !== 'prototype' || brief.avgSoundPlanning !== undefined
            || brief.avgVisualPlanning.version !== 5) return null;
        try {
            const visual = parseAvgVisualPlanningBriefV5(brief.avgVisualPlanning);
            assertAvgVisualPlanningPolicyV5({ ...brief, avgVisualPlanning: visual });
            return 'visual-v5';
        } catch { return null; }
    }
    if (brief.avgSoundPlanning !== undefined) {
        if (brief.intent.productType !== 'avg' || brief.qualityProfile !== 'prototype') return null;
        try {
            assertAvgSoundProductionPolicyV1(brief);
            return 'sound';
        } catch { return null; }
    }
    return isAvgAuthorPrototypeBriefV1(brief) ? 'assembly' : null;
}
/** Check at actual write boundaries, including the final transaction. Frozen
 * source/Release reads and successful command replay remain independent. */
export function assertAvgSoundPrototypeWriteEnabledV1(): void {
    if (!avgSoundProductionExecutionReadyV1()) throw new Error('[avg-sound] 声音原型验收与发布尚未启用，已有声音与版本仍可只读播放');
}
/** Generated-voice prototype writes require both existing media and voice
 * switches. Stored contracts and immutable playback remain readable. */
export function assertAvgVoicePrototypeWriteEnabledV3(): void {
    if (!avgVoiceProductionEnabledV3()) throw new Error('[avg-voice] 配音原型验收与发布尚未启用，已有配音与版本仍可只读播放');
}
/** The two existing image/planning switches fence actual prototype writes;
 * classification and immutable original reads do not require an open factory. */
export function assertAvgVisualPrototypeWriteEnabledV5(): void {
    if (!avgVisualPlanningExecutionReadyV5()) throw new Error('[avg-visual-plan] 专业视觉原型验收与发布尚未启用，已有图片与版本仍可只读播放');
}
/** Frozen pre-preview QA is technical only. Real full-catalog decoding and an
 * explicit completed-route author receipt must still qualify it after preview;
 * this predicate never supplies those receipts or changes the frozen report. */
export function avgPrototypeTechnicalQualitySatisfiedV1(input: {
    brief: ProductProductionBriefV3;
    runtimePackage: AnyProductRuntimePackage;
    quality: ProductBuildQualityReportV1;
    buildNumber: number;
    packageHash: string;
}): boolean {
    const { brief, runtimePackage: pkg, quality } = input;
    if (!classifyAvgAuthorPrototypeBriefV1(brief) || pkg.version !== 2 || !avgExecutableModule(pkg))
        return false;
    const passed = new Set(quality.hardGateResults.filter(gate => gate.passed).map(gate => gate.gateId));
    return quality.buildNumber === input.buildNumber && quality.packageHash === input.packageHash && quality.playable
        && quality.mediaCoverage >= brief.completionContract.minimumMediaCoverage && quality.hardGateResults.every(gate => gate.passed)
        && brief.completionContract.requiredGateIds.every(gate => passed.has(gate));
}
