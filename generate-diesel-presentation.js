const pptxgen = require('pptxgenjs');
const path = require('path');

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'C&C Transport';
pptx.subject = 'Presentación de C&C Diesel App';
pptx.title = 'C&C Diesel App';
pptx.company = 'C&C Transport';
pptx.lang = 'es-MX';
pptx.theme = {
  headFontFace: 'Aptos Display',
  bodyFontFace: 'Aptos',
  lang: 'es-MX'
};
pptx.defineLayout({ name: 'CC_WIDE', width: 13.333, height: 7.5 });
pptx.layout = 'CC_WIDE';

const C = {
  navy: '142D72',
  navyDark: '0C1949',
  blue: '3158B5',
  red: 'E62C42',
  redDark: 'C71932',
  paper: 'F8F6F0',
  white: 'FFFFFF',
  ink: '172B58',
  muted: '60708C',
  line: 'DCE3F1',
  paleBlue: 'EEF3FF',
  paleRed: 'FFF0F2',
  paleGreen: 'EDF9F1',
  green: '16734C',
  gold: 'C78200',
  paleGold: 'FFF7DE'
};
const W = 13.333, H = 7.5;
const root = __dirname;
const logo = path.join(root, 'assets', 'logo-cc-transport.png');
// Capturas reales del flujo de C&C Diesel App para la demostración.
const screenshotsDir = 'C:\\Users\\machi\\OneDrive\\Im\u00e1genes\\Screenshots';
const formScreenshot = path.join(screenshotsDir, 'Captura de pantalla 2026-11-15 203442.png');
const validationScreenshot = path.join(screenshotsDir, 'Captura de pantalla 2026-11-15 203528.png');

function addText(slide, text, x, y, w, h, options = {}) {
  slide.addText(text, { x, y, w, h, margin: 0, breakLine: false, fontFace: 'Aptos', color: C.ink, fontSize: 16, fit: 'shrink', ...options });
}
function addRect(slide, x, y, w, h, fill, line = fill, radius = 0) {
  slide.addShape(radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, { x, y, w, h, rectRadius: radius, fill: { color: fill }, line: { color: line, transparency: line === fill ? 100 : 0 } });
}
function footer(slide, page) {
  slide.addShape(pptx.ShapeType.line, { x: 0.55, y: 7.11, w: 12.2, h: 0, line: { color: C.line, width: 0.8 } });
  addText(slide, 'C&C Transport · C&C Diesel App', 0.58, 7.2, 3.6, 0.15, { fontSize: 8.5, color: C.muted, bold: true });
  addText(slide, String(page), 12.45, 7.18, 0.25, 0.15, { fontSize: 8.5, color: C.muted, align: 'right' });
}
function header(slide, kicker, title, page) {
  addRect(slide, 0, 0, W, 0.11, C.red);
  slide.addImage({ path: logo, x: 0.58, y: 0.3, w: 0.73, h: 0.48, sizing: { type: 'contain', x: 0.58, y: 0.3, w: 0.73, h: 0.48 } });
  addText(slide, kicker.toUpperCase(), 1.48, 0.34, 4.7, 0.17, { fontSize: 8.5, color: C.red, charSpace: 1.3, bold: true });
  addText(slide, title, 1.48, 0.55, 10.7, 0.43, { fontSize: 25, color: C.navyDark, bold: true, fontFace: 'Aptos Display' });
  footer(slide, page);
}
function bullet(slide, text, x, y, w, opts = {}) {
  slide.addShape(pptx.ShapeType.ellipse, { x, y: y + 0.08, w: 0.12, h: 0.12, fill: { color: opts.dot || C.red }, line: { color: opts.dot || C.red, transparency: 100 } });
  addText(slide, text, x + 0.23, y, w - 0.23, 0.42, { fontSize: opts.fontSize || 14, color: opts.color || C.ink, breakLine: false, ...opts });
}
function card(slide, x, y, w, h, title, body, accent = C.red) {
  addRect(slide, x, y, w, h, C.white, C.line, 0.12);
  addRect(slide, x, y, 0.07, h, accent, accent);
  addText(slide, title, x + 0.25, y + 0.22, w - 0.42, 0.25, { fontSize: 15, color: C.navy, bold: true });
  addText(slide, body, x + 0.25, y + 0.59, w - 0.42, h - 0.78, { fontSize: 11.5, color: C.muted, breakLine: true, valign: 'top', breakLine: false });
}
function screenshot(slide, imagePath, x, y, w, h) {
  addRect(slide, x - 0.05, y - 0.05, w + 0.1, h + 0.1, C.white, C.line, 0.1);
  slide.addImage({ path: imagePath, x, y, w, h, sizing: { type: 'crop', x, y, w, h } });
}

