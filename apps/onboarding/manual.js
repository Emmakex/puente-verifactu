import {
  MANUAL_COPY,
  MANUAL_INVOICE_TYPES,
  calculateManualVat,
  isRectifyingInvoiceType,
  manualPayload,
} from './src/manual-model.mjs';

const state = {
  locale: navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'es',
  preflight: null,
  issued: null,
};

const form = document.querySelector('#manual-form');
const invoiceType = document.querySelector('#invoice-type');
const rectificationSection = document.querySelector('#rectification-section');
const rectificationType = document.querySelector('#rectification-type');
const correctedBaseField = document.querySelector('#corrected-base-field');
const correctedTaxField = document.querySelector('#corrected-tax-field');
const recipientName = document.querySelector('#recipient-name');
const recipientTaxId = document.querySelector('#recipient-tax-id');
const validateButton = document.querySelector('#validate-button');
const calculateButton = document.querySelector('#calculate-button');
const preflightResult = document.querySelector('#preflight-result');
const preflightSummary = document.querySelector('#preflight-summary');
const preflightErrors = document.querySelector('#preflight-errors');
const issueSection = document.querySelector('#issue-section');
const issueConfirm = document.querySelector('#issue-confirm');
const issueButton = document.querySelector('#issue-button');
const issuedResult = document.querySelector('#issued-result');
const issuedHeading = document.querySelector('#issued-heading');
const issuedDetails = document.querySelector('#issued-details');
const refreshButton = document.querySelector('#refresh-button');
const status = document.querySelector('#status');

function t(key) {
  return MANUAL_COPY[state.locale]?.[key] ?? MANUAL_COPY.es[key] ?? key;
}

function setStatus(message = '') {
  status.textContent = message;
}

function apiErrorMessage(error) {
  return error?.message ?? (state.locale === 'en' ? 'Request failed' : 'La solicitud ha fallado');
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error?.message || `HTTP ${response.status}`);
    error.code = body?.error?.code;
    error.details = body?.error?.details ?? [];
    error.status = response.status;
    throw error;
  }
  return body;
}

function renderInvoiceTypes() {
  const current = invoiceType.value || 'F2';
  invoiceType.innerHTML = '';
  for (const item of MANUAL_INVOICE_TYPES) {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label[state.locale] ?? item.label.es;
    option.selected = item.value === current;
    invoiceType.append(option);
  }
}

function translate() {
  document.documentElement.lang = state.locale;
  document.title = `Kairoseth Fiscal — ${t('title')}`;
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const value = MANUAL_COPY[state.locale]?.[element.dataset.i18n];
    if (value) element.textContent = value;
  });
  document.querySelectorAll('[data-lang]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.lang === state.locale);
  });
  renderInvoiceTypes();
  if (state.preflight) renderPreflight(state.preflight);
  if (state.issued) renderIssued(state.issued);
}

function values() {
  return Object.fromEntries(new FormData(form).entries());
}

function updateConditionalFields() {
  const rectifying = isRectifyingInvoiceType(invoiceType.value);
  rectificationSection.hidden = !rectifying;
  const needsRecipient = invoiceType.value !== 'F2';
  recipientName.required = needsRecipient;
  recipientTaxId.required = needsRecipient;
  const substitution = rectifying && rectificationType.value === 'S';
  correctedBaseField.hidden = !substitution;
  correctedTaxField.hidden = !substitution;
  correctedBaseField.querySelector('input').required = substitution;
  correctedTaxField.querySelector('input').required = substitution;
}

function invalidatePreflight() {
  state.preflight = null;
  preflightResult.hidden = true;
  issueSection.hidden = true;
  issueConfirm.checked = false;
  issueButton.disabled = true;
  state.issued = null;
  issuedResult.hidden = true;
}

function localizedIssue(issue) {
  const language = state.locale === 'en' ? 'en' : 'es';
  return issue?.message?.[language]
    ?? issue?.message?.es
    ?? issue?.message?.en
    ?? issue?.code
    ?? (state.locale === 'en' ? 'Validation error' : 'Error de validación');
}

