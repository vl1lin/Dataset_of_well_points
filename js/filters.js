// @ts-check
// Модуль filters.js — панель выбора: мультиселекты месторождений и скважин, флаги, кнопки.
//
// Схема взаимодействия:
//   экспортирует initFilters(data, handlers)  <- вызывает main.js после загрузки данных
//     data      — Dataset из data.js (берём fields, studies, pump_intake);
//     handlers.onShow(state) — вызывается по кнопке «Показать», получает FilterState;
//     handlers.onDownload()  — вызывается по кнопке «Скачать .xlsx»;
//     возвращает { getState, setDownloadEnabled } — main.js включает кнопку выгрузки, когда есть результат;
//   экспортирует buildWellGroups(data, fieldCodes, includePump) — чистая функция
//     (без DOM): список скважин, сгруппированный по месторождениям;
//   FilterState уйдёт дальше в query.js (этап 3).

import { wellId } from './query.js';

/** @typedef {import('./data.js').Dataset} Dataset */

/**
 * Скважина в списке выбора.
 * @typedef {Object} WellOption
 * @property {string} key    ключ внутри месторождения: номер скважины или «#<study_code>» для безномерных
 * @property {string} label  подпись в списке
 */

/**
 * Группа скважин одного месторождения.
 * @typedef {Object} WellGroup
 * @property {string} field_code
 * @property {string} title      «Название (код)»
 * @property {WellOption[]} wells
 */

/**
 * Состояние фильтра, которое получает запрос.
 * @typedef {Object} FilterState
 * @property {string[]} fieldCodes  выбранные месторождения (в порядке таблицы fields)
 * @property {string[]} wellIds     выбранные скважины в виде «<field_code>|<key>»
 * @property {boolean} showPvt      показывать PVT-свойства
 * @property {boolean} hidePump     скрыть режим работы ЭЦН/ШСН
 */

const collator = new Intl.Collator('ru', { numeric: true });

/**
 * Строит список скважин, сгруппированный по месторождениям.
 * Скважины берутся из studies и (если includePump) из pump_intake — объединением.
 * Исследования без номера скважины показываются как «без номера (<study_code>)» и идут в конце.
 * @param {Dataset} data все таблицы
 * @param {string[]} fieldCodes коды месторождений, для которых строим список
 * @param {boolean} includePump добавлять ли скважины из pump_intake
 * @returns {WellGroup[]} группы в порядке таблицы fields
 */
export function buildWellGroups(data, fieldCodes, includePump) {
  const wanted = new Set(fieldCodes);
  /** @type {WellGroup[]} */
  const groups = [];

  for (const field of data.fields) {
    const code = String(field.code);
    if (!wanted.has(code)) continue;

    /** @type {Map<string, WellOption>} */
    const numbered = new Map();
    /** @type {WellOption[]} */
    const unnumbered = [];

    for (const study of data.studies) {
      if (study.field_code !== code) continue;
      if (study.well === null) {
        unnumbered.push({
          key: `#${study.study_code}`,
          label: `без номера (${study.study_code})`,
        });
      } else {
        const well = String(study.well);
        numbered.set(well, { key: well, label: well });
      }
    }

    if (includePump) {
      for (const row of data.pump_intake) {
        if (row.field_code !== code || row.well === null) continue;
        const well = String(row.well);
        numbered.set(well, { key: well, label: well });
      }
    }

    const wells = [...numbered.values()].sort((a, b) => collator.compare(a.label, b.label));
    unnumbered.sort((a, b) => collator.compare(a.label, b.label));

    groups.push({
      field_code: code,
      title: `${field.name} (${code})`,
      wells: [...wells, ...unnumbered],
    });
  }
  return groups;
}

/**
 * Всплывающий список: кнопка-заголовок и меню, которое закрывается кликом снаружи.
 * @param {HTMLElement} root элемент .dropdown с кнопкой .dropdown-toggle и меню .dropdown-menu
 * @returns {{menu: HTMLElement, setLabel: (text: string) => void, setDisabled: (value: boolean) => void}}
 */
function createDropdown(root) {
  const toggle = /** @type {HTMLButtonElement} */ (root.querySelector('.dropdown-toggle'));
  const menu = /** @type {HTMLElement} */ (root.querySelector('.dropdown-menu'));

  toggle.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', (event) => {
    if (!root.contains(/** @type {Node} */ (event.target))) menu.hidden = true;
  });

  return {
    menu,
    setLabel: (text) => {
      toggle.textContent = text;
    },
    setDisabled: (value) => {
      toggle.disabled = value;
      if (value) menu.hidden = true;
    },
  };
}

/**
 * Находит элемент по id и проверяет, что он есть.
 * @template {HTMLElement} T
 * @param {string} id
 * @returns {T}
 */
function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`В index.html нет элемента #${id}`);
  return /** @type {T} */ (el);
}

/**
 * Подключает панель выбора к странице.
 * @param {Dataset} data все таблицы
 * @param {{onShow: (state: FilterState) => void, onDownload: () => void}} handlers обработчики кнопок
 * @returns {{getState: () => FilterState, setDownloadEnabled: (value: boolean) => void}}
 */