// 1. Cover
{
  const s = pptx.addSlide();
  s.background = { color: C.navyDark };
  s.addShape(pptx.ShapeType.ellipse, { x: 8.82, y: -1.75, w: 6.3, h: 6.3, fill: { color: C.blue, transparency: 15 }, line: { color: C.blue, transparency: 100 } });
  s.addShape(pptx.ShapeType.ellipse, { x: 10.35, y: 4.45, w: 3.0, h: 3.0, fill: { color: C.red, transparency: 10 }, line: { color: C.red, transparency: 100 } });
  s.addShape(pptx.ShapeType.line, { x: 0.66, y: 0.49, w: 2.85, h: 0, line: { color: C.red, width: 3.2 } });
  s.addImage({ path: logo, x: 0.65, y: 0.75, w: 1.5, h: 0.95, sizing: { type: 'contain', x: 0.65, y: 0.75, w: 1.5, h: 0.95 } });
  addText(s, 'C&C Diesel App', 0.67, 2.06, 7.25, 0.72, { fontSize: 46, color: C.white, bold: true, fontFace: 'Aptos Display' });
  addText(s, 'Propuesta piloto para control operativo de cargas e inventario de diésel', 0.7, 2.95, 6.75, 0.78, { fontSize: 20, color: 'DDE6FF', breakLine: true });
  addText(s, 'Primera reunión con encargados de área', 0.7, 4.06, 4.9, 0.27, { fontSize: 12, color: 'C9D6F5', bold: true });
  addText(s, 'C&C Transport · Noviembre 2026', 0.7, 6.58, 4.3, 0.2, { fontSize: 10, color: 'B8C6E8' });
  addRect(s, 8.15, 1.3, 3.67, 3.9, 'FFFFFF', 'FFFFFF', 0.18);
  addText(s, 'DE LA OPERACIÓN\nAL CONTROL', 8.54, 1.76, 2.92, 0.65, { fontSize: 12, color: C.red, bold: true, align: 'center', breakLine: true, charSpace: 1.4 });
  addText(s, 'Diésel', 8.57, 2.55, 2.85, 0.48, { fontSize: 36, color: C.navy, bold: true, align: 'center', fontFace: 'Aptos Display' });
  addText(s, 'Cargas · Evidencias · Inventario · Motive', 8.55, 3.27, 2.88, 0.44, { fontSize: 11.5, color: C.muted, align: 'center', breakLine: true });
  addRect(s, 9.18, 4.14, 1.56, 0.42, C.paleGreen, C.paleGreen, 0.12);
  addText(s, 'Piloto activo', 9.2, 4.25, 1.52, 0.14, { fontSize: 9.5, color: C.green, bold: true, align: 'center' });
}

// 2. Opportunity
{
  const s = pptx.addSlide();
  s.background = { color: C.paper };
  header(s, 'Contexto', '¿Qué problema estamos resolviendo?', 2);
  addText(s, 'El objetivo no es solo capturar una carga: es contar con información verificable para operar y tomar decisiones a tiempo.', 0.62, 1.24, 7.95, 0.48, { fontSize: 17, color: C.muted, breakLine: true });
  card(s, 0.66, 2.06, 3.8, 2.15, 'Registros dispersos', 'Ticket, odómetro, importe y estación pueden quedar en mensajes, fotos o formatos distintos.', C.red);
  card(s, 4.76, 2.06, 3.8, 2.15, 'Inventario sin visibilidad', 'Hobbs y Orla se recargan y consumen, pero sin una existencia central que permita anticipar faltantes.', C.gold);
  card(s, 8.86, 2.06, 3.8, 2.15, 'Validación manual', 'Empatar cargas, millas y unidades toma tiempo y hace más difícil detectar diferencias.', C.blue);
  addRect(s, 0.66, 4.76, 12, 1.28, C.navy, C.navy, 0.15);
  addText(s, 'La propuesta', 0.98, 5.02, 2.1, 0.23, { fontSize: 12, color: 'CFDAFF', bold: true, charSpace: 1.1 });
  addText(s, 'Una sola herramienta para registrar, validar y consultar el consumo de diésel.', 0.98, 5.32, 10.6, 0.32, { fontSize: 21, color: C.white, bold: true });
}

