const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const port = Number(process.env.PORT) || 3000;
const publicDirectory = __dirname;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;
let databaseReady = false;
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}
function unitId(number) {
  return `unit-${number.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}
function loadSeedUnits() {
  const source = fs.readFileSync(path.join(__dirname, 'units.js'), 'utf8');
  const catalog = source.match(/CC_UNIT_DATA\s*=\s*`([\s\S]*?)`\.trim/);
  if (!catalog) throw new Error('No se encontró el catálogo de unidades.');
  return catalog[1].trim().split(/\r?\n/).map((line) => {
    const [number, serial, description] = line.split('|');
    return { id: unitId(number), number, identifier: serial ? `S/N: ${serial}` : 'Sin identificador', description };
  });
}
async function initializeDatabase() {
  if (!pool) { console.log('Base de datos no configurada: se usará el modo local.'); return; }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS units (id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, identifier TEXT NOT NULL, description TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS fuel_records (
      record_id BIGSERIAL PRIMARY KEY, id TEXT NOT NULL UNIQUE, folio TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      unit_id TEXT NOT NULL REFERENCES units(id), unit_number TEXT NOT NULL, identifier TEXT NOT NULL,
      odometer INTEGER NOT NULL CHECK (odometer > 0), liters NUMERIC(12,2) NOT NULL CHECK (liters > 0), amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      station TEXT NOT NULL, ticket_file TEXT NOT NULL, odometer_file TEXT NOT NULL
    );`);
  for (const unit of loadSeedUnits()) await pool.query('INSERT INTO units (id, number, identifier, description) VALUES ($1, $2, $3, $4) ON CONFLICT (number) DO NOTHING', [unit.id, unit.number, unit.identifier, unit.description]);
  databaseReady = true;
  console.log('PostgreSQL conectado y catálogo de unidades preparado.');
}
function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; if (body.length > 100_000) reject(new Error('La solicitud es demasiado grande.')); });
    request.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('JSON inválido.')); } });
    request.on('error', reject);
  });
}
function cleanText(value, maxLength) { return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''; }
function databaseUnavailable(response) { sendJson(response, 503, { error: 'La base de datos aún no está disponible.' }); }

async function handleApi(request, response, url) {
  if (url.pathname === '/api/health' && request.method === 'GET') { sendJson(response, databaseReady ? 200 : 503, { database: databaseReady }); return true; }
  if (!databaseReady) { databaseUnavailable(response); return true; }
  if (url.pathname === '/api/units' && request.method === 'GET') {
    const result = await pool.query('SELECT id, number, identifier AS plates, description FROM units ORDER BY number');
    sendJson(response, 200, result.rows); return true;
  }
  if (url.pathname === '/api/units' && request.method === 'POST') {
    const body = await readJson(request);
    const number = cleanText(body.number, 40).toUpperCase(), plates = cleanText(body.plates, 80), description = cleanText(body.description, 120);
    if (!number || !plates || !description) { sendJson(response, 400, { error: 'Completa los datos de la unidad.' }); return true; }
    const unit = { id: unitId(number), number, plates, description };
    try { await pool.query('INSERT INTO units (id, number, identifier, description) VALUES ($1, $2, $3, $4)', [unit.id, unit.number, unit.plates, unit.description]); sendJson(response, 201, unit); }
    catch (error) { if (error.code === '23505') sendJson(response, 409, { error: 'Ese número de unidad ya está registrado.' }); else throw error; }
    return true;
  }
  if (url.pathname === '/api/records' && request.method === 'GET') {
    const result = await pool.query('SELECT id, folio, created_at AS "createdAt", unit_id AS "unitId", unit_number AS "unitNumber", identifier AS plates, odometer, liters, amount, station, ticket_file AS "ticketFile", odometer_file AS "odometerFile" FROM fuel_records ORDER BY created_at ASC');
    sendJson(response, 200, result.rows); return true;
  }
  if (url.pathname === '/api/records' && request.method === 'POST') {
    const body = await readJson(request);
    const id = cleanText(body.id, 80) || crypto.randomUUID(), odometer = Number(body.odometer), liters = Number(body.liters), amount = Number(body.amount);
    const station = cleanText(body.station, 120), ticketFile = cleanText(body.ticketFile, 180), odometerFile = cleanText(body.odometerFile, 180);
    if (!cleanText(body.unitId, 80) || !Number.isInteger(odometer) || odometer <= 0 || !Number.isFinite(liters) || liters <= 0 || !Number.isFinite(amount) || amount <= 0 || !station || !ticketFile || !odometerFile) { sendJson(response, 400, { error: 'Los datos de la carga están incompletos o no son válidos.' }); return true; }
    const unitResult = await pool.query('SELECT id, number, identifier FROM units WHERE id = $1', [body.unitId]);
    if (!unitResult.rowCount) { sendJson(response, 400, { error: 'La unidad seleccionada no existe.' }); return true; }
    const unit = unitResult.rows[0], client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query('INSERT INTO fuel_records (id, folio, unit_id, unit_number, identifier, odometer, liters, amount, station, ticket_file, odometer_file) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING record_id, created_at', [id, `PENDING-${id}`, unit.id, unit.number, unit.identifier, odometer, liters, amount, station, ticketFile, odometerFile]);
      const row = inserted.rows[0], folio = `DC-${new Date(row.created_at).getFullYear()}-${String(row.record_id).padStart(5, '0')}`;
      const saved = await client.query('UPDATE fuel_records SET folio = $1 WHERE record_id = $2 RETURNING id, folio, created_at AS "createdAt", unit_id AS "unitId", unit_number AS "unitNumber", identifier AS plates, odometer, liters, amount, station, ticket_file AS "ticketFile", odometer_file AS "odometerFile"', [folio, row.record_id]);
      await client.query('COMMIT'); sendJson(response, 201, saved.rows[0]);
    } catch (error) { await client.query('ROLLBACK'); if (error.code === '23505') sendJson(response, 409, { error: 'Esta carga ya fue registrada.' }); else throw error; }
    finally { client.release(); }
    return true;
  }
  return false;
}
function serveStatic(request, response, url) {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.resolve(publicDirectory, `.${decodeURIComponent(requestedPath)}`);
  const allowed = filePath === path.join(publicDirectory, 'index.html') || filePath === path.join(publicDirectory, 'app.js') || filePath === path.join(publicDirectory, 'units.js') || filePath === path.join(publicDirectory, 'styles.css') || filePath.startsWith(path.join(publicDirectory, 'assets') + path.sep);
  if (!allowed) { response.writeHead(404); response.end('Página no encontrada.'); return; }
  fs.readFile(filePath, (error, content) => {
    if (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500); response.end(error.code === 'ENOENT' ? 'Página no encontrada.' : 'Error del servidor.'); return; }
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : content);
  });
}
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) { if (await handleApi(request, response, url)) return; sendJson(response, 404, { error: 'Ruta no encontrada.' }); return; }
    serveStatic(request, response, url);
  } catch (error) { console.error(error); if (!response.headersSent) sendJson(response, 500, { error: 'Ocurrió un error inesperado.' }); }
});
async function start() {
  try { await initializeDatabase(); } catch (error) { console.error('No fue posible preparar PostgreSQL:', error.message); }
  server.listen(port, '0.0.0.0', () => console.log(`C&C Control de Diésel disponible en el puerto ${port}`));
}
start();
