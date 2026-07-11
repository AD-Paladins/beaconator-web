const CORS_HEADERS_BASE = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const RATE_LIMIT_STORE = new Map();

function jsonError(msg, status, headers) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function checkOrigin(request, env) {
  const allowed = env.ALLOWED_ORIGIN;
  if (!allowed || allowed === '*') return null;
  const origin = request.headers.get('Origin') || request.headers.get('Referer');
  if (!origin) return null;
  const originUrl = new URL(origin);
  if (originUrl.origin !== new URL(allowed).origin) return null;
  return origin;
}

function checkRateLimit(key, env) {
  const max = parseInt(env.RATE_LIMIT_GLOBAL_MAX || '60', 10);
  const window = parseInt(env.RATE_LIMIT_WINDOW_SECONDS || '60', 10) * 1000;
  const now = Date.now();
  const entry = RATE_LIMIT_STORE.get(key);
  if (!entry || now - entry.start > window) {
    RATE_LIMIT_STORE.set(key, { count: 1, start: now });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

function getRateLimitKey(request, env) {
  const mode = (env.RATE_LIMIT_MODE || 'global').toLowerCase();
  if (mode === 'ip') {
    return request.headers.get('CF-Connecting-IP') || 'unknown';
  }
  return '__global__';
}

function validateJiraDomain(domain) {
  if (!domain) return false;
  const clean = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (clean.includes('/') || clean.includes(':') || clean.includes(' ')) return false;
  if (!clean.endsWith('.atlassian.net') && !clean.includes('.')) return false;
  return true;
}

function corsHeaders(origin, env) {
  const allowed = env.ALLOWED_ORIGIN;
  if (!allowed || allowed === '*') {
    return { ...CORS_HEADERS_BASE, 'Access-Control-Allow-Origin': '*' };
  }
  return { ...CORS_HEADERS_BASE, 'Access-Control-Allow-Origin': allowed };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      const origin = checkOrigin(request, env);
      if (origin === null && env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== '*') {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }

    const origin = checkOrigin(request, env);
    if (origin === null && env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== '*') {
      return jsonError('Forbidden: origin not allowed', 403, corsHeaders(null, env));
    }

    const headers = corsHeaders(origin, env);

    const rlKey = getRateLimitKey(request, env);
    if (!checkRateLimit(rlKey, env)) {
      return jsonError('Rate limit exceeded', 429, { ...headers, 'Retry-After': '60' });
    }

    try {
      const url = new URL(request.url);
      const jiraDomain = url.searchParams.get('jira_domain');
      if (!jiraDomain) {
        return jsonError('Missing jira_domain param', 400, headers);
      }

      const cleanDomain = jiraDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (!validateJiraDomain(cleanDomain)) {
        return jsonError('Invalid jira_domain', 400, headers);
      }

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
        headers: { 'Content-Type': 'application/json', ...headers },
      });
    } catch (e) {
      return jsonError(e.message, 502, headers);
    }
  },
};
