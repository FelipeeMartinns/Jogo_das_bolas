'use strict';

/* ============================================================
   JOGO DAS BOLAS — lógica principal
   ============================================================ */

/* ---------------- Dados ----------------
   Ações: ataque, defesa, projetil, refletir
   Bolas: fogo, pedra, agua, ar
   Combo: 3 por jogador, nunca recarrega
   Cada ação base tem 3 usos; esgotou, recarrega no turno seguinte.
   Frenesi: quando alguém chega à metade da vida, tempo cai para 3s.
------------------------------------------ */

const ELEMENTS = {
  fogo:  { nome: 'Fogo',  cor: '#ff6b35', glow: '#ff6b35',
           desc: 'Todo projétil que acerta aumenta +2 de dano permanente nos seus próximos projéteis.' },
  pedra: { nome: 'Pedra', cor: '#a8b0bd', glow: '#8a93a3',
           desc: 'Ataques causam dano dobrado.' },
  agua:  { nome: 'Água',  cor: '#35a7ff', glow: '#35a7ff',
           desc: 'Refletir uma habilidade inimiga causa dano dobrado.' },
  ar:    { nome: 'Ar',    cor: '#eaf6ff', glow: '#cfe8ff',
           desc: '+1 de dano ao acertar um projétil, +2 ao acertar defesa ou ao refletir.' },
};

const ACTIONS = {
  ataque:   { nome: 'Ataque',   cls: '', desc: 'Vence Projétil' },
  defesa:   { nome: 'Defesa',   cls: '', desc: 'Vence Ataque e Refletir · contra-ataca' },
  projetil: { nome: 'Projétil', cls: '', desc: 'Vence Defesa' },
  refletir: { nome: 'Refletir', cls: '', desc: 'Devolve Projétil contra quem lançou' },
};

const BASE_DMG = 2;
const MAX_HP = 20;
const DECISION_SLOW = 5000;
const DECISION_FAST = 3000;
const USE_PER_ACTION = 3;
const MAX_TOP_ACTIONS = 2;

const KEYS = {
  p1: { ataque: 'KeyQ', defesa: 'KeyW', projetil: 'KeyE', refletir: 'KeyR', combo: 'KeyT', ok: 'KeyA' },
  p2: { ataque: 'KeyU', defesa: 'KeyI', projetil: 'KeyO', refletir: 'KeyP', combo: 'KeyK', ok: 'KeyL' },
};

const KEY_LABEL = {
  p1: { ataque: 'Q', defesa: 'W', projetil: 'E', refletir: 'R', combo: 'T', ok: 'A' },
  p2: { ataque: 'U', defesa: 'I', projetil: 'O', refletir: 'P', combo: 'K', ok: 'L' },
};

const ACTION_ORDER = ['ataque', 'defesa', 'projetil', 'refletir'];

/* ---------------- Estado geral ---------------- */
let game = null;        // dados da partida atual
let anim = null;        // estado de animação / desenho
let canvas = null, ctx = null;
let screenBattle = null;
let audioCtx = null;
let currentMode = 'hotseat';
let currentScreen = 'menu';

const $ = id => document.getElementById(id);

/* ---------------- Sons (WebAudio) ---------------- */
function ensureAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume().then(() => Music.sync());
    Music.sync();
  } catch (e) { /* sem áudio */ }
}

function tone(freq, dur, type, vol, when) {
  if (!audioCtx || !Settings.sfx) return;
  try {
    const t0 = audioCtx.currentTime + (when || 0);
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch (e) { /* ignore */ }
}

const sfx = {
  click:   () => tone(700, 0.05, 'triangle', 0.06),
  confirm: () => { tone(500, 0.09, 'triangle', 0.1); tone(800, 0.12, 'triangle', 0.08, 0.06); },
  whoosh:  () => tone(300, 0.18, 'sine', 0.1),
  hit:     () => { tone(120, 0.22, 'square', 0.16); tone(60, 0.25, 'sine', 0.16, 0.02); },
  block:   () => { tone(420, 0.1, 'square', 0.1); tone(210, 0.12, 'square', 0.08, 0.05); },
  reflect: () => { tone(900, 0.09, 'sine', 0.12); tone(1200, 0.12, 'sine', 0.1, 0.05); },
  frenzy:  () => { tone(660, 0.1, 'square', 0.14); tone(880, 0.12, 'square', 0.14, 0.12); },
  win:     () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.2, 'triangle', 0.12, i * 0.14)); },
  lose:    () => { [392, 349, 329, 261].forEach((f, i) => tone(f, 0.22, 'sine', 0.1, i * 0.16)); },
};

/* ---------------- Configurações de som ---------------- */
const SETTINGS_KEY = 'jdb.settings.v1';
const Settings = {
  menuMusic: true,
  combatMusic: true,
  sfx: true,
  load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) Object.assign(this, JSON.parse(raw));
    } catch (e) { /* sem storage */ }
  },
  save() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        menuMusic: this.menuMusic, combatMusic: this.combatMusic, sfx: this.sfx,
      }));
    } catch (e) { /* sem storage */ }
  },
};
Settings.load();

/* ---------------- Música procedural (WebAudio) ----------------
   Gera trilhas em loop sem arquivos externos, via osciladores.
   Menu: andamento calmo, arpejo em lá menor.
   Combate: andamento acelerado com kick e chimbal.
----------------------------------------------------------------- */
const MNOTE = st => 110 * Math.pow(2, st / 12);

