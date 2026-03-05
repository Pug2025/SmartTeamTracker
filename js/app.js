/* ===== App Version ===== */
const APP_VERSION = '6.2.3';

const IS_LOCAL_DEV_HOST = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const IS_SPECTATOR_MODE = !!window.__spectatorMode;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    if (IS_LOCAL_DEV_HOST) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
      } catch (_) {}
      return;
    }

    const swReloadKey = 'team-tracker-sw-version';
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      try {
        if (sessionStorage.getItem(swReloadKey) === APP_VERSION) return;
        sessionStorage.setItem(swReloadKey, APP_VERSION);
      } catch (_) {}
      window.location.reload();
    });

    try {
      const reg = await navigator.serviceWorker.register(
        `service-worker.js?v=${encodeURIComponent(APP_VERSION)}`,
        { updateViaCache: 'none' }
      );
      reg.update().catch(() => {});
    } catch (_) {}
  });
}

/* ===== IndexedDB KV helper ===== */
const idbKV = (() => {
  let dbp;
  function db(){
    if (dbp) return dbp;
    dbp = new Promise((resolve,reject)=>{
      const open = indexedDB.open('team-tracker-db',1);
      open.onupgradeneeded = () => open.result.createObjectStore('kvs');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => resolve(open.result);
    });
    return dbp;
  }
  async function get(key){
    const d = await db();
    return new Promise((res,rej)=>{
      const r = d.transaction('kvs','readonly').objectStore('kvs').get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function set(key,val){
    const d = await db();
    return new Promise((res,rej)=>{
      const w = d.transaction('kvs','readwrite').objectStore('kvs').put(val,key);
      w.onsuccess = () => res();
      w.onerror = () => rej(w.error);
    });
  }
  return {get,set};
})();

const $ = id => document.getElementById(id);
const SAVE_KEY = 'team-tracker-state';
const ROSTER_KEY = 'team-tracker-roster';
const LAST_SAVED_KEY = 'team-tracker-last-saved-gameId';
const OFFLINE_QUEUE_KEY = 'team-tracker-offline-queue';
const PREFS_KEY = 'team-tracker-prefs';
const MAX_PERIOD = 4;

let prefs = { trackPlusMinus: true };
try { const p = JSON.parse(localStorage.getItem(PREFS_KEY)); if(p) prefs = {...prefs, ...p}; } catch(_){}
function savePrefs(){ try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch(_){} }

// Shared with the live-share helpers; it must exist before init() runs because
// the setup header now hides live-share UI on first paint.
let _liveShareBannerTimer = null;

function getLocalTodayYMD(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function isLocalYMD(v){
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
function sanitizeDateInput(v){
  return isLocalYMD(v) ? v : getLocalTodayYMD();
}
function sanitizePeriod(v){
  const n = Number(v);
  if(!Number.isInteger(n)) return 1;
  return Math.min(MAX_PERIOD, Math.max(1, n));
}

/* ===== State ===== */
const state = {
  opponent:'',
  level:'U11',
  date:null,
  period:1,
  startedAt:new Date().toISOString(),
  gameId:Math.random().toString(36).slice(2),
  events:[],
  countsA:{shots:0, goals:0, softGoals:0, smothers:0, badRebounds:0, bigSaves:0},
  countsF:{shots:0, goals:0},
  team:{
    breakawaysAgainst:0,
    dzTurnovers:0,
    breakawaysFor:0,
    oddManRushFor:0,
    oddManRushAgainst:0,
    penaltiesFor:0,
    penaltiesAgainst:0,
    missedChancesFor:0,
    missedChancesAgainst:0,
    forcedTurnovers:0
  },
  roster:[],
  lastEventId:0
};

let per = {1:initP(),2:initP(),3:initP(),4:initP()};
function initP(){
  return {
    A_shots:0, A_goals:0, A_smothers:0, A_badRebounds:0, A_bigSaves:0,
    F_shots:0, F_goals:0,
    BA:0, DZ:0,
    BF:0, OMRF:0, FT:0,
    OMRA:0, PF:0, PA:0, MCF:0, MCA:0
  };
}

/* ===== UI Logic for Start/Setup ===== */
function closeHeaderMenu(){
  const menu = $('headerMenu');
  if(menu) menu.classList.remove('open');
}

function setInGameHeader(inGame){
  const scoreboardRow = $('scoreboardRow');
  if(scoreboardRow) scoreboardRow.style.display = inGame ? 'grid' : 'none';

  const shareBtn = $('btnShareLive');
  if(shareBtn) shareBtn.style.display = inGame ? 'inline-flex' : 'none';

  const editBtn = $('btnEditSetup');
  if(editBtn) editBtn.style.display = inGame ? '' : 'none';

  const rosterBtn = $('btnRoster');
  if(rosterBtn) rosterBtn.style.display = inGame ? '' : 'none';

  if(!inGame){
    $('qualityBarWrap').style.display = 'none';
    hideLiveShareBanner();
  }

  document.body.classList.toggle('in-game', inGame);
  closeHeaderMenu();
}

function toggleSetup(showSetup){
  if(showSetup){
    $('setupContainer').style.display='block';
    $('gameControls').style.display='none';
    $('btnUndo').style.display='none';
    setInGameHeader(false);
  } else {
    $('setupContainer').style.display='none';
    $('gameControls').style.display='block';
    $('btnUndo').style.display='flex';
    setInGameHeader(true);
  }
}
$('btnStartGame').addEventListener('click', ()=>{
  // Always pull current setup values (prevents stale state issues)
  state.opponent = ($('opponent').value || '').trim();
  state.level = $('level').value || 'U11';

  state.date = sanitizeDateInput($('date').value);
  $('date').value = state.date;

  save();
  validateState('start game');
  toggleSetup(false);
  vibrate(HAPTIC.tap);
});

$('btnEditSetup').addEventListener('click', ()=>{ toggleSetup(true); });

/* ===== Cloud status helper ===== */
function setCloudStatus(text, tone){
  const el = $('cloudStatus');
  if(!el) return;
  el.textContent = text;
  el.classList.remove('good','warn','bad');
  el.dataset.tone = tone || '';
  if(tone) el.classList.add(tone);
}
function refreshCloudStatus(){
  try{
    const last = localStorage.getItem(LAST_SAVED_KEY);
    if(last && last === state.gameId){
      setCloudStatus('Synced','good');
    } else {
      // default to connectivity status (set by ping)
      // no-op here; pingCloud will set it
    }
  }catch(_){}
}

/* Make cloud pill useful: ping /api/ping to show online/offline */
let lastCloudPingAt = 0;
async function pingCloud(){
  // If this game is already synced, keep that status.
  const el = $('cloudStatus');
  if(el && /Synced/i.test(el.textContent)) return;

  try{
    setCloudStatus('Checking','warn');
    const ctrl = new AbortController();
    const to = setTimeout(()=>ctrl.abort(), 2500);

    const res = await fetch('/api/ping', { cache:'no-store', signal: ctrl.signal });
    clearTimeout(to);

    if(res.ok){
      setCloudStatus('Online','good');
      flushOfflineQueue();
    } else {
      setCloudStatus('Offline','bad');
    }
  }catch(_){
    setCloudStatus('Offline','bad');
  } finally {
    lastCloudPingAt = Date.now();
  }
}

/* ===== Persistence ===== */
async function persistStorage(){
  try{
    if(navigator.storage && navigator.storage.persist){
      await navigator.storage.persist();
    }
  }catch(_){}
}
async function save(){
  if(IS_SPECTATOR_MODE) return;
  try{
    const json = JSON.stringify(state);
    localStorage.setItem(SAVE_KEY,json);
    await idbKV.set(SAVE_KEY,json);
  }catch(_){}
  // Push to live spectator API if sharing
  if(state.shareCode) pushLiveState();
}
async function load(){
  try{
    const v = await idbKV.get(SAVE_KEY);
    if(v) return JSON.parse(v);
  }catch(_){}
  try{
    const v = localStorage.getItem(SAVE_KEY);
    if(v) return JSON.parse(v);
  }catch(_){}
  return null;
}

/* Autosave & lifecycle saves (crash safety) */
if(!IS_SPECTATOR_MODE){
  setInterval(()=>save(), 4000);
  window.addEventListener('pagehide', ()=>save());
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'hidden') save();
  });
}

/* Periodic cloud ping (lightweight) */
if(!IS_SPECTATOR_MODE){
  setInterval(()=>{
    // ping more often during a live game; otherwise just leave whatever state is shown
    const live = (state.events && state.events.length>0) || ($('gameControls') && $('gameControls').style.display==='block');
    if(!live) return;
    if(Date.now() - lastCloudPingAt < 30000) return;
    pingCloud();
  }, 5000);
}

/* ===== Helpers ===== */
const HAPTIC = {
  tap: 15,
  goal: [40, 30, 40],
  goalAgainst: [80, 40, 80],
  period: [20, 15, 20, 15, 20],
  undo: [10, 20, 10],
  save: [30, 20, 30, 20, 60],
  error: [100, 50, 100]
};

/* Haptic feedback with Android vibrate + iOS audio-tick fallback */
let _hapticCtx = null;
function vibrate(pattern=20){
  // Android / Chrome: use vibration API
  try { if(navigator.vibrate) { navigator.vibrate(pattern); return; } } catch(_){}
  // iOS / Safari fallback: play a tiny inaudible tick via AudioContext
  // This triggers the system haptic engine on iOS when paired with user gesture
  try {
    if(!_hapticCtx) _hapticCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(_hapticCtx.state === 'suspended') _hapticCtx.resume();
    const osc = _hapticCtx.createOscillator();
    const gain = _hapticCtx.createGain();
    gain.gain.value = 0.001; // nearly silent
    osc.connect(gain);
    gain.connect(_hapticCtx.destination);
    osc.frequency.value = 1;
    osc.start();
    osc.stop(_hapticCtx.currentTime + 0.01);
  } catch(_){}
}

/* Status toast (replaces alert) */
let statusToastTimer = null;
function showStatusToast(msg, type='success', duration=2500){
  const el = $('statusToast');
  el.textContent = msg;
  el.className = 'status-toast ' + type;
  requestAnimationFrame(()=>el.classList.add('show'));
  if(statusToastTimer) clearTimeout(statusToastTimer);
  statusToastTimer = setTimeout(()=>{
    el.classList.remove('show');
    statusToastTimer = null;
  }, duration);
}

/* Confirm modal (replaces confirm()) */
function showConfirm(msg){
  return new Promise(resolve => {
    $('confirmMsg').textContent = msg;
    $('confirmOverlay').style.display = 'flex';
    function cleanup(){ $('confirmOverlay').style.display = 'none'; }
    $('confirmOk').onclick = ()=>{ cleanup(); resolve(true); };
    $('confirmCancel').onclick = ()=>{ cleanup(); resolve(false); };
    $('confirmOverlay').onclick = (e)=>{ if(e.target === $('confirmOverlay')){ cleanup(); resolve(false); }};
  });
}
window.showAppConfirm = showConfirm;

function highlightPeriod(){
  [...$('periodChips').children].forEach(ch=>{
    const p = Number(ch.dataset.p);
    ch.classList.toggle('active', p===state.period);
  });
}

function fmtTime(iso){
  const d=new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function isNumStr(x){ return typeof x==='string' && /^\d+$/.test(x.trim()); }
function sortRoster(arr){
  // numeric first, then alpha; stable-ish
  return [...arr].sort((a,b)=>{
    const an = isNumStr(String(a)) ? Number(a) : null;
    const bn = isNumStr(String(b)) ? Number(b) : null;
    if(an!==null && bn!==null) return an-bn;
    if(an!==null) return -1;
    if(bn!==null) return 1;
    return String(a).localeCompare(String(b));
  });
}
function ensureRosterNumber(num){
  const n = String(num||'').trim();
  if(!isNumStr(n)) return;
  const roster = new Set((state.roster||[]).map(x=>String(x).trim()).filter(Boolean));
  if(!roster.has(n)){
    roster.add(n);
    state.roster = sortRoster([...roster]);
    try{ localStorage.setItem(ROSTER_KEY, JSON.stringify(state.roster)); }catch(_){}
    if (window.TeamManager) window.TeamManager.syncRosterToActiveTeam(state.roster);
    save();
  }
}

/* ===== Event accounting ===== */
function bump(type, period){
  const p = per[period] || per[4];

  if(type==='shot'){
    state.countsA.shots++; p.A_shots++;
  }else if(type==='goal'){
    state.countsA.shots++; state.countsA.goals++;
    p.A_shots++; p.A_goals++;
  }else if(type==='soft_goal'){
    state.countsA.shots++; state.countsA.goals++; state.countsA.softGoals++;
    p.A_shots++; p.A_goals++;
  }else if(type==='smother'){
    state.countsA.smothers++; p.A_smothers++;
  }else if(type==='bad_rebound'){
    state.countsA.shots++; state.countsA.badRebounds++;
    p.A_shots++; p.A_badRebounds++;
  }else if(type==='big_save'){
    state.countsA.bigSaves++; state.countsA.shots++;
    p.A_bigSaves++; p.A_shots++;
  }else if(type==='for_shot'){
    state.countsF.shots++; p.F_shots++;
  }else if(type==='for_goal'){
    state.countsF.shots++; state.countsF.goals++;
    p.F_shots++; p.F_goals++;
  }else if(type==='breakaway_against'){
    state.team.breakawaysAgainst++; p.BA++;
  }else if(type==='dz_turnover'){
    state.team.dzTurnovers++; p.DZ++;
  }else if(type==='breakaway_for'){
    state.team.breakawaysFor++; p.BF++;
  }else if(type==='odd_man_rush_for'){
    state.team.oddManRushFor++; p.OMRF++;
  }else if(type==='odd_man_rush_against'){
    state.team.oddManRushAgainst++; p.OMRA++;
  }else if(type==='penalty_for'){
    state.team.penaltiesFor++; p.PF++;
  }else if(type==='penalty_against'){
    state.team.penaltiesAgainst++; p.PA++;
  }else if(type==='missed_chance_for'){
    state.team.missedChancesFor++; p.MCF++;
  }else if(type==='missed_chance_against'){
    state.team.missedChancesAgainst++; p.MCA++;
  }else if(type==='forced_turnover'){
    state.team.forcedTurnovers++; p.FT++;
  }
}

function rebuildFromEvents(){
  per = {1:initP(),2:initP(),3:initP(),4:initP()};
  state.countsA = {shots:0, goals:0, softGoals:0, smothers:0, badRebounds:0, bigSaves:0};
  state.countsF = {shots:0, goals:0};
  state.team = {breakawaysAgainst:0, dzTurnovers:0, breakawaysFor:0, oddManRushFor:0, oddManRushAgainst:0, penaltiesFor:0, penaltiesAgainst:0, missedChancesFor:0, missedChancesAgainst:0, forcedTurnovers:0};

  for(const ev of state.events){
    bump(ev.type, ev.period);
  }
}

function validateState(source='unknown'){
  const issues = [];
  if(!Number.isInteger(state.period) || state.period < 1 || state.period > MAX_PERIOD){
    issues.push(`period out of range: ${state.period}`);
  }
  if(!isLocalYMD(state.date)){
    issues.push(`invalid date format: ${state.date}`);
  }

  const nonNeg = [
    ['countsA.shots', state.countsA.shots],
    ['countsA.goals', state.countsA.goals],
    ['countsF.shots', state.countsF.shots],
    ['countsF.goals', state.countsF.goals],
    ['team.breakawaysAgainst', state.team.breakawaysAgainst],
    ['team.dzTurnovers', state.team.dzTurnovers],
    ['team.breakawaysFor', state.team.breakawaysFor],
    ['team.oddManRushFor', state.team.oddManRushFor],
    ['team.oddManRushAgainst', state.team.oddManRushAgainst],
    ['team.penaltiesFor', state.team.penaltiesFor],
    ['team.penaltiesAgainst', state.team.penaltiesAgainst],
    ['team.missedChancesFor', state.team.missedChancesFor],
    ['team.missedChancesAgainst', state.team.missedChancesAgainst],
    ['team.forcedTurnovers', state.team.forcedTurnovers]
  ];
  for(const [k,v] of nonNeg){
    if(typeof v !== 'number' || v < 0){
      issues.push(`${k} is negative/invalid: ${v}`);
    }
  }
  if(state.countsA.goals > state.countsA.shots){
    issues.push(`goals against exceeds shots against (${state.countsA.goals} > ${state.countsA.shots})`);
  }

  const expectedPer = {1:initP(),2:initP(),3:initP(),4:initP()};
  const expectedA = {shots:0, goals:0, softGoals:0, smothers:0, badRebounds:0, bigSaves:0};
  const expectedF = {shots:0, goals:0};
  const expectedTeam = {breakawaysAgainst:0, dzTurnovers:0, breakawaysFor:0, oddManRushFor:0, oddManRushAgainst:0, penaltiesFor:0, penaltiesAgainst:0, missedChancesFor:0, missedChancesAgainst:0, forcedTurnovers:0};
  for(const ev of state.events){
    const p = expectedPer[sanitizePeriod(ev.period)] || expectedPer[4];
    if(ev.type==='shot'){ expectedA.shots++; p.A_shots++; }
    else if(ev.type==='goal'){ expectedA.shots++; expectedA.goals++; p.A_shots++; p.A_goals++; }
    else if(ev.type==='soft_goal'){ expectedA.shots++; expectedA.goals++; expectedA.softGoals++; p.A_shots++; p.A_goals++; }
    else if(ev.type==='smother'){ expectedA.smothers++; p.A_smothers++; }
    else if(ev.type==='bad_rebound'){ expectedA.shots++; expectedA.badRebounds++; p.A_shots++; p.A_badRebounds++; }
    else if(ev.type==='big_save'){ expectedA.bigSaves++; expectedA.shots++; p.A_bigSaves++; p.A_shots++; }
    else if(ev.type==='for_shot'){ expectedF.shots++; p.F_shots++; }
    else if(ev.type==='for_goal'){ expectedF.shots++; expectedF.goals++; p.F_shots++; p.F_goals++; }
    else if(ev.type==='breakaway_against'){ expectedTeam.breakawaysAgainst++; p.BA++; }
    else if(ev.type==='dz_turnover'){ expectedTeam.dzTurnovers++; p.DZ++; }
    else if(ev.type==='breakaway_for'){ expectedTeam.breakawaysFor++; p.BF++; }
    else if(ev.type==='odd_man_rush_for'){ expectedTeam.oddManRushFor++; p.OMRF++; }
    else if(ev.type==='odd_man_rush_against'){ expectedTeam.oddManRushAgainst++; p.OMRA++; }
    else if(ev.type==='penalty_for'){ expectedTeam.penaltiesFor++; p.PF++; }
    else if(ev.type==='penalty_against'){ expectedTeam.penaltiesAgainst++; p.PA++; }
    else if(ev.type==='missed_chance_for'){ expectedTeam.missedChancesFor++; p.MCF++; }
    else if(ev.type==='missed_chance_against'){ expectedTeam.missedChancesAgainst++; p.MCA++; }
    else if(ev.type==='forced_turnover'){ expectedTeam.forcedTurnovers++; p.FT++; }
  }

  if(JSON.stringify(expectedA) !== JSON.stringify(state.countsA)) issues.push('countsA mismatch vs event log');
  if(JSON.stringify(expectedF) !== JSON.stringify(state.countsF)) issues.push('countsF mismatch vs event log');
  if(JSON.stringify(expectedTeam) !== JSON.stringify(state.team)) issues.push('team totals mismatch vs event log');
  if(JSON.stringify(expectedPer) !== JSON.stringify(per)) issues.push('period totals mismatch vs event log');

  const saves = state.countsA.shots - state.countsA.goals;
  if(saves < 0) issues.push(`negative saves computed (${saves})`);
  const sv = state.countsA.shots ? (saves/state.countsA.shots) : 0;
  if(!Number.isFinite(sv)) issues.push('save percentage is not finite');

  if(issues.length){
    console.error('[validateState] invariant violations after', source, issues, {
      period: state.period,
      date: state.date,
      countsA: state.countsA,
      countsF: state.countsF,
      team: state.team,
      per,
      events: state.events
    });
  }
  return issues.length === 0;
}

const pendingGood = new Map();
let lastShotEventId = null; // tracks the most recent shot/big_save for linking

/* Schedule a "good rebound" credit for a shot/big_save event.
   Each event gets its own independent 4s timer. A new shot only cancels the
   immediately preceding shot's timer (back-to-back shots imply an uncontrolled
   rebound), but does NOT cancel older timers that have already been running. */
function scheduleGoodReboundCredit(id){
  // A new shot/big_save means the PREVIOUS shot's rebound wasn't controlled
  // (puck came back out as another shot). Cancel only that one.
  if(lastShotEventId !== null && pendingGood.has(lastShotEventId)){
    clearTimeout(pendingGood.get(lastShotEventId));
    pendingGood.delete(lastShotEventId);
  }
  lastShotEventId = id;

  const to = setTimeout(()=>{
    const ev = state.events.find(e=>e.id===id);
    if(ev && !ev.goodRebound){
      ev.goodRebound = true;
      save();
      renderAll();
    }
    pendingGood.delete(id);
    if(lastShotEventId === id) lastShotEventId = null;
  }, 4000);

  pendingGood.set(id, to);
}

/* Cancel ALL pending credits.
   Called when a definitive outcome happens (smother/bad rebound/goal). */
function cancelRecentGoodCredit(){
  if(!pendingGood.size) return;
  for(const [pid, to] of pendingGood.entries()){
    clearTimeout(to);
    pendingGood.delete(pid);
  }
  lastShotEventId = null;
}

/* If the specific event is pending, clear it. */
function clearGoodPendingFor(id){
  if(!pendingGood.has(id)) return;
  clearTimeout(pendingGood.get(id));
  pendingGood.delete(id);
  if(lastShotEventId === id) lastShotEventId = null;
}

/* Offensive breakaway timing */
let lastBreakawayForTap = 0;

/* Track most recent "shot" event for linking with big_save/bad_rebound */
let lastShotAgainstTime = 0;
let lastShotAgainstId = null;
const SHOT_LINK_WINDOW = 3000; // 3 seconds

function addEvent(type, meta={}){
  // If big_save or bad_rebound is tapped within 3s of a plain "shot", upgrade
  // that shot event instead of creating a second SA.
  if(type === 'big_save' || type === 'bad_rebound'){
    const now = Date.now();
    if(lastShotAgainstId !== null && (now - lastShotAgainstTime) <= SHOT_LINK_WINDOW){
      const prevIdx = state.events.findIndex(e => e.id === lastShotAgainstId && e.type === 'shot');
      if(prevIdx !== -1){
        const prev = state.events[prevIdx];
        // Revert the old "shot" counts
        revert(prev);
        // Upgrade it
        prev.type = type;
        // Re-apply with new type
        bump(type, prev.period);
        // Handle good rebound credit
        clearGoodPendingFor(prev.id);
        if(type === 'bad_rebound') cancelRecentGoodCredit();
        if(type === 'big_save') scheduleGoodReboundCredit(prev.id);
        lastShotAgainstId = null;
        lastShotAgainstTime = 0;
        save();
        validateState(`upgrade:${type}`);
        renderAll();
        vibrate(HAPTIC.tap);
        return prev;
      }
    }
  }

  const ev = {
    id: ++state.lastEventId,
    type,
    tISO:new Date().toISOString(),
    period: sanitizePeriod(state.period),
    ...meta
  };

  // Track plain shots for linking
  if(type === 'shot'){
    lastShotAgainstTime = Date.now();
    lastShotAgainstId = ev.id;
  }

  // If a follow-up outcome happens, cancel the pending "good rebound" credit
  // (shot → smother means no rebound; shot → bad rebound means rebound was bad; goal ends the sequence)
  if(type === 'smother' || type === 'bad_rebound' || type === 'goal' || type === 'soft_goal'){
    cancelRecentGoodCredit();
  }

  const isGoalAgainst = (type === 'goal' || type === 'soft_goal');
  const isGoalFor = (type === 'for_goal');

  state.events.push(ev);
  bump(type, state.period);

  // Tag Goals For context (Breakaway / Odd Man Rush / Other)
  if(isGoalFor){
    tagGFCause(ev);
  }

  // Always tag GA causes first (BA/DZ/BR can all apply)
  if(isGoalAgainst){
    tagGACause(ev);

    // auto-context shortcuts:
    // - Pure breakaway goal: auto-set Breakaway and skip modal
    // - Pure rebound goal (bad rebound within 5s, no BA/DZ): auto-set Rebound and skip modal
    const pureBreakaway = !!ev.ga_ba && !ev.ga_dz && !ev.ga_br;
    const pureRebound = !!ev.ga_br && !ev.ga_ba && !ev.ga_dz;

    if(pureBreakaway){
      ev.ga_ctx = 'Breakaway';
      ev.needsContext = false;
      save();
    } else if(pureRebound){
      ev.ga_ctx = 'Net-Front Scramble';
      ev.needsContext = false;
      save();
    } else {
      openGAContext(ev);
    }
  }

  save();
  validateState(`addEvent:${type}`);
  renderAll();

  if(type==='goal' || type==='soft_goal'){
    triggerPulse('liveGA','bad');
    goalFlash('bad');
    vibrate(HAPTIC.goalAgainst);
  } else if(type==='for_goal'){
    triggerPulse('liveGF','good');
    goalFlash('good');
    vibrate(HAPTIC.goal);
  } else {
    vibrate(HAPTIC.tap);
  }

  if (type === 'shot' || type === 'big_save') scheduleGoodReboundCredit(ev.id);

  return ev;
}

function triggerPulse(elemId, type){
  const el = $(elemId);
  if(!el) return;
  el.classList.remove('pulse-good', 'pulse-bad');
  void el.offsetWidth;
  el.classList.add(type==='good'?'pulse-good':'pulse-bad');
}
function flashBtn(btnEl){
  if(!btnEl) return;
  btnEl.classList.remove('flash');
  void btnEl.offsetWidth;
  btnEl.classList.add('flash');
}
function goalFlash(type){
  const el = document.createElement('div');
  el.className = `goal-flash ${type}`;
  document.body.appendChild(el);
  el.addEventListener('animationend', ()=>el.remove());
}

function undo(){
  const ev = state.events.pop();
  if(!ev) return;
  revert(ev);
  validateState('undo');
  renderAll();
  vibrate(HAPTIC.undo);
}
function revert(ev){
  clearGoodPendingFor(ev.id);
  const p = per[ev.period] || per[4];

  if(ev.type==='shot'){ state.countsA.shots--; p.A_shots--; }
  else if(ev.type==='goal'){ state.countsA.shots--; state.countsA.goals--; p.A_shots--; p.A_goals--; }
  else if(ev.type==='soft_goal'){ state.countsA.shots--; state.countsA.goals--; state.countsA.softGoals--; p.A_shots--; p.A_goals--; }
  else if(ev.type==='smother'){ state.countsA.smothers--; p.A_smothers--; }
  else if(ev.type==='bad_rebound'){ state.countsA.shots--; state.countsA.badRebounds--; p.A_shots--; p.A_badRebounds--; }
  else if(ev.type==='big_save'){ state.countsA.bigSaves--; state.countsA.shots--; p.A_bigSaves--; p.A_shots--; }
  else if(ev.type==='for_shot'){ state.countsF.shots--; p.F_shots--; }
  else if(ev.type==='for_goal'){ state.countsF.shots--; state.countsF.goals--; p.F_shots--; p.F_goals--; }
  else if(ev.type==='breakaway_against'){ state.team.breakawaysAgainst--; p.BA--; }
  else if(ev.type==='dz_turnover'){ state.team.dzTurnovers--; p.DZ--; }
  else if(ev.type==='breakaway_for'){ state.team.breakawaysFor--; p.BF--; }
  else if(ev.type==='odd_man_rush_for'){ state.team.oddManRushFor--; p.OMRF--; }
  else if(ev.type==='odd_man_rush_against'){ state.team.oddManRushAgainst--; p.OMRA--; }
  else if(ev.type==='penalty_for'){ state.team.penaltiesFor--; p.PF--; }
  else if(ev.type==='penalty_against'){ state.team.penaltiesAgainst--; p.PA--; }
  else if(ev.type==='missed_chance_for'){ state.team.missedChancesFor--; p.MCF--; }
  else if(ev.type==='missed_chance_against'){ state.team.missedChancesAgainst--; p.MCA--; }
  else if(ev.type==='forced_turnover'){ state.team.forcedTurnovers--; p.FT--; }

  save();
  validateState(`revert:${ev.type}`);
}

/* Undo Hold Logic */
let undoHoldTimer = null, undoHeld = false, undoPointerActive = false;
function startUndoHold(){
  if(undoPointerActive)return;
  undoPointerActive=true;
  undoHeld=false;
  undoHoldTimer=setTimeout(()=>{undoHeld=true;showUndoModal();},600);
}
function finishUndo(){
  if(!undoPointerActive)return;
  undoPointerActive=false;
  if(undoHoldTimer){clearTimeout(undoHoldTimer);undoHoldTimer=null;}
  if(!undoHeld){undo();}
}
function cancelUndoHold(){
  if(!undoPointerActive)return;
  undoPointerActive=false;
  if(undoHoldTimer){clearTimeout(undoHoldTimer);undoHoldTimer=null;}
}
const undoBtn = $('btnUndo');
if(undoBtn){
  undoBtn.addEventListener('pointerdown',startUndoHold);
  undoBtn.addEventListener('pointerup',finishUndo);
  undoBtn.addEventListener('pointerleave',cancelUndoHold);
  undoBtn.addEventListener('pointercancel',cancelUndoHold);
}

/* Undo Modal */
let lastRemoved = null, toastTimer = null;
function showUndoModal(){
  const listEl = $('undoList');
  const recent = state.events.slice(-5);
  listEl.innerHTML = recent.length
    ? recent.map(ev=>`<div class="undoRow" data-id="${ev.id}">P${ev.period} • ${fmtTime(ev.tISO)} — ${labelFor(ev)}</div>`).reverse().join('')
    : `<div class="small">No events.</div>`;
  $('undoModal').style.display = 'flex';
}
$('undoList').addEventListener('click', e => {
  const row = e.target.closest('.undoRow');
  if(!row)return;
  const id = Number(row.dataset.id);
  const idx = state.events.findIndex(ev => ev.id === id);
  if(idx===-1) return;
  const [ev] = state.events.splice(idx,1);
  revert(ev);
  lastRemoved = ev;
  $('undoModal').style.display='none';
  showToast('Removed.');
  renderAll();
});
$('undoClose').addEventListener('click', ()=>$('undoModal').style.display='none');
function showToast(msg){
  const t=$('toast');
  t.firstChild.nodeValue = msg+' ';
  t.style.display='block';
  if(toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast,3500);
}
function hideToast(){
  $('toast').style.display='none';
  if(toastTimer){clearTimeout(toastTimer);toastTimer=null;}
}
$('toastRestore').addEventListener('click', ()=>{
  if(!lastRemoved){ hideToast(); return; }
  const ev = lastRemoved;
  lastRemoved=null;
  state.events.push(ev);
  state.events.sort((a,b)=>new Date(a.tISO)-new Date(b.tISO));
  rebuildFromEvents();
  save();
  validateState('toast restore');
  renderAll();
  hideToast();
});

/* Labels */
function labelFor(ev){
  let label = ev.type
    .replace('soft_goal','Soft Goal')
    .replace('bad_rebound','Bad Rebound')
    .replace('big_save','Big Save')
    .replace('for_shot','Our Shot')
    .replace('for_goal','Our Goal')
    .replace('breakaway_against','Breakaway Ag')
    .replace('dz_turnover','DZ Turnover')
    .replace('breakaway_for','Breakaway For')
    .replace('odd_man_rush_for','Odd Man Rush For')
    .replace('odd_man_rush_against','Odd Man Rush Ag')
    .replace('penalty_for','Penalty For')
    .replace('penalty_against','Penalty Against')
    .replace('missed_chance_for','Missed Chance For')
    .replace('missed_chance_against','Missed Chance Ag')
    .replace('forced_turnover','Forced Turnover')
    .replace(/_/g,' ');

  if(ev.type==='for_goal'){
    const s = ev.player && ev.player!=='?' ? ev.player : 'Unknown';
    const a = (ev.assist===null || ev.assist===undefined) ? '—' : (ev.assist==='?' ? 'Unknown' : ev.assist);
    label = `Our Goal (#${s}) A: ${a==='—' ? '—' : '#'+a}`;

    if(ev.off_ctx === 'Breakaway') label += ' [BA]';
    else if(ev.off_ctx === 'Odd Man Rush') label += ' [OMR]';
    else if(ev.off_ctx === 'Forced Turnover') label += ' [FT]';
  }

  if((ev.type==='for_shot')&&ev.player&&ev.player!=='?'&&ev.player!=='Unknown') {
    label+=` (#${ev.player})`;
  }
  return label;
}

/* GA Context */
const GA_TAGS = ['Screen','Deflection/Tip','Cross-Crease','Odd-Man Rush','Net-Front Scramble','Clean Look','Other'];
const SOFT_GA_TAGS = ['Misplay','Poor Positioning','Other'];
let lastGAEvent = null;
function openGAContext(ev){
  lastGAEvent = ev;

  // if we're opening the modal, we're actively tagging now
  lastGAEvent.needsContext = false;
  save();

  const tags = (ev.type === 'soft_goal') ? SOFT_GA_TAGS : GA_TAGS;
  $('gaGrid').innerHTML = tags.map(t=>`<div class="pickerBtn" data-t="${t}">${t}</div>`).join('');
  $('gaOverlay').style.display = 'flex';
}

$('gaGrid').addEventListener('click', e=>{
  const chip=e.target.closest('.pickerBtn');
  if(!chip||!lastGAEvent)return;
  lastGAEvent.ga_ctx=chip.dataset.t;
  lastGAEvent.needsContext = false;
  save();
  $('gaOverlay').style.display='none';
  renderAll();

  if(prefs.trackPlusMinus){
    openMultiPicker({title:'5 Players On Ice (for +/-)', max:5, event:lastGAEvent, field:'onIce', exclude:[]});
  } else {
    openStrengthPicker(lastGAEvent, 'Our Team\'s Situation (required)');
  }
  lastGAEvent=null;
});
$('gaSkip').addEventListener('click', ()=>{
  $('gaOverlay').style.display='none';
  if(lastGAEvent){
    lastGAEvent.needsContext = true;
    save();
    renderAll();

    if(prefs.trackPlusMinus){
      openMultiPicker({title:'5 Players On Ice (optional)', max:5, event:lastGAEvent, field:'onIce', exclude:[]});
    } else {
      openStrengthPicker(lastGAEvent, 'Our Team\'s Situation (required)');
    }
  }
});

/* BR window = 5s; BA/DZ window = 10s */
function tagGACause(gaEv){
  const tGA = new Date(gaEv.tISO).getTime();

  // BA/DZ window = 10s
  let windowStart = tGA - 10000;

  // Prevent bleed across goals:
  // only allow context events after the previous GA/soft GA
  for(let i = state.events.length - 1; i >= 0; i--){
    const ev = state.events[i];
    if(ev === gaEv) continue;

    const t = new Date(ev.tISO).getTime();
    if(t >= tGA) continue;

    if(ev.type === 'goal' || ev.type === 'soft_goal'){
      windowStart = Math.max(windowStart, t + 1);
      break;
    }
  }

  const brWindowStart = Math.max(windowStart, tGA - 5000); // BR window = 5s

  let hasBA = false, hasDZ = false, hasBR = false, hasOMRA = false;

  for(const ev of state.events){
    const t = new Date(ev.tISO).getTime();
    if(t > tGA) continue;

    // BA/DZ/OMRA check within 10s window
    if(t >= windowStart){
      if(ev.type === 'breakaway_against') hasBA = true;
      if(ev.type === 'dz_turnover') hasDZ = true;
      if(ev.type === 'odd_man_rush_against') hasOMRA = true;
    }

    // BR check within 5s window
    if(t >= brWindowStart){
      if(ev.type === 'bad_rebound') hasBR = true;
    }
  }

  const parts = [];
  gaEv.ga_ba = !!hasBA;
  gaEv.ga_dz = !!hasDZ;
  gaEv.ga_br = !!hasBR;
  gaEv.ga_omra = !!hasOMRA;

  if(gaEv.ga_ba) parts.push('BA');
  if(gaEv.ga_dz) parts.push('DZ');
  if(gaEv.ga_br) parts.push('BR');
  if(gaEv.ga_omra) parts.push('OMRA');

  gaEv.ga_cause = parts.length ? parts.join('+') : 'other';
  save();
}

/* Goals For context tagging (10s window, no bleed across Goals For) */
function tagGFCause(gfEv){
  const tGF = new Date(gfEv.tISO).getTime();

  // 10s window for offensive context
  let windowStart = tGF - 10000;

  // Prevent bleed across Goals For:
  // only allow context events after the previous for_goal
  for(let i = state.events.length - 1; i >= 0; i--){
    const ev = state.events[i];
    if(ev === gfEv) continue;

    const t = new Date(ev.tISO).getTime();
    if(t >= tGF) continue;

    if(ev.type === 'for_goal'){
      windowStart = Math.max(windowStart, t + 1);
      break;
    }
  }

  let hasBA = false;
  let hasOMR = false;
  let hasFT = false;

  for(const ev of state.events){
    const t = new Date(ev.tISO).getTime();
    if(t < windowStart || t > tGF) continue;

    if(ev.type === 'breakaway_for') hasBA = true;
    if(ev.type === 'odd_man_rush_for') hasOMR = true;
    if(ev.type === 'forced_turnover') hasFT = true;
  }

  // Priority: Breakaway > Odd Man Rush > Forced Turnover > Other
  if(hasBA) gfEv.off_ctx = 'Breakaway';
  else if(hasOMR) gfEv.off_ctx = 'Odd Man Rush';
  else if(hasFT) gfEv.off_ctx = 'Forced Turnover';
  else gfEv.off_ctx = 'Other';

  save();
}

/* Multi Picker */
let multiPick = {selected:new Set(), unknowns:0, max:5, exclude:new Set(), eventRef:null, field:'onIce'};
function openMultiPicker({title,max,event,field,exclude}){
  multiPick={selected:new Set(), unknowns:0, max, exclude:new Set(exclude||[]), eventRef:event, field};
  $('onIceTitle').textContent=title;
  $('onIceMax').textContent=String(max);
  $('onIceModal').style.display='flex';
  buildOnIceGrid();
  updateOnIceMeta();
}
function buildOnIceGrid(){
  const roster=sortRoster((state.roster||[]).map(x=>String(x).trim()).filter(Boolean));
  const uniq=Array.from(new Set(roster)).filter(n=>!multiPick.exclude.has(n));
  $('onIceGrid').innerHTML=uniq.length
    ? uniq.map(n=>`<div class="pickerBtn ${multiPick.selected.has(n)?'selected':''}" data-n="${n}">#${n}</div>`).join('')
    : `<div class="small" style="grid-column:1/-1;">No roster yet.</div>`;
}
function totalSelected(){
  return multiPick.selected.size + multiPick.unknowns;
}
function updateOnIceMeta(){
  $('onIceCount').textContent=String(totalSelected());
  $('onIceUnknownBadge').textContent=`Unknown ×${multiPick.unknowns}`;
}
$('onIceGrid').addEventListener('click',e=>{
  const b=e.target.closest('.pickerBtn');
  if(!b)return;
  const n=b.dataset.n;
  if(multiPick.selected.has(n)){
    multiPick.selected.delete(n);
    b.classList.remove('selected');
  }
  else{
    if(totalSelected()>=multiPick.max)return;
    multiPick.selected.add(n);
    b.classList.add('selected');
  }
  updateOnIceMeta();
});
$('onIceUnknownPlus').addEventListener('click', ()=>{
  if(totalSelected()>=multiPick.max)return;
  multiPick.unknowns++;
  updateOnIceMeta();
});
$('onIceUnknownMinus').addEventListener('click', ()=>{
  if(multiPick.unknowns>0){multiPick.unknowns--; updateOnIceMeta();}
});
$('onIceClear').addEventListener('click', ()=>{
  multiPick.selected.clear();
  multiPick.unknowns=0;
  buildOnIceGrid();
  updateOnIceMeta();
});
/* Allow typing a number into the on-ice picker (adds to roster + selects it) */
$('onIceAdd').addEventListener('click', () => {
  const input = $('onIceInput');
  if (!input) return;

  const raw = (input.value || '').trim();
  if (!raw) return;

  // Only allow digits for roster numbers
  if (!/^\d+$/.test(raw)) {
    input.value = '';
    return;
  }

  // Respect max selection count
  if (totalSelected() >= multiPick.max) {
    input.value = '';
    return;
  }

  // Add to roster (and persist) if new
  ensureRosterNumber(raw);

  // Select it in this modal
  multiPick.selected.add(String(raw));

  // Rebuild grid so the new number appears (and shows selected state)
  buildOnIceGrid();
  updateOnIceMeta();

  input.value = '';
});

// Pressing Enter on the keyboard should also "Use"
$('onIceInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('onIceAdd').click();
  }
});

$('onIceUse').addEventListener('click', ()=>{
  if(!multiPick.eventRef){
    $('onIceModal').style.display='none';
    return;
  }
  const ev=multiPick.eventRef, arr=[...multiPick.selected];
  for(let i=0;i<multiPick.unknowns;i++) arr.push('Unknown');
  ev[multiPick.field]=arr;
  save();
  $('onIceModal').style.display='none';
  multiPick.eventRef=null;
  renderAll();

  // Strength required after any goal for/against (and soft goal)
  if(ev.type==='goal'||ev.type==='soft_goal'||ev.type==='for_goal') openStrengthPicker(ev, 'Our Team\'s Situation (required)');
});
$('onIceCancel').addEventListener('click', ()=>{
  const ev = multiPick.eventRef;
  $('onIceModal').style.display='none';
  multiPick.eventRef=null;

  if(ev && (ev.type==='goal'||ev.type==='soft_goal'||ev.type==='for_goal')){
    openStrengthPicker(ev, 'Our Team\'s Situation (required)');
  }
});

/* Strength */
let strengthTarget=null;
function openStrengthPicker(ev, label){
  strengthTarget=ev;
  $('strengthTitle').textContent=label;
  $('strengthModal').style.display='flex';
}
$('strengthModal').addEventListener('click', e=>{
  const b=e.target.closest('.pickerBtn');
  if(!b||!strengthTarget)return;
  strengthTarget.strength=b.dataset.strength;
  save();
  $('strengthModal').style.display='none';
  strengthTarget=null;
  renderAll();
});
$('strengthSkip').addEventListener('click', ()=>{
  // requirement: prompt exists; allow skip, but leave undefined
  $('strengthModal').style.display='none';
  strengthTarget=null;
  renderAll();
});

/* PlusMinus / Stats / Scoring */
/* ===== Scoring helpers ===== */
function bayesRate(success, trials, priorRate, priorWeight){
  const s = Math.max(0, success);
  const t = Math.max(0, trials);
  const w = Math.max(0, priorWeight);
  const pr = Math.max(0, Math.min(1, priorRate));
  return (s + pr*w) / (t + w || 1);
}
function clamp(x, lo, hi){ return Math.max(lo, Math.min(hi, x)); }

/* Plus/minus map (used elsewhere) */
function computePlusMinus(){
  const pm=new Map();
  function inc(n,d){
    const s = String(n||'').trim();
    if(!s || s==='Unknown' || s==='?') return;
    pm.set(s,(pm.get(s)||0)+d);
  }

  for(const ev of state.events){
    if(ev.type==='for_goal'){
      const s=new Set();
      if(ev.player) s.add(ev.player);
      if(ev.assist) s.add(ev.assist);
      (ev.forOnIce||[]).forEach(x=>s.add(x));
      for(const n of s) inc(n,1);
    }
    if((ev.type==='goal'||ev.type==='soft_goal')&&ev.onIce){
      for(const n of ev.onIce) inc(n,-1);
    }
  }
  const order = sortRoster([...pm.keys()]);
  return {pm, order};
}

function normalizeLevelKey(levelStr){
  const s = String(levelStr||'').toUpperCase();
  const m = s.match(/U\d{1,2}/);
  return m ? m[0] : 'Other';
}

const LEVEL_PROFILES = {
  U9:  { goalieBaseSV:0.75 },
  U11: { goalieBaseSV:0.80 },
  U13: { goalieBaseSV:0.82 },
  U15: { goalieBaseSV:0.86 },
  U18: { goalieBaseSV:0.89 },
  Other:{ goalieBaseSV:0.85 }
};

/* ===== SHOT QUALITY / xG MODEL ===== */
const XG_RATES = {
  hd: 0.18,       // high danger shot: ~18% chance of goal
  normal: 0.07,   // regular shot: ~7% chance
  missed: 0.12    // missed chance: would have been ~12% (between normal and HD)
};

function computeShotQuality() {
  let xGF = 0, xGA = 0;
  let hdFor = 0, hdAg = 0, regFor = 0, regAg = 0;
  let mcFor = state.team.missedChancesFor || 0;
  let mcAg = state.team.missedChancesAgainst || 0;

  for (const ev of state.events) {
    if (ev.type === 'for_shot' || ev.type === 'for_goal') {
      if (ev.highDanger) { xGF += XG_RATES.hd; hdFor++; }
      else { xGF += XG_RATES.normal; regFor++; }
    }
    if (ev.type === 'shot' || ev.type === 'goal' || ev.type === 'soft_goal' || ev.type === 'big_save' || ev.type === 'bad_rebound') {
      if (ev.highDanger) { xGA += XG_RATES.hd; hdAg++; }
      else { xGA += XG_RATES.normal; regAg++; }
    }
  }

  // Missed chances add to expected goals (they were quality chances not taken)
  xGF += mcFor * XG_RATES.missed;
  xGA += mcAg * XG_RATES.missed;

  const SF = state.countsF.shots || 0;
  const SA = state.countsA.shots || 0;
  const hdPctFor = SF > 0 ? Math.round(100 * hdFor / SF) : 0;
  const hdPctAg = SA > 0 ? Math.round(100 * hdAg / SA) : 0;

  return {
    xGF: Math.round(xGF * 100) / 100,
    xGA: Math.round(xGA * 100) / 100,
    xGDiff: Math.round((xGF - xGA) * 100) / 100,
    hdFor, hdAg, regFor, regAg, mcFor, mcAg,
    hdPctFor, hdPctAg
  };
}

/* ===== SCORING ENGINE ===== */
function getSigmoidScore(actual, expected, spread) {
  const z = (actual - expected) / (spread || 1);
  // Asymmetric curve: baseline at 72, ceiling ~98, floor ~5
  // Upside: +3 spread units → ~96 (A+)
  // Downside: -3 spread units → ~15 (F)
  if (z >= 0) {
    // Above expected: 72 → 98 (generous upside)
    return Math.round(Math.min(100, 72 + 26 * (1 - Math.exp(-z * 0.8))));
  } else {
    // Below expected: 72 → 0 (steeper punishment)
    return Math.round(Math.max(0, 72 * Math.exp(z * 0.55)));
  }
}

function computeGoalieScore() {
  const C = state.countsA;
  const shots = C.shots;
  const ga = C.goals;

  // 1) Minimum Volume Check
  if (shots < 5) {
    return { total: 50, scoreSV: 0, softPenalty: 0, ctxAdj: 0, scoreRebound: 0, scoreBig: 0, goodRebounds: 0, smothers: 0 };
  }

  const prof = LEVEL_PROFILES[normalizeLevelKey(state.level)] || LEVEL_PROFILES.Other;
  const baseSvPct = prof.goalieBaseSV;

  // 2) Weighted shots/goals (context weighting + soft goal punishment)
  let weightedShots = 0;
  let weightedGoals = 0;

  const defenseEvents = state.events.filter(e =>
    e.type === 'goal' || e.type === 'soft_goal' || e.type === 'shot' || e.type === 'big_save' || e.type === 'bad_rebound' || e.type === 'smother'
  );

  let bigSaveBonus = 0;

  defenseEvents.forEach(ev => {
    let wShot = 1.0;
    let wGoal = 1.0;

    // HD shots are harder to save — weight them higher
    if (ev.highDanger) wShot = 1.5;

    // Big save: give additive bonus
    if (ev.type === 'big_save') {
      bigSaveBonus += 0.3;
    }

    if (ev.type === 'goal' || ev.type === 'soft_goal') {
      const cause = ev.ga_cause || '';
      const ctx = ev.ga_ctx || '';

      // Hard goals (less blame on goalie): breakaways, screens, deflections, odd-man rush, SH
      // Note: HD is NOT included here. HD means the team let the opponent into a dangerous
      // position, but the goalie is still expected to compete on those shots. The goalie gets
      // credit via the 1.5x weighted shot for HD saves, but letting one in is not excused.
      const isHard =
        cause.includes('BA') ||
        /Screen|Deflection\/Tip|Cross-Crease|Odd-Man Rush/.test(ctx) ||
        ev.strength === 'SH';

      // Soft goals (more blame on goalie): explicit soft goal, bad rebound, or clean look
      const isSoft =
        ev.type === 'soft_goal' ||
        !!ev.ga_br ||
        cause.includes('BR') ||
        ctx === 'Clean Look';

      if (isSoft) {
        wGoal = 2.0;
      } else if (isHard) {
        wGoal = 0.5;
      }
    }

    weightedShots += wShot;
    if (ev.type === 'goal' || ev.type === 'soft_goal') weightedGoals += wGoal;
  });

  // 3) Rebound control signal (smothers + good rebounds positive, bad rebounds negative)
  const goodRebounds = state.events.filter(e => e.goodRebound).length;
  const reboundScore = (C.smothers * 1.5) + (goodRebounds * 1.0) - (C.badRebounds * 2.0);

  // 4) GSAx: goals saved above expected (weighted)
  const expectedGoalsAllowed = weightedShots * (1 - baseSvPct);
  const GSAx = expectedGoalsAllowed - weightedGoals; // positive is good

  // 5) Final goalie score: sigmoid with wider spread (3.0) for better range usage
  //    Includes big save bonus (additive credit) and rebound influence
  const goalieInput = GSAx + bigSaveBonus + (reboundScore * 0.15);
  const totalScore = getSigmoidScore(goalieInput, 0, 3.0);

  return {
    total: totalScore,
    // For audit display: show weighted workload (not SV points)
    scoreSV: Math.round(weightedShots),
    // Keep soft goals count as "softPenalty" display field (UI expects number)
    softPenalty: C.softGoals,
    // Use ctxAdj field to display GSAx in the audit panel
    ctxAdj: Math.round(GSAx * 10) / 10,
    scoreRebound: Math.round(reboundScore),
    scoreBig: C.bigSaves,
    goodRebounds: goodRebounds,
    smothers: C.smothers
  };
}

function computeTeamScore() {
  const SF = state.countsF.shots;
  const SA = state.countsA.shots;
  const GF = state.countsF.goals;
  const GA = state.countsA.goals;
  const totalShots = SF + SA;

  if (totalShots < 5) {
    return { total: 50, scoreSS:0, scoreFin:0, scoreImp:0, scoreSQ:0, scoreStab:0, SS:0, Fin:0, scoreChance:0, scoreST:0, scoreDepth:0, penDef:0, scoreDiscipline:0 };
  }

  const sq = computeShotQuality();

  // 1) POSSESSION (Shot Share) — 20% weight
  const shotShare = SF / totalShots;
  const scorePossession = getSigmoidScore(shotShare, 0.5, 0.15);

  // 2) DANGER CONTROL (Net dangerous events) — 20% weight
  const dangerFor = (state.team.breakawaysFor || 0) + (state.team.oddManRushFor || 0) + (state.team.forcedTurnovers || 0);
  const dangerAg  = (state.team.breakawaysAgainst || 0) + (state.team.dzTurnovers || 0) + (state.team.oddManRushAgainst || 0);
  const dangerDiff = dangerFor - dangerAg;
  const scoreDanger = getSigmoidScore(dangerDiff, 0, 3);

  // 3) SHOT QUALITY (xG differential) — 15% weight
  //    Measures whether we're generating better chances than the opponent
  const scoreShotQuality = getSigmoidScore(sq.xGDiff, 0, 0.8);

  // 4) EXECUTION / RESULT (Weighted goal differential) — 35% weight
  let teamWeightedGF = GF;
  let teamWeightedGA = 0;
  for (const ev of state.events) {
    if (ev.type === 'goal' || ev.type === 'soft_goal') {
      teamWeightedGA += (ev.strength === 'SH') ? 0.6 : 1.0;
    }
  }
  if (teamWeightedGA === 0 && GA > 0) teamWeightedGA = GA;
  const goalDiff = teamWeightedGF - teamWeightedGA;
  const scoreResult = getSigmoidScore(goalDiff, 0, 2.5);

  // 5) DISCIPLINE (Penalties) — 10% weight
  const penFor = state.team.penaltiesFor || 0;
  const penAg = state.team.penaltiesAgainst || 0;
  const penDiff = penFor - penAg;
  const scoreDiscipline = getSigmoidScore(penDiff, 0, 2);

  // Weighted total: Possession 20%, Danger 20%, Shot Quality 15%, Result 35%, Discipline 10%
  const total = (scorePossession * 0.20) + (scoreDanger * 0.20) + (scoreShotQuality * 0.15) + (scoreResult * 0.35) + (scoreDiscipline * 0.10);

  return {
    total: Math.round(total),
    scoreSS: Math.round(scorePossession),
    scoreImp: Math.round(scoreDanger),
    scoreSQ: Math.round(scoreShotQuality),
    scoreFin: Math.round(scoreResult),
    scoreDiscipline: Math.round(scoreDiscipline),
    scoreStab: 0,
    SS: shotShare,
    Fin: SF > 0 ? GF/SF : 0,
    scoreChance: dangerFor,
    scoreST: 0,
    scoreDepth: 0,
    penDef: dangerAg
  };
}

/* GA breakdown helper */
function computeGABreakdown(){
  return state.events.reduce((acc,e)=>{
    if(e.type==='goal'||e.type==='soft_goal'){
      const c=e.ga_cause||'';
      if(e.ga_ba||c.includes('BA')) acc.BA++;
      else if(e.ga_dz||c.includes('DZ')) acc.DZ++;
      else if(e.ga_br||c.includes('BR')) acc.BR++;
      else if(e.ga_omra||c.includes('OMRA')) acc.OMRA++;
      else acc.Other++;
    }
    return acc;
  }, {BA:0,DZ:0,BR:0,OMRA:0,Other:0});
}

function computeGFContextBreakdown(){
  const acc = {BA:0, OMR:0, FT:0, Other:0};

  for(let i = 0; i < state.events.length; i++){
    const e = state.events[i];
    if(e.type !== 'for_goal') continue;

    // If already tagged, trust it
    if(e.off_ctx === 'Breakaway') { acc.BA++; continue; }
    if(e.off_ctx === 'Odd Man Rush') { acc.OMR++; continue; }
    if(e.off_ctx === 'Forced Turnover') { acc.FT++; continue; }
    if(e.off_ctx === 'Other') { acc.Other++; continue; }

    // Otherwise compute with no bleed across previous for_goal
    const tGoal = new Date(e.tISO).getTime();
    let windowStart = tGoal - 10000;

    for(let j = i - 1; j >= 0; j--){
      const prior = state.events[j];
      const t = new Date(prior.tISO).getTime();
      if(t >= tGoal) continue;
      if(prior.type === 'for_goal'){
        windowStart = Math.max(windowStart, t + 1);
        break;
      }
    }

    let hasBA = false, hasOMR = false, hasFT = false;
    for(let j = i - 1; j >= 0; j--){
      const prior = state.events[j];
      const t = new Date(prior.tISO).getTime();
      if(t < windowStart) break;

      if(prior.type === 'breakaway_for') hasBA = true;
      if(prior.type === 'odd_man_rush_for') hasOMR = true;
      if(prior.type === 'forced_turnover') hasFT = true;
    }

    if(hasBA) acc.BA++;
    else if(hasOMR) acc.OMR++;
    else if(hasFT) acc.FT++;
    else acc.Other++;
  }

  return acc;
}

/* Strength breakdown */
function computeStrengthBreakdown(){
  const out = {
    for:{EV:0,PP:0,SH:0,UNK:0},
    against:{EV:0,PP:0,SH:0,UNK:0}
  };
  for(const ev of state.events){
    if(ev.type==='for_goal'){
      const s = ev.strength || 'UNK';
      out.for[s] = (out.for[s]||0)+1;
    }
    if(ev.type==='goal' || ev.type==='soft_goal'){
      const s = ev.strength || 'UNK';
      out.against[s] = (out.against[s]||0)+1;
    }
  }
  return out;
}

/* ===== Live Renders ===== */
function setRing(valEl, arcEl, sc){
  if(!valEl || !arcEl) return;

  // Show placeholder when score is null/undefined
  if(sc === null || sc === undefined || sc === '—'){
    valEl.textContent = '—';
    arcEl.style.stroke = '#333';
    arcEl.style.strokeDashoffset = '220'; // empty ring
    return;
  }

  valEl.textContent = sc;
  const c = sc>=85 ? '#32d74b' : sc>=70 ? '#ff9f0a' : '#ff453a';
  arcEl.style.stroke = c;
  arcEl.style.strokeDashoffset = String(220*(1-sc/100));
}

function updateMeta(){
  const F=state.countsF, A=state.countsA;

  $('liveGF').textContent = F.goals;
  $('liveGA').textContent = A.goals;

  $('liveSF_sub').textContent = `SF: ${F.shots}`;
  $('liveSA_sub').textContent = `SA: ${A.shots}`;

  const saves=Math.max(0,A.shots-A.goals);
  const svText = A.shots ? (saves/A.shots).toFixed(3).slice(1) : '—';

  $('dashLine').textContent = `GF ${F.goals} • GA ${A.goals} • SF ${F.shots} • SA ${A.shots}`;

  $('savesVal').textContent = saves;
  $('svVal').textContent = `SV% ${svText}`;

  $('smothersVal').textContent = state.countsA.smothers;
  $('badRebVal').textContent = state.countsA.badRebounds;
  $('bigSavesVal').textContent = state.countsA.bigSaves;
  $('softVal').textContent = state.countsA.softGoals;

  $('baAgVal').textContent = state.team.breakawaysAgainst;
  $('dzVal').textContent = state.team.dzTurnovers;
  $('baForVal').textContent = state.team.breakawaysFor;
  $('omrForVal').textContent = state.team.oddManRushFor;
  $('ftVal').textContent = state.team.forcedTurnovers || 0;
  $('omrAgVal').textContent = state.team.oddManRushAgainst || 0;
  $('penForVal').textContent = state.team.penaltiesFor || 0;
  $('penAgVal').textContent = state.team.penaltiesAgainst || 0;

  const goodReb = state.events.filter(e=>e.goodRebound).length;
  $('goodRebVal').textContent = goodReb;

  // High danger + missed chances
  const hdFor = state.events.filter(e=>(e.type==='for_shot'||e.type==='for_goal')&&e.highDanger).length;
  const hdAg = state.events.filter(e=>(e.type==='shot'||e.type==='goal'||e.type==='soft_goal'||e.type==='big_save')&&e.highDanger).length;
  $('hdForVal').textContent = hdFor;
  $('hdAgVal').textContent = hdAg;
  if(F.shots > 0) $('hdForSub').textContent = Math.round(100*hdFor/F.shots)+'% of SF';
  if(A.shots > 0) $('hdAgSub').textContent = Math.round(100*hdAg/A.shots)+'% of SA';
  const mcFor = state.team.missedChancesFor||0, mcAg = state.team.missedChancesAgainst||0;
  $('missedChanceVal').textContent = mcFor + mcAg;
  $('missedSub').textContent = mcFor + ' for, ' + mcAg + ' ag';

  const shootPct = F.shots ? (F.goals/F.shots).toFixed(3).slice(1) : '—';
  $('shootPctVal').textContent = shootPct;

  const share = (F.shots + A.shots) ? Math.round(100 * (F.shots/(F.shots+A.shots)))+'%' : '—';
  $('shotShareVal').textContent = share;

  // Shot quality / xG
  const sq = computeShotQuality();
  if(state.events.length > 0){
    $('xgfVal').textContent = sq.xGF.toFixed(1);
    $('xgaVal').textContent = sq.xGA.toFixed(1);
    const diff = sq.xGDiff;
    $('xgDiffVal').textContent = (diff > 0 ? '+' : '') + diff.toFixed(1);
    $('xgDiffVal').style.color = diff > 0 ? 'var(--good)' : diff < 0 ? 'var(--accent-them)' : 'var(--ink)';
    $('xgfSub').textContent = `${sq.hdFor} HD / ${sq.regFor} reg`;
    $('xgaSub').textContent = `${sq.hdAg} HD / ${sq.regAg} reg`;
    $('xgDiffSub').textContent = diff > 0 ? 'Outplaying' : diff < 0 ? 'Under pressure' : 'Even';
  } else {
    $('xgfVal').textContent = '—';
    $('xgaVal').textContent = '—';
    $('xgDiffVal').textContent = '—';
    $('xgDiffVal').style.color = '';
    $('xgfSub').textContent = 'Expected goals for';
    $('xgaSub').textContent = 'Expected goals ag';
    $('xgDiffSub').textContent = 'Quality edge';
  }

  // Chance Quality slider
  // Boost goals to 1.0 xG (certainty) — a goal proves the chance was dangerous
  const GF = state.countsF.goals || 0;
  const GA = state.countsA.goals || 0;
  const goalBoostF = GF * (1.0 - XG_RATES.normal);  // extra xG beyond what xGF already counted
  const goalBoostA = GA * (1.0 - XG_RATES.normal);
  const qualF = sq.xGF + goalBoostF;
  const qualA = sq.xGA + goalBoostA;
  const totalShots = (state.countsF.shots || 0) + (state.countsA.shots || 0);
  const qWrap = $('qualityBarWrap');
  const qFill = $('qualityFill');
  const qText = $('qualityText');
  if(totalShots >= 5 && (qualF + qualA) > 0){
    qWrap.style.display = 'block';
    const pct = Math.round(100 * qualF / (qualF + qualA));
    // Fill from center: if pct > 50, fill right from 50%; if < 50, fill left toward 0
    if(pct >= 50){
      qFill.style.left = '50%';
      qFill.style.width = (pct - 50) + '%';
      const intensity = Math.min(1, (pct - 50) / 30);
      qFill.style.background = `rgba(50, 215, 75, ${0.4 + intensity * 0.5})`;
    } else {
      qFill.style.left = pct + '%';
      qFill.style.width = (50 - pct) + '%';
      const intensity = Math.min(1, (50 - pct) / 30);
      qFill.style.background = `rgba(255, 69, 58, ${0.4 + intensity * 0.5})`;
    }
    if(pct >= 58) {
      qText.textContent = 'We\'re getting the better chances';
      qText.style.color = 'var(--good)';
    } else if(pct <= 42) {
      qText.textContent = 'They\'re getting the better chances';
      qText.style.color = 'var(--accent-them)';
    } else {
      qText.textContent = 'Chances are balanced';
      qText.style.color = 'var(--muted)';
    }
  } else {
    qWrap.style.display = totalShots > 0 ? 'block' : 'none';
    if(totalShots > 0){
      qFill.style.left = '50%';
      qFill.style.width = '0%';
      qText.textContent = 'Not enough data yet';
      qText.style.color = 'var(--muted)';
    }
  }

  // rings
  if(state.events.length === 0){
    // start-of-game display
    $('goalieScoreNum').textContent = '—';
    $('teamScoreNum').textContent = '—';
    $('gsArc').style.stroke = '#333';
    $('tsArc').style.stroke = '#333';
    $('gsArc').style.strokeDashoffset = '220';
    $('tsArc').style.strokeDashoffset = '220';
  } else {
    const K = computeGoalieScore(), T = computeTeamScore();
    setRing($('goalieScoreNum'),$('gsArc'),K.total);
    setRing($('teamScoreNum'),$('tsArc'),T.total);
  }

  // per-period cards (clean: header already says P1/P2/P3/OT)
  function pLine(p){
    const v = per[p];
    // Big line: just the score for that period (GF–GA)
    return `${v.F_goals}–${v.A_goals}`;
  }
  function pSub(p){
    const v = per[p];
    // Small line: shots
    return `SF ${v.F_shots} • SA ${v.A_shots}`;
  }

  $('p1Line').textContent = pLine(1);
  $('p2Line').textContent = pLine(2);
  $('p3Line').textContent = pLine(3);
  $('p4Line').textContent = pLine(4);

  // Put the shots line into the .s text inside each tile (ONLY ONCE)
  const pTiles = [
    {id:'p1Line', p:1},{id:'p2Line', p:2},{id:'p3Line', p:3},{id:'p4Line', p:4},
  ];
  for(const it of pTiles){
    const el = $(it.id);
    if(el && el.parentElement && el.parentElement.querySelector('.s')){
      el.parentElement.querySelector('.s').textContent = pSub(it.p);
    }
  }

  updateDebugLines();
}

function renderLog(){
  const logEl = $('log');
  if(!logEl) return;
  const evs = [...state.events].sort((a,b)=>new Date(a.tISO)-new Date(b.tISO));
  if(!evs.length){
    logEl.innerHTML = `<div class="small" style="opacity:0.7;">No events yet.</div>`;
    return;
  }
  const THEM_TYPES = new Set(['shot','goal','soft_goal','bad_rebound','breakaway_against','dz_turnover','odd_man_rush_against','penalty_against','missed_chance_against']);
  const US_TYPES = new Set(['for_shot','for_goal','smother','big_save','breakaway_for','odd_man_rush_for','forced_turnover','penalty_for','missed_chance_for']);

  logEl.innerHTML = evs.map(ev=>{
    const isGA = (ev.type==='goal' || ev.type==='soft_goal');
    const ctx = ev.ga_ctx || '';
    const cause = ev.ga_cause || '';
    const tags = [];
    if(isGA){
      if(cause) tags.push(cause);
      if(ctx) tags.push(ctx);
    }
    if(ev.type==='for_goal' && ev.off_ctx) tags.push(`OF:${ev.off_ctx}`);
    if(ev.strength) tags.push(ev.strength);

    const tagText = tags.join(' • ');
    const needsCtx = ev.needsContext && isGA;
    const isGoal = isGA || ev.type==='for_goal';
    const needsStr = isGoal && !ev.strength;
    const meta = `P${ev.period} ${fmtTime(ev.tISO)}`;
    const side = THEM_TYPES.has(ev.type) ? 'log-them' : US_TYPES.has(ev.type) ? 'log-us' : 'log-ctx';
    return `
      <div class="log-item ${side}" data-id="${ev.id}">
        <div class="log-main">
          <span class="log-meta">${meta}</span>
          <span>${labelFor(ev)}</span>
          ${tagText ? `<span class="badge">${tagText}</span>` : ''}
        </div>
        ${needsCtx ? `<span class="badge badge-tag" data-id="${ev.id}">Tag</span>` : ''}
        ${needsStr ? `<span class="badge badge-tag badge-str" data-id="${ev.id}">EV/PP/SH</span>` : ''}
      </div>`;
  }).join('');
}

/* Handle Tag Later from log */
$('log').addEventListener('click', e=>{
  const badge = e.target.closest('.badge-tag');
  if(!badge) return;
  const id = Number(badge.dataset.id);
  const ev = state.events.find(x=>x.id===id);
  if(!ev) return;

  // Strength tag badge → open strength picker
  if(badge.classList.contains('badge-str')){
    openStrengthPicker(ev, 'Our Team\'s Situation (required)');
    return;
  }

  // GA context tag badge → open GA context modal
  ev.needsContext = false;
  save();
  openGAContext(ev);
});

/* ===== Summary Building ===== */
function tile(k, v, s){
  return `<div class="dashTile"><div class="k">${k}</div><div class="v">${v}</div>${s ? '<div class="s">'+s+'</div>' : ''}</div>`;
}

function compBar(label, score, color){
  const c = color || 'var(--accent-us)';
  const pct = Math.max(0, Math.min(100, score));
  return `<div class="comp-row">
    <div class="comp-label">${label}</div>
    <div class="comp-bar-track"><div class="comp-bar-fill" style="width:${pct}%; background:${c};"></div></div>
    <div class="comp-val">${Math.round(score)}</div>
  </div>`;
}

function endGame(){
  const K=computeGoalieScore(), T=computeTeamScore();
  const sq = computeShotQuality();
  const date = state.date || getLocalTodayYMD();
  const SF=state.countsF.shots, SA=state.countsA.shots, GF=state.countsF.goals, GA=state.countsA.goals;
  const saves=Math.max(0,SA-GA);
  const svText = SA ? (saves/SA).toFixed(3).slice(1) : '—';
  const shootPct = SF ? (GF/SF).toFixed(3).slice(1) : '—';
  const share = (SF+SA) ? Math.round(100*(SF/(SF+SA)))+'%' : '—';
  const goodReb = state.events.filter(e=>e.goodRebound).length;
  const hdFor = state.events.filter(e=>(e.type==='for_shot'||e.type==='for_goal')&&e.highDanger).length;
  const hdAg = state.events.filter(e=>(e.type==='shot'||e.type==='goal'||e.type==='soft_goal'||e.type==='big_save')&&e.highDanger).length;

  // === Header ===
  $('summaryTitle').textContent = `${state.opponent || 'Opponent ?'} \u2022 ${state.level || '?'} \u2022 ${date}`;
  $('sumGF').textContent = GF;
  $('sumGA').textContent = GA;
  const resultClass = GF > GA ? 'w' : GF < GA ? 'l' : 't';
  const resultText = GF > GA ? 'WIN' : GF < GA ? 'LOSS' : 'TIE';
  $('sumResultTag').innerHTML = `<span class="sum-result-tag ${resultClass}">${resultText}</span>`;

  // === Rings ===
  setRing($('goalieScoreNumSum'),$('gsArcSum'),K.total);
  setRing($('teamScoreNumSum'),$('tsArcSum'),T.total);

  // === Team Score Component Bars ===
  const teamColor = function(s){ return s >= 60 ? 'var(--good)' : s >= 40 ? 'var(--warn)' : 'var(--accent-them)'; };
  $('teamCompBars').innerHTML =
    compBar('Result 35%', T.scoreFin, teamColor(T.scoreFin)) +
    compBar('Possession 20%', T.scoreSS, teamColor(T.scoreSS)) +
    compBar('Danger 20%', T.scoreImp, teamColor(T.scoreImp)) +
    compBar('Quality 15%', T.scoreSQ||0, teamColor(T.scoreSQ||0)) +
    compBar('Discipline 10%', T.scoreDiscipline||0, teamColor(T.scoreDiscipline||0));

  // === Goalie Score Component Bars ===
  // Build meaningful bars from goalie data
  const gkColor = function(s){ return s >= 60 ? 'var(--good)' : s >= 40 ? 'var(--warn)' : 'var(--accent-them)'; };

  // GSAx: normalize around 0 to a 0-100 bar. GSAx of 0 = 50, positive is better.
  const gsaxNorm = Math.max(0, Math.min(100, 50 + (K.ctxAdj * 15)));

  // Rebound control: normalize. Score of 0 = 50, positive = better.
  const rebNorm = Math.max(0, Math.min(100, 50 + (K.scoreRebound * 8)));

  $('goalieCompBars').innerHTML =
    compBar('GSAx', gsaxNorm, gkColor(gsaxNorm)) +
    `<div style="font-size:11px; color:var(--muted); text-align:right; margin:-2px 0 6px 0;">${K.ctxAdj > 0 ? '+' : ''}${K.ctxAdj} goals saved above expected</div>` +
    compBar('Rebounds', rebNorm, gkColor(rebNorm)) +
    `<div style="font-size:11px; color:var(--muted); text-align:right; margin:-2px 0 6px 0;">${goodReb} good, ${state.countsA.badRebounds} bad, ${state.countsA.smothers} smothered</div>` +
    compBar('Big Saves', Math.min(100, K.scoreBig * 25), gkColor(Math.min(100, K.scoreBig * 25))) +
    `<div style="font-size:11px; color:var(--muted); text-align:right; margin:-2px 0 4px 0;">${K.scoreBig} big save${K.scoreBig !== 1 ? 's' : ''}</div>` +
    (K.softPenalty > 0 ? `<div style="font-size:12px; color:var(--accent-them); font-weight:700; text-align:right; margin-top:2px;">${K.softPenalty} soft goal${K.softPenalty !== 1 ? 's' : ''} allowed</div>` : '');

  // === Shots & Scoring ===
  $('sumShotsGrid').innerHTML =
    tile('Goals Ag', GA) +
    tile('Goals For', GF) +
    tile('Saves', saves, `SV% ${svText}`) +
    tile('Shots Ag', SA) +
    tile('Shots For', SF) +
    tile('Shot Share', share, `SF / (SF+SA)`);

  // === Shot Quality ===
  $('sumQualityGrid').innerHTML =
    tile('xGA', sq.xGA, sq.hdAg+' HD / '+sq.regAg+' reg') +
    tile('xGF', sq.xGF, sq.hdFor+' HD / '+sq.regFor+' reg') +
    tile('xG Diff', (sq.xGDiff>0?'+':'')+sq.xGDiff, sq.xGDiff>0?'Our edge':'Their edge') +
    tile('HD Against', hdAg, sq.hdPctAg+'% of SA') +
    tile('HD For', hdFor, sq.hdPctFor+'% of SF') +
    tile('Shooting %', shootPct, 'GF / SF');

  // === Goaltending ===
  $('sumGoalieGrid').innerHTML =
    tile('Big Saves', state.countsA.bigSaves) +
    tile('Smothers', state.countsA.smothers) +
    tile('Good Reb', goodReb) +
    tile('Bad Reb', state.countsA.badRebounds) +
    tile('Soft Goals', state.countsA.softGoals) +
    tile('Missed Ch', (state.team.missedChancesAgainst||0), 'Against');

  // === Offensive ===
  $('sumOffenseGrid').innerHTML =
    tile('Breakaways', state.team.breakawaysFor) +
    tile('Odd Man Rush', state.team.oddManRushFor) +
    tile('Forced TO', state.team.forcedTurnovers||0) +
    tile('Penalties Drawn', state.team.penaltiesFor||0) +
    tile('Missed Ch', state.team.missedChancesFor||0, 'For');

  // === Defensive ===
  $('sumDefenseGrid').innerHTML =
    tile('Breakaways Ag', state.team.breakawaysAgainst) +
    tile('D-Zone TO', state.team.dzTurnovers) +
    tile('OMR Against', state.team.oddManRushAgainst||0) +
    tile('Penalties Taken', state.team.penaltiesAgainst||0);

  // === Goal Breakdowns ===
  const gfCtx = computeGFContextBreakdown();
  const gaStats = computeGABreakdown();
  const totalGF = gfCtx.BA + gfCtx.OMR + (gfCtx.FT||0) + gfCtx.Other;
  const totalGA = gaStats.BA + gaStats.DZ + gaStats.BR + (gaStats.OMRA||0) + gaStats.Other;

  let gbHTML = '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">';
  // GA (them) on left, GF (us) on right — matches column layout
  if(totalGA > 0){
    gbHTML += `<div class="card" style="padding:10px;">
      <div class="small" style="font-weight:700; color:var(--accent-them); margin-bottom:6px;">Goals Against (${totalGA})</div>
      ${gaStats.BA ? `<div class="small">Breakaway: ${gaStats.BA}</div>` : ''}
      ${gaStats.DZ ? `<div class="small">D-Zone TO: ${gaStats.DZ}</div>` : ''}
      ${gaStats.BR ? `<div class="small">Bad Rebound: ${gaStats.BR}</div>` : ''}
      ${(gaStats.OMRA||0) ? `<div class="small">Odd Man Rush: ${gaStats.OMRA}</div>` : ''}
      ${gaStats.Other ? `<div class="small">Other: ${gaStats.Other}</div>` : ''}
    </div>`;
  } else {
    gbHTML += `<div class="card" style="padding:10px;"><div class="small" style="color:var(--muted);">No goals against</div></div>`;
  }
  if(totalGF > 0){
    gbHTML += `<div class="card" style="padding:10px;">
      <div class="small" style="font-weight:700; color:var(--accent-us); margin-bottom:6px;">Goals For (${totalGF})</div>
      ${gfCtx.BA ? `<div class="small">Breakaway: ${gfCtx.BA}</div>` : ''}
      ${gfCtx.OMR ? `<div class="small">Odd Man Rush: ${gfCtx.OMR}</div>` : ''}
      ${(gfCtx.FT||0) ? `<div class="small">Forced TO: ${gfCtx.FT}</div>` : ''}
      ${gfCtx.Other ? `<div class="small">Other: ${gfCtx.Other}</div>` : ''}
    </div>`;
  } else {
    gbHTML += `<div class="card" style="padding:10px;"><div class="small" style="color:var(--muted);">No goals for</div></div>`;
  }
  gbHTML += '</div>';
  $('sumGoalBreakdowns').innerHTML = gbHTML;

  // === Strength Breakdown ===
  const sb = computeStrengthBreakdown();
  const hasStrength = (sb.for.EV||0)+(sb.for.PP||0)+(sb.for.SH||0)+(sb.against.EV||0)+(sb.against.PP||0)+(sb.against.SH||0) > 0;
  if(hasStrength){
    $('sumStrengthWrap').style.display = '';
    $('sumStrengthGrid').innerHTML = `<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
      <div class="card" style="padding:10px;">
        <div class="small" style="font-weight:700; color:var(--accent-them); margin-bottom:4px;">Goals Against</div>
        <div class="small">EV: ${sb.against.EV||0} &bull; PP: ${sb.against.PP||0} &bull; SH: ${sb.against.SH||0}${sb.against.UNK ? ' &bull; Unk: '+sb.against.UNK : ''}</div>
      </div>
      <div class="card" style="padding:10px;">
        <div class="small" style="font-weight:700; color:var(--accent-us); margin-bottom:4px;">Goals For</div>
        <div class="small">EV: ${sb.for.EV||0} &bull; PP: ${sb.for.PP||0} &bull; SH: ${sb.for.SH||0}${sb.for.UNK ? ' &bull; Unk: '+sb.for.UNK : ''}</div>
      </div>
    </div>`;
  } else {
    $('sumStrengthWrap').style.display = 'none';
  }

  // === Period Table (transposed: stats as rows, periods as columns) ===
  const periods = [1,2,3,4];
  const pLabels = ['P1','P2','P3','OT'];
  const pRows = [
    {label:'GF', fn:p=>per[p].F_goals},
    {label:'GA', fn:p=>per[p].A_goals},
    {label:'SF', fn:p=>per[p].F_shots},
    {label:'SA', fn:p=>per[p].A_shots},
    {label:'BA For', fn:p=>per[p].BF},
    {label:'OMR For', fn:p=>per[p].OMRF},
    {label:'Forced TO', fn:p=>per[p].FT||0},
    {label:'BA Ag', fn:p=>per[p].BA},
    {label:'DZ TO', fn:p=>per[p].DZ},
    {label:'OMR Ag', fn:p=>per[p].OMRA||0},
    {label:'Pen For', fn:p=>per[p].PF||0},
    {label:'Pen Ag', fn:p=>per[p].PA||0},
  ];
  let pHTML = `<table><tr><th></th>`;
  pLabels.forEach(l=>{ pHTML += `<th>${l}</th>`; });
  pHTML += '</tr>';
  pRows.forEach(r=>{
    pHTML += `<tr><td style="text-align:left; font-weight:700;">${r.label}</td>`;
    periods.forEach(p=>{ pHTML += `<td>${r.fn(p)}</td>`; });
    pHTML += '</tr>';
  });
  pHTML += '</table>';
  $('summaryTableWrap').innerHTML = pHTML;

  // === Player Stats (+/- table) — only if tracking enabled ===
  if(prefs.trackPlusMinus){
    $('sumPlayerWrap').style.display = '';
    $('pmTableWrap').innerHTML = makePlusMinusTable();
  } else {
    // Still show player stats if roster has data, just without +/- column
    const playerData = computePlayerStats();
    const hasPlayerData = playerData.some(p => p.shots > 0 || p.goals > 0 || p.assists > 0);
    if(hasPlayerData){
      $('sumPlayerWrap').style.display = '';
      const pOrder = sortRoster(playerData.map(p=>p.player));
      let pTable = '<table><tr><th>#</th><th>S</th><th>G</th><th>A</th></tr>';
      for(const n of pOrder){
        const p = playerData.find(x=>x.player===n);
        if(!p) continue;
        pTable += `<tr><td>${p.player}</td><td>${p.shots}</td><td>${p.goals}</td><td>${p.assists}</td></tr>`;
      }
      pTable += '</table>';
      $('pmTableWrap').innerHTML = pTable;
    } else {
      $('sumPlayerWrap').style.display = 'none';
    }
  }

  // === Show summary, hide game controls ===
  $('gameControls').style.display = 'none';
  $('btnUndo').style.display = 'none';
  $('summaryPanel').classList.remove('hidden');
  window.scrollTo({top:0,behavior:'smooth'});

  // Save summary row automatically on end-game
  const cloudShare = (SF+SA) ? (SF/(SF+SA)) : 0.5;

  const gameData = {
    Date: date,
    Opponent: state.opponent,
    Level: state.level,
    TeamScore: T.total,
    GoalieScore: K.total,
    GF, GA, SF, SA,
    Saves: saves,
    SVPct: svText,
    OurShootingPct: shootPct,
    ShotShare: cloudShare,
    BreakawaysAgainst: state.team.breakawaysAgainst,
    DZTurnovers: state.team.dzTurnovers,
    BreakawaysFor: state.team.breakawaysFor,
    OddManRushFor: state.team.oddManRushFor,
    OddManRushAgainst: state.team.oddManRushAgainst||0,
    PenaltiesFor: state.team.penaltiesFor||0,
    PenaltiesAgainst: state.team.penaltiesAgainst||0,
    MissedChancesFor: state.team.missedChancesFor||0,
    MissedChancesAgainst: state.team.missedChancesAgainst||0,
    ForcedTurnovers: state.team.forcedTurnovers||0,
    Smothers: state.countsA.smothers,
    BadRebounds: state.countsA.badRebounds,
    BigSaves: state.countsA.bigSaves,
    SoftGoals: state.countsA.softGoals,
    GA_BA: gaStats.BA,
    GA_DZ: gaStats.DZ,
    GA_BR: gaStats.BR,
    GA_Other: gaStats.Other
  };

  gameData.gameId = state.gameId;
  saveGameToCloud(gameData);

  // Push final state to spectators (keeps the record so they see the final score)
  if(state.shareCode) endLiveShare();
}

async function saveGameToCloud(game){
  // Attach user_id if authenticated
  const uid = typeof window.getAuthUserId === 'function' ? window.getAuthUserId() : null;
  if (uid) game.user_id = uid;

  // Attach team_id if a team is selected
  const TM = window.TeamManager;
  const teamId = TM ? TM.getActiveTeamId() : null;
  if (teamId) game.team_id = teamId;

  try{
    setCloudStatus('Saving','warn');
    const res = await fetch('/api/save-game',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({game})
    });
    const d=await res.json();
    if(d.success){
      localStorage.setItem(LAST_SAVED_KEY, state.gameId);
      setCloudStatus('Synced','good');
      showStatusToast('Game saved!', 'success');
    }else{
      setCloudStatus('Error','bad');
      showStatusToast('Save failed', 'error', 3500);
      queueOfflineSave(game);
    }
  }catch(e){
    console.error(e);
    setCloudStatus('Queued','warn');
    showStatusToast('Offline — game queued for sync', 'warn', 3500);
    queueOfflineSave(game);
  }
}

