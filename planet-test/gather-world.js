// Test-only spherical copies of the main NexGame gathering resources.
// Quest locations and timings mirror game.js (main), but all objects remain
// in this independent offline scene and do not write to the production save.
export const GATHER_QUESTS=[
 null,
 {title:'Цветы равнин',item:'meadowFlower',count:4,gold:12,xp:35,
  hint:'Соберите луговые цветы вокруг лагеря.',intro:'Собери четыре луговых цветка для моего целебного настоя.',
  locations:[[-12,10],[-2,17],[5,20],[12,16],[-17,19],[15,24],[-7,27]]},
 {title:'Солнечные корни',item:'sunRoot',count:3,gold:20,xp:55,
  hint:'Найдите солнечные корни на дальних пастбищах.',intro:'Теперь мне нужны три солнечных корня, которые растут за лагерем.',
  locations:[[6,29],[13,31],[21,25],[27,19],[-12,29],[0,36]]},
 {title:'Лунные грибы',item:'moonMushroom',count:2,gold:35,xp:90,
  hint:'Ищите лунные грибы у прохладных камней.',intro:'Последний ингредиент — два лунных гриба среди прохладных камней.',
  locations:[[16,-22],[25,-23],[32,-31],[26,-9],[38,-27]]}
];
export const GATHER_INTERACT_RANGE=2.8;
export const GATHER_CAST_SECONDS=1.5;
export const GATHER_RESPAWN_SECONDS=32;
export const OFFLINE_CHEST={x:-33.2,z:-7.4,slots:18,range:4.7};
export function createGatherWorld({THREE,parent,place}){
  const yAxis=new THREE.Vector3(0,1,0);
  const material=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.92,...extra});
  const mats={stem:material('#587f40'),leaf:material('#739b47'),
    petal:material('#fff0b4',{emissive:'#483514',emissiveIntensity:.15}),
    core:material('#e7bb62',{emissive:'#805624',emissiveIntensity:.15}),
    root:material('#c0a16e'),rootLeaf:material('#99a85a'),
    mushroom:material('#a099c1',{emissive:'#594680',emissiveIntensity:.2}),
    spot:material('#e7dfed'),bone:material('#d6ccb1'),
    spark: new THREE.MeshBasicMaterial({color:'#faeabd'})
  };
  const nodes=[];
  function obj(group,shape,mat,x,y,z,sx=1,sy=1,sz=1){
    const mesh=new THREE.Mesh(shape,mat);mesh.position.set(x,y,z);
    mesh.scale.set(sx,sy,sz);group.add(mesh);return mesh;
  }
  const sph=new THREE.SphereGeometry(1,9,7);
  const cone=new THREE.ConeGeometry(1,1,8);
  const cyl=new THREE.CylinderGeometry(1,1,1,7);
  for(let stage=1;stage<=3;stage++){
    GATHER_QUESTS[stage].locations.forEach(([x,z],index)=>{
      const group=new THREE.Group();group.name='gather-'+stage+'-'+index;parent.add(group);
      if(stage===1){
        obj(group,cyl,mats.stem,0,.20,0,.035,.4,.035);
        obj(group,sph,mats.core,0,.43,0,.14,.12,.14);
        for(let i=0;i<5;i++){
          const angle=i*2*Math.PI/5;
          obj(group,sph,mats.petal,Math.sin(angle)*.27,.44,Math.cos(angle)*.27,.16,.075,.13);
        }
        obj(group,sph,mats.leaf,-.19,.14,0,.23,.06,.11);
      } else if(stage===2){
        obj(group,sph,mats.root,-.16,.15,-.1,.22,.19,.22);
        obj(group,sph,mats.root,.12,.15,.08,.22,.18,.22);
        for(let i=-1;i<=1;i++){
          const leaf=obj(group,sph,mats.rootLeaf,.16*i,.4,.07*i,.12,.26,.08);
          leaf.rotation.z=i*.48;
        }
      } else {
        for(const [cx,cz,h,r] of [[-.15,-.1,.34,.3],[.27,.15,.23,.22]]){
          obj(group,cyl,mats.bone,cx,h/2,cz,.07,h,.07);
          obj(group,cone,mats.mushroom,cx,h+.05,cz,r,.25,r);
          obj(group,sph,mats.spot,cx,h+.16,cz,r*.38,.045,r*.38);
        }
      }
      const spark=obj(group,sph,mats.spark,0,.86,0,.09,.09,.09);
      const node={kind:'gather',name:({1:'Луговой цветок',2:'Солнечный корень',3:'Лунный гриб'})[stage],
        id:stage+'-'+index,stage,index,x,z,yaw:0,root:group,spark,item:GATHER_QUESTS[stage].item,
        pending:false,readyAt:0};
      group.visible=false;nodes.push(node);place(node);
    });
  }
  // Physical 18-slot chest inside the original longhouse.
  const chestMat=material('#69482c'),dark=material('#3d3023'),metal=material('#c6a46b',{metalness:.35,roughness:.7});
  const chest=new THREE.Group();chest.name='offline-hearth-chest';parent.add(chest);
  obj(chest,new THREE.BoxGeometry(1,1,1),chestMat,0,.55,0,1.85,.93,1.15);
  obj(chest,new THREE.BoxGeometry(1,1,1),dark,0,1.07,0,1.93,.15,1.23);
  for(const z of [-.56,.56])obj(chest,new THREE.BoxGeometry(1,1,1),metal,0,.6,z,1.93,.1,.09);
  for(const x of [-.75,.75])obj(chest,new THREE.BoxGeometry(1,1,1),metal,x,.55,0,.12,1.04,1.25);
  obj(chest,new THREE.BoxGeometry(1,1,1),metal,0,.72,.62,.26,.3,.09);
  const chestEntity={kind:'chest',name:'Сундук · 18 ячеек',x:OFFLINE_CHEST.x,z:OFFLINE_CHEST.z,yaw:0,root:chest};
  place(chestEntity);
  return {nodes,chest:chestEntity,update(clock,isAvailable){
    for(const node of nodes){
      node.root.visible=!!isAvailable(node,clock);
      if(node.root.visible){
        node.spark.position.y=.86+.1*Math.sin(clock*2.5+node.index);
        node.root.rotateY(.0008);
      }
    }
  }};
}
