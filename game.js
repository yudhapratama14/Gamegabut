/* =============================================
   PEENES Z — GAME ENGINE
   Zuma-style marble shooter, Gen Z edition
   ============================================= */

'use strict';

// ── CONSTANTS ──────────────────────────────────
const BALL_RADIUS = 18;
const SHOOTER_RADIUS = 26;
const COLORS = [
  { id: 0, fill: '#b55fff', glow: '#b55fff', name: 'purple' },
  { id: 1, fill: '#0ff',    glow: '#0ff',    name: 'cyan'   },
  { id: 2, fill: '#f55aaa', glow: '#f55aaa', name: 'pink'   },
  { id: 3, fill: '#ffe066', glow: '#ffe066', name: 'yellow' },
  { id: 4, fill: '#5ffa68', glow: '#5ffa68', name: 'lime'   },
  { id: 5, fill: '#ff7043', glow: '#ff7043', name: 'orange' },
];

const MESSAGES_COMBO = [
  'AYOOO 🔥', 'GILA NIH 💀', 'NO CAP 🧢', 'SLAY! 💅',
  'BESTIE! ✨', 'FRFR 💯', 'EZ CLAP 🫰', 'UNREAL 🤯',
  'W BANGET 🏆', 'BUSETT 😤'
];
const MESSAGES_GAMEOVER = [
  'better luck next time 💅',
  'skill issue bestie 😭',
  'try again lah cmon',
  'almost! jangan nyerah',
  'touch grass dulu? 🌿',
];

// ── UTILS ──────────────────────────────────────
const $ = id => document.getElementById(id);
const rand = (a, b) => Math.random() * (b - a) + a;
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const lerp = (a, b, t) => a + (b - a) * t;

// ── PATH BUILDER ───────────────────────────────
function buildPath(W, H) {
  // S-curve snake path from top-right to center
  const path = [];
  const steps = 300;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    // Parametric snake
    const x = W * 0.1 + (W * 0.8) * t;
    const y = (H * 0.25) + Math.sin(t * Math.PI * 2.5) * (H * 0.22);
    path.push({ x, y });
  }
  return path;
}

// ── GAME STATE ─────────────────────────────────
class Game {
  constructor() {
    this.canvas = $('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.nextCanvas = $('next-canvas');
    this.nextCtx = this.nextCanvas.getContext('2d');

    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.canvas.addEventListener('mousemove', e => this.onMouseMove(e));
    this.canvas.addEventListener('click', e => this.onShoot(e));
    this.canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      this.onMouseMove(e.touches[0]);
    }, { passive: false });
    this.canvas.addEventListener('touchend', e => {
      e.preventDefault();
      this.onShoot(e.changedTouches[0]);
    });

    $('btn-pause').addEventListener('click', () => this.pause());
    $('btn-resume').addEventListener('click', () => this.resume());
    $('btn-quit').addEventListener('click', () => { this.stop(); showScreen('menu'); });
    $('btn-retry').addEventListener('click', () => this.start());
    $('btn-menu').addEventListener('click', () => { this.stop(); showScreen('menu'); });

