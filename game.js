'use strict';
// Graveyard Gridiron. An original browser game that follows the rules of a
// 1998 Java applet (see ../analysis/how-it-works.md), with a passing game added.
// Code, art and sound are new.

const COLS = 60, LANES = 11, VIEW = 20, CELL = 40;
const MID = Math.floor(LANES / 2);
const TICK_MS = 333, ROUTE_MS = 200, GAME_MS = 60000;
const FIELD_W = VIEW * CELL, FIELD_H = LANES * CELL, HUD_H = 104;
const OPENING_DENSITY = 0.06, BASE_DENSITY = 0.08, DIFFICULTY_STEP = 1.1;
const SOUL_DENSITY = 0.02, GRAVE_DENSITY = 0.02, DECOR_DENSITY = 0.1;
const RISE_START = CELL - 2, RISE_STEP = 3, SLIDE_STEP = 7;
const TACKLE_PAUSE = 2000, TOUCHDOWN_PAUSE = 3000, INCOMPLETE_PAUSE = 1500;
const RECEIVER_LANES = [1, 3, 9], THROW_KEYS = ['A', 'S', 'D'];
const BALL_BASE_MS = 250, BALL_PER_SQUARE_MS = 35;

// Route steps: R upfield, L back, I toward the middle, O toward the sideline,
// N upfield and in on a diagonal, X upfield and out on a diagonal, B back and in.
const PLAYS = [
  { name: 'Verticals', routes: ['R'.repeat(14), 'R'.repeat(14), 'R'.repeat(14)] },
  { name: 'Slants', routes: ['RR' + 'N'.repeat(5), 'RR' + 'N'.repeat(5), 'RR' + 'N'.repeat(5)] },
  { name: 'Outs', routes: ['R'.repeat(7) + 'OOO', 'R'.repeat(4) + 'OOO', 'R'.repeat(7) + 'OOO'] },
  { name: 'Curls', routes: ['R'.repeat(9) + 'BB', 'R'.repeat(7) + 'BB', 'R'.repeat(9) + 'BB'] },
  { name: 'Mesh', routes: ['RR' + 'I'.repeat(8), 'R'.repeat(12), 'RRRR' + 'I'.repeat(8)] },
  { name: 'Post-Corner', routes: ['R'.repeat(6) + 'N'.repeat(4), 'R'.repeat(6) + 'X'.repeat(4), 'R'.repeat(8) + 'N'.repeat(3)] },
];

const rand = n => Math.floor(Math.random() * n);
let clock = () => performance.now();
const silent = {
  wake() {}, hike() {}, whistle() {}, tackle() {}, touchdown() {}, crowd() {}, groan() {},
  throwBall() {}, catchBall() {}, muted: false,
};
let sfx = silent;
let S = null;
let cheat = false;
let playIndex = 0;

function grid(fill) {
  return Array.from({ length: COLS }, () => Array(LANES).fill(fill));
}

// ---------- rules ----------

function occupied(c, l) {
  if (S.cells[c][l]) return true;
  const r = S.runner;
  if (!S.tackled && r.col === c && r.lane === l) return true;
  return S.receivers.some(w => w.col === c && w.lane === l);
}

function newGame() {
  const ticks = S ? S.ticks : 0;
  S = {
    cells: grid(null), decor: grid(0),
    runner: { col: -1, lane: MID, face: 'right', step: 0 },
    receivers: [], ball: null, phase: 'pre', incomplete: false,
    camera: 0, scrimmage: 0, toGo: 10, down: 0, score: 0,
    playMs: 0, playStart: 0, freezeUntil: 0,
    tackled: false, tdPending: false, over: false,
    density: OPENING_DENSITY, slide: 0, ticks,
  };
  nextDown();
  S.density = BASE_DENSITY;
  const area = COLS * LANES;
  for (let i = 0; i < area * GRAVE_DENSITY; i++) {
    const c = 4 + rand(COLS - 5), l = rand(LANES);
    if (!occupied(c, l)) S.cells[c][l] = { kind: 'grave' };
  }
  for (let i = 0; i < area * DECOR_DENSITY; i++) S.decor[1 + rand(COLS - 2)][rand(LANES)] = 1 + rand(3);
}

function freeze(ms) {
  if (S.tackled) sfx.tackle();
  const now = clock();
  if (S.playStart > 0) S.playMs += now - S.playStart;
  S.freezeUntil = now + ms;
  S.playStart = 0;
}

function setRoutes() {
  S.receivers.forEach((w, i) => { w.route = PLAYS[playIndex].routes[i]; });
}

