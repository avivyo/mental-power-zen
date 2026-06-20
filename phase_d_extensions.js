// =============================================================================
// Mental Power Zen — Phase D Extensions
// Realtime | Toast | Print/PDF | PWA Helpers
// Appended automatically — keep at end of app.js
// =============================================================================

// ─── SECTION 20: SUPABASE REALTIME ────────────────────────────────────────────
let _realtimeChannel = null;

function startRealtimeUpdates() {
  if (!currentProfile?.team_id) return;
  const staffRoles = ['coach','team_manager','psychologist','nutritionist','fitness_coach'];
  if (!staffRoles.includes(currentProfile.role)) return;
  if (_realtimeChannel) _supabase.removeChannel(_realtimeChannel);

  _realtimeChannel = _supabase
    .channel('team-rpe-' + currentProfile.team_id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rpe_logs' }, handleRealtimeRPE)
    .subscribe();

  console.log('[REALTIME] Listening for team RPE updates...');
}

function stopRealtimeUpdates() {
  if (_realtimeChannel) {
    _supabase.removeChannel(_realtimeChannel);
    _realtimeChannel = null;
  }
}

function handleRealtimeRPE(payload) {
  const log = payload.new ?? payload.old;
  if (!log?.athlete_id) return;

  // Update visible roster card live
  const card = document.querySelector('.roster-card[data-athlete-id="' + log.athlete_id + '"]');
  if (card) {
    const rEl = card.querySelector('.card-rpe-val');
    const fEl = card.querySelector('.card-feel-val');
    if (rEl  && log.rpe_value     != null) rEl.textContent  = log.rpe_value;
    if (fEl  && log.feeling_score != null) fEl.textContent  = log.feeling_score;
    card.classList.add('realtime-flash');
    setTimeout(() => card.classList.remove('realtime-flash'), 1200);
  }

  const name = card?.querySelector('.card-name')?.textContent ?? 'ספורטאי';
  const rpe  = log.rpe_value    ?? '?';
  const feel = log.feeling_score ?? '?';
  showToast('📊 ' + name + ' דיווח — RPE: ' + rpe + ' | תחושה: ' + feel);

  if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification('RightPace ⚡', {
      body: name + ' דיווח: RPE ' + rpe + ', תחושה ' + feel,
      icon: '/icon-192.png',
      dir:  'rtl',
    });
  }
}

async function requestNotificationPermission() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}


// ─── SECTION 21: TOAST NOTIFICATIONS ─────────────────────────────────────────
function showToast(message, type, duration) {
  type     = type     || 'info';
  duration = duration || 4000;

  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, duration);
}


// ─── SECTION 22: PRINT / PDF COACH REPORT ────────────────────────────────────
async function printCoachReport(roster, weekOffset) {
  weekOffset = weekOffset || 0;
  const weekStart   = getWeekStartByOffset(weekOffset);
  const weekLabel   = formatWeekRange(weekStart);
  const scheduleMap = await fetchSchedulesForWeek(weekStart);

  const rows = roster.map(a => {
    const load = scheduleMap[a.athlete_id]?.target_load ?? null;
    const disc = (a.latestRPE && load)
      ? computeRPEDiscrepancy(load, a.latestRPE) : null;
    return `<tr>
      <td>${a.full_name}</td>
      <td>${translateLoad(load)}</td>
      <td>${a.latestRPE ?? '—'}</td>
      <td>${a.latestFeeling ?? '—'}</td>
      <td>${disc ? disc.badge.icon + ' ' + disc.badge.label : '—'}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8"/>
  <title>דוח מאמן — ${weekLabel}</title>
  <style>
    body { font-family: Arial, sans-serif; direction: rtl; padding: 24px; color: #111; }
    h1   { font-size: 20px; margin-bottom: 4px; }
    p    { color: #555; font-size: 13px; margin: 0 0 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: right; }
    th { background: #f5f5f5; font-weight: 600; }
    tr:nth-child(even) { background: #fafafa; }
    @media print { button { display: none; } }
  </style>
</head>
<body>
  <h1>RightPace ⚡ — דוח מאמן</h1>
  <p>שבוע: ${weekLabel} | קבוצה: ${currentTeam?.name ?? ''} | הודפס: ${new Date().toLocaleDateString('he-IL')}</p>
  <table>
    <thead>
      <tr><th>שם ספורטאי</th><th>עומס מטרה</th><th>RPE</th><th>תחושה</th><th>סטטוס</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) { showToast('אפשר חלונות קופצים בדפדפן', 'error'); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}
