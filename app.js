// ===== FIREBASE =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth, signInWithPopup, signOut as fbSignOut, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDRILmWna4Q8wMwktqGr7V_D7Lgw7lDPco",
  authDomain: "taswana-2014.firebaseapp.com",
  projectId: "taswana-2014",
  storageBucket: "taswana-2014.firebasestorage.app",
  messagingSenderId: "522304487789",
  appId: "1:522304487789:web:db99375aa240ce6b1f9a64"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
let fbUser = null;

// ===== END-TO-END ENCRYPTION =====
const SALT_KEY = 'taswana_e2e_salt';

function getE2ESalt() {
  let salt = localStorage.getItem(SALT_KEY);
  if (!salt) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    salt = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(SALT_KEY, salt);
  }
  return salt;
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

async function deriveKey(pin, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(plainObj, pin, saltHex) {
  const key = await deriveKey(pin, saltHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(plainObj))
  );
  return {
    iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
    data: Array.from(new Uint8Array(ciphertext)).map(b => b.toString(16).padStart(2, '0')).join('')
  };
}

async function decryptData(encObj, pin, saltHex) {
  const key = await deriveKey(pin, saltHex);
  const iv = hexToBytes(encObj.iv);
  const ciphertext = hexToBytes(encObj.data);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}

// ===== SYNC =====
function setSyncStatus(status) {
  const el = document.getElementById('sync-status');
  el.className = 'sync-status ' + status;
}

async function syncToCloud() {
  if (!fbUser) return;
  const pin = localStorage.getItem(PIN_KEY);
  if (!pin) return;
  setSyncStatus('syncing');
  try {
    const salt = getE2ESalt();
    const plainData = {
      entries: getEntries(),
      loans: getLoans(),
      moneyStorage: getMoneyStorage(),
      target: getTarget(),
      silverPrice: getSilverPrice(),
      hawl: getHawlDate(),
      pin: pin
    };
    const encrypted = await encryptData(plainData, pin, salt);
    await setDoc(doc(db, 'users', fbUser.uid), {
      encrypted: encrypted,
      salt: salt,
      e2e: true,
      updatedAt: new Date().toISOString()
    });
    setSyncStatus('synced');
  } catch (err) {
    console.error('Sync to cloud failed:', err);
    setSyncStatus('offline');
  }
}

async function syncFromCloud() {
  if (!fbUser) return;
  const pin = localStorage.getItem(PIN_KEY);
  if (!pin) return;
  setSyncStatus('syncing');
  try {
    const snap = await getDoc(doc(db, 'users', fbUser.uid));
    if (snap.exists()) {
      const doc_data = snap.data();

      // Handle encrypted data (new format)
      if (doc_data.e2e && doc_data.encrypted) {
        try {
          const salt = doc_data.salt;
          localStorage.setItem(SALT_KEY, salt);
          const data = await decryptData(doc_data.encrypted, pin, salt);
          if (data.entries) saveEntriesToLocal(data.entries);
          if (data.loans) saveLoansToLocal(data.loans);
          if (data.moneyStorage) localStorage.setItem(MONEY_STORAGE_KEY, JSON.stringify(data.moneyStorage));
          if (data.target) localStorage.setItem(TARGET_KEY, data.target);
          if (data.silverPrice) localStorage.setItem(SILVER_PRICE_KEY, data.silverPrice);
          if (data.hawl) localStorage.setItem(HAWL_KEY, data.hawl);
          refreshCurrentPage();
        } catch (decErr) {
          console.error('Decryption failed — PIN may not match:', decErr);
        }
      }
      // Handle legacy unencrypted data
      else if (doc_data.entries) {
        if (doc_data.entries) saveEntriesToLocal(doc_data.entries);
        if (doc_data.loans) saveLoansToLocal(doc_data.loans);
        if (doc_data.moneyStorage) localStorage.setItem(MONEY_STORAGE_KEY, JSON.stringify(doc_data.moneyStorage));
        if (doc_data.target) localStorage.setItem(TARGET_KEY, doc_data.target);
        if (doc_data.silverPrice) localStorage.setItem(SILVER_PRICE_KEY, doc_data.silverPrice);
        if (doc_data.hawl) localStorage.setItem(HAWL_KEY, doc_data.hawl);
        refreshCurrentPage();
        // Re-encrypt legacy data
        await syncToCloud();
      }
    }
    setSyncStatus('synced');
  } catch (err) {
    console.error('Sync from cloud failed:', err);
    setSyncStatus('offline');
  }
}

