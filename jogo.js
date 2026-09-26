'use strict';

/* ============================================================
   BOLISTIC - estado e fluxo da partida
   O estado compartilhado por todos os arquivos, os helpers genericos e a
   maquina de estados da partida: montagem, turno, resolucao e fim.
   ============================================================ */
/* ---------------- Estado geral ---------------- */
let game = null;        // dados da partida atual
let anim = null;        // estado de animação / desenho
let canvas = null, ctx = null;
let screenBattle = null;
let audioCtx = null;
let currentMode = 'machine';
let currentScreen = 'menu';
let arenaResizeLigado = false;   /* o resize so registra o listener uma vez */
let proximoTurnoTimer = null;    /* agendamento do proximo turno, para poder cancelar */
let filaSlotsOnline = Promise.resolve();  /* slots do convidado, tocados em fila */

/* estado da partida online (PeerJS) */
let online = {
  peer: null, conn: null,
  isHost: false, connected: false, started: false,
  code: null,
  hostPicked: null, guestElement: null,
  guestReady: false, guestReadyTurn: -1, revealSent: false, revealTimer: null, guestActions: null,
  pendingSync: null, lockTimer: null,
  awaitingSlots: false,
  slotTimer: null,
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
    /* as cargas sao montadas a partir de ACTION_ORDER de proposito: escrevendo
       as acoes na mao era facil esquecer uma, e uma acao sem carga nunca gasta
       carga (o `undefined > 0` e falso), nunca e bloqueada por estar sem carga
       e some da lista de opcoes da maquina. */
    counts: ACTION_ORDER.reduce((c, a) => { c[a] = USE_PER_ACTION; return c; }, {}),
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
  document.body.classList.remove('partida-encerrada');
  /* cancela o agendamento do turno de uma partida anterior: sem isso, comecar
     uma partida dentro da janela de 1,1s faz o timer velho abrir o turno da
     partida nova e apagar o que o jogador acabou de escolher. */
  if (proximoTurnoTimer) { clearTimeout(proximoTurnoTimer); proximoTurnoTimer = null; }

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
  /* o listener e registrado uma vez so: startBattle pode rodar varias vezes na
     mesma sessao (revanche, tutorial depois de uma partida) e cada registro
     antigo continuaria chamando resizeCanvas em cima do canvas novo. */
  if (!arenaResizeLigado) {
    window.addEventListener('resize', resizeCanvas);
    arenaResizeLigado = true;
  }
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
  /* a foto inicial da partida e o que vai permitir o replay: e daqui que a
     reproducao recomeca, turno a turno, chamando o mesmo resolveRound */
  inicioGravacao(elementP1, elementP2);
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
  /* Rede é timing: um pacote perdido deixava o convidado preso em
     "Resolvendo..." sem botão nenhum, para sempre. Este é o velo de segurança
     do `awaitingSlots`, que era ligado aqui mas nunca consultado em lugar
     nenhum. Se nenhum slot chegar, a partida é encerrada na honestidade em vez
     de congelar a tela. */
  if (online.slotTimer) clearTimeout(online.slotTimer);
  online.slotTimer = setTimeout(() => {
    online.slotTimer = null;
    if (!online.awaitingSlots || !game || game.state !== 'resolve') return;
    console.warn('[online] nenhum slot recebido do anfitrião.');
    setOnlineStatus('A conexão com o anfitrião foi perdida durante a resolução.<br>Voltando ao menu.');
    onOnlineLeave();
  }, 15000);
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

  /* O convidado só fecha o turno quando chega um slot com `last`. Se nenhum
     slot foi montado (n === 0 — os dois confirmaram sem nenhuma ação, o que
     acontece quando o pedido de ações cai no tempo limite e o anfitrião
     resolve sozinho com `actions: []`), o laço acima não chega a rodar, nada é
     enviado e o convidado fica parado em "Resolvendo..." para sempre, sem
     botão nenhum. Por isso o anfitrião sempre fecha com um último slot, mesmo
     vazio. */
  if (host && n === 0) sendOnline({ type: 'slot', events: [], last: true, agarrado: [] });

  endRound();
  if (host) sendOnline({ type: 'sync', sync: onlineSnapshot() });
}

/* convidado: toca os slots que o anfitrião for mandando */
function playOnlineSlot(evs, last, agarrado) {
  /* Os slots são enfileirados um atrás do outro. O anfitrião manda o slot 2
     assim que termina de montar o 1 (ele não espera o convidado terminar de
     assistir), e sem esta fila as duas séries de `playEvent` rodavam
     intercaladas — as animações se atropelavam e o `endRound` do slot 1
     fechava o turno com a 2ª ação ainda no ar. */
  filaSlotsOnline = filaSlotsOnline
    .then(() => reproduzirSlotOnline(evs, last, agarrado))
    .catch(e => { console.error('[online] falha ao reproduzir o slot:', e); });
  return filaSlotsOnline;
}

async function reproduzirSlotOnline(evs, last, agarrado) {
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
  /* a partida pode ter sido anulada no meio da animacao (o jogador voltou ao
     menu, o oponente desconectou): sem esta guarda o `game.players` estoura. */
  if (!game || game.state === 'over') return;
  /* no replay nao existe turno seguinte: as escolhas do proximo turno ja estao
     gravadas e a reproducao apenas avanca o indice. */
  if (emReplay) return;
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
    /* o turno que matou precisa ser gravado ANTES de fechar: e ele que faz o
       replay mostrar o golpe final. Gravando so depois, o replay terminava um
       turno antes e o vencedor da partida aparecia vivo no fim. */
    if (gravando) { registrarTurno(); finalizarGravacao(); }
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
  /* fecha agravacao do turno antes de qualquer outra coisa */
  registrarTurno();
  /* o proximo turno e agendado, e nao chamado na hora: da tempo da animacao de
     "Fim do turno". O timer e guardado (e cancelado no startBattle) para que
     uma partida iniciada dentro dessa janela nao tenha a selecao apagada por
     esse agendamento antigo. */
  if (proximoTurnoTimer) clearTimeout(proximoTurnoTimer);
  proximoTurnoTimer = setTimeout(() => { proximoTurnoTimer = null; startDecision(); }, 1100);
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
  /* com a partida acabada não há mais nada para abandonar */
  document.body.classList.add('partida-encerrada');
  bannerText(`${winner.name} venceu!`, 2400);
  /* quem nao tem replay (o tutorial) nao precisa do botao */
  const btnReplay = $('btn-ver-replay');
  if (btnReplay) btnReplay.hidden = !ultimoReplay;
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