/* ===== Offline Queue ===== */
function getOfflineQueue(){
  try{ return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY)) || []; }catch(_){ return []; }
}
function saveOfflineQueue(q){
  try{ localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q)); }catch(_){}
}
function queueOfflineSave(game){
  const q = getOfflineQueue();
  // Avoid duplicates by gameId
  const idx = q.findIndex(g => g.gameId === game.gameId);
  if(idx >= 0) q[idx] = game; else q.push(game);
  saveOfflineQueue(q);
}
async function flushOfflineQueue(){
  const q = getOfflineQueue();
  if(!q.length) return;
  const remaining = [];
  for(const game of q){
    try{
      const res = await fetch('/api/save-game',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({game})
      });
      const d = await res.json();
      if(!d.success) remaining.push(game);
    }catch(_){
      remaining.push(game);
      break; // still offline, stop trying
    }
  }
  saveOfflineQueue(remaining);
  if(remaining.length === 0 && q.length > 0){
    setCloudStatus('Synced','good');
    showStatusToast('Queued games synced!', 'success');
  }
}
// Flush queue when we come back online
window.addEventListener('online', ()=>{ setTimeout(flushOfflineQueue, 2000); });

/* CSV Helpers: game row + per-player block */
function computePlayerStats(){
  const stats = new Map();
  let unattr = {player:'Unattributed', shots:0, goals:0, assists:0, pm:0};
  function ensure(n){
    const s = String(n||'').trim();
    if(!s || s==='Unknown' || s==='?') return null;
    if(!stats.has(s)){
      stats.set(s,{player:s, shots:0, goals:0, assists:0, pm:0});
    }
    return stats.get(s);
  }
  for(const ev of state.events){
    if(ev.type==='for_shot'){
      const st = ensure(ev.player);
      if(st) st.shots++;
      else unattr.shots++;
    }
    if(ev.type==='for_goal'){
      const stS = ensure(ev.player);
      if(stS){ stS.goals++; stS.shots++; }
      else { unattr.goals++; unattr.shots++; }
      const stA = ensure(ev.assist);
      if(stA) stA.assists++;
    }
  }
  // plus/minus
  const {pm} = computePlusMinus();
  for(const [k,v] of pm.entries()){
    const st = ensure(k);
    if(st) st.pm = v;
  }
  const result = sortRoster([...stats.keys()]).map(k=>stats.get(k));
  if(unattr.shots > 0 || unattr.goals > 0) result.push(unattr);
  return result;
}

