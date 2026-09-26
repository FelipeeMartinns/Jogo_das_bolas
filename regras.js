'use strict';

/* ============================================================
   BOLISTIC - regras do combate
   A roda que decide cada confronto, o dano com as vantagens de cada
   bola, o combo, o agarrar e o contragolpe. Nao desenha nada.
   ============================================================ */
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
/* O replay precisa do MESMO resultado da janela original: a rolagem da
   maquina e aleatoria e, no caso do jogador, o botao so e apertado por
   alguem. Sem guardar o resultado, a reproducao ficaria 2 segundos
   esperando ninguem apertar e o dano sairia diferente do original. */
function counterWindow(playerKey) {
  if (emReplay) return Promise.resolve(filaCountadores.shift() === true);
  return counterWindowReal(playerKey).then(r => { registrarContador(r); return r; });
}

/* Abre a janela de 2s para o defensor contra-atacar. Devolve true se acertou.
   Quem não é o dono da janela só espera: no online o anfitrião aguarda a
   resposta do convidado, e o convidado espera o sync do anfitrião. */
function counterWindowReal(playerKey) {
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