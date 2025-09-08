/* Castle Fight - Two Lanes (No external assets) */
// Rendering constants
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const LANE_Y = [CANVAS_HEIGHT * 0.35, CANVAS_HEIGHT * 0.65];
const LANE_HEIGHT = 80;
const LEFT_SIDE = "player";
const RIGHT_SIDE = "ai";

// Economy
const START_GOLD = 500;
const GOLD_PER_SECOND = 5;
const GOLD_PER_KILL = 10;

// Structures
const CASTLE_MAX_HP = 5000;
const TOWER_MAX_HP = 1000;
const TOWER_DAMAGE = 20;

// Buildings
const BUILDING_MAX_HP = 500;
const BUILDINGS = {
  knight: { name: "Knight Temple", cost: 100, spawnInterval: 10, type: "knight" },
  archer: { name: "Archer Veil", cost: 120, spawnInterval: 10, type: "archer" },
  priest: { name: "Priest Temple", cost: 150, spawnInterval: 20, type: "priest" },
};

// Units
const UNIT_STATS = {
  knight: { hp: 200, dmg: 20, range: 24, speed: 50, attackRate: 1.0, type: "melee" },
  archer: { hp: 100, dmg: 30, range: 220, speed: 45, attackRate: 1.0, type: "ranged" },
  priest: { hp: 150, dmg: 15, range: 200, speed: 40, attackRate: 1.0, type: "ranged", healRate: 3.0, healAmount: 25, healRange: 180 },
};

// Deploy spots (12 per side -> 6 per lane)
const DEPLOY_PER_LANE = 6;

// Rendering helpers
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const goldEl = document.getElementById("gold");
const buildButtons = Array.from(document.querySelectorAll(".build-btn"));
const cancelBuildBtn = document.getElementById("cancel-build");
const musicToggleBtn = document.getElementById("music-toggle");
const sfxVolumeSlider = document.getElementById("sfx-volume");
const musicVolumeSlider = document.getElementById("music-volume");

// Audio
let audioCtx = null;
let masterGain = null;
let sfxGain = null;
let musicGain = null;
let musicNode = null;
let musicRunning = false;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  sfxGain = audioCtx.createGain();
  musicGain = audioCtx.createGain();
  masterGain.gain.value = 1.0;
  sfxGain.gain.value = Number(sfxVolumeSlider.value);
  musicGain.gain.value = Number(musicVolumeSlider.value);
  sfxGain.connect(masterGain);
  musicGain.connect(masterGain);
  masterGain.connect(audioCtx.destination);
}

