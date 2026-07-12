import { getConfig, setConfig, getWatchlist, setWatchlist } from './config.js';
import { fetchActivePRs, fetchCheckRuns, fetchPRReviews, searchRepos, fetchSinglePR, fetchRepoPRs } from './github.js';
import { fetchJira } from './jira.js';
import { computeMetrics } from './metrics.js';
import { t } from './i18n.js';
import { showLoading, showError, showEmpty } from './ui-utils.js';
import { exportSelected, parseImportFile, getImportPreview, applyImport, collectCategories } from './ui-crypto.js';
import { requestPermission, notifyReviewNeeded, getPendingCount, markAllSeen, getPermission } from './notifications.js';
import { THEMES, getTheme, setTheme } from './themes.js';
import { generateInsight, generateAllInsights, getCached, isCacheValid, renderMarkdown } from './ai.js';
import { AI_PROVIDERS } from './ai-providers.js';

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

function ciStatusText(checks) {
  if (checks.status === 'failure') return `${checks.failure} failed`;
  if (checks.status === 'pending') return `${checks.pending} running`;
  if (checks.status === 'success') return checks.success === 1 ? 'all passed' : `all ${checks.success} passed`;
  return '';
}

function isLight(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

// ---- Watchlist helpers ----

function normalizeWatchItem(item) {
  if (typeof item === 'string') return { type: 'jira', key: item };
  return item;
}

function watchKey(item) {
  const n = normalizeWatchItem(item);
  return n.type === 'pr' ? `pr:${n.owner}/${n.repo}#${n.number}` : `jira:${n.key}`;
}

function isJiraWatched(key) {
  return getWatchlist().some((i) => {
    const n = normalizeWatchItem(i);
    return n.type === 'jira' && n.key === key;
  });
}

function isPRWatched(owner, repo, number) {
  return getWatchlist().some((i) => {
    const n = normalizeWatchItem(i);
    return n.type === 'pr' && n.owner === owner && n.repo === repo && n.number === number;
  });
}

function toggleWatchJira(key) {
  const list = getWatchlist();
  const exists = list.some((i) => {
    const n = normalizeWatchItem(i);
    return n.type === 'jira' && n.key === key;
  });
  setWatchlist(exists ? list.filter((i) => { const n = normalizeWatchItem(i); return !(n.type === 'jira' && n.key === key); }) : [...list, { type: 'jira', key }]);
  return !exists;
}

function toggleWatchPR(owner, repo, number) {
  const list = getWatchlist();
  const exists = list.some((i) => {
    const n = normalizeWatchItem(i);
    return n.type === 'pr' && n.owner === owner && n.repo === repo && n.number === number;
  });
  setWatchlist(exists ? list.filter((i) => { const n = normalizeWatchItem(i); return !(n.type === 'pr' && n.owner === owner && n.repo === repo && n.number === number); }) : [...list, { type: 'pr', owner, repo, number }]);
  return !exists;
}

function parseRepoFromPRUrl(url) {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

// ---- Rendering ----

export function renderPRs(container, result, onRetry, prMeta) {
  if (result.error) {
    showError(container, result.error, onRetry);
    return;
  }
  if (!result.items.length) {
    showEmpty(container, t('pr.empty'));
    return;
  }
  container.innerHTML = '';
  result.items.forEach((pr) => {
    const repoName = pr.repository_url.split('/').slice(-2).join('/');
    const meta = prMeta?.[pr.number] || {};
    const checks = meta.checks;
    const mergeState = meta.mergeState;
    const approvals = meta.approvals;
    const urlParts = pr.repository_url.split('/');
    const prOwner = urlParts[urlParts.length - 2];
    const prRepo = urlParts[urlParts.length - 1];
    const watched = isPRWatched(prOwner, prRepo, pr.number);

    const badges = [];
    if (approvals !== undefined) {
      const cls = approvals >= 2 ? 'badge-ci-success' : approvals >= 1 ? 'badge-ci-pending' : 'badge-ci-failure';
      const text = approvals >= 2 ? 'approved' : `${approvals} of 2 approvals`;
      badges.push(`<span class="badge badge-ci ${cls}">${text}</span>`);
    }
    if (checks && checks.status !== 'none') {
      badges.push(`<span class="badge badge-ci badge-ci-${checks.status}">${escapeHtml(ciStatusText(checks))}</span>`);
    }
    if (mergeState === 'dirty') {
      badges.push(`<span class="badge badge-ci badge-ci-failure">has conflicts</span>`);
    } else if (mergeState === 'clean' && approvals >= 2) {
      badges.push(`<span class="badge badge-ci badge-ci-success">ready to merge</span>`);
    }

    const labels = (pr.labels || [])
      .map((l) => `<span class="pr-label" style="background:#${l.color};color:${isLight(l.color) ? '#1b1c23' : '#fff'}">${escapeHtml(l.name)}</span>`)
      .join('');

    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <div class="card-top">
        <span class="card-id">#${pr.number}</span>
        <span class="badge badge-repo">${escapeHtml(repoName)}</span>
        <button class="watch-btn ${watched ? 'watched' : ''}" data-owner="${escapeHtml(prOwner)}" data-repo="${escapeHtml(prRepo)}" data-number="${pr.number}" title="${watched ? t('watchlist.unwatch') : t('watchlist.watch')}">${watched ? '&#9733;' : '&#9734;'}</button>
      </div>
      <div class="card-title">${escapeHtml(pr.title)}</div>
      ${labels ? `<div class="card-labels">${labels}</div>` : ''}
      ${badges.length ? `<div class="card-badges">${badges.join('')}</div>` : ''}
      <div class="card-meta">
        <span>${escapeHtml(pr.user.login)}</span>
        <span>${timeAgo(pr.updated_at)}</span>
      </div>
    `;
    div.addEventListener('click', (e) => {
      if (e.target.closest('.watch-btn')) return;
      window.open(pr.html_url, '_blank');
    });
    div.querySelector('.watch-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      const newWatched = toggleWatchPR(btn.dataset.owner, btn.dataset.repo, parseInt(btn.dataset.number, 10));
      btn.classList.toggle('watched', newWatched);
      btn.innerHTML = newWatched ? '&#9733;' : '&#9734;';
      btn.title = newWatched ? t('watchlist.unwatch') : t('watchlist.watch');
    });
    container.appendChild(div);
  });
}

export function renderJira(container, result, options = {}) {
  if (result.error) {
    showError(container, result.error, options.onRetry || null);
    return;
  }
  if (!result.items.length) {
    showEmpty(container, t('jira.empty'));
    return;
  }
  container.innerHTML = '';
  result.items.forEach((issue) => {
    const status = issue.fields?.status?.name || 'unknown';
    const div = document.createElement('div');
    div.className = 'card';
    const cfg = getConfig();
    const domain = cfg.jiraDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const watched = isJiraWatched(issue.key);
    div.innerHTML = `
      <div class="card-top">
        <span class="card-id">${escapeHtml(issue.key)}</span>
        <span class="badge ${statusBadgeClass(status)}">${escapeHtml(status)}</span>
        ${options.showWatchBtn !== false ? `<button class="watch-btn ${watched ? 'watched' : ''}" data-key="${escapeHtml(issue.key)}" title="${watched ? t('watchlist.unwatch') : t('watchlist.watch')}">${watched ? '&#9733;' : '&#9734;'}</button>` : ''}
      </div>
      <div class="card-title">${escapeHtml(issue.fields?.summary || '')}</div>
      ${options.watchable ? `<div class="card-meta"><span class="watch-remove" data-key="${escapeHtml(issue.key)}">${t('watchlist.remove')}</span></div>` : ''}
    `;
    div.addEventListener('click', (e) => {
      if (e.target.closest('.watch-btn, .watch-remove')) return;
      window.open(`https://${domain}/browse/${issue.key}`, '_blank');
    });
    const watchBtn = div.querySelector('.watch-btn');
    if (watchBtn) {
      watchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        const newWatched = toggleWatchJira(btn.dataset.key);
        btn.classList.toggle('watched', newWatched);
        btn.innerHTML = newWatched ? '&#9733;' : '&#9734;';
        btn.title = newWatched ? t('watchlist.unwatch') : t('watchlist.watch');
      });
    }
    container.appendChild(div);
  });
  if (options.watchable) {
    container.querySelectorAll('.watch-remove').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = el.dataset.key;
        setWatchlist(getWatchlist().filter((i) => {
          const n = normalizeWatchItem(i);
          return !(n.type === 'jira' && n.key === key);
        }));
        if (options.onRemove) options.onRemove();
      });
    });
  }
}

