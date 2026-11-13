'use strict';
/* Autorimessa Vigili del Fuoco - Gestione Operativa */

const STORAGE_KEY = 'autorimessa_vvf_db_v4';
const COLL = ['vigili', 'mezzi', 'turni', 'squadre', 'servizi', 'manutenzioni', 'magazzino', 'report_attrezzatura'];

let DB = {
  settings: {
    comando: 'Vigili del Fuoco Mirandola (MO)',
    giorni_avviso: 30,
    adblue_litri: 120,
    adblue_taniche: 6,
    litri_per_tanica: 20
  }
};
COLL.forEach(c => DB[c] = []);
let IDX = {};
const UI = { calDate: new Date(), calFilterGruppo: '' };
let route = 'dashboard';

/* ---------- utilità ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const fmtDate = s => s ? s.split('-').reverse().join('/') : '';
const num0 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });
const fNum = v => (v === '' || v == null) ? '' : num0.format(+v);
const daysTo = s => {
  if (!s) return 999;
  try {
    return Math.round((new Date(s + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 864e5);
  } catch (e) { return 999; }
};

function reindex() {
  IDX = {};
  COLL.forEach(c => { IDX[c] = new Map((DB[c] || []).map(r => [r.id, r])); });
}
const nomeVigile = id => {
  const v = IDX.vigili.get(+id);
  return v ? `${v.qualifica ? v.qualifica + ' ' : ''}${v.cognome} ${v.nome}` : '';
};
const labelMezzo = id => {
  const m = IDX.mezzi.get(+id);
  return m ? `${m.sigla} (${m.targa})` : '';
};
const labelTurno = id => {
  const t = IDX.turni.get(+id);
  return t ? `${fmtDate(t.data)} · ${t.fascia} · ${t.gruppo}` : '';
};

function saveDB() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
  } catch (e) { console.error(e); }
  reindex();
  const com = $('#comando-name');
  if (com) com.textContent = DB.settings.comando || 'Autorimessa VVF';
}

function loadDB() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      DB = { ...DB, ...parsed, settings: { ...DB.settings, ...(parsed.settings || {}) } };
      COLL.forEach(c => { if (!Array.isArray(DB[c])) DB[c] = []; });
    } else {
      seedDemoData();
    }
  } catch (e) {
    console.error('Errore caricamento DB, ripristino demo:', e);
    seedDemoData();
  }
  saveDB();
}

function nextId(collName) {
  const arr = DB[collName] || [];
  return arr.length ? Math.max(...arr.map(x => +x.id || 0)) + 1 : 1;
}

function toast(msg, err) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.hidden = true, err ? 5500 : 2800);
}

function toggleSidebar(open) {
  const sb = $('#sidebar');
  const ov = $('#sidebar-overlay');
  if (!sb || !ov) return;
  const isOpen = open !== undefined ? open : !sb.classList.contains('open');
  sb.classList.toggle('open', isOpen);
  ov.hidden = !isOpen;
}

/* ---------- costanti operative VVF ---------- */
const TIPI_MEZZO = [
  'APS (Autopompa serbatoio)',
  'ABP (Autobotte)',
  'CA-PU (Pickup)',
  'AS (AutoScala)',
  'AV (Autovettura)'
];
const STATI_MEZZO = ['Operativo', 'In manutenzione', 'Fuori servizio'];
const STATI_VIGILE = ['In servizio', 'Ferie / Riposo', 'Malattia', 'Aggregato'];
const GRUPPI_TURNO = ['Turno A', 'Turno B', 'Turno C', 'Turno D'];
const FASCE_12H = ['Diurno (08:00 - 20:00)', 'Notturno (20:00 - 08:00)'];
const TIPI_SQUADRA = [
  'Squadra Ordinaria (5 unità)',
  'Squadra Supporto Aggiuntiva (2 unità: CS + Autista)',
  'Squadra Aggiuntiva (max 5 unità)'
];
const STATI_SERVIZIO = ['Aperto / In corso', 'Rientrato / Chiuso'];
const TIPI_MANUTENZIONE = ['Gomme', 'Olio', 'Tagliando', 'Meccanica / Vari', 'Carrozzeria / Allestimento'];

const BADGE = {
  'Operativo': 'ok', 'In manutenzione': 'warn', 'Fuori servizio': 'bad',
  'In servizio': 'ok', 'Ferie / Riposo': 'info', 'Malattia': 'bad', 'Aggregato': 'mute',
  'Aperto / In corso': 'bad', 'Rientrato / Chiuso': 'ok',
  'Turno A': 'info', 'Turno B': 'ok', 'Turno C': 'warn', 'Turno D': 'mute',
  'Integro': 'ok', 'Da verificare': 'warn', 'Guasto / Mancante': 'bad'
};
const badge = (t, cls) => `<span class="badge ${cls || BADGE[t] || 'mute'}">${esc(t)}</span>`;

