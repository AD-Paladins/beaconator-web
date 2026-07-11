const SPINNER = `<div class="loading-state"><div class="spinner"></div></div>`;

export function showLoading(container) {
  container.innerHTML = SPINNER;
}

export function showError(container, message, onRetry) {
  const retryBtn = onRetry
    ? `<button class="retry-btn" id="retry-${Math.random().toString(36).slice(2, 8)}">retry</button>`
    : '';
  container.innerHTML = `<div class="error-state">${escapeHtml(message)}${retryBtn}</div>`;
  if (onRetry) {
    const btn = container.querySelector('.retry-btn');
    if (btn) btn.addEventListener('click', onRetry);
  }
}

export function showEmpty(container, message) {
  container.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

export function formatRateLimit(resetTimestamp) {
  if (!resetTimestamp) return null;
  const resetDate = new Date(resetTimestamp * 1000);
  const now = new Date();
  const minutes = Math.ceil((resetDate - now) / 60000);
  if (minutes <= 0) return null;
  return minutes;
}
