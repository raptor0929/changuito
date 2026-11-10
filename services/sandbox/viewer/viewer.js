import RFB from '@novnc/novnc';

const part = document.documentElement.dataset.part === 'form' || document.documentElement.dataset.part === 'screen'
  ? document.documentElement.dataset.part : '';
let rfb;
let parentOrigin;
let cardToken = '';
let lang = 'es';
let applied = false;
const status = document.getElementById('status');
const form = document.getElementById('card-form');
const pan = document.getElementById('pan');
const holder = document.getElementById('holder');
const month = document.getElementById('month');
const year = document.getElementById('year');
const cvv = document.getElementById('cvv');
const apply = document.getElementById('apply-card');
const cardStatus = document.getElementById('card-status');
try { parentOrigin = new URL(document.referrer).origin; } catch { /* no parent */ }
const permitted = parent !== window && window.viewerParents.includes(parentOrigin);

const copy = {
  es: {
    kind: 'Tipo de tarjeta', debit: 'Débito', credit: 'Crédito',
    pan: 'Número de tarjeta', holder: 'Nombre y apellido', month: 'Mes', year: 'Año', cvv: 'Código de seguridad',
    hint: 'La usamos solo para este pago. Elegí mes y año acá; el teclado de arriba es para el captcha y la verificación.',
    hintForm: 'La usamos solo para este pago en Día. No queda guardada.',
    cvvHint: '3 o 4 dígitos',
    monthPlaceholder: 'MM',
    yearPlaceholder: 'AA',
    apply: 'Cargar en Día', update: 'Actualizar tarjeta', working: 'Cargando la tarjeta…',
    done: 'Tarjeta cargada en el checkout de Día. Podés corregirla y actualizarla hasta pagar.',
    partial: 'Día no tomó: ',
    locked: 'El pago ya empezó. Esta sesión ya no acepta otra tarjeta.',
    invalid: 'Revisá los datos de la tarjeta.',
    offline: 'Conectá el navegador antes de cargar la tarjeta.',
    failed: 'No se pudo cargar la tarjeta. Probá de nuevo.',
    panError: 'Ingresá el número completo de la tarjeta.',
    holderError: 'Ingresá el nombre como figura en la tarjeta.',
    monthError: 'Elegí el mes de vencimiento.',
    yearError: 'Elegí el año de vencimiento.',
    cvvError: 'Ingresá los 3 o 4 dígitos del código.',
    months: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
    fields: { pan: 'el número', holder: 'el nombre', month: 'el mes', year: 'el año', cvv: 'el código', expiry: 'el vencimiento' },
  },
  en: {
    kind: 'Card type', debit: 'Debit', credit: 'Credit',
    pan: 'Card number', holder: 'Name on card', month: 'Month', year: 'Year', cvv: 'Security code',
    hint: 'Used only for this payment. Choose the month and year here; the keyboard above is for the captcha and verification.',
    hintForm: 'Used only for this DIA payment. It is not saved.',
    cvvHint: '3 or 4 digits',
    monthPlaceholder: 'MM',
    yearPlaceholder: 'YY',
    apply: 'Load into DIA', update: 'Update card', working: 'Loading the card…',
    done: 'Card loaded into the DIA checkout. You can correct it and update it until you pay.',
    partial: 'DIA did not take: ',
    locked: 'Payment has started. This session no longer accepts another card.',
    invalid: 'Check the card details.',
    offline: 'Connect the browser before loading the card.',
    failed: 'The card could not be loaded. Try again.',
    panError: 'Enter the full card number.',
    holderError: 'Enter the name as it appears on the card.',
    monthError: 'Choose the expiry month.',
    yearError: 'Choose the expiry year.',
    cvvError: 'Enter the 3 or 4 digit code.',
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    fields: { pan: 'the number', holder: 'the name', month: 'the month', year: 'the year', cvv: 'the code', expiry: 'the expiry' },
  },
};

function text() { return copy[lang]; }

function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
}

