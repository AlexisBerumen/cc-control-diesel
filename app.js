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
let assignmentUnit = null;
let assignmentDriver = null;
let toastTimer;
let isAdmin = false;
let userRole = null;
let activeRecordsRange = { from: '', to: '' };
let recordsPagination = { page: 1, limit: 20, total: 0, totalPages: 1 };
let reconciliationData = null;
let unitCatalogPage = 1;
const maxOdometerJump = 10_000;
const odometerWarningJump = 2_000;
const recordsPageSize = 20;
const unitCatalogPageSize = 24;

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
function unitDescription(unit) { return unit?.description || 'Sin descripción'; }
function recordUnitDescription(record) { return unitDescription(units.find((unit) => unit.id === record.unitId)); }
function renderUnitCatalog() {
  const totalPages = Math.max(1, Math.ceil(units.length / unitCatalogPageSize));
  unitCatalogPage = Math.min(Math.max(1, unitCatalogPage), totalPages);
  const first = (unitCatalogPage - 1) * unitCatalogPageSize;
  const visibleUnits = units.slice(first, first + unitCatalogPageSize);
  $('#unit-catalog').innerHTML = units.length ? visibleUnits.map(u => `<div class="catalog-unit"><strong>Unidad ${esc(u.number)}</strong><small>${esc(unitDescription(u))}</small></div>`).join('') : '<p class="muted">No hay unidades registradas.</p>';
  const controls = $('#unit-catalog-pagination');
  controls.hidden = units.length <= unitCatalogPageSize;
  $('#unit-catalog-previous-page').disabled = unitCatalogPage <= 1;
  $('#unit-catalog-next-page').disabled = unitCatalogPage >= totalPages;
  $('#unit-catalog-page-summary').textContent = units.length ? `Mostrando ${first + 1}–${Math.min(first + visibleUnits.length, units.length)} de ${units.length} unidades · Página ${unitCatalogPage} de ${totalPages}` : '';
}
$('#unit-catalog-previous-page').addEventListener('click', () => { unitCatalogPage = Math.max(1, unitCatalogPage - 1); renderUnitCatalog(); });
$('#unit-catalog-next-page').addEventListener('click', () => { unitCatalogPage += 1; renderUnitCatalog(); });
function motiveAssignmentLabel(record) {
  const labels = {
    already_assigned: 'Motive: ya asignado',
    updated: 'Motive: chofer actualizado',
    pending: 'Motive: pendiente',
    processing: 'Motive: verificando'
  };
  return labels[record.motiveAssignmentStatus] || 'Motive: no disponible';
}
function recordsSearchParams({ page = recordsPagination.page, exportAll = false } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(recordsPageSize) });
  if (activeRecordsRange.from) params.set('from', activeRecordsRange.from);
  if (activeRecordsRange.to) params.set('to', activeRecordsRange.to);
  if (exportAll) params.set('export', '1');
  return params;
}
async function requestRecords({ page = recordsPagination.page, exportAll = false } = {}) {
  const response = await fetch(`/api/records?${recordsSearchParams({ page, exportAll }).toString()}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No fue posible consultar los registros.');
  return data;
}
async function loadRecordsPage(page = 1) {
  const data = await requestRecords({ page });
  records = data.records || [];
  recordsPagination = data.pagination || { page: 1, limit: recordsPageSize, total: records.length, totalPages: 1 };
  renderRecords();
}
function updateRecordsFilterSummary() {
  const summary = $('#records-filter-summary');
  const total = Number(recordsPagination.total || 0);
  if (!total) {
    summary.textContent = activeRecordsRange.from || activeRecordsRange.to ? 'No hay cargas en el rango seleccionado.' : 'Aún no hay cargas registradas.';
    return;
  }
  const first = (Number(recordsPagination.page) - 1) * Number(recordsPagination.limit) + 1;
  const last = first + records.length - 1;
  if (!activeRecordsRange.from && !activeRecordsRange.to) {
    summary.textContent = `Mostrando ${first}–${last} de ${total} carga(s), de la más reciente hacia atrás.`;
    return;
  }
  const range = [activeRecordsRange.from && `desde ${activeRecordsRange.from}`, activeRecordsRange.to && `hasta ${activeRecordsRange.to}`].filter(Boolean).join(' ');
  summary.textContent = `Mostrando ${first}–${last} de ${total} carga(s) ${range}.`;
}
function updateRecordsPagination() {
  const controls = $('#records-pagination');
  const totalPages = Number(recordsPagination.totalPages || 1);
  const page = Number(recordsPagination.page || 1);
  controls.hidden = Number(recordsPagination.total || 0) === 0;
  $('#records-previous-page').disabled = page <= 1;
  $('#records-next-page').disabled = page >= totalPages;
  $('#records-page-summary').textContent = totalPages > 1 ? `Página ${page} de ${totalPages}` : 'Página 1 de 1';
}
function renderRecords() {
  const body = $('#records-body');
  if (!records.length) body.innerHTML = '<tr class="empty"><td colspan="8">Aún no hay cargas registradas.</td></tr>';
  else body.innerHTML = records.map(r => `<tr><td>${esc(r.folio)}</td><td>${new Date(r.createdAt).toLocaleString('es-MX', { dateStyle:'short', timeStyle:'short' })}</td><td><strong>${esc(r.unitNumber)}</strong><br><small>${esc(r.driverName || 'No registrado')} · ${esc(recordUnitDescription(r))}</small></td><td>${number(r.odometer)} mi</td><td>${number(r.gallons)} gal</td><td>${r.amount === null || r.amount === undefined ? 'Bomba C&C' : money(r.amount)}</td><td>${r.ticketUrl && r.odometerUrl ? `<a class="evidence-link" href="${esc(r.ticketUrl)}" target="_blank" rel="noopener">Ticket</a><a class="evidence-link" href="${esc(r.odometerUrl)}" target="_blank" rel="noopener">Odómetro</a>` : 'No disponible'}</td><td><span class="status">Completo</span></td></tr>`).join('');
  const renderedRows = [...$('#records-body').querySelectorAll('tr')];
  renderedRows.forEach((row, index) => {
    const record = records[index];
    if (!record || !record.odometerWarning) return;
    const difference = Number(record.odometerDifference || 0);
    row.classList.add('odometer-warning-row');
    if (row.children[3]) row.children[3].innerHTML = `${number(record.odometer)} mi<br><small class="odometer-warning-badge">⚠ Revisar: +${number(difference)} mi vs. referencia</small>`;
  });
  if (userRole === 'admin') renderedRows.forEach((row, index) => {
    const record = records[index];
    if (!record || !row.lastElementChild) return;
    row.lastElementChild.innerHTML = `<span class="status">Completo</span><br><small title="${esc(record.motiveAssignmentMessage || '')}">${esc(motiveAssignmentLabel(record))}</small>`;
    const motiveOdometer = Number(units.find((unit) => unit.id === record.unitId)?.motiveOdometer || 0);
    if (motiveOdometer && Number(record.odometer) > motiveOdometer + maxOdometerJump) row.lastElementChild.insertAdjacentHTML('beforeend', `<br><button class="odometer-reset" type="button" data-reset-odometer="${esc(record.id)}">Corregir con Motive</button>`);
  });
  updateRecordsFilterSummary();
  updateRecordsPagination();
}
function isoDateInMexico(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
function setDefaultReconciliationRange() {
  const today = new Date();
  const start = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
  $('#reconciliation-date-from').value = isoDateInMexico(start);
  $('#reconciliation-date-to').value = isoDateInMexico(today);
}
function renderReconciliationUnitOptions() {
  const select = $('#reconciliation-unit');
  const selected = select.value;
  select.innerHTML = `<option value="">Todas las unidades</option>${units.map((unit) => `<option value="${esc(unit.id)}">${esc(unit.number)} · ${esc(unitDescription(unit))}</option>`).join('')}`;
  select.value = units.some((unit) => unit.id === selected) ? selected : '';
}
function setAssignmentUnit(unit) {
  assignmentUnit = unit;
  $('#assignment-unit-search').value = unit.number;
  $('#assignment-unit-options').hidden = true;
  $('#assignment-selected-unit').hidden = false;
  $('#assignment-selected-unit').innerHTML = `<span>✓</span><div><strong>Unidad ${esc(unit.number)} seleccionada</strong><br><small>${esc(unitDescription(unit))}</small></div>`;
}
function setAssignmentDriver(driver) {
  assignmentDriver = driver;
  $('#assignment-driver-search').value = driver.name;
  $('#assignment-driver-options').hidden = true;
  $('#assignment-selected-driver').hidden = false;
  $('#assignment-selected-driver').innerHTML = `<span>✓</span><div><strong>${esc(driver.name)} seleccionado</strong><br><small>Chofer registrado en Motive</small></div>`;
}
function updateAssignmentUnitSuggestions() {
  const query = $('#assignment-unit-search').value.trim().toLowerCase();
  const panel = $('#assignment-unit-options');
  if (!query) { panel.hidden = true; return; }
  const matches = units.filter((unit) => unit.number.toLowerCase().includes(query)).slice(0, 8);
  panel.innerHTML = matches.length ? matches.map((unit) => `<button class="suggestion" type="button" data-assignment-unit-id="${esc(unit.id)}"><strong>Unidad ${esc(unit.number)}</strong><small>${esc(unitDescription(unit))}</small></button>`).join('') : supportSuggestion('unidad');
  panel.hidden = false;
}
function updateAssignmentDriverSuggestions() {
  const query = $('#assignment-driver-search').value.trim().toLowerCase();
  const panel = $('#assignment-driver-options');
  if (!query) { panel.hidden = true; return; }
  const matches = drivers.filter((driver) => driver.name.toLowerCase().includes(query)).slice(0, 8);
  panel.innerHTML = matches.length ? matches.map((driver) => `<button class="suggestion" type="button" data-assignment-driver-id="${esc(driver.id)}"><strong>${esc(driver.name)}</strong><small>Chofer registrado en Motive</small></button>`).join('') : supportSuggestion('chofer');
  panel.hidden = false;
}
function renderDriverAssignmentOptions() {
  if (assignmentUnit && !units.some((unit) => String(unit.id) === String(assignmentUnit.id))) { assignmentUnit = null; $('#assignment-unit-search').value = ''; $('#assignment-selected-unit').hidden = true; }
  if (assignmentDriver && !drivers.some((driver) => String(driver.id) === String(assignmentDriver.id))) { assignmentDriver = null; $('#assignment-driver-search').value = ''; $('#assignment-selected-driver').hidden = true; }
}
function showDriverAssignmentResult(message, status) {
  const result = $('#driver-assignment-result');
  result.textContent = message;
  result.hidden = false;
  result.className = `driver-assignment-result ${status}`;
}
function reconciliationStatusText(row) {
  if (row.status === 'ready') return 'Datos completos';
  if (row.status === 'no_fuel_records') return 'Sin cargas en periodo';
  if (row.status === 'inconsistent_readings') return 'Revisar lecturas';
  return 'Faltan lecturas Motive';
}
function reconciliationStatus(row) {
  const label = reconciliationStatusText(row);
  if (row.status === 'ready') return `<span class="status">${label}</span>`;
  if (row.status === 'no_fuel_records') return `<span class="status-neutral">${label}</span>`;
  if (row.status === 'inconsistent_readings') return `<span class="status-warning">${label}</span>`;
  return `<span class="status-muted">${label}</span>`;
}
function valueOrDash(value, suffix = '') {
  return value === null || value === undefined || value === '' ? '—' : `${number(value)}${suffix}`;
}
function setReconciliationKpis(rows = []) {
  const complete = rows.filter((row) => row.status === 'ready');
  const rowsWithMiles = rows.filter((row) => row.miles !== null && row.miles !== undefined && Number.isFinite(Number(row.miles)) && Number(row.miles) >= 0);
  const totalMiles = rowsWithMiles.reduce((total, row) => total + Number(row.miles), 0);
  const totalGallons = rows.reduce((total, row) => total + Number(row.gallons || 0), 0);
  const completeMiles = complete.reduce((total, row) => total + Number(row.miles), 0);
  const completeGallons = complete.reduce((total, row) => total + Number(row.gallons), 0);
  $('#reconciliation-kpi-units').textContent = rows.length ? number(rows.length) : '—';
  $('#reconciliation-kpi-ready').textContent = rows.length ? number(complete.length) : '—';
  $('#reconciliation-kpi-miles').textContent = rowsWithMiles.length ? `${number(totalMiles)} mi` : '—';
  $('#reconciliation-kpi-gallons').textContent = rows.length ? `${number(totalGallons)} gal` : '—';
  $('#reconciliation-kpi-mpg').textContent = completeGallons > 0 ? number(completeMiles / completeGallons) : '—';
}
function reconciliationRowsForView(rows) {
  const filter = $('#reconciliation-view-filter').value;
  if (filter === 'missing-readings') return rows.filter((row) => row.status === 'insufficient_readings');
  if (filter === 'all') return rows;
  return rows.filter((row) => row.miles !== null && row.miles !== undefined && Number.isFinite(Number(row.miles)));
}
function renderReconciliation(data = null) {
  const body = $('#reconciliation-body');
  const summary = $('#reconciliation-summary');
  const insight = $('#reconciliation-insight');
  if (!data) {
    body.innerHTML = '<tr class="empty"><td colspan="8">Aún no hay una consulta de conciliación.</td></tr>';
    summary.textContent = 'Selecciona un rango para consultar las lecturas disponibles.';
    insight.textContent = 'Consulta un periodo para ver el resumen de las unidades.';
    setReconciliationKpis();
    return;
  }
  const allRows = data.rows || [];
  const rows = reconciliationRowsForView(allRows);
  body.innerHTML = rows.length ? rows.map((row) => `<tr class="reconciliation-${esc(row.status)}"><td><strong>${esc(row.unitNumber)}</strong><br><small>${esc(row.description || 'Sin descripción')}</small></td><td>${valueOrDash(row.odometerStart, ' mi')}</td><td>${valueOrDash(row.odometerEnd, ' mi')}</td><td>${valueOrDash(row.miles, ' mi')}</td><td>${valueOrDash(row.gallons, ' gal')}</td><td>${row.mpg === null || row.mpg === undefined ? '—' : number(row.mpg)}</td><td>${number(row.fuelLoadCount || 0)}</td><td>${reconciliationStatus(row)}</td></tr>`).join('') : '<tr class="empty"><td colspan="8">No hay unidades para el filtro seleccionado.</td></tr>';
  const ready = rows.filter((row) => row.status === 'ready').length;
  const missing = rows.filter((row) => row.status === 'insufficient_readings').length;
  const withoutFuel = rows.filter((row) => row.status === 'no_fuel_records').length;
  summary.textContent = `Mostrando ${number(rows.length)} de ${number(allRows.length)} unidad(es) · ${number(ready)} con datos completos · ${number(missing)} con lecturas insuficientes · ${number(withoutFuel)} sin cargas.`;
  insight.textContent = ready
    ? `El periodo ya tiene ${number(ready)} unidad(es) con información completa para revisar consumo.`
    : 'Aún no hay suficientes pares de lecturas en este rango. La información se completará conforme Motive siga sincronizando odómetros.';
  setReconciliationKpis(rows);
}
async function loadReconciliation() {
  const from = $('#reconciliation-date-from').value;
  const to = $('#reconciliation-date-to').value;
  if (!from || !to || from > to) throw new Error('Selecciona un rango de fechas válido para la conciliación.');
  const params = new URLSearchParams({ from, to });
  if ($('#reconciliation-unit').value) params.set('unitId', $('#reconciliation-unit').value);
  const response = await fetch(`/api/reconciliation?${params.toString()}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No fue posible consultar la conciliación.');
  reconciliationData = data;
  renderReconciliation(data);
}
$('#apply-reconciliation-filter').addEventListener('click', () => void loadReconciliation().catch((error) => showToast(error.message || 'No fue posible consultar la conciliación.')));
$('#clear-reconciliation-filter').addEventListener('click', () => {
  setDefaultReconciliationRange();
  $('#reconciliation-unit').value = '';
  $('#reconciliation-view-filter').value = 'with-miles';
  void loadReconciliation().catch((error) => showToast(error.message || 'No fue posible consultar la conciliación.'));
});
$('#reconciliation-unit').addEventListener('change', () => void loadReconciliation().catch((error) => showToast(error.message || 'No fue posible consultar la conciliación.')));
$('#reconciliation-view-filter').addEventListener('change', () => renderReconciliation(reconciliationData));
$('#assignment-unit-search').addEventListener('input', () => {
  assignmentUnit = null;
  $('#assignment-selected-unit').hidden = true;
  $('#driver-assignment-result').hidden = true;
  updateAssignmentUnitSuggestions();
});
$('#assignment-driver-search').addEventListener('input', () => {
  assignmentDriver = null;
  $('#assignment-selected-driver').hidden = true;
  $('#driver-assignment-result').hidden = true;
  updateAssignmentDriverSuggestions();
});
$('#assignment-unit-options').addEventListener('click', (event) => {
  const button = event.target.closest('[data-assignment-unit-id]');
  const unit = button && units.find((item) => String(item.id) === button.dataset.assignmentUnitId);
  if (unit) setAssignmentUnit(unit);
});
$('#assignment-driver-options').addEventListener('click', (event) => {
  const button = event.target.closest('[data-assignment-driver-id]');
  const driver = button && drivers.find((item) => String(item.id) === button.dataset.assignmentDriverId);
  if (driver) setAssignmentDriver(driver);
});
$('#driver-assignment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const unit = assignmentUnit;
  const driver = assignmentDriver;
  if (!unit || !driver) { showDriverAssignmentResult('Selecciona una unidad y un chofer desde las listas antes de continuar.', 'error'); return; }
  const unitId = unit.id;
  const driverId = driver.id;
  if (!units.some((item) => String(item.id) === String(unitId)) || !drivers.some((item) => String(item.id) === String(driverId))) { showDriverAssignmentResult('La unidad o el chofer seleccionado ya no están disponibles. Actualiza la página e inténtalo de nuevo.', 'error'); return; }
  if (!confirm(`Se verificará en Motive la asignación de ${driver.name} a la unidad ${unit.number}. ¿Deseas continuar?`)) return;
  const button = $('#assign-driver-button');
  button.disabled = true;
  showDriverAssignmentResult('Verificando la asignación con Motive...', 'pending');
  try {
    const response = await fetch('/api/driver-assignments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unitId, driverId }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No fue posible actualizar la asignación.');
    const prefix = data.status === 'already_assigned' ? 'Sin cambios: ' : data.status === 'updated' ? 'Asignación actualizada: ' : 'Pendiente: ';
    showDriverAssignmentResult(`${prefix}${data.message || 'La operación se completó.'}`, data.status === 'pending' ? 'pending' : 'success');
    showToast(data.status === 'updated' ? `Chofer actualizado en Motive para la unidad ${data.unitNumber}.` : data.message || 'Asignación verificada.');
  } catch (error) {
    showDriverAssignmentResult(error.message || 'No fue posible actualizar la asignación.', 'error');
  } finally { button.disabled = false; }
});
async function applyRecordsFilter() {
  const from = $('#records-date-from').value;
  const to = $('#records-date-to').value;
  if (from && to && from > to) { showToast('La fecha inicial no puede ser posterior a la fecha final.'); return; }
  activeRecordsRange = { from, to };
  try { await loadRecordsPage(1); }
  catch (error) { showToast(error.message || 'No fue posible filtrar los registros.'); }
}
$('#apply-records-filter').addEventListener('click', applyRecordsFilter);
$('#records-date-from').addEventListener('change', () => { if (!$('#records-date-to').value || $('#records-date-from').value <= $('#records-date-to').value) void applyRecordsFilter(); });
$('#records-date-to').addEventListener('change', () => { if (!$('#records-date-from').value || $('#records-date-from').value <= $('#records-date-to').value) void applyRecordsFilter(); });
$('#clear-records-filter').addEventListener('click', () => {
  $('#records-date-from').value = '';
  $('#records-date-to').value = '';
  activeRecordsRange = { from: '', to: '' };
  void loadRecordsPage(1).catch((error) => showToast(error.message || 'No fue posible actualizar los registros.'));
});
$('#records-previous-page').addEventListener('click', () => void loadRecordsPage(Math.max(1, Number(recordsPagination.page) - 1)).catch((error) => showToast(error.message || 'No fue posible cambiar de página.')));
$('#records-next-page').addEventListener('click', () => void loadRecordsPage(Number(recordsPagination.page) + 1).catch((error) => showToast(error.message || 'No fue posible cambiar de página.')));
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
  $('#selected-unit').innerHTML = `<span>✓</span><div><strong>Unidad ${esc(unit.number)} seleccionada</strong><br><small>${esc(unitDescription(unit))}</small></div>`;
  $('#odometer-note').textContent = last ? `Odómetro de referencia (Motive o carga previa): ${number(last)} millas.` : 'Aún no hay kilometraje previo para esta unidad.';
  if ($('#odometer').value) validateOdometer(true);
  updateReview();
}
function supportSuggestion(kind) {
  const message = kind === 'chofer'
    ? 'No encontramos ese chofer. Contacta a soporte para registrarlo o sincronizarlo con Motive antes de continuar.'
    : 'No encontramos esa unidad. Contacta a soporte para darla de alta antes de continuar.';
  const whatsappText = kind === 'chofer'
    ? 'Hola, necesito apoyo para registrar una carga de diésel. El chofer que busco no aparece en la lista.'
    : 'Hola, necesito apoyo para registrar una carga de diésel. La unidad que busco no aparece en la lista.';
  return `<div class="suggestion support-suggestion"><strong>¿No aparece el ${kind}?</strong><small>${message}</small><a class="support-whatsapp" href="https://wa.me/526183249678?text=${encodeURIComponent(whatsappText)}" target="_blank" rel="noopener">Contactar por WhatsApp</a></div>`;
}
function updateSuggestions() {
  const query = $('#unit-search').value.trim().toLowerCase();
  if (!query) { $('#unit-options').hidden = true; return; }
  const matches = units.filter(u => u.number.toLowerCase().includes(query)).slice(0, 6);
  const panel = $('#unit-options');
  panel.innerHTML = matches.length ? matches.map(u => `<button class="suggestion" type="button" data-id="${u.id}" role="option"><strong>Unidad ${esc(u.number)}</strong><small>${esc(unitDescription(u))}</small></button>`).join('') : supportSuggestion('unidad');
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
  panel.innerHTML = matches.length ? matches.map(driver => `<button class="suggestion" type="button" data-driver-id="${esc(driver.id)}" role="option"><strong>${esc(driver.name)}</strong><small>Chofer registrado en Motive</small></button>`).join('') : supportSuggestion('chofer');
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
  return caution ? `⚠ Atención: está ${number(caution.difference)} millas arriba de la referencia (${number(caution.previous)} mi). Si ya revisaste el odómetro y el número es correcto, puedes continuar; se te pedirá confirmarlo antes de guardar.` : '';
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
    ['Unidad', selectedUnit ? `${selectedUnit.number} · ${unitDescription(selectedUnit)}` : '—'], ['Chofer', driverName || '—'],
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
  $('#dialog-odometer-warning').hidden = true;
  $('#odometer-warning-confirm').checked = false;
  document.querySelectorAll('.upload-box').forEach(el => { el.classList.remove('has-file'); el.querySelector('.file-name').textContent = 'Toca aquí para tomar la foto'; });
  document.querySelectorAll('.error').forEach(el => el.textContent = ''); updateReview();
}

