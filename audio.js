'use strict';

/* ============================================================
   BOLISTIC - audio
   Os sons de efeito e a musica, com as configuracoes salvas no
   navegador (localStorage).
   ============================================================ */
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