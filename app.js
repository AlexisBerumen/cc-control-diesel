const STORAGE = { units: 'cc-units-v1', records: 'cc-fuel-records-v1' };
const defaultUnits = [
  { id: crypto.randomUUID(), number: '024', plates: 'AB-1234-A', description: 'Kenworth T680' },
  { id: crypto.randomUUID(), number: '031', plates: 'CD-5678-B', description: 'Freightliner Cascadia' },
  { id: crypto.randomUUID(), number: '042', plates: 'EF-9012-C', description: 'International LT' }
];
const $ = (selector) => document.querySelector(selector);
let units = load(STORAGE.units, defaultUnits);
let records = load(STORAGE.records, []);
let selectedUnit = null;
let toastTimer;

function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function money(value) { return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value || 0)); }
function number(value) { return new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(Number(value || 0)); }
function esc(text) { const d = document.createElement('div'); d.textContent = text; return d.innerHTML; }

function lastOdometer(unitId) {
  return records.filter(r => r.unitId === unitId).sort((a, b) => b.odometer - a.odometer)[0]?.odometer;
}
function renderUnitCatalog() {
  $('#unit-catalog').innerHTML = units.length ? units.map(u => `<div class="catalog-unit"><strong>Unidad ${esc(u.number)}</strong><small>${esc(u.plates)} · ${esc(u.description)}</small></div>`).join('') : '<p class="muted">No hay unidades registradas.</p>';
}
function renderRecords() {
  const body = $('#records-body');
  if (!records.length) { body.innerHTML = '<tr class="empty"><td colspan="7">Aún no hay cargas registradas.</td></tr>'; return; }
  body.innerHTML = [...records].reverse().map(r => `<tr><td>${esc(r.folio)}</td><td>${new Date(r.createdAt).toLocaleString('es-MX', { dateStyle:'short', timeStyle:'short' })}</td><td><strong>${esc(r.unitNumber)}</strong><br><small>${esc(r.plates)}</small></td><td>${number(r.odometer)} km</td><td>${number(r.liters)} L</td><td>${money(r.amount)}</td><td><span class="status">Completo</span></td></tr>`).join('');
}
function setUnit(unit) {
  selectedUnit = unit;
  $('#unit-search').value = unit.number;
  $('#unit-options').hidden = true;
  $('#unit-error').textContent = '';
  const last = lastOdometer(unit.id);
  $('#selected-unit').hidden = false;
  $('#selected-unit').innerHTML = `<span>✓</span><div><strong>Unidad ${esc(unit.number)} seleccionada</strong><br><small>${esc(unit.plates)} · ${esc(unit.description)}</small></div>`;
  $('#odometer-note').textContent = last ? `Último odómetro registrado: ${number(last)} km.` : 'Aún no hay kilometraje previo para esta unidad.';
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
function setError(id, message) { $(id).textContent = message; }
function validate(show = true) {
  let valid = true;
  const typed = $('#unit-search').value.trim();
  const exact = units.find(u => u.number.toLowerCase() === typed.toLowerCase());
  if (!selectedUnit || selectedUnit.id !== exact?.id) { if (show) setError('#unit-error', 'Selecciona una unidad válida de la lista.'); valid = false; }
  const odometer = Number($('#odometer').value);
  const previous = selectedUnit && lastOdometer(selectedUnit.id);
  if (!odometer) { if (show) setError('#odometer-error', 'Indica el kilometraje actual.'); valid = false; }
  else if (previous && odometer < previous) { if (show) setError('#odometer-error', `No puede ser menor al último registro (${number(previous)} km).`); valid = false; }
  else setError('#odometer-error', '');
  const liters = Number($('#liters').value);
  if (!liters || liters <= 0) { if (show) setError('#liters-error', 'Indica litros mayores a cero.'); valid = false; } else setError('#liters-error', '');
  const amount = Number($('#amount').value);
  if (!amount || amount <= 0) { if (show) setError('#amount-error', 'Indica el importe total.'); valid = false; } else setError('#amount-error', '');
  if (!$('#station').value.trim()) { if (show) setError('#station-error', 'Indica la estación de servicio.'); valid = false; } else setError('#station-error', '');
  if (!$('#ticket-photo').files.length || !$('#odometer-photo').files.length) { if (show) setError('#evidence-error', 'Debes adjuntar las dos evidencias.'); valid = false; } else setError('#evidence-error', '');
  return valid;
}
function updateReview() {
  const liters = Number($('#liters').value), amount = Number($('#amount').value), odo = Number($('#odometer').value);
  const data = [
    ['Unidad', selectedUnit ? `${selectedUnit.number} · ${selectedUnit.plates}` : '—'],
    ['Odómetro', odo ? `${number(odo)} km` : '—'], ['Litros', liters ? `${number(liters)} L` : '—'],
    ['Importe', amount ? money(amount) : '—'], ['Precio por litro', liters && amount ? money(amount / liters) : '—'],
    ['Evidencias', $('#ticket-photo').files.length && $('#odometer-photo').files.length ? '2 de 2 adjuntas ✓' : `${$('#ticket-photo').files.length + $('#odometer-photo').files.length} de 2 adjuntas`]
  ];
  $('#review-list').innerHTML = data.map(([key, value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`).join('');
  const price = liters && amount ? amount / liters : 0;
  $('#price-output').hidden = !price;
  $('#price-output').textContent = price ? `Precio calculado: ${money(price)} por litro` : '';
}
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 3800); }
function resetFuelForm() {
  $('#fuel-form').reset(); selectedUnit = null; $('#selected-unit').hidden = true; $('#unit-options').hidden = true; $('#odometer-note').textContent = 'Selecciona una unidad para validar el kilometraje.';
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
document.addEventListener('click', e => { if (!e.target.closest('.autocomplete')) $('#unit-options').hidden = true; });
['odometer','liters','amount','station','ticket-photo','odometer-photo'].forEach(id => $(`#${id}`).addEventListener('input', updateReview));
['ticket-photo','odometer-photo'].forEach(id => $(`#${id}`).addEventListener('change', e => { const box = $(`#${id}-box`); const name = e.target.files[0]?.name; box.classList.toggle('has-file', Boolean(name)); box.querySelector('.file-name').textContent = name || 'Tomar o seleccionar foto'; updateReview(); }));

$('#fuel-form').addEventListener('submit', e => {
  e.preventDefault(); if (!validate()) { showToast('Revisa los campos marcados antes de continuar.'); return; }
  const values = [['Unidad', `${selectedUnit.number} · ${selectedUnit.plates}`], ['Odómetro', `${number($('#odometer').value)} km`], ['Litros', `${number($('#liters').value)} L`], ['Importe', money($('#amount').value)], ['Estación', $('#station').value.trim()]];
  $('#dialog-summary').innerHTML = values.map(([k,v]) => `<p><span>${k}</span><strong>${esc(v)}</strong></p>`).join(''); $('#confirm-dialog').showModal();
});
$('#confirm-button').addEventListener('click', e => {
  e.preventDefault();
  const now = new Date();
  const record = { id: crypto.randomUUID(), folio: `DC-${now.getFullYear()}-${String(records.length + 1).padStart(4,'0')}`, createdAt: now.toISOString(), unitId: selectedUnit.id, unitNumber: selectedUnit.number, plates: selectedUnit.plates, odometer: Number($('#odometer').value), liters: Number($('#liters').value), amount: Number($('#amount').value), station: $('#station').value.trim(), ticketFile: $('#ticket-photo').files[0].name, odometerFile: $('#odometer-photo').files[0].name };
  records.push(record); save(STORAGE.records, records); $('#confirm-dialog').close(); renderRecords(); resetFuelForm(); showToast(`Carga ${record.folio} guardada correctamente.`); location.hash = '#registros';
});
$('#unit-form').addEventListener('submit', e => { e.preventDefault(); const numberInput = $('#new-unit-number'), plates = $('#new-unit-plates').value.trim().toUpperCase(), description = $('#new-unit-description').value.trim(); const unitNumber = numberInput.value.trim().toUpperCase(); if (units.some(u => u.number.toUpperCase() === unitNumber)) { showToast('Ese número de unidad ya está registrado.'); return; } units.push({ id: crypto.randomUUID(), number: unitNumber, plates, description }); save(STORAGE.units, units); e.target.reset(); renderUnitCatalog(); showToast(`Unidad ${unitNumber} agregada al catálogo.`); });
$('#export-csv').addEventListener('click', () => { if (!records.length) { showToast('Aún no hay registros para exportar.'); return; } const headings = ['Folio','Fecha','Unidad','Placas','Odómetro (km)','Litros','Importe (MXN)','Estación','Ticket','Foto odómetro']; const rows = records.map(r => [r.folio, new Date(r.createdAt).toLocaleString('es-MX'),r.unitNumber,r.plates,r.odometer,r.liters,r.amount,r.station,r.ticketFile,r.odometerFile]); const csv = [headings,...rows].map(row => row.map(v => `"${String(v).replaceAll('"','""')}"`).join(',')).join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8'})); link.download = `cargas-diesel-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href); });

renderUnitCatalog(); renderRecords(); updateReview();
