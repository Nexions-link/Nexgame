// A single, extensible source of truth for the NexGame bestiary.
export const BESTIARY_VERSION='0.1.0';
export const CREATURES=Object.freeze([
 Object.freeze({
  id:'dolgonog',number:'001',name:'Долгоног',subtitle:'Равнинная птица',
  habitat:'Тёплые равнины',category:'Фауна Мулгора',version:'0.1',
  description:'Высокая равнинная птица с сильными ногами, охристым оперением, тёмными крыльями и терракотовым хохолком.',
  animations:Object.freeze(['idle','walk','attack']),
  // No copy of the original GLB is currently accessible from chatgpt.site.
  // The preview is deliberately marked as a reconstruction, not the original.
  source:'procedural-reconstruction',
  futureAsset:'models/dolgonog-v0.1.glb',
  tags:Object.freeze(['Существо','Наземное','Анимированное'])
 })
]);
export const DRAFT_KEY='nexgame-bestiary-dolgonog-draft-v1';
export function normalizeCreatureParams(candidate,defaults){
 const result={...defaults};
 if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))return result;
 for(const [key,baseline] of Object.entries(defaults)){
  const value=candidate[key];
  if(typeof baseline==='number'&&Number.isFinite(value))result[key]=Math.min(1.6,Math.max(.55,value));
  if(typeof baseline==='string'&&/^#[0-9a-f]{6}$/i.test(value))result[key]=value.toLowerCase();
 }
 return result;
}
export function humanBytes(bytes){
 if(!Number.isFinite(bytes)||bytes<0)return '—';
 return bytes>=1048576?(bytes/1048576).toFixed(2)+' МБ':Math.round(bytes/1024)+' КБ';
}