const Music = {
  kind: null,          // 'menu' | 'combat' | null
  timer: null,
  step: 0,
  nextTime: 0,
  master: null,
  bpm: { menu: 88, combat: 150 },
  seq: {
    menu: {
      lead: [12, 15, 17, 19, 22, 19, 17, 15, 12, 15, 17, 19, 24, 22, 19, 17],
      bass: [0, null, 0, null, 0, null, 7, null, 0, null, 0, null, 3, null, 5, null],
    },
    combat: {
      lead: [12, 19, 15, 22, 17, 24, 15, 19, 12, 19, 15, 22, 17, 24, 19, 24],
      bass: [0, null, 7, null, 0, null, 7, null, 5, null, 7, null, 3, null, 7, null],
      kick: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      hat:  [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
    },
  },
  stepDur() { return 60 / this.bpm[this.kind] / 2; },
  ensureMaster() {
    if (!audioCtx) return null;
    if (!this.master) {
      this.master = audioCtx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(audioCtx.destination);
    }
    return this.master;
  },
  desiredKind() {
    return currentScreen === 'battle' ? 'combat' : 'menu';
  },
  sync() {
    if (!audioCtx || audioCtx.state === 'suspended') return;
    const kind = this.desiredKind();
    const enabled = kind === 'combat' ? Settings.combatMusic : Settings.menuMusic;
    if (!enabled) { if (this.kind === kind) this.stop(); return; }
    this.start(kind);
  },
  start(kind) {
    if (!audioCtx) return;
    if (this.kind === kind && this.timer) return;
    const master = this.ensureMaster();
    if (master) {
      const now = audioCtx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
      master.gain.exponentialRampToValueAtTime(0.8, now + 0.4);
    }
    if (this.timer) clearInterval(this.timer);
    this.kind = kind;
    this.step = 0;
    this.nextTime = audioCtx.currentTime + 0.05;
    this.timer = setInterval(() => this.scheduler(), 100);
  },
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (audioCtx && this.master) {
      const now = audioCtx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(Math.max(this.master.gain.value, 0.0001), now);
      this.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    }
    this.kind = null;
  },
  scheduler() {
    if (!audioCtx || audioCtx.state !== 'running' || !this.kind) return;
    const dur = this.stepDur();
    if (this.nextTime < audioCtx.currentTime - 0.5) this.nextTime = audioCtx.currentTime + 0.05;
    while (this.nextTime < audioCtx.currentTime + 0.25) {
      this.playStep(this.step, this.nextTime, dur);
      this.step = (this.step + 1) % 16;
      this.nextTime += dur;
    }
  },
  playStep(s, t, dur) {
    const st = this.seq[this.kind];
    if (this.kind === 'menu') {
      if (s === 0 || s === 8) {
        [12, 15, 19].forEach(n => musicNote(MNOTE(n), t, dur * 3, 'sine', 0.045, 900));
      }
      musicNote(MNOTE(st.bass[s]), t, dur * 0.9, 'triangle', 0.14, 500);
      musicNote(MNOTE(st.lead[s]), t, dur * 0.9, 'sine', 0.09, 2200);
    } else {
      if (st.kick[s]) musicNote(MNOTE(-12), t, 0.12, 'sine', 0.34, 190);
      if (st.hat[s]) musicNote(6000, t, 0.05, 'square', 0.012, 8000);
      musicNote(MNOTE(st.bass[s]), t, dur * 0.45, 'triangle', 0.2, 550);
      musicNote(MNOTE(st.lead[s]), t, dur * 0.85, 'square', 0.04, 2000);
    }
  },
};

function musicNote(freq, time, dur, type, vol, lowpass) {
  if (freq == null || !Music.master) return;
  try {
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, time);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vol || 0.1, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    let node = osc;
    if (lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(Music.master);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  } catch (e) { /* ignore */ }
}

/* ---------------- Helpers ---------------- */
const delay = ms => new Promise(r => setTimeout(r, ms));
function tween(ms, fn) {
  return new Promise(res => {
    const s = performance.now();
    const step = t => {
      const p = Math.min(1, (t - s) / ms);
      fn(p);
      if (p < 1) requestAnimationFrame(step);
      else res();
    };
    requestAnimationFrame(step);
  });
}
function rngInt(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rngInt(arr.length)]; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function weightedRandom(obj) {
  const entries = Object.entries(obj);
  let total = 0;
  const w = entries.map(([k, v]) => { total += (v || 0) + 1; return [k, v || 0]; });
  let r = Math.random() * total;
  for (const [k, v] of w) {
    r -= v + 1;
    if (r <= 0) return k;
  }
  return entries[0][0];
}

/* ---------------- Navegação de telas ---------------- */
function showScreen(id) {
  currentScreen = id.replace('screen-', '');
  ['screen-menu', 'screen-select', 'screen-battle'].forEach(s => {
    $(s).hidden = s !== id;
  });
  Music.sync();
}

function toggleRules() {
  const b = $('rules-box');
  b.hidden = !b.hidden;
}

function openSettings() {
  ensureAudio();
  sfx.click();
  updateSettingsUI();
  $('settings').hidden = false;
}

function closeSettings() {
  sfx.click();
  $('settings').hidden = true;
}

function toggleSetting(key) {
  Settings[key] = !Settings[key];
  Settings.save();
  updateSettingsUI();
  Music.sync();
}

function updateSettingsUI() {
  const map = { menuMusic: 'toggle-menu-music', combatMusic: 'toggle-combat-music', sfx: 'toggle-sfx' };
  for (const [key, id] of Object.entries(map)) {
    const el = $(id);
    if (!el) continue;
    const on = Settings[key];
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', on);
    el.setAttribute('aria-label', `${key} ${on ? 'ligado' : 'desligado'}`);
  }
}

function backToMenu() {
  game = null;
  $('gameover').hidden = true;
  document.body.classList.remove('frenzy');
  showScreen('screen-menu');
}

function startSelect(mode) {
  currentMode = mode;
  ensureAudio();
  sfx.click();
  buildSelect('p1');
  showScreen('screen-select');
}

/* ---------------- Seleção de personagens ---------------- */
let selectState = null;

