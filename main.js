import { refreshAll, openSettings, refreshMetrics, setupPeriodButtons, initNotifications } from './ui.js';
import { t, setLanguage, getLanguage, getAvailableLanguages, updateDOM } from './i18n.js';
import { THEMES, getTheme, setTheme } from './themes.js';

// ---- Language selector ----

function setupLangSelector() {
  const btn = document.getElementById('lang-btn');
  const dropdown = document.getElementById('lang-dropdown');
  const langs = getAvailableLanguages();

  btn.textContent = getLanguage().toUpperCase();

  dropdown.innerHTML = langs
    .map((l) => `<button class="lang-option${l === getLanguage() ? ' active' : ''}" data-lang="${l}">${l.toUpperCase()}</button>`)
    .join('');

  btn.addEventListener('click', () => {
    dropdown.classList.toggle('open');
  });

  dropdown.addEventListener('click', (e) => {
    const option = e.target.closest('.lang-option');
    if (!option) return;
    setLanguage(option.dataset.lang);
    btn.textContent = option.dataset.lang.toUpperCase();
    dropdown.querySelectorAll('.lang-option').forEach((o) => o.classList.remove('active'));
    option.classList.add('active');
    dropdown.classList.remove('open');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#lang-selector')) {
      dropdown.classList.remove('open');
    }
  });
}

// ---- Theme selector ----

function themeIcon(id) {
  const icons = {
    dark: '\u263E',
    light: '\u2600',
    'hc-light': '\u25A0',
    'hc-dark': '\u25A1',
    gaming: '\u2694',
    lilac: '\u2661',
    pink: '\u2764',
  };
  return icons[id] || '\u25CF';
}

function setupThemeSelector() {
  const btn = document.getElementById('theme-btn');
  const dropdown = document.getElementById('theme-dropdown');
  const current = getTheme();

  btn.textContent = themeIcon(current);

  dropdown.innerHTML = THEMES
    .map((th) => `<button class="lang-option${th.id === current ? ' active' : ''}" data-theme="${th.id}">${t(th.labelKey)}</button>`)
    .join('');

  btn.addEventListener('click', () => {
    dropdown.classList.toggle('open');
  });

  dropdown.addEventListener('click', (e) => {
    const option = e.target.closest('.lang-option');
    if (!option) return;
    const id = option.dataset.theme;
    setTheme(id);
    btn.textContent = themeIcon(id);
    dropdown.querySelectorAll('.lang-option').forEach((o) => o.classList.remove('active'));
    option.classList.add('active');
    dropdown.classList.remove('open');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#theme-selector')) {
      dropdown.classList.remove('open');
    }
  });
}

// ---- Init ----

document.getElementById('settings-btn').addEventListener('click', () => {
  openSettings(() => {
    refreshAll();
    refreshMetrics();
  });
});

document.getElementById('refresh-btn').addEventListener('click', () => {
  refreshAll();
  refreshMetrics();
});

document.addEventListener('languagechange', () => {
  refreshAll();
  refreshMetrics();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

updateDOM();
setupLangSelector();
setupThemeSelector();
setupPeriodButtons();
initNotifications();
refreshAll();
refreshMetrics();
setInterval(() => {
  refreshAll();
  refreshMetrics();
}, 5 * 60 * 1000);