/* ---------- schema delle sezioni ---------- */
const SCHEMA = {
  servizi: {
    label: 'Servizi / Interventi', one: 'servizio', nuovo: 'Apri un servizio', icon: '🚨', sort: ['data', 'desc'],
    statusOpts: STATI_SERVIZIO, hasDate: true,
    fields: [
      { k: 'data', l: 'Data servizio', t: 'date', req: 1, def: 'today' },
      { k: 'ora_uscita', l: 'Ora apertura / uscita', t: 'time', req: 1 },
      { k: 'stato', l: 'Stato servizio', t: 'select', opts: STATI_SERVIZIO, def: 'Aperto / In corso' },
      { k: 'tipologia', l: 'Tipologia intervento', t: 'text', req: 1, placeholder: 'Es. Incendio, Soccorso persona, Incidente...' },
      { k: 'luogo', l: 'Località / Indirizzo', t: 'text', req: 1, full: 1 },
      { k: 'mezzo_id', l: 'Mezzo impiegato', t: 'ref', ref: 'mezzi', req: 1 },
      { k: 'squadra_id', l: 'Squadra preimpostata (opzionale)', t: 'ref', ref: 'squadre' },
      { s: 'Composizione Squadra in Uscita' },
      { k: 'caposquadra_id', l: 'Capo Squadra', t: 'ref', ref: 'vigili', req: 1 },
      { k: 'autista_id', l: 'Autista', t: 'ref', ref: 'vigili', req: 1 },
      { k: 'prima_lancia_id', l: '1ª Lancia', t: 'ref', ref: 'vigili' },
      { k: 'seconda_lancia_id', l: '2ª Lancia', t: 'ref', ref: 'vigili' },
      { k: 'terza_lancia_id', l: '3ª Lancia', t: 'ref', ref: 'vigili' },
      { k: 'ora_rientro', l: 'Ora rientro in sede', t: 'time' },
      { k: 'km_percorsi', l: 'Km percorsi', t: 'number' },
      { k: 'note', l: 'Note operative / Rapporto', t: 'textarea', full: 1 },
    ],
    cols: [
      { l: 'Data', v: r => r.data, h: r => `${fmtDate(r.data)} <small class="sub">${esc(r.ora_uscita || '')}</small>` },
      { l: 'Tipologia', v: r => r.tipologia, h: r => `<strong>${esc(r.tipologia)}</strong>` },
      { l: 'Luogo', v: r => r.luogo, wrap: 1 },
      { l: 'Mezzo', v: r => labelMezzo(r.mezzo_id) },
      { l: 'Capo Squadra', v: r => nomeVigile(r.caposquadra_id) },
      { l: 'Autista', v: r => nomeVigile(r.autista_id) },
      { l: 'Lance (1ª / 2ª / 3ª)', v: r => [r.prima_lancia_id, r.seconda_lancia_id, r.terza_lancia_id].filter(Boolean).map(nomeVigile).join(', '), wrap: 1 },
      { l: 'Stato', v: r => r.stato, h: r => badge(r.stato) },
    ],
  },

  turni: {
    label: 'Elenco Turni (12 ore)', one: 'turno', nuovo: 'Crea turno 12h', icon: '📅', sort: ['data', 'desc'],
    statusOpts: GRUPPI_TURNO, hasDate: true,
    fields: [
      { k: 'data', l: 'Data turno', t: 'date', req: 1, def: 'today' },
      { k: 'fascia', l: 'Fascia oraria (12 ore)', t: 'select', opts: FASCE_12H, def: 'Diurno (08:00 - 20:00)', req: 1 },
      { k: 'gruppo', l: 'Gruppo in turno', t: 'select', opts: GRUPPI_TURNO, def: 'Turno A', req: 1 },
      { k: 'capoturno_id', l: 'Capo Turno / Responsabile', t: 'ref', ref: 'vigili' },
      { k: 'personale_ids', l: 'Personale presente nel turno', t: 'multiref', ref: 'vigili', full: 1 },
      { k: 'note', l: 'Note di turno / Sostituzioni', t: 'textarea', full: 1 },
    ],
    cols: [
      { l: 'Data', v: r => r.data, h: r => `<strong>${fmtDate(r.data)}</strong>` },
      { l: 'Fascia (12h)', v: r => r.fascia },
      { l: 'Gruppo', v: r => r.gruppo, h: r => badge(r.gruppo) },
      { l: 'Capo Turno', v: r => nomeVigile(r.capoturno_id) },
      { l: 'Personale nel turno', v: r => (r.personale_ids || []).map(nomeVigile).join(', '), h: r => {
        const list = (r.personale_ids || []).map(nomeVigile).filter(Boolean);
        return list.length ? `<span title="${esc(list.join(', '))}">${list.length} unità: ${esc(list.slice(0, 3).join(', '))}${list.length > 3 ? '…' : ''}</span>` : '<span class="sub">Nessuno assegnato</span>';
      }, wrap: 1 },
    ],
  },

  squadre: {
    label: 'Squadre Operative', one: 'squadra', nuovo: 'Nuova squadra', icon: '🚒', sort: ['nome', 'asc'],
    statusOpts: TIPI_SQUADRA,
    fields: [
      { k: 'nome', l: 'Nome / Sigla Squadra', t: 'text', req: 1 },
      { k: 'tipo', l: 'Tipologia Squadra', t: 'select', opts: TIPI_SQUADRA, def: 'Squadra Ordinaria (5 unità)', req: 1 },
      { k: 'turno_id', l: 'Assegna a Turno', t: 'ref', ref: 'turni' },
      { k: 'mezzo_id', l: 'Mezzo assegnato', t: 'ref', ref: 'mezzi' },
      { s: 'Ruoli della Squadra' },
      { k: 'caposquadra_id', l: 'Capo Squadra', t: 'ref', ref: 'vigili', req: 1 },
      { k: 'autista_id', l: 'Autista', t: 'ref', ref: 'vigili', req: 1 },
      { k: 'prima_lancia_id', l: '1ª Lancia', t: 'ref', ref: 'vigili' },
      { k: 'seconda_lancia_id', l: '2ª Lancia', t: 'ref', ref: 'vigili' },
      { k: 'terza_lancia_id', l: '3ª Lancia', t: 'ref', ref: 'vigili' },
      { k: 'note', l: 'Note', t: 'textarea', full: 1 },
    ],
    cols: [
      { l: 'Squadra', v: r => r.nome, h: r => `<strong>${esc(r.nome)}</strong>` },
      { l: 'Tipologia', v: r => r.tipo, h: r => badge(r.tipo.split(' (')[0], r.tipo.includes('Supporto') ? 'warn' : 'ok') },
      { l: 'Turno assegnato', v: r => labelTurno(r.turno_id) },
      { l: 'Mezzo', v: r => labelMezzo(r.mezzo_id) },
      { l: 'Capo Squadra', v: r => nomeVigile(r.caposquadra_id) },
      { l: 'Autista', v: r => nomeVigile(r.autista_id) },
      { l: 'Componenti / Lance', v: r => [r.prima_lancia_id, r.seconda_lancia_id, r.terza_lancia_id].filter(Boolean).map(nomeVigile).join(', '), wrap: 1 },
    ],
  },

  mezzi: {
    label: 'Mezzi Autorimessa', one: 'mezzo', nuovo: 'Nuovo mezzo', icon: '🚛', sort: ['sigla', 'asc'],
    statusOpts: STATI_MEZZO,
    fields: [
      { k: 'sigla', l: 'Sigla / Codice Mezzo', t: 'text', req: 1 },
      { k: 'tipo', l: 'Categoria Mezzo', t: 'select', opts: TIPI_MEZZO, def: 'APS (Autopompa serbatoio)', req: 1 },
      { k: 'targa', l: 'Targa VF', t: 'text', req: 1 },
      { k: 'marca_modello', l: 'Marca / Modello', t: 'text' },
      { k: 'anno', l: 'Anno', t: 'number' },
      { k: 'km_attuali', l: 'Km attuali', t: 'number' },
      { k: 'stato', l: 'Stato operativo', t: 'select', opts: STATI_MEZZO, def: 'Operativo' },
      { s: 'Scadenze' },
      { k: 'scad_revisione', l: 'Scadenza Revisione', t: 'date' },
      { k: 'scad_tagliando', l: 'Prossimo Tagliando', t: 'date' },
      { k: 'scad_assicurazione', l: 'Copertura Assicurativa', t: 'date' },
      { k: 'note', l: 'Note', t: 'textarea', full: 1 },
    ],
    cols: [
      { l: 'Sigla', v: r => r.sigla, h: r => `<strong>${esc(r.sigla)}</strong>` },
      { l: 'Categoria', v: r => r.tipo },
      { l: 'Targa', v: r => r.targa },
      { l: 'Marca / Modello', v: r => r.marca_modello },
      { l: 'Km', v: r => +r.km_attuali || 0, h: r => fNum(r.km_attuali), num: 1 },
      { l: 'Prossima scadenza', v: r => prossimaScad(r, SCAD_MEZZO)?.data || '9999', h: r => scadCell(prossimaScad(r, SCAD_MEZZO)) },
      { l: 'Stato', v: r => r.stato, h: r => badge(r.stato) },
    ],
  },

  vigili: {
    label: 'Vigili Sezione', one: 'vigile', nuovo: 'Nuovo vigile', icon: '🧑‍🚒', sort: ['cognome', 'asc'],
    statusOpts: STATI_VIGILE,
    fields: [
      { k: 'qualifica', l: 'Qualifica', t: 'text', def: 'VP', req: 1 },
      { k: 'cognome', l: 'Cognome', t: 'text', req: 1 },
      { k: 'nome', l: 'Nome', t: 'text', req: 1 },
      { k: 'gruppo', l: 'Turno di appartenenza', t: 'select', opts: GRUPPI_TURNO, def: 'Turno A' },
      { k: 'patente', l: 'Patente VF / Abilitazioni', t: 'text', def: '3° Grado' },
      { k: 'telefono', l: 'Telefono', t: 'text' },
      { k: 'stato', l: 'Stato', t: 'select', opts: STATI_VIGILE, def: 'In servizio' },
      { s: 'Scadenze Personali' },
      { k: 'scad_visita', l: 'Visita Medica Periodica', t: 'date' },
      { k: 'scad_patente', l: 'Rinnovo Patente VF', t: 'date' },
      { k: 'note', l: 'Note', t: 'textarea', full: 1 },
    ],
    cols: [
      { l: 'Qualifica', v: r => r.qualifica, h: r => badge(r.qualifica, 'info') },
      { l: 'Nominativo', v: r => `${r.cognome} ${r.nome}`, h: r => `<strong>${esc(r.cognome)} ${esc(r.nome)}</strong>` },
      { l: 'Gruppo', v: r => r.gruppo, h: r => badge(r.gruppo) },
      { l: 'Patente / Abil.', v: r => r.patente },
      { l: 'Telefono', v: r => r.telefono },
      { l: 'Scadenze', v: r => prossimaScad(r, SCAD_VIGILE)?.data || '9999', h: r => scadCell(prossimaScad(r, SCAD_VIGILE)) },
      { l: 'Stato', v: r => r.stato, h: r => badge(r.stato) },
    ],
  },

  manutenzioni: {
    label: 'Manutenzioni', one: 'manutenzione', nuovo: 'Registra manutenzione', icon: '🔧', sort: ['data', 'desc'],
    statusOpts: TIPI_MANUTENZIONE, hasDate: true,
    fields: [
      { k: 'data', l: 'Data intervento', t: 'date', req: 1, def: 'today' },
      { k: 'mezzo_id', l: 'Mezzo', t: 'ref', ref: 'mezzi', req: 1 },
      { k: 'stato', l: 'Tipo manutenzione', t: 'select', opts: TIPI_MANUTENZIONE, def: 'Tagliando', req: 1 },
      { k: 'portato_da_id', l: 'Portato da (Vigile)', t: 'ref', ref: 'vigili', req: 1 },
      { k: 'eseguito_da', l: 'Officina / Eseguito da', t: 'text' },
      { k: 'km', l: 'Km', t: 'number' },
      { k: 'descrizione', l: 'Descrizione intervento', t: 'textarea', req: 1, full: 1 },
      { s: 'Prossimo Intervento' },
      { k: 'prossima_data', l: 'Prossima scadenza', t: 'date' },
      { k: 'prossimi_km', l: 'Oppure ai km', t: 'number' },
    ],
    cols: [
      { l: 'Data', v: r => r.data, h: r => fmtDate(r.data) },
      { l: 'Mezzo', v: r => labelMezzo(r.mezzo_id), h: r => `<strong>${esc(labelMezzo(r.mezzo_id))}</strong>` },
      { l: 'Tipo', v: r => r.stato, h: r => badge(r.stato, 'warn') },
      { l: 'Portato da', v: r => nomeVigile(r.portato_da_id) },
      { l: 'Descrizione', v: r => r.descrizione, wrap: 1 },
      { l: 'Officina', v: r => r.eseguito_da },
      { l: 'Km', v: r => +r.km || 0, h: r => fNum(r.km), num: 1 },
      { l: 'Prossimo', v: r => r.prossima_data || '9999', h: r => r.prossima_data ? fmtDate(r.prossima_data) : (r.prossimi_km ? fNum(r.prossimi_km) + ' km' : '—') },
    ],
  },

  magazzino: {
    label: 'Magazzino & AdBlue', one: 'articolo', nuovo: 'Nuovo articolo', icon: '📦', sort: ['nome', 'asc'],
    fields: [
      { k: 'nome', l: 'Nome articolo / Materiale', t: 'text', req: 1 },
      { k: 'categoria', l: 'Categoria', t: 'select', opts: ['Lubrificanti e Liquidi', 'Estinguenti / Schiumogeni', 'Ricambi Mezzi', 'DPI e Vestiario', 'Materiale di Consumo'], def: 'Lubrificanti e Liquidi' },
      { k: 'quantita', l: 'Quantità in giacenza', t: 'number', req: 1 },
      { k: 'unita', l: 'Unità di misura', t: 'text', def: 'pz', req: 1 },
      { k: 'scorta_min', l: 'Scorta minima', t: 'number', def: 2 },
      { k: 'ubicazione', l: 'Ubicazione', t: 'text' },
      { k: 'note', l: 'Note', t: 'textarea', full: 1 },
    ],
    cols: [
      { l: 'Articolo', v: r => r.nome, h: r => `<strong>${esc(r.nome)}</strong>` },
      { l: 'Categoria', v: r => r.categoria },
      { l: 'Giacenza', v: r => +r.quantita || 0, h: r => {
        const low = (+r.quantita || 0) <= (+r.scorta_min || 0);
        return `<span class="${low ? 'neg' : 'pos'}"><strong>${num1.format(+r.quantita || 0)} ${esc(r.unita)}</strong></span>`;
      }, num: 1 },
      { l: 'Scorta min.', v: r => +r.scorta_min || 0, h: r => `${fNum(r.scorta_min)} ${esc(r.unita)}`, num: 1 },
      { l: 'Ubicazione', v: r => r.ubicazione },
      { l: 'Stato', v: r => (+r.quantita <= +r.scorta_min) ? 'Sotto scorta' : 'Disponibile', h: r => (+r.quantita <= +r.scorta_min) ? badge('Sotto scorta', 'bad') : badge('Disponibile', 'ok') },
    ],
  },

  report_attrezzatura: {
    label: 'Report Attrezzatura', one: 'attrezzatura', nuovo: 'Inserisci attrezzatura', icon: '🪓', sort: ['nome', 'asc'],
    statusOpts: ['Integro', 'Da verificare', 'Guasto / Mancante'],
    fields: [
      { k: 'nome', l: 'Nome attrezzatura', t: 'text', req: 1, placeholder: 'Es. Mototroncatrice, Divaricatore...' },
      { k: 'matricola', l: 'Matricola', t: 'text' },
      { k: 'mezzo_id', l: 'Mezzo o Vano', t: 'ref', ref: 'mezzi' },
      { k: 'vano', l: 'Posizione', t: 'text' },
      { k: 'stato', l: 'Stato efficienza', t: 'select', opts: ['Integro', 'Da verificare', 'Guasto / Mancante'], def: 'Integro', req: 1 },
      { k: 'data_controllo', l: 'Data controllo', t: 'date', def: 'today' },
      { k: 'verificato_da_id', l: 'Verificato da', t: 'ref', ref: 'vigili' },
      { k: 'note', l: 'Note', t: 'textarea', full: 1 },
    ],
    cols: [
      { l: 'Attrezzatura', v: r => r.nome, h: r => `<strong>${esc(r.nome)}</strong>` },
      { l: 'Matricola', v: r => r.matricola },
      { l: 'Mezzo assegnato', v: r => labelMezzo(r.mezzo_id) || 'Autorimessa' },
      { l: 'Posizione', v: r => r.vano },
      { l: 'Ultimo controllo', v: r => r.data_controllo, h: r => fmtDate(r.data_controllo) },
      { l: 'Verificato da', v: r => nomeVigile(r.verificato_da_id) },
      { l: 'Stato', v: r => r.stato, h: r => badge(r.stato) },
    ],
  }
};

