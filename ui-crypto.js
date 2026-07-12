const EXPORT_VERSION = 2;

const CATEGORIES = {
  github: { key: 'devdash_config_v1', fields: ['githubToken', 'githubEmail', 'githubUser', 'githubRepos'], label: 'GitHub' },
  jira: { key: 'devdash_config_v1', fields: ['jiraDomain', 'jiraEmail', 'jiraToken', 'jiraJql', 'jiraProxyUrl'], label: 'Jira' },
  ai: { key: 'devdash_config_v1', fields: ['aiProvider', 'aiApiKey', 'aiApiKeys', 'aiModel', 'aiCustomUrl'], label: 'AI' },
  watchlistJira: { key: 'devdash_watchlist_v1', filter: (list) => list.filter((i) => (i.type || 'jira') === 'jira'), label: 'Jira watchlist' },
  watchlistPRs: { key: 'devdash_watchlist_v1', filter: (list) => list.filter((i) => i.type === 'pr'), label: 'PR watchlist' },
  lang: { key: 'devdash_lang_v1', label: 'Language' },
};

function getConfig() {
  const raw = localStorage.getItem('devdash_config_v1');
  return raw ? JSON.parse(raw) : {};
}

function getWatchlist() {
  const raw = localStorage.getItem('devdash_watchlist_v1');
  return raw ? JSON.parse(raw) : [];
}

function getLang() {
  return localStorage.getItem('devdash_lang_v1') || 'en';
}

async function deriveKey(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encrypt(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return {
    __encrypted__: true,
    __version__: EXPORT_VERSION,
    salt: Array.from(salt),
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(encrypted)),
  };
}

async function decrypt(envelope, password) {
  const salt = new Uint8Array(envelope.salt);
  const iv = new Uint8Array(envelope.iv);
  const data = new Uint8Array(envelope.data);
  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  return new TextDecoder().decode(decrypted);
}

export function collectCategories() {
  const cfg = getConfig();
  const watchlist = getWatchlist();
  const result = {};
  for (const [id, cat] of Object.entries(CATEGORIES)) {
    if (cat.fields) {
      result[id] = { label: cat.label, data: cat.fields.map((f) => { const v = cfg[f]; return `${f}: ${v && typeof v === 'object' ? JSON.stringify(v) : v || ''}`; }).join('\n'), hasData: cat.fields.some((f) => { const v = cfg[f]; return v && typeof v === 'object' ? Object.keys(v).length > 0 : !!v; }) };
    } else if (cat.filter) {
      const items = cat.filter(watchlist);
      result[id] = { label: cat.label, data: items.map((i) => i.type === 'pr' ? `${i.owner}/${i.repo}#${i.number}` : i.key).join(', '), hasData: items.length > 0 };
    } else {
      const val = getLang();
      result[id] = { label: cat.label, data: val, hasData: !!val };
    }
  }
  return result;
}

export function exportSelected(categories, password) {
  const cfg = getConfig();
  const watchlist = getWatchlist();
  const lang = getLang();
  const payload = {};

  if (categories.github) {
    const gh = {};
    CATEGORIES.github.fields.forEach((f) => { gh[f] = cfg[f] || ''; });
    payload._github = gh;
  }
  if (categories.jira) {
    const jira = {};
    CATEGORIES.jira.fields.forEach((f) => { jira[f] = cfg[f] || ''; });
    payload._jira = jira;
  }
  if (categories.ai) {
    const ai = {};
    CATEGORIES.ai.fields.forEach((f) => { ai[f] = cfg[f] || ''; });
    payload._ai = ai;
  }
  if (categories.watchlistJira) {
    payload._watchlistJira = CATEGORIES.watchlistJira.filter(watchlist);
  }
  if (categories.watchlistPRs) {
    payload._watchlistPRs = CATEGORIES.watchlistPRs.filter(watchlist);
  }
  if (categories.lang) {
    payload._lang = lang;
  }

  payload.__version__ = EXPORT_VERSION;
  const json = JSON.stringify(payload, null, 2);

  if (password) {
    return encrypt(json, password).then((envelope) => {
      download('devdash-settings.json', JSON.stringify(envelope), 'application/json');
    });
  }
  download('devdash-settings.json', json, 'application/json');
  return Promise.resolve();
}

