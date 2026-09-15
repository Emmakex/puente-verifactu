import {
  COPY,
  FIXED_FIELDS,
  TARGET_LABELS,
  configurationDefaults,
  initialSelections,
  missingRequiredConfiguration,
  preflightPayload,
  targetLabel,
} from './src/model.mjs';

const state = {
  locale: navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'es',
  file: null,
  inspection: null,
  selections: [],
  configuration: configurationDefaults(),
  preflight: null,
};

const els = {
  file: document.querySelector('#invoice-file'),
  fileMeta: document.querySelector('#file-meta'),
  sheetField: document.querySelector('#sheet-field'),
  sheet: document.querySelector('#sheet-select'),
  mappingSection: document.querySelector('#mapping-section'),
  mappingBody: document.querySelector('#mapping-body'),
  configSection: document.querySelector('#config-section'),
  configGrid: document.querySelector('#config-grid'),
  validateSection: document.querySelector('#validate-section'),
  validateButton: document.querySelector('#validate-button'),
  resultSection: document.querySelector('#result-section'),
  resultSummary: document.querySelector('#result-summary'),
  resultErrors: document.querySelector('#result-errors'),
  status: document.querySelector('#status'),
};

function t(key) {
  return COPY[state.locale]?.[key] ?? COPY.es[key] ?? key;
}

function setStatus(message = '') {
  els.status.textContent = message;
}

function translateStatic() {
  document.documentElement.lang = state.locale;
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.dataset.i18n;
    if (COPY[state.locale]?.[key]) element.textContent = COPY[state.locale][key];
  });
  document.querySelectorAll('[data-lang]').forEach((button) => button.classList.toggle('is-active', button.dataset.lang === state.locale));
  document.title = `Puente VeriFactu — ${t('title')}`;
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error?.message || `HTTP ${response.status}`);
    error.code = body?.error?.code;
    error.status = response.status;
    error.details = body?.error?.details ?? [];
    throw error;
  }
  return body;
}

function hideWorkflow() {
  els.mappingSection.hidden = true;
  els.configSection.hidden = true;
  els.validateSection.hidden = true;
  els.resultSection.hidden = true;
}

function renderFileMeta() {
  if (!state.file || !state.inspection) {
    els.fileMeta.hidden = true;
    return;
  }
  const file = state.inspection.file;
  const size = state.file.size < 1024 * 1024
    ? `${Math.max(1, Math.round(state.file.size / 1024))} KB`
    : `${(state.file.size / 1024 / 1024).toFixed(1)} MB`;
  els.fileMeta.textContent = `${state.file.name} · ${size} · ${file.rows} ${t('rows')} · ${file.columns} columnas`;
  els.fileMeta.hidden = false;
}

function renderSheets() {
  const sheets = state.inspection?.file?.sheets ?? [];
  if (sheets.length <= 1) {
    els.sheetField.hidden = true;
    return;
  }
  els.sheet.innerHTML = '';
  for (const sheet of sheets) {
    const option = document.createElement('option');
    option.value = sheet.name;
    option.textContent = sheet.name;
    option.selected = sheet.name === state.inspection.file.sheetName;
    els.sheet.append(option);
  }
  els.sheetField.hidden = false;
}

function sampleFor(source) {
  return state.inspection?.sampleRows?.map((row) => row[source]).find((value) => String(value ?? '').trim()) ?? '';
}

function mappingStatusText(selection) {
  if (selection.status === 'auto') return t('auto');
  if (selection.status === 'review') return t('review');
  return t('unmatched');
}