onAuthStateChanged(auth, async (user) => {
  fbUser = user;
  updateCloudUI();
  if (user) {
    await syncFromCloud();
  } else {
    setSyncStatus('offline');
  }
});

function updateCloudUI() {
  const statusEl = document.getElementById('cloud-status');
  const signInBtn = document.getElementById('cloud-signin-btn');
  const signOutBtn = document.getElementById('cloud-signout-btn');
  if (fbUser) {
    statusEl.innerHTML = 'Signed in as <strong>' + esc(fbUser.email) + '</strong><br>Data is end-to-end encrypted with your PIN. Not even the app owner can read it.';
    signInBtn.style.display = 'none';
    signOutBtn.style.display = 'flex';
  } else {
    statusEl.textContent = 'Sign in with Google to sync your data to the cloud. Data is end-to-end encrypted with your PIN — only you can read it.';
    signInBtn.style.display = 'flex';
    signOutBtn.style.display = 'none';
  }
}

window.cloudSignIn = async function() {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      alert('Sign-in failed: ' + err.message);
    }
  }
};

window.cloudSignOut = async function() {
  if (!confirm('Sign out? Your data will remain locally but won\'t sync to cloud.')) return;
  await fbSignOut(auth);
  setSyncStatus('offline');
};

// ===== PIN LOCK =====
const PIN_KEY = 'taswana_pin';
let currentPin = '';
let pinMode = 'unlock';
let newPinTemp = '';

function getStoredPin() {
  return localStorage.getItem(PIN_KEY);
}

function initLock() {
  const stored = getStoredPin();
  if (!stored) {
    pinMode = 'setup';
    document.getElementById('lock-subtitle').textContent = 'Create a 4-digit PIN';
  } else {
    pinMode = 'unlock';
    document.getElementById('lock-subtitle').textContent = 'Enter your PIN';
    document.getElementById('lock-change-btn').style.display = 'none';
  }
  currentPin = '';
  updateDots();
}

window.pinInput = function(digit) {
  if (currentPin.length >= 4) return;
  currentPin += digit;
  updateDots();
  if (currentPin.length === 4) {
    setTimeout(handlePinComplete, 150);
  }
};

window.pinDelete = function() {
  currentPin = currentPin.slice(0, -1);
  updateDots();
  document.getElementById('pin-error').textContent = '';
};

function updateDots() {
  const dots = document.querySelectorAll('#pin-dots span');
  dots.forEach((d, i) => {
    d.classList.toggle('filled', i < currentPin.length);
    d.classList.remove('error');
  });
}

function handlePinComplete() {
  const stored = getStoredPin();

  if (pinMode === 'setup') {
    newPinTemp = currentPin;
    pinMode = 'confirm';
    document.getElementById('lock-subtitle').textContent = 'Confirm your PIN';
    currentPin = '';
    updateDots();
    return;
  }

  if (pinMode === 'confirm') {
    if (currentPin === newPinTemp) {
      localStorage.setItem(PIN_KEY, currentPin);
      unlockApp();
    } else {
      showPinError("PINs don't match. Try again.");
      pinMode = 'setup';
      document.getElementById('lock-subtitle').textContent = 'Create a 4-digit PIN';
      newPinTemp = '';
    }
    return;
  }

  if (pinMode === 'new') {
    newPinTemp = currentPin;
    pinMode = 'confirm';
    document.getElementById('lock-subtitle').textContent = 'Confirm new PIN';
    currentPin = '';
    updateDots();
    return;
  }

  if (currentPin === stored) {
    unlockApp();
  } else {
    showPinError('Wrong PIN');
  }
}

function showPinError(msg) {
  const dots = document.getElementById('pin-dots');
  const dotsSpans = dots.querySelectorAll('span');
  dotsSpans.forEach(d => { d.classList.add('error'); d.classList.remove('filled'); });
  dots.classList.add('shake');
  document.getElementById('pin-error').textContent = msg;
  currentPin = '';
  setTimeout(() => {
    dots.classList.remove('shake');
    dotsSpans.forEach(d => d.classList.remove('error'));
  }, 500);
}

function unlockApp() {
  const lock = document.getElementById('lock-screen');
  lock.classList.add('unlocked');
  setTimeout(() => { lock.style.display = 'none'; }, 300);
}

