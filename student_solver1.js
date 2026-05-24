'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  student_solver1.js — Automated greedy topology optimizer (student simulator)
//
//  Usage:  node student_solver1.js PLAYER_CODE http://localhost:8451  
//
//  Algorithm:
//    1. Fetch the full problem from /api/problem
//    2. Repeatedly solve the current structure and try removing the
//       LEAST-STRESSED non-locked member (most likely removable first)
//    3. If removal causes failure (mechanism OR stress > yield) → lock member
//    4. Stop when every remaining member is locked
//    5. Submit the final member list to /api/submit
// ═══════════════════════════════════════════════════════════════════════════

const http = require('http');

const CODE   = process.argv[2];
const SERVER = process.argv[3] || 'http://localhost:8451';

if (!CODE) {
    console.error('Usage: node student_solver.js <player_code> [http://localhost:8451]');
    process.exit(1);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let d = '';
            res.on('data', c => (d += c));
            res.on('end', () => {
                try { resolve(JSON.parse(d)); }
                catch (e) { reject(new Error(`Bad JSON from GET ${url}: ${d.slice(0, 120)}`)); }
            });
        }).on('error', reject);
    });
}

function httpPost(url, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const u    = new URL(url);
        const opts = {
            hostname: u.hostname,
            port:     u.port,
            path:     u.pathname,
            method:   'POST',
            headers: {
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(data),
            },
        };
        const req = http.request(opts, res => {
            let d = '';
            res.on('data', c => (d += c));
            res.on('end', () => {
                try { resolve(JSON.parse(d)); }
                catch (e) { reject(new Error(`Bad JSON from POST ${url}: ${d.slice(0, 120)}`)); }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// ── FEM solver (identical to server.js) ──────────────────────────────────────
// With uniform EA=1, forces come out in real Newtons for statically
// indeterminate trusses where all members share the same cross-section,
// because relative stiffness (1/L) determines force distribution correctly.

function gaussElim(A, b) {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
        let maxRow = col;
        for (let r = col + 1; r < n; r++)
            if (Math.abs(M[r][col]) > Math.abs(M[maxRow][col])) maxRow = r;
        [M[col], M[maxRow]] = [M[maxRow], M[col]];
        if (Math.abs(M[col][col]) < 1e-14)
            throw new Error('Singular — mechanism');
        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const f = M[r][col] / M[col][col];
            for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
        }
    }
    return M.map((row, i) => row[n] / row[i]);
}

function solveTruss(nodes, members, fixedDofs, femLoads) {
    const nDof = nodes.length * 2;
    const K    = Array.from({ length: nDof }, () => new Array(nDof).fill(0));

    for (const [i, j] of members) {
        const [xi, yi] = nodes[i], [xj, yj] = nodes[j];
        const L = Math.hypot(xj - xi, yj - yi);
        if (L < 1e-9) throw new Error(`Zero-length member ${i}-${j}`);
        const c = (xj - xi) / L, s = (yj - yi) / L;
        const kl = [
            [ c*c,  c*s, -c*c, -c*s],
            [ c*s,  s*s, -c*s, -s*s],
            [-c*c, -c*s,  c*c,  c*s],
            [-c*s, -s*s,  c*s,  s*s],
        ];
        const dofs = [2*i, 2*i+1, 2*j, 2*j+1];
        for (let a = 0; a < 4; a++)
            for (let b = 0; b < 4; b++)
                K[dofs[a]][dofs[b]] += kl[a][b] / L;
    }

    const F = new Array(nDof).fill(0);
    for (const { dof, force } of femLoads) F[dof] += force;

    const fixed       = new Set(fixedDofs);
    const activeNodes = new Set(members.flatMap(([i, j]) => [i, j]));

    // Co-linear node fix: a free node whose 2×2 stiffness block is rank-1 has
    // zero stiffness perpendicular to its members.  With zero perpendicular load
    // the displacement is also zero — enforce it via penalty stiffness so the
    // matrix stays non-singular without changing any physically meaningful force.
    for (const ni of activeNodes) {
        if (fixed.has(2*ni)) continue;
        const Kxx = K[2*ni  ][2*ni  ];
        const Kyy = K[2*ni+1][2*ni+1];
        const Kxy = K[2*ni  ][2*ni+1];
        const det   = Kxx * Kyy - Kxy * Kxy;
        const scale = Kxx * Kyy + 1e-30;
        if (Math.abs(det) < 1e-10 * scale) {
            const norm = Math.hypot(Kyy, -Kxy);
            if (norm < 1e-30) continue;
            const nx = Kyy / norm, ny = -Kxy / norm;
            if (Math.abs(F[2*ni] * nx + F[2*ni+1] * ny) < 1e-4) {
                const penalty = Math.max(Kxx, Kyy, 1e-6) * 1e8;
                K[2*ni  ][2*ni  ] += penalty * nx * nx;
                K[2*ni  ][2*ni+1] += penalty * nx * ny;
                K[2*ni+1][2*ni  ] += penalty * ny * nx;
                K[2*ni+1][2*ni+1] += penalty * ny * ny;
            }
        }
    }

    const free  = Array.from({ length: nDof }, (_, i) => i)
        .filter(i => !fixed.has(i) && activeNodes.has(Math.floor(i / 2)));
    if (free.length === 0) throw new Error('All DOFs fixed');

    const Kff = free.map(r => free.map(c => K[r][c]));
    const Ff  = free.map(i => F[i]);
    const uf  = gaussElim(Kff, Ff);

    const u = new Array(nDof).fill(0);
    free.forEach((dof, idx) => { u[dof] = uf[idx]; });

    return members.map(([i, j]) => {
        const [xi, yi] = nodes[i], [xj, yj] = nodes[j];
        const L = Math.hypot(xj - xi, yj - yi);
        const c = (xj - xi) / L, s = (yj - yi) / L;
        const ue = [u[2*i], u[2*i+1], u[2*j], u[2*j+1]];
        return (1 / L) * (-c*ue[0] - s*ue[1] + c*ue[2] + s*ue[3]);
    });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`[STUDENT] Connecting to ${SERVER} as code "${CODE}"…`);

    // ── 1. Fetch problem ───────────────────────────────────────────────────
    const prob = await httpGet(`${SERVER}/api/problem`);
    const { nodes, members: allMembers, boundary, loads: loadDef, rodSide, yieldMPa } = prob;
    const yieldStress = yieldMPa * 1e6;   // Pa
    const rodArea     = rodSide * rodSide; // m²

    console.log(`[STUDENT] Problem: ${nodes.length} nodes, ${allMembers.length} members`);
    console.log(`[STUDENT] rodSide=${rodSide} m  yield=${yieldMPa} MPa`);

    // ── 2. Build fixed DOFs from boundary ──────────────────────────────────
    const fixedDofs = [];
    for (let i = 0; i < nodes.length; i++) {
        const [x, y] = nodes[i];
        const pinned =
            (boundary.x_min != null && x <= boundary.x_min) ||
            (boundary.x_max != null && x >= boundary.x_max) ||
            (boundary.y_min != null && y <= boundary.y_min) ||
            (boundary.y_max != null && y >= boundary.y_max);
        if (pinned) fixedDofs.push(2 * i, 2 * i + 1);
    }
    console.log(`[STUDENT] Fixed nodes: ${fixedDofs.length / 2}`);

    // ── 3. Build FEM load array ────────────────────────────────────────────
    const femLoads = loadDef.flatMap(([ni, fx, fy]) => [
        { dof: 2 * ni,     force: fx },
        { dof: 2 * ni + 1, force: fy },
    ]);

    // ── 4. Validate full structure (sanity check) ──────────────────────────
    let axial;
    try {
        axial = solveTruss(nodes, allMembers, fixedDofs, femLoads);
    } catch (e) {
        console.error(`[STUDENT] Full structure fails FEM: ${e.message}`);
        process.exit(1);
    }
    const initMaxStress = Math.max(...axial.map(f => Math.abs(f) / rodArea));
    console.log(`[STUDENT] Full structure: SF = ${(yieldStress / initMaxStress).toFixed(2)}`);

    // ── 5. Iterated greedy removal ────────────────────────────────────────
    //
    //  Key improvements over naive greedy:
    //
    //  (a) Phase 0 — remove fixed↔fixed members immediately (zero force,
    //      always safe, no FEM needed).
    //
    //  (b) Fast pre-checks before every FEM call:
    //      • Degree check  — both endpoints of the removed member must still
    //        have degree ≥ 2 among the free nodes, otherwise the node becomes
    //        a slider mechanism and FEM would fail anyway.
    //      • Connectivity check (BFS) — the load node must still be reachable
    //        from at least one fixed node through the remaining members.
    //      These two O(M) checks avoid most unnecessary O(N³) FEM solves.
    //
    //  (c) Randomised iterations — each iteration adds Gaussian noise scaled
    //      to a fraction of the stress range before sorting, so different
    //      iterations take different paths through the search space.
    //      Odd  iterations restart from the FULL original structure.
    //      Even iterations restart from the current best (exploitation).
    //
    //  (d) Global best tracking — the cheapest valid solution across all
    //      iterations is submitted.

    const ITERATIONS = 2;
    const memberKey  = ([a, b]) => `${Math.min(a, b)},${Math.max(a, b)}`;

    // Sets for fast lookup
    const fixedNodeSet = new Set();
    for (let i = 0; i < fixedDofs.length; i += 2) fixedNodeSet.add(fixedDofs[i] / 2);
    const freeNodeSet = new Set(
        Array.from({ length: nodes.length }, (_, i) => i).filter(i => !fixedNodeSet.has(i))
    );

    // Load node index (first load entry)
    const loadNodeIdx = loadDef[0][0];

    // ── Phase 0: remove fixed↔fixed members (zero elongation, always safe) ─
    function removeFixedFixed(members) {
        const removed = members.filter(([a, b]) => fixedNodeSet.has(a) && fixedNodeSet.has(b));
        const kept    = members.filter(([a, b]) => !(fixedNodeSet.has(a) && fixedNodeSet.has(b)));
        if (removed.length)
            console.log(`[STUDENT] Phase 0: removed ${removed.length} fixed↔fixed members → ${kept.length} remain`);
        return kept;
    }

    // ── Pre-check helpers ─────────────────────────────────────────────────

    // Degree of free nodes in a member list
    function freeDegrees(members) {
        const deg = new Map([...freeNodeSet].map(n => [n, 0]));
        for (const [a, b] of members) {
            if (deg.has(a)) deg.set(a, deg.get(a) + 1);
            if (deg.has(b)) deg.set(b, deg.get(b) + 1);
        }
        return deg;
    }

    // BFS: can we reach any fixed node from loadNodeIdx through `members`?
    function isLoadConnected(members) {
        const adj = new Map();
        for (const [a, b] of members) {
            if (!adj.has(a)) adj.set(a, []);
            if (!adj.has(b)) adj.set(b, []);
            adj.get(a).push(b);
            adj.get(b).push(a);
        }
        const visited = new Set([loadNodeIdx]);
        const queue   = [loadNodeIdx];
        while (queue.length) {
            const n = queue.shift();
            if (fixedNodeSet.has(n)) return true;
            for (const nb of (adj.get(n) || [])) {
                if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
            }
        }
        return false;
    }

    // Combined pre-check: is it worth running FEM after removing member at `idx`?
    function quickCheck(trial, removedA, removedB) {
        // Degree check for the two endpoints that are free nodes
        if (freeNodeSet.has(removedA) || freeNodeSet.has(removedB)) {
            const deg = freeDegrees(trial);
            if (freeNodeSet.has(removedA) && (deg.get(removedA) || 0) < 2) return false;
            if (freeNodeSet.has(removedB) && (deg.get(removedB) || 0) < 2) return false;
        }
        // Connectivity check
        if (!isLoadConnected(trial)) return false;
        return true;
    }

    // ── Greedy pass with a given noise scale for stress ranking ───────────
    function greedyReduce(startMembers, noiseScale) {
        let current = startMembers.slice();
        const locked = new Set();
        let pass = 0;
        let changed = true;

        while (changed) {
            pass++;
            changed = false;

            let curAxial;
            try {
                curAxial = solveTruss(nodes, current, fixedDofs, femLoads);
            } catch {
                break;
            }

            // Stress range for noise calibration
            const stresses   = curAxial.map(Math.abs);
            const maxStress  = Math.max(...stresses) || 1;
            const noiseAmp   = maxStress * noiseScale;

            // Build candidate list: non-locked, sorted by stress + noise
            const candidates = current
                .map((m, idx) => ({
                    idx,
                    key: memberKey(m),
                    m,
                    sortKey: stresses[idx] + (Math.random() * 2 - 1) * noiseAmp,
                }))
                .filter(c => !locked.has(c.key))
                .sort((a, b) => a.sortKey - b.sortKey);

            if (candidates.length === 0) break;

            for (const { idx, key, m } of candidates) {
                const trial = current.filter((_, i) => i !== idx);

                // Fast pre-checks (avoid FEM when obviously invalid)
                if (!quickCheck(trial, m[0], m[1])) {
                    locked.add(key);
                    continue;
                }

                // FEM validation
                let ok = false;
                try {
                    const trialAxial = solveTruss(nodes, trial, fixedDofs, femLoads);
                    const ms = Math.max(...trialAxial.map(f => Math.abs(f) / rodArea));
                    ok = ms <= yieldStress;
                } catch { /* mechanism */ }

                if (ok) {
                    current = trial;
                    changed = true;
                    break; // re-rank after each removal
                } else {
                    locked.add(key);
                }
            }
        }
        return current;
    }

    // ── Run iterations ────────────────────────────────────────────────────
    const phase0Base = removeFixedFixed(allMembers.slice());
    let best = phase0Base;

    for (let iter = 1; iter <= ITERATIONS; iter++) {
        // Odd iterations: restart from full (pruned) structure → exploration
        // Even iterations: restart from current best                → exploitation
        const start = (iter % 2 === 1) ? phase0Base.slice() : best.slice();

        // Noise scale decreases over iterations: 0.3 → 0.05
        // Early iterations explore broadly; later iterations refine
        const noiseScale = 0.3 - (iter - 1) * (0.25 / (ITERATIONS - 1));

        console.log(`\n[STUDENT] ━━━ Iter ${iter}/${ITERATIONS}  start=${start.length}  noise=${noiseScale.toFixed(2)} ━━━`);

        const result = greedyReduce(start, noiseScale);

        console.log(`[STUDENT] Iter ${iter} done: ${result.length} members`);

        if (result.length < best.length) {
            best = result;
            console.log(`[STUDENT] ★ New best: ${best.length} members`);
        }
    }

    const current = best;
    console.log(`\n[STUDENT] ✓ Optimization complete: ${current.length} members remaining`);

    // Final SF check
    const finalAxial = solveTruss(nodes, current, fixedDofs, femLoads);
    const finalMax   = Math.max(...finalAxial.map(f => Math.abs(f) / rodArea));
    const finalSF    = yieldStress / finalMax;
    console.log(`[STUDENT] Final SF = ${finalSF.toFixed(3)}`);

    // ── 6. Submit — retry up to 10 times on network errors ────────────────
    const MAX_RETRIES = 10;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[STUDENT] Submitting… (attempt ${attempt}/${MAX_RETRIES})`);
            const result = await httpPost(`${SERVER}/api/submit`, { code: CODE, members: current });
            if (result.ok) {
                console.log(`[STUDENT] ✓ Accepted!  score=${result.score}  SF=${result.safetyFactor}`);
            } else {
                console.error(`[STUDENT] ✗ Rejected: ${result.message}`);
            }
            break;
        } catch (e) {
            console.warn(`[STUDENT] Network error on attempt ${attempt}: ${e.message}`);
            if (attempt === MAX_RETRIES) {
                console.error(`[STUDENT] All ${MAX_RETRIES} attempts failed. Giving up.`);
            } else {
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
    }
}

main().catch(e => { console.error('[STUDENT] Fatal:', e.message); process.exit(1); });
