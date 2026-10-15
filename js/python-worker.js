// @ts-check
// Модуль python-worker.js — Web Worker с Pyodide (Python + pandas в браузере).
//
// Схема взаимодействия (сообщения между python-panel.js и этим воркером):
//   панель -> воркер:
//     { type: 'init', tables: { <имя>: { url, textColumns } } } — загрузить Pyodide, pandas и CSV-таблицы;
//     { type: 'setDf', json } — сохранить DataFrame `df` (json: { columns, data });
//     { type: 'run', code }   — выполнить код пользователя;
//   воркер -> панель:
//     { type: 'status', text }  — ход загрузки;
//     { type: 'ready' } или { type: 'initError', message };
//     { type: 'result', ok, stdout, frame, error } — итог выполнения:
//       frame — { columns, data } (результат-DataFrame) или null, error — текст traceback.
//   Воркер работает в отдельном потоке, поэтому страница не зависает; «Остановить»
//   в панели просто завершает воркер и запускает новый.
//   Это классический воркер (importScripts): Pyodide подключается скриптом с CDN.

/** Pyodide с CDN, версия закреплена точно. */
const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

/** Python-код воркера: чтение таблиц и выполнение пользовательского кода. */
const BOOTSTRAP = `
import ast, io, json, traceback
import pandas as pd

_tables = {}
_df = None


def _load_table(name, text, text_columns_json):
    # Идентификаторы читаем как текст («12Ф», «1.10»), пустое поле — NaN.
    text_columns = json.loads(text_columns_json)
    _tables[name] = pd.read_csv(
        io.StringIO(text),
        dtype={c: str for c in text_columns},
        keep_default_na=False,
        na_values=[''],
    )


def _set_df(frame_json):
    global _df
    frame = json.loads(frame_json)
    _df = pd.DataFrame(frame['data'], columns=frame['columns'])


def _to_frame(value):
    # DataFrame или Series -> DataFrame с обычным индексом и строковыми названиями колонок.
    if isinstance(value, pd.Series):
        value = value.to_frame()
    if not isinstance(value, pd.DataFrame):
        return None
    if any(name is not None for name in value.index.names):
        value = value.reset_index()
    value = value.copy()
    value.columns = [
        '_'.join(str(part) for part in c if str(part) != '') if isinstance(c, tuple) else str(c)
        for c in value.columns
    ]
    return value


def _run(code):
    # Каждый запуск работает с копиями таблиц: изменения не сохраняются.
    ns = {name: table.copy() for name, table in _tables.items()}
    ns['pd'] = pd
    if _df is not None:
        ns['df'] = _df.copy()
    try:
        tree = ast.parse(code)
        last = ast.Expression(tree.body.pop().value) if tree.body and isinstance(tree.body[-1], ast.Expr) else None
        exec(compile(tree, '<code>', 'exec'), ns)
        value = eval(compile(last, '<code>', 'eval'), ns) if last is not None else None
    except Exception as e:
        frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == '<code>']
        text = ''
        if frames:
            text += 'Traceback (most recent call last):\\n' + ''.join(traceback.format_list(frames))
        text += ''.join(traceback.format_exception_only(type(e), e))
        return json.dumps({'error': text})

    frame = _to_frame(ns.get('result'))
    if frame is None:
        frame = _to_frame(value)
    if frame is None:
        return json.dumps({'frame': None})
    return json.dumps({'frame': json.loads(frame.to_json(orient='split', index=False, default_handler=str))})
`;

const scope = /** @type {any} */ (self);

/** @type {any} */
let pyodide = null;
/** @type {string[]} */
let output = [];

/**
 * Отправляет сообщение панели.
 * @param {Object} message
 */
function send(message) {
  scope.postMessage(message);
}

/**
 * Загружает Pyodide, pandas и таблицы.
 * @param {Record<string, {url: string, textColumns: string[]}>} tables
 */
async function init(tables) {
  send({ type: 'status', text: 'Загрузка Python (Pyodide)…' });
  scope.importScripts(`${PYODIDE_BASE}pyodide.js`);
  pyodide = await scope.loadPyodide({ indexURL: PYODIDE_BASE });
  pyodide.setStdout({ batched: (/** @type {string} */ line) => output.push(line) });
  pyodide.setStderr({ batched: (/** @type {string} */ line) => output.push(line) });

  send({ type: 'status', text: 'Загрузка pandas…' });
  await pyodide.loadPackage('pandas');
  pyodide.runPython(BOOTSTRAP);

  send({ type: 'status', text: 'Загрузка таблиц…' });
  const loadTable = pyodide.globals.get('_load_table');
  for (const [name, { url, textColumns }] of Object.entries(tables)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Не удалось загрузить ${url}: HTTP ${response.status}`);
    loadTable(name, await response.text(), JSON.stringify(textColumns));
  }
  loadTable.destroy();
}

scope.onmessage = async (/** @type {MessageEvent} */ event) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      await init(message.tables);
      send({ type: 'ready' });
    } else if (message.type === 'setDf') {
      pyodide.globals.get('_set_df')(message.json);
    } else if (message.type === 'run') {
      output = [];
      const answer = JSON.parse(pyodide.globals.get('_run')(message.code));
      send({
        type: 'result',
        ok: !answer.error,
        stdout: output.join('\n'),
        frame: answer.frame ?? null,
        error: answer.error ?? null,
      });
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    send(message.type === 'init' ? { type: 'initError', message: text } : { type: 'result', ok: false, stdout: output.join('\n'), frame: null, error: text });
  }
};
