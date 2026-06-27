// =============================================================================
// RightPace — Core Application Engine  (app.js)
// Version: 2.0.0-production
// Architecture: Multi-tenant teams, self-registration, 2-slider daily report,
//               Chart.js visualizations, LWW sync, XOR obfuscation
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// SECTION 0: SUPABASE CLIENT
// ---------------------------------------------------------------------------
const SUPABASE_URL  = window.__ENV__?.SUPABASE_URL  || 'https://ffamagrtdgsoqaxebtgt.supabase.co';
const SUPABASE_ANON = window.__ENV__?.SUPABASE_ANON || 'sb_publishable_dH032jxsVjDT4L-n4Ph-8Q_l_h-CtGe';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);


// =============================================================================
// SECTION 1: SECURITY — Runtime DEV PANEL DESTRUCTION
// =============================================================================
(function enforceProductionHardening() {
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';
  if (!isLocal) {
    document.getElementById('dev-panel')?.remove();
    console.warn('[SECURITY] Dev panel destroyed. Host:', host);
  }
})();


// =============================================================================
// SECTION 2: XOR OBFUSCATION STORAGE UTILITY
// =============================================================================
const XOR_KEY = 'RIGHTPACE-2025-SECURE-KEY';

function encryptData(plaintext) {
  if (typeof plaintext !== 'string') plaintext = JSON.stringify(plaintext);
  let result = '';
  for (let i = 0; i < plaintext.length; i++) {
    result += String.fromCharCode(plaintext.charCodeAt(i) ^ XOR_KEY.charCodeAt(i % XOR_KEY.length));
  }
  return btoa(unescape(encodeURIComponent(result)));
}

function decryptData(ciphertext) {
  try {
    const decoded = decodeURIComponent(escape(atob(ciphertext)));
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ XOR_KEY.charCodeAt(i % XOR_KEY.length));
    }
    try { return JSON.parse(result); } catch { return result; }
  } catch { return null; }
}

function setCache(key, value) {
  try { localStorage.setItem(`mpz::${key}`, encryptData(value)); } catch { /* quota */ }
}
function getCache(key) {
  const raw = localStorage.getItem(`mpz::${key}`);
  return raw ? decryptData(raw) : null;
}
function clearCache(key) { localStorage.removeItem(`mpz::${key}`); }
function clearAllCache() {
  Object.keys(localStorage).filter(k => k.startsWith('mpz::')).forEach(k => localStorage.removeItem(k));
}


// =============================================================================
// SECTION 3: LAST-WRITE-WINS CONFLICT RESOLUTION
// =============================================================================
function mergeLastWriteWins(local, remote) {
  if (!local && !remote) return null;
  if (!local) return remote;
  if (!remote) return local;
  const localTs  = local.updated_at  ? new Date(local.updated_at).getTime()  : 0;
  const remoteTs = remote.updated_at ? new Date(remote.updated_at).getTime() : 0;
  return remoteTs >= localTs ? remote : local;
}

function mergeRecordSets(localArr = [], remoteArr = []) {
  const map = new Map();
  for (const r of localArr)  map.set(r.id, r);
  for (const r of remoteArr) map.set(r.id, mergeLastWriteWins(map.get(r.id), r));
  return Array.from(map.values());
}


// =============================================================================
// SECTION 4: RPE LOAD DISCREPANCY ENGINE
// =============================================================================
const LOAD_LEVELS    = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const RPE_BUCKET_MAP = { 1:1,2:1,3:1, 4:2,5:2,6:2,7:2, 8:3,9:3,10:3 };
const TARGET_MAP     = { low:1, medium:2, high:3 };
const DISC_STATUS    = {
  GREEN:   { css:'status-green',  icon:'🟢', label:'יישור מושלם',                    severity:0 },
  YELLOW:  { css:'status-yellow', icon:'🟡', label:'סטייה — שים לב',                severity:1 },
  RED:     { css:'status-red',    icon:'🔴', label:'סטייה קריטית — התערבות מיידית', severity:2 },
  PENDING: { css:'status-grey',   icon:'⏳', label:'ממתין לדיווח',                   severity:-1 },
  UNKNOWN: { css:'status-grey',   icon:'❓', label:'נתונים חסרים',                   severity:-1 },
};

function computeRPEDiscrepancy(targetLoad, rpeValue) {
  const target  = TARGET_MAP[targetLoad?.toLowerCase()];
  const athlete = RPE_BUCKET_MAP[parseInt(rpeValue, 10)];
  if (target === undefined || athlete === undefined)
    return { status:'UNKNOWN', badge: DISC_STATUS.UNKNOWN, variance: null };
  const variance = Math.abs(target - athlete);
  const status = variance === 0 ? 'GREEN' : variance === 1 ? 'YELLOW' : 'RED';
  return { status, badge: DISC_STATUS[status], variance, target, athlete };
}

function evaluateRoster(rosterData) {
  return rosterData.map(entry => ({
    ...entry,
    discrepancy: (entry.latestRPE != null && entry.targetLoad)
      ? computeRPEDiscrepancy(entry.targetLoad, entry.latestRPE)
      : { status:'PENDING', badge: DISC_STATUS.PENDING, variance: null },
  }));
}

// =============================================================================
// PHASE B DATE HELPERS — Multi-week planning
// =============================================================================

// Returns ISO week-start (Monday) for current week + optional offset in weeks
function getWeekStartByOffset(offsetWeeks = 0) {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diffToMonday + (offsetWeeks * 7));
  return d.toISOString().split('T')[0];
}

// Human-readable date range for a week: "16/6 – 22/6"
function formatWeekRange(weekStartISO) {
  const start = new Date(weekStartISO);
  const end   = new Date(weekStartISO);
  end.setDate(end.getDate() + 6);
  const fmt = d => d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}

// Week label for tabs — supports -4 to +3
function weekTabLabel(offset) {
  if (offset === -4) return '4 שבועות לפני';
  if (offset === -3) return '3 שבועות לפני';
  if (offset === -2) return 'לפני שבועיים';
  if (offset === -1) return 'שבוע שעבר';
  if (offset ===  0) return 'שבוע זה';
  if (offset ===  1) return 'שבוע הבא';
  if (offset ===  2) return 'עוד שבועיים';
  if (offset ===  3) return 'עוד 3 שבועות';
  return `${offset > 0 ? '+' : ''}${offset}w`;
}

// Fetch all schedules for a team for a specific week
async function fetchSchedulesForWeek(weekStart) {
  if (!currentProfile?.team_id) return {};
  // Get athlete IDs from team
  const { data: profiles } = await _supabase.from('profiles')
    .select('id').eq('team_id', currentProfile.team_id).eq('role', 'athlete').eq('status', 'active');
  if (!profiles?.length) return {};

  const athleteIds = profiles.map(p => p.id);
  const { data } = await _supabase.from('schedules')
    .select('athlete_id,target_load,notes')
    .in('athlete_id', athleteIds).eq('week_start', weekStart);

  const map = {};
  (data || []).forEach(s => { map[s.athlete_id] = s; });
  return map;
}

// Bulk save for a specific week (multi-week planner)
async function bulkUpsertSchedulesForWeek(loadMap, weekStart) {
  const rows = Object.entries(loadMap).map(([athleteId, load]) => ({
    athlete_id: athleteId, staff_id: currentProfile.id,
    week_start: weekStart, target_load: load,
  }));
  if (!rows.length) return true;
  const { error } = await _supabase.from('schedules')
    .upsert(rows, { onConflict: 'athlete_id,staff_id,week_start' });
  if (error) console.error('[SCHEDULE BULK WEEK]', error.message);
  return !error;
}

// Season goals — stored as core_focus with discipline='coach', title='SEASON_GOAL'
async function fetchSeasonGoal(athleteId) {
  const { data } = await _supabase.from('core_focus')
    .select('*').eq('athlete_id', athleteId).eq('discipline', 'coach')
    .ilike('title', 'SEASON_GOAL%')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data;
}

async function saveSeasonGoal(athleteId, goalText) {
  // Delete old season goal first
  await _supabase.from('core_focus')
    .delete().eq('athlete_id', athleteId).eq('discipline', 'coach')
    .eq('staff_id', currentProfile.id).ilike('title', 'SEASON_GOAL%');

  if (!goalText.trim()) return null;
  const { data, error } = await _supabase.from('core_focus').insert({
    staff_id:    currentProfile.id,
    athlete_id:  athleteId,
    title:       'SEASON_GOAL',
    description: goalText.trim(),
    discipline:  'coach',
    week_start:  getWeekStartByOffset(0),
  }).select().single();
  if (error) { console.error('[SEASON GOAL]', error.message); return null; }
  return data;
}

// =============================================================================
// SECTION 5: AUTH STATE
// =============================================================================
let currentUser    = null;
let currentProfile = null;
let currentTeam    = null;

async function loadCurrentProfile() {
  const { data: { user }, error } = await _supabase.auth.getUser();
  if (error || !user) return null;
  currentUser = user;

  // Layer 1: ensure profile row exists — handles ALL creation edge cases
  // (dashboard users, trigger failures, API-created users, etc.)
  await _supabase.rpc('ensure_profile');

  const cached = getCache(`profile:${user.id}`);
  const { data: remote } = await _supabase
    .from('profiles').select('*').eq('id', user.id).maybeSingle();

  const winner = mergeLastWriteWins(cached, remote);
  if (winner) {
    setCache(`profile:${user.id}`, winner);
    currentProfile = winner;
  }

  // Layer 2: load team if linked
  if (winner?.team_id) {
    const { data: team } = await _supabase
      .from('teams').select('*').eq('id', winner.team_id).single();
    if (team) currentTeam = team;
  }

  return winner;
}

async function signOut() {
  clearAllCache();
  currentUser = currentProfile = currentTeam = null;
  _routingInProgress = false;
  await _supabase.auth.signOut();
  renderView('auth');
}


// =============================================================================
// SECTION 6: DATA ACCESS LAYER
// =============================================================================

async function fetchCurrentSchedule(athleteId) {
  const weekStart = getWeekStartISO();
  const key = `schedule:${athleteId}:${weekStart}`;
  const cached = getCache(key);

  const { data } = await _supabase.from('schedules')
    .select('*').eq('athlete_id', athleteId).eq('week_start', weekStart)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();

  const winner = mergeLastWriteWins(cached, data);
  if (winner) setCache(key, winner);
  return winner;
}

async function fetchTodayRPE(athleteId) {
  const today = getTodayISO();
  const key = `rpe:${athleteId}:${today}`;
  const cached = getCache(key);

  const { data } = await _supabase.from('rpe_logs').select('*')
    .eq('athlete_id', athleteId).eq('log_date', today).maybeSingle();

  const winner = mergeLastWriteWins(cached, data);
  if (winner) setCache(key, winner);
  return winner;
}

async function upsertDailyReport(athleteId, rpeValue, feelingScore, notes = '') {
  const today = getTodayISO();
  const payload = {
    athlete_id:    athleteId,
    log_date:      today,
    rpe_value:     parseInt(rpeValue, 10),
    feeling_score: parseInt(feelingScore, 10),
    notes,
  };

  const { data, error } = await _supabase.from('rpe_logs')
    .upsert(payload, { onConflict: 'athlete_id,log_date' }).select().single();

  if (error) { console.error('[RPE] Upsert:', error.message); return null; }
  setCache(`rpe:${athleteId}:${today}`, data);
  return data;
}

async function fetchRPEHistory(athleteId, days = 7) {
  const key = `rpe-hist:${athleteId}:${days}`;
  const cached = getCache(key) || [];

  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  const sinceISO = since.toISOString().split('T')[0];

  const { data } = await _supabase.from('rpe_logs').select('log_date,rpe_value,feeling_score')
    .eq('athlete_id', athleteId).gte('log_date', sinceISO)
    .order('log_date', { ascending: true });

  const merged = mergeRecordSets(cached, data || []);
  setCache(key, merged);
  return merged;
}

async function fetchDailyTasks(athleteId, dateISO = getTodayISO()) {
  const key = `tasks:${athleteId}:${dateISO}`;
  const cached = getCache(key) || [];

  const { data } = await _supabase.from('daily_tasks').select('*')
    .eq('athlete_id', athleteId).eq('task_date', dateISO)
    .order('created_at', { ascending: true });

  const merged = mergeRecordSets(cached, data || []);
  setCache(key, merged);
  return merged;
}

async function toggleTask(taskId, isCompleted) {
  const { data, error } = await _supabase.from('daily_tasks')
    .update({ is_completed: isCompleted }).eq('id', taskId).select().single();
  if (error) console.error('[TASKS] Toggle:', error.message);
  return data;
}

async function addCustomTask(athleteId, title, discipline = 'personal') {
  const { data, error } = await _supabase.from('daily_tasks').insert({
    athlete_id: athleteId, task_date: getTodayISO(),
    discipline, title, is_completed: false, source: 'athlete',
  }).select().single();
  if (error) { console.error('[TASKS] Insert:', error.message); return null; }
  return data;
}

async function fetchCoreFocus(athleteId) {
  const weekStart = getWeekStartISO();
  const key = `focus:${athleteId}:${weekStart}`;
  const cached = getCache(key) || [];

  const { data } = await _supabase.from('core_focus')
    .select('*, staff:profiles!core_focus_staff_id_fkey(full_name, role)')
    .eq('athlete_id', athleteId).eq('week_start', weekStart)
    .order('discipline', { ascending: true });

  const merged = mergeRecordSets(cached, data || []);
  setCache(key, merged);
  return merged;
}

async function fetchTeamRoster() {
  if (!currentProfile?.team_id) return [];
  const today     = getTodayISO();
  const weekStart = getWeekStartISO();

  const { data: athletes, error } = await _supabase.from('profiles')
    .select('id, full_name, avatar_url')
    .eq('team_id', currentProfile.team_id)
    .eq('role', 'athlete')
    .eq('status', 'active');

  if (error || !athletes) return [];

  // Batch-fetch today's RPE and current week schedule for each athlete
  const athleteIds = athletes.map(a => a.id);

  const [{ data: rpeToday }, { data: schedules }] = await Promise.all([
    _supabase.from('rpe_logs').select('athlete_id,rpe_value,feeling_score')
      .in('athlete_id', athleteIds).eq('log_date', today),
    _supabase.from('schedules').select('athlete_id,target_load')
      .in('athlete_id', athleteIds).eq('week_start', weekStart),
  ]);

  const rpeMap      = new Map((rpeToday     || []).map(r => [r.athlete_id, r]));
  const scheduleMap = new Map((schedules    || []).map(s => [s.athlete_id, s]));

  return evaluateRoster(athletes.map(a => ({
    athlete_id:  a.id,
    full_name:   a.full_name,
    avatar_url:  a.avatar_url,
    targetLoad:  scheduleMap.get(a.id)?.target_load ?? null,
    latestRPE:   rpeMap.get(a.id)?.rpe_value ?? null,
    latestFeeling: rpeMap.get(a.id)?.feeling_score ?? null,
  })));
}

async function fetchPendingMembers() {
  if (!currentProfile?.is_team_admin || !currentProfile?.team_id) return [];
  const { data } = await _supabase.from('profiles')
    .select('id, full_name, email, role')
    .eq('team_id', currentProfile.team_id)
    .eq('status', 'pending');
  return data || [];
}

async function upsertSchedule(athleteId, targetLoad, notes = '') {
  const weekStart = getWeekStartISO();
  const { data, error } = await _supabase.from('schedules').upsert({
    athlete_id:  athleteId,
    staff_id:    currentProfile.id,
    week_start:  weekStart,
    target_load: targetLoad,
    notes,
  }, { onConflict: 'athlete_id,staff_id,week_start' }).select().single();

  if (error) { console.error('[SCHEDULE] Upsert:', error.message); return null; }
  setCache(`schedule:${athleteId}:${weekStart}`, data);
  return data;
}

// Bulk update target_load for multiple athletes at once (coach weekly planner)
async function bulkUpsertSchedules(loadMap) {
  const weekStart = getWeekStartISO();
  const rows = Object.entries(loadMap).map(([athleteId, load]) => ({
    athlete_id: athleteId, staff_id: currentProfile.id,
    week_start: weekStart, target_load: load,
  }));
  const { error } = await _supabase.from('schedules')
    .upsert(rows, { onConflict: 'athlete_id,staff_id,week_start' });
  if (error) console.error('[SCHEDULE BULK]', error.message);
  return !error;
}

// Fetch RPE history over N weeks (for periodization chart)
async function fetchRPEHistoryWeeks(athleteId, weeks = 8) {
  const since = new Date();
  since.setDate(since.getDate() - (weeks * 7));
  const sinceISO = since.toISOString().split('T')[0];
  const { data } = await _supabase.from('rpe_logs')
    .select('log_date,rpe_value,feeling_score')
    .eq('athlete_id', athleteId).gte('log_date', sinceISO)
    .order('log_date', { ascending: true });
  return data || [];
}

// Fetch team RPE history for all athletes (periodization overview)
async function fetchTeamRPEHistoryWeeks(athleteIds, weeks = 8) {
  const since = new Date();
  since.setDate(since.getDate() - (weeks * 7));
  const { data } = await _supabase.from('rpe_logs')
    .select('athlete_id,log_date,rpe_value,feeling_score')
    .in('athlete_id', athleteIds).gte('log_date', since.toISOString().split('T')[0])
    .order('log_date', { ascending: true });
  return data || [];
}

