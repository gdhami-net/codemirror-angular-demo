/**
 * Counts the things an EditorView registers outside its own element: handlers
 * on `document`, on `window` and on the `print` media query, and
 * MutationObserver instances that are observing and have not been disconnected.
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
}

export interface CensusHandle {
  read(): Census;
  /** Totals of the four types an EditorView is responsible for, plus observers. */
  editorFootprint(): number;
  restore(): void;
}

/**
 * The global registrations a single EditorView makes, measured on
 * @codemirror/view 6.43.12: one `selectionchange` handler on the document it
 * lives in, `resize` and `scroll` on the window, one print handler, and one
 * MutationObserver over its own content element. Five.
 */
export const EDITOR_FOOTPRINT_PER_VIEW = 5;
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
    }),
    editorFootprint() {
      const sum = (counts: Map<string, number>, types: readonly string[]) =>
        types.reduce((total, type) => total + (counts.get(type) ?? 0), 0);
      return (
        sum(documentCounts, EDITOR_DOCUMENT_EVENTS) +
        sum(windowCounts, EDITOR_WINDOW_EVENTS) +
        printQueryCount +
        countEditorObservers(liveObservers)
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