window.startChangePin = function() {
  pinMode = 'new';
  document.getElementById('lock-subtitle').textContent = 'Enter new PIN';
  document.getElementById('pin-error').textContent = '';
  document.getElementById('lock-change-btn').style.display = 'none';
  currentPin = '';
  updateDots();
};

window.reloadApp = function() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(r => r.unregister());
    }).then(() => {
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
        window.location.reload(true);
      });
    });
  } else {
    window.location.reload(true);
  }
};

window.lockApp = function() {
  const lock = document.getElementById('lock-screen');
  lock.style.display = 'flex';
  lock.classList.remove('unlocked');
  pinMode = 'unlock';
  document.getElementById('lock-subtitle').textContent = 'Enter your PIN';
  document.getElementById('lock-change-btn').style.display = 'inline-block';
  document.getElementById('pin-error').textContent = '';
  currentPin = '';
  updateDots();
};

// ===== PRIVACY MODE =====
let privacyOn = localStorage.getItem('taswana_privacy') === 'true';

window.togglePrivacy = function() {
  privacyOn = !privacyOn;
  localStorage.setItem('taswana_privacy', privacyOn);
  applyPrivacy();
};

function applyPrivacy() {
  const dash = document.getElementById('page-dashboard');
  dash.classList.toggle('masked', privacyOn);
  document.getElementById('eye-open').style.display = privacyOn ? 'none' : 'block';
  document.getElementById('eye-closed').style.display = privacyOn ? 'block' : 'none';
}

// ===== ZAKAT =====
const SILVER_PRICE_KEY = 'taswana_silver_price';
const HAWL_KEY = 'taswana_hawl';
const LUNAR_YEAR_DAYS = 354;
const NISAB_GRAMS = 612.36;
const SILVER_UNIT_GRAMS = 11.66;

function getSilverPrice() {
  return parseInt(localStorage.getItem(SILVER_PRICE_KEY)) || 0;
}

function calcNisab() {
  const pricePerUnit = getSilverPrice();
  if (pricePerUnit <= 0) return 0;
  const pricePerGram = pricePerUnit / SILVER_UNIT_GRAMS;
  return Math.round(NISAB_GRAMS * pricePerGram);
}

function getHawlDate() {
  return localStorage.getItem(HAWL_KEY) || '';
}

function isHawlComplete() {
  const hawl = getHawlDate();
  if (!hawl) return false;
  const start = new Date(hawl + 'T00:00:00');
  const now = new Date();
  const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  return diffDays >= LUNAR_YEAR_DAYS;
}

function getHawlDaysRemaining() {
  const hawl = getHawlDate();
  if (!hawl) return -1;
  const start = new Date(hawl + 'T00:00:00');
  const now = new Date();
  const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  return Math.max(0, LUNAR_YEAR_DAYS - diffDays);
}

