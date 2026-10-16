// NexGameWorld PT: three-dimensional quest punctuation for spherical NPCs.
// Geometric depth and dark silhouette keep quest status readable against sky,
// grass and tent fabric. This module never changes quest logic or NPC targeting.
export const QUEST_MARKER_VISUALS=Object.freeze({
 available:Object.freeze({glyph:'!',color:0xffd400,edge:0x603b10,glow:.30}),
 ready:Object.freeze({glyph:'?',color:0xffdc13,edge:0x603b10,glow:.29}),
 active:Object.freeze({glyph:'?',color:0xb7aa72,edge:0x3b3729,glow:.075})
});
export const markerStateFromGlyph=glyph=>glyph==='!'?'available':glyph==='?'?'ready':glyph==='·'?'active':null;

function exclamationShape(THREE){
 const shape=new THREE.Shape();
 shape.moveTo(-.195,.72);
 shape.lineTo(.195,.72);
 shape.lineTo(.108,-.19);
 shape.quadraticCurveTo(.100,-.255,.036,-.255);
 shape.lineTo(-.036,-.255);
 shape.quadraticCurveTo(-.100,-.255,-.108,-.19);
 shape.closePath();
 return shape;
}
function makeHaloTexture(THREE,document){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=96;
 const ctx=canvas.getContext('2d');
 const grad=ctx.createRadialGradient(48,48,8,48,48,47);
 grad.addColorStop(0,'rgba(255,231,91,.44)');
 grad.addColorStop(.35,'rgba(255,207,32,.23)');
 grad.addColorStop(.72,'rgba(255,185,7,.07)');
 grad.addColorStop(1,'rgba(255,185,7,0)');
 ctx.fillStyle=grad;ctx.fillRect(0,0,96,96);
 const map=new THREE.CanvasTexture(canvas);
 map.colorSpace=THREE.SRGBColorSpace;
 return map;
}
export function createQuestMarkerFactory(THREE,{document,camera}){
 const haloMap=makeHaloTexture(THREE,document);
 const markers=[];
 const darkCache=new Map(),lightCache=new Map();
 const mat=(hex,dark)=>{
  const cache=dark?darkCache:lightCache;
  if(!cache.has(hex))cache.set(hex,new THREE.MeshBasicMaterial({
   color:hex,toneMapped:false,depthTest:true,depthWrite:true,side:THREE.DoubleSide
  }));
  return cache.get(hex);
 };
 const faceConfig={depth:.105,bevelEnabled:true,bevelSegments:2,steps:1,
  bevelSize:.034,bevelThickness:.026,curveSegments:12};
 function addMesh(parent,geometry,material,x=0,y=0,z=0){
  const mesh=new THREE.Mesh(geometry,material);
  mesh.position.set(x,y,z);mesh.castShadow=false;mesh.receiveShadow=false;
  // Quest punctuation must never steal taps intended for the NPC.
  mesh.raycast=()=>{};
  parent.add(mesh);return mesh;
 }
 function addBall(parent,x,y,z,radius,material){
  const b=addMesh(parent,new THREE.SphereGeometry(radius,12,8),material,x,y,z);
  b.scale.z=.75;return b;
 }
 function addSymbol(root,glyph,style){
  const edge=mat(style.edge,true),gold=mat(style.color,false);
  if(glyph==='!'){
   const shape=exclamationShape(THREE);
   const geom=new THREE.ExtrudeGeometry(shape,faceConfig);
   const outline=addMesh(root,geom,edge,0,0,-.08);
   outline.scale.set(1.24,1.10,1.15);
   addMesh(root,geom,gold,0,0,.068);
   addBall(root,0,-.52,-.05,.185,edge);
   addBall(root,0,-.52,.065,.132,gold);
  }else{
   const curve=new THREE.CatmullRomCurve3([
    new THREE.Vector3(-.295,.425,0),new THREE.Vector3(-.265,.625,0),
    new THREE.Vector3(-.02,.70,0),new THREE.Vector3(.245,.61,0),
    new THREE.Vector3(.325,.405,0),new THREE.Vector3(.242,.22,0),
    new THREE.Vector3(.07,.04,0),new THREE.Vector3(.035,-.18,0)
   ],false,'centripetal');
   addMesh(root,new THREE.TubeGeometry(curve,22,.173,9,false),edge,0,0,-.04);
   addMesh(root,new THREE.TubeGeometry(curve,22,.113,9,false),gold,0,0,.062);
   addBall(root,.035,-.52,-.06,.182,edge);
   addBall(root,.035,-.52,.066,.128,gold);
  }
 }
 function create(glyph,height=5.48){
  const state=markerStateFromGlyph(glyph);
  if(!state)throw Error('Unsupported quest marker: '+glyph);
  const config=QUEST_MARKER_VISUALS[state];
  const marker=new THREE.Group();
  marker.name='nexgameworld-quest-'+state;
  marker.position.y=height;
  marker.userData.questMarker=true;
  marker.userData.glyph=glyph; // Existing gameplay uses this exact token.
  marker.userData.questState=state;
  marker.userData.baseHeight=height;
  marker.userData.phase=markers.length*1.57;
  const halo=new THREE.Sprite(new THREE.SpriteMaterial({
   map:haloMap,transparent:true,opacity:config.glow,
   color:0xffd236,depthWrite:false,depthTest:true,
   blending:THREE.AdditiveBlending,toneMapped:false
  }));
  halo.position.set(0,.12,-.20);
  halo.scale.set(2.05,2.25,1);
  halo.raycast=()=>{};
  halo.name='quest-soft-halo';
  marker.add(halo);
  addSymbol(marker,config.glyph,config);
  marker.scale.setScalar(1.12);
  marker.visible=false;
  markers.push({marker,halo,config});
  return marker;
 }
 const tempRotation=new THREE.Quaternion();
 function update(time=0,detail=.68){
  const t=Number.isFinite(time)?time:0;
  const quality=Math.max(0,Math.min(1,Number(detail)||0));
  camera.updateMatrixWorld();
  for(const {marker,halo,config} of markers){
   if(!marker.visible||!marker.parent)continue;
   marker.parent.updateWorldMatrix(true,false);
   // Real meshes face the camera, even when NPC local Y points radially outward.
   marker.parent.getWorldQuaternion(tempRotation);
   marker.quaternion.copy(tempRotation.invert()).multiply(camera.quaternion);
   const phase=t*1.55+marker.userData.phase;
   marker.position.y=marker.userData.baseHeight+Math.sin(phase)*.095;
   marker.scale.setScalar(1.12*(1+.035*Math.sin(phase)));
   halo.material.opacity=quality<.35?0:config.glow*(.87+.13*Math.sin(t*2.3+marker.userData.phase));
  }
 }
 function dispose(){
  for(const {marker,halo} of markers){
   for(const obj of marker.children)if(obj.isMesh)obj.geometry.dispose();
   halo.material.dispose();
   marker.removeFromParent();
  }
  haloMap.dispose();
  markers.length=0;
 }
 return {create,update,dispose,markers};
}