function playBeep(frequency, duration, volume = 0.3, type = "sine") {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.value = volume;
  osc.connect(gain).connect(sfxGain);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function playSfx(kind) {
  switch (kind) {
    case "melee":
      playBeep(180, 0.05, 0.35, "square");
      playBeep(110, 0.06, 0.25, "sawtooth");
      break;
    case "arrow":
      playBeep(600, 0.02, 0.22, "triangle");
      playBeep(420, 0.05, 0.18, "triangle");
      break;
    case "holy":
      playBeep(780, 0.08, 0.3, "sine");
      break;
    case "hit":
      playBeep(240, 0.04, 0.2, "square");
      break;
  }
}

function startMusic() {
  if (!audioCtx) initAudio();
  if (musicRunning) return;
  musicRunning = true;

  const tempo = 92; // bpm
  const beat = 60 / tempo;
  const pattern = [0, 3, 5, 7, 5, 3]; // minor arpeggio
  const baseFreq = 196; // G3

  const voice = audioCtx.createOscillator();
  voice.type = "triangle";
  const voiceGain = audioCtx.createGain();
  voiceGain.gain.value = 0.0;
  voice.connect(voiceGain).connect(musicGain);
  voice.start();

  const pad = audioCtx.createOscillator();
  pad.type = "sine";
  const padGain = audioCtx.createGain();
  padGain.gain.value = 0.0;
  pad.connect(padGain).connect(musicGain);
  pad.start();

  let step = 0;
  function schedule() {
    if (!musicRunning) return;
    const t = audioCtx.currentTime;
    const semitone = pattern[step % pattern.length];
    voice.frequency.setTargetAtTime(baseFreq * Math.pow(2, semitone / 12), t, 0.005);
    voiceGain.gain.cancelScheduledValues(t);
    voiceGain.gain.setValueAtTime(0.0, t);
    voiceGain.gain.linearRampToValueAtTime(0.12, t + 0.03);
    voiceGain.gain.linearRampToValueAtTime(0.0, t + beat * 0.9);

    pad.frequency.setTargetAtTime(baseFreq / 2, t, 0.02);
    padGain.gain.cancelScheduledValues(t);
    padGain.gain.setTargetAtTime(0.06, t, 0.2);

    step++;
    musicNode = setTimeout(schedule, beat * 1000);
  }
  schedule();
}

function stopMusic() {
  musicRunning = false;
  if (musicNode) clearTimeout(musicNode);
}

// Game state
const state = {
  time: 0,
  gold: { [LEFT_SIDE]: START_GOLD, [RIGHT_SIDE]: START_GOLD },
  castles: {
    [LEFT_SIDE]: { x: 70, y: CANVAS_HEIGHT / 2, width: 80, height: 220, hp: CASTLE_MAX_HP },
    [RIGHT_SIDE]: { x: CANVAS_WIDTH - 70, y: CANVAS_HEIGHT / 2, width: 80, height: 220, hp: CASTLE_MAX_HP },
  },
  towers: [],
  buildings: [],
  units: [],
  projectiles: [],
  floatText: [],
  gameOver: false,
  winner: null,
  deploySlots: { [LEFT_SIDE]: [], [RIGHT_SIDE]: [] },
  selectedBuild: null,
  lastIncomeTime: 0,
};

function seedDeploySlots() {
  // 6 per lane per side, arranged near each side's castle
  const marginX = 160;
  const spacingX = 54;
  const cols = 3;
  const rows = 2; // per lane
  const slotSize = 34;
  for (const side of [LEFT_SIDE, RIGHT_SIDE]) {
    for (let laneIndex = 0; laneIndex < 2; laneIndex++) {
      const laneYCenter = LANE_Y[laneIndex];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const sx = side === LEFT_SIDE
            ? marginX + c * spacingX
            : CANVAS_WIDTH - marginX - c * spacingX;
          const sy = laneYCenter - 20 + r * 40; // closer to lane center for better targeting
          state.deploySlots[side].push({
            side,
            laneIndex,
            x: sx,
            y: sy,
            size: slotSize,
            occupied: false,
            buildingId: null,
          });
        }
      }
    }
  }
}

function addTowers() {
  // One tower for each player on each line
  for (let laneIndex = 0; laneIndex < 2; laneIndex++) {
    const y = LANE_Y[laneIndex];
    state.towers.push({ id: uid(), side: LEFT_SIDE, laneIndex, x: 180, y, range: 300, hp: TOWER_MAX_HP, cooldown: 0 });
    state.towers.push({ id: uid(), side: RIGHT_SIDE, laneIndex, x: CANVAS_WIDTH - 180, y, range: 300, hp: TOWER_MAX_HP, cooldown: 0 });
  }
}

// Utils
function uid() { return Math.random().toString(36).slice(2); }

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function sideSign(side) { return side === LEFT_SIDE ? 1 : -1; }

function isOpposite(a, b) { return a !== b; }

// Input handling
let mouse = { x: 0, y: 0 };
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
  mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
});

canvas.addEventListener("mousedown", () => {
  if (!audioCtx) initAudio();
});

canvas.addEventListener("click", (e) => {
  if (state.gameOver) return;
  if (!state.selectedBuild) return;
  // Try place on player's slot under cursor
  const slot = state.deploySlots[LEFT_SIDE].find(s => !s.occupied && pointInSquare(mouse.x, mouse.y, s.x, s.y, s.size));
  if (!slot) return;
  const buildDef = BUILDINGS[state.selectedBuild];
  if (state.gold[LEFT_SIDE] < buildDef.cost) return;
  state.gold[LEFT_SIDE] -= buildDef.cost;
  const building = createBuilding(LEFT_SIDE, slot.laneIndex, slot.x, slot.y, state.selectedBuild);
  slot.occupied = true;
  slot.buildingId = building.id;
});

