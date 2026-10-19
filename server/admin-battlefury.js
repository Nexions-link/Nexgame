// Never accept combat privilege based on browser supplied item IDs.
export const ADMIN_BATTLEFURY_ID='adminBattlefury';
export const ADMIN_BATTLEFURY_CHARACTER_ID='ccfdf7dc-fdbf-4857-9d9f-5b8b0301fd98';
export const ADMIN_BATTLEFURY_ACCOUNT_ID='4aadebea-72c0-4987-839d-de5059a75f38';
export function isAuthorizedBattlefuryEquipped(player){
 return player?.characterId===ADMIN_BATTLEFURY_CHARACTER_ID&&
  player?.accountId===ADMIN_BATTLEFURY_ACCOUNT_ID&&
  player?.equipment?.weapon?.id===ADMIN_BATTLEFURY_ID;
}
