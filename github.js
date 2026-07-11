export async function fetchActivePRs(cfg) {
  if (!cfg.githubToken || !cfg.githubRepos) {
    return { error: 'Configura tu GitHub token y repos en Settings.' };
  }
  const repos = cfg.githubRepos.split(',').map((r) => r.trim()).filter(Boolean);
  const repoQuery = repos.map((r) => `repo:${r}`).join(' ');
  const userClause = cfg.githubUser
    ? `(author:${cfg.githubUser} OR review-requested:${cfg.githubUser})`
    : '';
  const q = encodeURIComponent(
    `is:pr is:open ${repoQuery} ${userClause}`.trim()
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
    if (!res.ok) {
      const body = await res.text();
      return { error: `GitHub API ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = await res.json();
    return { items: data.items || [] };
  } catch (e) {
    return { error: `Fallo de red hacia GitHub: ${e.message}` };
  }
}
