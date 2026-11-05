/* Ecomax Equipo · app conectada (fase 1) */
'use strict';
const CFG = window.ECOMAX_CONFIG;
const sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ecomax-equipo-auth' } });

/* ---------- utilidades ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const eur = (n, d = 0) => { if (n == null || isNaN(n)) return '—'; const s = Math.abs(+n).toFixed(d).split('.'); s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.'); return (n < 0 ? '−' : '') + s.join(',') + ' €'; };
const fDate = s => { if (!s) return ''; const d = new Date(String(s).length <= 10 ? s + 'T12:00' : s); return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }); };
const fWhen = s => { if (!s) return ''; const d = new Date(s); return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); };
const hhmm = t => t ? String(t).slice(0, 5) : '';
const today = () => new Date().toISOString().slice(0, 10);
let toastT;
function toast(m, ms = 2800) { clearTimeout(toastT); $('toastSlot').innerHTML = `<div class="toast" role="status">${esc(m)}</div>`; toastT = setTimeout(() => $('toastSlot').innerHTML = '', ms); }
function errMsg(e) { const m = e?.message || String(e); return m.replace(/^.*?ERROR:\s*/, '').replace(/\s*CONTEXT:.*$/s, ''); }
async function rpc(fn, args) { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; }
function busy(btn, on) { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.t = btn.textContent; btn.textContent = 'Guardando…'; } else if (btn.dataset.t) btn.textContent = btn.dataset.t; }

/* ---------- textos ---------- */
const ROLTXT = { captacion: 'Captación', comercial: 'Comercial', oficina: 'Oficina', direccion: 'Dirección', instalador: 'Instalación', comparativas: 'Comparativas' };
const ROLLAB = { captacion: 'Captación · leads y citas', comercial: 'Comercial', oficina: 'Oficina · presupuestos y trámites', direccion: 'Dirección · visto bueno final', instalador: 'Instalador', comparativas: 'Comparativas de luz y gas' };
const ST = {
  lead: { t: 'Lead nuevo', c: 'p-new', k: 0 }, visita: { t: 'Visita agendada', c: 'p-info', k: 1 },
  solicitud: { t: 'Ficha recibida', c: 'p-new', k: 2 }, preparacion: { t: 'En preparación', c: 'p-info', k: 2 }, devuelta: { t: 'Devuelta a oficina', c: 'p-bad', k: 2 },
  aprobacion: { t: 'Pendiente de visto bueno', c: 'p-warn', k: 3 }, aprobado: { t: 'Visto bueno · falta enviar', c: 'p-warn', k: 4 }, enviado: { t: 'Enviado al cliente', c: 'p-ok', k: 5 },
  aceptado: { t: 'Venta cerrada', c: 'p-done', k: 6 }, rechazado: { t: 'Rechazado', c: 'p-bad', k: 9 }, descartado: { t: 'Descartado', c: 'p-mute', k: 9 },
};
const STEPS = ['Lead', 'Visita', 'Presupuesto', 'Visto bueno', 'Envío', 'Cliente', 'Venta'];

/* ---------- estado ---------- */
let me = null, empresa = null, team = [], tarifas = [], E = [], CORR = [];
let view = null, sel = null, sub = 'res', filt = 'pend', mode = 'view', day = null, actWho = 'all';
let detail = { id: null, eventos: [], archivos: [] };
const P = id => team.find(p => p.id === id);
const nm = id => P(id)?.name ?? P(id)?.nombre ?? '—';
const ini = id => { const n = P(id)?.nombre || '?'; const w = n.trim().split(/\s+/); return ((w[0]?.[0] || '') + (w[1]?.[0] || n[1] || '')).toUpperCase(); };
const role = () => me?.rol;

/* ---------- carga de datos ---------- */
async function loadAll() {
  const [t, ta, ex] = await Promise.all([
    sb.from('profiles').select('id,nombre,email,rol,admin,activo,created_at').order('nombre'),
    sb.from('tarifas').select('*').order('orden'),
    sb.from('expedientes').select('*').order('id', { ascending: false }).limit(2000),
  ]);
  if (t.error) throw t.error; if (ex.error) throw ex.error;
  team = t.data || []; tarifas = ta.data || []; E = ex.data || [];
  const co = await sb.from('eventos').select('id,expediente_id,actor,tipo,comentario,datos,created_at').in('tipo', ['correccion', 'correccion_hecha']).order('id');
  const ev = co.data || [], hechas = {};
  ev.filter(x => x.tipo === 'correccion_hecha').forEach(x => { hechas[x.datos?.ref] = x; });
  CORR = ev.filter(x => x.tipo === 'correccion').map(x => ({ ...x, para: x.datos?.para, done: hechas[x.id] || null }));
}
const myCorr = () => CORR.filter(c => !c.done && c.para === me?.id);
async function loadDetail(id) {
  const [ev, ar] = await Promise.all([
    sb.from('eventos').select('*').eq('expediente_id', id).order('id'),
    sb.from('archivos').select('*').eq('expediente_id', id).order('id'),
  ]);
  detail = { id, eventos: ev.data || [], archivos: ar.data || [] };
}

/* ---------- reglas de qué toca a cada uno ---------- */
function needsMe(e) {
  const r = role();
  if (r === 'captacion') return e.etapa === 'lead';
  if (r === 'comercial') return e.comercial === me.id && ['visita', 'enviado'].includes(e.etapa);
  if (r === 'oficina') return ['solicitud', 'preparacion', 'devuelta', 'aprobado'].includes(e.etapa) || faltaTaclia(e);
  if (r === 'direccion') return e.etapa === 'aprobacion';
  return false;
}
const isOpen = e => !['aceptado', 'rechazado', 'descartado'].includes(e.etapa) || faltaTaclia(e);
function sumario(e) {
  const f = e.ficha || {}, p = [];
  if (f.fv) p.push(`${f.fv.placas} placas${+f.fv.batN ? ` + ${f.fv.batN}×${f.fv.batKWh} kWh` : ''}`);
  if (f.aero) p.push(`Aerotermia ${f.aero.m2 || '?'} m²`);
  if (!p.length && e.interes) p.push(e.interes);
  return p.join(' · ');
}
function taskLabel(e) {
  const r = role();
  if (r === 'captacion') return 'Contactar y agendar visita';
  if (r === 'comercial') return e.etapa === 'visita' ? `Visita ${fDate(e.visita_fecha)} ${hhmm(e.visita_hora)} · rellenar ficha` : 'Marcar respuesta del cliente';
  if (r === 'oficina') return ({ solicitud: 'Aceptar ficha nueva', preparacion: 'Hacer presupuesto en Taclia', devuelta: 'Corregir lo que pide dirección', aprobado: 'Enviar presupuesto al cliente' })[e.etapa] || (faltaTaclia(e) ? 'Pasar a Taclia' : 'Revisar');
  if (r === 'direccion') return `Dar visto bueno · ${eur(e.presupuesto?.propuesto)}`;
  return 'Abrir';
}
function tarifaDe(e) {
  const f = e.ficha?.fv; if (!f) return null;
  const bat = (+f.batN || 0) * (+f.batKWh || 0);
  const r = tarifas.find(x => +x.placas === +f.placas && +x.bateria_kwh === bat);
  if (!r) return { miss: true, txt: `${f.placas} placas${bat ? ` + ${bat} kWh de batería` : ''}` };
  const tri = f.instalacion === 'Trifásica';
  return { r, tri, precio: tri ? (r.pvp_tri ?? +r.pvp_mono + 2000) : +r.pvp_mono, label: `${r.placas} PL + INV ${r.inversor_kw} kW${+r.bateria_kwh ? ` + BAT ${r.bateria_kwh} kWh` : ''}` };
}
function eqTexto(e) {
  const f = e.ficha?.fv, a = e.ficha?.aero, L = [];
  if (f) { const bat = (+f.batN || 0) * (+f.batKWh || 0);
    L.push(`${f.placas} paneles solares de ${f.potPlaca} W (${((f.placas * f.potPlaca) / 1000).toLocaleString('es-ES')} kWp)`);
    L.push(`${f.invN > 1 ? f.invN + ' inversores' : 'Inversor'} híbrido de ${f.invKW} kW ${String(f.instalacion || '').toLowerCase()}`);
    if (bat) L.push(`${f.batN > 1 ? f.batN + ' baterías de ' + f.batKWh + ' kWh' : 'Batería de ' + f.batKWh + ' kWh'} (${bat} kWh en total)`);
    if (f.cargador && f.cargador !== 'No') L.push('Cargador de coche eléctrico de 8,5 kW (Modo 3)'); }
  if (a) L.push(`Aerotermia para ${a.m2 || '?'} m²${a.hibridar === 'Sí' ? ', hibridada con ' + (a.hibSist || 'el sistema actual') : ''}`);
  return L;
}
function datosIA(e, numero, precio) {
  const c = e.cliente || {}, f = e.ficha?.fv, a = e.ficha?.aero;
  const P = +precio || 0;
  return [`Haz el presupuesto con el mismo diseño de los presupuestos de Ecomax Energía (cabecera con el logo, "Presupuesto para", fecha, ubicación y nº de presupuesto, equipos incluidos, especificaciones técnicas, precio total, financiación, beneficios y pie con 654 094 963 · info@ecomaxenergia.com · www.ecomaxenergia.com).`, '',
    `Presupuesto para: ${c.nombre || ''}`, `Ubicación: ${[c.calle, c.pueblo].filter(Boolean).join(', ')}`,
    `Fecha: ${new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}`, `Presupuesto nº: ${numero || ''}`, '',
    'Equipos incluidos:', ...eqTexto(e).map(x => '- ' + x), '',
    'Especificaciones: estructura y pequeño material, cableado y protecciones, instalación y puesta en marcha, legalizaciones y certificados incluidos en el precio, monitorización.',
    f ? `Datos de la visita: cubierta ${f.cubierta}; Solar Bloc ${f.solarBloc}; grúa ${f.grua}; distancia del cuadro al inversor ${f.distInv} m y a la batería ${f.distBat} m.` : '',
    a ? `Datos de la visita: ${a.m2} m², ${a.plantas} plantas, ${a.personas} personas, emisores ${a.emisores}, combustible actual ${a.combustible}.` : '',
    '', `Precio total: ${eur(P)} (IVA incluido)`,
    P ? `Financiación: 12 meses sin intereses ${eur(cuota(P, 12), 2)}/mes · 120 cuotas ${eur(cuota(P, 120), 2)}/mes (orientativo).` : '',
    'Garantías: paneles 25 años de producción; inversor [revisar años]; batería 10 años o 6.000 ciclos.',
    e.ficha?.notas ? `Observaciones del comercial: ${e.ficha.notas}` : ''].filter(x => x !== null && x !== undefined).join('\n').replace(/\n{3,}/g, '\n\n');
}
function datosTaclia(e) {
  const c = e.cliente || {}, f = e.ficha?.fv, P = +e.presupuesto?.final || 0, base = P / 1.21, L = [];
  L.push(`CLIENTE: ${c.nombre || ''} · ${[c.calle, c.pueblo].filter(Boolean).join(', ')} · ${c.tel || ''}${c.email ? ' · ' + c.email : ''}`, '', 'CONCEPTOS (cantidad):');
  if (f) { const bat = (+f.batN || 0) * (+f.batKWh || 0);
    L.push(`FTV + PLACA SOLAR RÍGIDA (${f.placas}) · Placas de última generación ${f.potPlaca} W`);
    L.push(`FTV INVERSOR ${f.invKW}KW (${f.invN || 1}) · Inversor híbrido ${f.invKW} kW ${String(f.instalacion || '').toLowerCase()} para autoconsumo`);
    if (bat) L.push(`FTV BATERÍA ${f.batKWh} kWh (${f.batN}) · Batería de litio de alto rendimiento`);
    if (f.cargador && f.cargador !== 'No') L.push('FTV CARGADOR COCHE (1) · Cargador de coche 8,5 kW, modo 3');
    L.push('FTV LEGALIZACIONES (1) · Memoria técnica y estudio SS, trámites ayuntamiento, CIE, CFO, RITSIC, RAC, bonificación IBI');
    L.push('FTV CERTIFICADOS ENERGÉTICOS (1) · Certificado antes y después para la deducción del IRPF'); }
  if (e.ficha?.aero) L.push(`AEROTERMIA (1) · ${eqTexto(e).slice(-1)[0]}`);
  L.push(`TOTAL INSTALACIÓN (1) · Llave en mano · ${eur(base, 2)} + IVA 21 %`, '', `Base imponible: ${eur(base, 2)}`, `IVA 21 %: ${eur(P - base, 2)}`, `TOTAL: ${eur(P, 2)}`, '',
    'Método de pago: 70% a la aceptación por transferencia (concepto: nombre del cliente y nº de presupuesto) y 30% al finalizar la instalación y la puesta en marcha.');
  return L.join('\n');
}
function obsTaclia(e) {
  const pr = e.presupuesto || {}, pg = e.pago, o = [];
  if (pr.numero) o.push(`Presupuesto Ecomax ${pr.numero}.`);
  if (pg) o.push(`Forma de pago: ${pg.forma}${pg.plazo ? ' a ' + pg.plazo + ' meses' : ''}.`);
  if (e.ficha?.fv?.altSinBat) o.push('El cliente pidió también versión sin batería.');
  return o.join(' ');
}
const cuota = (Pr, n) => { if (n <= 24) return Pr / n; const r = 0.0625 / 12; return Pr * r / (1 - Math.pow(1 + r, -n)); };