// Staff private notes
async function fetchPrivateNotes(athleteId) {
  const { data } = await _supabase.from('staff_private_notes')
    .select('*').eq('staff_id', currentProfile.id).eq('athlete_id', athleteId)
    .order('note_date', { ascending: false });
  return data || [];
}

async function insertPrivateNote(athleteId, content, sensitivity = 'confidential') {
  const { data, error } = await _supabase.from('staff_private_notes').insert({
    staff_id:   currentProfile.id,
    athlete_id: athleteId,
    content,
    sensitivity,
    discipline: roleToDiscipline(currentProfile.role),
    note_date:  getTodayISO(),
  }).select().single();
  if (error) { console.error('[NOTES]', error.message); return null; }
  return data;
}

// Staff logs (visible to athlete)
async function insertStaffLog(athleteId, content, discipline) {
  const { data, error } = await _supabase.from('staff_logs').insert({
    staff_id:   currentProfile.id,
    athlete_id: athleteId,
    content,
    discipline: discipline || roleToDiscipline(currentProfile.role),
    log_date:   getTodayISO(),
  }).select().single();
  if (error) { console.error('[STAFF LOG]', error.message); return null; }
  return data;
}

// Core focus directive
async function insertCoreFocus(athleteId, title, description, discipline) {
  const { data, error } = await _supabase.from('core_focus').insert({
    staff_id:   currentProfile.id,
    athlete_id: athleteId,
    title,
    description,
    discipline: discipline || roleToDiscipline(currentProfile.role),
    week_start: getWeekStartISO(),
  }).select().single();
  if (error) { console.error('[FOCUS]', error.message); return null; }
  return data;
}

// Fetch staff logs per athlete by this staff member
async function fetchMyStaffLogs(athleteId) {
  const { data } = await _supabase.from('staff_logs')
    .select('*').eq('staff_id', currentProfile.id).eq('athlete_id', athleteId)
    .order('log_date', { ascending: false }).limit(20);
  return data || [];
}

// Fetch fitness tasks assigned to an athlete
async function fetchFitnessTasks(athleteId, dateISO = getTodayISO()) {
  const { data } = await _supabase.from('daily_tasks').select('*')
    .eq('athlete_id', athleteId).eq('task_date', dateISO).eq('discipline', 'fitness')
    .order('created_at', { ascending: true });
  return data || [];
}

async function assignFitnessTask(athleteId, title, dateISO = getTodayISO()) {
  const { data, error } = await _supabase.from('daily_tasks').insert({
    athlete_id: athleteId, task_date: dateISO,
    discipline: 'fitness', title, is_completed: false, source: 'system',
  }).select().single();
  if (error) { console.error('[TASK]', error.message); return null; }
  return data;
}

// =============================================================================
// SECTION 7: VIEW ROUTER
// =============================================================================
const ROLE_VIEWS = {
  auth:          renderAuthView,
  pending:       renderPendingView,
  email_confirm: renderEmailConfirmView,
  team_setup:    renderTeamSetupView,
  team_manager:  renderTeamManagerView,
  coach:         renderCoachView,
  psychologist:  renderPsychologistView,
  nutritionist:  renderNutritionistView,
  fitness_coach: renderFitnessCoachView,
  athlete:       renderAthleteView,
};

function renderView(role) {
  // Hide splash screen on every view transition
  const splash = document.getElementById('splash-screen');
  if (splash) splash.classList.add('hidden');
  const fn = ROLE_VIEWS[role];
  if (!fn) { console.error('[ROUTER] Unknown role:', role); return; }
  fn();
}

// Guard: prevents double-routing when both getSession + onAuthStateChange fire
let _routingInProgress = false;
let _profileLoaded     = false;   // true once a profile has been successfully routed

function routeByProfile(profile) {
  _routingInProgress = false;  // clear — routing is happening now
  _profileLoaded     = true;

  // Always hide splash screen regardless of auth result
  const splash = document.getElementById('splash-screen');
  if (splash) splash.classList.add('hidden');

  if (!profile)                      { renderView('auth');       return; }
  if (profile.status === 'pending')  { renderView('pending');    return; }
  if (!profile.team_id)              { renderView('team_setup'); return; }
  renderView(profile.role);
}

// Email confirmation pending view
function renderEmailConfirmView() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="auth-container glass-card">
      <div class="pending-icon">📧</div>
      <h2 class="pending-title">אשר את האימייל שלך</h2>
      <p class="pending-text">שלחנו לך קישור אימות לאימייל.<br/>לאחר האישור חזור לדף זה והתחבר.</p>
      <p class="pending-name" style="font-size:0.85rem;color:var(--text-muted);margin-top:1rem;">
        לחלופין: השבת אישור אימייל ב-Supabase Dashboard →<br/>
        Authentication → Email → בטל "Confirm email"
      </p>
      <button class="btn btn-primary btn-full" style="margin-top:1.5rem" id="back-to-login">חזור להתחברות</button>
    </div>
  `;
  document.getElementById('back-to-login').addEventListener('click', () => renderView('auth'));
}

// Team setup — shown when user is authenticated but has no team yet
// Covers: dashboard users, failed registrations, any edge case
function renderTeamSetupView() {
  const root = document.getElementById('app-root');
  const role = currentProfile?.role ?? 'athlete';
  const isCreator = role === 'team_manager' || role === 'coach';

  root.innerHTML = `
    <div class="auth-container glass-card">
      <div class="auth-logo">
        <div class="logo-icon">⚡</div>
        <h2 class="auth-title">ברוך הבא${currentProfile?.full_name ? ', ' + currentProfile.full_name.split(' ')[0] : ''}!</h2>
        <p class="auth-subtitle">צעד אחד נוסף — חיבור לקבוצה</p>
      </div>

      <div class="form-group">
        <label class="form-label">תפקיד שלי</label>
        <select id="setup-role" class="form-input form-select">
          <option value="team_manager" ${role === 'team_manager' ? 'selected' : ''}>👑 מנהל קבוצה</option>
          <option value="coach"        ${role === 'coach'        ? 'selected' : ''}>🏆 מאמן ראשי</option>
          <option value="athlete"      ${role === 'athlete'      ? 'selected' : ''}>🏅 ספורטאי</option>
          <option value="psychologist" ${role === 'psychologist' ? 'selected' : ''}>🧠 פסיכולוג ספורט</option>
          <option value="nutritionist" ${role === 'nutritionist' ? 'selected' : ''}>🥗 תזונאי</option>
          <option value="fitness_coach"${role === 'fitness_coach'? 'selected' : ''}>💪 מאמן כושר</option>
        </select>
      </div>

      <div id="setup-create-field" class="form-group ${isCreator ? '' : 'hidden'}">
        <label class="form-label">שם הקבוצה (יוצרים קבוצה חדשה)</label>
        <input type="text" id="setup-team-name" class="form-input" placeholder="עירוני גבעתיים U18" maxlength="60" />
        <span class="form-hint">קוד הקבוצה ייוצר אוטומטית</span>
      </div>

      <div id="setup-join-field" class="form-group ${!isCreator ? '' : 'hidden'}">
        <label class="form-label">קוד קבוצה (מתקבל מהמנהל)</label>
        <input type="text" id="setup-team-code" class="form-input code-input" placeholder="ABC123" maxlength="6" />
      </div>

      <div id="setup-error" class="auth-error hidden"></div>
      <button class="btn btn-primary btn-full" id="setup-submit">כנס למערכת →</button>
      <button class="btn btn-ghost" id="setup-signout" style="margin-top:0.5rem">התנתק</button>
    </div>
  `;

  // Role change → toggle fields
  document.getElementById('setup-role').addEventListener('change', (e) => {
    const r = e.target.value;
    const creator = r === 'team_manager' || r === 'coach';
    document.getElementById('setup-create-field').classList.toggle('hidden', !creator);
    document.getElementById('setup-join-field').classList.toggle('hidden', creator);
  });

  document.getElementById('setup-team-code')?.addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase();
  });

  document.getElementById('setup-signout').addEventListener('click', signOut);

  document.getElementById('setup-submit').addEventListener('click', async () => {
    const selectedRole = document.getElementById('setup-role').value;
    const isCreatorRole = selectedRole === 'team_manager' || selectedRole === 'coach';
    const teamName = document.getElementById('setup-team-name')?.value.trim();
    const teamCode = document.getElementById('setup-team-code')?.value.trim().toUpperCase();
    const errEl   = document.getElementById('setup-error');
    const btn     = document.getElementById('setup-submit');

    errEl.classList.add('hidden');

    if (isCreatorRole && !teamName) {
      errEl.textContent = 'יש להזין שם קבוצה.'; errEl.classList.remove('hidden'); return;
    }
    if (!isCreatorRole && !teamCode) {
      errEl.textContent = 'יש להזין קוד קבוצה.'; errEl.classList.remove('hidden'); return;
    }

    btn.disabled = true; btn.textContent = 'מחבר...';

    // Update role in profile if it changed
    if (selectedRole !== currentProfile?.role) {
      await _supabase.from('profiles')
        .update({ role: selectedRole }).eq('id', currentProfile.id);
    }

    let result;
    if (isCreatorRole) {
      const { data } = await _supabase.rpc('create_team', { p_team_name: teamName });
      result = data;
    } else {
      const { data } = await _supabase.rpc('join_team', { p_code: teamCode });
      result = data;
    }

    if (result?.error) {
      errEl.textContent = result.error;
      errEl.classList.remove('hidden');
      btn.disabled = false; btn.textContent = 'כנס למערכת →';
      return;
    }

    // Creator → show team code reveal screen
    if (isCreatorRole && result?.code) {
      renderTeamCodeReveal(result.code, result.team_name);
      return;
    }

    // Reload profile and route
    _routingInProgress = false;
    const profile = await loadCurrentProfile();
    routeByProfile(profile);
  });
}

// =============================================================================
// PASSWORD RESET VIEW — shown when user clicks the email reset link
// =============================================================================
function renderPasswordResetView() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="auth-container glass-card">
      <div class="auth-logo">
        <div class="logo-icon">🔑</div>
        <h1 class="auth-title">הגדר סיסמא חדשה</h1>
        <p class="auth-subtitle">הזן סיסמא חדשה עבור החשבון שלך</p>
      </div>
      <div style="padding: var(--sp-lg) 0;">
        <div class="form-group">
          <label class="form-label" for="new-pw">סיסמא חדשה</label>
          <input type="password" id="new-pw" class="form-input" placeholder="לפחות 6 תווים" minlength="6" />
        </div>
        <div class="form-group">
          <label class="form-label" for="new-pw-confirm">אימות סיסמא</label>
          <input type="password" id="new-pw-confirm" class="form-input" placeholder="חזור על הסיסמא" />
        </div>
        <div id="new-pw-error" class="auth-error hidden"></div>
        <button class="btn btn-primary btn-full" id="new-pw-btn">
          <span id="new-pw-btn-text">שמור סיסמא חדשה</span>
          <span id="new-pw-spinner" class="spinner hidden"></span>
        </button>
      </div>
    </div>
  `;
  document.getElementById('new-pw-btn').addEventListener('click', async () => {
    const pw1   = document.getElementById('new-pw').value;
    const pw2   = document.getElementById('new-pw-confirm').value;
    const errEl = document.getElementById('new-pw-error');
    errEl.classList.add('hidden');
    if (pw1.length < 6) { errEl.textContent = 'הסיסמא חייבת להכיל לפחות 6 תווים'; errEl.classList.remove('hidden'); return; }
    if (pw1 !== pw2)    { errEl.textContent = 'הסיסמאות אינן תואמות'; errEl.classList.remove('hidden'); return; }
    setLoading('new-pw-btn', 'new-pw-btn-text', 'new-pw-spinner', true);
    const { error } = await _supabase.auth.updateUser({ password: pw1 });
    setLoading('new-pw-btn', 'new-pw-btn-text', 'new-pw-spinner', false);
    if (error) {
      errEl.textContent = error.message || 'שגיאה — נסה שוב';
      errEl.classList.remove('hidden');
    } else {
      const profile = await loadCurrentProfile();
      routeByProfile(profile);
    }
  });
}

// =============================================================================
// SECTION 8: AUTH VIEW — Login + Register tabs
// =============================================================================
function renderAuthView() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="auth-container glass-card">
      <div class="auth-logo">
        <div class="logo-icon">⚡</div>
        <h1 class="auth-title">RightPace</h1>
        <p class="auth-subtitle">מערכת ביצועים לספורטאי עילית</p>
      </div>

      <div class="auth-tabs">
        <button class="auth-tab active" id="tab-login"  data-tab="login">כניסה</button>
        <button class="auth-tab"        id="tab-register" data-tab="register">הרשמה</button>
      </div>

      <!-- LOGIN PANEL -->
      <div id="panel-login" class="auth-panel">
        <form id="login-form" class="auth-form" novalidate>
          <div class="form-group">
            <label class="form-label" for="login-email">אימייל</label>
            <input type="email" id="login-email" class="form-input" placeholder="name@example.com" required />
          </div>
          <div class="form-group">
            <label class="form-label" for="login-password">סיסמה</label>
            <input type="password" id="login-password" class="form-input" placeholder="••••••••" required />
          </div>
          <div id="login-error" class="auth-error hidden"></div>
          <button type="submit" class="btn btn-primary btn-full" id="login-btn">
            <span id="login-btn-text">כניסה למערכת</span>
            <span id="login-spinner" class="spinner hidden"></span>
          </button>
          <div style="text-align:center; margin-top: var(--sp-sm);">
            <button type="button" id="forgot-pw-btn" class="link-btn">שכחתי סיסמה</button>
          </div>
        </form>

        <!-- Forgot-password inline panel (hidden by default) -->
        <div id="forgot-pw-panel" class="hidden" style="margin-top: var(--sp-lg);">
          <p style="font-size:var(--fs-sm); color:var(--text-secondary); margin-bottom:var(--sp-sm);">
            הזן את האימייל שלך ונשלח לך קישור לאיפוס סיסמה
          </p>
          <div class="form-group">
            <input type="email" id="reset-email" class="form-input" placeholder="name@example.com" />
          </div>
          <div id="reset-error" class="auth-error hidden"></div>
          <button class="btn btn-primary btn-full" id="reset-send-btn">שלח קישור</button>
          <div id="reset-success" class="hidden" style="color:var(--status-green); font-size:var(--fs-sm); text-align:center; margin-top:var(--sp-sm);">
            ✅ שלחנו! בדוק את תיבת הדואר שלך
          </div>
        </div>
      </div>

      <!-- REGISTER PANEL -->
      <div id="panel-register" class="auth-panel hidden">
        <form id="register-form" class="auth-form" novalidate>
          <div class="form-group">
            <label class="form-label" for="reg-name">שם מלא</label>
            <input type="text" id="reg-name" class="form-input" placeholder="ישראל ישראלי" required />
          </div>
          <div class="form-group">
            <label class="form-label" for="reg-email">אימייל</label>
            <input type="email" id="reg-email" class="form-input" placeholder="name@example.com" required />
          </div>
          <div class="form-group">
            <label class="form-label" for="reg-password">סיסמה (מינימום 6 תווים)</label>
            <input type="password" id="reg-password" class="form-input" placeholder="••••••••" required minlength="6" />
          </div>
          <div class="form-group">
            <label class="form-label" for="reg-role">תפקיד</label>
            <select id="reg-role" class="form-input form-select" required>
              <option value="">— בחר תפקיד —</option>
              <option value="team_manager">👑 מנהל קבוצה</option>
              <option value="coach">🏆 מאמן ראשי</option>
              <option value="athlete">🏅 ספורטאי</option>
              <option value="psychologist">🧠 פסיכולוג ספורט</option>
              <option value="nutritionist">🥗 תזונאי</option>
              <option value="fitness_coach">💪 מאמן כושר</option>
            </select>
          </div>

          <!-- Conditional: team_manager/coach = create team, else = join team -->
          <div id="team-create-field" class="form-group hidden">
            <label class="form-label" for="reg-team-name">שם הקבוצה (יוצרים קבוצה חדשה)</label>
            <input type="text" id="reg-team-name" class="form-input" placeholder="עירוני גבעתיים U18" maxlength="60" />
            <span class="form-hint">קוד הקבוצה ייוצר אוטומטית ויוצג לך לאחר ההרשמה</span>
          </div>
          <div id="team-join-field" class="form-group hidden">
            <label class="form-label" for="reg-team-code">קוד קבוצה (מתקבל מהמנהל/מאמן)</label>
            <input type="text" id="reg-team-code" class="form-input code-input" placeholder="ABC123" maxlength="6" />
          </div>

          <div id="register-error" class="auth-error hidden"></div>
          <button type="submit" class="btn btn-primary btn-full" id="register-btn">
            <span id="register-btn-text">הרשמה</span>
            <span id="register-spinner" class="spinner hidden"></span>
          </button>
        </form>
      </div>
    </div>
  `;

  // Tab switching
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.auth-panel').forEach(p => p.classList.add('hidden'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.tab}`).classList.remove('hidden');
    });
  });

  // Role selection: show/hide team fields
  document.getElementById('reg-role').addEventListener('change', (e) => {
    const role = e.target.value;
    const isCreator = role === 'team_manager' || role === 'coach';
    document.getElementById('team-create-field').classList.toggle('hidden', !isCreator);
    document.getElementById('team-join-field').classList.toggle('hidden',  isCreator || !role);
  });

  // Team code → uppercase
  document.getElementById('reg-team-code')?.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  // FORGOT PASSWORD — toggle panel
  document.getElementById('forgot-pw-btn').addEventListener('click', () => {
    const panel = document.getElementById('forgot-pw-panel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      const loginEmail = document.getElementById('login-email').value.trim();
      if (loginEmail) document.getElementById('reset-email').value = loginEmail;
      document.getElementById('reset-email').focus();
    }
  });

  // FORGOT PASSWORD — send reset email
  document.getElementById('reset-send-btn').addEventListener('click', async () => {
    const email = document.getElementById('reset-email').value.trim();
    const errEl = document.getElementById('reset-error');
    const okEl  = document.getElementById('reset-success');
    errEl.classList.add('hidden');
    okEl.classList.add('hidden');
    if (!email) { errEl.textContent = 'יש להזין אימייל'; errEl.classList.remove('hidden'); return; }
    const btn = document.getElementById('reset-send-btn');
    btn.disabled = true; btn.textContent = 'שולח...';
    const { error } = await _supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/?reset=1',
    });
    btn.disabled = false; btn.textContent = 'שלח קישור';
    if (error) {
      errEl.textContent = error.message || 'שגיאה — נסה שוב';
      errEl.classList.remove('hidden');
    } else {
      okEl.classList.remove('hidden');
    }
  });

  // LOGIN
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl    = document.getElementById('login-error');
    setLoading('login-btn', 'login-btn-text', 'login-spinner', true);
    errEl.classList.add('hidden');

    const { error } = await _supabase.auth.signInWithPassword({ email, password });
    setLoading('login-btn', 'login-btn-text', 'login-spinner', false);

    if (error) {
      errEl.textContent = 'כניסה נכשלה. בדוק אימייל וסיסמה.';
      errEl.classList.remove('hidden');
      return;
    }

    const profile = await loadCurrentProfile();
    routeByProfile(profile);
  });

  // REGISTER
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullName  = document.getElementById('reg-name').value.trim();
    const email     = document.getElementById('reg-email').value.trim();
    const password  = document.getElementById('reg-password').value;
    const role      = document.getElementById('reg-role').value;
    const teamName  = document.getElementById('reg-team-name').value.trim();
    const teamCode  = document.getElementById('reg-team-code').value.trim().toUpperCase();
    const errEl     = document.getElementById('register-error');

    errEl.classList.add('hidden');

    const isCreator = role === 'team_manager' || role === 'coach';

    if (!fullName || !email || !password || !role) {
      errEl.textContent = 'יש למלא את כל השדות.'; errEl.classList.remove('hidden'); return;
    }
    if (isCreator && !teamName) {
      errEl.textContent = 'יש להזין שם קבוצה.'; errEl.classList.remove('hidden'); return;
    }
    if (!isCreator && !teamCode) {
      errEl.textContent = 'יש להזין קוד קבוצה.'; errEl.classList.remove('hidden'); return;
    }

    setLoading('register-btn', 'register-btn-text', 'register-spinner', true);

    const { data, error: signUpError } = await _supabase.auth.signUp({
      email, password,
      options: { data: { full_name: fullName, role } },
    });

    if (signUpError) {
      setLoading('register-btn', 'register-btn-text', 'register-spinner', false);
      errEl.textContent = signUpError.message || 'הרשמה נכשלה.';
      errEl.classList.remove('hidden');
      return;
    }

    // If no session yet = email confirmation required
    if (!data.session) {
      setLoading('register-btn', 'register-btn-text', 'register-spinner', false);
      // Store pending action for after email confirmation
      setCache('pending_team_action', {
        action: isCreator ? 'create' : 'join',
        value:  isCreator ? teamName : teamCode,
        role,
      });
      renderView('email_confirm');
      return;
    }

    // Use ensure_profile() RPC — SECURITY DEFINER so it bypasses RLS
    // Retry to handle slow Supabase cold starts (up to 6 seconds)
    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise(r => setTimeout(r, 600));
      const { data: rpcOk } = await _supabase.rpc('ensure_profile');
      if (rpcOk && !rpcOk.error) break;
    }

    // Team setup RPC
    let teamResult;
    if (isCreator) {
      const { data: rpcData, error: rpcErr } = await _supabase.rpc('create_team', { p_team_name: teamName });
      teamResult = rpcData;
      if (rpcErr || rpcData?.error) {
        errEl.textContent = rpcData?.error || `שגיאה ביצירת קבוצה (${rpcErr?.message ?? 'unknown'})`;
        errEl.classList.remove('hidden');
        setLoading('register-btn', 'register-btn-text', 'register-spinner', false);
        return;
      }
    } else {
      const { data: rpcData, error: rpcErr } = await _supabase.rpc('join_team', { p_code: teamCode });
      teamResult = rpcData;
      if (rpcErr || rpcData?.error) {
        errEl.textContent = rpcData?.error || `קוד קבוצה לא תקין (${rpcErr?.message ?? 'unknown'})`;
        errEl.classList.remove('hidden');
        setLoading('register-btn', 'register-btn-text', 'register-spinner', false);
        return;
      }
    }

    setLoading('register-btn', 'register-btn-text', 'register-spinner', false);

    const profile = await loadCurrentProfile();

    // Show team code to team creator
    if (isCreator && teamResult?.code) {
      renderTeamCodeReveal(teamResult.code, teamResult.team_name);
      return;
    }

    routeByProfile(profile);
  });
}