function pointInSquare(px, py, cx, cy, size) {
  return px >= cx - size / 2 && px <= cx + size / 2 && py >= cy - size / 2 && py <= cy + size / 2;
}

// UI interactions
let activeBtn = null;
buildButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    buildButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.selectedBuild = btn.dataset.type;
  });
});

cancelBuildBtn.addEventListener("click", () => {
  state.selectedBuild = null;
  buildButtons.forEach(b => b.classList.remove("active"));
});

musicToggleBtn.addEventListener("click", () => {
  if (!audioCtx) initAudio();
  if (musicRunning) {
    stopMusic();
    musicToggleBtn.textContent = "Play Music";
  } else {
    startMusic();
    musicToggleBtn.textContent = "Stop Music";
  }
});

sfxVolumeSlider.addEventListener("input", () => {
  if (!audioCtx) return;
  sfxGain.gain.value = Number(sfxVolumeSlider.value);
});

musicVolumeSlider.addEventListener("input", () => {
  if (!audioCtx) return;
  musicGain.gain.value = Number(musicVolumeSlider.value);
});

// Entity creation
function createBuilding(side, laneIndex, x, y, kind) {
  const def = BUILDINGS[kind];
  const b = {
    id: uid(),
    kind,
    side,
    laneIndex,
    x,
    y,
    hp: BUILDING_MAX_HP,
    spawnInterval: def.spawnInterval,
    spawnTimer: def.spawnInterval,
  };
  state.buildings.push(b);
  return b;
}

function createUnit(side, laneIndex, x, kind) {
  const s = UNIT_STATS[kind];
  const u = {
    id: uid(),
    side,
    laneIndex,
    x,
    y: LANE_Y[laneIndex],
    kind,
    hp: s.hp,
    maxHp: s.hp,
    dmg: s.dmg,
    range: s.range,
    speed: s.speed,
    type: s.type,
    cooldown: 0,
    attackRate: s.attackRate,
    attackCounter: 0, // for archer crit
    healCooldown: s.healRate ? s.healRate : 0,
  };
  state.units.push(u);
  return u;
}

function createProjectile(side, laneIndex, x, y, targetId, dmg, speed = 320) {
  const p = { id: uid(), side, laneIndex, x, y, targetId, dmg, speed };
  state.projectiles.push(p);
  return p;
}

function addFloatText(x, y, text, color = "#fff", ttl = 1.2) {
  state.floatText.push({ id: uid(), x, y, text, color, ttl });
}

// AI logic
let aiTimer = 0;
function aiUpdate(dt) {
  aiTimer -= dt;
  if (aiTimer > 0) return;
  aiTimer = 2.5 + Math.random() * 1.5;

  const choices = ["knight", "archer", "priest"];
  const pick = choices[(Math.random() * choices.length) | 0];
  const def = BUILDINGS[pick];
  if (state.gold[RIGHT_SIDE] < def.cost) return;

  const freeSlots = state.deploySlots[RIGHT_SIDE].filter(s => !s.occupied);
  if (freeSlots.length === 0) return;
  freeSlots.sort((a, b) => (a.laneIndex - b.laneIndex) || (Math.random() - 0.5));
  const slot = freeSlots[0];
  state.gold[RIGHT_SIDE] -= def.cost;
  const b = createBuilding(RIGHT_SIDE, slot.laneIndex, slot.x, slot.y, pick);
  slot.occupied = true;
  slot.buildingId = b.id;
}

// Combat helpers
function findTargets(side, laneIndex) {
  const enemies = [];
  for (const u of state.units) {
    if (u.side !== side && u.laneIndex === laneIndex) enemies.push(u);
  }
  for (const t of state.towers) {
    if (t.side !== side && t.laneIndex === laneIndex && t.hp > 0) enemies.push(t);
  }
  return enemies;
}