function renderZakat() {
  const entries = getEntries();
  const loans = getLoans();

  const totalSavings = entries
    .filter(e => e.type === 'saving')
    .reduce((s, e) => s + e.amount, 0);

  const totalLent = loans
    .filter(l => l.loanType === 'lent')
    .reduce((s, l) => s + l.amount, 0);

  const totalBorrowed = loans
    .filter(l => l.loanType === 'borrowed')
    .reduce((s, l) => s + l.amount, 0);

  const totalExpenses = entries
    .filter(e => e.type === 'expense')
    .reduce((s, e) => s + e.amount, 0);

  const zakatableWealth = totalSavings - totalExpenses + totalLent - totalBorrowed;
  const silverPrice = getSilverPrice();
  const nisab = calcNisab();
  const hawl = getHawlDate();
  const hawlComplete = isHawlComplete();
  const daysRemaining = getHawlDaysRemaining();

  // Silver & Nisab info
  if (silverPrice > 0) {
    const perGram = silverPrice / SILVER_UNIT_GRAMS;
    document.getElementById('zakat-silver-price').textContent = formatBDT(silverPrice);
    document.getElementById('zakat-per-gram').textContent = formatBDT(Math.round(perGram));
    document.getElementById('zakat-nisab-display').textContent = formatBDT(nisab);
  } else {
    document.getElementById('zakat-silver-price').textContent = 'Not set';
    document.getElementById('zakat-per-gram').textContent = '—';
    document.getElementById('zakat-nisab-display').textContent = '—';
  }

  // Wealth breakdown
  document.getElementById('zakat-savings').textContent = formatBDT(totalSavings);
  document.getElementById('zakat-expenses').textContent = formatBDT(totalExpenses);
  document.getElementById('zakat-lent').textContent = formatBDT(totalLent);
  document.getElementById('zakat-borrowed').textContent = formatBDT(totalBorrowed);
  document.getElementById('zakat-total').textContent = formatBDT(zakatableWealth);

  // Hawl display
  const hawlDisplay = document.getElementById('zakat-hawl-display');
  const hawlRemainingRow = document.getElementById('zakat-hawl-remaining-row');
  const hawlStatusEl = document.getElementById('zakat-hawl-status');

  if (hawl) {
    hawlDisplay.textContent = formatDate(hawl);
    hawlRemainingRow.style.display = 'flex';
    if (hawlComplete) {
      hawlStatusEl.textContent = 'Hawl complete — 1 lunar year passed';
      hawlStatusEl.className = 'hawl-complete';
    } else {
      hawlStatusEl.textContent = daysRemaining + ' days remaining';
      hawlStatusEl.className = 'hawl-pending';
    }
  } else {
    hawlDisplay.textContent = 'Not set';
    hawlRemainingRow.style.display = 'none';
  }

  // Zakat status — uses per-entry calculation
  const statusEl = document.getElementById('zakat-status');
  const dueEl = document.getElementById('zakat-due');
  const zakatEntries = calcZakatEntries();
  const entryZakatTotal = zakatEntries.reduce((s, e) => s + e.zakat, 0);
  const eligibleCount = zakatEntries.length;

  if (nisab <= 0) {
    statusEl.textContent = 'Set silver price to calculate Zakat';
    statusEl.className = 'zakat-status not-due';
    dueEl.textContent = '—';
  } else if (zakatableWealth < nisab) {
    statusEl.textContent = 'Zakat is not due — wealth is below Nisab (' + formatBDT(nisab) + ')';
    statusEl.className = 'zakat-status not-due';
    dueEl.textContent = formatBDT(0);
  } else if (eligibleCount > 0) {
    statusEl.textContent = 'Zakat is due — ' + eligibleCount + ' entry(s) completed 1 lunar year';
    statusEl.className = 'zakat-status due';
    dueEl.textContent = formatBDT(entryZakatTotal);
  } else {
    statusEl.textContent = 'Wealth exceeds Nisab — no entries have completed 1 lunar year yet';
    statusEl.className = 'zakat-status not-due';
    dueEl.textContent = formatBDT(0);
  }

  document.getElementById('inp-silver-price').value = silverPrice || '';
  document.getElementById('inp-hawl').value = hawl || '';
}

let zakatEditOpen = false;

window.toggleZakatEdit = function() {
  zakatEditOpen = !zakatEditOpen;
  document.getElementById('zakat-edit').style.display = zakatEditOpen ? 'block' : 'none';
  document.getElementById('zakat-edit-label').textContent = zakatEditOpen ? 'Cancel' : 'Settings';
};

window.saveZakatSettings = function() {
  const silverVal = parseInt(document.getElementById('inp-silver-price').value) || 0;
  const hawlVal = document.getElementById('inp-hawl').value || '';
  localStorage.setItem(SILVER_PRICE_KEY, silverVal);
  localStorage.setItem(HAWL_KEY, hawlVal);
  zakatEditOpen = false;
  document.getElementById('zakat-edit').style.display = 'none';
  document.getElementById('zakat-edit-label').textContent = 'Settings';
  renderZakat();
  syncToCloud();
};

// ===== SAVINGS TARGET =====
let targetEditOpen = false;

window.toggleTargetEdit = function() {
  targetEditOpen = !targetEditOpen;
  document.getElementById('target-edit').style.display = targetEditOpen ? 'block' : 'none';
  document.getElementById('target-edit-label').textContent = targetEditOpen ? 'Cancel' : 'Edit';
};

window.saveTarget = function() {
  const val = parseInt(document.getElementById('inp-target').value) || 0;
  localStorage.setItem(TARGET_KEY, val);
  targetEditOpen = false;
  document.getElementById('target-edit').style.display = 'none';
  document.getElementById('target-edit-label').textContent = 'Edit';
  renderDashboard();
  syncToCloud();
};

// ===== MONEY STORAGE =====
const MONEY_STORAGE_KEY = 'taswana_money_storage';