function exportGameCSV(){
  const K=computeGoalieScore(), T=computeTeamScore();
  const date = state.date || getLocalTodayYMD();

  const SF=state.countsF.shots, SA=state.countsA.shots, GF=state.countsF.goals, GA=state.countsA.goals;
  const saves=Math.max(0,SA-GA);
  const svText = SA ? (saves/SA).toFixed(3).slice(1) : '';
  const shootPct = SF ? (GF/SF).toFixed(3).slice(1) : '';

  const gameRow = {
    date,
    opponent: state.opponent||'',
    level: state.level||'',
    teamScore: T.total,
    goalieScore: K.total,
    GF, GA, SF, SA,
    saves,
    sv: svText,
    ourShooting: shootPct,
    breakawaysAgainst: state.team.breakawaysAgainst,
    dzTurnovers: state.team.dzTurnovers,
    breakawaysFor: state.team.breakawaysFor,
    oddManRushFor: state.team.oddManRushFor,
    oddManRushAgainst: state.team.oddManRushAgainst||0,
    forcedTurnovers: state.team.forcedTurnovers||0,
    penaltiesFor: state.team.penaltiesFor||0,
    penaltiesAgainst: state.team.penaltiesAgainst||0,
    smothers: state.countsA.smothers,
    badRebounds: state.countsA.badRebounds,
    bigSaves: state.countsA.bigSaves,
    softGoals: state.countsA.softGoals
  };

  const players = computePlayerStats();

  const gameHeaders = Object.keys(gameRow);
  const gameValues = gameHeaders.map(h => `"${String(gameRow[h]??'').replace(/"/g,'""')}"`);
  let csv = 'GAME\n' + gameHeaders.join(',') + '\n' + gameValues.join(',') + '\n\n';

  csv += 'PLAYERS\n';
  csv += ['player','shots','goals','assists','plusMinus'].join(',') + '\n';
  for(const p of players){
    csv += [`"${p.player}"`, p.shots, p.goals, p.assists, p.pm].join(',') + '\n';
  }

  const blob=new Blob([csv],{type:'text/csv'});
  const fileName = `team-tracker-${date}.csv`;

  // Share sheet if available, else download
  const doDownload = ()=>{
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if(navigator.canShare && navigator.canShare({files:[new File([blob], fileName, {type:'text/csv'})]}) && navigator.share){
    const f = new File([blob], fileName, {type:'text/csv'});
    navigator.share({files:[f], title:'Team Tracker CSV'}).catch(()=>doDownload());
  } else {
    doDownload();
  }
}

function updateDebugLines(){}

/* Plus/minus table */
function makePlusMinusTable(){
  // Build a complete list from the roster (so players with 0 stats still show)
  const roster = sortRoster((state.roster || []).map(x => String(x).trim()).filter(Boolean));

  // Start everyone at 0
  const map = new Map();
  for(const n of roster){
    map.set(n, { player: n, shots: 0, goals: 0, assists: 0, pm: 0 });
  }

  // Overlay actual stats (shots/goals/assists/pm) from game events
  const stats = computePlayerStats(); // returns [{player, shots, goals, assists, pm}, ...]
  for(const p of stats){
    const key = String(p.player).trim();
    if(!key) continue;

    // If a player wasn't in roster for some reason, still include them
    if(!map.has(key)){
      map.set(key, { player: key, shots: 0, goals: 0, assists: 0, pm: 0 });
    }

    map.set(key, {
      player: key,
      shots: Number(p.shots || 0),
      goals: Number(p.goals || 0),
      assists: Number(p.assists || 0),
      pm: Number(p.pm || 0)
    });
  }

  const order = sortRoster([...map.keys()]);
  if(!order.length){
    return '<div class="small" style="margin-top:4px;">No player data.</div>';
  }

  // IMPORTANT: column order is Shots / Goals / Assists / +/-
  let html = '<table><tr><th>#</th><th>S</th><th>G</th><th>A</th><th>+/-</th></tr>';

  for(const n of order){
    const p = map.get(n);
    const pm = Number(p.pm || 0);

    html += `<tr>
      <td>${p.player}</td>
      <td>${p.shots}</td>
      <td>${p.goals}</td>
      <td>${p.assists}</td>
      <td>${pm > 0 ? '+' : ''}${pm}</td>
    </tr>`;
  }

  html += '</table>';
  return html;
}

/* Roster Modal */
function openRoster(){
  const area = $('rosterArea');
  area.value = (state.roster||[]).join('\n');
  $('rosterModal').style.display='flex';
}
function saveRosterFromArea(){
  const raw = $('rosterArea').value.split('\n').map(x=>x.trim()).filter(x=>x.length>0);
  state.roster = sortRoster(raw);
  localStorage.setItem(ROSTER_KEY, JSON.stringify(state.roster));
  // Sync to active team
  if (window.TeamManager) window.TeamManager.syncRosterToActiveTeam(state.roster);
  save();
  $('rosterModal').style.display='none';
}
function closeRoster(){ $('rosterModal').style.display='none'; }

/* Player picker flow (supports scorer + assist) */
let pickerFlow = {mode:null, pendingGoalEv:null};

function openPicker(mode, label, { showNone=false, exclude=[] } = {}){
  pickerFlow.mode = mode;
  $('pickerTitle').textContent = label || 'Select Player';

  $('pickerNone').style.display = showNone ? 'inline-block' : 'none';

  const excludeSet = new Set((exclude || []).map(x => String(x).trim()).filter(Boolean));

  const roster = sortRoster((state.roster || []).map(x => String(x).trim()).filter(Boolean));
  const uniq = Array.from(new Set(roster)).filter(n => !excludeSet.has(String(n)));

  $('pickerGrid').innerHTML = uniq.length
    ? uniq.map(n=>`<div class="pickerBtn" data-n="${n}">#${n}</div>`).join('')
    : `<div class="small" style="grid-column:1/-1;">No roster yet. Type a number below.</div>`;

  $('pickerInput').value='';
  $('pickerModal').style.display='flex';
}

/* Tap roster number to immediately apply */
$('pickerGrid').addEventListener('click', e=>{
  const b=e.target.closest('.pickerBtn');
  if(!b)return;
  applyPickerSelection(b.dataset.n);
});
$('pickerAdd').addEventListener('click', ()=>{
  const num = $('pickerInput').value.trim() || '?';
  applyPickerSelection(num);
});
$('pickerUnknown').addEventListener('click', ()=>applyPickerSelection('?'));
$('pickerNone').addEventListener('click', ()=>{
  // No Assist
  applyPickerSelection(null);
});
$('pickerCancel').addEventListener('click', ()=>{
  $('pickerModal').style.display='none';
  pickerFlow.mode=null;
});

function applyPickerSelection(num){
  const mode = pickerFlow.mode;
  $('pickerModal').style.display='none';

  if(!mode) return;

  // roster auto-grow for numeric entries (main behavior)
  if(num!==null) ensureRosterNumber(String(num));

  if(mode==='for_shot'){
    const ev = addEvent('for_shot',{player: (num===null ? '?' : String(num))});
    pickerFlow.mode=null;
    renderAll();
    openDangerPrompt(ev);
    return;
  }

  if(mode==='for_goal_scorer'){
    // scorer can be unknown
    const scorer = (num===null ? '?' : String(num));
    ensureRosterNumber(scorer);

    const ev = addEvent('for_goal',{player:scorer});
    pickerFlow.pendingGoalEv = ev;

    // next: assist picker (optional, can be unknown too)
    pickerFlow.mode='for_goal_assist';
    openPicker('for_goal_assist','Assist (optional)',{showNone:true, exclude:[scorer]});
    return;
  }

  if(mode==='for_goal_assist'){
    const ev = pickerFlow.pendingGoalEv;
    if(!ev){ pickerFlow.mode=null; return; }

    // assist can be null (no assist) or unknown '?'
    ev.assist = (num===null ? null : String(num));
    if(ev.assist!==null) ensureRosterNumber(ev.assist);

    save();
    renderAll();

if(prefs.trackPlusMinus){
  const known = [];
  if(ev.player && ev.player !== '?' && ev.player !== 'Unknown') known.push(String(ev.player));
  if(ev.assist && ev.assist !== '?' && ev.assist !== 'Unknown') known.push(String(ev.assist));
  const exclude = [...new Set(known)];
  const max = Math.max(0, 5 - exclude.length);
  openMultiPicker({ title:`Other ${max} On Ice (optional)`, max, event: ev, field: 'forOnIce', exclude });
} else {
  openStrengthPicker(ev, 'Our Team\'s Situation (required)');
}

pickerFlow.mode=null;
pickerFlow.pendingGoalEv=null;
return;

  }

  pickerFlow.mode=null;
}

/* Init */
(function init(){
  // Date input default (iOS-safe: set string, not valueAsDate)
  const todayStr = getLocalTodayYMD();
  $('date').value = todayStr;
  setInGameHeader(false);

  // Keep state date aligned initially
  state.date = todayStr;

  try{ state.roster = JSON.parse(localStorage.getItem(ROSTER_KEY))||[]; }catch(_){}
  persistStorage();

  // cloud ping (useful status)
  pingCloud();

  load().then(loaded=>{
    if(loaded && Array.isArray(loaded.events)){
      Object.assign(state, loaded);
      state.period = sanitizePeriod(state.period);
      state.date = sanitizeDateInput(state.date);
      state.events.sort((a,b)=>new Date(a.tISO)-new Date(b.tISO));
      state.events.forEach(ev=>{ ev.period = sanitizePeriod(ev.period); });
      rebuildFromEvents();
    }

    // Decide whether this is a real resume
    const hasEvents = Array.isArray(state.events) && state.events.length > 0;

    if(hasEvents){
      $('resumeBanner').classList.remove('hidden');
      toggleSetup(false);
    } else {
      $('resumeBanner').classList.add('hidden');
      // Clear ONLY the setup field display so it doesn't show stale opponent
      $('opponent').value = '';
    }

    // Ensure date always has a value (and keep input in sync)
    if(!state.date){
      state.date = $('date').value || todayStr;
    }
    state.date = sanitizeDateInput(state.date);
    $('date').value = state.date;

    // Sync setup inputs from state (except opponent when not resuming)
    if(hasEvents){
      $('opponent').value = state.opponent || '';
    }
    $('level').value = state.level || $('level').value;

    updateMeta();
    highlightPeriod();
    renderAll();
    validateState('init load');
    refreshCloudStatus();

    // Restore live-share button state after loading saved game.
    if (state.shareCode) {
      setLiveShareUi(true);
      hideLiveShareBanner();
    } else {
      setLiveShareUi(false);
    }

    // If not saved, show cloud OK/offline
    const last = localStorage.getItem(LAST_SAVED_KEY);
    if(!last || last !== state.gameId){
      pingCloud();
    }
  });

  /* First-launch welcome modal */
  const SEEN_KEY = 'team-tracker-welcome-seen';
  const hasSeenWelcome = localStorage.getItem(SEEN_KEY);
  if(!hasSeenWelcome){
    $('welcomeModal').style.display = 'flex';
    $('btnHelp').classList.add('pulse');
  }
  $('btnWelcomeDismiss').onclick = function(){
    $('welcomeModal').style.display = 'none';
    localStorage.setItem(SEEN_KEY, '1');
  };
  // Also dismiss on backdrop click
  $('welcomeModal').addEventListener('click', function(e){
    if(e.target === $('welcomeModal')){
      $('welcomeModal').style.display = 'none';
      localStorage.setItem(SEEN_KEY, '1');
    }
  });

  /* Help button */
  $('btnHelp').onclick = function(){
    $('helpModal').style.display = 'flex';
    // Stop pulsing after first open
    $('btnHelp').classList.remove('pulse');
    if(!hasSeenWelcome) localStorage.setItem(SEEN_KEY, '1');
  };
  $('btnHelpClose').onclick = function(){
    $('helpModal').style.display = 'none';
  };
  $('helpModal').addEventListener('click', function(e){
    if(e.target === $('helpModal')) $('helpModal').style.display = 'none';
  });

  /* Header menu */
  const headerMenu = $('headerMenu');
  $('btnHeaderMenu').onclick = function(e){
    e.stopPropagation();
    if (!headerMenu) return;
    headerMenu.classList.toggle('open');
  };
  if (headerMenu) {
    headerMenu.addEventListener('click', (e) => {
      if (e.target.closest('button')) closeHeaderMenu();
    });
  }
  document.addEventListener('click', (e) => {
    if (!headerMenu || !headerMenu.classList.contains('open')) return;
    if (e.target === $('btnHeaderMenu') || $('btnHeaderMenu').contains(e.target)) return;
    if (headerMenu.contains(e.target)) return;
    closeHeaderMenu();
  });

  /* ===== Team Selector Init ===== */
  refreshTeamUI();

})();

/* ===== Multi-Team Management ===== */

/* Team manager accessor with local fallback in case teams.js is delayed/missing. */
function getTeamManager() {
  if (window.TeamManager && typeof window.TeamManager.loadTeams === 'function') {
    return window.TeamManager;
  }

  const TEAMS_KEY = 'team-tracker-teams';
  const ACTIVE_TEAM_KEY = 'team-tracker-active-team';

  const safeParse = (v) => {
    try { return JSON.parse(v); } catch (_) { return null; }
  };
  const loadTeams = () => {
    const parsed = safeParse(localStorage.getItem(TEAMS_KEY));
    return Array.isArray(parsed) ? parsed : [];
  };
  const saveTeams = (teams) => localStorage.setItem(TEAMS_KEY, JSON.stringify(Array.isArray(teams) ? teams : []));
  const getActiveTeamId = () => localStorage.getItem(ACTIVE_TEAM_KEY) || null;
  const setActiveTeamId = (id) => {
    if (id) localStorage.setItem(ACTIVE_TEAM_KEY, id);
    else localStorage.removeItem(ACTIVE_TEAM_KEY);
  };
  const getActiveTeam = () => {
    const id = getActiveTeamId();
    return id ? (loadTeams().find(t => t.id === id) || null) : null;
  };
  const makeId = () => 't_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const createTeam = (name, level, roster) => {
    const teams = loadTeams();
    const team = {
      id: makeId(),
      name: String(name || '').trim(),
      level: level || 'U11',
      roster: Array.isArray(roster) ? roster : []
    };
    teams.push(team);
    saveTeams(teams);
    return team;
  };
  const updateTeam = (id, updates) => {
    const teams = loadTeams();
    const i = teams.findIndex(t => t.id === id);
    if (i === -1) return null;
    if (updates.name !== undefined) teams[i].name = String(updates.name || '').trim();
    if (updates.level !== undefined) teams[i].level = updates.level;
    if (updates.roster !== undefined) teams[i].roster = updates.roster;
    saveTeams(teams);
    return teams[i];
  };
  const deleteTeam = (id) => {
    let teams = loadTeams();
    teams = teams.filter(t => t.id !== id);
    saveTeams(teams);
    if (getActiveTeamId() === id) setActiveTeamId(teams.length ? teams[0].id : null);
  };
  const syncRosterToActiveTeam = (roster) => {
    const id = getActiveTeamId();
    if (!id) return;
    updateTeam(id, { roster });
  };

  window.TeamManager = {
    loadTeams,
    saveTeams,
    getActiveTeamId,
    setActiveTeamId,
    getActiveTeam,
    createTeam,
    updateTeam,
    deleteTeam,
    syncRosterToActiveTeam
  };
  return window.TeamManager;
}

