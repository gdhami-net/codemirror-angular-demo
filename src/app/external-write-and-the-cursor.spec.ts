import { Component, Type, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { CodeEditor } from './code-editor';
import { ControlledCodeEditor } from './controlled-code-editor';
import { minimalChange } from './minimal-change';

const SEED = 'const a = 1;\nconst b = 2;\n';
/** Offset 10 puts the caret on the `1` of the first line, ten characters in. */
const CARET = 10;

@Component({
  selector: 'app-one-way-host',
  imports: [CodeEditor],
  template: `<app-code-editor [value]="value()" (valueChange)="value.set($event)" />`,
})
class OneWayHost {
  readonly value = signal(SEED);
  readonly editor = viewChild.required(CodeEditor);
}

@Component({
  selector: 'app-controlled-host',
  imports: [ControlledCodeEditor],
  template: `<app-controlled-code-editor [value]="value()" (valueChange)="value.set($event)" />`,
})
class ControlledHost {
  readonly value = signal(SEED);
  readonly editor = viewChild.required(ControlledCodeEditor);
}

const fixtures: Array<{ destroy(): void }> = [];

async function mount<T>(type: Type<T>) {
  await TestBed.configureTestingModule({ imports: [type] }).compileComponents();
  const fixture = TestBed.createComponent(type);
  fixtures.push(fixture);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

afterEach(() => {
  while (fixtures.length) fixtures.pop()!.destroy();
  TestBed.resetTestingModule();
});

describe('a write from outside, and where the caret ends up', () => {
  it('keeps the caret on its own character when the change is the minimal one', async () => {
    const fixture = await mount(OneWayHost);
    const host = fixture.componentInstance;
    const view = host.editor().editorView!;

    view.dispatch({ selection: { anchor: CARET } });
    expect(view.state.selection.main.head).toBe(CARET);
    expect(view.state.sliceDoc(0, CARET)).toBe('const a = ');

    host.value.set(SEED + 'const c = 3;\n');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(view.state.doc.toString()).toBe(SEED + 'const c = 3;\n');
    expect(view.state.selection.main.head).toBe(CARET);
    expect(view.state.sliceDoc(0, CARET)).toBe('const a = ');
  });

  it('moves the caret along with its text when the change is inserted before it', async () => {
    const fixture = await mount(OneWayHost);
    const host = fixture.componentInstance;
    const view = host.editor().editorView!;

    view.dispatch({ selection: { anchor: CARET } });
    const header = '// header\n';
    host.value.set(header + SEED);
    fixture.detectChanges();
    await fixture.whenStable();

    // Ten characters were inserted in front of it, so the offset moved by ten
    // and the caret is still sitting on the same `1`.
    expect(view.state.selection.main.head).toBe(CARET + header.length);
    expect(view.state.sliceDoc(0, CARET + header.length)).toBe(header + 'const a = ');
  });

  it('collapses the caret to the start when the whole document is replaced', async () => {
    const fixture = await mount(ControlledHost);
    const host = fixture.componentInstance;
    const view = host.editor().editorView!;

    view.dispatch({ selection: { anchor: CARET } });
    expect(view.state.selection.main.head).toBe(CARET);

    host.value.set(SEED + 'const c = 3;\n');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(view.state.doc.toString()).toBe(SEED + 'const c = 3;\n');
    expect(view.state.selection.main.head).toBe(0);
  });

  // The fourth cell of the post's table. It read as though all four numbers
  // came from this file, and only three did - the controlled-plus-header case
  // was assumed rather than measured. It is measured now.
  it('collapses the caret to the start for a header too, not just an append', async () => {
    const fixture = await mount(ControlledHost);
    const host = fixture.componentInstance;
    const view = host.editor().editorView!;

    view.dispatch({ selection: { anchor: CARET } });
    expect(view.state.selection.main.head).toBe(CARET);

    const header = '// header\n';
    host.value.set(header + SEED);
    fixture.detectChanges();
    await fixture.whenStable();

    // One-way moves the caret to CARET + header.length here. Replacing the
    // whole document throws the selection away wherever the edit landed.
    expect(view.state.doc.toString()).toBe(header + SEED);
    expect(view.state.selection.main.head).toBe(0);
  });
});

describe('the minimal change itself', () => {
  it('returns null when the two documents are identical', () => {
    expect(minimalChange(SEED, SEED)).toBeNull();
  });

  it('touches only the characters that differ', () => {
    expect(minimalChange(SEED, SEED + 'const c = 3;\n')).toEqual({
      from: 26,
      to: 26,
      insert: 'const c = 3;\n',
    });
    expect(minimalChange('const a = 1;\nconst b = 2;\n', 'const a = 1;\nconst b = 99;\n')).toEqual({
      from: 23,
      to: 24,
      insert: '99',
    });
  });

  it('does not cut a surrogate pair in half', () => {
    // Both strings share the leading high surrogate of the emoji, so a scan
    // over code units produces from: 6 - a range starting inside a character.
    // The resulting document is still correct (the halves re-pair); what is
    // wrong is the change, which claims to replace half a character.
    const before = 'tag: \u{1F600}';
    const after = 'tag: \u{1F680}';
    const change = minimalChange(before, after) as { from: number; to: number; insert: string };
    expect(change.from).toBe(5);
    expect(change.to).toBe(7);

    const view = new EditorView({ state: EditorState.create({ doc: before }) });
    view.dispatch({ changes: change });
    expect(view.state.doc.toString()).toBe(after);
    expect([...view.state.doc.toString()]).toHaveLength(6);
    view.destroy();
  });
});