function buildSelect(playerKey) {
  const title = $('select-title');
  const grid = $('select-grid');
  const note = $('select-note');
  grid.innerHTML = '';
  note.textContent = '';

  const label = playerKey === 'p1'
    ? (currentMode === 'machine' ? 'Você' : 'Jogador 1')
    : 'Jogador 2';
  title.textContent = `${label} — escolha sua bola`;

  selectState = { playerKey, chosen: null };

  for (const [el, data] of Object.entries(ELEMENTS)) {
    const card = document.createElement('div');
    card.className = 'select-card';
    card.innerHTML = `
      <div class="select-ball ${el}"></div>
      <h3>${data.nome}</h3>
      <p>${data.desc}</p>`;
    card.addEventListener('click', () => {
      ensureAudio();
      sfx.click();
      selectState.chosen = el;
      grid.querySelectorAll('.select-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      finishSelect(el, playerKey);
    });
    grid.appendChild(card);
  }
}

function finishSelect(element, playerKey) {
  if (playerKey === 'p1') {
    selectStateP1 = element;
    if (currentMode === 'machine') {
      const els = Object.keys(ELEMENTS).filter(e => e !== element);
      const aiPick = pick(els);
      $('select-note').textContent = 'Máquina escolhendo...';
      setTimeout(() => startBattle(element, aiPick), 800);
    } else {
      $('select-note').textContent = 'Passe o controle para o Jogador 2.';
      setTimeout(() => buildSelect('p2'), 300);
    }
  } else {
    $('select-note').textContent = '';
    startBattle(selectStateP1, element);
  }
}

/* mantém a escolha do P1 na seleção hotseat */
let selectStateP1 = null;

/* ---------------- Jogadores e partida ---------------- */
function makePlayer(key, element, isAI, name) {
  return {
    key,
    name,
    isAI,
    element,
    hp: MAX_HP,
    maxHp: MAX_HP,
    counts: { ataque: USE_PER_ACTION, defesa: USE_PER_ACTION, projetil: USE_PER_ACTION, refletir: USE_PER_ACTION },
    combos: 3,
    fireBonus: 0,
    selection: { combo: false, actions: [] },
    confirmed: false,
    lastActions: [],
  };
}

function startBattle(elementP1, elementP2) {
  showScreen('screen-battle');
  document.body.classList.remove('frenzy');

  const isMachine = currentMode === 'machine';
  const p1 = makePlayer('p1', elementP1, false, isMachine ? 'Você' : 'Jogador 1');
  const p2 = makePlayer('p2', elementP2, isMachine, isMachine ? 'Máquina' : 'Jogador 2');

  game = {
    mode: isMachine ? 'machine' : 'hotseat',
    players: { p1, p2 },
    state: 'decision',
    frenzy: false,
    turns: 0,
    phaseStart: 0,
    phaseDuration: DECISION_SLOW,
  };

  canvas = $('arena');
  ctx = canvas.getContext('2d');
  screenBattle = $('screen-battle');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  anim = newAnimState();

  setupPanel(1);
  setupPanel(2);
  $('log').innerHTML = '';
  $('banner').hidden = true;
  $('gameover').hidden = true;

  if (isMachine) $('panel-2').classList.add('hidden-panel');
  else $('panel-2').classList.remove('hidden-panel');
  $('panel-2-head').textContent = isMachine ? 'MÁQUINA' : 'JOGADOR 2';

  refreshHUD();
  startDecision();
}

function resizeCanvas() {
  if (!canvas || !screenBattle) return;
  const rect = $('arena-row').getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(50, Math.floor(rect.width * dpr));
  canvas.height = Math.max(50, Math.floor((rect.height * dpr)));
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
}

function newAnimState() {
  return {
    off: { p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 } },
    shake: { p1: 0, p2: 0 },
    projectiles: [],
    rings: [],
    particles: [],
    bannerFlash: 0,
  };
}

/* ---------------- HUD / Painéis ---------------- */
function refreshHUD() {
  const p1 = game.players.p1, p2 = game.players.p2;
  $('p1-hud-name').textContent = `${p1.name} · ${ELEMENTS[p1.element].nome}`;
  $('p1-hud-name').style.color = ELEMENTS[p1.element].cor;
  $('p2-hud-name').textContent = `${p2.name} · ${ELEMENTS[p2.element].nome}`;
  $('p2-hud-name').style.color = ELEMENTS[p2.element].cor;

  $('p1-hp-fill').style.width = (p1.hp / p1.maxHp * 100) + '%';
  $('p2-hp-fill').style.width = (p2.hp / p2.maxHp * 100) + '%';

  $('p1-hud-meta').innerHTML = hudMeta(p1);
  $('p2-hud-meta').innerHTML = hudMeta(p2);
  $('phase-label').textContent = game.state === 'decision'
    ? (game.frenzy ? 'FRENESI! Escolham rápido!' : 'Escolham suas ações!')
    : 'Resolvendo...';
}

function hudMeta(p) {
  const chips = ACTION_ORDER.map(a => {
    const tag = a === 'ataque' ? 'Atk' : a === 'defesa' ? 'Def' : a === 'projetil' ? 'Proj' : 'Ref';
    return `<span class="chip ${p.counts[a] === 0 ? 'out' : ''}">${tag} <span class="num">${p.counts[a]}</span></span>`;
  }).join('');
  const combo = `<span class="chip ${p.combos === 0 ? 'out' : ''}">Combo <span class="num">${p.combos}</span></span>`;
  const hp = `<span class="chip">HP <span class="num">${Math.max(0, p.hp)}</span></span>`;
  const fire = p.element === 'fogo'
    ? `<span class="chip" style="color:#ffd08a">dano projétil <span class="num">${BASE_DMG + p.fireBonus}</span></span>`
    : '';
  const el = `<span class="chip" style="color:${ELEMENTS[p.element].cor}">${ELEMENTS[p.element].nome}</span>`;
  return el + hp + chips + combo + fire;
}