function getMoneyStorage() {
  return JSON.parse(localStorage.getItem(MONEY_STORAGE_KEY) || '{"wise":0,"bank":0,"mobileMoney":0,"cashBdt":0}');
}

function saveMoneyStorage(data) {
  localStorage.setItem(MONEY_STORAGE_KEY, JSON.stringify(data));
  syncToCloud();
}

function getStorageTotal() {
  const s = getMoneyStorage();
  return s.wise + s.bank + s.mobileMoney + s.cashBdt;
}

function renderMoneyStorage() {
  const s = getMoneyStorage();
  const total = s.wise + s.bank + s.mobileMoney + s.cashBdt;
  document.getElementById('storage-total').textContent = formatBDT(total);
  document.getElementById('disp-wise').textContent = formatBDT(s.wise);
  document.getElementById('disp-bank').textContent = formatBDT(s.bank);
  document.getElementById('disp-mobile-money').textContent = formatBDT(s.mobileMoney);
  document.getElementById('disp-cash-bdt').textContent = formatBDT(s.cashBdt);

  // Fill edit inputs
  document.getElementById('inp-wise').value = s.wise || '';
  document.getElementById('inp-bank').value = s.bank || '';
  document.getElementById('inp-mobile-money').value = s.mobileMoney || '';
  document.getElementById('inp-cash-bdt').value = s.cashBdt || '';
}

let storageEditOpen = false;

window.toggleStorageEdit = function() {
  storageEditOpen = !storageEditOpen;
  document.getElementById('storage-edit').style.display = storageEditOpen ? 'block' : 'none';
  document.getElementById('storage-display').style.display = storageEditOpen ? 'none' : 'flex';
  document.getElementById('storage-edit-label').textContent = storageEditOpen ? 'Cancel' : 'Edit';
};

window.saveStorage = function() {
  const data = {
    wise: parseInt(document.getElementById('inp-wise').value) || 0,
    bank: parseInt(document.getElementById('inp-bank').value) || 0,
    mobileMoney: parseInt(document.getElementById('inp-mobile-money').value) || 0,
    cashBdt: parseInt(document.getElementById('inp-cash-bdt').value) || 0
  };
  saveMoneyStorage(data);
  storageEditOpen = false;
  document.getElementById('storage-edit').style.display = 'none';
  document.getElementById('storage-display').style.display = 'flex';
  document.getElementById('storage-edit-label').textContent = 'Edit';
  renderMoneyStorage();
  renderDashboard();
};

// ===== DATA LAYER =====
const STORAGE_KEY = 'taswana_entries';
const LOANS_KEY = 'taswana_loans';
const TARGET_KEY = 'taswana_target';

function getTarget() {
  return parseInt(localStorage.getItem(TARGET_KEY)) || 0;
}

function getEntries() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
}

