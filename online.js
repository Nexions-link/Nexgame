// Shared-world presence transport. Networking is opt-in until the server is deployed.
// Rendering and gameplay are not coupled to socket lifecycle.
export function createWorldPresence({url,onStatus,onPlayers,onMobs,onLeave,onWelcome,getPosition}){
 let socket=null,closed=false,retry=null,interval=null,selfId=null;
 const send=json=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(json))};
 const status=value=>onStatus?.(value);
 const connect=()=>{
  if(closed||!url)return;
  status('connecting');
  const ws=new WebSocket(url);socket=ws;
  ws.onopen=()=>{status('online');send({type:'join',name:'Странник',...getPosition?.()});
   interval=setInterval(()=>{const p=getPosition?.();if(p)send({type:'move',...p})},100);
  };
  ws.onmessage=e=>{
   let m;try{m=JSON.parse(e.data)}catch{return}
   if(!m||typeof m!=='object')return;
   if(m.type==='welcome'){selfId=m.id;onWelcome?.(m);
    if(Array.isArray(m.mobs))onMobs?.(m.mobs);
   }
   else if(m.type==='snapshot'){
    if(Array.isArray(m.players))onPlayers?.(m.players.filter(p=>p.id!==selfId));
    if(Array.isArray(m.mobs))onMobs?.(m.mobs);
   }
   else if(m.type==='leave'&&typeof m.id==='string')onLeave?.(m.id);
  };
  ws.onclose=()=>{if(socket!==ws)return;socket=null;clearInterval(interval);interval=null;
   onPlayers?.([]);onMobs?.(null);status('offline');if(!closed)retry=setTimeout(connect,3000);
  };
  ws.onerror=()=>{if(ws.readyState<2)ws.close()};
 };
 if(!url){status('solo');return {close(){},connected:()=>false}}
 connect();
 return {close(){closed=true;clearTimeout(retry);clearInterval(interval);socket?.close();},
  connected:()=>socket?.readyState===WebSocket.OPEN};
}
