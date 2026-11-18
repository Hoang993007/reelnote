import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { keys } from '../lib/data';
import { mutate } from '../lib/resource';
import { failureText, save } from '../lib/saves';
import { useSession } from '../lib/session';
import { toast } from '../lib/shell-state';
import type { Block, BlockImage, MarkupColor, MarkupShape } from '../lib/types';
import { Dialog } from '../shell/dialog';
import { Icon, type IconName } from '../shell/icons';
import { cropBoxStyle, cropOf, imageLabel, imageUrl, MarkupLayer, type Crop } from './figure';
import { drawRect, isTiny, toImagePoint } from './viewer-math';

type Tool = 'move' | 'rect' | 'line' | 'crop';
type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target' | 'preventDefault'>;
const TOOLS: Array<[Tool, string, string, IconName]> = [['move', 'Move', 'V', 'pointer'], ['rect', 'Rectangle', 'R', 'rect'], ['line', 'Line', 'L', 'line'], ['crop', 'Crop', 'C', 'crop']];
const COLORS: Array<[MarkupColor, string]> = [['orange', 'Orange'], ['blue', 'Blue'], ['white', 'White']];
const TOOL_KEYS: Record<string, Tool> = { KeyV: 'move', KeyR: 'rect', KeyL: 'line', KeyC: 'crop' };

/**
 * The image viewer (design-spec §5.6): move, rectangle, line and crop tools in frame coordinates, three colours,
 * undo, reset crop, zoom 100–400% and a note. Crop and shapes are stored beside the image, never baked in, so
 * the original frame is always kept. A friend opening the owner's image gets zoom only.
 */
