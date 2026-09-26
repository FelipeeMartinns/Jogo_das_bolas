'use strict';

/* ============================================================
   BOLISTIC — lógica principal
   ============================================================ */

/* ---------------- Dados ----------------
   Ações: ataque, refletir, projetil, defesa, agarrar
   Roda: cada ação vence as DUAS seguintes (2 vitórias, 2 derrotas).
     Ataque > Refletir > Projétil > Defesa > Agarrar > Ataque
   Espelhos: ataque×ataque e agarrar×agarrar ferem os dois; os outros
     três só dão feedback visual, sem dano.
   Contragolpe: só Defesa > Ataque e Defesa > Agarrar.
   Agarrar cancela a 2ª ação normal do Combo, nunca uma ativa.
   Bolas: fogo, pedra, agua, ar, raio, tempo
   Combo: 3 por jogador, nunca recarrega. Só é gasto se o 2º slot
     realmente acontecer (a 1ª ação precisa conectar).
   Cada ação base tem 3 cargas; elas só importam dentro do Combo.
   Frenesi: quando alguém chega à metade da vida, tempo cai para 3s.
------------------------------------------ */

const ELEMENTS = {
  fogo:  { nome: 'Fogo',  cor: '#ff6b35', glow: '#ff6b35',
           desc: 'Todo projétil acertado acumula +2 de stacks. A habilidade ativa Incineração consome os stacks e lança todo o dano acumulado.' },
  pedra: { nome: 'Pedra', cor: '#a8b0bd', glow: '#8a93a3',
           desc: 'Ataques causam dano dobrado — inclusive o Contragolpe.' },
  agua:  { nome: 'Água',  cor: '#35a7ff', glow: '#35a7ff',
           desc: 'Refletir causa +1 de dano em qualquer reflexo.' },
  ar:    { nome: 'Ar',    cor: '#eaf6ff', glow: '#cfe8ff',
            desc: 'Ataques causam +1 contra Projétil e +2 contra Refletir; Projétil causa +2 contra Defesa.' },
   raio:  { nome: 'Raio',  cor: '#b06bff', glow: '#b06bff',
            desc: 'Ao chegar à metade da vida, energiza. A habilidade ativa causa 2 de dano, bloqueia 1 ação aleatória por 3 turnos e concede dano dobrado permanente pelo resto da partida (uso único).' },
   tempo: { nome: 'Tempo', cor: '#35e0c0', glow: '#2dd4b3',
            desc: 'Passivo: reduz em 1 segundo o tempo do inimigo. Ganha 1 stack por ponto de dano sofrido (máx. 7). A habilidade Regenerar (uso único) cura 1 de vida por stack e faz o Tempo perder 1 de dano em todas as ações por 3 turnos.' },
};

/* A roda: cada ação vence as DUAS seguintes. Ver RODA/vence() mais abaixo.
   Ataque > Refletir > Projétil > Defesa > Agarrar > Ataque */
const ACTIONS = {
  ataque:   { nome: 'Ataque',   cls: '', desc: 'Vence Projétil e Refletir' },
  refletir: { nome: 'Refletir', cls: '', desc: 'Vence Projétil (+1) e usa a Defesa do inimigo contra ele' },
  projetil: { nome: 'Projétil', cls: '', desc: 'Vence Defesa e Agarrar com o dano normal' },
  defesa:   { nome: 'Defesa',   cls: '', desc: 'Segura o Ataque e o Agarrar abrindo Contragolpe (+1)' },
  agarrar:  { nome: 'Agarrar',  cls: '', desc: 'Vence Ataque e Refletir · agarra e impede a 2ª ação do Combo' },
  raio:    { nome: 'Raio',    cls: '', desc: 'Habilidade ativa: causa 2 de dano, bloqueia 1 ação aleatória por 3 turnos e concede dano x2 permanente (uso único)' },
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
const COUNTER_BONUS = 1;              // dano extra do Contragolpe
const REFLECT_BONUS = 1;              // dano extra do Refletir contra Projétil
const COUNTER_MS = 2000;              // janela para apertar o Contragolpe
const AI_COUNTER_CHANCE = 0.7;        // chance de a máquina acertar o Contragolpe
const AI_COUNTER_DELAY = 550;         // atraso da máquina antes de responder

/* um único conjunto de teclas: só existe um jogador humano por partida */
const KEYS = { ataque: 'KeyQ', defesa: 'KeyW', projetil: 'KeyE', refletir: 'KeyR', agarrar: 'KeyF', combo: 'KeyT', ok: 'KeyA' };

const KEY_LABEL = { ataque: 'Q', defesa: 'W', projetil: 'E', refletir: 'R', agarrar: 'F', combo: 'T', ok: 'A' };

const ACTION_ORDER = ['ataque', 'defesa', 'projetil', 'refletir', 'agarrar'];
/* sigla curta das cargas, no painel da bola */
const ACTION_TAG = { ataque: 'Atk', defesa: 'Def', projetil: 'Proj', refletir: 'Ref', agarrar: 'Ag' };
const ACTIVE_ACTIONS = ['raio', 'incinerar', 'tempo'];
function isActiveAction(a) { return ACTIVE_ACTIONS.includes(a); }

/* ---------------- A roda das 5 ações ----------------
   Cada ação vence as DUAS seguintes na roda e perde para as duas anteriores.
   É a única regra: não existe nenhum par sem vencedor, exceto os espelhos.
       Ataque > Refletir > Projétil > Defesa > Agarrar > Ataque
   Com 5 ações isso fecha perfectly (todas em 2 vitórias e 2 derrotas), coisa
   que era impossível com 4 — e o ciclo antigo de 4 continua idêntico aqui. */
const RODA = ['ataque', 'refletir', 'projetil', 'defesa', 'agarrar'];
function vence(a, b) {
  const d = (RODA.indexOf(b) - RODA.indexOf(a) + RODA.length) % RODA.length;
  return d === 1 || d === 2;
}

/* modos com adversário controlado pelo jogo (o jogador é sempre o p1) */
const AI_MODES = ['machine', 'tutorial'];
function isAIMode(m) { return AI_MODES.includes(m); }

const ONLINE_PREFIX = 'jdb-';
const ONLINE_CODE_LEN = 4;

/* Servidores ICE: STUN público + TURN público como fallback para NAT restritivo */
const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: ['stun:relay.metered.ca:80', 'stun:relay.metered.ca:443'] },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turn:relay.metered.ca:80',
      'turn:relay.metered.ca:443',
      'turn:relay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

/* ---------------- Estado geral ---------------- */
let game = null;        // dados da partida atual
let anim = null;        // estado de animação / desenho
let canvas = null, ctx = null;
let screenBattle = null;
let audioCtx = null;
let currentMode = 'machine';
let currentScreen = 'menu';

/* estado da partida online (PeerJS) */
let online = {
  peer: null, conn: null,
  isHost: false, connected: false, started: false,
  code: null,
  hostPicked: null, guestElement: null,
  guestReady: false, guestReadyTurn: -1, revealSent: false, revealTimer: null, guestActions: null,
  pendingSync: null, lockTimer: null,
  awaitingSlots: false,
  waitingCounter: null,
  rematchSent: false, rematchReceived: false,
  watchdog: null,
  hasTime: true,          /* o anfitriao escolhe na criacao da sala */
};

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
  grab:    () => { tone(180, 0.09, 'square', 0.1); tone(420, 0.07, 'square', 0.1, 0.07); tone(120, 0.2, 'sawtooth', 0.12, 0.13); },
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
    /* se a música do lugar atual está desligada, cala qualquer coisa que esteja tocando */
    if (!enabled) { if (this.kind || this.timer) this.stop(); return; }
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
  ['screen-menu', 'screen-select', 'screen-online', 'screen-balls', 'screen-battle'].forEach(s => {
    $(s).hidden = s !== id;
  });
  Music.sync();
}

function toggleRules() {
  const b = $('rules-box');
  b.hidden = !b.hidden;
}

/* ---------------- Coleção de bolas ---------------- */
function openBalls() {
  ensureAudio();
  sfx.click();
  buildBalls();
  showScreen('screen-balls');
}

function backFromBalls() {
  sfx.click();
  showScreen('screen-menu');
}

