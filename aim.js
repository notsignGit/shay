/**
 * AIM – Stress Test
 * =================
 * מדמה את כל 22 השחקנים מתחברים דרך WebSocket ושולחים כוחות:
 *   AIM  → רודף אחרי ה-GOAL הקרוב ביותר של הצוות השני
 *   GOAL → בורח מה-AIM הקרוב ביותר של הצוות השני
 * מודד תגובות שרת, שגיאות ועקביות.
 *
 * שימוש:  node stress_test.js [server_url] [duration_ms]
 * דוגמה:  node stress_test.js http://192.168.60.104:5817 30000
 */
'use strict';

const http  = require('http');
const https = require('https');
const { WebSocket } = require('ws');

const SERVER   = process.argv[2] || 'http://192.168.60.104:5817';

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

// Max force magnitudes (must not exceed server limits)
const MAX_AIM_F  = 440;
const MAX_GOAL_F = 290;

// ── Counters ─────────────────────────────────────────────────────────────────
let cmdSent = 0, errCount = 0;

// ── HTTP GET ──────────────────────────────────────────────────────────────────
function httpGet(url) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        lib.get(url, { timeout: 5000 }, (res) => {
            let buf = ''; res.on('data', c => { buf += c; });
            res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(null); } });
        }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
    });
}

// ── Admin command (start game) ────────────────────────────────────────────────
function adminStart() {
    return new Promise((resolve) => {
        const ws = new WebSocket(SERVER.replace(/^http/, 'ws') + '/');
        const done = () => { try { ws.close(); } catch {} resolve(); };
        const t = setTimeout(done, 4000);
        ws.on('open', () => ws.send(JSON.stringify({ type: 'admin', password: 'admin156234', action: 'start' })));
        ws.on('message', () => { clearTimeout(t); done(); });
        ws.on('error',   () => { clearTimeout(t); resolve(); });
    });
}

// ── Force strategy ────────────────────────────────────────────────────────────
function computeForce(myEntity, allEntities) {
    const enemies = allEntities.filter(e => e.team !== myEntity.team);
    if (!enemies.length) return { x: 0, y: 0 };

    if (myEntity.type === 'aim') {
        // Chase the nearest enemy GOAL
        const targets = enemies.filter(e => e.type === 'goal');
        if (!targets.length) return { x: 0, y: 0 };
        const nearest = targets.reduce((a, b) =>
            Math.hypot(b.pos.x - myEntity.pos.x, b.pos.y - myEntity.pos.y) <
            Math.hypot(a.pos.x - myEntity.pos.x, a.pos.y - myEntity.pos.y) ? b : a
        );
        const dx = nearest.pos.x - myEntity.pos.x;
        const dy = nearest.pos.y - myEntity.pos.y;
        const d  = Math.hypot(dx, dy) || 1;
        return { x: (dx / d) * MAX_AIM_F, y: (dy / d) * MAX_AIM_F };
    } else {
        // GOAL: flee the nearest enemy AIM
        const threats = enemies.filter(e => e.type === 'aim');
        if (!threats.length) return { x: 0, y: 0 };
        const nearest = threats.reduce((a, b) =>
            Math.hypot(b.pos.x - myEntity.pos.x, b.pos.y - myEntity.pos.y) <
            Math.hypot(a.pos.x - myEntity.pos.x, a.pos.y - myEntity.pos.y) ? b : a
        );
        const dx = myEntity.pos.x - nearest.pos.x;
        const dy = myEntity.pos.y - nearest.pos.y;
        const d  = Math.hypot(dx, dy) || 1;
        return { x: (dx / d) * MAX_GOAL_F, y: (dy / d) * MAX_GOAL_F };
    }
}

// ── Connect one player (resolves when game ends or connection drops) ─────────
function connectPlayer(player) {
    return new Promise((resolve) => {
        const ws     = new WebSocket(SERVER.replace(/^http/, 'ws') + '/');
        let myName   = null;
        let alive    = true;

        const close = () => { alive = false; try { ws.close(); } catch {} resolve(); };
        // Safety: never hang more than 10 min per round
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
                if (!myName || !msg.entities) return;
                const me = msg.entities.find(e => e.name === myName);
                if (!me) return;
                const force = computeForce(me, msg.entities);
                ws.send(JSON.stringify({ type: 'cmd', entityId: me.id, force }));
                cmdSent++;
            }
        });

        ws.on('error', () => { errCount++; clearTimeout(safety); close(); });
        ws.on('close', () => { clearTimeout(safety); close(); });
    });
}

// ── Main (infinite loop) ──────────────────────────────────────────────────────
async function main() {
    console.log(`[AIM stress] server=${SERVER}  (infinite loop — Ctrl+C to stop)`);
    try { await httpGet(`${SERVER}/api/state`); }
    catch (e) { console.error('Cannot reach server:', e.message); process.exit(1); }

    let round = 0;
    while (true) {
        round++;
        console.log(`\n--- Round ${round} ---`);
        cmdSent = 0; errCount = 0;

        await adminAction('reset');
        await sleep(300);
        await adminAction('start');
        await sleep(500);

        await Promise.all(PLAYERS.map(p => connectPlayer(p)));
        console.log(`  Round ${round} ended  cmds=${cmdSent}  errors=${errCount}`);
        await sleep(1500);
    }
}
main();