function saveEntriesToLocal(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function saveEntries(entries) {
  saveEntriesToLocal(entries);
  syncToCloud();
}

function getLoans() {
  return JSON.parse(localStorage.getItem(LOANS_KEY) || '[]');
}

function saveLoansToLocal(loans) {
  localStorage.setItem(LOANS_KEY, JSON.stringify(loans));
}

function saveLoans(loans) {
  saveLoansToLocal(loans);
  syncToCloud();
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
  fab.style.display = (page === 'graphs' || page === 'settings') ? 'none' : 'flex';
  if (page === 'dashboard') renderDashboard();
  if (page === 'savings') renderSavings();
  if (page === 'expense') renderExpenses();
  if (page === 'loans') renderLoans();
  if (page === 'graphs') renderCharts();
  if (page === 'settings') renderSettings();
}

// ===== MONTH NAVIGATION =====
let savingsMonthOffset = 0;
let expenseMonthOffset = 0;

function getOffsetMonth(offset) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

window.changeMonth = function(type, dir) {
  if (type === 'savings') {
    savingsMonthOffset += dir;
    renderSavings();
  } else {
    expenseMonthOffset += dir;
    renderExpenses();
  }
};

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

  const totalExpenses = entries
    .filter(e => e.type === 'expense')
    .reduce((s, e) => s + e.amount, 0);

  const totalLent = loans
    .filter(l => l.loanType === 'lent')
    .reduce((s, l) => s + l.amount, 0);

  const totalBorrowed = loans
    .filter(l => l.loanType === 'borrowed')
    .reduce((s, l) => s + l.amount, 0);

  const netBalance = totalSavings - totalExpenses + totalLent - totalBorrowed;

  document.getElementById('dash-total-savings').textContent = formatBDT(totalSavings);
  const netEl = document.getElementById('dash-net-balance');
  netEl.textContent = formatBDT(netBalance);
  netEl.className = 'card-value ' + (netBalance >= 0 ? 'positive' : 'negative');

  document.getElementById('dash-month-savings').textContent = formatBDT(monthSavings);
  document.getElementById('dash-month-expense').textContent = formatBDT(monthExpense);
  document.getElementById('dash-total-lent').textContent = formatBDT(totalLent);
  document.getElementById('dash-total-borrowed').textContent = formatBDT(totalBorrowed);

  const target = getTarget();
  if (target > 0) {
    const netSavings = monthSavings - monthExpense;
    const pct = Math.min((netSavings / target) * 100, 100);
    document.getElementById('dash-target-val').textContent = formatBDT(netSavings) + ' / ' + formatBDT(target);
    const fill = document.getElementById('dash-target-fill');
    fill.style.width = Math.max(pct, 0) + '%';
    fill.style.background = netSavings >= target ? 'var(--accent)' : 'var(--warning)';
    document.getElementById('dash-target-label-text').textContent = 'Target: ' + formatBDT(target);

    const badge = document.getElementById('dash-target-badge');
    if (netSavings >= target) {
      badge.textContent = 'Above Target';
      badge.className = 'badge above';
    } else {
      badge.textContent = 'Below Target';
      badge.className = 'badge below';
    }
  } else {
    document.getElementById('dash-target-val').textContent = 'No target set';
    document.getElementById('dash-target-fill').style.width = '0%';
    document.getElementById('dash-target-label-text').textContent = 'Set a target';
    const badge = document.getElementById('dash-target-badge');
    badge.textContent = 'Not set';
    badge.className = 'badge';
  }
  document.getElementById('inp-target').value = target || '';

  // Welcome message
  const welcomeEl = document.getElementById('welcome-msg');
  if (fbUser && fbUser.displayName) {
    welcomeEl.innerHTML = 'আসসালামু আলাইকুম <strong>' + esc(fbUser.displayName) + '</strong>,<br>Control your money—or it will control you \u{1F642}';
  } else {
    welcomeEl.innerHTML = 'আসসালামু আলাইকুম,<br>Control your money—or it will control you \u{1F642}';
  }

  renderZakat();
}

