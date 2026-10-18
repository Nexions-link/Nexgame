// NexGameWorld bandit camp — deterministic encounter data, no client authority.
// Server must validate combat, kills, quest progress and rewards.
export const BANDIT_CAMP = Object.freeze({
  id:'dust-trail-camp',name:'Лагерь Пыльной тропы',
  center:Object.freeze({x:-43,z:54}),unlockLevel:3,
  patrolRadius:12,leashRadius:19
});
export const BANDIT_SPAWNS=Object.freeze([
  {id:'scout-west',role:'scout',level:3,x:-54,z:51,patrol:[[-54,51],[-48,48],[-43,53]]},
  {id:'scout-east',role:'scout',level:3,x:-32,z:56,patrol:[[-32,56],[-36,62],[-43,60]]},
  {id:'guard-gate',role:'guard',level:3,x:-43,z:46,patrol:[]},
  {id:'guard-fire',role:'guard',level:4,x:-45,z:58,patrol:[]},
  {id:'captain',role:'boss',level:5,x:-44,z:65,patrol:[]}
].map(m=>Object.freeze({...m,patrol:Object.freeze(m.patrol.map(p=>Object.freeze(p)))})));
export const BANDIT_QUESTS=Object.freeze([
 {id:'bandit-recon',title:'Следы разбойников',level:3,objective:'discover',required:1,xp:65},
 {id:'bandit-patrol',title:'Очистить тропу',level:3,objective:'kill',role:'scout',required:3,xp:110},
 {id:'bandit-supplies',title:'Украденные припасы',level:3,objective:'recover',required:1,xp:90},
 {id:'bandit-captain',title:'Главарь Пыльной тропы',level:4,objective:'kill',role:'boss',required:1,xp:180}
].map(q=>Object.freeze(q)));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export function canAcceptBanditQuest(level,stage){
 return Number.isInteger(level)&&level>=BANDIT_CAMP.unlockLevel&&
 Number.isInteger(stage)&&stage>=0&&stage<BANDIT_QUESTS.length&&
 level>=BANDIT_QUESTS[stage].level;
}
export function nextPatrolPoint(spawn,position,index=0,arrival=1.1){
 const points=spawn?.patrol;
 if(!Array.isArray(points)||!points.length)return null;
 const i=((Math.trunc(index)%points.length)+points.length)%points.length;
 const target={x:points[i][0],z:points[i][1]};
 const next=dist(position,target)<=arrival?(i+1)%points.length:i;
 return {index:next,target:{x:points[next][0],z:points[next][1]}};
}
export function shouldResetBandit(spawn,position){
 return !spawn||!position||dist(spawn,position)>BANDIT_CAMP.leashRadius;
}
export function applyBanditQuestEvent(progress,event){
 // Pure transition: caller must supply server-verified event and persist atomically.
 if(!progress||!event||!Number.isInteger(progress.stage))return progress;
 const quest=BANDIT_QUESTS[progress.stage];
 if(!quest||progress.ready)return progress;
 const matches=quest.objective===event.type&&
   (quest.objective!=='kill'||quest.role===event.role);
 if(!matches)return progress;
 const count=Math.min(quest.required,Math.max(0,progress.count||0)+1);
 return {...progress,count,ready:count>=quest.required};
}
