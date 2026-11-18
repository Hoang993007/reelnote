import type { Source } from '../lib/types';
import { SourceAvatar } from '../shell/marks';
import type { Access } from './access';

/** One row per source: Open (read) and Edit (write) ticks. */
export function SourceChecks({ sources, access, label, onToggle }: {
  sources: Source[];
  access: Access;
  label?: string;
  onToggle: (source: Source, column: 'read' | 'write', on: boolean) => void;
}) {
  const who = label ?? 'They';
  return <div className="ppl-srcs">
    <div className="ppl-src ppl-src-head muted"><span>Open</span><span /><span>Source</span><span /><span>Edit</span></div>
    {sources.map((s) => <div key={s.id} className="ppl-src">
      <input type="checkbox" checked={access.read.includes(s.id)} aria-label={`${who} can open ${s.name}`} onChange={(e) => onToggle(s, 'read', e.target.checked)} />
      <SourceAvatar source={s} size="xs" /><span>{s.name}</span><span className="muted">{s.pageCount} pages</span>
      <input type="checkbox" checked={access.write.includes(s.id)} aria-label={`${who} can edit ${s.name}`} title="Change its pages, videos and every note on it"
        onChange={(e) => onToggle(s, 'write', e.target.checked)} />
    </div>)}
  </div>;
}
