import type { KeyboardEvent, PointerEvent } from 'react';

const MIN = 26;
const MAX = 64;
const clamp = (value: number) => Math.max(MIN, Math.min(MAX, value));

/** Between the study pane and the notebook: drag, or focus it and press ← →. The ratio is remembered per person. */
export function Splitter({ value, onChange }: { value: number; onChange: (percent: number) => void }) {
  const down = (event: PointerEvent<HTMLDivElement>) => {
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const box = handle.parentElement!.getBoundingClientRect();
    const move = (ev: globalThis.PointerEvent) => onChange(Math.round(clamp(((ev.clientX - box.left) / box.width) * 100)));
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', () => handle.removeEventListener('pointermove', move), { once: true });
  };
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    onChange(clamp(value + (event.key === 'ArrowLeft' ? -2 : 2)));
  };
  return <div className="splitter" role="separator" aria-orientation="vertical" aria-label="Resize video and notes" tabIndex={0}
    aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={value} onPointerDown={down} onKeyDown={key} />;
}