$('#unit-search').addEventListener('input', () => {
  selectedUnit = null; $('#selected-unit').hidden = true; $('#odometer-warning').textContent = ''; $('#odometer').classList.remove('input-warning'); setError('#unit-error', ''); updateSuggestions(); updateReview();
});
$('#unit-options').addEventListener('click', e => { const button = e.target.closest('[data-id]'); if (button) setUnit(units.find(u => u.id === button.dataset.id)); });
$('#driver-search').addEventListener('input', () => {
  selectedDriver = null; $('#selected-driver').hidden = true; setError('#driver-error', ''); updateDriverSuggestions(); updateReview();
});
$('#driver-options').addEventListener('click', e => { const button = e.target.closest('[data-driver-id]'); if (button) setDriver(drivers.find(driver => driver.id === button.dataset.driverId)); });
document.addEventListener('click', e => { if (!e.target.closest('.autocomplete')) { $('#unit-options').hidden = true; $('#driver-options').hidden = true; } });
['gallons','amount','station','ticket-photo','odometer-photo'].forEach(id => $(`#${id}`).addEventListener('input', updateReview));
$('#odometer').addEventListener('input', () => { formatOdometerInput(); validateOdometer(Boolean(selectedUnit)); updateReview(); });
const evidenceBoxes = { 'ticket-photo': '#ticket-box', 'odometer-photo': '#odometer-box' };
Object.entries(evidenceBoxes).forEach(([inputId, boxSelector]) => $(`#${inputId}`).addEventListener('change', e => { const box = $(boxSelector); const name = e.target.files[0]?.name; box.classList.toggle('has-file', Boolean(name)); box.querySelector('.file-name').textContent = name || 'Tomar o seleccionar foto'; updateReview(); }));

