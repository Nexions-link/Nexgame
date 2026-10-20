// Render is ready only if EVERY required Neon pool responds.
// Accounts alone do not imply progress saves and economy will work.
export async function assertWorldReady({
 accountApi,authenticatedWorldGate,accountStore,worldProgressStore,worldEconomyStore,
 stopping=false
}={}){
 if(stopping)throw Error('server_stopping');
 if(!accountApi||!authenticatedWorldGate||!accountStore||
    !worldProgressStore||!worldEconomyStore)
  throw Error('world_dependencies_unavailable');
 const stores=[accountStore,worldProgressStore,worldEconomyStore];
 if(stores.some(store=>typeof store.ping!=='function'))
  throw Error('world_pool_not_monitorable');
 await Promise.all(stores.map(store=>store.ping()));
 return true;
}