function setupPanel(n) {
  const panelKey = 'p' + n;
  const box = $('buttons-' + n);
  box.innerHTML = '';
  const player = game.players[panelKey];
  const isAI = player.isAI;

  for (const a of ACTION_ORDER) {
    const b = document.createElement('button');
    b.className = 'action-btn';
    b.dataset.act = a;
    b.dataset.player = panelKey;
    b.innerHTML = `<span class="act-nome">${ACTIONS[a].nome}</span>
      <span class="key">[${KEY_LABEL[panelKey][a]}]</span>
      <span class="count">×${player.counts[a]}</span>`;
    b.disabled = isAI;
    b.addEventListener('click', () => onPickAction(panelKey, a));
    box.appendChild(b);
  }

  const comboBtn = document.createElement('button');
  comboBtn.className = 'action-btn combo-btn';
  comboBtn.dataset.act = 'combo';
  comboBtn.dataset.player = panelKey;
  comboBtn.id = panelKey + '-combo-btn';
  comboBtn.innerHTML = `<span class="act-nome">Combo</span>
    <span class="key">[${KEY_LABEL[panelKey].combo}]</span>
    <span class="count" id="${panelKey}-combo-count">×${player.combos}</span>`;
  comboBtn.disabled = isAI;
  comboBtn.addEventListener('click', () => onPickCombo(panelKey));
  box.appendChild(comboBtn);

  const okBtn = $('ok-' + n);
  okBtn.disabled = isAI;
  okBtn.innerHTML = `OK [${KEY_LABEL[panelKey].ok}]`;
  okBtn.classList.remove('confirmed');
}

function refreshPanel(playerKey) {
  const p = game.players[playerKey];
  const box = $('buttons-' + (playerKey === 'p1' ? 1 : 2));
  const selected = $('selected-' + (playerKey === 'p1' ? 1 : 2));

  box.querySelectorAll('.action-btn').forEach(btn => {
    const act = btn.dataset.act;
    const isCombo = act === 'combo';
    const picked = isCombo ? p.selection.combo : p.selection.actions.includes(act);
    btn.classList.toggle('picked', picked);
    btn.classList.toggle('combo-picked', isCombo && picked);
    btn.classList.toggle('slot0', !isCombo && p.selection.actions[0] === act);
    btn.classList.toggle('slot1', !isCombo && p.selection.actions[1] === act);

    if (!p.confirmed && !p.isAI) {
      if (isCombo) {
        btn.disabled = p.combos <= 0;
      } else {
        const instances = p.selection.actions.filter(x => x === act).length;
        const slotFree = p.selection.actions.length < (p.selection.combo ? MAX_TOP_ACTIONS : 1);
        btn.disabled = (instances === 0 && !slotFree) || p.counts[act] <= 0;
      }
      btn.style.opacity = '';
    } else {
      btn.disabled = true;
    }

    if (!isCombo) {
      const countEl = btn.querySelector('.count');
      if (countEl) countEl.textContent = '×' + p.counts[act];
    }
  });

  const comboCount = $(`${playerKey}-combo-count`);
  if (comboCount) comboCount.textContent = '×' + p.combos;

  let html = '';
  p.selection.actions.forEach((a, i) => {
    html += `<span class="slot-tag slot${i}">${i + 1}. ${ACTIONS[a].nome}</span>`;
  });
  if (p.selection.combo) html += `<span class="slot-tag" style="color:var(--accent)">COMBO</span>`;
  if (p.confirmed && !p.isAI) html += `<span class="slot-tag" style="color:var(--good)">✓ confirmado</span>`;
  selected.innerHTML = html;

  const okBtn = $('ok-' + (playerKey === 'p1' ? 1 : 2));
  okBtn.disabled = p.isAI || p.confirmed;
  okBtn.classList.toggle('confirmed', p.confirmed);
}

/* ---------------- Seleção de jogada ---------------- */
function onPickAction(playerKey, act) {
  ensureAudio();
  const p = game.players[playerKey];
  if (p.isAI || p.confirmed || game.state !== 'decision') return;
  const s = p.selection;

  sfx.click();
  const instances = s.actions.filter(x => x === act).length;
  if (instances === 0) {
    const max = s.combo ? MAX_TOP_ACTIONS : 1;
    if (s.actions.length >= max) {
      bannerText(s.combo ? 'Máximo de 2 ações por turno' : 'Ative o Combo para uma 2ª ação');
      return;
    }
    s.actions.push(act);
  } else if (s.combo && instances === 1 && s.actions.length < MAX_TOP_ACTIONS && p.counts[act] > instances) {
    s.actions.push(act);
  } else {
    s.actions.splice(s.actions.lastIndexOf(act), 1);
  }
  refreshPanel(playerKey);
  refreshHUD();
}

function onPickCombo(playerKey) {
  ensureAudio();
  const p = game.players[playerKey];
  if (p.isAI || p.confirmed || game.state !== 'decision') return;
  const s = p.selection;
  if (s.combo) {
    s.combo = false;
    if (s.actions.length > 1) s.actions = s.actions.slice(0, 1);
  } else {
    if (p.combos <= 0) return;
    s.combo = true;
  }
  sfx.click();
  refreshPanel(playerKey);
  refreshHUD();
}

function confirmPlayer(playerKey) {
  ensureAudio();
  const p = game.players[playerKey];
  if (p.isAI || p.confirmed || game.state !== 'decision') return;
  lockPlayer(playerKey);
  sfx.confirm();
  refreshHUD();
}

function lockPlayer(playerKey) {
  const p = game.players[playerKey];
  if (p.confirmed) return;
  p.confirmed = true;
  const s = p.selection;
  if (s.combo && s.actions.length > 0 && p.combos > 0) p.combos--;
  s.actions.forEach(a => {
    if (p.counts[a] > 0) p.counts[a]--;
  });
  refreshPanel(playerKey);
}

/* ---------------- Turno de decisão ---------------- */
function startDecision() {
  const p1 = game.players.p1, p2 = game.players.p2;
  game.state = 'decision';
  game.phaseDuration = game.frenzy ? DECISION_FAST : DECISION_SLOW;
  game.phaseStart = performance.now();

  ACTION_ORDER.forEach(a => {
    if (p1.counts[a] === 0) p1.counts[a] = USE_PER_ACTION;
    if (p2.counts[a] === 0) p2.counts[a] = USE_PER_ACTION;
  });

  p1.selection = { combo: false, actions: [] };
  p2.selection = { combo: false, actions: [] };
  p1.confirmed = false;
  p2.confirmed = false;

  refreshPanel('p1');
  refreshPanel('p2');
  refreshHUD();

  if (game.mode === 'machine') {
    const think = 700 + Math.random() * 900;
    setTimeout(() => {
      if (game && game.state === 'decision' && !game.players.p2.confirmed) {
        aiLock(game.players.p2);
      }
    }, think);
  }
}

