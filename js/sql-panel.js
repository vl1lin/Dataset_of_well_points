// @ts-check
// Модуль sql-panel.js — UI SQL-режима боковой панели.
//
// Схема взаимодействия:
//   экспортирует initSqlPanel(container)  <- вызывает main.js, container — #pane-sql;
//     возвращает { load(), setSql(sql) }: main.js передаёт load в panel.js, и DuckDB начинает
//     грузиться при первом открытии панели; setSql вызывается из builder-ui.js
//     («Открыть в SQL-режиме»);
//   getDb() из duckdb.js даёт движок: runSql(sql) и список таблиц для подсказки;
//   createResultView() из result-view.js рисует таблицу результата и кнопку .xlsx.

import { getDb } from './duckdb.js';
import { createResultView } from './result-view.js';

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
 * Строит интерфейс SQL-режима в контейнере.
 * @param {HTMLElement} container пустой контейнер вкладки SQL
 * @param {{onSendToPython?: (columns: string[], rows: import('./data.js').Row[]) => void}} [handlers]
 *   onSendToPython — обработчик кнопки «Передать в Python»
 * @returns {{load: () => void, setSql: (sql: string) => void}} load() запускает загрузку DuckDB
 *   (повторные вызовы безопасны); setSql() подставляет текст запроса в поле (из конструктора)
 */
export function initSqlPanel(container, { onSendToPython } = {}) {
  const status = el('p', 'pane-status', 'DuckDB загрузится при открытии панели…');

  const hint = /** @type {HTMLDetailsElement} */ (el('details', 'sql-hint'));
  hint.append(el('summary', '', 'Таблицы и колонки'));
  const hintBody = el('div', 'sql-hint-body');
  hint.append(hintBody);

  const textarea = /** @type {HTMLTextAreaElement} */ (el('textarea', 'sql-input'));
  textarea.rows = 6;
  textarea.spellcheck = false;
  textarea.value = 'SELECT COUNT(*) AS n FROM points';

  const runBtn = /** @type {HTMLButtonElement} */ (el('button', '', 'Выполнить'));
  runBtn.type = 'button';
  runBtn.disabled = true;
  const runHint = el('span', 'run-hint', 'Ctrl+Enter');
  const actions = el('div', 'pane-actions');
  actions.append(runBtn, runHint);

  const resultHost = el('div', 'result-host');
  const resultView = createResultView(resultHost, 'SQL', { onSendToPython });

  container.append(status, hint, textarea, actions, resultHost);

  let started = false;

  /** Запускает загрузку DuckDB и, когда готово, заполняет подсказку и включает кнопку. */
  function load() {
    if (started) return;
    started = true;
    status.textContent = 'Загрузка DuckDB-WASM (несколько МБ, разовая) и таблиц…';
    getDb()
      .then((db) => {
        status.textContent = 'Готово. Таблицы доступны с именами колонок как в CSV, технические колонки тоже.';
        for (const [table, columns] of Object.entries(db.tables)) {
          const line = el('p', 'sql-hint-line');
          const name = el('strong', '', table);
          line.append(name, `: ${columns.join(', ')}`);
          hintBody.append(line);
        }
        runBtn.disabled = false;
      })
      .catch((error) => {
        started = false; // следующее открытие панели попробует загрузить ещё раз
        status.textContent = `Не удалось загрузить DuckDB: ${error.message}`;
        status.classList.add('error');
      });
  }

  /** Выполняет запрос из поля и выводит результат или текст ошибки. */
  async function run() {
    if (runBtn.disabled) return;
    const sql = textarea.value.trim();
    if (sql === '') return;

    runBtn.disabled = true;
    try {
      const db = await getDb();
      const { columns, rows } = await db.runSql(sql);
      resultView.showResult(columns, rows);
    } catch (error) {
      resultView.showError(error.message);
    } finally {
      runBtn.disabled = false;
    }
  }

  runBtn.addEventListener('click', run);
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      run();
    }
  });

  return {
    load,
    setSql: (sql) => {
      textarea.value = sql;
    },
  };
}
