import { Component, afterNextRender, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CodeEditor } from './code-editor';
import { ControlledCodeEditor } from './controlled-code-editor';
import { installCensus } from './global-census';

const SEED = `function total(lines) {\n  return lines.reduce((sum, l) => sum + l.amount, 0);\n}\n`;
const EXTRA = `\nconst vat = (n) => n * 0.05;\n`;

/**
 * Two hosts for the same editor, side by side, plus a live count of what each
 * one has registered outside its own element.
 *
 * Put the caret somewhere in the middle of either editor, press "append a line
 * from outside", and watch where the caret ends up. Then unmount and read the
 * counts.
 */
@Component({
  selector: 'app-root',
  imports: [CodeEditor, ControlledCodeEditor, ReactiveFormsModule],
  template: `
    <h1>Who owns the document?</h1>

    <p class="controls">
      <button type="button" (click)="appendFromOutside()">append a line from outside</button>
      <button type="button" (click)="mounted.set(!mounted())">
        {{ mounted() ? 'unmount both editors' : 'mount both editors' }}
      </button>
      <button type="button" (click)="refreshCensus()">re-read the counts</button>
    </p>

    <div class="cols">
      <section>
        <h2>one-way + destroy</h2>
        @if (mounted()) {
          <app-code-editor [value]="oneWay()" (valueChange)="onOneWay($event)" />
        }
        <label class="value">
          the form control, updated from the editor
          <textarea rows="4" readonly [formControl]="form"></textarea>
        </label>
      </section>

      <section>
        <h2>write the whole value back, no teardown</h2>
        @if (mounted()) {
          <app-controlled-code-editor
            [value]="controlled()"
            (valueChange)="controlled.set($event)"
          />
        }
        <p class="value">
          document: <code>{{ controlled().length }}</code> characters
        </p>
      </section>
    </div>

    <pre class="census">{{ censusText() }}</pre>
  `,
  styles: `
    :host {
      display: block;
      font-family: system-ui, sans-serif;
      margin: 2rem auto;
      max-width: 62rem;
    }
    h1 {
      font-size: 1.4rem;
    }
    h2 {
      font-size: 0.95rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    .controls {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      margin: 1rem 0 1.5rem;
    }
    button {
      padding: 0.45rem 0.9rem;
      cursor: pointer;
    }
    .cols {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
      gap: 2rem;
    }
    .value {
      display: block;
      font-size: 0.85rem;
      color: #475569;
      margin-top: 0.75rem;
    }
    textarea {
      display: block;
      width: 100%;
      margin-top: 0.35rem;
      font-family: ui-monospace, monospace;
      font-size: 0.75rem;
    }
    .census {
      margin-top: 2rem;
      padding: 1rem;
      background: #0f172a;
      color: #e2e8f0;
      font-size: 0.8rem;
      overflow-x: auto;
    }
  `,
})
export class App {
  readonly mounted = signal(true);
  readonly oneWay = signal(SEED);
  readonly controlled = signal(SEED);
  readonly censusText = signal('counting…');

  /** The form control that really holds the document the editor produced. */
  readonly form = new FormControl(SEED, { nonNullable: true });

  private readonly census = installCensus();

  constructor() {
    afterNextRender(() => this.refreshCensus());
  }

  onOneWay(next: string): void {
    this.oneWay.set(next);
    this.form.setValue(next);
  }

  appendFromOutside(): void {
    this.oneWay.update((text) => text + EXTRA);
    this.controlled.update((text) => text + EXTRA);
    this.form.setValue(this.oneWay());
  }

  refreshCensus(): void {
    const reading = this.census.read();
    const line = (label: string, counts: ReadonlyMap<string, number>, types: string[]) =>
      `${label}: ` + types.map((t) => `${t}=${counts.get(t) ?? 0}`).join('  ');
    this.censusText.set(
      [
        line('document handlers', reading.document, ['selectionchange']),
        line('window handlers  ', reading.window, ['resize', 'scroll', 'beforeprint']),
        `print media query: ${reading.printQuery}`,
        `live MutationObservers: ${reading.liveObservers}`,
        `total per-editor registrations: ${this.census.editorFootprint()}`,
      ].join('\n'),
    );
  }
}
