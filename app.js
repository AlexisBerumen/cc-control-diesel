const STORAGE = { units: 'cc-units-v2', records: 'cc-fuel-records-v2', drivers: 'cc-drivers-v1' };
function createUnitId(number) {
  return `unit-${number.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}
const defaultUnits = window.CC_UNIT_DATA.map(([number, serial, description]) => ({
  id: createUnitId(number),
  number,
  plates: serial ? `S/N: ${serial}` : 'Sin identificador',
  description
}));
const $ = (selector) => document.querySelector(selector);
let units = load(STORAGE.units, defaultUnits);
let records = [];
try { localStorage.removeItem(STORAGE.records); } catch { /* Los registros sólo se consultan con sesión. */ }
let drivers = load(STORAGE.drivers, []);
let selectedUnit = null;
let selectedDriver = null;
let toastTimer;
let isAdmin = false;
let userRole = null;
let activeRecordsRange = { from: '', to: '' };
let displayedRecords = [];
const maxOdometerJump = 10_000;
const odometerWarningJump = 2_000;

function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function money(value) { return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value || 0)); }
function number(value) { return new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(Number(value || 0)); }
function odometerValue() { return Number($('#odometer').value.replace(/[^0-9]/g, '')); }
function formatOdometerInput() {
  const input = $('#odometer');
  const digits = input.value.replace(/[^0-9]/g, '');
  input.value = digits ? Number(digits).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '';
}
function esc(text) { const d = document.createElement('div'); d.textContent = text; return d.innerHTML; }
function fileAsDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('No fue posible leer la foto.')); reader.readAsDataURL(file); }); }
async function uploadEvidence(file, kind) {
  const response = await fetch('/api/evidence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, imageData: await fileAsDataUrl(file) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No fue posible subir una evidencia.');
  return data;
}

function lastOdometer(unitId) {
  const recordOdometer = records.filter(r => r.unitId === unitId).sort((a, b) => b.odometer - a.odometer)[0]?.odometer || 0;
  const motiveOdometer = Number(units.find(unit => unit.id === unitId)?.motiveOdometer || 0);
  return Math.max(recordOdometer, motiveOdometer) || undefined;
}
function renderUnitCatalog() {
  $('#unit-catalog').innerHTML = units.length ? units.map(u => `<div class="catalog-unit"><strong>Unidad ${esc(u.number)}</strong><small>${esc(u.plates)} · ${esc(u.description)}</small></div>`).join('') : '<p class="muted">No hay unidades registradas.</p>';
}
function motiveAssignmentLabel(record) {
  const labels = {
    already_assigned: 'Motive: ya asignado',
    updated: 'Motive: chofer actualizado',
    pending: 'Motive: pendiente',
    processing: 'Motive: verificando'
  };
  return labels[record.motiveAssignmentStatus] || 'Motive: no disponible';
}
function renderRecords() {
  const body = $('#records-body');
  if (!records.length) { body.innerHTML = '<tr class="empty"><td colspan="8">Aún no hay cargas registradas.</td></tr>'; return; }
  body.innerHTML = [...records].reverse().map(r => `<tr><td>${esc(r.folio)}</td><td>${new Date(r.createdAt).toLocaleString('es-MX', { dateStyle:'short', timeStyle:'short' })}</td><td><strong>${esc(r.unitNumber)}</strong><br><small>${esc(r.driverName || 'No registrado')} · ${esc(r.plates)}</small></td><td>${number(r.odometer)} mi</td><td>${number(r.gallons)} gal</td><td>${r.amount === null || r.amount === undefined ? 'Bomba C&C' : money(r.amount)}</td><td>${r.ticketUrl && r.odometerUrl ? `<a class="evidence-link" href="${esc(r.ticketUrl)}" target="_blank" rel="noopener">Ticket</a><a class="evidence-link" href="${esc(r.odometerUrl)}" target="_blank" rel="noopener">Odómetro</a>` : 'No disponible'}</td><td><span class="status">Completo</span></td></tr>`).join('');
}
function filteredRecords() {
  const from = activeRecordsRange.from ? new Date(`${activeRecordsRange.from}T00:00:00`).getTime() : -Infinity;
  const to = activeRecordsRange.to ? new Date(`${activeRecordsRange.to}T23:59:59.999`).getTime() : Infinity;
  return records.filter((record) => {
    const time = new Date(record.createdAt).getTime();
    return Number.isFinite(time) && time >= from && time <= to;
  });
}
function updateRecordsFilterSummary() {
  const summary = $('#records-filter-summary');
  if (!activeRecordsRange.from && !activeRecordsRange.to) {
    summary.textContent = `Mostrando ${displayedRecords.length} carga(s), de la más reciente hacia atrás.`;
    return;
  }
  const range = [activeRecordsRange.from && `desde ${activeRecordsRange.from}`, activeRecordsRange.to && `hasta ${activeRecordsRange.to}`].filter(Boolean).join(' ');
  summary.textContent = `Mostrando ${displayedRecords.length} carga(s) ${range}.`;
}
const renderRecordsBase = renderRecords;
renderRecords = function renderRecordsWithMotiveStatus() {
  displayedRecords = filteredRecords();
  const allRecords = records;
  records = displayedRecords;
  renderRecordsBase();
  records = allRecords;
  const renderedRows = [...$('#records-body').querySelectorAll('tr')];
  renderedRows.forEach((row, index) => {
    const record = [...displayedRecords].reverse()[index];
    if (!record || !record.odometerWarning) return;
    const difference = Number(record.odometerDifference || 0);
    row.classList.add('odometer-warning-row');
    if (row.children[3]) row.children[3].innerHTML = `${number(record.odometer)} mi<br><small class="odometer-warning-badge">⚠ Revisar: +${number(difference)} mi vs. referencia</small>`;
  });
  if (userRole !== 'admin') { updateRecordsFilterSummary(); return; }
  renderedRows.forEach((row, index) => {
    const record = [...displayedRecords].reverse()[index];
    if (!record || !row.lastElementChild) return;
    row.lastElementChild.innerHTML = `<span class="status">Completo</span><br><small title="${esc(record.motiveAssignmentMessage || '')}">${esc(motiveAssignmentLabel(record))}</small>`;
    const motiveOdometer = Number(units.find((unit) => unit.id === record.unitId)?.motiveOdometer || 0);
    if (motiveOdometer && Number(record.odometer) > motiveOdometer + maxOdometerJump) row.lastElementChild.insertAdjacentHTML('beforeend', `<br><button class="odometer-reset" type="button" data-reset-odometer="${esc(record.id)}">Corregir con Motive</button>`);
  });
  updateRecordsFilterSummary();
};
function applyRecordsFilter() {
  const from = $('#records-date-from').value;
  const to = $('#records-date-to').value;
  if (from && to && from > to) { showToast('La fecha inicial no puede ser posterior a la fecha final.'); return; }
  activeRecordsRange = { from, to };
  renderRecords();
}
$('#apply-records-filter').addEventListener('click', applyRecordsFilter);
$('#records-date-from').addEventListener('change', () => { if (!$('#records-date-to').value || $('#records-date-from').value <= $('#records-date-to').value) applyRecordsFilter(); });
$('#records-date-to').addEventListener('change', () => { if (!$('#records-date-from').value || $('#records-date-from').value <= $('#records-date-to').value) applyRecordsFilter(); });
$('#clear-records-filter').addEventListener('click', () => {
  $('#records-date-from').value = '';
  $('#records-date-to').value = '';
  activeRecordsRange = { from: '', to: '' };
  renderRecords();
});
$('#records-body').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-reset-odometer]');
  if (!button || userRole !== 'admin') return;
  if (!confirm('Se reemplazará el odómetro de esta carga con la lectura actual de Motive. El valor original quedará guardado para auditoría. ¿Continuar?')) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/records/${encodeURIComponent(button.dataset.resetOdometer)}/reset-odometer-from-motive`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No fue posible corregir el odómetro.');
    showToast(`Odómetro corregido a ${number(data.odometer)} millas desde Motive.`);
    await synchronizeWithDatabase();
  } catch (error) { showToast(error.message || 'No fue posible corregir el odómetro.'); }
  finally { button.disabled = false; }
});
function setUnit(unit) {
  selectedUnit = unit;
  $('#unit-search').value = unit.number;
  $('#unit-options').hidden = true;
  $('#unit-error').textContent = '';
  const last = lastOdometer(unit.id);
  $('#selected-unit').hidden = false;
  $('#selected-unit').innerHTML = `<span>✓</span><div><strong>Unidad ${esc(unit.number)} seleccionada</strong><br><small>${esc(unit.plates)} · ${esc(unit.description)}</small></div>`;
  $('#odometer-note').textContent = last ? `Odómetro de referencia (Motive o carga previa): ${number(last)} millas.` : 'Aún no hay kilometraje previo para esta unidad.';
  if ($('#odometer').value) validateOdometer(true);
  updateReview();
}
function updateSuggestions() {
  const query = $('#unit-search').value.trim().toLowerCase();
  if (!query) { $('#unit-options').hidden = true; return; }
  const matches = units.filter(u => u.number.toLowerCase().includes(query)).slice(0, 6);
  const panel = $('#unit-options');
  panel.innerHTML = matches.length ? matches.map(u => `<button class="suggestion" type="button" data-id="${u.id}" role="option"><strong>Unidad ${esc(u.number)}</strong><small>${esc(u.plates)} · ${esc(u.description)}</small></button>`).join('') : '<div class="suggestion"><strong>Sin coincidencias</strong><small>Esta unidad no está registrada.</small></div>';
  panel.hidden = false;
}
function setDriver(driver) {
  selectedDriver = driver;
  $('#driver-search').value = driver.name;
  $('#driver-options').hidden = true;
  $('#driver-error').textContent = '';
  $('#selected-driver').hidden = false;
  $('#selected-driver').innerHTML = `<span>✓</span><div><strong>${esc(driver.name)} seleccionado</strong><br><small>Chofer registrado en Motive</small></div>`;
  updateReview();
}
function updateDriverSuggestions() {
  const query = $('#driver-search').value.trim().toLowerCase();
  if (!query) { $('#driver-options').hidden = true; return; }
  const matches = drivers.filter(driver => driver.name.toLowerCase().includes(query)).slice(0, 8);
  const panel = $('#driver-options');
  panel.innerHTML = matches.length ? matches.map(driver => `<button class="suggestion" type="button" data-driver-id="${esc(driver.id)}" role="option"><strong>${esc(driver.name)}</strong><small>Chofer registrado en Motive</small></button>`).join('') : '<div class="suggestion"><strong>Sin coincidencias</strong><small>Selecciona un chofer registrado en Motive.</small></div>';
  panel.hidden = false;
}
function setError(id, message) { $(id).textContent = message; }
function odometerCaution() {
  const odometer = odometerValue();
  const previous = selectedUnit && lastOdometer(selectedUnit.id);
  if (!previous || odometer <= previous + odometerWarningJump || odometer > previous + maxOdometerJump) return null;
  return { previous, difference: odometer - previous };
}
function odometerCautionText(caution = odometerCaution()) {
  return caution ? `⚠ Revisión recomendada: está ${number(caution.difference)} millas arriba de la referencia (${number(caution.previous)} mi). Confirma que el número sea correcto.` : '';
}
function validateOdometer(show = true) {
  const odometer = odometerValue();
  const previous = selectedUnit && lastOdometer(selectedUnit.id);
  let message = '';
  if (!odometer) message = 'Indica el kilometraje actual.';
  else if (previous && odometer < previous) message = `No puede ser menor al último registro (${number(previous)} millas).`;
  else if (previous && odometer > previous + maxOdometerJump) message = `El odómetro excede por más de ${number(maxOdometerJump)} millas la referencia (${number(previous)} mi). Verifica que no haya un cero de más.`;
  const caution = message ? null : odometerCaution();
  if (show) setError('#odometer-error', message);
  $('#odometer-warning').textContent = caution ? odometerCautionText(caution) : '';
  $('#odometer').classList.toggle('input-invalid', Boolean(message));
  $('#odometer').classList.toggle('input-warning', Boolean(caution));
  return !message;
}
function validate(show = true) {
  let valid = true;
  const typed = $('#unit-search').value.trim();
  const exact = units.find(u => u.number.toLowerCase() === typed.toLowerCase());
  if (!selectedUnit || selectedUnit.id !== exact?.id) { if (show) setError('#unit-error', 'Selecciona una unidad válida de la lista.'); valid = false; }
  if (!validateOdometer(show)) valid = false;
  const typedDriver = $('#driver-search').value.trim();
  const exactDriver = drivers.find(driver => driver.name.toLowerCase() === typedDriver.toLowerCase());
  if (!selectedDriver || selectedDriver.id !== exactDriver?.id) { if (show) setError('#driver-error', 'Selecciona un chofer válido de la lista.'); valid = false; } else setError('#driver-error', '');
  const gallons = Number($('#gallons').value);
  if (!gallons || gallons <= 0) { if (show) setError('#gallons-error', 'Indica galones mayores a cero.'); valid = false; }
  else if (gallons > 300) { if (show) setError('#gallons-error', 'Máximo permitido: 300 galones por carga.'); valid = false; }
  else setError('#gallons-error', '');
  const amountValue = $('#amount').value.trim(), amount = Number(amountValue);
  if (amountValue && (!amount || amount <= 0)) { if (show) setError('#amount-error', 'El importe debe ser mayor a cero o déjalo vacío para bomba C&C.'); valid = false; } else setError('#amount-error', '');
  if (!$('#station').value.trim()) { if (show) setError('#station-error', 'Indica la estación de servicio.'); valid = false; } else setError('#station-error', '');
  const evidenceFiles = [$('#ticket-photo').files[0], $('#odometer-photo').files[0]];
  if (evidenceFiles.some(file => !file)) { if (show) setError('#evidence-error', 'Debes adjuntar las dos evidencias.'); valid = false; }
  else if (evidenceFiles.some(file => file.size > 8 * 1024 * 1024)) { if (show) setError('#evidence-error', 'Cada foto debe pesar máximo 8 MB.'); valid = false; }
  else setError('#evidence-error', '');
  return valid;
}
function updateReview() {
  const gallons = Number($('#gallons').value), amountValue = $('#amount').value.trim(), amount = amountValue ? Number(amountValue) : null, odo = odometerValue(), driverName = selectedDriver?.name || '';
  const data = [
    ['Unidad', selectedUnit ? `${selectedUnit.number} · ${selectedUnit.plates}` : '—'], ['Chofer', driverName || '—'],
    ['Odómetro', odo ? `${number(odo)} mi${odometerCaution() ? ' ⚠' : ''}` : '—'], ['Galones', gallons ? `${number(gallons)} gal` : '—'],
    ['Importe', amount ? money(amount) : 'Bomba C&C / no aplica'], ['Precio por galón', gallons && amount ? money(amount / gallons) : 'No aplica'],
    ['Evidencias', $('#ticket-photo').files.length && $('#odometer-photo').files.length ? '2 de 2 adjuntas ✓' : `${$('#ticket-photo').files.length + $('#odometer-photo').files.length} de 2 adjuntas`]
  ];
  $('#review-list').innerHTML = data.map(([key, value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`).join('');
  const price = gallons && amount ? amount / gallons : 0;
  $('#price-output').hidden = !price;
  $('#price-output').textContent = price ? `Precio calculado: ${money(price)} por galón` : '';
}
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 3800); }
function resetFuelForm() {
  $('#fuel-form').reset(); selectedUnit = null; selectedDriver = null; $('#selected-unit').hidden = true; $('#selected-driver').hidden = true; $('#unit-options').hidden = true; $('#driver-options').hidden = true; $('#odometer-note').textContent = 'Selecciona una unidad para validar el kilometraje.';
  $('#odometer-warning').textContent = '';
  $('#odometer').classList.remove('input-invalid', 'input-warning');
  document.querySelectorAll('.upload-box').forEach(el => { el.classList.remove('has-file'); el.querySelector('.file-name').textContent = 'Tomar o seleccionar foto'; });
  document.querySelectorAll('.error').forEach(el => el.textContent = ''); updateReview();
}

$('#unit-search').addEventListener('input', () => {
  const typed = $('#unit-search').value.trim();
  const exact = units.find(u => u.number.toLowerCase() === typed.toLowerCase());
  if (exact) { setUnit(exact); return; }
  selectedUnit = null; $('#selected-unit').hidden = true; $('#odometer-warning').textContent = ''; $('#odometer').classList.remove('input-warning'); setError('#unit-error', ''); updateSuggestions(); updateReview();
});
$('#unit-options').addEventListener('click', e => { const button = e.target.closest('[data-id]'); if (button) setUnit(units.find(u => u.id === button.dataset.id)); });
$('#driver-search').addEventListener('input', () => {
  const typed = $('#driver-search').value.trim();
  const exact = drivers.find(driver => driver.name.toLowerCase() === typed.toLowerCase());
  if (exact) { setDriver(exact); return; }
  selectedDriver = null; $('#selected-driver').hidden = true; setError('#driver-error', ''); updateDriverSuggestions(); updateReview();
});
$('#driver-options').addEventListener('click', e => { const button = e.target.closest('[data-driver-id]'); if (button) setDriver(drivers.find(driver => driver.id === button.dataset.driverId)); });
document.addEventListener('click', e => { if (!e.target.closest('.autocomplete')) { $('#unit-options').hidden = true; $('#driver-options').hidden = true; } });
['gallons','amount','station','ticket-photo','odometer-photo'].forEach(id => $(`#${id}`).addEventListener('input', updateReview));
$('#odometer').addEventListener('input', () => { formatOdometerInput(); validateOdometer(Boolean(selectedUnit)); updateReview(); });
const evidenceBoxes = { 'ticket-photo': '#ticket-box', 'odometer-photo': '#odometer-box' };
Object.entries(evidenceBoxes).forEach(([inputId, boxSelector]) => $(`#${inputId}`).addEventListener('change', e => { const box = $(boxSelector); const name = e.target.files[0]?.name; box.classList.toggle('has-file', Boolean(name)); box.querySelector('.file-name').textContent = name || 'Tomar o seleccionar foto'; updateReview(); }));

$('#fuel-form').addEventListener('submit', e => {
  e.preventDefault(); if (!validate()) { showToast('Revisa los campos marcados antes de continuar.'); return; }
  const amountValue = $('#amount').value.trim();
  const caution = odometerCaution();
  const values = [['Unidad', `${selectedUnit.number} · ${selectedUnit.plates}`], ['Chofer', selectedDriver.name], ['Odómetro', `${number(odometerValue())} mi`], ['Galones', `${number($('#gallons').value)} gal`], ['Importe', amountValue ? money(amountValue) : 'Bomba C&C / no aplica'], ['Estación', $('#station').value.trim()]];
  if (caution) values.splice(3, 0, ['Alerta', `Revisar: +${number(caution.difference)} mi vs. referencia`]);
  $('#dialog-summary').innerHTML = values.map(([k,v]) => `<p><span>${k}</span><strong>${esc(v)}</strong></p>`).join(''); $('#confirm-dialog').showModal();
});
$('#confirm-button').addEventListener('click', async e => {
  e.preventDefault();
  const now = new Date();
  const amountValue = $('#amount').value.trim();
  const confirmButton = $('#confirm-button');
  confirmButton.disabled = true;
  let saved;
  try {
    showToast('Subiendo evidencias de forma segura...');
    const [ticketEvidence, odometerEvidence] = await Promise.all([
      uploadEvidence($('#ticket-photo').files[0], 'ticket'),
      uploadEvidence($('#odometer-photo').files[0], 'odometer')
    ]);
    const record = { id: crypto.randomUUID(), folio: `DC-${now.getFullYear()}-${String(records.length + 1).padStart(4,'0')}`, createdAt: now.toISOString(), unitId: selectedUnit.id, unitNumber: selectedUnit.number, plates: selectedUnit.plates, driverId: selectedDriver.id, driverName: selectedDriver.name, odometer: odometerValue(), gallons: Number($('#gallons').value), amount: amountValue ? Number(amountValue) : null, station: $('#station').value.trim(), ticketFile: $('#ticket-photo').files[0].name, odometerFile: $('#odometer-photo').files[0].name, ticketUrl: ticketEvidence.url, odometerUrl: odometerEvidence.url };
    const response = await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No fue posible guardar la carga.');
    saved = data;
  } catch (error) {
    showToast(error.message || 'No se pudo conectar a la base de datos.');
    confirmButton.disabled = false;
    return;
  }
  confirmButton.disabled = false;
  if (isAdmin) { records.push(saved); renderRecords(); }
  $('#confirm-dialog').close(); resetFuelForm(); showToast(`Carga ${saved.folio} guardada.${userRole === 'admin' ? ` ${motiveAssignmentLabel(saved)}` : ''}`); location.hash = '#registro';
});
$('#unit-form').addEventListener('submit', e => { e.preventDefault(); const numberInput = $('#new-unit-number'), plates = $('#new-unit-plates').value.trim().toUpperCase(), description = $('#new-unit-description').value.trim(); const unitNumber = numberInput.value.trim().toUpperCase(); if (units.some(u => u.number.toUpperCase() === unitNumber)) { showToast('Ese número de unidad ya está registrado.'); return; } units.push({ id: crypto.randomUUID(), number: unitNumber, plates, description }); save(STORAGE.units, units); e.target.reset(); renderUnitCatalog(); showToast(`Unidad ${unitNumber} agregada al catálogo.`); });
$('#export-csv').addEventListener('click', () => { if (!records.length) { showToast('Aún no hay registros para exportar.'); return; } const headings = ['Folio','Fecha','Unidad','Chofer','Identificador','Odómetro (millas)','Galones','Importe (MXN)','Estación','Archivo ticket','Archivo odómetro','URL ticket','URL odómetro']; const rows = records.map(r => [r.folio, new Date(r.createdAt).toLocaleString('es-MX'),r.unitNumber,r.driverName ?? '',r.plates,r.odometer,r.gallons,r.amount ?? '',r.station,r.ticketFile,r.odometerFile,r.ticketUrl ?? '',r.odometerUrl ?? '']); const csv = [headings,...rows].map(row => row.map(v => `"${String(v).replaceAll('"','""')}"`).join(',')).join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8'})); link.download = `cargas-diesel-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href); });

function exportRows() {
  const headings = ['Folio', 'Fecha', 'Unidad', 'Chofer', 'Odómetro (millas)', 'Galones', 'Importe (MXN)', 'Estación'];
  const rows = [...displayedRecords].reverse().map((record) => [record.folio, new Date(record.createdAt).toLocaleString('es-MX'), record.unitNumber, record.driverName || '', record.odometer, record.gallons, record.amount ?? '', record.station]);
  return [headings, ...rows];
}
function downloadFile(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
}
function exportCsv() {
  if (!displayedRecords.length) { showToast('No hay cargas en el rango seleccionado.'); return; }
  const csv = exportRows().map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
  downloadFile(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }), `cargas-diesel-${new Date().toISOString().slice(0, 10)}.csv`);
}
function xmlEscape(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;'); }
function spreadsheetValue(value) { const text = String(value ?? ''); return /^[=+\-@]/.test(text) ? `'${text}` : text; }
function spreadsheetColumn(index) { let output = ''; for (let number = index + 1; number; number = Math.floor((number - 1) / 26)) output = String.fromCharCode(65 + (number - 1) % 26) + output; return output; }
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function xlsxZip(files) {
  const encoder = new TextEncoder(), parts = [], central = [], offsets = [];
  let offset = 0;
  const bytes = (size) => new Uint8Array(size);
  const write16 = (target, position, value) => new DataView(target.buffer).setUint16(position, value, true);
  const write32 = (target, position, value) => new DataView(target.buffer).setUint32(position, value >>> 0, true);
  for (const [name, content] of files) {
    const nameBytes = encoder.encode(name), contentBytes = encoder.encode(content), crc = crc32(contentBytes), local = bytes(30 + nameBytes.length);
    write32(local, 0, 0x04034b50); write16(local, 4, 20); write16(local, 8, 0); write32(local, 14, crc); write32(local, 18, contentBytes.length); write32(local, 22, contentBytes.length); write16(local, 26, nameBytes.length); local.set(nameBytes, 30);
    parts.push(local, contentBytes); offsets.push(offset); offset += local.length + contentBytes.length;
    const header = bytes(46 + nameBytes.length); write32(header, 0, 0x02014b50); write16(header, 4, 20); write16(header, 6, 20); write16(header, 10, 0); write32(header, 16, crc); write32(header, 20, contentBytes.length); write32(header, 24, contentBytes.length); write16(header, 28, nameBytes.length); write32(header, 42, offsets[offsets.length - 1]); header.set(nameBytes, 46); central.push(header);
  }
  const centralSize = central.reduce((total, part) => total + part.length, 0), end = bytes(22);
  write32(end, 0, 0x06054b50); write16(end, 8, files.length); write16(end, 10, files.length); write32(end, 12, centralSize); write32(end, 16, offset);
  return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function exportExcel() {
  if (!displayedRecords.length) { showToast('No hay cargas en el rango seleccionado.'); return; }
  const rows = exportRows();
  const sheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => `<c r="${spreadsheetColumn(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xmlEscape(spreadsheetValue(value))}</t></is></c>`).join('')}</row>`).join('');
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cargas de diesel" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`]
  ];
  downloadFile(xlsxZip(files), `cargas-diesel-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
const csvButton = $('#export-csv').cloneNode(true);
$('#export-csv').replaceWith(csvButton);
csvButton.addEventListener('click', exportCsv);
$('#export-excel').addEventListener('click', exportExcel);

$('#unit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  const numberInput = $('#new-unit-number');
  const number = numberInput.value.trim().toUpperCase();
  const plates = $('#new-unit-plates').value.trim().toUpperCase();
  const description = $('#new-unit-description').value.trim();
  if (units.some((unit) => unit.number.toUpperCase() === number)) { showToast('Ese número de unidad ya está registrado.'); return; }
  try {
    const response = await fetch('/api/units', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number, plates, description }) });
    const saved = await response.json();
    if (!response.ok) throw new Error(saved.error || 'No fue posible agregar la unidad.');
    units.push(saved); save(STORAGE.units, units); event.currentTarget.reset(); renderUnitCatalog(); showToast(`Unidad ${number} agregada al catálogo.`);
  } catch (error) { showToast(error.message || 'No se pudo conectar a la base de datos.'); }
}, { capture: true });

function setAdminInterface(authenticated, role = null) {
  isAdmin = authenticated;
  userRole = authenticated ? role : null;
  $('#registros').hidden = !authenticated;
  $('#unidades').hidden = !authenticated;
  $('#unit-form').hidden = role !== 'admin';
  $('#units-link').hidden = !authenticated;
  $('#login-button').hidden = authenticated;
  $('#logout-button').hidden = !authenticated;
}
async function updateSession() {
  try {
    const response = await fetch('/api/auth/status');
    const data = await response.json();
    setAdminInterface(Boolean(data.authenticated), data.role);
  } catch { setAdminInterface(false); }
  return isAdmin;
}
async function synchronizeWithDatabase() {
  try {
    const admin = await updateSession();
    const [unitsResponse, driversResponse] = await Promise.all([fetch('/api/units'), fetch('/api/drivers')]);
    if (unitsResponse.ok) { units = await unitsResponse.json(); save(STORAGE.units, units); }
    if (driversResponse.ok) { drivers = await driversResponse.json(); save(STORAGE.drivers, drivers); }
    if (admin) {
      const recordsResponse = await fetch('/api/records');
      if (recordsResponse.ok) { records = await recordsResponse.json(); }
    } else {
      records = [];
      localStorage.removeItem(STORAGE.records);
    }
    renderUnitCatalog(); renderRecords(); updateReview();
  } catch { /* El sitio muestra el catálogo inicial hasta que PostgreSQL esté conectado. */ }
}

$('#records-link').addEventListener('click', (event) => {
  if (isAdmin) return;
  event.preventDefault();
  $('#login-error').textContent = '';
  $('#login-dialog').showModal();
  $('#login-email').focus();
});
$('#login-button').addEventListener('click', () => {
  $('#login-error').textContent = '';
  $('#login-dialog').showModal();
  $('#login-email').focus();
});
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#login-submit');
  button.disabled = true;
  $('#login-error').textContent = '';
  try {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('#login-email').value, password: $('#login-password').value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No fue posible iniciar sesión.');
    $('#login-dialog').close();
    $('#login-form').reset();
    await synchronizeWithDatabase();
    location.hash = '#registros';
    showToast('Sesión iniciada.');
  } catch (error) { $('#login-error').textContent = error.message || 'No fue posible iniciar sesión.'; }
  button.disabled = false;
});
$('#logout-button').addEventListener('click', async () => {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* La interfaz se cierra aun si hubo un problema de red. */ }
  records = [];
  localStorage.removeItem(STORAGE.records);
  setAdminInterface(false);
  renderRecords();
  location.hash = '#registro';
  showToast('Sesión cerrada.');
});

setAdminInterface(false); renderUnitCatalog(); renderRecords(); updateReview(); synchronizeWithDatabase();
