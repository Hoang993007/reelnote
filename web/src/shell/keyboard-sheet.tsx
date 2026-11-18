import { overlay } from '../lib/shell-state';
import { Dialog } from './dialog';

const KEYS: Array<[string, Array<[string, string]>]> = [
  ['Anywhere', [['Ctrl K', 'Search notes, pages and sources'], ['/', 'Search inside this source'], ['G then H', 'Home'], ['G then S', 'Switch source'],
    ['G then I', 'Insights of this source'], ['G then P', 'Pages of this source'], ['Alt 1–9', 'Back to the page you were reading in source 1–9'], ['?', 'This sheet']]],
  ['Video', [['Space', 'Play or pause'], ['← →', 'Back or forward 5 s'], ['Shift ← →', 'Back or forward 30 s'], ['< >', 'Slower or faster'], ['M', 'Mute or unmute'],
    ['Double-click', 'Fullscreen (the video)'], ['N', 'New note at the current second'],
    ['F', 'Put the current frame into a note'], ['Q', 'Quote the selected transcript text, or the current line'], ['\\', 'Focus writing: shrink the video']]],
  ['Notes', [['J K', 'Next or previous block'], ['Enter', 'Edit the block'], ['Esc', 'Stop editing'], ['/', 'Block type (in an empty block)'],
    ['I', 'Mark as insight'], ['T', 'Tag'], ['A', 'Private annotation'], ['P', 'Pin'], ['O', 'Question open or answered'],
    ['Delete', 'Delete block (Undo in the toast)'], ['Ctrl Enter', 'Play or pause while typing'], ['Ctrl [ ]', 'Seek 5 s while typing']]],
  ['Pages', [['[ ]', 'Previous or next page'], ['Ctrl \\', 'Show or hide the page list'], ['J K', 'Move between rows (source)'], ['Alt ↑ ↓', 'Move a page in the source list']]],
];

export function KeyboardSheet() {
  return <Dialog title="Keyboard" onClose={() => overlay.set(null)} className="keys-sheet">
    <p className="muted keys-note">Single-letter keys work when you are not typing, so they never fight Unikey or EVKey.
      They follow the physical key, so Telex or VNI mode does not matter.</p>
    <div className="keys-grid">
      {KEYS.map(([group, rows]) => <section key={group}>
        <h3 className="label">{group}</h3>
        <dl>{rows.map(([key, what]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{what}</dd></div>)}</dl>
      </section>)}
    </div>
  </Dialog>;
}
