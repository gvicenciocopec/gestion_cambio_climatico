/**
 * Bot de tareas por WhatsApp · receptor gratuito (Cloudflare Workers, plan Free, sin tarjeta).
 * Guía paso a paso: docs/GUIA_WHATSAPP.md
 *
 * Qué hace:
 *   1. Meta (WhatsApp Cloud API) le avisa cada mensaje que llega al número del bot.
 *   2. Verifica que el aviso venga de verdad de Meta (firma X-Hub-Signature-256).
 *   3. Si el mensaje es de un número del equipo (pestaña "WhatsApp contactos" de la planilla), lo agrega como fila
 *      a la pestaña "WhatsApp" usando la cuenta robot de Google. Nunca lee ni muestra otros datos de la planilla.
 *   4. Lo marca como leído (✓✓ azul): esa es la confirmación. NO responde mensajes, para que el costo sea 0.
 *   La app (Cuadre AACC) convierte esas filas en tareas la próxima vez que alguien la abre.
 *
 * Variables (Cloudflare → tu Worker → Settings → Variables and Secrets):
 *   VERIFY_TOKEN     texto que inventas; el mismo que pegas en Meta al conectar el webhook
 *   APP_SECRET       Meta → tu app → Configuración de la app → Básica → Clave secreta de la app   (tipo Secret)
 *   SHEET_ID         ID de la planilla (lo que va entre /d/ y /edit en su URL)
 *   GOOGLE_SA_JSON   contenido completo del archivo .json de la cuenta robot de Google                 (tipo Secret)
 *   PHONE_NUMBER_ID  Meta → WhatsApp → Configuración de la API → identificador del número de teléfono
 *   WA_TOKEN         (opcional) token permanente de Meta, sólo para marcar como leído               (tipo Secret)
 *   GRAPH_VERSION    (opcional) versión de la API de Meta; por defecto v25.0
 *   CONTACT_EMAIL    (opcional) correo de contacto que aparece en /privacidad
 */

const INBOX = 'WhatsApp';
const CONTACTS = 'WhatsApp contactos';
const ALLOW_TTL_MS = 5 * 60 * 1000;
const enc = new TextEncoder();
let TOKEN = null; // {value, exp} token de acceso de Google (dura ~1 h; se reutiliza mientras el Worker siga vivo)
let ALLOW = null; // {set, exp} números del equipo (se releen cada 5 minutos)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/privacidad') return privacyPage(env);

    if (request.method === 'GET') {
      // Prueba de conexión de Meta: devolver hub.challenge tal cual
      if (url.searchParams.get('hub.mode') === 'subscribe') {
        const ok = !!env.VERIFY_TOKEN && url.searchParams.get('hub.verify_token') === env.VERIFY_TOKEN;
        return ok ? text(url.searchParams.get('hub.challenge') || '') : text('Token de verificación incorrecto', 403);
      }
      return text('Bot de tareas: funcionando.');
    }
    if (request.method !== 'POST') return text('Método no permitido', 405);

    const raw = await request.text();
    if (!(await validSignature(raw, request.headers.get('x-hub-signature-256'), env.APP_SECRET))) {
      return text('Firma inválida', 401);
    }
    let body;
    try { body = JSON.parse(raw); } catch (e) { return text('JSON inválido', 400); }

    try {
      const msgs = extractMessages(body, env);
      if (!msgs.length) return text('ok'); // avisos de "entregado"/"leído": nada que guardar
      const allow = await allowList(env);
      const mine = msgs.filter(m => allow.has(digits(m.from)));
      if (!mine.length) return text('ok'); // números que no son del equipo: se ignoran en silencio
      await appendRows(env, mine.map(toRow));
      if (env.WA_TOKEN) {
        const job = Promise.all(mine.filter(m => m.id).map(m => markRead(env, m.id))).catch(e => console.error('No se pudo marcar como leído:', e));
        if (ctx && ctx.waitUntil) ctx.waitUntil(job);
      }
      return text('ok');
    } catch (e) {
      // Sin 200, Meta reintenta durante varios días: el mensaje no se pierde. La app descarta duplicados por ID.
      console.error('Error al guardar en la planilla:', (e && e.stack) || e);
      return text('Error temporal', 500);
    }
  },
};

/* ------------------------------------------------------------------ */
/* Meta                                                                */
/* ------------------------------------------------------------------ */

async function validSignature(raw, header, secret) {
  if (!secret || !header) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(header).trim());
  if (!m) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(raw)));
  return safeEqual(hex(mac), m[1].toLowerCase());
}