function renderTeamCodeReveal(code, teamName) {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="auth-container glass-card reveal-card">
      <div class="reveal-icon">🎉</div>
      <h2 class="reveal-title">הקבוצה נוצרה בהצלחה!</h2>
      <p class="reveal-subtitle">${teamName}</p>
      <div class="team-code-display">
        <span class="team-code-label">קוד הקבוצה שלך</span>
        <div class="team-code-value" id="team-code-value">${code}</div>
        <button class="btn btn-secondary btn-sm" id="copy-code-btn">העתק קוד</button>
      </div>
      <p class="reveal-hint">שתף את הקוד הזה עם הספורטאים והצוות שלך כדי שיוכלו להצטרף.</p>
      <button class="btn btn-primary btn-full" id="enter-app-btn">כנס לאפליקציה</button>
    </div>
  `;
  document.getElementById('copy-code-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(code).then(() => {
      document.getElementById('copy-code-btn').textContent = '✓ הועתק!';
      setTimeout(() => { document.getElementById('copy-code-btn').textContent = 'העתק קוד'; }, 2000);
    });
  });
  document.getElementById('enter-app-btn').addEventListener('click', async () => {
    const profile = await loadCurrentProfile();
    routeByProfile(profile);
  });
}


// =============================================================================
// SECTION 9: PENDING APPROVAL VIEW
// =============================================================================
function renderPendingView() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="auth-container glass-card">
      <div class="pending-icon">⏳</div>
      <h2 class="pending-title">ממתין לאישור</h2>
      <p class="pending-text">בקשת ההצטרפות שלך לקבוצה נשלחה למאמן הראשי.<br/>תוכל להיכנס לאחר שהבקשה תאושר.</p>
      <p class="pending-name">${currentProfile?.full_name ?? ''}</p>
      <p class="pending-role">${translateRole(currentProfile?.role)}</p>
      <button class="btn btn-ghost" id="pending-signout">התנתק</button>
    </div>
  `;
  document.getElementById('pending-signout').addEventListener('click', signOut);
}


// =============================================================================
// SECTION 10: ATHLETE HUB VIEW
// =============================================================================
async function renderAthleteView() {
  const root    = document.getElementById('app-root');
  const profile = currentProfile;

  root.innerHTML = `
    <div class="app-shell">
      ${renderTopBar(profile)}
      <main class="main-content" id="athlete-main">
        <div class="loading-state"><div class="spinner-lg"></div><p>טוען נתונים...</p></div>
      </main>
    </div>
  `;

  // Load all data in parallel
  const [schedule, tasks, focus, rpeLog, history, fitnessTasks, staffLogs, seasonGoal] = await Promise.all([
    fetchCurrentSchedule(profile.id),
    fetchDailyTasks(profile.id),
    fetchCoreFocus(profile.id),
    fetchTodayRPE(profile.id),
    fetchRPEHistory(profile.id, 14),
    fetchFitnessTasksForAthlete(profile.id),
    fetchStaffLogsForAthlete(profile.id),
    fetchSeasonGoalForAthlete(profile.id),
  ]);

  const main        = document.getElementById('athlete-main');
  const currentRPE  = rpeLog?.rpe_value    ?? null;
  const currentFeel = rpeLog?.feeling_score ?? null;
  const targetLoad  = schedule?.target_load ?? null;
  const discrepancy = (currentRPE !== null && targetLoad)
    ? computeRPEDiscrepancy(targetLoad, currentRPE) : null;

  const focusByDiscipline = {
    mental:    focus.filter(f => f.discipline === 'mental'),
    nutrition: focus.filter(f => f.discipline === 'nutrition'),
    fitness:   focus.filter(f => f.discipline === 'fitness'),
  };

  // Count unread staff messages
  const staffMsgCount = focus.length + staffLogs.length;
  const fitTaskCount  = fitnessTasks.filter(t => !t.is_completed && t.task_date === getTodayISO()).length;

  main.innerHTML = `
    <nav class="athlete-hub-nav">
      <button class="athlete-hub-tab active" data-htab="report">📊 דיווח יומי</button>
      <button class="athlete-hub-tab" data-htab="directives">
        📌 הנחיות צוות${staffMsgCount > 0 ? ` <span class="hub-badge">${staffMsgCount}</span>` : ''}
      </button>
      <button class="athlete-hub-tab" data-htab="fitness">
        💪 משימות כושר${fitTaskCount > 0 ? ` <span class="hub-badge hub-badge-fitness">${fitTaskCount}</span>` : ''}
      </button>
      ${seasonGoal ? '<button class="athlete-hub-tab" data-htab="goal">🎯 יעד עונה</button>' : ''}
    </nav>

    <!-- TAB: DAILY REPORT -->
    <div class="hub-pane" id="htab-report">
      <div class="athlete-grid">

        <div class="card glass-card report-card">
          <h2 class="card-title">דיווח יומי <span class="tag tag-rpe">RPE</span></h2>

          <div class="slider-block">
            <div class="slider-header">
              <span class="slider-label">עומס אימון</span>
              <span class="slider-value-badge rpe-color" id="rpe-badge">${currentRPE ?? '—'}</span>
            </div>
            <input type="range" class="dual-slider rpe-slider" id="rpe-slider"
              min="1" max="10" value="${currentRPE ?? 5}" />
            <div class="slider-scale"><span>קל</span><span>בינוני</span><span>קשה</span></div>
            <div class="slider-sublabel" id="rpe-sub">${currentRPE ? getRPELabel(currentRPE) : 'הזז להגדרה'}</div>
          </div>

          <div class="slider-block">
            <div class="slider-header">
              <span class="slider-label">תחושה אישית כללית</span>
              <span class="slider-value-badge feel-color" id="feel-badge">${currentFeel ?? '—'}</span>
            </div>
            <input type="range" class="dual-slider feel-slider" id="feel-slider"
              min="1" max="10" value="${currentFeel ?? 5}" />
            <div class="slider-scale"><span>גרוע</span><span>בינוני</span><span>מצוין</span></div>
            <div class="slider-sublabel" id="feel-sub">${currentFeel ? getFeelingLabel(currentFeel) : 'הזז להגדרה'}</div>
          </div>

          ${discrepancy ? `
            <div class="discrepancy-badge ${discrepancy.badge.css}" id="disc-badge">
              <span>${discrepancy.badge.icon}</span>
              <span>${discrepancy.badge.label}</span>
            </div>
          ` : `<div class="discrepancy-badge status-grey" id="disc-badge">⏳ ממתין לנתוני מאמן</div>`}

          <input type="text" id="rpe-notes" class="form-input"
            placeholder="הערות (אופציונלי)" value="${rpeLog?.notes ?? ''}" />
          <button class="btn btn-primary" id="report-submit">שמור דיווח יומי</button>
        </div>

        <div class="card glass-card schedule-card">
          <h2 class="card-title">תכנית שבועית</h2>
          ${schedule ? `
            <div class="schedule-load-row">
              <span class="load-label">עומס מטרה:</span>
              <span class="load-badge load-${schedule.target_load}">${translateLoad(schedule.target_load)}</span>
            </div>
            ${schedule.notes ? `<p class="schedule-notes">${schedule.notes}</p>` : ''}
            <p class="schedule-week">שבוע: ${formatWeekDisplay(schedule.week_start)}</p>
          ` : `<p class="empty-state">המאמן טרם הגדיר עומס לשבוע זה</p>`}
        </div>

        <div class="card glass-card chart-card full-width">
          <h2 class="card-title">מגמת 14 ימים 📈</h2>
          <div class="chart-wrapper chart-tall">
            <canvas id="athlete-trend-chart"></canvas>
          </div>
        </div>

        <div class="card glass-card tasks-card">
          <h2 class="card-title">משימות אישיות</h2>
          <div id="tasks-list" class="tasks-list">${renderTasksList(tasks.filter(t => t.discipline !== 'fitness'))}</div>
          <div class="add-task-row">
            <input type="text" id="custom-task-input" class="form-input" placeholder="הוסף משימה אישית..." maxlength="120" />
            <button class="btn btn-secondary" id="add-task-btn">+ הוסף</button>
          </div>
        </div>

      </div>
    </div>

    <!-- TAB: STAFF DIRECTIVES -->
    <div class="hub-pane hidden" id="htab-directives">
      <div class="focus-tabs">
        <button class="focus-tab active" data-tab="mental">🧠 מנטל</button>
        <button class="focus-tab" data-tab="nutrition">🥗 תזונה</button>
        <button class="focus-tab" data-tab="fitness">💪 כושר</button>
      </div>
      <div id="focus-content" style="margin-top:var(--sp-md)">${renderFocusItems(focusByDiscipline.mental)}</div>

      ${staffLogs.length ? `
        <div style="margin-top:var(--sp-xl)">
          <h3 class="section-label">📬 הודעות מהצוות המקצועי</h3>
          <div style="display:flex;flex-direction:column;gap:var(--sp-sm);margin-top:var(--sp-sm)">
            ${staffLogs.map(l => `
              <div class="staff-msg-card">
                <div class="staff-msg-header">
                  <span class="staff-msg-role">${translateRole(l.staff?.role ?? '')}</span>
                  <span>${l.staff?.full_name ?? ''}</span>
                  <span class="staff-msg-date">${l.log_date}</span>
                </div>
                <p class="staff-msg-body">${l.content}</p>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>

    <!-- TAB: FITNESS TASKS -->
    <div class="hub-pane hidden" id="htab-fitness">
      <h3 class="section-label" style="margin-bottom:var(--sp-md)">משימות כושר מהמאמן</h3>
      ${fitnessTasks.length ? `
        <div style="display:flex;flex-direction:column;gap:var(--sp-sm)">
          ${fitnessTasks.map(t => `
            <div class="fitness-task-item ${t.is_completed ? 'completed' : ''}">
              <span class="fitness-task-icon">${t.is_completed ? '✅' : '💪'}</span>
              <span class="fitness-task-text">${t.title}</span>
              <span class="fitness-task-date">${t.task_date}</span>
            </div>
          `).join('')}
        </div>
      ` : '<div class="staff-msg-empty">אין משימות כושר מהמאמן כרגע</div>'}
    </div>

    <!-- TAB: SEASON GOAL -->
    ${seasonGoal ? `
      <div class="hub-pane hidden" id="htab-goal">
        <div class="athlete-season-goal" style="margin-bottom:var(--sp-lg)">
          <span class="athlete-season-goal-label">🎯 יעד עונה — הוגדר על ידי המאמן</span>
          <p class="athlete-season-goal-text">${seasonGoal.description}</p>
          <span style="font-size:var(--fs-xs);color:var(--text-muted)">עודכן: ${seasonGoal.week_start}</span>
        </div>
      </div>
    ` : ''}
  `;

  // Sliders
  const rpeSlider  = document.getElementById('rpe-slider');
  const feelSlider = document.getElementById('feel-slider');
  const rpeBadge   = document.getElementById('rpe-badge');
  const feelBadge  = document.getElementById('feel-badge');
  const rpeSub     = document.getElementById('rpe-sub');
  const feelSub    = document.getElementById('feel-sub');
  const discBadge  = document.getElementById('disc-badge');

  function updateSliderGradient(slider, pct, colorVar) {
    slider.style.background = `linear-gradient(to right, var(${colorVar}) ${pct}%, var(--bg-input) ${pct}%)`;
  }

  function syncRPE() {
    const val = parseInt(rpeSlider.value, 10);
    rpeBadge.textContent = val;
    rpeSub.textContent   = getRPELabel(val);
    updateSliderGradient(rpeSlider, ((val - 1) / 9) * 100, '--rpe-gradient');
    if (targetLoad && discBadge) {
      const d = computeRPEDiscrepancy(targetLoad, val);
      discBadge.className = `discrepancy-badge ${d.badge.css}`;
      discBadge.innerHTML = `<span>${d.badge.icon}</span><span>${d.badge.label}</span>`;
    }
  }

  function syncFeel() {
    const val = parseInt(feelSlider.value, 10);
    feelBadge.textContent = val;
    feelSub.textContent   = getFeelingLabel(val);
    updateSliderGradient(feelSlider, ((val - 1) / 9) * 100, '--feel-gradient');
  }

  rpeSlider.addEventListener('input', syncRPE);
  feelSlider.addEventListener('input', syncFeel);
  syncRPE(); syncFeel();

  // Submit
  document.getElementById('report-submit').addEventListener('click', async () => {
    const btn = document.getElementById('report-submit');
    btn.disabled = true; btn.textContent = 'שומר...';
    const result = await upsertDailyReport(
      profile.id,
      parseInt(rpeSlider.value, 10),
      parseInt(feelSlider.value, 10),
      document.getElementById('rpe-notes').value.trim(),
    );
    btn.disabled = false;
    btn.textContent = result ? '✓ נשמר בהצלחה' : '⚠ שגיאה בשמירה';
    setTimeout(() => { btn.textContent = 'שמור דיווח יומי'; }, 2500);
  });

  // Personal tasks
  tasks.filter(t => t.discipline !== 'fitness').forEach(t => bindTaskCheckbox(t.id));
  document.getElementById('add-task-btn').addEventListener('click', async () => {
    const input = document.getElementById('custom-task-input');
    const title = input.value.trim();
    if (!title) return;
    const newTask = await addCustomTask(profile.id, title);
    if (newTask) {
      input.value = '';
      document.getElementById('tasks-list').insertAdjacentHTML('beforeend', renderSingleTask(newTask));
      bindTaskCheckbox(newTask.id);
    }
  });

  // Hub tabs
  document.querySelectorAll('.athlete-hub-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.athlete-hub-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.hub-pane').forEach(p => p.classList.add('hidden'));
      tab.classList.add('active');
      const pane = document.getElementById(`htab-${tab.dataset.htab}`);
      if (pane) pane.classList.remove('hidden');
    });
  });

  // Focus tabs (inside directives tab)
  document.querySelectorAll('.focus-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.focus-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('focus-content').innerHTML =
        renderFocusItems(focusByDiscipline[tab.dataset.tab]);
    });
  });

  // Render trend chart
  renderAthleteTrendChart('athlete-trend-chart', history, targetLoad);
}