/* ---------- scadenze ---------- */
const SCAD_MEZZO = [['scad_revisione', 'Revisione'], ['scad_tagliando', 'Tagliando'], ['scad_assicurazione', 'Assicurazione']];
const SCAD_VIGILE = [['scad_visita', 'Visita Medica'], ['scad_patente', 'Patente VF']];
const soglia = () => +DB.settings.giorni_avviso || 30;
function scadStato(g) { return g < 0 ? 'scaduta' : g <= soglia() ? 'in scadenza' : 'ok'; }
function prossimaScad(rec, defs) {
  let best = null;
  defs.forEach(([k, l]) => { if (rec && rec[k] && (!best || rec[k] < best.data)) best = { data: rec[k], voce: l }; });
  return best;
}
function scadCell(s) {
  if (!s) return '<span class="sub">—</span>';
  const g = daysTo(s.data), st = scadStato(g);
  const cls = st === 'scaduta' ? 'bad' : st === 'in scadenza' ? 'warn' : 'ok';
  return `${badge(fmtDate(s.data), cls)} <span class="sub">${esc(s.voce)}</span>`;
}
function tutteScadenze() {
  const out = [];
  try {
    (DB.mezzi || []).forEach(m => SCAD_MEZZO.forEach(([k, l]) => m && m[k] && out.push({ tipo: 'Mezzo', chi: `${m.sigla} (${m.targa})`, voce: l, data: m[k], vista: 'mezzi', id: m.id })));
    (DB.vigili || []).forEach(v => SCAD_VIGILE.forEach(([k, l]) => v && v[k] && out.push({ tipo: 'Vigile', chi: `${v.qualifica} ${v.cognome} ${v.nome}`, voce: l, data: v[k], vista: 'vigili', id: v.id })));
    (DB.manutenzioni || []).filter(x => x && x.prossima_data).forEach(x => {
      const m = IDX.mezzi.get(+x.mezzo_id);
      if (m) out.push({ tipo: 'Manutenzione', chi: `${m.sigla} (${m.targa})`, voce: x.stato, data: x.prossima_data, vista: 'manutenzioni', id: x.id });
    });
    out.forEach(s => { s.giorni = daysTo(s.data); s.stato = scadStato(s.giorni); });
  } catch (e) { console.error('Errore in tutteScadenze:', e); }
  return out.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
}

