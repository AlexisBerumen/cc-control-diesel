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
let records = load(STORAGE.records, []);
let drivers = load(STORAGE.drivers, []);
let selectedUnit = null;
let selectedDriver = null;
let toastTimer;

function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function money(value) { return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value || 0)); }
function number(value) { return new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(Number(value || 0)); }
function esc(text) { const d = document.createElement('div'); d.textContent = text; return d.innerHTML; }

function lastOdometer(unitId) {
  const recordOdometer = records.filter(r => r.unitId === unitId).sort((a, b) => b.odometer - a.odometer)[0]?.odometer || 0;
  const motiveOdometer = Number(units.find(unit => unit.id === unitId)?.motiveOdometer || 0);
  return Math.max(recordOdometer, motiveOdometer) || undefined;
}
function renderUnitCatalog() {
  $('#unit-catalog').innerHTML = units.length ? units.map(u => `<div class="catalog-unit"><strong>Unidad ${esc(u.number)}</strong><small>${esc(u.plates)} · ${esc(u.description)}</small></div>`).join('') : '<p class="muted">No hay unidades registradas.</p>';
}
function renderRecords() {
  const body = $('#records-body');
  if (!records.length) { body.innerHTML = '<tr class="empty"><td colspan="7">Aún no hay cargas registradas.</td></tr>'; return; }
  body.innerHTML = [...records].reverse().map(r => `<tr><td>${esc(r.folio)}</td><td>${new Date(r.createdAt).toLocaleString('es-MX', { dateStyle:'short', timeStyle:'short' })}</td><td><strong>${esc(r.unitNumber)}</strong><br><small>${esc(r.driverName || 'No registrado')} · ${esc(r.plates)}</small></td><td>${number(r.odometer)} mi</td><td>${number(r.gallons)} gal</td><td>${r.amount === null || r.amount === undefined ? 'Bomba C&C' : money(r.amount)}</td><td><span class="status">Completo</span></td></tr>`).join('');
}
function setUnit(unit) {
  selectedUnit = unit;
  $('#unit-search').value = unit.number;
  $('#unit-options').hidden = true;
  $('#unit-error').textContent = '';
  const last = lastOdometer(unit.id);
  $('#selected-unit').hidden = false;
  $('#selected-unit').innerHTML = `<span>✓</span><div><strong>Unidad ${esc(unit.number)} seleccionada</strong><br><small>${esc(unit.plates)} · ${esc(unit.description)}</small></div>`;
  $('#odometer-note').textContent = last ? `Odómetro de referencia (Motive o carga previa): ${number(last)} millas.` : 'Aún no hay kilometraje previo para esta unidad.';
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
function validate(show = true) {
  let valid = true;
  const typed = $('#unit-search').value.trim();
  const exact = units.find(u => u.number.toLowerCase() === typed.toLowerCase());
  if (!selectedUnit || selectedUnit.id !== exact?.id) { if (show) setError('#unit-error', 'Selecciona una unidad válida de la lista.'); valid = false; }
  const odometer = Number($('#odometer').value);
  const previous = selectedUnit && lastOdometer(selectedUnit.id);
  if (!odometer) { if (show) setError('#odometer-error', 'Indica el kilometraje actual.'); valid = false; }
  else if (previous && odometer < previous) { if (show) setError('#odometer-error', `No puede ser menor al último registro (${number(previous)} millas).`); valid = false; }
  else setError('#odometer-error', '');
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
  if (!$('#ticket-photo').files.length || !$('#odometer-photo').files.length) { if (show) setError('#evidence-error', 'Debes adjuntar las dos evidencias.'); valid = false; } else setError('#evidence-error', '');
  return valid;
}
function updateReview() {
  const gallons = Number($('#gallons').value), amountValue = $('#amount').value.trim(), amount = amountValue ? Number(amountValue) : null, odo = Number($('#odometer').value), driverName = selectedDriver?.name || '';
  const data = [
    ['Unidad', selectedUnit ? `${selectedUnit.number} · ${selectedUnit.plates}` : '—'], ['Chofer', driverName || '—'],
    ['Odómetro', odo ? `${number(odo)} mi` : '—'], ['Galones', gallons ? `${number(gallons)} gal` : '—'],
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
  document.querySelectorAll('.upload-box').forEach(el => { el.classList.remove('has-file'); el.querySelector('.file-name').textContent = 'Tomar o seleccionar foto'; });
  document.querySelectorAll('.error').forEach(el => el.textContent = ''); updateReview();
}

$('#unit-search').addEventListener('input', () => {
  const typed = $('#unit-search').value.trim();
  const exact = units.find(u => u.number.toLowerCase() === typed.toLowerCase());
  if (exact) { setUnit(exact); return; }
  selectedUnit = null; $('#selected-unit').hidden = true; setError('#unit-error', ''); updateSuggestions(); updateReview();
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
['odometer','gallons','amount','station','ticket-photo','odometer-photo'].forEach(id => $(`#${id}`).addEventListener('input', updateReview));
const evidenceBoxes = { 'ticket-photo': '#ticket-box', 'odometer-photo': '#odometer-box' };
Object.entries(evidenceBoxes).forEach(([inputId, boxSelector]) => $(`#${inputId}`).addEventListener('change', e => { const box = $(boxSelector); const name = e.target.files[0]?.name; box.classList.toggle('has-file', Boolean(name)); box.querySelector('.file-name').textContent = name || 'Tomar o seleccionar foto'; updateReview(); }));

$('#fuel-form').addEventListener('submit', e => {
  e.preventDefault(); if (!validate()) { showToast('Revisa los campos marcados antes de continuar.'); return; }
  const amountValue = $('#amount').value.trim();
  const values = [['Unidad', `${selectedUnit.number} · ${selectedUnit.plates}`], ['Chofer', selectedDriver.name], ['Odómetro', `${number($('#odometer').value)} mi`], ['Galones', `${number($('#gallons').value)} gal`], ['Importe', amountValue ? money(amountValue) : 'Bomba C&C / no aplica'], ['Estación', $('#station').value.trim()]];
  $('#dialog-summary').innerHTML = values.map(([k,v]) => `<p><span>${k}</span><strong>${esc(v)}</strong></p>`).join(''); $('#confirm-dialog').showModal();
});
$('#confirm-button').addEventListener('click', async e => {
  e.preventDefault();
  const now = new Date();
  const amountValue = $('#amount').value.trim();
  const record = { id: crypto.randomUUID(), folio: `DC-${now.getFullYear()}-${String(records.length + 1).padStart(4,'0')}`, createdAt: now.toISOString(), unitId: selectedUnit.id, unitNumber: selectedUnit.number, plates: selectedUnit.plates, driverId: selectedDriver.id, driverName: selectedDriver.name, odometer: Number($('#odometer').value), gallons: Number($('#gallons').value), amount: amountValue ? Number(amountValue) : null, station: $('#station').value.trim(), ticketFile: $('#ticket-photo').files[0].name, odometerFile: $('#odometer-photo').files[0].name };
  let saved;
  try {
    const response = await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No fue posible guardar la carga.');
    saved = data;
  } catch (error) {
    showToast(error.message || 'No se pudo conectar a la base de datos.');
    return;
  }
  records.push(saved); save(STORAGE.records, records); $('#confirm-dialog').close(); renderRecords(); resetFuelForm(); showToast(`Carga ${saved.folio} guardada correctamente.`); location.hash = '#registros';
});
$('#unit-form').addEventListener('submit', e => { e.preventDefault(); const numberInput = $('#new-unit-number'), plates = $('#new-unit-plates').value.trim().toUpperCase(), description = $('#new-unit-description').value.trim(); const unitNumber = numberInput.value.trim().toUpperCase(); if (units.some(u => u.number.toUpperCase() === unitNumber)) { showToast('Ese número de unidad ya está registrado.'); return; } units.push({ id: crypto.randomUUID(), number: unitNumber, plates, description }); save(STORAGE.units, units); e.target.reset(); renderUnitCatalog(); showToast(`Unidad ${unitNumber} agregada al catálogo.`); });
$('#export-csv').addEventListener('click', () => { if (!records.length) { showToast('Aún no hay registros para exportar.'); return; } const headings = ['Folio','Fecha','Unidad','Chofer','Identificador','Odómetro (millas)','Galones','Importe (MXN)','Estación','Ticket','Foto odómetro']; const rows = records.map(r => [r.folio, new Date(r.createdAt).toLocaleString('es-MX'),r.unitNumber,r.driverName ?? '',r.plates,r.odometer,r.gallons,r.amount ?? '',r.station,r.ticketFile,r.odometerFile]); const csv = [headings,...rows].map(row => row.map(v => `"${String(v).replaceAll('"','""')}"`).join(',')).join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8'})); link.download = `cargas-diesel-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href); });

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

async function synchronizeWithDatabase() {
  try {
    const [unitsResponse, recordsResponse, driversResponse] = await Promise.all([fetch('/api/units'), fetch('/api/records'), fetch('/api/drivers')]);
    if (!unitsResponse.ok || !recordsResponse.ok || !driversResponse.ok) return;
    units = await unitsResponse.json();
    records = await recordsResponse.json();
    drivers = await driversResponse.json();
    save(STORAGE.units, units); save(STORAGE.records, records); save(STORAGE.drivers, drivers);
    renderUnitCatalog(); renderRecords(); updateReview();
  } catch { /* El sitio muestra el catálogo inicial hasta que PostgreSQL esté conectado. */ }
}

renderUnitCatalog(); renderRecords(); updateReview(); synchronizeWithDatabase();
