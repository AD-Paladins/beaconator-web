import { getConfig } from './config.js';

// ---- Helpers ----

function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function hoursBetween(a, b) {
  return Math.abs(new Date(b) - new Date(a)) / 3600000;
}

// ---- GitHub ----

async function ghFetch(cfg, url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${cfg.githubToken}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchMergedPRs(cfg, sinceDate) {
  if (!cfg.githubToken || !cfg.githubRepos) return [];
  const repos = cfg.githubRepos.split(',').map((r) => r.trim()).filter(Boolean);
  const repoQuery = repos.map((r) => `repo:${r}`).join(' ');
  const q = encodeURIComponent(`is:pr is:merged merged:>=${sinceDate} ${repoQuery}`.trim());

  const data = await ghFetch(cfg, `https://api.github.com/search/issues?q=${q}&sort=updated&per_page=30`);
  return data?.items || [];
}

async function fetchPRReviews(cfg, owner, repo, prNumber) {
  const data = await ghFetch(cfg, `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`);
  return data || [];
}

async function fetchOpenPRs(cfg) {
  if (!cfg.githubToken || !cfg.githubRepos) return [];
  const repos = cfg.githubRepos.split(',').map((r) => r.trim()).filter(Boolean);
  const repoQuery = repos.map((r) => `repo:${r}`).join(' ');
  const q = encodeURIComponent(`is:pr is:open ${repoQuery}`.trim());

  const data = await ghFetch(cfg, `https://api.github.com/search/issues?q=${q}&sort=updated&per_page=30`);
  return data?.items || [];
}

function parseRepoFromUrl(url) {
  const parts = url.split('/');
  return { owner: parts[-2], repo: parts[-1] };
}

async function computeGitHubMetrics(cfg, periodDays) {
  const since = daysAgo(periodDays);
  const merged = await fetchMergedPRs(cfg, since);

  const mergeTimes = [];
  const reviewGaps = [];
  const reviewRounds = [];
  let waitingForSecond = 0;

  const reviewsBatch = await Promise.allSettled(
    merged.map(async (pr) => {
      const urlParts = pr.repository_url.split('/');
      const owner = urlParts[urlParts.length - 2];
      const repo = urlParts[urlParts.length - 1];
      const reviews = await fetchPRReviews(cfg, owner, repo, pr.number);
      return { pr, reviews, owner, repo };
    })
  );

  for (const result of reviewsBatch) {
    if (result.status !== 'fulfilled') continue;
    const { pr, reviews } = result.value;

    const mergeTime = hoursBetween(pr.created_at, pr.closed_at);
    if (mergeTime > 0) mergeTimes.push(mergeTime);

    const approvals = reviews
      .filter((r) => r.state === 'APPROVED')
      .sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));

    const uniqueDates = [...new Set(
      reviews.map((r) => new Date(r.submitted_at).toDateString())
    )];
    if (uniqueDates.length > 0) reviewRounds.push(uniqueDates.length);

    if (approvals.length >= 2) {
      const gap = hoursBetween(approvals[0].submitted_at, approvals[1].submitted_at);
      if (gap > 0) reviewGaps.push(gap);
    }
  }

  const openPRs = await fetchOpenPRs(cfg);
  for (const pr of openPRs) {
    const urlParts = pr.repository_url.split('/');
    const owner = urlParts[urlParts.length - 2];
    const repo = urlParts[urlParts.length - 1];
    const reviews = await fetchPRReviews(cfg, owner, repo, pr.number);
    const approvals = reviews.filter((r) => r.state === 'APPROVED');
    if (approvals.length === 1) waitingForSecond++;
  }

  return {
    timeToFirstApproval: null,
    timeBetweenApprovals: median(reviewGaps),
    reviewRounds: median(reviewRounds),
    waitingForSecond,
    mergeRate: merged.length,
    mergeTimes: median(mergeTimes),
  };
}

// ---- Jira ----

async function fetchResolvedTickets(cfg, sinceDate) {
  if (!cfg.jiraDomain || !cfg.jiraEmail || !cfg.jiraToken) return [];
  const domain = cfg.jiraDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const auth = btoa(`${cfg.jiraEmail}:${cfg.jiraToken}`);
  const jql = `resolved >= "${sinceDate}" ORDER BY resolved DESC`;

  let url;
  if (cfg.jiraProxyUrl) {
    const proxy = cfg.jiraProxyUrl.replace(/\/$/, '');
    url = `${proxy}/search/jql?jira_domain=${encodeURIComponent(domain)}&jql=${encodeURIComponent(jql)}&maxResults=50&fields=created,resolutiondate,status`;
  } else {
    url = `https://${domain}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=50&fields=created,resolutiondate,status`;
  }

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.issues || [];
  } catch {
    return [];
  }
}

async function computeJiraMetrics(cfg, periodDays) {
  const since = daysAgo(periodDays);
  const resolved = await fetchResolvedTickets(cfg, since);

  const cycleTimes = [];
  for (const issue of resolved) {
    const created = issue.fields?.created;
    const resolvedDate = issue.fields?.resolutiondate;
    if (created && resolvedDate) {
      const cycleHours = hoursBetween(created, resolvedDate);
      if (cycleHours > 0) cycleTimes.push(cycleHours);
    }
  }

  return {
    throughput: resolved.length,
    cycleTime: median(cycleTimes),
  };
}

// ---- Main ----

export async function computeMetrics(periodDays) {
  const cfg = getConfig();

  const [gh, jira] = await Promise.allSettled([
    computeGitHubMetrics(cfg, periodDays),
    computeJiraMetrics(cfg, periodDays),
  ]);

  return {
    github: gh.status === 'fulfilled' ? gh.value : null,
    jira: jira.status === 'fulfilled' ? jira.value : null,
  };
}
