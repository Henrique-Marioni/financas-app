'use strict';

/* ============================================================
   Minhas Finanças — PWA offline. Dados salvos no localStorage.
   ============================================================ */

const STORAGE_KEY = 'financas.v1';          // a chave continua a mesma; a versão fica dentro do objeto
const PRE_V2_KEY = 'financas.v1.pre-v2';    // cópia bruta do estado v1, guardada antes de migrar
const APP_VERSION = '5';
const TIPOS = {
  in: ['Extra', 'Salário', 'Outra entrada'],
  out: ['Avulso', 'Conta'],
  transf: ['Transferência'],
};
const TIPO_CONTA = { banco: 'Banco', dinheiro: 'Dinheiro' };
const CATEGORIAS_PADRAO = ['Alimentação', 'Mercado', 'Casa', 'Transporte', 'Saúde', 'Lazer', 'Compras', 'Dívidas', 'Outros'];

const ICON_CONTA = {
  banco: '<svg viewBox="0 0 24 24"><path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/></svg>',
  dinheiro: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/></svg>',
};

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

/* ---------------- Estado ---------------- */

function defaultState() {
  return {
    version: 2,
    settings: { inicioMes: '', extraQuiSex: 200, extraSabBase: 400, extraSabTeto: 600, lastBackup: null, ultimaContaId: null },
    contas: [],
    items: [],
    seq: 1,
  };
}

function novaContaId() { return 'c' + uid(); }

/**
 * Converte qualquer estado salvo (v1 ou v2) para o formato v2.
 * Idempotente: rodar duas vezes dá o mesmo resultado.
 * v1 → v2: o "saldo inicial em conta" vira o saldo inicial de uma conta "Conta principal",
 * e todos os lançamentos passam a pertencer a ela.
 */
function migrate(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const d = defaultState();
  const settingsIn = s.settings && typeof s.settings === 'object' ? s.settings : {};
  const st = {
    ...d, ...s,
    settings: { ...d.settings, ...settingsIn },
    contas: Array.isArray(s.contas) ? s.contas.filter((c) => c && typeof c === 'object') : [],
    items: Array.isArray(s.items) ? s.items.filter((i) => i && typeof i === 'object') : [],
  };

  // contas: normaliza campos
  const vistos = new Set();
  st.contas = st.contas.map((c) => {
    let id = c.id ? String(c.id) : novaContaId();
    if (vistos.has(id)) id = novaContaId();
    vistos.add(id);
    return {
      id,
      nome: String(c.nome ?? '').trim().slice(0, 40) || 'Conta',
      tipo: c.tipo === 'dinheiro' ? 'dinheiro' : 'banco',
      saldoInicial: round2(Number(c.saldoInicial) || 0),
      arquivada: !!c.arquivada,
    };
  });

  // v1 (ou estado vazio): cria a conta principal com o saldo inicial antigo
  if (!st.contas.length) {
    st.contas.push({
      id: novaContaId(), nome: 'Conta principal', tipo: 'banco',
      saldoInicial: round2(Number(settingsIn.saldoInicial) || 0), arquivada: false,
    });
  }
  // sempre pelo menos uma conta ativa
  if (!st.contas.some((c) => !c.arquivada)) st.contas[0].arquivada = false;
  delete st.settings.saldoInicial; // agora o saldo inicial mora em cada conta

  // V10: lançamento sem conta (ou com conta que não existe mais) vai para a primeira conta ativa
  const ids = new Set(st.contas.map((c) => c.id));
  const primeira = (st.contas.find((c) => !c.arquivada) || st.contas[0]).id;
  for (const it of st.items) {
    if (!ids.has(it.contaId)) it.contaId = primeira;
    if (it.kind === 'transf') {
      it.tipo = 'Transferência';
      it.categoria = '';
      if (!ids.has(it.contaDestinoId)) it.contaDestinoId = (st.contas.find((c) => c.id !== it.contaId) || st.contas[0]).id;
    } else if ('contaDestinoId' in it) {
      delete it.contaDestinoId;
    }
  }
  if (!ids.has(st.settings.ultimaContaId)) st.settings.ultimaContaId = null;
  st.seq = Number(st.seq) || 1;
  st.version = 2;
  return st;
}

function guardarPreV2(rawText) {
  try {
    if (localStorage.getItem(PRE_V2_KEY) == null) localStorage.setItem(PRE_V2_KEY, rawText);
  } catch (e) { console.warn('pre-v2', e); }
}

let migrouNoLoad = false;
let state = null; // carregado em "Inicialização", depois que todas as utilidades existem
let viewMonth = monthOf(todayISO());
let filtro = 'todos';
let filtroConta = '';
let editingId = null;
let pendingImport = null;
let editingContaId = null;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return migrate(defaultState());
    const s = JSON.parse(raw);
    if (!(s && s.version >= 2)) { guardarPreV2(raw); migrouNoLoad = true; }
    return migrate(s);
  } catch (e) {
    console.error(e);
    return migrate(defaultState());
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Não foi possível salvar: ' + e.message);
  }
}

/* ---------------- Utilidades ---------------- */

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (v) => fmtBRL.format(Math.round((v || 0) * 100) / 100);
const round2 = (v) => Math.round(v * 100) / 100;
/** Dinheiro em centavos inteiros: somar inteiros não tem erro de ponto flutuante. */
const cents = (v) => Math.round((Number(v) || 0) * 100);

