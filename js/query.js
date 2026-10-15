// @ts-check
// Модуль query.js — логика выборки (аналог SQL-запроса на JS). Без работы с DOM.
//
// Схема взаимодействия:
//   экспортирует runQuery(data, state)  <- вызовет main.js по кнопке «Показать»
//     data  — Dataset из data.js;
//     state — FilterState из filters.js (месторождения, выбранные скважины, флаги);
//     результат — массив FieldResult (по одному элементу на месторождение),
//     его будет рисовать render.js (этап 4) и выгружать export.js (этап 6);
//   экспортирует wellId(fieldCode, key) — общий формат идентификатора скважины,
//     им пользуется и filters.js, чтобы выбор и запрос понимали друг друга.
//   Строятся таблицы 1–3 всегда, таблица 4 (PVT) — при state.showPvt,
//   таблица 5 (режимы насосов) — при выключенном state.hidePump и наличии данных.

/** @typedef {import('./data.js').Dataset} Dataset */
/** @typedef {import('./data.js').Row} Row */
/** @typedef {import('./filters.js').FilterState} FilterState */

/**
 * Таблица результата: колонки в нужном порядке и строки.
 * @typedef {Object} Table
 * @property {string[]} columns  имена колонок (как в CSV)
 * @property {Row[]} rows
 */

/**
 * Результат по одному месторождению.
 * @typedef {Object} FieldResult
 * @property {string} field_code
 * @property {string} field_name
 * @property {Table} studies  таблица 1: исследования
 * @property {Table} params   таблица 2: параметры исследований
 * @property {Table} points   таблица 3: распределение давления и температуры
 * @property {PvtTables | null} pvt  таблица 4 (null, если флаг PVT выключен)
 * @property {Table | null} pump     таблица 5 (null, если режимы скрыты или данных нет)
 */

/**
 * Таблица 4: PVT-свойства.
 * @typedef {Object} PvtTables
 * @property {Table} studies  4а: из исследований
 * @property {Table} fluids   4б: из fluids по залежам (rows пуст, если для месторождения данных нет)
 */

/** Колонки таблицы 1. */
const STUDIES_COLUMNS = ['well', 'study_code', 'horizon', 'lift_method', 'study_year', 'study_month'];

/** PVT-колонки studies: выводятся в таблице 4, поэтому в таблице 2 их нет. */
const PVT_COLUMNS = [
  'p_sat_mpa', 't_res_c', 'gas_content_m3m3', 'gas_sat_m3t', 'gor', 'gor_unit',
  'rho_oil_dead', 'rho_oil_res', 'rho_gas', 'rho_water',
];

/** Колонки studies, которые не попадают в таблицу 2 (кроме well и study_code, они ставятся первыми). */
const PARAMS_EXCLUDED = new Set([
  ...STUDIES_COLUMNS, ...PVT_COLUMNS, 'field_code', 'note', 'source', 'book_table',
]);

/** Колонки таблицы 3. */
const POINTS_COLUMNS = ['well', 'study_code', 'depth_m', 'pressure_mpa', 'temp_c'];

/** Колонки таблицы 5 (pump_intake). */
const PUMP_COLUMNS = ['well', 'lift_method', 'regime', 'h_pump_m', 'h_dyn_m', 'p_annulus_wh_mpa', 'p_intake_mpa'];

/** Колонки fluids, которые не выводятся в таблице 4б. */
const FLUIDS_EXCLUDED = new Set(['field_code', 'source', 'note']);

const collator = new Intl.Collator('ru', { numeric: true });

/**
 * Собирает идентификатор скважины для хранения в выборе.
 * Для исследований без номера скважины ключом служит «#<study_code>».
 * @param {string} fieldCode код месторождения
 * @param {string} key номер скважины или «#<study_code>»
 * @returns {string} идентификатор вида «<field_code>|<key>»
 */
export function wellId(fieldCode, key) {
  return `${fieldCode}|${key}`;
}

