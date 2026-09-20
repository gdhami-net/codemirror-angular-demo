import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import angularCore from '../../node_modules/@angular/core/package.json';
import codemirrorState from '../../node_modules/@codemirror/state/package.json';
import codemirrorView from '../../node_modules/@codemirror/view/package.json';
import typescriptPackage from '../../node_modules/typescript/package.json';

describe('the versions every number in the post was measured on', () => {
  it('pins them', () => {
    expect(angularCore.version).toBe('22.1.7');
    expect(typescriptPackage.version).toBe('6.0.3');
    expect(codemirrorView.version).toBe('6.43.12');
    expect(codemirrorState.version).toBe('6.7.5');
  });
});

describe('writing the value back from inside the update listener', () => {
  it('recurses until the stack runs out', () => {
    let failure: unknown = null;
    let depth = 0;

    const view: EditorView = new EditorView({
      state: EditorState.create({
        doc: 'a',
        extensions: [
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            depth++;
            try {
              // The form heard about a new document, so it writes the new
              // document back. Each write is a change, so each write runs this
              // listener again.
              view.dispatch({
                changes: {
                  from: 0,
                  to: update.state.doc.length,
                  insert: update.state.doc.toString(),
                },
              });
            } catch (error) {
              failure ??= error;
            }
          }),
        ],
      }),
    });

    view.dispatch({ changes: { from: 1, insert: 'b' } });

    expect(failure).toBeInstanceOf(RangeError);
    // V8's wording. The point is the shape of the failure, not the string.
    expect((failure as RangeError).message).toMatch(/call stack/i);
    expect(depth).toBeGreaterThan(100);

    view.destroy();
  });

  it('does not recurse when the write is skipped for an unchanged document', () => {
    let depth = 0;

    const view: EditorView = new EditorView({
      state: EditorState.create({
        doc: 'a',
        extensions: [
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            depth++;
            const next = update.state.doc.toString();
            if (next === view.state.doc.toString()) return;
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
          }),
        ],
      }),
    });

    view.dispatch({ changes: { from: 1, insert: 'b' } });

    expect(depth).toBe(1);
    expect(view.state.doc.toString()).toBe('ab');

    view.destroy();
  });
});
