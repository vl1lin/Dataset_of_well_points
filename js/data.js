// @ts-check
// Модуль data.js — загрузка и парсинг CSV.
//
// Схема взаимодействия:
//   экспортирует TABLE_FILES (имя таблицы -> путь к CSV)  <- читает duckdb.js (создаёт таблицы DuckDB);
//   экспортирует loadAllData()  <- вызывает main.js (один раз при старте страницы)
//   на выходе: объект { fields, fluids, studies, points, pump_intake },
//              где каждое поле — массив строк-объектов (ключи = названия колонок CSV).
//   использует глобальный Papa (Papa Parse, подключён в index.html через CDN).

/**
 * Одна строка таблицы: имя колонки -> число, строка или null (пустое поле).
 * @typedef {Record<string, string | number | null>} Row
 */

/**
 * Все таблицы базы.
 * @typedef {Object} Dataset
 * @property {Row[]} fields      месторождения
 * @property {Row[]} fluids      свойства флюидов по залежам
 * @property {Row[]} studies     исследования
 * @property {Row[]} points      точки замеров давления и температуры
 * @property {Row[]} pump_intake давление на приёме насосов
 */

/** Papa Parse из CDN лежит в window; для ts-check приводим к any. */
const Papa = /** @type {any} */ (window).Papa;

/** Соответствие: имя таблицы -> путь к CSV-файлу. */
export const TABLE_FILES = {
  fields: 'data/01_fields.csv',
  fluids: 'data/02_fluids.csv',
  studies: 'data/03_studies.csv',
  points: 'data/04_points.csv',
  pump_intake: 'data/05_pump_intake.csv',
};

/**
 * Загружает один CSV и разбирает его в массив объектов.
 * Числа приводятся к number (dynamicTyping), пустые поля становятся null.
 * Но `well` и коды (например «2Ф», «1ПШ») остаются строками, а «123» как номер
 * скважины — числом; для единообразия приведём well к строке отдельно.
 * @param {string} url путь к CSV относительно страницы
 * @returns {Promise<Row[]>} строки таблицы
 */
async function loadCsv(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Не удалось загрузить ${url}: HTTP ${response.status}`);
  }
  const text = await response.text();

  const parsed = Papa.parse(text, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    transform: (value) => (value === '' ? null : value),
  });

  if (parsed.errors.length > 0) {
    console.warn(`Предупреждения при разборе ${url}:`, parsed.errors);
  }

  /** @type {Row[]} */
  const rows = parsed.data;

  // Номер скважины — это идентификатор, а не число: «12» и «12Ф» должны вести себя одинаково.
  for (const row of rows) {
    if ('well' in row && row.well !== null) {
      row.well = String(row.well);
    }
  }
  return rows;
}

/**
 * Загружает все пять таблиц параллельно.
 * @returns {Promise<Dataset>} объект с таблицами
 */
export async function loadAllData() {
  const names = /** @type {(keyof typeof TABLE_FILES)[]} */ (Object.keys(TABLE_FILES));
  const tables = await Promise.all(names.map((name) => loadCsv(TABLE_FILES[name])));

  const data = /** @type {Dataset} */ ({});
  names.forEach((name, i) => {
    data[name] = tables[i];
  });
  return data;
}
