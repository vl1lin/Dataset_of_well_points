// @ts-check
// Модуль builder-sql.js — состояние конструктора -> текст SQL. Чистая функция, без DOM.
//
// Схема взаимодействия:
//   экспортирует buildSql(state, mainFilter)  <- вызывает builder-ui.js по кнопкам
//     «Выполнить», «Показать SQL» и «Открыть в SQL-режиме»;
//     state      — BuilderState: выбранные колонки, условия, группировка, сортировка (см. typedef ниже);
//     mainFilter — выбор месторождений и скважин с главной панели (используется, если state.useMain);
//     результат  — { sql, columns } или { error }: columns описывает колонки результата
//     (псевдоним в SQL и русский заголовок), чтобы панель показала «Среднее: Забойное давление, МПа»;
//   экспортирует describeOutput(state)  <- builder-ui.js (список колонок для сортировки);
//   экспортирует OPERATORS и AGGREGATES  <- builder-ui.js (выпадающие списки).
//   Имена таблиц и колонок берутся только из schema.js (белый список), значения экранируются.
//
// Связи таблиц подбираются автоматически по тому, какие таблицы затронуты колонками и условиями:
//   studies <-> points по study_code; studies <-> fields по field_code;
//   studies -> fluids (LEFT JOIN) по field_code + horizon; pump_intake <-> fields по field_code.
//   pump_intake со studies, points и fluids не связывается: общих скважин мало, связь неоднозначна.

import { TABLES, parseKey, columnTitle } from './schema.js';

/**
 * Условие отбора.
 * @typedef {Object} Condition
 * @property {string} key       колонка, ключ «таблица.колонка»
 * @property {string} op        код оператора (см. OPERATORS)
 * @property {string} value     число или первая граница «между» (как ввёл пользователь)
 * @property {string} value2    вторая граница «между»
 * @property {string[]} values  выбранные значения для «равно одному из» / «не равно ни одному из»
 */

/**
 * Агрегат.
 * @typedef {Object} Aggregate
 * @property {'count' | 'avg' | 'min' | 'max' | 'sum'} fn
 * @property {string | null} key колонка; null — «количество строк»
 */

/**
 * Сортировка по колонке результата.
 * @typedef {Object} SortItem
 * @property {string} key ключ колонки результата (см. OutputColumn.key)
 * @property {'asc' | 'desc'} dir
 */

/**
 * Состояние конструктора.
 * @typedef {Object} BuilderState
 * @property {string[]} columns        шаг 1: выбранные колонки
 * @property {Condition[]} conditions  шаг 2: условия
 * @property {'and' | 'or'} combine    как объединять условия
 * @property {string[]} groupBy        шаг 3: колонки группировки
 * @property {Aggregate[]} aggregates  шаг 3: агрегаты
 * @property {SortItem[]} sort         шаг 4: сортировка
 * @property {boolean} useMain         шаг 5: учитывать выбор с главной панели
 */

/**
 * Выбор с главной панели.
 * @typedef {Object} MainFilter
 * @property {string[]} fieldCodes выбранные месторождения
 * @property {string[]} wellIds    выбранные скважины, формат «<field_code>|<ключ>» (см. query.js)
 */

/**
 * Колонка результата.
 * @typedef {Object} OutputColumn
 * @property {string} key    ключ для сортировки: «таблица.колонка» или «функция:таблица.колонка»
 * @property {string} alias  имя колонки в SQL
 * @property {string} title  русский заголовок
 * @property {string | null} table таблица колонки (null для «количество строк»)
 */

/** Операторы условий по типам колонок. */
export const OPERATORS = {
  number: [
    { id: 'eq', label: '=' },
    { id: 'ne', label: '≠' },
    { id: 'gt', label: '>' },
    { id: 'ge', label: '≥' },
    { id: 'lt', label: '<' },
    { id: 'le', label: '≤' },
    { id: 'between', label: 'между' },
    { id: 'null', label: 'пусто' },
    { id: 'notnull', label: 'не пусто' },
  ],
  text: [
    { id: 'in', label: 'равно одному из' },
    { id: 'notin', label: 'не равно ни одному из' },
    { id: 'null', label: 'пусто' },
    { id: 'notnull', label: 'не пусто' },
  ],
};