/**
 * Сравнивает исследования: по номеру скважины (естественный порядок, безномерные в конце),
 * затем по study_code.
 * @param {Row} a
 * @param {Row} b
 * @returns {number}
 */
function compareStudies(a, b) {
  if (a.well === null && b.well !== null) return 1;
  if (a.well !== null && b.well === null) return -1;
  if (a.well !== null && b.well !== null) {
    const byWell = collator.compare(String(a.well), String(b.well));
    if (byWell !== 0) return byWell;
  }
  return collator.compare(String(a.study_code), String(b.study_code));
}

/**
 * Оставляет в строке только указанные колонки (в заданном порядке).
 * @param {Row} row
 * @param {string[]} columns
 * @returns {Row}
 */
function pick(row, columns) {
  /** @type {Row} */
  const result = {};
  for (const column of columns) result[column] = row[column] ?? null;
  return result;
}

/**
 * Блок вывода: заголовок и (необязательно) таблица.
 * Используется и страницей (render.js), и выгрузкой (export.js), чтобы порядок таблиц совпадал.
 * @typedef {Object} Section
 * @property {string} title      заголовок блока
 * @property {3 | 4} level       3 — таблица, 4 — часть таблицы 4
 * @property {Table | null} table  null — блок только с заголовком (над частями 4а и 4б)
 * @property {string} emptyText  сообщение, если в таблице нет строк
 */

/**
 * Возвращает блоки результата по месторождению в порядке вывода: таблицы 1–3, затем 4 и 5, если они есть.
 * @param {FieldResult} result результат по месторождению
 * @returns {Section[]}
 */
export function fieldSections(result) {
  const noData = 'Нет данных для выбранных скважин';
  /** @type {Section[]} */
  const sections = [
    { title: 'Таблица 1. Исследования', level: 3, table: result.studies, emptyText: noData },
    { title: 'Таблица 2. Параметры исследований', level: 3, table: result.params, emptyText: noData },
    { title: 'Таблица 3. Распределение давления и температуры', level: 3, table: result.points, emptyText: noData },
  ];
  if (result.pvt) {
    sections.push(
      { title: 'Таблица 4. PVT-свойства', level: 3, table: null, emptyText: '' },
      { title: '4а. По исследованиям', level: 4, table: result.pvt.studies, emptyText: noData },
      {
        title: '4б. По залежам',
        level: 4,
        table: result.pvt.fluids,
        emptyText: 'Свойства флюидов по залежам в книге не приведены',
      },
    );
  }
  if (result.pump) {
    sections.push({ title: 'Таблица 5. Давление на приёме насосов', level: 3, table: result.pump, emptyText: noData });
  }
  return sections;
}

/**
 * Убирает колонки, в которых нет ни одного значения. Колонки well и study_code остаются всегда.
 * @param {string[]} columns колонки таблицы
 * @param {Row[]} rows строки таблицы
 * @returns {string[]} колонки, где есть хотя бы одно непустое значение
 */
function nonEmptyColumns(columns, rows) {
  return columns.filter(
    (column) =>
      column === 'well' || column === 'study_code' || rows.some((row) => row[column] !== null),
  );
}

/**
 * Выполняет выборку таблиц 1–3 по состоянию фильтра.
 * Исследование попадает в результат, если его месторождение выбрано
 * и выбрана его скважина (безномерное — по ключу «#<study_code>»).
 * @param {Dataset} data все таблицы
 * @param {FilterState} state состояние панели выбора
 * @returns {FieldResult[]} по одному элементу на выбранное месторождение, в порядке таблицы fields
 */
