// Developer-only local pose tuning. No gameplay stats or multiplayer data use this.
export const AXE_TUNER_STORAGE_KEY='nexgame-axe-tuner-v1';
export const AXE_TUNER_DEFAULTS=Object.freeze({
 handX:0,handY:0,handZ:0,
 axeX:0,axeY:-90,axeZ:-90,
 posX:0,posY:-0.23,posZ:0.135
});
export const AXE_TUNER_GROUPS=[
 {title:'Правая кисть · добавочный поворот',fields:['handX','handY','handZ']},
 {title:'Топор · поворот относительно кулака',fields:['axeX','axeY','axeZ']},
 {title:'Рукоять · смещение в кулаке',fields:['posX','posY','posZ']}
];
export const AXE_TUNER_FIELDS=Object.fromEntries(
 Object.keys(AXE_TUNER_DEFAULTS).map(key=>[key,{
  label:key.slice(-1),minimum:key.startsWith('pos')?-1.5:-180,
  maximum:key.startsWith('pos')?1.5:180,
  step:key.startsWith('pos')?0.005:1,
  unit:key.startsWith('pos')?'':'°'
 }])
);
export function normalizeAxeTuning(input){
 const obj=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
 const out={};
 for(const [key,original] of Object.entries(AXE_TUNER_DEFAULTS)){
  const {minimum,maximum,step}=AXE_TUNER_FIELDS[key];
  const value=typeof obj[key]==='number'&&Number.isFinite(obj[key])?obj[key]:original;
  const limited=Math.max(minimum,Math.min(maximum,value));
  out[key]=Math.round(limited/step)*step;
  if(key.startsWith('pos'))out[key]=Number(out[key].toFixed(3));
 }
 return out;
}
export function serializeAxeTuning(values){
 return JSON.stringify(normalizeAxeTuning(values),null,2);
}
