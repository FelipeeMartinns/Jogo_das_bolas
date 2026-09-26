'use strict';

/* ============================================================
   BOLISTIC - arena: desenho e animacao
   O canvas, o desenho das bolas, os efeitos de cada acao e os loops de
   tela. E o ultimo arquivo, porque o loop de desenho so comeca no fim
   dele, quando todas as funcoes ja existem.
   ============================================================ */
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

/* O loop comeca aqui, e nao junto do frame(): ele chama draw(), que so
   passa a existir depois que este arquivo inteiro carregou. */
requestAnimationFrame(frame);