function aiLock(p) {
  aiThink(p);
  lockPlayer(p.key);
  refreshHUD();
}

function aiThink(p) {
  const opp = game.players[p1Key(p)];
  const freq = { ataque: 0, defesa: 0, projetil: 0, refletir: 0 };
  opp.lastActions.forEach(a => { if (a in freq) freq[a]++; });

  const counters = {
    ataque: ['defesa'],
    defesa: ['projetil'],
    projetil: ['refletir', 'ataque'],
    refletir: ['ataque', 'defesa'],
  };
  const predicted = weightedRandom(freq);
  let first = pick(counters[predicted]);
  if (Math.random() < 0.3) first = pick(ACTION_ORDER);
  first = availableAction(p, first);

  p.selection = { combo: false, actions: [first] };

  if (p.combos > 0 && Math.random() < 0.28) {
    p.selection.combo = true;
    const second = availableAction(p, null, first);
    if (second) p.selection.actions.push(second);
  }
}

function p1Key(x) { return x.key === 'p1' ? 'p2' : 'p1'; }

function availableAction(p, preferred, exclude) {
  const skipRepetir = exclude && p.counts[exclude] < 2;
  const opts = ACTION_ORDER.filter(a => p.counts[a] > 0 && (!skipRepetir || a !== exclude));
  if (opts.length === 0) return null;
  if (preferred && opts.includes(preferred)) return preferred;
  return pick(opts);
}

/* ---------------- Resolução ---------------- */
function planRound() {
  const p1 = game.players.p1, p2 = game.players.p2;
  const events = [];
  const n = Math.max(p1.selection.actions.length, p2.selection.actions.length);
  for (let i = 0; i < n; i++) {
    const a = p1.selection.actions[i];
    const b = p2.selection.actions[i];
    if (a && b) {
      const r = resolveDuel('p1', a, 'p2', b);
      if (r.none) events.push({ kind: 'none' });
      else if (r.clash) {
        events.push({ kind: 'hit', winner: 'p1', loser: 'p2', action: 'ataque', beaten: 'ataque', dmg: calcDamage(p1, 'ataque', 'ataque'), clash: true });
        events.push({ kind: 'hit', winner: 'p2', loser: 'p1', action: 'ataque', beaten: 'ataque', dmg: calcDamage(p2, 'ataque', 'ataque'), clash: true });
      } else {
        const W = r.winner === 'p1' ? p1 : p2;
        const act = r.winnerAct, beat = r.winnerBeaten;
        events.push({
          kind: act === 'refletir' ? 'reflect' : 'hit',
          winner: r.winner, loser: r.loser,
          action: act, beaten: beat,
          dmg: calcDamage(W, act, beat),
        });
      }
    } else if (a && (a === 'ataque' || a === 'projetil')) {
      events.push({ kind: 'hit', winner: 'p1', loser: 'p2', action: a, beaten: '', dmg: calcDamage(p1, a, '') });
    } else if (b && (b === 'ataque' || b === 'projetil')) {
      events.push({ kind: 'hit', winner: 'p2', loser: 'p1', action: b, beaten: '', dmg: calcDamage(p2, b, '') });
    } else {
      events.push({ kind: 'none' });
    }
  }
  return events;
}

function resolveDuel(aKey, aAct, bKey, bAct) {
  if (aAct === bAct) {
    if (aAct === 'ataque') return { clash: true };
    return { none: true };
  }
  let winner = null;         // 'a' | 'b'
  let winnerAct = null, winnerBeaten = null;
  if (aAct === 'ataque' && (bAct === 'projetil' || bAct === 'refletir')) { winner = 'a'; }
  if (aAct === 'defesa' && (bAct === 'ataque' || bAct === 'refletir')) { winner = 'a'; }
  if (aAct === 'projetil' && bAct === 'defesa') { winner = 'a'; }
  if (aAct === 'refletir' && bAct === 'projetil') { winner = 'a'; }
  if (bAct === 'ataque' && (aAct === 'projetil' || aAct === 'refletir')) { winner = 'b'; }
  if (bAct === 'defesa' && (aAct === 'ataque' || aAct === 'refletir')) { winner = 'b'; }
  if (bAct === 'projetil' && aAct === 'defesa') { winner = 'b'; }
  if (bAct === 'refletir' && aAct === 'projetil') { winner = 'b'; }
  if (!winner) return { none: true };

  if (winner === 'a') { winnerAct = aAct; winnerBeaten = bAct; }
  else { winnerAct = bAct; winnerBeaten = aAct; }

  return {
    winner: winner === 'a' ? aKey : bKey,
    loser: winner === 'a' ? bKey : aKey,
    winnerAct, winnerBeaten,
  };
}

/* ---------------- Dano e vantagens das bolas ---------------- */
function calcDamage(attacker, action, beaten) {
  const el = attacker.element;
  const base = BASE_DMG;
  if (action === 'ataque') {
    if (el === 'pedra') return base * 2;
    if (el === 'ar' && beaten === 'projetil') return base + 1;
    return base;
  }
  if (action === 'projetil') {
    if (el === 'fogo') return base + attacker.fireBonus;
    if (el === 'ar' && beaten === 'defesa') return base + 2;
    return base;
  }
  if (action === 'refletir') {
    if (el === 'agua') return base * 2;
    if (el === 'ar') return base + 2;
    return base;
  }
  return base; // defesa contra ataque/refletir
}

function applyDamage(player, dmg) {
  player.hp = Math.max(0, player.hp - dmg);
  refreshHUD();
  return player.hp;
}

