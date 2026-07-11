export async function fetchActivePRs(cfg) {
  if (!cfg.githubToken || !cfg.githubRepos) {
    return { error: 'Configura tu GitHub token y repos en Settings.' };
  }
  const repos = cfg.githubRepos.split(',').map((r) => r.trim()).filter(Boolean);
  const repoQuery = repos.map((r) => `repo:${r}`).join(' ');
  const emailClause = cfg.githubEmail ? `author-email:${cfg.githubEmail}` : '';
  const userClause = cfg.githubUser
    ? `review-requested:${cfg.githubUser}`
    : '';
  const q = encodeURIComponent(
    `is:pr is:open ${repoQuery} ${emailClause} ${userClause}`.trim()
  );

  try {
    const res = await fetch(
      `https://api.github.com/search/issues?q=${q}&sort=updated&per_page=20`,
      {
        headers: {
          Authorization: `Bearer ${cfg.githubToken}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );

    const rateLimit = {
      remaining: parseInt(res.headers.get('x-ratelimit-remaining') || '-1', 10),
      reset: parseInt(res.headers.get('x-ratelimit-reset') || '0', 10),
    };

    if (res.status === 403 && rateLimit.remaining === 0) {
      const resetDate = new Date(rateLimit.reset * 1000);
      const minutes = Math.ceil((resetDate - Date.now()) / 60000);
      return {
        error: `GitHub rate limit alcanzado. Se resetea en ${minutes} min.`,
        rateLimited: true,
        rateLimit,
      };
    }

    if (!res.ok) {
      const body = await res.text();
      return { error: `GitHub API ${res.status}: ${body.slice(0, 200)}`, rateLimit };
    }
    const data = await res.json();
    return { items: data.items || [], rateLimit };
  } catch (e) {
    return { error: `Fallo de red hacia GitHub: ${e.message}` };
  }
}

export async function fetchCheckRuns(cfg, owner, repo, ref) {
  if (!cfg.githubToken) return null;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/${ref}/check-runs`,
      {
        headers: {
          Authorization: `Bearer ${cfg.githubToken}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const runs = data.check_runs || [];
    if (!runs.length) return { status: 'none', total: 0 };

    const summary = runs.reduce(
      (acc, r) => {
        acc.total++;
        if (r.conclusion === 'success') acc.success++;
        else if (r.conclusion === 'failure') acc.failure++;
        else if (r.status === 'in_progress') acc.pending++;
        else if (r.conclusion === 'skipped') acc.skipped++;
        else acc.other++;
        return acc;
      },
      { total: 0, success: 0, failure: 0, pending: 0, skipped: 0, other: 0 }
    );

    if (summary.failure > 0) summary.status = 'failure';
    else if (summary.pending > 0) summary.status = 'pending';
    else if (summary.success > 0) summary.status = 'success';
    else summary.status = 'none';

    return summary;
  } catch {
    return null;
  }
}

export async function fetchPRReviews(cfg, owner, repo, prNumber) {
  if (!cfg.githubToken) return [];
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
      {
        headers: {
          Authorization: `Bearer ${cfg.githubToken}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data || [];
  } catch {
    return [];
  }
}

export async function searchRepos(cfg, query) {
  if (!cfg.githubToken || !query) return [];
  try {
    const q = encodeURIComponent(query);
    const res = await fetch(
      `https://api.github.com/search/repositories?q=${q}&sort=stars&per_page=15`,
      {
        headers: {
          Authorization: `Bearer ${cfg.githubToken}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map((r) => ({
      fullName: r.full_name,
      description: r.description || '',
      stars: r.stargazers_count,
      language: r.language,
    }));
  } catch {
    return [];
  }
}

export async function fetchSinglePR(cfg, owner, repo, number) {
  if (!cfg.githubToken) return null;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`,
      {
        headers: {
          Authorization: `Bearer ${cfg.githubToken}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchRepoPRs(cfg, owner, repo) {
  if (!cfg.githubToken) return [];
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&sort=updated&per_page=30`,
      {
        headers: {
          Authorization: `Bearer ${cfg.githubToken}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}
