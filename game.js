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
           desc: 'Todo projétil acertado acumula +2 de stacks. A habilidade ativa Incineração consome os stacks e lança todo o dano acumulado.' },
  pedra: { nome: 'Pedra', cor: '#a8b0bd', glow: '#8a93a3',
           desc: 'Ataques causam dano dobrado.' },
  agua:  { nome: 'Água',  cor: '#35a7ff', glow: '#35a7ff',
           desc: 'Refletir uma habilidade inimiga causa dano dobrado.' },
ar:    { nome: 'Ar',    cor: '#eaf6ff', glow: '#cfe8ff',
            desc: '+1 de dano ao acertar um projétil, +2 ao acertar defesa ou ao refletir.' },
   raio:  { nome: 'Raio',  cor: '#b06bff', glow: '#b06bff',
            desc: 'Ao chegar à metade da vida, energiza. A habilidade ativa eletrocuta o inimigo (bloqueia 1 ação aleatória por 3 turnos) e concede dano dobrado permanente pelo resto da partida (uso único).' },
   tempo: { nome: 'Tempo', cor: '#35e0c0', glow: '#2dd4b3',
            desc: 'Passivo: reduz em 1 segundo o tempo do inimigo. Ganha 1 stack por ponto de dano sofrido (máx. 7). A habilidade Regenerar (uso único) cura 1 de vida por stack e faz o Tempo perder 1 de dano em todas as ações por 3 turnos.' },
};

const ACTIONS = {
  ataque:   { nome: 'Ataque',   cls: '', desc: 'Vence Projétil' },
  defesa:   { nome: 'Defesa',   cls: '', desc: 'Vence Ataque e Refletir · contra-ataca' },
  projetil: { nome: 'Projétil', cls: '', desc: 'Vence Defesa' },
  refletir: { nome: 'Refletir', cls: '', desc: 'Devolve Projétil contra quem lançou' },
  raio:    { nome: 'Raio',    cls: '', desc: 'Habilidade ativa: eletrocuta o inimigo, bloqueia 1 ação aleatória por 3 turnos e concede dano x2 permanente (uso único)' },
  incinerar: { nome: 'Incineração', cls: '', desc: 'Habilidade ativa (Fogo): consome os stacks e lança todo o dano acumulado no inimigo' },
  tempo:   { nome: 'Regenerar', cls: '', desc: 'Habilidade ativa (Tempo, uso único): consome os stacks e recupera 1 de vida por stack. Depois de usar, o Tempo perde 1 de dano em todas as ações por 3 turnos' },
};

const BASE_DMG = 2;
const MAX_HP = 20;
const DECISION_SLOW = 5000;
const DECISION_FAST = 3000;
const USE_PER_ACTION = 3;
const MAX_TOP_ACTIONS = 2;
const TEMPO_STACK_CAP = 7;            // máx. de stacks da bola Tempo
const TEMPO_HEAL_PER_STACK = 1;       // vida recuperada por stack na Regenerar

const KEYS = {
  p1: { ataque: 'KeyQ', defesa: 'KeyW', projetil: 'KeyE', refletir: 'KeyR', combo: 'KeyT', ok: 'KeyA' },
  p2: { ataque: 'KeyU', defesa: 'KeyI', projetil: 'KeyO', refletir: 'KeyP', combo: 'KeyK', ok: 'KeyL' },
};

const KEY_LABEL = {
  p1: { ataque: 'Q', defesa: 'W', projetil: 'E', refletir: 'R', combo: 'T', ok: 'A' },
  p2: { ataque: 'U', defesa: 'I', projetil: 'O', refletir: 'P', combo: 'K', ok: 'L' },
};

const ACTION_ORDER = ['ataque', 'defesa', 'projetil', 'refletir'];
const ACTIVE_ACTIONS = ['raio', 'incinerar', 'tempo'];
function isActiveAction(a) { return ACTIVE_ACTIONS.includes(a); }

