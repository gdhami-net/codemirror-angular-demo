import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { minimalChange } from './minimal-change';

/**
 * A CodeMirror 6 editor hosted by an Angular component.
 *
 * The document lives in the EditorView's state. This component never treats its
 * own `value` input as the truth; it reports what the editor produced, and it
 * writes into the editor only when the incoming value genuinely differs from
 * the document the editor already holds.
 */
@Component({
  selector: 'app-code-editor',
  template: `<div #host class="cm-host"></div>`,
  styles: `
    .cm-host {
      border: 1px solid #2b3a52;
      min-height: 150px;
    }
  `,
})
export class CodeEditor implements AfterViewInit, OnDestroy {
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  /** What the form holds. Seeds the document, then feeds later external writes. */
  readonly value = input('');

  /** Every document the editor produces, in the order it produces them. */
  readonly valueChange = output<string>();

  private view: EditorView | null = null;

  constructor() {
    effect(() => {
      const next = this.value();
      const view = this.view;
      // Before ngAfterViewInit there is no view yet; EditorState.create below
      // seeds the document from the same signal.
      if (!view) return;
      const change = minimalChange(view.state.doc.toString(), next);
      // Nothing to do, so nothing is dispatched, so no update listener runs,
      // so the value the editor just emitted does not come back round again.
      if (!change) return;
      view.dispatch({ changes: change });
    });
  }

  ngAfterViewInit(): void {
    this.view = new EditorView({
      parent: this.host().nativeElement,
      state: EditorState.create({
        doc: this.value(),
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          javascript(),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            this.valueChange.emit(update.state.doc.toString());
          }),
        ],
      }),
    });
  }

  ngOnDestroy(): void {
    this.view?.destroy();
    this.view = null;
  }

  /** Test and page access to the live view. Null before mount and after destroy. */
  get editorView(): EditorView | null {
    return this.view;
  }
}