function renderWatchlistUnified(container, jiraResult, prItems, options = {}) {
  container.innerHTML = '';
  let hasContent = false;

  if (jiraResult?.items?.length) {
    const section = document.createElement('div');
    section.className = 'watch-section';
    section.innerHTML = `<div class="watch-section-title">${t('watchlist.jiraSection')}</div>`;
    jiraResult.items.forEach((issue) => {
      const status = issue.fields?.status?.name || 'unknown';
      const cfg = getConfig();
      const domain = cfg.jiraDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="card-top">
          <span class="card-id">${escapeHtml(issue.key)}</span>
          <span class="badge ${statusBadgeClass(status)}">${escapeHtml(status)}</span>
          <button class="watch-remove" data-type="jira" data-key="${escapeHtml(issue.key)}" title="${t('watchlist.remove')}">&times;</button>
        </div>
        <div class="card-title">${escapeHtml(issue.fields?.summary || '')}</div>
      `;
      card.addEventListener('click', (e) => {
        if (e.target.closest('.watch-remove')) return;
        window.open(`https://${domain}/browse/${issue.key}`, '_blank');
      });
      section.appendChild(card);
      hasContent = true;
    });
    container.appendChild(section);
  }

  if (prItems.length) {
    const section = document.createElement('div');
    section.className = 'watch-section';
    section.innerHTML = `<div class="watch-section-title">${t('watchlist.prSection')}</div>`;
    prItems.forEach(({ pr, meta }) => {
      const repoName = pr.repository_url.split('/').slice(-2).join('/');
      const checks = meta?.checks;
      const mergeState = meta?.mergeState;
      const approvals = meta?.approvals;
      const badges = [];
      if (approvals !== undefined) {
        const cls = approvals >= 2 ? 'badge-ci-success' : approvals >= 1 ? 'badge-ci-pending' : 'badge-ci-failure';
        const text = approvals >= 2 ? 'approved' : `${approvals} of 2 approvals`;
        badges.push(`<span class="badge badge-ci ${cls}">${text}</span>`);
      }
      if (checks && checks.status !== 'none') {
        badges.push(`<span class="badge badge-ci badge-ci-${checks.status}">${escapeHtml(ciStatusText(checks))}</span>`);
      }
      if (mergeState === 'dirty') {
        badges.push(`<span class="badge badge-ci badge-ci-failure">has conflicts</span>`);
      } else if (mergeState === 'clean' && approvals >= 2) {
        badges.push(`<span class="badge badge-ci badge-ci-success">ready to merge</span>`);
      }
      const urlParts = pr.repository_url.split('/');
      const prOwner = urlParts[urlParts.length - 2];
      const prRepo = urlParts[urlParts.length - 1];
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="card-top">
          <span class="card-id">#${pr.number}</span>
          <span class="badge badge-repo">${escapeHtml(repoName)}</span>
          <button class="watch-remove" data-type="pr" data-owner="${escapeHtml(prOwner)}" data-repo="${escapeHtml(prRepo)}" data-number="${pr.number}" title="${t('watchlist.remove')}">&times;</button>
        </div>
        <div class="card-title">${escapeHtml(pr.title)}</div>
        ${badges.length ? `<div class="card-badges">${badges.join('')}</div>` : ''}
        <div class="card-meta">
          <span>${escapeHtml(pr.user.login)}</span>
          <span>${timeAgo(pr.updated_at)}</span>
        </div>
      `;
      card.addEventListener('click', (e) => {
        if (e.target.closest('.watch-remove')) return;
        window.open(pr.html_url, '_blank');
      });
      section.appendChild(card);
      hasContent = true;
    });
    container.appendChild(section);
  }

  if (!hasContent) {
    showEmpty(container, t('watchlist.empty'));
    return;
  }

  container.querySelectorAll('.watch-remove').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const type = el.dataset.type;
      const list = getWatchlist();
      setWatchlist(list.filter((i) => {
        const n = normalizeWatchItem(i);
        if (type === 'jira') return !(n.type === 'jira' && n.key === el.dataset.key);
        if (type === 'pr') return !(n.type === 'pr' && n.owner === el.dataset.owner && n.repo === el.dataset.repo && n.number === parseInt(el.dataset.number, 10));
        return true;
      }));
      if (options.onRemove) options.onRemove();
    });
  });
}

// ---- Refresh ----

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

function updateNotifBadge(count) {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  badge.textContent = count || '';
  badge.style.display = count ? '' : 'none';
}

export function initNotifications() {
  requestPermission();
}

export async function refreshAll() {
  const cfg = getConfig();
  setStatus(t('status.loading'));

  const prContainer = document.getElementById('pr-list');
  const jiraContainer = document.getElementById('jira-list');
  const watchContainer = document.getElementById('watch-list');

  showLoading(prContainer);
  showLoading(jiraContainer);
  showLoading(watchContainer);

  const fetchPRs = async () => {
    const result = await fetchActivePRs(cfg);
    if (result.error || !result.items?.length) {
      renderPRs(prContainer, result, fetchPRs);
      return;
    }
    const prMeta = {};
    await Promise.allSettled(
      result.items.map(async (pr) => {
        try {
          const prNum = parseInt(pr.pull_request.html_url.split('/').pop(), 10);
          const urlParts = pr.repository_url.split('/');
          const owner = urlParts[urlParts.length - 2];
          const repo = urlParts[urlParts.length - 1];
          const prRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/pulls/${prNum}`,
            {
              headers: {
                Authorization: `Bearer ${cfg.githubToken}`,
                Accept: 'application/vnd.github+json',
              },
            }
          );
          if (!prRes.ok) return;
          const prData = await prRes.json();
          const meta = {};
          if (prData.head?.sha) {
            const [checks, reviews] = await Promise.all([
              fetchCheckRuns(cfg, owner, repo, prData.head.sha),
              fetchPRReviews(cfg, owner, repo, prNum),
            ]);
            meta.checks = checks;
            meta.approvals = reviews.filter((r) => r.state === 'APPROVED').length;
          }
          if (prData.mergeable_state) {
            meta.mergeState = prData.mergeable_state;
          }
          prMeta[pr.number] = meta;
        } catch { /* skip */ }
      })
    );
    renderPRs(prContainer, result, fetchPRs, prMeta);

    if (cfg.githubUser) {
      const needReview = result.items.filter((pr) => {
        if (pr.draft) return false;
        const meta = prMeta[pr.number];
        if (meta?.mergeState === 'clean') return false;
        return pr.requested_reviewers?.some((r) => r.login === cfg.githubUser)
          || pr.requested_teams?.length > 0;
      });
      notifyReviewNeeded(needReview);
      updateNotifBadge(getPendingCount(result.items.filter((pr) => !pr.draft)));
    }
  };
  const fetchMyJira = () => {
    const myJql = cfg.jiraJql || 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC';
    return fetchJira(cfg, myJql).then((r) => renderJira(jiraContainer, r, { onRetry: fetchMyJira }));
  };
  const fetchWatch = () => {
    const watchlist = getWatchlist().map(normalizeWatchItem);
    if (!watchlist.length) {
      showEmpty(watchContainer, t('watchlist.empty'));
      return Promise.resolve();
    }
    const jiraKeys = watchlist.filter((i) => i.type === 'jira').map((i) => i.key);
    const prItems = watchlist.filter((i) => i.type === 'pr');

    const jiraPromise = jiraKeys.length
      ? fetchJira(cfg, `key in (${jiraKeys.join(',')})`).then((r) => ({ jira: r }))
      : Promise.resolve({ jira: { items: [] } });

    const prPromises = prItems.map(async (item) => {
      const pr = await fetchSinglePR(cfg, item.owner, item.repo, item.number);
      if (!pr) return null;
      const meta = {};
      if (pr.head?.sha) {
        const [checks, reviews] = await Promise.all([
          fetchCheckRuns(cfg, item.owner, item.repo, pr.head.sha),
          fetchPRReviews(cfg, item.owner, item.repo, item.number),
        ]);
        meta.checks = checks;
        meta.approvals = reviews.filter((r) => r.state === 'APPROVED').length;
      }
      if (pr.mergeable_state) meta.mergeState = pr.mergeable_state;
      return { pr, meta };
    });

    return Promise.all([jiraPromise, Promise.all(prPromises)]).then(([jiraRes, prResults]) => {
      renderWatchlistUnified(watchContainer, jiraRes.jira, prResults.filter(Boolean), {
        onRemove: refreshAll,
        onRetry: fetchWatch,
      });
    });
  };

  await Promise.allSettled([fetchPRs(), fetchMyJira(), fetchWatch()]);

  setStatus(t('status.updated', { time: new Date().toLocaleTimeString() }));
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