// Fetch all staff logs visible to an athlete
async function fetchStaffLogsForAthlete(athleteId) {
  const { data } = await _supabase.from('staff_logs')
    .select('*, staff:profiles!staff_logs_staff_id_fkey(full_name, role)')
    .eq('athlete_id', athleteId)
    .order('log_date', { ascending: false })
    .limit(20);
  return data || [];
}

// Fetch fitness tasks assigned to an athlete (all dates, not just today)
async function fetchFitnessTasksForAthlete(athleteId) {
  const { data } = await _supabase.from('daily_tasks')
    .select('*').eq('athlete_id', athleteId).eq('discipline', 'fitness')
    .order('task_date', { ascending: false }).limit(30);
  return data || [];
}

// Fetch season goal set by coach for this athlete
async function fetchSeasonGoalForAthlete(athleteId) {
  const { data } = await _supabase.from('core_focus')
    .select('*').eq('athlete_id', athleteId).eq('discipline', 'coach')
    .ilike('title', 'SEASON_GOAL%')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data;
}


// =============================================================================
// SECTION 11: STAFF VIEWS
// =============================================================================
async function renderStaffBase(roleLabel, accentClass, extraTabs = '') {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="app-shell">
      ${renderTopBar(currentProfile)}
      <main class="main-content" id="staff-main">
        <div class="staff-nav">
          <button class="staff-nav-btn active" data-view="roster">
            <span>רשימת ספורטאים</span>
          </button>
          <button class="staff-nav-btn" data-view="analytics">
            📊 ניתוח נתונים
          </button>
          ${extraTabs}
        </div>
        <div id="staff-view-content">
          <div class="loading-state"><div class="spinner-lg"></div><p>טוען נתונים...</p></div>
        </div>
      </main>
    </div>
  `;

  const roster = await fetchTeamRoster();

  document.querySelectorAll('.staff-nav-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.staff-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      if (view === 'roster')    renderRosterView(roster, roleLabel, accentClass);
      if (view === 'analytics') renderAnalyticsView(roster);
      if (view === 'admin')     renderAdminView();
    });
  });

  renderRosterView(roster, roleLabel, accentClass);
}

function renderRosterView(roster, roleLabel, accentClass) {
  const content = document.getElementById('staff-view-content');
  content.innerHTML = `
    <div class="staff-header">
      <h2 class="staff-role-title ${accentClass}">${roleLabel}</h2>
      <div class="roster-meta">
        <span class="roster-count">${roster.length} ספורטאים</span>
        ${currentTeam ? `<span class="team-code-pill">קוד: <strong>${currentTeam.code}</strong></span>` : ''}
      </div>
    </div>
    <div class="roster-grid" id="roster-grid">
      ${roster.length === 0
        ? `<div class="empty-state full-width">אין ספורטאים רשומים בקבוצה עדיין.<br/>שתף את קוד הקבוצה <strong>${currentTeam?.code ?? ''}</strong> כדי להתחיל.</div>`
        : roster.map(a => renderAthleteCard(a)).join('')
      }
    </div>
  `;

  document.querySelectorAll('.roster-card[data-athlete-id]').forEach(card => {
    card.addEventListener('click', () => openAthleteModal(card.dataset.athleteId));
  });
}

function renderAthleteCard(athlete) {
  const badge    = athlete.discrepancy?.badge ?? DISC_STATUS.PENDING;
  const initials = getInitials(athlete.full_name);
  const feelEmoji = athlete.latestFeeling != null ? getFeelingEmoji(athlete.latestFeeling) : '—';

  return `
    <div class="roster-card glass-card" data-athlete-id="${athlete.athlete_id}">
      <div class="athlete-avatar">${initials}</div>
      <div class="athlete-info">
        <span class="athlete-name">${athlete.full_name}</span>
        <div class="athlete-metrics">
          <span class="metric-pill">עומס: <strong>${athlete.latestRPE ?? '—'}</strong></span>
          <span class="metric-pill">תחושה: <strong>${feelEmoji}</strong></span>
          <span class="load-badge load-${athlete.targetLoad}">${translateLoad(athlete.targetLoad)}</span>
        </div>
      </div>
      <div class="disc-circle ${badge.css}" title="${badge.label}">${badge.icon}</div>
    </div>
  `;
}

function renderAnalyticsView(roster) {
  const content = document.getElementById('staff-view-content');

  const alerts = roster.filter(a => a.discrepancy?.badge?.severity >= 1)
    .sort((a, b) => (b.discrepancy?.badge?.severity ?? 0) - (a.discrepancy?.badge?.severity ?? 0));

  content.innerHTML = `
    <div class="analytics-layout">

      <!-- Alert feed -->
      <div class="card glass-card alert-card">
        <h3 class="card-title">🚨 התראות עומס</h3>
        ${alerts.length === 0
          ? `<div class="alert-all-green">🟢 כל הספורטאים ביישור מושלם</div>`
          : alerts.map(a => `
            <div class="alert-row ${a.discrepancy.badge.css}">
              <span class="alert-icon">${a.discrepancy.badge.icon}</span>
              <span class="alert-name">${a.full_name}</span>
              <span class="alert-detail">עומס ${a.latestRPE ?? '—'} vs מטרה ${translateLoad(a.targetLoad)}</span>
              <span class="alert-label">${a.discrepancy.badge.label}</span>
            </div>
          `).join('')
        }
      </div>

      <!-- Team overview bar chart -->
      <div class="card glass-card chart-card">
        <h3 class="card-title">סטטוס הקבוצה היום 📊</h3>
        <div class="chart-wrapper chart-tall">
          <canvas id="team-overview-chart"></canvas>
        </div>
      </div>

      <!-- Feeling trend chart -->
      <div class="card glass-card chart-card">
        <h3 class="card-title">תחושה ממוצעת — מגמה שבועית 💡</h3>
        <div class="chart-wrapper">
          <canvas id="team-feeling-chart"></canvas>
        </div>
      </div>

    </div>
  `;

  renderTeamOverviewChart('team-overview-chart', roster);
  renderTeamFeelingChart('team-feeling-chart', roster);
}

async function renderAdminView() {
  const content = document.getElementById('staff-view-content');
  content.innerHTML = `<div class="loading-state"><div class="spinner-lg"></div></div>`;

  const pending = await fetchPendingMembers();

  content.innerHTML = `
    <div class="admin-panel">
      <div class="card glass-card">
        <h3 class="card-title">⚙️ ניהול קבוצה</h3>

        <div class="team-info-row">
          <span class="team-info-label">קוד הקבוצה:</span>
          <span class="team-code-display-lg">${currentTeam?.code ?? '—'}</span>
          <button class="btn btn-secondary btn-sm" id="admin-copy-code">העתק</button>
        </div>
        <p class="team-info-hint">שתף קוד זה עם ספורטאים וצוות מקצועי</p>
      </div>

      <div class="card glass-card">
        <h3 class="card-title">⏳ ממתינים לאישור (${pending.length})</h3>
        ${pending.length === 0
          ? `<p class="empty-state">אין בקשות ממתינות</p>`
          : pending.map(p => `
            <div class="pending-row" data-member-id="${p.id}">
              <div class="pending-info">
                <span class="pending-name">${p.full_name}</span>
                <span class="pending-role-tag">${translateRole(p.role)}</span>
              </div>
              <div class="pending-actions">
                <button class="btn btn-approve" data-id="${p.id}">✓ אשר</button>
                <button class="btn btn-reject"  data-id="${p.id}">✕ דחה</button>
              </div>
            </div>
          `).join('')
        }
      </div>
    </div>
  `;

  document.getElementById('admin-copy-code')?.addEventListener('click', () => {
    navigator.clipboard.writeText(currentTeam?.code ?? '');
  });

  document.querySelectorAll('.btn-approve').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = '...';
      await _supabase.rpc('approve_team_member', { p_member_id: btn.dataset.id });
      btn.closest('.pending-row').remove();
    });
  });

  document.querySelectorAll('.btn-reject').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await _supabase.rpc('reject_team_member', { p_member_id: btn.dataset.id });
      btn.closest('.pending-row').remove();
    });
  });
}

async function openAthleteModal(athleteId) {
  const [tasks, focus, schedule, rpe, history] = await Promise.all([
    fetchDailyTasks(athleteId),
    fetchCoreFocus(athleteId),
    fetchCurrentSchedule(athleteId),
    fetchTodayRPE(athleteId),
    fetchRPEHistory(athleteId, 7),
  ]);

  document.getElementById('athlete-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'athlete-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-panel glass-card">
      <button class="modal-close" id="modal-close-btn">✕</button>
      <h3 class="modal-title" id="modal-athlete-name">פרטי ספורטאי</h3>

      <div class="modal-metrics-row">
        <div class="modal-metric">
          <span class="modal-metric-label">עומס RPE</span>
          <span class="modal-metric-value rpe-color">${rpe?.rpe_value ?? '—'}</span>
        </div>
        <div class="modal-metric">
          <span class="modal-metric-label">תחושה</span>
          <span class="modal-metric-value feel-color">${rpe?.feeling_score != null ? rpe.feeling_score : '—'}</span>
        </div>
        <div class="modal-metric">
          <span class="modal-metric-label">עומס מטרה</span>
          <span class="load-badge load-${schedule?.target_load}">${translateLoad(schedule?.target_load)}</span>
        </div>
        <div class="modal-metric">
          <span class="modal-metric-label">סטטוס</span>
          ${rpe?.rpe_value != null && schedule?.target_load
            ? (() => { const d = computeRPEDiscrepancy(schedule.target_load, rpe.rpe_value); return `<span class="${d.badge.css}">${d.badge.icon} ${d.badge.label}</span>`; })()
            : `<span class="status-grey">⏳ ממתין</span>`
          }
        </div>
      </div>

      <!-- Mini trend chart -->
      <div class="modal-chart-wrapper">
        <canvas id="modal-trend-chart"></canvas>
      </div>

      <!-- Set target load (coaches only) -->
      ${currentProfile.role === 'coach' ? `
        <div class="modal-section">
          <strong>הגדרת עומס שבועי:</strong>
          <div class="load-selector">
            <button class="load-opt ${schedule?.target_load === 'low'    ? 'active' : ''}" data-load="low">קל</button>
            <button class="load-opt ${schedule?.target_load === 'medium' ? 'active' : ''}" data-load="medium">בינוני</button>
            <button class="load-opt ${schedule?.target_load === 'high'   ? 'active' : ''}" data-load="high">גבוה</button>
          </div>
          <input type="text" id="schedule-notes" class="form-input" placeholder="הערות למאמן..." value="${schedule?.notes ?? ''}" />
          <button class="btn btn-primary btn-sm" id="save-schedule-btn">שמור עומס</button>
        </div>
      ` : ''}

      <!-- Focus directives -->
      <div class="modal-section">
        <strong>הנחיות שבועיות:</strong>
        <ul class="focus-modal-list">
          ${focus.map(f => `
            <li class="focus-modal-item">
              <span class="disc-badge">${disciplineLabel(f.discipline)}</span>
              <strong>${f.title}</strong>
              ${f.description ? `<p>${f.description}</p>` : ''}
            </li>
          `).join('') || '<li class="empty-state">אין הנחיות לשבוע זה</li>'}
        </ul>
      </div>

      <!-- Tasks -->
      <div class="modal-section">
        <strong>משימות יום:</strong>
        <div class="tasks-modal-list">
          ${tasks.map(t => `
            <div class="task-modal-item ${t.is_completed ? 'completed' : ''}">
              <span>${t.is_completed ? '✓' : '○'}</span>
              <span>${t.title}</span>
              ${t.source === 'athlete' ? `<span class="custom-badge">★</span>` : ''}
            </div>
          `).join('') || '<div class="empty-state">אין משימות</div>'}
        </div>
      </div>

      <!-- Staff note -->
      <div class="modal-section">
        <strong>הוסף הערה מקצועית:</strong>
        <textarea id="staff-note-input" class="form-input form-textarea" placeholder="כתוב כאן..." rows="3"></textarea>
        <button class="btn btn-secondary btn-sm" id="staff-note-submit">שמור הערה</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  renderAthleteTrendChart('modal-trend-chart', history, schedule?.target_load, true);

  document.getElementById('modal-close-btn').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  // Load opt buttons
  document.querySelectorAll('.load-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.load-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('save-schedule-btn')?.addEventListener('click', async () => {
    const load  = document.querySelector('.load-opt.active')?.dataset.load;
    const notes = document.getElementById('schedule-notes').value.trim();
    if (!load) return;
    const btn = document.getElementById('save-schedule-btn');
    btn.disabled = true;
    await upsertSchedule(athleteId, load, notes);
    btn.textContent = '✓ נשמר';
    setTimeout(() => { btn.disabled = false; btn.textContent = 'שמור עומס'; }, 2000);
  });

  document.getElementById('staff-note-submit')?.addEventListener('click', async () => {
    const content = document.getElementById('staff-note-input').value.trim();
    if (!content) return;
    await _supabase.from('staff_logs').insert({
      staff_id: currentProfile.id, athlete_id: athleteId,
      discipline: roleToDiscipline(currentProfile.role), content,
      log_date: getTodayISO(),
    });
    document.getElementById('staff-note-submit').textContent = '✓ נשמר';
  });
}


// =============================================================================
// SECTION 12: ROLE-SPECIFIC RENDERERS
// =============================================================================

// ─── TEAM MANAGER ─────────────────────────────────────────────────────────────
async function renderTeamManagerView() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="staff-dashboard">
      <header class="staff-header">
        <div class="staff-header-left">
          <span class="staff-role-badge accent-manager">👑 מנהל קבוצה</span>
          <span class="staff-team-name">${currentTeam?.name ?? ''}</span>
        </div>
        <div class="staff-header-right">
          <span class="staff-name">${currentProfile?.full_name ?? ''}</span>
          <button class="btn-signout" id="manager-signout">יציאה</button>
        </div>
      </header>
      <nav class="staff-nav">
        <button class="staff-nav-btn active" data-view="overview">📊 סקירה כללית</button>
        <button class="staff-nav-btn" data-view="roster">👥 ספורטאים</button>
        <button class="staff-nav-btn" data-view="analytics">📈 ניתוח</button>
        <button class="staff-nav-btn" data-view="coach">🏆 מאמן ראשי</button>
        <button class="staff-nav-btn" data-view="psychologist">🧠 פסיכולוג</button>
        <button class="staff-nav-btn" data-view="fitness">💪 מאמן כושר</button>
        <button class="staff-nav-btn" data-view="nutritionist">🥗 תזונאי</button>
        <button class="staff-nav-btn" data-view="admin">⚙️ ניהול</button>
      </nav>
      <main class="staff-main" id="manager-main">
        <div class="loading-spinner-lg">טוען...</div>
      </main>
    </div>
  `;

  document.getElementById('manager-signout').addEventListener('click', signOut);

  const roster = await fetchTeamRoster();

  async function showManagerView(view) {
    document.querySelectorAll('.staff-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.staff-nav-btn[data-view="${view}"]`)?.classList.add('active');
    const main = document.getElementById('manager-main');

    if (view === 'overview') {
      const evaluated = evaluateRoster(roster);
      const reportedToday = evaluated.filter(a => a.latestRPE != null).length;
      const alerts        = evaluated.filter(a => a.discrepancy?.status === 'RED').length;
      const yellowCount   = evaluated.filter(a => a.discrepancy?.status === 'YELLOW').length;

      main.innerHTML = `
        <div class="manager-stats-row">
          <div class="manager-stat-card">
            <span class="manager-stat-number">${roster.length}</span>
            <span class="manager-stat-label">ספורטאים בקבוצה</span>
          </div>
          <div class="manager-stat-card ${reportedToday === roster.length ? 'stat-ok' : ''}">
            <span class="manager-stat-number">${reportedToday}/${roster.length}</span>
            <span class="manager-stat-label">דיווחו היום</span>
          </div>
          <div class="manager-stat-card ${alerts > 0 ? 'stat-alert' : 'stat-ok'}">
            <span class="manager-stat-number">${alerts}</span>
            <span class="manager-stat-label">התראות קריטיות</span>
          </div>
          <div class="manager-stat-card">
            <span class="manager-stat-number">${yellowCount}</span>
            <span class="manager-stat-label">סטיות קלות</span>
          </div>
          <div class="manager-stat-card">
            <span class="manager-stat-number">${currentTeam?.code ?? '—'}</span>
            <span class="manager-stat-label">קוד קבוצה</span>
          </div>
        </div>

        ${alerts > 0 ? `
          <div class="card glass-card" style="margin-bottom:var(--sp-lg)">
            <h3 class="card-title">🚨 ספורטאים בסטייה קריטית</h3>
            ${evaluated.filter(a => a.discrepancy?.status === 'RED').map(a => `
              <div class="alert-row status-red">
                <span class="alert-icon">🔴</span>
                <span class="alert-name">${a.full_name}</span>
                <span class="alert-detail">RPE: ${a.latestRPE} | עומס מטרה: ${translateLoad(a.targetLoad)}</span>
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="card glass-card">
            <div class="alert-all-green">✅ אין התראות קריטיות כרגע — הקבוצה מיושרת</div>
          </div>
        `}

        <div class="roster-grid" style="margin-top:var(--sp-lg)">
          ${evaluated.slice(0,6).map(a => renderAthleteCard(a)).join('')}
          ${roster.length > 6 ? `<div class="empty-state">+ ${roster.length - 6} ספורטאים נוספים — עבור לטאב ספורטאים</div>` : ''}
        </div>
      `;
      attachRosterEvents(evaluated);

    } else if (view === 'roster') {
      main.innerHTML = renderManagerRosterHTML(roster);
      attachRosterEvents(roster);

    } else if (view === 'analytics') {
      await renderAnalyticsHTML(main);

    } else if (view === 'coach') {
      main.innerHTML = '<div class="loading-spinner-lg">טוען לוח מאמן...</div>';
      // Render coach notes panel inline (without full-page takeover)
      main.innerHTML = renderCoachNotesHTML(roster);
      attachCoachNotesEvents(roster);

    } else if (view === 'psychologist') {
      main.innerHTML = '<div class="loading-spinner-lg">טוען לוח פסיכולוג...</div>';
      main.innerHTML = renderPsychRosterHTML(roster);
      attachPsychAthleteEvents(roster);

    } else if (view === 'fitness') {
      main.innerHTML = '<div class="loading-spinner-lg">טוען לוח מאמן כושר...</div>';
      main.innerHTML = renderFitnessRosterHTML(roster);
      attachFitnessAthleteEvents(roster);

    } else if (view === 'nutritionist') {
      main.innerHTML = '<div class="loading-spinner-lg">טוען לוח תזונאי...</div>';
      await renderNutritionistPanel(main, roster);

    } else if (view === 'admin') {
      main.innerHTML = '<div class="loading-spinner-lg">טוען...</div>';
      await renderAdminPanel(main);
    }
  }

  document.querySelectorAll('.staff-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showManagerView(btn.dataset.view));
  });

  showManagerView('overview');
}

function renderManagerRosterHTML(roster) {
  return `
    <div class="staff-header">
      <h2 class="staff-role-title accent-manager">👥 כל הספורטאים</h2>
      <div class="roster-meta">
        <span class="roster-count">${roster.length} ספורטאים</span>
        ${currentTeam ? `<span class="team-code-pill">קוד: <strong>${currentTeam.code}</strong></span>` : ''}
      </div>
    </div>
    <div class="roster-grid">
      ${roster.length ? roster.map(a => renderAthleteCard(a)).join('')
        : `<div class="empty-state full-width">אין ספורטאים רשומים בקבוצה עדיין.<br/>שתף את קוד הקבוצה <strong>${currentTeam?.code ?? ''}</strong> כדי להתחיל.</div>`}
    </div>
  `;
}


// ─── COACH ────────────────────────────────────────────────────────────────────
async function renderCoachView() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="staff-dashboard">
      <header class="staff-header">
        <div class="staff-header-left">
          <span class="staff-role-badge accent-coach">🏆 מאמן ראשי</span>
          <span class="staff-team-name">${currentTeam?.name ?? ''}</span>
        </div>
        <div class="staff-header-right">
          <span class="staff-name">${currentProfile?.full_name ?? ''}</span>
          <button class="btn-signout" id="coach-signout">יציאה</button>
        </div>
      </header>
      <nav class="staff-nav">
        <button class="staff-nav-btn active" data-view="roster">👥 ספורטאים</button>
        <button class="staff-nav-btn" data-view="planner">📅 לו"ז שבועי</button>
        <button class="staff-nav-btn" data-view="notes">📝 הערות</button>
        <button class="staff-nav-btn" data-view="analytics">📊 ניתוח</button>
        ${currentProfile.is_team_admin ? '<button class="staff-nav-btn" data-view="admin">⚙️ ניהול</button>' : ''}
      </nav>
      <main class="staff-main" id="coach-main">
        <div class="loading-spinner-lg">טוען...</div>
      </main>
    </div>
  `;

  document.getElementById('coach-signout').addEventListener('click', signOut);

  const roster = await fetchTeamRoster();
  let currentView = 'roster';

  async function showCoachView(view) {
    currentView = view;
    document.querySelectorAll('.staff-nav-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.view === view));
    const main = document.getElementById('coach-main');

    if (view === 'roster') {
      main.innerHTML = renderRosterHTML(roster);
      attachRosterEvents(roster);

    } else if (view === 'planner') {
      await renderMultiWeekPlanner(main, roster);

    } else if (view === 'notes') {
      main.innerHTML = renderCoachNotesHTML(roster);
      attachCoachNotesEvents(roster);

    } else if (view === 'analytics') {
      main.innerHTML = renderAnalyticsHTML(roster);
      await renderAnalyticsCharts(roster);

    } else if (view === 'admin') {
      main.innerHTML = '<div class="loading-spinner-lg">טוען...</div>';
      await renderAdminPanel(main);
    }
  }

  document.querySelectorAll('.staff-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showCoachView(btn.dataset.view));
  });

  showCoachView('roster');
}

// ─── PHASE B: MULTI-WEEK PLANNER (8 weeks: -4 past + current + 3 future) ──────
async function renderMultiWeekPlanner(container, roster) {
  if (!roster.length) { container.innerHTML = '<div class="empty-state">אין ספורטאים בקבוצה</div>'; return; }

  const OFFSETS    = [-4, -3, -2, -1, 0, 1, 2, 3];
  let activeOffset = 0;

  function buildTabsHTML() {
    return OFFSETS.map(offset => {
      const ws     = getWeekStartByOffset(offset);
      const isPast = offset < 0;
      return `<button class="week-tab ${offset === activeOffset ? 'active' : ''} ${isPast ? 'past' : ''}" data-offset="${offset}">
        <span class="week-tab-label">${weekTabLabel(offset)}</span>
        <span class="week-tab-range">${formatWeekRange(ws)}</span>
        ${isPast ? '<span class="week-tab-past-badge">📋</span>' : ''}
      </button>`;
    }).join('');
  }

  function buildGridHTML(scheduleMap, isPast) {
    const loadOpts = ['low', 'medium', 'high'];
    return `
      <div class="planner-grid ${isPast ? 'planner-readonly' : ''}">
        <div class="planner-grid-header">
          <span>ספורטאי</span>
          <span>עומס נמוך</span>
          <span>עומס בינוני</span>
          <span>עומס גבוה</span>
          <span class="planner-rpe">RPE היום</span>
          <span class="planner-feel">תחושה</span>
        </div>
        ${roster.map(a => {
          const saved = scheduleMap[a.athlete_id]?.target_load;
          return `
            <div class="planner-row" data-athlete-id="${a.athlete_id}">
              <span class="planner-name">${a.full_name}</span>
              ${loadOpts.map(load => `
                <label class="planner-load-cell ${isPast ? 'readonly-cell' : ''}">
                  <input type="radio" name="wload-${a.athlete_id}" value="${load}"
                    ${saved === load ? 'checked' : ''} class="planner-radio"
                    ${isPast ? 'disabled' : ''} />
                  <span class="planner-load-pill load-${load} ${saved === load && isPast ? 'pill-saved' : ''}">${translateLoad(load)}</span>
                </label>
              `).join('')}
              <span class="planner-rpe ${getRPEClass(a.latestRPE)}">${activeOffset === 0 ? (a.latestRPE ?? '—') : '—'}</span>
              <span class="planner-feel">${activeOffset === 0 && a.latestFeeling != null ? a.latestFeeling : '—'}</span>
            </div>
          `;
        }).join('')}
      </div>
      ${isPast ? '<div class="planner-readonly-banner">📋 שבוע שעבר — תצוגה בלבד</div>' : ''}
    `;
  }

  async function renderPlanner() {
    const weekStart = getWeekStartByOffset(activeOffset);
    const isPast    = activeOffset < 0;
    document.getElementById('planner-grid-area').innerHTML = '<div class="loading-spinner-lg">טוען...</div>';
    const scheduleMap = await fetchSchedulesForWeek(weekStart);
    document.getElementById('planner-grid-area').innerHTML = buildGridHTML(scheduleMap, isPast);
    document.getElementById('planner-week-range').textContent = formatWeekRange(weekStart);
    const saveBtn = document.getElementById('planner-save-all');
    if (saveBtn) saveBtn.style.display = isPast ? 'none' : '';
  }

  container.innerHTML = `
    <div class="planner-header">
      <h3 class="planner-title">📅 תכנון עומסים — 8 שבועות</h3>
      <div class="planner-actions">
        <span class="planner-range-display" id="planner-week-range"></span>
        <button class="btn btn-primary" id="planner-save-all">שמור שבוע</button>
      </div>
    </div>
    <div class="week-tabs" id="week-tabs">${buildTabsHTML()}</div>
    <div id="planner-grid-area"><div class="loading-spinner-lg">טוען...</div></div>
  `;

  await renderPlanner();

  document.getElementById('week-tabs').addEventListener('click', async e => {
    const tab = e.target.closest('.week-tab');
    if (!tab) return;
    activeOffset = parseInt(tab.dataset.offset);
    document.querySelectorAll('.week-tab').forEach(t =>
      t.classList.toggle('active', parseInt(t.dataset.offset) === activeOffset));
    await renderPlanner();
  });

  document.getElementById('planner-save-all').addEventListener('click', async () => {
    const btn = document.getElementById('planner-save-all');
    btn.disabled = true; btn.textContent = 'שומר...';
    const weekStart = getWeekStartByOffset(activeOffset);
    const loadMap = {};
    roster.forEach(a => {
      const sel = document.querySelector(`input[name="wload-${a.athlete_id}"]:checked`);
      if (sel) loadMap[a.athlete_id] = sel.value;
    });
    const ok = await bulkUpsertSchedulesForWeek(loadMap, weekStart);
    btn.textContent = ok ? '✓ נשמר!' : '❌ שגיאה';
    btn.disabled = false;
    setTimeout(() => { btn.textContent = 'שמור שבוע'; }, 2500);
  });
}



function renderCoachNotesHTML(roster) {
  if (!roster.length) return '<div class="empty-state">אין ספורטאים</div>';
  return `
    <div class="notes-layout">
      <div class="notes-sidebar">
        <h4 class="notes-sidebar-title">ספורטאים</h4>
        ${roster.map(a => `
          <button class="notes-athlete-btn" data-athlete-id="${a.athlete_id}" data-name="${a.full_name}">
            <span class="notes-avatar">${a.full_name.charAt(0)}</span>
            <span>${a.full_name}</span>
          </button>
        `).join('')}
      </div>
      <div class="notes-panel" id="notes-panel">
        <div class="notes-empty-prompt">← בחר ספורטאי לצפייה ועריכת הערות</div>
      </div>
    </div>
  `;
}

function attachCoachNotesEvents(roster) {
  document.querySelectorAll('.notes-athlete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.notes-athlete-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      await loadNotesPanel(btn.dataset.athleteId, btn.dataset.name);
    });
  });
}

async function loadNotesPanel(athleteId, name) {
  const panel = document.getElementById('notes-panel');
  panel.innerHTML = '<div class="loading-spinner-lg">טוען הערות...</div>';

  const [privateNotes, staffLogs, seasonGoal] = await Promise.all([
    fetchPrivateNotes(athleteId),
    fetchMyStaffLogs(athleteId),
    fetchSeasonGoal(athleteId),
  ]);

  panel.innerHTML = `
    <h4 class="notes-panel-title">📝 ${name}</h4>
    <div class="notes-tabs">
      <button class="notes-tab active" data-ntab="private">🔒 הערות פרטיות</button>
      <button class="notes-tab" data-ntab="log">👁 רישום לספורטאי</button>
      <button class="notes-tab" data-ntab="season">🎯 יעדי עונה</button>
    </div>

    <div class="notes-tab-pane" id="ntab-private">
      <div class="note-form">
        <textarea id="private-note-input" class="note-textarea" placeholder="הערה פרטית — לא נראית לספורטאי..." rows="3"></textarea>
        <div class="note-form-row">
          <select id="note-sensitivity" class="form-input form-select note-sensitivity-sel">
            <option value="confidential">🔒 סודי</option>
            <option value="critical">🚨 קריטי</option>
          </select>
          <button class="btn btn-primary" id="private-note-save">שמור</button>
        </div>
      </div>
      <div class="notes-list">
        ${privateNotes.length ? privateNotes.map(n => `
          <div class="note-item note-${n.sensitivity}">
            <span class="note-badge">${n.sensitivity === 'critical' ? '🚨' : '🔒'}</span>
            <span class="note-content">${n.content}</span>
            <span class="note-date">${n.note_date}</span>
          </div>
        `).join('') : '<div class="notes-empty">אין הערות עדיין</div>'}
      </div>
    </div>

    <div class="notes-tab-pane hidden" id="ntab-log">
      <div class="note-form">
        <textarea id="log-note-input" class="note-textarea" placeholder="רישום גלוי לספורטאי..." rows="3"></textarea>
        <button class="btn btn-primary" id="log-note-save">שמור</button>
      </div>
      <div class="notes-list">
        ${staffLogs.length ? staffLogs.map(n => `
          <div class="note-item">
            <span class="note-content">${n.content}</span>
            <span class="note-date">${n.log_date}</span>
          </div>
        `).join('') : '<div class="notes-empty">אין רישומים עדיין</div>'}
      </div>
    </div>

    <div class="notes-tab-pane hidden" id="ntab-season">
      <div class="season-goal-block">
        <div class="season-goal-header">
          <span class="season-goal-icon">🎯</span>
          <div>
            <h5 class="season-goal-title">יעדי עונה — ${name}</h5>
            <p class="season-goal-hint">מוצג לך בלבד. ניתן לעדכן בכל עת.</p>
          </div>
        </div>
        <textarea id="season-goal-input" class="note-textarea season-goal-textarea"
          placeholder="למשל: שיפור מהירות ספרינט 10m ל-1.65 שניות. שמירה על אחוז שומן מתחת ל-12%. חיזוק ליבה."
          rows="5">${seasonGoal?.description ?? ''}</textarea>
        <button class="btn btn-primary" id="season-goal-save">💾 שמור יעדי עונה</button>
        ${seasonGoal ? `<span class="season-goal-updated">עודכן לאחרונה: ${seasonGoal.week_start}</span>` : ''}
      </div>
    </div>
  `;

  // Tab switching
  panel.querySelectorAll('.notes-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      panel.querySelectorAll('.notes-tab').forEach(t => t.classList.remove('active'));
      panel.querySelectorAll('.notes-tab-pane').forEach(p => p.classList.add('hidden'));
      tab.classList.add('active');
      panel.querySelector(`#ntab-${tab.dataset.ntab}`).classList.remove('hidden');
    });
  });

  document.getElementById('private-note-save')?.addEventListener('click', async () => {
    const content = document.getElementById('private-note-input').value.trim();
    const sensitivity = document.getElementById('note-sensitivity').value;
    if (!content) return;
    const result = await insertPrivateNote(athleteId, content, sensitivity);
    if (result) {
      document.getElementById('private-note-input').value = '';
      await loadNotesPanel(athleteId, name);
    }
  });

  document.getElementById('log-note-save')?.addEventListener('click', async () => {
    const content = document.getElementById('log-note-input').value.trim();
    if (!content) return;
    const result = await insertStaffLog(athleteId, content, 'coach');
    if (result) {
      document.getElementById('log-note-input').value = '';
      await loadNotesPanel(athleteId, name);
    }
  });

  document.getElementById('season-goal-save')?.addEventListener('click', async () => {
    const btn = document.getElementById('season-goal-save');
    const goalText = document.getElementById('season-goal-input').value;
    btn.disabled = true; btn.textContent = 'שומר...';
    await saveSeasonGoal(athleteId, goalText);
    btn.textContent = '✓ נשמר!';
    btn.disabled = false;
    setTimeout(() => { btn.textContent = '💾 שמור יעדי עונה'; }, 2500);
  });
}

