// @ts-check
// Модуль render.js — вывод результата выборки на страницу: вкладки и HTML-таблицы.
//
// Схема взаимодействия:
//   экспортирует renderResults(container, results)  <- вызывает main.js после runQuery();
//     results — массив FieldResult из query.js; на странице появляется вкладка на каждое месторождение;
//   экспортирует renderMessage(container, text)  <- main.js, когда выводить нечего (например, не выбраны скважины);
//   экспортирует buildTable(table, options)  <- result-view.js (таблица результата в боковой панели);
//   заголовки колонок берёт из columns.js (getColumnTitle), список таблиц — из query.js (fieldSections).
//   Содержимое вкладки строится при первом открытии (35 вкладок с 4327 строками сразу не нужны).

import { getColumnTitle } from './columns.js';
import { fieldSections } from './query.js';

/** @typedef {import('./query.js').FieldResult} FieldResult */
/** @typedef {import('./query.js').Table} Table */

/**
 * Создаёт элемент с классом и текстом.
 * @param {string} tag имя тега
 * @param {string} [className] класс
 * @param {string} [text] текст (через textContent, HTML не разбирается)
 * @returns {HTMLElement}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Строит HTML-таблицу с русскими заголовками.
 * Пустые значения выводятся пустой ячейкой; для таблиц результата выборки (markNoWell)
 * пустой номер скважины выводится как «без номера».
 * @param {Table} table колонки и строки
 * @param {{markNoWell?: boolean, warnUnknown?: boolean, titles?: Record<string, string>}} [options]
 *   markNoWell — подписывать пустую скважину;
 *   warnUnknown — предупреждать о колонках без перевода (по умолчанию да);
 *   titles — готовые заголовки «колонка -> текст» (например, из конструктора), имеют приоритет над columns.js
 * @returns {HTMLTableElement}
 */
export function buildTable(table, { markNoWell = false, warnUnknown = true, titles = {} } = {}) {
  const tableEl = document.createElement('table');

  const headRow = tableEl.createTHead().insertRow();
  for (const column of table.columns) {
    const th = document.createElement('th');
    th.textContent = titles[column] ?? getColumnTitle(column, warnUnknown);
    headRow.append(th);
  }

  const body = tableEl.createTBody();
  for (const row of table.rows) {
    const tr = body.insertRow();
    for (const column of table.columns) {
      const value = row[column];
      const td = tr.insertCell();
      if (value === null || value === undefined) {
        if (markNoWell && column === 'well') td.textContent = 'без номера';
      } else {
        td.textContent = String(value);
      }
    }
  }
  return tableEl;
}

/**
 * Строит блок «заголовок + таблица» или сообщение, если строк нет.
 * @param {import('./query.js').Section} item блок из fieldSections()
 * @returns {HTMLElement}
 */
function buildSection(item) {
  const section = el('section', 'result-table');
  section.append(el(`h${item.level}`, '', item.title));
  if (item.table === null) return section;
  if (item.table.rows.length === 0) {
    section.append(el('p', 'empty', item.emptyText));
  } else {
    const scroll = el('div', 'table-scroll');
    scroll.append(buildTable(item.table, { markNoWell: true }));
    section.append(scroll);
  }
  return section;
}

/**
 * Строит содержимое вкладки месторождения: блоки из fieldSections() друг под другом.
 * @param {FieldResult} result результат по месторождению
 * @returns {HTMLElement}
 */
function buildFieldPanel(result) {
  const panel = el('div', 'field-panel');
  panel.append(...fieldSections(result).map(buildSection));
  return panel;
}

/**
 * Выводит в контейнер одно сообщение вместо результата.
 * @param {HTMLElement} container куда выводить (содержимое заменяется)
 * @param {string} text текст сообщения
 */
export function renderMessage(container, text) {
  container.replaceChildren(el('p', 'empty', text));
}

/**
 * Выводит результат: вкладки по месторождениям и таблицы внутри активной вкладки.
 * @param {HTMLElement} container куда выводить (содержимое заменяется)
 * @param {FieldResult[]} results результат выборки
 */
export function renderResults(container, results) {
  if (results.length === 0) {
    renderMessage(container, 'Нет данных для выбранных скважин');
    return;
  }

  const tabBar = el('div', 'tabs');
  tabBar.setAttribute('role', 'tablist');
  const panelHost = el('div', 'tab-content');

  /** @type {HTMLButtonElement[]} */
  const buttons = [];
  /** @type {(HTMLElement | null)[]} */
  const panels = results.map(() => null);

  /**
   * Делает вкладку активной; содержимое строится при первом открытии.
   * @param {number} index номер вкладки
   */
  function activate(index) {
    buttons.forEach((b, i) => {
      b.classList.toggle('active', i === index);
      b.setAttribute('aria-selected', String(i === index));
    });
    let panel = panels[index];
    if (!panel) {
      panel = buildFieldPanel(results[index]);
      panels[index] = panel;
    }
    panelHost.replaceChildren(panel);
  }

  results.forEach((result, index) => {
    const button = /** @type {HTMLButtonElement} */ (el('button', 'tab', result.field_name));
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.addEventListener('click', () => activate(index));
    buttons.push(button);
    tabBar.append(button);
  });

  container.replaceChildren(tabBar, panelHost);
  activate(0);
}
