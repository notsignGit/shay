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
    { name: 'YAIR',     code: '' },
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

// ── BFS: returns first move toward the target, or null if unreachable ─────────
function bfsMove(sx, sy, tx, ty, obstSet, W, H) {
    if (sx === tx && sy === ty) return 'STAY';
    const key   = (x, y) => `${x},${y}`;
    const queue = [[sx, sy, null]];   // [x, y, firstMove]
    const seen  = new Set([key(sx, sy)]);

    while (queue.length) {
        const [x, y, first] = queue.shift();
        for (const move of MOVES) {
            const [dx, dy] = DELTAS[move];
            const nx = x + dx, ny = y + dy;
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

/**
 * Pick the best target prize and return the first BFS move toward it.
 * Prizes are ranked by value / manhattan_distance (higher = better).
 */
function chooseMove(robot, prizes, obstSet, W, H) {
    if (!prizes.length) return 'STAY';

    const ranked = prizes
        .map(p => ({ p, score: p.value / (Math.abs(p.x - robot.x) + Math.abs(p.y - robot.y) + 1) }))
        .sort((a, b) => b.score - a.score);

    for (const { p } of ranked) {
        const move = bfsMove(robot.x, robot.y, p.x, p.y, obstSet, W, H);
        if (move && move !== 'STAY') return move;
    }
    return 'STAY';
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
                if (msg.obstacles) obstSet = new Set(msg.obstacles.map(([x, y]) => `${x},${y}`));
                const move = chooseMove(robot, msg.prizes || [], obstSet || new Set(), gridW, gridH);
                ws.send(JSON.stringify({ type: 'cmd', move }));
                cmdSent++;
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