function renderMetrics(container, data, onRetry) {
  if (!data) {
    showError(container, t('metrics.error'), onRetry);
    return;
  }

  if (data.rateLimited) {
    showError(container, data.rateLimited, onRetry);
    return;
  }

  const gh = data.github || {};
  const jira = data.jira || {};

  container.innerHTML = `<div class="metrics-grid">
    <div class="metrics-section">GitHub</div>
    ${metricCard(t('metrics.timeToFirst'), formatHours(gh.timeToFirstApproval))}
    ${metricCard(t('metrics.timeBetween'), formatHours(gh.timeBetweenApprovals))}
    ${metricCard(t('metrics.reviewRounds'), gh.reviewRounds !== null && gh.reviewRounds !== undefined ? gh.reviewRounds.toFixed(1) : null)}
    ${metricCard(t('metrics.waitingSecond'), gh.waitingForSecond !== null && gh.waitingForSecond !== undefined ? gh.waitingForSecond : null)}
    ${metricCard(t('metrics.mergeRate'), gh.mergeRate !== null && gh.mergeRate !== undefined ? `${gh.mergeRate}%` : null)}
    <div class="metrics-section">Jira</div>
    ${metricCard(t('metrics.jiraThroughput'), jira.throughput !== null && jira.throughput !== undefined ? `${jira.throughput}` : null)}
    ${metricCard(t('metrics.jiraCycleTime'), formatHours(jira.cycleTime))}
  </div>`;
}

let currentPeriod = 2;