function renderPreflight(report) {
  preflightResult.hidden = false;
  preflightResult.classList.toggle('success', Boolean(report.ok));
  preflightResult.classList.toggle('failure', !report.ok);
  preflightSummary.innerHTML = '';
  preflightErrors.innerHTML = '';

  const heading = document.createElement('h2');
  heading.textContent = report.ok ? t('validationOk') : t('validationError');
  preflightSummary.append(heading);

  const issues = [...(report.errors ?? []), ...(report.warnings ?? [])];
  if (issues.length) {
    const list = document.createElement('ul');
    list.className = 'error-list';
    for (const issue of issues) {
      const item = document.createElement('li');
      item.textContent = localizedIssue(issue);
      list.append(item);
    }
    preflightErrors.append(list);
  }

  issueSection.hidden = !report.ok;
  issueConfirm.checked = false;
  issueButton.disabled = true;
}

function safeQrLink(url) {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function renderIssued(resource) {
  issuedResult.hidden = false;
  issuedHeading.textContent = resource.duplicate ? t('duplicate') : t('issued');
  issuedDetails.innerHTML = '';

  const record = document.createElement('div');
  record.className = 'issued-record';
  record.textContent = `recordId: ${resource.recordId}`;
  issuedDetails.append(record);

  const delivery = document.createElement('div');
  delivery.className = 'issued-record';
  delivery.textContent = `status: ${resource.status ?? resource.delivery?.status ?? 'fiscalized'}`;
  issuedDetails.append(delivery);

  const qrUrl = safeQrLink(resource.presentation?.qr?.url);
  if (qrUrl) {
    const link = document.createElement('a');
    link.className = 'qr-link';
    link.href = qrUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = t('qr');
    issuedDetails.append(link);
  }

  if (resource.presentation?.verificationText) {
    const text = document.createElement('p');
    text.textContent = resource.presentation.verificationText;
    issuedDetails.append(text);
  }
}

async function validateManual(event) {
  event.preventDefault();
  if (!form.reportValidity()) return;
  validateButton.disabled = true;
  setStatus(state.locale === 'en' ? 'Validating…' : 'Validando…');
  try {
    const payload = manualPayload(values());
    const report = await apiJson('/v1/manual/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-language': state.locale },
      body: JSON.stringify(payload),
    });
    state.preflight = report;
    renderPreflight(report);
    setStatus(report.ok ? t('validationOk') : t('validationError'));
  } catch (error) {
    state.preflight = null;
    preflightResult.hidden = true;
    issueSection.hidden = true;
    setStatus(apiErrorMessage(error));
  } finally {
    validateButton.disabled = false;
  }
}

async function issueManual() {
  if (!state.preflight?.ok || !issueConfirm.checked) return;
  issueButton.disabled = true;
  setStatus(state.locale === 'en' ? 'Issuing…' : 'Emitiendo…');
  try {
    const payload = manualPayload(values());
    const resource = await apiJson('/v1/manual/fiscal-records', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-language': state.locale },
      body: JSON.stringify(payload),
    });
    state.issued = resource;
    renderIssued(resource);
    setStatus(resource.duplicate ? t('duplicate') : t('issued'));
  } catch (error) {
    setStatus(apiErrorMessage(error));
  } finally {
    issueButton.disabled = !issueConfirm.checked;
  }
}

async function refreshStatus() {
  if (!state.issued?.recordId) return;
  refreshButton.disabled = true;
  try {
    const resource = await apiJson(`/v1/fiscal-records/${encodeURIComponent(state.issued.recordId)}/status`);
    state.issued = { ...state.issued, ...resource };
    renderIssued(state.issued);
  } catch (error) {
    setStatus(apiErrorMessage(error));
  } finally {
    refreshButton.disabled = false;
  }
}

calculateButton.addEventListener('click', () => {
  try {
    const current = values();
    const calculated = calculateManualVat(current.baseAmount, current.rate);
    form.elements.taxAmount.value = calculated.taxAmount;
    form.elements.totalAmount.value = calculated.totalAmount;
    invalidatePreflight();
    setStatus('');
  } catch (error) {
    setStatus(apiErrorMessage(error));
  }
});

form.addEventListener('submit', validateManual);
form.addEventListener('input', () => {
  invalidatePreflight();
  updateConditionalFields();
});
form.addEventListener('change', () => {
  invalidatePreflight();
  updateConditionalFields();
});
rectificationType.addEventListener('change', updateConditionalFields);
issueConfirm.addEventListener('change', () => {
  issueButton.disabled = !issueConfirm.checked || !state.preflight?.ok;
});
issueButton.addEventListener('click', issueManual);
refreshButton.addEventListener('click', refreshStatus);

document.querySelectorAll('[data-lang]').forEach((button) => {
  button.addEventListener('click', () => {
    state.locale = button.dataset.lang;
    translate();
  });
});

translate();
updateConditionalFields();
