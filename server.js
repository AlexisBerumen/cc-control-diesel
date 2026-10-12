const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const port = Number(process.env.PORT) || 3000;
const publicDirectory = __dirname;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;
let databaseReady = false;
// Motive's authorization screen accepts the specific scope enabled for the app.
// This is the least-privilege scope needed to retrieve each vehicle's current odometer.
const motiveScope = 'locations.vehicle_locations_list';
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
    );
    ALTER TABLE units ADD COLUMN IF NOT EXISTS motive_vehicle_id TEXT UNIQUE;
    ALTER TABLE units ADD COLUMN IF NOT EXISTS motive_odometer NUMERIC(12,2);
    ALTER TABLE units ADD COLUMN IF NOT EXISTS motive_odometer_unit TEXT;
    ALTER TABLE units ADD COLUMN IF NOT EXISTS motive_odometer_updated_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS motive_connection (
      id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id), encrypted_access_token TEXT NOT NULL,
      encrypted_refresh_token TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
      connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_synced_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS motive_oauth_states (
      state TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL
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
function sendHtml(response, status, html) { response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(html); }
function motiveConfigured() { return Boolean(process.env.MOTIVE_CLIENT_ID && process.env.MOTIVE_CLIENT_SECRET && process.env.MOTIVE_REDIRECT_URI && process.env.MOTIVE_TOKEN_ENCRYPTION_KEY); }
function motiveEncryptionKey() {
  const key = Buffer.from(process.env.MOTIVE_TOKEN_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw new Error('MOTIVE_TOKEN_ENCRYPTION_KEY debe ser una clave Base64 de 32 bytes.');
  return key;
}
function encryptSecret(value) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', motiveEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}
function decryptSecret(value) {
  const [iv, tag, encrypted] = value.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', motiveEncryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}
async function requestMotiveToken(params) {
  // Motive's public OAuth documentation keeps the token endpoint on its
  // original KeepTruckin domain. The gomotive.com host serves HTML here.
  const response = await fetch('https://keeptruckin.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, client_id: process.env.MOTIVE_CLIENT_ID, client_secret: process.env.MOTIVE_CLIENT_SECRET, redirect_uri: process.env.MOTIVE_REDIRECT_URI }) });
  const responseText = await response.text();
  let data;
  try { data = JSON.parse(responseText); } catch { throw new Error(`Motive devolvió una respuesta inválida al generar el token (HTTP ${response.status}).`); }
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Motive rechazó la autorización.');
  return data;
}
async function saveMotiveTokens(tokens) {
  const expiresAt = new Date(Date.now() + Number(tokens.expires_in || 7200) * 1000);
  await pool.query(`INSERT INTO motive_connection (id, encrypted_access_token, encrypted_refresh_token, expires_at, connected_at) VALUES (TRUE, $1, $2, $3, NOW()) ON CONFLICT (id) DO UPDATE SET encrypted_access_token = EXCLUDED.encrypted_access_token, encrypted_refresh_token = EXCLUDED.encrypted_refresh_token, expires_at = EXCLUDED.expires_at, connected_at = NOW()`, [encryptSecret(tokens.access_token), encryptSecret(tokens.refresh_token), expiresAt]);
}
async function getMotiveAccessToken() {
  const result = await pool.query('SELECT encrypted_access_token, encrypted_refresh_token, expires_at FROM motive_connection WHERE id = TRUE');
  if (!result.rowCount) throw new Error('Motive aún no está conectado.');
  const connection = result.rows[0];
  if (new Date(connection.expires_at).getTime() > Date.now() + 300_000) return decryptSecret(connection.encrypted_access_token);
  const tokens = await requestMotiveToken({ grant_type: 'refresh_token', refresh_token: decryptSecret(connection.encrypted_refresh_token) });
  await saveMotiveTokens(tokens);
  return tokens.access_token;
}
async function syncMotiveVehicles() {
  const accessToken = await getMotiveAccessToken();
  let page = 1, total = Infinity, matched = 0, received = 0, responseShape = [], motiveEndpoint = 'v2';
  while ((page - 1) * 100 < total) {
    let response = await fetch(`https://api.gomotive.com/v2/vehicle_locations?per_page=100&page_no=${page}`, { headers: { Authorization: `Bearer ${accessToken}`, 'X-Metric-Units': 'true', 'X-Time-Zone': 'America/Mexico_City' } });
    let data = await response.json();
    if (!response.ok) throw new Error(data.error || data.message || 'No fue posible consultar los vehículos de Motive.');
    // Motive has returned both direct and data-wrapped lists across API versions.
    let vehicles = Array.isArray(data) ? data : data.vehicles || data.vehicle_locations || data.data?.vehicles || data.data?.vehicle_locations || data.data?.items || data.data || [];
    if (!Array.isArray(vehicles)) throw new Error(`Motive no devolvio una lista de vehiculos. Campos recibidos: ${Object.keys(data).join(', ') || 'ninguno'}.`);
    if (!vehicles.length && page === 1) {
      response = await fetch(`https://api.gomotive.com/v1/vehicle_locations?per_page=100&page_no=${page}`, { headers: { Authorization: `Bearer ${accessToken}`, 'X-Metric-Units': 'true', 'X-Time-Zone': 'America/Mexico_City' } });
      data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || 'Motive no permitio consultar las ubicaciones v1.');
      vehicles = Array.isArray(data) ? data : data.vehicles || data.vehicle_locations || data.data?.vehicles || data.data?.vehicle_locations || data.data?.items || data.data || [];
      if (!Array.isArray(vehicles)) throw new Error(`Motive no devolvio una lista v1. Campos recibidos: ${Object.keys(data).join(', ') || 'ninguno'}.`);
      motiveEndpoint = 'v1';
    }
    responseShape = Array.isArray(data) ? ['array'] : Object.keys(data);
    total = Number(data.total || data.pagination?.total || data.data?.total || vehicles.length);
    for (const vehicle of vehicles) {
      const location = vehicle.current_location || vehicle;
      const reading = location.true_odometer ?? location.odometer;
      if (!vehicle.number || !Number.isFinite(Number(reading))) continue;
      const updated = await pool.query('UPDATE units SET motive_vehicle_id = $1, motive_odometer = $2, motive_odometer_unit = $3, motive_odometer_updated_at = $4 WHERE LOWER(number) = LOWER($5)', [String(vehicle.id), Number(reading), 'km', location.located_at || new Date().toISOString(), vehicle.number]);
      if (updated.rowCount) matched += 1;
      received += 1;
    }
    if (!vehicles.length) break;
    page += 1;
  }
  await pool.query('UPDATE motive_connection SET last_synced_at = NOW() WHERE id = TRUE');
  return { vehiclesReceived: received, unitsMatched: matched, unitsWithoutMatch: Math.max(received - matched, 0), motiveEndpoint, motiveResponseFields: responseShape };
}

async function handleApi(request, response, url) {
  if (url.pathname === '/api/health' && request.method === 'GET') { sendJson(response, databaseReady ? 200 : 503, { database: databaseReady }); return true; }
  if (!databaseReady) { databaseUnavailable(response); return true; }
  if (url.pathname === '/api/motive/status' && request.method === 'GET') {
    const connection = await pool.query('SELECT connected_at AS "connectedAt", last_synced_at AS "lastSyncedAt" FROM motive_connection WHERE id = TRUE');
    sendJson(response, 200, { configured: motiveConfigured(), connected: Boolean(connection.rowCount), ...(connection.rows[0] || {}) });
    return true;
  }
  if (url.pathname === '/api/motive/connect' && request.method === 'GET') {
    if (!motiveConfigured()) { sendHtml(response, 503, '<h1>Falta configurar Motive</h1><p>Agrega MOTIVE_CLIENT_ID, MOTIVE_CLIENT_SECRET, MOTIVE_REDIRECT_URI y MOTIVE_TOKEN_ENCRYPTION_KEY en Railway.</p>'); return true; }
    const state = crypto.randomUUID();
    await pool.query('DELETE FROM motive_oauth_states WHERE expires_at < NOW()');
    await pool.query('INSERT INTO motive_oauth_states (state, expires_at) VALUES ($1, NOW() + INTERVAL \'10 minutes\')', [state]);
    const authorizationUrl = new URL('https://gomotive.com/oauth/authorize');
    authorizationUrl.search = new URLSearchParams({ client_id: process.env.MOTIVE_CLIENT_ID, redirect_uri: process.env.MOTIVE_REDIRECT_URI, response_type: 'code', scope: motiveScope, state }).toString();
    response.writeHead(302, { Location: authorizationUrl.toString(), 'Cache-Control': 'no-store' }); response.end(); return true;
  }
  if (url.pathname === '/api/motive/callback' && request.method === 'GET') {
    const code = url.searchParams.get('code'), state = url.searchParams.get('state');
    if (!motiveConfigured() || !code || !state) { sendHtml(response, 400, '<h1>No se pudo conectar Motive</h1><p>Falta un código de autorización o la configuración de Motive.</p>'); return true; }
    const stateResult = await pool.query('DELETE FROM motive_oauth_states WHERE state = $1 AND expires_at > NOW() RETURNING state', [state]);
    if (!stateResult.rowCount) { sendHtml(response, 400, '<h1>Autorización expirada</h1><p>Vuelve a iniciar la conexión desde el sistema.</p>'); return true; }
    const tokens = await requestMotiveToken({ grant_type: 'authorization_code', code });
    await saveMotiveTokens(tokens);
    sendHtml(response, 200, '<h1>Motive conectado</h1><p>La autorización se guardó de forma segura. Ahora abre <code>/api/motive/sync</code> para importar las unidades y odómetros.</p>'); return true;
  }
  if (url.pathname === '/api/motive/sync' && request.method === 'GET') {
    if (!motiveConfigured()) { sendJson(response, 503, { error: 'Falta configurar Motive en Railway.' }); return true; }
    sendJson(response, 200, await syncMotiveVehicles()); return true;
  }
  if (url.pathname === '/api/units' && request.method === 'GET') {
    const result = await pool.query('SELECT id, number, identifier AS plates, description, motive_odometer AS "motiveOdometer", motive_odometer_unit AS "motiveOdometerUnit", motive_odometer_updated_at AS "motiveOdometerUpdatedAt" FROM units ORDER BY number');
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
