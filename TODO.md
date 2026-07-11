# TODO — Dev Dashboard

PWA personal para monitorear PRs de GitHub y tickets de Jira. Actualmente funciona en localhost:3000 con un Cloudflare Worker proxy para Jira.

## Estado actual

- [x] PWA funcional con 4 paneles: Active PRs, My Jira, Watchlist, Metrics
- [x] Cloudflare Worker proxy para CORS de Jira
- [x] Config en localStorage, auto-refresh cada 5 min
- [x] README con setup instructions y troubleshooting
- [x] Split de app.js en módulos: `config.js`, `github.js`, `jira.js`, `ui.js`, `main.js`
- [x] Internacionalización (i18n): EN/ES con selector de idioma en el header
- [x] Panel de métricas con 7 métricas (GitHub + Jira)
- [x] Loading states, error handling con retry, rate limit detection
- [x] Estado de CI checks en los PRs
- [x] Labels de GitHub con colores en PR cards
- [x] Approval badge (N/2), conflict badge, ready-to-merge badge
- [x] Notificaciones del browser para PRs que necesitan review
- [x] Header badge con count de PRs pendientes
- [x] Repo browser — search y selección de repos desde GitHub API
- [x] PR browser — picker de dos pasos (repo → PRs) para watchlist
- [x] Watchlist unificada (Jira tickets + GitHub PRs)
- [x] Watch button (estrella) en PR cards y Jira cards
- [x] View repos / View watched PRs — modales para gestionar
- [x] Export/Import con checklist selectivo y preview de cambios
- [x] Help modal — guía completa de cada campo de settings
- [x] GitHub email para filtrar PRs (username opcional para notificaciones)

## Pendiente

### 1. Deploy real
- [ ] Frontend en Cloudflare Pages (estático)
- [ ] Verificar que el worker ya deployado funciona con la URL de Pages
- [ ] Configurar custom domain si aplica

### 2. Seguridad del worker
- [ ] Validar origin en `worker/index.js` (usar `ALLOWED_ORIGIN` de wrangler.toml que hoy no se usa)
- [ ] Considerar API key simple como header custom
- [ ] Rate limiting básico para evitar abuso

### 3. Selector de temas
- [ ] Dark (actual) — default
- [ ] Light — fondo claro, texto oscuro
- [ ] High contrast light — fondo blanco, texto negro, bordes gruesos
- [ ] High contrast dark — fondo negro puro, texto blanco puro, bordes gruesos
- [ ] Gaming — púrpura/amarillo, estilo gamer
- [ ] Lilac — tonos lila suaves
- [ ] Pink — rosa (no fosforescente)
- [ ] Selector de temas en el header o settings
- [ ] Persistir preferencia en localStorage

### 4. Integración IA
- [ ] Evaluar calidad de descripciones de PRs (las plantillas existentes tienen 200-300 chars pero no dicen nada útil)
- [ ] Resumen semanal: qué se hizo, qué está stuck, qué necesita atención
- [ ] Detección de anomalías en throughput y tiempos de review
- [ ] Sugerencias automáticas: "este PR lleva 5d sin 2do review, considerá hacer ping"

### Notas
- Deploy a Cloudflare Pages: pendiente hasta que el usuario lo solicite activamente
