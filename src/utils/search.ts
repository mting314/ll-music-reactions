import { toHiragana, toRomaji } from 'wanakana';

export interface SearchableItem {
  id: string | number;
  name: string;
  englishName?: string;
  phoneticName?: string;
  [key: string]: unknown;
}

function stripPunctuation(str: string): string {
  return str
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getLevenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1,
          matrix[i]![j - 1]! + 1,
          matrix[i - 1]![j]! + 1,
        );
      }
    }
  }

  return matrix[b.length]![a.length]!;
}

const MAX_LEVENSHTEIN_DISTANCE = 3;

function maxDistanceForLength(len: number): number {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 8) return 2;
  return MAX_LEVENSHTEIN_DISTANCE;
}

export function fuzzySearch(item: SearchableItem, query: string): boolean {
  if (!query.trim()) return true;

  const q = query.toLowerCase();
  const queryHiragana = toHiragana(q, { passRomaji: false });
  const queryRomaji = toRomaji(queryHiragana);
  const normalizedQueryRomaji = queryRomaji.replace(/\s+/g, '');

  const phoneticName = item.phoneticName ?? '';
  const phoneticRomaji = toRomaji(phoneticName);
  const normalizedPhoneticRomaji = phoneticRomaji.replace(/\s+/g, '');

  const itemName = item.name.toLowerCase();
  const englishName = (item.englishName ?? '').toLowerCase();

  const strippedQ = stripPunctuation(q);
  const strippedItemName = stripPunctuation(itemName);
  const strippedEnglishName = stripPunctuation(englishName);

  if (
    itemName.includes(q) ||
    strippedItemName.includes(strippedQ) ||
    phoneticName.includes(queryHiragana) ||
    normalizedPhoneticRomaji.includes(normalizedQueryRomaji) ||
    englishName.includes(q) ||
    strippedEnglishName.includes(strippedQ)
  ) {
    return true;
  }

  if (
    englishName &&
    getLevenshteinDistance(englishName, q) <=
      maxDistanceForLength(englishName.length)
  ) {
    return true;
  }

  if (
    normalizedPhoneticRomaji &&
    getLevenshteinDistance(normalizedPhoneticRomaji, normalizedQueryRomaji) <=
      maxDistanceForLength(normalizedPhoneticRomaji.length)
  ) {
    return true;
  }

  if (
    phoneticName &&
    getLevenshteinDistance(phoneticName, queryHiragana) <=
      maxDistanceForLength(phoneticName.length)
  ) {
    return true;
  }

  return false;
}

export function getSearchScore(item: SearchableItem, query: string): number {
  if (!query.trim()) return 0;

  const q = query.toLowerCase();
  const queryHiragana = toHiragana(q, { passRomaji: false });
  const queryRomaji = toRomaji(queryHiragana);
  const normalizedQueryRomaji = queryRomaji.replace(/\s+/g, '');

  const itemName = item.name.toLowerCase();
  const englishName = (item.englishName ?? '').toLowerCase();
  const phoneticName = item.phoneticName ?? '';
  const phoneticRomaji = toRomaji(phoneticName);
  const normalizedPhoneticRomaji = phoneticRomaji.replace(/\s+/g, '');

  const strippedQ = stripPunctuation(q);
  const strippedItemName = stripPunctuation(itemName);
  const strippedEnglishName = stripPunctuation(englishName);

  if (itemName === q || strippedItemName === strippedQ) return 100;
  if (englishName === q || strippedEnglishName === strippedQ) return 95;

  if (itemName.startsWith(q) || strippedItemName.startsWith(strippedQ))
    return 90;
  if (englishName.startsWith(q) || strippedEnglishName.startsWith(strippedQ))
    return 85;

  if (itemName.includes(q) || strippedItemName.includes(strippedQ)) return 80;
  if (englishName.includes(q) || strippedEnglishName.includes(strippedQ))
    return 75;

  if (phoneticName === queryHiragana) return 70;
  if (normalizedPhoneticRomaji === normalizedQueryRomaji) return 70;

  if (phoneticName.startsWith(queryHiragana)) return 65;
  if (normalizedPhoneticRomaji.startsWith(normalizedQueryRomaji)) return 65;

  if (phoneticName.includes(queryHiragana)) return 60;
  if (normalizedPhoneticRomaji.includes(normalizedQueryRomaji)) return 60;

  if (englishName) {
    const dist = getLevenshteinDistance(englishName, q);
    if (dist <= maxDistanceForLength(englishName.length)) return 50 - dist;
  }

  if (normalizedPhoneticRomaji) {
    const dist = getLevenshteinDistance(
      normalizedPhoneticRomaji,
      normalizedQueryRomaji,
    );
    if (dist <= maxDistanceForLength(normalizedPhoneticRomaji.length))
      return 50 - dist;
  }

  if (phoneticName) {
    const dist = getLevenshteinDistance(phoneticName, queryHiragana);
    if (dist <= maxDistanceForLength(phoneticName.length)) return 50 - dist;
  }

  return 0;
}