    this.raf = null;
    this.state = 'idle';
  }

  resize() {
    const W = window.innerWidth;
    const H = window.innerHeight - 60;
    this.canvas.width = W;
    this.canvas.height = H;
    this.W = W; this.H = H;
    this.shooterX = W / 2;
    this.shooterY = H - 60;
    this.path = buildPath(W, H);
  }

  start() {
    this.stop();
    showScreen('game');

    this.score = 0;
    this.level = 1;
    this.combo = 1;
    this.comboTimer = 0;
    this.highScore = parseInt(localStorage.getItem('pz_hs') || '0');

    this.chain = [];      // marbles on the path
    this.projectiles = []; // flying balls
    this.pathPos = 0;     // lead marble path index
    this.speed = 0.25;    // path steps per frame
    this.paused = false;
    this.gameOver = false;

    this.angle = -Math.PI / 2;
    this.currentColor = this.randColor();
    this.nextColor = this.randColor();

    this.spawnChain(10 + this.level * 2);
    this.updateHUD();
    this.state = 'playing';
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(ts => this.loop(ts));
  }

  stop() {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
    this.state = 'idle';
  }

  pause() {
    if (this.state !== 'playing') return;
    this.paused = true;
    this.state = 'paused';
    showScreen('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.paused = false;
    this.state = 'playing';
    hideScreen('pause');
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(ts => this.loop(ts));
  }

  loop(ts) {
    if (this.state !== 'playing') return;
    const dt = Math.min(ts - this.lastTime, 50);
    this.lastTime = ts;
    this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(t => this.loop(t));
  }

  // ── UPDATE ────────────────────────────────────
  update(dt) {
    // Advance combo timer
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) { this.combo = 1; this.updateHUD(); }
    }

    // Move chain along path
    this.pathPos += this.speed;
    this.syncChain();

    // Check if chain reached end of path → game over
    if (this.chain.length > 0) {
      const tail = this.chain[this.chain.length - 1];
      if (tail.pathIdx <= 0) {
        this.triggerGameOver();
        return;
      }
    }

    // Move projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.x += p.vx * dt * 0.06;
      p.y += p.vy * dt * 0.06;

      // Boundary check
      if (p.x < 0 || p.x > this.W || p.y < 0 || p.y > this.H + 60) {
        this.projectiles.splice(i, 1);
        continue;
      }

      // Collision with chain
      let hit = false;
      for (let j = 0; j < this.chain.length; j++) {
        const m = this.chain[j];
        const dx = p.x - m.x, dy = p.y - m.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < BALL_RADIUS * 2 - 2) {
          // Insert into chain near j
          this.insertBall(j, p.colorId);
          this.projectiles.splice(i, 1);
          this.checkMatches(j);
          hit = true;
          break;
        }
      }
      if (hit) continue;
    }

    // If chain is empty → level up
    if (this.chain.length === 0 && this.projectiles.length === 0) {
      this.levelUp();
    }

    // Gradually speed up
    this.speed = 0.25 + (this.level - 1) * 0.04 + this.pathPos * 0.00005;
  }

  // ── CHAIN MANAGEMENT ─────────────────────────
  spawnChain(count) {
    const numColors = Math.min(2 + this.level, COLORS.length);
    const colorPool = COLORS.slice(0, numColors).map(c => c.id);
    this.chain = [];
    // Start at the far right (beginning of path)
    const startIdx = this.path.length - 1;
    for (let i = 0; i < count; i++) {
      const idx = startIdx - i * (BALL_RADIUS * 2.1 / 1);
      const clamped = Math.max(0, Math.floor(idx));
      const colorId = colorPool[Math.floor(Math.random() * colorPool.length)];
      const pt = this.path[clamped] || this.path[0];
      this.chain.push({ pathIdx: clamped, colorId, x: pt.x, y: pt.y });
    }
    this.pathPos = this.path.length - 1;
  }

  syncChain() {
    if (this.chain.length === 0) return;
    // Lead ball follows pathPos
    const lead = this.chain[0];
    lead.pathIdx = Math.max(0, Math.floor(this.pathPos));
    const pt = this.path[lead.pathIdx] || this.path[0];
    lead.x = pt.x; lead.y = pt.y;

    // Following balls pack tightly behind
    const spacing = BALL_RADIUS * 2.15;
    for (let i = 1; i < this.chain.length; i++) {
      const prev = this.chain[i - 1];
      // Walk backwards along path until spacing is reached
      let idx = prev.pathIdx;
      let dist = 0;
      while (idx > 0 && dist < spacing) {
        const a = this.path[idx], b = this.path[idx - 1];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        dist += d;
        idx--;
      }
      this.chain[i].pathIdx = Math.max(0, idx);
      const p2 = this.path[this.chain[i].pathIdx] || this.path[0];
      this.chain[i].x = p2.x;
      this.chain[i].y = p2.y;
    }
  }

  insertBall(nearIdx, colorId) {
    // Insert after nearIdx
    const insertAt = Math.min(nearIdx + 1, this.chain.length);
    const refIdx = this.chain[nearIdx] ? this.chain[nearIdx].pathIdx : Math.floor(this.pathPos);
    const pt = this.path[refIdx] || this.path[0];
    this.chain.splice(insertAt, 0, { pathIdx: refIdx, colorId, x: pt.x, y: pt.y });
  }

  checkMatches(insertedIdx) {
    let start = insertedIdx;
    let end = insertedIdx;
    const colorId = this.chain[insertedIdx]?.colorId;
    if (colorId === undefined) return;

    // Expand left
    while (start > 0 && this.chain[start - 1].colorId === colorId) start--;
    // Expand right
    while (end < this.chain.length - 1 && this.chain[end + 1].colorId === colorId) end++;

    const count = end - start + 1;
    if (count >= 3) {
      // Get position for popup
      const midIdx = Math.floor((start + end) / 2);
      const mx = this.chain[midIdx]?.x ?? this.W / 2;
      const my = this.chain[midIdx]?.y ?? this.H / 2;

      // Remove matched balls
      this.chain.splice(start, count);

      // Score
      const pts = count * 50 * this.combo;
      this.score += pts;
      this.combo = Math.min(this.combo + 1, 10);
      this.comboTimer = 3000;
      this.updateHUD();
      this.showPopup(mx, my - 20, '+' + pts, this.combo > 2 ? '#ffe066' : '#fff');
      if (this.combo >= 3) {
        const msg = MESSAGES_COMBO[Math.min(this.combo - 3, MESSAGES_COMBO.length - 1)];
        this.showPopup(mx, my - 60, msg, '#f55aaa');
      }

      // Cascade check
      if (this.chain.length > 0) {
        // Re-check around the insertion point (which shifted)
        const newIdx = Math.min(start, this.chain.length - 1);
        setTimeout(() => this.checkMatches(newIdx), 80);
      }
    }
  }

  // ── SHOOTING ─────────────────────────────────
  onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = (e.clientX ?? e.pageX) - rect.left;
    const my = (e.clientY ?? e.pageY) - rect.top;
    this.angle = Math.atan2(my - this.shooterY, mx - this.shooterX);
  }

  onShoot(e) {
    if (this.state !== 'playing') return;
    const speed = 14;
    this.projectiles.push({
      x: this.shooterX,
      y: this.shooterY,
      vx: Math.cos(this.angle) * speed,
      vy: Math.sin(this.angle) * speed,
      colorId: this.currentColor,
    });
    this.currentColor = this.nextColor;
    this.nextColor = this.randColor();
    this.updateHUD();
    this.drawNextBall();
  }

  // ── LEVEL UP ──────────────────────────────────
  levelUp() {
    this.level++;
    this.speed = 0.25 + (this.level - 1) * 0.04;
    this.updateHUD();
    $('levelup-num').textContent = this.level;
    showScreen('levelup');
    setTimeout(() => {
      hideScreen('levelup');
      this.spawnChain(10 + this.level * 2);
    }, 1800);
  }

  // ── GAME OVER ─────────────────────────────────
  triggerGameOver() {
    this.state = 'gameover';
    cancelAnimationFrame(this.raf);
    this.raf = null;

    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem('pz_hs', this.highScore);
    }
    $('go-score').textContent = this.score;
    $('go-level').textContent = this.level;
    $('go-highscore').textContent = this.highScore;
    $('menu-highscore').textContent = this.highScore;
    $('go-message').textContent = MESSAGES_GAMEOVER[randInt(0, MESSAGES_GAMEOVER.length - 1)];
    showScreen('gameover');
  }

  // ── HUD ───────────────────────────────────────
  updateHUD() {
    $('hud-score').textContent = this.score;
    $('hud-combo').textContent = 'x' + this.combo;
    $('hud-level').textContent = this.level;
    const hs = parseInt(localStorage.getItem('pz_hs') || '0');
    $('menu-highscore').textContent = hs;
  }

  // ── POPUPS ────────────────────────────────────
  showPopup(x, y, text, color) {
    const el = document.createElement('div');
    el.className = 'popup';
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = (y + 60) + 'px'; // offset for HUD
    el.style.color = color || '#fff';
    $('popups').appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  // ── DRAW ─────────────────────────────────────
  draw() {
    const ctx = this.ctx;
    const W = this.W, H = this.H;

    ctx.clearRect(0, 0, W, H);

    // Background gradient
    const bg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W, H) * 0.7);
    bg.addColorStop(0, '#14141e');
    bg.addColorStop(1, '#0a0a0f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Draw path (faint track)
    this.drawPath(ctx);

    // Draw chain marbles
    for (let i = this.chain.length - 1; i >= 0; i--) {
      this.drawBall(ctx, this.chain[i].x, this.chain[i].y, this.chain[i].colorId, 1);
    }

    // Draw projectiles
    for (const p of this.projectiles) {
      this.drawBall(ctx, p.x, p.y, p.colorId, 1);
    }

    // Draw shooter
    this.drawShooter(ctx);

    // Draw aim line
    this.drawAim(ctx);

    // Draw current ball on shooter
    this.drawBall(ctx, this.shooterX, this.shooterY, this.currentColor, 1);

    // Draw next ball preview
    this.drawNextBall();
  }

  drawPath(ctx) {
    if (this.path.length < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(this.path[0].x, this.path[0].y);
    for (let i = 1; i < this.path.length; i++) {
      ctx.lineTo(this.path[i].x, this.path[i].y);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = BALL_RADIUS * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // End skull marker
    const end = this.path[0];
    ctx.save();
    ctx.font = '24px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.5;
    ctx.fillText('💀', end.x, end.y);
    ctx.restore();
  }

  drawBall(ctx, x, y, colorId, alpha = 1) {
    const col = COLORS[colorId] || COLORS[0];
    ctx.save();
    ctx.globalAlpha = alpha;

    // Glow
    ctx.shadowColor = col.glow;
    ctx.shadowBlur = 16;

    // Main ball gradient
    const grad = ctx.createRadialGradient(x - 5, y - 5, 2, x, y, BALL_RADIUS);
    grad.addColorStop(0, lighten(col.fill, 0.4));
    grad.addColorStop(0.5, col.fill);
    grad.addColorStop(1, darken(col.fill, 0.35));

    ctx.beginPath();
    ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Shine
    ctx.shadowBlur = 0;
    const shine = ctx.createRadialGradient(x - 6, y - 6, 0, x - 6, y - 6, BALL_RADIUS * 0.6);
    shine.addColorStop(0, 'rgba(255,255,255,0.4)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = shine;
    ctx.fill();

    // Border
    ctx.beginPath();
    ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }

  drawShooter(ctx) {
    const x = this.shooterX, y = this.shooterY;
    ctx.save();

    // Outer ring
    ctx.shadowColor = '#b55fff';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(x, y, SHOOTER_RADIUS + 8, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(181,95,255,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Base ring
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(x, y, SHOOTER_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(181,95,255,0.5)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Cannon barrel
    const barLen = 36;
    const bx = x + Math.cos(this.angle) * barLen;
    const by = y + Math.sin(this.angle) * barLen;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(bx, by);
    ctx.strokeStyle = '#b55fff';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.restore();
  }

  drawAim(ctx) {
    const x = this.shooterX, y = this.shooterY;
    ctx.save();
    ctx.setLineDash([6, 10]);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(this.angle) * 40, y + Math.sin(this.angle) * 40);
    ctx.lineTo(x + Math.cos(this.angle) * 200, y + Math.sin(this.angle) * 200);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawNextBall() {
    const ctx = this.nextCtx;
    ctx.clearRect(0, 0, 60, 60);
    this.drawBall(ctx, 30, 30, this.nextColor, 1);
  }

  // ── HELPERS ───────────────────────────────────
  randColor() {
    const numColors = Math.min(2 + this.level, COLORS.length);
    return randInt(0, numColors - 1);
  }
}

// ── COLOR HELPERS ──────────────────────────────
function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function lighten(hex, amt) {
  if (hex.length < 4) return hex;
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
}
function darken(hex, amt) {
  if (hex.length < 4) return hex;
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amt), g * (1 - amt), b * (1 - amt));
}

// ── SCREEN MANAGEMENT ──────────────────────────
const screens = {};
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => {
    if (!s.classList.contains('overlay-screen')) s.classList.remove('active');
  });
  const el = $('screen-' + name);
  if (el) el.classList.add('active');
}
function hideScreen(name) {
  const el = $('screen-' + name);
  if (el) el.classList.remove('active');
}

// ── INIT ───────────────────────────────────────
const game = new Game();

$('btn-play').addEventListener('click', () => {
  game.start();
});

$('btn-how').addEventListener('click', () => showScreen('how'));
$('btn-back').addEventListener('click', () => showScreen('menu'));

// Load high score on menu
const hs = parseInt(localStorage.getItem('pz_hs') || '0');
$('menu-highscore').textContent = hs;

showScreen('menu');