export function initFilters(data, handlers) {
  const allCodes = data.fields.map((f) => String(f.code));

  const fieldsDropdown = createDropdown(byId('fields-dropdown'));
  const wellsDropdown = createDropdown(byId('wells-dropdown'));
  const allFieldsCheck = /** @type {HTMLInputElement} */ (byId('fields-all'));
  const pvtCheck = /** @type {HTMLInputElement} */ (byId('flag-pvt'));
  const hidePumpCheck = /** @type {HTMLInputElement} */ (byId('flag-hide-pump'));
  const showBtn = /** @type {HTMLButtonElement} */ (byId('btn-show'));
  const downloadBtn = /** @type {HTMLButtonElement} */ (byId('btn-download'));

  /** @type {Set<string>} */
  const selectedFields = new Set();
  /** @type {Set<string>} */
  const selectedWells = new Set();
  /** @type {WellGroup[]} */
  let groups = [];

  /**
   * Коды месторождений, по которым идёт отбор (с учётом «Выбрать все»).
   * @returns {string[]}
   */
  function effectiveFields() {
    return allFieldsCheck.checked ? allCodes : allCodes.filter((c) => selectedFields.has(c));
  }

  /**
   * Собирает текущее состояние фильтра.
   * @returns {FilterState}
   */
  function getState() {
    return {
      fieldCodes: effectiveFields(),
      wellIds: [...selectedWells],
      showPvt: pvtCheck.checked,
      hidePump: hidePumpCheck.checked,
    };
  }

  /** Рисует чекбоксы месторождений (один раз, список не меняется). */
  function renderFieldsMenu() {
    fieldsDropdown.menu.innerHTML = '';
    for (const field of data.fields) {
      const code = String(field.code);
      const label = document.createElement('label');
      label.className = 'menu-item';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = code;
      label.append(input, ` ${field.name} (${code})`);
      fieldsDropdown.menu.append(label);
    }
  }

  /** Обновляет галочки месторождений и подпись кнопки. */
  function syncFieldsUi() {
    const all = allFieldsCheck.checked;
    fieldsDropdown.menu.querySelectorAll('input').forEach((input) => {
      input.checked = all || selectedFields.has(input.value);
    });
    fieldsDropdown.setDisabled(all);
    const count = effectiveFields().length;
    fieldsDropdown.setLabel(count === 0 ? 'Не выбрано' : `Выбрано: ${count}`);
  }

  /** Обновляет галочки скважин (в т.ч. «все скважины месторождения») и подпись кнопки. */
  function syncWellsUi() {
    wellsDropdown.menu.querySelectorAll('input[data-well]').forEach((el) => {
      const input = /** @type {HTMLInputElement} */ (el);
      input.checked = selectedWells.has(/** @type {string} */ (input.dataset.well));
    });
    wellsDropdown.menu.querySelectorAll('input[data-group]').forEach((el) => {
      const input = /** @type {HTMLInputElement} */ (el);
      const group = groups.find((g) => g.field_code === input.dataset.group);
      const ids = group ? group.wells.map((w) => wellId(group.field_code, w.key)) : [];
      const selected = ids.filter((id) => selectedWells.has(id)).length;
      input.checked = ids.length > 0 && selected === ids.length;
      input.indeterminate = selected > 0 && selected < ids.length;
    });
    wellsDropdown.setLabel(selectedWells.size === 0 ? 'Не выбрано' : `Выбрано: ${selectedWells.size}`);
  }

  /**
   * Пересобирает список скважин под текущие месторождения и флаг,
   * сбрасывая выбранные скважины, которых в списке больше нет.
   */
  function rebuildWells() {
    groups = buildWellGroups(data, effectiveFields(), !hidePumpCheck.checked);

    const valid = new Set(groups.flatMap((g) => g.wells.map((w) => wellId(g.field_code, w.key))));
    for (const id of [...selectedWells]) {
      if (!valid.has(id)) selectedWells.delete(id);
    }

    const menu = wellsDropdown.menu;
    menu.innerHTML = '';
    if (groups.length === 0) {
      menu.textContent = 'Сначала выберите месторождения';
    }
    for (const group of groups) {
      const head = document.createElement('div');
      head.className = 'menu-group-title';
      head.textContent = group.title;
      menu.append(head);

      const all = document.createElement('label');
      all.className = 'menu-item menu-item-all';
      const allInput = document.createElement('input');
      allInput.type = 'checkbox';
      allInput.dataset.group = group.field_code;
      all.append(allInput, ' Выбрать все скважины месторождения');
      menu.append(all);

      for (const well of group.wells) {
        const label = document.createElement('label');
        label.className = 'menu-item';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.well = wellId(group.field_code, well.key);
        label.append(input, ` ${well.label}`);
        menu.append(label);
      }
    }
    syncWellsUi();
  }

  /** Обновляет всё, что зависит от выбора месторождений. */
  function onFieldsChanged() {
    syncFieldsUi();
    rebuildWells();
    showBtn.disabled = effectiveFields().length === 0;
  }

  fieldsDropdown.menu.addEventListener('change', (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    if (input.checked) selectedFields.add(input.value);
    else selectedFields.delete(input.value);
    onFieldsChanged();
  });

  allFieldsCheck.addEventListener('change', onFieldsChanged);
  hidePumpCheck.addEventListener('change', rebuildWells);

  wellsDropdown.menu.addEventListener('change', (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    if (input.dataset.well) {
      if (input.checked) selectedWells.add(input.dataset.well);
      else selectedWells.delete(input.dataset.well);
    } else if (input.dataset.group) {
      const group = groups.find((g) => g.field_code === input.dataset.group);
      for (const well of group ? group.wells : []) {
        const id = wellId(/** @type {WellGroup} */ (group).field_code, well.key);
        if (input.checked) selectedWells.add(id);
        else selectedWells.delete(id);
      }
    }
    syncWellsUi();
  });

  showBtn.addEventListener('click', () => handlers.onShow(getState()));
  downloadBtn.addEventListener('click', () => handlers.onDownload());

  renderFieldsMenu();
  onFieldsChanged();

  return {
    getState,
    setDownloadEnabled: (value) => {
      downloadBtn.disabled = !value;
    },
  };
}