// ─── PSYCHOLOGIST ──────────────────────────────────────────────────────────────
async function renderPsychologistView() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="staff-dashboard">
      <header class="staff-header">
        <div class="staff-header-left">
          <span class="staff-role-badge accent-psych">🧠 פסיכולוג ספורט</span>
          <span class="staff-team-name">${currentTeam?.name ?? ''}</span>
        </div>
        <div class="staff-header-right">
          <span class="staff-name">${currentProfile?.full_name ?? ''}</span>
          <button class="btn-signout" id="psych-signout">יציאה</button>
        </div>
      </header>
      <nav class="staff-nav">
        <button class="staff-nav-btn active" data-view="athletes">👥 שחקנים</button>
        <button class="staff-nav-btn" data-view="mental-overview">📊 סקירה מנטלית</button>
      </nav>
      <main class="staff-main" id="psych-main">
        <div class="loading-spinner-lg">טוען...</div>
      </main>
    </div>
  `;

  document.getElementById('psych-signout').addEventListener('click', signOut);
  const roster = await fetchTeamRoster();

  async function showPsychView(view) {
    document.querySelectorAll('.staff-nav-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.view === view));
    const main = document.getElementById('psych-main');

    if (view === 'athletes') {
      main.innerHTML = renderPsychRosterHTML(roster);
      attachPsychAthleteEvents(roster);
    } else if (view === 'mental-overview') {
      await renderTeamMentalOverview(main, roster);
    }
  }

  document.querySelectorAll('.staff-nav-btn').forEach(btn =>
    btn.addEventListener('click', () => showPsychView(btn.dataset.view)));
  showPsychView('athletes');
}

function renderPsychRosterHTML(roster) {
  if (!roster.length) return '<div class="empty-state">אין ספורטאים</div>';
  const sorted = [...roster].sort((a, b) =>
    (a.latestFeeling ?? 11) - (b.latestFeeling ?? 11));

  return `
    <div class="psych-roster">
      <div class="psych-roster-hint">לחץ על ספורטאי לפתיחת הפאנל המנטלי</div>
      ${sorted.map(a => {
        const feel = a.latestFeeling;
        const feelClass = feel == null ? '' : feel <= 3 ? 'feel-critical' : feel <= 6 ? 'feel-mid' : 'feel-good';
        return `
          <div class="psych-athlete-card ${feelClass}" data-athlete-id="${a.athlete_id}">
            <div class="psych-avatar">${a.full_name.charAt(0)}</div>
            <div class="psych-info">
              <span class="psych-name">${a.full_name}</span>
              <span class="psych-feel-label">תחושה: <strong>${feel ?? '—'}/10</strong></span>
            </div>
            <div class="psych-feel-bar">
              <div class="psych-feel-fill" style="width:${feel ? feel * 10 : 0}%"></div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function attachPsychAthleteEvents(roster) {
  document.querySelectorAll('.psych-athlete-card').forEach(card => {
    card.addEventListener('click', () => {
      const a = roster.find(r => r.athlete_id === card.dataset.athleteId);
      if (a) openPsychAthleteModal(a);
    });
  });
}

async function openPsychAthleteModal(athlete) {
  const [history, prevNotes, prevLogs] = await Promise.all([
    fetchRPEHistoryWeeks(athlete.athlete_id, 3),
    fetchPrivateNotes(athlete.athlete_id),
    fetchMyStaffLogs(athlete.athlete_id),
  ]);

  document.getElementById('psych-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'psych-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-panel glass-card modal-wide">
      <button class="modal-close" id="psych-modal-close">✕</button>
      <h3 class="modal-title">🧠 ${athlete.full_name} — פאנל מנטלי</h3>

      <div class="psych-modal-grid">
        <div class="psych-chart-col">
          <h4 class="section-label">גרף תחושה — 3 שבועות אחרונים</h4>
          <div class="chart-wrapper">
            <canvas id="psych-feel-chart" height="160"></canvas>
          </div>
        </div>
        <div class="psych-forms-col">
          <div class="psych-form-block">
            <h4 class="section-label">📌 הנחיית מיקוד מנטלי (שבוע זה)</h4>
            <input type="text" id="focus-title" class="form-input" placeholder="כותרת הנחיה..." />
            <textarea id="focus-desc" class="note-textarea" placeholder="תיאור ההנחיה..." rows="2"></textarea>
            <button class="btn btn-primary btn-sm" id="focus-save">שמור הנחיה</button>
          </div>
          <div class="psych-form-block">
            <h4 class="section-label">🔒 הערה קלינית (פרטית)</h4>
            <textarea id="psych-private-note" class="note-textarea" placeholder="הערה פרטית — ספורטאי לא רואה..." rows="2"></textarea>
            <div class="note-form-row">
              <select id="psych-sensitivity" class="form-input form-select note-sensitivity-sel">
                <option value="confidential">🔒 סודי</option>
                <option value="critical">🚨 קריטי</option>
              </select>
              <button class="btn btn-secondary btn-sm" id="psych-note-save">שמור</button>
            </div>
          </div>
          <div class="psych-form-block">
            <h4 class="section-label">👁 סיכום מפגש (גלוי לספורטאי)</h4>
            <textarea id="psych-log-input" class="note-textarea" placeholder="סיכום מפגש..." rows="2"></textarea>
            <button class="btn btn-ghost btn-sm" id="psych-log-save">שמור</button>
          </div>
        </div>
      </div>

      <div class="notes-list" style="margin-top:1.5rem">
        <h4 class="section-label">הערות קודמות</h4>
        ${prevNotes.length ? prevNotes.slice(0,5).map(n => `
          <div class="note-item note-${n.sensitivity}">
            <span class="note-badge">${n.sensitivity === 'critical' ? '🚨' : '🔒'}</span>
            <span class="note-content">${n.content}</span>
            <span class="note-date">${n.note_date}</span>
          </div>`).join('') : '<div class="notes-empty">אין הערות קודמות</div>'}
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Feeling chart
  const feelData = history.map(r => ({ x: r.log_date, y: r.feeling_score })).filter(r => r.y != null);
  if (feelData.length) {
    new Chart(document.getElementById('psych-feel-chart'), {
      type: 'line',
      data: {
        labels: feelData.map(r => r.x),
        datasets: [{
          label: 'תחושה',
          data: feelData.map(r => r.y),
          borderColor: 'hsl(280,80%,65%)',
          backgroundColor: 'hsla(280,80%,65%,0.1)',
          tension: 0.4, fill: true, pointRadius: 4,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          y: { min: 1, max: 10, ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          x: { ticks: { color: '#aaa', maxTicksLimit: 7 }, grid: { display: false } }
        },
        plugins: { legend: { display: false } },
      }
    });
  }

  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('psych-modal-close').addEventListener('click', () => modal.remove());

  document.getElementById('focus-save').addEventListener('click', async () => {
    const title = document.getElementById('focus-title').value.trim();
    const desc  = document.getElementById('focus-desc').value.trim();
    if (!title) return;
    await insertCoreFocus(athlete.athlete_id, title, desc, 'mental');
    document.getElementById('focus-title').value = '';
    document.getElementById('focus-desc').value = '';
    document.getElementById('focus-save').textContent = '✓ נשמר';
    setTimeout(() => { document.getElementById('focus-save').textContent = 'שמור הנחיה'; }, 2000);
  });

  document.getElementById('psych-note-save').addEventListener('click', async () => {
    const content = document.getElementById('psych-private-note').value.trim();
    const sens = document.getElementById('psych-sensitivity').value;
    if (!content) return;
    await insertPrivateNote(athlete.athlete_id, content, sens);
    document.getElementById('psych-private-note').value = '';
    document.getElementById('psych-note-save').textContent = '✓';
    setTimeout(() => { document.getElementById('psych-note-save').textContent = 'שמור'; }, 2000);
  });

  document.getElementById('psych-log-save').addEventListener('click', async () => {
    const content = document.getElementById('psych-log-input').value.trim();
    if (!content) return;
    await insertStaffLog(athlete.athlete_id, content, 'mental');
    document.getElementById('psych-log-input').value = '';
    document.getElementById('psych-log-save').textContent = '✓';
    setTimeout(() => { document.getElementById('psych-log-save').textContent = 'שמור'; }, 2000);
  });
}

async function renderTeamMentalOverview(container, roster) {
  if (!roster.length) { container.innerHTML = '<div class="empty-state">אין ספורטאים</div>'; return; }
  container.innerHTML = `
    <h3 class="section-label">📊 סקירה מנטלית — 14 ימים אחרונים</h3>
    <div class="chart-wrapper" style="max-width:700px;margin:0 auto">
      <canvas id="team-mental-chart" height="200"></canvas>
    </div>
    <div class="mental-overview-list">
      ${[...roster].sort((a,b)=>(a.latestFeeling??11)-(b.latestFeeling??11)).map(a=>`
        <div class="mental-row">
          <span class="mental-name">${a.full_name}</span>
          <div class="mental-bar-track">
            <div class="mental-bar-fill feel-fill-${a.latestFeeling <= 3 ? 'low' : a.latestFeeling <= 6 ? 'mid' : 'high'}"
              style="width:${(a.latestFeeling ?? 0)*10}%"></div>
          </div>
          <span class="mental-score">${a.latestFeeling ?? '—'}/10</span>
        </div>
      `).join('')}
    </div>
  `;

  const athleteIds = roster.map(r => r.athlete_id);
  const teamHistory = await fetchTeamRPEHistoryWeeks(athleteIds, 2);
  const byDate = {};
  teamHistory.forEach(r => {
    if (r.feeling_score == null) return;
    if (!byDate[r.log_date]) byDate[r.log_date] = [];
    byDate[r.log_date].push(r.feeling_score);
  });
  const labels = Object.keys(byDate).sort();
  const avgs = labels.map(d => {
    const arr = byDate[d];
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  });

  if (labels.length) {
    new Chart(document.getElementById('team-mental-chart'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'ממוצע תחושת קבוצה',
          data: avgs,
          borderColor: 'hsl(280,80%,65%)',
          backgroundColor: 'hsla(280,80%,65%,0.12)',
          tension: 0.4, fill: true, pointRadius: 4,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          y: { min:1, max:10, ticks:{color:'#aaa'}, grid:{color:'rgba(255,255,255,0.05)'} },
          x: { ticks:{color:'#aaa', maxTicksLimit:8}, grid:{display:false} },
        },
        plugins: { legend: { labels: { color: '#ccc' } } },
      }
    });
  }
}

// ─── FITNESS COACH ─────────────────────────────────────────────────────────────
async function renderFitnessCoachView() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="staff-dashboard">
      <header class="staff-header">
        <div class="staff-header-left">
          <span class="staff-role-badge accent-fitness">💪 מאמן כושר</span>
          <span class="staff-team-name">${currentTeam?.name ?? ''}</span>
        </div>
        <div class="staff-header-right">
          <span class="staff-name">${currentProfile?.full_name ?? ''}</span>
          <button class="btn-signout" id="fitness-signout">יציאה</button>
        </div>
      </header>
      <nav class="staff-nav">
        <button class="staff-nav-btn active" data-view="athletes">👥 שחקנים</button>
        <button class="staff-nav-btn" data-view="periodization">📈 פריודיזציה</button>
      </nav>
      <main class="staff-main" id="fitness-main">
        <div class="loading-spinner-lg">טוען...</div>
      </main>
    </div>
  `;

  document.getElementById('fitness-signout').addEventListener('click', signOut);
  const roster = await fetchTeamRoster();

  async function showFitnessView(view) {
    document.querySelectorAll('.staff-nav-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.view === view));
    const main = document.getElementById('fitness-main');

    if (view === 'athletes') {
      main.innerHTML = renderFitnessRosterHTML(roster);
      attachFitnessAthleteEvents(roster);
    } else if (view === 'periodization') {
      await renderTeamPeriodization(main, roster);
    }
  }

  document.querySelectorAll('.staff-nav-btn').forEach(btn =>
    btn.addEventListener('click', () => showFitnessView(btn.dataset.view)));
  showFitnessView('athletes');
}

function renderFitnessRosterHTML(roster) {
  if (!roster.length) return '<div class="empty-state">אין ספורטאים</div>';
  return `
    <div class="psych-roster">
      <div class="psych-roster-hint">לחץ לפתיחת פאנל הכושר וההגדרת משימות</div>
      ${roster.map(a => {
        const rpeClass = getRPEClass(a.latestRPE);
        return `
          <div class="psych-athlete-card" data-athlete-id="${a.athlete_id}">
            <div class="psych-avatar">${a.full_name.charAt(0)}</div>
            <div class="psych-info">
              <span class="psych-name">${a.full_name}</span>
              <span class="psych-feel-label">RPE: <strong class="${rpeClass}">${a.latestRPE ?? '—'}</strong> | עומס מטרה: <span class="load-badge load-${a.targetLoad}">${translateLoad(a.targetLoad)}</span></span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function attachFitnessAthleteEvents(roster) {
  document.querySelectorAll('.psych-athlete-card').forEach(card => {
    card.addEventListener('click', () => {
      const a = roster.find(r => r.athlete_id === card.dataset.athleteId);
      if (a) openFitnessAthleteModal(a);
    });
  });
}

async function openFitnessAthleteModal(athlete) {
  const [history, tasks] = await Promise.all([
    fetchRPEHistoryWeeks(athlete.athlete_id, 8),
    fetchFitnessTasks(athlete.athlete_id),
  ]);

  document.getElementById('fitness-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'fitness-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-panel glass-card modal-wide">
      <button class="modal-close" id="fitness-modal-close">✕</button>
      <h3 class="modal-title">💪 ${athlete.full_name} — פריודיזציה ומשימות</h3>

      <div class="psych-modal-grid">
        <div class="psych-chart-col">
          <h4 class="section-label">גרף RPE — 8 שבועות אחרונים</h4>
          <div class="chart-wrapper">
            <canvas id="fitness-rpe-chart" height="180"></canvas>
          </div>
        </div>
        <div class="psych-forms-col">
          <div class="psych-form-block">
            <h4 class="section-label">➕ הוספת משימת כושר</h4>
            <input type="date" id="fitness-task-date" class="form-input" value="${getTodayISO()}" />
            <input type="text" id="fitness-task-title" class="form-input" placeholder="תיאור המשימה..." style="margin-top:0.5rem"/>
            <button class="btn btn-primary btn-sm" id="fitness-task-save" style="margin-top:0.5rem">הוסף משימה</button>
          </div>
          <div class="psych-form-block">
            <h4 class="section-label">📌 הנחיית שבוע (כושר)</h4>
            <input type="text" id="fitness-focus-title" class="form-input" placeholder="כותרת..." />
            <textarea id="fitness-focus-desc" class="note-textarea" placeholder="תיאור..." rows="2"></textarea>
            <button class="btn btn-secondary btn-sm" id="fitness-focus-save">שמור הנחיה</button>
          </div>
          <div class="psych-form-block">
            <h4 class="section-label">משימות היום</h4>
            <div class="tasks-mini-list">
              ${tasks.length ? tasks.map(t => `
                <div class="task-mini ${t.is_completed ? 'completed' : ''}">
                  ${t.is_completed ? '✓' : '○'} ${t.title}
                </div>`).join('') : '<div class="notes-empty">אין משימות להיום</div>'}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Periodization chart — group by week
  const weekMap = {};
  history.forEach(r => {
    const d = new Date(r.log_date);
    const wk = getWeekLabel(d);
    if (!weekMap[wk]) weekMap[wk] = [];
    weekMap[wk].push(r.rpe_value);
  });
  const weeks = Object.keys(weekMap);
  const avgRPE = weeks.map(w => {
    const arr = weekMap[w];
    return +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1);
  });

  if (weeks.length) {
    new Chart(document.getElementById('fitness-rpe-chart'), {
      type: 'bar',
      data: {
        labels: weeks,
        datasets: [{
          label: 'ממוצע RPE שבועי',
          data: avgRPE,
          backgroundColor: avgRPE.map(v =>
            v >= 8 ? 'hsla(0,80%,60%,0.7)' :
            v >= 6 ? 'hsla(38,90%,55%,0.7)' :
                     'hsla(145,65%,52%,0.7)'),
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          y: { min:1, max:10, ticks:{color:'#aaa'}, grid:{color:'rgba(255,255,255,0.05)'} },
          x: { ticks:{color:'#aaa'}, grid:{display:false} },
        },
        plugins: { legend: { display: false } },
      }
    });
  }

  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('fitness-modal-close').addEventListener('click', () => modal.remove());

  document.getElementById('fitness-task-save').addEventListener('click', async () => {
    const title = document.getElementById('fitness-task-title').value.trim();
    const date  = document.getElementById('fitness-task-date').value;
    if (!title) return;
    await assignFitnessTask(athlete.athlete_id, title, date);
    document.getElementById('fitness-task-title').value = '';
    document.getElementById('fitness-task-save').textContent = '✓ נוסף';
    setTimeout(() => { document.getElementById('fitness-task-save').textContent = 'הוסף משימה'; }, 2000);
  });

  document.getElementById('fitness-focus-save').addEventListener('click', async () => {
    const title = document.getElementById('fitness-focus-title').value.trim();
    const desc  = document.getElementById('fitness-focus-desc').value.trim();
    if (!title) return;
    await insertCoreFocus(athlete.athlete_id, title, desc, 'fitness');
    document.getElementById('fitness-focus-title').value = '';
    document.getElementById('fitness-focus-desc').value = '';
    document.getElementById('fitness-focus-save').textContent = '✓ נשמר';
    setTimeout(() => { document.getElementById('fitness-focus-save').textContent = 'שמור הנחיה'; }, 2000);
  });
}

async function renderTeamPeriodization(container, roster) {
  if (!roster.length) { container.innerHTML = '<div class="empty-state">אין ספורטאים</div>'; return; }
  container.innerHTML = `
    <h3 class="section-label">📈 פריודיזציה קבוצתית — 8 שבועות</h3>
    <div class="chart-wrapper" style="max-width:750px;margin:0 auto 2rem">
      <canvas id="team-period-chart" height="220"></canvas>
    </div>
    <div class="period-athlete-grid">
      ${roster.map(a => `
        <div class="period-athlete-card">
          <span class="period-athlete-name">${a.full_name}</span>
          <span class="period-athlete-rpe ${getRPEClass(a.latestRPE)}">RPE ${a.latestRPE ?? '—'}</span>
          <span class="load-badge load-${a.targetLoad}">${translateLoad(a.targetLoad)}</span>
        </div>
      `).join('')}
    </div>
  `;

  const athleteIds = roster.map(r => r.athlete_id);
  const teamHistory = await fetchTeamRPEHistoryWeeks(athleteIds, 8);

  const weekMap = {};
  teamHistory.forEach(r => {
    const d = new Date(r.log_date);
    const wk = getWeekLabel(d);
    if (!weekMap[wk]) weekMap[wk] = [];
    weekMap[wk].push(r.rpe_value);
  });
  const weeks = Object.keys(weekMap);
  const avgs = weeks.map(w => {
    const arr = weekMap[w];
    return +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1);
  });

  if (weeks.length) {
    new Chart(document.getElementById('team-period-chart'), {
      type: 'line',
      data: {
        labels: weeks,
        datasets: [{
          label: 'ממוצע RPE קבוצתי',
          data: avgs,
          borderColor: 'hsl(212,90%,60%)',
          backgroundColor: 'hsla(212,90%,60%,0.1)',
          tension: 0.4, fill: true, pointRadius: 5,
          pointBackgroundColor: avgs.map(v =>
            v >= 8 ? 'hsl(0,80%,60%)' : v >= 6 ? 'hsl(38,90%,55%)' : 'hsl(145,65%,52%)'),
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          y: { min:1, max:10, ticks:{color:'#aaa'}, grid:{color:'rgba(255,255,255,0.05)'} },
          x: { ticks:{color:'#aaa'}, grid:{display:false} },
        },
        plugins: { legend: { labels: { color: '#ccc' } } },
      }
    });
  }
}

// ─── NUTRITIONIST ──────────────────────────────────────────────────────────────
async function renderNutritionistView() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="staff-dashboard">
      <header class="staff-header">
        <div class="staff-header-left">
          <span class="staff-role-badge accent-nutrition">🥗 תזונאי</span>
          <span class="staff-team-name">${currentTeam?.name ?? ''}</span>
        </div>
        <div class="staff-header-right">
          <span class="staff-name">${currentProfile?.full_name ?? ''}</span>
          <button class="btn-signout" id="nutri-signout">יציאה</button>
        </div>
      </header>
      <nav class="staff-nav">
        <button class="staff-nav-btn active" data-view="athletes">👥 שחקנים</button>
      </nav>
      <main class="staff-main" id="nutri-main">
        <div class="loading-spinner-lg">טוען...</div>
      </main>
    </div>
  `;

  document.getElementById('nutri-signout').addEventListener('click', signOut);
  const roster = await fetchTeamRoster();

  document.getElementById('nutri-main').innerHTML = renderNutriRosterHTML(roster);
  attachNutriAthleteEvents(roster);
}

// פאנל תזונאי מוטמע בתוך מסך מנהל הקבוצה
async function renderNutritionistPanel(container, roster) {
  if (!roster.length) { container.innerHTML = '<div class="empty-state">אין ספורטאים בקבוצה</div>'; return; }
  container.innerHTML = renderNutriRosterHTML(roster);
  attachNutriAthleteEvents(roster);
}

function renderNutriRosterHTML(roster) {
  if (!roster.length) return '<div class="empty-state">אין ספורטאים</div>';
  return `
    <div class="psych-roster">
      <div class="psych-roster-hint">לחץ לפתיחת הנחיות התזונה לספורטאי</div>
      ${roster.map(a => `
        <div class="psych-athlete-card" data-athlete-id="${a.athlete_id}">
          <div class="psych-avatar">${a.full_name.charAt(0)}</div>
          <div class="psych-info">
            <span class="psych-name">${a.full_name}</span>
            <span class="psych-feel-label">עומס מטרה: <span class="load-badge load-${a.targetLoad}">${translateLoad(a.targetLoad)}</span></span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function attachNutriAthleteEvents(roster) {
  document.querySelectorAll('.psych-athlete-card').forEach(card => {
    card.addEventListener('click', () => {
      const a = roster.find(r => r.athlete_id === card.dataset.athleteId);
      if (a) openNutriAthleteModal(a);
    });
  });
}

async function openNutriAthleteModal(athlete) {
  const [prevLogs] = await Promise.all([fetchMyStaffLogs(athlete.athlete_id)]);

  document.getElementById('nutri-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'nutri-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-panel glass-card">
      <button class="modal-close" id="nutri-modal-close">✕</button>
      <h3 class="modal-title">🥗 ${athlete.full_name} — תוכנית תזונה</h3>

      <div class="psych-form-block">
        <h4 class="section-label">📌 הנחיית תזונה שבועית</h4>
        <input type="text" id="nutri-focus-title" class="form-input" placeholder="כותרת (למשל: העמסת פחמימות לפני משחק)" />
        <textarea id="nutri-focus-desc" class="note-textarea" placeholder="תיאור מפורט..." rows="3"></textarea>
        <button class="btn btn-primary" id="nutri-focus-save">שמור הנחיה</button>
      </div>

      <div class="psych-form-block" style="margin-top:1rem">
        <h4 class="section-label">📝 רישום תזונתי</h4>
        <textarea id="nutri-log-input" class="note-textarea" placeholder="רישום גלוי לספורטאי..." rows="2"></textarea>
        <button class="btn btn-secondary btn-sm" id="nutri-log-save">שמור</button>
      </div>

      <div class="notes-list" style="margin-top:1.5rem">
        <h4 class="section-label">רישומים קודמים</h4>
        ${prevLogs.length ? prevLogs.slice(0,6).map(n => `
          <div class="note-item">
            <span class="note-content">${n.content}</span>
            <span class="note-date">${n.log_date}</span>
          </div>`).join('') : '<div class="notes-empty">אין רישומים קודמים</div>'}
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('nutri-modal-close').addEventListener('click', () => modal.remove());

  document.getElementById('nutri-focus-save').addEventListener('click', async () => {
    const title = document.getElementById('nutri-focus-title').value.trim();
    const desc  = document.getElementById('nutri-focus-desc').value.trim();
    if (!title) return;
    await insertCoreFocus(athlete.athlete_id, title, desc, 'nutrition');
    document.getElementById('nutri-focus-title').value = '';
    document.getElementById('nutri-focus-desc').value = '';
    document.getElementById('nutri-focus-save').textContent = '✓ נשמר';
    setTimeout(() => { document.getElementById('nutri-focus-save').textContent = 'שמור הנחיה'; }, 2000);
  });

  document.getElementById('nutri-log-save').addEventListener('click', async () => {
    const content = document.getElementById('nutri-log-input').value.trim();
    if (!content) return;
    await insertStaffLog(athlete.athlete_id, content, 'nutrition');
    document.getElementById('nutri-log-input').value = '';
    document.getElementById('nutri-log-save').textContent = '✓';
    setTimeout(() => { document.getElementById('nutri-log-save').textContent = 'שמור'; }, 2000);
  });
}

// Helper: get week label for a date
function getWeekLabel(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay() + 1);
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
}


// =============================================================================
// SECTION 13: CHART.JS VISUALIZATIONS
// =============================================================================
const CHART_DEFAULTS = {
  rpeColor:    'hsl(0, 75%, 60%)',
  feelColor:   'hsl(212, 85%, 62%)',
  rpeGlow:     'hsla(0, 75%, 60%, 0.18)',
  feelGlow:    'hsla(212, 85%, 62%, 0.15)',
  gridColor:   'hsla(210, 40%, 70%, 0.08)',
  textColor:   'hsl(220, 15%, 62%)',
  fontFamily:  'Outfit, system-ui, sans-serif',
};

function baseChartConfig() {
  return {
    plugins: {
      legend: {
        labels: {
          color: CHART_DEFAULTS.textColor,
          font: { family: CHART_DEFAULTS.fontFamily, size: 12 },
          padding: 16,
        },
      },
      tooltip: {
        backgroundColor: 'hsla(228, 30%, 10%, 0.92)',
        titleColor: 'hsl(220, 20%, 94%)',
        bodyColor:  CHART_DEFAULTS.textColor,
        borderColor: 'hsla(210, 60%, 70%, 0.15)',
        borderWidth: 1,
        padding: 12,
        titleFont: { family: CHART_DEFAULTS.fontFamily, weight: '700' },
        bodyFont:  { family: CHART_DEFAULTS.fontFamily },
      },
    },
    scales: {
      x: {
        ticks: { color: CHART_DEFAULTS.textColor, font: { family: CHART_DEFAULTS.fontFamily, size: 11 } },
        grid:  { color: CHART_DEFAULTS.gridColor },
      },
      y: {
        ticks: { color: CHART_DEFAULTS.textColor, font: { family: CHART_DEFAULTS.fontFamily, size: 11 } },
        grid:  { color: CHART_DEFAULTS.gridColor },
        min: 0, max: 10,
      },
    },
    animation: { duration: 600, easing: 'easeInOutQuart' },
    responsive: true,
    maintainAspectRatio: false,
  };
}

function renderAthleteTrendChart(canvasId, history, targetLoad, compact = false) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;

  // Destroy existing instance
  Chart.getChart(canvas)?.destroy();

  // Build last-7-days date array
  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }

  const histMap = new Map((history || []).map(h => [h.log_date, h]));

  const rpeData   = dates.map(d => histMap.get(d)?.rpe_value    ?? null);
  const feelData  = dates.map(d => histMap.get(d)?.feeling_score ?? null);
  const labels    = dates.map(d => formatDateLabel(d));

  const targetVal = TARGET_MAP[targetLoad] ? TARGET_MAP[targetLoad] * 3.33 : null;

  const datasets = [
    {
      label: 'עומס אימון (RPE)',
      data: rpeData,
      borderColor: CHART_DEFAULTS.rpeColor,
      backgroundColor: CHART_DEFAULTS.rpeGlow,
      fill: false,
      tension: 0.4,
      pointBackgroundColor: CHART_DEFAULTS.rpeColor,
      pointRadius: 5,
      pointHoverRadius: 8,
      borderWidth: 2.5,
      spanGaps: true,
    },
    {
      label: 'תחושה אישית',
      data: feelData,
      borderColor: CHART_DEFAULTS.feelColor,
      backgroundColor: CHART_DEFAULTS.feelGlow,
      fill: false,
      tension: 0.4,
      pointBackgroundColor: CHART_DEFAULTS.feelColor,
      pointRadius: 5,
      pointHoverRadius: 8,
      borderWidth: 2.5,
      borderDash: [4, 3],
      spanGaps: true,
    },
  ];

  // Target load reference line
  if (targetVal) {
    datasets.push({
      label: `עומס מטרה (${translateLoad(targetLoad)})`,
      data: dates.map(() => targetVal),
      borderColor: 'hsla(263, 70%, 65%, 0.6)',
      borderDash: [8, 4],
      pointRadius: 0,
      borderWidth: 1.5,
      fill: false,
    });
  }

  new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...baseChartConfig(),
      scales: {
        ...baseChartConfig().scales,
        y: { ...baseChartConfig().scales.y, min: 0, max: 10 },
      },
      plugins: {
        ...baseChartConfig().plugins,
        legend: { ...baseChartConfig().plugins.legend, position: compact ? 'bottom' : 'top' },
      },
    },
  });
}

function renderTeamOverviewChart(canvasId, roster) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined' || !roster.length) return;
  Chart.getChart(canvas)?.destroy();

  const statusColors = {
    GREEN:   'hsl(145, 65%, 50%)',
    YELLOW:  'hsl(45, 90%, 55%)',
    RED:     'hsl(0, 75%, 58%)',
    PENDING: 'hsl(220, 15%, 45%)',
    UNKNOWN: 'hsl(220, 15%, 45%)',
  };

  const labels = roster.map(a => a.full_name.split(' ')[0]);
  const rpeVals = roster.map(a => a.latestRPE ?? 0);
  const colors  = roster.map(a => statusColors[a.discrepancy?.status ?? 'PENDING']);

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'RPE היום',
        data: rpeVals,
        backgroundColor: colors.map(c => c.replace('hsl', 'hsla').replace(')', ', 0.75)')),
        borderColor: colors,
        borderWidth: 1.5,
        borderRadius: 6,
      }],
    },
    options: {
      ...baseChartConfig(),
      scales: {
        ...baseChartConfig().scales,
        y: { ...baseChartConfig().scales.y, min: 0, max: 10,
          title: { display: true, text: 'RPE', color: CHART_DEFAULTS.textColor, font: { family: CHART_DEFAULTS.fontFamily } }
        },
      },
      plugins: { ...baseChartConfig().plugins, legend: { display: false } },
    },
  });
}

async function renderTeamFeelingChart(canvasId, roster) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined' || !roster.length) return;
  Chart.getChart(canvas)?.destroy();

  // Fetch 7-day history for all athletes, compute daily average feeling
  const athleteIds = roster.map(a => a.athlete_id);
  const since = new Date(); since.setDate(since.getDate() - 6);
  const sinceISO = since.toISOString().split('T')[0];

  const { data: allHistory } = await _supabase.from('rpe_logs')
    .select('athlete_id, log_date, feeling_score')
    .in('athlete_id', athleteIds).gte('log_date', sinceISO)
    .order('log_date', { ascending: true });

  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }

  const avgByDate = dates.map(date => {
    const scores = (allHistory || [])
      .filter(h => h.log_date === date && h.feeling_score != null)
      .map(h => h.feeling_score);
    return scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  });

  const ctx  = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 200);
  grad.addColorStop(0, 'hsla(212, 85%, 62%, 0.35)');
  grad.addColorStop(1, 'hsla(212, 85%, 62%, 0.02)');

  new Chart(canvas, {
    type: 'line',
    data: {
      labels: dates.map(d => formatDateLabel(d)),
      datasets: [{
        label: 'תחושה ממוצעת קבוצה',
        data: avgByDate,
        borderColor: CHART_DEFAULTS.feelColor,
        backgroundColor: grad,
        fill: true,
        tension: 0.5,
        pointBackgroundColor: CHART_DEFAULTS.feelColor,
        pointRadius: 5,
        pointHoverRadius: 8,
        borderWidth: 2.5,
        spanGaps: true,
      }],
    },
    options: {
      ...baseChartConfig(),
      scales: {
        ...baseChartConfig().scales,
        y: { ...baseChartConfig().scales.y, min: 0, max: 10,
          title: { display: true, text: 'תחושה', color: CHART_DEFAULTS.textColor, font: { family: CHART_DEFAULTS.fontFamily } }
        },
      },
    },
  });
}


// =============================================================================
// SECTION 14: RENDER HELPERS
// =============================================================================
function renderTopBar(profile) {
  const pendingCount = ''; // badge shown for admins via DOM update
  return `
    <header class="top-bar glass-header">
      <div class="top-bar-brand">
        <span class="brand-icon">⚡</span>
        <span class="brand-name">Mental Power Zen</span>
        ${currentTeam ? `<span class="team-name-pill">${currentTeam.name}</span>` : ''}
      </div>
      <div class="top-bar-user">
        <span class="user-name">${profile?.full_name ?? ''}</span>
        <span class="role-badge">${translateRole(profile?.role)}</span>
        <button class="btn btn-ghost btn-sm" id="signout-btn">יציאה</button>
      </div>
    </header>
  `;
}

function renderTasksList(tasks) {
  if (!tasks?.length) return '<p class="empty-state">אין משימות להיום</p>';
  return tasks.map(renderSingleTask).join('');
}

function renderSingleTask(task) {
  return `
    <div class="task-item ${task.is_completed ? 'completed' : ''}" id="task-${task.id}">
      <input type="checkbox" class="task-checkbox" id="chk-${task.id}" data-task-id="${task.id}" ${task.is_completed ? 'checked' : ''} />
      <label for="chk-${task.id}" class="task-label">
        <span class="discipline-dot disc-${task.discipline}"></span>
        ${task.title}
      </label>
      ${task.source === 'athlete' ? `<span class="custom-badge">★</span>` : ''}
    </div>
  `;
}

function bindTaskCheckbox(taskId) {
  const chk = document.getElementById(`chk-${taskId}`);
  if (!chk) return;
  chk.addEventListener('change', async () => {
    document.getElementById(`task-${taskId}`)?.classList.toggle('completed', chk.checked);
    await toggleTask(taskId, chk.checked);
  });
}

function renderFocusItems(items) {
  if (!items?.length) return '<p class="empty-state">אין הנחיות לשבוע זה</p>';
  return items.map(f => `
    <div class="focus-item">
      <h4 class="focus-item-title">${f.title}</h4>
      ${f.description ? `<p class="focus-item-desc">${f.description}</p>` : ''}
      ${f.staff?.full_name ? `<span class="focus-author">— ${f.staff.full_name}</span>` : ''}
    </div>
  `).join('');
}


// =============================================================================
// SECTION 15: UTILITY FUNCTIONS
// =============================================================================
function getTodayISO()     { return new Date().toISOString().split('T')[0]; }
function getWeekStartISO() {
  const d = new Date(), day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return d.toISOString().split('T')[0];
}

function formatWeekDisplay(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('he-IL', { day:'numeric', month:'long', year:'numeric' });
}

function formatDateLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL', { weekday:'short', day:'numeric', month:'numeric' });
}

function translateLoad(load) {
  return { low:'קל', medium:'בינוני', high:'גבוה' }[load] ?? '—';
}

function translateRole(role) {
  return {
    team_manager:'מנהל קבוצה', coach:'מאמן ראשי', psychologist:'פסיכולוג',
    nutritionist:'תזונאי', fitness_coach:'מאמן כושר', athlete:'ספורטאי',
  }[role] ?? role ?? '—';
}

function disciplineLabel(disc) {
  return { mental:'🧠 מנטל', nutrition:'🥗 תזונה', fitness:'💪 כושר', personal:'★ אישי' }[disc] ?? disc;
}

function roleToDiscipline(role) {
  return { team_manager:'coach', coach:'coach', psychologist:'mental', nutritionist:'nutrition', fitness_coach:'fitness' }[role] ?? 'coach';
}

function getRPELabel(val) {
  const v = parseInt(val, 10);
  if (v <= 3) return 'עומס קל — ריצה קלה, מתיחות';
  if (v <= 7) return 'עומס בינוני — אימון תקני';
  return 'עומס גבוה — אימון אינטנסיבי';
}

function getFeelingLabel(val) {
  const v = parseInt(val, 10);
  if (v <= 3) return 'תחושה קשה — מומלץ לדווח לצוות';
  if (v <= 6) return 'תחושה בינונית';
  return 'תחושה טובה — מוכן לאימון';
}

function getFeelingEmoji(val) {
  const v = parseInt(val, 10);
  if (v <= 3) return '😞 ' + v;
  if (v <= 6) return '😐 ' + v;
  return '😊 ' + v;
}

function getInitials(name) {
  return (name || '??').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function setLoading(btnId, textId, spinnerId, loading) {
  const btn     = document.getElementById(btnId);
  const text    = document.getElementById(textId);
  const spinner = document.getElementById(spinnerId);
  if (btn)     btn.disabled = loading;
  if (text)    text.classList.toggle('hidden', loading);
  if (spinner) spinner.classList.toggle('hidden', !loading);
}


// =============================================================================
// SECTION 16: BOOTSTRAP
// =============================================================================
async function initApp() {
  // Safety net: if splash is still visible after 6 seconds, force auth screen
  // Prevents black screen if Supabase/network hangs during cold start
  const splashSafetyTimer = setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    if (splash && !splash.classList.contains('hidden')) {
      console.warn('[INIT] Splash safety timeout fired — forcing auth view');
      splash.classList.add('hidden');
      if (!_profileLoaded) renderView('auth');
    }
  }, 6000);

  // onAuthStateChange handles BOTH the initial session check AND subsequent changes.
  // In Supabase v2, on page load it fires INITIAL_SESSION (not SIGNED_IN) with the
  // existing session — so we must handle INITIAL_SESSION exactly like SIGNED_IN.
  _supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      clearTimeout(splashSafetyTimer);
      renderPasswordResetView(); return;
    }

    // INITIAL_SESSION fires on page load; SIGNED_IN fires after explicit login
    if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session?.user) {
      if (_routingInProgress || _profileLoaded) return;  // already handled
      _routingInProgress = true;
      clearTimeout(splashSafetyTimer);

      try {
        let profile = await loadCurrentProfile();

        // Handle pending team action (registered but team not yet created/joined)
        if (profile && !profile.team_id) {
          const pending = getCache('pending_team_action');
          if (pending) {
            if (pending.action === 'create') {
              await _supabase.rpc('create_team', { p_team_name: pending.value });
            } else {
              await _supabase.rpc('join_team', { p_code: pending.value });
            }
            clearCache('pending_team_action');
            profile = await loadCurrentProfile();
          }
        }
        routeByProfile(profile);   // clears _routingInProgress

        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
          setTimeout(() => {
            if (typeof startRealtimeUpdates === 'function')          startRealtimeUpdates();
            if (typeof requestNotificationPermission === 'function') requestNotificationPermission();
          }, 1500);
        }
      } catch (err) {
        console.error('[INIT] loadCurrentProfile failed:', err);
        _routingInProgress = false;
        renderView('auth');
      }

    } else if (event === 'INITIAL_SESSION' && !session?.user) {
      // Not logged in — show auth immediately
      clearTimeout(splashSafetyTimer);
      renderView('auth');

    } else if (event === 'SIGNED_OUT') {
      clearTimeout(splashSafetyTimer);
      _profileLoaded     = false;
      _routingInProgress = false;
      renderView('auth');
    }
  });

  // Global signout delegation
  document.addEventListener('click', e => {
    if (e.target?.id === 'signout-btn') signOut();
  });
}

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', initApp)
  : initApp();
// =============================================================================
// MISSING FUNCTIONS — יש להדביק אותן בתוך app.js
// לפני הסוגר הסופי של renderTeamManagerView או בסוף הקובץ
// =============================================================================

// =============================================================================
// attachRosterEvents — מצמיד אירועים לטבלת הרוסטר של המנהל
// =============================================================================
function attachRosterEvents(roster) {
  // כפתורי פתיחת כרטיס ספורטאי
  document.querySelectorAll('.roster-row').forEach(row => {
    row.addEventListener('click', () => {
      const athleteId   = row.dataset.athleteId;
      const athleteName = row.dataset.athleteName;
      const athlete     = roster.find(a => a.athlete_id === athleteId);
      if (athlete) openAthleteCard(athlete);
    });
  });
}

// פתיחת כרטיס ספורטאי (modal מפורט)
function openAthleteCard(athlete) {
  const existing = document.getElementById('athlete-card-modal');
  if (existing) existing.remove();

  const disc = athlete.discrepancy;
  const modal = document.createElement('div');
  modal.id = 'athlete-card-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card glass-card" style="max-width:520px;width:95%;">
      <div class="modal-header">
        <div class="athlete-avatar-lg">${athlete.full_name?.charAt(0) ?? '?'}</div>
        <div>
          <h2 style="margin:0;font-size:var(--fs-xl)">${athlete.full_name ?? 'ספורטאי'}</h2>
          <span class="badge ${disc?.badge?.css ?? 'status-grey'}">${disc?.badge?.icon ?? ''} ${disc?.badge?.label ?? 'אין מידע'}</span>
        </div>
        <button id="close-athlete-card" class="btn-icon" style="margin-right:auto">✕</button>
      </div>
      <div class="modal-body" style="margin-top:var(--sp-md)">
        <div class="stat-grid">
          <div class="stat-box">
            <span class="stat-label">RPE היום</span>
            <span class="stat-val">${athlete.latestRPE ?? '—'}</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">תחושה</span>
            <span class="stat-val">${athlete.latestFeeling ?? '—'}</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">עומס מתוכנן</span>
            <span class="stat-val">${athlete.targetLoad ?? '—'}</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">סטייה</span>
            <span class="stat-val">${disc?.variance ?? '—'}</span>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('close-athlete-card').addEventListener('click', () => modal.remove());
}


// =============================================================================
// renderAnalyticsHTML — מרנדר את טאב "ניתוח" עבור מנהל הקבוצה
// =============================================================================
async function renderAnalyticsHTML(container) {
  container.innerHTML = `<div style="text-align:center;padding:var(--sp-xl)"><div class="spinner"></div><p style="margin-top:var(--sp-md);color:var(--text-secondary)">טוען נתוני ניתוח...</p></div>`;

  const roster = await fetchTeamRoster();

  if (!roster.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📊</div>
        <h3>אין נתונים לניתוח</h3>
        <p>הוסף ספורטאים לקבוצה והם יתחילו לדווח RPE יומי.</p>
      </div>`;
    return;
  }

  const athleteIds = roster.map(a => a.athlete_id);
  const rpeHistory = await fetchTeamRPEHistoryWeeks(athleteIds, 8);

  // חישוב ממוצעים שבועיים
  const weeklyMap = {};
  rpeHistory.forEach(log => {
    const d    = new Date(log.log_date);
    const day  = d.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    d.setDate(d.getDate() + diff);
    const wk   = d.toISOString().split('T')[0];
    if (!weeklyMap[wk]) weeklyMap[wk] = { rpe: [], feeling: [] };
    if (log.rpe_value     != null) weeklyMap[wk].rpe.push(log.rpe_value);
    if (log.feeling_score != null) weeklyMap[wk].feeling.push(log.feeling_score);
  });

  const weeks   = Object.keys(weeklyMap).sort();
  const avgRpe  = weeks.map(w => (weeklyMap[w].rpe.reduce((s, v) => s + v, 0) / (weeklyMap[w].rpe.length || 1)).toFixed(1));
  const avgFeel = weeks.map(w => (weeklyMap[w].feeling.reduce((s, v) => s + v, 0) / (weeklyMap[w].feeling.length || 1)).toFixed(1));
  const labels  = weeks.map(w => formatWeekRange(w));

  // סטטוס היום
  const green  = roster.filter(a => a.discrepancy?.status === 'GREEN').length;
  const yellow = roster.filter(a => a.discrepancy?.status === 'YELLOW').length;
  const red    = roster.filter(a => a.discrepancy?.status === 'RED').length;
  const pending= roster.filter(a => a.discrepancy?.status === 'PENDING').length;

  container.innerHTML = `
    <div class="analytics-grid">

      <!-- סיכום היום -->
      <div class="analytics-section glass-card">
        <h3 class="section-title">📊 מצב היום</h3>
        <div class="disc-summary-grid">
          <div class="disc-box green"><span class="disc-num">${green}</span><span class="disc-lbl">יישור מושלם 🟢</span></div>
          <div class="disc-box yellow"><span class="disc-num">${yellow}</span><span class="disc-lbl">סטייה קלה 🟡</span></div>
          <div class="disc-box red"><span class="disc-num">${red}</span><span class="disc-lbl">סטייה קריטית 🔴</span></div>
          <div class="disc-box grey"><span class="disc-num">${pending}</span><span class="disc-lbl">ממתין ⏳</span></div>
        </div>
      </div>

      <!-- גרף RPE שבועי -->
      <div class="analytics-section glass-card">
        <h3 class="section-title">📈 ממוצע RPE קבוצתי — 8 שבועות</h3>
        <div style="position:relative;height:220px;">
          <canvas id="analytics-rpe-chart"></canvas>
        </div>
      </div>

      <!-- גרף תחושה שבועי -->
      <div class="analytics-section glass-card">
        <h3 class="section-title">💚 ממוצע תחושה קבוצתית — 8 שבועות</h3>
        <div style="position:relative;height:220px;">
          <canvas id="analytics-feel-chart"></canvas>
        </div>
      </div>

      <!-- טבלת ספורטאים -->
      <div class="analytics-section glass-card">
        <h3 class="section-title">🏅 סטטוס ספורטאים</h3>
        <div class="roster-table-wrap">
          <table class="roster-table">
            <thead>
              <tr>
                <th>ספורטאי</th>
                <th>RPE</th>
                <th>תחושה</th>
                <th>עומס מתוכנן</th>
                <th>סטטוס</th>
              </tr>
            </thead>
            <tbody>
              ${roster.map(a => `
                <tr>
                  <td><div class="athlete-mini-avatar">${a.full_name?.charAt(0) ?? '?'}</div> ${a.full_name ?? '—'}</td>
                  <td>${a.latestRPE ?? '—'}</td>
                  <td>${a.latestFeeling ?? '—'}</td>
                  <td>${a.targetLoad ?? '—'}</td>
                  <td><span class="badge ${a.discrepancy?.badge?.css ?? 'status-grey'}">${a.discrepancy?.badge?.icon ?? ''} ${a.discrepancy?.badge?.label ?? 'אין'}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // בניית גרפים
  requestAnimationFrame(() => {
    const chartDefaults = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: 'rgba(255,255,255,0.6)' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
    };

    const rpeCtx = document.getElementById('analytics-rpe-chart');
    if (rpeCtx && typeof Chart !== 'undefined') {
      new Chart(rpeCtx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'ממוצע RPE',
            data: avgRpe,
            borderColor: '#7c3aed',
            backgroundColor: 'rgba(124,58,237,0.15)',
            tension: 0.4,
            fill: true,
            pointBackgroundColor: '#7c3aed',
            pointRadius: 5,
          }],
        },
        options: { ...chartDefaults, scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, min: 1, max: 10 } } },
      });
    }

    const feelCtx = document.getElementById('analytics-feel-chart');
    if (feelCtx && typeof Chart !== 'undefined') {
      new Chart(feelCtx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'ממוצע תחושה',
            data: avgFeel,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16,185,129,0.15)',
            tension: 0.4,
            fill: true,
            pointBackgroundColor: '#10b981',
            pointRadius: 5,
          }],
        },
        options: { ...chartDefaults, scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, min: 1, max: 10 } } },
      });
    }
  });
}