/* ---------- arranque y acceso ---------- */
async function boot() {
  $('main').innerHTML = `<div class="empty">Cargando…</div>`;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showAccess();
  await afterLogin(session.user);
}
async function showAccess() {
  me = null; renderTop();
  let configurado = true;
  try { const { data, error } = await sb.functions.invoke('usuarios', { body: { accion: 'estado' } }); if (!error) configurado = !!data?.configurado; } catch (e) { }
  configurado ? renderLogin() : renderSetup();
}
function loginShell(inner) {
  return `<div class="login panel"><img class="login-logo" src="icons/logo.png" alt="Ecomax Energía"><h1>Ecomax Equipo</h1>${inner}</div>`;
}
function renderLogin() {
  $('main').innerHTML = loginShell(`<p class="hint">Entra con tu email y tu contraseña.</p>
   <form id="fLogin" class="f" novalidate>
    <label class="fl">Email<input type="email" id="lgEmail" autocomplete="username" autocapitalize="none" inputmode="email"></label>
    <label class="fl">Contraseña<input type="password" id="lgPass" autocomplete="current-password"></label>
    <span class="err hide" id="lgErr"></span>
    <button class="btn primary big" type="submit">Entrar</button></form>
   <p class="hint">¿No tienes acceso o has olvidado la contraseña? Pídeselo al administrador de tu empresa.</p>`);
  $('fLogin').addEventListener('submit', async ev => {
    ev.preventDefault(); const b = ev.submitter; busy(b, true);
    const { data, error } = await sb.auth.signInWithPassword({ email: $('lgEmail').value.trim(), password: $('lgPass').value });
    busy(b, false);
    if (error) { $('lgErr').textContent = 'Email o contraseña incorrectos.'; $('lgErr').classList.remove('hide'); return; }
    await afterLogin(data.user);
  });
}
function renderSetup() {
  $('main').innerHTML = loginShell(`<p class="hint">Primera vez: configura la empresa y crea tu usuario de administrador. Solo se hace una vez.</p>
   <form id="fSetup" class="f" novalidate>
    <label class="fl">Nombre de la empresa<input type="text" id="suEmp" value="Ecomax Energía"></label>
    <label class="fl">Tu nombre<input type="text" id="suNom" autocomplete="name"></label>
    <label class="fl">Tu email<input type="email" id="suEmail" autocomplete="username" autocapitalize="none"></label>
    <label class="fl">Contraseña (mínimo 8)<input type="password" id="suPass" autocomplete="new-password"></label>
    <label class="fl">Repite la contraseña<input type="password" id="suPass2" autocomplete="new-password"></label>
    <span class="err hide" id="suErr"></span>
    <button class="btn primary big" type="submit">Configurar y entrar</button></form>`);
  $('fSetup').addEventListener('submit', async ev => {
    ev.preventDefault(); const b = ev.submitter; const err = m => { $('suErr').textContent = m; $('suErr').classList.remove('hide'); };
    const v = id => $(id).value.trim();
    if ($('suPass').value !== $('suPass2').value) return err('Las contraseñas no coinciden.');
    busy(b, true);
    const { data, error } = await sb.functions.invoke('usuarios', { body: { accion: 'configurar', empresa: v('suEmp'), nombre: v('suNom'), email: v('suEmail'), password: $('suPass').value } });
    if (error || data?.error) { busy(b, false); return err(data?.error || (await error?.context?.json?.().catch(() => null))?.error || 'No se ha podido configurar.'); }
    const r = await sb.auth.signInWithPassword({ email: v('suEmail'), password: $('suPass').value });
    busy(b, false);
    if (r.error) return err('Configurado, pero no se ha podido entrar. Prueba desde la pantalla de acceso.');
    await afterLogin(r.data.user);
  });
}
async function afterLogin(user) {
  const { data: p, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error || !p || !p.activo) { await sb.auth.signOut(); toast('Tu usuario no está activo. Habla con tu administrador.', 5000); return showAccess(); }
  me = p;
  const { data: em } = await sb.from('empresas').select('*').eq('id', p.empresa_id).maybeSingle(); empresa = em;
  await loadAll();
  view = null; sel = null; mode = 'view';
  subscribe();
  render();
}
async function logout() { try { await sb.removeAllChannels(); } catch (e) { } await sb.auth.signOut(); me = null; E = []; team = []; view = null; showAccess(); }

/* ---------- tiempo real ---------- */
let rtTimer = null, lastPend = null;
function subscribe() {
  sb.removeAllChannels();
  sb.channel('ecomax-cambios')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expedientes' }, onRemote)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'eventos' }, onRemote)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'archivos' }, onRemote)
    .subscribe();
}
function onRemote() {
  clearTimeout(rtTimer);
  rtTimer = setTimeout(async () => {
    if (!me) return;
    const before = E.filter(needsMe).length;
    await loadAll();
    if (sel && detail.id === sel) await loadDetail(sel);
    const after = E.filter(needsMe).length;
    if (after > before) { toast('Tienes algo nuevo que hacer'); try { navigator.vibrate?.(150); } catch (e) { } }
    if (!document.querySelector('form.f:not(#fLogin) input:focus, form.f textarea:focus, .action input:focus, .action textarea:focus')) render(false, true);
  }, 400);
}

/* ---------- cabecera y menú ---------- */
const VIEWT = { corr: 'Correcciones', ventas: 'Quién interviene', leads: 'Leads', agenda: 'Agenda', exp: 'Expedientes', act: 'Actividad del equipo', equipo: 'Equipo', tarifas: 'Tarifas' };
function renderTop() {
  const hd = document.querySelector('header.top'); hd.hidden = !me;
  if (!me) { $('who').innerHTML = ''; $('crumb').innerHTML = ''; return; }
  $('who').innerHTML = `<strong>${esc(me.nombre)}</strong>${ROLLAB[me.rol]}<br><button type="button" class="btn ghost sm" data-go="salir">Salir</button>`;
  const t = role() === 'direccion' && view === 'exp' ? 'Expedientes' : role() === 'oficina' && view === 'exp' ? 'Bandeja' : role() === 'comercial' && view === 'exp' ? 'Mis expedientes' : role() === 'comercial' && view === 'agenda' ? 'Mi agenda' : VIEWT[view];
  $('crumb').innerHTML = view ? `<button type="button" class="btn sm" data-go="menu">← Inicio</button><h2>${t}</h2>` : '';
}
function menuItems() {
  const r = role(), it = [], pend = E.filter(needsMe).length;
  if (r === 'captacion') { it.push(['new:lead', '+ Nuevo lead', 'Llamada, web, WhatsApp o feria', 0, 1]); it.push(['leads', 'Leads', 'Contactar y agendar visitas', pend]); it.push(['agenda', 'Agenda de comerciales', 'Ver huecos antes de dar cita', 0]); }
  if (r === 'comercial') { it.push(['agenda', 'Mi agenda', 'Visitas y rellenar la ficha', E.filter(e => e.comercial === me.id && e.etapa === 'visita').length]); it.push(['new:ficha', '+ Ficha sin cita', 'Visita que no venía de captación', 0, 1]); it.push(['exp', 'Mis expedientes', 'Respuestas de clientes y estado', E.filter(e => e.comercial === me.id && e.etapa === 'enviado').length]); }
  if (r === 'oficina') { it.push(['exp', 'Bandeja', 'Fichas nuevas, presupuestos y envíos', pend]); it.push(['new:lead', '+ Nuevo lead', 'Si entra una llamada en oficina', 0]); it.push(['agenda', 'Agenda', 'Visitas de comerciales', 0]); }
  if (r === 'direccion') { it.push(['exp', 'Expedientes', 'Visto bueno y revisión de todo', pend]); it.push(['corr', 'Correcciones', 'Las que has indicado y si están hechas', CORR.filter(c => !c.done).length]); it.push(['ventas', 'Quién interviene', 'Ventas cerradas y quién hizo cada paso', 0]); it.push(['act', 'Actividad del equipo', 'Quién ha hecho qué y cuándo', 0]); it.push(['agenda', 'Agenda', 'Visitas de comerciales', 0]); }
  if (['captacion', 'comercial', 'oficina', 'direccion'].includes(r)) it.push(['tarifas', 'Tarifas', r === 'oficina' ? 'Ver y cambiar precios' : 'Precios y cuotas', 0]);
  if (me.admin) it.push(['equipo', 'Equipo', 'Altas, roles y contraseñas', 0]);
  return it;
}
function go(k) {
  if (k === 'salir') return logout();
  sel = null; mode = 'view'; filt = 'pend'; sub = 'res';
  if (k === 'menu') view = null;
  else if (k === 'new:lead') { view = role() === 'captacion' ? 'leads' : 'exp'; mode = 'lead'; }
  else if (k === 'new:ficha') { view = 'exp'; mode = 'ficha'; }
  else { view = k; if (k === 'exp' && ['comercial', 'direccion'].includes(role())) filt = role() === 'direccion' ? 'pend' : 'open'; }
  render(mode !== 'view'); window.scrollTo({ top: 0 });
}
function renderMenu() {
  const r = role();
  if (['instalador', 'comparativas'].includes(r)) {
    $('main').innerHTML = `<div class="hello"><h1>Hola, ${esc(me.nombre.split(' ')[0])}</h1><p>Tu apartado (${r === 'instalador' ? 'instalaciones' : 'comparativas de luz y gas'}) llega en la próxima fase. Ya tienes tu usuario creado.</p></div>`; return;
  }
  const tasks = E.filter(needsMe).sort((a, b) => ST[a.etapa].k - ST[b.etapa].k || a.id - b.id);
  const corrs = myCorr(); const byId = Object.fromEntries(E.map(e => [e.id, e]));
  const corrHTML = corrs.map(c => `<button type="button" class="task" data-task="${c.expediente_id}" style="border-left-color:var(--bad)"><span class="t-a" style="color:var(--bad)">Corrección de ${esc(nm(c.actor))}</span><b>${esc(byId[c.expediente_id]?.cliente?.nombre || '#' + c.expediente_id)}</b><span class="hint">“${esc(c.comentario)}”</span></button>`).join('');
  const nTask = tasks.length + corrs.length;
  const it = menuItems(), nw = it.filter(x => x[4]), rest = it.filter(x => !x[4]);
  $('main').innerHTML = `<div class="hello"><h1>Hola, ${esc(me.nombre.split(' ')[0])}</h1><p>${nTask ? `Tienes ${nTask} cosa${nTask === 1 ? '' : 's'} por hacer.` : 'Lo tienes todo al día.'}</p></div>
  <div class="home">
   ${nw.map(([k, t, d]) => `<button type="button" class="mbtn new slim" data-go="${k}"><b>${t}</b><span class="d">${d}</span></button>`).join('')}
   <section><h2 class="h-sec">Lo que te toca</h2>${nTask ? `<div class="tasks">${corrHTML}${tasks.map(e => `<button type="button" class="task" data-task="${e.id}"><span class="t-a">${esc(taskLabel(e))}</span><b>${esc(e.cliente?.nombre)}</b><span class="hint">${esc(sumario(e))}${e.cliente?.pueblo ? ' · ' + esc(e.cliente.pueblo) : ''}</span></button>`).join('')}</div>` : `<div class="empty panel">No tienes nada pendiente. Cuando llegue algo nuevo aparecerá aquí al momento.</div>`}</section>
   <section><h2 class="h-sec">Más</h2><div class="more">${rest.map(([k, t, d, n]) => `<button type="button" class="mini" data-go="${k}"><b>${t}</b>${n ? `<span class="badge">${n}</span>` : ''}<span class="hint">${d}</span></button>`).join('')}</div></section>
  </div>`;
}

/* ---------- render principal ---------- */
async function render(showDetail, soft) {
  renderTop();
  if (!me) return;
  if (!view) return renderMenu();
  if (['exp', 'leads'].includes(view)) return renderGrid(showDetail, soft);
  ({ agenda: renderAgenda, act: renderAct, ventas: renderVentas, corr: renderCorr, equipo: renderEquipo, tarifas: renderTarifas })[view]();
}

