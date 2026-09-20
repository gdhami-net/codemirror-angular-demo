/**
 * Counts what an EditorView registers outside its own element: handlers on
 * `document`, on `window`, on the `print` media query, on every ANCESTOR
 * ELEMENT of the editor, plus observer instances that are still live.
 *
 * The ancestor handlers are easy to miss and were missed here at first. The
 * DOM observer's `listenForScroll` walks from the content element up through
 * every parent — and out of shadow roots — adding a `scroll` handler to each
 * one, so an editor inside `body > div` puts three more handlers on the page
 * than a census watching only `document` and `window` can see.
 *
 * It works by wrapping addEventListener/removeEventListener on those targets
 * and observe/disconnect on MutationObserver.prototype, so it sees
 * registrations made by code that was imported long before the census was
 * installed.
 *
 * The print handler is the awkward one. @codemirror/view 6.43.12 registers it
 * on `window.matchMedia("print")` where matchMedia exists and falls back to a
 * `beforeprint` handler on the window where it does not, so counting only the
 * window would report four registrations in a browser and five under jsdom for
 * the same editor. Counting both places gives the same five everywhere.
 *
 * This is instrumentation, not something you would ship inside a component. The
 * page uses it to show live numbers and the tests use it to assert them.
 */

export interface Census {
  /** Handlers currently registered on `document`, by event type. */
  readonly document: ReadonlyMap<string, number>;
  /** Handlers currently registered on `window`, by event type. */
  readonly window: ReadonlyMap<string, number>;
  /** Handlers on a `print` media query list, wherever the print handler went. */
  readonly printQuery: number;
  /** Observers pointed at editor content that have not been disconnected. */
  readonly liveObservers: number;
  /** Observers belonging to anything else, so the number above stays honest. */
  readonly otherObservers: number;
  /**
   * `scroll` handlers on elements ABOVE the editor — one per ancestor, so the
   * number rises with how deep the editor sits. These are the easy ones to
   * miss: they are not on `document` or `window`, and they are not inside the
   * element Angular takes away.
   */
  readonly ancestorScroll: number;
  /**
   * Live ResizeObserver and IntersectionObserver instances. jsdom implements
   * neither, so this is 0 there and non-zero in a browser: the number the
   * tests can assert and the number a reader sees are not the same, and
   * pretending otherwise is how the first version of this got it wrong.
   */
  readonly viewObservers: number;
}

export interface CensusHandle {
  read(): Census;
  /** Totals of the four types an EditorView is responsible for, plus observers. */
  editorFootprint(): number;
  restore(): void;
}

/**
 * What one EditorView registers, on @codemirror/view 6.43.12. There is no
 * single number: it depends on how deep the editor sits and on what the host
 * implements, which is the honest version of the claim.
 *
 * Always: one `selectionchange` handler on its document, `resize` and a print
 * handler on its window, one MutationObserver over its content element, and
 * one `scroll` handler per ancestor element up to and including `html`.
 *
 * In a browser, additionally: a ResizeObserver on the scroller and two
 * IntersectionObservers. jsdom implements neither, so the test environment
 * sees the smaller set. `destroy()` is what takes back all of them.
 */
export const EDITOR_FIXED_REGISTRATIONS = 4;   // selectionchange, resize, print, MutationObserver
export const EDITOR_DOCUMENT_EVENTS = ['selectionchange'] as const;
export const EDITOR_WINDOW_EVENTS = ['resize', 'scroll', 'beforeprint'] as const;