/* Show/hide the right section on the setup screen based on whether teams exist */
function refreshTeamUI() {
  const TM = getTeamManager();
  const teams = TM.loadTeams();
  const activeId = TM.getActiveTeamId();
  const activeTeam = activeId ? teams.find(t => t.id === activeId) : null;

  if (teams.length === 0) {
    // No teams: show "Add Team" prompt, hide selector
    $('teamEmpty').style.display = '';
    $('teamHasTeams').style.display = 'none';
    // Show editable level dropdown (no team to pull from)
    $('levelGroup').style.display = '';
    $('levelReadonly').style.display = 'none';
  } else {
    // Has teams: show selector, hide prompt
    $('teamEmpty').style.display = 'none';
    $('teamHasTeams').style.display = '';
    // Populate dropdown
    const sel = $('teamSelect');
    sel.innerHTML = '<option value="">— Select Team —</option>' +
      teams.map(t => `<option value="${t.id}">${t.name} (${t.level})</option>`).join('');
    sel.value = activeId || '';

    // Toggle level display: readonly when team selected, editable when "no team"
    if (activeTeam) {
      $('levelGroup').style.display = 'none';
      $('levelReadonly').style.display = '';
      $('levelDisplay').textContent = activeTeam.level || 'U11';
    } else {
      $('levelGroup').style.display = '';
      $('levelReadonly').style.display = 'none';
    }
  }
}