/** Tells the checkout dialog how tall the form is. The message is a number, never card fields. */
let reportedHeight = 0;
function reportFormHeight() {
  if (part !== 'form' || !permitted || !parentOrigin) return;
  const height = Math.ceil(form.getBoundingClientRect().height);
  if (!height || height === reportedHeight) return;
  reportedHeight = height;
  parent.postMessage({ type: 'changuito-form-height', height }, parentOrigin);
}

function fillSelects() {
  const selectedMonth = month.value;
  const selectedYear = year.value;
  const t = text();
  month.replaceChildren(new Option(t.monthPlaceholder, ''));
  t.months.forEach((name, index) => {
    const value = String(index + 1).padStart(2, '0');
    const option = new Option(value, value);
    option.title = name;
    month.append(option);
  });
  month.value = selectedMonth;
  const start = new Date().getFullYear();
  year.replaceChildren(new Option(t.yearPlaceholder, ''));
  for (let value = start; value <= start + 12; value += 1) {
    year.append(new Option(String(value).slice(-2), String(value)));
  }
  year.value = selectedYear;
}

function applyCopy() {
  const t = text();
  document.documentElement.lang = lang;
  if (part === 'form') document.title = lang === 'en' ? 'Card form' : 'Formulario de la tarjeta';
  document.getElementById('kinds').setAttribute('aria-label', t.kind);
  document.getElementById('lbl-debit').textContent = t.debit;
  document.getElementById('lbl-credit').textContent = t.credit;
  document.getElementById('lbl-pan').textContent = t.pan;
  document.getElementById('lbl-holder').textContent = t.holder;
  document.getElementById('lbl-month').textContent = t.month;
  document.getElementById('lbl-year').textContent = t.year;
  document.getElementById('lbl-cvv').textContent = t.cvv;
  document.getElementById('cvv-hint').textContent = t.cvvHint;
  document.getElementById('card-hint').textContent = part === 'form' ? t.hintForm : t.hint;
  if (!apply.disabled) apply.textContent = applied ? t.update : t.apply;
  fillSelects();
  reportFormHeight();
}

function fieldError(input, id, message) {
  const slot = document.getElementById(id);
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  slot.textContent = message;
  slot.hidden = !message;
}

function setStatus(message, ok) {
  cardStatus.textContent = message;
  cardStatus.classList.toggle('ok', Boolean(ok));
}

function lockForm() {
  apply.setAttribute('aria-busy', 'false');
  apply.textContent = applied ? text().update : text().apply;
  form.querySelectorAll('input, select, button').forEach(el => { el.disabled = true; });
  setStatus(text().locked, false);
}

function ready() {
  if (permitted) parent.postMessage({ type: 'changuito-viewer-ready' }, parentOrigin);
}

window.addEventListener('message', event => {
  if (!permitted || event.source !== parent || event.origin !== parentOrigin) return;
  if (event.data?.type === 'changuito-viewer-theme') {
    applyTheme(event.data.theme);
    reportedHeight = 0;
    reportFormHeight();
    return;
  }
  if (event.data?.type !== 'changuito-viewer-connect') return;
  const { jobId } = event.data;
  if (!/^[0-9a-f]{32}$/.test(jobId)) return;
  const ticket = event.data.ticket || '';
  const ticketOk = /^[A-Za-z0-9_-]{40,64}$/.test(ticket);
  if (part !== 'form' && !ticketOk) return;
  cardToken = /^[A-Za-z0-9_-]{40,64}$/.test(event.data.cardToken || '') ? event.data.cardToken : '';
  lang = event.data.lang === 'en' ? 'en' : 'es';
  applyTheme(event.data.theme);
  applyCopy();
  form.dataset.jobId = jobId;
  if (!ticketOk) return;
  rfb?.disconnect();
  const url = new URL(`/viewer/${jobId}/socket`, location.origin);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  rfb = new RFB(document.getElementById('screen'), url.toString(), { shared: false, wsProtocols: ['changuito.viewer', ticket] });
  rfb.scaleViewport = true;
  rfb.resizeSession = false;
  rfb.focusOnClick = true;
  rfb.addEventListener('connect', () => { status.textContent = 'Conectado / Connected'; });
  rfb.addEventListener('disconnect', () => { status.textContent = 'Desconectado / Disconnected'; });
  rfb.addEventListener('securityfailure', () => { status.textContent = 'Acceso rechazado / Access denied'; });
  form.dataset.jobId = jobId;
});