function pad(n) { return String(n).padStart(2, '0'); }
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function monthOf(iso) { return iso.slice(0, 7); }
function addMonths(ym, n) {
  let [y, m] = ym.split('-').map(Number);
  m += n;
  while (m > 12) { m -= 12; y++; }
  while (m < 1) { m += 12; y--; }
  return `${y}-${pad(m)}`;
}
function daysInMonth(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); }
function dateFromISO(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
function weekday(iso) { return dateFromISO(iso).getDay(); }

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function dayLabel(iso) {
  const s = dateFromISO(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace(/\./g, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function norm(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[?:]/g, '').trim();
}

/** Aceita "1.234,56", "1234.56", "53,90+53,90", "R$ 200". */
function parseValor(input) {
  if (typeof input === 'number') return input;
  const s = String(input ?? '').replace(/R\$|\s/g, '');
  if (!s) return NaN;
  return s.split('+').reduce((acc, part) => {
    let p = part;
    if (p.includes(',')) p = p.replace(/\./g, '').replace(',', '.');
    const n = Number(p);
    return acc + (isFinite(n) ? n : NaN);
  }, 0);
}
function valorToInput(v) { return v ? String(round2(v)).replace('.', ',') : ''; }

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- Contas ---------------- */

function contaById(id) { return state.contas.find((c) => c.id === id) || null; }
function contaNome(id) { const c = contaById(id); return c ? c.nome : '?'; }
function contasAtivas() { return state.contas.filter((c) => !c.arquivada); }
/** Conta sugerida em lançamentos novos: a última usada, se ainda ativa; senão a primeira ativa. */
function contaPadraoId() {
  const u = contaById(state.settings.ultimaContaId);
  if (u && !u.arquivada) return u.id;
  return (contasAtivas()[0] || state.contas[0]).id;
}
function lancamentosDaConta(id) { return state.items.filter((i) => i.contaId === id || i.contaDestinoId === id).length; }

/* ---------------- Cálculos ---------------- */

function sortedItems() {
  return [...state.items].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : (a.ord || 0) - (b.ord || 0)));
}

function contaNoSaldo(it) {
  const ini = state.settings.inicioMes;
  return !ini || monthOf(it.data) >= ini;
}

/** Efeito no saldo TOTAL, em centavos. Transferência só move entre contas: efeito total zero. */
function signedC(it) {
  if (it.kind === 'transf') return 0;
  return it.kind === 'in' ? cents(it.valor) : -cents(it.valor);
}
function signed(it) { return signedC(it) / 100; }

/** Efeito do lançamento em UMA conta, em centavos (C1, C2, C3). */
function deltaConta(it, contaId) {
  const c = cents(it.valor);
  if (it.kind === 'transf') return (it.contaId === contaId ? -c : 0) + (it.contaDestinoId === contaId ? c : 0);
  if (it.contaId !== contaId) return 0;
  return it.kind === 'in' ? c : -c;
}

function saldoInicialC(contaId) {
  if (contaId) return cents(contaById(contaId)?.saldoInicial);
  return state.contas.reduce((a, c) => a + cents(c.saldoInicial), 0);
}

/**
 * Saldos de cada conta, em centavos.
 * real = saldo inicial + realizados do período (C5).
 * prev = saldo inicial + todos (realizados e pendentes) com data <= ateISO (C6); sem ateISO, todos.
 */
function saldosPorConta(ateISO) {
  const m = new Map(state.contas.map((c) => [c.id, { conta: c, real: cents(c.saldoInicial), prev: cents(c.saldoInicial) }]));
  const add = (id, it, v) => {
    const o = m.get(id);
    if (!o) return;
    if (it.realizado) o.real += v;
    if (!ateISO || it.data <= ateISO) o.prev += v;
  };
  for (const it of state.items) {
    if (!contaNoSaldo(it)) continue; // C4: fora do período, ignora inteiro (inclusive transferência)
    const c = cents(it.valor);
    if (it.kind === 'transf') { add(it.contaId, it, -c); add(it.contaDestinoId, it, c); }
    else add(it.contaId, it, it.kind === 'in' ? c : -c);
  }
  return [...m.values()];
}

/** Saldo previsto e real acumulados após cada lançamento (total, ou de uma conta). */
function computeRunning(contaId) {
  const run = new Map();
  let prev = saldoInicialC(contaId);
  let real = prev;
  for (const it of sortedItems()) {
    if (contaNoSaldo(it)) {
      const d = contaId ? deltaConta(it, contaId) : signedC(it);
      prev += d;
      if (it.realizado) real += d;
    }
    run.set(it.id, { prev: prev / 100, real: real / 100 });
  }
  return run;
}

function saldoAte(isoInclusive, soRealizados) {
  let s = saldoInicialC();
  for (const it of state.items) {
    if (!contaNoSaldo(it) || it.data > isoInclusive) continue;
    if (soRealizados && !it.realizado) continue;
    s += signedC(it);
  }
  return s / 100;
}

/** C9: total real = soma dos saldos reais de todas as contas (arquivadas inclusas). */
function saldoRealAtual() {
  return saldosPorConta().reduce((a, s) => a + s.real, 0) / 100;
}

function monthItems(ym) { return sortedItems().filter((it) => monthOf(it.data) === ym); }

function monthStats(ym) {
  const items = monthItems(ym);
  const c = { salarios: 0, extras: 0, outrasEntradas: 0, contas: 0, avulsos: 0, aReceber: 0, aPagar: 0 };
  let sabados = 0, pend = 0;
  for (const it of items) {
    if (!it.realizado) pend++;               // C13: transferência conta em n e pend
    if (it.kind === 'transf') continue;      // C12: e fica fora de todos os totais
    const v = cents(it.valor);
    if (!it.realizado) { if (it.kind === 'in') c.aReceber += v; else c.aPagar += v; }
    if (it.kind === 'in') {
      if (it.tipo === 'Salário') c.salarios += v;
      else if (it.tipo === 'Extra') { c.extras += v; if (weekday(it.data) === 6) sabados++; }
      else c.outrasEntradas += v;
    } else if (it.tipo === 'Avulso') c.avulsos += v;
    else c.contas += v;
  }
  const st = { n: items.length, pend, sabados };
  for (const k in c) st[k] = c[k] / 100;
  const ent = c.salarios + c.extras + c.outrasEntradas;
  const sai = c.contas + c.avulsos;
  st.entradas = ent / 100;
  st.saidas = sai / 100;
  st.resultado = (ent - sai) / 100;
  const ultimoDia = `${ym}-${pad(daysInMonth(ym))}`;
  st.porConta = saldosPorConta(ultimoDia);
  st.saldoFim = st.porConta.reduce((a, s) => a + s.prev, 0) / 100;

  // menor saldo previsto no mês (total; transferência repete o saldo anterior)
  const run = computeRunning();
  let min = null;
  for (const it of items) {
    const r = run.get(it.id);
    if (min === null || r.prev < min.v) min = { v: r.prev, data: it.data };
  }
  st.menor = min;
  return st;
}

/* ---------------- Render ---------------- */

function render() {
  $('#monthLabel').textContent = monthLabel(viewMonth);
  const st = monthStats(viewMonth);
  $('#monthSub').textContent = st.n ? `${st.n} lançamentos · ${st.pend} pendentes` : 'sem lançamentos';
  renderResumo(st);
  renderFiltroConta();
  renderLista();
  renderSettings();
}

function setMoney(el, v, colorize) {
  el.textContent = money(v);
  if (colorize) el.classList.toggle('neg', v < 0);
}

function renderResumo(st) {
  setMoney($('#saldoReal'), saldoRealAtual());
  setMoney($('#saldoFimMes'), st.saldoFim, true);
  setMoney($('#resultadoMes'), st.resultado, true);
  setMoney($('#totEntradas'), st.entradas);
  setMoney($('#totSaidas'), st.saidas);
  $('#entradasFoot').textContent = st.aReceber ? `${money(st.aReceber)} a receber` : 'tudo recebido';
  $('#saidasFoot').textContent = st.aPagar ? `${money(st.aPagar)} a pagar` : 'tudo pago';

  renderOndeEsta(st.porConta);

  // composição
  const rows = [
    ['Salários', st.salarios, 'var(--in)', st.entradas],
    ['Extras', st.extras, 'var(--in)', st.entradas],
    ['Outras entradas', st.outrasEntradas, 'var(--in)', st.entradas],
    ['Contas fixas', st.contas, 'var(--out)', st.saidas],
    ['Gastos avulsos', st.avulsos, 'var(--out)', st.saidas],
  ].filter((r) => r[1] > 0 || r[0] !== 'Outras entradas');
  $('#composicao').innerHTML = rows.map(([nome, v, cor, tot]) => {
    const pct = tot ? (v / tot) * 100 : 0;
    return `<div class="bar-row"><span>${nome} <span class="muted small">${pct.toFixed(0)}%</span></span><span class="v">${money(v)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${cor}"></div></div></div>`;
  }).join('');

  // atenção
  const s = state.settings;
  const ganhoTeto = st.sabados * ((Number(s.extraSabTeto) || 0) - (Number(s.extraSabBase) || 0));
  const lis = [];
  if (st.menor) lis.push(['Menor saldo previsto', `<span class="${st.menor.v < 0 ? 'neg' : ''}">${money(st.menor.v)}</span><br><span class="muted small">${dayLabel(st.menor.data)}</span>`]);
  lis.push(['A receber no mês', money(st.aReceber)]);
  lis.push(['A pagar no mês', money(st.aPagar)]);
  if (st.sabados) lis.push([`Sobra com sábado a ${money(s.extraSabTeto)}`, `${money(st.saldoFim + ganhoTeto)}<br><span class="muted small">+${money(ganhoTeto)} (${st.sabados} sáb.)</span>`]);
  $('#atencao').innerHTML = lis.map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('');

  renderChart();
}

/** Cartão "Onde está meu dinheiro": saldo real e previsto no fim do mês, por conta. */
function renderOndeEsta(porConta) {
  const visiveis = porConta.filter((s) => !s.conta.arquivada || s.real !== 0 || s.prev !== 0); // C10
  const totReal = porConta.reduce((a, s) => a + s.real, 0);
  const totPrev = porConta.reduce((a, s) => a + s.prev, 0);
  const neg = (c) => (c < 0 ? ' neg' : '');
  $('#ondeSub').textContent = `Saldo real hoje · previsto no fim de ${monthLabel(viewMonth).toLowerCase()}`;
  $('#ondeEsta').innerHTML = visiveis.map(({ conta, real, prev }) => `
    <div class="conta-row${conta.arquivada ? ' arq' : ''}">
      <span class="conta-ico">${ICON_CONTA[conta.tipo] || ICON_CONTA.banco}</span>
      <span class="conta-info"><span class="conta-nome">${escapeHtml(conta.nome)}${conta.arquivada ? ' <span class="muted">(arquivada)</span>' : ''}</span>
        <small>fim do mês: <span class="${neg(prev)}">${money(prev / 100)}</span></small></span>
      <span class="conta-val${neg(real)}">${money(real / 100)}</span>
    </div>`).join('') + `
    <div class="conta-row total">
      <span class="conta-info"><span class="conta-nome">Total</span>
        <small>fim do mês: <span class="${neg(totPrev)}">${money(totPrev / 100)}</span></small></span>
      <span class="conta-val${neg(totReal)}">${money(totReal / 100)}</span>
    </div>`;
}

function renderChart() {
  const ym = viewMonth;
  const nd = daysInMonth(ym);
  const today = todayISO();
  const prevStart = cents(saldoAte(`${addMonths(ym, -1)}-31`, false));
  const realStart = cents(saldoAte(`${addMonths(ym, -1)}-31`, true));
  const items = monthItems(ym).filter(contaNoSaldo);
  const prev = [], real = [];
  let p = prevStart, r = realStart;
  for (let d = 1; d <= nd; d++) {
    const iso = `${ym}-${pad(d)}`;
    for (const it of items) if (it.data === iso) { p += signedC(it); if (it.realizado) r += signedC(it); }
    prev.push(p / 100);
    if (iso <= today) real.push(r / 100);
  }
  // real também inclui realizados futuros (ex.: pagamento antecipado) no último ponto conhecido
  const W = 320, H = 160, padL = 4, padR = 4, padT = 14, padB = 18;
  const all = [...prev, ...real, 0];
  let min = Math.min(...all), max = Math.max(...all);
  if (max - min < 1) { max += 1; min -= 1; }
  const x = (i) => padL + (i / Math.max(nd - 1, 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const step = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const zeroY = y(0);
  const ticks = [1, 10, 20, nd].map((d) => `<text x="${x(d - 1)}" y="${H - 4}" font-size="9" fill="var(--muted)" text-anchor="${d === 1 ? 'start' : d === nd ? 'end' : 'middle'}" stroke="none">${d}</text>`).join('');
  $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Gráfico de saldo do mês">
    <line x1="0" x2="${W}" y1="${zeroY}" y2="${zeroY}" stroke="var(--line)" stroke-dasharray="3 3"/>
    <text x="${padL}" y="${padT - 4}" font-size="9" fill="var(--muted)" stroke="none">${money(max)}</text>
    <path d="${step(prev)}" stroke="var(--prev)" stroke-width="2" vector-effect="non-scaling-stroke"/>
    ${real.length ? `<path d="${step(real)}" stroke="var(--real)" stroke-width="2.5" vector-effect="non-scaling-stroke"/>` : ''}
    ${ticks}
  </svg>`;
}

function renderFiltroConta() {
  if (filtroConta && !contaById(filtroConta)) filtroConta = '';
  const sel = $('#filtroConta');
  sel.innerHTML = '<option value="">Todas as contas</option>' + state.contas.map((c) =>
    `<option value="${escapeHtml(c.id)}">${escapeHtml(c.nome)}${c.arquivada ? ' (arquivada)' : ''}</option>`).join('');
  sel.value = filtroConta;
  sel.classList.toggle('active', !!filtroConta);
}

function renderLista() {
  const run = computeRunning(filtroConta || undefined); // C17 / C18
  let items = monthItems(viewMonth);
  if (filtroConta) items = items.filter((i) => i.contaId === filtroConta || (i.kind === 'transf' && i.contaDestinoId === filtroConta));
  if (filtro === 'in') items = items.filter((i) => i.kind === 'in');
  else if (filtro === 'Conta') items = items.filter((i) => i.kind === 'out' && i.tipo !== 'Avulso');
  else if (filtro === 'Avulso') items = items.filter((i) => i.kind === 'out' && i.tipo === 'Avulso');
  else if (filtro === 'pend') items = items.filter((i) => !i.realizado);

  $('#listaVazia').hidden = items.length > 0;
  const groups = new Map();
  for (const it of items) { if (!groups.has(it.data)) groups.set(it.data, []); groups.get(it.data).push(it); }

  const efeito = (it) => (filtroConta ? deltaConta(it, filtroConta) : signedC(it));
  const check = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>';
  $('#lista').innerHTML = [...groups].map(([data, arr]) => {
    const net = arr.reduce((a, it) => a + efeito(it), 0) / 100;
    return `<div class="day"><div class="day-head"><span>${dayLabel(data)}${data === todayISO() ? ' · hoje' : ''}</span><span>${net === 0 && !filtroConta && arr.every((it) => it.kind === 'transf') ? '' : `${net >= 0 ? '+' : ''}${money(net)}`}</span></div>
      <div class="day-items">${arr.map((it) => {
        const r = run.get(it.id);
        const isT = it.kind === 'transf';
        // transferência: com descrição padrão, a linha principal vira "Origem → Destino"
        const rota = isT ? `${contaNome(it.contaId)} → ${contaNome(it.contaDestinoId)}` : '';
        const descPadrao = isT && (!String(it.desc || '').trim() || norm(it.desc) === 'transferencia');
        const desc = descPadrao ? rota : it.desc;
        const meta = isT
          ? (descPadrao ? 'Transferência' : rota)
          : [it.tipo, it.categoria, contaNome(it.contaId)].filter(Boolean).join(' · ');
        let amt;
        if (isT) {
          const sinal = filtroConta ? (deltaConta(it, filtroConta) >= 0 ? '+' : '−') : '';
          amt = `<span class="transf">${sinal}${money(it.valor)}</span>`;
        } else {
          amt = `<span class="${it.kind}">${it.kind === 'in' ? '+' : '−'}${money(it.valor)}</span>`;
        }
        return `<div class="item ${it.realizado ? '' : 'pend'}" data-id="${escapeHtml(it.id)}">
          <button class="check-btn ${it.realizado ? 'on' : ''}" data-toggle="${escapeHtml(it.id)}" aria-label="${it.realizado ? 'Marcar como pendente' : 'Marcar como realizado'}">${check}</button>
          <div class="info"><div class="desc">${escapeHtml(desc)}</div><div class="meta">${escapeHtml(meta)}</div></div>
          <div class="amt">${amt}<small>saldo ${money(r.prev)}</small></div>
        </div>`;
      }).join('')}</div></div>`;
  }).join('');
}

function renderSettings() {
  renderMinhasContas();
  const f = $('#formSettings');
  const s = state.settings;
  const lb = s.lastBackup ? new Date(s.lastBackup).toLocaleDateString('pt-BR') : 'nunca';
  $('#storageInfo').textContent = `${state.items.length} lançamentos e ${state.contas.length} contas salvos · último backup: ${lb}`;
  if (document.activeElement && f.contains(document.activeElement)) return;
  f.inicioMes.value = s.inicioMes || '';
  f.extraQuiSex.value = valorToInput(s.extraQuiSex);
  f.extraSabBase.value = valorToInput(s.extraSabBase);
  f.extraSabTeto.value = valorToInput(s.extraSabTeto);
}

/** Ajustes → Minhas contas: lista com saldo real atual. Ativas primeiro, arquivadas no fim. */
function renderMinhasContas() {
  const saldos = new Map(saldosPorConta().map((s) => [s.conta.id, s.real]));
  const ordem = [...contasAtivas(), ...state.contas.filter((c) => c.arquivada)];
  $('#listaContas').innerHTML = ordem.map((c) => {
    const real = saldos.get(c.id) || 0;
    return `<button type="button" class="conta-row tap${c.arquivada ? ' arq' : ''}" data-conta="${escapeHtml(c.id)}">
      <span class="conta-ico">${ICON_CONTA[c.tipo] || ICON_CONTA.banco}</span>
      <span class="conta-info"><span class="conta-nome">${escapeHtml(c.nome)}</span>
        <small>${TIPO_CONTA[c.tipo] || 'Banco'}${c.arquivada ? ' · arquivada' : ''}</small></span>
      <span class="conta-val${real < 0 ? ' neg' : ''}">${money(real / 100)}</span>
    </button>`;
  }).join('');
}

/* ---------------- Navegação ---------------- */

function showView(name) {
  $$('.view').forEach((v) => (v.hidden = v.id !== `view-${name}`));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  $('#fab').hidden = name === 'ajustes';
  window.scrollTo(0, 0);
}

$$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
$('#prevMonth').addEventListener('click', () => { viewMonth = addMonths(viewMonth, -1); render(); });
$('#nextMonth').addEventListener('click', () => { viewMonth = addMonths(viewMonth, 1); render(); });
$$('#filtros .chip').forEach((c) => c.addEventListener('click', () => {
  filtro = c.dataset.f;
  $$('#filtros .chip').forEach((x) => x.classList.toggle('active', x === c));
  renderLista();
}));
$('#filtroConta').addEventListener('change', (e) => {
  filtroConta = e.target.value;
  e.target.classList.toggle('active', !!filtroConta);
  renderLista();
});

/* ---------------- Lançamento (form) ---------------- */

const dlg = $('#dlgLanc');
const form = $('#formLanc');
let formKind = 'out';
let editingOrig = null; // contas originais do lançamento em edição (para aceitar conta arquivada já usada)

/** Opções de conta: só ativas, mais a conta arquivada que o lançamento editado já usa (V4). */
function contaOptions(keepId) {
  return state.contas.filter((c) => !c.arquivada || c.id === keepId).map((c) =>
    `<option value="${escapeHtml(c.id)}"${c.arquivada ? ' data-arq="1"' : ''}>${escapeHtml(c.nome)}${c.arquivada ? ' (arquivada)' : ''}</option>`).join('');
}

function primeiraAtivaDiferente(id) {
  const c = contasAtivas().find((x) => x.id !== id);
  return c ? c.id : '';
}

/** Ao trocar de uma conta arquivada para outra, a arquivada sai da lista (não volta). */
function descartarArquivadas(sel) {
  $$('option[data-arq]', sel).forEach((o) => { if (o.value !== sel.value) o.remove(); });
}

function setKind(kind, tipo) {
  formKind = kind;
  $$('#segKind button').forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
  const isT = kind === 'transf';
  const sel = $('#selTipo');
  sel.innerHTML = TIPOS[kind].map((t) => `<option>${t}</option>`).join('');
  if (tipo && !TIPOS[kind].includes(tipo)) sel.insertAdjacentHTML('beforeend', `<option>${escapeHtml(tipo)}</option>`);
  sel.value = isT ? 'Transferência' : (tipo || TIPOS[kind][0]);
  $('#lblTipo').hidden = isT;
  $('#lblContaDest').hidden = !isT;
  $('#rowContas').classList.toggle('row2', isT);
  $('#lblContaTxt').textContent = isT ? 'De' : 'Conta';
  form.desc.required = !isT; // transferência sem descrição vira "Transferência"
  if (isT) {
    const dest = $('#selContaDest');
    if (!dest.value || dest.value === $('#selConta').value) dest.value = primeiraAtivaDiferente($('#selConta').value);
  }
  onTipoChange();
}

function onTipoChange() {
  const tipo = $('#selTipo').value;
  $('#lblCategoria').hidden = tipo !== 'Avulso' || formKind === 'transf';
  // sugestões de descrição de acordo com o tipo
  const descs = [...new Set(state.items.filter((i) => i.tipo === tipo).map((i) => i.desc))].slice(0, 40);
  $('#descSugest').innerHTML = descs.map((d) => `<option value="${escapeHtml(d)}">`).join('');
}

function sugerirValorExtra() {
  if (formKind !== 'in' || $('#selTipo').value !== 'Extra' || form.valor.value) return;
  const wd = weekday(form.data.value || todayISO());
  const s = state.settings;
  if (wd === 4 || wd === 5) form.valor.value = valorToInput(s.extraQuiSex);
  else if (wd === 6) form.valor.value = valorToInput(s.extraSabBase);
}

$$('#segKind button').forEach((b) => b.addEventListener('click', () => {
  const vinhaDe = formKind;
  setKind(b.dataset.kind);
  if (b.dataset.kind === 'transf' && vinhaDe !== 'transf' && !editingId) form.realizado.checked = true; // V5
  sugerirValorExtra();
}));
$('#selTipo').addEventListener('change', () => {
  onTipoChange();
  if ($('#selTipo').value === 'Avulso') form.realizado.checked = true;
  sugerirValorExtra();
});
$('#selConta').addEventListener('change', (e) => {
  descartarArquivadas(e.target);
  if (formKind === 'transf' && $('#selContaDest').value === e.target.value) $('#selContaDest').value = primeiraAtivaDiferente(e.target.value);
});
$('#selContaDest').addEventListener('change', (e) => descartarArquivadas(e.target));
form.data.addEventListener('change', sugerirValorExtra);

function openForm(item) {
  editingId = item ? item.id : null;
  editingOrig = item ? { contaId: item.contaId, contaDestinoId: item.contaDestinoId } : null;
  form.reset();
  $('#dlgTitle').textContent = item ? 'Editar lançamento' : 'Novo lançamento';
  $('#btnExcluir').hidden = !item;
  const cats = [...new Set([...CATEGORIAS_PADRAO, ...state.items.map((i) => i.categoria).filter(Boolean)])];
  $('#catSugest').innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}">`).join('');

  const selConta = $('#selConta');
  const selDest = $('#selContaDest');
  selConta.innerHTML = contaOptions(item ? item.contaId : null);
  selDest.innerHTML = contaOptions(item && item.kind === 'transf' ? item.contaDestinoId : null);

  if (item) {
    selConta.value = contaById(item.contaId) ? item.contaId : contaPadraoId();
    selDest.value = item.kind === 'transf' ? item.contaDestinoId : primeiraAtivaDiferente(selConta.value);
    setKind(item.kind, item.tipo);
    form.valor.value = valorToInput(item.valor);
    form.desc.value = item.desc;
    form.categoria.value = item.categoria || '';
    form.data.value = item.data;
    form.realizado.checked = !!item.realizado;
  } else {
    selConta.value = contaPadraoId();
    selDest.value = primeiraAtivaDiferente(selConta.value);
    setKind('out', 'Avulso');
    const t = todayISO();
    form.data.value = monthOf(t) === viewMonth ? t : `${viewMonth}-01`;
    form.realizado.checked = true;
  }
  dlg.showModal();
  if (!item) setTimeout(() => form.valor.focus(), 50);
}

$('#fab').addEventListener('click', () => openForm(null));
$('#dlgClose').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

/** Conta aceitável no formulário: ativa, ou a mesma arquivada que o lançamento já tinha. */
function contaAceita(id, original) {
  const c = contaById(id);
  return !!c && (!c.arquivada || id === original);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const valor = round2(parseValor(form.valor.value));
  if (!isFinite(valor) || valor <= 0) { toast('Informe um valor maior que zero'); form.valor.focus(); return; } // V2
  if (!form.data.value) { toast('Informe a data'); return; }
  const isT = formKind === 'transf';
  const contaId = $('#selConta').value;
  if (!contaAceita(contaId, editingOrig?.contaId)) { toast(isT ? 'Escolha a conta de origem' : 'Escolha uma conta'); return; }
  let contaDestinoId = null;
  if (isT) {
    contaDestinoId = $('#selContaDest').value;
    if (!contaDestinoId) { toast('Para transferir, cadastre outra conta em Ajustes → Minhas contas'); return; }
    if (contaId === contaDestinoId) { toast('Origem e destino precisam ser diferentes'); return; } // V1
    if (!contaAceita(contaDestinoId, editingOrig?.contaDestinoId)) { toast('Escolha a conta de destino'); return; } // V3
  }
  const tipo = isT ? 'Transferência' : $('#selTipo').value;
  const data = {
    data: form.data.value,
    kind: formKind,
    tipo,
    desc: form.desc.value.trim() || tipo,
    categoria: tipo === 'Avulso' && !isT ? form.categoria.value.trim() : '',
    valor,
    realizado: form.realizado.checked,
    contaId,
  };
  if (isT) data.contaDestinoId = contaDestinoId;
  if (editingId) {
    const it = state.items.find((i) => i.id === editingId);
    Object.assign(it, data);
    if (!isT) delete it.contaDestinoId;
    toast('Lançamento atualizado');
  } else {
    state.items.push({ id: uid(), ord: state.seq++, origem: 'manual', ...data });
    toast('Lançamento salvo');
  }
  state.settings.ultimaContaId = contaId;
  save();
  viewMonth = monthOf(data.data);
  dlg.close();
  render();
});

$('#btnExcluir').addEventListener('click', () => {
  if (!editingId || !confirm('Excluir este lançamento?')) return;
  state.items = state.items.filter((i) => i.id !== editingId);
  save();
  dlg.close();
  render();
  toast('Lançamento excluído');
});

$('#lista').addEventListener('click', (e) => {
  const tg = e.target.closest('[data-toggle]');
  if (tg) {
    const it = state.items.find((i) => i.id === tg.dataset.toggle);
    it.realizado = !it.realizado;
    save();
    render();
    return;
  }
  const row = e.target.closest('.item');
  if (row) openForm(state.items.find((i) => i.id === row.dataset.id));
});

/* ---------------- Minhas contas ---------------- */

const dlgConta = $('#dlgConta');
const formConta = $('#formConta');

function openConta(conta) {
  editingContaId = conta ? conta.id : null;
  formConta.reset();
  $('#dlgContaTitle').textContent = conta ? 'Editar conta' : 'Nova conta';
  formConta.nome.value = conta ? conta.nome : '';
  formConta.tipo.value = conta ? conta.tipo : 'banco';
  formConta.saldoInicial.value = conta ? (valorToInput(conta.saldoInicial) || '0') : '';
  const ini = state.settings.inicioMes;
  $('#contaSaldoHint').textContent = ini
    ? `Quanto havia nesta conta no começo de ${monthLabel(ini).toLowerCase()}. Pode ser negativo.`
    : 'Quanto havia nesta conta antes do primeiro lançamento. Pode ser negativo.';
  $('#btnArquivarConta').hidden = !conta;
  $('#btnExcluirConta').hidden = !conta;
  if (conta) {
    $('#btnArquivarConta').textContent = conta.arquivada ? 'Desarquivar' : 'Arquivar';
    const real = saldosPorConta().find((s) => s.conta.id === conta.id)?.real || 0;
    const n = lancamentosDaConta(conta.id);
    $('#contaInfo').textContent = `Saldo real atual: ${money(real / 100)} · ${n} lançamento${n === 1 ? '' : 's'}${conta.arquivada ? ' · arquivada' : ''}`;
  } else {
    $('#contaInfo').textContent = '';
  }
  dlgConta.showModal();
  if (!conta) setTimeout(() => formConta.nome.focus(), 50);
}

$('#listaContas').addEventListener('click', (e) => {
  const row = e.target.closest('[data-conta]');
  if (row) openConta(contaById(row.dataset.conta));
});
$('#btnAddConta').addEventListener('click', () => openConta(null));
$('#dlgContaClose').addEventListener('click', () => dlgConta.close());
dlgConta.addEventListener('click', (e) => { if (e.target === dlgConta) dlgConta.close(); });

formConta.addEventListener('submit', (e) => {
  e.preventDefault();
  const nome = formConta.nome.value.trim();
  if (!nome) { toast('Informe o nome da conta'); formConta.nome.focus(); return; } // V6
  if (nome.length > 40) { toast('Nome com no máximo 40 letras'); return; }
  if (state.contas.some((c) => c.id !== editingContaId && norm(c.nome) === norm(nome))) { toast('Já existe uma conta com esse nome'); return; }
  const txt = formConta.saldoInicial.value.trim();
  const saldo = txt ? parseValor(txt) : 0;
  if (!isFinite(saldo)) { toast('Saldo inicial inválido'); formConta.saldoInicial.focus(); return; }
  const tipo = formConta.tipo.value === 'dinheiro' ? 'dinheiro' : 'banco';
  if (editingContaId) {
    Object.assign(contaById(editingContaId), { nome, tipo, saldoInicial: round2(saldo) });
    toast('Conta atualizada');
  } else {
    state.contas.push({ id: novaContaId(), nome, tipo, saldoInicial: round2(saldo), arquivada: false });
    toast('Conta criada');
  }
  save(); // V9
  dlgConta.close();
  render();
});

/** Arquiva/desarquiva. Devolve true se mudou. */
function alternarArquivo(conta) {
  if (conta.arquivada) {
    conta.arquivada = false;
    toast('Conta desarquivada');
    return true;
  }
  if (contasAtivas().length <= 1) { toast('Precisa ficar pelo menos uma conta ativa'); return false; } // V8
  const real = saldosPorConta().find((s) => s.conta.id === conta.id)?.real || 0;
  const msg = real !== 0
    ? `Arquivar "${conta.nome}"? O saldo dela (${money(real / 100)}) continua somando no total.`
    : `Arquivar "${conta.nome}"? Ela some das listas de escolha, mas os lançamentos antigos continuam.`;
  if (!confirm(msg)) return false;
  conta.arquivada = true;
  if (state.settings.ultimaContaId === conta.id) state.settings.ultimaContaId = null;
  toast('Conta arquivada');
  return true;
}

$('#btnArquivarConta').addEventListener('click', () => {
  const conta = contaById(editingContaId);
  if (!conta || !alternarArquivo(conta)) return;
  save();
  dlgConta.close();
  render();
});

$('#btnExcluirConta').addEventListener('click', () => {
  const conta = contaById(editingContaId);
  if (!conta) return;
  if (!conta.arquivada && contasAtivas().length <= 1) { toast('Precisa ficar pelo menos uma conta ativa'); return; } // V8
  const n = lancamentosDaConta(conta.id);
  if (n) { // V7: com lançamentos, não exclui — oferece arquivar
    if (conta.arquivada) { alert(`"${conta.nome}" tem ${n} lançamentos, por isso não pode ser excluída. Ela já está arquivada.`); return; }
    if (!confirm(`"${conta.nome}" tem ${n} lançamentos; arquive em vez de excluir.\n\nArquivar agora?`)) return;
    if (!alternarArquivo(conta)) return;
  } else {
    if (!confirm(`Excluir a conta "${conta.nome}"?`)) return;
    state.contas = state.contas.filter((c) => c.id !== conta.id);
    if (state.settings.ultimaContaId === conta.id) state.settings.ultimaContaId = null;
    if (filtroConta === conta.id) filtroConta = '';
    toast('Conta excluída');
  }
  save();
  dlgConta.close();
  render();
});

/* ---------------- Premissas ---------------- */

$('#formSettings').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const num = (v, def) => { const n = parseValor(v); return isFinite(n) ? round2(n) : def; };
  const s = state.settings;
  s.inicioMes = f.inicioMes.value || '';
  s.extraQuiSex = num(f.extraQuiSex.value, s.extraQuiSex);
  s.extraSabBase = num(f.extraSabBase.value, s.extraSabBase);
  s.extraSabTeto = num(f.extraSabTeto.value, s.extraSabTeto);
  save();
  document.activeElement?.blur();
  render();
  toast('Premissas salvas');
});

