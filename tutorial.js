'use strict';

/* ============================================================
   BOLISTIC - tutorial
   Os passos do aprendizado guiado, que joga uma partida de verdade
   com o jogador como Pedra contra o oponente Treino.
   ============================================================ */
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