function distanceUnitToEntity(u, e) {
  const ex = e.x;
  const ey = (e.laneIndex != null) ? LANE_Y[e.laneIndex] : (e.y || LANE_Y[u.laneIndex]); // align to lane center for buildings/towers
  const dx = ex - u.x;
  const dy = ey - u.y;
  return Math.hypot(dx, dy);
}

function dealDamage(entity, damage, sourceSide) {
  entity.hp -= damage;
  playSfx("hit");
  if (entity.hp <= 0) {
    entity.hp = 0;
    if (sourceSide && sourceSide in state.gold) {
      state.gold[sourceSide] += GOLD_PER_KILL;
    }
  }
}

function healEntity(entity, amount) {
  if (!entity) return;
  entity.hp = Math.min(entity.maxHp || BUILDING_MAX_HP, entity.hp + amount);
  playSfx("holy");
}

// Game loop
let lastTime = performance.now();
function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (!state.gameOver) update(dt);
  render();
  requestAnimationFrame(loop);
}

function update(dt) {
  state.time += dt;

  // income
  if (state.time - state.lastIncomeTime >= 1.0) {
    state.lastIncomeTime = state.time;
    state.gold[LEFT_SIDE] += GOLD_PER_SECOND;
    state.gold[RIGHT_SIDE] += GOLD_PER_SECOND;
  }
  goldEl.textContent = String(state.gold[LEFT_SIDE]);

  // buildings spawn
  for (const b of state.buildings) {
    if (b.hp <= 0) continue;
    b.spawnTimer -= dt;
    if (b.spawnTimer <= 0) {
      b.spawnTimer += b.spawnInterval;
      const x = b.side === LEFT_SIDE ? b.x + 20 : b.x - 20;
      createUnit(b.side, b.laneIndex, x, BUILDINGS[b.kind].type);
    }
  }

  // units update
  for (const u of state.units) {
    if (u.hp <= 0) continue;
    const enemies = findTargets(u.side, u.laneIndex);
    for (const b of state.buildings) {
      if (b.side !== u.side && b.laneIndex === u.laneIndex && b.hp > 0) enemies.push(b);
    }
    const enemyCastle = state.castles[u.side === LEFT_SIDE ? RIGHT_SIDE : LEFT_SIDE];
    const castleProxy = { x: enemyCastle.x + (u.side === LEFT_SIDE ? -enemyCastle.width/2 : enemyCastle.width/2), y: LANE_Y[u.laneIndex], hp: enemyCastle.hp, _castle: true };
    enemies.push(castleProxy);

    // find closest in front
    let best = null;
    let bestDist = Infinity;
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      const d = distanceUnitToEntity(u, e);
      const forward = sideSign(u.side) > 0 ? (e.x >= u.x - 4) : (e.x <= u.x + 4);
      if (!forward) continue;
      if (d < bestDist) { bestDist = d; best = e; }
    }

    let inRange = best && bestDist <= u.range + 2;
    if (!best || !inRange) {
      u.x += sideSign(u.side) * u.speed * dt;
    }

    // attack
    u.cooldown -= dt;
    if (best && inRange && u.cooldown <= 0) {
      u.cooldown = 1.0 / u.attackRate;
      if (u.type === "melee") {
        playSfx("melee");
        let dmg = u.dmg;
        applyDamageToTarget(best, dmg, u);
      } else {
        playSfx("arrow");
        let dmg = u.dmg;
        if (u.kind === "archer") {
          u.attackCounter = (u.attackCounter + 1) % 3;
          if (u.attackCounter === 0) {
            dmg *= 2; // crit
            addFloatText(u.x, u.y - 24, String(dmg), "#ff4d4d", 2.0);
          }
        }
        const projectile = createProjectile(u.side, u.laneIndex, u.x, u.y, best.id || best._castle || best, dmg);
        projectile.targetEntity = best;
      }
    }

    // priest heal
    if (u.kind === "priest") {
      u.healCooldown -= dt;
      if (u.healCooldown <= 0) {
        u.healCooldown = UNIT_STATS.priest.healRate;
        const allies = state.units.filter(v => v.side === u.side && v.laneIndex === u.laneIndex && v.hp > 0 && v !== u);
        let target = null;
        let worstRatio = 1.0;
        for (const a of allies) {
          const d = Math.abs(a.x - u.x);
          if (d <= UNIT_STATS.priest.healRange) {
            const ratio = a.hp / a.maxHp;
            if (ratio < worstRatio) { worstRatio = ratio; target = a; }
          }
        }
        if (target && worstRatio < 1.0) {
          healEntity(target, UNIT_STATS.priest.healAmount);
          addFloatText(target.x, target.y - 18, "+" + UNIT_STATS.priest.healAmount, "#6cf0b5", 1.0);
        }
      }
    }
  }

  // projectiles
  for (const p of state.projectiles) {
    const target = p.targetEntity;
    if (!target || target.hp <= 0) { p.ttl = -1; continue; }
    const tx = target._castle ? (state.castles[p.side === LEFT_SIDE ? RIGHT_SIDE : LEFT_SIDE].x) : target.x;
    const ty = (target.laneIndex != null) ? LANE_Y[target.laneIndex] : (target.y || LANE_Y[p.laneIndex]);
    const dx = tx - p.x; const dy = ty - p.y;
    const dist = Math.hypot(dx, dy);
    const step = p.speed * dt;
    if (dist <= step + 2) {
      applyDamageToTarget(target, p.dmg, { side: p.side });
      p.ttl = -1;
    } else {
      p.x += (dx / dist) * step;
      p.y += (dy / dist) * step;
    }
  }
  state.projectiles = state.projectiles.filter(p => (p.ttl === undefined || p.ttl > 0));

  // towers attack
  for (const t of state.towers) {
    if (t.hp <= 0) continue;
    t.cooldown -= dt;
    if (t.cooldown > 0) continue;
    let best = null; let bestDist = Infinity;
    for (const u of state.units) {
      if (u.side !== t.side && u.laneIndex === t.laneIndex && u.hp > 0) {
        const d = Math.abs(u.x - t.x);
        if (d < bestDist && d <= t.range) { best = u; bestDist = d; }
      }
    }
    if (best) {
      t.cooldown = 1.0;
      createProjectile(t.side, t.laneIndex, t.x, t.y, best.id, TOWER_DAMAGE, 420).targetEntity = best;
      playSfx("arrow");
    }
  }

  // cleanup dead entities and free slots
  for (const s of state.deploySlots[LEFT_SIDE]) {
    if (s.occupied && s.buildingId) {
      const b = state.buildings.find(x => x.id === s.buildingId);
      if (!b || b.hp <= 0) { s.occupied = false; s.buildingId = null; }
    }
  }
  for (const s of state.deploySlots[RIGHT_SIDE]) {
    if (s.occupied && s.buildingId) {
      const b = state.buildings.find(x => x.id === s.buildingId);
      if (!b || b.hp <= 0) { s.occupied = false; s.buildingId = null; }
    }
  }

  // castles receive melee hits when reached
  for (const u of state.units) {
    if (u.hp <= 0) continue;
    const enemyCastleKey = u.side === LEFT_SIDE ? RIGHT_SIDE : LEFT_SIDE;
    const castle = state.castles[enemyCastleKey];
    const cx = castle.x + (enemyCastleKey === LEFT_SIDE ? -castle.width/2 : castle.width/2);
    if ((u.side === LEFT_SIDE && u.x >= cx - 6) || (u.side === RIGHT_SIDE && u.x <= cx + 6)) {
      u.cooldown -= dt;
      if (u.cooldown <= 0) {
        u.cooldown = 1.0 / u.attackRate;
        castle.hp = Math.max(0, castle.hp - u.dmg);
        playSfx("hit");
      }
    }
  }

  // remove dead units
  state.units = state.units.filter(u => u.hp > 0);

  // check game over
  if (state.castles[LEFT_SIDE].hp <= 0 || state.castles[RIGHT_SIDE].hp <= 0) {
    state.gameOver = true;
    state.winner = state.castles[LEFT_SIDE].hp <= 0 ? RIGHT_SIDE : LEFT_SIDE;
  }

  // AI
  aiUpdate(dt);
}