/** Агрегаты: код, подпись и SQL-функция. */
export const AGGREGATES = [
  { id: 'count', label: 'Количество', sql: 'COUNT' },
  { id: 'avg', label: 'Среднее', sql: 'AVG' },
  { id: 'min', label: 'Минимум', sql: 'MIN' },
  { id: 'max', label: 'Максимум', sql: 'MAX' },
  { id: 'sum', label: 'Сумма', sql: 'SUM' },
];

const COMPARE_SQL = { eq: '=', ne: '<>', gt: '>', ge: '>=', lt: '<', le: '<=' };

/**
 * Находит агрегат по коду.
 * @param {string} id
 * @returns {typeof AGGREGATES[number]}
 */
function aggregateInfo(id) {
  const info = AGGREGATES.find((a) => a.id === id);
  if (!info) throw new Error(`Неизвестный агрегат «${id}»`);
  return info;
}

/**
 * Ошибка пользователя: её текст показывается в панели как есть.
 */
class BuilderError extends Error {}

/**
 * Берёт колонку по ключу из схемы или бросает ошибку (белый список).
 * @param {string} key
 * @returns {{table: string, column: string, type: import('./schema.js').ColType}}
 */
function need(key) {
  const parsed = parseKey(key);
  if (!parsed) throw new BuilderError(`Неизвестная колонка «${key}»`);
  return parsed;
}

/**
 * Выбирает уникальные псевдонимы: первый вариант, а при повторе — второй, затем с номером.
 * @param {[string, string][]} candidates пары «предпочтительный, запасной»
 * @returns {string[]}
 */
function pickAliases(candidates) {
  const used = new Set();
  return candidates.map(([first, second]) => {
    let alias = used.has(first) ? second : first;
    for (let n = 2; used.has(alias); n += 1) alias = `${second}_${n}`;
    used.add(alias);
    return alias;
  });
}

/**
 * Работает ли запрос в режиме группировки (есть колонки группировки или агрегаты).
 * @param {BuilderState} state
 * @returns {boolean}
 */
function isGrouped(state) {
  return state.groupBy.length > 0 || state.aggregates.length > 0;
}

/**
 * Описывает колонки результата: в режиме группировки — колонки группировки и агрегаты,
 * иначе — колонки шага 1.
 * @param {BuilderState} state
 * @returns {OutputColumn[]}
 */
export function describeOutput(state) {
  /** @type {{key: string, table: string | null, title: string, primary: string, secondary: string}[]} */
  const items = [];

  const keys = isGrouped(state) ? state.groupBy : state.columns;
  for (const key of keys) {
    const { table, column } = need(key);
    items.push({ key, table, title: columnTitle(key), primary: column, secondary: `${table}_${column}` });
  }
  for (const agg of state.aggregates) {
    const label = aggregateInfo(agg.fn).label;
    if (agg.key === null) {
      items.push({ key: `${agg.fn}:*`, table: null, title: 'Количество строк', primary: `${agg.fn}_all`, secondary: `${agg.fn}_all` });
    } else {
      const { table, column } = need(agg.key);
      items.push({
        key: `${agg.fn}:${agg.key}`,
        table,
        title: `${label}: ${columnTitle(agg.key)}`,
        primary: `${agg.fn}_${column}`,
        secondary: `${agg.fn}_${table}_${column}`,
      });
    }
  }

  const aliases = pickAliases(items.map((i) => [i.primary, i.secondary]));

  // Одинаковые заголовки (например, «Горизонт» из исследований и из залежей) различаем по таблице.
  const titleCount = new Map();
  for (const i of items) titleCount.set(i.title, (titleCount.get(i.title) ?? 0) + 1);

  return items.map((item, index) => ({
    key: item.key,
    alias: aliases[index],
    table: item.table,
    title:
      item.table !== null && (titleCount.get(item.title) ?? 0) > 1
        ? `${item.title} — ${TABLES[item.table].label}`
        : item.title,
  }));
}

/**
 * Экранирует текстовое значение для SQL-литерала в одинарных кавычках.
 * @param {string} value
 * @returns {string}
 */
function quote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Разбирает число, введённое пользователем (десятичный разделитель — точка или запятая).
 * @param {string} text введённый текст
 * @param {string} key колонка (для сообщения об ошибке)
 * @returns {string} число в виде SQL-литерала
 */