/* ---------------- Copiar mês ---------------- */

/** K3: conta dos extras gerados = conta mais usada nos Extras do mês de origem. */
function contaDosExtras(ym) {
  const freq = new Map();
  for (const i of monthItems(ym)) if (i.kind === 'in' && i.tipo === 'Extra') freq.set(i.contaId, (freq.get(i.contaId) || 0) + 1);
  let melhor = null, max = 0;
  for (const [id, n] of freq) if (n > max) { melhor = id; max = n; }
  const c = contaById(melhor) || contaById(state.settings.ultimaContaId);
  if (c && !c.arquivada) return c.id;
  return (contasAtivas()[0] || state.contas[0]).id;
}

$('#btnCopiarMes').addEventListener('click', () => {
  // K2: transferências nunca são copiadas
  const src = monthItems(viewMonth).filter((i) => i.kind !== 'transf' && i.tipo !== 'Avulso' && i.tipo !== 'Extra');
  const temExtras = monthItems(viewMonth).some((i) => i.kind === 'in' && i.tipo === 'Extra');
  const dest = addMonths(viewMonth, 1);
  if (!src.length && !temExtras) { toast('Nada para copiar neste mês'); return; }
  const jaTem = monthItems(dest).length;
  const msg = `Copiar ${src.length} contas/salários de ${monthLabel(viewMonth)} para ${monthLabel(dest)}` +
    (temExtras ? ' e gerar os extras de quinta, sexta e sábado' : '') + '?' +
    (jaTem ? `\n\nAtenção: ${monthLabel(dest)} já tem ${jaTem} lançamentos.` : '');
  if (!confirm(msg)) return;
  const nd = daysInMonth(dest);
  // K1: mantém a conta (mesmo arquivada) e nasce pendente
  const novos = src.map((i) => ({
    ...i, id: uid(), ord: 0, origem: 'manual', realizado: false,
    data: `${dest}-${pad(Math.min(Number(i.data.slice(8, 10)), nd))}`,
  }));
  if (temExtras) {
    const s = state.settings;
    const contaId = contaDosExtras(viewMonth);
    for (let d = 1; d <= nd; d++) {
      const iso = `${dest}-${pad(d)}`;
      const wd = weekday(iso);
      if (wd === 4 || wd === 5 || wd === 6) {
        novos.push({
          id: uid(), ord: 0, origem: 'manual', realizado: false, data: iso, kind: 'in', tipo: 'Extra',
          desc: wd === 4 ? 'Extra quinta' : wd === 5 ? 'Extra sexta' : 'Extra sábado',
          valor: wd === 6 ? s.extraSabBase : s.extraQuiSex, categoria: '', contaId,
        });
      }
    }
  }
  novos.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : (a.kind === 'in' ? -1 : 1)));
  novos.forEach((n) => (n.ord = state.seq++));
  state.items.push(...novos);
  save();
  viewMonth = dest;
  render();
  showView('lanc');
  toast(`${novos.length} lançamentos criados em ${monthLabel(dest)}`);
});