function applyDamageToTarget(target, damage, source) {
  if (target._castle) {
    const key = source.side === LEFT_SIDE ? RIGHT_SIDE : LEFT_SIDE;
    state.castles[key].hp = Math.max(0, state.castles[key].hp - damage);
    playSfx("hit");
    return;
  }
  dealDamage(target, damage, source.side);
}

// Rendering
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();
  drawLanes();
  drawCastles();
  drawTowers();
  drawBuildings();
  drawUnits();
  drawProjectiles();
  drawFloatText();
  drawHUDOverlays();
  if (state.gameOver) drawGameOver();
}

function drawBackground() {
  const grd = ctx.createLinearGradient(0, CANVAS_HEIGHT * 0.6, 0, CANVAS_HEIGHT);
  grd.addColorStop(0, "#1b2a3e");
  grd.addColorStop(1, "#0f1a28");
  ctx.fillStyle = grd;
  ctx.fillRect(0, CANVAS_HEIGHT * 0.6, CANVAS_WIDTH, CANVAS_HEIGHT * 0.4);

  ctx.save();
  ctx.translate(0, CANVAS_HEIGHT * 0.55);
  ctx.fillStyle = "#25324a";
  for (let i = 0; i < 10; i++) {
    const x = (i / 10) * CANVAS_WIDTH + (i % 2 ? 20 : -10);
    const w = 80 + (i % 3) * 20;
    const h = 60 + (i % 4) * 20;
    ctx.fillRect(x, -h, w, h);
    ctx.fillRect(x + 10, -h - 20, w * 0.2, 20);
  }
  ctx.restore();
}

