import { Component, signal, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it } from 'vitest';
import { CodeEditor } from './code-editor';

/**
 * Simulates what a browser does when someone types into a contenteditable: it
 * edits the text node, and CodeMirror's DOM observer notices. Nothing here
 * calls dispatch, so the transaction this test observes is one the editor made
 * for itself out of a DOM change it did not perform.
 */
function typeIntoFirstLine(view: EditorView, text: string): void {
  const line = view.contentDOM.firstChild as HTMLElement;
  const textNode = line.firstChild as Text;
  textNode.nodeValue = text;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

@Component({
  selector: 'app-form-host',
  imports: [CodeEditor, ReactiveFormsModule],
  template: `
    <form>
      <app-code-editor [value]="pushedToEditor()" (valueChange)="onEditorChange($event)" />
    </form>
  `,
})
class FormHost {
  readonly source = new FormControl('const a = 1;\n', { nonNullable: true });
  readonly pushedToEditor = signal('const a = 1;\n');
  readonly editor = viewChild.required(CodeEditor);
  readonly emissions: string[] = [];

  onEditorChange(next: string): void {
    this.emissions.push(next);
    this.source.setValue(next);
    this.pushedToEditor.set(next);
  }
}

describe('a keystroke reaches the form value', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<FormHost>>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FormHost] }).compileComponents();
    fixture = TestBed.createComponent(FormHost);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('mounts the editor into the component host element', () => {
    const view = fixture.componentInstance.editor().editorView;
    expect(view).not.toBeNull();
    expect(view!.state.doc.toString()).toBe('const a = 1;\n');
    expect(fixture.componentInstance.source.value).toBe('const a = 1;\n');
  });

  it('turns an edit made in the DOM into a transaction and lands it on the form control', async () => {
    const host = fixture.componentInstance;
    const view = host.editor().editorView!;

    typeIntoFirstLine(view, 'const ab = 1;');
    await flush();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(view.state.doc.toString()).toBe('const ab = 1;\n');
    expect(host.source.value).toBe('const ab = 1;\n');
  });

  it('emits once per edit, because the value coming back is already the document', async () => {
    const host = fixture.componentInstance;
    const view = host.editor().editorView!;
    host.emissions.length = 0;

    typeIntoFirstLine(view, 'const ab = 1;');
    await flush();
    fixture.detectChanges();
    await fixture.whenStable();

    typeIntoFirstLine(view, 'const abc = 1;');
    await flush();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.emissions).toEqual(['const ab = 1;\n', 'const abc = 1;\n']);
    expect(host.source.value).toBe('const abc = 1;\n');
  });
});
