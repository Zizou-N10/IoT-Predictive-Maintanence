/* Portfolio layer: demo mode (fake packets), guided demo, "How it works" drawer.
   Runs after app.js and reuses its globals (socket, ingest, toast, alertList...). */
(function () {
    const IDS = ['MOTOR-01', 'PUMP-02', 'COMP-04', 'FAN-03'];
    const TYPE = { 'MOTOR-01': 'motor', 'PUMP-02': 'pump', 'COMP-04': 'compressor', 'FAN-03': 'fan' };
    const F1 = { 'MOTOR-01': 25, 'PUMP-02': 24, 'COMP-04': 29, 'FAN-03': 16 };
    const FAULTS = ['bearing_fault', 'overheating', 'cascading', 'drift', 'stuck_at', 'spike', 'calibration_offset', 'noisy_sensor', 'dropout'];
    const D = { on: false, forced: /[?&]demo/.test(location.search), t: 0, hrs: 0, rand: false, timer: 0, aid: 0, m: {} };
    IDS.forEach((id) => { D.m[id] = { h: 100, load: 0.65, off: false, fault: null, n: 0, alerted: 0 }; });
    const rnd = (a = 1) => (Math.random() - 0.5) * a;

    // ---------- Demo mode ----------
    function inject(id, type, sec, sev = 1) {
        const m = D.m[id]; if (!m || m.off || sev < 0.3) return;
        m.fault = { type, until: Date.now() + sec * 1000, sev };
        if (/bearing|cascad|overheat/.test(type)) {
            const nx = IDS[(IDS.indexOf(id) + 1) % 4];
            setTimeout(() => D.on && inject(nx, type === 'overheating' ? type : 'bearing_fault', sec, sev * 0.7), 2000);
        }
    }

    function pkt(id) {
        const m = D.m[id], f = (m.fault && Date.now() < m.fault.until) ? m.fault : (m.fault = null);
        const s = f ? f.sev : 0, ty = f ? f.type : '', f1 = F1[id], bpfo = +(f1 * 3.58).toFixed(1);
        const bear = /bearing|cascad/.test(ty) ? s : 0, heat = ty === 'overheating' ? s : 0, noise = f && !bear && !heat ? s : 0;
        m.n++; m.h = Math.max(5, Math.min(100, m.h + (f ? -(bear * 2.2 + heat * 1.6 + noise * 0.4) : 0.35)));
        const temp = 52 + m.load * 18 + heat * 34 + rnd(1.2) + (ty === 'spike' && Math.random() < 0.3 ? 25 * s : 0);
        const rms = 1 + m.load * 0.5 + bear * 4.5 + noise * 1.2 + rnd(0.15) + (100 - m.h) * 0.01;
        const peak = 0.25 + bear * 5.2 + rnd(0.1), freqs = [], mags = [];
        for (let i = 0; i < 128; i++) {
            const fr = i * 2; freqs.push(fr);
            mags.push(Math.max(0, 0.12 + Math.random() * 0.1 + rms * 0.5 * Math.exp(-(((fr - f1) / 2.5) ** 2)) + peak * Math.exp(-(((fr - bpfo) / 3) ** 2))));
        }
        const ml = m.n < 20 ? { status: 'training', score: 0, trained: m.n } : { status: 'active', score: Math.min(1, 0.18 + (100 - m.h) / 100 * 0.9 + rnd(0.06)), trained: 20 };
        const det = [];
        if (temp > 85 || rms > 6) det.push({ layer: 'L1', message: temp > 85 ? `${id} temperature ${temp.toFixed(0)} C over limit` : `${id} vibration ${rms.toFixed(1)} mm/s over limit` });
        if (m.h < 85) det.push({ layer: 'L2', message: `${id} drifting away from its baseline` });
        if (ml.score > 0.63) det.push({ layer: 'L3', message: `${id} looks unlike anything it was trained on` });
        const est = Math.max(1, (m.h - 20) * 3), N = null;
        const rul = m.n < 8 ? { status: 'calibrating', estimateHours: N, lowHours: N, highHours: N, slopePerHour: 0 }
            : m.h < 25 ? { status: 'critical', estimateHours: 0, lowHours: 0, highHours: 0, slopePerHour: -4 }
                : m.h < 90 ? { status: 'degrading', estimateHours: Math.round(est), lowHours: Math.round(est * 0.7), highHours: Math.round(est * 1.4), slopePerHour: +(-(100 - m.h) * 0.08).toFixed(2) }
                    : { status: 'stable', estimateHours: N, lowHours: N, highHours: N, slopePerHour: 0 };
        return {
            machineId: id, machineType: TYPE[id], timestamp: Date.now(), simHours: +D.hrs.toFixed(2), sampleRateHz: 512, status: m.off ? 'offline' : 'online',
            metrics: {
                temperature: { value: +temp.toFixed(1), unit: 'C' }, current: { value: +(8 + m.load * 14 + rnd(0.4)).toFixed(1) },
                rpm: { value: m.off ? 0 : Math.round(f1 * 60 * (0.9 + m.load * 0.1) + rnd(8)) }, load: { value: Math.round(m.load * 100) },
                process: { name: 'Process', value: +(40 + m.load * 30 + rnd(2)).toFixed(1), unit: '' },
                ambientTemp: { value: +(24 + rnd(0.4)).toFixed(1) }, ambientHumidity: { value: Math.round(48 + rnd(2)) }, wear: { value: +(5 + (100 - m.h) * 0.1).toFixed(1) }
            },
            computed: { vibrationRms: { value: +rms.toFixed(2), unit: 'mm/s' }, fft: { freqs, mags, dominantFreqHz: bear > 0.3 ? bpfo : f1, f1Hz: f1, bpfoHz: bpfo, bpfoPeak: +peak.toFixed(2) }, ml, health: Math.round(m.h), rul, detections: det }
        };
    }

    function tick() {
        D.t++; D.hrs += 0.05;
        if (D.rand && D.t % 40 === 0) inject(IDS[Math.floor(Math.random() * 4)], FAULTS[Math.floor(Math.random() * 9)], 15);
        IDS.forEach((id) => {
            const m = D.m[id]; if (m.off) return;
            const p = pkt(id), det = p.computed.detections; ingest(p);
            if (det.length && Date.now() - m.alerted > 10000) {
                m.alerted = Date.now(); const d0 = det[det.length - 1];
                const a = { id: ++D.aid, machine_id: id, layer: d0.layer, severity: d0.layer === 'L1' ? 'critical' : 'warning', message: d0.message, status: 'active', created_at: Date.now() };
                alertList.unshift(a); alertList = alertList.slice(0, 60); renderAlerts(); toast(`${id} ${a.layer}: ${a.message}`, a.severity);
            }
        });
    }

    function cmd(c) {
        const m = D.m[c.machineId];
        if (c.action === 'inject') inject(c.machineId, c.faultType, c.durationSec || 15);
        else if (c.action === 'set-load' && m) m.load = c.load ?? 0.65;
        else if (c.action === 'kill-node' && m && !m.off) { const p = pkt(c.machineId); m.off = true; p.status = 'offline'; p.metrics.rpm.value = 0; ingest(p); toast(`${c.machineId} stopped answering. Last Will & Testament delivered.`, 'critical'); }
        else if (c.action === 'revive-node' && m) { m.off = false; m.n = 0; m.h = Math.max(m.h, 60); }
        else if (c.action === 'clear-all') IDS.forEach((i) => { D.m[i].fault = null; });
        else if (c.action === 'toggle-random') D.rand = !!c.enabled;
    }

    const realEmit = socket.emit.bind(socket);
    socket.emit = (ev, c) => (D.on ? cmd(c) : realEmit(ev, c));
    const _ack = ackAlert, _res = resolveAlert, _sr = startReplay, _st = stopReplay;
    const setSt = (id, st) => { const a = alertList.find((x) => String(x.id) === String(id)); if (a) { a.status = st; renderAlerts(); } };
    ackAlert = async (id) => (D.on ? setSt(id, 'acknowledged') : _ack(id));
    resolveAlert = async (id) => (D.on ? setSt(id, 'resolved') : _res(id));
    startReplay = async () => (D.on ? toast('Replay needs the SQLite backend. Demo mode only has live fiction.', 'info') : _sr());
    stopReplay = async () => (D.on ? 0 : _st());

    function start() { if (D.on) return; D.on = true; $('demo-flag').hidden = false; D.timer = setInterval(tick, 500); toast('Demo mode: simulated packets. Nothing here is real.', 'info'); }
    function stop() { if (D.forced) return; D.on = false; clearInterval(D.timer); $('demo-flag').hidden = true; }
    socket.on('connect', stop);
    if (D.forced) start(); else setTimeout(() => { if (!socket.connected) start(); }, 4000);

    // ---------- Guided demo ----------
    const g = document.createElement('div');
    g.id = 'guide'; g.hidden = true; g.setAttribute('role', 'region'); g.setAttribute('aria-label', 'Guided demo');
    g.innerHTML = '<b></b><p></p><div class="r"><button class="go"></button><button class="x">Close</button></div>';
    document.body.appendChild(g);
    const STEPS = [
        { t: 'Pick a victim', x: 'PUMP-02 is second in the loop, so everything after it is about to have a bad day.', b: 'Inject bearing fault', a: () => { selectMachine('PUMP-02'); $('chaos-fault').value = 'bearing_fault'; injectFault(); } },
        { t: 'Watch it spread', x: 'A red pulse leaves PUMP-02. Two seconds later COMP-04 gets hit.', b: 'Follow it downstream', a: () => selectMachine('COMP-04') },
        { t: 'Read the instruments', x: 'Back on PUMP-02: the L1 to L3 badges light up in turn, the BPFO band spikes, and RUL stops saying stable.', b: 'Show me', a: () => { selectMachine('PUMP-02'); document.querySelector('.kpis').scrollIntoView({ behavior: 'smooth' }); } },
        { t: 'Clean up', x: 'Faults expire after 15 s on their own, but this does it now.', b: 'Clear all and finish', a: () => { clearAll(); g.hidden = true; } }
    ];
    let gi = 0;
    const show = () => { const s = STEPS[gi]; g.querySelector('b').textContent = `Step ${gi + 1} of ${STEPS.length}: ${s.t}`; g.querySelector('p').textContent = s.x; g.querySelector('.go').textContent = s.b; };
    g.querySelector('.go').addEventListener('click', () => { STEPS[gi].a(); if (gi < STEPS.length - 1) { gi++; show(); } });
    g.querySelector('.x').addEventListener('click', () => { g.hidden = true; });
    $('btn-guide').addEventListener('click', () => { gi = 0; show(); g.hidden = false; g.querySelector('.go').focus(); });

    // ---------- How it works drawer ----------
    const FLOW = [['Simulator', 'Four machines with injectable faults'], ['MQTT broker', 'Last Will and Testament flags dead nodes as offline'],
    ['FFT and 3-layer detection', 'L1 thresholds, L2 z-score and EWMA, L3 isolation forest'], ['SQLite', 'Telemetry, alerts and ground truth, all replayable'],
    ['Socket.io', 'Pushes enriched packets to every open browser'], ['This UI', 'Three.js twin, charts and the chaos console']];
    const dr = document.createElement('aside');
    dr.id = 'drawer'; dr.setAttribute('role', 'dialog'); dr.setAttribute('aria-label', 'How it works');
    dr.innerHTML = `<h2><span>How it works</span><button class="x">Close</button></h2>
    <ol class="flow">${FLOW.map(([a, b]) => `<li><b>${a}</b><span>${b}</span></li>`).join('')}</ol>
    <p class="dim">Faults cascade downstream after a 2 s delay: MOTOR-01, PUMP-02, COMP-04, FAN-03, back to MOTOR-01. The red pulse in the twin mirrors that.</p>
    <p><a href="https://github.com/YOUR-USERNAME/YOUR-REPO" target="_blank" rel="noopener">Source on GitHub</a></p>`;
    document.body.appendChild(dr);
    const tog = (o) => { dr.classList.toggle('open', o); if (o) dr.querySelector('.x').focus(); else $('btn-how').focus(); };
    $('btn-how').addEventListener('click', () => tog(true));
    dr.querySelector('.x').addEventListener('click', () => tog(false));
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && dr.classList.contains('open')) tog(false); });
})();