/* ---------- navigazione ---------- */
const NAV = [
  ['dashboard', '📊', 'Cruscotto'],
  ['servizi', '🚨', 'Apri / Gestisci Servizi'],
  ['sep'],
  ['calendario', '🗓️', 'Calendario Turni'],
  ['turni', '📅', 'Elenco Turni (12h)'],
  ['squadre', '🚒', 'Squadre Operative'],
  ['sep'],
  ['mezzi', '🚛', 'Mezzi Autorimessa'],
  ['vigili', '🧑‍🚒', 'Vigili Sezione'],
  ['manutenzioni', '🔧', 'Manutenzioni'],
  ['sep'],
  ['magazzino', '📦', 'Magazzino & AdBlue'],
  ['report_attrezzatura', '🪓', 'Report Attrezzatura'],
  ['scadenze', '⏰', 'Scadenze'],
  ['sep'],
  ['impostazioni', '⚙️', 'Impostazioni & Backup'],
];

function renderNav() {
  const navEl = $('#nav');
  if (!navEl) return;
  try {
    const urgenti = tutteScadenze().filter(s => s.stato !== 'ok').length;
    const attivi = (DB.servizi || []).filter(s => s && s.stato === 'Aperto / In corso').length;
    navEl.innerHTML = NAV.map(n => n[0] === 'sep' ? '<div class="sep"></div>' :
      `<a data-action="go" data-to="${n[0]}" tabindex="0" role="link" class="${route === n[0] ? 'active' : ''}">
        <span>${n[1]}</span><span class="lbl">${n[2]}</span>
        ${n[0] === 'scadenze' && urgenti ? `<span class="count">${urgenti}</span>` : ''}
        ${n[0] === 'servizi' && attivi ? `<span class="count">${attivi}</span>` : ''}
      </a>`).join('');
  } catch (e) {
    console.error('Errore renderNav:', e);
    navEl.innerHTML = NAV.map(n => n[0] === 'sep' ? '<div class="sep"></div>' :
      `<a data-action="go" data-to="${n[0]}" tabindex="0" role="link"><span>${n[1]}</span><span class="lbl">${n[2]}</span></a>`).join('');
  }
}

function go(to) { location.hash = '#/' + to; }

