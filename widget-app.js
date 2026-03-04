// GitHub Widget — Renderer logic extracted from widget.html

const GITHUB_GRAPHQL = 'https://api.github.com/graphql';
const GITHUB_REST = 'https://api.github.com';
const STORAGE_KEY = 'github_widget_config';
const CACHE_KEY = 'github_widget_cache';
const CACHE_TTL = 30 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const $ = (id) => document.getElementById(id);
const isElectron = window.electronAPI?.isElectron || false;
let lastUpdatedAt = null;

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
    const cfg = loadConfig();
    if (cfg?.username) {
        showWidget();
        loadContributions(cfg.username, cfg.token);
    }

    // Listen for pin state changes from the main process (tray / startup state)
    if (isElectron && window.electronAPI.onPinChanged) {
        window.electronAPI.onPinChanged((val) => {
            const pinBtn = $('pinBtn');
            if (!pinBtn) return;
            if (val) {
                pinBtn.classList.add('pin-active');
            } else {
                pinBtn.classList.remove('pin-active');
            }
        });
    }

    // Auto-refresh every 30 min
    setInterval(() => {
        const c = loadConfig();
        if (c?.username) {
            localStorage.removeItem(CACHE_KEY);
            loadContributions(c.username, c.token);
        }
    }, CACHE_TTL);
});

// ---- Window Controls ----
const getElectron = () => window.electronAPI;

function minimizeWidget() {
    const api = getElectron();
    if (api) api.minimize();
}

function closeWidget() {
    const api = getElectron();
    if (api) api.close();
}

function togglePin() {
    const api = getElectron();
    if (api) api.toggleAlwaysOnTop();
}

// ---- About dialog ----
function openAbout() {
    const el = $('aboutOverlay');
    if (el) el.classList.remove('hidden');
}

function closeAbout() {
    const el = $('aboutOverlay');
    if (el) el.classList.add('hidden');
}

// ---- Storage ----
function loadConfig() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
}
function saveConfig(username, token) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ username, token }));
}
function clearConfig() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CACHE_KEY);
}
function loadCache() {
    try {
        const c = JSON.parse(localStorage.getItem(CACHE_KEY));
        return (c && Date.now() - c.ts < CACHE_TTL) ? c.data : null;
    } catch { return null; }
}
function saveCache(data) {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
}

// ---- UI ----
function showWidget() {
    $('setupPanel').classList.add('hidden');
    $('widgetView').classList.remove('hidden');
}
function showSetup() {
    $('setupPanel').classList.remove('hidden');
    $('widgetView').classList.add('hidden');
}

// ---- Connect ----
async function connectGitHub() {
    const username = $('usernameInput').value.trim();
    const token = $('tokenInput').value.trim();
    const err = $('setupError');
    const btn = $('connectBtn');
    err.textContent = '';
    if (!username) { err.textContent = 'Enter your GitHub username.'; return; }
    btn.classList.add('loading'); btn.disabled = true;
    try {
        const r = await fetch(`${GITHUB_REST}/users/${username}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (!r.ok) throw new Error(r.status === 404 ? 'User not found.' : `API error ${r.status}`);
        saveConfig(username, token);
        showWidget();
        await loadContributions(username, token);
    } catch (e) {
        err.textContent = e.message;
    } finally {
        btn.classList.remove('loading'); btn.disabled = false;
    }
}

function logout() {
    clearConfig();
    $('usernameInput').value = '';
    $('tokenInput').value = '';
    showSetup();
}

async function refreshData() {
    const cfg = loadConfig(); if (!cfg) return;
    localStorage.removeItem(CACHE_KEY);
    $('refreshBtn').classList.add('spinning');
    const lu = $('lastUpdated');
    if (lu) lu.textContent = 'Refreshing…';
    await loadContributions(cfg.username, cfg.token);
    setTimeout(() => $('refreshBtn').classList.remove('spinning'), 600);
}

// ---- Load ----
async function loadContributions(username, token) {
    const cached = loadCache();
    if (cached?.username === username) { renderAll(cached); return; }
    try {
        let data;
        if (token) { data = await fetchGraphQL(username, token); }
        else { data = await fetchFallback(username); }
        if (data) { data.username = username; saveCache(data); renderAll(data); }
    } catch (e) {
        console.error(e);
        renderAll(generateDemo(username));
    }
}

async function fetchGraphQL(username, token) {
    const q = `query($u:String!){user(login:$u){name login avatarUrl contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{contributionCount date color}}}}}}`;
    const r = await fetch(GITHUB_GRAPHQL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: q, variables: { u: username } })
    });
    const j = await r.json();
    if (j.errors) throw new Error(j.errors[0].message);
    const u = j.data.user, cal = u.contributionsCollection.contributionCalendar;
    const days = [];
    cal.weeks.forEach(w => w.contributionDays.forEach(d => {
        days.push({ date: d.date, count: d.contributionCount, level: getLevel(d.contributionCount) });
    }));
    return { name: u.name || u.login, login: u.login, avatar: u.avatarUrl, totalContributions: cal.totalContributions, days, weeks: cal.weeks };
}

async function fetchFallback(username) {
    const r = await fetch(`${GITHUB_REST}/users/${username}`);
    const u = await r.json();
    return generateDemo(username, u);
}

function generateDemo(username, userData) {
    const days = []; let total = 0;
    const now = new Date(), start = new Date(now);
    start.setDate(start.getDate() - 364);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(now); end.setDate(end.getDate() + (6 - end.getDay()));
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const wd = d.getDay(), isWd = wd >= 1 && wd <= 5;
        let c; const r = Math.random();
        if (r < 0.2) c = 0;
        else if (r < 0.45) c = Math.floor(Math.random() * 3) + 1;
        else if (r < 0.7) c = Math.floor(Math.random() * 5) + 2;
        else if (r < 0.9) c = Math.floor(Math.random() * 8) + 4;
        else c = Math.floor(Math.random() * (isWd ? 12 : 4)) + 6;
        if (d > now) c = 0;
        days.push({ date: d.toISOString().split('T')[0], count: c, level: getLevel(c) });
        total += c;
    }
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) weeks.push({ contributionDays: days.slice(i, i + 7) });
    return {
        name: userData?.name || username,
        login: userData?.login || username,
        avatar: userData?.avatar_url || `https://github.com/${username}.png`,
        totalContributions: total,
        days,
        weeks,
        isDemo: true
    };
}

