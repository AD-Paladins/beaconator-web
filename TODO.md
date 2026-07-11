# TODO — Dev Dashboard

PWA personal para monitorear PRs de GitHub y tickets de Jira. Actualmente funciona en localhost:3000 con un Cloudflare Worker proxy para Jira.

## Estado actual

- [x] PWA funcional con 3 paneles: Active PRs, My Jira, Watchlist
- [x] Cloudflare Worker proxy para CORS de Jira
- [x] Config en localStorage, auto-refresh cada 5 min
- [x] README con setup instructions y troubleshooting
- [x] Split de app.js en módulos: `config.js`, `github.js`, `jira.js`, `ui.js`, `main.js`
- [x] Internacionalización (i18n): EN/ES con selector de idioma en el header
- [x] Panel de métricas con 6 métricas (GitHub + Jira)

## Pendiente

### 1. Métricas (prioridad actual)
- [x] Nuevo módulo `metrics.js` para queries de GitHub + Jira
- [x] Panel de métricas en UI con periodos: 2d, 3d, 4d, 5d+
- [ ] **GitHub:** tiempo a 1er approval, tiempo entre approvals, rondas de review, PRs esperando 2do approval, merge rate
- [ ] **Jira:** throughput (tickets resueltos), cycle time promedio

### 2. Deploy real
- [ ] Frontend en Cloudflare Pages (estático)
- [ ] Verificar que el worker ya deployado funciona con la URL de Pages
- [ ] Configurar custom domain si aplica

### 3. Seguridad del worker
- [ ] Validar origin en `worker/index.js` (usar `ALLOWED_ORIGIN` de wrangler.toml que hoy no se usa)
- [ ] Considerar API key simple como header custom
- [ ] Rate limiting básico para evitar abuso

### 4. Features futuras
- [ ] Estado de CI checks en los PRs (GitHub API: `GET /repos/{owner}/{repo}/commits/{ref}/check-runs`)
- [ ] Notificaciones del browser para PRs que necesitan review
- [ ] Watchlist de PRs (no solo Jira)

### 5. Integración IA
- [ ] Evaluar calidad de descripciones de PRs (las plantillas existentes tienen 200-300 chars pero no dicen nada útil)
- [ ] Resumen semanal: qué se hizo, qué está stuck, qué necesita atención
- [ ] Detección de anomalías en throughput y tiempos de review
- [ ] Sugerencias automáticas: "este PR lleva 5d sin 2do review, considerá hacer ping"
