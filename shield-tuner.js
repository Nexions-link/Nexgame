// Separate nine-axis profiles, each shield pose saved only on this device.
export const SHIELD_TUNER_VARIANTS=['round','kite'];
export const SHIELD_TUNER_DEFAULTS=Object.freeze({
 handX:0,handY:0,handZ:0,shieldX:0,shieldY:180,shieldZ:0,
 posX:-.12,posY:-.02,posZ:-.34
});
export const SHIELD_TUNER_GROUPS=[
 {title:'Положение щита',fields:['posX','posY','posZ']},
 {title:'Поворот щита',fields:['shieldX','shieldY','shieldZ']},
 {title:'Левая кисть',fields:['handX','handY','handZ']}
];
export const SHIELD_TUNER_FIELDS=Object.fromEntries(Object.keys(SHIELD_TUNER_DEFAULTS).map(key=>[key,{
 label:key.slice(-1),min:key.startsWith('pos')?-1.5:-180,
 max:key.startsWith('pos')?1.5:180,step:key.startsWith('pos')?.005:1,
 unit:key.startsWith('pos')?'':'°'
}]));
export function shieldTunerStorageKey(kind){
 if(!SHIELD_TUNER_VARIANTS.includes(kind))throw Error('Unknown shield variant');
 return 'nexgame-shield-'+kind+'-tuner-v1';
}
export function normalizeShieldTuning(input){
 const value=input&&typeof input==='object'&&!Array.isArray(input)?input:{},result={};
 for(const [key,fallback] of Object.entries(SHIELD_TUNER_DEFAULTS)){
  const spec=SHIELD_TUNER_FIELDS[key],raw=Number.isFinite(value[key])?value[key]:fallback;
  const rounded=Math.round(Math.max(spec.min,Math.min(spec.max,raw))/spec.step)*spec.step;
  result[key]=key.startsWith('pos')?Number(rounded.toFixed(3)):rounded;
 }
 return result;
}
export function serializeShieldTuning(value){return JSON.stringify(normalizeShieldTuning(value),null,2)}
