const socket = (typeof io === 'function' && !/[?&]demo/.test(location.search)) ? io() : { connected: false, on() { return this; }, emit() { } };
let selectedId = 'MOTOR-01';
let randomOn = false;
let replayActive = false;
let alertList = [];
let dirty = true;
let glOK = false;
const machines = {};
const spectroHistory = {};
const trainSeen = {};
const ORDER = ['MOTOR-01', 'PUMP-02', 'COMP-04', 'FAN-03'];

const $ = (id) => document.getElementById(id);
const V = (x) => (x && typeof x === 'object' && 'value' in x) ? x.value : x;
const f = (x, n = 1) => (typeof x === 'number' && isFinite(x)) ? x.toFixed(n) : '--';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const setT = (id, t) => { const e = $(id); if (e && e.textContent !== t) e.textContent = t; };
// Color means state: only health, alarm and link state ever get green / amber / red / grey.
const sc = (h, off) => off ? 'var(--of)' : h >= 75 ? 'var(--ok)' : h >= 45 ? 'var(--wn)' : 'var(--cr)';

function toast(msg, cls = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + cls; t.textContent = msg;
    $('toasts').appendChild(t); setTimeout(() => t.remove(), 5000);
}

// ---------- Charts ----------
const fftChart = new Chart($('fftChart'), {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: '#7fa6c4', barPercentage: 1, categoryPercentage: 1 }] },
    options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        scales: {
            x: { ticks: { maxTicksLimit: 10, color: '#8b9097' }, grid: { color: '#20242a' } },
            y: { min: 0, max: 10, ticks: { color: '#8b9097' }, grid: { color: '#20242a' } }
        },
        plugins: { legend: { display: false } }
    }
});

function drawSpectrogram(id) {
    const c = $('spectro'), x = c.getContext('2d'), cols = spectroHistory[id] || [];
    x.fillStyle = '#0b0d10'; x.fillRect(0, 0, c.width, c.height);
    const s = c.width - cols.length;
    cols.forEach((mags, i) => mags.forEach((v, b) => {
        const t = Math.min(1, v / 6);
        if (t > 0.02) { x.fillStyle = `rgb(${Math.round(30 + t * 200)},${Math.round(40 + t * 190)},${Math.round(50 + t * 170)})`; x.fillRect(s + i, c.height - 1 - b, 1, 1); }
    }));
}

// ---------- 2D fallback twin (only if WebGL fails) ----------
function drawFallback() {
    $('fallback').innerHTML = ORDER.map((id, i) => {
        const d = machines[id], off = !d || d.status === 'offline', h = d?.computed?.health ?? 0;
        return `<g class="fb${id === selectedId ? ' sel' : ''}" tabindex="0" role="button" data-id="${id}" transform="translate(${20 + i * 185},50)">
      <rect width="160" height="110" rx="4" style="stroke:${sc(h, off)}"/>
      <text x="12" y="26" style="font-weight:700">${id}</text>
      <text x="12" y="68" style="fill:${sc(h, off)};font-size:20px">${off ? 'OFFLINE' : Math.round(h) + ' / 100'}</text>
      <text x="12" y="92" style="fill:var(--dim)">${d ? f(V(d.metrics?.temperature)) + ' C, ' + f(V(d.computed?.vibrationRms), 2) + ' mm/s' : 'Waiting...'}</text></g>`;
    }).join('');
}

// ---------- Selected machine ----------
function selectMachine(id) {
    selectedId = id;
    $('chaos-machine').value = id;
    syncChaosTarget();
    Twin.select(id);
    dirty = true;
}

function syncChaosTarget() {
    $('chaos-target-label').textContent = 'Target: ' + $('chaos-machine').value;
}

