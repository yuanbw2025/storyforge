/* global MutationObserver, document, window, performance, requestAnimationFrame */
import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import process from 'node:process'

const [baseline, candidate, destination = '/tmp/storyforge-plugin-performance.json'] = process.argv.slice(2)
for (const address of [baseline,candidate]) if (!address || !/^http:\/\/127\.0\.0\.1:\d+\/storyforge\/$/.test(address)) throw new Error('Pass isolated loopback baseline/candidate production URLs')
const browser = await chromium.launch()
const runs = { baseline: [], candidate: [] }
async function measure(address) {
 const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'})
 await context.route('https://**',route=>route.abort())
 await context.addInitScript(()=>{
  const observer=new MutationObserver(()=>{if(document.querySelector('[data-testid="home-page"]')){window.__sfReady=performance.now();observer.disconnect()}})
  observer.observe(document,{childList:true,subtree:true})
 })
 const page=await context.newPage()
 await page.goto(address,{waitUntil:'load'})
 await page.waitForFunction(()=>typeof window.__sfReady==='number')
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 const value=await page.evaluate(()=>({readyMs:window.__sfReady,fcpMs:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,pluginScripts:performance.getEntriesByType('resource').filter(entry=>/ExtensionSurface|WorkshopPage|mcp-client|PluginTools/.test(entry.name)).map(entry=>entry.name)}))
 await context.close()
 return value
}
try{
 for(let i=0;i<14;i++){
  const order=i%2?['candidate','baseline']:['baseline','candidate']
  for(const key of order){const result=await measure(key==='baseline'?baseline:candidate);if(i>=2)runs[key].push(result)}
 }
 const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]
 const summaries=Object.fromEntries(Object.entries(runs).map(([key,values])=>[key,{readyMedianMs:median(values.map(row=>row.readyMs)),fcpMedianMs:median(values.map(row=>row.fcpMs)),readyMinMs:Math.min(...values.map(row=>row.readyMs)),readyMaxMs:Math.max(...values.map(row=>row.readyMs)),pluginScriptRequests:values.reduce((sum,row)=>sum+row.pluginScripts.length,0)}]))
 const comparison={startupPercent:(summaries.candidate.readyMedianMs/summaries.baseline.readyMedianMs-1)*100,fcpPercent:(summaries.candidate.fcpMedianMs/summaries.baseline.fcpMedianMs-1)*100}
 const report={measuredAt:new Date().toISOString(),platform:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0].model,ramGiB:os.totalmem()/1024**3,method:'Same Chromium, alternating isolated cold contexts, 2 warmup pairs then 12 measured pairs, production bundles, plugins off, external fonts blocked, service workers blocked',budget:{startupRegressionPercent:5,fcpRegressionPercent:5},baseline,candidate,summaries,comparison,runs}
 await fs.writeFile(destination,JSON.stringify(report,null,2)+'\n')
 process.stdout.write(JSON.stringify({summaries,comparison,destination},null,2)+'\n')
}finally{await browser.close()}
