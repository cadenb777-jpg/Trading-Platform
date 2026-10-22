/** The script editor: write Pine-style indicators, check them, save them and add them to the chart. */
import { ScriptError, compileScript } from '../script/interpreter';
import { EXAMPLES, NEW_SCRIPT, REFERENCE } from '../script/reference';
import { deleteScript, getScript, listScripts, registerScript, saveScript, scriptDefId, scriptTitle, type UserScript } from '../script/store';
import { h, toast } from '../ui/dom';
import { icon } from '../ui/icons';

const newId = () => Math.random().toString(36).slice(2, 10);

export function createScriptsPage(opts: { onAddToChart: (defId: string) => void; onScriptSaved: (defId: string) => void }) {
  let current: UserScript = { id: newId(), source: NEW_SCRIPT, updated: 0 };
  let dirty = false;

  const list = h('div', { class: 'script-list' });
  const examples = h(
    'div',
    { class: 'script-list' },
    ...EXAMPLES.map((ex) =>
      h('button', { class: 'script-item', onclick: () => open({ id: newId(), source: ex.source, updated: 0 }) }, icon('chart', 16), ex.name),
    ),
  );
  const editor = h('textarea', { class: 'code', spellcheck: false, autocomplete: 'off', 'aria-label': 'Script code', wrap: 'off' });
  const gutter = h('pre', { class: 'gutter', 'aria-hidden': 'true' });
  const status = h('div', { class: 'script-status' });
  const titleEl = h('h2', { class: 'script-title' });
  const deleteBtn = h('button', { class: 'btn danger', onclick: () => remove() }, 'Delete');
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search functions, e.g. rsi', 'aria-label': 'Search reference' });
  const refBody = h('div', { class: 'ref-body' });

  const el = h(
    'div',
    { class: 'scripts-page' },
    h(
      'aside',
      { class: 'scripts-side' },
      h('div', { class: 'panel-head' }, h('h3', {}, 'My scripts'), h('span', { class: 'spacer' }), h('button', { class: 'btn primary small-btn', onclick: () => open({ id: newId(), source: NEW_SCRIPT, updated: 0 }) }, '+ New')),
      list,
      h('div', { class: 'panel-head side-gap' }, h('h3', {}, 'Examples')),
      examples,
    ),
    h(
      'section',
      { class: 'script-main' },
      h(
        'div',
        { class: 'script-toolbar' },
        titleEl,
        h('span', { class: 'spacer' }),
        deleteBtn,
        h('button', { class: 'btn', onclick: () => save(), title: 'Save (Ctrl+S)' }, 'Save'),
        h('button', { class: 'btn primary', onclick: () => addToChart() }, 'Add to chart'),
      ),
      h('div', { class: 'editor-wrap' }, gutter, editor),
      status,
    ),
    h(
      'aside',
      { class: 'ref-side' },
      h('div', { class: 'panel-head' }, h('h3', {}, 'Pine Script reference')),
      h('p', { class: 'muted small' }, 'This editor understands the most common parts of TradingView\'s Pine Script v5. Paste a script from TradingView or start from an example. If a script uses something not supported yet, ask Claude to convert it.'),
      search,
      refBody,
    ),
  );

  function renderReference() {
    const q = search.value.trim().toLowerCase();
    refBody.replaceChildren(
      ...REFERENCE.map((section) => {
        const items = section.items.filter((i) => !q || `${i.sig} ${i.desc}`.toLowerCase().includes(q));
        if (!items.length) return null;
        return h(
          'details',
          { class: 'ref-section', open: !!q || section.title === 'Getting started' },
          h('summary', {}, section.title),
          ...items.map((i) => h('div', { class: 'ref-item' }, h('code', {}, i.sig), h('div', { class: 'muted small' }, i.desc))),
        );
      }).filter((n): n is HTMLDetailsElement => n !== null),
    );
  }
  search.addEventListener('input', renderReference);

  function renderList() {
    const scripts = listScripts();
    list.replaceChildren(
      ...scripts.map((s) =>
        h('button', { class: `script-item${s.id === current.id ? ' active' : ''}`, onclick: () => open(s) }, icon('chart', 16), scriptTitle(s.source)),
      ),
    );
    if (!scripts.length) list.append(h('div', { class: 'muted small pad' }, 'No saved scripts yet. Start from an example or click + New.'));
  }

  function renderGutter() {
    const lines = editor.value.split('\n').length;
    gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
    gutter.scrollTop = editor.scrollTop;
  }

  /** Compiles the code and shows the result under the editor. */
  function check(): boolean {
    titleEl.textContent = `${scriptTitle(editor.value)}${dirty ? ' •' : ''}`;
    gutter.querySelectorAll('mark').forEach((m) => m.replaceWith(m.textContent ?? ''));
    try {
      const compiled = compileScript(editor.value);
      const parts = [`${compiled.plots.length} plot${compiled.plots.length === 1 ? '' : 's'}`, `${compiled.inputs.length} setting${compiled.inputs.length === 1 ? '' : 's'}`, compiled.overlay ? 'on the price chart' : 'in its own pane'];
      status.className = 'script-status ok';
      status.replaceChildren(h('b', {}, '✓ Looks good: '), parts.join(' · '));
      if (compiled.warnings.length) status.append(h('div', { class: 'muted small' }, `Skipped (not supported yet): ${compiled.warnings.join(', ')}`));
      return true;
    } catch (err) {
      status.className = 'script-status error';
      status.replaceChildren(h('b', {}, '✕ '), (err as Error).message);
      const line = err instanceof ScriptError ? err.line : 0;
      if (line) {
        const numbers = gutter.textContent!.split('\n');
        gutter.replaceChildren(...numbers.flatMap((n, i) => [i + 1 === line ? h('mark', {}, n) : n, i < numbers.length - 1 ? '\n' : '']));
      }
      return false;
    }
  }

  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  editor.addEventListener('input', () => {
    dirty = true;
    renderGutter();
    clearTimeout(checkTimer);
    checkTimer = setTimeout(check, 400);
  });
  editor.addEventListener('scroll', () => (gutter.scrollTop = editor.scrollTop));
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      editor.setRangeText('    ', editor.selectionStart, editor.selectionEnd, 'end');
      editor.dispatchEvent(new Event('input'));
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  });

  function open(script: UserScript) {
    if (dirty && !confirm('You have unsaved changes. Discard them?')) return;
    current = script;
    editor.value = script.source;
    dirty = false;
    deleteBtn.hidden = !getScript(script.id);
    renderGutter();
    renderList();
    check();
    editor.focus();
  }

  function save(): boolean {
    if (!check()) {
      toast('Fix the error shown under the editor first');
      return false;
    }
    current = { ...current, source: editor.value, updated: Date.now() };
    saveScript(current);
    const err = registerScript(current);
    if (err) {
      toast(err.message);
      return false;
    }
    dirty = false;
    deleteBtn.hidden = false;
    renderList();
    check();
    opts.onScriptSaved(scriptDefId(current.id));
    toast(`Saved "${scriptTitle(current.source)}". It's in the Indicators menu under My scripts.`);
    return true;
  }

  function addToChart() {
    if (save()) opts.onAddToChart(scriptDefId(current.id));
  }

  function remove() {
    if (!getScript(current.id) || !confirm(`Delete "${scriptTitle(current.source)}"?`)) return;
    deleteScript(current.id);
    dirty = false;
    opts.onScriptSaved(scriptDefId(current.id));
    open({ id: newId(), source: NEW_SCRIPT, updated: 0 });
    toast('Script deleted');
  }

  let started = false;
  function start() {
    if (started) return;
    started = true;
    renderReference();
    const first = listScripts()[0];
    open(first ?? { id: newId(), source: NEW_SCRIPT, updated: 0 });
  }

  return { el, start };
}