export function installCensus(): CensusHandle {
  const documentCounts = new Map<string, number>();
  const windowCounts = new Map<string, number>();
  // Observer -> the node it was pointed at, so the count can be attributed.
  // Something other than the editor observing something else must not show up
  // as an editor that failed to clean itself up.
  const liveObservers = new Map<MutationObserver, Node>();
  let printQueryCount = 0;

  const restorers: Array<() => void> = [];

  function countOn(target: EventTarget, counts: Map<string, number>): void {
    type Add = EventTarget['addEventListener'];
    type Remove = EventTarget['removeEventListener'];
    const realAdd = target.addEventListener as Add;
    const realRemove = target.removeEventListener as Remove;
    // `window` carries these as own properties in some hosts and inherits them
    // in others. Putting the original descriptor back covers both; deleting
    // blindly would strip addEventListener off a window that owned it.
    const original = {
      add: Object.getOwnPropertyDescriptor(target, 'addEventListener'),
      remove: Object.getOwnPropertyDescriptor(target, 'removeEventListener'),
    };
    target.addEventListener = function (this: EventTarget, ...args: Parameters<Add>) {
      counts.set(args[0], (counts.get(args[0]) ?? 0) + 1);
      return realAdd.apply(this, args);
    } satisfies Add;
    target.removeEventListener = function (this: EventTarget, ...args: Parameters<Remove>) {
      counts.set(args[0], (counts.get(args[0]) ?? 0) - 1);
      return realRemove.apply(this, args);
    } satisfies Remove;
    restorers.push(() => {
      restoreMember(target, 'addEventListener', original.add);
      restoreMember(target, 'removeEventListener', original.remove);
    });
  }

  countOn(document, documentCounts);
  countOn(window, windowCounts);

  // MediaQueryList is where the print handler lands in a browser. Only the
  // `print` query is counted; a component listening for a colour-scheme change
  // is not an editor that forgot to clean up.
  const mediaQueryProto: MediaQueryList | null =
    typeof MediaQueryList === 'undefined' ? null : MediaQueryList.prototype;
  if (mediaQueryProto) {
    const realAdd = mediaQueryProto.addEventListener;
    const realRemove = mediaQueryProto.removeEventListener;
    mediaQueryProto.addEventListener = function (this: MediaQueryList, ...args: never[]) {
      if (this.media === 'print') printQueryCount++;
      return (realAdd as (...a: never[]) => void).apply(this, args);
    } as MediaQueryList['addEventListener'];
    mediaQueryProto.removeEventListener = function (this: MediaQueryList, ...args: never[]) {
      if (this.media === 'print') printQueryCount--;
      return (realRemove as (...a: never[]) => void).apply(this, args);
    } as MediaQueryList['removeEventListener'];
    restorers.push(() => {
      mediaQueryProto.addEventListener = realAdd;
      mediaQueryProto.removeEventListener = realRemove;
    });
  }

  // Element listeners. `document` and `window` are wrapped above as own
  // properties, so restricting this to Element instances cannot double count.
  // Scroll handlers on elements are recorded as they happen and classified
  // when the census is READ, never when they are attached. Two reasons, both
  // learned the hard way here:
  //
  //   - At attach time the editor's own class is not on its element yet, so a
  //     "is this above a .cm-editor?" test run then finds nothing and counts
  //     zero.
  //   - At detach time Angular has already removed the component, so the same
  //     test fails again and the count goes negative.
  //
  // Recording the (element, handler) pair and asking the question once, later,
  // when the DOM has settled, is the only version that is right at both ends.
  const scrollHandlers: Array<{ target: Element; fn: unknown; owned: boolean }> = [];
  const elementProto = EventTarget.prototype;
  const realElAdd = elementProto.addEventListener;
  const realElRemove = elementProto.removeEventListener;
  elementProto.addEventListener = function (this: EventTarget, ...args: never[]) {
    if ((args[0] as unknown) === 'scroll' && this instanceof Element) {
      scrollHandlers.push({ target: this, fn: args[1], owned: false });
    }
    return (realElAdd as (...a: never[]) => void).apply(this, args);
  } as EventTarget['addEventListener'];
  elementProto.removeEventListener = function (this: EventTarget, ...args: never[]) {
    if ((args[0] as unknown) === 'scroll' && this instanceof Element) {
      const i = scrollHandlers.findIndex((h) => h.target === this && h.fn === args[1]);
      if (i !== -1) scrollHandlers.splice(i, 1);
    }
    return (realElRemove as (...a: never[]) => void).apply(this, args);
  } as EventTarget['removeEventListener'];
  restorers.push(() => {
    elementProto.addEventListener = realElAdd;
    elementProto.removeEventListener = realElRemove;
  });

  // Above the editor, not inside it: a handler on the view's own scroller goes
  // away with the element Angular removes; one on `body` does not.
  //
  // Ownership is STICKY once established, and that is the whole point. After
  // Angular removes the component without destroying the view, `body` no
  // longer contains a `.cm-editor` — but the handler the editor put on `body`
  // is still there, still firing. Re-deciding on every read would make the
  // leak disappear from the measurement at the exact moment it starts.
  const countAncestorScroll = (): number => {
    for (const h of scrollHandlers) {
      if (!h.owned && !h.target.closest('.cm-editor') && h.target.querySelector('.cm-editor')) {
        h.owned = true;
      }
    }
    return scrollHandlers.filter((h) => h.owned).length;
  };

  // ResizeObserver and IntersectionObserver. Absent in jsdom, which is exactly
  // why the browser footprint is bigger than any number a test can assert.
  let viewObservers = 0;
  for (const name of ['ResizeObserver', 'IntersectionObserver'] as const) {
    const ctor = (globalThis as Record<string, unknown>)[name] as
      | { prototype: { observe: (...a: never[]) => void; disconnect: () => void } }
      | undefined;
    if (!ctor) continue;
    const op = ctor.prototype;
    const realObs = op.observe;
    const realDis = op.disconnect;
    const seen = new WeakSet<object>();
    op.observe = function (this: object, ...args: never[]) {
      if (!seen.has(this)) { seen.add(this); viewObservers++; }
      return realObs.apply(this, args);
    };
    op.disconnect = function (this: object) {
      if (seen.has(this)) { seen.delete(this); viewObservers--; }
      return realDis.call(this);
    };
    restorers.push(() => { op.observe = realObs; op.disconnect = realDis; });
  }

  const proto = MutationObserver.prototype;
  const realObserve = proto.observe;
  const realDisconnect = proto.disconnect;
  proto.observe = function (this: MutationObserver, target: Node, options?: MutationObserverInit) {
    liveObservers.set(this, target);
    return realObserve.call(this, target, options);
  };
  proto.disconnect = function (this: MutationObserver) {
    liveObservers.delete(this);
    return realDisconnect.call(this);
  };
  restorers.push(() => {
    proto.observe = realObserve;
    proto.disconnect = realDisconnect;
  });

  return {
    read: () => ({
      document: new Map(documentCounts),
      window: new Map(windowCounts),
      printQuery: printQueryCount,
      liveObservers: countEditorObservers(liveObservers),
      otherObservers: liveObservers.size - countEditorObservers(liveObservers),
      ancestorScroll: countAncestorScroll(),
      viewObservers,
    }),
    editorFootprint() {
      const sum = (counts: Map<string, number>, types: readonly string[]) =>
        types.reduce((total, type) => total + (counts.get(type) ?? 0), 0);
      return (
        sum(documentCounts, EDITOR_DOCUMENT_EVENTS) +
        sum(windowCounts, EDITOR_WINDOW_EVENTS) +
        printQueryCount +
        countEditorObservers(liveObservers) +
        countAncestorScroll() +
        viewObservers
      );
    },
    restore() {
      while (restorers.length) restorers.pop()!();
    },
  };
}

function restoreMember(target: object, name: string, original?: PropertyDescriptor): void {
  if (original) Object.defineProperty(target, name, original);
  else delete (target as Record<string, unknown>)[name];
}

/**
 * CodeMirror's DOM observer watches the editor's own content element. Anything
 * observing a node outside a `.cm-editor` belongs to someone else — Angular's
 * test harness makes one of its own, and counting it would turn a clean
 * teardown into a phantom leak.
 */
function countEditorObservers(observers: ReadonlyMap<MutationObserver, Node>): number {
  let count = 0;
  for (const target of observers.values()) {
    const element =
      target.nodeType === Node.ELEMENT_NODE ? (target as Element) : target.parentElement;
    if (element?.closest('.cm-editor')) count++;
  }
  return count;
}