function nextDown() {
  const r = S.runner;
  const left = S.toGo - (r.col - S.scrimmage);
  S.tackled = false;
  S.freezeUntil = 0;
  S.ball = null;
  S.incomplete = false;
  if (S.over) return;

  if ((S.down === 4 && left > 0) || S.playMs > GAME_MS) {
    S.over = true;
    S.receivers = [];
    sfx.groan();
    if (S.tdPending) { S.tdPending = false; return; }
    freeze(0);
    return;
  }

  S.playStart = 0;
  S.phase = 'pre';
  r.face = 'right';
  r.step = 1;
  r.lane = MID;
  r.rx = undefined;
  if (r.col < 0 || S.tdPending) {
    r.col = 0; S.camera = 0; S.scrimmage = 0; S.toGo = 10;
    if (S.playMs > 0) S.density *= DIFFICULTY_STEP;
    S.tdPending = false;
    S.down = 1;
  } else {
    S.slide = CELL - 3;
    S.down++;
    S.toGo = left;
    if (S.toGo <= 0) { S.down = 1; S.toGo = 10; }
    S.scrimmage = r.col;
  }
  S.camera = Math.max(0, Math.min(COLS - VIEW, r.col - Math.floor(VIEW / 4)));

  for (const column of S.cells) {
    for (let l = 0; l < LANES; l++) {
      if (column[l] && column[l].kind !== 'grave') column[l] = null;
    }
  }

  const ahead = (COLS - r.col - 1) * LANES;
  const place = (count, make) => {
    for (let i = 0; i < count; i++) {
      const c = r.col + rand(COLS - r.col) + 1, l = rand(LANES);
      if (c > 0 && c < COLS - 1 && !S.cells[c][l]) S.cells[c][l] = make();
    }
  };
  place(Math.floor(ahead * S.density), () => ({ kind: 'ghoul', face: 'left', step: rand(2) }));
  place(Math.floor(ahead * SOUL_DENSITY), () => ({ kind: 'soul', step: rand(2) }));
  for (let l = r.lane - 1; l < r.lane + 2; l++) {
    if (!S.cells[r.col + 1][l]) S.cells[r.col + 1][l] = { kind: 'ghoul', face: 'left', step: 0 };
  }

  // formation: the quarterback in the middle lane, three receivers on the line
  S.cells[r.col][r.lane] = null;
  S.receivers = RECEIVER_LANES.map((lane, i) => {
    for (let c = r.col; c <= Math.min(COLS - 1, r.col + 2); c++) S.cells[c][lane] = null;
    return { col: r.col, lane, step: 0, key: THROW_KEYS[i], inDir: lane < MID ? 1 : -1, route: '' };
  });
  setRoutes();
}

function choosePlay(n) {
  if (S.phase !== 'pre' || S.over || n < 0 || n >= PLAYS.length) return;
  playIndex = n;
  setRoutes();
}

function snap() {
  if (S.over || S.freezeUntil > 0 || S.phase !== 'pre') return;
  S.phase = 'live';
  S.slide = 0;
  S.playStart = clock();
  sfx.hike();
}

function placePile(c1, l1, c2, l2) {
  S.cells[Math.min(c1, c2)][Math.min(l1, l2)] = { kind: 'pile', horiz: c1 !== c2 };
  S.tackled = true;
  freeze(TACKLE_PAUSE);
}

function touchdown() {
  S.score += 7;
  S.down = 1; S.toGo = 10;
  S.tdPending = true;
  S.receivers = [];
  freeze(TOUCHDOWN_PAUSE);
  sfx.touchdown();
}

function press(dir) {
  if (S.freezeUntil > 0) return;
  S.slide = 0;
  if (S.over) { newGame(); return; }
  if (S.phase === 'air') return;
  if (S.phase === 'pre') {
    // before the snap, up and down move through the playbook; only Space snaps
    if (dir === 'up') choosePlay((playIndex + PLAYS.length - 1) % PLAYS.length);
    if (dir === 'down') choosePlay((playIndex + 1) % PLAYS.length);
    return;
  }

  const r = S.runner;
  let c = r.col, l = r.lane, cam = S.camera;
  if (dir === 'up' && l > 0) l--;
  if (dir === 'down' && l < LANES - 1) l++;
  if (dir === 'left') {
    if (c > 0) {
      if (cam > 0 && c < COLS - Math.floor(VIEW * 3 / 4)) cam--;
      c--;
    }
    r.face = 'left'; r.step ^= 1;
  }
  if (dir === 'right') {
    if (c < COLS - 1) {
      if (c >= Math.floor(VIEW / 4) && cam < COLS - VIEW) cam++;
      c++;
    }
    r.face = 'right'; r.step ^= 1;
  }
  if (c === r.col && l === r.lane) return;

  const target = S.cells[c][l];
  if (!cheat && target && (target.kind === 'ghoul' || target.kind === 'rising')) {
    S.cells[c][l] = null;
    placePile(r.col, r.lane, c, l);
    return;
  }
  if (target && (target.kind === 'grave' || target.kind === 'pile')) return;
  if (S.receivers.some(w => w.col === c && w.lane === l)) return;

  r.col = c; r.lane = l; S.camera = cam;
  if (target && target.kind === 'soul') {
    S.cells[c][l] = { kind: 'grave' };
    S.score += 2;
    sfx.whistle();
  }
  if (r.col === COLS - 1) touchdown();
}

function routeMove(c, l, move, inDir) {
  let nc = c, nl = l;
  if (move === 'R') nc++;
  if (move === 'L') nc--;
  if (move === 'I') nl += inDir;
  if (move === 'O') nl -= inDir;
  if (move === 'N') { nc++; nl += inDir; }
  if (move === 'X') { nc++; nl -= inDir; }
  if (move === 'B') { nc--; nl += inDir; }
  if (nl < 0 || nl >= LANES) { nl = l; nc = c + 1; }   // at the sideline, keep running upfield
  if (nc < 0 || nc >= COLS) return null;
  return [nc, nl];
}

function routeStep() {
  if (S.phase !== 'live' && S.phase !== 'air') return;
  if (S.freezeUntil > 0) return;
  for (const w of S.receivers) {
    if (w.step >= w.route.length) continue;
    const next = routeMove(w.col, w.lane, w.route[w.step], w.inDir);
    if (!next) { w.step = w.route.length; continue; }
    if (!S.cells[next[0]][next[1]]) {   // teammates don't block each other's routes
      w.col = next[0]; w.lane = next[1];
      w.step++;
    }
  }
}