/* ---------------- Importação de planilha ---------------- */

function cellToISO(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const p = XLSX.SSF.parse_date_code(v);
    return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : null;
  }
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function cellNum(v) {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseValor(v);
  return isFinite(n) ? round2(n) : 0;
}

function cellStr(v) { return String(v ?? '').trim(); }

function canonTipo(t, kind) {
  const n = norm(t);
  if (n.startsWith('salario')) return 'Salário';
  if (n.startsWith('extra')) return 'Extra';
  if (n.startsWith('avulso') || n.startsWith('gasto')) return 'Avulso';
  if (n.startsWith('conta') || n.startsWith('fixa')) return 'Conta';
  if (!n) return kind === 'in' ? 'Outra entrada' : 'Conta';
  return String(t).trim();
}

/**
 * Lê o workbook e devolve { items, settings, sheets, ignoradas, temColunaConta }.
 * Cada item traz contaNome / contaDestNome (texto da planilha); a conversão para contaId
 * acontece só na confirmação (resolverImport), para que cancelar não crie nada.
 */
function parseWorkbook(wb) {
  const items = [];
  const settings = {};
  const sheets = [];
  let ignoradas = 0;
  let temColunaConta = false;

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    let count = 0;

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] || [];
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (cell == null) continue;
        const n = norm(cell);

        // Premissas (rótulo + valor à direita)
        const valRight = () => { for (let k = c + 1; k < Math.min(row.length, c + 4); k++) if (typeof row[k] === 'number') return row[k]; return null; };
        if (n.startsWith('saldo inicial')) { const v = valRight(); if (v != null) settings.saldoInicial = v; }
        else if (n.startsWith('extra por quinta')) { const v = valRight(); if (v != null) settings.extraQuiSex = v; }
        else if (n.startsWith('extra por sabado') && n.includes('base')) { const v = valRight(); if (v != null) settings.extraSabBase = v; }
        else if (n.startsWith('extra por sabado') && n.includes('teto')) { const v = valRight(); if (v != null) settings.extraSabTeto = v; }

        // Tabela "Contas" da aba Resumo exportada pelo app: Nome | Tipo | Saldo inicial | ...
        if (n === 'nome' && norm(row[c + 1]).startsWith('tipo') && norm(row[c + 2]).startsWith('saldo inicial')) {
          const contas = [];
          for (let rr = r + 1; rr < rows.length; rr++) {
            const dr = rows[rr] || [];
            const nome = cellStr(dr[c]);
            if (!nome || norm(nome) === 'total') break;
            contas.push({ nome: nome.slice(0, 40), tipo: norm(dr[c + 1]).startsWith('dinheiro') ? 'dinheiro' : 'banco', saldoInicial: cellNum(dr[c + 2]) });
          }
          if (contas.length) settings.contas = contas;
          continue;
        }

        if (n !== 'data') continue;

        // Cabeçalho de tabela: lê colunas contíguas à direita
        const cols = {};
        for (let k = c; k < row.length && row[k] != null && typeof row[k] === 'string'; k++) {
          const h = norm(row[k]);
          if (k > c && h === 'data') break;
          if (h === 'data') cols.data = k;
          else if (h.startsWith('conta destino') || h.startsWith('destino')) cols.contaDest = k; // I1: testar antes de "conta"
          else if (h === 'conta' || h.startsWith('conta origem') || h.startsWith('banco') || h.startsWith('carteira')) cols.conta = k;
          else if (h.startsWith('tipo')) cols.tipo = k;
          else if (h.startsWith('descri')) cols.desc = k;
          else if (h.startsWith('categ')) cols.cat = k;
          else if (h.startsWith('entrada')) cols.entrada = k;
          else if (h.startsWith('saida')) cols.saida = k;
          else if (h.startsWith('valor')) cols.valor = k;
          else if (h.startsWith('realizado') || h.startsWith('pago')) cols.realizado = k;
        }
        const isMain = cols.desc != null && (cols.entrada != null || cols.saida != null);
        const isAvulso = !isMain && cols.desc != null && cols.valor != null;
        if (!isMain && !isAvulso) continue;
        if (cols.conta != null) temColunaConta = true;

        for (let rr = r + 1; rr < rows.length; rr++) {
          const dr = rows[rr] || [];
          const iso = cellToISO(dr[cols.data]);
          if (!iso) break;
          const desc = cellStr(dr[cols.desc]);
          const contaNome = cols.conta != null ? cellStr(dr[cols.conta]) : '';
          const categoria = cols.cat != null ? cellStr(dr[cols.cat]) : '';
          if (isMain) {
            const ent = cellNum(dr[cols.entrada]);
            const sai = cellNum(dr[cols.saida]);
            if (!ent && !sai) continue;
            const tipoRaw = cols.tipo != null ? dr[cols.tipo] : '';
            const realizadoCol = cols.realizado != null ? norm(dr[cols.realizado]).startsWith('s') : null;
            if (norm(tipoRaw).startsWith('transf')) { // I4
              const contaDestNome = cols.contaDest != null ? cellStr(dr[cols.contaDest]) : '';
              if (!contaDestNome || (contaNome && norm(contaNome) === norm(contaDestNome))) { ignoradas++; continue; }
              items.push({ data: iso, kind: 'transf', tipo: 'Transferência', desc: desc || 'Transferência', valor: Math.abs(sai || ent),
                categoria: '', realizado: realizadoCol ?? true, contaNome, contaDestNome });
            } else {
              const kind = ent > 0 ? 'in' : 'out';
              const tipo = canonTipo(tipoRaw, kind);
              items.push({ data: iso, kind, tipo, desc: desc || tipo, valor: kind === 'in' ? ent : sai,
                categoria, realizado: realizadoCol ?? tipo === 'Avulso', contaNome });
            }
          } else {
            const v = cellNum(dr[cols.valor]);
            if (!v) continue;
            items.push({ data: iso, kind: 'out', tipo: 'Avulso', desc: desc || 'Gasto avulso', valor: Math.abs(v),
              categoria, realizado: true, contaNome });
          }
          count++;
        }
      }
    }
    if (count) sheets.push({ name, count });
  }
  return { items, settings, sheets, ignoradas, temColunaConta };
}

