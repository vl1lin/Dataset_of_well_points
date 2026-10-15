// @ts-check
// Модуль schema.js — описание схемы для конструктора: таблицы, типы колонок, группы колонок.
//
// Схема взаимодействия:
//   экспортирует TABLES, GROUPS и функции-помощники (parseKey, columnType, columnTitle, listColumns);
//   их читают builder-sql.js (строит SQL только из имён, которые есть здесь)
//   и builder-ui.js (рисует галочки по группам и выпадающие списки колонок).
//   Это белый список: колонки, которых здесь нет (в т.ч. технические note, source, book_table),
//   в конструктор попасть не могут. В SQL-режиме доступно всё.
//
// Колонка в конструкторе задаётся ключом «таблица.колонка», например «studies.p_bh_mpa»:
//   одно и то же имя бывает в разных таблицах (well, p_sat_mpa, rho_water...).

import { getColumnTitle } from './columns.js';

/** @typedef {'text' | 'number'} ColType */

/**
 * Описание таблицы.
 * @typedef {Object} TableInfo
 * @property {string} alias    короткий псевдоним в SQL
 * @property {string} label    название для подписей (родительный падеж не нужен, просто смысл)
 * @property {Record<string, ColType>} columns колонки, доступные конструктору, и их типы
 */

/** @type {Record<string, TableInfo>} */
export const TABLES = {
  fields: {
    alias: 'f',
    label: 'месторождения',
    columns: { code: 'text', name: 'text', region: 'text' },
  },
  fluids: {
    alias: 'fl',
    label: 'залежи',
    columns: {
      horizon: 'text', t_res_c: 'number', rho_oil_res: 'number', rho_oil_dead: 'number',
      p_sat_mpa: 'number', gas_content_m3m3: 'number', b_oil: 'number',
      mu_oil_res_mpas: 'number', mu_oil_dead_mpas: 'number', rho_gas: 'number',
      y_methane_pct: 'number', y_nitrogen_pct: 'number', rho_water: 'number',
    },
  },
  studies: {
    alias: 's',
    label: 'исследования',
    columns: {
      well: 'text', study_code: 'text', horizon: 'text', lift_method: 'text',
      study_year: 'number', study_month: 'number', measured_in: 'text',
      q_liquid: 'number', q_liquid_unit: 'text', q_oil: 'number', q_oil_unit: 'text',
      q_water: 'number', q_water_unit: 'text', water_cut_pct: 'number', water_cut_type: 'text',
      d_in_m: 'number', d_out_m: 'number', casing_d_in_m: 'number', choke_mm: 'number',
      h_well_m: 'number', h_tubing_m: 'number', h_pump_m: 'number', h_gas_inj_m: 'number',
      h_dyn_m: 'number', perf_top_m: 'number', perf_bottom_m: 'number', incl_deg: 'number',
      pump_model: 'text',
      p_res_mpa: 'number', p_bh_mpa: 'number', p_wh_mpa: 'number', p_annulus_mpa: 'number',
      p_intake_mpa: 'number', p_discharge_mpa: 'number',
      t_wh_c: 'number', t_bh_c: 'number',
      gas_total_m3d: 'number', gas_annulus_m3d: 'number', gas_annulus_spec_m3m3: 'number',
      v_bubble_cms: 'number',
      p_sat_mpa: 'number', t_res_c: 'number', gas_content_m3m3: 'number', gas_sat_m3t: 'number',
      gor: 'number', gor_unit: 'text', rho_oil_dead: 'number', rho_oil_res: 'number',
      rho_gas: 'number', rho_water: 'number',
    },
  },
  points: {
    alias: 'p',
    label: 'замеры по глубине',
    columns: { depth_m: 'number', pressure_mpa: 'number', temp_c: 'number' },
  },
  pump_intake: {
    alias: 'pi',
    label: 'режимы насосов',
    columns: {
      well: 'text', lift_method: 'text', regime: 'number', h_pump_m: 'number',
      h_dyn_m: 'number', p_annulus_wh_mpa: 'number', p_intake_mpa: 'number',
    },
  },
};

/**
 * Смысловая группа колонок для шага 1 конструктора.
 * @typedef {Object} ColumnGroup
 * @property {string} id
 * @property {string} title
 * @property {string[]} keys  ключи «таблица.колонка» в порядке показа
 */

/**
 * Строит ключи колонок одной таблицы.
 * @param {string} table
 * @param {string[]} columns
 * @returns {string[]}
 */