export function ImageViewer({ block, imageId, pageTitle, editable, onClose }: { block: Block; imageId: number; pageTitle: string; editable: boolean; onClose: () => void }) {
  const { ownerName } = useSession();
  const image = block.images.find((i) => i.id === imageId);
  const [tool, setTool] = useState<Tool>('move');
  const [color, setColor] = useState<MarkupColor>('orange');
  const [zoom, setZoom] = useState(1);
  const [draft, setDraft] = useState<MarkupShape | null>(null);
  const [cropDraft, setCropDraft] = useState<Crop | null>(null);
  const [undo, setUndo] = useState<Array<{ markup: MarkupShape[] | null; crop: Crop | null }>>([]);
  const [note, setNote] = useState(image?.caption ?? '');
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<{ w: number; h: number } | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyRef = useRef<((event: KeyLike) => void) | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Keys while focus is outside the dialog (it can land on the page after a drag on the picture).
  useEffect(() => {
    const listen = (event: KeyboardEvent) => {
      if ((event.target as Element | null)?.closest?.('.viewer')) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      keyRef.current?.(event);
    };
    window.addEventListener('keydown', listen, true);
    return () => window.removeEventListener('keydown', listen, true);
  }, []);

  const patchImage = (patch: Partial<BlockImage>) => mutate<Block[]>(keys.blocks(block.pageId ?? 0), (list) => list.map((b) => (b.id === block.id
    ? { ...b, images: b.images.map((i) => (i.id === imageId ? { ...i, ...patch } : i)) } : b)));
  const fail = (error: unknown) => toast(failureText(error, ownerName));

  const saveNote = (text: string) => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = null;
    if (!editable || text === (image?.caption ?? '')) return;
    patchImage({ caption: text || null });
    save('PATCH', `/block-images/${imageId}/note`, { note: text }, `note:${imageId}`).catch(fail);
  };
  useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current); }, []);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setStageSize({ w: el.clientWidth - 32, h: el.clientHeight - 32 }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!image) return null;
  const crop = cropOf(image);
  const markup = image.markup ?? [];

  const setMarkup = (next: MarkupShape[]) => {
    setUndo((stack) => [...stack, { markup: image.markup, crop }]);
    patchImage({ markup: next.length ? next : null });
    save('PATCH', `/block-images/${imageId}/markup`, { markup: next.length ? next : null }).catch(fail);
  };
  const setCrop = (next: Crop | null, remember = true) => {
    if (remember) setUndo((stack) => [...stack, { markup: image.markup, crop }]);
    patchImage(next ? { cropX: next.x, cropY: next.y, cropW: next.w, cropH: next.h } : { cropX: null, cropY: null, cropW: null, cropH: null });
    save('PATCH', `/block-images/${imageId}/crop`, next ?? { reset: true }).catch(fail);
  };
  const undoLast = () => {
    const last = undo[undo.length - 1];
    if (!last) return;
    setUndo((stack) => stack.slice(0, -1));
    patchImage({ markup: last.markup });
    save('PATCH', `/block-images/${imageId}/markup`, { markup: last.markup }).catch(fail);
    if (JSON.stringify(last.crop) !== JSON.stringify(crop)) setCrop(last.crop, false);
  };

  const cropping = tool === 'crop';
  const shown = cropping ? null : crop;
  const box = cropBoxStyle(shown, natural);
  // Fit: the whole picture inside the stage; zoom multiplies that width.
  const ratio = Number(box.box.aspectRatio) || 16 / 9;
  const fitWidth = stageSize ? Math.max(120, Math.min(stageSize.w, stageSize.h * ratio)) : null;

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (!editable || tool === 'move') return;
    const surface = event.currentTarget;
    surface.setPointerCapture(event.pointerId);
    const rect = surface.getBoundingClientRect();
    const start = toImagePoint(event, rect, shown);
    const size = { w: rect.width / (shown?.w ?? 1), h: rect.height / (shown?.h ?? 1) };
    const move = (ev: globalThis.PointerEvent) => {
      const at = toImagePoint(ev, rect, shown);
      if (cropping) setCropDraft(drawRect(start, at));
      else setDraft({ kind: tool === 'line' ? 'line' : 'rect', color, x1: start.x, y1: start.y, x2: at.x, y2: at.y });
    };
    const up = (ev: globalThis.PointerEvent) => {
      surface.removeEventListener('pointermove', move);
      const at = toImagePoint(ev, rect, shown);
      setDraft(null);
      setCropDraft(null);
      if (cropping) {
        const next = drawRect(start, at);
        if (next.w * size.w > 8 && next.h * size.h > 8) {
          setCrop(next);
          setTool('move');
          toast('Cropped. The original frame is kept.');
        }
        return;
      }
      const shape: MarkupShape = { kind: tool === 'line' ? 'line' : 'rect', color, x1: start.x, y1: start.y, x2: at.x, y2: at.y };
      if (!isTiny(shape, size)) setMarkup([...markup, shape]);
    };
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', up, { once: true });
  };

  // Move: dragging pans a zoomed picture.
  const pan = (event: PointerEvent<HTMLDivElement>) => {
    if (tool !== 'move' || zoom === 1 || !stage.current) return;
    const el = stage.current;
    const start = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop };
    const move = (ev: globalThis.PointerEvent) => { el.scrollLeft = start.left - (ev.clientX - start.x); el.scrollTop = start.top - (ev.clientY - start.y); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
  };

  const onKey = (event: KeyLike) => {
    if ((event.target as HTMLElement).tagName === 'TEXTAREA') return;
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') { event.preventDefault(); undoLast(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (editable && TOOL_KEYS[event.code]) { event.preventDefault(); setTool(TOOL_KEYS[event.code]); return; }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom((z) => Math.min(4, z + 0.5)); }
    else if (event.key === '-') { event.preventDefault(); setZoom((z) => Math.max(1, z - 0.5)); }
    else if (event.key === '0') { event.preventDefault(); setZoom(1); }
  };

  keyRef.current = onKey;
  const shownCrop = cropDraft ?? crop;
  return <Dialog dark wide onClose={() => { saveNote(note); onClose(); }} className="viewer" labelledBy="v-title" onKey={onKey}>
    <div className="viewer-in">
      <header className="v-head">
        <div id="v-title"><strong className="mono">{imageLabel(image)}</strong><span className="muted"> · {pageTitle}</span></div>
        <button type="button" className="ibtn" aria-label="Close (Esc)" onClick={() => { saveNote(note); onClose(); }}><Icon name="close" /></button>
      </header>
      <div className="v-tools" role="toolbar" aria-label="Image tools">
        {editable ? <>
          {TOOLS.map(([key, label, hint, icon]) => <button key={key} type="button" className={`vt${tool === key ? ' is-on' : ''}`} aria-pressed={tool === key}
            title={`${label} (${hint})`} onClick={() => setTool(key)}><Icon name={icon} /><span>{label}</span></button>)}
          <span className="vt-sep" />
          {COLORS.map(([key, label]) => <button key={key} type="button" className={`swatch mk-sw-${key}${color === key ? ' is-on' : ''}`} aria-label={`Colour ${label}`}
            aria-pressed={color === key} onClick={() => setColor(key)} />)}
          <span className="vt-sep" />
          <button type="button" className="vt" title="Undo (Ctrl Z)" disabled={!undo.length} onClick={undoLast}><Icon name="undo" /><span>Undo</span></button>
          {crop ? <button type="button" className="vt" onClick={() => setCrop(null)}>Reset crop</button> : null}
        </> : null}
        <span className="fill" />
        <button type="button" className="vt" aria-label="Zoom out (-)" title="Zoom out (-)" onClick={() => setZoom((z) => Math.max(1, z - 0.5))}><Icon name="zoomout" /></button>
        <span className="mono vt-zoom" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" className="vt" aria-label="Zoom in (+)" title="Zoom in (+)" onClick={() => setZoom((z) => Math.min(4, z + 0.5))}><Icon name="zoomin" /></button>
        <button type="button" className="vt" title="Fit (0)" onClick={() => setZoom(1)}>Fit</button>
      </div>
      <div className="v-stage" ref={stage} onPointerDown={pan}>
        <div className={`v-canvas tool-${tool}`} style={{ width: fitWidth ? `${fitWidth * zoom}px` : `${zoom * 100}%` }}>
          <div className="crop-box v-box" style={box.box} onPointerDown={down}>
            <img src={imageUrl(image)} alt={imageLabel(image)} draggable={false} style={box.img}
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
            {cropping ? <CropShade crop={shownCrop} /> : <MarkupLayer shapes={markup} crop={crop} draft={draft} />}
          </div>
        </div>
      </div>
      <footer className="v-foot">
        <label htmlFor="v-note" className="label">Note on this image</label>
        <textarea id="v-note" rows={2} readOnly={!editable} placeholder={editable ? 'What should you notice here?' : ''} value={note}
          onChange={(e) => {
            setNote(e.target.value);
            if (noteTimer.current) clearTimeout(noteTimer.current);
            const text = e.target.value;
            noteTimer.current = setTimeout(() => saveNote(text), 800);
          }} onBlur={() => saveNote(note)} />
        <button type="button" className="btn btn-primary" onClick={() => { saveNote(note); onClose(); }}>Done</button>
      </footer>
    </div>
  </Dialog>;
}

/** While cropping: the whole frame, dimmed outside the crop. */
function CropShade({ crop }: { crop: Crop | null }) {
  if (!crop) return null;
  const { x, y, w, h } = crop;
  return <svg className="markup-layer" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
    <path className="crop-dim" fillRule="evenodd" d={`M0 0H1V1H0Z M${x} ${y}v${h}h${w}v${-h}Z`} />
    <rect className="crop-edge" x={x} y={y} width={w} height={h} />
  </svg>;
}
