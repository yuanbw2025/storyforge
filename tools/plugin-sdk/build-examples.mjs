import fs from 'node:fs/promises'
import { mergeCatalogEntries } from './catalog-entries.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { createHash } from 'node:crypto'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// Publish the same type contract the host compiles, without runtime private-source imports.
const types = await fs.readFile(path.join(root, 'src/lib/extensions/types.ts'), 'utf8')
await fs.writeFile(path.join(root, 'tools/plugin-sdk/index.d.ts'), types)
const folders = (await fs.readdir(path.join(root,'examples/plugins'),{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort()
const catalogPath = path.join(root, 'public/workshop/catalog.json')
const previous = JSON.parse(await fs.readFile(catalogPath, 'utf8'))
const entries=[]
for(const folder of folders){
 const manifest=JSON.parse(await fs.readFile(path.join(root,'examples/plugins',folder,'manifest.json'),'utf8'))
 const filename=`${manifest.id}-${manifest.version}.sfplugin`
 execFileSync(process.execPath,[path.join(root,'tools/plugin-sdk/cli.mjs'),'pack',path.join(root,'examples/plugins',folder),path.join(root,'public/workshop/packages',filename)],{cwd:root})
 const bytes=await fs.readFile(path.join(root,'public/workshop/packages',filename))
 entries.push({id:manifest.id,version:manifest.version,name:manifest.name,description:manifest.description,author:manifest.author,kind:manifest.kind,owner:manifest.owner,url:`packages/${filename}`,digest:createHash('sha256').update(bytes).digest('hex'),dependencies:manifest.dependencies})
}
await fs.writeFile(path.join(root,'public/workshop/catalog.json'),JSON.stringify({...previous,format:1,entries:mergeCatalogEntries(previous.entries,entries)},null,2)+'\n')
