// Interest management for visual presence. Chat, parties and PvE are global
// within a room; only large replaceable snapshots are proximity-filtered.
import {arcDistance} from './spherical-pve.js';
export const VISUAL_RANGE=85,MAX_VISIBLE_PEERS=16;
export function selectVisiblePlayers(roomPlayers,observer,radius,{range=VISUAL_RANGE,limit=MAX_VISIBLE_PEERS}={}){
 if(!observer)return [];
 const visible=[];
 for(const player of roomPlayers){
  if(player.id===observer.id)continue;
  const meters=arcDistance(observer.normal,player.normal,radius);
  if(meters<=range)visible.push({player,meters});
 }
 visible.sort((a,b)=>a.meters-b.meters);
 return [observer,...visible.slice(0,limit).map(entry=>entry.player)];
}