/**
 * Converte nomes de conta da planilha em contas do app, SEM alterar o estado (I2, I3, I4).
 * Contas novas recebem uma chave provisória "new:<nome normalizado>".
 */
function resolverImport(p, contaPadrao, comPremissas) {
  const porNome = new Map(state.contas.map((c) => [norm(c.nome), c]));
  const novas = new Map();     // norm → { nome, tipo, saldoInicial }
  const reativar = new Map();  // id → conta arquivada que volta a ficar ativa
  const keyOf = (nome) => {
    const n = norm(nome);
    if (!n) return null;
    const c = porNome.get(n);
    return c ? c.id : 'new:' + n;
  };
  const registrar = (nome) => {
    const n = norm(nome);
    if (!n) return;
    const c = porNome.get(n);
    if (c) { if (c.arquivada) reativar.set(c.id, c); }
    else if (!novas.has(n)) novas.set(n, { nome: cellStr(nome).slice(0, 40), tipo: 'banco', saldoInicial: 0 });
  };

  let ignoradas = p.ignoradas;
  const items = [];
  for (const it of p.items) {
    const contaKey = keyOf(it.contaNome) || contaPadrao;
    let destKey = null;
    if (it.kind === 'transf') {
      destKey = keyOf(it.contaDestNome);
      if (!destKey || destKey === contaKey) { ignoradas++; continue; }
      registrar(it.contaDestNome);
    }
    registrar(it.contaNome);
    const { contaNome, contaDestNome, ...resto } = it;
    items.push({ ...resto, contaKey, destKey });
  }

  // saldos iniciais por conta (tabela "Contas" da exportação), só com "atualizar premissas"
  const saldos = [];
  if (comPremissas && p.settings.contas) {
    for (const sc of p.settings.contas) {
      const n = norm(sc.nome);
      if (!porNome.has(n) && !novas.has(n)) novas.set(n, { nome: sc.nome, tipo: sc.tipo, saldoInicial: 0 });
      if (novas.has(n)) novas.get(n).tipo = sc.tipo;
      saldos.push({ key: keyOf(sc.nome), saldoInicial: sc.saldoInicial });
    }
  }
  return { items, novas, reativar: [...reativar.values()], ignoradas, saldos };
}