/* ---------------- Estado geral ---------------- */
let game = null;        // dados da partida atual
let anim = null;        // estado de animação / desenho
let canvas = null, ctx = null;
let screenBattle = null;
let audioCtx = null;
let currentMode = 'hotseat';
let currentScreen = 'menu';

const $ = id => document.getElementById(id);

/* evita que cliques/toques rápidos no mesmo controle desfaçam a escolha */
const pickGuard = {};
function quickPick(key, ms) {
  const now = performance.now();
  const prev = pickGuard[key];
  pickGuard[key] = now;
  return prev !== undefined && now - prev < (ms || 350);
}

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
  zap:     () => { tone(160, 0.16, 'sawtooth', 0.14); tone(900, 0.06, 'sawtooth', 0.09, 0.05); tone(2400, 0.08, 'square', 0.06, 0.1); tone(300, 0.14, 'sawtooth', 0.1, 0.13); },
  burn:    () => { tone(90, 0.42, 'sawtooth', 0.16); tone(150, 0.36, 'sawtooth', 0.12, 0.08); tone(2100, 0.16, 'sine', 0.05, 0.06); },
  heal:    () => { tone(520, 0.12, 'sine', 0.12); tone(780, 0.18, 'sine', 0.1, 0.1); tone(1040, 0.22, 'sine', 0.08, 0.22); },
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
  if (quickPick('startSelect')) return;
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
    card.addEventListener('click', e => {
      if (e.detail > 1) return;
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
  if (quickPick('finishSelect:' + playerKey)) return;
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
    deadline: 0,          // fim da fase de decisão deste jogador (milissegundos)
    hp: MAX_HP,
    maxHp: MAX_HP,
    counts: { ataque: USE_PER_ACTION, defesa: USE_PER_ACTION, projetil: USE_PER_ACTION, refletir: USE_PER_ACTION },
    combos: 3,
    fireBonus: 0,
    charged: false,       // raio: energizada (habilidade disponível)
    chargedUsed: false,   // raio: habilidade ativa já foi usada (uso único)
    overPowered: false,   // raio: após eletrocutar, dano x2 permanente pelo resto da partida
    blockedAction: null,  // ação bloqueada por um Raio inimigo
    blockTurns: 0,        // turnos restantes do bloqueio
    blockTurn: 0,         // turno em que o bloqueio foi aplicado (não conta o próprio turno)
    tempoStacks: 0,       // tempo: stacks de dano sofrido (máx. 7)
    tempoHealUsed: false, // tempo: Regenerar já foi usada (uso único por partida)
    tempoWeakTurns: 0,    // tempo: turnos restantes com -1 de dano
    tempoWeakTurn: 0,     // tempo: turno em que o debuff começou (não conta o próprio turno)
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
    lightnings: [],
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
  const block = p.blockedAction && p.blockTurns > 0 ? p.blockedAction : null;
  const chips = ACTION_ORDER.map(a => {
    const tag = a === 'ataque' ? 'Atk' : a === 'defesa' ? 'Def' : a === 'projetil' ? 'Proj' : 'Ref';
    return `<span class="chip ${p.counts[a] === 0 ? 'out' : ''}${a === block ? ' blocked' : ''}">${tag} <span class="num">${p.counts[a]}</span></span>`;
  }).join('');
  const combo = `<span class="chip ${p.combos === 0 ? 'out' : ''}">Combo <span class="num">${p.combos}</span></span>`;
  const hp = `<span class="chip">HP <span class="num">${Math.max(0, p.hp)}</span></span>`;
  const fire = p.element === 'fogo'
    ? `<span class="chip" style="color:#ffd08a">🔥 stacks <span class="num">${p.fireBonus}</span></span>`
    : '';
  const raio = p.element === 'raio'
    ? (p.overPowered
        ? `<span class="chip" style="color:#ffd23f">⚡ Dano x2 permanente</span>`
        : p.chargedUsed ? `<span class="chip">Carga usada</span>`
        : p.charged ? `<span class="chip" style="color:#ffd23f">⚡ Energizada</span>` : '')
    : '';
  const blockChip = block
    ? `<span class="chip blocked">⚡ ${ACTIONS[block].nome} (${p.blockTurns} turno${p.blockTurns > 1 ? 's' : ''})</span>`
    : '';
  const el = `<span class="chip" style="color:${ELEMENTS[p.element].cor}">${ELEMENTS[p.element].nome}</span>`;
  const tempo = p.element === 'tempo'
    ? `<span class="chip" style="color:#35e0c0">⏱ Inimigo -1s</span>`
      + (p.tempoHealUsed
        ? `<span class="chip">Regenerar usada</span>`
        : `<span class="chip" style="color:#7ff3dc">stacks <span class="num">${p.tempoStacks}</span></span>`)
      + (p.tempoWeakTurns > 0 ? `<span class="chip" style="color:#ffb0a0">-1 dano (${p.tempoWeakTurns})</span>` : '')
    : '';
  return blockChip + el + hp + chips + combo + fire + raio + tempo;
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
    b.addEventListener('click', e => {
      if (e.detail > 1) return;
      onPickAction(panelKey, a);
    });
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
  comboBtn.addEventListener('click', e => {
    if (e.detail > 1) return;
    onPickCombo(panelKey);
  });
  box.appendChild(comboBtn);

  const actives = player.element === 'raio' ? ['raio'] : player.element === 'fogo' ? ['incinerar'] : player.element === 'tempo' ? ['tempo'] : [];
  for (const act of actives) {
    const aBtn = document.createElement('button');
    aBtn.className = 'action-btn active-btn ' + (act === 'raio' ? 'thunder' : act === 'incinerar' ? 'fire' : 'tempo-ball');
    aBtn.dataset.act = act;
    aBtn.dataset.player = panelKey;
    aBtn.id = panelKey + '-' + act + '-btn';
    aBtn.innerHTML = `<span class="act-nome">${ACTIONS[act].nome}</span>
      <span class="key">[ativa]</span>
      <span class="count">×1</span>`;
    aBtn.disabled = true;
    aBtn.addEventListener('click', e => {
      if (e.detail > 1) return;
      onPickAction(panelKey, act);
    });
    box.appendChild(aBtn);
  }

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
    const isAct = isActiveAction(act);
    const picked = isCombo ? p.selection.combo : p.selection.actions.includes(act);
    const activeBlock = !isCombo && !isAct && p.blockedAction === act && p.blockTurns > 0;
    btn.classList.toggle('picked', picked);
    btn.classList.toggle('combo-picked', isCombo && picked);
    btn.classList.toggle('blocked', activeBlock);
    btn.classList.toggle('slot0', !isCombo && p.selection.actions[0] === act);
    btn.classList.toggle('slot1', !isCombo && p.selection.actions[1] === act);

    if (!p.confirmed && !p.isAI) {
      if (isCombo) {
        btn.disabled = p.combos <= 0;
      } else if (isAct) {
        const ready = act === 'raio' ? p.charged : act === 'incinerar' ? p.fireBonus > 0 : (p.tempoStacks > 0 && !p.tempoHealUsed);
        const slotFree = p.selection.actions.length < (p.selection.combo ? MAX_TOP_ACTIONS : 1);
        btn.disabled = !ready || (!p.selection.actions.includes(act) && !slotFree);
      } else {
        const instances = p.selection.actions.filter(x => x === act).length;
        if (p.selection.combo) {
          const slotFree = p.selection.actions.length < MAX_TOP_ACTIONS;
          btn.disabled = (instances === 0 && !slotFree) || p.counts[act] <= 0 || activeBlock;
        } else {
          btn.disabled = p.counts[act] <= 0 || activeBlock;
        }
      }
      btn.style.opacity = '';
    } else {
      btn.disabled = true;
    }

    if (!isCombo && !isAct) {
      const countEl = btn.querySelector('.count');
      if (countEl) countEl.textContent = '×' + p.counts[act];
    } else if (isAct && act === 'tempo' && p.tempoHealUsed) {
      const countEl = btn.querySelector('.count');
      if (countEl) countEl.textContent = '×0';
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
  const quick = quickPick(playerKey + ':' + act);

  sfx.click();
  if (p.blockedAction === act && p.blockTurns > 0) {
    bannerText(`${ACTIONS[act].nome} está bloqueada pelo Raio!`);
    return;
  }
  if (isActiveAction(act)) {
    if (s.actions.includes(act)) {
      if (quick) return;
      s.actions = s.actions.filter(x => x !== act);
    } else {
      const max = s.combo ? MAX_TOP_ACTIONS : 1;
      if (s.actions.length >= max) {
        bannerText(s.combo ? 'Máximo de 2 ações por turno' : 'Ative o Combo para uma 2ª ação');
        return;
      }
      s.actions.push(act);
    }
    refreshPanel(playerKey);
    refreshHUD();
    return;
  }

  const instances = s.actions.filter(x => x === act).length;
  if (!s.combo) {
    /* escolha única: a última ação clicada prevalece (não é preciso desmarcar antes) */
    if (instances === 0) {
      if (p.counts[act] <= 0) return;
      s.actions = [act];
    } else {
      if (quick) return;
      s.actions.splice(s.actions.lastIndexOf(act), 1);
    }
    refreshPanel(playerKey);
    refreshHUD();
    return;
  }

  if (instances === 0) {
    if (s.actions.length >= MAX_TOP_ACTIONS) {
      bannerText('Máximo de 2 ações por turno');
      return;
    }
    s.actions.push(act);
  } else if (instances === 1 && s.actions.length < MAX_TOP_ACTIONS && p.counts[act] > instances) {
    s.actions.push(act);
  } else {
    if (quick) return;
    s.actions.splice(s.actions.lastIndexOf(act), 1);
  }
  refreshPanel(playerKey);
  refreshHUD();
}

function onPickCombo(playerKey) {
  ensureAudio();
  const p = game.players[playerKey];
  if (p.isAI || p.confirmed || game.state !== 'decision') return;
  if (quickPick('combo:' + playerKey)) return;
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
  if (s.actions.includes('raio') && p.element === 'raio' && p.charged) {
    p.charged = false;
    p.chargedUsed = true;
    p.overPowered = true;
  }
  if (s.combo && s.actions.length > 0 && p.combos > 0) p.combos--;
  s.actions.forEach(a => {
    if (p.counts[a] > 0) p.counts[a]--;
  });
  refreshPanel(playerKey);
}

function decisionTimeFor(p) {
  const opp = game.players[p1Key(p)];
  let ms = game.frenzy ? DECISION_FAST : DECISION_SLOW;
  if (opp.element === 'tempo') ms -= 1000;
  return Math.max(1000, ms);
}

/* ---------------- Turno de decisão ---------------- */
function startDecision() {
  const p1 = game.players.p1, p2 = game.players.p2;
  game.state = 'decision';
  game.phaseStart = performance.now();
  p1.deadline = game.phaseStart + decisionTimeFor(p1);
  p2.deadline = game.phaseStart + decisionTimeFor(p2);
  game.phaseDuration = Math.min(p1.deadline, p2.deadline) - game.phaseStart;

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
  updateCharge();

  if (game.mode === 'machine') {
    const think = 700 + Math.random() * 900;
    setTimeout(() => {
      if (game && game.state === 'decision' && !game.players.p2.confirmed) {
        aiLock(game.players.p2);
      }
    }, think);
  }
}

function updateCharge() {
  for (const k of ['p1', 'p2']) {
    const p = game.players[k];
    if (p.element === 'raio' && !p.chargedUsed && !p.charged && p.hp <= p.maxHp / 2) {
      p.charged = true;
      sfx.zap();
      bannerText(`⚡ ${p.name} ENERGIZOU! Habilidade Raio pronta!`, 1800);
      log(`<span class="log-entry big">⚡ ${p.name} (Raio): energizou! Usar a habilidade no turno eletrocuta o inimigo (bloqueia 1 ação aleatória por 3 turnos) e concede <b>dano x2 permanente</b> pelo resto da partida.</span>`);
      refreshPanel(k);
      refreshHUD();
    }
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

  if (p.element === 'fogo' && p.fireBonus >= 4 && Math.random() < 0.5) {
    p.selection = { combo: false, actions: ['incinerar'] };
    return;
  }

  if (p.element === 'raio' && p.charged && Math.random() < 0.7) {
    p.selection = { combo: false, actions: ['raio'] };
    return;
  }

  if (p.element === 'tempo' && !p.tempoHealUsed && p.tempoStacks >= 4 && Math.random() < 0.6) {
    p.selection = { combo: false, actions: ['tempo'] };
    return;
  }

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
  const blocked = p.blockedAction && p.blockTurns > 0;
  const opts = ACTION_ORDER.filter(a =>
    p.counts[a] > 0 &&
    (!skipRepetir || a !== exclude) &&
    !(blocked && a === p.blockedAction));
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
      if (isActiveAction(a) || isActiveAction(b)) {
        if (isActiveAction(a)) events.push(activeEvent('p1', 'p2', a));
        if (isActiveAction(b)) events.push(activeEvent('p2', 'p1', b));
        if (isActiveAction(a) && isActiveAction(b)) continue;
        const channel = isActiveAction(a) ? 'p1' : 'p2';
        const other = isActiveAction(a) ? 'p2' : 'p1';
        const otherAct = isActiveAction(a) ? b : a;
        if (otherAct === 'ataque' || otherAct === 'projetil') {
          events.push({ kind: 'hit', winner: other, loser: channel, action: otherAct, beaten: '', dmg: calcDamage(game.players[other], otherAct, '') });
        } else {
          events.push({ kind: 'none' });
        }
      } else {
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
      }
    } else if (a) {
      if (isActiveAction(a)) events.push(activeEvent('p1', 'p2', a));
      else if (a === 'ataque' || a === 'projetil') events.push({ kind: 'hit', winner: 'p1', loser: 'p2', action: a, beaten: '', dmg: calcDamage(p1, a, '') });
      else events.push({ kind: 'none' });
    } else if (b) {
      if (isActiveAction(b)) events.push(activeEvent('p2', 'p1', b));
      else if (b === 'ataque' || b === 'projetil') events.push({ kind: 'hit', winner: 'p2', loser: 'p1', action: b, beaten: '', dmg: calcDamage(p2, b, '') });
      else events.push({ kind: 'none' });
    } else {
      events.push({ kind: 'none' });
    }
  }
  return events;
}

function activeEvent(winner, loser, act) {
  if (act === 'raio') return { kind: 'zap', winner, loser };
  if (act === 'incinerar') return { kind: 'burn', winner, loser };
  if (act === 'tempo') return { kind: 'heal', winner, loser };
  return { kind: 'none', winner, loser };
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
  const base = BASE_DMG;
  let dmg;
  if (action === 'ataque') {
    if (attacker.element === 'pedra') dmg = base * 2;
    else if (attacker.element === 'ar' && beaten === 'projetil') dmg = base + 1;
    else dmg = base;
  } else if (action === 'projetil') {
    if (attacker.element === 'ar' && beaten === 'defesa') dmg = base + 2;
    else dmg = base;
  } else if (action === 'refletir') {
    if (attacker.element === 'agua') dmg = base * 2;
    else if (attacker.element === 'ar') dmg = base + 2;
    else dmg = base;
  } else {
    dmg = base;
  }
  if (attacker.element === 'raio' && attacker.overPowered) dmg *= 2;
  if (attacker.element === 'tempo' && attacker.tempoWeakTurns > 0) dmg = Math.max(1, dmg - 1);
  return dmg;
}

function applyDamage(player, dmg) {
  player.hp = Math.max(0, player.hp - dmg);
  refreshHUD();
  return player.hp;
}

function applyBlock(target) {
  const usable = ACTION_ORDER.filter(a => target.counts[a] > 0);
  const pool = usable.length ? usable : ACTION_ORDER.slice();
  target.blockedAction = pick(pool);
  target.blockTurns = 3;
  target.blockTurn = game.turns;
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
  if (ev.kind === 'zap') {
    const W = game.players[ev.winner], L = game.players[ev.loser];
    sfx.zap();
    lightningBolt(ev.winner, ev.loser, ELEMENTS[W.element].cor);
    applyBlock(L);
    log(`<span class="log-entry big">⚡ ${W.name} (Raio) eletrocuta <b>${L.name}</b>! Ação <b>${ACTIONS[L.blockedAction].nome}</b> bloqueada por 3 turnos e dano x2 permanente para ${W.name}!</span>`);
    await delay(550);
    return;
  }
  if (ev.kind === 'burn') {
    const W = game.players[ev.winner], L = game.players[ev.loser];
    const stored = W.fireBonus;
    sfx.burn();
    incinerateFx(ev.loser);
    applyDamage(L, stored);
    W.fireBonus = 0;
    if (L.element === 'tempo' && stored > 0 && L.tempoStacks < TEMPO_STACK_CAP) {
      L.tempoStacks = Math.min(TEMPO_STACK_CAP, L.tempoStacks + stored);
    }
    log(`<span class="log-entry big">🔥 ${W.name} (Fogo) lança <b>Incineração</b>: -${stored} de dano em ${L.name}. Stacks zerados.</span>`);
    refreshHUD();
    await delay(500);
    return;
  }
  if (ev.kind === 'heal') {
    const W = game.players[ev.winner];
    const stacks = Math.min(TEMPO_STACK_CAP, W.tempoStacks);
    const heal = stacks * TEMPO_HEAL_PER_STACK;
    W.tempoStacks = 0;
    W.tempoHealUsed = true;
    sfx.heal();
    W.hp = Math.min(W.maxHp, W.hp + heal);
    W.tempoWeakTurns = 3;
    W.tempoWeakTurn = game.turns;
    log(`<span class="log-entry big">⏱ ${W.name} (Tempo) usa <b>Regenerar</b> (uso único): recupera +${heal} de vida. A energia do tempo se esgotou: dano -1 em todas as ações por 3 turnos.</span>`);
    refreshHUD();
    await delay(500);
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

  /* Fogo: +2 de stack em todo projétil que acerta (dano fica guardado p/ Incineração) */
  if (act === 'projetil' && W.element === 'fogo') {
    W.fireBonus += 2;
    log(`<span class="log-entry big">${W.name} (Fogo): +2 stacks! Incineração agora causa ${W.fireBonus} de dano.</span>`);
    refreshHUD();
  }

  /* Tempo: ganha stacks (máx. 7) conforme recebe dano */
  if (L.element === 'tempo' && dmg > 0 && L.tempoStacks < TEMPO_STACK_CAP) {
    L.tempoStacks = Math.min(TEMPO_STACK_CAP, L.tempoStacks + dmg);
    log(`<span class="log-entry big">${L.name} (Tempo): +${Math.min(dmg, TEMPO_STACK_CAP)} stacks! Regenerar agora cura ${L.tempoStacks} de vida.</span>`);
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

  /* decai o bloqueio do Raio inimigo (só a partir do turno seguinte ao eletrocuto) */
  for (const k of ['p1', 'p2']) {
    const p = game.players[k];
    if (p.blockTurns > 0 && p.blockTurn !== game.turns) {
      p.blockTurns--;
      if (p.blockTurns <= 0) {
        log(`<span class="log-entry">⚡ ${p.name}: ação <b>${ACTIONS[p.blockedAction].nome}</b> desbloqueada.</span>`);
        p.blockedAction = null;
      }
    }
    if (p.tempoWeakTurns > 0 && p.tempoWeakTurn !== game.turns) {
      p.tempoWeakTurns--;
      if (p.tempoWeakTurns <= 0) {
        log(`<span class="log-entry">⏱ ${p.name}: o tempo voltou ao normal (dano recuperado).</span>`);
      }
    }
  }

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
function log() {}

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
  if (ev.repeat) return;
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
function refreshTimeHeads(r1, r2) {
  const h1 = $('panel-1-head');
  const h2 = $('panel-2-head');
  const fmt = (label, s) => label ? `${label} · ${s}s` : label;
  if (h1) h1.textContent = fmt('JOGADOR 1', r1 === null ? '--' : Math.max(0, Math.ceil(r1 / 1000)));
  if (h2) h2.textContent = fmt('JOGADOR 2', r2 === null ? '--' : Math.max(0, Math.ceil(r2 / 1000)));
}

function frame(now) {
  requestAnimationFrame(frame);
  if (game) {
    if (game.state === 'decision' && now) {
      const nowMs = now || performance.now();
      const p1 = game.players.p1, p2 = game.players.p2;
      const p1rem = p1.deadline - nowMs;
      const p2rem = p2.deadline - nowMs;
      const rem = Math.min(p1rem, p2rem);
      const secs = Math.ceil(rem / 1000);
      const el = $('timer-label');
      el.textContent = secs;
      el.classList.toggle('tight', rem < 1000 || game.frenzy);
      refreshTimeHeads(p1rem, p2rem);
      if (!p1.confirmed && p1rem <= 0) lockPlayer('p1');
      if (!p2.confirmed && p2rem <= 0) {
        if (p2.isAI) aiLock(p2);
        else lockPlayer('p2');
      }
      const p1c = p1.confirmed, p2c = p2.confirmed;
      if (p1c && p2c) {
        if (game.mode === 'hotseat' || p2.isAI) startResolve();
      }
    } else if (game.state === 'resolve' || game.state === 'over') {
      const el = $('timer-label');
      el.textContent = '--';
      el.classList.remove('tight');
      refreshTimeHeads(null, null);
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

function lightningBolt(fromKey, toKey) {
  anim.lightnings.push({ from: fromKey, to: toKey, life: 1.1 });
  for (const k of [fromKey, toKey]) {
    anim.rings.push({ x: ballMetrics(k).x, y: ballMetrics(k).y, r: ballMetrics(k).r * 0.6, vr: ballMetrics(k).r * 4, alpha: 0.8, color: '#ffe36b', width: 6 });
  }
}

function incinerateFx(key) {
  anim.shake[key] = 16;
  const m = ballMetrics(key);
  const x = m.x, y = m.y;
  anim.rings.push({ x, y, r: m.r * 0.3, vr: m.r * 5, alpha: 0.95, color: '#ff6b35', width: 10 });
  anim.rings.push({ x, y, r: m.r * 0.5, vr: m.r * 3.2, alpha: 0.7, color: '#ffd23f', width: 7 });
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 60 + Math.random() * 220;
    anim.particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
      life: 1, maxLife: 1,
      color: pick(['#ff6b35', '#ffd23f', '#ff8f3f', '#e63f1f']), size: 2 + Math.random() * 5,
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
    if (el === 'raio' && Math.random() < 0.18) {
      anim.particles.push({
        x: pos.x + (Math.random() - 0.5) * m.r * 0.9,
        y: pos.y + (Math.random() - 0.5) * m.r * 0.9,
        vx: (Math.random() - 0.5) * 70, vy: (Math.random() - 0.5) * 70,
        life: 1, maxLife: 1, color: Math.random() < 0.5 ? '#ffe36b' : '#b06bff', size: 1.5 + Math.random() * 2.5,
      });
    }
    if (el === 'tempo' && Math.random() < 0.2) {
      anim.particles.push({
        x: pos.x + (Math.random() - 0.5) * m.r * 0.9,
        y: pos.y + (Math.random() - 0.5) * m.r * 0.9,
        vx: (Math.random() - 0.5) * 30, vy: -20 - Math.random() * 40,
        life: 1, maxLife: 1, color: Math.random() < 0.5 ? '#7ff3dc' : '#c9fff2', size: 1 + Math.random() * 2.5,
      });
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

  /* raios (eletrocuto) */
  anim.lightnings = anim.lightnings.filter(l => l.life > 0);
  for (const l of anim.lightnings) {
    const a = ballPos(l.from, t);
    const b = ballPos(l.to, t);
    ctx.globalAlpha = clamp(l.life, 0, 1);
    ctx.strokeStyle = '#ffe36b';
    ctx.lineWidth = 3 + 2 * clamp(l.life, 0, 1);
    ctx.shadowColor = '#ffd23f';
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    const segs = 9;
    for (let s = 1; s < segs; s++) {
      const p = s / segs;
      const mx = a.x + (b.x - a.x) * p;
      const my = a.y + (b.y - a.y) * p;
      ctx.lineTo(mx + (Math.random() - 0.5) * 36, my + (Math.random() - 0.5) * 16 + Math.sin(p * 9) * 8);
    }
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    l.life -= 0.035;
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
  else if (el === 'raio') { grad.addColorStop(0, '#ffef9e'); grad.addColorStop(0.5, '#b25cff'); grad.addColorStop(1, '#371a70'); }
  else if (el === 'tempo') { grad.addColorStop(0, '#d9fff4'); grad.addColorStop(0.55, '#35e0c0'); grad.addColorStop(1, '#0b5148'); }
  else { grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.55, '#eef8ff'); grad.addColorStop(1, '#9db8cf'); }

  c.beginPath();
  c.arc(x + shakeX, y + shakeY, r, 0, Math.PI * 2);
  c.fillStyle = grad;
  c.fill();
  c.shadowBlur = 0;

  /* borda */
  c.strokeStyle = (el === 'ar' || el === 'raio' || el === 'tempo') ? '#ffffff99' : '#ffffff44';
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
if (el === 'tempo') {
    c.strokeStyle = 'rgba(53,224,192,0.45)';
    c.lineWidth = 2.5;
    c.setLineDash([6, 10]);
    c.lineDashOffset = -t * 0.03;
    c.beginPath();
    c.arc(x + shakeX, y + shakeY, r * 1.35, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    const ang1 = t * 0.0006;
    const ang2 = t * 0.0045;
    c.strokeStyle = '#ffffffcc';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(x + shakeX, y + shakeY);
    c.lineTo(x + shakeX + Math.cos(ang1) * r * 0.42, y + shakeY + Math.sin(ang1) * r * 0.42);
    c.stroke();
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x + shakeX, y + shakeY);
    c.lineTo(x + shakeX + Math.cos(ang2) * r * 0.72, y + shakeY + Math.sin(ang2) * r * 0.72);
    c.stroke();
  }
  if (el === 'raio') {
    const charged = p.charged;
    c.strokeStyle = charged ? '#ffd23f' : '#b06bff88';
    c.lineWidth = 2.5;
    c.setLineDash([7, 9]);
    c.lineDashOffset = -t * 0.06;
    c.shadowColor = charged ? '#ffd23f' : '#b06bff';
    c.shadowBlur = charged ? 18 : 8;
    c.beginPath();
    c.arc(x + shakeX, y + shakeY, r * (charged ? 1.3 : 1.2), 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    c.shadowBlur = 0;
    if (charged) {
      c.fillStyle = '#ffd23f';
      for (let k = 0; k < 3; k++) {
        const a = Math.random() * Math.PI * 2;
        const rr = r * (0.7 + Math.random() * 0.6);
        const sx = x + shakeX + Math.cos(a) * rr;
        const sy = y + shakeY + Math.sin(a) * rr;
        c.beginPath();
        c.arc(sx, sy, 2 + Math.random() * 3, 0, Math.PI * 2);
        c.fill();
      }
    }
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