function toNumber(text, key) {
  const cleaned = text.trim().replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(cleaned) || !Number.isFinite(Number(cleaned))) {
    throw new BuilderError(`В условии для «${columnTitle(key)}» нужно число, а введено «${text}».`);
  }
  return String(Number(cleaned));
}

/**
 * Превращает одно условие в SQL-выражение.
 * @param {Condition} cond
 * @returns {string}
 */
function conditionSql(cond) {
  const { table, column, type } = need(cond.key);
  const col = `${TABLES[table].alias}.${column}`;
  const title = columnTitle(cond.key);

  if (!OPERATORS[type].some((o) => o.id === cond.op)) {
    throw new BuilderError(`Оператор «${cond.op}» не подходит для колонки «${title}».`);
  }

  switch (cond.op) {
    case 'null':
      return `${col} IS NULL`;
    case 'notnull':
      return `${col} IS NOT NULL`;
    case 'between': {
      const a = Number(toNumber(cond.value, cond.key));
      const b = Number(toNumber(cond.value2, cond.key));
      return `${col} BETWEEN ${Math.min(a, b)} AND ${Math.max(a, b)}`;
    }
    case 'in':
    case 'notin': {
      if (cond.values.length === 0) throw new BuilderError(`В условии для «${title}» выберите хотя бы одно значение.`);
      const list = cond.values.map(quote).join(', ');
      return `${col} ${cond.op === 'in' ? 'IN' : 'NOT IN'} (${list})`;
    }
    default:
      return `${col} ${/** @type {Record<string, string>} */ (COMPARE_SQL)[cond.op]} ${toNumber(cond.value, cond.key)}`;
  }
}

/**
 * Собирает FROM с JOIN по набору затронутых таблиц.
 * @param {Set<string>} used затронутые таблицы
 * @returns {{from: string, base: 'pump_intake' | 'studies' | 'points' | 'fluids' | 'fields'}}
 */
function buildFrom(used) {
  const a = (/** @type {string} */ t) => TABLES[t].alias;

  if (used.has('pump_intake')) {
    const others = ['studies', 'points', 'fluids'].filter((t) => used.has(t));
    if (others.length > 0) {
      throw new BuilderError(
        'Колонки из группы «Режимы насосов» нельзя совмещать с колонками исследований, замеров по глубине ' +
          'и свойств по залежам: общих скважин мало, связь неоднозначна. Оставьте колонки одной из групп.',
      );
    }
    let from = 'FROM pump_intake pi';
    if (used.has('fields')) from += '\nJOIN fields f ON f.code = pi.field_code';
    return { from, base: 'pump_intake' };
  }

  const needStudies = used.has('studies') || (used.has('points') && (used.has('fields') || used.has('fluids')));
  if (needStudies) {
    let from = 'FROM studies s';
    if (used.has('points')) from += '\nJOIN points p ON p.study_code = s.study_code';
    if (used.has('fields')) from += '\nJOIN fields f ON f.code = s.field_code';
    if (used.has('fluids')) from += '\nLEFT JOIN fluids fl ON fl.field_code = s.field_code AND fl.horizon = s.horizon';
    return { from, base: 'studies' };
  }
  if (used.has('points')) return { from: 'FROM points p', base: 'points' };
  if (used.has('fluids')) {
    let from = 'FROM fluids fl';
    if (used.has('fields')) from += `\nJOIN fields ${a('fields')} ON ${a('fields')}.code = fl.field_code`;
    return { from, base: 'fluids' };
  }
  return { from: 'FROM fields f', base: 'fields' };
}

/**
 * Условие по выбору с главной панели для базовой таблицы запроса.
 * @param {'pump_intake' | 'studies' | 'points' | 'fluids' | 'fields'} base
 * @param {MainFilter} main
 * @returns {string}
 */