// 3. Solution architecture
{
  const s = pptx.addSlide();
  s.background = { color: C.white };
  header(s, 'Solución', 'C&C Diesel App centraliza el flujo operativo', 3);
  addText(s, 'La plataforma reúne tres fuentes de información para generar control desde el momento de la carga.', 0.62, 1.25, 8.6, 0.32, { fontSize: 16, color: C.muted });
  const xs = [0.78, 4.68, 8.58];
  const data = [
    ['1', 'Registro de carga', 'Unidad, chofer, odómetro, galones, origen y dos evidencias.'],
    ['2', 'Inventario de bombas', 'Compras, saldo por Hobbs/Orla, alertas y bitácora de movimientos.'],
    ['3', 'Motive y conciliación', 'Unidades, choferes, odómetros y comparación de millas contra consumo.']
  ];
  data.forEach(([n, t, d], i) => {
    addRect(s, xs[i], 2.07, 3.35, 2.85, i === 1 ? C.paleRed : C.paleBlue, C.line, 0.18);
    s.addShape(pptx.ShapeType.ellipse, { x: xs[i] + 0.3, y: 2.35, w: 0.55, h: 0.55, fill: { color: i === 1 ? C.red : C.navy }, line: { color: i === 1 ? C.red : C.navy, transparency: 100 } });
    addText(s, n, xs[i] + 0.3, 2.49, 0.55, 0.12, { fontSize: 12, color: C.white, bold: true, align: 'center' });
    addText(s, t, xs[i] + 0.3, 3.14, 2.75, 0.27, { fontSize: 18, color: C.navy, bold: true });
    addText(s, d, xs[i] + 0.3, 3.6, 2.75, 0.72, { fontSize: 12, color: C.muted, breakLine: true });
  });
  addText(s, 'La información queda disponible para consulta interna, exportación y revisión por área.', 1.2, 5.73, 10.9, 0.28, { fontSize: 16, color: C.navy, bold: true, align: 'center' });
}

// 4. Load registration
{
  const s = pptx.addSlide();
  s.background = { color: C.paper };
  header(s, 'Demostración', 'Registro guiado de una carga de diésel', 4);
  screenshot(s, formScreenshot, 0.62, 1.3, 7.85, 5.35);
  addText(s, 'Qué se captura', 8.82, 1.48, 3.35, 0.28, { fontSize: 20, color: C.navy, bold: true });
  bullet(s, 'Unidad seleccionada desde el catálogo sincronizado.', 8.82, 2.05, 3.75, { fontSize: 13 });
  bullet(s, 'Chofer identificado desde el listado de Motive.', 8.82, 2.72, 3.75, { fontSize: 13 });
  bullet(s, 'Odómetro, galones y origen de la carga.', 8.82, 3.39, 3.75, { fontSize: 13 });
  bullet(s, 'Dos evidencias obligatorias: ticket/bomba y odómetro.', 8.82, 4.06, 3.75, { fontSize: 13 });
  addRect(s, 8.81, 4.95, 3.7, 1.05, C.paleGreen, 'C9E6D4', 0.12);
  addText(s, 'Resultado', 9.05, 5.17, 1.25, 0.18, { fontSize: 11, color: C.green, bold: true });
  addText(s, 'Un registro con folio, fecha y hora, listo para seguimiento.', 9.05, 5.42, 3.15, 0.3, { fontSize: 12.5, color: C.ink, breakLine: true });
}

