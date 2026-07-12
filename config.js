const CONFIG_KEY = 'devdash_config_v1';
const WATCHLIST_KEY = 'devdash_watchlist_v1';

const DEFAULTS = {
  githubToken: '',
  githubRepos: '',
  githubEmail: '',
  githubUser: '',
  jiraDomain: '',
  jiraEmail: '',
  jiraToken: '',
  jiraJql: '',
  jiraProxyUrl: '',
  aiProvider: 'google-ai-studio',
  aiApiKey: '',
  aiApiKeys: {},
  aiModel: 'gemini-3.5-flash',
  aiCustomUrl: 'localhost:11434/v1',
};

const STALE_AI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro'];

export function getConfig() {
  const raw = localStorage.getItem(CONFIG_KEY);
  if (!raw) return { ...DEFAULTS };
  const stored = JSON.parse(raw);
  if (STALE_AI_MODELS.includes(stored.aiModel)) {
    stored.aiModel = DEFAULTS.aiModel;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(stored));
  }
  return { ...DEFAULTS, ...stored };
}

export function setConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

export function getWatchlist() {
  const raw = localStorage.getItem(WATCHLIST_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function setWatchlist(list) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
}
