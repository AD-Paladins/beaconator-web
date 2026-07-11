# Jira CORS Proxy (Cloudflare Worker)

## Setup (una vez)

```bash
# Instalá wrangler CLI si no lo tenés
npm install -g wrangler

# Logueate en Cloudflare
wrangler login

# Deploy
cd worker
wrangler deploy
```

Te va a dar una URL tipo:
```
https://jira-proxy.your-subdomain.workers.dev
```

Copiá esa URL y pegala en el **Settings** del dashboard en el campo **Proxy URL**.

## Cómo funciona

1. Tu navegador llama al worker con el token de Jira en el header `Authorization`
2. El worker reenvía la llamada a Jira Cloud (server-side, sin CORS)
3. El worker devuelve la respuesta a tu navegador

Nada se almacena. El worker es un tubo transparente.