const keys = (table, columns) => columns.map((c) => `${table}.${c}`);

/** @type {ColumnGroup[]} */
export const GROUPS = [
  {
    id: 'identification',
    title: 'Идентификация',
    keys: [
      'fields.name', 'fields.code', 'fields.region',
      ...keys('studies', ['well', 'study_code', 'horizon', 'lift_method', 'study_year', 'study_month', 'measured_in']),
    ],
  },
  {
    id: 'rates',
    title: 'Дебиты и обводнённость',
    keys: keys('studies', [
      'q_liquid', 'q_liquid_unit', 'q_oil', 'q_oil_unit', 'q_water', 'q_water_unit',
      'water_cut_pct', 'water_cut_type',
    ]),
  },
  {
    id: 'geometry',
    title: 'Геометрия',
    keys: keys('studies', [
      'd_in_m', 'd_out_m', 'casing_d_in_m', 'choke_mm', 'h_well_m', 'h_tubing_m', 'h_pump_m',
      'h_gas_inj_m', 'h_dyn_m', 'perf_top_m', 'perf_bottom_m', 'incl_deg', 'pump_model',
    ]),
  },
  {
    id: 'pressures',
    title: 'Давления',
    keys: keys('studies', ['p_res_mpa', 'p_bh_mpa', 'p_wh_mpa', 'p_annulus_mpa', 'p_intake_mpa', 'p_discharge_mpa']),
  },
  { id: 'temperatures', title: 'Температуры', keys: keys('studies', ['t_wh_c', 't_bh_c']) },
  {
    id: 'gas',
    title: 'Газ',
    keys: keys('studies', ['gas_total_m3d', 'gas_annulus_m3d', 'gas_annulus_spec_m3m3', 'v_bubble_cms']),
  },
  {
    id: 'pvt',
    title: 'PVT',
    keys: keys('studies', [
      'p_sat_mpa', 't_res_c', 'gas_content_m3m3', 'gas_sat_m3t', 'gor', 'gor_unit',
      'rho_oil_dead', 'rho_oil_res', 'rho_gas', 'rho_water',
    ]),
  },
  { id: 'points', title: 'Замеры по глубине', keys: keys('points', ['depth_m', 'pressure_mpa', 'temp_c']) },
  {
    id: 'fluids',
    title: 'Свойства по залежам',
    keys: keys('fluids', [
      'horizon', 't_res_c', 'rho_oil_res', 'rho_oil_dead', 'p_sat_mpa', 'gas_content_m3m3', 'b_oil',
      'mu_oil_res_mpas', 'mu_oil_dead_mpas', 'rho_gas', 'y_methane_pct', 'y_nitrogen_pct', 'rho_water',
    ]),
  },
  {
    id: 'pump',
    title: 'Режимы насосов',
    keys: keys('pump_intake', ['well', 'lift_method', 'regime', 'h_pump_m', 'h_dyn_m', 'p_annulus_wh_mpa', 'p_intake_mpa']),
  },
];

/**
 * Разбирает ключ «таблица.колонка» и проверяет его по белому списку.
 * @param {string} key
 * @returns {{table: string, column: string, type: ColType} | null} null, если такой колонки в схеме нет
 */
export function parseKey(key) {
  const dot = key.indexOf('.');
  if (dot < 0) return null;
  const table = key.slice(0, dot);
  const column = key.slice(dot + 1);
  const info = Object.hasOwn(TABLES, table) ? TABLES[table] : null;
  if (!info || !Object.hasOwn(info.columns, column)) return null;
  return { table, column, type: info.columns[column] };
}

/**
 * Русский заголовок колонки по ключу.
 * @param {string} key ключ «таблица.колонка»
 * @returns {string}
 */
export function columnTitle(key) {
  const parsed = parseKey(key);
  return parsed ? getColumnTitle(parsed.column, false) : key;
}

/**
 * Плоский список всех колонок конструктора в порядке групп (колонка не повторяется).
 * @returns {{key: string, title: string, type: ColType, group: string}[]}
 */
export function listColumns() {
  const seen = new Set();
  /** @type {{key: string, title: string, type: ColType, group: string}[]} */
  const result = [];
  for (const group of GROUPS) {
    for (const key of group.keys) {
      const parsed = parseKey(key);
      if (!parsed || seen.has(key)) continue;
      seen.add(key);
      result.push({ key, title: columnTitle(key), type: parsed.type, group: group.title });
    }
  }
  return result;
}
