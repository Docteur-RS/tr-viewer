const ETF_COLORS = [
  '#c8a44e', '#5b9cf6', '#3ecf8e', '#ef6461',
  '#b07ee1', '#e8a838', '#4ecdc4', '#f78fb3',
  '#7c8cf8', '#f9c74f'
];

let rawTransactions = [];
let portfolioChart = null;
let allocationChart = null;
let etfPriceChart = null;
let selectedEtf = null;
let txFilterCategory = 'ALL';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function fmt(n, decimals = 2) {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(n);
}

function fmtCurrency(n) {
  return fmt(n) + ' €';
}

function fmtPct(n) {
  const sign = n >= 0 ? '+' : '';
  return sign + fmt(n) + '%';
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

function fmtDateShort(d) {
  return new Date(d).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short'
  });
}

function parseCSV(text) {
  const result = Papa.parse(text.trim(), {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  return result.data.map(row => ({
    datetime: row.datetime,
    date: row.date,
    accountType: row.account_type,
    category: row.category,
    type: row.type,
    assetClass: row.asset_class || '',
    name: (row.name || '').trim(),
    symbol: (row.symbol || '').trim(),
    shares: parseFloat(row.shares) || 0,
    price: parseFloat(row.price) || 0,
    amount: parseFloat(row.amount) || 0,
    fee: parseFloat(row.fee) || 0,
    tax: parseFloat(row.tax) || 0,
    currency: row.currency || 'EUR',
    description: row.description || '',
  }));
}

function getTradingTransactions() {
  return rawTransactions.filter(t => t.category === 'TRADING');
}

function getBuys() {
  return getTradingTransactions().filter(t => t.type === 'BUY');
}

function getUniqueAssets() {
  const map = new Map();
  for (const t of getTradingTransactions()) {
    if (!t.symbol) continue;
    if (!map.has(t.symbol)) {
      map.set(t.symbol, {
        symbol: t.symbol,
        name: t.name,
        assetClass: t.assetClass,
        color: ETF_COLORS[map.size % ETF_COLORS.length],
      });
    }
  }
  return map;
}

function getAssetHoldings() {
  const assets = getUniqueAssets();
  const holdings = new Map();
  for (const [symbol, info] of assets) {
    const trades = getTradingTransactions().filter(t => t.symbol === symbol);
    let totalShares = 0;
    let totalCost = 0;
    let totalFees = 0;
    let lastPrice = 0;
    const priceHistory = [];
    for (const t of trades) {
      if (t.type === 'BUY') {
        totalShares += t.shares;
        totalCost += Math.abs(t.amount);
        totalFees += Math.abs(t.fee);
        lastPrice = t.price;
        priceHistory.push({ date: t.date, price: t.price, shares: totalShares });
      } else if (t.type === 'SELL') {
        totalShares -= t.shares;
        totalCost -= (t.shares * t.price);
        lastPrice = t.price;
        priceHistory.push({ date: t.date, price: t.price, shares: totalShares });
      }
    }
    const avgPrice = totalShares > 0 ? totalCost / totalShares : 0;
    const currentValue = totalShares * lastPrice;
    const invested = totalCost + totalFees;
    let pnl = currentValue - invested;
    if (Math.abs(pnl) < 0.005) pnl = 0;
    const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
    holdings.set(symbol, {
      ...info,
      totalShares,
      avgPrice,
      totalCost,
      totalFees,
      invested,
      lastPrice,
      currentValue,
      pnl,
      pnlPct,
      priceHistory,
      trades,
    });
  }
  return holdings;
}

function getPortfolioTimeline() {
  const buys = getBuys().sort((a, b) => a.date.localeCompare(b.date));
  if (buys.length === 0) return [];
  const dailyMap = new Map();
  let cumulInvested = 0;
  let cumulFees = 0;
  const assetLastPrice = new Map();
  const assetShares = new Map();
  const deposits = rawTransactions
    .filter(t => t.type === 'TRANSFER_INSTANT_INBOUND' || t.type === 'TRANSFER_INBOUND')
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const allDates = [...new Set(rawTransactions.map(t => t.date))].sort();
  for (const t of buys) {
    if (!assetShares.has(t.symbol)) {
      assetShares.set(t.symbol, 0);
    }
    assetShares.set(t.symbol, assetShares.get(t.symbol) + t.shares);
    assetLastPrice.set(t.symbol, t.price);
    cumulInvested += Math.abs(t.amount);
    cumulFees += t.fee;
  }
  for (const d of allDates) {
    const dayTrades = buys.filter(t => t.date <= d);
    if (dayTrades.length === 0) continue;
    let inv = 0;
    let fees = 0;
    let val = 0;
    const sMap = new Map();
    const pMap = new Map();
    for (const t of dayTrades) {
      if (!sMap.has(t.symbol)) sMap.set(t.symbol, 0);
      sMap.set(t.symbol, sMap.get(t.symbol) + t.shares);
      pMap.set(t.symbol, t.price);
      inv += Math.abs(t.amount);
      fees += t.fee;
    }
    for (const [sym, shares] of sMap) {
      val += shares * (pMap.get(sym) || 0);
    }
    dailyMap.set(d, { invested: inv + fees, value: val });
  }
  return Array.from(dailyMap.entries()).map(([date, data]) => ({
    date,
    ...data
  }));
}

function getTotalDeposits() {
  return rawTransactions
    .filter(t => t.type === 'TRANSFER_INSTANT_INBOUND' || t.type === 'TRANSFER_INBOUND')
    .reduce((s, t) => s + Math.abs(t.amount), 0);
}

function getTotalInterest() {
  return rawTransactions
    .filter(t => t.type === 'INTEREST_PAYMENT')
    .reduce((s, t) => s + Math.abs(t.amount), 0);
}

function getTotalFees() {
  return rawTransactions.reduce((s, t) => s + Math.abs(t.fee), 0);
}

function getTotalTaxes() {
  return rawTransactions.reduce((s, t) => s + Math.abs(t.tax), 0);
}

function getTotalInvested() {
  const holdings = getAssetHoldings();
  let total = 0;
  for (const [, h] of holdings) total += h.invested;
  return total;
}

function getTotalPortfolioValue() {
  const holdings = getAssetHoldings();
  let total = 0;
  for (const [, h] of holdings) total += h.currentValue;
  return total;
}

function renderKPIs() {
  const row = $('#kpi-row');
  const invested = getTotalInvested();
  const value = getTotalPortfolioValue();
  const pnl = value - invested;
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
  const deposits = getTotalDeposits();
  const interest = getTotalInterest();
  const fees = getTotalFees();
  row.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Valeur portefeuille</div>
      <div class="kpi-value">${fmtCurrency(value)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Total investi</div>
      <div class="kpi-value">${fmtCurrency(invested)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">P&L non réalisé</div>
      <div class="kpi-value ${pnl >= 0 ? 'positive' : 'negative'}">${fmtCurrency(pnl)}</div>
      <div class="kpi-sub ${pnl >= 0 ? 'positive' : 'negative'}">${fmtPct(pnlPct)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Dépôts</div>
      <div class="kpi-value">${fmtCurrency(deposits)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Intérêts</div>
      <div class="kpi-value">${fmtCurrency(interest)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Frais</div>
      <div class="kpi-value negative" style="color:var(--red)">${fmtCurrency(fees)}</div>
    </div>
  `;
}

function renderPortfolioChart() {
  const timeline = getPortfolioTimeline();
  const ctx = $('#portfolio-chart');
  if (portfolioChart) portfolioChart.destroy();
  if (timeline.length === 0) {
    portfolioChart = null;
    return;
  }
  const labels = timeline.map(t => t.date);
  portfolioChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Valeur',
          data: timeline.map(t => t.value),
          borderColor: '#c8a44e',
          backgroundColor: 'rgba(200,164,78,0.08)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: '#c8a44e',
          pointBorderWidth: 0,
          borderWidth: 2,
        },
        {
          label: 'Investi',
          data: timeline.map(t => t.invested),
          borderColor: '#5c5b57',
          borderDash: [6, 4],
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.1,
          pointRadius: 0,
          borderWidth: 1.5,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            color: '#8a8983',
            font: { family: "'DM Sans'", size: 12 },
            boxWidth: 12,
            boxHeight: 2,
            padding: 16,
          }
        },
        tooltip: {
          backgroundColor: '#25262b',
          titleColor: '#f0efe8',
          bodyColor: '#c4c3bc',
          borderColor: '#2a2b30',
          borderWidth: 1,
          titleFont: { family: "'DM Sans'", weight: '600' },
          bodyFont: { family: "'JetBrains Mono'", size: 12 },
          padding: 12,
          callbacks: {
            label: ctx => ctx.dataset.label + ': ' + fmtCurrency(ctx.parsed.y)
          }
        }
      },
      scales: {
        x: {
          type: 'category',
          ticks: {
            color: '#5c5b57',
            font: { family: "'DM Sans'", size: 11 },
            maxRotation: 0,
            callback: function(val, i) {
              const label = this.getLabelForValue(val);
              return fmtDateShort(label);
            }
          },
          grid: { color: 'rgba(42,43,48,0.5)', drawBorder: false }
        },
        y: {
          ticks: {
            color: '#5c5b57',
            font: { family: "'JetBrains Mono'", size: 11 },
            callback: v => fmt(v) + '€'
          },
          grid: { color: 'rgba(42,43,48,0.5)', drawBorder: false }
        }
      }
    }
  });
}

function renderAllocationChart() {
  const holdings = getAssetHoldings();
  const ctx = $('#allocation-chart');
  if (allocationChart) allocationChart.destroy();
  const entries = [...holdings.values()].filter(h => h.totalShares > 0);
  if (entries.length === 0) {
    allocationChart = null;
    return;
  }
  allocationChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: entries.map(h => h.name),
      datasets: [{
        data: entries.map(h => h.currentValue),
        backgroundColor: entries.map(h => h.color),
        borderColor: '#18191d',
        borderWidth: 3,
        hoverOffset: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#8a8983',
            font: { family: "'DM Sans'", size: 11.5 },
            padding: 14,
            boxWidth: 10,
            boxHeight: 10,
            borderRadius: 2,
            useBorderRadius: true,
          }
        },
        tooltip: {
          backgroundColor: '#25262b',
          titleColor: '#f0efe8',
          bodyColor: '#c4c3bc',
          borderColor: '#2a2b30',
          borderWidth: 1,
          bodyFont: { family: "'JetBrains Mono'", size: 12 },
          padding: 12,
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = ((ctx.parsed / total) * 100).toFixed(1);
              return fmtCurrency(ctx.parsed) + ' (' + pct + '%)';
            }
          }
        }
      }
    }
  });
}

function renderHoldingsTable() {
  const holdings = getAssetHoldings();
  const tbody = $('#holdings-table tbody');
  const entries = [...holdings.values()].filter(h => h.totalShares > 0);
  if (entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-3);padding:32px">Aucune position</td></tr>';
    return;
  }
  tbody.innerHTML = entries.map(h => `
    <tr class="clickable-row" data-symbol="${h.symbol}">
      <td>
        <div class="asset-name">
          <span style="color:${h.color}">${h.name}</span>
          <span class="asset-symbol">${h.symbol}</span>
        </div>
      </td>
      <td class="mono">${fmt(h.totalShares, 4)}</td>
      <td class="mono">${fmtCurrency(h.avgPrice)}</td>
      <td class="mono">${fmtCurrency(h.invested)}</td>
      <td class="mono">${fmtCurrency(h.lastPrice)}</td>
      <td class="mono">${fmtCurrency(h.currentValue)}</td>
      <td class="mono ${h.pnl >= 0 ? 'positive' : 'negative'}">${fmtCurrency(h.pnl)}<br><small>${fmtPct(h.pnlPct)}</small></td>
    </tr>
  `).join('');
  tbody.querySelectorAll('.clickable-row').forEach(row => {
    row.addEventListener('click', () => {
      navigateToEtf(row.dataset.symbol);
    });
  });
}

function renderDashboard() {
  renderKPIs();
  renderPortfolioChart();
  renderAllocationChart();
  renderHoldingsTable();
}

function renderEtfSidebarList() {
  const holdings = getAssetHoldings();
  const list = $('#etf-list');
  const section = $('#etf-list-section');
  const entries = [...holdings.values()];
  if (entries.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  list.innerHTML = entries.map(h => `
    <button class="etf-sidebar-item ${selectedEtf === h.symbol ? 'active' : ''}" data-symbol="${h.symbol}">
      <span class="etf-dot" style="background:${h.color}"></span>
      ${h.name}
    </button>
  `).join('');
  list.querySelectorAll('.etf-sidebar-item').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateToEtf(btn.dataset.symbol);
    });
  });
}

function renderEtfDetail(symbol) {
  const holdings = getAssetHoldings();
  const h = holdings.get(symbol);
  if (!h) return;
  selectedEtf = symbol;
  $('#etf-detail-title').textContent = h.name;
  $('#etf-detail-subtitle').textContent = h.symbol + ' · ' + h.assetClass;
  const kpiRow = $('#etf-detail-kpi');
  kpiRow.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Parts détenues</div>
      <div class="kpi-value">${fmt(h.totalShares, 4)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Prix moyen</div>
      <div class="kpi-value">${fmtCurrency(h.avgPrice)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Dernier prix</div>
      <div class="kpi-value">${fmtCurrency(h.lastPrice)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Total investi</div>
      <div class="kpi-value">${fmtCurrency(h.invested)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Valeur actuelle</div>
      <div class="kpi-value">${fmtCurrency(h.currentValue)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">P&L</div>
      <div class="kpi-value ${h.pnl >= 0 ? 'positive' : 'negative'}">${fmtCurrency(h.pnl)}</div>
      <div class="kpi-sub ${h.pnl >= 0 ? 'positive' : 'negative'}">${fmtPct(h.pnlPct)}</div>
    </div>
  `;
  renderEtfPriceChart(h);
  renderEtfTransactionsTable(h);
  renderEtfSidebarList();
}

function renderEtfPriceChart(h) {
  const ctx = $('#etf-price-chart');
  if (etfPriceChart) etfPriceChart.destroy();
  const history = h.priceHistory;
  if (history.length === 0) {
    etfPriceChart = null;
    return;
  }
  etfPriceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: history.map(p => p.date),
      datasets: [
        {
          label: 'Prix',
          data: history.map(p => p.price),
          borderColor: h.color,
          backgroundColor: hexToRgba(h.color, 0.08),
          fill: true,
          tension: 0.3,
          pointRadius: 5,
          pointBackgroundColor: h.color,
          pointBorderWidth: 0,
          borderWidth: 2,
          yAxisID: 'y',
        },
        {
          label: 'Parts cumulées',
          data: history.map(p => p.shares),
          borderColor: '#5c5b57',
          borderDash: [4, 3],
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.1,
          pointRadius: 0,
          borderWidth: 1.5,
          yAxisID: 'y1',
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            color: '#8a8983',
            font: { family: "'DM Sans'", size: 12 },
            boxWidth: 12,
            boxHeight: 2,
            padding: 16,
          }
        },
        tooltip: {
          backgroundColor: '#25262b',
          titleColor: '#f0efe8',
          bodyColor: '#c4c3bc',
          borderColor: '#2a2b30',
          borderWidth: 1,
          bodyFont: { family: "'JetBrains Mono'", size: 12 },
          padding: 12,
          callbacks: {
            title: items => fmtDate(items[0].label),
            label: ctx => {
              if (ctx.datasetIndex === 0) return 'Prix: ' + fmtCurrency(ctx.parsed.y);
              return 'Parts: ' + fmt(ctx.parsed.y, 4);
            }
          }
        }
      },
      scales: {
        x: {
          type: 'category',
          ticks: {
            color: '#5c5b57',
            font: { family: "'DM Sans'", size: 11 },
            maxRotation: 0,
            callback: function(val) { return fmtDateShort(this.getLabelForValue(val)); }
          },
          grid: { color: 'rgba(42,43,48,0.5)', drawBorder: false }
        },
        y: {
          position: 'left',
          ticks: {
            color: '#5c5b57',
            font: { family: "'JetBrains Mono'", size: 11 },
            callback: v => fmtCurrency(v)
          },
          grid: { color: 'rgba(42,43,48,0.5)', drawBorder: false }
        },
        y1: {
          position: 'right',
          ticks: {
            color: '#5c5b57',
            font: { family: "'JetBrains Mono'", size: 11 },
            callback: v => fmt(v, 1)
          },
          grid: { display: false }
        }
      }
    }
  });
}

function renderEtfTransactionsTable(h) {
  const tbody = $('#etf-transactions-table tbody');
  const trades = [...h.trades].sort((a, b) => b.date.localeCompare(a.date));
  tbody.innerHTML = trades.map(t => `
    <tr>
      <td>${fmtDate(t.date)}</td>
      <td><span class="badge ${t.type === 'BUY' ? 'badge-buy' : 'badge-sell'}">${t.type}</span></td>
      <td><span class="account-badge ${t.accountType === 'PEA' ? 'pea' : ''}">${t.accountType}</span></td>
      <td class="mono">${fmt(t.shares, 4)}</td>
      <td class="mono">${fmtCurrency(t.price)}</td>
      <td class="mono">${fmtCurrency(Math.abs(t.amount))}</td>
      <td class="mono">${t.fee ? fmtCurrency(t.fee) : '—'}</td>
    </tr>
  `).join('');
}

function navigateToEtf(symbol) {
  selectedEtf = symbol;
  switchView('etf-detail');
  renderEtfDetail(symbol);
}

function getTypeBadgeClass(type) {
  if (type === 'BUY') return 'badge-buy';
  if (type === 'SELL') return 'badge-sell';
  if (type.includes('TRANSFER')) return 'badge-transfer';
  if (type === 'INTEREST_PAYMENT') return 'badge-interest';
  if (type === 'STOCKPERK') return 'badge-interest';
  return 'badge-other';
}

function getTypeLabel(t) {
  const map = {
    'BUY': 'Achat',
    'SELL': 'Vente',
    'TRANSFER_INSTANT_INBOUND': 'Dépôt',
    'TRANSFER_INBOUND': 'Dépôt',
    'TRANSFER_OUT': 'Retrait',
    'TRANSFER_IN': 'Transfert',
    'INTEREST_PAYMENT': 'Intérêts',
    'STOCKPERK': 'Stockperk',
  };
  return map[t.type] || t.type;
}

function renderTransactionsView() {
  const filtersRow = $('#filters-row');
  const categories = ['ALL', 'TRADING', 'CASH'];
  const labels = { ALL: 'Tout', TRADING: 'Trading', CASH: 'Cash' };
  filtersRow.innerHTML = categories.map(c => `
    <button class="filter-chip ${txFilterCategory === c ? 'active' : ''}" data-cat="${c}">${labels[c]}</button>
  `).join('');
  filtersRow.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      txFilterCategory = btn.dataset.cat;
      renderTransactionsView();
    });
  });
  let txs = [...rawTransactions].sort((a, b) => b.date.localeCompare(a.date));
  if (txFilterCategory !== 'ALL') {
    txs = txs.filter(t => t.category === txFilterCategory);
  }
  const tbody = $('#all-transactions-table tbody');
  tbody.innerHTML = txs.map(t => `
    <tr>
      <td>${fmtDate(t.date)}</td>
      <td>${t.category}</td>
      <td><span class="badge ${getTypeBadgeClass(t.type)}">${getTypeLabel(t)}</span></td>
      <td><span class="account-badge ${t.accountType === 'PEA' ? 'pea' : ''}">${t.accountType}</span></td>
      <td>${t.name || '—'}</td>
      <td class="mono">${t.shares ? fmt(t.shares, 4) : '—'}</td>
      <td class="mono">${t.price ? fmtCurrency(t.price) : '—'}</td>
      <td class="mono ${t.amount < 0 ? 'negative' : t.amount > 0 ? 'positive' : ''}">${t.amount ? fmtCurrency(Math.abs(t.amount)) : '—'}</td>
      <td class="mono">${t.fee ? fmtCurrency(t.fee) : '—'}</td>
      <td class="mono">${t.tax ? fmtCurrency(t.tax) : '—'}</td>
    </tr>
  `).join('');
}

