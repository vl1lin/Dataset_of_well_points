// @ts-check
// Модуль main.js — точка входа страницы.
//
// Схема взаимодействия:
//   импортирует loadAllData() из data.js и получает от неё Dataset (все таблицы);
//   выводит в консоль число строк по каждой таблице и обновляет статус на странице;
//   импортирует initFilters() из filters.js: передаёт данные и обработчик «Показать»;
//   по «Показать» вызывает runQuery() из query.js (получает FieldResult[])
//   и отдаёт результат в renderResults() из render.js — вкладки и таблицы в #results.
//   подключает боковую панель: initPanel() из panel.js, initSqlPanel() из sql-panel.js
//   (DuckDB-WASM из duckdb.js начинает грузиться при первом открытии панели)
//   и initBuilder() из builder-ui.js (ему передаются выбор с главной панели и переход в SQL-режим),
//   а также initPythonPanel() из python-panel.js (Python грузится при первом показе вкладки);
//   кнопка «Передать в Python» конструктора и SQL отдаёт результат в pythonPanel.setDf();
//   по «Скачать .xlsx» вызывает downloadXlsx() из export.js для последнего показанного результата.

import { loadAllData } from './data.js';
import { initFilters } from './filters.js';
import { runQuery } from './query.js';
import { renderMessage, renderResults } from './render.js';
import { downloadXlsx } from './export.js';
import { initPanel } from './panel.js';
import { initSqlPanel } from './sql-panel.js';
import { initBuilder } from './builder-ui.js';
import { initPythonPanel } from './python-panel.js';

/**
 * Запускает приложение: загружает данные и сообщает результат.
 * @returns {Promise<void>}
 */
async function init() {
  const statusEl = document.getElementById('status');
  try {
    const data = await loadAllData();

    for (const [name, rows] of Object.entries(data)) {
      console.log(`${name}: ${rows.length} строк`);
    }

    if (statusEl) {
      statusEl.textContent = 'Данные загружены (подробности — в консоли браузера).';
    }

    const resultsEl = document.getElementById('results');
    if (!resultsEl) throw new Error('В index.html нет элемента #results');

    // Боковая панель: DuckDB грузится только при первом её открытии, Python — при первом показе его вкладки.
    const pythonPanel = initPythonPanel(/** @type {HTMLElement} */ (document.getElementById('pane-python')));
    /** Передаёт результат конструктора или SQL в Python как DataFrame df и открывает вкладку Python. */
    const sendToPython = (/** @type {string[]} */ columns, /** @type {import('./data.js').Row[]} */ rows) => {
      pythonPanel.setDf(columns, rows);
      panel.setMode('python');
    };
    const sqlPanel = initSqlPanel(/** @type {HTMLElement} */ (document.getElementById('pane-sql')), {
      onSendToPython: sendToPython,
    });
    const panel = initPanel({
      onFirstOpen: sqlPanel.load,
      onModeShown: (mode) => {
        if (mode === 'python') pythonPanel.load();
      },
    });

    // Последний показанный результат: именно он выгружается в .xlsx,
    // даже если после «Показать» пользователь успел изменить выбор.
    /** @type {{results: import('./query.js').FieldResult[], state: import('./filters.js').FilterState} | null} */
    let shown = null;

    const filters = initFilters(data, {
      onShow: (state) => {
        shown = null;
        filters.setDownloadEnabled(false);
        if (state.wellIds.length === 0) {
          renderMessage(resultsEl, 'Выберите хотя бы одну скважину');
          return;
        }
        const results = runQuery(data, state);
        renderResults(resultsEl, results);
        if (results.length > 0) {
          shown = { results, state };
          filters.setDownloadEnabled(true);
        }
      },
      onDownload: () => {
        if (shown) downloadXlsx(shown.results, shown.state);
      },
    });

    // Конструктор берёт выбор с главной панели в момент нажатия кнопок.
    initBuilder(/** @type {HTMLElement} */ (document.getElementById('pane-builder')), {
      getMainFilter: () => {
        const { fieldCodes, wellIds } = filters.getState();
        return { fieldCodes, wellIds };
      },
      onOpenInSql: (sql) => {
        sqlPanel.setSql(sql);
        panel.setMode('sql');
      },
      onSendToPython: sendToPython,
    });
  } catch (error) {
    console.error(error);
    if (statusEl) {
      statusEl.textContent = `Ошибка загрузки данных: ${error.message}`;
      statusEl.classList.add('error');
    }
  }
}

init();