/* ---------------- Playback dos eventos ---------------- */
async function startResolve() {
  if (game.state !== 'decision') return;
  game.state = 'resolve';
  game.turns++;
  animatePhaseLabel('Resolvendo...');
  const events = planRound();

  for (const ev of events) {
    if (game.state === 'over') return;
    await playEvent(ev);
  }
  endRound();
}

async function playEvent(ev) {
  if (ev.kind === 'none') {
    await delay(350);
    return;
  }
  const W = game.players[ev.winner];
  const L = game.players[ev.loser];
  const act = ev.action;
  const dmg = ev.dmg;

  if (ev.kind === 'reflect') {
    /* projétil inimigo viaja até o refletor e volta */
    sfx.whoosh();
    await shootProjectile(ev.loser, ev.winner, '#ffd23f');
    sfx.reflect();
    await shootProjectile(ev.winner, ev.loser, ELEMENTS[W.element].cor, true);
    impact(ev.loser, ELEMENTS[W.element].cor);
  } else if (act === 'defesa') {
    /* o agressor ataca, a defesa bloqueia e contra-ataca */
    sfx.whoosh();
    await lunge(ev.loser);
    sfx.block();
    shieldFlash(ev.winner, W.element);
    impact(ev.loser, ELEMENTS[W.element].cor);
  } else if (act === 'ataque') {
    sfx.whoosh();
    await lunge(ev.winner);
    sfx.hit();
  } else {
    /* projetil */
    sfx.whoosh();
    await shootProjectile(ev.winner, ev.loser, ELEMENTS[W.element].cor);
    sfx.hit();
  }

  applyDamage(L, dmg);

  /* Fogo: +2 permanente em todo projétil que acerta */
  if (act === 'projetil' && W.element === 'fogo') {
    W.fireBonus += 2;
    log(`<span class="log-entry big">${W.name} (Fogo): projéteis agora causam ${BASE_DMG + W.fireBonus} de dano!</span>`);
    refreshHUD();
  }

  logStruggle(ev);
  await delay(450);
}

function logStruggle(ev) {
  if (ev.kind === 'none') { log(`<span class="log-entry">Nenhuma ação efetiva.</span>`); return; }
  const W = game.players[ev.winner], L = game.players[ev.loser];
  const wEl = ELEMENTS[W.element], lEl = ELEMENTS[L.element];
  const wName = `<b style="color:${wEl.cor}">${W.name} (${wEl.nome})</b>`;
  const lName = `<b style="color:${lEl.cor}">${L.name} (${lEl.nome})</b>`;
  const actFull = ev.clash ? 'Ataque' : ACTIONS[ev.action].nome;
  const dmgColor = ev.dmg > BASE_DMG ? 'big' : 'dmg';
  const line = ev.clash
    ? `Choque de ataques entre ${wName} e ${lName}!`
    : `${wName} usa <b>${actFull}</b> contra ${lName}${ev.beaten ? ' (respondeu ' + ACTIONS[ev.beaten].nome + ')' : ''}.`;
  log(`<span class="log-entry">${line}</span>`);
  log(`<span class="log-entry ${dmgColor}"> → -${ev.dmg} de dano em ${lName}.</span>`);
}

/* ---------------- Fim do turno / partida ---------------- */
function endRound() {
  const p1 = game.players.p1, p2 = game.players.p2;

  /* memória do que cada um fez (usada pela máquina) */
  p1.selection.actions.forEach(a => p1.lastActions.push(a));
  p2.selection.actions.forEach(a => p2.lastActions.push(a));
  p1.lastActions = p1.lastActions.slice(-6);
  p2.lastActions = p2.lastActions.slice(-6);

  if (p1.hp <= 0 || p2.hp <= 0) {
    game.state = 'over';
    finishMatch();
    return;
  }

  if (!game.frenzy && (p1.hp <= p1.maxHp / 2 || p2.hp <= p2.maxHp / 2)) {
    game.frenzy = true;
    sfx.frenzy();
    document.body.classList.add('frenzy');
    bannerText('FRENESI! Tempo caiu para 3s!', 1600);
    log(`<span class="log-entry big">FRENESI! Um jogador chegou à metade da vida. Apenas 3 segundos por turno!</span>`);
  }

  animatePhaseLabel(`Fim do turno ${game.turns}.`);
  refreshHUD();
  setTimeout(startDecision, 1100);
}

function finishMatch() {
  const p1 = game.players.p1, p2 = game.players.p2;
  const winner = p1.hp > 0 ? p1 : p2;
  const loser = winner === p1 ? p2 : p1;
  $('gameover').hidden = false;
  $('result-title').textContent = `${winner.name} (${ELEMENTS[winner.element].nome}) venceu!`;
  $('result-sub').textContent =
    `Após ${game.turns} turnos, ${loser.name} ficou com ${loser.hp} HP.`;
  const isHumanWinner = !winner.isAI;
  (isHumanWinner ? sfx.win : sfx.lose)();
  bannerText(`${winner.name} venceu!`, 2400);
}

function rematch() {
  $('gameover').hidden = true;
  const mode = game ? game.mode : currentMode;
  game = null;
  startSelect(mode);
}

/* ---------------- Log ---------------- */
function log(html) {
  const box = $('log');
  const div = document.createElement('div');
  div.innerHTML = html;
  box.prepend(div);
}

function bannerText(text, ms) {
  const b = $('banner');
  b.textContent = text;
  b.hidden = false;
  b.style.opacity = '1';
  setTimeout(() => { b.style.opacity = '0'; setTimeout(() => (b.hidden = true), 300); }, ms || 1200);
}

function animatePhaseLabel(text) {
  const el = $('phase-label');
  el.textContent = text;
}

