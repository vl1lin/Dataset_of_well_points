// @ts-check
// Модуль result-view.js — общий вывод результата в боковой панели (для всех режимов).
//
// Схема взаимодействия:
//   экспортирует createResultView(container, sheetName)  <- вызывают sql-panel.js
//     (позже builder-ui.js и python-panel.js), каждый для своего контейнера;
//     возвращает { showResult(columns, rows), showError(text), clear() };
//   рисует счётчик строк, таблицу (первые 1000 строк), кнопку «Скачать .xlsx» и, если передан
//   onSendToPython, кнопку «Передать в Python» (все строки результата уходят в DataFrame df);
//   таблицу строит buildTable() из render.js, выгрузку делает downloadPanelXlsx() из export.js
//     (в файл попадают все строки, лист называется sheetName).

import { buildTable } from './render.js';
import { downloadPanelXlsx } from './export.js';

/** @typedef {import('./data.js').Row} Row */

/** Сколько строк показывается на экране (в выгрузку идут все). */
const MAX_VISIBLE_ROWS = 1000;

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
 * Создаёт область вывода результата внутри контейнера.
 * @param {HTMLElement} container куда вставить область (содержимое заменяется)
 * @param {string} sheetName имя листа в .xlsx — название режима
 * @param {{onSendToPython?: (columns: string[], rows: Row[]) => void}} [options]
 *   onSendToPython — если задан, в панели появляется кнопка «Передать в Python» (конструктор и SQL)
 * @returns {{showResult: (columns: string[], rows: Row[], titles?: Record<string, string>) => void,
 *   showError: (text: string) => void, clear: () => void}}
 *   titles в showResult — готовые заголовки «колонка -> текст» (конструктор подписывает агрегаты)
 */
export function createResultView(container, sheetName, { onSendToPython } = {}) {
  const info = el('span', 'result-info');
  const download = /** @type {HTMLButtonElement} */ (el('button', '', 'Скачать .xlsx'));
  download.type = 'button';
  const toPython = /** @type {HTMLButtonElement} */ (el('button', 'secondary', 'Передать в Python'));
  toPython.type = 'button';
  const bar = el('div', 'result-bar');
  bar.append(info);
  if (onSendToPython) bar.append(toPython);
  bar.append(download);
  const body = el('div', 'result-body');
  container.replaceChildren(bar, body);

  /** @type {{columns: string[], rows: Row[], titles: Record<string, string>} | null} */
  let current = null;

  toPython.addEventListener('click', () => {
    if (current && onSendToPython) onSendToPython(current.columns, current.rows);
  });

  download.addEventListener('click', () => {
    if (current) downloadPanelXlsx(sheetName, current.columns, current.rows, current.titles);
  });

  /** Скрывает счётчик и кнопку, очищает таблицу. */
  function clear() {
    current = null;
    bar.hidden = true;
    body.replaceChildren();
  }

  clear();

  return {
    clear,

    showResult(columns, rows, titles = {}) {
      current = { columns, rows, titles };
      bar.hidden = false;
      download.disabled = rows.length === 0;
      toPython.disabled = rows.length === 0;
      info.textContent =
        rows.length > MAX_VISIBLE_ROWS
          ? `Строк: ${rows.length} (показаны первые ${MAX_VISIBLE_ROWS}, в .xlsx попадут все)`
          : `Строк: ${rows.length}`;

      const scroll = el('div', 'table-scroll');
      scroll.append(buildTable({ columns, rows: rows.slice(0, MAX_VISIBLE_ROWS) }, { warnUnknown: false, titles }));
      body.replaceChildren(scroll);
    },

    showError(text) {
      current = null;
      bar.hidden = true;
      body.replaceChildren(el('pre', 'error-box', text));
    },
  };
}
