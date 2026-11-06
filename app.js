'use strict';

/* ============================================================
   Minhas Finanças — PWA offline. Dados salvos no localStorage.
   ============================================================ */

const STORAGE_KEY = 'financas.v1';
const TIPOS = {
  in: ['Extra', 'Salário', 'Outra entrada'],
  out: ['Avulso', 'Conta'],
};
const CATEGORIAS_PADRAO = ['Alimentação', 'Mercado', 'Casa', 'Transporte', 'Saúde', 'Lazer', 'Compras', 'Dívidas', 'Outros'];

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

/* ---------------- Estado ---------------- */

function defaultState() {
  return {
    version: 1,
    settings: { saldoInicial: 0, inicioMes: '', extraQuiSex: 200, extraSabBase: 400, extraSabTeto: 600, lastBackup: null },
    items: [],
    seq: 1,
  };
}

let state = load();
let viewMonth = monthOf(todayISO());
let filtro = 'todos';
let editingId = null;
let pendingImport = null;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    const d = defaultState();
    return { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) }, items: Array.isArray(s.items) ? s.items : [] };
  } catch (e) {
    console.error(e);
    return defaultState();
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

/* ---------------- Cálculos ---------------- */

function sortedItems() {
  return [...state.items].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : (a.ord || 0) - (b.ord || 0)));
}

function contaNoSaldo(it) {
  const ini = state.settings.inicioMes;
  return !ini || monthOf(it.data) >= ini;
}

function signed(it) { return it.kind === 'in' ? it.valor : -it.valor; }

/** Saldo previsto e real acumulados após cada lançamento. */
function computeRunning() {
  const run = new Map();
  let prev = Number(state.settings.saldoInicial) || 0;
  let real = prev;
  for (const it of sortedItems()) {
    if (contaNoSaldo(it)) {
      prev += signed(it);
      if (it.realizado) real += signed(it);
    }
    run.set(it.id, { prev: round2(prev), real: round2(real) });
  }
  return run;
}

function saldoAte(isoInclusive, soRealizados) {
  let s = Number(state.settings.saldoInicial) || 0;
  for (const it of state.items) {
    if (!contaNoSaldo(it) || it.data > isoInclusive) continue;
    if (soRealizados && !it.realizado) continue;
    s += signed(it);
  }
  return round2(s);
}

function saldoRealAtual() {
  let s = Number(state.settings.saldoInicial) || 0;
  for (const it of state.items) if (contaNoSaldo(it) && it.realizado) s += signed(it);
  return round2(s);
}

function monthItems(ym) { return sortedItems().filter((it) => monthOf(it.data) === ym); }