export function runQuery(data, state) {
  const selectedFields = new Set(state.fieldCodes);
  const selectedWells = new Set(state.wellIds);

  // Колонки таблицы 2: well, study_code и все остальные колонки studies, кроме исключённых.
  const allColumns = data.studies.length > 0 ? Object.keys(data.studies[0]) : [];
  const paramsColumns = ['well', 'study_code', ...allColumns.filter((c) => !PARAMS_EXCLUDED.has(c))];

  // Исследования по месторождениям (только выбранные скважины).
  /** @type {Map<string, Row[]>} */
  const studiesByField = new Map();
  /** @type {Map<string, Row>} */
  const studyByCode = new Map();
  for (const study of data.studies) {
    const fieldCode = String(study.field_code);
    if (!selectedFields.has(fieldCode)) continue;
    const key = study.well === null ? `#${study.study_code}` : String(study.well);
    if (!selectedWells.has(wellId(fieldCode, key))) continue;

    studyByCode.set(String(study.study_code), study);
    const list = studiesByField.get(fieldCode);
    if (list) list.push(study);
    else studiesByField.set(fieldCode, [study]);
  }

  // Точки замеров по месторождениям (через study_code -> исследование).
  /** @type {Map<string, Row[]>} */
  const pointsByField = new Map();
  for (const point of data.points) {
    const study = studyByCode.get(String(point.study_code));
    if (!study) continue;
    const fieldCode = String(study.field_code);
    const row = { well: study.well, ...pick(point, POINTS_COLUMNS.slice(1)) };
    const list = pointsByField.get(fieldCode);
    if (list) list.push(row);
    else pointsByField.set(fieldCode, [row]);
  }

  /** @type {FieldResult[]} */
  const results = [];
  for (const field of data.fields) {
    const code = String(field.code);
    if (!selectedFields.has(code)) continue;

    const studies = (studiesByField.get(code) ?? []).sort(compareStudies);
    const points = (pointsByField.get(code) ?? []).sort((a, b) => {
      const byCode = collator.compare(String(a.study_code), String(b.study_code));
      return byCode !== 0 ? byCode : Number(a.depth_m) - Number(b.depth_m);
    });

    // Таблица 2: колонки, пустые во всей выборке этого месторождения, скрываем.
    const paramsRows = studies.map((s) => pick(s, paramsColumns));

    /** @type {PvtTables | null} */
    let pvt = null;
    if (state.showPvt) {
      const pvtStudyColumns = ['well', 'study_code', ...PVT_COLUMNS];
      const fluidRows = data.fluids.filter((f) => f.field_code === code);
      const fluidColumns = data.fluids.length > 0
        ? Object.keys(data.fluids[0]).filter((c) => !FLUIDS_EXCLUDED.has(c))
        : [];
      // Исследования, у которых все PVT-колонки пусты, в таблицу 4а не попадают.
      const pvtRows = studies
        .filter((s) => PVT_COLUMNS.some((c) => s[c] !== null))
        .map((s) => pick(s, pvtStudyColumns));
      pvt = {
        studies: { columns: pvtStudyColumns, rows: pvtRows },
        fluids: { columns: fluidColumns, rows: fluidRows.map((f) => pick(f, fluidColumns)) },
      };
    }

    /** @type {Table | null} */
    let pump = null;
    if (!state.hidePump) {
      const pumpRows = data.pump_intake
        .filter((p) => p.field_code === code && p.well !== null && selectedWells.has(wellId(code, String(p.well))))
        .sort((a, b) => collator.compare(String(a.well), String(b.well)) || Number(a.regime) - Number(b.regime))
        .map((p) => pick(p, PUMP_COLUMNS));
      if (pumpRows.length > 0) pump = { columns: PUMP_COLUMNS, rows: pumpRows };
    }

    results.push({
      field_code: code,
      field_name: String(field.name),
      studies: { columns: STUDIES_COLUMNS, rows: studies.map((s) => pick(s, STUDIES_COLUMNS)) },
      params: { columns: nonEmptyColumns(paramsColumns, paramsRows), rows: paramsRows },
      points: { columns: POINTS_COLUMNS, rows: points },
      pvt,
      pump,
    });
  }
  return results;
}
