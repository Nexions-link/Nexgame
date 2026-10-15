// Unified expandable NexGame asset registry. Add new entries here.
export const ATLAS_VERSION='0.2.3';
export const ATLAS_CATEGORIES=Object.freeze([
 {id:'creatures',name:'Существа',icon:'◈'},
 {id:'weapons',name:'Оружие',icon:'⚒'},
 {id:'armor',name:'Броня',icon:'◇'},
 {id:'items',name:'Предметы',icon:'✦'},
 {id:'world',name:'Мир',icon:'⌖'}
]);
export const ATLAS_ENTRIES=Object.freeze([
 {id:'dolgonog',category:'creatures',number:'C001',name:'Долгоног',subtitle:'Равнинная птица',version:'0.1',asset:'./models/dolgonog-v0.1.glb',description:'Высокая равнинная птица с сильными ногами, охристым оперением и терракотовым хохолком.',facts:[['Обитание','Равнины Мулгора'],['Тип','Существо'],['Анимации','Idle · Walk · Peck']],animations:['Idle','Walk','Peck']},
 {id:'tauren-axe',category:'weapons',number:'W001',name:'Топор странника',subtitle:'Одноручный топор',version:'0.1',asset:'../assets/weapons/tauren-axe-v0.1.glb',description:'Простой боевой топор с деревянной рукоятью, кожаной обмоткой и металлическим лезвием. Первая самостоятельная модель оружия.',facts:[['Тип','Одноручный топор'],['Формат','GLB'],['Использование','Экипировка персонажа']],animations:[]},
 {id:'plains-sword',category:'weapons',number:'W002',name:'Клинок равнин',subtitle:'Одноручный меч',version:'0.1',asset:'../assets/weapons/plains-sword-v0.1.glb',description:'Оригинальный одноручный стальной клинок с бронзовой гардой, кожаным хватом и гранёным навершием.',facts:[['Тип','Одноручный меч'],['Формат','GLB'],['Использование','Снаряжение и примерка']],animations:[]},
 {id:'steppe-dagger',category:'weapons',number:'W003',name:'Степной кинжал',subtitle:'Одноручный кинжал',version:'0.1',asset:'../assets/weapons/steppe-dagger-v0.1.glb',description:'Компактный кинжал с гранёным стальным клинком, бронзовой гардой, кожаной рукоятью и бирюзовым камнем в навершии. Оригинальная модель NexGame.',facts:[['Тип','Одноручный кинжал'],['Формат','GLB · 3D'],['Использование','Снаряжение и тюнер кинжала']],animations:[]}
]);
export function filterAtlasEntries(category='all',query=''){
 const q=query.trim().toLocaleLowerCase('ru');
 return ATLAS_ENTRIES.filter(e=>(category==='all'||e.category===category)&&[e.name,e.subtitle,e.description,e.number].join(' ').toLocaleLowerCase('ru').includes(q));
}