// =============================================================================
// renderAdminPanel — פאנל ניהול: אישור חברים, הגדרות קבוצה
// =============================================================================
async function renderAdminPanel(container) {
  container.innerHTML = `<div style="text-align:center;padding:var(--sp-xl)"><div class="spinner"></div></div>`;

  const [pending, roster] = await Promise.all([
    fetchPendingMembers(),
    fetchTeamRoster(),
  ]);

  container.innerHTML = `
    <div class="admin-grid">

      <!-- בקשות הצטרפות ממתינות -->
      <div class="admin-section glass-card">
        <h3 class="section-title">🔔 בקשות הצטרפות ${pending.length > 0 ? `<span class="badge status-yellow">${pending.length}</span>` : ''}</h3>
        ${pending.length === 0
          ? `<p class="text-muted" style="text-align:center;padding:var(--sp-md)">אין בקשות ממתינות ✅</p>`
          : `<div class="pending-list">
              ${pending.map(m => `
                <div class="pending-item glass-card" style="padding:var(--sp-sm) var(--sp-md);display:flex;align-items:center;gap:var(--sp-sm);margin-bottom:var(--sp-sm)">
                  <div class="athlete-mini-avatar">${m.full_name?.charAt(0) ?? '?'}</div>
                  <div style="flex:1">
                    <div style="font-weight:600">${m.full_name ?? '—'}</div>
                    <div style="font-size:var(--fs-sm);color:var(--text-secondary)">${m.email ?? ''} · ${m.role ?? ''}</div>
                  </div>
                  <button class="btn btn-primary btn-sm approve-btn" data-uid="${m.id}">✓ אשר</button>
                  <button class="btn btn-ghost btn-sm reject-btn" data-uid="${m.id}">✕ דחה</button>
                </div>
              `).join('')}
            </div>`
        }
      </div>

      <!-- רוסטר פעיל -->
      <div class="admin-section glass-card">
        <h3 class="section-title">👥 חברי קבוצה פעילים (${roster.length})</h3>
        ${roster.length === 0
          ? `<p class="text-muted" style="text-align:center;padding:var(--sp-md)">אין ספורטאים פעילים עדיין</p>`
          : `<div class="roster-list">
              ${roster.map(a => `
                <div class="roster-item" style="display:flex;align-items:center;gap:var(--sp-sm);padding:var(--sp-sm) 0;border-bottom:1px solid rgba(255,255,255,0.05)">
                  <div class="athlete-mini-avatar">${a.full_name?.charAt(0) ?? '?'}</div>
                  <span style="flex:1">${a.full_name ?? '—'}</span>
                  <span class="badge ${a.discrepancy?.badge?.css ?? 'status-grey'}">${a.discrepancy?.badge?.icon ?? '⏳'}</span>
                </div>
              `).join('')}
            </div>`
        }
      </div>

      <!-- קוד הקבוצה -->
      <div class="admin-section glass-card">
        <h3 class="section-title">🔑 קוד הקבוצה</h3>
        <div style="text-align:center;padding:var(--sp-md)">
          <div class="team-code-display">${currentTeam?.code ?? '—'}</div>
          <p class="text-muted" style="margin-top:var(--sp-sm);font-size:var(--fs-sm)">שתף קוד זה עם חברי הסגל כדי שיצטרפו לקבוצה</p>
          <button class="btn btn-ghost" id="copy-team-code-btn" style="margin-top:var(--sp-sm)">📋 העתק קוד</button>
        </div>
      </div>

    </div>
  `;

  // אישור/דחיית חברים
  container.querySelectorAll('.approve-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.uid;
      btn.disabled = true; btn.textContent = '...';
      const { error } = await _supabase.from('profiles')
        .update({ status: 'active' }).eq('id', uid);
      if (!error) renderAdminPanel(container);
      else { btn.disabled = false; btn.textContent = '✓ אשר'; alert('שגיאה: ' + error.message); }
    });
  });

  container.querySelectorAll('.reject-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('לדחות את הבקשה?')) return;
      const uid = btn.dataset.uid;
      btn.disabled = true;
      const { error } = await _supabase.from('profiles')
        .update({ status: 'rejected' }).eq('id', uid);
      if (!error) renderAdminPanel(container);
      else { btn.disabled = false; alert('שגיאה: ' + error.message); }
    });
  });

  // העתקת קוד
  document.getElementById('copy-team-code-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(currentTeam?.code ?? '').then(() => {
      const btn = document.getElementById('copy-team-code-btn');
      if (btn) { btn.textContent = '✅ הועתק!'; setTimeout(() => { btn.textContent = '📋 העתק קוד'; }, 2000); }
    });
  });
}

