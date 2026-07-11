const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      const url = new URL(request.url);
      const jiraDomain = url.searchParams.get('jira_domain');
      if (!jiraDomain) {
        return new Response(JSON.stringify({ error: 'Missing jira_domain param' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }

      const cleanDomain = jiraDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
      url.searchParams.delete('jira_domain');
      url.hostname = cleanDomain;
      url.pathname = '/rest/api/3' + url.pathname;

      const res = await fetch(url.toString(), {
        method: request.method,
        headers: {
          Authorization: request.headers.get('Authorization') || '',
          Accept: 'application/json',
        },
      });

      return new Response(await res.text(), {
        status: res.status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }
  },
};