function getLevel(c) { return c === 0 ? 0 : c <= 3 ? 1 : c <= 6 ? 2 : c <= 9 ? 3 : 4; }

// ---- Render ----
function renderAll(data) {
    $('userAvatar').src = data.avatar;
    $('displayName').textContent = data.name;
    $('username').textContent = '@' + data.login;
    $('totalContributions').textContent = data.totalContributions.toLocaleString();
    $('graphContribCount').textContent = data.totalContributions.toLocaleString();

    // Demo badge
    const nameEl = $('displayName');
    if (nameEl) {
        const existing = nameEl.querySelector('.badge-demo');
        if (existing) existing.remove();
        if (data.isDemo) {
            const b = document.createElement('span');
            b.className = 'badge-demo';
            b.textContent = 'Demo data';
            nameEl.appendChild(b);
        }
    }

    // Click through to profile in browser
    const avatar = $('userAvatar');
    const nameElInstance = $('displayName');
    const userEl = $('username');
    const profileUrl = `https://github.com/${data.login}`;
    [avatar, nameElInstance, userEl].forEach((el) => {
        if (!el) return;
        el.style.cursor = 'pointer';
        el.onclick = () => window.open(profileUrl, '_blank');
    });

    // Streak
    const today = new Date().toISOString().split('T')[0];
    let streak = 0;
    for (let i = data.days.length - 1; i >= 0; i--) {
        if (data.days[i].date > today) continue;
        if (data.days[i].count > 0) streak++;
        else { if (data.days[i].date === today) continue; break; }
    }
    $('currentStreak').textContent = streak + (streak === 1 ? ' day' : ' days');

    // Best
    let best = { count: 0, date: '' };
    data.days.forEach(d => { if (d.count > best.count) best = d; });
    if (best.date) {
        const bd = new Date(best.date + 'T00:00:00');
        $('bestDay').textContent = best.count + ' (' + MONTHS[bd.getMonth()] + ' ' + bd.getDate() + ')';
    }

    // Avg
    const active = data.days.filter(d => d.count > 0).length;
    $('avgPerDay').textContent = active > 0 ? (data.totalContributions / active).toFixed(1) : '0';

    // Last updated
    lastUpdatedAt = new Date();
    const lu = $('lastUpdated');
    if (lu) {
        const mins = 0;
        lu.textContent = 'Updated just now';
        setTimeout(updateLastUpdatedLabel, 60 * 1000);
    }

    renderGrid(data);
    renderMonthly(data);
}

function updateLastUpdatedLabel() {
    if (!lastUpdatedAt) return;
    const lu = $('lastUpdated');
    if (!lu) return;
    const diffMs = Date.now() - lastUpdatedAt.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin <= 0) {
        lu.textContent = 'Updated just now';
    } else if (diffMin === 1) {
        lu.textContent = 'Updated 1 min ago';
    } else if (diffMin < 60) {
        lu.textContent = `Updated ${diffMin} mins ago`;
    } else {
        const d = lastUpdatedAt;
        const hh = d.getHours().toString().padStart(2, '0');
        const mm = d.getMinutes().toString().padStart(2, '0');
        lu.textContent = `Updated at ${hh}:${mm}`;
    }
    // keep it roughly fresh while app is open
    setTimeout(updateLastUpdatedLabel, 10 * 60 * 1000);
}

