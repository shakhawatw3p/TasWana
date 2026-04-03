// ===== PRIVACY MODE =====
let privacyOn = localStorage.getItem('taswana_privacy') === 'true';

function togglePrivacy() {
  privacyOn = !privacyOn;
  localStorage.setItem('taswana_privacy', privacyOn);
  applyPrivacy();
}

function applyPrivacy() {
  const dash = document.getElementById('page-dashboard');
  dash.classList.toggle('masked', privacyOn);
  document.getElementById('eye-open').style.display = privacyOn ? 'none' : 'block';
  document.getElementById('eye-closed').style.display = privacyOn ? 'block' : 'none';
}

// ===== DATA LAYER =====
const STORAGE_KEY = 'taswana_entries';
const LOANS_KEY = 'taswana_loans';
const TARGET = 300000; // 3 lakh BDT

function getEntries() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
}

function saveEntries(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function getLoans() {
  return JSON.parse(localStorage.getItem(LOANS_KEY) || '[]');
}

function saveLoans(loans) {
  localStorage.setItem(LOANS_KEY, JSON.stringify(loans));
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ===== FORMAT HELPERS =====
function formatBDT(n) {
  const abs = Math.abs(Math.round(n));
  let s = abs.toString();
  if (s.length > 3) {
    const last3 = s.slice(-3);
    let rest = s.slice(0, -3);
    const parts = [];
    while (rest.length > 2) {
      parts.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest) parts.unshift(rest);
    s = parts.join(',') + ',' + last3;
  }
  return (n < 0 ? '-' : '') + '৳' + s;
}

function monthKey(date) {
  const d = new Date(date);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return names[parseInt(m) - 1] + ' ' + y;
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function currentMonthKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function formatDate(d) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function esc(s) {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

// ===== NAVIGATION =====
const navBtns = document.querySelectorAll('.bottom-nav button');
const pages = document.querySelectorAll('.page');
const fab = document.getElementById('fab-btn');

let currentPage = 'dashboard';

navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    navigateTo(btn.dataset.page);
  });
});

function navigateTo(page) {
  currentPage = page;
  navBtns.forEach(b => b.classList.toggle('active', b.dataset.page === page));
  pages.forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
  fab.style.display = (page === 'graphs') ? 'none' : 'flex';
  if (page === 'dashboard') renderDashboard();
  if (page === 'savings') renderSavings();
  if (page === 'expense') renderExpenses();
  if (page === 'loans') renderLoans();
  if (page === 'graphs') renderCharts();
}

// ===== MONTH NAVIGATION =====
let savingsMonthOffset = 0;
let expenseMonthOffset = 0;

function getOffsetMonth(offset) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function changeMonth(type, dir) {
  if (type === 'savings') {
    savingsMonthOffset += dir;
    renderSavings();
  } else {
    expenseMonthOffset += dir;
    renderExpenses();
  }
}

// ===== DASHBOARD =====
function renderDashboard() {
  const entries = getEntries();
  const loans = getLoans();
  const mk = currentMonthKey();

  const totalSavings = entries
    .filter(e => e.type === 'saving')
    .reduce((s, e) => s + e.amount, 0);

  const monthSavings = entries
    .filter(e => e.type === 'saving' && monthKey(e.date) === mk)
    .reduce((s, e) => s + e.amount, 0);

  const monthExpense = entries
    .filter(e => e.type === 'expense' && monthKey(e.date) === mk)
    .reduce((s, e) => s + e.amount, 0);

  const totalLent = loans
    .filter(l => l.loanType === 'lent')
    .reduce((s, l) => s + l.amount, 0);

  const totalBorrowed = loans
    .filter(l => l.loanType === 'borrowed')
    .reduce((s, l) => s + l.amount, 0);

  // Net balance = savings + lent out (asset) - borrowed (liability)
  const netBalance = totalSavings + totalLent - totalBorrowed;

  document.getElementById('dash-total-savings').textContent = formatBDT(totalSavings);
  document.getElementById('dash-net-balance').textContent = formatBDT(netBalance);
  const netEl = document.getElementById('dash-net-balance');
  netEl.textContent = formatBDT(netBalance);
  netEl.className = 'card-value ' + (netBalance >= 0 ? 'positive' : 'negative');

  document.getElementById('dash-month-savings').textContent = formatBDT(monthSavings);
  document.getElementById('dash-month-expense').textContent = formatBDT(monthExpense);
  document.getElementById('dash-total-lent').textContent = formatBDT(totalLent);
  document.getElementById('dash-total-borrowed').textContent = formatBDT(totalBorrowed);

  // Target
  const pct = Math.min((monthSavings / TARGET) * 100, 100);
  document.getElementById('dash-target-val').textContent = formatBDT(monthSavings) + ' / ' + formatBDT(TARGET);
  const fill = document.getElementById('dash-target-fill');
  fill.style.width = pct + '%';
  fill.style.background = monthSavings >= TARGET ? 'var(--accent)' : 'var(--warning)';

  const badge = document.getElementById('dash-target-badge');
  if (monthSavings >= TARGET) {
    badge.textContent = 'Above Target';
    badge.className = 'badge above';
  } else {
    badge.textContent = 'Below Target';
    badge.className = 'badge below';
  }
}