function applyActiveTeam() {
  const TM = getTeamManager();
  const team = TM.getActiveTeam();
  if (team) {
    state.roster = Array.isArray(team.roster) ? [...team.roster] : [];
    state.level = team.level || state.level;
    $('level').value = state.level;
    try { localStorage.setItem(ROSTER_KEY, JSON.stringify(state.roster)); } catch (_) {}
    save();
  }
  refreshTeamUI();
}

function openTeamModal(autoShowForm) {
  const TM = getTeamManager();
  renderTeamList();
  if (autoShowForm) {
    showTeamForm(null);
  } else {
    hideTeamForm();
  }
  $('teamModal').style.display = 'flex';
}

function renderTeamList() {
  const TM = getTeamManager();
  const teams = TM.loadTeams();
  const activeId = TM.getActiveTeamId();

  if (!teams.length) {
    $('teamList').innerHTML = '';
    $('btnAddTeam').style.display = 'none';
    return;
  }

  $('btnAddTeam').style.display = '';
  $('teamList').innerHTML = teams.map(t => {
    const isActive = t.id === activeId;
    const rosterCount = (t.roster || []).length;
    return `<div class="team-list-item${isActive ? ' active' : ''}" data-id="${t.id}">
      <div class="team-item-info">
        <span class="team-item-name">${t.name}</span>
        <span class="team-item-meta">${t.level} &bull; ${rosterCount} player${rosterCount !== 1 ? 's' : ''}</span>
      </div>
      <div class="team-item-actions">
        <button class="btn-edit" data-id="${t.id}">Edit</button>
        <button class="btn-del" data-id="${t.id}">Del</button>
      </div>
    </div>`;
  }).join('');

  // Delegated click handler for team list
  $('teamList').onclick = function(e) {
    const TM = getTeamManager();
    const editBtn = e.target.closest('.btn-edit');
    const delBtn = e.target.closest('.btn-del');
    const row = e.target.closest('.team-list-item');

    if (editBtn) {
      e.stopPropagation();
      const team = TM.loadTeams().find(t => t.id === editBtn.dataset.id);
      if (team) showTeamForm(team);
      return;
    }
    if (delBtn) {
      e.stopPropagation();
      showConfirm('Delete this team?').then(ok => {
        if (!ok) return;
        TM.deleteTeam(delBtn.dataset.id);
        refreshTeamUI();
        renderTeamList();
      });
      return;
    }
    if (row) {
      TM.setActiveTeamId(row.dataset.id);
      $('teamSelect').value = row.dataset.id;
      applyActiveTeam();
      refreshTeamUI();
      renderTeamList();
      showStatusToast('Team selected', 'success');
    }
  };
}

