'use strict';

/* ============================================================
   BOLISTIC - modo online (PeerJS/WebRTC)
   A criacao e a entrada nas salas, a conexao, a conversa entre os
   dois jogadores e a reconciliacao de estado no fim de cada turno.
   ============================================================ */
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
    /* os botões já estavam escondidos na hora de tentar criar a sala; sem
       devolvê-los, um erro síncrono deixava a tela sem nenhuma forma de
       sair. */
    $('online-actions').hidden = false;
    $('online-join').hidden = true;
    online.peer = null;
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
    $('online-actions').hidden = false;
    $('online-join').hidden = true;
    online.peer = null;
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
  /* Envio falhado é o modo silencioso de travar a partida: o outro lado fica
     esperando uma mensagem que nunca chega, sem nenhum aviso. O console é o
     canal de diagnóstico, mas o jogador precisa ver também. */
  if (!online.connected || !online.conn || !online.conn.open) {
    console.warn('[online] tentativa de enviar sem conexão:', msg && msg.type);
    return false;
  }
  try {
    online.conn.send(msg);
    return true;
  } catch (e) {
    console.error('[online] falha ao enviar', msg && msg.type, e);
    return false;
  }
}

function closeOnline() {
  if (online.revealTimer) clearTimeout(online.revealTimer);
  if (online.watchdog) clearTimeout(online.watchdog);
  if (online.lockTimer) clearTimeout(online.lockTimer);
  if (online.slotTimer) clearTimeout(online.slotTimer);
  /* a janela de Contragolpe do anfitrião é uma Promise que só se resolve com a
     resposta do convidado. Se a conexão cai dentro dela, ninguém mais responde:
     a `resolveRound` ficava esperando para sempre e, pior, voltava a resumed
     quando a partida seguinte começava, medindo a partida nova. Encerra com
     "não acertou". */
  if (online.waitingCounter) {
    const w = online.waitingCounter;
    online.waitingCounter = null;
    clearTimeout(w.timer);
    w.resolve(false);
  }
  try { if (online.conn) online.conn.close(); } catch (e) {}
  try { if (online.peer) online.peer.destroy(); } catch (e) {}
  online.conn = null;
  online.peer = null;
  online.watchdog = null;
  online.revealTimer = null;
  online.lockTimer = null;
  online.slotTimer = null;
  online.waitingCounter = null;
  online.awaitingSlots = false;
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
  online.awaitingSlots = false;
  online.slotTimer = null;
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
  document.body.classList.remove('partida-encerrada');
  $('gameover').hidden = true;
  showScreen('screen-menu');
}

function onOnlineData(raw) {
  let msg = raw;
  try { if (typeof raw === 'string') msg = JSON.parse(raw); } catch (e) { return; }
  if (!msg || typeof msg.type !== 'string') return;

  /* Tudo que chega pela rede entra no estado do jogo. Um campo inesperado não
     pode virar crash: `ELEMENTS[undefined]` e `ACTIONS[undefined]` explodem no
     meio da partida e deixam a tela sem nenhuma ação para sair. O que não
     bater com a tabela vira recusa limpa. */
  const elementoValido = v => typeof v === 'string' && Object.prototype.hasOwnProperty.call(ELEMENTS, v);
  const acoesValidas = a => Array.isArray(a)
    && a.length <= 2
    && a.every(x => typeof x === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, x));
  const acaoInvalida = () => {
    console.warn('[online] mensagem fora do formato, ignorada.');
    setOnlineStatus('O oponente enviou uma mensagem inesperada. A partida foi encerrada.');
    onOnlineLeave();
  };

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
        if (!elementoValido(msg.element)) { acaoInvalida(); return; }
        online.guestElement = msg.element;
        if (online.hostPicked) startOnlineBattle(online.hostPicked, msg.element);
      }
      break;
    case 'start':
      if (!online.isHost && !online.started) {
        if (!elementoValido(msg.e1) || !elementoValido(msg.e2)) { acaoInvalida(); return; }
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
        online.revealTimer = null;
        /* fica registrado para a trava do tempo limite saber que a jogada
           chegou: sem esta atribuição o campo nunca era lido e a guarda
           `!online.guestActions` era sempre verdadeira. */
        online.guestActions = acoesValidas(msg.actions) ? msg.actions.slice() : null;
        if (game.state === 'decision') {
          if (!online.guestActions) { acaoInvalida(); return; }
          game.players.p2.selection = { combo: !!msg.combo, actions: online.guestActions };
          lockPlayer('p2');
          /* As duas escolhas vao junto no "round". O convidado nunca recebe a
             escolha do anfitriao de outro jeito, e sem ela nao consegue
             montar o replay da partida. */
          sendOnline({ type: 'round', sel: { p1: clonar(game.players.p1.selection), p2: clonar(game.players.p2.selection) } });
          startResolve();
        }
      }
      break;
    case 'round':
      /* protocolo antigo: o convidado começa a resolução e espera os slots */
      if (!online.isHost && game && game.mode === 'online' && game.state === 'decision') {
        /* as escolhas do anfitriao chegam aqui: e o que permite ao convidado
           gravar o replay da partida tambem */
        if (msg.sel && msg.sel.p1 && msg.sel.p2 && gravando) {
          game.players.p1.selection = clonar(msg.sel.p1);
        }
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
      /* só faz sentido com a partida terminada. Aceitar isso no meio da luta
         jogaria a tela de seleção por cima da batalha sem avisar. */
      if (!game || game.state !== 'over') return;
      online.rematchReceived = true;
      if (online.rematchSent) {
        $('gameover').hidden = true;
        goOnlineSelect();
      } else {
        $('result-sub').textContent = 'Oponente quer uma revanche! Clique em Revanche para aceitar.';
      }
      break;
    case 'leave':
      /* o convidado pode avisar que está saindo em qualquer momento; o
         anfitrião só trata isso como partida encerrada se havia uma em curso,
         senão a tela de sala seria fechada por um "leave" atrasado. */
      if (online.isHost && game && game.mode !== 'online') return;
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
      sendOnline({ type: 'round', sel: { p1: clonar(game.players.p1.selection), p2: clonar(game.players.p2.selection) } });
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
      /* `blockTurn`/`tempoWeakTurn` dizem em que turno o efeito foi aplicado.
         Sem eles no sync, o convidado repetia a checagem de decaimento contra o
         turno errado e nunca liberava o bloqueio nem o dano reduzido — a bola
         Raio e a bola Tempo ficavam travadas para sempre no online. */
      blockTurn: p.blockTurn,
      tempoStacks: p.tempoStacks,
      tempoHealUsed: p.tempoHealUsed,
      tempoWeakTurns: p.tempoWeakTurns,
      tempoWeakTurn: p.tempoWeakTurn,
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
    p.blockTurn = s.blockTurn;
    p.tempoStacks = s.tempoStacks;
    p.tempoHealUsed = s.tempoHealUsed;
    p.tempoWeakTurns = s.tempoWeakTurns;
    p.tempoWeakTurn = s.tempoWeakTurn;
  }
  document.body.classList.toggle('frenzy', !!game.frenzy);
  refreshPanel('p1');
  refreshPanel('p2');
  refreshHUD();
}