// Todos los mensajes del aviso (Meta puede agrupar varios). Ignora los de otro número del bot.
function extractMessages(body, env) {
  const out = [];
  const entries = (body && body.entry) || [];
  for (const entry of entries) {
    for (const ch of entry.changes || []) {
      if (ch.field && ch.field !== 'messages') continue;
      const v = ch.value || {};
      if (env.PHONE_NUMBER_ID && v.metadata && String(v.metadata.phone_number_id) !== String(env.PHONE_NUMBER_ID)) continue;
      const names = {};
      for (const c of v.contacts || []) if (c && c.wa_id) names[c.wa_id] = (c.profile && c.profile.name) || '';
      for (const m of v.messages || []) {
        const from = m.from || (v.contacts && v.contacts[0] && v.contacts[0].wa_id) || '';
        let msg = '', note = '';
        if (m.type === 'text') msg = (m.text && m.text.body) || '';
        else if (m.type === 'interactive') {
          const it = m.interactive || {};
          msg = (it.button_reply && it.button_reply.title) || (it.list_reply && it.list_reply.title) || '';
        } else if (m.type === 'button') msg = (m.button && m.button.text) || '';
        else note = 'Tipo no soportado: ' + (m.type || 'desconocido');
        out.push({ id: m.id || '', from: from, name: names[from] || '', text: msg, note: note, ts: m.timestamp });
      }
    }
  }
  return out;
}

async function markRead(env, messageId) {
  const v = env.GRAPH_VERSION || 'v25.0';
  const res = await fetch('https://graph.facebook.com/' + v + '/' + encodeURIComponent(env.PHONE_NUMBER_ID) + '/messages', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + env.WA_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
  });
  if (!res.ok) throw new Error('Meta ' + res.status + ': ' + (await res.text()).slice(0, 300));
}

/* ------------------------------------------------------------------ */
/* Google Sheets (cuenta robot)                                        */
/* ------------------------------------------------------------------ */

function toRow(m) {
  const at = m.ts ? new Date(Number(m.ts) * 1000) : new Date();
  return [at.toISOString(), m.id, digits(m.from), m.name, m.text, 'Nueva', '', m.note];
}

// valueInputOption=RAW: lo que escribe la gente se guarda como texto, nunca como fórmula
async function appendRows(env, rows) {
  const range = encodeURIComponent("'" + INBOX + "'!A1");
  await sheets(env, 'POST', '/values/' + range + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { values: rows });
}

async function allowList(env) {
  if (ALLOW && ALLOW.exp > Date.now()) return ALLOW.set;
  const range = encodeURIComponent("'" + CONTACTS + "'!A2:A");
  const data = await sheets(env, 'GET', '/values/' + range + '?majorDimension=COLUMNS');
  const set = new Set(((data.values && data.values[0]) || []).map(digits).filter(Boolean));
  ALLOW = { set: set, exp: Date.now() + ALLOW_TTL_MS };
  return set;
}

async function sheets(env, method, path, payload) {
  if (!env.SHEET_ID) throw new Error('Falta la variable SHEET_ID');
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(env.SHEET_ID) + path, {
    method: method,
    headers: Object.assign({ authorization: 'Bearer ' + (await googleToken(env)) }, payload ? { 'content-type': 'application/json' } : {}),
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (!res.ok) {
    if (res.status === 401) TOKEN = null;
    throw new Error('Google Sheets ' + res.status + ': ' + (await res.text()).slice(0, 300));
  }
  return res.json();
}

// Token de acceso firmado con la llave de la cuenta robot (JWT RS256, sin librerías)
async function googleToken(env) {
  if (TOKEN && TOKEN.exp > Date.now() + 60000) return TOKEN.value;
  if (!env.GOOGLE_SA_JSON) throw new Error('Falta la variable GOOGLE_SA_JSON');
  let sa;
  try { sa = JSON.parse(env.GOOGLE_SA_JSON); } catch (e) { throw new Error('GOOGLE_SA_JSON no es un JSON válido'); }
  const now = Math.floor(Date.now() / 1000);
  const aud = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const head = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64url(enc.encode(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: aud, iat: now, exp: now + 3600,
  })));
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(head + '.' + claim));
  const res = await fetch(aud, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + claim + '.' + b64url(new Uint8Array(sig)),
  });
  if (!res.ok) throw new Error('Google token ' + res.status + ': ' + (await res.text()).slice(0, 300));
  const j = await res.json();
  TOKEN = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return TOKEN.value;
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

// Sólo dígitos; un celular chileno de 9 dígitos sin el 56 se completa (igual que la app)
function digits(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (/^9\d{8}$/.test(d)) d = '56' + d;
  return d;
}

function text(body, status) {
  return new Response(body, { status: status || 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

function hex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem) {
  const b64 = String(pem || '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function privacyPage(env) {
  const contact = env.CONTACT_EMAIL ? '<p>Contacto: ' + String(env.CONTACT_EMAIL).replace(/[<>&"]/g, '') + '</p>' : '';
  const html = '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Política de privacidad · Bot de tareas</title><body style="font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.6">' +
    '<h1>Política de privacidad · Bot de tareas</h1>' +
    '<p>Este bot es una herramienta interna de un equipo de trabajo. Sólo procesa mensajes enviados por los miembros registrados del equipo.</p>' +
    '<p>El texto de cada mensaje se guarda como una tarea en la planilla privada del equipo. No se usa para publicidad, no se vende y no se comparte con terceros.</p>' +
    '<p>Los mensajes de números que no pertenecen al equipo se descartan sin guardarse.</p>' +
    '<p>Para eliminar tus datos, pide al administrador del equipo que borre tus tareas.</p>' + contact +
    '</body></html>';
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