function showTeamForm(team) {
  const form = $('teamForm');
  form.classList.add('visible');
  $('btnAddTeam').style.display = 'none';

  if (team) {
    $('teamFormTitle').textContent = 'Edit Team';
    $('teamNameInput').value = team.name;
    $('teamLevelInput').value = team.level || 'U11';
    $('teamRosterInput').value = (team.roster || []).join('\n');
    form.dataset.editId = team.id;
  } else {
    $('teamFormTitle').textContent = 'Add New Team';
    $('teamNameInput').value = '';
    $('teamLevelInput').value = 'U11';
    $('teamRosterInput').value = '';
    form.dataset.editId = '';
  }
  $('teamNameInput').focus();
}

function hideTeamForm() {
  $('teamForm').classList.remove('visible');
  $('teamForm').dataset.editId = '';
  const TM = getTeamManager();
  if (TM.loadTeams().length) $('btnAddTeam').style.display = '';
}

function saveTeamFromForm() {
  const TM = getTeamManager();
  const name = $('teamNameInput').value.trim();
  if (!name) { $('teamNameInput').focus(); return; }
  const level = $('teamLevelInput').value;
  const rosterRaw = $('teamRosterInput').value.split('\n').map(x => x.trim()).filter(Boolean);

  const editId = $('teamForm').dataset.editId;
  if (editId) {
    TM.updateTeam(editId, { name, level, roster: rosterRaw });
  } else {
    const team = TM.createTeam(name, level, rosterRaw);
    TM.setActiveTeamId(team.id);
    applyActiveTeam();
  }
  refreshTeamUI();
  renderTeamList();
  hideTeamForm();
  showStatusToast(editId ? 'Team updated' : 'Team added!', 'success');
}

function renderAll(){
  rebuildFromEvents();
  updateMeta();
  renderLog();
}