// 5. Validations
{
  const s = pptx.addSlide();
  s.background = { color: C.white };
  header(s, 'Control de calidad', 'Validaciones antes de guardar', 5);
  addText(s, 'El sistema no sustituye la revisión humana: la guía y hace visibles las excepciones antes de que se conviertan en un problema.', 0.62, 1.26, 11.4, 0.36, { fontSize: 16, color: C.muted, breakLine: true });
  screenshot(s, validationScreenshot, 0.62, 1.95, 7.45, 4.92);
  card(s, 8.55, 2.0, 3.88, 1.19, 'Odómetro', 'Evita lecturas menores, saltos imposibles y resalta diferencias que deben verificarse.', C.gold);
  card(s, 8.55, 3.5, 3.88, 1.19, 'Capacidad y existencia', 'Limita galones por carga y no permite descontar más diésel del disponible en la bomba.', C.red);
  card(s, 8.55, 5.0, 3.88, 1.19, 'Evidencia y confirmación', 'Solicita fotos y confirmación adicional cuando existe una advertencia relevante.', C.green);
}

// 6. Inventory
{
  const s = pptx.addSlide();
  s.background = { color: C.paper };
  header(s, 'Inventario', 'Control de existencias por origen de carga', 6);
  addText(s, 'El piloto distingue las dos bombas de la empresa y las cargas externas con tarjeta Pilot.', 0.62, 1.25, 9.2, 0.3, { fontSize: 16, color: C.muted });
  const tanks = [
    ['Hobbs', 'Bomba C&C', 'Las compras suman galones y cada carga descuenta del saldo.', C.navy],
    ['Orla', 'Bomba C&C', 'Mismo control independiente para anticipar reabasto.', C.blue],
    ['Pilot', 'Carga externa', 'Ubicación e importe obligatorios; no afecta inventario local.', C.red]
  ];
  tanks.forEach(([name, type, detail, color], i) => {
    const x = 0.72 + (i * 4.12);
    addRect(s, x, 2.1, 3.57, 2.6, C.white, C.line, 0.16);
    addRect(s, x, 2.1, 3.57, 0.11, color, color);
    addText(s, name, x + 0.28, 2.46, 2.95, 0.38, { fontSize: 26, color, bold: true, fontFace: 'Aptos Display' });
    addText(s, type, x + 0.28, 2.98, 2.95, 0.18, { fontSize: 11, color: C.muted, bold: true });
    addText(s, detail, x + 0.28, 3.45, 2.92, 0.63, { fontSize: 12.5, color: C.ink, breakLine: true });
  });
  addRect(s, 0.72, 5.25, 11.8, 0.92, C.navy, C.navy, 0.13);
  addText(s, 'Compras + cargas de unidad + ajustes autorizados = bitácora completa por bomba', 0.98, 5.54, 11.25, 0.2, { fontSize: 16, color: C.white, bold: true, align: 'center' });
}

// 7. Motive and reconciliation
{
  const s = pptx.addSlide();
  s.background = { color: C.white };
  header(s, 'Integración', 'Motive aporta el contexto operativo', 7);
  addText(s, 'La sincronización alimenta el catálogo y permite comparar los registros de combustible contra la operación de cada unidad.', 0.62, 1.25, 11.2, 0.32, { fontSize: 16, color: C.muted });
  const flow = [
    ['Motive', 'Unidades · choferes · odómetros'],
    ['C&C Diesel App', 'Cargas · fotos · inventario'],
    ['Conciliación', 'Millas · galones · MPG · alertas']
  ];
  flow.forEach(([title, subtitle], i) => {
    const x = 0.82 + (i * 4.08);
    addRect(s, x, 2.35, 3.2, 1.75, i === 1 ? C.paleRed : C.paleBlue, C.line, 0.18);
    addText(s, title, x + 0.22, 2.74, 2.75, 0.27, { fontSize: 20, color: i === 1 ? C.redDark : C.navy, bold: true, align: 'center' });
    addText(s, subtitle, x + 0.28, 3.24, 2.64, 0.42, { fontSize: 12, color: C.muted, align: 'center', breakLine: true });
    if (i < 2) {
      s.addShape(pptx.ShapeType.chevron, { x: x + 3.38, y: 2.94, w: 0.42, h: 0.44, fill: { color: C.red }, line: { color: C.red, transparency: 100 } });
    }
  });
  addRect(s, 1.46, 5.05, 10.4, 0.98, C.paleGreen, 'C7E8D5', 0.13);
  addText(s, 'Resultado esperado: identificar inconsistencias de kilometraje, consumo o captura para revisarlas oportunamente.', 1.75, 5.38, 9.82, 0.26, { fontSize: 15, color: C.green, bold: true, align: 'center' });
}