/* ---------------- Teclado ---------------- */
window.addEventListener('keydown', ev => {
  ensureAudio();
  if (!game || game.state !== 'decision') return;
  const k = ev.code;
  if (k === 'Space') return;
  for (const pk of ['p1', 'p2']) {
    const player = game.players[pk];
    if (player.isAI) continue;
    const map = KEYS[pk];
    if (k === map.ataque) { ev.preventDefault(); onPickAction(pk, 'ataque'); }
    else if (k === map.defesa) { ev.preventDefault(); onPickAction(pk, 'defesa'); }
    else if (k === map.projetil) { ev.preventDefault(); onPickAction(pk, 'projetil'); }
    else if (k === map.refletir) { ev.preventDefault(); onPickAction(pk, 'refletir'); }
    else if (k === map.combo) { ev.preventDefault(); onPickCombo(pk); }
    else if (k === map.ok) { ev.preventDefault(); confirmPlayer(pk); }
  }
});

/* ---------------- Loops principais ---------------- */
function frame(now) {
  requestAnimationFrame(frame);
  if (game) {
    if (game.state === 'decision' && now) {
      const remaining = game.phaseStart + game.phaseDuration - now;
      const secs = Math.ceil(remaining / 1000);
      const el = $('timer-label');
      el.textContent = secs;
      el.classList.toggle('tight', remaining < 1000 || game.frenzy);
      if (remaining <= 0) {
        if (!game.players.p1.confirmed) lockPlayer('p1');
        if (!game.players.p2.confirmed) {
          if (game.players.p2.isAI) aiLock(game.players.p2);
          else lockPlayer('p2');
        }
        startResolve();
      } else {
        const p1c = game.players.p1.confirmed, p2c = game.players.p2.confirmed;
        if (p1c && p2c) {
          if (game.mode === 'hotseat' || game.players.p2.isAI) startResolve();
        }
      }
    } else if (game.state === 'resolve' || game.state === 'over') {
      const el = $('timer-label');
      el.textContent = '--';
      el.classList.remove('tight');
    }
  }
  if (anim && ctx && canvas && screenBattle && !screenBattle.hidden) draw(now);
}
requestAnimationFrame(frame);

/* ============================================================
   ARENA / Desenho
   ============================================================ */
function ballMetrics(key) {
  const w = canvas.width, h = canvas.height;
  const r = Math.min(w, h) * 0.14;
  return { x: key === 'p1' ? w * 0.2 : w * 0.8, y: h * 0.58, r };
}

function ballPos(key, t) {
  const m = ballMetrics(key);
  const bobbing = Math.sin(t * 0.0022 + (key === 'p1' ? 0 : Math.PI)) * 6;
  return { x: m.x + anim.off[key].x, y: m.y + bobbing + anim.off[key].y };
}

async function lunge(key) {
  const dir = key === 'p1' ? 1 : -1;
  await tween(230, p => {
    anim.off[key].x = dir * 64 * Math.sin(p * Math.PI);
    anim.off[key].y = -42 * Math.sin(p * Math.PI);
  });
  anim.off[key].x = 0;
  anim.off[key].y = 0;
}

function shieldFlash(key, element) {
  const m = ballMetrics(key);
  anim.rings.push({
    x: m.x, y: m.y, r: m.r * 0.6, vr: m.r * 4, alpha: 1,
    color: ELEMENTS[element] ? ELEMENTS[element].glow : '#66ccff', width: 6,
  });
}

function impact(key, color) {
  anim.shake[key] = 14;
  const m = ballMetrics(key);
  const x = m.x, y = m.y;
  anim.rings.push({ x, y, r: m.r * 0.4, vr: m.r * 5.5, alpha: 0.9, color, width: 8 });
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 40 + Math.random() * 160;
    anim.particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 1, maxLife: 1, color, size: 2 + Math.random() * 4,
    });
  }
}

async function shootProjectile(fromKey, toKey, color, reflected) {
  const f = ballMetrics(fromKey), t = ballMetrics(toKey);
  const rnd = { x: 0, y: 0, color, trail: [], trailOffset: 0 };
  rnd.x = f.x;
  rnd.y = f.y;
  anim.projectiles.push(rnd);
  const dist = Math.hypot(t.x - f.x, t.y - f.y);
  const dur = clamp(dist / 1000, 0.32, 0.6) * 1000;
  const SPEED = reflected ? 1.5 : 1;
  await tween(dur / SPEED, p => {
    const tx = f.x + (t.x - f.x) * p;
    const ty = f.y + (t.y - f.y) * p;
    rnd.x = tx;
    rnd.y = ty;
    rnd.trail.push({ x: tx, y: ty, life: 1 });
    if (rnd.trail.length > 8) rnd.trail.shift();
  });
  rnd.trail.forEach(tr => (tr.life = 0));
  const idx = anim.projectiles.indexOf(rnd);
  if (idx >= 0) anim.projectiles.splice(idx, 1);
  impact(toKey, color);
}

