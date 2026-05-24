/**
 * ROBOWAR – Stress Test
 * =====================
 * מדמה את כל 22 השחקנים מתחברים דרך WebSocket ושולחים פקודות תנועה.
 *
 * אסטרטגיה:
 *   BFS אל הפרס הקרוב ביותר (ערך × 1 / מרחק), תוך הימנעות ממכשולים.
 *   אם ה-BFS נכשל (הפרס חסום), עוברים לפרס הבא.
 *
 * שימוש:  node stress_test.js [server_url] [duration_ms]
 * דוגמה:  node robo.js
 */
'use strict';

const http  = require('http');
const https = require('https');
const { WebSocket } = require('ws');

const SERVER   = process.argv[2] || 'http://192.168.60.104:5064';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function adminAction(action) {
    return new Promise((resolve) => {
        const ws = new WebSocket(SERVER.replace(/^http/, 'ws') + '/');
        const done = () => { try { ws.close(); } catch {} resolve(); };
        const t = setTimeout(done, 5000);
        ws.on('open', () => ws.send(JSON.stringify({ type: 'admin', password: 'admin156234', action })));
        ws.on('message', () => { clearTimeout(t); setTimeout(done, 100); });
        ws.on('error',   () => { clearTimeout(t); resolve(); });
    });
}

const PLAYERS = [
    { name: 'SHAI',     code: '0998987654' },
    // { name: 'SHLOMI',   code: '' },
    // { name: 'MIKI',     code: '' },
    // { name: 'MIKI2',    code: '' },
    // { name: 'KEREN',    code: '' },
    // { name: 'ARIA',     code: '' },
    // { name: 'YOSSI',    code: '' },
    // { name: 'ARON',     code: '' },
    // { name: 'ROSS',     code: '' },
    // { name: 'RAZ',      code: '' },
    // { name: 'ASCHCHAR', code: '' },
    // { name: 'SHAI',     code: '' },
    // { name: 'TOMER',    code: '' },
    // { name: 'DORON',    code: '' },
    // { name: 'YAMIT',    code: '' },
    // { name: 'INBAL',    code: '' },
    // { name: 'NOAM',     code: '' },
    // { name: 'SAMUAL',   code: '' },
    // { name: 'GUY',      code: '' },
    // { name: 'DANIEL',   code: '' },
    // { name: 'AMITL',    code: '' },
    // { name: 'ARIAL',    code: '' },
];

const MOVES   = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
const DELTAS  = { UP: [0, 1], DOWN: [0, -1], LEFT: [-1, 0], RIGHT: [1, 0] };
const OPPOSITE = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };

function key(x, y) {
    return `${x},${y}`;
}

function stepCoord(x, y, move) {
    const [dx, dy] = DELTAS[move];
    return { x: x + dx, y: y + dy };
}

function manhattan(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// ── BFS: returns first move toward the target, or null if unreachable ─────────
function bfsMove(sx, sy, tx, ty, obstSet, W, H) {
    if (sx === tx && sy === ty) return 'STAY';
    const queue = [[sx, sy, null]];
    const seen  = new Set([key(sx, sy)]);

    while (queue.length) {
        const [x, y, first] = queue.shift();
        for (const move of MOVES) {
            const { x: nx, y: ny } = stepCoord(x, y, move);
            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
            const k = key(nx, ny);
            if (seen.has(k) || obstSet.has(k)) continue;
            const fm = first || move;
            if (nx === tx && ny === ty) return fm;
            seen.add(k);
            queue.push([nx, ny, fm]);
        }
    }
    return null;   // unreachable
}

function chooseTarget(prizes, robot) {
    if (!prizes.length) return null;

    const clusters = prizes
        .map(p => ({
            p,
            dist: manhattan(robot, p),
            value: p.value,
        }))
        .sort((a, b) => a.dist - b.dist);

    const nearest = clusters[0]?.dist ?? Infinity;
    const nearby = clusters.filter(entry => entry.dist <= nearest + 2);

    const totalValue = nearby.reduce((sum, entry) => sum + entry.value, 0);
    const centroid = nearby.reduce(
        (acc, entry) => ({
            x: acc.x + entry.p.x,
            y: acc.y + entry.p.y,
        }),
        { x: 0, y: 0 }
    );

    return {
        x: Math.round(centroid.x / nearby.length),
        y: Math.round(centroid.y / nearby.length),
        value: totalValue,
        nearby,
    };
}

function chooseMove(robot, prizes, rivals, obstSet, W, H, lastMove) {
    if (!prizes.length) return 'STAY';

    const target = chooseTarget(prizes, robot);
    const myDist = manhattan(robot, target);
    const rivalCloser = rivals.some(r => manhattan(r, target) < myDist);

    const move = bfsMove(robot.x, robot.y, target.x, target.y, obstSet, W, H);
    if (!move || move === 'STAY') return 'STAY';

    if (!rivalCloser) return move;

    const contestMoves = getContestMoves(robot, target, rivals, obstSet, W, H, lastMove);
    if (contestMoves.length) return contestMoves[0].move;
    return move;
}

function buildBlockedSet(msg, myName) {
    const blocked = new Set();

    for (const [x, y] of (msg.obstacles || [])) {
        blocked.add(key(x, y));
    }

    for (const robot of (msg.robots || [])) {
        if (robot.name === myName) continue;
        blocked.add(key(robot.x, robot.y));
    }

    return blocked;
}

function buildRivals(msg, myName) {
    return (msg.robots || [])
        .filter(robot => robot.name !== myName)
        .map(robot => ({ x: robot.x, y: robot.y, name: robot.name }));
}

function getContestMoves(robot, prize, rivals, obstSet, W, H, lastMove) {
    const rivalSet = new Set(rivals.map(r => key(r.x, r.y)));

    return MOVES
        .map(move => {
            const next = stepCoord(robot.x, robot.y, move);
            const blocked = next.x < 0 || next.x >= W || next.y < 0 || next.y >= H || obstSet.has(key(next.x, next.y));
            const nearRival = rivals.some(r => Math.abs(r.x - next.x) + Math.abs(r.y - next.y) === 1);
            const score = manhattan(next, prize) + (nearRival ? 2 : 0);
            const reversePenalty = move === OPPOSITE[lastMove] ? 1 : 0;

            return { move, next, blocked, score, reversePenalty };
        })
        .filter(candidate => !candidate.blocked)
        .sort((a, b) => a.reversePenalty - b.reversePenalty || a.score - b.score);
}

function pickAlternativeMove(robot, prizes, rivals, obstSet, W, H, lastMove) {
    const feasible = MOVES
        .map(move => {
            const next = stepCoord(robot.x, robot.y, move);
            const blocked = obstSet.has(key(next.x, next.y)) || next.x < 0 || next.x >= W || next.y < 0 || next.y >= H;
            const nearRival = rivals.some(r => Math.abs(r.x - next.x) + Math.abs(r.y - next.y) === 1);
            const bestPrizeDist = prizes.reduce((best, p) => Math.min(best, manhattan(next, p)), Infinity);
            const reversePenalty = move === OPPOSITE[lastMove] ? 1 : 0;

            return { move, next, blocked, bestPrizeDist, reversePenalty, nearRival };
        })
        .filter(candidate => !candidate.blocked)
        .sort((a, b) => a.reversePenalty - b.reversePenalty || a.nearRival - b.nearRival || a.bestPrizeDist - b.bestPrizeDist);

    if (!feasible.length) return 'STAY';
    return feasible[0].move;
}

// ── HTTP GET ──────────────────────────────────────────────────────────────────
function httpGet(url) {
    return new Promise((resolve, reject) => {
        const lib    = url.startsWith('https') ? https : http;
        lib.get(url, { timeout: 5000 }, (res) => {
            let buf = ''; res.on('data', c => { buf += c; });
            res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(null); } });
        }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
    });
}