function mainFilterSql(base, main) {
  const byWell = base === 'pump_intake' || base === 'studies' || base === 'points';
  if (byWell && main.wellIds.length === 0) {
    throw new BuilderError(
      'Включён учёт главной панели, но скважины там не выбраны. Выберите скважины или снимите галочку.',
    );
  }
  if (!byWell && main.fieldCodes.length === 0) {
    throw new BuilderError(
      'Включён учёт главной панели, но месторождения там не выбраны. Выберите месторождения или снимите галочку.',
    );
  }

  const wells = main.wellIds.map(quote).join(', ');
  switch (base) {
    case 'pump_intake':
      return `(pi.field_code || '|' || pi.well) IN (${wells})`;
    case 'studies':
      return `(s.field_code || '|' || COALESCE(s.well, '#' || s.study_code)) IN (${wells})`;
    case 'points':
      return (
        "p.study_code IN (SELECT study_code FROM studies WHERE " +
        `(field_code || '|' || COALESCE(well, '#' || study_code)) IN (${wells}))`
      );
    case 'fluids':
      return `fl.field_code IN (${main.fieldCodes.map(quote).join(', ')})`;
    default:
      return `f.code IN (${main.fieldCodes.map(quote).join(', ')})`;
  }
}

/**
 * Строит SQL по состоянию конструктора.
 * @param {BuilderState} state состояние конструктора
 * @param {MainFilter} mainFilter выбор с главной панели
 * @returns {{sql: string, columns: OutputColumn[]} | {error: string}} запрос или понятное сообщение об ошибке
 */
export function buildSql(state, mainFilter) {
  try {
    const grouped = isGrouped(state);
    const columns = describeOutput(state);
    if (columns.length === 0) throw new BuilderError('Выберите хотя бы одну колонку.');

    // Тип агрегатов проверяем заранее: среднее и сумма только для чисел.
    for (const agg of state.aggregates) {
      if (agg.key !== null && (agg.fn === 'avg' || agg.fn === 'sum') && need(agg.key).type !== 'number') {
        throw new BuilderError(`«${aggregateInfo(agg.fn).label}» считается только для числовых колонок: «${columnTitle(agg.key)}».`);
      }
    }

    // Какие таблицы затронуты: колонки результата и колонки условий.
    const used = new Set();
    const outputKeys = grouped
      ? [...state.groupBy, ...state.aggregates.map((g) => g.key).filter((k) => k !== null)]
      : state.columns;
    for (const key of [...outputKeys, ...state.conditions.map((c) => c.key)]) {
      used.add(need(/** @type {string} */ (key)).table);
    }
    if (used.size === 0) {
      throw new BuilderError('Для «Количество строк» добавьте колонку группировки или условие: иначе неясно, из какой таблицы считать.');
    }

    const { from, base } = buildFrom(used);

    /** @type {string[]} */
    const where = [];
    if (state.useMain) where.push(mainFilterSql(base, mainFilter));
    if (state.conditions.length > 0) {
      const joiner = state.combine === 'or' ? ' OR ' : ' AND ';
      where.push(`(${state.conditions.map(conditionSql).join(joiner)})`);
    }

    // SELECT: выражение + псевдоним для каждой колонки результата.
    const ref = (/** @type {string} */ key) => {
      const { table, column } = need(key);
      return `${TABLES[table].alias}.${column}`;
    };
    const selectParts = columns.map((col) => {
      const sep = col.key.indexOf(':');
      if (sep < 0) return `  ${ref(col.key)} AS "${col.alias}"`;
      const fn = aggregateInfo(col.key.slice(0, sep)).sql;
      const target = col.key.slice(sep + 1);
      return `  ${fn}(${target === '*' ? '*' : ref(target)}) AS "${col.alias}"`;
    });

    const lines = [`SELECT\n${selectParts.join(',\n')}`, from];
    if (where.length > 0) lines.push(`WHERE ${where.join('\n  AND ')}`);
    if (state.groupBy.length > 0) lines.push(`GROUP BY ${state.groupBy.map(ref).join(', ')}`);

    if (state.sort.length > 0) {
      const order = state.sort.map((item) => {
        const col = columns.find((c) => c.key === item.key);
        if (!col) throw new BuilderError('Сортировка задана по колонке, которой нет в результате.');
        return `"${col.alias}" ${item.dir === 'desc' ? 'DESC' : 'ASC'}`;
      });
      lines.push(`ORDER BY ${order.join(', ')}`);
    }

    return { sql: lines.join('\n'), columns };
  } catch (error) {
    if (error instanceof BuilderError) return { error: error.message };
    throw error;
  }
}
