import { getConfig } from './config.js';
import { chatCompletion } from './ai-providers.js';
import { fetchPRReviews } from './github.js';
import { fetchJira } from './jira.js';

const CACHE_KEY = 'devdash_ai_cache_v1';
const CACHE_TTL = 60 * 60 * 1000;

// ---- Cache ----

function getCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
  } catch {
    return {};
  }
}

function setCache(type, content) {
  const cache = getCache();
  cache[type] = { content, timestamp: Date.now() };
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export function getCached(type) {
  const cache = getCache();
  return cache[type] || null;
}

export function isCacheValid(type) {
  const entry = getCached(type);
  if (!entry) return false;
  return Date.now() - entry.timestamp < CACHE_TTL;
}

// ---- Markdown renderer (minimal) ----

export function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`(.+?)`/g, '<code>$1</code>');
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  html = html.replace(/\n{2,}/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  return `<div class="ai-markdown">${html}</div>`;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ---- Data collection ----

async function collectGitHubData(cfg) {
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - 7);
  const since = sinceDate.toISOString().split('T')[0];

  const [merged, openPRs, closed] = await Promise.allSettled([
    (async () => {
      const repos = cfg.githubRepos.split(',').map((r) => r.trim()).filter(Boolean);
      if (!repos.length || !cfg.githubToken) return [];
      const repoQuery = repos.map((r) => `repo:${r}`).join(' ');
      const q = encodeURIComponent(`is:pr is:merged merged:>=${since} ${repoQuery}`.trim());
      const res = await fetch(`https://api.github.com/search/issues?q=${q}&sort=updated&per_page=30`, {
        headers: { Authorization: `Bearer ${cfg.githubToken}`, Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.items || [];
    })(),
    (async () => {
      const repos = cfg.githubRepos.split(',').map((r) => r.trim()).filter(Boolean);
      if (!repos.length || !cfg.githubToken) return [];
      const repoQuery = repos.map((r) => `repo:${r}`).join(' ');
      const q = encodeURIComponent(`is:pr is:open ${repoQuery}`.trim());
      const res = await fetch(`https://api.github.com/search/issues?q=${q}&sort=updated&per_page=30`, {
        headers: { Authorization: `Bearer ${cfg.githubToken}`, Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.items || [];
    })(),
    (async () => {
      const repos = cfg.githubRepos.split(',').map((r) => r.trim()).filter(Boolean);
      if (!repos.length || !cfg.githubToken) return [];
      const repoQuery = repos.map((r) => `repo:${r}`).join(' ');
      const q = encodeURIComponent(`is:pr is:closed closed:>=${since} ${repoQuery}`.trim());
      const res = await fetch(`https://api.github.com/search/issues?q=${q}&sort=updated&per_page=30`, {
        headers: { Authorization: `Bearer ${cfg.githubToken}`, Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.items || [];
    })(),
  ]);

  const mergedPRs = merged.status === 'fulfilled' ? merged.value : [];
  const openItems = openPRs.status === 'fulfilled' ? openPRs.value : [];
  const closedPRs = closed.status === 'fulfilled' ? closed.value : [];

  const enrichedOpen = await Promise.allSettled(
    openItems.slice(0, 10).map(async (pr) => {
      const urlParts = pr.repository_url.split('/');
      const owner = urlParts[urlParts.length - 2];
      const repo = urlParts[urlParts.length - 1];
      const reviews = await fetchPRReviews(cfg, owner, repo, pr.number);
      const approvals = reviews.filter((r) => r.state === 'APPROVED').length;
      const daysOpen = Math.floor((Date.now() - new Date(pr.created_at).getTime()) / 86400000);
      return {
        number: pr.number,
        title: pr.title,
        repo: `${owner}/${repo}`,
        author: pr.user?.login || '',
        daysOpen,
        approvals,
        labels: (pr.labels || []).map((l) => l.name),
        draft: pr.draft || false,
        url: pr.html_url,
      };
    })
  );

  return {
    merged: mergedPRs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      repo: pr.repository_url.split('/').slice(-2).join('/'),
      author: pr.user?.login || '',
      mergedAt: pr.closed_at,
    })),
    open: enrichedOpen.filter((r) => r.status === 'fulfilled').map((r) => r.value),
    totalClosed: closedPRs.length,
    mergeRate: closedPRs.length > 0 ? Math.round((mergedPRs.length / closedPRs.length) * 100) : null,
  };
}

async function collectJiraData(cfg) {
  const jql = cfg.jiraJql || 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC';
  const result = await fetchJira(cfg, jql);
  if (result.error) return { tickets: [], error: result.error };

  const tickets = (result.items || []).map((issue) => {
    const created = issue.fields?.created ? new Date(issue.fields.created) : null;
    const updated = issue.fields?.updated ? new Date(issue.fields.updated) : null;
    const daysSinceUpdate = updated ? Math.floor((Date.now() - updated.getTime()) / 86400000) : null;
    const daysSinceCreated = created ? Math.floor((Date.now() - created.getTime()) / 86400000) : null;
    return {
      key: issue.key,
      summary: issue.fields?.summary || '',
      status: issue.fields?.status?.name || 'unknown',
      priority: issue.fields?.priority?.name || '',
      daysSinceUpdate,
      daysSinceCreated,
    };
  });

  return { tickets };
}

// ---- Analysis functions ----

const SYSTEM_PROMPT = `You are a senior engineering manager analyzing a dev team's dashboard data.
Be concise, direct, and actionable. Use bullet points.
Focus on what needs human attention. Don't state obvious numbers — interpret them.
Keep responses under 400 words.
Output in the same language as the data context (if Spanish labels, respond in Spanish; if English, English).`;

function buildSummaryPrompt(gh, jira) {
  return `Analyze this week's development activity and provide a summary.

## GitHub
- PRs merged this week: ${gh.merged.length}
- PRs currently open: ${gh.open.length}
- Merge rate: ${gh.mergeRate !== null ? gh.mergeRate + '%' : 'N/A'}
- PRs open details:
${gh.open.map((pr) => `  - #${pr.number} "${pr.title}" in ${pr.repo} by ${pr.author} — ${pr.daysOpen}d open, ${pr.approvals} approvals${pr.draft ? ' (draft)' : ''}`).join('\n') || '  (none)'}

## Jira
- Open tickets: ${jira.tickets.length}
- Tickets:
${jira.tickets.map((t) => `  - ${t.key} "${t.summary}" — status: ${t.status}, ${t.daysSinceUpdate}d since update`).join('\n') || '  (none)'}

Provide:
1. **What was done** — key accomplishments this week
2. **What's stuck** — items that haven't moved or are blocked
3. **What needs attention** — PRs needing review, CI failures, stale tickets`;
}

function buildAnomaliesPrompt(gh, jira) {
  return `Analyze these development metrics for anomalies or concerning patterns.

## GitHub Metrics (this week)
- PRs merged: ${gh.merged.length}
- PRs open: ${gh.open.length}
- Merge rate: ${gh.mergeRate !== null ? gh.mergeRate + '%' : 'N/A'}
- PRs waiting for 2nd approval: ${gh.open.filter((pr) => pr.approvals === 1).length}
- PRs waiting for any approval: ${gh.open.filter((pr) => pr.approvals === 0 && !pr.draft).length}

## Jira
- Open tickets: ${jira.tickets.length}
- Stale tickets (no update in 3+ days): ${jira.tickets.filter((t) => t.daysSinceUpdate >= 3).length}
- Old tickets (created 7+ days ago, still open): ${jira.tickets.filter((t) => t.daysSinceCreated >= 7).length}

Identify any anomalies: unusual patterns, things that look wrong, or metrics that deserve investigation.
Be specific — cite ticket numbers and PR numbers.`;
}

function buildSuggestionsPrompt(gh, jira) {
  return `Based on this dashboard data, generate specific actionable suggestions.

## Open PRs
${gh.open.map((pr) => `  - #${pr.number} "${pr.title}" in ${pr.repo}
    Author: ${pr.author} | Open: ${pr.daysOpen}d | Approvals: ${pr.approvals}/2${pr.draft ? ' | DRAFT' : ''}
    Labels: ${pr.labels.join(', ') || 'none'}`).join('\n') || '  (none)'}

## Jira Tickets
${jira.tickets.map((t) => `  - ${t.key} "${t.summary}"
    Status: ${t.status} | Priority: ${t.priority} | Last update: ${t.daysSinceUpdate}d ago | Age: ${t.daysSinceCreated}d`).join('\n') || '  (none)'}

Generate specific, actionable suggestions:
- PRs that need a ping or follow-up (waiting too long for review)
- PRs waiting for any approval for more than 2 days
- Tickets that seem stuck or need escalation
- Any quick wins (PRs with 2 approvals ready to merge, tickets almost done)
Use format: "[ACTION] for [ITEM] — [REASON]"`;
}

// ---- Public API ----

export async function generateInsight(type) {
  const cfg = getConfig();
  if (!cfg.aiApiKey) throw new Error('no_api_key');

  const [gh, jira] = await Promise.all([collectGitHubData(cfg), collectJiraData(cfg)]);

  let prompt;
  switch (type) {
    case 'summary': prompt = buildSummaryPrompt(gh, jira); break;
    case 'anomalies': prompt = buildAnomaliesPrompt(gh, jira); break;
    case 'suggestions': prompt = buildSuggestionsPrompt(gh, jira); break;
    default: throw new Error(`Unknown insight type: ${type}`);
  }

  const result = await chatCompletion(cfg, {
    system: SYSTEM_PROMPT,
    user: prompt,
    temperature: 0.3,
    maxTokens: 1500,
  });

  setCache(type, result);
  return result;
}

export async function generateAllInsights(onProgress) {
  const cfg = getConfig();
  if (!cfg.aiApiKey) throw new Error('no_api_key');

  const [gh, jira] = await Promise.all([collectGitHubData(cfg), collectJiraData(cfg)]);
  const types = ['summary', 'anomalies', 'suggestions'];
  const results = {};

  for (const type of types) {
    if (onProgress) onProgress(type);
    const promptFn = { summary: buildSummaryPrompt, anomalies: buildAnomaliesPrompt, suggestions: buildSuggestionsPrompt }[type];
    const result = await chatCompletion(cfg, {
      system: SYSTEM_PROMPT,
      user: promptFn(gh, jira),
      temperature: 0.3,
      maxTokens: 1500,
    });
    setCache(type, result);
    results[type] = result;
  }

  return results;
}