function renderSelected() {
    const d = machines[selectedId];
    if (!d) return;
    const c = d.computed || {}, m = d.metrics || {}, r = c.rul || {}, fft = c.fft || {}, ml = c.ml || {};
    const dets = c.detections || [], off = d.status === 'offline', h = c.health ?? 0, col = sc(h, off);
    setT('env-bar', `Ambient ${f(V(m.ambientTemp))} C, humidity ${f(V(m.ambientHumidity), 0)}%, sim runtime ${f(d.simHours, 1)} h`);
    setT('sel-name', `${d.machineId} (${d.machineType || 'machine'})`);
    setT('health-val', off ? 'OFFLINE' : f(h, 0));
    $('health-val').style.color = col;
    const arc = $('g-arc'); arc.style.stroke = col; arc.style.strokeDashoffset = 251 * (1 - (off ? 0 : h) / 100);
    setT('metrics-inline', `${f(V(m.temperature))} C, ${f(V(c.vibrationRms), 2)} mm/s, ${f(V(m.current))} A, load ${f(V(m.load), 0)}%, ${f(V(m.rpm), 0)} rpm`);
    setT('log-line', off ? `${d.machineId} stopped answering. Last Will & Testament delivered.`
        : dets.length ? `[${dets[0].layer}] ${dets[0].message}` : `${d.machineId} is nominal. Nothing to report, which is the best kind of report.`);

    const rs = r.status || 'calibrating', ru = $('rul-val');
    ru.className = 'num' + (rs === 'calibrating' ? ' sm' : '');
    setT('rul-val', { calibrating: "Still learning what 'normal' looks like.", stable: '> 500 h', critical: '0 h', degrading: `${f(r.estimateHours, 0)} h` }[rs] || '--');
    setT('rul-slope', `Trend: ${f(r.slopePerHour, 2)} pts/h`);
    const bi = $('band-i'), deg = rs === 'degrading' && isFinite(r.lowHours) && isFinite(r.highHours);
    const mxh = deg ? Math.max(r.highHours * 1.25, 1) : 1;
    bi.style.left = deg ? (100 * r.lowHours / mxh) + '%' : '0'; bi.style.width = deg ? (100 * (r.highHours - r.lowHours) / mxh) + '%' : '0';
    setT('rul-band', deg ? `95% confidence band: ${f(r.lowHours, 0)} h to ${f(r.highHours, 0)} h` : 'No downward trend to put a band on.');
    setT('rul-chip', rs.toUpperCase()); $('rul-chip').className = 'badge st-' + rs;

    [1, 2, 3].forEach((n) => {
        const on = dets.some((x) => x.layer === 'L' + n);
        $('b-l' + n).className = 'badge ' + (off ? '' : on ? 'on' + n : 'ok');
    });
    // Training progress: uses a count from the packet if one exists, else counts training packets seen client-side.
    const trained = ml.trained ?? ml.samples ?? ml.count ?? ml.n ?? trainSeen[d.machineId] ?? 0;
    const active = ml.status === 'active';
    setT('ml-status', active ? `ML score: ${f(ml.score, 2)}` : `ML: ${ml.status || 'training'}`);
    setT('ml-line', active ? `Isolation forest score ${f(ml.score, 2)} (anomaly above 0.63)` : `Isolation forest: training ${Math.min(20, trained)}/20`);
    $('ml-line').style.color = active && ml.score > 0.63 ? 'var(--cr)' : '';
    setT('fft-summary', `Shaft f1: ${f(fft.f1Hz)} Hz. BPFO (${f(fft.bpfoHz)} Hz): ${f(fft.bpfoPeak, 2)} mm/s. Dominant: ${f(fft.dominantFreqHz)} Hz.`);
    setT('bpfo-callout', `BPFO band at ${f(fft.bpfoHz)} Hz: ${f(fft.bpfoPeak, 2)} mm/s`);

    if (fft.freqs && fft.mags) {
        fftChart.data.labels = fft.freqs;
        fftChart.data.datasets[0].data = fft.mags;
        fftChart.data.datasets[0].backgroundColor = fft.freqs.map((fr) =>
            Math.abs(fr - fft.bpfoHz) <= 4.5 ? '#d9d5c7' : Math.abs(fr - fft.dominantFreqHz) <= 2 ? '#ffffff' : Math.abs(fr - fft.f1Hz) <= 2 ? '#a9c4d8' : '#4d6577');
        fftChart.update('none');
    }
    drawSpectrogram(selectedId);
}

