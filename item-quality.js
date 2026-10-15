// Item-quality visuals, shared by every inventory surface and existing 3D gear.
// This module never changes item statistics, attack timers or model geometry.
export const QUALITY_VISUALS=Object.freeze({
 poor:Object.freeze({rank:0,color:'#a4a7ac',marker:0xadb0b5,glow:0,materialTint:0x747981}),
 common:Object.freeze({rank:1,color:'#efe6d5',marker:0xf0d8a9,glow:0,materialTint:0xffffff}),
 uncommon:Object.freeze({rank:2,color:'#72df81',marker:0x69db81,glow:.08,materialTint:0x65b87a}),
 rare:Object.freeze({rank:3,color:'#79bcff',marker:0x73bcff,glow:.17,materialTint:0x5fa5e5})
});
export function itemRarity(rarity){
 return Object.prototype.hasOwnProperty.call(QUALITY_VISUALS,rarity)?rarity:'common';
}
export function highestLootRarity(items,catalog){
 let strongest='common',rank=-1;
 for(const item of items||[]){
  const name=itemRarity(catalog?.[item?.id]?.rarity);
  const value=QUALITY_VISUALS[name].rank;
  if(value>rank){strongest=name;rank=value}
 }
 return strongest;
}
// The clone(true) Three.js method shares material instances by default.
// Cache per actual mesh, not in Object3D.userData (which clone(true) copies),
// to avoid permanently dyeing the hero, inspection view and other players alike.
const meshMaterials=new WeakMap();
const applied=new WeakMap();
export function applyWeaponQuality(THREE,root,kind,rarity){
 const weapon=root?.getObjectByName?.('gear-'+kind);
 if(!weapon||!weapon.traverse)return false;
 const tier=itemRarity(rarity);
 if(applied.get(weapon)===tier)return false;
 const profile=QUALITY_VISUALS[tier],accentColor=new THREE.Color(profile.materialTint);
 let index=0;
 weapon.traverse(obj=>{
  if(!obj.isMesh||!obj.material)return;
  let record=meshMaterials.get(obj);
  if(!record){
   const single=!Array.isArray(obj.material);
   const original=single?[obj.material]:obj.material;
   const materials=original.map(m=>m.clone());
   record={materials,bases:materials.map(m=>({
    color:m.color?.clone(),emissive:m.emissive?.clone(),
    intensity:m.emissiveIntensity,roughness:m.roughness,metalness:m.metalness
   }))};
   meshMaterials.set(obj,record);
   obj.material=single?materials[0]:materials;
  }
  for(let j=0;j<record.materials.length;j++){
   const m=record.materials[j],base=record.bases[j];
   const accented=/guard|rune|gem|inlay|pommel|binding|grip|hilt|rivet|head|ornament|cross/i.test((obj.name||'')+' '+(m.name||''))||index%5===0;
   if(base.color&&m.color){
    m.color.copy(base.color);
    if(tier==='poor')m.color.lerp(accentColor,.16);
    else if(tier==='uncommon'||tier==='rare')
     m.color.lerp(accentColor,accented?(tier==='rare'?.30:.22):.045);
   }
   if(base.emissive&&m.emissive){
    m.emissive.copy(base.emissive);
    if((tier==='uncommon'||tier==='rare')&&accented)
     m.emissive.lerp(accentColor,tier==='rare'?.72:.52);
    m.emissiveIntensity=base.intensity+(accented?profile.glow:0);
   }
   if(typeof base.roughness==='number')
    m.roughness=Math.max(.17,Math.min(1,base.roughness+(tier==='poor'?.15:tier==='rare'?-.08:0)));
   if(typeof base.metalness==='number')
    m.metalness=Math.min(1,base.metalness+(tier==='rare'?.07:0));
  }
  index++;
 });
 applied.set(weapon,tier);
 return true;
}