function render() {
  try {
    route = (location.hash.replace(/^#\//, '') || 'dashboard');
    if (!VIEWS[route] && !SCHEMA[route]) route = 'dashboard';
    renderNav();
    const main = $('#main');
    if (!main) return;
    main.scrollTop = 0;
    (VIEWS[route] || (() => renderList(route)))(main);
  } catch (err) {
    console.error('Errore critico in render():', err);
    const main = $('#main');
    if (main) {
      main.innerHTML = `<div class="panel" style="margin:20px; border-color:var(--bad);">
        <h2>⚠️ Si è verificato un errore di visualizzazione</h2>
        <p>Dettaglio: <code>${esc(err.message)}</code></p>
        <p style="margin-top:15px"><button class="btn primary" onclick="localStorage.removeItem('${STORAGE_KEY}'); location.reload();">🔄 Ripristina Dati e Ricarica</button></p>
      </div>`;
    }
  }
}

/* ---------- liste generiche ---------- */
function listState(name) {
  return UI[name] ||= { q: '', stato: '', from: '', to: '', sort: SCHEMA[name].sort.slice() };
}

function renderAdBlueBanner() {
  const s = DB.settings || {};
  const litri = +s.adblue_litri || 0;
  const taniche = +s.adblue_taniche || 0;
  const cap = +s.litri_per_tanica || 20;
  const tot = litri + (taniche * cap);
  return `
    <div class="adblue-box">
      <div style="font-size:28px">💧</div>
      <div>
        <div style="font-size:12px;text-transform:uppercase;font-weight:700;color:#1565c0">Giacenza AdBlue Autorimessa</div>
        <div class="adblue-stat">${num1.format(litri)} Litri sfusi + ${num0.format(taniche)} Taniche <small style="font-size:13px;font-weight:500">(da ${cap}L = Totale ${num1.format(tot)} L)</small></div>
      </div>
      <span class="spacer" style="flex:1"></span>
      <button class="btn info small" data-action="edit-adblue">Aggiorna AdBlue</button>
    </div>`;
}

function renderList(name) {
  const S = SCHEMA[name], st = listState(name);
  const main = $('#main');
  main.innerHTML = `
    <div class="mobile-topbar no-print">
      <button class="btn small" id="sidebar-toggle" aria-label="Apri menu">☰ Menu</button>
      <span class="mobile-title">${esc(S.label)}</span>
    </div>
    <div class="page-head"><h1>${S.icon} ${S.label}</h1><span class="spacer"></span>
      <button class="btn" data-action="csv" data-name="${name}">Esporta CSV</button>
      <button class="btn primary" data-action="new" data-name="${name}">+ ${S.nuovo}</button>
    </div>
    ${name === 'magazzino' ? renderAdBlueBanner() : ''}
    <div class="toolbar">
      <input type="search" placeholder="Cerca…" aria-label="Cerca" data-filter="q" data-name="${name}" value="${esc(st.q)}">
      ${S.statusOpts ? `<select data-filter="stato" data-name="${name}" aria-label="Filtra"><option value="">Tutti</option>${S.statusOpts.map(o => `<option ${st.stato === o ? 'selected' : ''}>${o}</option>`).join('')}</select>` : ''}
      ${S.hasDate ? `<label>Dal <input type="date" data-filter="from" data-name="${name}" value="${st.from}"></label><label>al <input type="date" data-filter="to" data-name="${name}" value="${st.to}"></label>` : ''}
    </div>
    <div class="table-wrap" id="tbl"></div>`;
  updateTable(name);
}

function visibleRows(name) {
  const S = SCHEMA[name], st = listState(name);
  let rows = (DB[name] || []).slice();
  if (st.stato) {
    rows = rows.filter(r => r && ((r.stato === st.stato) || (r.gruppo === st.stato) || (r.tipo === st.stato)));
  }
  if (st.from) rows = rows.filter(r => r && r.data >= st.from);
  if (st.to) rows = rows.filter(r => r && r.data <= st.to);
  if (st.q) {
    const q = st.q.toLowerCase();
    rows = rows.filter(r => r && (S.cols.some(c => String(c.v(r) ?? '').toLowerCase().includes(q)) || String(r.note || '').toLowerCase().includes(q)));
  }
  const [key, dir] = st.sort;
  const col = S.cols.find(c => c.l === key) || S.cols[0];
  const sk = key && !S.cols.find(c => c.l === key) ? (r => r[key]) : col.v;
  rows.sort((a, b) => {
    let x = sk(a), y = sk(b);
    if (typeof x === 'string' || typeof y === 'string') {
      const c = String(x ?? '').localeCompare(String(y ?? ''), 'it', { numeric: true });
      return dir === 'asc' ? c : -c;
    }
    return dir === 'asc' ? (x ?? 0) - (y ?? 0) : (y ?? 0) - (x ?? 0);
  });
  return rows;
}

function updateTable(name) {
  const S = SCHEMA[name], st = listState(name), rows = visibleRows(name);
  const tblEl = $('#tbl');
  if (!tblEl) return;
  const sortLabel = c => (st.sort[0] === c.l || (st.sort[0] === S.sort[0] && c === S.cols[0] && !S.cols.find(x => x.l === st.sort[0]))) ? st.sort[1] : '';
  const head = S.cols.map(c => {
    const s = sortLabel(c);
    return `<th class="${c.num ? 'num' : ''}" data-action="sort" data-name="${name}" data-col="${esc(c.l)}">${esc(c.l)} <span class="arrow">${s === 'asc' ? '▲' : s === 'desc' ? '▼' : ''}</span></th>`;
  }).join('') + '<th class="nosort"></th>';

  const body = rows.map(r => `<tr>${S.cols.map(c => `<td class="${c.num ? 'num' : ''} ${c.wrap ? 'wrap' : ''}">${c.h ? c.h(r) : esc(c.v(r))}</td>`).join('')}
    <td class="actions">
      ${name === 'servizi' ? `<button class="btn small" data-action="print-servizio" data-id="${r.id}" title="Stampa Foglio Servizio">🖨</button>` : ''}
      <button class="btn small" data-action="edit" data-name="${name}" data-id="${r.id}">Modifica</button>
      <button class="btn small danger" data-action="del" data-name="${name}" data-id="${r.id}">Elimina</button>
    </td></tr>`).join('');

  tblEl.innerHTML = rows.length
    ? `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
    : `<div class="empty">${(DB[name] || []).length ? 'Nessun risultato con i filtri attuali.' : `Nessun record presente. Premi “${S.nuovo}” per iniziare.`}</div>`;
}

/* ---------- form ---------- */
function refOptions(f, selected) {
  let list = (DB[f.ref] || []).filter(r => r && (!f.filter || f.filter(r) || r.id === +selected || (Array.isArray(selected) && selected.includes(r.id))));
  const label = r => {
    if (f.ref === 'vigili') return `${r.qualifica} ${r.cognome} ${r.nome} (${r.gruppo})`;
    if (f.ref === 'mezzi') return `${r.sigla} — ${r.tipo} [${r.targa}]`;
    if (f.ref === 'turni') return `${fmtDate(r.data)} · ${r.fascia} · ${r.gruppo}`;
    if (f.ref === 'squadre') return `${r.nome} — ${r.tipo}`;
    return r.nome || r.id;
  };
  list = list.map(r => [r.id, label(r)]).sort((a, b) => a[1].localeCompare(b[1], 'it'));
  if (f.t === 'multiref') {
    const selSet = new Set((selected || []).map(Number));
    return list.map(([id, l]) => `<option value="${id}" ${selSet.has(id) ? 'selected' : ''}>${esc(l)}</option>`).join('');
  }
  return `<option value="">— Seleziona —</option>` + list.map(([id, l]) => `<option value="${id}" ${id === +selected ? 'selected' : ''}>${esc(l)}</option>`).join('');
}

function fieldHtml(f, rec) {
  if (f.s) return `<div class="form-section">${esc(f.s)}</div>`;
  let v = rec[f.k];
  if (v === undefined && f.def) v = f.def === 'today' ? todayStr() : f.def;
  const id = 'f_' + f.k, lab = `<label for="${id}">${esc(f.l)}${f.req ? ' <span class="req">*</span>' : ''}</label>`;
  let input;
  if (f.t === 'select') input = `<select id="${id}" name="${f.k}">${(f.opts || []).map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  else if (f.t === 'ref') input = `<select id="${id}" name="${f.k}">${refOptions(f, v)}</select>`;
  else if (f.t === 'multiref') input = `<select id="${id}" name="${f.k}" multiple>${refOptions(f, v)}</select>`;
  else if (f.t === 'textarea') input = `<textarea id="${id}" name="${f.k}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
  else if (f.t === 'date') input = `<input id="${id}" name="${f.k}" type="date" value="${esc(v)}">`;
  else if (f.t === 'time') input = `<input id="${id}" name="${f.k}" type="time" value="${esc(v)}">`;
  else if (f.t === 'number') input = `<input id="${id}" name="${f.k}" type="number" step="any" min="0" value="${v ?? ''}">`;
  else input = `<input id="${id}" name="${f.k}" type="text" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" autocomplete="off">`;
  return `<div class="field ${f.full ? 'full' : ''}">${lab}${input}</div>`;
}

function openForm(name, id, prefill = {}) {
  const S = SCHEMA[name];
  const rec = id ? { ...(IDX[name].get(id) || {}) } : { ...prefill };
  const modal = $('#modal');
  if (!modal) return;
  modal.innerHTML = `<form class="modal" data-name="${name}" data-id="${id || ''}" novalidate role="dialog" aria-modal="true">
    <header><h2>${id ? 'Modifica ' + S.one : S.nuovo}</h2><button type="button" class="btn small" data-action="close-modal">✕</button></header>
    <div class="body"><div id="form-error" class="form-error" hidden></div><div class="form-grid">${S.fields.map(f => fieldHtml(f, rec)).join('')}</div></div>
    <footer>
      ${id && name === 'servizi' ? `<button type="button" class="btn left" data-action="print-servizio" data-id="${id}">🖨 Foglio Servizio</button>` : ''}
      ${id && name === 'turni' ? `<button type="button" class="btn danger left" data-action="del-modal" data-name="turni" data-id="${id}">Elimina Turno</button>` : ''}
      <button type="button" class="btn" data-action="close-modal">Annulla</button>
      <button type="submit" class="btn primary">Salva</button>
    </footer></form>`;
  modal.hidden = false;
}

function openAdBlueModal() {
  const s = DB.settings || {};
  const modal = $('#modal');
  if (!modal) return;
  modal.innerHTML = `<form class="modal" data-adblue-form novalidate>
    <header><h2>💧 Aggiorna Giacenza AdBlue</h2><button type="button" class="btn small" data-action="close-modal">✕</button></header>
    <div class="body"><div class="form-grid">
      <div class="field"><label>Litri sfusi</label><input type="number" step="0.5" min="0" name="adblue_litri" value="${s.adblue_litri || 0}"></div>
      <div class="field"><label>Taniche</label><input type="number" step="1" min="0" name="adblue_taniche" value="${s.adblue_taniche || 0}"></div>
      <div class="field full"><label>Capacità tanica (Litri)</label><input type="number" step="1" min="1" name="litri_per_tanica" value="${s.litri_per_tanica || 20}"></div>
    </div></div>
    <footer><button type="button" class="btn" data-action="close-modal">Annulla</button><button type="submit" class="btn primary">Salva</button></footer>
  </form>`;
  modal.hidden = false;
}

function openAutoTurniModal() {
  const d = UI.calDate || new Date();
  const meseLabel = d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  const modal = $('#modal');
  if (!modal) return;
  modal.innerHTML = `<form class="modal" data-autoturni-form novalidate>
    <header><h2>🔄 Rotazione Turni (${esc(meseLabel)})</h2><button type="button" class="btn small" data-action="close-modal">✕</button></header>
    <div class="body">
      <p class="sub" style="margin-top:0">Genera automaticamente i turni diurni e notturni del mese.</p>
      <div class="form-grid">
        <div class="field"><label>Gruppo di partenza (1° del mese)</label>
          <select name="start_gruppo">${GRUPPI_TURNO.map(g => `<option>${g}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Modalità</label>
          <select name="overwrite">
            <option value="skip">Aggiungi solo nei giorni vuoti</option>
            <option value="replace">Sostituisci esistenti</option>
          </select>
        </div>
      </div>
    </div>
    <footer><button type="button" class="btn" data-action="close-modal">Annulla</button><button type="submit" class="btn primary">Genera Turni</button></footer>
  </form>`;
  modal.hidden = false;
}

function closeModal() {
  const modal = $('#modal');
  if (!modal) return;
  modal.hidden = true;
  modal.innerHTML = '';
}

function submitForm(form) {
  const name = form.dataset.name, id = form.dataset.id ? +form.dataset.id : null, S = SCHEMA[name];
  const rec = {}; let missing = [];
  S.fields.forEach(f => {
    if (f.s) return;
    const el = form.elements[f.k];
    if (!el) return;
    if (f.t === 'multiref') {
      rec[f.k] = Array.from(el.selectedOptions).map(o => +o.value);
      return;
    }
    let v = el.value.trim();
    if (f.req && !v) missing.push(f.l);
    if (f.t === 'number') v = v === '' ? null : parseFloat(v);
    else if (f.t === 'ref') v = v === '' ? null : +v;
    rec[f.k] = v;
  });

  const err = $('#form-error');
  if (missing.length) {
    if (err) { err.textContent = 'Compila i campi obbligatori: ' + missing.join(', ') + '.'; err.hidden = false; }
    return;
  }

  if (id) {
    const idx = (DB[name] || []).findIndex(x => x.id === id);
    if (idx >= 0) DB[name][idx] = { ...DB[name][idx], ...rec, id };
  } else {
    if (!DB[name]) DB[name] = [];
    DB[name].push({ ...rec, id: nextId(name) });
  }

  saveDB();
  closeModal();
  render();
  toast('Salvato con successo.');
}

function del(name, id) {
  if (!confirm(`Eliminare questo record?`)) return;
  DB[name] = (DB[name] || []).filter(x => x.id !== id);
  saveDB();
  closeModal();
  render();
  toast('Record eliminato.');
}

/* ---------- CSV, ICS & Stampa ---------- */
function downloadCsv(filename, header, rows) {
  const q = v => { v = String(v ?? ''); return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const text = '\uFEFF' + [header, ...rows].map(r => r.map(q).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = filename; document.body.appendChild(a); a.click(); a.remove();
}
function csvOf(name) {
  const S = SCHEMA[name];
  const csvVal = (c, r) => { const v = c.v(r); return v === '9999' ? '' : v; };
  downloadCsv(`autorimessa-${name}-${todayStr()}.csv`, S.cols.map(c => c.l), visibleRows(name).map(r => S.cols.map(c => csvVal(c, r))));
}

function exportTurniIcs() {
  if (!(DB.turni || []).length) return toast('Nessun turno da esportare.', true);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Autorimessa VVF//Turni 12h//IT'];
  DB.turni.forEach(t => {
    if (!t || !t.data) return;
    const cleanDate = t.data.replace(/-/g, '');
    const isNotte = (t.fascia || '').toLowerCase().includes('notturno');
    const dtStart = isNotte ? `${cleanDate}T200000` : `${cleanDate}T080000`;
    let dtEnd;
    if (isNotte) {
      const next = new Date(t.data + 'T00:00:00');
      next.setDate(next.getDate() + 1);
      dtEnd = `${ymd(next).replace(/-/g, '')}T080000`;
    } else {
      dtEnd = `${cleanDate}T200000`;
    }
    const pers = (t.personale_ids || []).map(nomeVigile).filter(Boolean).join(', ');
    lines.push(
      'BEGIN:VEVENT',
      `UID:turno-${t.id}@autorimessa-vvf`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${t.gruppo} - ${t.fascia}`,
      `DESCRIPTION:Personale: ${pers || 'Da definire'}`,
      'END:VEVENT'
    );
  });
  lines.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' }));
  a.download = `turni-autorimessa-${todayStr()}.ics`;
  a.click();
  toast('File calendario .ics scaricato!');
}

