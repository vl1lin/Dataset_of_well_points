// @ts-check
// Модуль panel.js — выдвижная боковая панель «Работа с данными» и переключение режимов.
//
// Схема взаимодействия:
//   экспортирует initPanel({ onFirstOpen })  <- вызывает main.js;
//     onFirstOpen вызывается один раз при первом открытии панели
//     (main.js передаёт туда загрузку DuckDB, чтобы тяжёлые библиотеки не грузились зря);
//   разметка панели лежит в index.html (#side-panel, #panel-toggle, кнопки режимов .mode-tab,
//   области режимов .mode-pane с data-mode); здесь только открытие/закрытие и выбор режима;
//   возвращает { setMode } — main.js использует его, чтобы «Открыть в SQL-режиме» переключила вкладку.
//   onModeShown(mode) — необязательный обработчик смены режима.

/**
 * Находит элемент по селектору и проверяет, что он есть.
 * @template {HTMLElement} T
 * @param {string} selector
 * @returns {T}
 */
function query(selector) {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`В index.html нет элемента ${selector}`);
  return /** @type {T} */ (node);
}

/**
 * Подключает боковую панель: ярлык на краю экрана, кнопка закрытия, вкладки режимов.
 * @param {{onFirstOpen: () => void, onModeShown?: (mode: string) => void}} handlers обработчики событий панели;
 *   onModeShown вызывается при каждом переключении режима (так Python загружается при первом показе вкладки)
 * @returns {{setMode: (mode: string) => void}} setMode переключает режим (builder, sql, python)
 */
export function initPanel({ onFirstOpen, onModeShown }) {
  const panel = query('#side-panel');
  const toggle = query('#panel-toggle');
  const closeBtn = query('#panel-close');
  const tabs = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('.mode-tab')]);
  const panes = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('.mode-pane')]);

  let opened = false;

  /**
   * Открывает или закрывает панель; при первом открытии вызывает onFirstOpen.
   * @param {boolean} open
   */
  function setOpen(open) {
    panel.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open && !opened) {
      opened = true;
      onFirstOpen();
    }
  }

  /**
   * Показывает выбранный режим и скрывает остальные.
   * @param {string} mode значение data-mode: builder, sql или python
   */
  function setMode(mode) {
    tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.mode === mode));
    panes.forEach((pane) => {
      pane.hidden = pane.dataset.mode !== mode;
    });
    if (onModeShown) onModeShown(mode);
  }

  toggle.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
  closeBtn.addEventListener('click', () => setOpen(false));
  tabs.forEach((tab) => tab.addEventListener('click', () => setMode(/** @type {string} */ (tab.dataset.mode))));

  setMode('builder');
  return { setMode };
}
