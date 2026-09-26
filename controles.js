'use strict';

/* ============================================================
   BOLISTIC - controles
   Os paineis de jogada, o HUD, a escolha das acoes do jogador e a
   maquina que escolhe as dela. Cuida so da decisao; quem aplica as
   regras do combate e o regras.js.
   ============================================================ */
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

  /* O sync do anfitriao e a unica fonte da vida correta no online, e ele so
     chega aqui. Por isso o fim de partida e conferido DEPOIS de aplicar o sync:
     sem esta checagem, um golpe que matou rodava com a vida antiga, o
     endRound nao via o hp <= 0, e o turno seguinte comecava normalmente contra
     um oponente ja morto -- o convidado ficava preso numa partida que o
     anfitriao ja tinha encerrado, sem nenhuma tela de volta para sair. */
  if (p1.hp <= 0 || p2.hp <= 0) {
    if (tutorialGuard()) return;
    /* o convidado termina a partida pelo sync do anfitrião, entao e aqui que
       o ultimo turno dele precisa ser gravado (no anfitrião, e no endRound) */
    if (gravando) { registrarTurno(); finalizarGravacao(); }
    game.state = 'over';
    finishMatch();
    return;
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