function renderGrid(data) {
    const grid = $('contributionGrid'), ml = $('monthLabels'), tip = $('tooltip');
    grid.innerHTML = ''; ml.innerHTML = '';

    // Cell size: 9px cell + 2px gap = 11px per week column
    const CELL_TOTAL = 11; // 9px + 2px gap
    const DAY_LABEL_WIDTH = 24; // width of the day labels column + gap

    // First pass: record which week index each new month starts
    const monthStarts = []; // { month, weekIndex }
    let lastM = -1;
    data.weeks.forEach((w, wi) => {
        const fd = w.contributionDays[0];
        if (fd) {
            const mn = parseInt(fd.date.split('-')[1]) - 1;
            if (mn !== lastM) {
                lastM = mn;
                monthStarts.push({ month: mn, weekIndex: wi });
            }
        }
    });

    // Build month labels with accurate positions
    ml.style.position = 'relative';
    ml.style.height = '14px';
    ml.style.marginLeft = DAY_LABEL_WIDTH + 'px';
    ml.style.marginBottom = '4px';

    monthStarts.forEach((ms, i) => {
        const lb = document.createElement('span');
        lb.className = 'month-label';
        lb.textContent = MONTHS[ms.month];
        lb.style.position = 'absolute';
        lb.style.left = (ms.weekIndex * CELL_TOTAL) + 'px';
        // Don't show if it would overlap with the next month label (< 3 weeks apart)
        if (i > 0 && (ms.weekIndex - monthStarts[i - 1].weekIndex) < 3) {
            // Skip labels too close together
        } else {
            ml.appendChild(lb);
        }
    });

    // Second pass: build the grid cells
    data.weeks.forEach((w, wi) => {
        const wEl = document.createElement('div'); wEl.className = 'contrib-week';
        w.contributionDays.forEach((d, di) => {
            const cell = document.createElement('div'); cell.className = 'contrib-cell';
            const lv = d.level !== undefined ? d.level : getLevel(d.contributionCount || d.count || 0);
            if (lv > 0) cell.classList.add('level-' + lv);
            cell.style.animationDelay = (wi * 7 + di) * 1.5 + 'ms';
            const date = d.date, count = d.contributionCount ?? d.count ?? 0;
            cell.addEventListener('mouseenter', e => {
                const dt = new Date(date + 'T00:00:00');
                const ds = MONTHS[dt.getMonth()] + ' ' + dt.getDate() + ', ' + dt.getFullYear();
                tip.innerHTML = (count === 0 ? 'No contributions' : '<strong>' + count + '</strong> contrib' + (count > 1 ? 's' : '')) + ' on ' + ds;
                tip.classList.add('visible');
                const r = e.target.getBoundingClientRect();
                tip.style.left = (r.left + r.width / 2 - tip.offsetWidth / 2) + 'px';
                tip.style.top = (r.top - tip.offsetHeight - 6) + 'px';
            });
            cell.addEventListener('mouseleave', () => tip.classList.remove('visible'));
            wEl.appendChild(cell);
        });
        grid.appendChild(wEl);
    });
}

function renderMonthly(data) {
    const c = $('monthlyBars'); c.innerHTML = '';
    const mt = {};
    data.days.forEach(d => {
        const [y, m] = d.date.split('-'), k = y + '-' + m;
        if (!mt[k]) mt[k] = { total: 0, month: parseInt(m) - 1, year: parseInt(y) };
        mt[k].total += d.count || d.contributionCount || 0;
    });
    const entries = Object.values(mt).sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month).slice(-12);
    const max = Math.max(...entries.map(e => e.total), 1);
    entries.forEach((e, i) => {
        const w = document.createElement('div'); w.className = 'month-bar-wrapper';
        const v = document.createElement('span'); v.className = 'month-bar-value'; v.textContent = e.total;
        const b = document.createElement('div'); b.className = 'month-bar'; b.style.height = '0%';
        setTimeout(() => { b.style.height = Math.max(e.total / max * 100, 2) + '%'; }, 80 + i * 50);
        const l = document.createElement('span'); l.className = 'month-bar-label'; l.textContent = MONTHS[e.month];
        w.appendChild(v); w.appendChild(b); w.appendChild(l); c.appendChild(w);
    });
}

// Enter key
document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !$('setupPanel').classList.contains('hidden')) connectGitHub();
});

