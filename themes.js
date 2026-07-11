const THEME_KEY = 'devdash_theme';

export const THEMES = [
  { id: 'dark', labelKey: 'theme.dark' },
  { id: 'light', labelKey: 'theme.light' },
  { id: 'hc-light', labelKey: 'theme.hcLight' },
  { id: 'hc-dark', labelKey: 'theme.hcDark' },
  { id: 'gaming', labelKey: 'theme.gaming' },
  { id: 'lilac', labelKey: 'theme.lilac' },
  { id: 'pink', labelKey: 'theme.pink' },
];

export function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'dark';
}

export function setTheme(id) {
  localStorage.setItem(THEME_KEY, id);
  applyTheme(id);
}

export function applyTheme(id) {
  const theme = id || getTheme();
  if (theme === 'dark') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    meta.setAttribute('content', bg);
  }
}