function renderImportAvisos() {
  const p = pendingImport;
  if (!p) return;
  const r = resolverImport(p, $('#impConta').value, $('#impSettings').checked);
  const avisos = [];
  if (r.novas.size) avisos.push(`<p><b>Contas novas:</b> ${[...r.novas.values()].map((c) => escapeHtml(c.nome)).join(', ')}</p>`);
  if (r.reativar.length) avisos.push(`<p class="warn">Contas arquivadas que voltarão a ficar ativas: ${r.reativar.map((c) => escapeHtml(c.nome)).join(', ')}</p>`);
  if (r.ignoradas) avisos.push(`<p class="warn">${r.ignoradas} transferência${r.ignoradas === 1 ? '' : 's'} ignorada${r.ignoradas === 1 ? '' : 's'} (sem conta destino ou com origem igual ao destino)</p>`);
  if (!p.temColunaConta) avisos.push('<p class="muted">A planilha não tem coluna Conta: todos os lançamentos vão para a conta escolhida acima.</p>');
  $('#impAvisos').innerHTML = avisos.join('');
}

$('#fileImport').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    let wb;
    try { wb = XLSX.read(buf, { type: 'array' }); } catch (_) { wb = null; }
    if (!wb || !wb.SheetNames.length) { toast('Esse arquivo não parece ser uma planilha do Excel (.xlsx)'); return; }
    const parsed = parseWorkbook(wb);
    if (!parsed.items.length) { toast('Nenhum lançamento encontrado na planilha'); return; }
    pendingImport = parsed;
    const months = [...new Set(parsed.items.map((i) => monthOf(i.data)))].sort();
    const s = parsed.settings;
    const temPremissas = ['saldoInicial', 'extraQuiSex', 'extraSabBase', 'extraSabTeto', 'contas'].some((k) => s[k] != null);
    $('#importResumo').innerHTML = `<p><b>${escapeHtml(file.name)}</b> — ${parsed.items.length} lançamentos</p>
      <ul>${parsed.sheets.map((sh) => `<li>${escapeHtml(sh.name)}: ${sh.count}</li>`).join('')}</ul>
      <p class="muted">Meses que serão atualizados: ${months.map(monthLabel).join(', ')}</p>
      ${temPremissas ? `<p class="muted">Premissas encontradas: ${[
        s.contas ? `saldo inicial de ${s.contas.length} conta${s.contas.length === 1 ? '' : 's'}` : (s.saldoInicial != null && `saldo inicial ${money(s.saldoInicial)} (vai para a conta escolhida abaixo)`),
        s.extraQuiSex != null && `extra qui/sex ${money(s.extraQuiSex)}`,
        s.extraSabBase != null && `sábado ${money(s.extraSabBase)}–${money(s.extraSabTeto ?? s.extraSabBase)}`,
      ].filter(Boolean).join(', ')}</p>` : ''}`;
    $('#impSettings').closest('label').hidden = !temPremissas;
    const sel = $('#impConta');
    sel.innerHTML = contaOptions(null);
    sel.value = contaPadraoId();
    renderImportAvisos();
    $('#dlgImport').showModal();
  } catch (err) {
    console.error(err);
    toast('Erro ao ler a planilha: ' + err.message);
  }
});

