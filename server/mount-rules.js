// NGW M1: authoritative rules for the first ground mount.
// Do not use client-provided level, ownership, movement speed, or combat flags.
export const MOUNT_LEVEL=10;
export const MOUNT_CAST_MS=2000;
export const MOUNT_SPEED_MULTIPLIER=1.6;
export const FIRST_MOUNT_ID='forest_wolf';
export const MOUNT_CATALOG=Object.freeze({
 [FIRST_MOUNT_ID]:Object.freeze({id:FIRST_MOUNT_ID,name:'Лесной волк',speedMultiplier:MOUNT_SPEED_MULTIPLIER,castMs:MOUNT_CAST_MS})
});
export const MOUNT_STATE=Object.freeze({FOOT:'foot',CASTING:'casting',RIDING:'riding'});
export function mountOwned(progress,mountId=FIRST_MOUNT_ID){
 // A quest reward must be granted by server persistence, never the browser.
 return !!progress&&Array.isArray(progress.mounts)&&progress.mounts.includes(mountId);
}
export function canBeginMount({level,owned=false,inCombat=false,inWater=false,indoors=false,dead=false,moving=false,state='foot'}={}){
 if(!Number.isInteger(level)||level<MOUNT_LEVEL)return 'level';
 if(!owned)return 'not_owned';
 if(dead)return 'dead';
 if(inCombat)return 'combat';
 if(inWater)return 'water';
 if(indoors)return 'indoors';
 if(moving)return 'moving';
 if(state!==MOUNT_STATE.FOOT)return 'busy';
 return null;
}
export function beginMount(state,now,mountId=FIRST_MOUNT_ID){
 if(!MOUNT_CATALOG[mountId])return null;
 return {...state,mountState:MOUNT_STATE.CASTING,mountId,castEndsAt:now+MOUNT_CAST_MS};
}
export function advanceMount(state,now,{inCombat=false,moving=false,dead=false}={}){
 if(state.mountState!==MOUNT_STATE.CASTING)return state;
 if(inCombat||moving||dead)return dismount(state);
 if(now<state.castEndsAt)return state;
 return {...state,mountState:MOUNT_STATE.RIDING,castEndsAt:0};
}
export function dismount(state){
 return {...state,mountState:MOUNT_STATE.FOOT,mountId:null,castEndsAt:0};
}
export function mountedSpeed(baseSpeed,state){
 return state?.mountState===MOUNT_STATE.RIDING&&MOUNT_CATALOG[state.mountId]
  ?baseSpeed*MOUNT_CATALOG[state.mountId].speedMultiplier:baseSpeed;
}
export function publicMount(state){
 return {mountState:state?.mountState===MOUNT_STATE.RIDING?'riding':'foot',
  mountId:state?.mountState===MOUNT_STATE.RIDING&&MOUNT_CATALOG[state.mountId]?state.mountId:null};
}
