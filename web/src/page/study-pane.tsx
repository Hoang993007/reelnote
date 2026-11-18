import { useSyncExternalStore } from 'react';
import { fmtTime } from '../lib/format';
import type { PageVideo } from '../lib/types';
import { Icon } from '../shell/icons';
import { ProgressMark } from '../shell/marks';
import { Player, type Tick } from './player';
import { usePlayer } from './player-controller';
import { Transcript, type QuoteSource } from './transcript';
import type { NotebookOps } from './notebook-ops';

const watchState = (v: PageVideo) => (v.completed ? 'full' : v.furthestSec > 5 ? 'half' : 'none');

/** The study pane (design-spec §5.4): video tabs, the player, the three capture actions, the transcript. */
export function StudyPane({ videos, video, ticks, ops, quoteRef, onSelect, onLocate }: {
  videos: PageVideo[];
  video: PageVideo;
  ticks: Tick[];
  ops: NotebookOps;
  quoteRef: { current: () => QuoteSource | null };
  onSelect: (videoId: number) => void;
  onLocate: () => void;
}) {
  const player = usePlayer();
  const t = useSyncExternalStore(player.state.subscribe, () => Math.floor(player.state.get().t));
  // The actions never take focus from the note being written (design-spec §6.2).
  const keep = (event: React.MouseEvent) => event.preventDefault();
  return <>
    {videos.length > 1 ? <div className="vtabs" role="tablist" aria-label="Videos in this page">
      {videos.map((v) => <button key={v.id} type="button" role="tab" className={`vtab${v.id === video.id ? ' is-on' : ''}`} aria-selected={v.id === video.id}
        onClick={() => onSelect(v.id)}>
        <ProgressMark state={watchState(v)} /><span>{v.title}</span>{v.durationSec ? <span className="muted mono">{fmtTime(v.durationSec)}</span> : null}
      </button>)}
    </div> : null}
    <Player key={video.id} video={video} ticks={ticks} onLocate={onLocate} />
    <div className="study-actions">
      <button type="button" className="btn btn-primary" onMouseDown={keep} onClick={() => void ops.noteAt()}>
        <Icon name="note" /><span>Note at <span className="mono">{fmtTime(t)}</span></span><kbd>N</kbd></button>
      <button type="button" className="btn" onMouseDown={keep} onClick={() => void ops.capture()}><Icon name="camera" /><span>Capture frame</span><kbd>F</kbd></button>
      <button type="button" className="btn" onMouseDown={keep} onClick={() => void ops.quote()}><Icon name="quote" /><span>Quote line</span><kbd>Q</kbd></button>
    </div>
    <Transcript key={`tr${video.id}`} videoId={video.id} quoteRef={quoteRef} onQuote={(source) => void ops.quote(source)}
      onSaveNote={(body, t) => void ops.saveNote(body, t)} />
  </>;
}