$('#impConta').addEventListener('change', renderImportAvisos);
$('#impSettings').addEventListener('change', renderImportAvisos);
$('#impCancel').addEventListener('click', () => { pendingImport = null; $('#dlgImport').close(); });

$('#impOk').addEventListener('click', () => {
  const p = pendingImport;
  if (!p) return;
  const contaPadrao = $('#impConta').value || contaPadraoId();
  const comPremissas = $('#impSettings').checked && !$('#impSettings').closest('label').hidden;
  const r = resolverImport(p, contaPadrao, comPremissas);

  // só agora, com a confirmação, cria/reativa contas (I3)
  const idDe = new Map();
  for (const [n, c] of r.novas) {
    const id = novaContaId();
    state.contas.push({ id, nome: c.nome, tipo: c.tipo, saldoInicial: 0, arquivada: false });
    idDe.set('new:' + n, id);
  }
  for (const c of r.reativar) c.arquivada = false;
  const resolve = (k) => (k && k.startsWith('new:') ? idDe.get(k) : k);
  const novosItens = r.items.map(({ contaKey, destKey, ...it }) => {
    const out = { ...it, contaId: resolve(contaKey) };
    if (it.kind === 'transf') out.contaDestinoId = resolve(destKey);
    return out;
  });

  const months = new Set(novosItens.map((i) => monthOf(i.data)));
  const apagarManuais = $('#impManuais').checked;
  const key = (i) => `${i.data}|${norm(i.desc)}|${round2(i.valor)}|${i.contaId || ''}|${i.kind === 'transf' ? i.contaDestinoId : ''}`; // I5

  // preserva "realizado" marcado no app para itens que já existiam
  const realizadosNoApp = new Set(state.items.filter((i) => i.realizado && months.has(monthOf(i.data))).map(key));

  state.items = state.items.filter((i) => !(months.has(monthOf(i.data)) && (i.origem === 'import' || apagarManuais)));
  const manuaisRestantes = new Set(state.items.filter((i) => months.has(monthOf(i.data))).map(key));

  let add = 0, dup = 0;
  for (const it of novosItens) {
    if (manuaisRestantes.has(key(it))) { dup++; continue; } // já lançado manualmente
    state.items.push({ id: uid(), ord: state.seq++, origem: 'import', ...it, realizado: it.realizado || realizadosNoApp.has(key(it)) });
    add++;
  }

  if (comPremissas) {
    const s = p.settings;
    for (const k of ['extraQuiSex', 'extraSabBase', 'extraSabTeto']) if (s[k] != null) state.settings[k] = round2(s[k]);
    let mexeuSaldo = false;
    if (r.saldos.length) { // tabela "Contas": saldo inicial por conta
      for (const sc of r.saldos) { const c = contaById(resolve(sc.key)); if (c) { c.saldoInicial = round2(sc.saldoInicial); mexeuSaldo = true; } }
    } else if (s.saldoInicial != null) { // I7: saldo único vai para a conta escolhida
      const c = contaById(contaPadrao);
      if (c) { c.saldoInicial = round2(s.saldoInicial); mexeuSaldo = true; }
    }
    if (mexeuSaldo && months.size) {
      const first = [...months].sort()[0];
      if (!state.settings.inicioMes || first < state.settings.inicioMes) state.settings.inicioMes = first;
    }
  }
  // app vazio que recebeu as contas da planilha: a "Conta principal" automática, zerada e sem uso, sai
  const principal = state.contas.find((c) => c.nome === 'Conta principal');
  if (principal && cents(principal.saldoInicial) === 0 && !lancamentosDaConta(principal.id) &&
      state.contas.some((c) => c.id !== principal.id && !c.arquivada)) {
    state.contas = state.contas.filter((c) => c.id !== principal.id);
    if (filtroConta === principal.id) filtroConta = '';
  }
  state.settings.ultimaContaId = contaById(contaPadrao) ? contaPadrao : contaPadraoId();
  save();
  pendingImport = null;
  $('#dlgImport').close();
  const cur = monthOf(todayISO());
  if (months.size) viewMonth = months.has(cur) ? cur : [...months].sort()[0];
  render();
  showView('resumo');
  const extras = [dup && `${dup} já existiam`, r.novas.size && `${r.novas.size} conta${r.novas.size === 1 ? '' : 's'} nova${r.novas.size === 1 ? '' : 's'}`, r.ignoradas && `${r.ignoradas} ignorada${r.ignoradas === 1 ? '' : 's'}`].filter(Boolean);
  toast(`${add} lançamentos importados${extras.length ? ' · ' + extras.join(' · ') : ''}`);
});

