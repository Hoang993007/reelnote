import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Block } from '../lib/types';
import { Icon } from '../shell/icons';
import { useNotebook } from './notebook-context';

/** The private annotation (violet row, lock, PRIVATE): only its author ever sees it. Saved as it is typed. */
export function Annotation({ block, focus }: { block: Block; focus: boolean }) {
  const ctx = useNotebook();
  const [value, setValue] = useState(block.annotation ?? '');
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (focus) area.current?.focus();
  }, [focus]);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const save = (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (text !== (block.annotation ?? '')) void ctx.ops.update(block.id, { annotation: text }, `ann:${block.id}`);
  };

  return <div className="ann">
    <span className="ann-l"><Icon name="lock" />Private</span>
    <textarea ref={area} className="ann-x" rows={1} value={value} placeholder="Only you see this" aria-label="Private annotation, only you see it"
      onChange={(e) => {
        setValue(e.target.value);
        if (timer.current) clearTimeout(timer.current);
        const text = e.target.value;
        timer.current = setTimeout(() => save(text), 600);
      }}
      onBlur={() => { save(value); if (!value.trim()) ctx.openAnnotation(0); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); save(value); (e.currentTarget.closest('.blk') as HTMLElement | null)?.focus(); } }} />
  </div>;
}