// ===== SAVINGS LIST =====
function renderSavings() {
  const mk = getOffsetMonth(savingsMonthOffset);
  document.getElementById('savings-month-label').textContent = monthLabel(mk);

  const entries = getEntries()
    .filter(e => e.type === 'saving' && monthKey(e.date) === mk)
    .sort((a, b) => b.date.localeCompare(a.date));

  const total = entries.reduce((s, e) => s + e.amount, 0);
  document.getElementById('savings-month-total').textContent = formatBDT(total);

  const list = document.getElementById('savings-list');
  const empty = document.getElementById('savings-empty');

  if (!entries.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = entries.map(e => `
    <li class="entry-item">
      <div class="entry-info">
        <div class="entry-desc">${esc(e.desc || 'Savings')}</div>
        <div class="entry-meta">${formatDate(e.date)}</div>
      </div>
      <span class="entry-amount income">${formatBDT(e.amount)}</span>
      <div class="entry-actions">
        <button onclick="editEntry('${e.id}')" title="Edit">&#9998;</button>
        <button class="del" onclick="deleteEntry('${e.id}')" title="Delete">&times;</button>
      </div>
    </li>
  `).join('');
}

// ===== EXPENSE LIST =====
function renderExpenses() {
  const mk = getOffsetMonth(expenseMonthOffset);
  document.getElementById('expense-month-label').textContent = monthLabel(mk);

  const entries = getEntries()
    .filter(e => e.type === 'expense' && monthKey(e.date) === mk)
    .sort((a, b) => b.date.localeCompare(a.date));

  const total = entries.reduce((s, e) => s + e.amount, 0);
  document.getElementById('expense-month-total').textContent = formatBDT(total);

  const list = document.getElementById('expense-list');
  const empty = document.getElementById('expense-empty');

  if (!entries.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = entries.map(e => `
    <li class="entry-item">
      <div class="entry-info">
        <div class="entry-desc">${esc(e.desc || e.category || 'Expense')}</div>
        <div class="entry-meta">${formatDate(e.date)} <span class="cat-badge">${esc(e.category || '')}</span></div>
      </div>
      <span class="entry-amount expense">${formatBDT(e.amount)}</span>
      <div class="entry-actions">
        <button onclick="editEntry('${e.id}')" title="Edit">&#9998;</button>
        <button class="del" onclick="deleteEntry('${e.id}')" title="Delete">&times;</button>
      </div>
    </li>
  `).join('');
}

// ===== LOANS =====
let loanFilter = 'all';

function setLoanFilter(filter) {
  loanFilter = filter;
  document.getElementById('loan-tab-all').classList.toggle('active', filter === 'all');
  document.getElementById('loan-tab-borrowed').classList.toggle('active', filter === 'borrowed');
  document.getElementById('loan-tab-lent').classList.toggle('active', filter === 'lent');
  renderLoans();
}

function renderLoans() {
  const loans = getLoans();

  const totalBorrowed = loans.filter(l => l.loanType === 'borrowed').reduce((s, l) => s + l.amount, 0);
  const totalLent = loans.filter(l => l.loanType === 'lent').reduce((s, l) => s + l.amount, 0);

  document.getElementById('loans-total-borrowed').textContent = formatBDT(totalBorrowed);
  document.getElementById('loans-total-lent').textContent = formatBDT(totalLent);

  let filtered = loans;
  if (loanFilter !== 'all') {
    filtered = loans.filter(l => l.loanType === loanFilter);
  }
  filtered.sort((a, b) => b.date.localeCompare(a.date));

  const list = document.getElementById('loans-list');
  const empty = document.getElementById('loans-empty');

  if (!filtered.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = filtered.map(l => `
    <li class="entry-item">
      <div class="entry-info">
        <div class="entry-desc">${esc(l.person)}</div>
        <div class="entry-meta">
          ${formatDate(l.date)}
          <span class="loan-type-badge ${l.loanType}">${l.loanType === 'borrowed' ? 'Borrowed' : 'Lent'}</span>
          ${l.desc ? ' &mdash; ' + esc(l.desc) : ''}
        </div>
      </div>
      <span class="entry-amount ${l.loanType === 'lent' ? 'income' : 'expense'}">${formatBDT(l.amount)}</span>
      <div class="entry-actions">
        <button onclick="editLoan('${l.id}')" title="Edit">&#9998;</button>
        <button class="del" onclick="deleteLoan('${l.id}')" title="Delete">&times;</button>
      </div>
    </li>
  `).join('');
}

// ===== MODAL / FORM (Savings & Expenses) =====
let entryType = 'saving';

function setEntryType(type) {
  entryType = type;
  document.getElementById('tab-saving').classList.toggle('active', type === 'saving');
  document.getElementById('tab-expense').classList.toggle('active', type === 'expense');
  document.getElementById('category-group').style.display = type === 'expense' ? 'block' : 'none';
}

function openAddModal() {
  if (currentPage === 'loans') {
    openLoanModal();
    return;
  }

  document.getElementById('entry-id').value = '';
  document.getElementById('entry-amount').value = '';
  document.getElementById('entry-desc').value = '';
  document.getElementById('entry-date').value = todayStr();
  document.getElementById('modal-title').textContent = 'Add Entry';
  document.getElementById('entry-submit-btn').textContent = 'Save';

  if (currentPage === 'expense') {
    setEntryType('expense');
  } else {
    setEntryType('saving');
  }

  document.getElementById('add-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('add-modal').classList.remove('open');
}

function editEntry(id) {
  const e = getEntries().find(x => x.id === id);
  if (!e) return;
  document.getElementById('entry-id').value = e.id;
  document.getElementById('entry-amount').value = e.amount;
  document.getElementById('entry-desc').value = e.desc || '';
  document.getElementById('entry-date').value = e.date;
  document.getElementById('modal-title').textContent = 'Edit Entry';
  document.getElementById('entry-submit-btn').textContent = 'Update';

  setEntryType(e.type === 'expense' ? 'expense' : 'saving');
  if (e.category) document.getElementById('entry-cat').value = e.category;

  document.getElementById('add-modal').classList.add('open');
}

function deleteEntry(id) {
  if (!confirm('Delete this entry?')) return;
  const entries = getEntries().filter(e => e.id !== id);
  saveEntries(entries);
  refreshCurrentPage();
}

function saveEntry(e) {
  e.preventDefault();
  const id = document.getElementById('entry-id').value;
  const amount = parseInt(document.getElementById('entry-amount').value) || 0;
  const desc = document.getElementById('entry-desc').value.trim();
  const date = document.getElementById('entry-date').value;
  const category = entryType === 'expense' ? document.getElementById('entry-cat').value : '';

  if (amount <= 0) return;

  const entries = getEntries();

  if (id) {
    const idx = entries.findIndex(x => x.id === id);
    if (idx > -1) {
      entries[idx] = { ...entries[idx], amount, desc, date, type: entryType, category };
    }
  } else {
    entries.push({ id: genId(), type: entryType, amount, desc, date, category });
  }

  saveEntries(entries);
  closeModal();
  refreshCurrentPage();
}

// ===== LOAN MODAL =====
let loanType = 'borrowed';

function setLoanType(type) {
  loanType = type;
  document.getElementById('loan-tab-type-borrowed').classList.toggle('active', type === 'borrowed');
  document.getElementById('loan-tab-type-lent').classList.toggle('active', type === 'lent');
}

function openLoanModal() {
  document.getElementById('loan-id').value = '';
  document.getElementById('loan-amount').value = '';
  document.getElementById('loan-person').value = '';
  document.getElementById('loan-desc').value = '';
  document.getElementById('loan-date').value = todayStr();
  document.getElementById('loan-modal-title').textContent = 'Add Loan Entry';
  document.getElementById('loan-submit-btn').textContent = 'Save';
  setLoanType('borrowed');
  document.getElementById('loan-modal').classList.add('open');
}

function closeLoanModal() {
  document.getElementById('loan-modal').classList.remove('open');
}

function editLoan(id) {
  const l = getLoans().find(x => x.id === id);
  if (!l) return;
  document.getElementById('loan-id').value = l.id;
  document.getElementById('loan-amount').value = l.amount;
  document.getElementById('loan-person').value = l.person || '';
  document.getElementById('loan-desc').value = l.desc || '';
  document.getElementById('loan-date').value = l.date;
  document.getElementById('loan-modal-title').textContent = 'Edit Loan Entry';
  document.getElementById('loan-submit-btn').textContent = 'Update';
  setLoanType(l.loanType);
  document.getElementById('loan-modal').classList.add('open');
}

function deleteLoan(id) {
  if (!confirm('Delete this loan entry?')) return;
  const loans = getLoans().filter(l => l.id !== id);
  saveLoans(loans);
  refreshCurrentPage();
}

function saveLoan(e) {
  e.preventDefault();
  const id = document.getElementById('loan-id').value;
  const amount = parseInt(document.getElementById('loan-amount').value) || 0;
  const person = document.getElementById('loan-person').value.trim();
  const desc = document.getElementById('loan-desc').value.trim();
  const date = document.getElementById('loan-date').value;

  if (amount <= 0 || !person) return;

  const loans = getLoans();

  if (id) {
    const idx = loans.findIndex(x => x.id === id);
    if (idx > -1) {
      loans[idx] = { ...loans[idx], amount, person, desc, date, loanType };
    }
  } else {
    loans.push({ id: genId(), loanType, amount, person, desc, date });
  }

  saveLoans(loans);
  closeLoanModal();
  refreshCurrentPage();
}

function refreshCurrentPage() {
  navigateTo(currentPage);
}

// Close modals on overlay click
document.getElementById('add-modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});
document.getElementById('loan-modal').addEventListener('click', function(e) {
  if (e.target === this) closeLoanModal();
});

// ===== CHARTS =====
let mainChart = null;
let catChart = null;
let activeChart = 'savings';

function switchChart(type) {
  activeChart = type;
  document.querySelectorAll('#page-graphs .tab-btn').forEach((b, i) => {
    b.classList.toggle('active', (i === 0 && type === 'savings') || (i === 1 && type === 'expense'));
  });
  document.getElementById('category-chart-card').style.display = type === 'expense' ? 'block' : 'none';
  renderCharts();
}

function renderCharts() {
  const entries = getEntries();
  const months = getLast12Months();

  const data = months.map(mk => {
    return entries
      .filter(e => e.type === (activeChart === 'savings' ? 'saving' : 'expense') && monthKey(e.date) === mk)
      .reduce((s, e) => s + e.amount, 0);
  });

  const ctx = document.getElementById('main-chart').getContext('2d');
  if (mainChart) mainChart.destroy();

  mainChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map(m => monthLabel(m)),
      datasets: [{
        label: activeChart === 'savings' ? 'Savings (BDT)' : 'Expenses (BDT)',
        data: data,
        backgroundColor: activeChart === 'savings' ? '#25d366' : '#ef4444',
        borderRadius: 6,
        barPercentage: 0.6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => formatBDT(ctx.raw)
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: v => v >= 100000 ? (v / 100000) + 'L' : v >= 1000 ? (v / 1000) + 'K' : v
          }
        },
        x: {
          ticks: { font: { size: 10 }, maxRotation: 45 }
        }
      }
    }
  });

  // Category doughnut (expenses only)
  if (activeChart === 'expense') {
    const last6 = months.slice(-6);
    const catTotals = {};
    entries
      .filter(e => e.type === 'expense' && last6.includes(monthKey(e.date)))
      .forEach(e => {
        const cat = e.category || 'Other';
        catTotals[cat] = (catTotals[cat] || 0) + e.amount;
      });

    const cats = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a]);
    const catColors = [
      '#075e54','#128c7e','#25d366','#f59e0b','#ef4444','#8b5cf6',
      '#ec4899','#06b6d4','#84cc16','#f97316','#6366f1','#14b8a6',
      '#e11d48','#a3a3a3'
    ];

    const ctx2 = document.getElementById('category-chart').getContext('2d');
    if (catChart) catChart.destroy();

    if (cats.length) {
      catChart = new Chart(ctx2, {
        type: 'doughnut',
        data: {
          labels: cats,
          datasets: [{
            data: cats.map(c => catTotals[c]),
            backgroundColor: catColors.slice(0, cats.length),
            borderWidth: 2,
            borderColor: '#fff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            tooltip: {
              callbacks: {
                label: ctx => ctx.label + ': ' + formatBDT(ctx.raw)
              }
            }
          }
        }
      });
    }
  }
}

function getLast12Months() {
  const months = [];
  const d = new Date();
  for (let i = 11; i >= 0; i--) {
    const dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
    months.push(dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0'));
  }
  return months;
}

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

// ===== INIT =====
renderDashboard();
applyPrivacy();