function printServizio(id) {
  const s = IDX.servizi.get(id); if (!s) return;
  const row = (l, x) => `<tr><th>${l}</th><td>${esc(x ?? '—')}</td></tr>`;
  const printArea = $('#printArea');
  if (!printArea) return;
  printArea.innerHTML = `<div class="sheet">
    <div class="company"><strong>CORPO NAZIONALE VIGILI DEL FUOCO</strong><br>${esc(DB.settings.comando)}</div>
    <h1>RAPPORTINO USCITA / SERVIZIO DI SOCCORSO</h1>
    <p>Data: <strong>${fmtDate(s.data)}</strong> &nbsp;|&nbsp; Ora Uscita: <strong>${esc(s.ora_uscita)}</strong> &nbsp;|&nbsp; Ora Rientro: <strong>${esc(s.ora_rientro || 'In corso')}</strong></p>
    <table>
      ${row('Tipologia Intervento', s.tipologia)}
      ${row('Località / Indirizzo', s.luogo)}
      ${row('Mezzo Impiegato', labelMezzo(s.mezzo_id))}
      ${row('Capo Squadra', nomeVigile(s.caposquadra_id))}
      ${row('Autista', nomeVigile(s.autista_id))}
      ${row('1ª Lancia', nomeVigile(s.prima_lancia_id))}
      ${row('2ª Lancia', nomeVigile(s.seconda_lancia_id))}
      ${row('3ª Lancia', nomeVigile(s.terza_lancia_id))}
      ${row('Km Percorsi', s.km_percorsi ? s.km_percorsi + ' km' : '')}
      ${row('Note Operative', s.note)}
    </table>
    <div class="sign"><div>Firma del Capo Squadra</div><div>Visto il Capo Turno / Responsabile Autorimessa</div></div>
  </div>`;
  document.body.classList.add('printing-sheet');
  window.print();
  document.body.classList.remove('printing-sheet');
}

/* ---------- viste speciali ---------- */
const VIEWS = {};