function monthStats(ym) {
  const items = monthItems(ym);
  const st = { salarios: 0, extras: 0, outrasEntradas: 0, contas: 0, avulsos: 0, aReceber: 0, aPagar: 0, sabados: 0, n: items.length, pend: 0 };
  for (const it of items) {
    if (!it.realizado) { st.pend++; if (it.kind === 'in') st.aReceber += it.valor; else st.aPagar += it.valor; }
    if (it.kind === 'in') {
      if (it.tipo === 'Salário') st.salarios += it.valor;
      else if (it.tipo === 'Extra') { st.extras += it.valor; if (weekday(it.data) === 6) st.sabados++; }
      else st.outrasEntradas += it.valor;
    } else if (it.tipo === 'Avulso') st.avulsos += it.valor;
    else st.contas += it.valor;
  }
  st.entradas = st.salarios + st.extras + st.outrasEntradas;
  st.saidas = st.contas + st.avulsos;
  st.resultado = st.entradas - st.saidas;
  const ultimoDia = `${ym}-${pad(daysInMonth(ym))}`;
  st.saldoFim = saldoAte(ultimoDia, false);

  // menor saldo previsto no mês
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

function renderChart() {
  const ym = viewMonth;
  const nd = daysInMonth(ym);
  const today = todayISO();
  const prevStart = saldoAte(`${addMonths(ym, -1)}-31`, false);
  const realStart = saldoAte(`${addMonths(ym, -1)}-31`, true);
  const items = monthItems(ym).filter(contaNoSaldo);
  const prev = [], real = [];
  let p = prevStart, r = realStart;
  for (let d = 1; d <= nd; d++) {
    const iso = `${ym}-${pad(d)}`;
    for (const it of items) if (it.data === iso) { p += signed(it); if (it.realizado) r += signed(it); }
    prev.push(p);
    if (iso <= today) real.push(r);
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

function renderLista() {
  const run = computeRunning();
  let items = monthItems(viewMonth);
  if (filtro === 'in') items = items.filter((i) => i.kind === 'in');
  else if (filtro === 'Conta') items = items.filter((i) => i.kind === 'out' && i.tipo !== 'Avulso');
  else if (filtro === 'Avulso') items = items.filter((i) => i.tipo === 'Avulso');
  else if (filtro === 'pend') items = items.filter((i) => !i.realizado);

  $('#listaVazia').hidden = items.length > 0;
  const groups = new Map();
  for (const it of items) { if (!groups.has(it.data)) groups.set(it.data, []); groups.get(it.data).push(it); }

  const check = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>';
  $('#lista').innerHTML = [...groups].map(([data, arr]) => {
    const net = arr.reduce((a, it) => a + signed(it), 0);
    return `<div class="day"><div class="day-head"><span>${dayLabel(data)}${data === todayISO() ? ' · hoje' : ''}</span><span>${net >= 0 ? '+' : ''}${money(net)}</span></div>
      <div class="day-items">${arr.map((it) => {
        const r = run.get(it.id);
        const meta = [it.tipo, it.categoria].filter(Boolean).join(' · ');
        return `<div class="item ${it.realizado ? '' : 'pend'}" data-id="${it.id}">
          <button class="check-btn ${it.realizado ? 'on' : ''}" data-toggle="${it.id}" aria-label="${it.realizado ? 'Marcar como pendente' : 'Marcar como realizado'}">${check}</button>
          <div class="info"><div class="desc">${escapeHtml(it.desc)}</div><div class="meta">${escapeHtml(meta)}</div></div>
          <div class="amt"><span class="${it.kind}">${it.kind === 'in' ? '+' : '−'}${money(it.valor)}</span><small>saldo ${money(r.prev)}</small></div>
        </div>`;
      }).join('')}</div></div>`;
  }).join('');
}

function renderSettings() {
  const f = $('#formSettings');
  const s = state.settings;
  if (document.activeElement && f.contains(document.activeElement)) return;
  f.saldoInicial.value = valorToInput(s.saldoInicial) || '0';
  f.inicioMes.value = s.inicioMes || '';
  f.extraQuiSex.value = valorToInput(s.extraQuiSex);
  f.extraSabBase.value = valorToInput(s.extraSabBase);
  f.extraSabTeto.value = valorToInput(s.extraSabTeto);
  const lb = s.lastBackup ? new Date(s.lastBackup).toLocaleDateString('pt-BR') : 'nunca';
  $('#storageInfo').textContent = `${state.items.length} lançamentos salvos · último backup: ${lb}`;
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

/* ---------------- Lançamento (form) ---------------- */

const dlg = $('#dlgLanc');
const form = $('#formLanc');
let formKind = 'out';

function setKind(kind, tipo) {
  formKind = kind;
  $$('#segKind button').forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
  const sel = $('#selTipo');
  sel.innerHTML = TIPOS[kind].map((t) => `<option>${t}</option>`).join('');
  if (tipo && !TIPOS[kind].includes(tipo)) sel.insertAdjacentHTML('beforeend', `<option>${escapeHtml(tipo)}</option>`);
  sel.value = tipo || TIPOS[kind][0];
  onTipoChange();
}

function onTipoChange() {
  const tipo = $('#selTipo').value;
  $('#lblCategoria').hidden = tipo !== 'Avulso';
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

$$('#segKind button').forEach((b) => b.addEventListener('click', () => { setKind(b.dataset.kind); sugerirValorExtra(); }));
$('#selTipo').addEventListener('change', () => {
  onTipoChange();
  if ($('#selTipo').value === 'Avulso') form.realizado.checked = true;
  sugerirValorExtra();
});
form.data.addEventListener('change', sugerirValorExtra);

function openForm(item) {
  editingId = item ? item.id : null;
  form.reset();
  $('#dlgTitle').textContent = item ? 'Editar lançamento' : 'Novo lançamento';
  $('#btnExcluir').hidden = !item;
  const cats = [...new Set([...CATEGORIAS_PADRAO, ...state.items.map((i) => i.categoria).filter(Boolean)])];
  $('#catSugest').innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}">`).join('');

  if (item) {
    setKind(item.kind, item.tipo);
    form.valor.value = valorToInput(item.valor);
    form.desc.value = item.desc;
    form.categoria.value = item.categoria || '';
    form.data.value = item.data;
    form.realizado.checked = !!item.realizado;
  } else {
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

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const valor = round2(parseValor(form.valor.value));
  if (!isFinite(valor) || valor <= 0) { toast('Informe um valor válido'); form.valor.focus(); return; }
  const tipo = $('#selTipo').value;
  const data = {
    data: form.data.value,
    kind: formKind,
    tipo,
    desc: form.desc.value.trim() || tipo,
    categoria: tipo === 'Avulso' ? form.categoria.value.trim() : '',
    valor,
    realizado: form.realizado.checked,
  };
  if (editingId) {
    const it = state.items.find((i) => i.id === editingId);
    Object.assign(it, data);
    toast('Lançamento atualizado');
  } else {
    state.items.push({ id: uid(), ord: state.seq++, origem: 'manual', ...data });
    toast('Lançamento salvo');
  }
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

/* ---------------- Premissas ---------------- */

$('#formSettings').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const num = (v, def) => { const n = parseValor(v); return isFinite(n) ? round2(n) : def; };
  const s = state.settings;
  s.saldoInicial = num(f.saldoInicial.value, 0);
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

$('#btnCopiarMes').addEventListener('click', () => {
  const src = monthItems(viewMonth).filter((i) => i.tipo !== 'Avulso' && i.tipo !== 'Extra');
  const temExtras = monthItems(viewMonth).some((i) => i.tipo === 'Extra');
  const dest = addMonths(viewMonth, 1);
  if (!src.length && !temExtras) { toast('Nada para copiar neste mês'); return; }
  const jaTem = monthItems(dest).length;
  const msg = `Copiar ${src.length} contas/salários de ${monthLabel(viewMonth)} para ${monthLabel(dest)}` +
    (temExtras ? ' e gerar os extras de quinta, sexta e sábado' : '') + '?' +
    (jaTem ? `\n\nAtenção: ${monthLabel(dest)} já tem ${jaTem} lançamentos.` : '');
  if (!confirm(msg)) return;
  const nd = daysInMonth(dest);
  const novos = src.map((i) => ({
    ...i, id: uid(), ord: 0, origem: 'manual', realizado: false,
    data: `${dest}-${pad(Math.min(Number(i.data.slice(8, 10)), nd))}`,
  }));
  if (temExtras) {
    const s = state.settings;
    for (let d = 1; d <= nd; d++) {
      const iso = `${dest}-${pad(d)}`;
      const wd = weekday(iso);
      if (wd === 4 || wd === 5 || wd === 6) {
        novos.push({
          id: uid(), ord: 0, origem: 'manual', realizado: false, data: iso, kind: 'in', tipo: 'Extra',
          desc: wd === 4 ? 'Extra quinta' : wd === 5 ? 'Extra sexta' : 'Extra sábado',
          valor: wd === 6 ? s.extraSabBase : s.extraQuiSex, categoria: '',
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

function canonTipo(t, kind) {
  const n = norm(t);
  if (n.startsWith('salario')) return 'Salário';
  if (n.startsWith('extra')) return 'Extra';
  if (n.startsWith('avulso') || n.startsWith('gasto')) return 'Avulso';
  if (n.startsWith('conta') || n.startsWith('fixa')) return 'Conta';
  if (!n) return kind === 'in' ? 'Outra entrada' : 'Conta';
  return String(t).trim();
}

/** Lê o workbook e devolve { items, settings, sheets }. */
function parseWorkbook(wb) {
  const items = [];
  const settings = {};
  const sheets = [];

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

        if (n !== 'data') continue;

        // Cabeçalho de tabela: lê colunas contíguas à direita
        const cols = {};
        for (let k = c; k < row.length && row[k] != null && typeof row[k] === 'string'; k++) {
          const h = norm(row[k]);
          if (k > c && h === 'data') break;
          if (h === 'data') cols.data = k;
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

        for (let rr = r + 1; rr < rows.length; rr++) {
          const dr = rows[rr] || [];
          const iso = cellToISO(dr[cols.data]);
          if (!iso) break;
          const desc = String(dr[cols.desc] ?? '').trim();
          if (isMain) {
            const ent = cellNum(dr[cols.entrada]);
            const sai = cellNum(dr[cols.saida]);
            if (!ent && !sai) continue;
            const kind = ent > 0 ? 'in' : 'out';
            const tipo = canonTipo(cols.tipo != null ? dr[cols.tipo] : '', kind);
            const realizado = cols.realizado != null ? norm(dr[cols.realizado]).startsWith('s') : tipo === 'Avulso';
            items.push({ data: iso, kind, tipo, desc: desc || tipo, valor: kind === 'in' ? ent : sai,
              categoria: cols.cat != null ? String(dr[cols.cat] ?? '').trim() : '', realizado });
          } else {
            const v = cellNum(dr[cols.valor]);
            if (!v) continue;
            items.push({ data: iso, kind: 'out', tipo: 'Avulso', desc: desc || 'Gasto avulso', valor: Math.abs(v),
              categoria: cols.cat != null ? String(dr[cols.cat] ?? '').trim() : '', realizado: true });
          }
          count++;
        }
      }
    }
    if (count) sheets.push({ name, count });
  }
  return { items, settings, sheets };
}

$('#fileImport').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const parsed = parseWorkbook(wb);
    if (!parsed.items.length) { toast('Nenhum lançamento encontrado na planilha'); return; }
    pendingImport = parsed;
    const months = [...new Set(parsed.items.map((i) => monthOf(i.data)))].sort();
    const s = parsed.settings;
    $('#importResumo').innerHTML = `<p><b>${escapeHtml(file.name)}</b> — ${parsed.items.length} lançamentos</p>
      <ul>${parsed.sheets.map((sh) => `<li>${escapeHtml(sh.name)}: ${sh.count}</li>`).join('')}</ul>
      <p class="muted">Meses que serão atualizados: ${months.map(monthLabel).join(', ')}</p>
      ${Object.keys(s).length ? `<p class="muted">Premissas encontradas: ${[
        s.saldoInicial != null && `saldo inicial ${money(s.saldoInicial)}`,
        s.extraQuiSex != null && `extra qui/sex ${money(s.extraQuiSex)}`,
        s.extraSabBase != null && `sábado ${money(s.extraSabBase)}–${money(s.extraSabTeto ?? s.extraSabBase)}`,
      ].filter(Boolean).join(', ')}</p>` : ''}`;
    $('#impSettings').closest('label').hidden = !Object.keys(s).length;
    $('#dlgImport').showModal();
  } catch (err) {
    console.error(err);
    toast('Erro ao ler a planilha: ' + err.message);
  }
});

$('#impCancel').addEventListener('click', () => { pendingImport = null; $('#dlgImport').close(); });

$('#impOk').addEventListener('click', () => {
  const p = pendingImport;
  if (!p) return;
  const months = new Set(p.items.map((i) => monthOf(i.data)));
  const apagarManuais = $('#impManuais').checked;
  const key = (i) => `${i.data}|${norm(i.desc)}|${round2(i.valor)}`;

  // preserva "realizado" marcado no app para itens que já existiam
  const realizadosNoApp = new Set(state.items.filter((i) => i.realizado && months.has(monthOf(i.data))).map(key));

  state.items = state.items.filter((i) => !(months.has(monthOf(i.data)) && (i.origem === 'import' || apagarManuais)));
  const manuaisRestantes = new Set(state.items.filter((i) => months.has(monthOf(i.data))).map(key));

  let add = 0, dup = 0;
  for (const it of p.items) {
    if (manuaisRestantes.has(key(it))) { dup++; continue; } // já lançado manualmente
    state.items.push({ id: uid(), ord: state.seq++, origem: 'import', ...it, realizado: it.realizado || realizadosNoApp.has(key(it)) });
    add++;
  }

  if ($('#impSettings').checked) {
    const s = p.settings;
    for (const k of ['saldoInicial', 'extraQuiSex', 'extraSabBase', 'extraSabTeto']) if (s[k] != null) state.settings[k] = round2(s[k]);
    if (s.saldoInicial != null) {
      const first = [...months].sort()[0];
      if (!state.settings.inicioMes || first < state.settings.inicioMes) state.settings.inicioMes = first;
    }
  }
  save();
  pendingImport = null;
  $('#dlgImport').close();
  const cur = monthOf(todayISO());
  viewMonth = months.has(cur) ? cur : [...months].sort()[0];
  render();
  showView('resumo');
  toast(`${add} lançamentos importados${dup ? ` · ${dup} já existiam` : ''}`);
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
  const resumo = XLSX.utils.aoa_to_sheet([
    ['Premissas'],
    ['Saldo inicial em conta', s.saldoInicial],
    ['Extra por quinta / sexta', s.extraQuiSex],
    ['Extra por sábado (base)', s.extraSabBase],
    ['Extra por sábado (teto)', s.extraSabTeto],
    [],
    ['Saldo real atual', saldoRealAtual()],
    ['Exportado em', new Date().toLocaleString('pt-BR')],
  ]);
  resumo['!cols'] = [{ wch: 28 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, resumo, 'Resumo');

  const run = computeRunning();
  const months = [...new Set(state.items.map((i) => monthOf(i.data)))].sort();
  for (const ym of months) {
    const aoa = [['Data', 'Tipo', 'Descrição', 'Categoria', 'Entrada', 'Saída', 'Saldo previsto', 'Realizado?', 'Saldo real']];
    for (const it of monthItems(ym)) {
      const r = run.get(it.id);
      aoa.push([
        { t: 'n', v: excelSerial(it.data), z: 'dd/mm/yyyy' }, it.tipo, it.desc, it.categoria || '',
        it.kind === 'in' ? it.valor : null, it.kind === 'out' ? it.valor : null, r.prev, it.realizado ? 'Sim' : 'Não', r.real,
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 11 }, { wch: 10 }, { wch: 34 }, { wch: 14 }, { wch: 11 }, { wch: 11 }, { wch: 14 }, { wch: 11 }, { wch: 12 }];
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
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.items)) throw new Error('arquivo inválido');
    if (!confirm(`Restaurar ${data.items.length} lançamentos? Os dados atuais serão substituídos.`)) return;
    const d = defaultState();
    state = { ...d, ...data, settings: { ...d.settings, ...(data.settings || {}) } };
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
  state = defaultState();
  save();
  render();
  toast('Dados apagados');
});

/* ---------------- Inicialização ---------------- */

render();

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
}

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