function drawLanes() {
  for (let i = 0; i < 2; i++) {
    const y = LANE_Y[i];
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y - LANE_HEIGHT / 2);
    ctx.lineTo(CANVAS_WIDTH, y - LANE_HEIGHT / 2);
    ctx.moveTo(0, y + LANE_HEIGHT / 2);
    ctx.lineTo(CANVAS_WIDTH, y + LANE_HEIGHT / 2);
    ctx.stroke();

    ctx.fillStyle = "#2a3957";
    ctx.fillRect(20, y - 14, 80, 28);
    ctx.fillRect(CANVAS_WIDTH - 100, y - 14, 80, 28);
  }

  for (const side of [LEFT_SIDE, RIGHT_SIDE]) {
    for (const s of state.deploySlots[side]) {
      const hovered = pointInSquare(mouse.x, mouse.y, s.x, s.y, s.size);
      ctx.lineWidth = 2;
      ctx.strokeStyle = side === LEFT_SIDE ? (hovered && !s.occupied && state.selectedBuild ? "#78ffb6" : "#6f93d8") : "#d56f6f";
      ctx.globalAlpha = s.occupied ? 0.35 : 0.9;
      ctx.strokeRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
      ctx.globalAlpha = 1.0;
    }
  }
}

function drawCastles() {
  for (const key of [LEFT_SIDE, RIGHT_SIDE]) {
    const c = state.castles[key];
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.fillStyle = key === LEFT_SIDE ? "#7a8caf" : "#af7a7a";
    ctx.fillRect(-c.width / 2, -c.height / 2, c.width, c.height);
    ctx.fillStyle = "#e6e6f0";
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(-c.width / 2 + i * (c.width / 5) + 6, -c.height / 2 - 10, 12, 10);
    }
    drawHpBar(-c.width / 2, -c.height / 2 - 18, c.width, c.hp, CASTLE_MAX_HP);
    ctx.restore();
  }
}

function drawTowers() {
  for (const t of state.towers) {
    if (t.hp <= 0) continue;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.fillStyle = t.side === LEFT_SIDE ? "#6f86b6" : "#b66f6f";
    ctx.fillRect(-12, -38, 24, 76);
    ctx.fillStyle = "#eaeaf5";
    ctx.fillRect(-16, -38, 8, 16);
    ctx.fillRect(8, -38, 8, 16);
    drawHpBar(-22, -46, 44, t.hp, TOWER_MAX_HP);
    ctx.restore();
  }
}