document.getElementById('reconnect').onclick = ready;
document.getElementById('keyboard').addEventListener('input', event => {
  for (const character of event.target.value) {
    const code = character.codePointAt(0);
    rfb?.sendKey(code > 255 ? 0x01000000 | code : code);
  }
  event.target.value = '';
});
document.getElementById('tab').onclick = () => rfb?.sendKey(0xff09);
document.getElementById('backspace').onclick = () => rfb?.sendKey(0xff08);

pan.addEventListener('input', () => {
  const digits = pan.value.replace(/\D/g, '').slice(0, 19);
  pan.value = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
  fieldError(pan, 'pan-error', '');
});
cvv.addEventListener('input', () => {
  cvv.value = cvv.value.replace(/\D/g, '').slice(0, 4);
  fieldError(cvv, 'cvv-error', '');
});
holder.addEventListener('input', () => fieldError(holder, 'holder-error', ''));
month.addEventListener('change', () => fieldError(month, 'month-error', ''));
year.addEventListener('change', () => fieldError(year, 'year-error', ''));

function localProblems() {
  const t = text();
  const problems = [
    [pan, 'pan-error', pan.value.replace(/\D/g, '').length >= 13 && pan.value.replace(/\D/g, '').length <= 19 ? '' : t.panError],
    [holder, 'holder-error', holder.value.trim() ? '' : t.holderError],
    [month, 'month-error', month.value ? '' : t.monthError],
    [year, 'year-error', year.value ? '' : t.yearError],
    [cvv, 'cvv-error', /^\d{3,4}$/.test(cvv.value) ? '' : t.cvvError],
  ];
  let first = null;
  for (const [input, id, message] of problems) {
    fieldError(input, id, message);
    if (message && !first) first = input;
  }
  return first;
}

apply.addEventListener('click', async () => {
  setStatus('', false);
  const first = localProblems();
  if (first) {
    setStatus(text().invalid, false);
    first.focus();
    return;
  }
  if ((part !== 'form' && !rfb) || !cardToken || !form.dataset.jobId) {
    setStatus(text().offline, false);
    return;
  }
  apply.disabled = true;
  apply.setAttribute('aria-busy', 'true');
  apply.textContent = text().working;
  try {
    const response = await fetch(`/viewer/${form.dataset.jobId}/card`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cardToken}` },
      body: JSON.stringify({
        pan: pan.value.replace(/\D/g, ''),
        cvv: cvv.value,
        exp_month: month.value,
        exp_year: year.value,
        holder: holder.value.trim(),
        kind: form.querySelector('input[name="kind"]:checked')?.value === 'credit' ? 'credit' : 'debit',
      }),
    });
    if (response.status === 409) {
      lockForm();
      return;
    }
    if (!response.ok) {
      setStatus(response.status === 422 ? text().invalid : text().failed, false);
      return;
    }
    const result = await response.json();
    const missing = Array.isArray(result.missing) ? result.missing : [];
    if (missing.length) {
      const names = missing.map(key => text().fields[key] || key);
      setStatus(text().partial + names.join(', ') + '.', false);
      return;
    }
    applied = true;
    cvv.value = '';
    setStatus(text().done, true);
    cardStatus.focus();
    if (permitted) parent.postMessage({ type: 'changuito-card-applied' }, parentOrigin);
  } catch {
    setStatus(text().failed, false);
  } finally {
    if (!apply.disabled) return;
    if (form.querySelector('input:disabled')) return;
    apply.setAttribute('aria-busy', 'false');
    apply.disabled = false;
    apply.textContent = applied ? text().update : text().apply;
  }
});

applyCopy();
if (part === 'form' && typeof ResizeObserver === 'function') {
  let pending = 0;
  const observer = new ResizeObserver(() => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      reportFormHeight();
    });
  });
  observer.observe(form);
}
ready();
