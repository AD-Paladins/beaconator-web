import { refreshAll, openSettings, refreshMetrics, setupPeriodButtons, initNotifications } from './ui.js';
import { t, setLanguage, getLanguage, getAvailableLanguages, updateDOM } from './i18n.js';

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
setupPeriodButtons();
initNotifications();
refreshAll();
refreshMetrics();
setInterval(() => {
  refreshAll();
  refreshMetrics();
}, 5 * 60 * 1000);
