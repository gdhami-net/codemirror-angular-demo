import type { ChangeSpec } from '@codemirror/state';

const HIGH_SURROGATE_START = 0xd800;

/**
 * The smallest single replacement that turns `current` into `next`: whatever
 * the two strings already share at the front and at the back is left alone.
 *
 * Returning `null` for an identical document is the important half. A dispatch
 * with an empty change set still runs every update listener on the view, and
 * the update listener is the thing that pushes the value back out to the form,
 * so an editor that dispatches on every incoming value talks to itself.
 *
 * Both scans step over whole code points rather than UTF-16 code units, so the
 * change never starts or ends in the middle of a surrogate pair. Without that,
 * changing one emoji into another produces a replacement range that splits a
 * pair and a document with a lone surrogate in it.
 */
export function minimalChange(current: string, next: string): ChangeSpec | null {
  if (current === next) return null;

  const shortest = Math.min(current.length, next.length);

  let from = 0;
  while (from < shortest) {
    const point = current.codePointAt(from)!;
    if (point !== next.codePointAt(from)) break;
    from += point > 0xffff ? 2 : 1;
  }

  let endCurrent = current.length;
  let endNext = next.length;
  while (endCurrent > from && endNext > from) {
    const a = codePointBefore(current, endCurrent);
    const b = codePointBefore(next, endNext);
    if (a.point !== b.point) break;
    endCurrent = a.start;
    endNext = b.start;
  }

  return { from, to: endCurrent, insert: next.slice(from, endNext) };
}

function codePointBefore(text: string, end: number): { point: number; start: number } {
  const start = end - 1;
  const unit = text.charCodeAt(start);
  if (unit >= 0xdc00 && unit <= 0xdfff && start > 0) {
    const lead = text.charCodeAt(start - 1);
    if (lead >= HIGH_SURROGATE_START && lead <= 0xdbff) {
      return { point: text.codePointAt(start - 1)!, start: start - 1 };
    }
  }
  return { point: unit, start };
}
