const CONFIG_KEY = 'devdash_config_v1';
const WATCHLIST_KEY = 'devdash_watchlist_v1';

export function getConfig() {
  const raw = localStorage.getItem(CONFIG_KEY);
  return raw ? JSON.parse(raw) : {
    githubToken: '',
    githubRepos: '',
    githubUser: '',
    jiraDomain: '',
    jiraEmail: '',
    jiraToken: '',
    jiraJql: '',
    jiraProxyUrl: '',
  };
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