/* ---------- lista + expediente ---------- */
function visibleList() { let l = E; if (view === 'leads') l = l.filter(e => ['lead', 'visita', 'descartado'].includes(e.etapa)); return l; }
function renderGrid(showDetail, soft) {
  const r = role(), all = visibleList();
  const pend = all.filter(needsMe).length, open = all.filter(isOpen).length;
  let l = filt === 'pend' ? all.filter(needsMe) : filt === 'open' ? all.filter(isOpen) : all;
  const title = view === 'leads' ? 'Leads' : r === 'comercial' ? 'Mis expedientes' : r === 'oficina' ? 'Bandeja' : 'Expedientes';
  const newBtn = r === 'comercial' ? `<button class="btn sun sm" data-go="new:ficha" type="button">+ Ficha</button>` : ['captacion', 'oficina'].includes(r) ? `<button class="btn sun sm" data-go="new:lead" type="button">+ Lead</button>` : '';
  const items = l.length ? l.map(e => { const s = ST[e.etapa]; return `<li><button type="button" class="item" data-id="${e.id}" aria-current="${e.id === sel && mode === 'view'}"><span class="nm">${esc(e.cliente?.nombre)}</span><span class="pill ${s.c}">${s.t}</span><span class="sub">${esc(sumario(e))}${e.cliente?.pueblo ? ' · ' + esc(e.cliente.pueblo) : ''}</span><span class="ref">#${e.id}</span></button></li>`; }).join('')
    : `<li class="empty">${filt === 'pend' ? 'No tienes nada pendiente.' : 'Todavía no hay expedientes.'}</li>`;
  const keepScroll = soft ? document.querySelector('.detail')?.scrollTop : 0;
  $('main').innerHTML = `<div class="grid ${mode !== 'view' || sel ? 'show-detail' : ''}" id="grid">
   <section class="list-col panel" aria-label="${title}"><div class="list-head"><h2>${title}</h2>${newBtn}</div>
    <div class="tabs"><button type="button" data-filt="pend" aria-pressed="${filt === 'pend'}">Me toca${pend ? ` <span class="badge">${pend}</span>` : ''}</button><button type="button" data-filt="open" aria-pressed="${filt === 'open'}">Abiertos (${open})</button><button type="button" data-filt="all" aria-pressed="${filt === 'all'}">Todos (${all.length})</button></div>
    <ul class="items">${items}</ul></section>
   <section class="detail-col panel" aria-live="polite"><div class="detail" id="detail"></div></section></div>`;
  if (showDetail) $('grid').classList.add('show-detail');
  renderDetail();
  if (soft && keepScroll) { const d = document.querySelector('.detail'); if (d) d.scrollTop = keepScroll; }
}
async function openExp(id, s) {
  sel = id; mode = 'view'; sub = s || 'res';
  if (!['exp', 'leads'].includes(view)) view = role() === 'captacion' ? 'leads' : 'exp';
  filt = 'all';
  await loadDetail(id);
  render(true); window.scrollTo({ top: 0 });
}
function person(id, r) { if (!id) return ''; return `<span class="person"><span class="av">${ini(id)}</span>${esc(nm(id))}<small>· ${r}</small></span>`; }
function stepsHTML(e) { const k = ST[e.etapa].k, idx = k === 9 ? -1 : Math.min(k, 6); return `<ol class="steps">${STEPS.map((s, i) => `<li class="${i < idx || e.etapa === 'aceptado' ? 'done' : i === idx ? 'now' : ''}">${s}</li>`).join('')}</ol>`; }
const opt = (a, v) => a.map(o => `<option ${o == v ? 'selected' : ''}>${o}</option>`).join('');
const comerciales = () => team.filter(p => p.rol === 'comercial' && p.activo);