// ── Counters ──────────────────────────────────────────────────────────────────
let cmdSent  = 0, errCount = 0;

// ── Connect one player (resolves on game_over or connection drop) ──────────────
function connectPlayer(player) {
    return new Promise((resolve) => {
        const ws    = new WebSocket(SERVER.replace(/^http/, 'ws') + '/');
        let myName  = null;
        let alive   = true;
        let obstSet = null;
        let gridW   = 38, gridH = 25;
        let lastMove = null;
        let lastPos  = null;
        let noProgressSteps = 0;

        const close = () => { alive = false; try { ws.close(); } catch {} resolve(); };
        const safety = setTimeout(close, 10 * 60 * 1000);

        ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', code: player.code })));

        ws.on('message', (raw) => {
            if (!alive) return;
            let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }

            if (msg.type === 'auth_result') {
                if (!msg.ok) { errCount++; clearTimeout(safety); close(); return; }
                myName = msg.name;
                return;
            }
            if (msg.type === 'game_over') { clearTimeout(safety); close(); return; }

            if (msg.type === 'state') {
                if (!myName || !msg.robots) return;
                const robot = msg.robots.find(r => r.name === myName);
                if (!robot) return;
                gridW   = msg.grid?.width  || 38;
                gridH   = msg.grid?.height || 25;
                obstSet = buildBlockedSet(msg, myName);
                const rivals = buildRivals(msg, myName);

                if (lastPos && robot.x === lastPos.x && robot.y === lastPos.y) {
                    noProgressSteps++;
                } else {
                    noProgressSteps = 0;
                }

                let move = chooseMove(robot, msg.prizes || [], rivals, obstSet || new Set(), gridW, gridH, lastMove);
                let burstCount = 2;
                if (move === 'STAY' || noProgressSteps >= 2 || (lastMove === move && lastPos && robot.x === lastPos.x && robot.y === lastPos.y)) {
                    move = pickAlternativeMove(robot, msg.prizes || [], rivals, obstSet || new Set(), gridW, gridH, lastMove);
                    burstCount = 1;
                }

                if (rivals.some(r => Math.abs(r.x - robot.x) + Math.abs(r.y - robot.y) <= 2)) {
                    burstCount = 1;
                }

                for (let i = 0; i < burstCount; i++) {
                    ws.send(JSON.stringify({ type: 'cmd', move }));
                }
                cmdSent += burstCount;
                lastMove = move;
                lastPos = { x: robot.x, y: robot.y };
            }
        });

        ws.on('error', () => { errCount++; clearTimeout(safety); close(); });
        ws.on('close', () => { clearTimeout(safety); close(); });
    });
}

// ── Main (infinite loop) ─────────────────────────────────────────────────────
async function main() {
    console.log(`[ROBOWAR stress] server=${SERVER}  (infinite loop — Ctrl+C to stop)`);
    try { await httpGet(`${SERVER}/api/state`); }
    catch (e) { console.error('Cannot reach server:', e.message); process.exit(1); }

    let round = 0;
    while (true) {
        round++;
        console.log(`\n--- Round ${round} ---`);
        cmdSent = 0; errCount = 0;

        await adminAction('reset');
        await sleep(400);
        await adminAction('start');
        await sleep(600);

        await Promise.all(PLAYERS.map(p => connectPlayer(p)));
        console.log(`  Round ${round} ended  cmds=${cmdSent}  errors=${errCount}`);
        await sleep(1500);
    }
}
main();
