// @ts-check
// Модуль export.js — выгрузка результата в файл .xlsx (SheetJS).
//
// Схема взаимодействия:
//   экспортирует downloadXlsx(results, state)  <- вызывает main.js по кнопке «Скачать .xlsx»
//     results — FieldResult[] из query.js (то, что сейчас показано на странице);
//     state   — FilterState из filters.js (для листа «Параметры запроса»);
//   экспортирует downloadPanelXlsx(sheetName, columns, rows)  <- result-view.js (кнопка в боковой панели);
//   экспортирует buildSheets(results, state, date)  — чистая функция без DOM и SheetJS:
//     возвращает листы как массивы строк, поэтому их можно проверить отдельно;
//   порядок таблиц берёт из query.js (fieldSections), заголовки колонок — из columns.js.
//   использует глобальный XLSX (SheetJS, подключён в index.html через CDN).

import { getColumnTitle } from './columns.js';
import { fieldSections } from './query.js';

/** @typedef {import('./query.js').FieldResult} FieldResult */
/** @typedef {import('./filters.js').FilterState} FilterState */

/**
 * Лист книги: имя и содержимое в виде строк ячеек.
 * @typedef {Object} SheetData
 * @property {string} name
 * @property {(string | number | null)[][]} rows
 */

const XLSX = /** @type {any} */ (window).XLSX;

const collator = new Intl.Collator('ru', { numeric: true });

/** Имя первого листа. */
const PARAMS_SHEET = 'Параметры запроса';

/**
 * Делает имя листа допустимым для Excel: убирает символы []:*?/\ и обрезает до 31 символа.
 * Повторы получают суффикс « (2)», « (3)» и т.д.
 * @param {string} name желаемое имя
 * @param {Set<string>} used уже занятые имена (дополняется)
 * @returns {string} уникальное допустимое имя
 */
function uniqueSheetName(name, used) {
  const base = name.replace(/[[\]:*?/\\]/g, '').trim().slice(0, 31) || 'Лист';
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n += 1) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Превращает идентификатор скважины «<поле>|<ключ>» в подпись для листа параметров.
 * @param {string} key часть после «|»: номер или «#<study_code>»
 * @returns {string}
 */
function wellLabel(key) {
  return key.startsWith('#') ? `без номера (${key.slice(1)})` : key;
}

/**
 * Строит лист «Параметры запроса»: месторождения, скважины, флаги, дата выгрузки.
 * @param {FieldResult[]} results результат выборки
 * @param {FilterState} state состояние панели выбора
 * @param {string} date дата выгрузки (ГГГГ-ММ-ДД)
 * @returns {SheetData}
 */
function buildParamsSheet(results, state, date) {
  /** @type {SheetData['rows']} */
  const rows = [
    ['Дата выгрузки', date],
    ['Показать PVT-свойства', state.showPvt ? 'да' : 'нет'],
    ['Скрыть режим работы ЭЦН/ШСН', state.hidePump ? 'да' : 'нет'],
    [],
    ['Месторождение', 'Выбранные скважины'],
  ];
  for (const result of results) {
    const wells = state.wellIds
      .filter((id) => id.startsWith(`${result.field_code}|`))
      .map((id) => wellLabel(id.slice(result.field_code.length + 1)))
      .sort((a, b) => collator.compare(a, b));
    rows.push([`${result.field_name} (${result.field_code})`, wells.join(', ')]);
  }
  return { name: PARAMS_SHEET, rows };
}

/**
 * Строит лист месторождения: таблицы друг под другом в том же порядке, что на странице.
 * Перед таблицей — строка заголовка и строка русских названий колонок, между таблицами — пустая строка.
 * @param {FieldResult} result результат по месторождению
 * @returns {SheetData['rows']}
 */
function buildFieldRows(result) {
  /** @type {SheetData['rows']} */
  const rows = [];
  let afterHeading = false;
  for (const section of fieldSections(result)) {
    // Пустая строка между таблицами; сразу после заголовка «Таблица 4» её не нужно.
    if (rows.length > 0 && !afterHeading) rows.push([]);
    afterHeading = section.table === null;
    rows.push([section.title]);
    const table = section.table;
    if (table === null) continue;
    if (table.rows.length === 0) {
      rows.push([section.emptyText]);
      continue;
    }
    rows.push(table.columns.map(getColumnTitle));
    for (const row of table.rows) {
      rows.push(
        table.columns.map((column) => {
          const value = row[column];
          if (value === null || value === undefined) return column === 'well' ? 'без номера' : null;
          return value;
        }),
      );
    }
  }
  return rows;
}

/**
 * Собирает все листы книги: «Параметры запроса» и по одному листу на месторождение.
 * @param {FieldResult[]} results результат выборки
 * @param {FilterState} state состояние панели выбора
 * @param {string} date дата выгрузки (ГГГГ-ММ-ДД)
 * @returns {SheetData[]}
 */
export function buildSheets(results, state, date) {
  const used = new Set([PARAMS_SHEET.toLowerCase()]);
  return [
    buildParamsSheet(results, state, date),
    ...results.map((result) => ({
      name: uniqueSheetName(result.field_name, used),
      rows: buildFieldRows(result),
    })),
  ];
}

/**
 * Возвращает сегодняшнюю дату по местному времени в виде ГГГГ-ММ-ДД.
 * @returns {string}
 */
function today() {
  const d = new Date();
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Выгружает результат боковой панели: один лист, названный по режиму («Конструктор», «SQL», «Python»).
 * Первая строка — русские заголовки колонок, затем все строки результата (не только показанные).
 * @param {string} sheetName имя листа
 * @param {string[]} columns колонки результата
 * @param {import('./data.js').Row[]} rows все строки результата
 * @param {Record<string, string>} [titles] готовые заголовки «колонка -> текст»; у остальных — из columns.js
 */
export function downloadPanelXlsx(sheetName, columns, rows, titles = {}) {
  const aoa = [
    columns.map((c) => titles[c] ?? getColumnTitle(c, false)),
    ...rows.map((row) => columns.map((c) => row[c] ?? null)),
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  XLSX.writeFile(workbook, `well_data_${today()}.xlsx`);
}

/**
 * Формирует книгу и скачивает файл well_data_<ГГГГ-ММ-ДД>.xlsx.
 * @param {FieldResult[]} results результат выборки
 * @param {FilterState} state состояние панели выбора
 */
export function downloadXlsx(results, state) {
  const date = today();
  const workbook = XLSX.utils.book_new();
  for (const sheet of buildSheets(results, state, date)) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    worksheet['!cols'] = [{ wch: 28 }];
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }
  XLSX.writeFile(workbook, `well_data_${date}.xlsx`);
}
