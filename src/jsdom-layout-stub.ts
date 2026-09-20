/**
 * jsdom has no layout engine, so `Range.prototype.getClientRects` does not
 * exist and every element measures 0x0. CodeMirror calls those APIs from its
 * measure pass to work out line heights and caret coordinates.
 *
 * None of the tests in this repo assert a pixel: they assert document contents,
 * selection offsets in characters, and counts of registered handlers. So the
 * measure pass is given empty rectangles rather than being allowed to throw.
 * Anything that genuinely depends on layout has to be checked in a browser, and
 * `npm start` is there for that.
 */
const emptyRect = (): DOMRect =>
  ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  }) as DOMRect;

const emptyRectList = (): DOMRectList => {
  const list = [] as unknown as DOMRectList;
  (list as unknown as { item: (i: number) => DOMRect | null }).item = () => null;
  return list;
};

const rangeProto = typeof Range === 'undefined' ? null : (Range.prototype as Partial<Range>);
if (rangeProto && typeof rangeProto.getClientRects !== 'function') {
  rangeProto.getClientRects = emptyRectList;
  rangeProto.getBoundingClientRect = emptyRect;
}
