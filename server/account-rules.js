// NexGameWorld 0.7.0 account/character input rules (no browser trust).
// Keep account identities independent from characters so future classes,
// appearance presets, races and multiple character slots can be added safely.
export const CHARACTER_SLOT_LIMIT=3;
export const INITIAL_RACE='hornfolk';
export const INITIAL_CLASS='warrior';
const NAME_PATTERN=/^[\p{L}\p{N}][\p{L}\p{N}_-]*[\p{L}\p{N}]$/u;
export function normalizeEmail(value){
 if(typeof value!=='string')throw new TypeError('Некорректная почта');
 const email=value.trim().normalize('NFC').toLowerCase();
 if(email.length<3||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
  throw new TypeError('Некорректная почта');
 return email;
}
export function validatePassword(value){
 if(typeof value!=='string'||value.length<12||value.length>128||
    /[\u0000-\u001f\u007f]/u.test(value))
  throw new TypeError('Пароль должен содержать от 12 до 128 символов');
 return value;
}
export function normalizeNickname(value){
 if(typeof value!=='string')throw new TypeError('Некорректное имя персонажа');
 const name=value.trim().normalize('NFC');
 const length=[...name].length;
 if(length<3||length>24||!NAME_PATTERN.test(name))
  throw new TypeError('Имя: 3–24 буквы, цифры, дефис или подчёркивание');
 return name;
}
export function validateCharacterOptions(input){
 if(!input||typeof input!=='object'||Array.isArray(input))
  throw new TypeError('Некорректные параметры персонажа');
 const nickname=normalizeNickname(input.nickname);
 // The launch build has one playable race/class. The DB schema remains open
 // to additional class and appearance ids after server-side allowlisting.
 if(input.raceId!==undefined&&input.raceId!==INITIAL_RACE)
  throw new TypeError('Раса пока недоступна');
 if(input.classId!==undefined&&input.classId!==INITIAL_CLASS)
  throw new TypeError('Класс пока недоступен');
 return {nickname,raceId:INITIAL_RACE,classId:INITIAL_CLASS,appearance:{}};
}