function drawBuildings() {
  for (const b of state.buildings) {
    if (b.hp <= 0) continue;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = b.side === LEFT_SIDE ? "#5f7fb6" : "#b65f5f";
    ctx.fillRect(-16, -16, 32, 32);
    ctx.fillStyle = "#f2f6ff";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const icon = b.kind === "knight" ? "⚔" : b.kind === "archer" ? "🏹" : "✚";
    ctx.fillText(icon, 0, 1);
    drawHpBar(-20, -26, 40, b.hp, BUILDING_MAX_HP);

    const pct = clamp(1 - (b.spawnTimer / b.spawnInterval), 0, 1);
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
    ctx.stroke();
    ctx.restore();
  }
}

function drawUnits() {
  for (const u of state.units) {
    ctx.save();
    ctx.translate(u.x, u.y);
    if (u.kind === "knight") {
      ctx.fillStyle = u.side === LEFT_SIDE ? "#88a6ff" : "#ff8888";
      ctx.fillRect(-10, -16, 20, 32);
      ctx.fillStyle = "#e6e6f0";
      ctx.fillRect(-2, -20, 4, 8);
    } else if (u.kind === "archer") {
      ctx.fillStyle = u.side === LEFT_SIDE ? "#7fcfb1" : "#cf7f7f";
      ctx.fillRect(-9, -14, 18, 28);
      ctx.fillStyle = "#e6e6f0";
      ctx.fillRect(6, -8, 10, 2);
    } else if (u.kind === "priest") {
      ctx.fillStyle = u.side === LEFT_SIDE ? "#c4b87a" : "#c47a7a";
      ctx.fillRect(-9, -14, 18, 28);
      ctx.fillStyle = "#f7f3d4";
      ctx.fillRect(-3, -20, 6, 8);
    }
    drawHpBar(-16, -26, 32, u.hp, u.maxHp);
    ctx.restore();
  }
}

function drawProjectiles() {
  ctx.fillStyle = "#f0dc72";
  for (const p of state.projectiles) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFloatText() {
  for (const ft of state.floatText) {
    ft.ttl -= 1 / 60;
    ft.y -= 0.2;
  }
  state.floatText = state.floatText.filter(f => f.ttl > 0);
  for (const ft of state.floatText) {
    ctx.globalAlpha = Math.min(1, ft.ttl);
    ctx.fillStyle = ft.color;
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.globalAlpha = 1.0;
  }
}

function drawHUDOverlays() {
  if (state.selectedBuild) {
    ctx.fillStyle = "rgba(122, 180, 255, 0.08)";
    ctx.fillRect(0, 0, CANVAS_WIDTH / 2, CANVAS_HEIGHT);
  }
}

function drawGameOver() {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillStyle = "#f2f6ff";
  ctx.font = "bold 48px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${state.winner === LEFT_SIDE ? "You Win" : "You Lose"}!`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
  ctx.restore();
}

function drawHpBar(x, y, w, hp, maxHp) {
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x, y, w, 6);
  const pct = clamp(hp / maxHp, 0, 1);
  ctx.fillStyle = pct > 0.5 ? "#63e07d" : pct > 0.25 ? "#e0cf63" : "#e06363";
  ctx.fillRect(x, y, w * pct, 6);
}

// Initialize
seedDeploySlots();
addTowers();
// Give both sides an initial building to start the action
createBuilding(LEFT_SIDE, 0, state.deploySlots[LEFT_SIDE][0].x, state.deploySlots[LEFT_SIDE][0].y, "knight");
state.deploySlots[LEFT_SIDE][0].occupied = true;
state.deploySlots[LEFT_SIDE][0].buildingId = state.buildings[state.buildings.length - 1].id;
createBuilding(RIGHT_SIDE, 1, state.deploySlots[RIGHT_SIDE][5].x, state.deploySlots[RIGHT_SIDE][5].y, "archer");
state.deploySlots[RIGHT_SIDE][5].occupied = true;
state.deploySlots[RIGHT_SIDE][5].buildingId = state.buildings[state.buildings.length - 1].id;

requestAnimationFrame(loop);