VIEWS.dashboard = main => {
  const now = new Date();
  const scad = tutteScadenze(), urg = scad.filter(s => s.stato !== 'ok');
  const serviziAperti = (DB.servizi || []).filter(s => s && s.stato === 'Aperto / In corso');
  const mezziOp = (DB.mezzi || []).filter(m => m && m.stato === 'Operativo').length;
  const turniOggi = (DB.turni || []).filter(t => t && t.data === todayStr());
  const guastiAttr = (DB.report_attrezzatura || []).filter(a => a && a.stato !== 'Integro').length;

  main.innerHTML = `
    <div class="mobile-topbar no-print">
      <button class="btn small" id="sidebar-toggle" aria-label="Apri menu">☰ Menu</button>
      <span class="mobile-title">Cruscotto VVF</span>
    </div>
    <div class="page-head">
      <h1>📊 Cruscotto Autorimessa</h1>
      <span class="sub">${now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
      <span class="spacer"></span>
      <button class="btn info" data-action="new" data-name="turni">+ Turno</button>
      <button class="btn primary" data-action="new" data-name="servizi">🚨 Servizio</button>
    </div>

    ${renderAdBlueBanner()}

    <div class="grid kpis">
      <div class="kpi ${serviziAperti.length ? 'alert' : ''}">
        <div class="label">Servizi Aperti</div>
        <div class="value">${serviziAperti.length}</div>
        <div class="note">${(DB.servizi || []).length} totali</div>
      </div>
      <div class="kpi">
        <div class="label">Mezzi Operativi</div>
        <div class="value">${mezziOp} / ${(DB.mezzi || []).length}</div>
        <div class="note">In officina/fuori: ${(DB.mezzi || []).filter(m => m && m.stato !== 'Operativo').length}</div>
      </div>
      <div class="kpi">
        <div class="label">Turni Oggi</div>
        <div class="value">${turniOggi.length}</div>
        <div class="note">${turniOggi.map(t => t.gruppo).join(' · ') || 'Nessuno'}</div>
      </div>
      <div class="kpi ${urg.length ? 'alert' : ''}">
        <div class="label">Scadenze</div>
        <div class="value">${urg.length}</div>
        <div class="note">${urg.filter(s => s.stato === 'scaduta').length} scadute</div>
      </div>
      <div class="kpi ${guastiAttr ? 'alert' : ''}">
        <div class="label">Attrezzature</div>
        <div class="value">${guastiAttr}</div>
        <div class="note">da verificare</div>
      </div>
    </div>

    <div class="grid two">
      <div class="panel">
        <h2>🚨 Servizi Recenti</h2>
        ${(DB.servizi || []).length ? `<div class="table-wrap"><table><thead><tr><th class="nosort">Data</th><th class="nosort">Intervento</th><th class="nosort">Mezzo</th><th class="nosort">Stato</th></tr></thead><tbody>
          ${(DB.servizi || []).slice().sort((a, b) => (b.data || '').localeCompare(a.data || '')).slice(0, 5).map(s => `<tr>
            <td>${fmtDate(s.data)}</td>
            <td><strong>${esc(s.tipologia)}</strong></td>
            <td>${esc(labelMezzo(s.mezzo_id))}</td>
            <td>${badge(s.stato)}</td>
          </tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nessun servizio.</div>'}
      </div>

      <div class="panel">
        <h2>⏰ Scadenze Imminenti</h2>
        ${scad.length ? `<ul class="list-plain">${scad.slice(0, 5).map(s => `<li>
          <div class="grow"><strong>${esc(s.chi)}</strong> — ${esc(s.voce)}<div class="meta">${s.tipo} · ${fmtDate(s.data)}</div></div>
          ${scadBadge(s)}
        </li>`).join('')}</ul>` : '<div class="empty">Nessuna scadenza.</div>'}
        <p style="margin:10px 0 0"><a href="#/scadenze">Tutte le scadenze →</a></p>
      </div>
    </div>`;
};

function scadBadge(s) {
  const cls = s.stato === 'scaduta' ? 'bad' : s.stato === 'in scadenza' ? 'warn' : 'ok';
  const txt = s.giorni < 0 ? `scaduta da ${-s.giorni} g` : s.giorni === 0 ? 'oggi' : `tra ${s.giorni} g`;
  return badge(txt, cls);
}

VIEWS.calendario = main => {
  const d = UI.calDate || new Date();
  const y = d.getFullYear(), m = d.getMonth();
  const firstDay = new Date(y, m, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const monthName = firstDay.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  const grpFilter = UI.calFilterGruppo || '';

  const grpClass = g => g === 'Turno A' ? 'grp-A' : g === 'Turno B' ? 'grp-B' : g === 'Turno C' ? 'grp-C' : 'grp-D';

  let cells = '';
  for (let i = 0; i < startOffset; i++) cells += `<div class="cal-day muted"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${y}-${pad(m + 1)}-${pad(day)}`;
    const turniGiorno = (DB.turni || [])
      .filter(t => t && t.data === dateStr && (!grpFilter || t.gruppo === grpFilter))
      .sort((a, b) => (a.fascia || '').localeCompare(b.fascia || ''));
    const isToday = dateStr === todayStr();

    cells += `<div class="cal-day ${isToday ? 'today' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="cal-num">${day}</span>
        <button class="btn small" style="padding:0 4px;font-size:11px" data-action="new-turno-day" data-date="${dateStr}">+</button>
      </div>
      ${turniGiorno.map(t => {
        const isNotte = (t.fascia || '').toLowerCase().includes('notturno');
        return `<div class="cal-ev ${grpClass(t.gruppo)}" data-action="edit" data-name="turni" data-id="${t.id}">
          <strong>${isNotte ? '🌙' : '☀️'} ${esc(t.gruppo)}</strong>
        </div>`;
      }).join('')}
    </div>`;
  }

  main.innerHTML = `
    <div class="mobile-topbar no-print">
      <button class="btn small" id="sidebar-toggle" aria-label="Apri menu">☰ Menu</button>
      <span class="mobile-title">Calendario</span>
    </div>
    <div class="page-head">
      <h1>🗓️ Calendario Turni</h1>
      <span class="spacer"></span>
      <button class="btn" data-action="export-ics">📥 .ICS</button>
      <button class="btn info" data-action="open-autoturni">🔄 Mese</button>
      <button class="btn primary" data-action="new" data-name="turni">+ Turno</button>
    </div>
    <div class="panel">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <button class="btn small" data-action="cal-prev">◀</button>
        <strong style="font-size:15px;text-transform:capitalize;min-width:140px;text-align:center">${esc(monthName)}</strong>
        <button class="btn small" data-action="cal-next">▶</button>
        <button class="btn small" data-action="cal-today">Oggi</button>
        <select data-filter="cal-gruppo" style="border:1px solid var(--line);border-radius:8px;padding:5px 8px;background:#fff">
          <option value="">Tutti i Gruppi</option>
          ${GRUPPI_TURNO.map(g => `<option ${grpFilter === g ? 'selected' : ''}>${g}</option>`).join('')}
        </select>
      </div>
      <div style="overflow-x:auto; margin-top:12px;">
        <div class="cal-grid" style="min-width:550px">
          <div class="cal-head">Lun</div><div class="cal-head">Mar</div><div class="cal-head">Mer</div>
          <div class="cal-head">Gio</div><div class="cal-head">Ven</div><div class="cal-head">Sab</div><div class="cal-head">Dom</div>
          ${cells}
        </div>
      </div>
    </div>`;
};

VIEWS.scadenze = main => {
  const st = UI.scad ||= { f: '' };
  const all = tutteScadenze(), rows = all.filter(s => !st.f || s.stato === st.f);
  main.innerHTML = `
    <div class="mobile-topbar no-print">
      <button class="btn small" id="sidebar-toggle" aria-label="Apri menu">☰ Menu</button>
      <span class="mobile-title">Scadenze</span>
    </div>
    <div class="page-head"><h1>⏰ Scadenze</h1><span class="sub">Avviso ${soglia()} giorni prima</span></div>
    <div class="toolbar"><select data-filter="scad"><option value="">Tutte (${all.length})</option>
      <option value="scaduta" ${st.f === 'scaduta' ? 'selected' : ''}>Scadute</option>
      <option value="in scadenza" ${st.f === 'in scadenza' ? 'selected' : ''}>In scadenza</option>
      <option value="ok" ${st.f === 'ok' ? 'selected' : ''}>Regolari</option></select></div>
    <div class="table-wrap">${rows.length ? `<table><thead><tr><th class="nosort">Stato</th><th class="nosort">Data</th><th class="nosort">Ambito</th><th class="nosort">Mezzo / Vigile</th><th class="nosort">Scadenza</th><th class="nosort"></th></tr></thead><tbody>
    ${rows.map(s => `<tr><td>${scadBadge(s)}</td><td>${fmtDate(s.data)}</td><td>${s.tipo}</td><td><strong>${esc(s.chi)}</strong></td><td>${esc(s.voce)}</td><td class="actions"><button class="btn small" data-action="edit" data-name="${s.vista}" data-id="${s.id}">Apri</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nessuna scadenza.</div>'}</div>`;
};

VIEWS.impostazioni = main => {
  const s = DB.settings || {};
  main.innerHTML = `
    <div class="mobile-topbar no-print">
      <button class="btn small" id="sidebar-toggle" aria-label="Apri menu">☰ Menu</button>
      <span class="mobile-title">Impostazioni</span>
    </div>
    <div class="page-head"><h1>⚙️ Impostazioni & Backup</h1></div>
  <form class="panel settings-block" data-settings><h2>Dati Comando</h2>
    <div class="form-grid">
      <div class="field full"><label>Nome Comando / Distaccamento</label><input name="comando" value="${esc(s.comando)}"></div>
      <div class="field"><label>Giorni preavviso</label><input name="giorni_avviso" type="number" min="1" max="365" value="${soglia()}"></div>
      <div class="field"><label>Litri tanica AdBlue</label><input name="litri_per_tanica" type="number" min="1" value="${s.litri_per_tanica || 20}"></div>
    </div>
    <p style="margin:14px 0 0"><button class="btn primary" type="submit">Salva Impostazioni</button></p>
  </form>
  <div class="panel settings-block"><h2>Backup Dati (JSON)</h2>
    <div class="row-btns" style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn" data-action="export-json">⬇ Scarica JSON</button>
      <label class="btn" style="cursor:pointer">⬆ Ripristina<input type="file" accept=".json,application/json" data-restore hidden></label>
      <button class="btn danger" data-action="reset-demo">Ripristina Demo</button>
    </div>
  </div>`;
};

/* ---------- eventi ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el) {
    const d = el.dataset;
    switch (d.action) {
      case 'go': go(d.to); toggleSidebar(false); break;
      case 'new': openForm(d.name); break;
      case 'new-turno-day': openForm('turni', null, { data: d.date }); break;
      case 'edit': openForm(d.name, +d.id); break;
      case 'del': del(d.name, +d.id); break;
      case 'del-modal': del(d.name, +d.id); break;
      case 'close-modal': closeModal(); break;
      case 'csv': csvOf(d.name); break;
      case 'export-ics': exportTurniIcs(); break;
      case 'print-servizio': printServizio(+d.id); break;
      case 'edit-adblue': openAdBlueModal(); break;
      case 'open-autoturni': openAutoTurniModal(); break;
      case 'cal-prev': UI.calDate = new Date(UI.calDate.getFullYear(), UI.calDate.getMonth() - 1, 1); VIEWS.calendario($('#main')); break;
      case 'cal-next': UI.calDate = new Date(UI.calDate.getFullYear(), UI.calDate.getMonth() + 1, 1); VIEWS.calendario($('#main')); break;
      case 'cal-today': UI.calDate = new Date(); VIEWS.calendario($('#main')); break;
      case 'sort': {
        const st = listState(d.name);
        st.sort = [d.col, st.sort[0] === d.col && st.sort[1] === 'asc' ? 'desc' : 'asc'];
        updateTable(d.name); break;
      }
      case 'export-json': {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' }));
        a.download = `backup-autorimessa-${todayStr()}.json`;
        a.click();
        break;
      }
      case 'reset-demo':
        if (confirm('Ripristinare i dati dimostrativi?')) {
          seedDemoData(); saveDB(); render(); toast('Dati ripristinati.');
        }
        break;
    }
  }
  if (e.target.closest('#sidebar-toggle')) { toggleSidebar(true); return; }
  if (e.target.closest('#sidebar-close') || e.target.closest('#sidebar-overlay')) { toggleSidebar(false); return; }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#modal')?.hidden) closeModal();
});

document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  if (f.matches('form.modal')) return submitForm(f);
  if (f.matches('[data-adblue-form]')) {
    const fd = new FormData(f);
    DB.settings.adblue_litri = parseFloat(fd.get('adblue_litri')) || 0;
    DB.settings.adblue_taniche = parseInt(fd.get('adblue_taniche'), 10) || 0;
    DB.settings.litri_per_tanica = parseInt(fd.get('litri_per_tanica'), 10) || 20;
    saveDB(); closeModal(); render(); toast('AdBlue aggiornato.');
  }
  if (f.matches('[data-autoturni-form]')) {
    const fd = new FormData(f);
    const startGrp = fd.get('start_gruppo');
    const overwrite = fd.get('overwrite') === 'replace';
    const d = UI.calDate || new Date();
    const y = d.getFullYear(), m = d.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const monthPrefix = `${y}-${pad(m + 1)}-`;

    if (!DB.turni) DB.turni = [];
    if (overwrite) {
      DB.turni = DB.turni.filter(t => t && !t.data.startsWith(monthPrefix));
    }

    const startIdx = GRUPPI_TURNO.indexOf(startGrp);
    let creati = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${monthPrefix}${pad(day)}`;
      const grpDiurno = GRUPPI_TURNO[(startIdx + day - 1) % 4];
      const grpNotturno = GRUPPI_TURNO[(startIdx + day + 2) % 4];

      [
        { fascia: FASCE_12H[0], gruppo: grpDiurno },
        { fascia: FASCE_12H[1], gruppo: grpNotturno }
      ].forEach(slot => {
        const exists = DB.turni.some(t => t && t.data === dateStr && t.fascia === slot.fascia);
        if (!exists) {
          const membri = (DB.vigili || []).filter(v => v && v.gruppo === slot.gruppo && v.stato === 'In servizio').map(v => v.id);
          DB.turni.push({
            id: nextId('turni'),
            data: dateStr,
            fascia: slot.fascia,
            gruppo: slot.gruppo,
            capoturno_id: membri[0] || null,
            personale_ids: membri,
            note: 'Rotazione automatica'
          });
          creati++;
        }
      });
    }
    saveDB(); closeModal(); render();
    toast(`Creati ${creati} turni.`);
  }
  if (f.matches('[data-settings]')) {
    const obj = Object.fromEntries(new FormData(f).entries());
    DB.settings = { ...DB.settings, ...obj };
    saveDB(); renderNav(); toast('Impostazioni salvate.');
  }
});

function onFilter(e) {
  const el = e.target.closest('[data-filter]'); if (!el) return;
  const k = el.dataset.filter;
  if (k === 'scad') { UI.scad.f = el.value; return VIEWS.scadenze($('#main')); }
  if (k === 'cal-gruppo') { UI.calFilterGruppo = el.value; return VIEWS.calendario($('#main')); }
  listState(el.dataset.name)[k] = el.value; updateTable(el.dataset.name);
}
document.addEventListener('input', e => { if (e.target.matches('input[type=search]')) onFilter(e); });
document.addEventListener('change', async e => {
  if (e.target.matches('select[data-filter], input[type=date][data-filter]')) onFilter(e);
  if (e.target.matches('[data-restore]')) {
    const file = e.target.files[0]; if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      DB = { ...DB, ...parsed };
      saveDB(); render(); toast('Backup ripristinato.');
    } catch (err) { toast('File non valido.', true); }
    e.target.value = '';
  }
});
window.addEventListener('hashchange', render);

function seedDemoData() {
  const today = todayStr();
  DB.vigili = [
    { id: 1, qualifica: 'CS', cognome: 'Rossi', nome: 'Marco', gruppo: 'Turno A', patente: '3° Grado', telefono: '333-1122334', stato: 'In servizio', scad_visita: '2027-04-15' },
    { id: 2, qualifica: 'VP', cognome: 'Bianchi', nome: 'Luca', gruppo: 'Turno A', patente: '3° Grado', telefono: '333-2233445', stato: 'In servizio', scad_visita: '2026-12-01' }
  ];
  DB.mezzi = [
    { id: 1, sigla: 'APS 1', tipo: 'APS (Autopompa serbatoio)', targa: 'VF 28410', marca_modello: 'Iveco Eurocargo', anno: 2021, km_attuali: 42300, stato: 'Operativo', scad_revisione: '2026-12-15' },
    { id: 2, sigla: 'ABP 1', tipo: 'ABP (Autobotte)', targa: 'VF 25119', marca_modello: 'Iveco Trakker', anno: 2019, km_attuali: 31800, stato: 'Operativo', scad_revisione: '2027-03-10' }
  ];
  DB.turni = [
    { id: 1, data: today, fascia: 'Diurno (08:00 - 20:00)', gruppo: 'Turno A', capoturno_id: 1, personale_ids: [1, 2] }
  ];
  DB.squadre = [
    { id: 1, nome: '1ª Partenza', tipo: 'Squadra Ordinaria (5 unità)', turno_id: 1, mezzo_id: 1, caposquadra_id: 1, autista_id: 2 }
  ];
  DB.servizi = [
    { id: 1, data: today, ora_uscita: '09:15', stato: 'Aperto / In corso', tipologia: 'Incendio sterpaglie', luogo: 'Via Roma', mezzo_id: 1, caposquadra_id: 1, autista_id: 2 }
  ];
  DB.manutenzioni = [];
  DB.magazzino = [
    { id: 1, nome: 'Olio Motore', categoria: 'Lubrificanti e Liquidi', quantita: 45, unita: 'litri', scorta_min: 20 }
  ];
  DB.report_attrezzatura = [];
}

/* ---------- avvio sicuro ---------- */
try {
  loadDB();
  render();
} catch (err) {
  console.error('Errore fatale all’avvio:', err);
  localStorage.removeItem(STORAGE_KEY);
  seedDemoData();
  render();
}
