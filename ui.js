import { getConfig, setConfig, getWatchlist, setWatchlist } from './config.js';
import { fetchActivePRs } from './github.js';
import { fetchJira } from './jira.js';
import { computeMetrics } from './metrics.js';
import { t } from './i18n.js';

// ---- Utils ----

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return t('time.justNow');
  if (hours < 24) return t('time.hoursAgo', { n: hours });
  return t('time.daysAgo', { n: Math.floor(hours / 24) });
}

function statusBadgeClass(statusName) {
  const s = (statusName || '').toLowerCase();
  if (s.includes('done') || s.includes('closed') || s.includes('resolved')) return 'badge-status-done';
  if (s.includes('progress') || s.includes('review')) return 'badge-status-progress';
  return 'badge-status-todo';
}

// ---- Rendering ----

export function renderPRs(container, result) {
  container.innerHTML = '';
  if (result.error) {
    container.innerHTML = `<div class="error-state">${escapeHtml(result.error)}</div>`;
    return;
  }
  if (!result.items.length) {
    container.innerHTML = `<div class="empty-state">${t('pr.empty')}</div>`;
    return;
  }
  result.items.forEach((pr) => {
    const repoName = pr.repository_url.split('/').slice(-2).join('/');
    const div = document.createElement('div');
    div.className = 'card';
    div.onclick = () => window.open(pr.html_url, '_blank');
    div.innerHTML = `
      <div class="card-top">
        <span class="card-id">#${pr.number}</span>
        <span class="badge badge-repo">${escapeHtml(repoName)}</span>
      </div>
      <div class="card-title">${escapeHtml(pr.title)}</div>
      <div class="card-meta">
        <span>${escapeHtml(pr.user.login)}</span>
        <span>${timeAgo(pr.updated_at)}</span>
      </div>
    `;
    container.appendChild(div);
  });
}

export function renderJira(container, result, options = {}) {
  container.innerHTML = '';
  if (result.error) {
    container.innerHTML = `<div class="error-state">${escapeHtml(result.error)}</div>`;
    return;
  }
  if (!result.items.length) {
    container.innerHTML = `<div class="empty-state">${t('jira.empty')}</div>`;
    return;
  }
  result.items.forEach((issue) => {
    const status = issue.fields?.status?.name || 'unknown';
    const div = document.createElement('div');
    div.className = 'card';
    const cfg = getConfig();
    const domain = cfg.jiraDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    div.onclick = () => window.open(`https://${domain}/browse/${issue.key}`, '_blank');
    div.innerHTML = `
      <div class="card-top">
        <span class="card-id">${escapeHtml(issue.key)}</span>
        <span class="badge ${statusBadgeClass(status)}">${escapeHtml(status)}</span>
      </div>
      <div class="card-title">${escapeHtml(issue.fields?.summary || '')}</div>
      ${options.watchable ? `<div class="card-meta"><span class="watch-remove" data-key="${issue.key}">${t('watchlist.remove')}</span></div>` : ''}
    `;
    container.appendChild(div);
  });
  if (options.watchable) {
    container.querySelectorAll('.watch-remove').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = el.dataset.key;
        setWatchlist(getWatchlist().filter((k) => k !== key));
        if (options.onRemove) options.onRemove();
      });
    });
  }
}

// ---- Refresh ----

export async function refreshAll() {
  const cfg = getConfig();
  const statusEl = document.getElementById('status');
  statusEl.textContent = t('status.loading');

  const prContainer = document.getElementById('pr-list');
  const jiraContainer = document.getElementById('jira-list');
  const watchContainer = document.getElementById('watch-list');

  const prResult = await fetchActivePRs(cfg);
  renderPRs(prContainer, prResult);

  const myJql = cfg.jiraJql || 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC';
  const jiraResult = await fetchJira(cfg, myJql);
  renderJira(jiraContainer, jiraResult);

  const watchlist = getWatchlist();
  if (watchlist.length) {
    const watchJql = `key in (${watchlist.join(',')})`;
    const watchResult = await fetchJira(cfg, watchJql);
    renderJira(watchContainer, watchResult, { watchable: true, onRemove: refreshAll });
  } else {
    watchContainer.innerHTML = `<div class="empty-state">${t('watchlist.empty')}</div>`;
  }

  statusEl.textContent = t('status.updated', { time: new Date().toLocaleTimeString() });
}

// ---- Metrics ----

