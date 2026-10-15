// Native NexGame meadow density and geometry, bent onto a spherical world.
// Instanced draw calls: 1 grass, 3 blossom species, 1 shrub batch.
import {scatterMeadow} from '../meadow.js?v=0.3.7.1';
function clumpGeometry(THREE){
 const positions=[],colors=[];
 for(let i=0;i<4;i++){
  const a=i*Math.PI/2,cs=Math.cos(a),sn=Math.sin(a),h=.58+(i%2)*.19,w=.145;
  positions.push(-sn*w,0,cs*w,sn*w,0,-cs*w,cs*.12,h,sn*.12);
  colors.push(.55,.74,.43,.55,.74,.43,1,.98,.77);
 }
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
 geometry.computeVertexNormals();return geometry;
}
function blossomGeometry(THREE,hex){
 const stem=new THREE.Color(0x6a8b48),leaf=new THREE.Color(0x93ae62);
 const petal=new THREE.Color(hex),core=new THREE.Color(0xffd37b);
 const positions=[],colors=[];
 const tri=(a,b,c,ca,cb,cc)=>{
  positions.push(...a,...b,...c);
  for(const color of [ca,cb,cc])colors.push(color.r,color.g,color.b);
 };
 for(const a of [0,Math.PI/2]){
  const x=Math.cos(a)*.045,z=Math.sin(a)*.045;
  tri([-x,0,-z],[x,0,z],[0,.57,0],stem,stem,leaf);
 }
 for(let i=0;i<5;i++){
  const a=i*Math.PI*2/5,cs=Math.cos(a),sn=Math.sin(a);
  const sideX=-sn*.12,sideZ=cs*.12;
  const tip=[cs*.26,.63,sn*.26];
  const left=[cs*.09+sideX,.57,sn*.09+sideZ];
  const right=[cs*.09-sideX,.57,sn*.09-sideZ];
  tri([0,.55,0],left,tip,core,petal,petal);
  tri([0,.55,0],tip,right,core,petal,petal);
 }
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
 geometry.computeVertexNormals();return geometry;
}

export function createSphericalMeadow(THREE,{scene,getRadius,toNormal,heightAt,accept}){
 const UP=new THREE.Vector3(0,1,0),dummy=new THREE.Object3D();
 const upQuat=new THREE.Quaternion(),twist=new THREE.Quaternion();
 const layers=[];
 const allowed=(x,z)=>Math.hypot(x+5,z-4)>8&&accept(x,z);
 const grassPoints=scatterMeadow({count:2100,attempts:6200,seed:17031,extent:69,
  accept:(x,z)=>allowed(x,z)});
 const grass=new THREE.InstancedMesh(clumpGeometry(THREE),new THREE.MeshStandardMaterial({
  color:0xffffff,roughness:1,side:THREE.DoubleSide,vertexColors:true
 }),grassPoints.length);
 scene.add(grass);layers.push({mesh:grass,points:grassPoints,mode:'grass'});
 const flowerPoints=scatterMeadow({count:330,attempts:3100,seed:69241,extent:65,
  accept:(x,z)=>allowed(x,z)&&Math.hypot(x+5,z-4)>13&&
   Math.sin(x*.23+z*.075)*Math.cos(z*.21-x*.12)>.05});
 const flowers=[];
 for(let variant=0;variant<3;variant++){
  const rows=flowerPoints.filter((_,i)=>i%3===variant);
  const flower=new THREE.InstancedMesh(
   blossomGeometry(THREE,[0xf7d879,0xd5b2ee,0xf7eee0][variant]),
   new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide}),rows.length);
  scene.add(flower);flowers.push(flower);layers.push({mesh:flower,points:rows,mode:'flower'});
 }
 const shrubPoints=scatterMeadow({count:125,attempts:1600,seed:83649,extent:66,
  accept:(x,z)=>allowed(x,z)&&Math.hypot(x+5,z-4)>19&&Math.sin(x*.17-z*.19)>.1});
 const shrubs=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1,0),
  new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,flatShading:true}),shrubPoints.length);
 scene.add(shrubs);layers.push({mesh:shrubs,points:shrubPoints,mode:'shrubs'});
 function rebuild(){
  const radius=getRadius();
  for(const {mesh,points,mode} of layers){
   for(let i=0;i<points.length;i++){
    const p=points[i],normal=toNormal(p.x,p.z,radius);
    const elevation=heightAt(normal);
    const scale=mode==='grass'?.55+p.scale*.58:mode==='flower'?.7+p.scale*.5:p.scale;
    const localHeight=mode==='grass'?0:mode==='flower'?.012:.31*p.scale;
    dummy.position.copy(normal).multiplyScalar(radius+elevation+localHeight);
    upQuat.setFromUnitVectors(UP,normal);
    dummy.quaternion.copy(upQuat).multiply(twist.setFromAxisAngle(UP,p.angle));
    if(mode==='shrubs')dummy.scale.set(.54*scale,.34*scale,.48*scale);
    else dummy.scale.setScalar(scale);
    dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
    if(mode==='grass')mesh.setColorAt(i,new THREE.Color().setHSL(.19+p.variety*.055,.35,.43+p.variety*.14));
    if(mode==='shrubs')mesh.setColorAt(i,new THREE.Color().setHSL(.21+p.variety*.055,.28,.33+p.variety*.1));
   }
   mesh.instanceMatrix.needsUpdate=true;
   mesh.frustumCulled=false;
   mesh.castShadow=false;mesh.receiveShadow=false;
   mesh.count=points.length;
  }
 }
 function applyDensity(preset){
  const fraction=key=>Math.max(0,Math.min(1,Number(preset[key])||0));
  for(const {mesh,points,mode} of layers)
   mesh.count=Math.floor(points.length*fraction(mode==='grass'?'grass':mode==='flower'?'flowers':'shrubs'));
 }
 rebuild();
 return {rebuild,applyDensity,counts:{grass:grassPoints.length,flowers:flowerPoints.length,shrubs:shrubPoints.length}};
}