function switchView(viewName) {
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`#view-${viewName}`).classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.remove('active'));
  const navBtn = $(`.nav-btn[data-view="${viewName}"]`);
  if (navBtn) navBtn.classList.add('active');
  if (viewName === 'dashboard') {
    renderDashboard();
  } else if (viewName === 'transactions') {
    renderTransactionsView();
  }
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function initNavigation() {
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view === 'etf-detail' && !selectedEtf) {
        const holdings = getAssetHoldings();
        const first = holdings.values().next().value;
        if (first) {
          navigateToEtf(first.symbol);
          return;
        }
      }
      switchView(view);
    });
  });
}

function handleCSVUpload(file) {
  const reader = new FileReader();
  reader.onload = e => {
    rawTransactions = parseCSV(e.target.result);
    selectedEtf = null;
    txFilterCategory = 'ALL';
    renderDashboard();
    renderEtfSidebarList();
  };
  reader.readAsText(file);
}

function loadDefaultCSV() {
  fetch('transaction.csv')
    .then(r => r.text())
    .then(text => {
      rawTransactions = parseCSV(text);
      renderDashboard();
      renderEtfSidebarList();
    })
    .catch(() => {
      renderDashboard();
    });
}

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  $('#csv-upload').addEventListener('change', e => {
    if (e.target.files[0]) handleCSVUpload(e.target.files[0]);
  });
  loadDefaultCSV();
});
