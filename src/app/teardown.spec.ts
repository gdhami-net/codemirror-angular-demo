import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeEditor } from './code-editor';
import { ControlledCodeEditor } from './controlled-code-editor';
import { CensusHandle, EDITOR_FOOTPRINT_PER_VIEW, installCensus } from './global-census';

const SEED = 'const a = 1;\n';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

@Component({
  selector: 'app-switch-host',
  imports: [CodeEditor, ControlledCodeEditor],
  template: `
    @if (showOneWay()) {
      <app-code-editor [value]="value()" (valueChange)="value.set($event)" />
    }
    @if (showControlled()) {
      <app-controlled-code-editor [value]="value()" (valueChange)="onControlled($event)" />
    }
  `,
})
class SwitchHost {
  readonly showOneWay = signal(false);
  readonly showControlled = signal(false);
  readonly value = signal(SEED);
  readonly oneWay = viewChild(CodeEditor);
  readonly controlled = viewChild(ControlledCodeEditor);
  readonly handledAfterUnmount: string[] = [];
  controlledIsGone = false;

  onControlled(next: string): void {
    if (this.controlledIsGone) this.handledAfterUnmount.push(next);
    this.value.set(next);
  }
}

function mutateFirstLine(view: EditorView, text: string): void {
  const line = view.contentDOM.firstChild as HTMLElement;
  (line.firstChild as Text).nodeValue = text;
}

describe('what the component leaves behind', () => {
  let census: CensusHandle;
  const orphans: EditorView[] = [];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SwitchHost] }).compileComponents();
    census = installCensus();
  });

  afterEach(() => {
    // A view left alive by a failing assertion would go on registering handlers
    // and poison the next test's count, which is exactly the post's point and
    // is not something to discover twice.
    while (orphans.length) orphans.pop()!.destroy();
    census.restore();
    TestBed.resetTestingModule();
  });

  it('registers four handlers outside its element and one observer, per mounted editor', async () => {
    const fixture = TestBed.createComponent(SwitchHost);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(census.editorFootprint()).toBe(0);

    fixture.componentInstance.showOneWay.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const reading = census.read();
    expect(reading.document.get('selectionchange')).toBe(1);
    expect(reading.window.get('resize')).toBe(1);
    expect(reading.window.get('scroll')).toBe(1);
    // The print handler goes on a `print` media query where matchMedia exists
    // and on the window itself where it does not. One of them, either way.
    expect((reading.window.get('beforeprint') ?? 0) + reading.printQuery).toBe(1);
    expect(reading.liveObservers).toBe(1);
    expect(census.editorFootprint()).toBe(EDITOR_FOOTPRINT_PER_VIEW);

    fixture.destroy();
  });

  it('gives every one of them back when ngOnDestroy calls view.destroy()', async () => {
    const fixture = TestBed.createComponent(SwitchHost);
    fixture.componentInstance.showOneWay.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(census.editorFootprint()).toBe(EDITOR_FOOTPRINT_PER_VIEW);

    fixture.componentInstance.showOneWay.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    const reading = census.read();
    expect(reading.document.get('selectionchange')).toBe(0);
    expect(reading.window.get('resize')).toBe(0);
    expect(reading.window.get('scroll')).toBe(0);
    expect((reading.window.get('beforeprint') ?? 0) + reading.printQuery).toBe(0);
    expect(reading.liveObservers).toBe(0);
    expect(census.editorFootprint()).toBe(0);

    fixture.destroy();
  });

  it('keeps every one of them when the component goes away without destroying the view', async () => {
    const fixture = TestBed.createComponent(SwitchHost);
    const host = fixture.componentInstance;
    host.showControlled.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(census.editorFootprint()).toBe(EDITOR_FOOTPRINT_PER_VIEW);

    const orphan = host.controlled()!.editorView!;
    orphans.push(orphan);
    host.showControlled.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    // Angular took the element out of the document. The editor did not notice.
    expect(orphan.dom.isConnected).toBe(false);
    expect(census.editorFootprint()).toBe(EDITOR_FOOTPRINT_PER_VIEW);

    orphans.pop();
    orphan.destroy();
    expect(census.editorFootprint()).toBe(0);
    fixture.destroy();
  });

  it('still builds a transaction and still runs the dead component code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fixture = TestBed.createComponent(SwitchHost);
    const host = fixture.componentInstance;
    host.showControlled.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const editorComponent = host.controlled()!;
    const orphan = editorComponent.editorView!;
    orphans.push(orphan);
    host.showControlled.set(false);
    host.controlledIsGone = true;
    fixture.detectChanges();
    await fixture.whenStable();
    editorComponent.produced.length = 0;

    mutateFirstLine(orphan, 'const zz = 9;');
    await flush();

    // The view read its own DOM, made a transaction out of it, and moved on to
    // a new state, all of it after the component was destroyed.
    expect(orphan.state.doc.toString()).toBe('const zz = 9;\n');
    // The update listener's closure ran and wrote into the dead component.
    expect(editorComponent.produced).toEqual(['const zz = 9;\n']);
    // Angular refuses the output emit, so the parent's handler is not called.
    expect(host.handledAfterUnmount).toEqual([]);
    expect(warn.mock.calls.map(String).join('\n')).toContain('NG0953');

    orphans.pop();
    orphan.destroy();
    fixture.destroy();
    warn.mockRestore();
  });

  it('does nothing at all on the same mutation once the view is destroyed', async () => {
    const fixture = TestBed.createComponent(SwitchHost);
    const host = fixture.componentInstance;
    host.showControlled.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const editorComponent = host.controlled()!;
    const destroyed = editorComponent.editorView!;
    const documentBefore = destroyed.state.doc.toString();

    host.showControlled.set(false);
    host.controlledIsGone = true;
    fixture.detectChanges();
    await fixture.whenStable();
    // Nothing in Angular does this for you: the component has no ngOnDestroy,
    // so the test plays the part of the missing line.
    destroyed.destroy();
    editorComponent.produced.length = 0;

    mutateFirstLine(destroyed, 'const zz = 9;');
    await flush();

    expect(destroyed.state.doc.toString()).toBe(documentBefore);
    expect(editorComponent.produced).toEqual([]);
    expect(host.handledAfterUnmount).toEqual([]);
    expect(census.editorFootprint()).toBe(0);

    fixture.destroy();
  });
});