// ---------- Alerts ----------
function renderAlerts() {
    const flt = $('alert-filter').value, rows = alertList.filter((a) => flt === 'all' || a.status === flt);
    setT('alert-count', `${rows.length} of ${alertList.length} alerts`);
    $('alert-tbody').innerHTML = rows.length ? rows.map((a) => `
    <tr>
      <td>${new Date(a.created_at).toLocaleTimeString()}</td>
      <td><b>${esc(a.machine_id)}</b></td>
      <td>${esc(a.layer)}</td>
      <td class="sev-${esc(a.severity)}">${esc(a.severity).toUpperCase()}</td>
      <td>${esc(a.message)}</td>
      <td class="st-${esc(a.status)}">${esc(a.status).toUpperCase()}</td>
      <td>
        ${a.status === 'active' ? `<button data-act="ack" data-id="${a.id}">Ack</button>` : ''}
        ${a.status !== 'resolved' ? `<button data-act="resolve" data-id="${a.id}">Resolve</button>` : 'done'}
      </td>
    </tr>`).join('') : '<tr><td colspan="7" class="dim">No alerts. Suspiciously quiet.</td></tr>';
}

async function ackAlert(id) { await fetch(`/api/alerts/${id}/ack`, { method: 'POST' }); }
async function resolveAlert(id) { await fetch(`/api/alerts/${id}/resolve`, { method: 'POST' }); }

// ---------- Replay ----------
async function startReplay() {
    const speed = Number($('replay-speed').value);
    const res = await fetch('/api/replay/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ speed })
    });
    if (!res.ok) toast('Wait a few seconds for SQLite to record telemetry first.');
}
async function stopReplay() { await fetch('/api/replay/stop', { method: 'POST' }); }

function setMode(st) {
    replayActive = !!st.active;
    const pill = $('mode-pill');
    pill.textContent = st.active ? `REPLAY ${st.speed}x` : 'LIVE MQTT';
    pill.className = 'pill ' + (st.active ? 'replay' : 'live');
    document.body.classList.toggle('replay', replayActive);
    setT('replay-progress', st.active ? `Frame ${st.index} / ${st.total} at ${st.speed}x. Time travel, but supervised.` : 'Recording live telemetry to data/telemetry.sqlite');
    $('replay-fill').style.width = (st.active && st.total) ? (100 * st.index / st.total) + '%' : '0';
}

// ---------- Chaos commands (fault-command contract) ----------
function injectFault() {
    socket.emit('fault-command', {
        action: 'inject', machineId: $('chaos-machine').value,
        faultType: $('chaos-fault').value, durationSec: 15
    });
}
function applyLoad() {
    socket.emit('fault-command', { action: 'set-load', machineId: $('chaos-machine').value, load: Number($('load-slider').value) / 100 });
}
function resetLoad() { socket.emit('fault-command', { action: 'set-load', machineId: $('chaos-machine').value, load: null }); }
function killNode() { socket.emit('fault-command', { action: 'kill-node', machineId: $('chaos-machine').value }); }
function reviveNode() { socket.emit('fault-command', { action: 'revive-node', machineId: $('chaos-machine').value }); }
function clearAll() { socket.emit('fault-command', { action: 'clear-all' }); }
function toggleRandom() {
    randomOn = !randomOn;
    const btn = $('btn-random');
    btn.textContent = `Random faults: ${randomOn ? 'on' : 'off'}`;
    btn.setAttribute('aria-pressed', randomOn);
    socket.emit('fault-command', { action: 'toggle-random', enabled: randomOn });
}

