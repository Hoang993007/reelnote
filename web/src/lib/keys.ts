import { useEffect, useRef } from 'react';
import { menuState } from '../shell/menu';
import { overlay } from './shell-state';

/**
 * The keyboard model (design-spec §8). Single-letter keys fire only outside text fields and match
 * `event.code` (the physical key), so Vietnamese IMEs (Unikey, EVKey; Telex or VNI) never change what a key
 * does. Screens register a handler; the newest one mounted sees a key first and returns true when it used it.
 */
export type KeyHandler = (event: KeyboardEvent, typing: boolean) => boolean | void;

const handlers: Array<{ current: KeyHandler }> = [];

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/** `target.closest(selector)`, for an event target that may not be an element (window, document). */
export function closestTo(target: EventTarget | null, selector: string): Element | null {
  return target instanceof Element ? target.closest(selector) : null;
}

/** Registers a screen's key handler while the component is mounted. */
export function useKeys(handler: KeyHandler): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const entry = { get current() { return ref.current; } };
    handlers.push(entry);
    return () => {
      const i = handlers.indexOf(entry);
      if (i >= 0) handlers.splice(i, 1);
    };
  }, []);
}

/** Overlays (menus, dialogs, search) handle their own keys; the screens wait. */
export function overlayOpen(): boolean {
  return !!menuState.get() || !!overlay.get() || !!document.querySelector('.modal-back');
}

/** Runs the registered handlers, newest first, until one takes the key. */
export function dispatchKey(event: KeyboardEvent): boolean {
  const typing = isTyping(event.target);
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i].current(event, typing)) {
      event.preventDefault();
      return true;
    }
  }
  return false;
}
