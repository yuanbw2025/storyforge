/** Fixed semantic input corpus for comparing canonical bytes across an
 * implementation change. No production rows, credentials or random clock. */
export function productionCanonicalKeyFixture(){
  let state=0x6d2b79f5
  const next=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state}
  const boundaries=['a','Z','0','é','e\u0301','中','\ud7ff','\ud800','\udfff','\ue000','\uffff','\u{10000}','\u{10ffff}','😀']
  return Array.from({length:2048},(_,i)=>({
    schema:'storyforge.canonical-byte-equivalence',version:2,productionKey:`production.${i}`,buildNumber:i+1,
    controlEpoch:i%3,contentHash:'0123456789abcdef'.repeat(4),title:`作品 e\u0301 ${i}`,
    references:Array.from({length:3},(_,j)=>({artifactKey:`artifact.${i}.${j}`,version:j+1,contentHash:'abcdef0123456789'.repeat(4)})),
    labels:Object.fromEntries(Array.from({length:24},(_,j)=>{
      const point=next()%0x110000
      return [`${boundaries[next()%boundaries.length]}${String.fromCodePoint(point)}.${j}`,`${i}:${j}:é`]
    })),
  }))
}