function actionBox(e) { return corrRecibidas(e) + actionMain(e) + tacliaBox(e) + corrDireccion(e); }
const faltaTaclia = e => ['enviado', 'aceptado'].includes(e.etapa) && !e.presupuesto?.taclia;
function tacliaBox(e) {
  const pr = e.presupuesto || {};
  if (role() !== 'oficina') return '';
  if (pr.taclia) return '';
  if (!faltaTaclia(e)) return '';
  return `<div class="action"><h3>Último paso: pásalo a Taclia</h3><p>Copia los datos en Taclia. Lo que Taclia no deja poner va en observaciones.</p>
   <details><summary style="cursor:pointer;font-weight:600">Datos para Taclia (listos para copiar)</summary><div class="note" id="txtTaclia" style="margin-top:8px;max-height:260px;overflow:auto">${esc(datosTaclia(e))}</div><div class="row" style="margin-top:8px"><button class="btn sm" data-copy="txtTaclia" style="flex:0 0 auto">Copiar datos</button></div></details>
   <div class="row"><label class="fl">Nº que te da Taclia<input type="text" id="tacNum" placeholder="EE-2026-388"></label></div>
   <label class="fl">Observaciones puestas en Taclia<textarea id="tacObs">${esc(obsTaclia(e))}</textarea></label>
   <button class="btn primary" data-act="taclia">Marcar como pasado a Taclia</button></div>`;
}
function corrRecibidas(e) {
  const l = myCorr().filter(c => c.expediente_id === e.id);
  return l.map(c => `<div class="action" style="background:var(--bad-soft);border-color:color-mix(in srgb,var(--bad) 35%,transparent)"><h3>Corrección de ${esc(nm(c.actor))}</h3><p>“${esc(c.comentario)}” · ${fWhen(c.created_at)}</p><div class="row"><label class="fl">Qué has hecho (opcional)<input type="text" id="resNota-${c.id}"></label><button class="btn primary" data-act="resolver" data-cid="${c.id}" style="flex:0 0 auto">Marcar como hecha</button></div></div>`).join('');
}
function corrDireccion(e) {
  if (role() !== 'direccion') return '';
  const ppl = team.filter(p => p.activo && (['oficina', 'captacion'].includes(p.rol) || p.id === e.comercial || p.id === e.captador));
  return `<details class="action wait"><summary style="cursor:pointer;font-weight:600">Indicar una corrección a alguien del equipo</summary><div style="display:flex;flex-direction:column;gap:8px;margin-top:10px"><label class="fl">Para<select id="corPara">${ppl.map(p => `<option value="${p.id}" ${p.id === (e.etapa === 'visita' || e.etapa === 'enviado' ? e.comercial : '') ? 'selected' : ''}>${esc(p.nombre)} · ${ROLTXT[p.rol]}</option>`).join('')}</select></label><label class="fl">Qué tiene que corregir<textarea id="corTxt" placeholder="Ej.: falta la foto del contador"></textarea></label><p class="hint">Le aparece como tarea hasta que la marque como hecha. Queda en la trazabilidad.</p><button class="btn sm" data-act="corregir">Enviar corrección</button></div></details>`;
}
function actionMain(e) {
  const r = role(); const c = e.cliente || {};
  if (['captacion', 'oficina'].includes(r) && e.etapa === 'lead') return `<div class="action"><h3>Contactar y agendar visita</h3>
    <div class="quick">${['No contesta', 'Buzón', 'WhatsApp enviado', 'Habla con cliente'].map(t => `<button class="btn sm" data-act="contacto" data-t="${t}">${t}</button>`).join('')}</div>
    <label class="fl">Nota del contacto (opcional)<input type="text" id="segNota" placeholder="Ej.: casa en propiedad, quiere 8 placas"></label>
    <div class="row"><label class="fl">Comercial<select id="agCom">${comerciales().map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('') || '<option value="">No hay comerciales dados de alta</option>'}</select></label>
    <label class="fl">Día<input type="date" id="agDia" value="${today()}"></label><label class="fl">Hora<input type="time" id="agHora" value="10:00"></label></div>
    <label class="fl">Dirección de la visita<input type="text" id="agDir" value="${esc(c.calle || '')}" placeholder="Calle y número"></label>
    <div class="row"><button class="btn primary" data-act="agendar">Agendar visita</button><button class="btn ghost" data-act="descartar">Descartar lead</button></div></div>`;
  if (r === 'comercial' && e.comercial === me.id && e.etapa === 'visita') return `<div class="action"><h3>Visita ${fDate(e.visita_fecha)} · ${hhmm(e.visita_hora)}</h3><p>Al terminar, rellena la ficha. Le llega a oficina al momento.</p><button class="btn sun big" data-act="ficha">Rellenar ficha de visita</button></div>`;
  if (['captacion', 'oficina'].includes(r) && e.etapa === 'visita') return `<div class="action wait"><h3>Visita con ${esc(nm(e.comercial))}</h3><p>${fDate(e.visita_fecha)} a las ${hhmm(e.visita_hora)}. Para cambiarla, reprograma aquí.</p>
    <div class="row"><label class="fl">Día<input type="date" id="agDia" value="${e.visita_fecha || today()}"></label><label class="fl">Hora<input type="time" id="agHora" value="${hhmm(e.visita_hora) || '10:00'}"></label><label class="fl">Comercial<select id="agCom">${comerciales().map(p => `<option value="${p.id}" ${p.id === e.comercial ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label></div>
    <input type="hidden" id="agDir" value="${esc(c.calle || '')}"><div class="row"><button class="btn sm" data-act="agendar">Guardar cambio de visita</button><button class="btn ghost sm" data-act="descartar">Descartar</button></div></div>`;
  if (r === 'oficina' && e.etapa === 'solicitud') return `<div class="action"><h3>Ficha nueva de ${esc(nm(e.comercial))}</h3><p>Al aceptarla, el comercial ve que oficina ya la tiene.</p><button class="btn primary big" data-act="aceptar">Aceptar y empezar presupuesto</button></div>`;
  if (r === 'oficina' && ['preparacion', 'devuelta'].includes(e.etapa)) {
    const t = tarifaDe(e); const dev = [...detail.eventos].reverse().find(x => ['devuelto', 'cambios'].includes(x.tipo));
    const th = e.ficha?.fv ? (t.miss ? `<p class="hint">Sin tarifa exacta para <b>${esc(t.txt)}</b>. Precio a criterio; dirección lo validará.</p>` : `<p class="hint">Tarifa: <b>${t.label}</b>${t.tri ? ' · trifásica' : ''} → <b>${eur(t.precio)}</b> IVA incl.</p>`) : `<p class="hint">Sin tarifa cargada para esta instalación. Pon el precio a criterio.</p>`;
    const d = new Date(), num = e.presupuesto?.numero || `ECO-${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}-${e.id}`, prS = e.presupuesto?.propuesto ?? (t && !t.miss ? t.precio : '');
    return `<div class="action"><h3>${e.etapa === 'devuelta' ? 'Devuelta: corrige y vuelve a pasar' : 'Haz el presupuesto y pásalo a dirección'}</h3>
     <p>Con los datos de la ficha, hazlo con la IA en el formato de Ecomax y súbelo aquí (PDF o imagen). Taclia se rellena al final, cuando ya esté aprobado y enviado.</p>
     <details><summary style="cursor:pointer;font-weight:600">Datos para la IA (listos para copiar)</summary><div class="note" id="txtIA" style="margin-top:8px;max-height:260px;overflow:auto">${esc(datosIA(e, num, prS))}</div><div class="row" style="margin-top:8px"><button class="btn sm" data-copy="txtIA" style="flex:0 0 auto">Copiar datos</button></div></details>
     ${dev && e.etapa !== 'preparacion' || (dev && dev.tipo === 'cambios') ? `<p>“${esc(dev.comentario || '')}” — ${esc(nm(dev.actor))}</p>` : ''}${th}${e.ficha?.fv?.altSinBat ? `<p class="hint"><b>Ojo:</b> el comercial pide también una versión sin batería.</p>` : ''}
     <div class="row"><label class="fl">Nº de presupuesto<input type="text" id="presNum" value="${esc(num)}"></label>
     <label class="fl">Precio (IVA incl.)<input type="number" id="precioProp" step="50" value="${prS}"></label></div>
     <label class="fl">Presupuesto hecho (PDF o imagen)${e.presupuesto?.archivo ? ' · ya hay uno; sube otro solo si cambia' : ''}<input type="file" id="presFile" accept="application/pdf,image/*"></label>
     <button class="btn primary big" data-act="subir">Pasar a dirección para aprobar</button></div>`;
  }
  if (r === 'direccion' && e.etapa === 'aprobacion') {
    const t = tarifaDe(e), tp = t && !t.miss ? t.precio : null, pr = +e.presupuesto?.propuesto, diff = tp != null ? pr - tp : null;
    return `<div class="action"><h3>Revisa el presupuesto ${esc(e.presupuesto?.numero || '')} y da el visto bueno</h3>
     ${e.presupuesto?.archivo ? `<div class="row"><button class="btn primary sm" data-open-file="${esc(e.presupuesto.archivo)}" style="flex:0 0 auto">Ver el presupuesto</button></div>` : ''}
     <div class="cmp"><div><span class="tag">Tarifa</span><div class="v">${tp != null ? eur(tp) : '—'}</div><span class="hint">${t ? (t.miss ? 'Sin tarifa exacta' : esc(t.label)) : 'Sin tarifa'}</span></div>
     <div><span class="tag">Propone oficina</span><div class="v">${eur(pr)}</div><span class="hint">${diff ? `${diff > 0 ? '+' : ''}${eur(diff)} vs tarifa` : tp != null ? 'Igual que tarifa' : ''}</span></div>
     <div><span class="tag">Base para financiera</span><div class="v">${eur(pr / 1.21, 2)}</div><span class="hint">Sin IVA</span></div></div>
     <label class="fl">Precio final al cliente (IVA incl.)<input type="number" id="precioFin" step="50" value="${pr || ''}"></label>
     <label class="fl">Nota para oficina (opcional)<input type="text" id="notaAp" placeholder="Ej.: envíalo hoy mismo"></label>
     <p class="hint">Al dar el visto bueno, el presupuesto vuelve a oficina para que lo envíe al cliente.</p>
     <div class="row"><button class="btn sun big" data-act="aprobar">Dar el visto bueno</button></div>
     <details><summary style="cursor:pointer;font-size:13.5px;color:var(--muted)">Devolver a oficina con un comentario</summary><div style="display:flex;flex-direction:column;gap:8px;margin-top:8px"><textarea id="motivo" placeholder="Ej.: pon el inversor de 8 kW"></textarea><button class="btn sm" data-act="devolver">Devolver a oficina</button></div></details></div>`;
  }
  if (r === 'oficina' && e.etapa === 'aprobado') return `<div class="action"><h3>Visto bueno: ${eur(e.presupuesto?.final)} · envíalo al cliente</h3>
    ${(() => { const a = [...detail.eventos].reverse().find(x => x.tipo === 'aprobado'); return a?.comentario ? `<p>“${esc(a.comentario)}” — ${esc(nm(a.actor))}</p>` : ''; })()}
    ${e.presupuesto?.archivo ? `<div class="row"><button class="btn sm" data-open-file="${esc(e.presupuesto.archivo)}" style="flex:0 0 auto">Ver el presupuesto aprobado</button></div>` : ''}
    <div class="row"><label class="fl">Cómo lo has enviado<select id="envMedio"><option>Email</option><option>WhatsApp</option><option>En mano (comercial)</option><option>Correo postal</option></select></label><label class="fl">Nota (opcional)<input type="text" id="envNota" placeholder="Ej.: enviado a montse.ferrer@correo.es"></label></div>
    <button class="btn primary big" data-act="enviar">Marcar como enviado al cliente</button></div>`;
  if (((r === 'comercial' && e.comercial === me.id) || r === 'oficina') && e.etapa === 'enviado') return `<div class="action"><h3>Enviado al cliente: ${eur(e.presupuesto?.final)}</h3><p>Cuando el cliente conteste, marca aquí su respuesta.</p>
    ${e.presupuesto?.archivo ? `<div class="row"><button class="btn sm" data-open-file="${esc(e.presupuesto.archivo)}" style="flex:0 0 auto">Ver el presupuesto</button></div>` : ''}
    <div class="row"><label class="fl">Forma de pago<select id="pgForma"><option>Contado</option><option>Financiado</option><option>Mixto</option></select></label>
    <label class="fl">Plazo si financia<select id="pgPlazo"><option value="12">12 meses · 0%</option><option value="24">24 meses · 0% + 3,5%</option><option value="60">60 meses</option><option value="120" selected>120 meses</option></select></label></div>
    <label class="fl">Comentario (cambios o motivo)<input type="text" id="cliNota"></label>
    <div class="row"><button class="btn primary" data-act="acepta">Cliente acepta</button><button class="btn" data-act="cambios">Pide cambios</button><button class="btn ghost" data-act="rechaza">Rechaza</button></div></div>`;
  if (e.etapa === 'aceptado') return `<div class="action done"><h3>Venta cerrada · ${eur(e.presupuesto?.final)} · ${esc(e.pago?.forma || '')}</h3><p>Financiación, instalación y legalización se gestionarán aquí en la fase 2.</p></div>`;
  return `<div class="action wait"><h3>${ST[e.etapa].t}</h3><p>${({ lead: 'Captación está contactando.', visita: `Visita con ${esc(nm(e.comercial))} el ${fDate(e.visita_fecha)}.`, solicitud: 'Oficina aún no la ha abierto.', preparacion: 'Oficina está haciendo el presupuesto.', devuelta: 'Dirección pidió un cambio a oficina.', aprobacion: 'Falta el visto bueno de dirección.', aprobado: 'Visto bueno dado. Oficina lo enviará al cliente.', enviado: 'Esperando respuesta del cliente.', rechazado: 'Archivado con su historial.', descartado: 'Lead descartado.' })[e.etapa] || ''}</p></div>`;
}

const SUBS = [['res', 'Resumen'], ['traz', 'Trazabilidad'], ['ficha', 'Ficha de visita'], ['pres', 'Presupuesto'], ['docs', 'Documentos']];
function renderDetail() {
  const d = $('detail'); if (!d) return;
  if (mode === 'ficha') { d.innerHTML = fichaForm(); bindFicha(); return; }
  if (mode === 'lead') { d.innerHTML = leadForm(); bindLead(); return; }
  const e = E.find(x => x.id === sel);
  if (!e) { d.innerHTML = `<div class="empty">Elige un expediente de la lista.</div>`; return; }
  if (detail.id !== e.id) { d.innerHTML = `<div class="empty">Cargando…</div>`; loadDetail(e.id).then(renderDetail); return; }
  const s = ST[e.etapa], c = e.cliente || {};
  const body = { res: tabRes, traz: tabTraz, ficha: tabFicha, pres: tabPres, docs: tabDocs }[sub](e);
  d.innerHTML = `<button class="btn ghost sm back" data-act="back">← Volver</button>
  <div class="d-head"><h1>${esc(c.nombre)}</h1><span class="pill ${s.c}">${s.t}</span></div>
  <p class="d-meta"><span class="ref">#${e.id}</span><span>${esc([c.calle, c.pueblo].filter(Boolean).join(', '))}</span><span>${esc(c.tel || '')}</span>${e.comercial ? `<span>Comercial: ${esc(nm(e.comercial))}</span>` : ''}</p>
  ${stepsHTML(e)}${actionBox(e)}
  <div class="subtabs" role="tablist">${SUBS.map(([k, t]) => `<button type="button" role="tab" data-sub="${k}" aria-pressed="${sub === k}">${t}</button>`).join('')}</div><div>${body}</div>`;
}
function tabRes(e) {
  const c = e.cliente || {}; const canRe = ['captacion', 'oficina', 'direccion'].includes(role()) && e.comercial && isOpen(e);
  const contactos = detail.eventos.filter(x => x.tipo === 'contacto');
  return `<div class="sec"><h4>Cliente</h4><dl class="kv"><div><dt>Teléfono</dt><dd>${esc(c.tel || '—')}</dd></div><div><dt>Email</dt><dd>${esc(c.email || '—')}</dd></div><div><dt>Dirección</dt><dd>${esc(c.calle || '—')}</dd></div><div><dt>Población</dt><dd>${esc(c.pueblo || '—')}</dd></div><div><dt>Comarca</dt><dd>${esc(c.comarca || '—')}</dd></div><div><dt>Origen</dt><dd>${esc(e.origen || '—')}</dd></div></dl></div>
  <div class="sec"><h4>Qué quiere</h4><dl class="kv"><div><dt>Interés</dt><dd>${esc(sumario(e) || '—')}</dd></div>${e.visita_fecha ? `<div><dt>Visita</dt><dd>${fDate(e.visita_fecha)} · ${hhmm(e.visita_hora)}</dd></div>` : ''}${e.visita_km ? `<div><dt>Km</dt><dd>${e.visita_km}</dd></div>` : ''}${e.ficha?.finQuiere ? `<div><dt>¿Financiar?</dt><dd>${esc(e.ficha.finQuiere)}</dd></div>` : ''}${e.presupuesto?.final ? `<div><dt>Precio aprobado</dt><dd>${eur(e.presupuesto.final)}</dd></div>` : ''}${e.pago ? `<div><dt>Pago</dt><dd>${esc(e.pago.forma)}${e.pago.plazo ? ` · ${e.pago.plazo} m` : ''}</dd></div>` : ''}</dl></div>
  ${contactos.length ? `<div class="sec"><h4>Contactos de captación</h4><ol class="tl">${contactos.map(x => `<li><span class="t">${fWhen(x.created_at)} · ${esc(nm(x.actor))}</span><br><b>${esc(x.detalle.replace(/^Contacto:\s*/, ''))}</b>${x.comentario ? `<span class="c">${esc(x.comentario)}</span>` : ''}</li>`).join('')}</ol></div>` : ''}
  <div class="sec"><h4>Responsables</h4><div class="people">${person(e.captador, 'captación')}${person(e.comercial, 'comercial')}</div>
  ${canRe ? `<div class="row" style="margin-top:10px"><label class="fl">Cambiar comercial<select id="reCom">${comerciales().map(p => `<option value="${p.id}" ${p.id === e.comercial ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label><label class="fl">Motivo<input type="text" id="reMot" placeholder="Queda registrado"></label><button class="btn sm" data-act="reasignar" style="flex:0 0 auto">Cambiar</button></div>` : ''}</div>`;
}
function tabTraz(e) {
  const ev = detail.eventos;
  const fst = t => ev.find(x => x.tipo === t), lst = t => [...ev].reverse().find(x => x.tipo === t);
  const S = [];
  const L = fst('lead'); S.push({ rol: 'captacion', who: e.captador, what: L ? `Trajo el lead (${e.origen || '—'})` : e.origen === 'Visita sin cita' ? 'Visita sin cita: sin captación' : 'Sin captación', w: L?.created_at, done: !!e.captador });
  const V = lst('visita'); if (V) S.push({ rol: 'captacion', who: V.actor, what: V.detalle, w: V.created_at, done: true });
  const F = lst('ficha'); S.push({ rol: 'comercial', who: e.comercial, what: F ? 'Hizo la visita y envió la ficha' : 'Visita pendiente', w: F?.created_at, done: !!F });
  const A = lst('aceptada'); if (A) S.push({ rol: 'oficina', who: A.actor, what: 'Aceptó la ficha', w: A.created_at, done: true });
  const Pz = lst('presupuesto'); S.push({ rol: 'oficina', who: Pz?.actor || null, what: Pz ? Pz.detalle : 'Presupuesto pendiente', w: Pz?.created_at, done: !!Pz });
  const Ap = lst('aprobado'); S.push({ rol: 'direccion', who: Ap?.actor || null, what: Ap ? Ap.detalle : 'Visto bueno pendiente', w: Ap?.created_at, done: !!Ap });
  const En = lst('enviado'); S.push({ rol: 'oficina', who: En?.actor || null, what: En ? En.detalle : 'Envío al cliente pendiente', w: En?.created_at, done: !!En });
  const Tc = lst('taclia');
  const Vt = lst('venta'), Rc = lst('rechazo'); S.push({ rol: 'comercial', who: (Vt || Rc)?.actor || e.comercial, what: Vt ? `Marcó la venta: el cliente acepta · ${e.pago?.forma || ''}` : Rc ? 'Marcó que el cliente rechaza' : 'Esperando respuesta del cliente', w: (Vt || Rc)?.created_at, done: !!Vt, bad: !!Rc });
  if (En) S.push({ rol: 'oficina', who: Tc?.actor || null, what: Tc ? Tc.detalle : 'Pendiente de pasar a Taclia', w: Tc?.created_at, done: !!Tc });
  const chain = `<ol class="chain">${S.map(s => `<li class="${s.done ? 'ok' : s.bad ? 'bad' : 'pend'}"><span class="av">${s.who ? ini(s.who) : '?'}</span><div><span class="tag">${ROLTXT[(s.who && P(s.who)?.rol) || s.rol]}</span><b>${s.who ? esc(nm(s.who)) : 'Sin asignar'}</b><span class="what">${esc(s.what)}</span></div><span class="when">${s.w ? fWhen(s.w) : s.done ? '' : '—'}</span></li>`).join('')}</ol>`;
  return `<p class="hint" style="margin:0 0 12px">Se registra en el servidor: cada paso guarda quién lo hizo y cuándo. Nadie puede editarlo ni borrarlo, tampoco el administrador.</p>${chain}
  ${(() => { const cs = CORR.filter(c => c.expediente_id === e.id); return cs.length ? `<div class="sec"><h4>Correcciones de dirección (${cs.length})</h4><ol class="tl">${cs.map(c => `<li><span class="t">${fWhen(c.created_at)} · ${esc(nm(c.actor))} → ${esc(nm(c.para))}</span><br>“${esc(c.comentario)}” <span class="pill ${c.done ? 'p-ok' : 'p-bad'}">${c.done ? 'Hecha ' + fWhen(c.done.created_at) : 'Pendiente'}</span>${c.done?.comentario ? `<span class="c">${esc(c.done.comentario)}</span>` : ''}</li>`).join('')}</ol></div>` : ''; })()}
  <div class="sec"><h4>Registro completo (${ev.length})</h4><ol class="tl">${ev.map(x => `<li><span class="t">${fWhen(x.created_at)} · ${esc(nm(x.actor))}</span><br>${esc(x.detalle)}${x.comentario ? `<span class="c">“${esc(x.comentario)}”</span>` : ''}</li>`).join('')}</ol></div>`;
}
function tabFicha(e) {
  const f = e.ficha?.fv, a = e.ficha?.aero, n = e.ficha?.notas;
  if (!f && !a) return `<div class="empty">Aún no hay ficha. ${e.comercial ? esc(nm(e.comercial)) : 'El comercial'} la rellena al terminar la visita.</div>`;
  const kv = (l, v) => `<div><dt>${l}</dt><dd>${esc(v ?? '—')}</dd></div>`;
  return `${f ? `<div class="sec"><h4>Placas solares</h4><dl class="kv">${kv('Nº de placas', `${f.placas} × ${f.potPlaca} W`)}${kv('Potencia', `${((f.placas * f.potPlaca) / 1000).toLocaleString('es-ES')} kWp`)}${kv('Inversor', `${f.invN} × ${f.invKW} kW híbrido`)}${kv('Batería', +f.batN ? `${f.batN} × ${f.batKWh} kWh` : 'No')}${kv('Instalación eléctrica', f.instalacion)}${kv('Cubierta', f.cubierta)}${kv('Solar Bloc', f.solarBloc)}${kv('Grúa', f.grua)}${kv('CEE 1 (antes)', f.cee1)}${kv('CEE 2 (después)', f.cee2)}${kv('Cuadro → inversor', f.distInv + ' m')}${kv('Cuadro → batería', f.distBat + ' m')}${kv('Cargador coche', f.cargador)}${f.consumo ? kv('Consumo anual', f.consumo + ' kWh') : ''}${f.altSinBat ? kv('Alternativa', 'También sin batería') : ''}</dl></div>` : ''}
  ${a ? `<div class="sec"><h4>Aerotermia</h4><dl class="kv">${kv('Superficie', a.m2 + ' m²')}${kv('Plantas', a.plantas)}${kv('Personas', a.personas)}${kv('Habitaciones', a.habit)}${kv('Combustible actual', a.combustible)}${kv('Consumo anual', a.consumo || '—')}${kv('Emisores', a.emisores + (a.radMat ? ' · ' + a.radMat : ''))}${kv('Nº radiadores', a.radN || '—')}${kv('Circuito', a.circuito)}${kv('Máq. ext. → inercia', a.distExt + ' m')}${kv('Depósito ACS', (a.ubiACS || '—') + (a.acsL ? ' · ' + a.acsL + ' L' : ''))}${kv('Depósito inercia', a.ubiInercia || '—')}${kv('Máquina exterior', a.ubiExt || '—')}${kv('Mejoras térmicas', a.mejoras)}${kv('Año construcción', a.anyo || '—')}${kv('Hibridar', a.hibridar + (a.hibSist ? ' · ' + a.hibSist : ''))}</dl></div>` : ''}
  ${n ? `<div class="sec"><h4>Observaciones</h4><div class="note">${esc(n)}</div></div>` : ''}`;
}
function tabPres(e) {
  const t = tarifaDe(e), pr = e.presupuesto || {};
  const Pp = pr.final || pr.propuesto || (t && !t.miss ? t.precio : null);
  return `<div class="sec"><h4>Tarifa aplicable</h4><div class="note">${e.ficha?.fv ? (t.miss ? `Sin tarifa exacta para ${esc(t.txt)}.` : `${t.label}${t.tri ? ' · trifásica' : ' · monofásica'} → ${eur(t.precio)} IVA incluido (${eur(t.precio / 1.21, 2)} sin IVA)`) : 'Sin tarifa para esta instalación.'}</div></div>
  ${pr.numero ? `<div class="sec"><h4>Presupuesto</h4><div class="files"><div class="file"><span class="ico">PDF</span><div><div class="fn">${esc(pr.numero)}</div><div class="hint">Propuesto ${eur(pr.propuesto)}${pr.final ? ` · visto bueno ${eur(pr.final)}` : ''}${pr.medio ? ` · enviado por ${esc(pr.medio)}` : ''}</div></div>${pr.archivo ? `<button class="btn sm" data-open-file="${esc(pr.archivo)}">Abrir</button>` : ''}</div></div></div>` : `<div class="sec"><div class="empty">Oficina sube aquí el presupuesto cuando esté hecho.</div></div>`}
  ${pr.taclia ? `<div class="sec"><h4>Taclia</h4><dl class="kv"><div><dt>Nº en Taclia</dt><dd>${esc(pr.taclia)}</dd></div><div><dt>Pasado el</dt><dd>${fWhen(pr.taclia_en)}</dd></div></dl>${pr.taclia_obs ? `<div class="note" style="margin-top:8px">Observaciones: ${esc(pr.taclia_obs)}</div>` : ''}</div>` : (pr.final ? `<div class="sec"><h4>Taclia</h4><div class="note">Pendiente de pasar a Taclia${['enviado', 'aceptado'].includes(e.etapa) ? '' : ' (se hace después de enviarlo al cliente)'}.</div></div>` : '')}
  ${Pp ? `<div class="sec"><h4>Cuotas orientativas</h4><dl class="kv"><div><dt>12 meses · 0%</dt><dd>${eur(cuota(Pp, 12), 2)}/mes</dd></div><div><dt>24 meses · 0% + 3,5%</dt><dd>${eur(cuota(Pp, 24), 2)}/mes</dd></div><div><dt>60 meses · 6,25%</dt><dd>${eur(cuota(Pp, 60), 2)}/mes</dd></div><div><dt>120 meses · 6,25%</dt><dd>${eur(cuota(Pp, 120), 2)}/mes</dd></div></dl><p class="hint" style="margin-top:6px">Simulación no contractual.</p></div>` : ''}
`;
}
function tabDocs(e) {
  const A = detail.archivos;
  return `<div class="sec"><h4>Subir</h4><div class="row"><label class="fl">Fotos<input type="file" id="upFotos" accept="image/*" multiple></label><label class="fl">Documento (PDF)<input type="file" id="upDoc" accept="application/pdf,image/*"></label><button class="btn sm" data-act="subirDocs" style="flex:0 0 auto">Subir</button></div><p class="hint">Lo que se sube queda guardado y no se puede borrar.</p></div>
  <div class="sec"><h4>Archivos (${A.length})</h4>${A.length ? `<div class="files">${A.map(f => `<div class="file"><span class="ico ${f.tipo === 'foto' ? 'img' : ''}">${f.tipo === 'foto' ? 'IMG' : 'PDF'}</span><div><div class="fn">${esc(f.nombre)}</div><div class="hint">${fWhen(f.created_at)} · ${esc(nm(f.subido_por))}</div></div><button class="btn sm" data-open-file="${esc(f.path)}">Abrir</button></div>`).join('')}</div>` : `<div class="empty">Todavía no hay archivos.</div>`}</div>`;
}

/* ---------- formularios ---------- */
function leadForm() {
  return `<button class="btn ghost sm back" data-act="back">← Volver</button><div class="d-head"><h1>Nuevo lead</h1></div><p class="d-meta">Llamada, formulario web, WhatsApp o feria.</p>
  <form class="f" id="fLead" novalidate><fieldset><legend>Contacto</legend>
   <label class="fl">Nombre *<input type="text" id="lNom"></label><label class="fl">Teléfono *<input type="tel" id="lTel"></label><label class="fl">Email<input type="email" id="lMail"></label>
   <label class="fl">Población<input type="text" id="lPob"></label><label class="fl">Comarca<input type="text" id="lCom"></label>
   <label class="fl">Origen<select id="lOr">${opt(['Formulario web', 'Teléfono', 'WhatsApp', 'Recomendación', 'Feria', 'Redes sociales'], 'Teléfono')}</select></label>
   <div class="chips"><label><input type="checkbox" id="lFv" checked> Placas</label><label><input type="checkbox" id="lBat"> Batería</label><label><input type="checkbox" id="lAe"> Aerotermia</label><label><input type="checkbox" id="lCar"> Cargador coche</label></div>
   <label class="fl wide">Nota<textarea id="lNota"></textarea></label></fieldset>
   <span class="err hide" id="errL"></span><button class="btn sun big" type="submit">Guardar lead</button></form>`;
}
function bindLead() {
  $('fLead').addEventListener('submit', async ev => {
    ev.preventDefault(); const v = id => $(id).value.trim(), c = id => $(id).checked, b = ev.submitter;
    const int = [c('lFv') && 'Placas', c('lBat') && 'batería', c('lAe') && 'aerotermia', c('lCar') && 'cargador coche'].filter(Boolean).join(' + ');
    busy(b, true);
    try {
      const id = await rpc('crear_lead', { p_cliente: { nombre: v('lNom'), tel: v('lTel'), email: v('lMail'), pueblo: v('lPob'), comarca: v('lCom') }, p_origen: v('lOr'), p_interes: int, p_tipos: c('lAe') && !c('lFv') ? ['aero'] : ['fv'], p_nota: v('lNota') });
      await loadAll(); toast('Lead guardado.'); await openExp(id);
    } catch (e) { busy(b, false); $('errL').textContent = errMsg(e); $('errL').classList.remove('hide'); }
  });
}
function fichaForm() {
  const e = E.find(x => x.id === sel && x.etapa === 'visita'), c = e?.cliente || {};
  const aero = e && (e.tipos || []).includes('aero') && !(e.tipos || []).includes('fv');
  return `<button class="btn ghost sm back" data-act="back">← Volver</button><div class="d-head"><h1>Ficha de visita</h1></div>
  <p class="d-meta">${e ? `Visita de ${fDate(e.visita_fecha)} · ${hhmm(e.visita_hora)}. Los datos del cliente vienen de captación.` : 'Visita sin cita previa.'} Los campos con * son obligatorios.</p>
  <form class="f" id="fFicha" novalidate>
   <fieldset><legend>Cliente</legend><label class="fl">Nombre *<input type="text" id="cNom" value="${esc(c.nombre || '')}"></label><label class="fl">Móvil *<input type="tel" id="cTel" value="${esc(c.tel || '')}"></label><label class="fl">Email<input type="email" id="cMail" value="${esc(c.email || '')}"></label><label class="fl">Calle *<input type="text" id="cCalle" value="${esc(c.calle || '')}"></label><label class="fl">Pueblo *<input type="text" id="cPueblo" value="${esc(c.pueblo || '')}"></label></fieldset>
   <fieldset><legend>Qué quiere</legend><div class="chips"><label><input type="checkbox" id="tFv" ${aero ? '' : 'checked'}> Placas solares</label><label><input type="checkbox" id="tAe" ${aero ? 'checked' : ''}> Aerotermia</label></div></fieldset>
   <fieldset id="fsFv" class="${aero ? 'hide' : ''}"><legend>Placas solares</legend>
    <label class="fl">Número de placas<input type="number" id="fvPl" min="1" value="12"></label><label class="fl">Potencia placa (W)<select id="fvW">${opt(['505', '510', '515', '540'], '540')}</select></label>
    <label class="fl">Inversor híbrido (kW)<select id="fvInv">${opt(['5', '6', '8', '10'], '6')}</select></label><label class="fl">Nº de inversores<input type="number" id="fvInvN" min="1" value="1"></label>
    <label class="fl">Nº de baterías<input type="number" id="fvBatN" min="0" value="1"></label><label class="fl">kWh por batería<select id="fvBatK">${opt(['5', '16'], '16')}</select></label>
    <label class="fl">Instalación eléctrica<select id="fvInst">${opt(['Monofásica', 'Trifásica'], 'Monofásica')}</select></label><label class="fl">Cubierta<select id="fvCub">${opt(['Teja árabe', 'Teja plana', 'Plana transitable', 'Chapa sándwich', 'Fibrocemento', 'Suelo'], 'Teja árabe')}</select></label>
    <label class="fl">Solar Bloc<select id="fvSB">${opt(['No', 'Sí'], 'No')}</select></label><label class="fl">Grúa<select id="fvGr">${opt(['No', 'Sí'], 'No')}</select></label>
    <label class="fl">CEE 1 (antes)<select id="fvC1">${opt(['Sí', 'No'], 'Sí')}</select></label><label class="fl">CEE 2 (después)<select id="fvC2">${opt(['Sí', 'No'], 'Sí')}</select></label>
    <label class="fl">Cuadro → inversor (m)<input type="number" id="fvDI" min="0" value="5"></label><label class="fl">Cuadro → batería (m)<input type="number" id="fvDB" min="0" value="5"></label>
    <label class="fl">Cargador coche<select id="fvCar">${opt(['No', 'Sí, 8,5 kW'], (e?.interes || '').includes('cargador') ? 'Sí, 8,5 kW' : 'No')}</select></label><label class="fl">Consumo anual (kWh)<input type="text" id="fvCons" inputmode="numeric"></label>
    <div class="chips"><label><input type="checkbox" id="fvAlt"> Preparar también versión sin batería</label></div></fieldset>
   <fieldset id="fsAe" class="${aero ? '' : 'hide'}"><legend>Aerotermia</legend>
    <label class="fl">Superficie calefactable (m²)<input type="number" id="aeM"></label><label class="fl">Plantas<input type="number" id="aePl"></label><label class="fl">Personas<input type="number" id="aeP"></label><label class="fl">Habitaciones<input type="number" id="aeH"></label>
    <label class="fl">Combustible actual<select id="aeComb">${opt(['Gas natural', 'Gasoil', 'Propano', 'Eléctrico', 'Leña / pellet'], 'Gas natural')}</select></label><label class="fl">Consumo anual<input type="text" id="aeCons" placeholder="Litros o kWh"></label>
    <label class="fl">Emisores<select id="aeEm">${opt(['Radiadores', 'Suelo radiante', 'Fancoils'], 'Radiadores')}</select></label><label class="fl">Material radiadores<select id="aeRM">${opt(['Aluminio', 'Hierro fundido', 'Acero'], 'Aluminio')}</select></label>
    <label class="fl">Nº radiadores<input type="number" id="aeRN"></label><label class="fl">Circuito<select id="aeCir">${opt(['Bitubo', 'Monotubo'], 'Bitubo')}</select></label><label class="fl">Máq. exterior → inercia (m)<input type="number" id="aeD"></label>
    <label class="fl">Ubicación depósito ACS<input type="text" id="aeUA"></label><label class="fl">Capacidad ACS (L)<input type="number" id="aeAL"></label><label class="fl">Ubicación depósito inercia<input type="text" id="aeUI"></label><label class="fl">Ubicación máquina exterior<input type="text" id="aeUE"></label>
    <label class="fl">Mejoras térmicas<select id="aeMej">${opt(['No', 'Ventanas', 'Aislamiento', 'Ambas'], 'No')}</select></label><label class="fl">Año construcción<input type="number" id="aeAn"></label>
    <label class="fl">¿Hibridar?<select id="aeHib">${opt(['No', 'Sí'], 'No')}</select></label><label class="fl">Con qué sistema<input type="text" id="aeHS"></label></fieldset>
   <fieldset><legend>Fotos y observaciones</legend><label class="fl wide">Fotos (cubierta, cuadro, contador, factura…)<input type="file" id="fotos" accept="image/*" multiple></label>
    <label class="fl">¿Quiere financiar?<select id="finQ">${opt(['No lo sabe', 'Sí', 'No'], 'No lo sabe')}</select></label><label class="fl">Km de la visita<input type="number" id="kmIn" value="${e?.visita_km ?? ''}"></label>
    <label class="fl wide">Observaciones<textarea id="notas"></textarea></label></fieldset>
   <p class="hint">Se envía a <b>oficina</b> para hacer el presupuesto. El visto bueno final lo da <b>dirección</b>.</p>
   <span class="err hide" id="errF"></span><button class="btn sun big" type="submit">Enviar ficha a oficina</button></form>`;
}
function bindFicha() {
  const tF = $('tFv'), tA = $('tAe'); const sync = () => { $('fsFv').classList.toggle('hide', !tF.checked); $('fsAe').classList.toggle('hide', !tA.checked); };
  tF.onchange = sync; tA.onchange = sync;
  $('fFicha').addEventListener('submit', async ev => {
    ev.preventDefault(); const v = id => $(id).value.trim(), b = ev.submitter;
    if (!tF.checked && !tA.checked) { tF.checked = true; sync(); }
    const n = id => v(id) === '' ? null : +v(id);
    const ficha = {
      fv: tF.checked ? { placas: n('fvPl'), potPlaca: n('fvW'), invKW: n('fvInv'), invN: n('fvInvN'), batN: n('fvBatN'), batKWh: n('fvBatK'), instalacion: v('fvInst'), cubierta: v('fvCub'), solarBloc: v('fvSB'), grua: v('fvGr'), cee1: v('fvC1'), cee2: v('fvC2'), distInv: n('fvDI'), distBat: n('fvDB'), cargador: v('fvCar'), consumo: v('fvCons'), altSinBat: $('fvAlt').checked } : null,
      aero: tA.checked ? { m2: n('aeM'), plantas: n('aePl'), personas: n('aeP'), habit: n('aeH'), combustible: v('aeComb'), consumo: v('aeCons'), emisores: v('aeEm'), radMat: v('aeEm') === 'Radiadores' ? v('aeRM') : '', radN: n('aeRN'), circuito: v('aeCir'), distExt: n('aeD'), ubiACS: v('aeUA'), acsL: n('aeAL'), ubiInercia: v('aeUI'), ubiExt: v('aeUE'), mejoras: v('aeMej'), anyo: n('aeAn'), hibridar: v('aeHib'), hibSist: v('aeHS') } : null,
      notas: v('notas'), finQuiere: v('finQ'),
    };
    const fotos = [...$('fotos').files];
    busy(b, true);
    try {
      const prev = E.find(x => x.id === sel && x.etapa === 'visita');
      const id = await rpc('enviar_ficha', { p_exp: prev ? prev.id : null, p_cliente: { nombre: v('cNom'), tel: v('cTel'), email: v('cMail'), calle: v('cCalle'), pueblo: v('cPueblo') }, p_tipos: [tF.checked && 'fv', tA.checked && 'aero'].filter(Boolean), p_ficha: ficha, p_km: n('kmIn') });
      if (fotos.length) { b.textContent = `Subiendo fotos (0/${fotos.length})…`; let i = 0; for (const f of fotos) { await uploadFile(id, f, 'foto'); b.textContent = `Subiendo fotos (${++i}/${fotos.length})…`; } }
      await loadAll(); toast('Ficha enviada. Oficina la tiene ya.'); view = 'exp'; await openExp(id, 'ficha');
    } catch (e) { busy(b, false); $('errF').textContent = errMsg(e); $('errF').classList.remove('hide'); }
  });
}

/* ---------- archivos ---------- */
async function compress(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/heic') return file;
  try {
    const bmp = await createImageBitmap(file); const max = 1600, r = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.82)); return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch (e) { return file; }
}
async function uploadFile(expId, file, tipo) {
  const f = await compress(file);
  const safe = f.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_').slice(-60);
  const path = `${me.empresa_id}/${expId}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${safe}`;
  const { error } = await sb.storage.from('docs').upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
  if (error) throw error;
  await rpc('registrar_archivo', { p_exp: expId, p_tipo: tipo, p_nombre: file.name, p_path: path });
  return path;
}
async function openFile(path) {
  const w = window.open('', '_blank');
  const { data, error } = await sb.storage.from('docs').createSignedUrl(path, 600);
  if (error) { w?.close(); return toast('No se ha podido abrir el archivo.'); }
  if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
}

/* ---------- acciones ---------- */
async function act(a, el) {
  const e = E.find(x => x.id === sel); const v = id => $(id)?.value.trim();
  if (a === 'back') { mode = 'view'; if (window.innerWidth <= 860) sel = null; return render(); }
  if (a === 'propuesta') return openProp(e);
  if (a === 'closeModal') { $('modalSlot').innerHTML = ''; return; }
  if (a === 'ficha') { mode = 'ficha'; return render(true); }
  if (!e) return;
  busy(el, true);
  try {
    switch (a) {
      case 'contacto': await rpc('registrar_contacto', { p_exp: e.id, p_tipo: el.dataset.t, p_nota: v('segNota') }); toast(`Registrado: ${el.dataset.t}`); break;
      case 'agendar': await rpc('agendar_visita', { p_exp: e.id, p_comercial: v('agCom') || null, p_fecha: v('agDia') || null, p_hora: v('agHora') || null, p_calle: v('agDir') }); toast(`Visita guardada. ${nm(v('agCom'))} la tiene en su agenda.`); break;
      case 'descartar': await rpc('descartar_lead', { p_exp: e.id, p_motivo: v('segNota') }); toast('Lead descartado.'); break;
      case 'aceptar': await rpc('aceptar_ficha', { p_exp: e.id }); toast('Aceptada. El comercial lo ve.'); break;
      case 'subir': {
        const f = $('presFile').files[0]; let path = null;
        if (!f && !e.presupuesto?.archivo) throw new Error('Falta adjuntar el presupuesto (PDF o imagen)');
        if (!v('presNum')) throw new Error('Falta el número de presupuesto');
        if (!(+v('precioProp') > 0)) throw new Error('Falta el precio');
        if (f) { el.textContent = 'Subiendo presupuesto…'; path = await uploadFile(e.id, f, 'presupuesto'); }
        await rpc('preparar_presupuesto', { p_exp: e.id, p_numero: v('presNum'), p_precio: +v('precioProp'), p_archivo: path });
        toast('Pasado a dirección para el visto bueno.'); break;
      }
      case 'taclia': await rpc('pasar_a_taclia', { p_exp: e.id, p_numero_taclia: v('tacNum'), p_observaciones: v('tacObs') }); toast('Marcado como pasado a Taclia. Expediente completo.'); break;
      case 'aprobar': await rpc('aprobar_presupuesto', { p_exp: e.id, p_precio: +v('precioFin') || null, p_nota: v('notaAp') }); toast('Visto bueno dado. Oficina lo enviará al cliente.'); break;
      case 'enviar': await rpc('enviar_al_cliente', { p_exp: e.id, p_medio: v('envMedio'), p_nota: v('envNota') }); toast('Marcado como enviado. El comercial lo ve.'); break;
      case 'corregir': await rpc('indicar_correccion', { p_exp: e.id, p_para: v('corPara'), p_texto: v('corTxt') }); toast(`Corrección enviada a ${nm(v('corPara'))}.`); break;
      case 'resolver': await rpc('resolver_correccion', { p_evento: +el.dataset.cid, p_nota: v('resNota-' + el.dataset.cid) }); toast('Corrección marcada como hecha. Dirección lo ve.'); break;
      case 'devolver': await rpc('devolver_presupuesto', { p_exp: e.id, p_motivo: v('motivo') }); toast('Devuelto a oficina.'); break;
      case 'acepta': await rpc('respuesta_cliente', { p_exp: e.id, p_resultado: 'acepta', p_forma: v('pgForma'), p_plazo: +v('pgPlazo'), p_nota: v('cliNota') }); toast('¡Venta cerrada!'); break;
      case 'cambios': await rpc('respuesta_cliente', { p_exp: e.id, p_resultado: 'cambios', p_nota: v('cliNota') }); toast('Vuelve a oficina con el cambio.'); break;
      case 'rechaza': await rpc('respuesta_cliente', { p_exp: e.id, p_resultado: 'rechaza', p_nota: v('cliNota') }); toast('Marcado como rechazado.'); break;
      case 'reasignar': await rpc('reasignar_comercial', { p_exp: e.id, p_comercial: v('reCom'), p_motivo: v('reMot') }); toast('Comercial cambiado. Queda registrado.'); break;
      case 'subirDocs': {
        const fs = [...$('upFotos').files], d = $('upDoc').files[0];
        if (!fs.length && !d) throw new Error('Elige alguna foto o documento');
        let i = 0; for (const f of fs) { el.textContent = `Subiendo ${++i}/${fs.length + (d ? 1 : 0)}…`; await uploadFile(e.id, f, 'foto'); }
        if (d) await uploadFile(e.id, d, d.type.startsWith('image/') ? 'foto' : 'documento');
        toast('Subido.'); break;
      }
    }
    await loadAll(); await loadDetail(e.id); render();
  } catch (err) { busy(el, false); toast(errMsg(err), 5000); }
}

/* ---------- propuesta para el cliente ---------- */
function openProp(e) {
  if (!e) return; const f = e.ficha?.fv, a = e.ficha?.aero, Pr = +e.presupuesto?.final, bat = f ? (+f.batN) * (+f.batKWh) : 0, c = e.cliente || {};
  const eq = [];
  if (f) { eq.push([`${f.placas} paneles solares`, `${f.potPlaca} W`, 'Alta eficiencia']); eq.push([`${f.invN} inversor`, `${f.invKW} kW híbrido`, f.instalacion]); if (bat) eq.push([`${f.batN} batería${f.batN > 1 ? 's' : ''}`, `${f.batKWh} kWh`, 'LiFePO4']); if (f.cargador && f.cargador !== 'No') eq.push(['1 cargador coche', '8,5 kW · Modo 3', '']); }
  if (a) eq.push(['Aerotermia', `Para ${a.m2 || '?'} m²`, a.hibridar === 'Sí' ? 'Hibridada' : 'Aire-agua']);
  const spec = f ? [['Paneles solares', `${f.placas} × ${f.potPlaca} W (${((f.placas * f.potPlaca) / 1000).toLocaleString('es-ES')} kWp)`], ['Inversor', `${f.invKW} kW ${String(f.instalacion).toLowerCase()}`], ...(bat ? [['Batería', `${bat} kWh (LiFePO4)`]] : []), ...(f.cargador && f.cargador !== 'No' ? [['Cargador coche', '8,5 kW (Modo 3)']] : []), ['Estructura y pequeño material', 'Incluidos'], ['Cableado y protecciones', 'Incluidos'], ['Instalación y puesta en marcha', 'Incluida'], ['Legalizaciones', 'Incluidas en el precio'], ['Certificados', 'Incluidos en el precio'], ['Monitorización', 'Incluida']] : [['Equipo', 'Aerotermia según presupuesto'], ['Instalación y puesta en marcha', 'Incluida'], ['Legalizaciones', 'Incluidas']];
  $('modalSlot').innerHTML = `<div class="modal" role="dialog" aria-label="Propuesta" data-act="closeModal"><div class="modal-bar"><span>Propuesta para el cliente</span><button class="btn sm" data-act="closeModal">Cerrar</button></div>
  <article class="doc"><div class="doc-top"><img src="icons/logo.png" alt="Ecomax Energía"><div class="tt"><b>PRESUPUESTO</b><span>Instalación ${f ? 'solar' + (bat ? ' con batería' : '') : ''}${f && a ? ' y ' : ''}${a ? 'aerotermia' : ''}</span></div></div>
  <div class="doc-cli"><div><small>Presupuesto para</small><b>${esc(c.nombre)}</b></div><div><small>Fecha</small>${new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</div><div><small>Ubicación</small>${esc([c.calle, c.pueblo].filter(Boolean).join(', '))}</div><div><small>Presupuesto nº</small>${esc(e.presupuesto?.numero || '')}</div></div>
  <div class="doc-sec"><h5 class="g">Equipos incluidos</h5><div class="doc-eq">${eq.map(([x, y, z]) => `<div><b>${esc(x)}</b>${esc(y)}<br>${esc(z)}</div>`).join('')}</div></div>
  <div class="doc-two"><div class="doc-sec"><h5>Especificaciones técnicas</h5><table class="doc-spec">${spec.map(([x, y]) => `<tr><td>${x}</td><td>${y}</td></tr>`).join('')}</table></div>
   <div style="display:flex;flex-direction:column;gap:16px"><div class="doc-sec"><h5 class="g">Precio total</h5><div class="doc-price"><b>${eur(Pr)}</b><span>IVA incluido</span></div><div class="doc-fin"><div>12 meses sin intereses<b>${eur(cuota(Pr, 12), 2)}</b>/mes</div><div>120 cuotas<b>${eur(cuota(Pr, 120), 2)}</b>/mes</div></div></div>
   <div class="doc-sec"><h5>Legalizaciones y certificados incluidos</h5><div style="padding:10px 12px;font-size:13px;color:#43507a">Memoria técnica, trámites de ayuntamiento, CIE, CFO, RITSIC, registro de autoconsumo, bonificación del IBI y certificados energéticos.</div></div></div></div>
  <p class="doc-legal">Pago: 70% a la aceptación y 30% al finalizar. Validez 30 días. Cuotas orientativas, sujetas a aprobación de la entidad financiera.</p>
  <div class="doc-foot"><span>654 094 963</span><span>info@ecomaxenergia.com</span><span>www.ecomaxenergia.com</span></div></article></div>`;
}

/* ---------- agenda ---------- */
function renderAgenda() {
  const mine = role() === 'comercial';
  const vs = E.filter(e => e.visita_fecha && (!mine || e.comercial === me.id));
  const days = [...new Set(vs.map(e => e.visita_fecha))].sort();
  const t = today();
  if (!day || !days.includes(day)) day = days.find(d => d >= t) || days[days.length - 1] || t;
  const shown = days.filter(d => d >= addDays(t, -7)).slice(0, 14);
  const coms = mine ? [me.id] : comerciales().map(p => p.id);
  const res = e => e.etapa === 'visita' ? ['Pendiente', 'p-new'] : e.etapa === 'rechazado' ? ['Rechazado', 'p-bad'] : e.etapa === 'aceptado' ? ['Venta', 'p-done'] : e.etapa === 'descartado' ? ['Descartado', 'p-mute'] : ['Ficha enviada', 'p-info'];
  const cols = coms.map(cid => {
    const l = vs.filter(e => e.comercial === cid && e.visita_fecha === day).sort((a, b) => String(a.visita_hora).localeCompare(String(b.visita_hora)));
    const km = l.reduce((s, e) => s + (+e.visita_km || 0), 0);
    return `<div class="agcol"><h3><span class="av">${ini(cid)}</span>${esc(nm(cid))}<small>${l.length} visita${l.length === 1 ? '' : 's'}${km ? ` · ${km} km` : ''}</small></h3>
     ${l.length ? l.map(e => { const [tx, cl] = res(e); return `<button type="button" class="visit" data-open="${e.id}"><span class="h">${hhmm(e.visita_hora)}</span><span class="b"><span class="nm">${esc(e.cliente?.nombre)}</span><span class="sub">${esc([e.cliente?.calle, e.cliente?.pueblo].filter(Boolean).join(', '))} · ${esc(e.cliente?.tel || '')}</span></span><span class="f"><span class="pill ${cl}">${tx}</span><span class="hint">${esc(sumario(e))}</span></span></button>`; }).join('') : `<div class="empty" style="padding:16px">Sin visitas este día.</div>`}</div>`;
  }).join('');
  $('main').innerHTML = `<section class="panel page"><div class="page-h"><div><p>Las citas las agenda captación. Cada visita abre su expediente.</p></div></div>
   ${shown.length ? `<div class="days">${shown.map(d => { const n = vs.filter(e => e.visita_fecha === d).length; return `<button type="button" data-day="${d}" aria-pressed="${d === day}"><b>${fDate(d)}</b>${n} visita${n === 1 ? '' : 's'}</button>`; }).join('')}</div>` : ''}
   ${coms.length ? `<div class="agcols">${cols}</div>` : `<div class="empty">Todavía no hay comerciales dados de alta.</div>`}</section>`;
}
function addDays(d, n) { const x = new Date(d + 'T12:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }

/* ---------- actividad del equipo ---------- */
async function renderAct() {
  $('main').innerHTML = `<section class="panel page"><div class="empty">Cargando actividad…</div></section>`;
  let q = sb.from('eventos').select('*').order('id', { ascending: false }).limit(400);
  if (actWho !== 'all') q = q.eq('actor', actWho);
  const { data, error } = await q; if (error) { toast(errMsg(error)); return; }
  const byId = Object.fromEntries(E.map(e => [e.id, e]));
  $('main').innerHTML = `<section class="panel page"><div class="page-h"><div><h3 class="h3">Quién ha hecho qué</h3><p>Todo lo que pasa en la app, con persona, fecha y cliente. Toca un nombre para filtrar.</p></div></div>
   <div class="days"><button type="button" data-aw="all" aria-pressed="${actWho === 'all'}"><b>Todos</b>Equipo</button>${team.map(p => `<button type="button" data-aw="${p.id}" aria-pressed="${actWho === p.id}"><b>${esc(p.nombre)}</b>${ROLTXT[p.rol]}</button>`).join('')}</div>
   ${data.length ? `<div class="tblw"><table class="t"><thead><tr><th>Cuándo</th><th>Quién</th><th>Cliente</th><th>Qué hizo</th></tr></thead><tbody>
   ${data.map(x => { const ex = byId[x.expediente_id]; return `<tr><td style="white-space:nowrap">${fWhen(x.created_at)}</td><td><b>${esc(nm(x.actor))}</b></td><td>${ex ? `<button type="button" class="lnk" data-tz="${ex.id}">${esc(ex.cliente?.nombre)}</button>` : x.expediente_id ? '#' + x.expediente_id : '<span class="hint">Equipo</span>'}</td><td>${esc(x.detalle)}${x.comentario ? `<br><span class="hint">“${esc(x.comentario)}”</span>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : `<div class="empty">Todavía no hay actividad${actWho !== 'all' ? ' de esta persona' : ''}.</div>`}</section>`;
}

/* ---------- equipo (administrador) ---------- */
function renderEquipo() {
  if (!me.admin) { view = null; return renderMenu(); }
  $('main').innerHTML = `<section class="panel page" style="margin-bottom:14px"><div class="page-h"><div><h3 class="h3">Dar de alta a una persona</h3><p>Se crea su acceso al momento. Pásale su email y la contraseña temporal.</p></div></div>
   <form class="f" id="fAlta" novalidate><fieldset style="border:0;padding:0">
    <label class="fl">Nombre<input type="text" id="aNom"></label><label class="fl">Email<input type="email" id="aEmail" autocapitalize="none"></label>
    <label class="fl">Rol<select id="aRol">${Object.entries(ROLTXT).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
    <label class="fl">Contraseña temporal (mín. 8)<input type="text" id="aPass" value="${genPass()}"></label>
    <div class="chips"><label><input type="checkbox" id="aAdm"> Puede gestionar el equipo (administrador)</label></div></fieldset>
    <span class="err hide" id="errA"></span><button class="btn primary" type="submit">Dar de alta</button></form></section>
  <section class="panel page"><div class="page-h"><div><h3 class="h3">Equipo (${team.length})</h3><p>Los cambios de rol, bajas y contraseñas quedan en la actividad.</p></div></div>
   <div class="tblw"><table class="t"><thead><tr><th>Persona</th><th>Email</th><th>Rol</th><th>Estado</th><th></th></tr></thead><tbody>
   ${team.map(p => `<tr><td><b>${esc(p.nombre)}</b>${p.admin ? ' <span class="pill p-info">Admin</span>' : ''}</td><td>${esc(p.email || '')}</td>
    <td><select data-urol="${p.id}" ${p.id === me.id ? 'disabled' : ''}>${Object.entries(ROLTXT).map(([k, t]) => `<option value="${k}" ${k === p.rol ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
    <td><span class="pill ${p.activo ? 'p-ok' : 'p-mute'}">${p.activo ? 'Activo' : 'De baja'}</span></td>
    <td style="white-space:nowrap">${p.id === me.id ? '<span class="hint">Tú</span>' : `<button class="btn sm" data-uact="${p.activo ? 'baja' : 'alta'}" data-uid="${p.id}">${p.activo ? 'Dar de baja' : 'Reactivar'}</button> <button class="btn sm" data-uact="pass" data-uid="${p.id}">Nueva contraseña</button>`}</td></tr>`).join('')}
   </tbody></table></div></section>`;
  $('fAlta').addEventListener('submit', async ev => {
    ev.preventDefault(); const b = ev.submitter, v = id => $(id).value.trim(); busy(b, true);
    const r = await fnUsuarios({ accion: 'crear', nombre: v('aNom'), email: v('aEmail'), rol: v('aRol'), password: v('aPass'), admin: $('aAdm').checked });
    busy(b, false);
    if (r.error) { $('errA').textContent = r.error; $('errA').classList.remove('hide'); return; }
    showCreds(v('aNom'), v('aEmail'), v('aPass')); await loadAll(); renderEquipo();
  });
}
function genPass() { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; const r = crypto.getRandomValues(new Uint32Array(10)); for (const x of r) s += a[x % a.length]; return s.slice(0, 5) + '-' + s.slice(5); }
async function fnUsuarios(body) {
  const { data, error } = await sb.functions.invoke('usuarios', { body });
  if (error) { let m = null; try { m = (await error.context.json()).error; } catch (e) { } return { error: m || 'No se ha podido completar.' }; }
  return data || {};
}
function showCreds(nombre, email, pass) {
  $('modalSlot').innerHTML = `<div class="modal" data-act="closeModal"><div class="modal-bar"><span></span><button class="btn sm" data-act="closeModal">Cerrar</button></div>
   <article class="doc" style="max-width:460px;padding:22px"><h3 style="margin:0 0 6px;font-family:var(--f-display)">Acceso de ${esc(nombre)}</h3><p style="margin:0 0 12px;color:#43507a">Pásale estos datos. Puede entrar ya desde el enlace de la app.</p>
   <div class="note" id="credTxt" style="background:#eef2fb;color:#14204a">Email: ${esc(email)}\nContraseña: ${esc(pass)}</div>
   <div class="row" style="margin-top:12px"><button class="btn primary" data-copy="credTxt">Copiar</button></div></article></div>`;
}

/* ---------- tarifas ---------- */
function renderTarifas() {
  const ed = role() === 'oficina'; let g = '';
  const rows = tarifas.map(r => { let h = ''; if (r.grupo !== g) { g = r.grupo; h = `<tr class="grp"><td colspan="4">${esc(r.grupo)} · legalización y certificados incluidos</td></tr>`; }
    const cell = (k, val) => ed ? `<input type="number" step="50" data-tar="${r.id}" data-k="${k}" value="${val ?? ''}" style="max-width:120px;text-align:right">` : (val != null ? eur(val) : '—');
    return h + `<tr><td>${r.placas} PL + INV ${r.inversor_kw} kW${+r.bateria_kwh ? ` + BAT ${r.bateria_kwh} kWh` : ''}</td><td class="num">${cell('pvp_mono', r.pvp_mono)}</td><td class="num">${cell('pvp_tri', r.pvp_tri)}</td><td class="num">${eur(r.pvp_mono / 1.21, 2)}</td></tr>`; }).join('');
  $('main').innerHTML = `<section class="panel page"><div class="page-h"><div><p>${ed ? 'Puedes cambiar los precios: se guardan al salir de la casilla y cada cambio queda registrado para dirección.' : 'El precio sugerido de cada expediente sale de esta tabla. Los cambios los hace oficina y quedan registrados.'}</p></div></div>
   <div class="tblw"><table class="t"><thead><tr><th>Instalación</th><th style="text-align:right">PVP monofásica</th><th style="text-align:right">PVP trifásica</th><th style="text-align:right">Sin IVA (financiera)</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">Sin tarifas.</td></tr>'}</tbody></table></div></section>`;
}


/* ---------- quién interviene en cada venta (dirección) ---------- */
let ventMes = 'all', ventWho = 'all', ventRows = [];
async function renderVentas() {
  $('main').innerHTML = `<section class="panel page"><div class="empty">Cargando ventas…</div></section>`;
  const ventas = E.filter(e => e.etapa === 'aceptado');
  let evs = [];
  if (ventas.length) {
    const { data, error } = await sb.from('eventos').select('expediente_id,actor,tipo,created_at').in('expediente_id', ventas.map(e => e.id)).in('tipo', ['visita', 'ficha', 'aceptada', 'presupuesto', 'aprobado', 'enviado', 'venta', 'taclia']).order('id');
    if (error) { toast(errMsg(error)); return; }
    evs = data || [];
  }
  const last = (id, t) => { let r = null; for (const x of evs) if (x.expediente_id === id && x.tipo === t) r = x; return r; };
  ventRows = ventas.map(e => {
    const v = last(e.id, 'venta');
    return { e, fecha: v?.created_at || e.updated_at, importe: +e.presupuesto?.final || 0, pago: e.pago?.forma || '',
      capto: e.captador || null, agendo: last(e.id, 'visita')?.actor || null, comercial: e.comercial || null,
      oficina: last(e.id, 'presupuesto')?.actor || null, aprobo: last(e.id, 'aprobado')?.actor || null, envio: last(e.id, 'enviado')?.actor || null, cerro: v?.actor || null, taclia: last(e.id, 'taclia')?.actor || null };
  }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const meses = [...new Set(ventRows.map(r => String(r.fecha).slice(0, 7)))].sort().reverse();
  const mesTxt = m => new Date(m + '-15').toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const ROLES_V = [['capto', 'Captó'], ['agendo', 'Agendó'], ['comercial', 'Comercial'], ['oficina', 'Presupuesto'], ['aprobo', 'Visto bueno'], ['envio', 'Envió'], ['cerro', 'Marcó la venta'], ['taclia', 'Pasó a Taclia']];
  let rows = ventRows.filter(r => ventMes === 'all' || String(r.fecha).startsWith(ventMes));
  if (ventWho !== 'all') rows = rows.filter(r => ROLES_V.some(([k]) => r[k] === ventWho));
  const total = rows.reduce((s, r) => s + r.importe, 0);
  const ppl = team.filter(p => ROLES_V.some(([k]) => rows.some(r => r[k] === p.id)));
  const cell = id => id ? esc(nm(id)) : '<span class="hint">—</span>';
  $('main').innerHTML = `<section class="panel page" style="margin-bottom:14px"><div class="page-h"><div><h3 class="h3">Quién interviene en cada venta</h3><p>Sale del registro del servidor, que nadie puede modificar. Toca un cliente para ver su trazabilidad completa.</p></div>
    <button class="btn sm" data-act-v="csv" ${rows.length ? '' : 'disabled'}>Descargar para Excel</button></div>
   <div class="row" style="margin-bottom:12px"><label class="fl">Mes<select id="vMes"><option value="all">Todos</option>${meses.map(m => `<option value="${m}" ${m === ventMes ? 'selected' : ''}>${mesTxt(m)}</option>`).join('')}</select></label>
    <label class="fl">Persona<select id="vWho"><option value="all">Todo el equipo</option>${team.map(p => `<option value="${p.id}" ${p.id === ventWho ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label></div>
   <div class="kpis"><div class="kpi hot"><div class="v">${rows.length}</div><div class="l">Venta${rows.length === 1 ? '' : 's'} cerrada${rows.length === 1 ? '' : 's'}</div></div><div class="kpi"><div class="v">${eur(total)}</div><div class="l">Importe total (IVA incl.)</div></div></div>
   ${rows.length ? `<div class="tblw"><table class="t"><thead><tr><th>Venta</th><th>Cliente</th><th style="text-align:right">Importe</th>${ROLES_V.map(([, t]) => `<th>${t}</th>`).join('')}</tr></thead><tbody>
   ${rows.map(r => `<tr><td style="white-space:nowrap">${fDate(r.fecha)}</td><td><button type="button" class="lnk" data-tz="${r.e.id}">${esc(r.e.cliente?.nombre)}</button><br><span class="hint">${esc(r.pago)}</span></td><td class="num">${eur(r.importe)}</td>${ROLES_V.map(([k]) => `<td>${cell(r[k])}</td>`).join('')}</tr>`).join('')}
   </tbody></table></div>` : `<div class="empty">No hay ventas cerradas${ventMes !== 'all' || ventWho !== 'all' ? ' con este filtro' : ' todavía'}.</div>`}</section>
  ${ppl.length ? `<section class="panel page"><div class="page-h"><div><h3 class="h3">Resumen por persona</h3><p>En cuántas de estas ventas ha intervenido cada uno y en qué papel.</p></div></div>
   <div class="tblw"><table class="t"><thead><tr><th>Persona</th>${ROLES_V.map(([, t]) => `<th style="text-align:right">${t}</th>`).join('')}<th style="text-align:right">Importe de sus ventas</th></tr></thead><tbody>
   ${ppl.map(p => { const mine = rows.filter(r => ROLES_V.some(([k]) => r[k] === p.id)); return `<tr><td><b>${esc(p.nombre)}</b><br><span class="hint">${ROLTXT[p.rol]}</span></td>${ROLES_V.map(([k]) => `<td class="num">${rows.filter(r => r[k] === p.id).length || '<span class="hint">—</span>'}</td>`).join('')}<td class="num">${eur(mine.reduce((s, r) => s + r.importe, 0))}</td></tr>`; }).join('')}
   </tbody></table></div></section>` : ''}`;
  $('vMes').onchange = ev => { ventMes = ev.target.value; renderVentas(); };
  $('vWho').onchange = ev => { ventWho = ev.target.value; renderVentas(); };
  document.querySelector('[data-act-v="csv"]').onclick = () => {
    const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const head = ['Fecha venta', 'Expediente', 'Cliente', 'Población', 'Importe IVA incl.', 'Forma de pago', ...ROLES_V.map(([, t]) => t)];
    const lines = [head.map(q).join(';'), ...rows.map(r => [new Date(r.fecha).toLocaleDateString('es-ES'), r.e.id, r.e.cliente?.nombre, r.e.cliente?.pueblo, String(r.importe).replace('.', ','), r.pago, ...ROLES_V.map(([k]) => r[k] ? nm(r[k]) : '')].map(q).join(';'))];
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ventas-intervenciones-${ventMes === 'all' ? 'todas' : ventMes}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
}


/* ---------- correcciones (dirección) ---------- */
function renderCorr() {
  const byId = Object.fromEntries(E.map(e => [e.id, e]));
  const l = [...CORR].sort((a, b) => (!!a.done - !!b.done) || b.id - a.id);
  $('main').innerHTML = `<section class="panel page"><div class="page-h"><div><h3 class="h3">Correcciones indicadas</h3><p>Cada corrección le aparece como tarea a la persona hasta que la marca como hecha. Se indican desde cada expediente.</p></div></div>
   ${l.length ? `<div class="tblw"><table class="t"><thead><tr><th>Cuándo</th><th>Para</th><th>Cliente</th><th>Corrección</th><th>Estado</th></tr></thead><tbody>
   ${l.map(c => `<tr><td style="white-space:nowrap">${fWhen(c.created_at)}</td><td><b>${esc(nm(c.para))}</b></td><td>${byId[c.expediente_id] ? `<button type="button" class="lnk" data-tz="${c.expediente_id}">${esc(byId[c.expediente_id].cliente?.nombre)}</button>` : '#' + c.expediente_id}</td><td>${esc(c.comentario)}${c.done?.comentario ? `<br><span class="hint">Respuesta: “${esc(c.done.comentario)}”</span>` : ''}</td><td><span class="pill ${c.done ? 'p-ok' : 'p-bad'}">${c.done ? 'Hecha · ' + fWhen(c.done.created_at) : 'Pendiente'}</span></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">Todavía no has indicado ninguna corrección.</div>`}</section>`;
}

/* ---------- eventos de la interfaz ---------- */
document.addEventListener('click', async ev => {
  const t = ev.target;
  const g = t.closest('[data-go]'); if (g) return go(g.dataset.go);
  const tk = t.closest('[data-task]'); if (tk) return openExp(+tk.dataset.task);
  const ft = t.closest('[data-filt]'); if (ft) { filt = ft.dataset.filt; sel = null; return renderGrid(); }
  const it = t.closest('.item'); if (it) { sel = +it.dataset.id; mode = 'view'; sub = 'res'; await loadDetail(sel); return render(true); }
  const st = t.closest('[data-sub]'); if (st) { sub = st.dataset.sub; return renderDetail(); }
  const dy = t.closest('[data-day]'); if (dy) { day = dy.dataset.day; return renderAgenda(); }
  const op = t.closest('[data-open]'); if (op) return openExp(+op.dataset.open);
  const tz = t.closest('[data-tz]'); if (tz) { view = 'exp'; return openExp(+tz.dataset.tz, 'traz'); }
  const aw = t.closest('[data-aw]'); if (aw) { actWho = aw.dataset.aw; return renderAct(); }
  const of = t.closest('[data-open-file]'); if (of) return openFile(of.dataset.openFile);
  const cp = t.closest('[data-copy]'); if (cp) { const txt = $(cp.dataset.copy).innerText; try { await navigator.clipboard.writeText(txt); toast('Copiado.'); } catch (e) { const r = document.createRange(); r.selectNodeContents($(cp.dataset.copy)); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Selecciona y copia el texto.'); } return; }
  const ua = t.closest('[data-uact]'); if (ua) {
    const id = ua.dataset.uid, k = ua.dataset.uact, p = P(id); busy(ua, true);
    let r; if (k === 'pass') { const np = genPass(); r = await fnUsuarios({ accion: 'password', id, password: np }); if (!r.error) showCreds(p.nombre, p.email, np); }
    else r = await fnUsuarios({ accion: 'actualizar', id, activo: k === 'alta' });
    busy(ua, false); if (r.error) return toast(r.error, 5000); if (k !== 'pass') toast(k === 'alta' ? 'Reactivado.' : 'Dado de baja. Ya no puede entrar.');
    await loadAll(); return renderEquipo();
  }
  const a = t.closest('[data-act]'); if (a) { if (a.classList.contains('modal') && t.closest('.doc')) return; return act(a.dataset.act, a); }
});
document.addEventListener('change', async ev => {
  const ur = ev.target.closest('[data-urol]'); if (ur) { const r = await fnUsuarios({ accion: 'actualizar', id: ur.dataset.urol, rol: ur.value }); if (r.error) toast(r.error, 5000); else toast('Rol cambiado. Queda registrado.'); await loadAll(); return renderEquipo(); }
  const tr = ev.target.closest('[data-tar]'); if (tr) { const val = tr.value === '' ? null : +tr.value; const { error } = await sb.rpc('actualizar_tarifa', { p_id: +tr.dataset.tar, p_campo: tr.dataset.k, p_valor: val }); if (error) toast(errMsg(error), 5000); else { toast('Precio guardado. Queda registrado.'); const x = tarifas.find(r => r.id === +tr.dataset.tar); if (x) x[tr.dataset.k] = val; } return; }
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') $('modalSlot').innerHTML = ''; });
sb.auth.onAuthStateChange((evt) => { if (evt === 'SIGNED_OUT' && me) { me = null; showAccess(); } });
window.addEventListener('online', () => me && onRemote());
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => { });
boot().catch(e => { console.error(e); $('main').innerHTML = `<div class="empty">No se ha podido conectar con el servidor. Revisa la conexión y recarga.<br><small>${esc(errMsg(e))}</small></div>`; });
