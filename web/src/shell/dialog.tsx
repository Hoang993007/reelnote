import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';

/**
 * A modal dialog (design-spec §6.4): title in the reading face, a close button, Esc or a backdrop click closes it,
 * focus stays inside and goes back where it was on close.
 */
export function Dialog({ title, onClose, children, className = '', wide, dark, labelledBy, onKey: onDialogKey }: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  wide?: boolean;
  dark?: boolean;
  labelledBy?: string;
  /** Keys inside the dialog, before Esc and Tab are handled (the image viewer's tools). */
  onKey?: (event: React.KeyboardEvent) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = document.activeElement;
    const el = box.current;
    const first = el?.querySelector<HTMLElement>('[autofocus], input, textarea, select, button:not(.dlg-x)') ?? el;
    first?.focus({ preventScroll: true });
    return () => {
      if (before instanceof HTMLElement && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, []);

  const onKey = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    onDialogKey?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close.current();
      return;
    }
    if (event.key !== 'Tab' || !box.current) return;
    const focusable = [...box.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), textarea, select, [tabindex="0"]')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const headingId = labelledBy ?? 'dlg-title';
  return createPortal(<div className={`modal-back${dark ? ' modal-dark' : ''}`} onPointerDown={(e) => { if (e.target === e.currentTarget) close.current(); }}>
    <div ref={box} className={`${wide ? '' : 'dialog '}${className}`} role="dialog" aria-modal="true" aria-labelledby={title ? headingId : undefined} tabIndex={-1} onKeyDown={onKey}>
      {title ? <header className="dlg-head"><h2 id={headingId}>{title}</h2>
        <button type="button" className="ibtn dlg-x" onClick={() => close.current()} aria-label="Close">
          <Icon name="close" />
        </button></header> : null}
      {children}
    </div>
  </div>, document.body);
}
