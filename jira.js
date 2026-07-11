export async function fetchJira(cfg, jql) {
  if (!cfg.jiraDomain || !cfg.jiraEmail || !cfg.jiraToken) {
    return { error: 'Configura tu dominio, email y token de Jira en Settings.' };
  }
  const domain = cfg.jiraDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const auth = btoa(`${cfg.jiraEmail}:${cfg.jiraToken}`);

  let url;
  if (cfg.jiraProxyUrl) {
    const proxy = cfg.jiraProxyUrl.replace(/\/$/, '');
    url = `${proxy}/search/jql?jira_domain=${encodeURIComponent(domain)}&jql=${encodeURIComponent(jql)}&maxResults=20&fields=summary,status,priority,updated`;
  } else {
    url = `https://${domain}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=20&fields=summary,status,priority,updated`;
  }

  try {
    const headers = {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    };
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.text();
      return { error: `Jira API ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = await res.json();
    return { items: data.issues || [] };
  } catch (e) {
    return {
      error: `No se pudo conectar a Jira directamente (probable bloqueo CORS). Necesitas un proxy — ver nota en Settings. Detalle: ${e.message}`,
    };
  }
}