/* desenho */
function draw(now) {
  const w = canvas.width, h = canvas.height;
  const t = now || performance.now();
  if (anim === null) return;

  /* shake decai */
  anim.shake.p1 *= 0.84;
  anim.shake.p2 *= 0.84;

  drawBackground(w, h);

  /* ambient particles por elemento */
  for (const key of ['p1', 'p2']) {
    const p = game ? game.players[key] : null;
    if (!p) continue;
    const pos = ballPos(key, t);
    const m = ballMetrics(key);
    const el = p.element;
    if (el === 'fogo' && Math.random() < 0.25) {
      anim.particles.push({
        x: pos.x + (Math.random() - 0.5) * m.r * 0.8,
        y: pos.y - m.r * 0.4,
        vx: (Math.random() - 0.5) * 30, vy: -30 - Math.random() * 50,
        life: 1, maxLife: 1, color: Math.random() < 0.5 ? '#ffb347' : '#ff6b35', size: 1.5 + Math.random() * 3,
      });
    }
    if (el === 'agua' && Math.random() < 0.06) {
      anim.rings.push({ x: pos.x, y: pos.y + m.r * 0.7, r: m.r * 0.4, vr: m.r * 2.5, alpha: 0.4, color: '#7fd0ff', width: 3 });
    }
  }

  /* partículas */
  anim.particles = anim.particles.filter(pt => pt.life > 0);
  for (const pt of anim.particles) {
    pt.x += pt.vx * 0.016;
    pt.y += pt.vy * 0.016;
    pt.vx *= 0.96;
    pt.vy *= 0.96;
    pt.life -= 0.02;
    ctx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, Math.max(0, pt.size * pt.life), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  /* anéis */
  anim.rings = anim.rings.filter(r => r.alpha > 0.02);
  for (const r of anim.rings) {
    r.r += r.vr * 0.016;
    r.alpha -= 0.028;
    ctx.globalAlpha = clamp(r.alpha, 0, 1);
    ctx.strokeStyle = r.color;
    ctx.lineWidth = r.width * r.alpha;
    ctx.beginPath();
    ctx.arc(r.x, r.y, Math.max(0, r.r), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  /* projéteis */
  for (const pr of anim.projectiles) {
    const dist = Math.hypot(pr.x - ballMetrics('p1').x, pr.y - ballMetrics('p1').y);
    for (const tr of pr.trail) {
      ctx.globalAlpha = tr.life * 0.4;
      ctx.fillStyle = pr.color;
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, 5 * tr.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const glow = 18 + Math.sin(t * 0.02) * 5;
    ctx.shadowColor = pr.color;
    ctx.shadowBlur = glow;
    ctx.fillStyle = pr.color;
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  /* bolas */
  if (game) {
    const p1 = game.players.p1, p2 = game.players.p2;
    drawBall(ctx, p1, ballPos('p1', t), t, p1.element);
    drawBall(ctx, p2, ballPos('p2', t), t, p2.element);
  }
}

function drawBackground(w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#171c3a');
  g.addColorStop(0.55, '#10142c');
  g.addColorStop(1, '#0a0c1f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  /* chão */
  ctx.fillStyle = '#ffffff08';
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 0.92, w * 0.42, h * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff22';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w * 0.08, h * 0.9);
  ctx.lineTo(w * 0.92, h * 0.9);
  ctx.stroke();

  /* bases */
  for (const key of ['p1', 'p2']) {
    const m = ballMetrics(key);
    ctx.strokeStyle = '#ffffff22';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(m.x, m.y + m.r * 0.75, m.r * 0.95, m.r * 0.28, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (game && game.frenzy && Math.random() < 0.4) {
    const sx = Math.random() * w, sy = Math.random() * h;
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = '#ff5c5c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + 6 - Math.random() * 12, sy + 6 - Math.random() * 12);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawBall(c, p, pos, t, el) {
  const m = ballMetrics(p.key);
  const r = m.r;
  const x = pos.x, y = pos.y;
  const shakeX = (Math.random() - 0.5) * anim.shake[p.key];
  const shakeY = (Math.random() - 0.5) * anim.shake[p.key];

  const data = ELEMENTS[el];
  const glowR = r * (el === 'fogo' ? (1.15 + Math.sin(t * 0.006) * 0.1) : 1.05);

  c.shadowColor = data.glow;
  c.shadowBlur = 22 + (el === 'fogo' ? Math.sin(t * 0.008) * 8 : 0) + (el === 'agua' ? Math.sin(t * 0.004 + 2) * 4 : 0);

  const grad = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, glowR);
  if (el === 'fogo') { grad.addColorStop(0, '#ffe6a6'); grad.addColorStop(0.5, '#ff8f3f'); grad.addColorStop(1, '#b32700'); }
  else if (el === 'pedra') { grad.addColorStop(0, '#dfe3ea'); grad.addColorStop(0.55, '#9aa3b1'); grad.addColorStop(1, '#4a505c'); }
  else if (el === 'agua') { grad.addColorStop(0, '#b7e8ff'); grad.addColorStop(0.55, '#3fa9ff'); grad.addColorStop(1, '#0a3f6b'); }
  else { grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.55, '#eef8ff'); grad.addColorStop(1, '#9db8cf'); }

  c.beginPath();
  c.arc(x + shakeX, y + shakeY, r, 0, Math.PI * 2);
  c.fillStyle = grad;
  c.fill();
  c.shadowBlur = 0;

  /* borda */
  c.strokeStyle = el === 'ar' ? '#ffffff88' : '#ffffff44';
  c.lineWidth = 2;
  c.stroke();

  /* brilho especular */
  c.fillStyle = '#ffffff55';
  c.beginPath();
  c.ellipse(x - r * 0.32 + shakeX, y - r * 0.4 + shakeY, r * 0.24, r * 0.14, -0.6, 0, Math.PI * 2);
  c.fill();

  /* detalhes por elemento */
  if (el === 'pedra') {
    c.fillStyle = '#00000022';
    for (const [dx, dy, dr] of [[0.2, 0.2, 0.18], [-0.3, 0.3, 0.14], [0.0, -0.1, 0.1]]) {
      c.beginPath();
      c.arc(x + shakeX + r * dx, y + shakeY + r * dy, r * dr, 0, Math.PI * 2);
      c.fill();
    }
  }
  if (el === 'agua') {
    c.strokeStyle = '#ffffffaa';
    c.lineWidth = 2;
    for (let k = 0; k < 2; k++) {
      const phase = t * 0.003 + k * 2.1;
      const wA = 0.6, lx = x + shakeX + Math.sin(phase * 0.01) * r * 0.1;
      c.globalAlpha = 0.4;
      c.beginPath();
      c.ellipse(lx, y + shakeY - r * 0.45 + k * r * 0.45, r * wA, r * 0.1, 0, 0, Math.PI * 2);
      c.stroke();
    }
    c.globalAlpha = 1;
  }
  if (el === 'ar') {
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.lineWidth = 3;
    c.setLineDash([8, 10]);
    c.lineDashOffset = -t * 0.05;
    c.beginPath();
    c.arc(x + shakeX, y + shakeY, r * 1.35, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
  }
}

/* ---------------- Sair/Fim ---------------- */
window.addEventListener('keydown', ev => {
  if (ev.code === 'Space' && !screenBattle) {
    ev.preventDefault();
  }
});

window.addEventListener('pointerdown', ensureAudio);

updateSettingsUI();