export async function parseImportFile(file, password) {
  const raw = await readFile(file);
  let payload;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.__encrypted__) {
      if (!password) throw new Error('encrypted-no-password');
      const decrypted = await decrypt(parsed, password);
      payload = JSON.parse(decrypted);
    } else {
      payload = parsed;
    }
  } catch (e) {
    if (e.message === 'encrypted-no-password') throw e;
    if (e instanceof DOMException && e.name === 'OperationError') {
      throw new Error('wrong-password');
    }
    throw new Error('invalid-file');
  }
  if (!payload || typeof payload !== 'object') throw new Error('invalid-file');
  return payload;
}

export function getImportPreview(payload) {
  const cfg = getConfig();
  const watchlist = getWatchlist();
  const preview = {};

  if (payload._github) {
    const fields = CATEGORIES.github.fields;
    preview.github = {
      label: 'GitHub',
      items: fields.map((f) => ({ field: f, current: cfg[f] || '', incoming: payload._github[f] || '', changed: (cfg[f] || '') !== (payload._github[f] || '') })),
    };
  }
  if (payload._jira) {
    const fields = CATEGORIES.jira.fields;
    preview.jira = {
      label: 'Jira',
      items: fields.map((f) => ({ field: f, current: cfg[f] || '', incoming: payload._jira[f] || '', changed: (cfg[f] || '') !== (payload._jira[f] || '') })),
    };
  }
  if (payload._ai) {
    const fields = CATEGORIES.ai.fields;
    preview.ai = {
      label: 'AI',
      items: fields.map((f) => {
        const cur = cfg[f];
        const inc = payload._ai[f];
        const curStr = cur && typeof cur === 'object' ? JSON.stringify(cur) : cur || '';
        const incStr = inc && typeof inc === 'object' ? JSON.stringify(inc) : inc || '';
        return { field: f, current: curStr, incoming: incStr, changed: curStr !== incStr };
      }),
    };
  }
  if (payload._watchlistJira) {
    const current = watchlist.filter((i) => (i.type || 'jira') === 'jira').map((i) => i.key);
    const incoming = payload._watchlistJira.map((i) => i.key);
    preview.watchlistJira = { label: 'Jira watchlist', current: current.join(', '), incoming: incoming.join(', '), changed: current.join(',') !== incoming.join(',') };
  }
  if (payload._watchlistPRs) {
    const current = watchlist.filter((i) => i.type === 'pr').map((i) => `${i.owner}/${i.repo}#${i.number}`);
    const incoming = payload._watchlistPRs.map((i) => `${i.owner}/${i.repo}#${i.number}`);
    preview.watchlistPRs = { label: 'PR watchlist', current: current.join(', '), incoming: incoming.join(', '), changed: current.join(',') !== incoming.join(',') };
  }
  if (payload._lang) {
    preview.lang = { label: 'Language', current: getLang(), incoming: payload._lang, changed: getLang() !== payload._lang };
  }
  return preview;
}

export function applyImport(payload, selected) {
  const cfg = getConfig();
  const watchlist = getWatchlist();

  if (selected.github && payload._github) {
    Object.assign(cfg, payload._github);
  }
  if (selected.jira && payload._jira) {
    Object.assign(cfg, payload._jira);
  }
  if (selected.ai && payload._ai) {
    Object.assign(cfg, payload._ai);
  }
  localStorage.setItem('devdash_config_v1', JSON.stringify(cfg));

  let newWatchlist = [...watchlist];
  if (selected.watchlistJira && payload._watchlistJira) {
    const incoming = payload._watchlistJira;
    const nonJira = newWatchlist.filter((i) => (i.type || 'jira') !== 'jira');
    newWatchlist = [...nonJira, ...incoming];
  }
  if (selected.watchlistPRs && payload._watchlistPRs) {
    const incoming = payload._watchlistPRs;
    const nonPR = newWatchlist.filter((i) => i.type !== 'pr');
    newWatchlist = [...nonPR, ...incoming];
  }
  localStorage.setItem('devdash_watchlist_v1', JSON.stringify(newWatchlist));

  if (selected.lang && payload._lang) {
    localStorage.setItem('devdash_lang_v1', payload._lang);
  }
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