/* Button Wiring — Teams */
$('btnAddFirstTeam').onclick = function(e){
  if (e) e.preventDefault();
  openTeamModal(true);
};
$('btnManageTeams').onclick = function(e){
  if (e) e.preventDefault();
  openTeamModal(false);
};
$('teamModalClose').onclick = function(){ $('teamModal').style.display='none'; };
$('btnAddTeam').onclick = function(){ showTeamForm(null); };
$('teamFormSave').onclick = saveTeamFromForm;
$('teamFormCancel').onclick = hideTeamForm;
$('teamSelect').onchange = function(){
  const TM = getTeamManager();
  TM.setActiveTeamId(this.value || null);
  applyActiveTeam();
};

// Extra delegated safety wiring for dynamic/late-rendered setup controls.
document.addEventListener('click', (e) => {
  const addFirst = e.target.closest('#btnAddFirstTeam');
  if (addFirst) {
    e.preventDefault();
    openTeamModal(true);
    return;
  }
  const manage = e.target.closest('#btnManageTeams');
  if (manage) {
    e.preventDefault();
    openTeamModal(false);
  }
});

/* Button Wiring */
$('btnRoster').onclick=openRoster;
$('btnRosterSave').onclick=saveRosterFromArea;
$('btnRosterClose').onclick=closeRoster;

/* High Danger modal logic — auto-dismisses after 2s (defaults to No) */
let dangerTarget = null;
let dangerAutoTimer = null;
function openDangerPrompt(ev) {
  dangerTarget = ev;
  $('dangerTitle').textContent = 'High Danger Chance?';
  $('dangerModal').style.display = 'flex';
  // Auto-dismiss after 2s if user doesn't tap
  if (dangerAutoTimer) clearTimeout(dangerAutoTimer);
  dangerAutoTimer = setTimeout(() => {
    if (dangerTarget) {
      dangerTarget.highDanger = false;
      save();
      $('dangerModal').style.display = 'none';
      dangerTarget = null;
    }
    dangerAutoTimer = null;
  }, 2000);
}
function closeDangerModal() {
  if (dangerAutoTimer) { clearTimeout(dangerAutoTimer); dangerAutoTimer = null; }
  $('dangerModal').style.display = 'none';
  dangerTarget = null;
}
$('dangerModal').addEventListener('click', e => {
  const b = e.target.closest('.pickerBtn');
  if (!b || !dangerTarget) {
    // Backdrop click — dismiss as No
    if (e.target === $('dangerModal')) {
      if (dangerTarget) { dangerTarget.highDanger = false; save(); }
      closeDangerModal();
    }
    return;
  }
  if (dangerAutoTimer) { clearTimeout(dangerAutoTimer); dangerAutoTimer = null; }
  dangerTarget.highDanger = (b.dataset.danger === 'yes');
  save();
  $('dangerModal').style.display = 'none';
  dangerTarget = null;
  renderAll();
});

$('btnShot').onclick=function(){ flashBtn(this); const ev = addEvent('shot'); openDangerPrompt(ev); };
$('btnGoal').onclick=function(){ flashBtn(this); addEvent('goal'); };

$('btnForShot').onclick=function(){ flashBtn(this); openPicker('for_shot','Shooter'); };
$('btnForGoal').onclick=function(){ flashBtn(this); openPicker('for_goal_scorer','Scorer'); };

$('btnSoftGoal').onclick=function(){ flashBtn(this); addEvent('soft_goal'); };
$('btnBadRebound').onclick=function(){ flashBtn(this); addEvent('bad_rebound'); };

$('btnBreakaway').onclick=function(){ flashBtn(this); addEvent('breakaway_against'); };
$('btnDZTurnover').onclick=function(){ flashBtn(this); addEvent('dz_turnover'); };

$('btnSmother').onclick=function(){ flashBtn(this); addEvent('smother'); };
$('btnBigSave').onclick=function(){ flashBtn(this); addEvent('big_save'); };

$('btnBreakawayFor').onclick=function(){ flashBtn(this); lastBreakawayForTap = Date.now(); addEvent('breakaway_for'); };
$('btnOddManRushFor').onclick=function(){ flashBtn(this); addEvent('odd_man_rush_for'); };
$('btnForcedTurnover').onclick=function(){ flashBtn(this); addEvent('forced_turnover'); };

$('btnOMRAgainst').onclick=function(){ flashBtn(this); addEvent('odd_man_rush_against'); };
$('btnPenaltyFor').onclick=function(){ flashBtn(this); addEvent('penalty_for'); };
$('btnPenaltyAgainst').onclick=function(){ flashBtn(this); addEvent('penalty_against'); };
$('btnMissedChanceFor').onclick=function(){ flashBtn(this); addEvent('missed_chance_for'); };
$('btnMissedChanceAg').onclick=function(){ flashBtn(this); addEvent('missed_chance_against'); };

$('periodChips').addEventListener('click',e=>{
  const c=e.target.closest('.p-opt');
  if(!c)return;
  state.period=sanitizePeriod(c.dataset.p);
  save();
  validateState('period chip change');
  highlightPeriod();
});

$('btnNextPeriod').onclick=()=>{
  state.period=sanitizePeriod(Math.min(MAX_PERIOD, Number(state.period) + 1));
  save();
  validateState('next period');
  highlightPeriod();
  vibrate(HAPTIC.period);
};

$('btnEnd').onclick=endGame;

$('btnBackToGame').onclick=()=>{
  $('summaryPanel').classList.add('hidden');
  $('gameControls').style.display='block';
  setInGameHeader(true);
  $('btnUndo').style.display='flex';
};

$('btnNewFromSummary').onclick=async()=>{
  const ok = await showConfirm('Start a new game?');
  if(!ok) return;

  // Stop live share if active
  if(state.shareCode) stopLiveShare();

  $('resumeBanner').classList.add('hidden');

  state.events=[];
  cancelRecentGoodCredit();
  lastRemoved = null;
  state.date = getLocalTodayYMD();
  $('date').value = state.date;
  state.period = 1;
  state.opponent='';
  $('opponent').value = '';
  state.countsA={shots:0,goals:0,softGoals:0,smothers:0,badRebounds:0,bigSaves:0};
  state.countsF={shots:0,goals:0};
  state.team={breakawaysAgainst:0,dzTurnovers:0,breakawaysFor:0,oddManRushFor:0,oddManRushAgainst:0,penaltiesFor:0,penaltiesAgainst:0,missedChancesFor:0,missedChancesAgainst:0,forcedTurnovers:0};
  per={1:initP(),2:initP(),3:initP(),4:initP()};

  state.gameId = Math.random().toString(36).slice(2);
  state.startedAt = new Date().toISOString();
  state.lastEventId = 0;

  save();
  validateState('new game from summary');
  toggleSetup(true);
  highlightPeriod();
  renderAll();
  $('summaryPanel').classList.add('hidden');

  try{ localStorage.removeItem(LAST_SAVED_KEY); }catch(_){}
  pingCloud();
};

$('btnReset').onclick=async()=>{
  const ok = await showConfirm('Clear current game and start fresh?');
  if(!ok) return;

  // Stop live share if active
  if(state.shareCode) stopLiveShare();

  // Hide "Resumed saved game" banner when starting a truly new game
  $('resumeBanner').classList.add('hidden');

  state.events=[];
  cancelRecentGoodCredit();
  lastRemoved = null;
  state.date = getLocalTodayYMD();
  $('date').value = state.date;
  state.period = 1;
  state.opponent='';
  $('opponent').value = '';
  state.countsA={shots:0,goals:0,softGoals:0,smothers:0,badRebounds:0,bigSaves:0};
  state.countsF={shots:0,goals:0};
  state.team={breakawaysAgainst:0,dzTurnovers:0,breakawaysFor:0,oddManRushFor:0,oddManRushAgainst:0,penaltiesFor:0,penaltiesAgainst:0,missedChancesFor:0,missedChancesAgainst:0,forcedTurnovers:0};
  per={1:initP(),2:initP(),3:initP(),4:initP()};

  state.gameId = Math.random().toString(36).slice(2);
  state.startedAt = new Date().toISOString();
  state.lastEventId = 0;

  save();
  validateState('new game reset');
  toggleSetup(true);
  highlightPeriod();
  renderAll();
  $('summaryPanel').classList.add('hidden');

  // reset cloud pill to connectivity
  try{ localStorage.removeItem(LAST_SAVED_KEY); }catch(_){}
  pingCloud();
};

/* Modals close on backdrop click — with state cleanup for stateful modals */
document.querySelectorAll('.modal').forEach(m=>
  m.addEventListener('click',e=>{
    if(e.target!==m) return;
    m.style.display='none';
    // Clean up state for modals that track pending operations
    const mid = m.id;
    if(mid==='pickerModal'){ pickerFlow.mode=null; }
    if(mid==='strengthModal'){ strengthTarget=null; }
    if(mid==='gaOverlay'){ lastGAEvent=null; }
    if(mid==='onIceModal'){ multiPick.eventRef=null; }
  })
);

/* Inputs */
$('opponent').oninput=e=>{state.opponent=e.target.value;save();}
$('level').onchange=e=>{state.level=e.target.value;save();}
$('date').onchange=e=>{state.date=sanitizeDateInput(e.target.value);$('date').value=state.date;save();validateState('date change');}
$('togglePM').checked = prefs.trackPlusMinus;
$('togglePM').addEventListener('change', e=>{ prefs.trackPlusMinus = e.target.checked; savePrefs(); });

/* Copy Summary (now: compact, structured text) */
$('btnCopySummary').addEventListener('click', ()=>{
  const date = state.date || getLocalTodayYMD();
  const SF=state.countsF.shots, SA=state.countsA.shots, GF=state.countsF.goals, GA=state.countsA.goals;
  const saves=Math.max(0,SA-GA);
  const svText = SA ? (saves/SA).toFixed(3).slice(1) : '—';
  const shootPct = SF ? (GF/SF).toFixed(3).slice(1) : '—';
  const share = (SF+SA) ? Math.round(100*(SF/(SF+SA)))+'%' : '—';
  const K=computeGoalieScore(), T=computeTeamScore();
  const gfCtx = computeGFContextBreakdown();
  const gaStats = computeGABreakdown();

  const sqCopy = computeShotQuality();
  const lines = [
    `${state.level||'?'} vs ${state.opponent||'Unknown'} on ${date}`,
    `Score: Us ${GF} – ${GA} Them`,
    `Shots: SF ${SF}, SA ${SA} | Saves ${saves} | SV% ${svText}`,
    `Team Score: ${T.total}/100 | Goalie Score: ${K.total}/100`,
    `xGF ${sqCopy.xGF} | xGA ${sqCopy.xGA} | xG Diff ${sqCopy.xGDiff > 0 ? '+' : ''}${sqCopy.xGDiff} | HD For ${sqCopy.hdFor} (${sqCopy.hdPctFor}%) | HD Ag ${sqCopy.hdAg} (${sqCopy.hdPctAg}%)`,
    `Smothers ${state.countsA.smothers} | Bad Reb ${state.countsA.badRebounds} | Big Saves ${state.countsA.bigSaves} | Soft Goals ${state.countsA.softGoals}`,
    `Shot Share ${share} | Our Shooting% ${shootPct}`,
    `BA Ag ${state.team.breakawaysAgainst} | DZ TO ${state.team.dzTurnovers} | OMR Ag ${state.team.oddManRushAgainst||0} | BA For ${state.team.breakawaysFor} | OMR For ${state.team.oddManRushFor} | FT ${state.team.forcedTurnovers||0}`,
    `Penalties For ${state.team.penaltiesFor||0} | Penalties Ag ${state.team.penaltiesAgainst||0}`,
    `GF off BA ${gfCtx.BA} | GF off OMR ${gfCtx.OMR} | GF off FT ${gfCtx.FT||0} | GF Other ${gfCtx.Other}`,
    `GA off Bad Reb ${gaStats.BR} | GA off BA ${gaStats.BA} | GA off DZ ${gaStats.DZ} | GA Other ${gaStats.Other}`
  ];

  const text = lines.join('\n');
  $('copyArea').value = text;
  $('copyModal').style.display='flex';
  if(navigator.clipboard && text){
    navigator.clipboard.writeText(text).catch(()=>{});
  }
});
$('btnCopySelect').addEventListener('click', ()=>{
  const area = $('copyArea');
  area.focus();
  area.select();
});
$('btnCopyClose').addEventListener('click', ()=>{ $('copyModal').style.display='none'; });

/* Export CSV */
$('btnExportGameCSV').addEventListener('click', exportGameCSV);

/* ===== Game History ===== */
$('btnHistory').addEventListener('click', async ()=>{
  $('historyPanel').style.display = 'block';
  $('historyList').innerHTML = '<div style="text-align:center; padding:20px; color:var(--muted);">Loading...</div>';
  try{
    const uid = typeof window.getAuthUserId === 'function' ? window.getAuthUserId() : null;
    const TM = window.TeamManager;
    const tid = TM ? TM.getActiveTeamId() : null;
    let histUrl = '/api/games';
    const params = [];
    if (uid) params.push('user_id=' + encodeURIComponent(uid));
    if (tid) params.push('team_id=' + encodeURIComponent(tid));
    if (params.length) histUrl += '?' + params.join('&');
    const res = await fetch(histUrl);
    const d = await res.json();
    if(!d.success || !d.games || !d.games.length){
      $('historyList').innerHTML = '<div style="text-align:center; padding:20px;">No past games found.</div>';
      return;
    }
    renderHistoryList(d.games);
  }catch(e){
    console.error(e);
    $('historyList').innerHTML = '<div style="text-align:center; padding:20px; color:var(--accent-them);">Failed to load games. Check your connection.</div>';
  }
});
$('btnHistoryClose').addEventListener('click', ()=>{ $('historyPanel').style.display='none'; });

function renderHistoryList(games){
  $('historyList').innerHTML = games.map((g,i) => {
    const data = g.data || {};
    const gf = data.GF ?? '?';
    const ga = data.GA ?? '?';
    const opp = data.Opponent || g.opponent || 'Unknown';
    const date = data.Date || g.date || '—';
    const level = data.Level || g.level || '';
    const gs = data.GoalieScore != null ? data.GoalieScore : '—';
    const ts = data.TeamScore != null ? data.TeamScore : '—';
    const scoreClass = gf > ga ? 'w' : gf < ga ? 'l' : 't';
    return `<div class="history-item" data-idx="${i}">
      <div class="history-left">
        <span class="history-opp">vs ${opp}</span>
        <span class="history-meta">${date} &bull; ${level} &bull; GK:${gs} TM:${ts}</span>
      </div>
      <div class="history-score"><span class="${scoreClass}">${gf}–${ga}</span></div>
    </div>`;
  }).join('');

  // Store games for detail view
  $('historyList')._games = games;

  $('historyList').onclick = (e) => {
    const item = e.target.closest('.history-item');
    if(!item) return;
    const idx = Number(item.dataset.idx);
    const game = $('historyList')._games[idx];
    if(game) showGameDetail(game);
  };
}

let currentDetailGameId = null;

function showGameDetail(game){
  const d = game.data || {};
  const opp = d.Opponent || game.opponent || 'Unknown';
  const date = d.Date || game.date || '—';
  const level = d.Level || game.level || '';

  currentDetailGameId = game.id || null;
  $('gameDetailTitle').textContent = `${opp} — ${date}`;

  const gf=d.GF??'—', ga=d.GA??'—', sf=d.SF??'—', sa=d.SA??'—';
  const saves = d.Saves ?? '—', sv = d.SVPct ?? '—';
  const shoot = d.OurShootingPct ?? '—';
  const share = d.ShotShare != null ? Math.round(d.ShotShare*100)+'%' : '—';

  const rows = [
    ['Level', level], ['GF', gf], ['GA', ga],
    ['SF', sf], ['SA', sa], ['Saves', saves],
    ['SV%', sv], ['Our Shooting%', shoot], ['Shot Share', share],
    ['Goalie Score', d.GoalieScore ?? '—'], ['Team Score', d.TeamScore ?? '—'],
    ['Smothers', d.Smothers ?? '—'], ['Bad Rebounds', d.BadRebounds ?? '—'],
    ['Big Saves', d.BigSaves ?? '—'], ['Soft Goals', d.SoftGoals ?? '—'],
    ['Breakaways Ag', d.BreakawaysAgainst ?? '—'], ['DZ Turnovers', d.DZTurnovers ?? '—'],
    ['Breakaways For', d.BreakawaysFor ?? '—'], ['Odd Man Rush For', d.OddManRushFor ?? '—'], ['Forced Turnovers', d.ForcedTurnovers ?? '—'],
    ['GA off BA', d.GA_BA ?? '—'], ['GA off DZ', d.GA_DZ ?? '—'],
    ['GA off Bad Reb', d.GA_BR ?? '—'], ['GA Other', d.GA_Other ?? '—']
  ];

  let html = '<table><tr><th>Stat</th><th>Value</th><th>Stat</th><th>Value</th></tr>';
  for(let i=0;i<rows.length;i+=2){
    const a=rows[i], b=rows[i+1];
    html+=`<tr><td>${a[0]}</td><td>${a[1]}</td><td>${b?b[0]:''}</td><td>${b?b[1]:''}</td></tr>`;
  }
  html+='</table>';

  $('gameDetailBody').innerHTML = html;
  $('gameDetailDelete').style.display = currentDetailGameId ? 'inline-block' : 'none';
  $('gameDetailModal').style.display = 'flex';
}
$('gameDetailClose').addEventListener('click', ()=>{ $('gameDetailModal').style.display='none'; });

$('gameDetailDelete').addEventListener('click', async ()=>{
  if(!currentDetailGameId) return;
  const ok = await showConfirm('Permanently delete this game?');
  if(!ok) return;

  try{
    const res = await fetch(`/api/games?id=${encodeURIComponent(currentDetailGameId)}`, { method:'DELETE' });
    const d = await res.json();
    if(d.success){
      showStatusToast('Game deleted', 'success');
      $('gameDetailModal').style.display = 'none';
      // Refresh the history list
      $('btnHistory').click();
    } else {
      showStatusToast('Delete failed', 'error', 3500);
    }
  }catch(e){
    console.error(e);
    showStatusToast('Error deleting game', 'error', 3500);
  }
});

