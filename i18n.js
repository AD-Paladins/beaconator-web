import en from './locales/en.json' with { type: 'json' };
import es from './locales/es.json' with { type: 'json' };

const locales = { en, es };
const LANG_KEY = 'devdash_lang_v1';

let currentLang = localStorage.getItem(LANG_KEY) || 'en';
let strings = locales[currentLang] || locales.en;

export function t(key, params = {}) {
  let str = strings[key] || key;
  for (const [k, v] of Object.entries(params)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  }
  return str;
}

export function setLanguage(lang) {
  if (!locales[lang]) return;
  currentLang = lang;
  strings = locales[lang];
  localStorage.setItem(LANG_KEY, lang);
  document.documentElement.lang = lang;
  updateDOM();
  document.dispatchEvent(new CustomEvent('languagechange', { detail: { lang } }));
}

export function getLanguage() {
  return currentLang;
}

export function getAvailableLanguages() {
  return Object.keys(locales);
}

export function updateDOM() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
}
