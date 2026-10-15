// @ts-check
// Модуль duckdb.js — загрузка DuckDB-WASM, создание таблиц из CSV, выполнение SQL.
//
// Схема взаимодействия:
//   экспортирует getDb()  <- вызывают sql-panel.js (и позже конструктор, Python-режим);
//     возвращает Promise<DuckDb>: { runSql(sql), tables };
//     runSql(sql) -> { columns: string[], rows: Row[] }, ошибка SQL — исключение с понятным текстом;
//     tables — словарь «имя таблицы -> список колонок» (для подсказки над полем запроса);
//   экспортирует TEXT_COLUMNS (колонки-идентификаторы, читаемые как текст)  <- python-panel.js
//     передаёт их воркеру, чтобы pandas читал номера скважин так же, как DuckDB;
//   DuckDB-WASM весит несколько МБ, поэтому грузится лениво — при первом вызове getDb(),
//   то есть при первом открытии боковой панели. Повторные вызовы возвращают тот же Promise;
//   пути к CSV берёт из data.js (TABLE_FILES).

import { TABLE_FILES } from './data.js';

/** @typedef {import('./data.js').Row} Row */

/**
 * Готовый движок.
 * @typedef {Object} DuckDb
 * @property {(sql: string) => Promise<{columns: string[], rows: Row[]}>} runSql выполняет один запрос
 * @property {Record<string, string[]>} tables таблицы и их колонки
 */

/** Библиотека с CDN, версия закреплена точно. */
const DUCKDB_URL = 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm';

/**
 * Колонки, которые нужно читать как текст: иначе DuckDB может принять, например,
 * номер скважины «12» за число и потерять «12Ф» или «1.10» превратить в 1.1.
 */
export const TEXT_COLUMNS = {
  fields: ['code', 'name', 'region', 'book_section'],
  fluids: ['field_code', 'horizon', 'source', 'note'],
  studies: ['field_code', 'study_code', 'well', 'horizon', 'lift_method'],
  points: ['study_code'],
  pump_intake: ['field_code', 'fluid_horizon', 'well', 'lift_method', 'book_table', 'note'],
};

/** @type {Promise<DuckDb> | null} */
let dbPromise = null;

/**
 * Приводит значение из Arrow к обычному значению JS: BigInt и HUGEINT (сумма целых) -> число.
 * @param {any} value значение ячейки
 * @returns {any}
 */
function normalizeValue(value) {
  if (typeof value === 'bigint') return Number(value);
  // HUGEINT приходит как 4 слова по 32 бита (младшее первым), число со знаком.
  if (value instanceof Uint32Array && value.length === 4) {
    let n = 0n;
    for (let i = 3; i >= 0; i -= 1) n = (n << 32n) | BigInt(value[i]);
    if (value[3] & 0x80000000) n -= 1n << 128n;
    return Number(n);
  }
  return value;
}

/**
 * Загружает DuckDB-WASM и создаёт пять таблиц из CSV.
 * @returns {Promise<DuckDb>}
 */
async function initDb() {
  const duckdb = await import(/** @type {string} */ (DUCKDB_URL));
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());

  // Воркер с другого домена нельзя создать напрямую, поэтому оборачиваем его в Blob.
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }),
  );
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), new Worker(workerUrl));
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);

  const conn = await db.connect();

  for (const [name, path] of Object.entries(TABLE_FILES)) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Не удалось загрузить ${path}: HTTP ${response.status}`);
    await db.registerFileText(`${name}.csv`, await response.text());

    const textColumns = /** @type {Record<string, string[]>} */ (TEXT_COLUMNS)[name];
    const types = textColumns.map((c) => `'${c}': 'VARCHAR'`).join(', ');
    await conn.query(
      `CREATE TABLE ${name} AS SELECT * FROM read_csv('${name}.csv', auto_detect = true, header = true, types = {${types}})`,
    );
  }

  /** @type {Record<string, string[]>} */
  const tables = {};
  const info = await conn.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'main' ORDER BY table_name, ordinal_position`,
  );
  for (const row of info.toArray()) {
    (tables[row.table_name] ??= []).push(row.column_name);
  }

  return {
    tables,
    runSql: async (sql) => {
      const result = await conn.query(sql);
      const columns = result.schema.fields.map((/** @type {{name: string}} */ f) => f.name);
      const rows = result.toArray().map((/** @type {any} */ r) => {
        /** @type {Row} */
        const row = {};
        for (const column of columns) row[column] = normalizeValue(r[column]);
        return row;
      });
      return { columns, rows };
    },
  };
}

/**
 * Возвращает движок, при первом вызове загружая его.
 * Если загрузка не удалась, следующий вызов попробует ещё раз.
 * @returns {Promise<DuckDb>}
 */
export function getDb() {
  if (!dbPromise) {
    dbPromise = initDb().catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}
