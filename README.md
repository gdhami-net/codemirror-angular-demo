# codemirror-angular-demo

Companion repo for the post **"CodeMirror owns the document, not your form"**
([gdhami.net](https://gdhami.net) — link added when the post is live).

CodeMirror 6 has no official Angular package. It keeps its own copy of the
document in an `EditorState`, applies every change as a transaction, and holds
handlers on `document` and `window` plus a `MutationObserver` over its content
element for as long as the view exists.

This repo measures three things about hosting one inside an Angular component:
where a keystroke goes, what a write from outside does to the caret, and what is
left registered after the component is gone.

## Versions

Every number below was produced by `npm run check` on:

| package | version |
|---|---|
| `@codemirror/state` | 6.7.5 |
| `@codemirror/view` | 6.43.12 |
| `@codemirror/commands` | 6.11.1 |
| `@codemirror/lang-javascript` | 6.2.5 |
| `@angular/core` | 22.1.7 |
| `typescript` | 6.0.3 |
| `vitest` | 4.1.11 (jsdom 28.1.0) |

`src/app/the-loop.spec.ts` asserts the first four of those against the installed
`package.json` files, so a version drift fails the suite rather than quietly
changing a number in the post.

## What it proves

Two components host the same editor.

`src/app/code-editor.ts` is the one-way version. The update listener reports
what the editor produced; incoming values are turned into the smallest change
that would produce them, and an incoming value identical to the current document
produces no change at all. `ngOnDestroy` calls `view.destroy()`.

`src/app/controlled-code-editor.ts` is the version wired the way an `<input>` is
wired: every incoming value replaces the document from 0 to its length, and there
is no `ngOnDestroy`.

| | one-way + destroy | replace the whole document, no teardown |
|---|---|---|
| caret at offset 10, a line appended from outside | stays at 10 | **collapses to 0** |
| caret at offset 10, a header inserted from outside | moves to 20, same character | **collapses to 0** |
| global handlers + observers while mounted | 5 | 5 |
| the same, after Angular removes the component | **0** | **5** |
| a DOM change in the detached tree afterwards | ignored | **becomes a transaction** |

The five are one `selectionchange` handler on `document`, `resize`, `scroll` and
`beforeprint` on `window`, and one `MutationObserver` on the editor's content
element. `src/app/global-census.ts` counts them by wrapping
`addEventListener`/`removeEventListener` on both targets and `observe`/`disconnect`
on `MutationObserver.prototype`. Observers pointed at a node outside a
`.cm-editor` are excluded, so an observer belonging to the test harness cannot
be mistaken for a leak.

One result worth stating on its own: Angular is not completely passive here.
`output()` refuses to emit once its component is destroyed and warns `NG0953`
instead, so the parent's handler is not called. Everything before the emit still
ran — the view read its DOM, built a transaction, moved to a new state, and the
listener's closure wrote into the destroyed component's own field.

## The tests

`npm run check` is `ng test`. Seventeen tests across four files:

- `src/app/keystroke-reaches-the-form.spec.ts` — an edit made the way a browser
  makes one (change the text node inside the contenteditable, do not call
  `dispatch`) becomes a transaction, lands on a `FormControl`, and emits exactly
  once per edit.
- `src/app/external-write-and-the-cursor.spec.ts` — caret offsets before and
  after a write from outside, for both components; plus the minimal-change
  helper, including the case where a naive prefix scan would cut a surrogate
  pair in half.
- `src/app/teardown.spec.ts` — the census across mount, unmount and destroy, and
  what an undestroyed view does with a mutation in its own detached tree.
- `src/app/the-loop.spec.ts` — the version pins, and what happens when the value
  is written back synchronously from inside the update listener.

Nothing sleeps and nothing polls. Where a wait is needed it is one macrotask, to
let `MutationObserver` records be delivered; everywhere else the tests read state
directly.

`src/jsdom-layout-stub.ts` gives `Range.prototype.getClientRects` an empty result
because jsdom has no layout engine and CodeMirror's measure pass calls it. No
test asserts a pixel; they assert document contents, caret offsets in characters,
and counts. Anything that depends on real layout has to be looked at in a
browser, which is what `npm start` is for.

## Run it

```
npm install
npm run check      # the tests
npm start          # the page, http://localhost:4200
```

The page mounts both editors side by side. Put the caret in the middle of either
one, press "append a line from outside", and watch where the caret ends up. Then
press "unmount both editors" and "re-read the counts".

## License

MIT
