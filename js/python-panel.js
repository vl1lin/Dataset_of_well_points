// @ts-check
// Модуль python-panel.js — UI Python-режима боковой панели и обмен сообщениями с воркером.
//
// Схема взаимодействия:
//   экспортирует initPythonPanel(container)  <- вызывает main.js;
//     возвращает { load(), setDf(columns, rows) }:
//       load()  — main.js вызывает при первом показе вкладки «Python»: запускает python-worker.js;
//       setDf() — вызывается по кнопке «Передать в Python» из конструктора и SQL-режима:
//                 результат становится DataFrame `df` в Python;
//   с воркером (python-worker.js) общается сообщениями (список — в начале того файла);
//   пути к CSV и список текстовых колонок берёт из data.js (TABLE_FILES) и duckdb.js (TEXT_COLUMNS);
//   результат выводит result-view.js (таблица с русскими заголовками и кнопка .xlsx).

import { TABLE_FILES } from './data.js';
import { TEXT_COLUMNS } from './duckdb.js';
import { createResultView } from './result-view.js';

/** @typedef {import('./data.js').Row} Row */

/**
 * Итог выполнения кода, присланный воркером.
 * @typedef {Object} RunResult
 * @property {boolean} ok
 * @property {string} stdout вывод print()
 * @property {{columns: string[], data: (string | number | null)[][]} | null} frame DataFrame-результат
 * @property {string | null} error текст traceback
 */

/** Примеры для шпаргалки над полем кода. */
const CHEAT_SHEET = `# 1. Фильтр строк
result = points[points.depth_m > 1000]

# 2. Выбор колонок
result = studies[['study_code', 'well', 'p_bh_mpa']]

# 3. Группировка: среднее забойное давление по способу эксплуатации
result = studies.groupby('lift_method')['p_bh_mpa'].mean().reset_index()

# print() выводится под полем кода: print(len(studies))
# df — результат, переданный из конструктора или SQL-режима`;

/**
 * Создаёт элемент с классом и текстом.
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Строит интерфейс Python-режима в контейнере.
 * @param {HTMLElement} container пустой контейнер вкладки Python
 * @returns {{load: () => void, setDf: (columns: string[], rows: Row[]) => void}}
 */
