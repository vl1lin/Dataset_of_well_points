// @ts-check
// Модуль builder-ui.js — интерфейс конструктора выборки (режим «Конструктор» боковой панели).
//
// Схема взаимодействия:
//   экспортирует initBuilder(container, handlers)  <- вызывает main.js;
//     handlers.getMainFilter() — выбор месторождений и скважин с главной панели (MainFilter);
//     handlers.onOpenInSql(sql) — «Открыть в SQL-режиме»: main.js кладёт запрос во вкладку SQL;
//   из schema.js берёт группы и колонки, из builder-sql.js — buildSql() и списки операторов;
//   запрос выполняет движок из duckdb.js (getDb), результат рисует result-view.js.
//   Состояние (BuilderState) хранится здесь; текст SQL строит только builder-sql.js.

import { GROUPS, listColumns, parseKey } from './schema.js';
import { AGGREGATES, OPERATORS, buildSql, describeOutput } from './builder-sql.js';
import { getDb } from './duckdb.js';
import { createResultView } from './result-view.js';

/** @typedef {import('./builder-sql.js').BuilderState} BuilderState */
/** @typedef {import('./builder-sql.js').Condition} Condition */
/** @typedef {import('./builder-sql.js').MainFilter} MainFilter */

/**
 * Создаёт элемент с классом и текстом.
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Создаёт кнопку.
 * @param {string} text
 * @param {string} [className]
 * @returns {HTMLButtonElement}
 */
function button(text, className) {
  const b = /** @type {HTMLButtonElement} */ (el('button', className, text));
  b.type = 'button';
  return b;
}

/**
 * Создаёт выпадающий список.
 * @param {[string, string][]} options пары «значение, подпись»
 * @param {string} value выбранное значение
 * @returns {HTMLSelectElement}
 */
function select(options, value) {
  const s = /** @type {HTMLSelectElement} */ (el('select'));
  for (const [v, label] of options) s.append(new Option(label, v));
  s.value = value;
  return s;
}

/**
 * Создаёт выпадающий список колонок, сгруппированных по смысловым группам.
 * @param {{key: string, title: string, group: string}[]} columns колонки для списка
 * @param {string} value выбранный ключ
 * @returns {HTMLSelectElement}
 */
function columnSelect(columns, value) {
  const s = /** @type {HTMLSelectElement} */ (el('select', 'column-select'));
  /** @type {Map<string, HTMLOptGroupElement>} */
  const groups = new Map();
  for (const col of columns) {
    let group = groups.get(col.group);
    if (!group) {
      group = document.createElement('optgroup');
      group.label = col.group;
      groups.set(col.group, group);
      s.append(group);
    }
    group.append(new Option(col.title, col.key));
  }
  s.value = value;
  return s;
}

/**
 * Подключает конструктор выборки к контейнеру.
 * @param {HTMLElement} container пустой контейнер вкладки «Конструктор»
 * @param {{getMainFilter: () => MainFilter, onOpenInSql: (sql: string) => void,
 *   onSendToPython: (columns: string[], rows: import('./data.js').Row[]) => void}} handlers
 *   onSendToPython — кнопка «Передать в Python» под результатом
 */