/* ---------------- Exportação ---------------- */

function excelSerial(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5;
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

$('#btnExportXlsx').addEventListener('click', () => {
  if (!state.items.length) { toast('Nada para exportar'); return; }
  const wb = XLSX.utils.book_new();
  const s = state.settings;
  const saldos = saldosPorConta();
  const tot = (k) => saldos.reduce((a, x) => a + x[k], 0) / 100;
  const resumo = XLSX.utils.aoa_to_sheet([
    ['Premissas'],
    ['Saldo inicial em conta', saldoInicialC() / 100], // E3: soma dos saldos iniciais
    ['Extra por quinta / sexta', s.extraQuiSex],
    ['Extra por sábado (base)', s.extraSabBase],
    ['Extra por sábado (teto)', s.extraSabTeto],
    [],
    ['Saldo real atual', saldoRealAtual()],
    ['Exportado em', new Date().toLocaleString('pt-BR')],
    [],
    ['Contas'],
    ['Nome', 'Tipo', 'Saldo inicial', 'Saldo real', 'Saldo previsto', 'Arquivada?'],
    ...saldos.map(({ conta, real, prev }) => [conta.nome, TIPO_CONTA[conta.tipo] || 'Banco', conta.saldoInicial, real / 100, prev / 100, conta.arquivada ? 'Sim' : 'Não']),
    ['Total', '', saldoInicialC() / 100, tot('real'), tot('prev'), ''],
  ]);
  resumo['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 11 }];
  XLSX.utils.book_append_sheet(wb, resumo, 'Resumo');

  const run = computeRunning();
  const months = [...new Set(state.items.map((i) => monthOf(i.data)))].sort();
  for (const ym of months) {
    const aoa = [['Data', 'Tipo', 'Descrição', 'Categoria', 'Conta', 'Conta destino', 'Entrada', 'Saída', 'Saldo previsto', 'Realizado?', 'Saldo real']];
    for (const it of monthItems(ym)) {
      const r = run.get(it.id);
      const isT = it.kind === 'transf';
      aoa.push([
        { t: 'n', v: excelSerial(it.data), z: 'dd/mm/yyyy' }, isT ? 'Transferência' : it.tipo, it.desc, it.categoria || '',
        contaById(it.contaId)?.nome || '', isT ? (contaById(it.contaDestinoId)?.nome || '') : '',
        it.kind === 'in' ? it.valor : null, it.kind !== 'in' ? it.valor : null, // E2: transferência na coluna Saída
        r.prev, it.realizado ? 'Sim' : 'Não', r.real,
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 11 }, { wch: 13 }, { wch: 34 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 11 }, { wch: 11 }, { wch: 14 }, { wch: 11 }, { wch: 12 }];
    const [y, m] = ym.split('-');
    XLSX.utils.book_append_sheet(wb, ws, `Lançamentos ${m}-${y}`);
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `financas_${todayISO()}.xlsx`);
  toast('Planilha exportada');
});

/* ---------------- Backup ---------------- */

$('#btnBackup').addEventListener('click', () => {
  state.settings.lastBackup = new Date().toISOString();
  save();
  downloadBlob(new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' }), `financas_backup_${todayISO()}.json`);
  renderSettings();
  toast('Backup salvo em Downloads');
});

$('#fileRestore').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.items)) throw new Error('arquivo inválido');
    if (!confirm(`Restaurar ${data.items.length} lançamentos? Os dados atuais serão substituídos.`)) return;
    if (!(data.version >= 2)) guardarPreV2(text); // backup antigo (v1): passa pela mesma migração do load()
    state = migrate(data);
    filtroConta = '';
    save();
    render();
    toast('Backup restaurado');
  } catch (err) {
    toast('Não foi possível restaurar: ' + err.message);
  }
});

$('#btnLimpar').addEventListener('click', () => {
  if (!confirm('Apagar TODOS os lançamentos e premissas deste celular?')) return;
  if (!confirm('Tem certeza? Isso não pode ser desfeito (a menos que você tenha um backup).')) return;
  state = migrate(defaultState());
  filtroConta = '';
  save();
  render();
  toast('Dados apagados');
});

/* ---------------- Inicialização ---------------- */

state = load();
if (migrouNoLoad) save(); // grava já no formato v2 (a cópia v1 ficou em financas.v1.pre-v2)
render();

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
$('#appVersion').textContent = APP_VERSION;

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch((e) => console.warn('SW', e));
  // quando um service worker novo assumir, recarrega uma vez para usar a versão nova
  let recarregou = false;
  const tinhaVersaoAntiga = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recarregou || !tinhaVersaoAntiga) return;
    recarregou = true;
    location.reload();
  });
}

$('#btnAtualizar').addEventListener('click', async () => {
  toast('Procurando atualização…');
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.update();
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch (e) { console.warn(e); }
  setTimeout(() => location.reload(), 600);
});

/* ---------------- Instalação (PWA) ---------------- */

let installEvent = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function renderInstall() {
  const card = $('#cardInstalar');
  if (isStandalone()) { card.hidden = true; return; }
  card.hidden = false;
  const btn = $('#btnInstalar');
  if (installEvent) {
    btn.hidden = false;
    $('#installMsg').textContent = 'Instale para usar como um aplicativo, com ícone próprio, em tela cheia e sem internet.';
  } else {
    btn.hidden = true;
    $('#installMsg').innerHTML = 'Abra este endereço no <b>Google Chrome</b> e toque em <b>⋮ → Instalar app</b>. ' +
      'Se só aparecer "Criar atalho", feche o Chrome por completo, abra o endereço de novo, espere alguns segundos e tente outra vez.';
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  renderInstall();
});
window.addEventListener('appinstalled', () => { installEvent = null; renderInstall(); toast('App instalado!'); });
$('#btnInstalar').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => null);
  installEvent = null;
  renderInstall();
});
renderInstall();