export function initPythonPanel(container) {
  const status = el('p', 'pane-status', 'Python загрузится при первом открытии этой вкладки.');

  const cheat = /** @type {HTMLDetailsElement} */ (el('details', 'sql-hint'));
  cheat.append(el('summary', '', 'Шпаргалка'));
  cheat.append(el('pre', 'sql-hint-body', CHEAT_SHEET));

  const textarea = /** @type {HTMLTextAreaElement} */ (el('textarea', 'sql-input'));
  textarea.rows = 8;
  textarea.spellcheck = false;
  textarea.value = "result = points[points.depth_m > 1000]\nprint(len(studies))";

  const runBtn = /** @type {HTMLButtonElement} */ (el('button', '', 'Выполнить'));
  runBtn.type = 'button';
  runBtn.disabled = true;
  const stopBtn = /** @type {HTMLButtonElement} */ (el('button', 'secondary', 'Остановить'));
  stopBtn.type = 'button';
  stopBtn.disabled = true;
  const actions = el('div', 'pane-actions');
  actions.append(runBtn, stopBtn, el('span', 'run-hint', 'Ctrl+Enter'));

  const dfNote = el('p', 'pane-status');
  const stdoutBox = el('pre', 'python-output');
  stdoutBox.hidden = true;
  const resultHost = el('div', 'result-host');
  const resultView = createResultView(resultHost, 'Python');

  container.append(status, cheat, textarea, actions, dfNote, stdoutBox, resultHost);

  /** @type {Worker | null} */
  let worker = null;
  /** @type {Promise<void> | null} */
  let ready = null;
  /** @type {string | null} последний переданный df (повторно отправляется после перезапуска воркера) */
  let lastDfJson = null;
  /** @type {{resolve: (r: RunResult) => void} | null} */
  let pendingRun = null;

  /** Запускает воркер и начинает загрузку Pyodide, pandas и таблиц. */
  function start() {
    status.classList.remove('error');
    status.textContent = 'Загрузка Python (Pyodide + pandas, 10–20 МБ). Это разовая загрузка, она занимает время…';
    runBtn.disabled = true;

    const newWorker = new Worker(new URL('./python-worker.js', import.meta.url));
    worker = newWorker;

    /** @type {Record<string, {url: string, textColumns: string[]}>} */
    const tables = {};
    for (const [name, path] of Object.entries(TABLE_FILES)) {
      tables[name] = {
        url: new URL(path, document.baseURI).href,
        textColumns: /** @type {Record<string, string[]>} */ (TEXT_COLUMNS)[name],
      };
    }

    ready = new Promise((resolve, reject) => {
      newWorker.onmessage = (event) => {
        const message = event.data;
        if (message.type === 'status') {
          status.textContent = `${message.text} (разовая загрузка)`;
        } else if (message.type === 'ready') {
          if (lastDfJson) newWorker.postMessage({ type: 'setDf', json: lastDfJson });
          status.textContent =
            'Готово. Доступны DataFrame: fields, fluids, studies, points, pump_intake. Результат — переменная result.';
          runBtn.disabled = false;
          resolve();
        } else if (message.type === 'initError') {
          reject(new Error(message.message));
        } else if (message.type === 'result' && pendingRun) {
          const run = pendingRun;
          pendingRun = null;
          run.resolve(message);
        }
      };
      newWorker.onerror = (event) => reject(new Error(event.message || 'Ошибка воркера'));
    });

    ready.catch((error) => {
      worker = null;
      ready = null; // следующее открытие вкладки попробует загрузить ещё раз
      status.textContent = `Не удалось загрузить Python: ${error.message}`;
      status.classList.add('error');
    });

    newWorker.postMessage({ type: 'init', tables });
  }

  /** Запускает загрузку Python, если она ещё не начиналась. */
  function load() {
    if (!ready) start();
  }

  /** Выполняет код из поля и выводит результат, вывод print() и ошибки. */
  async function run() {
    if (runBtn.disabled || !worker || !ready) return;
    runBtn.disabled = true;
    stopBtn.disabled = false;
    stdoutBox.hidden = true;
    const thisWorker = worker;

    /** @type {RunResult} */
    const result = await new Promise((resolve) => {
      pendingRun = { resolve };
      thisWorker.postMessage({ type: 'run', code: textarea.value });
    });

    // Если за время выполнения нажали «Остановить», воркер уже заменён — результат не нужен.
    if (thisWorker !== worker) return;
    stopBtn.disabled = true;
    runBtn.disabled = false;

    stdoutBox.hidden = result.stdout === '';
    stdoutBox.textContent = result.stdout;

    if (!result.ok) {
      resultView.showError(result.error ?? 'Неизвестная ошибка');
    } else if (result.frame === null) {
      resultView.showError('Результата-таблицы нет: присвойте DataFrame переменной result или сделайте его последним выражением.');
    } else {
      const { columns, data } = result.frame;
      /** @type {Row[]} */
      const rows = data.map((values) => Object.fromEntries(columns.map((c, i) => [c, values[i]])));
      resultView.showResult(columns, rows);
    }
  }

  /** Останавливает выполнение: воркер завершается и запускается заново. */
  function stop() {
    if (!worker) return;
    worker.terminate();
    worker = null;
    ready = null;
    if (pendingRun) {
      pendingRun.resolve({ ok: false, stdout: '', frame: null, error: 'Выполнение остановлено.' });
      pendingRun = null;
    }
    stopBtn.disabled = true;
    resultView.showError('Выполнение остановлено, Python перезапускается…');
    start();
  }

  runBtn.addEventListener('click', run);
  stopBtn.addEventListener('click', stop);
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      run();
    }
  });

  return {
    load,

    setDf(columns, rows) {
      lastDfJson = JSON.stringify({ columns, data: rows.map((row) => columns.map((c) => row[c] ?? null)) });
      dfNote.textContent = `Передан DataFrame df: ${rows.length} строк, колонки: ${columns.join(', ')}.`;
      if (!ready) start();
      // Если воркер ещё грузится, df отправится сразу после готовности (см. onmessage 'ready').
      /** @type {Promise<void>} */ (ready).then(() => worker?.postMessage({ type: 'setDf', json: lastDfJson })).catch(() => {});
    },
  };
}