export function initBuilder(container, { getMainFilter, onOpenInSql, onSendToPython }) {
  const allColumns = listColumns();
  const numberColumns = allColumns.filter((c) => c.type === 'number');

  /** Состояние конструктора. columns хранится как набор и упорядочивается по схеме при сборке. */
  const selectedColumns = new Set();
  /** @type {Omit<BuilderState, 'columns'>} */
  const state = { conditions: [], combine: 'and', groupBy: [], aggregates: [], sort: [], useMain: true };

  /**
   * Собирает полное состояние для builder-sql.js.
   * @returns {BuilderState}
   */
  function getState() {
    return { ...state, columns: allColumns.filter((c) => selectedColumns.has(c.key)).map((c) => c.key) };
  }

  // ---------- Шаг 1. Колонки ----------

  const columnsBox = el('div', 'builder-groups');
  GROUPS.forEach((group, index) => {
    const details = /** @type {HTMLDetailsElement} */ (el('details', 'builder-group'));
    details.open = index === 0;
    details.append(el('summary', '', group.title));
    for (const key of group.keys) {
      const col = allColumns.find((c) => c.key === key);
      if (!col) continue;
      const label = el('label', 'menu-item');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.key = key;
      label.append(input, ` ${col.title}`);
      details.append(label);
    }
    columnsBox.append(details);
  });
  columnsBox.addEventListener('change', (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    const key = /** @type {string} */ (input.dataset.key);
    // Одна и та же колонка может встречаться в группах один раз; синхронизируем галочку.
    if (input.checked) selectedColumns.add(key);
    else selectedColumns.delete(key);
    renderSort();
  });

  // ---------- Шаг 2. Условия ----------

  const combineSelect = select([['and', 'все условия (И)'], ['or', 'любое из условий (ИЛИ)']], 'and');
  combineSelect.addEventListener('change', () => {
    state.combine = /** @type {'and' | 'or'} */ (combineSelect.value);
  });
  const conditionsBox = el('div', 'builder-rows');
  const addConditionBtn = button('+ условие');
  addConditionBtn.addEventListener('click', () => {
    state.conditions.push({ key: allColumns[0].key, op: OPERATORS.text[0].id, value: '', value2: '', values: [] });
    renderConditions();
  });

  /** @type {Map<string, Promise<string[]>>} */
  const uniqueValues = new Map();

  /**
   * Уникальные значения текстовой колонки (для списка «равно одному из»).
   * Имя таблицы и колонки берётся только из схемы, поэтому подставлять в запрос безопасно.
   * @param {string} key ключ «таблица.колонка»
   * @returns {Promise<string[]>}
   */
  function loadUniqueValues(key) {
    let promise = uniqueValues.get(key);
    if (!promise) {
      const parsed = /** @type {NonNullable<ReturnType<typeof parseKey>>} */ (parseKey(key));
      promise = getDb()
        .then((db) =>
          db.runSql(
            `SELECT DISTINCT ${parsed.column} AS v FROM ${parsed.table} WHERE ${parsed.column} IS NOT NULL ORDER BY 1`,
          ),
        )
        .then((result) => result.rows.map((r) => String(r.v)));
      promise.catch(() => uniqueValues.delete(key)); // при ошибке в следующий раз попробуем снова
      uniqueValues.set(key, promise);
    }
    return promise;
  }

  /**
   * Строит поля значений условия в зависимости от оператора.
   * @param {Condition} cond
   * @returns {HTMLElement}
   */
  function conditionValues(cond) {
    const box = el('span', 'cond-values');
    if (cond.op === 'null' || cond.op === 'notnull') return box;

    if (cond.op === 'in' || cond.op === 'notin') {
      const list = /** @type {HTMLSelectElement} */ (el('select', 'cond-list'));
      list.multiple = true;
      list.size = 5;
      list.append(new Option('Загрузка значений…', '', false, false));
      list.disabled = true;
      loadUniqueValues(cond.key)
        .then((values) => {
          list.replaceChildren();
          for (const v of values) list.append(new Option(v, v, false, cond.values.includes(v)));
          list.disabled = false;
        })
        .catch((error) => {
          list.replaceChildren(new Option(`Не удалось загрузить: ${error.message}`, ''));
        });
      list.addEventListener('change', () => {
        cond.values = [...list.selectedOptions].map((o) => o.value);
      });
      box.append(list);
      return box;
    }

    const first = /** @type {HTMLInputElement} */ (el('input', 'cond-input'));
    first.type = 'text';
    first.inputMode = 'decimal';
    first.value = cond.value;
    first.addEventListener('input', () => {
      cond.value = first.value;
    });
    box.append(first);
    if (cond.op === 'between') {
      const second = /** @type {HTMLInputElement} */ (el('input', 'cond-input'));
      second.type = 'text';
      second.inputMode = 'decimal';
      second.value = cond.value2;
      second.addEventListener('input', () => {
        cond.value2 = second.value;
      });
      box.append(' и ', second);
    }
    return box;
  }

  /** Перерисовывает строки условий. */
  function renderConditions() {
    conditionsBox.replaceChildren();
    state.conditions.forEach((cond, index) => {
      const row = el('div', 'builder-row');
      const colSel = columnSelect(allColumns, cond.key);
      const type = /** @type {'number' | 'text'} */ (parseKey(cond.key)?.type ?? 'text');
      const opSel = select(OPERATORS[type].map((o) => [o.id, o.label]), cond.op);
      const remove = button('✕', 'icon-btn');

      colSel.addEventListener('change', () => {
        cond.key = colSel.value;
        const newType = /** @type {'number' | 'text'} */ (parseKey(cond.key)?.type ?? 'text');
        cond.op = OPERATORS[newType][0].id;
        cond.value = '';
        cond.value2 = '';
        cond.values = [];
        renderConditions();
      });
      opSel.addEventListener('change', () => {
        cond.op = opSel.value;
        renderConditions();
      });
      remove.addEventListener('click', () => {
        state.conditions.splice(index, 1);
        renderConditions();
      });

      row.append(colSel, opSel, conditionValues(cond), remove);
      conditionsBox.append(row);
    });
  }

  // ---------- Шаг 3. Группировка ----------

  const groupChips = el('div', 'builder-chips');
  const groupAddSelect = columnSelect(allColumns, allColumns[0].key);
  const groupAddBtn = button('+ колонка группировки');
  groupAddBtn.addEventListener('click', () => {
    if (!state.groupBy.includes(groupAddSelect.value)) state.groupBy.push(groupAddSelect.value);
    renderGroup();
  });

  const aggBox = el('div', 'builder-rows');
  const addAggBtn = button('+ агрегат');
  addAggBtn.addEventListener('click', () => {
    state.aggregates.push({ fn: 'count', key: null });
    renderGroup();
  });

  /** Перерисовывает шаг 3 и зависящий от него шаг 4. */
  function renderGroup() {
    groupChips.replaceChildren();
    state.groupBy.forEach((key, index) => {
      const chip = el('span', 'chip', allColumns.find((c) => c.key === key)?.title ?? key);
      const remove = button('✕', 'icon-btn');
      remove.addEventListener('click', () => {
        state.groupBy.splice(index, 1);
        renderGroup();
      });
      chip.append(remove);
      groupChips.append(chip);
    });

    aggBox.replaceChildren();
    state.aggregates.forEach((agg, index) => {
      const row = el('div', 'builder-row');
      const fnSel = select(AGGREGATES.map((a) => [a.id, a.label]), agg.fn);
      const numericOnly = agg.fn === 'avg' || agg.fn === 'sum';
      const colSel = columnSelect(numericOnly ? numberColumns : allColumns, agg.key ?? '');
      if (agg.fn === 'count') colSel.prepend(new Option('— все строки —', ''));
      colSel.value = agg.key ?? (agg.fn === 'count' ? '' : colSel.value);
      const remove = button('✕', 'icon-btn');

      fnSel.addEventListener('change', () => {
        agg.fn = /** @type {typeof agg.fn} */ (fnSel.value);
        const keepsColumn = agg.key !== null && (agg.fn !== 'avg' && agg.fn !== 'sum' || parseKey(agg.key)?.type === 'number');
        if (!keepsColumn) agg.key = agg.fn === 'count' ? null : (agg.fn === 'avg' || agg.fn === 'sum' ? numberColumns : allColumns)[0].key;
        renderGroup();
      });
      colSel.addEventListener('change', () => {
        agg.key = colSel.value === '' ? null : colSel.value;
        renderSort();
      });
      remove.addEventListener('click', () => {
        state.aggregates.splice(index, 1);
        renderGroup();
      });

      row.append(fnSel, colSel, remove);
      aggBox.append(row);
    });
    renderSort();
  }

  // ---------- Шаг 4. Сортировка ----------

  const sortBox = el('div', 'builder-rows');
  const addSortBtn = button('+ сортировка');
  addSortBtn.addEventListener('click', () => {
    const outputs = describeOutput(getState());
    if (outputs.length === 0) return;
    state.sort.push({ key: outputs[0].key, dir: 'asc' });
    renderSort();
  });

  /** Перерисовывает строки сортировки; сортировки по исчезнувшим колонкам результата убираются. */
  function renderSort() {
    const outputs = describeOutput(getState());
    state.sort = state.sort.filter((item) => outputs.some((o) => o.key === item.key));

    sortBox.replaceChildren();
    state.sort.forEach((item, index) => {
      const row = el('div', 'builder-row');
      const colSel = select(outputs.map((o) => [o.key, o.title]), item.key);
      const dirSel = select([['asc', 'по возрастанию'], ['desc', 'по убыванию']], item.dir);
      const remove = button('✕', 'icon-btn');
      colSel.addEventListener('change', () => {
        item.key = colSel.value;
      });
      dirSel.addEventListener('change', () => {
        item.dir = /** @type {'asc' | 'desc'} */ (dirSel.value);
      });
      remove.addEventListener('click', () => {
        state.sort.splice(index, 1);
        renderSort();
      });
      row.append(colSel, dirSel, remove);
      sortBox.append(row);
    });
  }

  // ---------- Шаг 5–6. Главная панель, кнопки, результат ----------

  const mainCheck = /** @type {HTMLInputElement} */ (el('input'));
  mainCheck.type = 'checkbox';
  mainCheck.checked = true;
  mainCheck.addEventListener('change', () => {
    state.useMain = mainCheck.checked;
  });
  const mainLabel = el('label', 'menu-item');
  mainLabel.append(mainCheck, ' Учитывать выбор месторождений и скважин с главной панели');

  const runBtn = button('Выполнить');
  const showSqlBtn = button('Показать SQL', 'secondary');
  const toSqlBtn = button('Открыть в SQL-режиме', 'secondary');
  const sqlPre = el('pre', 'sql-preview');
  sqlPre.hidden = true;
  const warning = el(
    'p',
    'panel-note builder-warning',
    'Обратного преобразования SQL → конструктор нет: правки, сделанные во вкладке SQL, в конструктор не вернутся.',
  );
  const resultHost = el('div', 'result-host');
  const resultView = createResultView(resultHost, 'Конструктор', { onSendToPython });

  /** Обновляет окно с текстом запроса, если оно открыто. */
  function refreshSqlPreview() {
    if (sqlPre.hidden) return;
    const built = buildSql(getState(), getMainFilter());
    sqlPre.textContent = 'error' in built ? `-- ${built.error}` : built.sql;
  }

  runBtn.addEventListener('click', async () => {
    const built = buildSql(getState(), getMainFilter());
    refreshSqlPreview();
    if ('error' in built) {
      resultView.showError(built.error);
      return;
    }
    runBtn.disabled = true;
    try {
      const db = await getDb();
      const { columns, rows } = await db.runSql(built.sql);
      const titles = Object.fromEntries(built.columns.map((c) => [c.alias, c.title]));
      resultView.showResult(columns, rows, titles);
    } catch (error) {
      resultView.showError(error.message);
    } finally {
      runBtn.disabled = false;
    }
  });

  showSqlBtn.addEventListener('click', () => {
    sqlPre.hidden = !sqlPre.hidden;
    showSqlBtn.textContent = sqlPre.hidden ? 'Показать SQL' : 'Скрыть SQL';
    refreshSqlPreview();
  });

  toSqlBtn.addEventListener('click', () => {
    const built = buildSql(getState(), getMainFilter());
    if ('error' in built) {
      resultView.showError(built.error);
      return;
    }
    onOpenInSql(built.sql);
  });

  // ---------- Сборка страницы режима ----------

  /**
   * Секция конструктора: заголовок и содержимое.
   * @param {string} title
   * @param {...(Node | string)} children
   * @returns {HTMLElement}
   */
  const section = (title, ...children) => {
    const s = el('section', 'builder-section');
    s.append(el('h3', '', title), ...children);
    return s;
  };

  const groupAddRow = el('div', 'builder-row');
  groupAddRow.append(groupAddSelect, groupAddBtn);
  const actions = el('div', 'pane-actions');
  actions.append(runBtn, showSqlBtn, toSqlBtn);

  container.append(
    section('1. Колонки', columnsBox),
    section('2. Условия', combineSelect, conditionsBox, addConditionBtn),
    section(
      '3. Группировка (необязательно)',
      el(
        'p',
        'panel-note',
        'Если задана группировка или агрегат, результат состоит из колонок группировки и агрегатов; колонки шага 1 не используются.',
      ),
      groupChips,
      groupAddRow,
      aggBox,
      addAggBtn,
    ),
    section('4. Сортировка', sortBox, addSortBtn),
    section('5. Главная панель', mainLabel),
    actions,
    sqlPre,
    warning,
    resultHost,
  );

  renderConditions();
  renderGroup();
}