function throwTo(i) {
  const r = S.runner, w = S.receivers[i];
  if (S.phase !== 'live' || !w || S.freezeUntil > 0 || r.col > S.scrimmage) return;
  const dist = Math.hypot(w.col - r.col, w.lane - r.lane);
  S.ball = { target: i, fromCol: r.col, fromLane: r.lane, t0: clock(), dur: BALL_BASE_MS + BALL_PER_SQUARE_MS * dist };
  S.phase = 'air';
  sfx.throwBall();
}

function covered(c, l) {
  for (let dc = -1; dc <= 1; dc++) {
    for (let dl = -1; dl <= 1; dl++) {
      const cc = c + dc, ll = l + dl;
      if (cc < 0 || cc >= COLS || ll < 0 || ll >= LANES) continue;
      const e = S.cells[cc][ll];
      if (e && e.kind === 'ghoul') return true;
    }
  }
  return false;
}

function resolveBall() {
  if (S.phase !== 'air' || !S.ball || clock() < S.ball.t0 + S.ball.dur) return;
  const r = S.runner, w = S.receivers[S.ball.target];
  S.ball = null;

  if (covered(w.col, w.lane)) {
    S.phase = 'dead';
    S.incomplete = true;
    r.col = S.scrimmage;     // an incomplete pass gains nothing
    sfx.whistle();
    freeze(INCOMPLETE_PAUSE);
    return;
  }

  r.col = w.col; r.lane = w.lane;
  r.rx = w.rx; r.ry = w.ry;
  r.face = 'right'; r.step = 0;
  S.receivers = [];
  S.phase = 'run';
  S.camera = Math.max(0, Math.min(COLS - VIEW, r.col - Math.floor(VIEW / 4)));
  sfx.catchBall();
  if (r.col === COLS - 1) touchdown();
}

function chaseTarget() {
  if (S.phase === 'air' && S.ball) return S.receivers[S.ball.target];
  return S.runner;
}

function moveThing(e, c, l, t) {
  const r = S.runner;
  let nc = c, nl = l;
  if (!S.over && e.kind === 'ghoul' && rand(2) === 0) {
    if (c < t.col) { nc++; e.face = 'right'; }
    else if (c > t.col) { nc--; e.face = 'left'; }
    else if (l < t.lane) nl++;
    else nl--;
  } else {
    const roll = rand(4);
    if (roll === 0) nl--;
    if (roll === 1) nl++;
    if (roll === 2) { nc--; if (e.kind === 'ghoul') e.face = 'left'; }
    if (roll === 3) { nc++; if (e.kind === 'ghoul') e.face = 'right'; }
  }
  if (nc < 0 || nc >= COLS || nl < 0 || nl >= LANES) return;

  const carrierLive = S.phase === 'live' || S.phase === 'run';
  if (!S.over && !cheat && carrierLive && e.kind === 'ghoul' && nc === r.col && nl === r.lane) {
    S.cells[c][l] = null;
    placePile(c, l, nc, nl);
    return;
  }
  if (!occupied(nc, nl)) {
    S.cells[c][l] = null;
    S.cells[nc][nl] = e;
    if (e.face !== 'front') e.step ^= 1;
  }
}

function stepWorld() {
  const r = S.runner, t = chaseTarget();
  const moved = new Set();
  for (let c = S.camera; c < S.camera + VIEW; c++) {
    for (let l = 0; l < LANES; l++) {
      const e = S.cells[c][l];
      if (!e || moved.has(e)) continue;
      if (e.kind === 'ghoul' || e.kind === 'soul') {
        if ((c < t.col && rand(2) === 0) || rand(5) === 0) {
          moved.add(e);
          moveThing(e, c, l, t);
          if (S.tackled) return;
        }
      } else if (e.kind === 'rising') {
        e.depth -= RISE_STEP;
        if (e.depth <= 0) S.cells[c][l] = { kind: 'ghoul', face: 'front', step: 0 };
      }
    }
  }
  if (S.over) return;
  const c = r.col + rand(S.camera + VIEW - r.col), l = rand(LANES);
  if (rand(4) === 0 && c > 0 && c < COLS && !occupied(c, l) && c !== t.col && l !== t.lane) {
    S.cells[c][l] = { kind: 'rising', depth: RISE_START };
  }
}

function tick() {
  if (S.freezeUntil > 0) {
    if (clock() > S.freezeUntil) nextDown();
  } else if (S.slide > 0) {
    S.slide = Math.max(0, S.slide - SLIDE_STEP);
  } else if (S.over || S.playStart) {
    stepWorld();
  }
  if (rand(12) === 0) sfx.crowd();
  S.ticks++;
}

function timeLeft() {
  const live = S.playStart ? clock() - S.playStart : 0;
  return Math.max(0, GAME_MS - S.playMs - live);
}

// ---------- art ----------

const INK = {
  grassA: '#3d4b22', grassB: '#44532a', endZone: '#47203d', stripe: 'rgba(214, 150, 196, 0.16)',
  line: 'rgba(235, 235, 210, 0.22)', yardText: 'rgba(235, 235, 210, 0.28)',
  helmet: '#f0c13a', helmetShade: '#b78b17', mask: '#4a4a52', jersey: '#7a3bb5', jerseyShade: '#562587',
  pants: '#f1eee4', skin: '#e3ad80', cleat: '#1f1b22', ball: '#8d4b1f', lace: '#f4efe4',
  ghoul: '#8dbb57', ghoulShade: '#5f8c3a', rag: '#7f776b', ragShade: '#5a534b', eye: '#ff4a36',
  stone: '#b0b5ba', stoneShade: '#6f757b', carve: '#5b6167', dirt: '#4f3a26', dirtLight: '#6a4f35',
  soul: '#e4f2ff', soulEdge: '#9fc6f0', shadow: 'rgba(0, 0, 0, 0.28)', route: 'rgba(255, 232, 160, 0.55)',
};
const FIG = 0.7;      // characters fill about two-thirds of a square
const FEET = 34;      // feet sit this far below the top of their square
let ctx = null, focused = true, lastFrame = 0;
const view = {};