// ---------- Data in ----------
function ingest(data) {
    if (!data || !data.machineId) return;
    const id = data.machineId, c = data.computed || {};
    machines[id] = data;
    if (c.fft && c.fft.mags) {
        (spectroHistory[id] ||= []).push(c.fft.mags);
        if (spectroHistory[id].length > 120) spectroHistory[id].shift();
    }
    if (c.ml && c.ml.status !== 'active') trainSeen[id] = Math.min(20, (trainSeen[id] || 0) + 1);
    Twin.update(data);
    dirty = true;
}

socket.on('connect', () => $('link-led').classList.add('on'));
socket.on('disconnect', () => $('link-led').classList.remove('on'));
socket.on('initial-state', (s) => {
    Object.values(s.machines || {}).forEach(ingest);
    alertList = s.alerts || [];
    renderAlerts();
    setMode({ active: !!s.replayActive });
});
socket.on('dashboard-update', (d) => { if (replayActive && !d.isReplay) return; ingest(d); });
socket.on('dashboard-status', (ev) => {
    if (machines[ev.machineId]) machines[ev.machineId].status = ev.status;
    Twin.update(machines[ev.machineId] || { machineId: ev.machineId, status: ev.status });
    if (ev.status === 'offline') toast(`${ev.machineId} stopped answering. Last Will & Testament delivered.`, 'critical');
    dirty = true;
});
socket.on('alert-new', (a) => {
    alertList.unshift(a); alertList = alertList.slice(0, 60); renderAlerts();
    toast(`${a.machine_id} ${a.layer}: ${a.message}`, a.severity);
});
socket.on('alerts-refresh', (list) => { alertList = list; renderAlerts(); });
socket.on('replay-state', setMode);

// ---------- Wiring ----------
glOK = Twin.init($('twin'), $('gl'), selectMachine);
if (!glOK) { $('gl').hidden = true; $('fallback').hidden = false; }
$('fallback').addEventListener('click', (e) => { const g = e.target.closest('[data-id]'); if (g) selectMachine(g.dataset.id); });
$('fallback').addEventListener('keydown', (e) => { const g = e.target.closest('[data-id]'); if (g && (e.key === 'Enter' || e.key === ' ')) selectMachine(g.dataset.id); });
$('chaos-machine').addEventListener('change', syncChaosTarget);
$('load-slider').addEventListener('input', (e) => { $('load-val').textContent = e.target.value + '%'; });
$('alert-filter').addEventListener('change', renderAlerts);
$('alert-tbody').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    (b.dataset.act === 'ack' ? ackAlert : resolveAlert)(b.dataset.id);
});
[['btn-replay', startReplay], ['btn-live', stopReplay], ['btn-inject', injectFault], ['btn-load', applyLoad], ['btn-auto', resetLoad],
['btn-kill', killNode], ['btn-revive', reviveNode], ['btn-random', toggleRandom]].forEach(([id, fn]) => $(id).addEventListener('click', fn));

// Clear All needs a 0.9 s hold (pointer or Space/Enter) so it can't be hit by accident.
let hold;
const arm = () => { const b = $('btn-clear'); b.classList.add('arming'); clearTimeout(hold); hold = setTimeout(() => { b.classList.remove('arming'); clearAll(); }, 900); };
const disarm = () => { clearTimeout(hold); $('btn-clear').classList.remove('arming'); };
$('btn-clear').addEventListener('pointerdown', arm);
['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach((ev) => $('btn-clear').addEventListener(ev, disarm));
$('btn-clear').addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) arm(); });
$('btn-clear').addEventListener('keyup', disarm);

addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.ctrlKey || e.metaKey) return;
    if (e.key >= '1' && e.key <= '4') selectMachine(ORDER[e.key - 1]);
    else if (e.key === 'r' || e.key === 'R') startReplay();
    else if (e.key === 'Escape') stopReplay();
});

// DOM work is throttled to one pass per animation frame, and skipped while the tab is hidden.
(function tick() {
    if (dirty && !document.hidden) { dirty = false; renderSelected(); if (!glOK) drawFallback(); }
    requestAnimationFrame(tick);
})();