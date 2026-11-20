(function () {
    const T = window.THREE;
    if (!T) { window.Twin = { init: () => false, update() { }, select() { } }; return; }
    const V = (x) => (x && typeof x === 'object' && 'value' in x) ? x.value : x;
    const COL = { ok: 0x4ec26b, wn: 0xf0a73a, cr: 0xee4b3f, of: 0x6b7480 };
    const POS = { 'MOTOR-01': [-4.2, 0, -3], 'PUMP-02': [4.2, 0, -3], 'COMP-04': [4.2, 0, 3], 'FAN-03': [-4.2, 0, 3] };
    const IDS = Object.keys(POS), M = {}, pick = [], pipes = [], pulses = [];
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mobile = matchMedia('(max-width:700px)').matches;
    let R, S, C, tip, onPick = () => { }, sel = 'MOTOR-01', th = 0.6, ph = 1.0, dist = 17, dGoal = 17;
    let mx = 0, my = 0, px = 0, py = 0, drag = null, vis = true, raf = 0, last = 0;
    const tgt = new T.Vector3(), goal = new T.Vector3(), ray = new T.Raycaster(), mouse = new T.Vector2();

    function build(id) {
        const g = new T.Group(), body = [], acc = [], p0 = POS[id];
        const part = (geo, x, y, z, list, c, parent) => {
            const m = new T.Mesh(geo, new T.MeshStandardMaterial({ color: c, metalness: 0.6, roughness: 0.5 }));
            list.push(m.material); m.position.set(x, y, z); m.userData.id = id; (parent || g).add(m); pick.push(m); return m;
        };
        const B = (x, y, z, w, h, d, l) => part(new T.BoxGeometry(w, h, d), x, y, z, l || body, 0x2b3038);
        const Cy = (x, y, z, r, h, rot) => { const m = part(new T.CylinderGeometry(r, r, h, 24), x, y, z, body, 0x2b3038); if (rot) m.rotation.z = Math.PI / 2; return m; };
        const Sp = (x, y, z, r) => part(new T.SphereGeometry(r, 20, 16), x, y, z, body, 0x2b3038);
        B(0, 0.15, 0, 3.4, 0.3, 2.2);
        let ax = 1.6, ay = 1.2, az = 0, br = 0.75, nb = 3, spin = true;
        if (id.startsWith('MOTOR')) {
            Cy(0, 1.2, 0, 0.9, 2.4, 1);
            for (let i = -2; i <= 2; i++) { const r = part(new T.TorusGeometry(0.93, 0.05, 8, 28), i * 0.5, 1.2, 0, body, 0x2b3038); r.rotation.y = Math.PI / 2; }
            B(0, 2.25, 0, 0.7, 0.3, 0.6);
        } else if (id.startsWith('PUMP')) {
            Sp(-0.2, 1.25, 0, 1.05); Cy(-0.2, 2.2, 0, 0.3, 1.1); Cy(1.0, 1.1, 0, 0.28, 1.2, 1); ax = 1.55; br = 0.45; nb = 2;
        } else if (id.startsWith('COMP')) {
            Cy(-0.2, 1.3, 0, 0.85, 2.4, 1); Sp(-1.4, 1.3, 0, 0.85); Sp(1.0, 1.3, 0, 0.85); B(-0.2, 2.35, 0, 0.9, 0.7, 0.8); ax = 1.9; br = 0.8; nb = 4;
        } else {
            const t = part(new T.TorusGeometry(1.25, 0.12, 12, 40), 0, 1.75, 0, body, 0x2b3038); void t;
            Cy(0, 0.9, -0.2, 0.18, 1.4); ax = 0; ay = 1.75; az = 0; br = 1.1; nb = 3; spin = false;
        }
        const axle = new T.Group(); axle.position.set(ax, ay, az); if (spin) axle.rotation.y = Math.PI / 2; g.add(axle);
        const rotor = new T.Group(); axle.add(rotor);
        part(new T.CylinderGeometry(0.16, 0.16, 0.3, 16), 0, 0, 0, acc, 0x888888, rotor).rotation.x = Math.PI / 2;
        for (let i = 0; i < nb; i++) part(new T.BoxGeometry(br * 2, 0.13, 0.05), 0, 0, 0, acc, 0x888888, rotor).rotation.z = i * Math.PI / nb;
        part(new T.SphereGeometry(0.13, 12, 12), 0, 2.7, 0, acc, 0xffffff);
        const ring = new T.Mesh(new T.RingGeometry(2.1, 2.3, 48), new T.MeshBasicMaterial({ transparent: true, side: T.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
        const sring = new T.Mesh(new T.RingGeometry(2.45, 2.55, 48), new T.MeshBasicMaterial({ color: 0x7fa6c4, side: T.DoubleSide }));
        sring.rotation.x = -Math.PI / 2; sring.position.y = 0.03; g.add(sring);
        const light = new T.PointLight(0xff6a2a, 0, 7); light.position.set(0, 2, 0); g.add(light);
        g.position.set(p0[0], 0, p0[2]); S.add(g);
        M[id] = { g, rotor, body, acc, ring, sring, light, base: new T.Vector3(p0[0], 0, p0[2]), h: 100, off: true, rpm: 0, rms: 0, temp: 0, det: false, ang: 0 };
    }

    function paint(m, t) {
        const c = m.off ? COL.of : m.h >= 75 ? COL.ok : m.h >= 45 ? COL.wn : COL.cr;
        m.body.forEach((x) => { x.wireframe = m.off; x.color.setHex(m.off ? 0x6b7480 : 0x2b3038); x.emissive.setHex(c).multiplyScalar(m.off ? 0 : 0.1); });
        m.acc.forEach((x) => { x.color.setHex(c); x.emissive.setHex(c).multiplyScalar(m.off ? 0 : 0.45); });
        m.ring.material.color.setHex(c);
        m.ring.material.opacity = m.off ? 0.15 : (m.h < 45 ? 0.55 + 0.35 * Math.sin(t * 8) : 0.35);
    }

    function frame(now) {
        const dt = Math.min((now - last) / 1000 || 0.016, 0.05); last = now;
        const k = calm ? 0.15 : 1;
        IDS.forEach((id) => {
            const m = M[id];
            m.ang += (m.off ? 0 : Math.min(m.rpm / 1500, 1.6) * 9) * dt * k;
            m.rotor.rotation.z = m.ang;
            const a = (calm || m.off) ? 0 : Math.min(m.rms * 0.012, 0.1);
            m.g.position.set(m.base.x + (Math.random() - 0.5) * a, (Math.random() - 0.5) * a, m.base.z + (Math.random() - 0.5) * a);
            m.light.intensity = m.off ? 0 : Math.max(0, Math.min(1, (m.temp - 65) / 35)) * 2.2;
            m.sring.visible = id === sel;
            paint(m, now / 1000);
        });
        pipes.forEach((p) => {
            const src = M[IDS[p.i]];
            p.t += dt * k * (src.off ? 0 : 0.25 + Math.min(src.rpm / 1500, 1.5) * 0.35);
            const a = p.pts.geometry.attributes.position;
            for (let j = 0; j < p.n; j++) { const u = (p.t + j / p.n) % 1; a.setXYZ(j, p.a.x + p.d.x * u, p.a.y, p.a.z + p.d.z * u); }
            a.needsUpdate = true; p.pts.material.opacity = src.off ? 0.15 : 0.9;
        });
        for (let k2 = pulses.length - 1; k2 >= 0; k2--) {
            const q = pulses[k2], pp = pipes[q.i]; q.t += dt / 1.4;
            const u = Math.min(q.t, 1);
            q.mesh.position.set(pp.a.x + pp.d.x * u, pp.a.y, pp.a.z + pp.d.z * u);
            q.mesh.scale.setScalar(1 + 0.4 * Math.sin(u * 20));
            if (q.t >= 1.2) { S.remove(q.mesh); q.mesh.geometry.dispose(); q.mesh.material.dispose(); pulses.splice(k2, 1); }
        }
        const e = 1 - Math.exp(-dt * 4);
        px += (mx - px) * 0.06; py += (my - py) * 0.06;
        tgt.lerp(goal, e); dist += (dGoal - dist) * e;
        const t = th + px * 0.15, p = Math.max(0.3, Math.min(1.45, ph + py * 0.08));
        C.position.set(tgt.x + dist * Math.sin(p) * Math.sin(t), tgt.y + dist * Math.cos(p), tgt.z + dist * Math.sin(p) * Math.cos(t));
        C.lookAt(tgt);
        R.render(S, C);
    }

    function loop(now) { raf = 0; if (!vis || document.hidden) return; frame(now); raf = requestAnimationFrame(loop); }
    function kick() { if (!raf && vis && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(loop); } }
    function hit() { ray.setFromCamera(mouse, C); const h = ray.intersectObjects(pick, false)[0]; return h ? h.object.userData.id : null; }

    // The fault cascades downstream after 2 s on the server; this pulse is the cosmetic mirror of that.
    function cascade(id) {
        setTimeout(() => {
            const mesh = new T.Mesh(new T.SphereGeometry(0.38, 16, 16), new T.MeshBasicMaterial({ color: COL.cr, transparent: true, opacity: 0.9 }));
            S.add(mesh); pulses.push({ i: IDS.indexOf(id), t: 0, mesh });
        }, 2000);
    }

    function init(box, cv, pickCb) {
        onPick = pickCb; tip = document.getElementById('tip');
        try { R = new T.WebGLRenderer({ canvas: cv, antialias: !mobile }); if (!R.getContext()) throw 0; } catch (e) { return false; }
        R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        S = new T.Scene(); S.background = new T.Color(0x0c0e11); S.fog = new T.Fog(0x0c0e11, 16, 38);
        C = new T.PerspectiveCamera(45, 1, 0.1, 100);
        S.add(new T.HemisphereLight(0xbfc8d6, 0x1a1c20, 0.55));
        const sun = new T.DirectionalLight(0xfff1d6, 0.9); sun.position.set(6, 10, 5); S.add(sun);
        const fl = new T.Mesh(new T.PlaneGeometry(60, 60), new T.MeshStandardMaterial({ color: 0x14171b, roughness: 1 }));
        fl.rotation.x = -Math.PI / 2; S.add(fl);
        const gr = new T.GridHelper(60, 60, 0x2c323a, 0x1a1e23); gr.position.y = 0.01; S.add(gr);
        IDS.forEach(build);
        IDS.forEach((id, i) => {
            const A = new T.Vector3(...POS[id]), Bv = new T.Vector3(...POS[IDS[(i + 1) % 4]]);
            const dir = Bv.clone().sub(A).normalize(), off = Math.abs(dir.x) > 0.5 ? 1.9 : 1.2;
            const a = A.clone().addScaledVector(dir, off), b = Bv.clone().addScaledVector(dir, -off); a.y = b.y = 1.2;
            const geo = new T.CylinderGeometry(0.14, 0.14, a.distanceTo(b), 12); geo.rotateX(Math.PI / 2);
            const pipe = new T.Mesh(geo, new T.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.8, roughness: 0.4 }));
            S.add(pipe); pipe.position.copy(a).add(b).multiplyScalar(0.5); pipe.lookAt(b);
            const n = mobile ? 10 : 22, pg = new T.BufferGeometry();
            pg.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3));
            const pts = new T.Points(pg, new T.PointsMaterial({ color: 0xd9d5c7, size: 0.16, transparent: true }));
            pts.frustumCulled = false; S.add(pts);
            pipes.push({ i, a, d: b.clone().sub(a), n, t: 0, pts });
        });
        const rs = () => { const w = box.clientWidth, h = box.clientHeight; if (!w || !h) return; R.setSize(w, h, false); C.aspect = w / h; C.updateProjectionMatrix(); };
        new ResizeObserver(rs).observe(box); rs();
        cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; });
        cv.addEventListener('pointermove', (e) => {
            const r = cv.getBoundingClientRect();
            mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); mx = mouse.x; my = mouse.y;
            if (drag) {
                const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
                th -= dx * 0.006; ph = Math.max(0.3, Math.min(1.45, ph - dy * 0.005)); tip.hidden = true; return;
            }
            const id = hit();
            if (!id) { tip.hidden = true; cv.style.cursor = 'grab'; return; }
            const m = M[id]; tip.hidden = false; cv.style.cursor = 'pointer';
            tip.textContent = id + (m.off ? ': offline' : ': health ' + Math.round(m.h));
            tip.style.left = (e.clientX - r.left + 14) + 'px'; tip.style.top = (e.clientY - r.top + 14) + 'px';
        });
        cv.addEventListener('pointerup', () => { if (drag && drag.moved < 6) { const id = hit(); if (id) onPick(id); } drag = null; cv.style.cursor = 'grab'; });
        cv.addEventListener('pointerleave', () => { tip.hidden = true; mx = my = 0; });
        cv.addEventListener('wheel', (e) => { e.preventDefault(); dGoal = Math.max(8, Math.min(26, dGoal + e.deltaY * 0.01)); }, { passive: false });
        new IntersectionObserver((es) => { vis = es[0].isIntersecting; kick(); }).observe(box);
        document.addEventListener('visibilitychange', kick);
        kick();
        return true;
    }

    function update(d) {
        const m = M[d.machineId]; if (!m) return;
        const c = d.computed || {}, me = d.metrics || {}, was = m.det;
        m.h = c.health ?? 100; m.off = d.status === 'offline';
        m.rpm = +V(me.rpm) || 0; m.temp = +V(me.temperature) || 0; m.rms = +V(c.vibrationRms) || 0;
        m.det = (c.detections || []).length > 0;
        if (m.det && !was && !m.off) cascade(d.machineId);
    }

    function select(id) { sel = id; const p = POS[id]; if (!p) return; goal.set(p[0] * 0.55, 0.8, p[2] * 0.55); dGoal = 13; }

    window.Twin = { init, update, select };
})();