$('#odometer-warning-confirm').addEventListener('change', () => {
  $('#confirm-button').disabled = !$('#odometer-warning-confirm').checked;
});
$('#edit-button').addEventListener('click', () => $('#confirm-dialog').close());

$('#fuel-form').addEventListener('submit', e => {
  e.preventDefault(); if (!validate()) { showToast('Revisa los campos marcados antes de continuar.'); return; }
  const amountValue = $('#amount').value.trim();
  const caution = odometerCaution();
  const values = [['Unidad', `${selectedUnit.number} · ${unitDescription(selectedUnit)}`], ['Chofer', selectedDriver.name], ['Odómetro', `${number(odometerValue())} mi`], ['Galones', `${number($('#gallons').value)} gal`], ['Importe', amountValue ? money(amountValue) : 'Bomba C&C / no aplica'], ['Estación', $('#station').value.trim()]];
  if (caution) values.splice(3, 0, ['Alerta', `Revisar: +${number(caution.difference)} mi vs. referencia`]);
  $('#dialog-summary').innerHTML = values.map(([k,v]) => `<p><span>${k}</span><strong>${esc(v)}</strong></p>`).join('');
  $('#dialog-odometer-warning').hidden = !caution;
  $('#odometer-warning-confirm').checked = false;
  $('#confirm-button').disabled = Boolean(caution);
  if (caution) $('#dialog-odometer-warning-text').textContent = `La lectura está ${number(caution.difference)} millas arriba de la referencia. Si ya revisaste la foto y el número es correcto, marca la casilla para continuar.`;
  $('#confirm-dialog').showModal();
});
$('#confirm-button').addEventListener('click', async e => {
  e.preventDefault();
  if (!$('#dialog-odometer-warning').hidden && !$('#odometer-warning-confirm').checked) { showToast('Confirma que verificaste el odómetro antes de continuar.'); return; }
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
  if (isAdmin) {
    try { await loadRecordsPage(1); }
    catch { /* La carga ya se guardó; el historial se actualizará al volver a abrirlo. */ }
  }
  $('#confirm-dialog').close();
  resetFuelForm();
  $('#success-folio').textContent = `Folio de carga: ${saved.folio}`;
  $('#success-dialog').showModal();
  showToast(`Carga ${saved.folio} guardada.`);
  location.hash = '#registro';
});
function exportRows(recordsForExport) {
  const headings = ['Folio', 'Fecha', 'Unidad', 'Chofer', 'Odómetro (millas)', 'Galones', 'Importe (MXN)', 'Estación', 'Evidencia bomba', 'Evidencia odómetro', 'Alerta de odómetro'];
  const rows = recordsForExport.map((record) => [record.folio, new Date(record.createdAt).toLocaleString('es-MX'), record.unitNumber, record.driverName || '', record.odometer, record.gallons, record.amount ?? '', record.station, record.ticketUrl ? 'Bomba (clic aquí)' : '', record.odometerUrl ? 'Odómetro (clic aquí)' : '', odometerExportAlert(record)]);
  return [headings, ...rows];
}
function odometerExportAlert(record) {
  if (!record.odometerWarning) return '';
  const difference = Number(record.odometerDifference || 0);
  const reference = Number(record.odometerReference || 0);
  return `ALERTA: +${number(difference)} mi vs. referencia ${number(reference)} mi. Verificar odómetro.`;
}
function downloadFile(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
}
async function loadRecordsForExport() {
  const data = await requestRecords({ page: 1, exportAll: true });
  if (data.pagination?.exportTruncated) throw new Error('Hay más de 10,000 cargas en este rango. Reduce las fechas antes de exportar.');
  return data.records || [];
}
async function exportCsv() {
  const button = $('#export-csv');
  button.disabled = true;
  try {
    showToast('Preparando archivo CSV...');
    const recordsForExport = await loadRecordsForExport();
    if (!recordsForExport.length) { showToast('No hay cargas en el rango seleccionado.'); return; }
    const csv = exportRows(recordsForExport).map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    downloadFile(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }), `cargas-diesel-${new Date().toISOString().slice(0, 10)}.csv`);
  } catch (error) { showToast(error.message || 'No fue posible exportar el CSV.'); }
  finally { button.disabled = false; }
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
function spreadsheetCell(value, cellReference, styleIndex, numeric) {
  const numericValue = Number(value);
  if (numeric && value !== '' && value !== null && value !== undefined && Number.isFinite(numericValue)) return `<c r="${cellReference}"${styleIndex ? ` s="${styleIndex}"` : ''}><v>${numericValue}</v></c>`;
  return `<c r="${cellReference}"${styleIndex ? ` s="${styleIndex}"` : ''} t="inlineStr"><is><t>${xmlEscape(spreadsheetValue(value))}</t></is></c>`;
}
function exportExcelFile(recordsForExport) {
  const rows = exportRows(recordsForExport);
  const hyperlinkColumns = { 8: 'ticketUrl', 9: 'odometerUrl' };
  const hyperlinks = [];
  const sheetRows = rows.map((row, rowIndex) => {
    const warning = rowIndex > 0 && recordsForExport[rowIndex - 1]?.odometerWarning;
    return `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
      const numeric = rowIndex > 0 && [4, 5, 6].includes(columnIndex);
      const record = rowIndex > 0 ? recordsForExport[rowIndex - 1] : null;
      const evidenceField = hyperlinkColumns[columnIndex];
      const cellReference = `${spreadsheetColumn(columnIndex)}${rowIndex + 1}`;
      const hasHyperlink = Boolean(evidenceField && record?.[evidenceField]);
      if (hasHyperlink) hyperlinks.push({ cellReference, url: record[evidenceField] });
      const styleIndex = numeric ? (warning ? 3 : 2) : (hasHyperlink ? (warning ? 5 : 4) : (warning ? 1 : 0));
      return spreadsheetCell(value, cellReference, styleIndex, numeric);
    }).join('')}</row>`;
  }).join('');
  const columnWidths = [18, 23, 16, 26, 20, 13, 17, 22, 18, 20, 48].map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  const hyperlinksXml = hyperlinks.length ? `<hyperlinks>${hyperlinks.map((link, index) => `<hyperlink ref="${link.cellReference}" r:id="rId${index + 1}"/>`).join('')}</hyperlinks>` : '';
  const hyperlinkRelationships = hyperlinks.length ? `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hyperlinks.map((link, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(link.url)}" TargetMode="External"/>`).join('')}</Relationships>` : null;
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cargas de diesel" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><u/><color rgb="FF0563C1"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>'],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columnWidths}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:K${rows.length}"/>${hyperlinksXml}</worksheet>`]
  ];
  if (hyperlinkRelationships) files.push(['xl/worksheets/_rels/sheet1.xml.rels', hyperlinkRelationships]);
  downloadFile(xlsxZip(files), `cargas-diesel-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
async function exportExcel() {
  const button = $('#export-excel');
  button.disabled = true;
  try {
    showToast('Preparando archivo Excel...');
    const recordsForExport = await loadRecordsForExport();
    if (!recordsForExport.length) { showToast('No hay cargas en el rango seleccionado.'); return; }
    exportExcelFile(recordsForExport);
  } catch (error) { showToast(error.message || 'No fue posible exportar el Excel.'); }
  finally { button.disabled = false; }
}
function reconciliationExportRows() {
  if (!reconciliationData) return [];
  const from = $('#reconciliation-date-from').value;
  const to = $('#reconciliation-date-to').value;
  const rows = reconciliationRowsForView(reconciliationData.rows || []);
  const headings = ['Desde', 'Hasta', 'Unidad', 'Descripción', 'Odómetro inicial (mi)', 'Odómetro final (mi)', 'Millas Motive', 'Galones', 'MPG', 'Cargas', 'Estado'];
  return [headings, ...rows.map((row) => [from, to, row.unitNumber, row.description || '', row.odometerStart ?? '', row.odometerEnd ?? '', row.miles ?? '', row.gallons ?? '', row.mpg ?? '', row.fuelLoadCount ?? 0, reconciliationStatusText(row)])];
}
function exportReconciliationExcelFile(rows, from, to) {
  const sheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => spreadsheetCell(value, `${spreadsheetColumn(columnIndex)}${rowIndex + 1}`, rowIndex > 0 && [4, 5, 6, 7, 8, 9].includes(columnIndex) ? 2 : 0, rowIndex > 0 && [4, 5, 6, 7, 8, 9].includes(columnIndex))).join('')}</row>`).join('');
  const widths = [14, 14, 18, 32, 22, 20, 18, 14, 12, 12, 25].map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Conciliación" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>'],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:K${rows.length}"/></worksheet>`]
  ];
  downloadFile(xlsxZip(files), `conciliacion-motive-${from}-a-${to}.xlsx`);
}
function exportReconciliationExcel() {
  const button = $('#export-reconciliation-excel');
  const from = $('#reconciliation-date-from').value;
  const to = $('#reconciliation-date-to').value;
  if (!reconciliationData || reconciliationData.from !== from || reconciliationData.to !== to) { showToast('Primero presiona Consultar para actualizar la conciliación antes de exportar.'); return; }
  const rows = reconciliationExportRows();
  if (rows.length <= 1) { showToast('No hay unidades visibles para exportar. Cambia el filtro “Mostrar” o consulta otro periodo.'); return; }
  button.disabled = true;
  try {
    exportReconciliationExcelFile(rows, from, to);
    showToast('Excel de conciliación preparado.');
  } catch (error) { showToast(error.message || 'No fue posible exportar la conciliación.'); }
  finally { button.disabled = false; }
}
$('#export-csv').addEventListener('click', exportCsv);
$('#export-excel').addEventListener('click', exportExcel);
$('#export-reconciliation-excel').addEventListener('click', exportReconciliationExcel);

$('#unit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const numberInput = $('#new-unit-number');
  const number = numberInput.value.trim().toUpperCase();
  const plates = $('#new-unit-plates').value.trim().toUpperCase();
  const description = $('#new-unit-description').value.trim();
  if (units.some((unit) => unit.number.toUpperCase() === number)) { showToast('Ese número de unidad ya está registrado.'); return; }
  try {
    const response = await fetch('/api/units', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number, plates, description }) });
    const saved = await response.json();
    if (!response.ok) throw new Error(saved.error || 'No fue posible agregar la unidad.');
    units.push(saved); save(STORAGE.units, units); unitCatalogPage = Math.ceil(units.length / unitCatalogPageSize); event.currentTarget.reset(); renderUnitCatalog(); showToast(`Unidad ${number} agregada al catálogo.`);
  } catch (error) { showToast(error.message || 'No se pudo conectar a la base de datos.'); }
});

function setAdminInterface(authenticated, role = null) {
  isAdmin = authenticated;
  userRole = authenticated ? role : null;
  $('#registros').hidden = !authenticated;
  $('#records-link').hidden = !authenticated;
  $('#conciliacion').hidden = !authenticated;
  $('#asignar-chofer').hidden = !authenticated;
  $('#unidades').hidden = !authenticated;
  $('#unit-form').hidden = role !== 'admin';
  $('#reconciliation-link').hidden = !authenticated;
  $('#driver-assignment-link').hidden = !authenticated;
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
    renderReconciliationUnitOptions();
    renderDriverAssignmentOptions();
    if (admin) {
      if (!$('#reconciliation-date-from').value || !$('#reconciliation-date-to').value) setDefaultReconciliationRange();
      await Promise.all([loadRecordsPage(1), loadReconciliation()]);
    } else {
      records = [];
      recordsPagination = { page: 1, limit: recordsPageSize, total: 0, totalPages: 1 };
      localStorage.removeItem(STORAGE.records);
      renderRecords();
      reconciliationData = null;
      renderReconciliation();
    }
    renderUnitCatalog(); updateReview();
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
  recordsPagination = { page: 1, limit: recordsPageSize, total: 0, totalPages: 1 };
  reconciliationData = null;
  localStorage.removeItem(STORAGE.records);
  setAdminInterface(false);
  renderRecords();
  renderReconciliation();
  location.hash = '#registro';
  showToast('Sesión cerrada.');
});

setAdminInterface(false); setDefaultReconciliationRange(); renderUnitCatalog(); renderReconciliationUnitOptions(); renderDriverAssignmentOptions(); renderRecords(); renderReconciliation(); updateReview(); synchronizeWithDatabase();
