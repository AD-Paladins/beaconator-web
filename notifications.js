const SEEN_KEY = 'devdash_notified_prs_v1';

function getSeenPRs() {
  const raw = localStorage.getItem(SEEN_KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveSeenPRs(list) {
  localStorage.setItem(SEEN_KEY, JSON.stringify(list));
}

export function requestPermission() {
  if (!('Notification' in window)) return Promise.resolve('unsupported');
  if (Notification.permission === 'granted') return Promise.resolve('granted');
  if (Notification.permission === 'denied') return Promise.resolve('denied');
  return Notification.requestPermission();
}

export function getPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export function notifyReviewNeeded(prs) {
  if (!prs.length) return;
  if (Notification.permission !== 'granted') return;

  const seen = new Set(getSeenPRs());
  const newPRs = prs.filter((pr) => !seen.has(pr.number));
  if (!newPRs.length) return;

  const title = newPRs.length === 1
    ? `Review needed: #${newPRs[0].number}`
    : `${newPRs.length} PRs need your review`;
  const body = newPRs.length === 1
    ? newPRs[0].title
    : newPRs.slice(0, 3).map((pr) => `#${pr.number} ${pr.title}`).join('\n');

  try {
    new Notification(title, { body, icon: './icon.svg', tag: 'review-needed' });
  } catch { /* notifications blocked or unavailable */ }

  const allSeen = [...seen, ...newPRs.map((pr) => pr.number)];
  if (allSeen.length > 100) allSeen.splice(0, allSeen.length - 100);
  saveSeenPRs(allSeen);
}

export function getPendingCount(prs) {
  const seen = new Set(getSeenPRs());
  return prs.filter((pr) => !seen.has(pr.number)).length;
}

export function markAllSeen(prs) {
  const seen = new Set(getSeenPRs());
  for (const pr of prs) seen.add(pr.number);
  const all = [...seen];
  if (all.length > 100) all.splice(0, all.length - 100);
  saveSeenPRs(all);
}

export function clearSeen() {
  localStorage.removeItem(SEEN_KEY);
}
