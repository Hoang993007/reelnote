/**
 * Text folded for matching: lower case, accents and other combining marks removed, đ as d. So "hap thu"
 * matches "hấp thụ" and "dong" matches "Đồng". The web UI folds the same way to highlight matches.
 */
const MARKS = /\p{M}+/gu;

function foldChar(char: string): string {
  return char.normalize('NFD').replace(MARKS, '').replace(/[đĐ]/g, 'd').toLowerCase();
}

export function foldText(text: string): string {
  return text.normalize('NFD').replace(MARKS, '').replace(/[đĐ]/g, 'd').toLowerCase();
}

/**
 * The folded text with, for each folded character, the index of the original character it came from, so a
 * match found in the folded text maps back to the original (a snippet keeps its accents).
 */
export function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  let index = 0;
  for (const char of text) {
    const part = foldChar(char);
    for (let i = 0; i < part.length; i++) map.push(index);
    folded += part;
    index += char.length;
  }
  map.push(index);
  return { folded, map };
}