/* ===== Season Dashboard ===== */
$('btnSeason').addEventListener('click', async ()=>{
  $('seasonPanel').style.display = 'block';
  $('seasonBody').innerHTML = '<div style="text-align:center; padding:20px; color:var(--muted);">Loading...</div>';
  try{
    const uid = typeof window.getAuthUserId === 'function' ? window.getAuthUserId() : null;
    const TM = window.TeamManager;
    const teamId = TM ? TM.getActiveTeamId() : null;
    let histUrl = '/api/games?limit=100';
    if(uid) histUrl += '&user_id=' + encodeURIComponent(uid);
    if(teamId) histUrl += '&team_id=' + encodeURIComponent(teamId);
    const res = await fetch(histUrl);
    const d = await res.json();
    if(!d.success || !d.games || !d.games.length){
      $('seasonBody').innerHTML = '<div style="text-align:center; padding:20px;">No games yet — play some games first!</div>';
      return;
    }
    renderSeasonDashboard(d.games);
  }catch(e){
    console.error(e);
    $('seasonBody').innerHTML = '<div style="text-align:center; padding:20px; color:var(--accent-them);">Failed to load. Check your connection.</div>';
  }
});
$('btnSeasonClose').addEventListener('click', ()=>{ $('seasonPanel').style.display='none'; });

function renderSeasonDashboard(games){
  // Extract data from all games
  const stats = games.map(g => g.data || {}).filter(d => d.GF != null);
  if(!stats.length){
    $('seasonBody').innerHTML = '<div style="text-align:center; padding:20px;">No game data to analyze.</div>';
    return;
  }

  const n = stats.length;
  let wins=0, losses=0, ties=0;
  let totalGF=0, totalGA=0, totalSF=0, totalSA=0;
  let totalGK=0, totalTM=0, gkCount=0, tmCount=0;
  const gkTrend=[], tmTrend=[], gfTrend=[], gaTrend=[], labels=[];

  // Process in chronological order (API returns newest first)
  const chrono = stats.slice().reverse();
  for(const d of chrono){
    const gf = Number(d.GF)||0, ga = Number(d.GA)||0;
    if(gf > ga) wins++; else if(ga > gf) losses++; else ties++;
    totalGF += gf;
    totalGA += ga;
    totalSF += Number(d.SF)||0;
    totalSA += Number(d.SA)||0;
    if(d.GoalieScore != null){ totalGK += d.GoalieScore; gkCount++; gkTrend.push(d.GoalieScore); }
    if(d.TeamScore != null){ totalTM += d.TeamScore; tmCount++; tmTrend.push(d.TeamScore); }
    gfTrend.push(gf);
    gaTrend.push(ga);
    labels.push(d.Opponent ? d.Opponent.substring(0,8) : '?');
  }

  const avgGK = gkCount ? Math.round(totalGK/gkCount) : '—';
  const avgTM = tmCount ? Math.round(totalTM/tmCount) : '—';
  const avgGF = (totalGF/n).toFixed(1);
  const avgGA = (totalGA/n).toFixed(1);
  const svPct = totalSA ? (((totalSA - totalGA)/totalSA)*100).toFixed(1) : '—';
  const shotPct = totalSF ? ((totalGF/totalSF)*100).toFixed(1) : '—';
  const shotShare = (totalSF+totalSA) ? Math.round((totalSF/(totalSF+totalSA))*100) : '—';

  // Recent form (last 5)
  const recent5 = chrono.slice(-5);
  const form = recent5.map(d => {
    const gf = Number(d.GF)||0, ga = Number(d.GA)||0;
    if(gf > ga) return '<span class="season-form-w">W</span>';
    if(ga > gf) return '<span class="season-form-l">L</span>';
    return '<span class="season-form-t">T</span>';
  }).join('');

  // Trend arrows (compare last 3 avg to previous 3 avg)
  function trendArrow(arr){
    if(arr.length < 4) return '';
    const recent = arr.slice(-3).reduce((a,b)=>a+b,0)/3;
    const prev = arr.slice(-6,-3).reduce((a,b)=>a+b,0)/Math.min(3, arr.slice(-6,-3).length||1);
    if(!prev) return '';
    const diff = recent - prev;
    if(Math.abs(diff) < 2) return '<span class="trend-flat">—</span>';
    return diff > 0 ? '<span class="trend-up">&#9650;</span>' : '<span class="trend-down">&#9660;</span>';
  }

  // Build sparkline SVG
  function sparkline(data, color, maxH){
    if(data.length < 2) return '';
    const max = Math.max(...data, 1);
    const w = 100, h = maxH || 30;
    const step = w / (data.length - 1);
    const pts = data.map((v,i) => `${i*step},${h - (v/max)*h}`).join(' ');
    return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
  }

  let html = '';

  // Record
  html += `<div class="season-record">
    <div class="season-record-main">${wins}W – ${losses}L${ties?' – '+ties+'T':''}</div>
    <div class="season-record-sub">${n} game${n>1?'s':''} played</div>
    <div class="season-form-row">Form: ${form}</div>
  </div>`;

  // Key stats grid
  html += `<div class="dashGrid" style="margin-top:10px;">
    <div class="dashTile"><div class="k">Avg Goalie</div><div class="v">${avgGK}</div><div class="s">${trendArrow(gkTrend)}</div></div>
    <div class="dashTile"><div class="k">Avg Team</div><div class="v">${avgTM}</div><div class="s">${trendArrow(tmTrend)}</div></div>
    <div class="dashTile"><div class="k">Goals For/G</div><div class="v">${avgGF}</div><div class="s">Total: ${totalGF}</div></div>
    <div class="dashTile"><div class="k">Goals Ag/G</div><div class="v">${avgGA}</div><div class="s">Total: ${totalGA}</div></div>
    <div class="dashTile"><div class="k">SV%</div><div class="v">${svPct}%</div><div class="s">${totalSA-totalGA}/${totalSA}</div></div>
    <div class="dashTile"><div class="k">Shooting%</div><div class="v">${shotPct}%</div><div class="s">${totalGF}/${totalSF}</div></div>
    <div class="dashTile"><div class="k">Shot Share</div><div class="v">${shotShare}%</div><div class="s">SF/(SF+SA)</div></div>
    <div class="dashTile"><div class="k">Goal Diff</div><div class="v" style="color:${totalGF-totalGA>=0?'var(--good)':'var(--accent-them)'}">${totalGF-totalGA>=0?'+':''}${totalGF-totalGA}</div></div>
  </div>`;

  // Sparklines
  if(gkTrend.length >= 3){
    html += `<div class="season-spark-section">
      <div class="season-spark-label">Goalie Score Trend</div>${sparkline(gkTrend,'#4da3ff',30)}
      <div class="season-spark-label" style="margin-top:8px;">Team Score Trend</div>${sparkline(tmTrend,'#4caf50',30)}
      <div class="season-spark-label" style="margin-top:8px;">Goals (green=for, red=against)</div>
      <div class="spark-overlay">${sparkline(gfTrend,'#4caf50',24)}${sparkline(gaTrend,'#ff453a',24)}</div>
    </div>`;
  }

  $('seasonBody').innerHTML = html;
}

/* ===== Live Spectator Sharing ===== */

let _livePushPending = false;
let _livePushQueued = false;

function generateShareCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function classifyLiveEventSide(type){
  switch(type){
    case 'for_shot':
    case 'for_goal':
    case 'smother':
    case 'big_save':
    case 'breakaway_for':
    case 'odd_man_rush_for':
    case 'forced_turnover':
    case 'penalty_for':
    case 'missed_chance_for':
      return 'us';
    case 'shot':
    case 'goal':
    case 'soft_goal':
    case 'bad_rebound':
    case 'breakaway_against':
    case 'odd_man_rush_against':
    case 'dz_turnover':
    case 'penalty_against':
    case 'missed_chance_against':
      return 'them';
    default:
      return null;
  }
}

function computeLiveQualitySummary(){
  const sq = computeShotQuality();
  const GF = state.countsF.goals || 0;
  const GA = state.countsA.goals || 0;
  const qualF = sq.xGF + (GF * (1.0 - XG_RATES.normal));
  const qualA = sq.xGA + (GA * (1.0 - XG_RATES.normal));
  const total = qualF + qualA;
  const pctFor = total > 0 ? Math.round(100 * qualF / total) : 50;
  const pctAgainst = 100 - pctFor;

  let edge = 'even';
  let text = 'Chances are balanced';
  if(pctFor >= 58){
    edge = 'us';
    text = "Strong chance edge: us";
  }else if(pctFor >= 53){
    edge = 'us';
    text = "Slight chance edge: us";
  }else if(pctFor <= 47 && pctFor >= 43){
    edge = 'them';
    text = "Slight chance edge: them";
  }else if(pctFor <= 42){
    edge = 'them';
    text = "Strong chance edge: them";
  }

  return {
    pctFor,
    pctAgainst,
    edge,
    text,
    xGF: sq.xGF,
    xGA: sq.xGA,
    xGDiff: sq.xGDiff,
    hdFor: sq.hdFor,
    hdAgainst: sq.hdAg,
    missedFor: sq.mcFor,
    missedAgainst: sq.mcAg
  };
}

function computeLiveMomentumSummary(){
  const WINDOW_EVENTS = 8;
  const weightByType = {
    shot: 1,
    for_shot: 1,
    goal: 3.4,
    soft_goal: 3.8,
    for_goal: 3.4,
    breakaway_against: 1.5,
    breakaway_for: 1.5,
    odd_man_rush_against: 1.3,
    odd_man_rush_for: 1.3,
    missed_chance_against: 1.1,
    missed_chance_for: 1.1,
    penalty_against: 1.1,
    penalty_for: 1.1,
    big_save: 1.2,
    bad_rebound: 1.2,
    forced_turnover: 1.1,
    dz_turnover: 1.1
  };

  const recent = [];
  for(let i = state.events.length - 1; i >= 0; i--){
    const ev = state.events[i];
    if(!ev) continue;
    if(!weightByType[ev.type]) continue;
    recent.push(ev);
    if(recent.length >= WINDOW_EVENTS) break;
  }

  let us = 0;
  let them = 0;
  for(const ev of recent){
    const w = weightByType[ev.type] || 0;
    if(!w) continue;

    const side = classifyLiveEventSide(ev.type);
    if(side === 'us') us += w;
    else if(side === 'them') them += w;
  }

  const total = us + them;
  const usPct = total > 0 ? Math.round((us / total) * 100) : 50;
  const themPct = 100 - usPct;

  let edge = 'even';
  let text = 'Recent tilt is even';
  if(usPct >= 58){
    edge = 'us';
    text = 'Recent tilt: us';
  }else if(usPct <= 42){
    edge = 'them';
    text = 'Recent tilt: them';
  }

  return {
    windowEvents: WINDOW_EVENTS,
    eventCount: recent.length,
    us: Math.round(us * 10) / 10,
    them: Math.round(them * 10) / 10,
    usPct,
    themPct,
    edge,
    text
  };
}

function buildLiveState() {
  // Build a compact state object for spectators (score, quality, momentum, key events)
  const quality = computeLiveQualitySummary();
  const momentum = computeLiveMomentumSummary();

  const goalieScore = state.events.length ? computeGoalieScore().total : null;
  const teamScore = state.events.length ? computeTeamScore().total : null;

  const saves = Math.max(0, (state.countsA.shots || 0) - (state.countsA.goals || 0));
  const svPct = state.countsA.shots ? Math.round((saves / state.countsA.shots) * 1000) / 10 : null;
  const shotSharePct = (state.countsF.shots + state.countsA.shots)
    ? Math.round((1000 * state.countsF.shots) / (state.countsF.shots + state.countsA.shots)) / 10
    : null;

  const keyEvents = state.events
    .filter(e => [
      'goal',
      'soft_goal',
      'for_goal',
      'penalty_for',
      'penalty_against',
      'breakaway_for',
      'breakaway_against',
      'odd_man_rush_for',
      'odd_man_rush_against',
      'missed_chance_for',
      'missed_chance_against',
      'big_save',
      'bad_rebound'
    ].includes(e.type))
    .slice(-24)
    .map(e => ({
      id: e.id || null,
      type: e.type,
      side: classifyLiveEventSide(e.type),
      period: sanitizePeriod(e.period || state.period),
      tISO: e.tISO || null,
      timeLabel: e.tISO ? fmtTime(e.tISO) : '',
      player: e.player || null,
      assist: e.assist || null,
      strength: e.strength || null,
      highDanger: !!e.highDanger
    }));

  return {
    schema: 2,
    updatedAt: new Date().toISOString(),
    opponent: state.opponent || 'Opponent',
    level: state.level || '',
    date: state.date || '',
    period: state.period,
    goalsFor: state.countsF.goals,
    goalsAgainst: state.countsA.goals,
    shotsFor: state.countsF.shots,
    shotsAgainst: state.countsA.shots,
    saves,
    svPct,
    shotSharePct,
    goalieScore,
    teamScore,
    dangerFor: (state.team.breakawaysFor || 0) + (state.team.oddManRushFor || 0) + (state.team.forcedTurnovers || 0),
    dangerAgainst: (state.team.breakawaysAgainst || 0) + (state.team.oddManRushAgainst || 0) + (state.team.dzTurnovers || 0),
    missedFor: state.team.missedChancesFor || 0,
    missedAgainst: state.team.missedChancesAgainst || 0,
    penaltiesFor: state.team.penaltiesFor || 0,
    penaltiesAgainst: state.team.penaltiesAgainst || 0,
    quality,
    momentum,
    events: keyEvents
  };
}

function hideLiveShareBanner() {
  const banner = $('liveShareBanner');
  if (banner) banner.style.display = 'none';
  if (_liveShareBannerTimer) {
    clearTimeout(_liveShareBannerTimer);
    _liveShareBannerTimer = null;
  }
}

function showLiveShareBanner(autoHideMs = 0) {
  const banner = $('liveShareBanner');
  if (!banner) return;
  banner.style.display = 'flex';
  if (_liveShareBannerTimer) {
    clearTimeout(_liveShareBannerTimer);
    _liveShareBannerTimer = null;
  }
  if (autoHideMs > 0) {
    _liveShareBannerTimer = setTimeout(() => {
      banner.style.display = 'none';
      _liveShareBannerTimer = null;
    }, autoHideMs);
  }
}

function setLiveShareUi(isSharing) {
  const btn = $('btnShareLive');
  if (!btn) return;
  if (isSharing) {
    btn.textContent = 'Sharing Live';
    btn.classList.add('toolbar-btn-live-active');
  } else {
    btn.textContent = 'Share Live';
    btn.classList.remove('toolbar-btn-live-active');
    hideLiveShareBanner();
  }
}

function toggleLiveShareBanner() {
  const banner = $('liveShareBanner');
  if (!banner) return;
  if (banner.style.display === 'none' || !banner.style.display) {
    showLiveShareBanner(0);
  } else {
    hideLiveShareBanner();
  }
}

async function pushLiveState() {
  if (!state.shareCode) return;
  if (_livePushPending) {
    _livePushQueued = true;
    return;
  }

  _livePushPending = true;
  try {
    do {
      _livePushQueued = false;
      const uid = typeof window.getAuthUserId === 'function' ? window.getAuthUserId() : null;
      const res = await fetch('/api/live-game', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          share_code: state.shareCode,
          game_id: state.gameId,
          user_id: uid,
          state: buildLiveState()
        })
      });
      if(!res.ok) throw new Error('live push failed');
    } while (_livePushQueued && state.shareCode);
  } catch (_) { /* silent – spectators just see stale data briefly */ }
  _livePushPending = false;
}

async function startLiveShare() {
  const code = generateShareCode();
  state.shareCode = code;
  save();

  // Open the controls immediately so copy/stop is the next obvious action.
  setLiveShareUi(true);
  showLiveShareBanner(0);

  // Initial push
  await pushLiveState();
}

async function endLiveShare() {
  // Push final state so spectators see the final score, then clean up after 5 min
  const code = state.shareCode;
  if (!code) return;

  // Push one last update with final flag
  try {
    const uid = typeof window.getAuthUserId === 'function' ? window.getAuthUserId() : null;
    await fetch('/api/live-game', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        share_code: code,
        game_id: state.gameId,
        user_id: uid,
        state: { ...buildLiveState(), final: true }
      })
    });
  } catch (_) {}

  // Clear local share state & UI
  state.shareCode = null;
  save();
  setLiveShareUi(false);

  // Delete the record after 5 minutes so spectators have time to see final score
  setTimeout(async () => {
    try {
      await fetch(`/api/live-game?code=${encodeURIComponent(code)}`, { method: 'DELETE' });
    } catch (_) {}
  }, 5 * 60 * 1000);
}

async function stopLiveShare() {
  const code = state.shareCode;
  state.shareCode = null;
  save();

  // Hide controls & reset button state
  setLiveShareUi(false);

  // Delete from server immediately (manual stop = no need to linger)
  if (code) {
    try {
      await fetch(`/api/live-game?code=${encodeURIComponent(code)}`, { method: 'DELETE' });
    } catch (_) {}
  }
}

// Wire up share buttons
$('btnShareLive').addEventListener('click', () => {
  if (state.shareCode) {
    // Already sharing – toggle the controls panel.
    toggleLiveShareBanner();
  } else {
    startLiveShare();
  }
});

$('btnCopyShareLink').addEventListener('click', () => {
  if (!state.shareCode) return;
  const url = new URL('/api/spectator-share', window.location.origin);
  url.searchParams.set('live', state.shareCode);
  const shareUrl = String(url);
  navigator.clipboard.writeText(shareUrl).then(() => {
    showStatusToast('Link copied!', 'success');
    showLiveShareBanner(2500);
  }).catch(() => {
    // Fallback: show the URL
    showStatusToast(shareUrl, 'success', 6000);
  });
});

$('btnStopShare').addEventListener('click', () => {
  showConfirm('Stop live sharing?').then(ok => { if (ok) stopLiveShare(); });
});