// ===== SAVINGS LIST =====
function renderSavings() {
  renderMoneyStorage();
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

// ===== ZAKAT PER ENTRY =====
function getEntryAgeDays(dateStr) {
  const start = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  return Math.floor((now - start) / (1000 * 60 * 60 * 24));
}

function calcZakatEntries() {
  const nisab = calcNisab();
  if (nisab <= 0) return [];

  // Check if total zakatable wealth exceeds Nisab
  const entries = getEntries();
  const loans = getLoans();
  const totalSavings = entries.filter(e => e.type === 'saving').reduce((s, e) => s + e.amount, 0);
  const totalLent = loans.filter(l => l.loanType === 'lent').reduce((s, l) => s + l.amount, 0);
  const totalBorrowed = loans.filter(l => l.loanType === 'borrowed').reduce((s, l) => s + l.amount, 0);
  const totalExpenses = entries.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
  const zakatableWealth = totalSavings - totalExpenses + totalLent - totalBorrowed;

  if (zakatableWealth < nisab) return [];

  // Savings entries that have completed 1 lunar year
  const savingsEligible = entries
    .filter(e => e.type === 'saving')
    .filter(e => getEntryAgeDays(e.date) >= LUNAR_YEAR_DAYS)
    .map(e => ({
      id: e.id,
      date: e.date,
      desc: e.desc || 'Savings',
      amount: e.amount,
      source: 'saving',
      days: getEntryAgeDays(e.date),
      zakat: Math.round(e.amount * 0.025)
    }));

  // Lent entries that have completed 1 lunar year
  const lentEligible = loans
    .filter(l => l.loanType === 'lent')
    .filter(l => getEntryAgeDays(l.date) >= LUNAR_YEAR_DAYS)
    .map(l => ({
      id: l.id,
      date: l.date,
      desc: 'Lent to ' + (l.person || ''),
      amount: l.amount,
      source: 'lent',
      days: getEntryAgeDays(l.date),
      zakat: Math.round(l.amount * 0.025)
    }));

  return [...savingsEligible, ...lentEligible].sort((a, b) => a.date.localeCompare(b.date));
}

function renderZakatEntries() {
  const zakatEntries = calcZakatEntries();
  const listEl = document.getElementById('zakat-entries-list');
  const emptyEl = document.getElementById('zakat-entries-empty');
  const totalEl = document.getElementById('zakat-entries-total');

  const totalZakat = zakatEntries.reduce((s, e) => s + e.zakat, 0);
  totalEl.textContent = formatBDT(totalZakat);

  if (!zakatEntries.length) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }

  emptyEl.style.display = 'none';
  listEl.innerHTML = zakatEntries.map(e => `
    <div class="zakat-entry-row">
      <span class="ze-date">${formatDate(e.date)}<br><small class="ze-source">${esc(e.desc)}</small></span>
      <span class="ze-amount">${formatBDT(e.amount)}</span>
      <span class="ze-zakat">${formatBDT(e.zakat)}</span>
    </div>
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

window.setLoanFilter = function(filter) {
  loanFilter = filter;
  document.getElementById('loan-tab-all').classList.toggle('active', filter === 'all');
  document.getElementById('loan-tab-borrowed').classList.toggle('active', filter === 'borrowed');
  document.getElementById('loan-tab-lent').classList.toggle('active', filter === 'lent');
  renderLoans();
};

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

window.setEntryType = function(type) {
  entryType = type;
  document.getElementById('tab-saving').classList.toggle('active', type === 'saving');
  document.getElementById('tab-expense').classList.toggle('active', type === 'expense');
  document.getElementById('category-group').style.display = type === 'expense' ? 'block' : 'none';
};

window.openAddModal = function() {
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
    window.setEntryType('expense');
  } else {
    window.setEntryType('saving');
  }

  document.getElementById('add-modal').classList.add('open');
};

window.closeModal = function() {
  document.getElementById('add-modal').classList.remove('open');
};

window.editEntry = function(id) {
  const e = getEntries().find(x => x.id === id);
  if (!e) return;
  document.getElementById('entry-id').value = e.id;
  document.getElementById('entry-amount').value = e.amount;
  document.getElementById('entry-desc').value = e.desc || '';
  document.getElementById('entry-date').value = e.date;
  document.getElementById('modal-title').textContent = 'Edit Entry';
  document.getElementById('entry-submit-btn').textContent = 'Update';

  window.setEntryType(e.type === 'expense' ? 'expense' : 'saving');
  if (e.category) document.getElementById('entry-cat').value = e.category;

  document.getElementById('add-modal').classList.add('open');
};

window.deleteEntry = function(id) {
  if (!confirm('Delete this entry?')) return;
  const entries = getEntries().filter(e => e.id !== id);
  saveEntries(entries);
  refreshCurrentPage();
};

window.saveEntry = function(e) {
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
  window.closeModal();
  refreshCurrentPage();
};

// ===== LOAN MODAL =====
let loanType = 'borrowed';

window.setLoanType = function(type) {
  loanType = type;
  document.getElementById('loan-tab-type-borrowed').classList.toggle('active', type === 'borrowed');
  document.getElementById('loan-tab-type-lent').classList.toggle('active', type === 'lent');
};

function openLoanModal() {
  document.getElementById('loan-id').value = '';
  document.getElementById('loan-amount').value = '';
  document.getElementById('loan-person').value = '';
  document.getElementById('loan-desc').value = '';
  document.getElementById('loan-date').value = todayStr();
  document.getElementById('loan-modal-title').textContent = 'Add Loan Entry';
  document.getElementById('loan-submit-btn').textContent = 'Save';
  window.setLoanType('borrowed');
  document.getElementById('loan-modal').classList.add('open');
}

window.closeLoanModal = function() {
  document.getElementById('loan-modal').classList.remove('open');
};

window.editLoan = function(id) {
  const l = getLoans().find(x => x.id === id);
  if (!l) return;
  document.getElementById('loan-id').value = l.id;
  document.getElementById('loan-amount').value = l.amount;
  document.getElementById('loan-person').value = l.person || '';
  document.getElementById('loan-desc').value = l.desc || '';
  document.getElementById('loan-date').value = l.date;
  document.getElementById('loan-modal-title').textContent = 'Edit Loan Entry';
  document.getElementById('loan-submit-btn').textContent = 'Update';
  window.setLoanType(l.loanType);
  document.getElementById('loan-modal').classList.add('open');
};

window.deleteLoan = function(id) {
  if (!confirm('Delete this loan entry?')) return;
  const loans = getLoans().filter(l => l.id !== id);
  saveLoans(loans);
  refreshCurrentPage();
};

window.saveLoan = function(e) {
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
  window.closeLoanModal();
  refreshCurrentPage();
};

function refreshCurrentPage() {
  navigateTo(currentPage);
}

// Close modals on overlay click
document.getElementById('add-modal').addEventListener('click', function(e) {
  if (e.target === this) window.closeModal();
});
document.getElementById('loan-modal').addEventListener('click', function(e) {
  if (e.target === this) window.closeLoanModal();
});

// ===== CHARTS =====
let mainChart = null;
let catChart = null;
let activeChart = 'savings';

window.switchChart = function(type) {
  activeChart = type;
  document.querySelectorAll('#page-graphs .tab-btn').forEach((b, i) => {
    b.classList.toggle('active', (i === 0 && type === 'savings') || (i === 1 && type === 'expense'));
  });
  document.getElementById('category-chart-card').style.display = type === 'expense' ? 'block' : 'none';
  renderCharts();
};

function renderCharts() {
  renderZakatEntries();
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

// ===== BACKUP & RESTORE =====
window.exportData = function() {
  const data = {
    version: 5,
    exportDate: new Date().toISOString(),
    entries: getEntries(),
    loans: getLoans(),
    moneyStorage: getMoneyStorage(),
    target: getTarget(),
    silverPrice: getSilverPrice(),
    hawl: getHawlDate(),
    pin: localStorage.getItem(PIN_KEY),
    privacy: localStorage.getItem('taswana_privacy')
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'TasWana-backup-' + todayStr() + '.json';
  a.click();
  URL.revokeObjectURL(url);

  localStorage.setItem('taswana_last_backup', new Date().toISOString());
  renderSettings();
};

window.importData = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);

      if (!data.entries && !data.loans) {
        alert('Invalid backup file.');
        return;
      }

      const entryCount = (data.entries || []).length;
      const loanCount = (data.loans || []).length;

      if (!confirm('This will replace all current data with:\n' + entryCount + ' entries\n' + loanCount + ' loans\n\nContinue?')) {
        return;
      }

      if (data.entries) saveEntries(data.entries);
      if (data.loans) saveLoans(data.loans);
      if (data.moneyStorage) saveMoneyStorage(data.moneyStorage);
      if (data.target) localStorage.setItem(TARGET_KEY, data.target);
      if (data.silverPrice) localStorage.setItem(SILVER_PRICE_KEY, data.silverPrice);
      if (data.hawl) localStorage.setItem(HAWL_KEY, data.hawl);
      if (data.pin) localStorage.setItem(PIN_KEY, data.pin);
      if (data.privacy) localStorage.setItem('taswana_privacy', data.privacy);

      localStorage.setItem('taswana_last_backup', new Date().toISOString());
      renderSettings();
      refreshCurrentPage();
      alert('Data restored successfully!');
    } catch (err) {
      alert('Error reading backup file. Make sure it\'s a valid TasWana backup.');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
};

function renderSettings() {
  const lastBackup = localStorage.getItem('taswana_last_backup');
  const infoEl = document.getElementById('last-backup-info');
  if (lastBackup) {
    const d = new Date(lastBackup);
    infoEl.textContent = 'Last backup: ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } else {
    infoEl.textContent = 'No backup taken yet. Please export a backup to keep your data safe.';
  }

  const entries = getEntries();
  const loans = getLoans();
  const savings = entries.filter(e => e.type === 'saving').length;
  const expenses = entries.filter(e => e.type === 'expense').length;
  document.getElementById('data-summary').innerHTML =
    '<strong>' + savings + '</strong> savings entries<br>' +
    '<strong>' + expenses + '</strong> expense entries<br>' +
    '<strong>' + loans.length + '</strong> loan entries';

  updateCloudUI();
}

window.resetPin = function() {
  if (!confirm('Change your PIN?')) return;
  window.lockApp();
  window.startChangePin();
};

// ===== INIT =====
initLock();
renderDashboard();
applyPrivacy();