function follow(obj, tx, ty, dt, jump = CELL * 1.5) {
  if (obj.rx === undefined || Math.abs(obj.rx - tx) > jump || Math.abs(obj.ry - ty) > jump) {
    obj.rx = tx; obj.ry = ty;
  }
  const k = 1 - Math.exp(-dt * 20);
  obj.rx += (tx - obj.rx) * k;
  obj.ry += (ty - obj.ry) * k;
  return Math.abs(tx - obj.rx) + Math.abs(ty - obj.ry) > 0.6;
}

function shadow(x, y, w) {
  ctx.fillStyle = INK.shadow;
  ctx.beginPath();
  ctx.ellipse(x, y + 1, w, w * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
}

function limb(x1, y1, x2, y2, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawFootball(x, y, angle, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.fillStyle = INK.ball;
  ctx.beginPath();
  ctx.ellipse(0, 0, 5, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  limb(-2, 0, 2, 0, 0.9, INK.lace);
  ctx.restore();
}

function drawRunner(x, y, face, phase, hasBall = true) {
  shadow(x, y, 9);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(face === 'left' ? -FIG : FIG, FIG);
  const swing = Math.sin(phase);

  for (const [hip, s] of [[-3, swing], [3, -swing]]) {
    limb(hip, -14, hip + s * 7, -1, 5, INK.pants);
    ctx.fillStyle = INK.cleat;
    ctx.beginPath();
    ctx.ellipse(hip + s * 7 + 1.5, 0, 3.6, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  limb(-3, -24, -9 - swing * 3, -16, 4.5, INK.jerseyShade);

  ctx.fillStyle = INK.jersey;
  ctx.beginPath();
  ctx.roundRect(-7, -28, 14, 16, 4);
  ctx.fill();
  ctx.fillStyle = INK.jerseyShade;
  ctx.beginPath();
  ctx.ellipse(0, -26.5, 9.5, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK.pants;
  ctx.fillRect(-7, -20, 14, 2.2);

  if (hasBall) {
    limb(2, -24, 6, -19, 4.5, INK.jersey);
    ctx.restore();
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(face === 'left' ? -FIG : FIG, FIG);
    drawFootball(7, -19, -0.45);
  } else {
    limb(2, -24, 8 + swing * 3, -17, 4.5, INK.jersey);
  }

  ctx.fillStyle = INK.skin;
  ctx.beginPath();
  ctx.arc(4, -31.5, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK.helmet;
  ctx.beginPath();
  ctx.arc(0, -33, 7.5, Math.PI * 0.62, Math.PI * 2.12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = INK.helmetShade;
  ctx.beginPath();
  ctx.arc(0, -33, 7.5, Math.PI * 0.62, Math.PI * 1.05);
  ctx.lineTo(-1, -33);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK.mask;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(5.5, -35);
  ctx.quadraticCurveTo(9.5, -32, 6, -28);
  ctx.moveTo(4.5, -31.5);
  ctx.lineTo(8.6, -31.5);
  ctx.stroke();
  ctx.restore();
}

function drawGhoul(x, y, face, phase) {
  shadow(x, y, 9);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(face === 'left' ? -FIG : FIG, FIG);
  const shuffle = Math.sin(phase);
  const front = face === 'front';

  for (const [hip, s] of [[-3, shuffle], [3, -shuffle]]) {
    limb(hip, -14, hip + s * 3.5, -1.5, 4.5, INK.ragShade);
    ctx.fillStyle = INK.ghoulShade;
    ctx.beginPath();
    ctx.ellipse(hip + s * 3.5 + (front ? 0 : 1.5), 0, 3.4, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (front) {
    limb(-6, -24, -14, -19 + shuffle * 1.5, 4, INK.ghoul);
    limb(6, -24, 14, -19 - shuffle * 1.5, 4, INK.ghoul);
  } else {
    limb(1, -23, 13, -21 + shuffle, 4, INK.ghoulShade);
  }

  ctx.fillStyle = INK.rag;
  ctx.beginPath();
  ctx.moveTo(-7, -27);
  ctx.lineTo(7, -27);
  ctx.lineTo(7.5, -14);
  for (let i = 0; i <= 5; i++) ctx.lineTo(7.5 - i * 3, i % 2 ? -11.5 : -14.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = INK.ragShade;
  ctx.fillRect(-2, -24, 3, 3);

  if (!front) limb(3, -24, 15, -23 - shuffle, 4, INK.ghoul);

  ctx.save();
  ctx.translate(front ? 0 : 1, -32);
  ctx.rotate(front ? 0 : 0.12);
  ctx.fillStyle = INK.ghoul;
  ctx.beginPath();
  ctx.ellipse(0, 0, 7, 7.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK.ghoulShade;
  ctx.beginPath();
  ctx.ellipse(-2.5, 1, 4, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = INK.eye;
  ctx.shadowBlur = 5;
  ctx.fillStyle = INK.eye;
  for (const ex of front ? [-2.6, 2.6] : [1, 4.6]) {
    ctx.beginPath();
    ctx.arc(ex, -1.5, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#2b2a22';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const mx = front ? -2.5 : 0.5;
  ctx.moveTo(mx, 3.5);
  for (let i = 1; i <= 4; i++) ctx.lineTo(mx + i * 1.4, i % 2 ? 2.6 : 3.6);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

function drawSoul(x, y, t) {
  const bob = Math.sin(t * 3) * 2;
  shadow(x, y, 7);
  ctx.save();
  ctx.translate(x, y - 4 + bob);
  ctx.scale(FIG, FIG);
  ctx.shadowColor = INK.soulEdge;
  ctx.shadowBlur = 10;
  const g = ctx.createLinearGradient(0, -34, 0, -6);
  g.addColorStop(0, INK.soul);
  g.addColorStop(1, 'rgba(200, 225, 255, 0.75)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, -24, 9, Math.PI, 0);
  ctx.lineTo(9, -8);
  for (let i = 1; i <= 6; i++) {
    const wx = 9 - i * 3;
    ctx.quadraticCurveTo(wx + 1.5, -8 + (i % 2 ? 4 : -2) + Math.sin(t * 6 + i) * 1.2, wx, -8);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#2f3a4a';
  for (const ex of [-3.2, 3.2]) {
    ctx.beginPath();
    ctx.ellipse(ex, -24, 1.6, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(0, -18.5, 2, 1.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGrave(x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(FIG, FIG);
  ctx.fillStyle = INK.dirt;
  ctx.beginPath();
  ctx.ellipse(0, 0.5, 14, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createLinearGradient(-10, 0, 10, 0);
  g.addColorStop(0, INK.stone);
  g.addColorStop(1, INK.stoneShade);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-10, 0);
  ctx.lineTo(-10, -22);
  ctx.arc(0, -22, 10, Math.PI, 0);
  ctx.lineTo(10, 0);
  ctx.closePath();
  ctx.fill();
  limb(0, -28, 0, -11, 2.2, INK.carve);
  limb(-4.5, -23, 4.5, -23, 2.2, INK.carve);
  ctx.restore();
}

function drawMound(x, y, w) {
  ctx.fillStyle = INK.dirt;
  ctx.beginPath();
  ctx.ellipse(x, y, w, 4, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = INK.dirtLight;
  for (const dx of [-w * 0.5, w * 0.1, w * 0.55]) {
    ctx.beginPath();
    ctx.arc(x + dx, y - 2, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDecor(kind, x, y) {
  if (kind === 1) {
    ctx.strokeStyle = 'rgba(120, 150, 60, 0.6)';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    for (const [dx, h, lean] of [[-4, 7, -2], [0, 9, 0.5], [4, 6, 2.5]]) {
      ctx.beginPath();
      ctx.moveTo(x + dx, y);
      ctx.quadraticCurveTo(x + dx, y - h * 0.6, x + dx + lean, y - h);
      ctx.stroke();
    }
  } else if (kind === 2) {
    limb(x - 6, y - 4, x + 6, y - 6, 1.8, 'rgba(225, 218, 200, 0.55)');
    ctx.fillStyle = 'rgba(225, 218, 200, 0.55)';
    for (const [bx, by] of [[x - 6.5, y - 4], [x + 6.5, y - 6]]) {
      ctx.beginPath();
      ctx.arc(bx, by - 1, 1.5, 0, Math.PI * 2);
      ctx.arc(bx, by + 1, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 3) {
    ctx.fillStyle = 'rgba(110, 104, 84, 0.6)';
    for (const [dx, dy, rad] of [[-7, -2, 2.2], [3, -9, 1.6], [8, -1, 2.6]]) {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function star(x, y, r, spin) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const rad = i % 2 ? r * 0.38 : r;
    const a = (i / 8) * Math.PI * 2;
    ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPile(e, x, y, t) {
  const cx = x + (e.horiz ? CELL : CELL / 2);
  const cy = y + (e.horiz ? FEET : CELL + FEET - CELL / 2);
  ctx.fillStyle = 'rgba(196, 170, 120, 0.28)';
  for (const [dx, dy, rad] of [[-11, -8, 11], [9, -6, 12], [0, -16, 10]]) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  drawGhoul(cx - 7, cy, 'right', 0);
  drawRunner(cx + 6, cy + 1, 'left', 1);
  ctx.fillStyle = '#ffe35a';
  for (const [dx, dy, i] of [[-12, -30, 0], [2, -34, 1], [14, -28, 2]]) {
    star(cx + dx, cy + dy + Math.sin(t * 8 + i) * 1.5, 4, t * 3 + i);
  }
}

function keyBubble(x, y, letter, active) {
  ctx.fillStyle = active ? 'rgba(24, 14, 28, 0.9)' : 'rgba(24, 14, 28, 0.55)';
  ctx.strokeStyle = active ? '#f0c13a' : 'rgba(200, 190, 210, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = '600 10px Inter, sans-serif';
  ctx.fillStyle = active ? '#f7e6b0' : 'rgba(220, 210, 230, 0.5)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, x, y + 0.5);
}

function drawRoute(w, cam) {
  const pts = [[w.col, w.lane]];
  let c = w.col, l = w.lane;
  for (const move of w.route) {
    const next = routeMove(c, l, move, w.inDir);
    if (!next) break;
    [c, l] = next;
    pts.push(next);
  }
  const px = p => [p[0] * CELL + CELL / 2 - cam, p[1] * CELL + FEET - 12];
  ctx.save();
  ctx.strokeStyle = INK.route;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  pts.forEach((p, i) => { const [x, y] = px(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.stroke();
  ctx.setLineDash([]);
  if (pts.length > 1) {
    const [x1, y1] = px(pts[pts.length - 2]), [x2, y2] = px(pts[pts.length - 1]);
    const a = Math.atan2(y2 - y1, x2 - x1);
    ctx.fillStyle = INK.route;
    ctx.beginPath();
    ctx.moveTo(x2 + Math.cos(a) * 6, y2 + Math.sin(a) * 6);
    ctx.lineTo(x2 + Math.cos(a + 2.4) * 7, y2 + Math.sin(a + 2.4) * 7);
    ctx.lineTo(x2 + Math.cos(a - 2.4) * 7, y2 + Math.sin(a - 2.4) * 7);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawBallFlight(cam, now) {
  const b = S.ball, w = S.receivers[b.target];
  const p = Math.min(1, Math.max(0, (now - b.t0) / b.dur));
  const x0 = b.fromCol * CELL + CELL / 2, y0 = b.fromLane * CELL + FEET - 14;
  const x1 = (w.rx ?? w.col * CELL + CELL / 2), y1 = (w.ry ?? w.lane * CELL + FEET) - 14;
  const x = x0 + (x1 - x0) * p, y = y0 + (y1 - y0) * p;
  const lift = Math.sin(Math.PI * p) * Math.min(60, 14 + Math.hypot(x1 - x0, y1 - y0) * 0.25);
  shadow(x - cam, y + 14, 4);
  drawFootball(x - cam, y - lift, Math.atan2(y1 - y0, x1 - x0) + now / 60, 1.1);
}

function drawPlaybook() {
  const w = 168, rowH = 18, h = 34 + PLAYS.length * rowH;
  const x = FIELD_W - w - 10, y = 10;
  ctx.fillStyle = 'rgba(16, 10, 20, 0.82)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill();
  ctx.font = '600 10px Inter, sans-serif';
  ctx.fillStyle = '#8f7f99';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('PLAYBOOK', x + 14, y + 16);
  PLAYS.forEach((play, i) => {
    const ry = y + 34 + i * rowH;
    const on = i === playIndex;
    if (on) {
      ctx.fillStyle = 'rgba(240, 193, 58, 0.14)';
      ctx.fillRect(x + 6, ry - rowH / 2, w - 12, rowH);
    }
    ctx.font = on ? '600 13px Inter, sans-serif' : '400 13px Inter, sans-serif';
    ctx.fillStyle = on ? '#f0c13a' : '#cbbfd3';
    ctx.fillText(`${i + 1}   ${play.name}`, x + 14, ry);
  });
}

function drawField(dt, now) {
  const r = S.runner, t = now / 1000;
  follow(view, S.camera * CELL, 0, dt, Infinity);
  const cam = view.rx;
  const first = Math.max(0, Math.floor(cam / CELL));
  const last = Math.min(COLS - 1, first + VIEW);
  const sx = c => c * CELL - cam;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, FIELD_W, FIELD_H);
  ctx.clip();

  for (let c = first; c <= last; c++) {
    const x = sx(c);
    const endZone = c === 0 || c === COLS - 1;
    ctx.fillStyle = endZone ? INK.endZone : (Math.floor(c / 5) % 2 ? INK.grassA : INK.grassB);
    ctx.fillRect(x - 0.5, 0, CELL + 1, FIELD_H);
    if (endZone) {
      ctx.save();
      ctx.beginPath(); ctx.rect(x, 0, CELL, FIELD_H); ctx.clip();
      ctx.strokeStyle = INK.stripe;
      ctx.lineWidth = 7;
      for (let y = -CELL; y < FIELD_H + CELL; y += 22) {
        ctx.beginPath(); ctx.moveTo(x, y + CELL); ctx.lineTo(x + CELL, y); ctx.stroke();
      }
      ctx.restore();
    }
    if (c % 5 === 0 && c > 0) {
      ctx.fillStyle = INK.line;
      ctx.fillRect(x - 0.75, 0, 1.5, FIELD_H);
      ctx.font = '600 11px Oswald, sans-serif';
      ctx.fillStyle = INK.yardText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(c), x, 9);
      ctx.fillText(String(c), x, FIELD_H - 9);
    }
    for (let l = 0; l < LANES; l++) {
      if (S.decor[c][l]) drawDecor(S.decor[c][l], x + CELL / 2, l * CELL + FEET);
    }
  }

  const shade = ctx.createLinearGradient(0, 0, 0, FIELD_H);
  shade.addColorStop(0, 'rgba(255, 255, 255, 0.04)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 0.18)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);

  if (S.scrimmage > 0) {
    ctx.fillStyle = 'rgba(120, 170, 255, 0.5)';
    ctx.fillRect(sx(S.scrimmage) + CELL - 1, 0, 2, FIELD_H);
  }
  const goalLine = S.scrimmage + S.toGo;
  if (goalLine < COLS - 1) {
    const fx = sx(goalLine);
    ctx.fillStyle = 'rgba(255, 214, 64, 0.75)';
    ctx.fillRect(fx - 1, 0, 2, FIELD_H);
    ctx.fillStyle = '#ff8c1a';
    ctx.beginPath();
    ctx.moveTo(fx + 1, 17); ctx.lineTo(fx + 12, 21); ctx.lineTo(fx + 1, 25);
    ctx.closePath();
    ctx.fill();
  }

  if (S.phase === 'pre' && !S.over) for (const w of S.receivers) drawRoute(w, cam);

  // draw lane by lane so figures lower on the field overlap the ones above
  const canThrow = S.phase === 'live' && r.col <= S.scrimmage;
  for (let l = 0; l < LANES; l++) {
    for (let c = Math.max(0, first - 1); c <= Math.min(COLS - 1, last + 1); c++) {
      const e = S.cells[c][l];
      if (!e) continue;
      const moving = follow(e, c * CELL + CELL / 2, l * CELL + FEET, dt);
      const x = e.rx - cam, y = e.ry;
      if (e.kind === 'grave') drawGrave(x, y);
      if (e.kind === 'soul') drawSoul(x, y, t + c);
      if (e.kind === 'ghoul') drawGhoul(x, y, e.face, moving ? t * 14 : t * 3 + c * 1.7 + l);
      if (e.kind === 'rising') {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x - CELL / 2, l * CELL, CELL, FEET + 1);
        ctx.clip();
        drawGhoul(x, y + e.depth * 0.8, 'front', t * 6);
        ctx.restore();
        drawMound(x, y + 1, 13);
      }
      if (e.kind === 'pile') drawPile(e, sx(c), l * CELL, t);
    }
    for (const w of S.receivers) {
      if (w.lane !== l) continue;
      const moving = follow(w, w.col * CELL + CELL / 2, l * CELL + FEET, dt);
      drawRunner(w.rx - cam, w.ry, 'right', moving ? t * 22 : 0.4, false);
      const target = S.ball && S.receivers[S.ball.target] === w;
      keyBubble(w.rx - cam, w.ry - 36, w.key, canThrow || S.phase === 'pre' || target);
    }
    if (!S.tackled && r.col >= 0 && r.lane === l) {
      const moving = follow(r, r.col * CELL + CELL / 2, l * CELL + FEET, dt);
      const holding = S.phase !== 'air' && !S.incomplete;
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.rx - cam - CELL / 2, l * CELL - 4, CELL, FEET + 6);
      ctx.clip();
      drawRunner(r.rx - cam, r.ry + S.slide * 0.8, r.face, moving ? t * 22 : 0.4, holding);
      ctx.restore();
    }
  }

  if (S.ball) drawBallFlight(cam, now);
  if (S.phase === 'pre' && !S.over && !S.freezeUntil) drawPlaybook();
  ctx.restore();
}

function banner(text, size, color) {
  ctx.font = `${size}px Creepster, fantasy`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(18, 10, 20, 0.9)';
  ctx.strokeText(text, FIELD_W / 2, FIELD_H / 2 - 12);
  ctx.fillStyle = color;
  ctx.fillText(text, FIELD_W / 2, FIELD_H / 2 - 12);
}

function prompt(text) {
  ctx.font = '500 14px Inter, sans-serif';
  const w = ctx.measureText(text).width + 36;
  ctx.fillStyle = 'rgba(14, 9, 18, 0.88)';
  ctx.beginPath();
  ctx.roundRect(FIELD_W / 2 - w / 2, FIELD_H / 2 + 24, w, 34, 17);
  ctx.fill();
  ctx.fillStyle = '#ece6d2';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, FIELD_W / 2, FIELD_H / 2 + 41);
}

function hint() {
  if (S.over) return 'Press any key for a new game';
  if (S.phase === 'pre') return '↑ ↓ pick a play · Space to snap';
  if (S.phase === 'live') {
    return S.runner.col > S.scrimmage ? 'Past the line of scrimmage, so run it' : 'A S D to throw · arrows to scramble';
  }
  if (S.phase === 'air') return 'Ball in the air';
  return 'Arrow keys or I J K L to run · M to mute';
}

function drawHud() {
  const top = FIELD_H;
  ctx.fillStyle = '#1a1220';
  ctx.fillRect(0, top, FIELD_W, HUD_H);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.fillRect(0, top, FIELD_W, 1);

  const stat = (label, value, x, color) => {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '600 10px Inter, sans-serif';
    ctx.fillStyle = '#8f7f99';
    ctx.fillText(label, x, top + 34);
    ctx.font = '500 30px Oswald, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(value, x, top + 68);
  };

  const secs = Math.ceil(timeLeft() / 1000);
  stat('TIME', String(secs).padStart(2, '0'), 24, secs <= 10 ? '#ff6b4a' : '#a6e36a');
  stat('SCORE', String(S.score).padStart(3, '0'), 90, '#a6e36a');

  const mid = FIELD_W / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '28px Creepster, fantasy';
  ctx.fillStyle = '#93d356';
  ctx.fillText('Graveyard Gridiron', mid, top + 38);
  ctx.font = '500 15px Oswald, sans-serif';
  ctx.fillStyle = '#f0c13a';
  ctx.fillText(`PLAY ${playIndex + 1} · ${PLAYS[playIndex].name.toUpperCase()}`, mid, top + 64);
  ctx.font = '400 12px Inter, sans-serif';
  ctx.fillStyle = '#8a7a94';
  ctx.fillText(hint(), mid, top + 86);

  const ord = ['1st', '2nd', '3rd', '4th'][Math.min(4, Math.max(1, S.down)) - 1];
  const goal = S.scrimmage + S.toGo >= COLS - 1;
  stat('DOWN', ord, FIELD_W - 140, '#f0c13a');
  stat('TO GO', goal ? 'GL' : String(S.toGo).padStart(2, '0'), FIELD_W - 74, '#f0c13a');
  if (cheat) {
    ctx.font = '600 10px Inter, sans-serif';
    ctx.fillStyle = '#9fc6f0';
    ctx.textAlign = 'left';
    ctx.fillText('GHOST MODE', FIELD_W - 140, top + 88);
  }
}

function draw() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - (lastFrame || now)) / 1000);
  lastFrame = now;
  ctx.clearRect(0, 0, FIELD_W, FIELD_H + HUD_H);
  drawField(dt, now);
  if (S.tdPending && S.ticks % 3) banner('TOUCHDOWN!', 64, '#ffd84a');
  if (S.incomplete) banner('INCOMPLETE', 52, '#e8e2c8');
  if (S.over) {
    if (S.ticks % 5) banner('GAME OVER', 60, '#ff5b3a');
    prompt('Press any key for a new game');
  } else if (!focused) {
    prompt('Click here to play');
  }
  drawHud();
}

// ---------- sound ----------

function makeAudio() {
  let ac = null, noiseBuf = null;
  const a = { muted: false };
  a.wake = () => {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
  };
  const ready = () => ac && !a.muted && ac.state === 'running';

  function tone(f0, f1, start, dur, type, vol) {
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + start;
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(start, dur, vol, freq, q, attack) {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    const t = ac.currentTime + start;
    s.buffer = noiseBuf; s.loop = true;
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(ac.destination);
    s.start(t); s.stop(t + dur + 0.05);
  }

  a.hike = () => {
    if (!ready()) return;
    tone(180, 150, 0, 0.09, 'square', 0.12);
    tone(180, 150, 0.14, 0.09, 'square', 0.12);
  };
  a.whistle = () => {
    if (!ready()) return;
    const o = ac.createOscillator(), lfo = ac.createOscillator(), depth = ac.createGain(), g = ac.createGain();
    const t = ac.currentTime;
    o.frequency.value = 2600;
    lfo.frequency.value = 28;
    depth.gain.value = 120;
    lfo.connect(depth).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
    g.gain.setValueAtTime(0.08, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g).connect(ac.destination);
    o.start(t); lfo.start(t); o.stop(t + 0.45); lfo.stop(t + 0.45);
  };
  a.tackle = () => {
    if (!ready()) return;
    tone(140, 40, 0, 0.25, 'sine', 0.35);
    noise(0, 0.25, 0.25, 600, 0.8, 0.005);
  };
  a.touchdown = () => {
    if (!ready()) return;
    [392, 494, 587, 784].forEach((f, i) => tone(f, 0, i * 0.12, 0.22, 'square', 0.1));
    noise(0.1, 2.2, 0.12, 900, 0.6, 0.5);
  };
  a.throwBall = () => { if (ready()) noise(0, 0.3, 0.07, 1800, 1.4, 0.04); };
  a.catchBall = () => { if (ready()) tone(520, 780, 0, 0.12, 'triangle', 0.15); };
  a.crowd = () => { if (ready()) noise(0, 1.6, 0.04, 700, 0.5, 0.5); };
  a.groan = () => { if (ready()) tone(220, 70, 0, 1.1, 'sawtooth', 0.12); };
  return a;
}

// ---------- browser wiring ----------

const KEYS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  i: 'up', k: 'down', j: 'left', l: 'right',
};

function boot() {
  const canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');

  // match the canvas to the screen's real pixels so nothing gets stretched
  const fit = () => {
    const width = canvas.getBoundingClientRect().width || FIELD_W;
    const k = (width / FIELD_W) * (window.devicePixelRatio || 1);
    canvas.width = Math.round(FIELD_W * k);
    canvas.height = Math.round((FIELD_H + HUD_H) * k);
    ctx.setTransform(k, 0, 0, k, 0, 0);
  };
  canvas.width = FIELD_W;
  canvas.height = FIELD_H + HUD_H;
  fit();
  window.addEventListener('resize', fit);

  sfx = makeAudio();
  newGame();

  const act = action => {
    sfx.wake();
    focused = true;
    if (S.over && S.freezeUntil === 0) { newGame(); return; }
    if (action === 'snap') snap();
    else if (action === 'play') choosePlay((playIndex + 1) % PLAYS.length);
    else if (action.startsWith('throw')) throwTo(Number(action.slice(5)));
    else press(action);
  };

  window.addEventListener('keydown', e => {
    sfx.wake();
    focused = true;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === '^') { cheat = !cheat; return; }
    if (key === 'm') { sfx.muted = !sfx.muted; return; }
    if (S.over) {
      if (S.freezeUntil === 0) newGame();
      e.preventDefault();
      return;
    }
    if (KEYS[key]) { e.preventDefault(); press(KEYS[key]); return; }
    if (key === ' ') { e.preventDefault(); snap(); return; }
    const thrown = THROW_KEYS.indexOf(key.toUpperCase());
    if (thrown >= 0) { throwTo(thrown); return; }
    if (/^[1-6]$/.test(key)) choosePlay(Number(key) - 1);
  });
  window.addEventListener('blur', () => { focused = false; });
  window.addEventListener('focus', () => { focused = true; });
  canvas.addEventListener('pointerdown', () => {
    sfx.wake();
    focused = true;
    if (S.over && S.freezeUntil === 0) newGame();
  });
  document.querySelectorAll('[data-act]').forEach(button => {
    button.addEventListener('pointerdown', e => {
      e.preventDefault();
      act(button.dataset.act);
    });
  });

  setInterval(tick, TICK_MS);
  setInterval(routeStep, ROUTE_MS);
  setInterval(resolveBall, 20);
  const frame = () => { draw(); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') boot();
if (typeof module !== 'undefined') {
  module.exports = {
    newGame, press, snap, throwTo, choosePlay, routeStep, resolveBall, tick, timeLeft, nextDown,
    state: () => S,
    setClock: fn => { clock = fn; },
    setCheat: on => { cheat = on; },
    PLAYS, COLS, LANES, VIEW, MID, GAME_MS, RECEIVER_LANES,
  };
}