function renderMapping() {
  els.mappingBody.innerHTML = '';
  state.selections.forEach((selection, index) => {
    const row = document.createElement('tr');

    const sourceCell = document.createElement('td');
    const source = document.createElement('div');
    source.className = 'source-name';
    source.textContent = selection.source;
    sourceCell.append(source);
    const sample = sampleFor(selection.source);
    if (sample !== '') {
      const sampleEl = document.createElement('div');
      sampleEl.className = 'sample';
      sampleEl.textContent = String(sample);
      sourceCell.append(sampleEl);
    }

    const destinationCell = document.createElement('td');
    const select = document.createElement('select');
    select.setAttribute('aria-label', `${t('destination')}: ${selection.source}`);
    const ignore = document.createElement('option');
    ignore.value = '';
    ignore.textContent = t('ignore');
    select.append(ignore);
    for (const target of Object.keys(TARGET_LABELS)) {
      const option = document.createElement('option');
      option.value = target;
      option.textContent = targetLabel(target, state.locale);
      option.selected = target === selection.target;
      select.append(option);
    }
    select.addEventListener('change', () => {
      const previous = state.selections[index].target;
      state.selections[index].target = select.value;
      if (select.value !== previous || state.selections[index].status !== 'auto') {
        state.selections[index].status = select.value ? 'review' : 'unmatched';
        state.selections[index].confirmed = select.value === '';
      }
      renderMapping();
    });
    destinationCell.append(select);

    const statusCell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${selection.status}`;
    badge.textContent = mappingStatusText(selection);
    if (selection.confidence != null) badge.title = `${Math.round(selection.confidence * 100)}%`;
    statusCell.append(badge);

    const confirmCell = document.createElement('td');
    if (selection.status === 'auto') {
      confirmCell.textContent = '✓';
    } else if (!selection.target) {
      confirmCell.textContent = '—';
    } else {
      const label = document.createElement('label');
      label.className = 'confirm-box';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selection.confirmed;
      checkbox.addEventListener('change', () => { state.selections[index].confirmed = checkbox.checked; });
      const text = document.createElement('span');
      text.textContent = t('confirm');
      label.append(checkbox, text);
      confirmCell.append(label);
    }

    row.append(sourceCell, destinationCell, statusCell, confirmCell);
    els.mappingBody.append(row);
  });
  els.mappingSection.hidden = false;
}

function renderConfiguration() {
  els.configGrid.innerHTML = '';
  for (const field of FIXED_FIELDS) {
    const label = document.createElement('label');
    label.className = 'field';
    const title = document.createElement('span');
    title.textContent = field.label[state.locale] ?? field.label.es;
    if (field.required) title.classList.add('required');
    label.append(title);

    let input;
    if (field.type === 'select') {
      input = document.createElement('select');
      for (const value of field.options ?? []) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value || '—';
        input.append(option);
      }
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.autocomplete = 'off';
    }
    input.value = state.configuration[field.path] ?? field.defaultValue ?? '';
    input.required = Boolean(field.required);
    input.addEventListener('input', () => { state.configuration[field.path] = input.value; });
    label.append(input);
    els.configGrid.append(label);
  }
  els.configSection.hidden = false;
  els.validateSection.hidden = false;
}

function renderInspection() {
  renderFileMeta();
  renderSheets();
  state.selections = initialSelections(state.inspection);
  renderMapping();
  renderConfiguration();
  els.resultSection.hidden = true;
  setStatus(t('ready'));
}

async function inspectFile(sheet) {
  if (!state.file) return;
  hideWorkflow();
  setStatus(t('loading'));
  const headers = {
    'content-type': 'application/octet-stream',
    'x-file-name': encodeURIComponent(state.file.name),
    'accept-language': state.locale,
  };
  if (sheet) headers['x-sheet'] = encodeURIComponent(sheet);
  try {
    state.inspection = await apiJson('/v1/imports/inspect', { method: 'POST', headers, body: state.file });
    renderInspection();
  } catch (error) {
    setStatus(error.message);
  }
}

function localizedIssue(error) {
  const language = state.locale === 'en' ? 'en' : 'es';
  return error?.message?.[language] ?? error?.message?.es ?? error?.message?.en ?? error?.code ?? 'Error';
}

function renderResult(report) {
  state.preflight = report;
  els.resultSection.hidden = false;
  els.resultSection.classList.toggle('success', report.ok);
  els.resultSection.classList.toggle('failure', !report.ok);
  els.resultSummary.innerHTML = '';

  const heading = document.createElement('h2');
  heading.textContent = report.ok ? t('success') : t('failure');
  els.resultSummary.append(heading);
  const kpis = document.createElement('div');
  kpis.className = 'result-kpis';
  for (const [value, label] of [
    [report.summary.rows, t('rows')],
    [report.summary.valid, t('valid')],
    [report.summary.invalid, t('invalid')],
  ]) {
    const item = document.createElement('div');
    item.className = 'result-kpi';
    item.innerHTML = `<strong>${value}</strong> ${label}`;
    kpis.append(item);
  }
  els.resultSummary.append(kpis);

  const problems = (report.rows ?? []).filter((row) => row.status !== 'valid').slice(0, 20);
  els.resultErrors.innerHTML = '';
  if (problems.length) {
    const list = document.createElement('ul');
    list.className = 'error-list';
    for (const row of problems) {
      const item = document.createElement('li');
      const messages = (row.errors ?? []).map(localizedIssue).join(' · ');
      item.textContent = `Fila ${row.row}: ${messages}`;
      list.append(item);
    }
    els.resultErrors.append(list);
  }
}

async function validateImport() {
  if (!state.inspection?.importId) return;
  const pending = state.selections.filter((selection) => selection.target && selection.status !== 'auto' && !selection.confirmed);
  if (pending.length) {
    setStatus(state.locale === 'en' ? 'Confirm or ignore the mappings marked for review.' : 'Confirma o ignora las equivalencias marcadas para revisar.');
    return;
  }
  const missing = missingRequiredConfiguration(state.configuration);
  if (missing.length) {
    setStatus(state.locale === 'en' ? 'Complete the required business data.' : 'Completa los datos obligatorios del negocio.');
    return;
  }

  els.validateButton.disabled = true;
  setStatus(state.locale === 'en' ? 'Validating…' : 'Validando…');
  try {
    const payload = preflightPayload(state.selections, state.configuration);
    const report = await apiJson(`/v1/imports/${state.inspection.importId}/preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-language': state.locale },
      body: JSON.stringify(payload),
    });
    renderResult(report);
    setStatus(report.ok ? t('success') : t('retry'));
  } catch (error) {
    if (['VF_IMPORT_SESSION_NOT_FOUND', 'VF_IMPORT_SESSION_EXPIRED'].includes(error.code)) setStatus(t('sessionExpired'));
    else setStatus(error.message);
  } finally {
    els.validateButton.disabled = false;
  }
}

els.file.addEventListener('change', () => {
  state.file = els.file.files?.[0] ?? null;
  state.inspection = null;
  state.preflight = null;
  if (state.file) inspectFile();
});

els.sheet.addEventListener('change', () => inspectFile(els.sheet.value));
els.validateButton.addEventListener('click', validateImport);
document.querySelectorAll('[data-lang]').forEach((button) => button.addEventListener('click', () => {
  state.locale = button.dataset.lang;
  translateStatic();
  if (state.inspection) {
    renderMapping();
    renderConfiguration();
    if (state.preflight) renderResult(state.preflight);
  }
}));

translateStatic();
