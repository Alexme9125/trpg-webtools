import type { Character, Session } from '../shared/types';
import { parseCharacter } from '../shared/rules';

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writeStored(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function getLibrary(): Character[] {
  const stored = readStored<unknown>('interlude-library', []);
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((value) => {
    try {
      return [parseCharacter(JSON.stringify(value))];
    } catch {
      return [];
    }
  });
}
export function saveToLibrary(character: Character) {
  const library = getLibrary();
  const index = library.findIndex((card) => card.id === character.id);
  if (index < 0) library.unshift(character);
  else library[index] = character;
  if (!writeStored('interlude-library', library)) {
    throw new Error('浏览器存储空间不可用，角色档案未保存。请先导出文件备份。');
  }
  return library;
}
export function getSession(): Session | null {
  const value = readStored<Session | null>('interlude-session', null);
  return value &&
    typeof value.roomCode === 'string' &&
    typeof value.memberId === 'string' &&
    typeof value.token === 'string'
    ? value
    : null;
}
export function downloadFile(text: string, name: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
