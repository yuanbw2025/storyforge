import * as THREE from 'three'
import { CAST, PLACES, type CastKey, type PlaceKey } from './definition'
import { walkable, walkingPath } from './navigation'
import { advanceWalkingPath, walkingFrameSeconds, type Point } from '../builtin-adventure/navigation'

export interface AphelionScene {
  dispose():void; travel(place:PlaceKey):void; setPaused(value:boolean):void; setQuality(value:boolean):void
  setQuest(place:PlaceKey,speaker:CastKey):void; setInput(x:number,z:number):void; setEnding(value:boolean):void
}
export interface AphelionSceneOptions {
  initialPlace:PlaceKey; preview:boolean; reducedMotion:boolean
  onNearby(place:PlaceKey|null):void; onArrive(place:PlaceKey):void; onInteract():void; onFailure(message:string):void
}
/** Product-owned original geometry. No downloaded models, textures, or runtime world writes. */
export function createAphelionScene(host:HTMLDivElement,options:AphelionSceneOptions):AphelionScene {
  const scene=new THREE.Scene();scene.background=new THREE.Color('#050a13')
  const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'})
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2
  renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','远日点空间站三维场景，方向键移动，E 交谈')
  host.appendChild(renderer.domElement)
  const camera=new THREE.PerspectiveCamera(43,1,.1,600)
  scene.add(new THREE.HemisphereLight('#b7d6ed','#162139',2.5))
  const sun=new THREE.DirectionalLight('#ffd2a0',3.2);sun.position.set(-45,75,25);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024)
  Object.assign(sun.shadow.camera,{left:-65,right:65,top:65,bottom:-65,near:1,far:180});sun.shadow.bias=-.0006;scene.add(sun)
  const fill=new THREE.DirectionalLight('#87d9f5',1.5);fill.position.set(45,25,-50);scene.add(fill)
  const materials=new Map<string,THREE.MeshStandardMaterial>()
  const material=(color:string,glow=false)=>{const key=color+glow;if(!materials.has(key))materials.set(key,new THREE.MeshStandardMaterial({color,roughness:.62,metalness:.36,...(glow?{emissive:color,emissiveIntensity:1.6}:{})}));return materials.get(key)!}
  function mesh(geometry:THREE.BufferGeometry,color:string,x:number,y:number,z:number,parent:THREE.Object3D=scene,glow=false) {const object=new THREE.Mesh(geometry,material(color,glow));object.position.set(x,y,z);object.castShadow=!glow;object.receiveShadow=true;parent.add(object);return object}
  const box=(w:number,h:number,d:number,color:string,x:number,y:number,z:number,parent:THREE.Object3D=scene,glow=false)=>mesh(new THREE.BoxGeometry(w,h,d),color,x,y,z,parent,glow)
  const floor:THREE.Mesh[]=[]
  let seed=40917
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/4294967296}
  const starsGeometry=new THREE.BufferGeometry();const points=[]
  for(let i=0;i<1200;i++){const a=random()*Math.PI*2,u=random()*2-1,r=180+random()*120;points.push(Math.sqrt(1-u*u)*Math.cos(a)*r,u*r,Math.sqrt(1-u*u)*Math.sin(a)*r)}
  starsGeometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3))
  scene.add(new THREE.Points(starsGeometry,new THREE.PointsMaterial({color:'#bcd8f2',size:.6,sizeAttenuation:true})))
  const gasGeometry=new THREE.SphereGeometry(37,96,64),gasColors:number[]=[]
  const gasPositions=gasGeometry.getAttribute('position'),coldBand=new THREE.Color('#617f8c'),warmBand=new THREE.Color('#d7bb8f')
  for(let index=0;index<gasPositions.count;index++) {
    const latitude=gasPositions.getY(index)/37,longitude=Math.atan2(gasPositions.getX(index),gasPositions.getZ(index))
    const curl=.018*Math.sin(longitude*7+latitude*19)+.009*Math.sin(longitude*13-latitude*23)
    const broad=.5+.5*Math.sin((latitude+curl)*15),fine=.5+.5*Math.sin((latitude+curl)*105)
    const color=coldBand.clone().lerp(warmBand,.35+broad*.65).multiplyScalar(.78+fine*.22)
    gasColors.push(color.r,color.g,color.b)
  }
  gasGeometry.setAttribute('color',new THREE.Float32BufferAttribute(gasColors,3))
  const planet=new THREE.Mesh(gasGeometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0}))
  planet.position.set(22,-15,-95);planet.rotation.z=.35;scene.add(planet)
  const cloudMaterial=new THREE.MeshStandardMaterial({color:'#e3d2aa',transparent:true,opacity:.23,roughness:1,depthWrite:false})
  const cloud=new THREE.Mesh(new THREE.SphereGeometry(37.25,48,32),cloudMaterial);planet.add(cloud)
  for(const radius of [47,51,56]) {const ring=new THREE.Mesh(new THREE.RingGeometry(radius,radius+2.2,96),new THREE.MeshBasicMaterial({color:'#bbaa91',side:THREE.DoubleSide,transparent:true,opacity:.4,depthWrite:false}));ring.rotation.x=.65;planet.add(ring)}
  const gate=new THREE.Group();gate.position.set(-24,20,63);gate.rotation.y=-.15;scene.add(gate)
  for(let i=0;i<3;i++){const ring=mesh(new THREE.TorusGeometry(13+i*.7,.28,8,72),i===1?'#91dae7':'#758da6',0,0,i*.8,gate,i===1);ring.rotation.z=i*.2}
  for(let i=0;i<12;i++){const a=i/12*Math.PI*2;const piece=box(1.5,3,2,'#35465e',Math.sin(a)*14,Math.cos(a)*14,.7,gate);piece.rotation.z=-a}
  const gateField=new THREE.Mesh(new THREE.CircleGeometry(12.8,64),new THREE.MeshBasicMaterial({color:'#6facd8',transparent:true,opacity:.06,side:THREE.DoubleSide,depthWrite:false}));gate.add(gateField)
  function deck(x:number,z:number,w:number,d:number) {floor.push(box(w,.7,d,'#2d4156',x,-.45,z));box(w+.2,.15,d+.2,'#4b667c',x,-.07,z);box(w,.06,.12,'#9bd9df',x,.04,z+d/2-.3,scene,true)}
  for(const z of [-20,0,20])deck(0,z,48,4.8)
  for(const x of [-24,0,24])deck(x,0,4.8,40)
  deck(0,-30,4.8,20)
  const animated:THREE.Object3D[]=[]
  for(const [index,place] of PLACES.entries()) {
    deck(place.x,place.z,20,16)
    for(const x of [-8,8])for(const z of [-6,6]) {box(.2,2.3,.2,'#687c8e',place.x+x,1.1,place.z+z);box(.28,.2,.28,'#b3ebeb',place.x+x,2.3,place.z+z,scene,true)}
    for(const side of [-1,1])for(const end of [-1,1])box(4,.12,.16,'#52697b',place.x+side*7,1.1,place.z+end*7.4)
    for(let tile=0;tile<5;tile++)box(.09,.025,12,'#42596e',place.x-8+tile*4,.02,place.z)
    // Console location is the same deterministic obstacle used by navigation.
    box(3,1.5,3,'#40546a',place.x+5,.75,place.z-3)
    const screen=box(2.7,.12,2,'#83d7e4',place.x+5,1.55,place.z-3,scene,true);screen.rotation.x=.12
    const placard=box(3,.9,.12,'#1a2d42',place.x-5,2.6,place.z-6.8)
    for(let n=0;n<=index%4;n++)box(.3,.3,.14,'#b5d7dc',placard.position.x-1+n*.5,2.6,place.z-6.72,scene,true)
    if(place.key==='garden')for(let i=0;i<6;i++){const x=place.x-6+(i%3)*4,z=place.z-3+Math.floor(i/3)*6;box(2.7,.7,2,'#d1d8c5',x,.4,z);for(let j=0;j<4;j++){const stem=mesh(new THREE.ConeGeometry(.55,1.7,5),'#7ea675',x-.8+(j%2)*1.5,1.5,z-.5+Math.floor(j/2));stem.rotation.z=(random()-.5)*.3}}
    if(place.key==='med'||place.key==='habitat')for(let i=0;i<4;i++){const x=place.x-6+(i%2)*4,z=place.z-4+Math.floor(i/2)*7;box(2,.8,3.8,'#bac8d0',x,.7,z);box(1.6,.5,3.1,'#355b76',x,1.3,z);box(.8,.1,.25,'#8fdfd2',x,1.65,z+1.2,scene,true)}
    if(place.key==='reactor'||place.key==='core'){const tower=mesh(new THREE.CylinderGeometry(1.7,2.2,4,12),'#58748b',place.x-5,2,place.z-3);const orb=mesh(new THREE.IcosahedronGeometry(1.15,1),place.key==='core'?'#8eebed':'#efb077',0,3,0,tower,true);animated.push(orb);for(let i=0;i<3;i++){const hoop=mesh(new THREE.TorusGeometry(2.4,.09,6,48),'#a4d1e4',0,2+i*.2,0,tower,true);hoop.rotation.x=Math.PI/2+i*.5}}
    if(place.key==='comms')for(let i=0;i<3;i++){const rack=mesh(new THREE.TorusGeometry(2.1,.11,6,40),'#87b3d1',place.x-6+i*4,3,place.z-5);rack.rotation.y=Math.PI/2;box(.2,3,.2,'#58728d',place.x-6+i*4,1.5,place.z-5)}
    if(place.key==='archive')for(let i=0;i<4;i++){box(2,3.5,1,'#334b64',place.x-7+i*3,1.8,place.z-6);for(let j=0;j<6;j++)box(1.5,.08,.12,j%2?'#b7a2d8':'#83bace',place.x-7+i*3,.5+j*.5,place.z-5.45,scene,true)}
    if(place.key==='observatory'){const scope=mesh(new THREE.CylinderGeometry(.7,1.1,5,12),'#b8c5d0',-5,3,-44);scope.rotation.x=.7;mesh(new THREE.SphereGeometry(.8,12,8),'#253c56',-5,1.3,-43);box(.5,2,.5,'#8b9eac',-5,.9,-43)}
  }
  const ship=new THREE.Group();ship.position.set(-24,1,43);scene.add(ship)
  const hull=mesh(new THREE.CylinderGeometry(3.2,4,17,12),'#9bafbd',0,2,0,ship);hull.rotation.x=Math.PI/2
  mesh(new THREE.SphereGeometry(3.25,16,12),'#bccbd1',0,2,-8.2,ship).scale.z=.7
  for(const side of [-1,1]){box(1.4,2.5,12,'#526c83',side*4.1,1.5,1,ship);mesh(new THREE.CylinderGeometry(.8,1,1.8,12),'#8ed9e6',side*4.1,1.5,7.5,ship,true).rotation.x=Math.PI/2;for(let i=0;i<5;i++)box(.15,.65,1.1,'#83c7db',side*3.7,3.1,-5+i*2.2,ship,true)}
  box(3,.4,12,'#668398',-24,-.1,31)
  // External truss and solar panels remain outside the walkable decks.
  for(const side of [-1,1])for(let i=0;i<4;i++){box(13,.22,5,'#1f3d6c',side*45,-1,-25+i*14);box(17,.3,.3,'#657c95',side*41,-.8,-25+i*14);for(let j=0;j<6;j++)box(.08,.25,5,'#42609b',side*45-5+j*2,-.83,-25+i*14)}
  function astronaut(color:string,drone=false) {
    const group=new THREE.Group();const outfit:THREE.Mesh[]=[]
    if(drone){outfit.push(mesh(new THREE.OctahedronGeometry(.6),color,0,1.5,0,group,true));const ring=mesh(new THREE.TorusGeometry(.75,.05,6,24),'#a8e4ed',0,1.5,0,group);ring.rotation.x=Math.PI/2;return {group,outfit,limbs:[] as THREE.Mesh[]}}
    outfit.push(box(.62,.85,.38,color,0,1,0,group));mesh(new THREE.SphereGeometry(.34,12,10),'#d8e2e8',0,1.72,0,group);const visor=mesh(new THREE.SphereGeometry(.29,12,8),'#223d5a',0,1.73,.13,group);visor.scale.set(1,.7,.7)
    box(.5,.55,.3,'#3b5168',0,1,-.3,group);box(.35,.07,.1,'#a1eff0',0,1.22,.25,group,true)
    const limbs=[box(.2,.65,.25,'#445b71',-.19,.36,0,group),box(.2,.65,.25,'#445b71',.19,.36,0,group),box(.18,.7,.22,color,-.45,1,0,group),box(.18,.7,.22,color,.45,1,0,group)];outfit.push(...limbs.slice(2));return{group,outfit,limbs}
  }
  const player=astronaut(CAST.player.color);scene.add(player.group)
  const npcs=new Map<PlaceKey,ReturnType<typeof astronaut>>()
  for(const place of PLACES){const npc=astronaut(CAST[place.npc].color,place.key==='core');npc.group.position.set(place.x-1.3,0,place.z-1.8);npc.group.rotation.y=.4;scene.add(npc.group);npcs.set(place.key,npc)}
  const ringGeometry=new THREE.RingGeometry(.85,1,40);ringGeometry.rotateX(-Math.PI/2)
  const marker=new THREE.Mesh(ringGeometry,new THREE.MeshBasicMaterial({color:'#9ee7eb',side:THREE.DoubleSide}));scene.add(marker)
  const start=PLACES.find(place=>place.key===options.initialPlace)!;player.group.position.set(start.x,0,start.z+2)
  let paused=false,low=false,disposed=false,ending=false,quest:PlaceKey=options.initialPlace,nearby:PlaceKey|null=null,arrived=options.initialPlace
  let path:Point[]=[],angle=.54,distance=29,last=performance.now(),elapsed=0,frameId=0,lastRendered=0
  // Paused scenes redraw only when a visual setting/state changes, leaving
  // the main thread available for installation and durable player commands.
  let needsRender = true
  const keys=new Set<string>();let touch={x:0,z:0};const target=player.group.position.clone()
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2()
  const resize=()=>{const {width,height}=host.getBoundingClientRect();if(!width||!height)return;needsRender=true;renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix()}
  const observer=new ResizeObserver(resize);observer.observe(host);resize()
  const blur=()=>{keys.clear();touch={x:0,z:0};last=performance.now()}
  const keydown=(event:KeyboardEvent)=>{if(event.defaultPrevented||(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable=true]'))return;if(paused||options.preview)return;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))event.preventDefault();keys.add(event.key.toLowerCase());if(event.key.toLowerCase()==='e'&&!event.repeat)options.onInteract()}
  const keyup=(event:KeyboardEvent)=>keys.delete(event.key.toLowerCase())
  let down:{x:number,y:number,button:number}|null=null
  const pointerdown=(event:PointerEvent)=>{down={x:event.clientX,y:event.clientY,button:event.button};renderer.domElement.setPointerCapture(event.pointerId)}
  const pointermove=(event:PointerEvent)=>{if(down?.button===2&&!paused){angle-=(event.clientX-down.x)*.008;down={...down,x:event.clientX,y:event.clientY}}}
  const pointerup=(event:PointerEvent)=>{const prior=down;down=null;if(!prior||prior.button!==0||paused||options.preview||Math.hypot(prior.x-event.clientX,prior.y-event.clientY)>8)return;const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(floor)[0];if(hit)path=walkingPath(player.group.position,hit.point);renderer.domElement.focus({preventScroll:true})}
  const cancel=()=>{down=null}
  const wheel=(event:WheelEvent)=>{event.preventDefault();distance=THREE.MathUtils.clamp(distance+event.deltaY*.015,18,50)}
  const context=(event:Event)=>event.preventDefault()
  const lost=(event:Event)=>{event.preventDefault();options.onFailure('三维画面暂时中断，已切换到文字探索。旅程仍可继续。')}
  window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',blur)
  const canvas=renderer.domElement
  canvas.addEventListener('pointerdown',pointerdown);canvas.addEventListener('pointermove',pointermove);canvas.addEventListener('pointerup',pointerup);canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('contextmenu',context);canvas.addEventListener('webglcontextlost',lost)
  function frame(now:number) {
    if(disposed)return;frameId=requestAnimationFrame(frame)
    if(document.hidden||(paused&&!needsRender)){last=now;return}
    if(!paused&&now-lastRendered<1000/30)return
    needsRender=false;lastRendered=now;const dt=walkingFrameSeconds(now-last);last=now;elapsed+=dt
    let moving=false
    if(!paused&&!options.preview){
      const ix=Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft'))+touch.x
      const iz=Number(keys.has('s')||keys.has('arrowdown'))-Number(keys.has('w')||keys.has('arrowup'))+touch.z
      let dx=0,dz=0
      if(ix||iz){path=[];dx=ix*Math.cos(angle)+iz*Math.sin(angle);dz=-ix*Math.sin(angle)+iz*Math.cos(angle)}
      else if(path.length){const p=player.group.position;const next=advanceWalkingPath(p,path,6.5*dt,walkable);const mx=next.x-p.x,mz=next.z-p.z;p.x=next.x;p.z=next.z;if(Math.hypot(mx,mz)>.001){player.group.rotation.y=Math.atan2(mx,mz);moving=true}}
      const length=Math.hypot(dx,dz)
      // Input strength scales distance per second, not the per-frame budget.
      if(length>.01){const speed=Math.min(1,length)*(keys.has('shift')?9:6.5)*dt;const steps=Math.max(1,Math.ceil(speed/.2));dx=dx/length*speed/steps;dz=dz/length*speed/steps;const p=player.group.position;for(let i=0;i<steps;i++){if(walkable({x:p.x+dx,z:p.z}))p.x+=dx;if(walkable({x:p.x,z:p.z+dz}))p.z+=dz}player.group.rotation.y=Math.atan2(dx,dz);moving=true}
      const nearest=PLACES.find(place=>Math.hypot(player.group.position.x-place.x,player.group.position.z-place.z)<3.6)?.key??null
      if(nearest!==nearby){nearby=nearest;options.onNearby(nearby)}
      // A selected route commits once on arrival, not at every landmark passed.
      if(nearest&&!path.length&&nearest!==arrived){arrived=nearest;options.onArrive(nearest)}
    }
    player.group.visible=!options.preview;player.limbs.forEach((limb,index)=>{limb.rotation.x=moving?Math.sin(elapsed*13+(index%2)*Math.PI)*(index<2?.6:.4):0})
    if(options.preview){const orbit=.56+(options.reducedMotion?0:Math.sin(elapsed*.03)*.08);camera.position.set(Math.sin(orbit)*107,70,Math.cos(orbit)*100-17);camera.lookAt(0,0,-8)}
    else{target.lerp(player.group.position,1-Math.exp(-dt*7));camera.position.set(target.x+Math.sin(angle)*distance,distance*.88,target.z+Math.cos(angle)*distance);camera.lookAt(target.x,1,target.z)}
    const objective=PLACES.find(place=>place.key===quest)!;marker.position.set(objective.x,.06,objective.z);marker.visible=!options.preview
    if(!options.reducedMotion){animated.forEach((object,index)=>{object.rotation.y=elapsed*(.25+index*.1)});gate.rotation.z=elapsed*.015;cloud.rotation.y=elapsed*.004}
    ;(gateField.material as THREE.MeshBasicMaterial).opacity=ending ? .19 : .06
    if(!low)gateField.rotation.z=elapsed*.02
    renderer.render(scene,camera)
  }
  frameId=requestAnimationFrame(frame)
  return {
    travel(place){const destination=PLACES.find(item=>item.key===place);if(destination)path=walkingPath(player.group.position,destination)},
    setPaused(value){if(paused!==value){needsRender=true;last=performance.now()}paused=value;if(value)blur()},setInput(x,z){touch={x,z}},setEnding(value){ending=value;needsRender=true},
    setQuality(value){low=value;renderer.setPixelRatio(value?1:Math.min(devicePixelRatio,1.75));renderer.shadowMap.enabled=!value;resize()},
    setQuest(place,speaker){quest=place;needsRender=true;for(const p of PLACES)updateNpc(p,p.key===place?speaker:p.npc)},
    dispose(){disposed=true;cancelAnimationFrame(frameId);observer.disconnect();window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',blur);canvas.removeEventListener('pointerdown',pointerdown);canvas.removeEventListener('pointermove',pointermove);canvas.removeEventListener('pointerup',pointerup);canvas.removeEventListener('pointercancel',cancel);canvas.removeEventListener('wheel',wheel);canvas.removeEventListener('contextmenu',context);canvas.removeEventListener('webglcontextlost',lost);const geometries=new Set<THREE.BufferGeometry>(),mats=new Set<THREE.Material>();scene.traverse(object=>{if(object instanceof THREE.Mesh||object instanceof THREE.Points){geometries.add(object.geometry);(Array.isArray(object.material)?object.material:[object.material]).forEach(mat=>mats.add(mat))}});geometries.forEach(geometry=>geometry.dispose());new Set([...materials.values(),...mats]).forEach(mat=>mat.dispose());renderer.dispose();canvas.remove()},
  }
  function updateNpc(place:typeof PLACES[number],speaker:CastKey){npcs.get(place.key)?.outfit.forEach(part=>{part.material=material(CAST[speaker].color,place.key==='core')})}
}
