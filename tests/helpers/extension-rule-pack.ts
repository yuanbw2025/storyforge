import { readFile } from 'node:fs/promises'
import { activePackages, enablePackage, extensionScope, installPackage } from '../../src/lib/extensions/store'
import { previewExtensionRulePack, installExtensionRulePack } from '../../src/lib/extensions/publication'
import type { WorkspaceScope } from '../../src/lib/types'
import type { ExtensionReviewRequest } from '../../src/lib/extensions/types'
export async function installReferenceExtensionRules(scope: WorkspaceScope) {
 const bytes=await readFile('public/workshop/packages/storyforge.harbor-rules-1.0.0.sfplugin')
 const pkg=await installPackage(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer)
 const extension=await extensionScope(scope.projectId,'work',scope.workId)
 await enablePackage(pkg,extension)
 const profile=(await activePackages(extension)).find(item=>item.pkg.pluginId===pkg.pluginId)!.profile
 const request:ExtensionReviewRequest={scope:extension,pluginId:pkg.pluginId,digest:pkg.digest,profileId:profile.id,kind:'rule-pack',ruleId:'harbor',instruction:''}
 const preview=await previewExtensionRulePack(request)
 return{pkg,profile,ruleId:await installExtensionRulePack(request,preview.hash),hash:preview.hash}
}
