import { toast } from '../lib/shell-state';

const WORDS = ['kite', 'moss', 'ruby', 'flint', 'harbor', 'maple', 'sable', 'quartz', 'ember', 'reef', 'lumen', 'cedar', 'delta', 'orbit', 'pine', 'tide',
  'amber', 'birch', 'comet', 'dune', 'fern', 'grove', 'heron', 'iris', 'juniper', 'lotus', 'meadow', 'nova', 'opal', 'pebble', 'quill', 'river'];

/** A temporary password `word-word-word-NN` (design-spec §5.8), from the browser's crypto random source. */
export function generatePassword(): string {
  const random = new Uint32Array(4);
  crypto.getRandomValues(random);
  const words = [0, 1, 2].map((i) => WORDS[random[i] % WORDS.length]);
  return `${words.join('-')}-${10 + (random[3] % 90)}`;
}

/** Copy, or (over plain HTTP, no clipboard) select the text so Ctrl C copies it. */
export function copyText(text: string, fallbackId: string): void {
  const select = () => {
    const node = document.getElementById(fallbackId);
    if (node) window.getSelection()?.selectAllChildren(node);
    toast('Selected. Press Ctrl C to copy.');
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => toast('Copied'), select);
  else select();
}
