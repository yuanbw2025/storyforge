import * as THREE from 'three'
import { CAST, PLACES, type CastKey, type PlaceKey } from './definition'
import { groundHeight, walkable, walkingPath, type Obstacle, type Point } from './navigation'
import { advanceWalkingPath, walkingFrameSeconds } from '../builtin-adventure/navigation'

export interface TidemarkScene {
  dispose(): void
  travel(place: PlaceKey): void
  setPaused(paused: boolean): void
  setQuest(place: PlaceKey, speaker: CastKey): void
  setQuality(low: boolean): void
  setPreview(preview: boolean): void
  setInput(x: number, z: number): void
  setEnding(ending: boolean): void
}

/** All geometry is original and procedural; dispose owns every GPU resource. */
export function createTidemarkScene(host: HTMLDivElement, options: {
  initialPlace: PlaceKey; preview: boolean; reducedMotion: boolean;
  onArrive(place: PlaceKey): void; onNearby(place: PlaceKey | null): void; onInteract(): void;
  onFrame?(framesPerSecond: number): void; onFailure(message: string): void;
}): TidemarkScene {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#162e3c')
  scene.fog = new THREE.FogExp2('#294653', 0.006)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.35
  renderer.domElement.setAttribute('aria-label', '白礁镇三维探索场景，使用方向键移动，E 键交谈')
  renderer.domElement.tabIndex = 0
  host.appendChild(renderer.domElement)
  const camera = new THREE.PerspectiveCamera(42, 1, 0.2, 320)
  const ambient = new THREE.HemisphereLight('#a8c4d0', '#283244', 2.2); scene.add(ambient)
  const sun = new THREE.DirectionalLight('#ffd4a4', 3.8); sun.position.set(-40, 65, -45)
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024)
  Object.assign(sun.shadow.camera, { left: -72, right: 72, top: 72, bottom: -72, near: 1, far: 180 })
  sun.shadow.bias = -0.0005; scene.add(sun)
  const moon = new THREE.Mesh(new THREE.SphereGeometry(5.5, 24, 16), new THREE.MeshBasicMaterial({ color: '#e4d9bc' })); moon.position.set(58, 55, -140); scene.add(moon)

  const materials = new Map<string, THREE.MeshStandardMaterial>()
  const material = (color: string, emissive = false) => {
    const key = color + emissive
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...(emissive ? { emissive: color, emissiveIntensity: 1.4 } : {}) }))
    return materials.get(key)!
  }
  function mesh(geometry: THREE.BufferGeometry, color: string, x: number, y: number, z: number, parent: THREE.Object3D = scene, glow = false) {
    const object = new THREE.Mesh(geometry, material(color, glow)); object.position.set(x, y, z); object.castShadow = !glow; object.receiveShadow = !glow; parent.add(object); return object
  }
  function box(w: number, h: number, d: number, color: string, x: number, y: number, z: number, parent: THREE.Object3D = scene, glow = false) { return mesh(new THREE.BoxGeometry(w,h,d),color,x,y,z,parent,glow) }
  let seed = 19910926
  const random = () => { seed = (Math.imul(seed,1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296 }
  const obstacles: Obstacle[] = []
  const waterGeometry = new THREE.PlaneGeometry(340,340,45,45); waterGeometry.rotateX(-Math.PI/2)
  const water = new THREE.Mesh(waterGeometry, new THREE.MeshStandardMaterial({ color: '#346b78', roughness: 0.39, metalness: 0.25, flatShading: true })); water.position.y=-2.6; scene.add(water)
  const landGeometry = new THREE.PlaneGeometry(118,134,60,68); landGeometry.rotateX(-Math.PI/2)
  const vertices = landGeometry.attributes.position
  for(let i=0;i<vertices.count;i++) { const x=vertices.getX(i); const z=vertices.getZ(i)-17; vertices.setXYZ(i,x,groundHeight(z),z) }
  const indices=landGeometry.index!;const inside:number[]=[]
  for(let i=0;i<indices.count;i+=3){const triangle=[indices.getX(i),indices.getX(i+1),indices.getX(i+2)];if(triangle.every(index=>(vertices.getX(index)/59)**2+((vertices.getZ(index)+17)/67)**2<=1))inside.push(...triangle)}
  landGeometry.setIndex(inside)
  landGeometry.computeVertexNormals(); const land=new THREE.Mesh(landGeometry,material('#617169')); land.receiveShadow=true; scene.add(land)
  const cliff=mesh(new THREE.CylinderGeometry(1,0.92,7,64), '#3b4d54',0,-3,-17); cliff.scale.set(59,1,67)
  for(let i=0;i<90;i++) {
    const theta=i/90*Math.PI*2; const x=Math.cos(theta)*58; const z=Math.sin(theta)*66-17
    const rock=mesh(new THREE.DodecahedronGeometry(1,0),'#59666a',x,-0.9,z); rock.scale.set(2+random()*2,2+random()*3,2+random()*2); rock.rotation.set(random(),random(),random())
  }
  function path(a: Point,b: Point,width=2.4) {
    const length=Math.hypot(b.x-a.x,b.z-a.z); const strips=Math.ceil(length/3)
    for(let i=0;i<strips;i++) { const t=(i+.5)/strips; const z=a.z+(b.z-a.z)*t; const tile=box(width,.07,length/strips+.1,'#a19b85',a.x+(b.x-a.x)*t,groundHeight(z)+.025,z); tile.rotation.y=Math.atan2(b.x-a.x,b.z-a.z); tile.castShadow=false }
  }
  const junction={x:0,z:-8}
  PLACES.forEach(place=>path(junction,place,place.key==='lighthouse'?3:2.5))
  function house(x:number,z:number,w:number,d:number,color:string, roof:string) {
    const ground=groundHeight(z); obstacles.push({x,z,width:w,depth:d})
    box(w+.4,.6,d+.4,'#4e5757',x,ground+.3,z)
    box(w,4,d,color,x,ground+2.6,z)
    const roofMesh=mesh(new THREE.CylinderGeometry(0,1,1,4),roof,x,ground+5.9,z); roofMesh.scale.set(w*.84,2.4,d*.84); roofMesh.rotation.y=Math.PI/4
    box(.8,3,.9,'#656768',x+w*.25,ground+5.3,z-1)
    box(1.25,2.3,.12,'#3a4142',x,ground+1.55,z+d/2+.07)
    for(const side of [-1,1]) { box(1,.95,.14,'#edb46d',x+side*w*.29,ground+2.9,z+d/2+.12,scene,true); box(.07,1,.16,'#62615b',x+side*w*.29,ground+2.9,z+d/2+.21) }
    for(let i=0;i<3;i++) box(w+1,.1,.14,'#576365',x,ground+1+i*1.05,z+d/2+.18)
  }
  house(-21,-5,8,7,'#c6b59d','#8a6350'); house(23,0,9,6,'#a7b6b2','#506573'); house(-20,-27,8,7,'#9da5a0','#697a7b')
  house(11,19,6,7,'#b8b0a1','#946c52'); house(-5,23,5,6,'#aeb5a8','#59736b'); house(33,16,6,6,'#b6aa98','#6d7776')
  house(-34,7,5,6,'#b7aaa0','#8a6c5d'); house(37,-8,5,6,'#b7b9aa','#7f6b63')
  // Lighthouse: tapered plaster, copper gallery, an animated light rather than a texture.
  const towerZ=-63, towerY=groundHeight(towerZ)
  obstacles.push({x:2,z:towerZ,width:7,depth:7})
  mesh(new THREE.CylinderGeometry(3,4,18,12),'#d2cec1',2,towerY+9,towerZ)
  for(const y of [4,8,12]) box(.85,1.5,.2,'#b8d2c5',2,towerY+y,towerZ+3.42,scene,true)
  mesh(new THREE.CylinderGeometry(4.3,4.3,.55,16),'#6f7d7d',2,towerY+18,towerZ)
  mesh(new THREE.CylinderGeometry(2.8,2.8,3.2,12),'#9cbbb4',2,towerY+20,towerZ)
  for(let i=0;i<12;i++){const a=i/12*Math.PI*2; box(.14,3.5,.14,'#667474',2+Math.cos(a)*2.85,towerY+20,towerZ+Math.sin(a)*2.85)}
  mesh(new THREE.ConeGeometry(3.6,3,12),'#62746d',2,towerY+23,towerZ)
  const beacon=mesh(new THREE.SphereGeometry(.8,12,8),'#ffcf7c',2,towerY+20,towerZ,scene,true)
  const beamMaterial=new THREE.MeshBasicMaterial({color:'#ffe2a0',transparent:true,opacity:.045,depthWrite:false,side:THREE.DoubleSide})
  const beam=new THREE.Mesh(new THREE.ConeGeometry(11,78,24,1,true),beamMaterial); beam.rotation.z=Math.PI/2; beam.position.x=39
  const beamPivot=new THREE.Group(); beamPivot.position.set(2,towerY+20,towerZ); beamPivot.add(beam); scene.add(beamPivot)
  // Jetty, moored boats, stacked freight.
  for(let i=0;i<24;i++) box(7,.25,.85,'#8b7760',-29,.18,29+i*.8)
  for(const x of [-32,-26]) for(const z of [30,36,42,48]) box(.45,4,.45,'#635951',x,-1,z)
  function boat(x:number,z:number,angle:number,broken=false) {
    const group=new THREE.Group(); group.position.set(x,broken?.5:-1.3,z);group.rotation.y=angle;scene.add(group)
    const hull=mesh(new THREE.CylinderGeometry(2,1,7,5),broken?'#6a6860':'#866b51',0,0,0,group);hull.rotation.x=Math.PI/2;hull.scale.x=.8
    box(2.1,.3,5.8,'#a38b69',0,.6,0,group); box(.15,9,.15,'#8a795f',0,4,0,group)
    const sail=mesh(new THREE.PlaneGeometry(3.6,4.5),'#d1cbb6',1.7,5,0,group);sail.material.side=THREE.DoubleSide;sail.rotation.y=.25
    return group
  }
  const boats=[boat(-39,38,-.2),boat(-20,48,.4)]
  boat(-49,-19,1.2,true)
  for(let i=0;i<7;i++){const x=-33+random()*8;const z=16+random()*4;box(1.2,1.2,1.2,'#968369',x,.6,z);box(1.25,.14,.14,'#584f44',x,.4,z+.61)}
  // Tide shrine: roof, stone steps and a tree hung with name tablets.
  const shrine=new THREE.Group();shrine.position.set(24,0,-29);scene.add(shrine)
  box(9,.5,6,'#8d9690',0,.25,0,shrine)
  for(const x of [-3.6,3.6])for(const z of [-2,2])box(.5,5,.5,'#ada58a',x,2.5,z,shrine)
  const shrineRoof=mesh(new THREE.ConeGeometry(6.5,2.5,4),'#68827d',0,6,0,shrine);shrineRoof.rotation.y=Math.PI/4;shrineRoof.scale.z=.75
  obstacles.push({x:24,z:-29,width:8,depth:5})
  function tree(x:number,z:number,scale=1,white=false) {
    const y=groundHeight(z);mesh(new THREE.CylinderGeometry(.12,.3,3.7,5),white?'#c6c7b5':'#756b57',x,y+1.8,z)
    for(let layer=0;layer<3;layer++) { const leaf=mesh(new THREE.ConeGeometry((2.1-layer*.4)*scale,3*scale,6),white?'#a7bdb3':['#3c625b','#47766a','#628c7a'][layer],x,y+3.5*scale+layer*1.15*scale,z);leaf.rotation.y=random()*3 }
  }
  for(let i=0;i<55;i++) { const x=(random()-.5)*94;const z=random()*94-66;if(PLACES.some(p=>Math.hypot(x-p.x,z-p.z)<9)||!walkable({x,z},obstacles)||Math.abs(x)<6)continue;tree(x,z,.65+random()*.6) }
  tree(31,-25,1.3,true)
  for(let i=0;i<9;i++)box(.38,.72,.1,'#e3cda1',29+random()*4,2+random()*2,-24+random()*2)
  mesh(new THREE.CylinderGeometry(3.4,3.4,.5,18),'#858e8a',2,.2,-37)
  for(let i=0;i<10;i++){const a=i/10*Math.PI*2;box(.2,1.1,.2,'#5f7373',2+Math.cos(a)*3.3,.8,-37+Math.sin(a)*3.3)}
  // Town clock and warm pools of light.
  box(1.1,6,1.1,'#a9a38f',0,3,8); mesh(new THREE.CylinderGeometry(1.1,1.1,.35,24),'#dfca95',0,5.5,8.7).rotation.x=Math.PI/2
  box(.12,1,.1,'#48575b',0,5.85,8.93)
  const lanterns:THREE.Mesh[]=[]
  for(const p of PLACES){const y=groundHeight(p.z);box(.14,3.5,.14,'#696a5c',p.x-2,y+1.7,p.z);const lantern=box(.55,.7,.55,'#efbb6d',p.x-2,y+3.3,p.z,scene,true);lanterns.push(lantern);mesh(new THREE.ConeGeometry(.55,.35,4),'#67726a',p.x-2,y+3.85,p.z)}
  const grassGeometry=new THREE.ConeGeometry(.12,.7,3)
  const grass=new THREE.InstancedMesh(grassGeometry,material('#86987a'),350);const dummy=new THREE.Object3D()
  for(let i=0;i<350;i++){const x=(random()-.5)*104;const z=random()*108-72;dummy.position.set(x,groundHeight(z)+.1,z);dummy.scale.setScalar(walkable({x,z},obstacles)? .6+random()*.8:0);dummy.rotation.y=random()*6;dummy.updateMatrix();grass.setMatrixAt(i,dummy.matrix)}scene.add(grass)
  function person(color:string) {
    const group=new THREE.Group()
    const coat=mesh(new THREE.CylinderGeometry(.27,.43,.9,6),color,0,.9,0,group)
    mesh(new THREE.SphereGeometry(.23,8,6),'#dac4a5',0,1.61,0,group)
    mesh(new THREE.SphereGeometry(.24,8,6),'#424b4e',0,1.74,-.03,group).scale.y=.55
    const legs=[box(.18,.6,.2,'#38464c',-.15,.28,0,group),box(.18,.6,.2,'#38464c',.15,.28,0,group)]
    const arms=[box(.16,.7,.17,color,-.38,.93,0,group),box(.16,.7,.17,color,.38,.93,0,group)]
    return {group,legs,arms,outfit:[coat,...arms]}
  }
  const player=person(CAST.player.color); scene.add(player.group)
  const scarf=box(.17,.5,.08,'#eccb8c',.15,1.18,-.35,player.group);scarf.rotation.x=.3
  const npcs=new Map<PlaceKey,ReturnType<typeof person>>()
  PLACES.forEach(place=>{const npc=person(CAST[place.npc].color);npc.group.position.set(place.x+1.2,groundHeight(place.z),place.z-1);npc.group.rotation.y=.7;scene.add(npc.group);npcs.set(place.key,npc)})
  const ringGeometry=new THREE.RingGeometry(.7,.87,32); ringGeometry.rotateX(-Math.PI/2)
  const ring=new THREE.Mesh(ringGeometry,new THREE.MeshBasicMaterial({color:'#f2cd8a',transparent:true,opacity:.85,side:THREE.DoubleSide}));scene.add(ring)
  const questMarker=mesh(new THREE.OctahedronGeometry(.33), '#e6c18a',0,3,0,scene,true)
  const start=PLACES.find(p=>p.key===options.initialPlace)!
  player.group.position.set(start.x,groundHeight(start.z),start.z+2)
  let paused=false,preview=options.preview,low=false,disposed=false,ending=false,quest:PlaceKey='quay'
  let waypoints:Point[]=[],angle=.62,distance=31,elapsed=0,last=performance.now(),lastRendered=0,frameId=0,frames=0,fpsStart=last
  let nearby:PlaceKey|null=null,arrived:PlaceKey=options.initialPlace
  // Paused scenes redraw only when a visual setting/state changes, leaving
  // the main thread available for installation and durable player commands.
  let needsRender = true
  const keys=new Set<string>();let touch={x:0,z:0};const lookAt=new THREE.Vector3();lookAt.copy(player.group.position)
  const raycaster=new THREE.Raycaster();const pointer=new THREE.Vector2()
  let down:{x:number;y:number;button:number}|null=null
  const resized=()=>{const {width,height}=host.getBoundingClientRect();if(!width||!height)return;needsRender=true;renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix()}
  const resizeObserver=new ResizeObserver(resized);resizeObserver.observe(host);resized()
  const keyDown=(event:KeyboardEvent)=>{if((event.target as HTMLElement)?.matches('input,textarea,select,[contenteditable=true]'))return;if((event.target as HTMLElement)?.closest('button')&&[' ','Enter'].includes(event.key))return;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(event.key))event.preventDefault();keys.add(event.key.toLowerCase());if(event.key.toLowerCase()==='e'&&!event.repeat&&!paused&&!preview)options.onInteract()}
  const keyUp=(event:KeyboardEvent)=>keys.delete(event.key.toLowerCase())
  const blur=()=>{keys.clear();touch={x:0,z:0};last=performance.now()}
  const pointerDown=(event:PointerEvent)=>{down={x:event.clientX,y:event.clientY,button:event.button}}
  const pointerMove=(event:PointerEvent)=>{if(down?.button===2){angle-=(event.clientX-down.x)*.008;down={...down,x:event.clientX,y:event.clientY}}}
  const pointerUp=(event:PointerEvent)=>{
    const prior=down;down=null;if(!prior||prior.button!==0||paused||preview||Math.hypot(prior.x-event.clientX,prior.y-event.clientY)>8)return
    const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera)
    const hits=raycaster.intersectObjects([...npcs.values()].map(npc=>npc.group),true)
    if(hits.length&&nearby&&npcs.get(nearby)?.group.children.includes(hits[0].object)) {options.onInteract();return}
    const ground=raycaster.intersectObject(land)[0];if(ground)waypoints=walkingPath(player.group.position,ground.point,obstacles)
    renderer.domElement.focus({preventScroll:true})
  }
  const wheel=(event:WheelEvent)=>{event.preventDefault();distance=THREE.MathUtils.clamp(distance+event.deltaY*.018,19,55)}
  const context=(event:Event)=>event.preventDefault()
  const lost=(event:Event)=>{event.preventDefault();options.onFailure('三维画面暂时中断。可切换到文字探索继续，或刷新恢复。')}
  window.addEventListener('keydown',keyDown);window.addEventListener('keyup',keyUp);window.addEventListener('blur',blur)
  renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointermove',pointerMove);renderer.domElement.addEventListener('pointerup',pointerUp)
  renderer.domElement.addEventListener('wheel',wheel,{passive:false});renderer.domElement.addEventListener('contextmenu',context);renderer.domElement.addEventListener('webglcontextlost',lost)
  function frame(now:number){
    if(disposed)return;frameId=requestAnimationFrame(frame)
    if(document.hidden){last=now;return}
    if(paused&&!needsRender){last=now;return}
    if(!paused&&now-lastRendered<1000/30)return
    needsRender=false;lastRendered=now
    const dt=walkingFrameSeconds(now-last);last=now;elapsed+=dt;frames++
    if(now-fpsStart>1500){options.onFrame?.(Math.round(frames*1000/(now-fpsStart)));frames=0;fpsStart=now}
    let moving=false
    if(!paused&&!preview){
      const inputX=Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft'))+touch.x
      const inputZ=Number(keys.has('s')||keys.has('arrowdown'))-Number(keys.has('w')||keys.has('arrowup'))+touch.z
      let dx=0,dz=0
      if(inputX||inputZ){waypoints=[];dx=inputX*Math.cos(angle)+inputZ*Math.sin(angle);dz=-inputX*Math.sin(angle)+inputZ*Math.cos(angle)}
      else if(waypoints.length){const p=player.group.position;const next=advanceWalkingPath(p,waypoints,5.8*dt,point=>walkable(point,obstacles));const mx=next.x-p.x,mz=next.z-p.z;p.x=next.x;p.z=next.z;p.y=groundHeight(p.z);if(Math.hypot(mx,mz)>.001){player.group.rotation.y=Math.atan2(mx,mz);moving=true}}
      const length=Math.hypot(dx,dz)
      if(length>.01){
        const distance = Math.min(1, length) * (keys.has('shift') ? 9 : 5.8) * dt
        const steps = Math.max(1, Math.ceil(distance / .25))
        dx = dx / length * distance / steps
        dz = dz / length * distance / steps
        const p=player.group.position
        for(let step=0;step<steps;step++){if(walkable({x:p.x+dx,z:p.z},obstacles))p.x+=dx;if(walkable({x:p.x,z:p.z+dz},obstacles))p.z+=dz}
        p.y=groundHeight(p.z);player.group.rotation.y=Math.atan2(dx,dz);moving=true
      }
      const nearest=PLACES.find(p=>Math.hypot(p.x-player.group.position.x,p.z-player.group.position.z)<4.3)?.key??null
      if(nearest!==nearby){nearby=nearest;options.onNearby(nearby)}
      // A selected route commits once on arrival, not at every landmark passed.
      if(nearest&&!waypoints.length&&nearest!==arrived){arrived=nearest;options.onArrive(nearest)}
    }
    player.legs.forEach((leg,i)=>leg.rotation.x=moving?Math.sin(elapsed*13+i*Math.PI)*.6:0)
    player.arms.forEach((arm,i)=>arm.rotation.x=moving?Math.sin(elapsed*13+i*Math.PI)*.45:0)
    player.group.visible=!preview
    if(preview){const orbit=options.reducedMotion ? .72 : .72+Math.sin(elapsed*.025)*.17;camera.position.set(Math.sin(orbit)*100,65,Math.cos(orbit)*98-22);camera.lookAt(0,3,-20)}
    else {lookAt.lerp(player.group.position,1-Math.exp(-dt*6));camera.position.set(lookAt.x+Math.sin(angle)*distance,lookAt.y+distance*.85,lookAt.z+Math.cos(angle)*distance);camera.lookAt(lookAt.x,lookAt.y+1,lookAt.z)}
    const objective=PLACES.find(p=>p.key===quest)!;ring.position.set(objective.x,groundHeight(objective.z)+.12,objective.z);questMarker.position.set(objective.x+1.2,groundHeight(objective.z)+3.2+(options.reducedMotion?0:Math.sin(elapsed*2)*.15),objective.z-1);questMarker.rotation.y=elapsed*.45;questMarker.visible=!preview
    beamPivot.rotation.y=elapsed*.13;beam.visible=ending||preview;beacon.visible=ending||preview
    if(!options.reducedMotion&&!low){const attr=waterGeometry.attributes.position;for(let i=0;i<attr.count;i++)attr.setY(i,Math.sin(attr.getX(i)*.12+elapsed*.5)*.22+Math.cos(attr.getZ(i)*.17+elapsed*.4)*.17);attr.needsUpdate=true;boats.forEach((boat,i)=>{boat.position.y=-1.3+Math.sin(elapsed+i)*.12;boat.rotation.z=Math.sin(elapsed*.8+i)*.025})}
    renderer.render(scene,camera)
  }
  frameId=requestAnimationFrame(frame)
  return {
    travel(place){const destination=PLACES.find(p=>p.key===place)!;waypoints=walkingPath(player.group.position,destination,obstacles)},
    setPaused(value){if(paused!==value){needsRender=true;last=performance.now()}paused=value;if(value)blur()}, setQuest(place,speaker){quest=place;needsRender=true;for(const location of PLACES){const npc=npcs.get(location.key)!;npc.outfit.forEach(part=>{part.material=material(CAST[location.key===place?speaker:location.npc].color)})}},
    setQuality(value){low=value;renderer.setPixelRatio(value?1:Math.min(window.devicePixelRatio,1.75));renderer.shadowMap.enabled=!value;resized()},
    setPreview(value){preview=value},setInput(x,z){touch={x,z}},setEnding(value){ending=value;needsRender=true},
    dispose(){disposed=true;cancelAnimationFrame(frameId);resizeObserver.disconnect();window.removeEventListener('keydown',keyDown);window.removeEventListener('keyup',keyUp);window.removeEventListener('blur',blur);renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointermove',pointerMove);renderer.domElement.removeEventListener('pointerup',pointerUp);renderer.domElement.removeEventListener('wheel',wheel);renderer.domElement.removeEventListener('contextmenu',context);renderer.domElement.removeEventListener('webglcontextlost',lost);const geometries=new Set<THREE.BufferGeometry>();const mats=new Set<THREE.Material>();scene.traverse(object=>{if(object instanceof THREE.Mesh){geometries.add(object.geometry);(Array.isArray(object.material)?object.material:[object.material]).forEach(mat=>mats.add(mat))}});geometries.forEach(geometry=>geometry.dispose());mats.forEach(mat=>mat.dispose());renderer.dispose();renderer.domElement.remove()},
  }
}
