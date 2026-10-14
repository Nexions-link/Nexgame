// Painted landscape, baked once at startup. No extra per-frame work or RNG use.
const clamp01=v=>Math.max(0,Math.min(1,v));
function smooth(a,b,v){const t=clamp01((v-a)/(b-a));return t*t*(3-2*t)}
function hash(x,z){let n=Math.imul(x,374761393)^Math.imul(z,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295}
function noise(x,z){const ix=Math.floor(x),iz=Math.floor(z),u=smooth(0,1,x-ix),v=smooth(0,1,z-iz);return (hash(ix,iz)*(1-u)+hash(ix+1,iz)*u)*(1-v)+(hash(ix,iz+1)*(1-u)+hash(ix+1,iz+1)*u)*v}

export function createLandscapeMap(THREE,segments,size=1024){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
 const context=canvas.getContext('2d'),image=context.createImageData(size,size),pixels=image.data;
 const routes=segments.map(s=>({...s,dx:s.bx-s.ax,dz:s.bz-s.az,length2:(s.bx-s.ax)**2+(s.bz-s.az)**2}));
 for(let py=0;py<size;py++)for(let px=0;px<size;px++){
  const x=(px+.5)/size*190-95,z=(py+.5)/size*190-95;
  const broad=noise(x*.065,z*.065),patch=noise(x*.27+31,z*.27-17),fine=noise(x*1.3,z*1.3);
  const dry=smooth(.36,.78,broad*.72+patch*.28),grain=(hash(px,py)-.5)*8;
  let r=88+dry*45+fine*9,g=111+dry*22+fine*11,b=55+dry*19+fine*6;
  // Capsule union rounds corners/junctions; broad noise breaks up the verge.
  let worn=0;
  for(const s of routes){
   const t=clamp01(((x-s.ax)*s.dx+(z-s.az)*s.dz)/s.length2);
   const distance=Math.hypot(x-s.ax-s.dx*t,z-s.az-s.dz*t);
   const edge=(patch-.5)*.6+(fine-.5)*.18;
   worn=Math.max(worn,1-smooth(s.width*.32,s.width*.67,distance+edge));
  }
  const dirt=patch*12+fine*7;
  r+=(151+dirt-r)*worn;g+=(125+dirt-g)*worn;b+=(79+dirt*.7-b)*worn;
  const i=(py*size+px)*4;pixels[i]=r+grain;pixels[i+1]=g+grain;pixels[i+2]=b+grain*.7;pixels[i+3]=255;
 }
 context.putImageData(image,0,0);
 const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
 map.name='Painted meadow and feathered paths';return map;
}

export function createSkyMap(THREE){
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;
 const c=canvas.getContext('2d'),gradient=c.createLinearGradient(0,0,0,256);
 gradient.addColorStop(0,'#4b83b4');gradient.addColorStop(.28,'#83b2ce');
 gradient.addColorStop(.48,'#c7d8d6');gradient.addColorStop(.53,'#c7d8d6');gradient.addColorStop(1,'#919d79');
 c.fillStyle=gradient;c.fillRect(0,0,512,256);
 // Small, soft cloud banks, baked into the sky rather than transparent meshes.
 for(let i=0;i<14;i++){
  const x=25+hash(i,7)*460,y=58+hash(i,13)*39,rx=15+hash(i,19)*26,ry=2+hash(i,23)*4;
  c.save();c.translate(x,y);c.scale(rx,ry);
  const cloud=c.createRadialGradient(0,0,0,0,0,1);cloud.addColorStop(0,'rgba(255,249,225,.24)');cloud.addColorStop(1,'rgba(255,249,225,0)');
  c.fillStyle=cloud;c.fillRect(-1,-1,2,2);c.restore();
 }
 const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.mapping=THREE.EquirectangularReflectionMapping;
 map.name='Painted daylight sky';return map;
}