// 8. Governance
{
  const s = pptx.addSlide();
  s.background = { color: C.paper };
  header(s, 'Seguridad y seguimiento', 'Información con acceso y trazabilidad', 8);
  const columns = [
    ['Acceso actual', 'La plataforma está cerrada. Por ahora solo la cuenta administradora puede entrar.', C.navy],
    ['Bitácora', 'Las compras, cargas y ajustes dejan fecha, responsable, motivo y saldo posterior.', C.green],
    ['Siguiente etapa', 'Agregar perfiles de chofer y operación con permisos específicos, sin cuentas compartidas.', C.red]
  ];
  columns.forEach(([title, text, color], i) => {
    const x = 0.77 + i * 4.1;
    addRect(s, x, 2.0, 3.56, 3.4, C.white, C.line, 0.18);
    s.addShape(pptx.ShapeType.ellipse, { x: x + 1.42, y: 2.38, w: 0.7, h: 0.7, fill: { color }, line: { color, transparency: 100 } });
    addText(s, String(i + 1), x + 1.42, 2.59, 0.7, 0.16, { fontSize: 13, color: C.white, bold: true, align: 'center' });
    addText(s, title, x + 0.3, 3.38, 2.96, 0.28, { fontSize: 18, color: C.navy, bold: true, align: 'center' });
    addText(s, text, x + 0.36, 3.95, 2.84, 0.77, { fontSize: 12.5, color: C.muted, align: 'center', breakLine: true });
  });
}

// 9. Close / next steps
{
  const s = pptx.addSlide();
  s.background = { color: C.navyDark };
  s.addShape(pptx.ShapeType.ellipse, { x: -1.1, y: 5.2, w: 4.1, h: 4.1, fill: { color: C.red, transparency: 15 }, line: { color: C.red, transparency: 100 } });
  s.addImage({ path: logo, x: 0.65, y: 0.55, w: 1.35, h: 0.84, sizing: { type: 'contain', x: 0.65, y: 0.55, w: 1.35, h: 0.84 } });
  addText(s, 'Propuesta de siguiente paso', 0.68, 1.72, 8, 0.35, { fontSize: 13, color: 'C9D6F5', bold: true, charSpace: 1.2 });
  addText(s, 'Validar el piloto con las áreas involucradas.', 0.66, 2.16, 8.5, 0.68, { fontSize: 37, color: C.white, bold: true, fontFace: 'Aptos Display', breakLine: true });
  const steps = [
    ['1', 'Definir responsables', 'Compras de diésel, revisión de registros y reabasto.'],
    ['2', 'Operar y medir', 'Usar el flujo diario y revisar alertas e inconsistencias.'],
    ['3', 'Ajustar y escalar', 'Afinar reglas, usuarios y reportes según la operación real.']
  ];
  steps.forEach(([n, title, desc], i) => {
    const y = 3.35 + i * 0.88;
    s.addShape(pptx.ShapeType.ellipse, { x: 0.75, y, w: 0.42, h: 0.42, fill: { color: C.red }, line: { color: C.red, transparency: 100 } });
    addText(s, n, 0.75, y + 0.13, 0.42, 0.11, { fontSize: 10, color: C.white, bold: true, align: 'center' });
    addText(s, title, 1.4, y + 0.02, 2.2, 0.18, { fontSize: 15, color: C.white, bold: true });
    addText(s, desc, 3.65, y + 0.02, 4.62, 0.32, { fontSize: 12, color: 'D6E0FA', breakLine: true });
  });
  addRect(s, 9.35, 2.2, 2.92, 2.8, C.white, C.white, 0.18);
  addText(s, 'C&C Diesel App', 9.68, 2.8, 2.25, 0.33, { fontSize: 19, color: C.navy, bold: true, align: 'center' });
  addText(s, 'Una herramienta diseñada para dar visibilidad, evidencia y control a la operación de diésel.', 9.68, 3.46, 2.27, 0.7, { fontSize: 12, color: C.muted, align: 'center', breakLine: true });
  addText(s, 'Gracias', 9.7, 4.48, 2.22, 0.2, { fontSize: 12, color: C.red, bold: true, align: 'center' });
}

const output = path.join(root, 'Presentacion_C&C_Diesel_App.pptx');

(async () => {
  await pptx.writeFile({ fileName: output });
  console.log(`Presentación creada: ${output}`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