export async function refreshMetrics(periodDays) {
  if (periodDays !== undefined) currentPeriod = periodDays;
  const container = document.getElementById('metrics-content');
  if (!container) return;
  showLoading(container);
  const doFetch = () => computeMetrics(currentPeriod).then((d) => renderMetrics(container, d, doFetch));
  await doFetch();
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

// ---- Help ----

function openHelp() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-help">
      <h2>${t('help.title')}</h2>
      <div class="help-content">
        <div class="help-section">
          <h3>${t('help.github.title')}</h3>
          <p>${t('help.github.token')}</p>
          <p>${t('help.github.repos')}</p>
          <p>${t('help.github.email')}</p>
          <p>${t('help.github.username')}</p>
        </div>
        <div class="help-section">
          <h3>${t('help.jira.title')}</h3>
          <p>${t('help.jira.domain')}</p>
          <p>${t('help.jira.credentials')}</p>
          <p>${t('help.jira.jql')}</p>
          <p>${t('help.jira.proxy')}</p>
        </div>
        <div class="help-section">
          <h3>${t('help.watchlist.title')}</h3>
          <p>${t('help.watchlist.jira')}</p>
          <p>${t('help.watchlist.prs')}</p>
        </div>
        <div class="help-section">
          <h3>${t('help.io.title')}</h3>
          <p>${t('help.io.export')}</p>
          <p>${t('help.io.import')}</p>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="help-close">${t('help.close')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#help-close').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ---- AI Insights Modal ----

function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.hoursAgo', { n: minutes });
  const hours = Math.floor(minutes / 60);
  return t('time.hoursAgo', { n: hours });
}

export function openAIModal() {
  const cfg = getConfig();
  if (!cfg.aiApiKey) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2>${t('ai.modal.title')}</h2>
        <div class="empty-state">${t('ai.noKey')}</div>
        <div class="modal-actions">
          <button class="btn btn-primary" id="ai-setup">${t('settings.save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#ai-setup').onclick = () => { overlay.remove(); openSettings(); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    return;
  }

  const types = ['summary', 'anomalies', 'suggestions'];
  const tabStatus = {};
  types.forEach((type) => { tabStatus[type] = isCacheValid(type) ? 'done' : 'pending'; });

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-ai">
      <h2>${t('ai.modal.title')}</h2>
      <div class="ai-tabs">
        ${types.map((type, i) => `
          <button class="ai-tab${i === 0 ? ' active' : ''}" data-type="${type}">
            <span class="ai-tab-label">${t(`ai.section.${type}`)}</span>
            <span class="ai-tab-dot" data-type="${type}"></span>
          </button>
        `).join('')}
      </div>
      <div class="ai-tab-content">
        ${types.map((type, i) => `
          <div class="ai-tab-panel${i === 0 ? ' active' : ''}" data-panel="${type}">
            <div class="ai-tab-panel-inner"></div>
          </div>
        `).join('')}
      </div>
      <div class="ai-footer">
        <span class="ai-cost">${t('ai.cost')}</span>
        <span class="ai-timestamp"></span>
      </div>
      <div class="modal-actions">
        <button class="btn" id="ai-refresh">${t('ai.refresh')}</button>
        <button class="btn btn-primary" id="ai-close">${t('help.close')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const timestampEl = overlay.querySelector('.ai-timestamp');
  let activeType = types[0];

  function getPanel(type) {
    return overlay.querySelector(`[data-panel="${type}"] .ai-tab-panel-inner`);
  }

  function getDot(type) {
    return overlay.querySelector(`.ai-tab-dot[data-type="${type}"]`);
  }

  function setDotStatus(type, status) {
    tabStatus[type] = status;
    const dot = getDot(type);
    dot.className = `ai-tab-dot ai-dot-${status}`;
  }

  function renderSection(type, content) {
    getPanel(type).innerHTML = renderMarkdown(content);
    setDotStatus(type, 'done');
  }

  function showSectionLoading(type) {
    getPanel(type).innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';
    setDotStatus(type, 'loading');
  }

  function showSectionError(type, msg) {
    getPanel(type).innerHTML = `<div class="error-state">${escapeHtml(msg)}</div>`;
    setDotStatus(type, 'error');
  }

  function updateTimestamp() {
    const latest = types.reduce((max, type) => {
      const c = getCached(type);
      return c && c.timestamp > max ? c.timestamp : max;
    }, 0);
    if (latest) timestampEl.textContent = t('ai.lastGenerated', { time: formatTimeAgo(latest) });
  }

  async function refreshSingle(type) {
    showSectionLoading(type);
    try {
      const result = await generateInsight(type);
      renderSection(type, result);
      updateTimestamp();
    } catch (e) {
      const msg = e.message === 'no_api_key' ? t('ai.noKey')
        : e.message.startsWith('rate_limited:') ? `Rate limited — retry in ${e.message.split(':')[1]}s`
        : `${t('ai.error')}: ${e.message}`;
      showSectionError(type, msg);
    }
  }

  async function loadInsights() {
    for (const type of types) {
      if (isCacheValid(type)) {
        const cached = getCached(type);
        renderSection(type, cached.content);
      } else {
        showSectionLoading(type);
      }
    }
    updateTimestamp();

    const needsFetch = types.filter((type) => !isCacheValid(type));
    if (!needsFetch.length) return;

    try {
      await generateAllInsights();

      for (const type of needsFetch) {
        const cached = getCached(type);
        if (cached) renderSection(type, cached.content);
      }
      updateTimestamp();
    } catch (e) {
      const msg = e.message === 'no_api_key' ? t('ai.noKey')
        : e.message.startsWith('rate_limited:') ? `Rate limited — retry in ${e.message.split(':')[1]}s`
        : `${t('ai.error')}: ${e.message}`;
      for (const type of needsFetch) showSectionError(type, msg);
    }
  }

  overlay.querySelectorAll('.ai-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      overlay.querySelectorAll('.ai-tab').forEach((t2) => t2.classList.remove('active'));
      overlay.querySelectorAll('.ai-tab-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      overlay.querySelector(`[data-panel="${tab.dataset.type}"]`).classList.add('active');
      activeType = tab.dataset.type;
    });
  });

  loadInsights();

  overlay.querySelector('#ai-refresh').onclick = () => refreshSingle(activeType);
  overlay.querySelector('#ai-close').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ---- Repo Browser ----

function openRepoBrowser(cfg, onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-repo-browser">
      <h2>${t('repoBrowser.title')}</h2>
      <div class="field">
        <input type="text" id="repo-search" placeholder="${t('repoBrowser.placeholder')}" autocomplete="off" />
      </div>
      <div class="repo-search-status" id="repo-search-status"></div>
      <div class="repo-results" id="repo-results"></div>
      <div class="repo-selected" id="repo-selected-label"></div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="repo-browser-done">${t('repoBrowser.done')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  let searchTimeout;
  const searchInput = overlay.querySelector('#repo-search');
  const resultsContainer = overlay.querySelector('#repo-results');
  const statusEl = overlay.querySelector('#repo-search-status');
  const selectedLabel = overlay.querySelector('#repo-selected-label');
  const currentRepos = cfg.githubRepos.split(',').map((r) => r.trim()).filter(Boolean);

  function updateSelectedCount() {
    selectedLabel.textContent = t('repoBrowser.selected', { n: currentRepos.length });
  }
  updateSelectedCount();

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = searchInput.value.trim();
    if (q.length < 2) {
      resultsContainer.innerHTML = '';
      statusEl.textContent = '';
      return;
    }
    statusEl.textContent = t('repoBrowser.searching');
    resultsContainer.innerHTML = '';
    searchTimeout = setTimeout(async () => {
      const results = await searchRepos(cfg, q);
      statusEl.textContent = '';
      if (!results.length) {
        resultsContainer.innerHTML = `<div class="repo-empty">${t('repoBrowser.noResults')}</div>`;
        return;
      }
      resultsContainer.innerHTML = results.map((r) => {
        const added = currentRepos.includes(r.fullName);
        return `
          <div class="repo-item ${added ? 'repo-item-added' : ''}" data-fullname="${escapeHtml(r.fullName)}">
            <div class="repo-item-name">${escapeHtml(r.fullName)}</div>
            <div class="repo-item-meta">
              ${r.language ? `<span>${escapeHtml(r.language)}</span>` : ''}
              ${r.stars > 0 ? `<span>&#9733; ${r.stars}</span>` : ''}
              ${r.description ? `<span class="repo-item-desc">${escapeHtml(r.description)}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
      resultsContainer.querySelectorAll('.repo-item').forEach((el) => {
        el.addEventListener('click', () => {
          const name = el.dataset.fullname;
          const idx = currentRepos.indexOf(name);
          if (idx >= 0) {
            currentRepos.splice(idx, 1);
            el.classList.remove('repo-item-added');
          } else {
            currentRepos.push(name);
            el.classList.add('repo-item-added');
          }
          updateSelectedCount();
        });
      });
    }, 300);
  });

  overlay.querySelector('#repo-browser-done').onclick = () => {
    onDone(currentRepos.join(', '));
    overlay.remove();
  };
}

function openViewRepos(onClose) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-repo-browser">
      <h2>${t('viewRepos.title')}</h2>
      <div class="repo-results" id="view-repos-list"></div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="view-repos-done">${t('prBrowser.done')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const list = overlay.querySelector('#view-repos-list');
  const repos = getConfig().githubRepos.split(',').map((r) => r.trim()).filter(Boolean);

  if (!repos.length) {
    list.innerHTML = `<div class="repo-empty">${t('viewRepos.empty')}</div>`;
  } else {
    list.innerHTML = repos.map((r) => `
      <div class="repo-item repo-item-added" data-repo="${escapeHtml(r)}">
        <div class="repo-item-name">${escapeHtml(r)}</div>
        <div class="repo-item-meta">
          <span class="watched-prs-remove">${t('watchlist.remove')}</span>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.watched-prs-remove').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = el.closest('.repo-item');
        const repoName = card.dataset.repo;
        const cfg = getConfig();
        const updated = cfg.githubRepos.split(',').map((s) => s.trim()).filter(Boolean).filter((r) => r !== repoName);
        setConfig({ ...cfg, githubRepos: updated.join(', ') });
        const watchlist = getWatchlist().map(normalizeWatchItem).filter((i) => {
          if (i.type !== 'pr') return true;
          return `${i.owner}/${i.repo}` !== repoName;
        });
        setWatchlist(watchlist);
        card.remove();
        if (!list.children.length) {
          list.innerHTML = `<div class="repo-empty">${t('viewRepos.empty')}</div>`;
        }
      });
    });
  }

  overlay.querySelector('#view-repos-done').onclick = () => {
    overlay.remove();
    if (onClose) onClose();
  };
}

function openWatchedPRs(onClose) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-repo-browser">
      <h2>${t('watchedPRs.title')}</h2>
      <div class="repo-results" id="watched-prs-list"></div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="watched-prs-done">${t('prBrowser.done')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const list = overlay.querySelector('#watched-prs-list');
  const watchlist = getWatchlist().map(normalizeWatchItem).filter((i) => i.type === 'pr');

  if (!watchlist.length) {
    list.innerHTML = `<div class="repo-empty">${t('watchedPRs.empty')}</div>`;
  } else {
    list.innerHTML = watchlist.map((item) => `
      <div class="repo-item repo-item-added" data-owner="${escapeHtml(item.owner)}" data-repo="${escapeHtml(item.repo)}" data-number="${item.number}">
        <div class="repo-item-name">${escapeHtml(item.owner)}/${escapeHtml(item.repo)}#${item.number}</div>
        <div class="repo-item-meta">
          <span class="watched-prs-remove">${t('watchlist.remove')}</span>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.watched-prs-remove').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = el.closest('.repo-item');
        const { owner, repo, number } = card.dataset;
        toggleWatchPR(owner, repo, parseInt(number, 10));
        card.remove();
        if (!list.children.length) {
          list.innerHTML = `<div class="repo-empty">${t('watchedPRs.empty')}</div>`;
        }
      });
    });
  }

  overlay.querySelector('#watched-prs-done').onclick = () => {
    overlay.remove();
    if (onClose) onClose();
  };
}

function openPRBrowser() {
  const cfg = getConfig();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-repo-browser">
      <h2>${t('prBrowser.title')}</h2>
      <div class="pr-browser-step" id="pr-step-repos">
        <div class="field">
          <input type="text" id="pr-repo-search" placeholder="${t('prBrowser.searchRepo')}" autocomplete="off" />
        </div>
        <div class="repo-search-status" id="pr-repo-status"></div>
        <div class="repo-results" id="pr-repo-results"></div>
      </div>
      <div class="pr-browser-step" id="pr-step-prs" style="display:none">
        <button class="btn pr-browser-back" id="pr-back">${t('prBrowser.back')}</button>
        <div class="repo-search-status" id="pr-prs-status"></div>
        <div class="repo-results" id="pr-prs-results"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="pr-browser-done">${t('prBrowser.done')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const stepRepos = overlay.querySelector('#pr-step-repos');
  const stepPRs = overlay.querySelector('#pr-step-prs');
  const repoSearchInput = overlay.querySelector('#pr-repo-search');
  const repoResults = overlay.querySelector('#pr-repo-results');
  const repoStatus = overlay.querySelector('#pr-repo-status');
  const prsStatus = overlay.querySelector('#pr-prs-status');
  const prsResults = overlay.querySelector('#pr-prs-results');

  const configuredRepos = cfg.githubRepos.split(',').map((r) => r.trim()).filter(Boolean);

  function showRepoList(query) {
    repoResults.innerHTML = '';
    repoStatus.textContent = '';
    const filtered = query
      ? configuredRepos.filter((r) => r.toLowerCase().includes(query.toLowerCase()))
      : configuredRepos;
    if (!filtered.length) {
      repoResults.innerHTML = `<div class="repo-empty">${t('prBrowser.noRepos')}</div>`;
      return;
    }
    repoResults.innerHTML = filtered.map((r) => `
      <div class="repo-item" data-repo="${escapeHtml(r)}">
        <div class="repo-item-name">${escapeHtml(r)}</div>
      </div>
    `).join('');
    repoResults.querySelectorAll('.repo-item').forEach((el) => {
      el.addEventListener('click', () => loadPRs(el.dataset.repo));
    });
  }

  async function loadPRs(fullName) {
    stepRepos.style.display = 'none';
    stepPRs.style.display = '';
    prsResults.innerHTML = '';
    prsStatus.textContent = t('prBrowser.loading');
    const [owner, repo] = fullName.split('/');
    const prs = await fetchRepoPRs(cfg, owner, repo);
    prsStatus.textContent = '';
    if (!prs.length) {
      prsResults.innerHTML = `<div class="repo-empty">${t('prBrowser.noPRs')}</div>`;
      return;
    }
    prsResults.innerHTML = prs.map((pr) => {
      const watched = isPRWatched(owner, repo, pr.number);
      return `
        <div class="repo-item ${watched ? 'repo-item-added' : ''}" data-owner="${escapeHtml(owner)}" data-repo="${escapeHtml(repo)}" data-number="${pr.number}">
          <div class="repo-item-name">#${pr.number} ${escapeHtml(pr.title)}</div>
          <div class="repo-item-meta">
            <span>${escapeHtml(pr.user.login)}</span>
            <span>${timeAgo(pr.updated_at)}</span>
            ${pr.draft ? `<span>${t('prBrowser.draft')}</span>` : ''}
          </div>
        </div>
      `;
    }).join('');
    prsResults.querySelectorAll('.repo-item').forEach((el) => {
      el.addEventListener('click', () => {
        const o = el.dataset.owner;
        const r = el.dataset.repo;
        const n = parseInt(el.dataset.number, 10);
        const newWatched = toggleWatchPR(o, r, n);
        el.classList.toggle('repo-item-added', newWatched);
      });
    });
  }

  repoSearchInput.addEventListener('input', () => {
    showRepoList(repoSearchInput.value.trim());
  });
  showRepoList('');

  overlay.querySelector('#pr-back').addEventListener('click', () => {
    stepPRs.style.display = 'none';
    stepRepos.style.display = '';
    prsResults.innerHTML = '';
  });

  overlay.querySelector('#pr-browser-done').onclick = () => overlay.remove();
}

// ---- Settings Modal ----

export function openSettings(onSave) {
  const cfg = getConfig();
  const watchlist = getWatchlist().map(normalizeWatchItem);
  const jiraKeys = watchlist.filter((i) => i.type === 'jira').map((i) => i.key);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-settings">
      <h2>${t('settings.title')}</h2>
      <div class="settings-tabs">
        <button class="settings-tab active" data-tab="general">${t('settings.tabGeneral')}</button>
        <button class="settings-tab" data-tab="ai">${t('settings.tabAI')}</button>
        <button class="settings-tab" data-tab="watchlist">${t('settings.tabWatchlist')}</button>
        <button class="settings-tab" data-tab="io">${t('settings.tabIO')}</button>
        <button class="settings-tab" data-tab="help">${t('settings.tabHelp')}</button>
      </div>

      <div class="settings-tab-panel active" data-panel="general">
        <div class="section-divider">${t('settings.github')}</div>
        <div class="field">
          <label>${t('settings.ghToken')}</label>
          <input type="password" id="cfg-gh-token" value="${escapeHtml(cfg.githubToken)}" placeholder="ghp_..." autocomplete="off" />
        </div>
        <div class="field">
          <label>${t('settings.ghRepos')}</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" id="cfg-view-repos">${t('settings.viewRepos')}</button>
            <button class="btn" id="cfg-repo-browser">${t('settings.browseRepos')}</button>
          </div>
        </div>
        <div class="field">
          <label>${t('settings.ghEmail')}</label>
          <input type="email" id="cfg-gh-email" value="${escapeHtml(cfg.githubEmail)}" placeholder="you@email.com" autocomplete="off" />
          <div class="field-hint">${t('settings.ghEmail.hint')}</div>
        </div>
        <div class="field">
          <label>${t('settings.ghUser')}</label>
          <input type="text" id="cfg-gh-user" value="${escapeHtml(cfg.githubUser || '')}" placeholder="${t('settings.ghUser.placeholder')}" />
          <div class="field-hint">${t('settings.ghUser.hint')}</div>
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
          <input type="password" id="cfg-jira-token" value="${escapeHtml(cfg.jiraToken)}" placeholder="token" autocomplete="off" />
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
      </div>

      <div class="settings-tab-panel" data-panel="ai">
        <div class="field">
          <label>${t('settings.aiProvider')}</label>
          <select id="cfg-ai-provider" class="cfg-select">
            ${Object.entries(AI_PROVIDERS).map(([id, p]) =>
              `<option value="${id}"${cfg.aiProvider === id ? ' selected' : ''}>${p.name}</option>`
            ).join('')}
          </select>
        </div>
        <div class="field">
          <label>${t('settings.aiApiKey')}</label>
          <input type="password" id="cfg-ai-key" value="${escapeHtml(cfg.aiApiKey || '')}" placeholder="..." autocomplete="off" />
          <div class="field-hint"><span id="ai-key-hint"></span></div>
        </div>
        <div class="field" id="cfg-ai-model-field">
          <label>${t('settings.aiModel')}</label>
          <select id="cfg-ai-model" class="cfg-select"></select>
        </div>
        <div class="field" id="cfg-ai-custom-field" style="display:none">
          <label>${t('settings.aiCustomUrl')}</label>
          <input type="text" id="cfg-ai-custom-url" value="${escapeHtml(cfg.aiCustomUrl || '')}" placeholder="localhost:11434/v1" />
          <div class="field-hint">${t('settings.aiCustomUrl.hint')}</div>
        </div>
      </div>

      <div class="settings-tab-panel" data-panel="watchlist">
        <div class="field">
          <label>${t('settings.watchlistKeys')}</label>
          <input type="text" id="cfg-watchlist-jira" value="${escapeHtml(jiraKeys.join(', '))}" placeholder="PROJ-123, PROJ-456" />
        </div>
        <div class="field">
          <label>${t('settings.watchlistPRs')}</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" id="cfg-view-watched-prs">${t('settings.viewWatchedPRs')}</button>
            <button class="btn" id="cfg-pr-browser">${t('settings.browsePRs')}</button>
          </div>
        </div>
      </div>

      <div class="settings-tab-panel" data-panel="io">
        <div class="io-buttons">
          <button class="btn" id="cfg-export">${t('settings.export')}</button>
          <button class="btn" id="cfg-import">${t('settings.import')}</button>
          <input type="file" id="cfg-import-file" accept=".json" hidden />
        </div>
        <div class="io-feedback" id="cfg-io-feedback"></div>
      </div>

      <div class="settings-tab-panel" data-panel="help">
        <div class="help-content">
          <div class="help-section">
            <h3>${t('help.github.title')}</h3>
            <p>${t('help.github.token')}</p>
            <p>${t('help.github.repos')}</p>
            <p>${t('help.github.email')}</p>
            <p>${t('help.github.username')}</p>
          </div>
          <div class="help-section">
            <h3>${t('help.jira.title')}</h3>
            <p>${t('help.jira.domain')}</p>
            <p>${t('help.jira.credentials')}</p>
            <p>${t('help.jira.jql')}</p>
            <p>${t('help.jira.proxy')}</p>
          </div>
          <div class="help-section">
            <h3>${t('help.watchlist.title')}</h3>
            <p>${t('help.watchlist.jira')}</p>
            <p>${t('help.watchlist.prs')}</p>
          </div>
          <div class="help-section">
            <h3>${t('help.io.title')}</h3>
            <p>${t('help.io.export')}</p>
            <p>${t('help.io.import')}</p>
          </div>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-danger" id="cfg-cancel">${t('settings.cancel')}</button>
        <button class="btn btn-primary" id="cfg-save">${t('settings.save')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // ---- Settings tabs ----
  overlay.querySelectorAll('.settings-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      overlay.querySelectorAll('.settings-tab').forEach((t2) => t2.classList.remove('active'));
      overlay.querySelectorAll('.settings-tab-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      overlay.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    });
  });

  // ---- AI settings dynamic behavior ----
  const aiProviderSelect = overlay.querySelector('#cfg-ai-provider');
  const aiKeyInput = overlay.querySelector('#cfg-ai-key');
  const aiKeyHint = overlay.querySelector('#ai-key-hint');
  const aiModelSelect = overlay.querySelector('#cfg-ai-model');
  const aiModelField = overlay.querySelector('#cfg-ai-model-field');
  const aiCustomField = overlay.querySelector('#cfg-ai-custom-field');
  const aiApiKeys = { ...(cfg.aiApiKeys || {}) };

  function updateAIFields() {
    const providerId = aiProviderSelect.value;
    const provider = AI_PROVIDERS[providerId];
    if (!provider) return;

    aiKeyInput.value = aiApiKeys[providerId] || '';

    if (provider.keyUrl) {
      aiKeyHint.innerHTML = `<a href="${provider.keyUrl}" target="_blank" rel="noopener">${provider.keyUrl}</a>`;
    } else {
      aiKeyHint.textContent = '';
    }

    aiModelSelect.innerHTML = provider.models
      .map((m) => `<option value="${m.id}"${m.id === cfg.aiModel ? ' selected' : ''}>${m.name}</option>`)
      .join('');

    aiCustomField.style.display = providerId === 'custom' ? '' : 'none';
    aiModelField.style.display = providerId === 'custom' ? 'none' : '';
  }

  aiKeyInput.addEventListener('input', () => {
    aiApiKeys[aiProviderSelect.value] = aiKeyInput.value.trim();
  });

  aiProviderSelect.addEventListener('change', updateAIFields);
  updateAIFields();

  // ---- end AI settings ----

  overlay.querySelector('#cfg-repo-browser').onclick = () => {
    openRepoBrowser(cfg, (repos) => {
      setConfig({ ...getConfig(), githubRepos: repos });
    });
  };

  overlay.querySelector('#cfg-view-repos').onclick = () => {
    openViewRepos();
  };

  overlay.querySelector('#cfg-pr-browser').onclick = () => {
    openPRBrowser();
  };

  overlay.querySelector('#cfg-view-watched-prs').onclick = () => {
    openWatchedPRs();
  };

  overlay.querySelector('#cfg-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#cfg-save').onclick = () => {
    const newCfg = {
      githubToken: document.getElementById('cfg-gh-token').value.trim(),
      githubEmail: document.getElementById('cfg-gh-email').value.trim(),
      githubUser: document.getElementById('cfg-gh-user').value.trim(),
      githubRepos: getConfig().githubRepos,
      jiraDomain: document.getElementById('cfg-jira-domain').value.trim(),
      jiraEmail: document.getElementById('cfg-jira-email').value.trim(),
      jiraToken: document.getElementById('cfg-jira-token').value.trim(),
      jiraJql: document.getElementById('cfg-jira-jql').value.trim(),
      jiraProxyUrl: document.getElementById('cfg-jira-proxy').value.trim(),
      aiProvider: document.getElementById('cfg-ai-provider').value,
      aiApiKey: document.getElementById('cfg-ai-key').value.trim(),
      aiApiKeys: { ...aiApiKeys, [document.getElementById('cfg-ai-provider').value]: document.getElementById('cfg-ai-key').value.trim() },
      aiModel: document.getElementById('cfg-ai-model')?.value || (document.getElementById('cfg-ai-provider').value === 'custom' ? '' : getConfig().aiModel),
      aiCustomUrl: document.getElementById('cfg-ai-custom-url')?.value.trim() || '',
    };
    setConfig(newCfg);
    const jiraInput = document.getElementById('cfg-watchlist-jira').value;
    const jiraItems = jiraInput.split(',').map((s) => s.trim()).filter(Boolean).map((key) => ({ type: 'jira', key }));
    const existingPRs = getWatchlist().map(normalizeWatchItem).filter((i) => i.type === 'pr');
    setWatchlist([...jiraItems, ...existingPRs]);
    overlay.remove();
    if (onSave) onSave();
  };

  const feedback = overlay.querySelector('#cfg-io-feedback');

  overlay.querySelector('#cfg-export').onclick = () => {
    openExportModal(feedback);
  };

  const fileInput = overlay.querySelector('#cfg-import-file');
  overlay.querySelector('#cfg-import').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const password = prompt(t('settings.importPasswordPrompt'));
    try {
      const payload = await parseImportFile(file, password || '');
      openImportModal(payload, feedback, overlay);
    } catch (e) {
      const msg = e.message === 'encrypted-no-password' ? t('import.encryptedNoPassword')
        : e.message === 'wrong-password' ? t('import.wrongPassword')
        : t('import.invalidFile');
      feedback.textContent = msg;
      feedback.className = 'io-feedback io-error';
    }
    fileInput.value = '';
  };
}

function openExportModal(feedback) {
  const cats = collectCategories();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>${t('export.title')}</h2>
      <div class="export-checklist">
        ${Object.entries(cats).map(([id, cat]) => `
          <label class="export-check">
            <input type="checkbox" data-cat="${id}" ${cat.hasData ? 'checked' : ''} />
            <span class="export-check-label">${escapeHtml(cat.label)}</span>
            <span class="export-check-preview">${escapeHtml(cat.data || t('export.empty'))}</span>
          </label>
        `).join('')}
      </div>
      <div class="export-legend">${t('export.legend')}</div>
      <div class="field" style="margin-top:12px">
        <label>${t('export.passwordLabel')}</label>
        <input type="password" id="export-password" placeholder="${t('export.passwordPlaceholder')}" autocomplete="off" />
      </div>
      <div class="io-feedback" id="export-feedback"></div>
      <div class="modal-actions">
        <button class="btn btn-danger" id="export-cancel">${t('settings.cancel')}</button>
        <button class="btn btn-primary" id="export-confirm">${t('export.confirm')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#export-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#export-confirm').onclick = async () => {
    const selected = {};
    overlay.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      selected[cb.dataset.cat] = cb.checked;
    });
    const password = overlay.querySelector('#export-password').value;
    const expFeedback = overlay.querySelector('#export-feedback');
    try {
      await exportSelected(selected, password);
      expFeedback.textContent = t('export.ok');
      expFeedback.className = 'io-feedback io-ok';
      feedback.textContent = t('export.ok');
      feedback.className = 'io-feedback io-ok';
      setTimeout(() => overlay.remove(), 800);
    } catch (e) {
      expFeedback.textContent = e.message;
      expFeedback.className = 'io-feedback io-error';
    }
  };
}

function openImportModal(payload, feedback, settingsOverlay) {
  const preview = getImportPreview(payload);
  const entries = Object.entries(preview);
  if (!entries.length) {
    feedback.textContent = t('import.noData');
    feedback.className = 'io-feedback io-error';
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>${t('import.title')}</h2>
      <div class="import-preview">
        ${entries.map(([id, item]) => {
          if (item.items) {
            return `
              <div class="import-section">
                <label class="export-check">
                  <input type="checkbox" data-import="${id}" ${item.items.some((i) => i.changed) ? 'checked' : ''} />
                  <span class="export-check-label">${escapeHtml(item.label)}</span>
                </label>
                <div class="import-diff">
                  ${item.items.filter((i) => i.changed).map((i) => `
                    <div class="import-diff-row">
                      <span class="import-field">${escapeHtml(i.field)}</span>
                      <span class="import-old">${escapeHtml(i.current || '(empty)')}</span>
                      <span class="import-arrow">&rarr;</span>
                      <span class="import-new">${escapeHtml(i.incoming || '(empty)')}</span>
                    </div>
                  `).join('')}
                  ${!item.items.some((i) => i.changed) ? `<div class="import-no-change">${t('import.noChanges')}</div>` : ''}
                </div>
              </div>
            `;
          }
          return `
            <label class="export-check">
              <input type="checkbox" data-import="${id}" ${item.changed ? 'checked' : ''} />
              <span class="export-check-label">${escapeHtml(item.label)}</span>
              <span class="import-change-detail">${escapeHtml(item.current || '(empty)')} &rarr; ${escapeHtml(item.incoming || '(empty)')}</span>
            </label>
          `;
        }).join('')}
      </div>
      <div class="io-feedback" id="import-feedback"></div>
      <div class="modal-actions">
        <button class="btn btn-danger" id="import-cancel">${t('settings.cancel')}</button>
        <button class="btn btn-primary" id="import-confirm">${t('import.confirm')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#import-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#import-confirm').onclick = () => {
    const selected = {};
    overlay.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      selected[cb.dataset.import] = cb.checked;
    });
    const impFeedback = overlay.querySelector('#import-feedback');
    try {
      applyImport(payload, selected);
      impFeedback.textContent = t('import.ok');
      impFeedback.className = 'io-feedback io-ok';
      feedback.textContent = t('import.ok');
      feedback.className = 'io-feedback io-ok';
      setTimeout(() => {
        overlay.remove();
        if (settingsOverlay) {
          settingsOverlay.remove();
        }
      }, 800);
    } catch (e) {
      impFeedback.textContent = e.message;
      impFeedback.className = 'io-feedback io-error';
    }
  };
}