function formatHours(hours) {
  if (hours === null || hours === undefined) return null;
  if (hours < 1) return '<1h';
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function metricCard(label, value) {
  const display = value === null ? 'N/A' : value;
  const cls = value === null ? 'metric-value null' : 'metric-value';
  return `<div class="metric-card"><div class="metric-label">${label}</div><div class="${cls}">${display}</div></div>`;
}

function renderMetrics(container, data) {
  if (!data) {
    container.innerHTML = `<div class="error-state">${t('metrics.error')}</div>`;
    return;
  }

  const gh = data.github || {};
  const jira = data.jira || {};

  container.innerHTML = `<div class="metrics-grid">
    ${metricCard(t('metrics.timeToFirst'), formatHours(gh.timeToFirstApproval))}
    ${metricCard(t('metrics.timeBetween'), formatHours(gh.timeBetweenApprovals))}
    ${metricCard(t('metrics.reviewRounds'), gh.reviewRounds !== null && gh.reviewRounds !== undefined ? gh.reviewRounds.toFixed(1) : null)}
    ${metricCard(t('metrics.waitingSecond'), gh.waitingForSecond !== null && gh.waitingForSecond !== undefined ? gh.waitingForSecond : null)}
    ${metricCard(t('metrics.mergeRate'), gh.mergeRate !== null && gh.mergeRate !== undefined ? `${gh.mergeRate}` : null)}
    ${metricCard(t('metrics.jiraThroughput'), jira.throughput !== null && jira.throughput !== undefined ? `${jira.throughput}` : null)}
  </div>`;
}

let currentPeriod = 2;

export async function refreshMetrics(periodDays) {
  if (periodDays !== undefined) currentPeriod = periodDays;
  const container = document.getElementById('metrics-content');
  if (!container) return;
  container.innerHTML = `<div class="empty-state">${t('metrics.loading')}</div>`;
  const data = await computeMetrics(currentPeriod);
  renderMetrics(container, data);
}

export function setupPeriodButtons() {
  document.querySelectorAll('.period-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      refreshMetrics(parseInt(btn.dataset.days, 10));
    });
  });
}

// ---- Settings Modal ----

export function openSettings(onSave) {
  const cfg = getConfig();
  const watchlist = getWatchlist();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>${t('settings.title')}</h2>

      <div class="section-divider">${t('settings.github')}</div>
      <div class="field">
        <label>${t('settings.ghToken')}</label>
        <input type="password" id="cfg-gh-token" value="${escapeHtml(cfg.githubToken)}" placeholder="ghp_..." />
      </div>
      <div class="field">
        <label>${t('settings.ghUser')}</label>
        <input type="text" id="cfg-gh-user" value="${escapeHtml(cfg.githubUser)}" placeholder="username" />
      </div>
      <div class="field">
        <label>${t('settings.ghRepos')}</label>
        <textarea id="cfg-gh-repos" data-i18n-placeholder="settings.ghRepos.placeholder" placeholder="org/repo1, org/repo2">${escapeHtml(cfg.githubRepos)}</textarea>
      </div>

      <div class="section-divider">${t('settings.jira')}</div>
      <div class="field">
        <label>${t('settings.jiraDomain')}</label>
        <input type="text" id="cfg-jira-domain" value="${escapeHtml(cfg.jiraDomain)}" placeholder="yourcompany.atlassian.net" />
      </div>
      <div class="field">
        <label>${t('settings.jiraEmail')}</label>
        <input type="text" id="cfg-jira-email" value="${escapeHtml(cfg.jiraEmail)}" placeholder="you@email.com" />
      </div>
      <div class="field">
        <label>${t('settings.jiraToken')}</label>
        <input type="password" id="cfg-jira-token" value="${escapeHtml(cfg.jiraToken)}" placeholder="token" />
      </div>
      <div class="field">
        <label>${t('settings.jiraJql')}</label>
        <textarea id="cfg-jira-jql" placeholder="assignee = currentUser() AND resolution = Unresolved">${escapeHtml(cfg.jiraJql)}</textarea>
      </div>
      <div class="field">
        <label>${t('settings.jiraProxy')}</label>
        <input type="text" id="cfg-jira-proxy" value="${escapeHtml(cfg.jiraProxyUrl)}" placeholder="https://your-proxy.workers.dev" />
        <div class="field-hint">${t('settings.jiraProxy.hint')}</div>
      </div>

      <div class="section-divider">${t('settings.watchlist')}</div>
      <div class="field">
        <label>${t('settings.watchlistKeys')}</label>
        <input type="text" id="cfg-watchlist" value="${escapeHtml(watchlist.join(', '))}" placeholder="PROJ-123, PROJ-456" />
      </div>

      <div class="modal-actions">
        <button class="btn btn-danger" id="cfg-cancel">${t('settings.cancel')}</button>
        <button class="btn btn-primary" id="cfg-save">${t('settings.save')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#cfg-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#cfg-save').onclick = () => {
    const newCfg = {
      githubToken: document.getElementById('cfg-gh-token').value.trim(),
      githubUser: document.getElementById('cfg-gh-user').value.trim(),
      githubRepos: document.getElementById('cfg-gh-repos').value.trim(),
      jiraDomain: document.getElementById('cfg-jira-domain').value.trim(),
      jiraEmail: document.getElementById('cfg-jira-email').value.trim(),
      jiraToken: document.getElementById('cfg-jira-token').value.trim(),
      jiraJql: document.getElementById('cfg-jira-jql').value.trim(),
      jiraProxyUrl: document.getElementById('cfg-jira-proxy').value.trim(),
    };
    setConfig(newCfg);
    const watchInput = document.getElementById('cfg-watchlist').value;
    const list = watchInput.split(',').map((s) => s.trim()).filter(Boolean);
    setWatchlist(list);
    overlay.remove();
    if (onSave) onSave();
  };
}