function buildBalls() {
  const grid = $('balls-grid');
  const detail = $('balls-detail');
  grid.innerHTML = '';
  detail.innerHTML = '<p class="balls-hint">Toque em uma bola para ver a descrição.</p>';

  for (const [el, data] of Object.entries(ELEMENTS)) {
    const card = document.createElement('div');
    card.className = 'select-card';
    card.innerHTML = `<div class="select-ball ${el}"></div>
      <h3>${data.nome}</h3>`;
    card.addEventListener('click', e => {
      if (e.detail > 1) return;
      sfx.click();
      grid.querySelectorAll('.select-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      detail.innerHTML = `
        <div class="select-ball ${el}"></div>
        <div class="balls-txt">
          <h3 style="color:${data.cor}">${data.nome}</h3>
          <p>${data.desc}</p>
        </div>`;
    });
    grid.appendChild(card);
  }
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
  if (online.peer || online.conn) {
    sendOnline({ type: 'leave' });
    closeOnline();
  } else if (game && game.mode === 'online') {
    closeOnline();
  }
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

function backFromSelect() {
  if (quickPick('backFromSelect')) return;
  ensureAudio();
  sfx.click();
  clearSelectTimer();
  selectState = null;
  const grid = $('select-grid');
  if (grid) grid.querySelectorAll('.select-card.selected').forEach(c => c.classList.remove('selected'));
  $('select-note').textContent = '';
  backToMenu();
}

/* ---------------- Modo Online (PeerJS) ---------------- */
function startOnline() {
  if (quickPick('startOnline')) return;
  ensureAudio();
  sfx.click();
  resetOnline();
  $('online-actions').hidden = false;
  $('online-join').hidden = true;
  /* devolve o seletor de tempo: ele some só quando o jogador vai entrar
     numa sala, e volta a valer quando ele pretende criar outra */
  $('online-time').hidden = false;
  applyTimeChoice();
  setOnlineStatus('');
  showScreen('screen-online');
}

function setOnlineStatus(t) {
  const el = $('online-status');
  if (el) el.innerHTML = t || '';
}

function esc(t) {
  return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function checkPeerJs() {
  if (typeof Peer === 'undefined') {
    setOnlineStatus('A biblioteca PeerJS não carregou.<br>Verifique a internet e recarregue a página.');
    return false;
  }
  return true;
}

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < ONLINE_CODE_LEN; i++) c += chars[rngInt(chars.length)];
  return c;
}

function peerOptions() {
  return { debug: 2, config: { iceServers: ICE_SERVERS } };
}

/* ---------------- Tempo do turno na sala online ----------------
   Quem cria a sala escolhe se os turnos terão cronômetro. A escolha vai
   para o convidado junto com o começo da partida, e os dois lados passam a
   usar a mesma regra: sem tempo, ninguém é bloqueado por pensar demais. */
function pickTimeChoice(on) {
  ensureAudio();
  sfx.click();
  online.hasTime = !!on;
  applyTimeChoice();
}

function applyTimeChoice() {
  const on = $('opt-time-on'), off = $('opt-time-off');
  if (on) on.classList.toggle('on', online.hasTime);
  if (off) off.classList.toggle('on', !online.hasTime);
  if (on) on.setAttribute('aria-checked', online.hasTime ? 'true' : 'false');
  if (off) off.setAttribute('aria-checked', online.hasTime ? 'false' : 'true');
}

/* true quando o cronômetro do turno está valendo nesta partida */
function timeLimitOn() {
  if (!game) return true;
  return game.hasTime !== false;
}

/* a bola Tempo encurta o turno do oponente, então o modo sem tempo também
   desliga esse efeito: sem cronômetro não há o que encurtar */
function decisionTimeFor(p) {
  if (!timeLimitOn()) return Infinity;
  const opp = game.players[p1Key(p)];
  let ms = game.frenzy ? DECISION_FAST : DECISION_SLOW;
  if (opp.element === 'tempo') ms -= 1000;
  return Math.max(1000, ms);
}

function scheduleConnWatchdog() {
  if (online.watchdog) clearTimeout(online.watchdog);
  online.watchdog = setTimeout(() => {
    if (online.connected) return;
    console.warn('[online] Sem conexão após 20s.');
    setOnlineStatus('Demorando para conectar...<br>Confira: os dois estão com internet?<br>Se são 2 abas do MESMO navegador, abra em navegadores diferentes (ex.: Chrome + Edge).<br>Se for entre PCs, a rede precisa permitir conexões (NAT/firewall).');
  }, 20000);
}

function createRoom() {
  if (!checkPeerJs() || online.peer) return;
  ensureAudio();
  sfx.click();
  online.isHost = true;
  online.code = makeRoomCode();
  /* a sala nasce com a regra de tempo escolhida na tela (online.hasTime é a
     fonte da verdade; a UI só reflete) */
  $('online-actions').hidden = true;
  $('online-join').hidden = true;
  setOnlineStatus(`Sala criada! Código: <b style="color:var(--accent)">${online.code}</b><br>Aguardando oponente...`);
  scheduleConnWatchdog();
  try {
    online.peer = new Peer(ONLINE_PREFIX + online.code, peerOptions());
  } catch (e) {
    console.error('[online] erro ao criar Peer', e);
    setOnlineStatus('Erro ao criar a sala. Tente novamente.');
    return;
  }
  online.peer.on('open', () => {
    console.log('[online] peer do anfitrião aberto:', online.code);
    setOnlineStatus(`Sala criada! Código: <b style="color:var(--accent)">${online.code}</b><br>Envie o código para seu amigo e aguarde...`);
  });
  online.peer.on('connection', setupOnlineConn);
  online.peer.on('error', err => {
    console.error('[online] erro no peer (anfitrião):', err && err.type, err);
    if (online.connected) return;
    if (err && err.type === 'unavailable-id') {
      closeOnline();
      setOnlineStatus('Falha ao criar a sala (ID em uso). Tente novamente.');
    } else if (!online.connected) {
      setOnlineStatus('Falha de conexão com o servidor de sinal. Verifique a internet e tente de novo.');
    }
  });
}

function joinRoomPrompt() {
  if (!checkPeerJs()) return;
  ensureAudio();
  sfx.click();
  $('online-actions').hidden = true;
  $('online-join').hidden = false;
  /* quem entra não escolhe: a regra do tempo é do anfitrião da sala */
  $('online-time').hidden = true;
  setOnlineStatus('');
  $('room-code-input').focus();
}

function joinRoom() {
  if (!checkPeerJs() || online.peer) return;
  const code = ($('room-code-input').value || '').trim().toUpperCase();
  if (!code) { setOnlineStatus('Digite o código da sala.'); return; }
  ensureAudio();
  sfx.click();
  online.isHost = false;
  online.code = code;
  $('online-join').hidden = true;
  setOnlineStatus(`Conectando à sala <b>${esc(code)}</b>...`);
  scheduleConnWatchdog();
  try {
    online.peer = new Peer(peerOptions());
    online.peer.on('open', () => {
      console.log('[online] peer do convidado aberto, conectando em', ONLINE_PREFIX + code);
      online.conn = online.peer.connect(ONLINE_PREFIX + code, { reliable: true });
      setupOnlineConn(online.conn);
    });
    online.peer.on('error', err => {
      console.error('[online] erro no peer (convidado):', err && err.type, err);
      if (online.connected) return;
      if (err) {
        closeOnline();
        setOnlineStatus(`Não encontrou a sala (${esc(code)}). Confira o código e tente de novo.`);
        $('online-actions').hidden = false;
      }
    });
  } catch (e) {
    console.error('[online] erro ao criar Peer (convidado)', e);
    setOnlineStatus('Erro ao conectar. Tente novamente.');
  }
}

function setupOnlineConn(conn) {
  conn.on('open', () => {
    console.log('[online] canal de dados aberto');
    online.connected = true;
    online.conn = conn;
    if (online.watchdog) clearTimeout(online.watchdog);
    if (online.revealTimer) clearTimeout(online.revealTimer);
    /* o anfitrião já manda a regra do tempo junto da primeira mensagem, para
       o convidado saber antes de escolher a bola */
    const pronto = online.isHost ? 'guest-ready' : 'host-ready';
    sendOnline(online.isHost ? { type: pronto, hasTime: online.hasTime } : { type: pronto });
  });
  conn.on('data', onOnlineData);
  conn.on('close', onOnlineLeave);
  conn.on('error', err => {
    console.error('[online] erro no canal:', err && err.type, err);
    if (online.connected) onOnlineLeave();
    else if (!online.isHost) setOnlineStatus('Não foi possível conectar. Confira o código e tente de novo.');
  });
}

function sendOnline(msg) {
  try {
    if (online.connected && online.conn && online.conn.open) online.conn.send(msg);
  } catch (e) { /* ignore */ }
}

function closeOnline() {
  if (online.revealTimer) clearTimeout(online.revealTimer);
  if (online.watchdog) clearTimeout(online.watchdog);
  if (online.lockTimer) clearTimeout(online.lockTimer);
  try { if (online.conn) online.conn.close(); } catch (e) {}
  try { if (online.peer) online.peer.destroy(); } catch (e) {}
  online.conn = null;
  online.peer = null;
  online.watchdog = null;
  online.revealTimer = null;
  online.lockTimer = null;
  online.connected = false;
}

function resetOnline() {
  closeOnline();
  online.isHost = false;
  online.connected = false;
  online.started = false;
  online.code = null;
  online.hostPicked = null;
  online.guestElement = null;
  online.guestReady = false;
  online.guestReadyTurn = -1;
  online.revealSent = false;
  online.revealTimer = null;
  online.guestActions = null;
  online.pendingSync = null;
  online.rematchSent = false;
  online.rematchReceived = false;
  online.hasTime = true;
}

function onOnlineLeave() {
  const inBattle = !!(game && game.mode === 'online');
  if (inBattle) alert('O oponente desconectou. A partida foi encerrada.');
  else if (online.connected) alert('Conexão encerrada.');
  closeOnline();
  game = null;
  document.body.classList.remove('frenzy');
  $('gameover').hidden = true;
  showScreen('screen-menu');
}

function onOnlineData(raw) {
  let msg = raw;
  try { if (typeof raw === 'string') msg = JSON.parse(raw); } catch (e) { return; }
  if (!msg || typeof msg.type !== 'string') return;
  switch (msg.type) {
    case 'host-ready':
      if (online.isHost) goOnlineSelect();
      break;
    case 'guest-ready':
      if (!online.isHost) {
        /* a regra do tempo vem do anfitrião; se ele não mandar, vale a
           padrão (com tempo) para não travar uma sala antiga */
        if (typeof msg.hasTime === 'boolean') {
          online.hasTime = msg.hasTime;
          applyTimeChoice();
        }
        goOnlineSelect();
      }
      break;
    case 'select':
      if (online.isHost && !online.started) {
        online.guestElement = msg.element;
        if (online.hostPicked) startOnlineBattle(online.hostPicked, msg.element);
      }
      break;
    case 'start':
      if (!online.isHost && !online.started) {
        online.started = true;
        /* o start manda a regra do tempo de novo: ela é a válida da partida,
           e cobre o caso de a mensagem de conexão ter se misturado */
        if (typeof msg.hasTime === 'boolean') {
          online.hasTime = msg.hasTime;
          applyTimeChoice();
        }
        startBattle(msg.e1, msg.e2);
      }
      break;
    case 'ready':
      if (online.isHost) {
        online.guestReady = true;
        online.guestReadyTurn = game ? game.turns : -1;
        maybeRequestActions();
      }
      break;
    case 'actions-request':
      if (!online.isHost && game && game.mode === 'online' && game.state === 'decision') {
        const me = game.players[game.myKey];
        sendOnline({ type: 'actions', combo: me.selection.combo, actions: me.selection.actions.slice() });
      }
      break;
    case 'actions':
      if (online.isHost && game && game.mode === 'online') {
        clearTimeout(online.revealTimer);
        if (game.state === 'decision') {
          game.players.p2.selection = { combo: !!msg.combo, actions: Array.isArray(msg.actions) ? msg.actions : [] };
          lockPlayer('p2');
          sendOnline({ type: 'round' });
          startResolve();
        }
      }
      break;
    case 'round':
      /* protocolo antigo: o convidado começa a resolução e espera os slots */
      if (!online.isHost && game && game.mode === 'online' && game.state === 'decision') {
        startOnlineResolve();
      }
      break;
    case 'slot':
      if (!online.isHost && game && game.mode === 'online') {
        if (game.state === 'decision') startOnlineResolve();
        if (game.state === 'resolve') playOnlineSlot(msg.events, !!msg.last, msg.agarrado);
      }
      break;
    case 'counter':
      /* o convidado respondeu o pedido de Contragolpe */
      if (online.isHost && online.waitingCounter) {
        const w = online.waitingCounter;
        online.waitingCounter = null;
        clearTimeout(w.timer);
        w.resolve(!!msg.hit);
      }
      break;
    case 'sync':
      if (!online.isHost && game && game.mode === 'online') {
        if (game.state === 'resolve') online.pendingSync = msg.sync;
        else applyOnlineSync(msg.sync);
      }
      break;
    case 'rematch':
      online.rematchReceived = true;
      if (online.rematchSent) {
        $('gameover').hidden = true;
        goOnlineSelect();
      } else {
        $('result-sub').textContent = 'Oponente quer uma revanche! Clique em Revanche para aceitar.';
      }
      break;
    case 'leave':
      onOnlineLeave();
      break;
  }
}

function goOnlineSelect() {
  online.connected = true;
  online.started = false;
  online.hostPicked = null;
  online.guestElement = null;
  online.guestReady = false;
  online.guestReadyTurn = -1;
  online.revealSent = false;
  online.revealTimer = null;
  online.guestActions = null;
  online.pendingSync = null;
  online.rematchSent = false;
  online.rematchReceived = false;
  game = null;
  currentMode = 'online';
  buildSelect(online.isHost ? 'p1' : 'p2');
  /* confirma a regra da sala para os dois antes de começar */
  const note = $('select-note');
  if (note) {
    note.innerHTML = online.hasTime
      ? 'Sala <b>com tempo</b>: 5s por turno.'
      : 'Sala <b>sem tempo</b>: pense à vontade, o relógio não conta.';
  }
  showScreen('screen-select');
}

function startOnlineBattle(e1, e2) {
  online.started = true;
  sendOnline({ type: 'start', e1, e2, hasTime: online.hasTime });
  startBattle(e1, e2);
}

function maybeRequestActions() {
  if (!online.isHost || !game || game.mode !== 'online' || game.state !== 'decision') return;
  if (online.revealSent || !online.guestReady || !game.players.p1.confirmed) return;
  online.revealSent = true;
  sendOnline({ type: 'actions-request' });
  online.revealTimer = setTimeout(() => {
    if (online.isHost && game && game.mode === 'online' && game.state === 'decision' && !online.guestActions) {
      game.players.p2.selection = { combo: false, actions: [] };
      sendOnline({ type: 'round' });
      startResolve();
    }
  }, 6000);
}

function onlineSnapshot() {
  const pl = k => {
    const p = game.players[k];
    return {
      hp: p.hp,
      counts: Object.assign({}, p.counts),
      combos: p.combos,
      fireBonus: p.fireBonus,
      charged: p.charged,
      chargedUsed: p.chargedUsed,
      overPowered: p.overPowered,
      blockedAction: p.blockedAction,
      blockTurns: p.blockTurns,
      tempoStacks: p.tempoStacks,
      tempoHealUsed: p.tempoHealUsed,
      tempoWeakTurns: p.tempoWeakTurns,
    };
  };
  return { p1: pl('p1'), p2: pl('p2'), frenzy: game.frenzy, turns: game.turns };
}

function applyOnlineSync(sync) {
  if (!game || !sync) return;
  game.frenzy = !!sync.frenzy;
  game.turns = sync.turns;
  for (const k of ['p1', 'p2']) {
    const s = sync[k], p = game.players[k];
    if (!s || !p) continue;
    p.hp = s.hp;
    p.counts = Object.assign({}, s.counts);
    p.combos = s.combos;
    p.fireBonus = s.fireBonus;
    p.charged = s.charged;
    p.chargedUsed = s.chargedUsed;
    p.overPowered = s.overPowered;
    p.blockedAction = s.blockedAction;
    p.blockTurns = s.blockTurns;
    p.tempoStacks = s.tempoStacks;
    p.tempoHealUsed = s.tempoHealUsed;
    p.tempoWeakTurns = s.tempoWeakTurns;
  }
  document.body.classList.toggle('frenzy', !!game.frenzy);
  refreshPanel('p1');
  refreshPanel('p2');
  refreshHUD();
}

/* ============================================================
   TUTORIAL
   ============================================================ */

/* oponentes fixos: o jogador aprende sem surpresas */
const TUT_DUMMY = { pedra: 'agua', fogo: 'pedra' };

const TUTORIAL_STEPS = [
  {
    id: 'boas-vindas', mode: 'talk', title: 'Bem-vindo!',
    text: 'Você é a bola <b>Pedra</b> e o <b>Treino</b> é o seu oponente. '
      + 'Em cada turno os dois escolhem uma ação <b>em segredo</b> e só descobrimos o que rolou quando o turno acaba.',
  },
  {
    id: 'escolher', mode: 'act', title: 'Escolhendo a ação',
    goal: 'Toque em uma das cinco ações: <b>Ataque</b>, <b>Refletir</b>, <b>Projétil</b>, <b>Defesa</b> ou <b>Agarrar</b>.',
    check: () => tut.flags.picked,
  },
  {
    id: 'confirmar', mode: 'act', title: 'Confirmando a jogada',
    goal: 'Agora toque no botão <b>OK</b> (o botão largo embaixo) para confirmar e resolver o turno.',
    check: () => tut.flags.confirmed,
  },
  {
    id: 'regras', mode: 'talk', title: 'A roda das cinco ações',
    text: 'As cinco ações formam uma <b>roda</b>, e cada uma vence as <b>duas seguintes</b>: '
      + '<b>Ataque → Refletir → Projétil → Defesa → Agarrar → (volta ao Ataque)</b>. '
      + 'Assim todas vencem 2 e perdem 2, e nenhum par de ações fica sem resultado. '
      + 'Cada ação tem <b>3 cargas</b> e recarrega quando zeram.',
  },
  {
    id: 'agarrar', mode: 'talk', title: 'O Agarrar',
    text: 'O <b>Agarrar</b> pega o <b>Ataque</b> e o <b>Refletir</b> — as duas ações que se aproximam. '
      + 'Ele causa o dano normal e ainda <b>cancela a 2ª ação do Combo</b> do adversário. '
      + 'Perde para <b>Projétil</b> e <b>Defesa</b>, e nunca cancela uma habilidade ativa.',
  },
  {
    id: 'contragolpe', mode: 'talk', title: 'O Contragolpe',
    text: 'A <b>Defesa</b> segura o <b>Ataque</b> e o <b>Agarrar</b> — são os dois únicos casos. '
      + 'Segurar não causa dano sozinha: acende um <b>botão amarelo</b> com <b>2 segundos</b> de prazo. '
      + 'Se você apertar a tempo, contra-ataca e causa <b>+1 de dano</b>. Passou do tempo, só segurou. '
      + 'E um detalhe seu: <b>Pedra causa o dobro de dano no Ataque</b> — inclusive no Contragolpe.',
  },
  {
    id: 'usarcontra', mode: 'act', title: 'Apertando o Contragolpe',
    goal: 'O Treino vai atacar. Escolha <b>Defesa</b> e, quando o botão amarelo aparecer, <b>aperte-o antes de 2 segundos</b>.',
    enter: () => { tut.forceAI = 'ataque'; },
    check: () => tut.flags.countered,
    onDone: () => { tut.forceAI = null; },
  },
  {
    id: 'turnos', mode: 'act', title: 'Jogando de verdade',
    goal: () => {
      const left = Math.max(0, tut.startTurn + 1 - game.turns);
      return left > 0
        ? `Falta${left > 1 ? 'm' : ''} <b>${left}</b> turno${left > 1 ? 's' : ''}. Escolha uma ação e confirme.`
        : 'Bom trabalho!';
    },
    check: () => game.turns >= tut.startTurn + 1,
  },
  {
    id: 'combo', mode: 'talk', title: 'O botão Combo',
    text: 'O <b>Combo</b> libera <b>DUAS ações no mesmo turno</b>. Você só tem <b>3 combos</b> e eles '
      + '<b>nunca recarregam</b>. A pegadinha: o combo <b>só se completa se a primeira ação acertar alguma coisa</b>. '
      + 'Se ela falhar, a segunda nem acontece — <b>mas você não gasta o combo</b>, então pode tentar de novo. '
      + 'Por isso a primeira ação do combo precisa ser uma de confiança.',
  },
  {
    id: 'usarcombo', mode: 'act', title: 'Usando o Combo',
    goal: 'Toque em <b>Combo</b> e escolha <b>duas ações</b>. Pode ser a mesma repetida: com o combo ligado, cada botão passa a mostrar quantas <b>cargas</b> ainda sobram, e cada repetição gasta uma. Sem carga, não dá para repetir.',
    check: () => {
      const s = game.players.p1.selection;
      return tut.flags.comboUsed && s.combo && s.actions.length >= 2;
    },
  },
  {
    id: 'frenesi', mode: 'talk', title: 'Frenesi',
    text: 'Falta explicar a <b>regrinha do tempo</b>. Você tem <b>5 segundos</b> por turno para escolher e confirmar. '
      + 'Se o tempo acabar, o que você já escolheu é usado do mesmo jeito. '
      + 'E quando <b>algum jogador chega à metade da vida</b>, cai o <b>Frenesi</b>: o tempo desce para <b>3 segundos</b> e a tela esquenta.',
  },
  {
    id: 'verfrenezi', mode: 'act', title: 'Vendo o Frenesi',
    goal: 'O Treino te derrubou à metade da vida. Complete um turno e repare no tempo e no aviso vermelho.',
    enter: () => {
      const p1 = game.players.p1;
      p1.hp = Math.ceil(p1.maxHp / 2);
      game.frenzy = true;
      tut.frenzyDone = false;
      document.body.classList.add('frenzy');
      sfx.frenzy();
      bannerText('FRENESI! Tempo caiu para 3s!', 1600);
      refreshHUD();
    },
    check: () => tut.frenzyDone,
  },
  {
    id: 'fogo', mode: 'talk', title: 'Agora a parte escondida: o Fogo',
    text: 'Cada bola tem uma vantagem própria, e algumas têm uma <b>habilidade ativa</b> que só aparece na partida. '
      + 'A partir de agora você é a bola <b>Fogo</b>: todo projétil que acerta guarda <b>+2 de stacks</b> '
      + 'e o projétil em si causa só o dano base.',
    enter: () => { tut.forceAI = 'defesa'; startBattle('fogo', TUT_DUMMY.fogo); },
  },
  {
    id: 'stacks', mode: 'act', title: 'Acumulando stacks',
    goal: 'O Treino vai se defender. Escolha <b>Projétil</b> para guardá-los.',
    check: () => game.players.p1.fireBonus >= 2,
  },
  {
    id: 'incinerar', mode: 'talk', title: 'Incineração',
    text: 'Com os stacks guardados, o botão <b>Incineração</b> se acende no painel. '
      + 'Ele <b>consome todos os stacks</b> e lança <b>todo o dano acumulado de uma vez</b> no inimigo — '
      + 'é por isso que o projétil do Fogo sozinho causa pouco.',
    onDone: () => { tut.forceAI = null; },
  },
  {
    id: 'usarincinerar', mode: 'act', title: 'Solte a Incineração',
    goal: 'Toque no botão <b>Incineração</b> e veja o fogo tomar o inimigo.',
    check: () => tut.flags.burned,
  },
  {
    id: 'fim', mode: 'talk', title: 'Você aprendeu!',
    text: 'É isso. As outras bolas também têm habilidades: <b>Raio</b> eletrifica o inimigo e bloqueia uma ação dele, '
      + '<b>Tempo</b> rouba um segundo do adversário e se regenera, <b>Água</b> ganha +1 em qualquer reflexo '
      + 'e <b>Ar</b> bate mais forte no Refletir. Bom jogo!',
  },
];

let tut = null;

function startTutorial() {
  if (quickPick('startTutorial')) return;
  currentMode = 'tutorial';
  ensureAudio();
  sfx.click();
  tut = {
    i: 0,
    entered: -1,
    total: TUTORIAL_STEPS.length,
    startTurn: 1,
    hpFloor: Math.ceil(MAX_HP * 0.6),
    forceAI: null,
    frenzyDone: false,
    guard: false,
    flags: {},
  };
  document.body.classList.add('tutorial');
  startBattle('pedra', TUT_DUMMY.pedra);
  tut.startTurn = game.turns + 1;
  tutorialShow();
}

function tutorialShow() {
  if (!tut) return;
  const st = TUTORIAL_STEPS[tut.i];
  if (!st) return;
  if (tut.entered !== tut.i) {
    tut.entered = tut.i;
    if (st.enter) st.enter();
  }
  const c = $('coach');
  c.hidden = false;
  c.classList.toggle('chip', st.mode === 'act');
  $('coach-tag').textContent = `Tutorial ${tut.i + 1}/${tut.total}`;
  $('coach-title').textContent = st.title || '';
  $('coach-text').innerHTML = st.text || '';
  const goal = $('coach-goal');
  const goalHtml = typeof st.goal === 'function' ? st.goal() : st.goal;
  if (goalHtml) { goal.innerHTML = goalHtml; goal.hidden = false; }
  else goal.hidden = true;
  const talk = st.mode === 'talk';
  $('coach-foot').hidden = !talk;
  $('coach-next').textContent = tut.i === tut.total - 1 ? 'Voltar ao menu' : 'Continuar';
}

function tutorialNext() {
  if (!tut || tut.guard) return;
  if (quickPick('tutNext')) return;
  sfx.click();
  const st = TUTORIAL_STEPS[tut.i];
  if (st && st.onDone) st.onDone();
  tut.i++;
  if (tut.i >= tut.total) { tutorialFinish(); return; }
  tutorialShow();
}

function tutorialEvent() {
  if (!tut || tut.guard) return;
  const st = TUTORIAL_STEPS[tut.i];
  if (!st || st.mode !== 'act' || !st.check) return;
  if (!st.check()) return;
  tut.guard = true;
  sfx.confirm();
  bannerText('Isso aí!', 1000);
  setTimeout(() => {
    if (!tut) return;
    tut.guard = false;
    tutorialNext();
  }, 850);
}

function skipTutorial() {
  if (!tut) return;
  sfx.click();
  tutorialFinish();
}

function tutorialFinish() {
  tut = null;
  document.body.classList.remove('tutorial', 'frenzy');
  $('coach').hidden = true;
  $('gameover').hidden = true;
  game = null;
  showScreen('screen-menu');
}

/* o tutorial não pode terminar: se alguém zerar, a luta é retomada */
function tutorialGuard() {
  if (!tut) return false;
  const p1 = game.players.p1, p2 = game.players.p2;
  if (p1.hp > 0 && p2.hp > 0) return false;
  if (p1.hp <= 0) {
    p1.hp = tut.hpFloor;
    sfx.heal();
    bannerText('O Treino acertou forte! Vida recuperada.', 1800);
  }
  if (p2.hp <= 0) {
    p2.hp = Math.ceil(p2.maxHp * 0.5);
    bannerText('O Treino volta para a luta!', 1600);
  }
  refreshHUD();
  setTimeout(startDecision, 1100);
  return true;
}

/* ---------------- Seleção de personagens ---------------- */
let selectState = null;
let selectTimer = null;

function clearSelectTimer() {
  if (selectTimer) {
    clearTimeout(selectTimer);
    selectTimer = null;
  }
}

function buildSelect(playerKey) {
  clearSelectTimer();
  const title = $('select-title');
  const grid = $('select-grid');
  const note = $('select-note');
  grid.innerHTML = '';
  note.textContent = '';

  title.textContent = 'Escolha sua bola';
  selectState = { playerKey, chosen: null };

  for (const [el, data] of Object.entries(ELEMENTS)) {
    const card = document.createElement('div');
    card.className = 'select-card';
    card.innerHTML = `
      <div class="select-ball ${el}"></div>
      <h3>${data.nome}</h3>`;
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
  if (currentMode === 'online') {
    sendOnline({ type: 'select', element });
    if (online.isHost) {
      online.hostPicked = element;
      if (online.guestElement) startOnlineBattle(element, online.guestElement);
      else $('select-note').textContent = 'Escolha enviada! Aguardando o oponente...';
    } else {
      $('select-note').textContent = 'Escolha enviada! Aguardando o anfitrião...';
    }
    return;
  }
  const els = Object.keys(ELEMENTS).filter(e => e !== element);
  const aiPick = pick(els);
  $('select-note').textContent = 'Máquina escolhendo...';
  selectTimer = setTimeout(() => { selectTimer = null; startBattle(element, aiPick); }, 800);
}

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

  const isOnline = currentMode === 'online';
  const myKey = isOnline ? (online.isHost ? 'p1' : 'p2') : 'p1';
  const p2Name = isOnline ? (myKey === 'p2' ? 'Você' : 'Oponente') : currentMode === 'tutorial' ? 'Treino' : 'Máquina';
  const p1 = makePlayer('p1', elementP1, false, isOnline && myKey === 'p2' ? 'Oponente' : 'Você');
  const p2 = makePlayer('p2', elementP2, !isOnline, p2Name);

  game = {
    mode: currentMode,
    myKey: isOnline ? myKey : null,
    players: { p1, p2 },
    state: 'decision',
    frenzy: false,
    turns: 0,
    phaseStart: 0,
    phaseDuration: DECISION_SLOW,
    /* o online é que tem a opção de tempo; nos outros modos sempre vale o
       cronômetro, como antes */
    hasTime: isOnline ? online.hasTime !== false : true,
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

  if (isOnline) {
    const opp = myKey === 'p1' ? '2' : '1';
    $('panel-' + opp).classList.add('hidden-panel');
    $('panel-' + (myKey === 'p1' ? '1' : '2')).classList.remove('hidden-panel');
    setPanelHead(1, myKey === 'p1' ? 'VOCÊ' : 'OPONENTE');
    setPanelHead(2, myKey === 'p2' ? 'VOCÊ' : 'OPONENTE');
  } else {
    $('panel-2').classList.add('hidden-panel');
    setPanelHead(1, 'VOCÊ');
    setPanelHead(2, currentMode === 'tutorial' ? 'TREINO' : 'MÁQUINA');
  }

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
    pulses: [],
    grapples: [],
    shields: [],
    particles: [],
    lightnings: [],
    flames: [],
    rewinds: [],
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
    ? (game.frenzy ? (timeLimitOn() ? 'FRENESI! Escolham rápido!' : 'FRENESI!') : 'Escolham suas ações!')
    : 'Resolvendo...';
}

function hudMeta(p) {
  const block = p.blockedAction && p.blockTurns > 0 ? p.blockedAction : null;
  /* as cargas só aparecem no turno de decisão e com o combo ligado: fora disso o número só confunde */
  const showCounts = game.state === 'decision' && p.selection && p.selection.combo;
  const chips = showCounts ? ACTION_ORDER.map(a => {
    return `<span class="chip ${p.counts[a] === 0 ? 'out' : ''}${a === block ? ' blocked' : ''}">${ACTION_TAG[a]} <span class="num">${p.counts[a]}</span></span>`;
  }).join('') : '';
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
      <span class="key">[${KEY_LABEL[a]}]</span>
      <span class="count${player.selection && player.selection.combo ? '' : ' hidden'}">×${player.counts[a]}</span>`;
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
    <span class="key">[${KEY_LABEL.combo}]</span>
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
  okBtn.innerHTML = `OK [${KEY_LABEL.ok}]`;
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
      if (countEl) {
        const showCounts = game.state === 'decision' && p.selection.combo;
        countEl.textContent = '×' + p.counts[act];
        countEl.classList.toggle('hidden', !showCounts);
        countEl.classList.toggle('low', showCounts && p.counts[act] === 1);
      }
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
  if (tut && playerKey === 'p1' && !isActiveAction(act)) tut.flags.picked = true;
  const s = p.selection;
  const quick = quickPick(playerKey + ':' + act);

  sfx.click();
  tutorialEvent();
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
  if (tut && playerKey === 'p1') tut.flags.comboUsed = true;
  refreshPanel(playerKey);
  refreshHUD();
  tutorialEvent();
}

function confirmPlayer(playerKey) {
  ensureAudio();
  const p = game.players[playerKey];
  if (p.isAI || p.confirmed || game.state !== 'decision') return;
  if (tut && playerKey === 'p1') tut.flags.confirmed = true;
  lockPlayer(playerKey);
  sfx.confirm();
  refreshHUD();
  tutorialEvent();
  if (game.mode === 'online') {
    sendOnline({ type: 'ready' });
    if (online.isHost) maybeRequestActions();
  }
}

function autoLock(playerKey) {
  lockPlayer(playerKey);
  refreshHUD();
  if (game.mode === 'online') {
    sendOnline({ type: 'ready' });
    if (online.isHost) maybeRequestActions();
  }
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
  /* o combo NÃO é gasto aqui: só se desconta em resolveRound(), no 2º slot,
     quando ele realmente acontece. Gastar no confirm punia duas vezes —
     queimava um dos 3 combos da partida mesmo com o combo se desfazendo. */
  s.actions.forEach(a => {
    if (p.counts[a] > 0) p.counts[a]--;
  });
  refreshPanel(playerKey);
}

/* ---------------- Turno de decisão ---------------- */
function startDecision() {
  if (!game) return;
  const p1 = game.players.p1, p2 = game.players.p2;

  if (game.mode === 'online' && online.pendingSync) {
    const s = online.pendingSync;
    online.pendingSync = null;
    applyOnlineSync(s);
  }

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

  if (game.mode === 'online') {
    if (online.guestReadyTurn !== game.turns) online.guestReady = false;
    online.revealSent = false;
    online.guestActions = null;
    if (online.revealTimer) clearTimeout(online.revealTimer);
    online.revealTimer = null;
  }

  if (isAIMode(game.mode)) {
    const think = 700 + Math.random() * 900;
    setTimeout(() => {
      if (game && game.state === 'decision' && !game.players.p2.confirmed) {
        aiLock(game.players.p2);
      }
    }, think);
  } else if (game.mode === 'online') {
    /* rAF é pausado com a aba em segundo plano; garante o auto-lock próprio.
       Sem cronômetro não existe prazo: agendar o timeout com Infinity
       estouraria o limite do setTimeout e travaria o turno na hora. */
    if (online.lockTimer) clearTimeout(online.lockTimer);
    online.lockTimer = null;
    if (timeLimitOn()) {
      const own = game.players[game.myKey];
      online.lockTimer = setTimeout(() => {
        online.lockTimer = null;
        if (game && game.mode === 'online' && game.state === 'decision' && !game.players[game.myKey].confirmed) {
          autoLock(game.myKey);
        }
      }, Math.max(0, own.deadline - performance.now()) + 60);
    }
  }
}

function updateCharge() {
  for (const k of ['p1', 'p2']) {
    const p = game.players[k];
    if (p.element === 'raio' && !p.chargedUsed && !p.charged && p.hp <= p.maxHp / 2) {
      p.charged = true;
      sfx.zap();
      bannerText(`⚡ ${p.name} ENERGIZOU! Habilidade Raio pronta!`, 1800);
      log(`<span class="log-entry big">⚡ ${p.name} (Raio): energizou! Usar a habilidade no turno causa <b>2 de dano</b>, bloqueia 1 ação aleatória por 3 turnos e concede <b>dano x2 permanente</b> pelo resto da partida.</span>`);
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
  /* no tutorial o Treino joga o que o passo pedir, para o jogador conseguir concluir */
  if (tut && game.mode === 'tutorial' && p.isAI && tut.forceAI) {
    p.selection = { combo: false, actions: [tut.forceAI] };
    return;
  }
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

  /* responde com uma das DUAS ações que vencem a do jogador (a roda dá
     sempre duas respostas certas, então a máquina escolhe entre elas) */
  const counters = {
    ataque: ['refletir', 'projetil'],
    refletir: ['projetil', 'defesa'],
    projetil: ['defesa', 'agarrar'],
    defesa: ['agarrar', 'ataque'],
    agarrar: ['ataque', 'refletir'],
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
/* Devolve os eventos de um único slot.
   O jogo é uma roda de 5: cada ação vence as DUAS seguintes (RODA/vence()).
       Ataque > Refletir > Projétil > Defesa > Agarrar > Ataque
   Nenhum par fica sem vencedor.
   - 'hit'      um lado acerta o outro
   - 'counter'  a Defesa segurou o Ataque ou o Agarrar e abre o Contragolpe
   - 'grapple'  o Agarrar pegou o adversário: cancela o 2º slot do Combo
   - 'reflect'  o Refletir devolveu o golpe
   - 'clash'    os dois atacam e ambos se ferem
   - 'grappleClash' os dois se agarram e ambos se ferem
   - 'brace'    as duas Defesas se sustentam, ninguém se fere
   - 'waves'    os dois Refletires jogam ondas, ninguém se fere
   - 'projClash' os projéteis colidem no ar
   'landedBy' diz quem marcou o ponto: 'p1' | 'p2' | 'both' | null */
function slotEvents(a, b) {
  const P = key => game.players[key];

  if (a && b) {
    /* habilidades ativas têm prioridade e são resolvidas à parte */
    if (isActiveAction(a) || isActiveAction(b)) {
      const out = [];
      if (isActiveAction(a)) out.push(activeEvent('p1', 'p2', a));
      if (isActiveAction(b)) out.push(activeEvent('p2', 'p1', b));
      if (isActiveAction(a) && isActiveAction(b)) return out;
      const channel = isActiveAction(a) ? 'p1' : 'p2';
      const other = isActiveAction(a) ? 'p2' : 'p1';
      const otherAct = isActiveAction(a) ? b : a;
      if (otherAct === 'ataque' || otherAct === 'projetil' || otherAct === 'agarrar') {
        out.push({
          kind: 'hit', winner: other, loser: channel, action: otherAct, beaten: '',
          dmg: calcDamage(P(other), otherAct, ''), landedBy: other,
        });
      } else {
        out.push({ kind: 'none', landedBy: null });
      }
      return out;
    }

    /* espelhos: nenhum dos lados fica sem resultado */
    if (a === b) {
      if (a === 'ataque') {
        return [{ kind: 'clash', landedBy: 'both' }];
      }
      if (a === 'projetil') {
        return [{ kind: 'projClash', landedBy: null }];
      }
      if (a === 'refletir') {
        /* duas ondas se encontram e se anulam: ninguém se fere */
        return [{ kind: 'waves', landedBy: null }];
      }
      if (a === 'agarrar') {
        /* os dois tentam se agarrar: cada um leva a pancada do outro */
        return [{ kind: 'grappleClash', landedBy: 'both' }];
      }
      /* duas Defesas: cada uma sustenta a sua, ninguém se fere */
      return [{ kind: 'brace', landedBy: null }];
    }

    /* ---- a roda decide: cada ação vence as duas seguintes ---- */
    const p1Vence = vence(a, b);
    const W = p1Vence ? 'p1' : 'p2';
    const L = p1Vence ? 'p2' : 'p1';
    const win = p1Vence ? a : b;
    const lose = p1Vence ? b : a;

    /* Defesa > Ataque e Defesa > Agarrar: o defensor é que pode contra-atacar.
       São os únicos dois confrontos que abrem a janela do Contragolpe. */
    if (win === 'defesa') {
      return [{ kind: 'counter', defender: W, attacker: L, act: lose, landedBy: null }];
    }

    /* Refletir > Projétil (+1) e Refletir > Defesa (usa o escudo dele contra ele) */
    if (win === 'refletir') {
      return [{
        kind: 'reflect', winner: W, loser: L, action: 'refletir', beaten: lose,
        dmg: calcDamage(P(W), 'refletir', lose), landedBy: W,
      }];
    }

    /* Agarrar > Ataque e Agarrar > Refletir: pega o adversário de surpresa */
    if (win === 'agarrar') {
      return [{
        kind: 'grapple', winner: W, loser: L, action: 'agarrar', beaten: lose,
        dmg: calcDamage(P(W), 'agarrar', lose), landedBy: W,
      }];
    }

    /* Ataque > Projétil (é mais rápido) e Ataque > Refletir;
       Projétil > Defesa (dano normal, o escudo não amortece mais) e
       Projétil > Agarrar */
    return [{
      kind: 'hit', winner: W, loser: L, action: win, beaten: lose,
      dmg: calcDamage(P(W), win, lose), landedBy: W,
    }];
  }

  /* sem oposição: quem jogou acerta direto */
  if (a) {
    if (isActiveAction(a)) return [activeEvent('p1', 'p2', a)];
    if (a === 'ataque' || a === 'projetil' || a === 'agarrar') {
      return [{ kind: 'hit', winner: 'p1', loser: 'p2', action: a, beaten: '', dmg: calcDamage(P('p1'), a, ''), landedBy: 'p1' }];
    }
    /* Defesa sem nada contra ela: não causa dano e não segura o Combo
       (não connects com nada), mas a barreira ainda sobe pra o jogador
       ver o que escolheu. */
    return [{ kind: 'none', landedBy: null, guard: a === 'defesa' ? 'p1' : null }];
  }
  if (b) {
    if (isActiveAction(b)) return [activeEvent('p2', 'p1', b)];
    if (b === 'ataque' || b === 'projetil' || b === 'agarrar') {
      return [{ kind: 'hit', winner: 'p2', loser: 'p1', action: b, beaten: '', dmg: calcDamage(P('p2'), b, ''), landedBy: 'p2' }];
    }
    return [{ kind: 'none', landedBy: null, guard: b === 'defesa' ? 'p2' : null }];
  }
  return [{ kind: 'none', landedBy: null }];
}

/* a ativa sempre marca o ponto, senão o combo dela se desfez na hora */
function activeEvent(winner, loser, act) {
  if (act === 'raio') return { kind: 'zap', winner, loser, landedBy: winner };
  if (act === 'incinerar') return { kind: 'burn', winner, loser, landedBy: winner };
  if (act === 'tempo') return { kind: 'heal', winner, loser, landedBy: winner };
  return { kind: 'none', winner, loser, landedBy: null };
}

/* ---------------- Dano e vantagens das bolas ---------------- */
/* bonus aplica um acréscimo plano no fim: assim a bola continua mandando no
   multiplicador e o +1 do Contragolpe/Refletir nunca é dobrado junto */
function calcDamage(attacker, action, beaten, bonus) {
  const base = BASE_DMG;
  let dmg;
  if (action === 'ataque') {
    if (attacker.element === 'pedra') dmg = base * 2;
    /* Ar é o atacante de mão pesada: bate mais forte em quem o recebe */
    else if (attacker.element === 'ar' && beaten === 'refletir') dmg = base + 2;
    else if (attacker.element === 'ar' && beaten === 'projetil') dmg = base + 1;
    else dmg = base;
  } else if (action === 'projetil') {
    if (attacker.element === 'ar' && beaten === 'defesa') dmg = base + 2;
    else dmg = base;
  } else if (action === 'refletir') {
    dmg = base;
    /* o +1 do Refletir é contra Projétil; contra a Defesa é o dano base */
    if (beaten === 'projetil') dmg = base + REFLECT_BONUS;
    /* Água é a bola do Refletir: ganha +1 em qualquer reflexo */
    if (attacker.element === 'agua') dmg += 1;
  } else if (action === 'agarrar') {
    /* o Agarrar causa o mesmo dano base dos outros. Nenhuma bola interage
       com ele ainda — a identidade dele é a rede de confrontos, e a bola que
       vai tirar proveito dele ainda não existe. */
    dmg = base;
  } else {
    dmg = base;
  }
  if (attacker.element === 'raio' && attacker.overPowered) dmg *= 2;
  if (attacker.element === 'tempo' && attacker.tempoWeakTurns > 0) dmg = Math.max(1, dmg - 1);
  if (bonus) dmg += bonus;
  return dmg;
}

/* o Agarrar é o dano base como os outros: a Defesa não amortece mais nada,
   então calcBlocked (metade do dano do Projétil) saiu junto com o evento pierce */

function applyDamage(player, dmg) {
  player.hp = Math.max(0, player.hp - dmg);
  refreshHUD();
  return player.hp;
}

function applyBlock(target, forced) {
  const usable = ACTION_ORDER.filter(a => target.counts[a] > 0);
  const pool = usable.length ? usable : ACTION_ORDER.slice();
  target.blockedAction = forced || pick(pool);
  target.blockTurns = 3;
  target.blockTurn = game.turns;
}

/* ---------------- Contragolpe ---------------- */
/* Abre a janela de 2s para o defensor contra-atacar. Devolve true se acertou.
   Quem não é o dono da janela só espera: no online o anfitrião aguarda a
   resposta do convidado, e o convidado espera o sync do anfitrião. */
function counterWindow(playerKey) {
  if (!game || game.state === 'over') return Promise.resolve(false);
  const onlineMode = game.mode === 'online';
  const mine = !onlineMode || (online.isHost ? playerKey === 'p1' : playerKey === 'p2');

  if (!mine) {
    if (onlineMode && online.isHost) {
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          if (online.waitingCounter && online.waitingCounter.resolve === resolve) {
            online.waitingCounter = null;
          }
          resolve(false);
        }, COUNTER_MS);
        online.waitingCounter = { resolve, timer };
      });
    }
    return Promise.resolve(false);
  }

  const p = game.players[playerKey];
  if (p.isAI) {
    return new Promise(resolve => setTimeout(() => resolve(Math.random() < AI_COUNTER_CHANCE), AI_COUNTER_DELAY));
  }

  const box = $('buttons-' + (playerKey === 'p1' ? 1 : 2));
  if (!box) return Promise.resolve(false);

  return new Promise(resolve => {
    const slot = document.createElement('div');
    slot.className = 'counter-slot';
    slot.innerHTML = `<button class="counter-btn" style="--dur:${COUNTER_MS}ms">
      <span class="cb-label">Contragolpe</span>
      <span class="cb-bar"></span>
    </button>`;
    const btn = slot.querySelector('.counter-btn');

    let done = false;
    const finish = hit => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (slot.parentNode) slot.parentNode.removeChild(slot);
      if (hit) {
        sfx.click();
        bannerText('Contragolpe!', 900);
      }
      if (onlineMode && !online.isHost) sendOnline({ type: 'counter', hit: !!hit });
      resolve(!!hit);
    };
    const timer = setTimeout(() => finish(false), COUNTER_MS);
    btn.addEventListener('click', e => { e.preventDefault(); finish(true); });
    box.appendChild(slot);
  });
}

/* ---------------- Playback dos eventos ---------------- */
async function startResolve() {
  if (!game || game.state !== 'decision') return;
  game.state = 'resolve';
  game.turns++;
  animatePhaseLabel('Resolvendo...');
  await resolveRound();
}

function startOnlineResolve() {
  if (!game || game.mode !== 'online' || game.state !== 'decision') return;
  game.state = 'resolve';
  game.turns++;
  animatePhaseLabel('Resolvendo...');
  online.awaitingSlots = true;
}

function onlineSlotKey(key) {
  return key === 'p1' ? 'p2' : 'p1';
}

/* O slot é montado e tocado de um lado só (o anfitrião no online, o próprio
   jogador nos demais modos). O 2º slot de um combo só existe se o 1º acertou,
   então a decisão precisa ser tomada depois da animação, não antes. */
async function resolveRound() {
  const p1 = game.players.p1, p2 = game.players.p2;
  const n = Math.max(p1.selection.actions.length, p2.selection.actions.length);
  /* `landed` = "esta jogador realmente connectou no 1º slot?".
     Começa falso de propósito: quem usou combo e teve a 1ª ação neutralizada
     (bloqueada, espelhada ou ignorada) NÃO continua o combo. Só quemCONNECTOU
     — atacou, lançou, bloqueou com dano ou acertou o Contragolpe — segue. */
  const landed = { p1: false, p2: false };
  /* `held` = "esta jogador está agarrado e não joga a 2ª ação".
     O Agarrar segura o adversário, mas SÓ quando ele ganha o confronto
     (ele perde para Projétil e Defesa) e SÓ no 1º slot — no 2º não há mais
     ação adversária para cancelar. Habilidade ativa nunca é cancelada: ela é
     de uso único e perdê-la sem errar a jogada seria injusto. */
  const held = { p1: false, p2: false };
  const host = game.mode === 'online' && online.isHost;

  for (let i = 0; i < n; i++) {
    if (!game || game.state === 'over') return;
    const drop = [];
    const agarrado = [];
    if (i > 0) {
      if (p1.selection.combo && !landed.p1) drop.push('p1');
      if (p2.selection.combo && !landed.p2) drop.push('p2');
      if (held.p1 && p1.selection.actions[i] && !isActiveAction(p1.selection.actions[i])) agarrado.push('p1');
      if (held.p2 && p2.selection.actions[i] && !isActiveAction(p2.selection.actions[i])) agarrado.push('p2');
      drop.push(...agarrado);
    }
    if (i > 0 && agarrado.length) {
      const quem = agarrado.length === 2 ? 'Os dois' : game.players[agarrado[0]].name;
      /* o log do combate é um no-op nesta versão, então o cancelamento do
         Combo precisa aparecer no banner — senão a 2ª ação simplesmente
         "desaparece" e o jogador não entende o que houve. */
      bannerText(agarrado.length === 2 ? 'OS DOIS FORAM AGARRADOS!' : `${quem} FOI AGARRADO!`, 1600);
      log(`<span class="log-entry">🤜 ${quem} agarrado${agarrado.length === 2 ? 's' : ''}: a 2ª ação não acontece. <b>Vocês não gastaram o combo.</b></span>`);
    }
    if (i > 0 && drop.length && !agarrado.length) {
      bannerText('COMBO SE DESFEZ', 900);
      log(`<span class="log-entry">💨 Combo de ${drop.map(k => game.players[k].name).join(' e ')} se desfez: a primeira ação não acertou nada. <b>Você não gastou o combo.</b></span>`);
    }
    /* o combo só é descontado no 2º slot, e só para quem ele realmente aconteceu */
    if (i > 0) {
      if (p1.selection.combo && !drop.includes('p1') && p1.selection.actions[i] && p1.combos > 0) p1.combos--;
      if (p2.selection.combo && !drop.includes('p2') && p2.selection.actions[i] && p2.combos > 0) p2.combos--;
    }
    const a = (i === 0 || !drop.includes('p1')) ? p1.selection.actions[i] : null;
    const b = (i === 0 || !drop.includes('p2')) ? p2.selection.actions[i] : null;
    const evs = slotEvents(a, b);

    if (host) {
      for (const ev of evs) {
        if (ev.kind === 'zap') {
          applyBlock(game.players[ev.loser]);
          ev.block = game.players[ev.loser].blockedAction;
        }
      }
      sendOnline({ type: 'slot', events: evs, last: i === n - 1, agarrado: agarrado.slice() });
    }

    for (const ev of evs) {
      if (!game || game.state === 'over') return;
      await playEvent(ev);
      if (ev.landedBy === 'both') { landed.p1 = true; landed.p2 = true; }
      else if (ev.landedBy) landed[ev.landedBy] = true;
      /* o Agarrar só segura quem ele realmente pegou: ganhou o confronto
         no 1º slot. Perder para Projétil ou Defesa não agarra ninguém. */
      if (i === 0 && ev.kind === 'grapple' && ev.landedBy) {
        held[ev.landedBy === 'p1' ? 'p2' : 'p1'] = true;
      }
    }
  }

  endRound();
  if (host) sendOnline({ type: 'sync', sync: onlineSnapshot() });
}

/* convidado: toca os slots que o anfitrião for mandando */
async function playOnlineSlot(evs, last, agarrado) {
  if (!game || game.state !== 'resolve') return;
  /* o cancelamento do Combo é decidido no anfitrião: o convidado só
     reproduz o aviso, senão a 2ª ação dele simplesmente desapareceria */
  if (agarrado && agarrado.length) {
    const quem = agarrado.length === 2 ? 'OS DOIS FORAM' : `${game.players[agarrado[0]].name} FOI`;
    bannerText(agarrado.length === 2 ? 'OS DOIS FORAM AGARRADOS!' : `${quem} AGARRADO!`, 1600);
  }
  for (const ev of (evs || [])) {
    if (!game || game.state === 'over') return;
    await playEvent(ev);
  }
  if (last) {
    endRound();
    online.awaitingSlots = false;
  }
}

async function playEvent(ev) {
  if (ev.kind === 'none') {
    /* Defesa sem oposição: a barreira sobe mesmo assim, para o jogador
       ver o escudo da própria bola */
    if (ev.guard) shieldFlash(ev.guard, game.players[ev.guard].element);
    await delay(350);
    return;
  }
  if (ev.kind === 'projClash') {
    const m1 = ballMetrics('p1');
    const m2 = ballMetrics('p2');
    const mx = (m1.x + m2.x) / 2;
    const my = (m1.y + m2.y) / 2 - m1.r * 0.5;
    sfx.whoosh();
    await Promise.all([
      flyProjectile('p1', mx, my, ELEMENTS[game.players.p1.element].cor),
      flyProjectile('p2', mx, my, ELEMENTS[game.players.p2.element].cor),
    ]);
    sfx.hit();
    anim.shake.p1 = 10;
    anim.shake.p2 = 10;
    impactAt(mx, my, '#ffd23f', m1.r);
    impactAt(mx, my, '#ffffff', m1.r * 0.6);
    log(`<span class="log-entry big">💥 Projéteis colidiram no ar! ${game.players.p1.name} e ${game.players.p2.name} se desequilibram, ninguém se fere.</span>`);
    await delay(450);
    return;
  }
  if (ev.kind === 'zap') {
    const W = game.players[ev.winner], L = game.players[ev.loser];
    sfx.zap();
    lightningBolt(ev.winner, ev.loser, ELEMENTS[W.element].cor);
    applyBlock(L, ev.block);
    /* o Raio cause o dano base: o especial não é de graça, e o dano
       sofrido ainda vira stack para a bola Tempo (como em qualquer golpe) */
    const zapDmg = BASE_DMG;
    applyDamage(L, zapDmg);
    tempoStacksFor(ev.loser, zapDmg);
    log(`<span class="log-entry big">⚡ ${W.name} (Raio) eletrocuta <b>${L.name}</b>! -${zapDmg} de dano, ação <b>${ACTIONS[L.blockedAction].nome}</b> bloqueada por 3 turnos e dano x2 permanente para ${W.name}!</span>`);
    await delay(550);
    return;
  }
  if (ev.kind === 'burn') {
    const W = game.players[ev.winner], L = game.players[ev.loser];
    if (tut && ev.winner === 'p1') tut.flags.burned = true;
    const stored = W.fireBonus;
    sfx.burn();
    flameStream(ev.winner, ev.loser);
    await delay(420);
    incinerateFx(ev.loser);
    applyDamage(L, stored);
    W.fireBonus = 0;
    if (L.element === 'tempo' && stored > 0 && L.tempoStacks < TEMPO_STACK_CAP) {
      L.tempoStacks = Math.min(TEMPO_STACK_CAP, L.tempoStacks + stored);
    }
    log(`<span class="log-entry big">🔥 ${W.name} (Fogo) lança <b>Incineração</b>: -${stored} de dano em ${L.name}. Stacks zerados.</span>`);
    refreshHUD();
    await delay(700);
    return;
  }
  if (ev.kind === 'clash') {
    /* dois Ataques ao mesmo tempo: os dois se ferem */
    const p1 = game.players.p1, p2 = game.players.p2;
    sfx.whoosh();
    await Promise.all([lunge('p1'), lunge('p2')]);
    sfx.hit();
    const d1 = calcDamage(p1, 'ataque', 'ataque');
    const d2 = calcDamage(p2, 'ataque', 'ataque');
    impact('p2', ELEMENTS[p1.element].cor);
    impact('p1', ELEMENTS[p2.element].cor);
    applyDamage(game.players.p2, d1);
    applyDamage(game.players.p1, d2);
    tempoStacksFor('p1', d2);
    tempoStacksFor('p2', d1);
    ev.dmg = Math.max(d1, d2);
    ev.landedBy = 'both';
    log(`<span class="log-entry big">💥 Choque de ataques: <b>${p1.name}</b> e <b>${p2.name}</b> se acertaram ao mesmo tempo!</span>`);
    log(`<span class="log-entry big"> → -${d1} e -${d2} de dano nos dois.</span>`);
    await delay(520);
    return;
  }
  if (ev.kind === 'waves') {
    /* dois Refletires: as ondas se encontram e se anulam. Ninguém se fere,
       mas o feedback visual mostra as duas jogando as ondas. */
    const p1 = game.players.p1, p2 = game.players.p2;
    sfx.whoosh();
    reflectWave('p1', 'p2', ELEMENTS[p1.element].cor);
    reflectWave('p2', 'p1', ELEMENTS[p2.element].cor);
    sfx.reflect();
    ev.dmg = 0;
    ev.landedBy = null;
    log(`<span class="log-entry big">🪞 <b>${p1.name}</b> e <b>${p2.name}</b> jogaram as ondas ao mesmo tempo: elas se encontraram no meio e se anularam.</span>`);
    log(`<span class="log-entry">Ninguém levou dano.</span>`);
    await delay(520);
    return;
  }
  if (ev.kind === 'brace') {
    /* duas Defesas: cada uma sustenta a sua. Ninguém se fere e não abre
       contragolpe — o feedback visual é o escudo de cada uma. */
    const p1 = game.players.p1, p2 = game.players.p2;
    sfx.block();
    shieldFlash('p1', p1.element);
    shieldFlash('p2', p2.element);
    ev.dmg = 0;
    ev.landedBy = null;
    log(`<span class="log-entry big">🛡 <b>${p1.name}</b> e <b>${p2.name}</b> se defenderam ao mesmo tempo: os dois escudos se sustentaram.</span>`);
    log(`<span class="log-entry">Ninguém levou dano.</span>`);
    refreshHUD();
    await delay(520);
    return;
  }
  if (ev.kind === 'grappleClash') {
    /* dois Agarrares: os dois tentam pegar o outro e cada um leva a pancada */
    const p1 = game.players.p1, p2 = game.players.p2;
    /* os dois se agarram ao mesmo tempo e a disputa solta os dois */
    await grabTug(ELEMENTS[p1.element].cor, ELEMENTS[p2.element].cor);
    const d1 = calcDamage(p1, 'agarrar', 'agarrar');
    const d2 = calcDamage(p2, 'agarrar', 'agarrar');
    applyDamage(game.players.p2, d1);
    applyDamage(game.players.p1, d2);
    tempoStacksFor('p1', d2);
    tempoStacksFor('p2', d1);
    ev.dmg = Math.max(d1, d2);
    ev.landedBy = 'both';
    log(`<span class="log-entry big">🤜🤛 Os dois tentaram se agarrar ao mesmo tempo e trocaram a pancada!</span>`);
    log(`<span class="log-entry big"> → -${d1} e -${d2} de dano nos dois.</span>`);
    await delay(520);
    return;
  }
  if (ev.kind === 'grapple') {
    /* Agarrar > Ataque e Agarrar > Refletir: o agarrador pega o adversário.
       O cancelamento do 2º slot do Combo é feito em resolveRound(), que
       precisa do landedBy para saber se o agarrar realmente pegou. */
    const W = game.players[ev.winner], L = game.players[ev.loser];
    /* agarra e arremessa: não é um soco, o adversário é jogado longe */
    await grabThrow(ev.winner, ev.loser, ELEMENTS[W.element].cor);
    const dmg = ev.dmg;
    applyDamage(L, dmg);
    tempoStacksFor(ev.loser, dmg);
    logStruggle(ev);
    refreshHUD();
    await delay(450);
    return;
  }
  if (ev.kind === 'counter') {
    const D = game.players[ev.defender], A = game.players[ev.attacker];
    /* a Defesa segurou o Ataque ou o Agarrar: são os dois únicos casos */
    if (ev.act === 'agarrar') {
      /* o Agarrar não pode aparecer como soco: a garra estende e o escudo
         a barra, empurrando o agarrador de volta */
      await grabBlocked(ev.attacker, ev.defender, ELEMENTS[A.element].cor);
    } else {
      sfx.whoosh();
      await lunge(ev.attacker);
    }
    sfx.block();
    shieldFlash(ev.defender, D.element);
    impact(ev.attacker, ELEMENTS[D.element].cor);
    const qual = ACTIONS[ev.act] ? ACTIONS[ev.act].nome : ev.act;
    log(`<span class="log-entry big">🛡 <b>${D.name}</b> segurou o ${qual} de <b>${A.name}</b>!</span>`);
    await delay(260);

    const acertou = await counterWindow(ev.defender);

    if (acertou) {
      if (tut && ev.defender === 'p1') tut.flags.countered = true;
      const dmg = calcDamage(D, 'ataque', 'ataque', COUNTER_BONUS);
      sfx.whoosh();
      await lunge(ev.defender);
      sfx.hit();
      impact(ev.attacker, ELEMENTS[D.element].cor);
      applyDamage(A, dmg);
      tempoStacksFor(ev.attacker, dmg);
      ev.dmg = dmg;
      ev.landedBy = ev.defender;
      log(`<span class="log-entry big">💥 <b>${D.name}</b> acertou o <b>Contragolpe</b> (+${COUNTER_BONUS})!</span>`);
      log(`<span class="log-entry big"> → -${dmg} de dano em <b>${A.name}</b>.</span>`);
    } else {
      log(`<span class="log-entry"><b>${D.name}</b> segurou, mas o Contragolpe passou batido.</span>`);
    }
    refreshHUD();
    await delay(480);
    return;
  }
  if (ev.kind === 'heal') {
    const W = game.players[ev.winner];
    const stacks = Math.min(TEMPO_STACK_CAP, W.tempoStacks);
    const heal = stacks * TEMPO_HEAL_PER_STACK;
    W.tempoStacks = 0;
    W.tempoHealUsed = true;
    sfx.heal();
    rewindFx(ev.winner);
    W.hp = Math.min(W.maxHp, W.hp + heal);
    W.tempoWeakTurns = 3;
    W.tempoWeakTurn = game.turns;
    log(`<span class="log-entry big">⏱ ${W.name} (Tempo) usa <b>Regenerar</b> (uso único): recupera +${heal} de vida. A energia do tempo se esgotou: dano -1 em todas as ações por 3 turnos.</span>`);
    refreshHUD();
    await delay(700);
    return;
  }
  const W = game.players[ev.winner];
  const L = game.players[ev.loser];
  const act = ev.action;
  const dmg = ev.dmg;

  if (ev.kind === 'reflect') {
    /* O Refletir devolve uma ONDA, nunca um projétil: quem reflete não
       atira nada, só inverte o que veio contra ele.
       contra Projétil: o projétil do adversário viaja até o refletor (esse
         foi Ele quem atirou) e a onda volta com +1.
       contra Defesa: não houve projétil nenhum, então a onda só nasce no
         refletor e rompe o escudo. */
    if (ev.beaten === 'defesa') {
      sfx.whoosh();
      sfx.reflect();
      shieldFlash(ev.loser, game.players[ev.loser].element);
      reflectWave(ev.winner, ev.loser, ELEMENTS[W.element].cor);
      await delay(420);
      impact(ev.loser, ELEMENTS[W.element].cor);
    } else {
      sfx.whoosh();
      await shootProjectile(ev.loser, ev.winner, '#ffd23f');
      sfx.reflect();
      reflectWave(ev.winner, ev.loser, ELEMENTS[W.element].cor);
      await delay(420);
      impact(ev.loser, ELEMENTS[W.element].cor);
    }
  } else if (act === 'ataque') {
    sfx.whoosh();
    await lunge(ev.winner);
    sfx.hit();
  } else if (act === 'agarrar') {
    /* o agarrar chega aqui só contra ativa ou sem oposição: quando há
       confronto normal ele vira um evento 'grapple' com o cancelamento */
    await grabThrow(ev.winner, ev.loser, ELEMENTS[W.element].cor);
  } else {
    /* projetil */
    sfx.whoosh();
    await shootProjectile(ev.winner, ev.loser, ELEMENTS[W.element].cor);
    sfx.hit();
  }

  applyDamage(L, dmg);

  /* Fogo: +2 de stack em todo projétil que acerta (dano fica guardado p/ Incineração) */
  if (act === 'projetil') fireStack(ev.winner);

  /* Tempo: ganha stacks (máx. 7) conforme recebe dano */
  tempoStacksFor(ev.loser, dmg);

  logStruggle(ev);
  await delay(450);
}

/* Fogo guarda 2 de stack por projétil acertado */
function fireStack(key) {
  const S = game.players[key];
  if (S.element !== 'fogo') return;
  S.fireBonus += 2;
  log(`<span class="log-entry big">${S.name} (Fogo): +2 stacks! Incineração agora causa ${S.fireBonus} de dano.</span>`);
  refreshHUD();
}

/* Tempo converte o dano sofrido em stacks (máx. 7) */
function tempoStacksFor(key, dmg) {
  const T = game.players[key];
  if (T.element !== 'tempo' || dmg <= 0 || T.tempoStacks >= TEMPO_STACK_CAP) return;
  const room = TEMPO_STACK_CAP - T.tempoStacks;
  const gain = Math.min(dmg, room);
  T.tempoStacks += gain;
  log(`<span class="log-entry big">${T.name} (Tempo): +${gain} stacks! Regenerar agora cura ${T.tempoStacks} de vida.</span>`);
  refreshHUD();
}

function logStruggle(ev) {
  if (ev.kind === 'none') { log(`<span class="log-entry">Nenhuma ação efetiva.</span>`); return; }
  const W = game.players[ev.winner], L = game.players[ev.loser];
  const wEl = ELEMENTS[W.element], lEl = ELEMENTS[L.element];
  const wName = `<b style="color:${wEl.cor}">${W.name} (${wEl.nome})</b>`;
  const lName = `<b style="color:${lEl.cor}">${L.name} (${lEl.nome})</b>`;
  const actFull = ACTIONS[ev.action].nome;
  const dmgColor = ev.dmg > BASE_DMG ? 'big' : 'dmg';
  /* o "gancho" muda conforme a ação que foi respondida */
  const contra = !ev.beaten ? ''
    : ev.action === 'refletir' && ev.beaten === 'defesa' ? ' (usou o escudo dele como ataque)'
    : ev.action === 'agarrar' ? ' (agarrou)'
    : ev.beaten === 'defesa' ? ' (o escudo não amorteceu)'
    : ` (respondeu ${ACTIONS[ev.beaten].nome})`;
  const line = `${wName} usa <b>${actFull}</b> contra ${lName}${contra}.`;
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
    if (tutorialGuard()) return;
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

  if (tut) {
    if (game.frenzy) tut.frenzyDone = true;
    tutorialEvent();
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
  const mode = game ? game.mode : currentMode;
  if (mode === 'online') {
    if (online.rematchSent) return;
    online.rematchSent = true;
    sendOnline({ type: 'rematch' });
    game = null;
    if (online.rematchReceived) {
      $('gameover').hidden = true;
      goOnlineSelect();
    } else {
      $('result-title').textContent = 'Aguardando o oponente...';
      $('result-sub').textContent = 'Você pediu a revanche. Aguarde o oponente aceitar.';
    }
    return;
  }
  $('gameover').hidden = true;
  game = null;
  if (mode === 'tutorial') { startTutorial(); return; }
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
    if (game.mode === 'online' && pk !== game.myKey) continue;
    if (k === KEYS.ataque) { ev.preventDefault(); onPickAction(pk, 'ataque'); }
    else if (k === KEYS.defesa) { ev.preventDefault(); onPickAction(pk, 'defesa'); }
    else if (k === KEYS.projetil) { ev.preventDefault(); onPickAction(pk, 'projetil'); }
    else if (k === KEYS.refletir) { ev.preventDefault(); onPickAction(pk, 'refletir'); }
    else if (k === KEYS.combo) { ev.preventDefault(); onPickCombo(pk); }
    else if (k === KEYS.ok) { ev.preventDefault(); confirmPlayer(pk); }
  }
});

/* ---------------- Loops principais ---------------- */
const panelHeads = { 1: 'VOCÊ', 2: 'OPONENTE' };
function setPanelHead(n, label) {
  panelHeads[n] = label;
  const el = $('panel-' + n + '-head');
  if (el) el.textContent = label;
}

function refreshTimeHeads(r1, r2) {
  const h1 = $('panel-1-head');
  const h2 = $('panel-2-head');
  const fmt = (label, s) => s === null ? label : `${label} · ${s}s`;
  if (h1) h1.textContent = fmt(panelHeads[1], r1 === null ? null : Math.max(0, Math.ceil(r1 / 1000)));
  if (h2) h2.textContent = fmt(panelHeads[2], r2 === null ? null : Math.max(0, Math.ceil(r2 / 1000)));
}

function frame(now) {
  requestAnimationFrame(frame);
  if (game) {
    if (game.state === 'decision' && now) {
      const nowMs = now || performance.now();
      const p1 = game.players.p1, p2 = game.players.p2;
      /* enquanto o coach está explicando, o relógio não corre. Numa sala sem
         tempo os prazos são Infinity e não podem ser reescritos aqui. */
      if (tut && !tut.guard) {
        const st = TUTORIAL_STEPS[tut.i];
        if (st && st.mode === 'talk') {
          if (timeLimitOn()) {
            p1.deadline = nowMs + 2000;
            p2.deadline = nowMs + 2000;
          }
        } else if (st && typeof st.goal === 'function') {
          /* objetivo dinâmico (ex.: contador de turnos) */
          const g = $('coach-goal');
          const html = st.goal();
          if (g.innerHTML !== html) g.innerHTML = html;
        }
      }
      const p1rem = p1.deadline - nowMs;
      const p2rem = p2.deadline - nowMs;
      const el = $('timer-label');
      if (!timeLimitOn()) {
        /* Sala sem tempo: mostra o infinito, não aperta o relógio e não
           bloqueia ninguém por demora. Os prazos são Infinity, então nem
           comparison nem auto-lock são feitos aqui. */
        el.textContent = '∞';
        el.classList.remove('tight');
        refreshTimeHeads(null, null);
      } else {
        const rem = game.mode === 'online' ? game.players[game.myKey].deadline - nowMs : Math.min(p1rem, p2rem);
        const secs = Math.max(0, Math.ceil(rem / 1000));
        el.textContent = secs;
        el.classList.toggle('tight', rem < 1000 || game.frenzy);
        refreshTimeHeads(p1rem, p2rem);
        if (game.mode === 'online') {
          const me = game.players[game.myKey];
          if (!me.confirmed && me.deadline <= nowMs) autoLock(game.myKey);
        } else {
          /* fora do online só existe a máquina como oponente */
          if (!p1.confirmed && p1rem <= 0) autoLock('p1');
          if (!p2.confirmed && p2rem <= 0) aiLock(p2);
          if (p1.confirmed && p2.confirmed) startResolve();
        }
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

/* ---------------- Agarrar: a garra e o arremesso ----------------
   O Agarrar NÃO pode parecer um ataque. A sequência é:
     1. o braço estende e a garra fecha no adversário
     2. o adversário é puxado na direção de quem agarrou
     3. e arremessado para longe, cambaleando de volta pro lugar
   Tudo pelo anim.off, que é só visual: a hitbox não muda. */
function grabLink(fromKey, toKey, color) {
  anim.grapples.push({ from: fromKey, to: toKey, life: 1, maxLife: 1, color: color || '#ffd23f', seed: Math.random() * 100 });
}

/* as bolas ficam em 20% e 80% da largura da arena, e o canvas cresce com o
   dpi da tela. Por isso o alcance, o puxão e o arremesso sao medidos no
   raio da bola e na largura do canvas: assim o Agarrar sai igual em
   qualquer tela, e o arremesso nunca joga a vítima para fora da arena. */
function grabReach() {
  const r = ballMetrics('p1').r;
  return { reach: r * 3.4, pull: r * 1.3, toss: r * 2.4 };
}

function grabThrowRoom(fromKey, toKey) {
  const m = ballMetrics(toKey);
  const w = canvas ? canvas.width : 820;
  const dir = fromKey === 'p1' ? 1 : -1;
  /* quanto ainda cabe até a borda, deixando a bola inteira visível */
  const room = dir > 0 ? (w - m.x - m.r * 1.15) : (m.x - m.r * 1.15);
  return Math.max(m.r * 1.2, Math.min(w * 0.3, room));
}

async function grabThrow(fromKey, toKey, color) {
  const dir = fromKey === 'p1' ? 1 : -1;
  const a = ballMetrics(fromKey), b = ballMetrics(toKey);
  const { reach, pull } = grabReach();
  const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  /* a garra só alcança um tanto: de mais longe ela estica e o adversário é
     arrastado até o alcance antes de ser arremessado */
  const PULL = Math.min(pull, Math.max(reach, dist * 0.5));
  const THROW = grabThrowRoom(fromKey, toKey);
  grabLink(fromKey, toKey, color);
  sfx.whoosh();

  /* 1. o braço estende */
  await tween(180, p => {
    const e = Math.sin(p * Math.PI * 0.9);
    anim.off[fromKey].x = dir * reach * 0.8 * e;
    anim.off[fromKey].y = -a.r * 0.9 * e;
  });

  /* 2. a garra fecha e puxa */
  sfx.grab();
  await tween(150, p => {
    anim.off[toKey].x = -dir * PULL * p;
    anim.off[toKey].y = -b.r * 0.5 * p;
  });

  /* 3. o arremesso, pra longe. O alvo e THROW a partir da posicao de
     descanso: o puxao tem de ser desfeito, senao a vitima so avanca few
     pixels e o Agarrar parece um soco */
  sfx.hit();
  await tween(260, p => {
    const e = 1 - Math.pow(1 - p, 3);
    anim.off[toKey].x = -dir * PULL + dir * (PULL + THROW) * e;
    anim.off[toKey].y = -b.r * 0.5 - b.r * 1.5 * Math.sin(p * Math.PI);
  });
  impact(toKey, color);
  anim.off[fromKey].x = 0;
  anim.off[fromKey].y = 0;

  /* 4. a vítima volta cambaleando */
  const rest = dir * THROW;
  await tween(240, p => {
    const back = 1 - p;
    anim.off[toKey].x = rest * back * back;
    anim.off[toKey].y = -b.r * 0.5 * back * back;
  });
  anim.off[toKey].x = 0;
  anim.off[toKey].y = 0;
}

/* Agarrar x Agarrar: os dois se pegam ao mesmo tempo e a disputa empurra
   os dois para trás. Não dá pra rodar dois grabThrow ao mesmo tempo — eles
   brigariam pelo mesmo anim.off. */
async function grabTug(color1, color2) {
  const { reach } = grabReach();
  const puxa = reach * 0.62, solta = reach * 0.78;
  grabLink('p1', 'p2', color1);
  grabLink('p2', 'p1', color2);
  sfx.whoosh();
  /* os dois se puxam para o meio */
  await tween(230, p => {
    const e = Math.sin(p * Math.PI);
    anim.off.p1.x = puxa * e; anim.off.p2.x = -puxa * e;
    anim.off.p1.y = -puxa * 0.28 * e; anim.off.p2.y = -puxa * 0.28 * e;
  });
  /* a disputa solta: os dois são jogados para trás */
  sfx.hit();
  await tween(200, p => {
    const e = 1 - Math.pow(1 - p, 3);
    anim.off.p1.x = solta * e; anim.off.p2.x = -solta * e;
  });
  for (const g of anim.grapples) g.life = Math.min(g.life, 0.3);
  await tween(220, p => {
    const back = 1 - p;
    anim.off.p1.x = solta * back * back; anim.off.p2.x = -solta * back * back;
    anim.off.p1.y = -puxa * 0.28 * back * back; anim.off.p2.y = -puxa * 0.28 * back * back;
  });
  anim.off.p1.x = 0; anim.off.p1.y = 0;
  anim.off.p2.x = 0; anim.off.p2.y = 0;
}

/* o Agarrar foi barrado: a garra estende, o escudo segura e o agarrador é
   empurrado de volta. Sem arremesso — a defesa aguentou. */
async function grabBlocked(fromKey, toKey, color) {
  const dir = fromKey === 'p1' ? 1 : -1;
  const r = ballMetrics(fromKey).r;
  grabLink(fromKey, toKey, color);
  sfx.whoosh();
  await tween(200, p => {
    const e = Math.sin(p * Math.PI);
    anim.off[fromKey].x = dir * r * 1.6 * e;
    anim.off[fromKey].y = -r * 0.8 * e;
  });
  anim.off[fromKey].x = 0;
  anim.off[fromKey].y = 0;
  for (const g of anim.grapples) g.life = Math.min(g.life, 0.45);
}

/* ---------------- Escudo da Defesa, por elemento ----------------
   Cada bola levanta a sua própria barreira, e todas elas encaram o
   adversário (o lado que o golpe vai bater):
     Fogo  = labareda de fogo      Pedra = parede de pedra
     Raio  = campo de força        Ar    = furacão
     Água  = onda                  Tempo = relógio de energia
   Dura ~1.1s, o suficiente para a janela de 2s do Contragolpe. */
function shieldFlash(key, element) {
  const m = ballMetrics(key);
  const el = ELEMENTS[element] || {};
  anim.shields.push({
    key, element: element || 'pedra', life: 1.15, maxLife: 1.15,
    seed: Math.random() * 100, color: el.glow || '#66ccff', tone: el.cor || '#66ccff',
  });
  /* a onda de abertura: o escudo "aparece" com um baque */
  anim.rings.push({
    x: m.x, y: m.y, r: m.r * 0.6, vr: m.r * 4, alpha: 1,
    color: el.glow || '#66ccff', width: 6,
  });
}

/* ângulo do escudo: aponta para o bola inimigo */
function shieldFacing(key) {
  const me = ballMetrics(key);
  const foe = ballMetrics(key === 'p1' ? 'p2' : 'p1');
  return Math.atan2(foe.y - me.y, foe.x - me.x);
}

function impact(key, color) {
  anim.shake[key] = 14;
  const m = ballMetrics(key);
  impactAt(m.x, m.y, color, m.r);
}

function impactAt(x, y, color, r) {
  r = r || 30;
  anim.rings.push({ x, y, r: r * 0.4, vr: r * 5.5, alpha: 0.9, color, width: 8 });
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

function flameStream(fromKey, toKey) {
  anim.flames.push({ from: fromKey, to: toKey, life: 1.35, seed: Math.random() * 100 });
  for (const k of [fromKey, toKey]) {
    const m = ballMetrics(k);
    anim.rings.push({ x: m.x, y: m.y, r: m.r * 0.6, vr: m.r * 4.5, alpha: 0.85, color: '#ff6b35', width: 7 });
    anim.rings.push({ x: m.x, y: m.y, r: m.r * 0.3, vr: m.r * 3, alpha: 0.7, color: '#ffd23f', width: 5 });
  }
}

/* Tempo: Regenerar — o tempo volta, então tudo é puxado de volta para a bola */
function rewindFx(key) {
  const m = ballMetrics(key);
  anim.rewinds.push({ key, life: 1.4, t: 0, seed: Math.random() * 100 });
  /* anéis que recolhem para dentro: o inverso do impacto */
  anim.rings.push({ x: m.x, y: m.y, r: m.r * 7, vr: -m.r * 4.2, alpha: 0.65, color: '#35e0c0', width: 6 });
  anim.rings.push({ x: m.x, y: m.y, r: m.r * 5, vr: -m.r * 3, alpha: 0.55, color: '#8ff7dd', width: 4 });
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

async function flyProjectile(fromKey, x, y, color, speed) {
  const f = ballMetrics(fromKey);
  const rnd = { x: f.x, y: f.y, color, trail: [], trailOffset: 0 };
  anim.projectiles.push(rnd);
  const dist = Math.hypot(x - f.x, y - f.y);
  const dur = clamp(dist / 1000, 0.32, 0.6) * 1000;
  await tween(dur / (speed || 1), p => {
    const tx = f.x + (x - f.x) * p;
    const ty = f.y + (y - f.y) * p;
    rnd.x = tx;
    rnd.y = ty;
    rnd.trail.push({ x: tx, y: ty, life: 1 });
    if (rnd.trail.length > 8) rnd.trail.shift();
  });
  rnd.trail.forEach(tr => (tr.life = 0));
  const idx = anim.projectiles.indexOf(rnd);
  if (idx >= 0) anim.projectiles.splice(idx, 1);
}

async function shootProjectile(fromKey, toKey, color, speedUp) {
  const t = ballMetrics(toKey);
  await flyProjectile(fromKey, t.x, t.y, color, speedUp ? 1.5 : 1);
  impact(toKey, color);
}

/* O Refletir NÃO é um projétil: é uma onda que sai do bola e viaja até o
   adversário. Desenha arcos concêntricos que atravessam a tela, no mesmo
   padrão do flameStream, então quem reflete nunca "atira uma bola". */
function reflectWave(fromKey, toKey, color) {
  anim.pulses.push({ from: fromKey, to: toKey, life: 1, color: color || '#9fe8ff' });
  const m = ballMetrics(fromKey);
  anim.rings.push({
    x: m.x, y: m.y, r: m.r * 0.5, vr: m.r * 3.2, alpha: 0.95,
    color: color || '#9fe8ff', width: 5,
  });
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

  /* rastros de fogo (incineração) */
  anim.flames = anim.flames.filter(f => f.life > 0);
  for (const f of anim.flames) {
    const a = ballPos(f.from, t);
    const b = ballPos(f.to, t);
    const k = clamp(f.life, 0, 1);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const w = 16 + 16 * k;
    const puffs = 9;
    for (let i = 0; i < puffs; i++) {
      const p = i / (puffs - 1);
      /* serpentina com duas frequências, como o raio, mas larga e redonda */
      const wobble = Math.sin(p * 7 + t * 0.011 + f.seed) * 26
        + Math.sin(p * 17 - t * 0.007 + f.seed) * 11;
      const px = a.x + dx * p + nx * wobble;
      const py = a.y + dy * p + ny * wobble;
      const fade = k * (0.35 + 0.65 * Math.sin(p * Math.PI));
      const g = ctx.createRadialGradient(px, py, 0, px, py, w);
      g.addColorStop(0, `rgba(255,236,170,${0.85 * fade})`);
      g.addColorStop(0.4, `rgba(255,138,40,${0.7 * fade})`);
      g.addColorStop(1, 'rgba(190,30,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, w, 0, Math.PI * 2);
      ctx.fill();
    }
    /* brasas viajando junto com a chama */
    for (let i = 0; i < 3; i++) {
      if (Math.random() < 0.55) {
        const p = Math.random();
        anim.particles.push({
          x: a.x + dx * p, y: a.y + dy * p,
          vx: (Math.random() - 0.5) * 40, vy: -30 - Math.random() * 50,
          life: 0.5, maxLife: 0.5,
          color: pick(['#ffd23f', '#ff8f3f', '#ff6b35']), size: 2 + Math.random() * 3,
        });
      }
    }
    f.life -= 0.022;
  }

  /* ondas de Refletir: arcos concêntricos que viajam de uma bola à outra.
     Não é projétil: não tem bola, nem rastro, só a frente da onda. */
  anim.pulses = anim.pulses.filter(p => p.life > 0);
  for (const p of anim.pulses) {
    const a = ballPos(p.from, t);
    const b = ballPos(p.to, t);
    const k = clamp(p.life, 0, 1);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const px = -uy, py = ux;            /* perpendicular à frente da onda */
    const R = ballMetrics(p.from).r;
    /* a onda cresce e se move: nasce colada na bola e chega larga no alvo */
    const head = 1 - k;
    for (let arc = 0; arc < 3; arc++) {
      const off = (arc - 1) * 9;        /* as três frentes, uma atrás da outra */
      const cx = a.x + dx * head + px * off;
      const cy = a.y + dy * head + py * off;
      const rad = R * (0.75 + 0.5 * head) * (1 + arc * 0.16);
      /* fade no meio do caminho e nas pontas, para não parecer um círculo solto */
      const env = Math.sin(Math.min(1, Math.max(0, head)) * Math.PI);
      ctx.globalAlpha = clamp(k * (0.28 + 0.55 * env) * (1 - arc * 0.22), 0, 1);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = (7 - arc * 1.6) * k;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    p.life -= 0.028;
  }
  ctx.globalAlpha = 1;

  /* garra do Agarrar: a corrente sai da bola, fecha a mão no adversário e
     o arremesso é desenhado com linhas de velocidade */
  anim.grapples = anim.grapples.filter(g => g.life > 0);
  for (const g of anim.grapples) {
    const a = ballPos(g.from, t);
    const b = ballPos(g.to, t);
    const k = clamp(g.life / g.maxLife, 0, 1);
    const R = ballMetrics(g.to).r;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const fade = Math.min(1, k * 3);

    /* a corrente: elos grossos ao longo da linha, com folga quando estica */
    const slack = Math.sin(g.life * 6 + g.seed) * 6 * (1 - k);
    const segs = 9;
    for (let i = 1; i < segs; i++) {
      const p = i / segs;
      const px = a.x + dx * p - uy * slack * Math.sin(p * Math.PI);
      const py = a.y + dy * p + ux * slack * Math.sin(p * Math.PI);
      ctx.globalAlpha = 0.85 * fade;
      ctx.fillStyle = '#2a2a33';
      ctx.beginPath();
      ctx.ellipse(px, py, 5, 3.6, Math.atan2(dy, dx), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = g.color;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    /* a mão: fecha no centro do adversário */
    const grip = 1 - Math.min(1, (1 - k) * 3.2);   /* abre rápido, fecha */
    ctx.globalAlpha = fade;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.strokeStyle = g.color;
    ctx.shadowColor = g.color;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 3;
    /* quatro dedos curvados sobre a bola + o pulso */
    for (let i = 0; i < 4; i++) {
      const ang = -1.1 + (i / 3) * 2.2;
      const rr = R * (0.96 - 0.12 * grip);
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * rr * 0.35, Math.sin(ang) * rr * 0.35, R * (0.4 + 0.16 * (1 - grip)), ang - 0.9, ang + 0.9);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.restore();

    /* linhas de velocidade do arremesso, atrás da vítima */
    if (k < 0.75) {
      ctx.globalAlpha = 0.5 * fade * (1 - k / 0.75);
      ctx.strokeStyle = g.color;
      ctx.lineWidth = 2;
      const back = R * 3.4;
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * R * 0.55;
        ctx.beginPath();
        ctx.moveTo(b.x - ux * back - uy * off, b.y - uy * back + ux * off);
        ctx.lineTo(b.x - ux * R * 0.9 - uy * off, b.y - uy * R * 0.9 + ux * off);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    g.life -= 0.02;
  }

  /* escudo da Defesa: cada bola levanta a barreira dela, de frente para
     o adversário. Fogo labareda, Pedra parede, Raio campo de força,
     Ar furacão, Água onda, Tempo relógio. */
  anim.shields = anim.shields.filter(s => s.life > 0);
  for (const s of anim.shields) {
    const m = ballMetrics(s.key);
    const k = clamp(s.life / s.maxLife, 0, 1);
    const R = m.r;
    const fade = Math.min(1, k * 2.4);                 /* acende rápido, apaga no fim */
    const pump = 1 + 0.05 * Math.sin(t * 0.02 + s.seed); /* a barreira "respira" */
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(shieldFacing(s.key));                   /* +x passa a apontar pro inimigo */
    ctx.scale(pump, pump);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (s.element === 'fogo') {
      /* labareda: línguas de fogo lambendo a frente da bola */
      for (let i = 0; i < 7; i++) {
        const p = i / 6;
        const a = (p - 0.5) * 2.1;
        const flick = Math.abs(Math.sin(t * 0.013 + i * 1.4 + s.seed));
        const cx = Math.cos(a) * R * 0.92, cy = Math.sin(a) * R * 0.92;
        const rad = R * (0.34 + 0.34 * flick);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.scale(1, 1 + 0.9 * flick);                  /* estica na direção da labareda */
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
        g.addColorStop(0, `rgba(255,244,205,${0.92 * fade})`);
        g.addColorStop(0.4, `rgba(255,150,55,${0.7 * fade})`);
        g.addColorStop(1, 'rgba(190,36,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else if (s.element === 'raio') {
      /* campo de força: cúpula hexagonal com raios crepitando por cima */
      const rr = R * 1.55;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const px = Math.cos(a) * rr * 0.92, py = Math.sin(a) * rr * 0.92;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(176,107,255,${0.15 * fade})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(214,168,255,${0.85 * fade})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      /* malha interna */
      ctx.strokeStyle = `rgba(176,107,255,${0.28 * fade})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * rr * 0.92, Math.sin(a) * rr * 0.92);
        ctx.stroke();
      }
      /*unos raios crepitando (o tremor de frame em frame dá o estalo) */
      ctx.shadowColor = '#e0b3ff';
      ctx.shadowBlur = 16;
      for (let i = 0; i < 3; i++) {
        const a0 = Math.random() * Math.PI * 2;
        const rr0 = rr * (0.35 + Math.random() * 0.6);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        for (let j = 1; j <= 4; j++) {
          const aa = a0 + (Math.random() - 0.5) * 0.8;
          const rad = rr0 * (j / 4);
          ctx.lineTo(Math.cos(aa) * rad, Math.sin(aa) * rad);
        }
        ctx.strokeStyle = `rgba(235,205,255,${0.8 * fade})`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    } else if (s.element === 'ar') {
      /* furacão: braços em espiral girando ao redor da bola */
      for (let arm = 0; arm < 3; arm++) {
        ctx.beginPath();
        const phase = t * 0.009 + s.seed + (arm / 3) * Math.PI * 2;
        for (let i = 0; i <= 16; i++) {
          const p = i / 16;
          const a = phase + p * 2.4;
          const rad = R * (0.4 + 1.0 * p);
          const px = Math.cos(a) * rad, py = Math.sin(a) * rad;
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.strokeStyle = `rgba(234,246,255,${(0.18 + 0.45 * k) * fade})`;
        ctx.lineWidth = 4.5 - arm * 0.8;
        ctx.stroke();
      }
    } else if (s.element === 'agua') {
      /* onda: corpo d'água com a crista quebrando na frente */
      const A = 1.3, rIn = R * 0.95, rOut = R * 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, rOut, -A, A);
      ctx.arc(0, 0, rIn, A, -A, true);
      ctx.closePath();
      const g = ctx.createRadialGradient(0, 0, rIn, 0, 0, rOut);
      g.addColorStop(0, `rgba(53,167,255,${0.5 * fade})`);
      g.addColorStop(1, `rgba(16,86,190,${0.88 * fade})`);
      ctx.fillStyle = g;
      ctx.fill();
      /* crista: uma onda quebrando, não um aro liso */
      ctx.beginPath();
      for (let i = 0; i <= 20; i++) {
        const p = i / 20, a = -A + 2 * A * p;
        const rr = rOut + Math.sin(p * Math.PI * 3 + t * 0.02) * R * 0.13;
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.strokeStyle = `rgba(232,250,255,${0.92 * fade})`;
      ctx.lineWidth = 3.5;
      ctx.stroke();
      /* espuma */
      for (let i = 0; i < 5; i++) {
        const a = -A + 2 * A * ((i + 0.5) / 5);
        const rr = rOut + Math.sin(t * 0.02 + i) * R * 0.1;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, R * 0.09, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.55 * fade})`;
        ctx.fill();
      }
    } else if (s.element === 'tempo') {
      /* relógio de energia temporal: mostrador, marcas e ponteiros girando */
      const rr = R * 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(53,224,192,${0.12 * fade})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(45,212,179,${0.9 * fade})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * rr * 0.9, Math.sin(a) * rr * 0.9);
        ctx.lineTo(Math.cos(a) * rr * 0.76, Math.sin(a) * rr * 0.76);
        ctx.strokeStyle = `rgba(170,255,238,${0.8 * fade})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      /* ponteiro dos segundos (rápido) e dos minutos (devagar, ao contrário) */
      for (const h of [[t * 0.008, rr * 0.5], [-t * 0.0022, rr * 0.72]]) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(h[0]) * h[1], Math.sin(h[0]) * h[1]);
        ctx.strokeStyle = `rgba(235,255,251,${0.95 * fade})`;
        ctx.lineWidth = 2.6;
        ctx.stroke();
      }
      /* anel de energia girando por fora */
      ctx.beginPath();
      ctx.arc(0, 0, rr * 1.1, t * 0.011, t * 0.011 + 2.3);
      ctx.strokeStyle = `rgba(53,224,192,${0.7 * fade})`;
      ctx.lineWidth = 4;
      ctx.stroke();
    } else {
      /* pedra: parede de blocos de frente para o golpe */
      const A = 1.15, rIn = R * 1.02, rOut = R * 1.66;
      ctx.beginPath();
      ctx.arc(0, 0, rOut, -A, A);
      ctx.arc(0, 0, rIn, A, -A, true);
      ctx.closePath();
      ctx.fillStyle = `rgba(104,97,86,${0.88 * fade})`;
      ctx.fill();
      for (let i = 0; i < 5; i++) {
        const a = -A + 2 * A * ((i + 0.5) / 5);
        const rr = (rIn + rOut) / 2;
        const sh = 128 + i * 9;
        ctx.save();
        ctx.translate(Math.cos(a) * rr, Math.sin(a) * rr);
        ctx.rotate(a);
        ctx.fillStyle = `rgba(${sh + 26},${sh + 18},${sh + 4},${0.95 * fade})`;
        ctx.fillRect(-R * 0.17, -R * 0.21, R * 0.34, R * 0.42);
        ctx.strokeStyle = `rgba(58,53,46,${0.7 * fade})`;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(-R * 0.17, -R * 0.21, R * 0.34, R * 0.42);
        ctx.restore();
      }
      /* aresta iluminada */
      ctx.beginPath();
      ctx.arc(0, 0, rOut, -A, A);
      ctx.strokeStyle = `rgba(232,226,212,${0.9 * fade})`;
      ctx.lineWidth = 2.6;
      ctx.stroke();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
    s.life -= 0.015;
  }

  /* voltas no tempo (regenerar da bola Tempo) */
  anim.rewinds = anim.rewinds.filter(w => w.life > 0);
  for (const w of anim.rewinds) {
    const c = ballMetrics(w.key);
    const k = clamp(w.life, 0, 1);
    w.t += 0.045;
    ctx.save();

    /* dois mostradores girando em sentidos opostos: o relógio correndo ao contrário */
    for (let ring = 0; ring < 2; ring++) {
      ctx.beginPath();
      ctx.strokeStyle = ring ? '#8ff7dd' : '#35e0c0';
      ctx.lineWidth = 3 - ring * 0.8;
      ctx.setLineDash(ring ? [3, 12] : [18, 13]);
      ctx.lineDashOffset = -w.seed + (ring ? t * 0.25 : -t * 0.18);
      ctx.arc(c.x, c.y, c.r * (1.5 + ring * 0.75), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    /* ponteiro do relógio girando para trás */
    const hand = -w.t - w.seed;
    const hr = c.r * 1.9;
    ctx.globalAlpha = k * 0.5;
    ctx.fillStyle = '#8ff7dd';
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.arc(c.x, c.y, hr, hand, hand + 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = k * 0.95;
    ctx.strokeStyle = '#dcfff5';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + Math.cos(hand) * hr, c.y + Math.sin(hand) * hr);
    ctx.stroke();
    ctx.restore();

    /* partículas voltando para a bola: o inverso do impacto */
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = c.r * (2.2 + Math.random() * 3.4);
      const sp = 300 + Math.random() * 130;
      anim.particles.push({
        x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d,
        vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp,
        life: 0.6, maxLife: 0.6,
        color: pick(['#35e0c0', '#8ff7dd', '#2dd4b3']), size: 2 + Math.random() * 3,
      });
    }
    w.life -= 0.012;
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