import {
  AfterViewInit,
  Component,
  ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';

/**
 * The same editor wired the way an `<input>` is wired: whatever value arrives
 * from outside is written over the whole document, and Angular is trusted to
 * clean the element up on destroy.
 *
 * It is in the repo because the tests measure what it does. Both of its
 * differences from CodeEditor are deliberate and both are measured:
 *
 *  - the write replaces the document from 0 to its length, so every selection
 *    inside the replaced range collapses to the start of the insertion;
 *  - there is no ngOnDestroy, so the view's global handlers and its
 *    MutationObserver survive the component.
 */
@Component({
  selector: 'app-controlled-code-editor',
  template: `<div #host class="cm-host"></div>`,
  styles: `
    .cm-host {
      border: 1px solid #5a3550;
      min-height: 150px;
    }
  `,
})
export class ControlledCodeEditor implements AfterViewInit {
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  readonly value = input('');
  readonly valueChange = output<string>();

  /**
   * Every document the update listener has seen, kept on the component
   * instance. It is here so the tests can tell whether the listener's closure
   * is still running after Angular has thrown the component away.
   */
  readonly produced: string[] = [];

  private view: EditorView | null = null;

  constructor() {
    effect(() => {
      const next = this.value();
      const view = this.view;
      if (!view) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
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
            this.produced.push(update.state.doc.toString());
            this.valueChange.emit(update.state.doc.toString());
          }),
        ],
      }),
    });
  }

  get editorView(): EditorView | null {
    return this.view;
  }
}
