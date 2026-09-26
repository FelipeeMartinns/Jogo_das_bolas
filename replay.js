'use strict';

/* ============================================================
   BOLISTIC - replay das partidas
   A ideia: a resolucao de um turno (resolveRound) e totalmente
   deterministica - ela nao sorteia nada, as bolas sempre saem no
   mesmo lugar. Entao um replay nao precisa guardar video nenhum:
   basta guardar o estado do comeco da partida e as escolhas de cada
   turno, e chamar o mesmo resolveRound de novo. Toda a animacao e o
   desenho ja existem e sao reaproveitados.

   O que precisa ser gravado alem das escolhas:
   - o estado inicial (a "foto" da partida antes do primeiro turno);
   - o resultado de cada janela de Contragolpe, porque nele a rolagem
     da maquina e aleatoria e o botão do jogador depende de alguem
     apertar. Sem isso o replay nao reproduz a partida original.
   ============================================================ */

/* ---------------- Estado do gravador ---------------- */
let gravando = false;      /* a partida atual esta sendo gravada? */
let registro = null;       /* a partida em andamento que vira replay */
let filaCountadores = [];  /* resultados de Contragolpe ja gravados */
let emReplay = false;      /* estamos reproduzindo (nao eh partida de verdade) */
let replayAtivo = null;    /* o registro que esta tocando */
let replayAbortar = false; /* o jogador mandou pular/sair */
let ultimoReplay = null;   /* a ultima partida salva (botao da tela de resultado) */

/* como o jogo guarda as configuracoes no navegador (audio.js) */
const REPLAYS_KEY = 'jdb.replays.v1';
const REPLAYS_MAX = 12;

const Replays = {
  lista: [],

  carregar() {
    try {
      const raw = localStorage.getItem(REPLAYS_KEY);
      const l = raw ? JSON.parse(raw) : [];
      this.lista = Array.isArray(l) ? l.filter(r => r && r.base && Array.isArray(r.turnos)) : [];
    } catch (e) { this.lista = []; }
  },

  salvar() {
    try {
      localStorage.setItem(REPLAYS_KEY, JSON.stringify(this.lista.slice(0, REPLAYS_MAX)));
    } catch (e) { /* sem storage: o replay so vale nesta sessao */ }
  },

  guardar(rec) {
    this.lista.unshift(rec);
    if (this.lista.length > REPLAYS_MAX) this.lista.length = REPLAYS_MAX;
    this.salvar();
  },

  apagarTudo() {
    this.lista = [];
    try { localStorage.removeItem(REPLAYS_KEY); } catch (e) { /* nada a fazer */ }
  },

  remover(id) {
    this.lista = this.lista.filter(r => r.id !== id);
    this.salvar();
  },
};
Replays.carregar();

/* ---------------- Gravacao ----------------
   Uma copia profunda e pequena: os dados sao numeros, textos e
   objetos simples, entao o JSON funciona como clone. */
function clonar(o) { return JSON.parse(JSON.stringify(o)); }

function inicioGravacao(e1, e2) {
  /* o replay nao se grava: ele ja esta tocando um registro, e gravar de novo
     sobrescreveria a partida original com a reproducao */
  if (emReplay) return;
  /* o tutorial nao tem replay: ele tem um coach que avanca junto com a
     luta, e reproduzir a partida por baixo dele brigaria com as duas
     coisas ao mesmo tempo. */
  if (currentMode === 'tutorial') { gravando = false; registro = null; return; }
  gravando = true;
  registro = {
    modo: currentMode,
    e1, e2,
    turnos: [],
    contadores: [],
    /* marcado no fim, quando finishMatch sabe quem venceu */
    vencedor: null,
    hpRestante: null,
    data: Date.now(),
  };
  filaCountadores = [];
  registro.base = clonar(game);
}

function registrarTurno() {
  if (!gravando || !registro || !game) return;
  registro.turnos.push({
    p1: clonar(game.players.p1.selection),
    p2: clonar(game.players.p2.selection),
  });
}

/* called a partir de counterWindow (regras.js): o resultado precisa ser
   guardado na ordem em que as janelas aparecem, porque e assim que o
   replay vai consume-las. */
function registrarContador(acertou) {
  if (gravando && registro) registro.contadores.push(!!acertou);
}

function finalizarGravacao() {
  if (!gravando || !registro || !game) { gravando = false; registro = null; return; }
  const p1 = game.players.p1, p2 = game.players.p2;
  const venceu = p1.hp > 0 ? p1 : p2;
  registro.vencedor = venceu.key;
  registro.hpRestante = Math.max(0, Math.max(p1.hp, p2.hp));
  registro.id = 'r' + registro.data + '-' + Math.floor(Math.random() * 1000);
  Replays.guardar(registro);
  ultimoReplay = registro;
  gravando = false;
  registro = null;
}

/* ---------------- Tela da lista ---------------- */
function abrirReplays() {
  if (quickPick('abrirReplays')) return;
  ensureAudio();
  sfx.click();
  closeOnline();
  /* sair de uma partida em andamento para ver os replays nao pode deixar o
     turno agendado vivo, senao ele abre a fase de decisao de uma partida que
     nao existe mais */
  if (proximoTurnoTimer) { clearTimeout(proximoTurnoTimer); proximoTurnoTimer = null; }
  game = null;
  document.body.classList.remove('frenzy');
  document.body.classList.remove('partida-encerrada');
  renderListaReplays();
  showScreen('screen-replays');
}

function voltarDosReplays() {
  ensureAudio();
  sfx.click();
  showScreen('screen-menu');
}

function apagarTodosReplays() {
  ensureAudio();
  sfx.click();
  if (!Replays.lista.length) { alert('Não há replay para apagar.'); return; }
  if (!confirm(`Apagar todos os ${Replays.lista.length} replays? Não dá para desfazer.`)) return;
  Replays.apagarTudo();
  ultimoReplay = null;
  renderListaReplays();
}

function dataCurta(ms) {
  const d = new Date(ms);
  const p = n => (n < 10 ? '0' + n : '' + n);
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* O navegador recusa o localStorage quando a pagina vem do disco (origem sem
   site). Descobrindo isso na hora, a tela pode avisar em vez de mostrar uma
   lista vazia sem explicar o motivo. */
function storageDeReplays() {
  try {
    localStorage.setItem(REPLAYS_KEY + '.teste', '1');
    localStorage.removeItem(REPLAYS_KEY + '.teste');
    return true;
  } catch (e) { return false; }
}

function renderListaReplays() {
  const cx = $('replay-list');
  if (!cx) return;
  const aviso = $('replay-aviso');
  if (aviso) {
    aviso.innerHTML = storageDeReplays()
      ? 'As partidas ficam guardadas <b>só neste navegador</b>. Limpar os dados do navegador apaga os replays.'
      : '<b>Atenção:</b> neste navegador o armazenamento está bloqueado (acesso pelo arquivo local,'
        + ' sem servidor). Os replays desta sessão funcionam, mas <b>não sobrevivem ao F5</b>.'
        + ' Acesse pelo site para guardar de verdade.';
    aviso.classList.toggle('replay-aviso-erro', !storageDeReplays());
  }
  cx.innerHTML = '';
  if (!Replays.lista.length) {
    cx.innerHTML = '<p class="replay-vazio">Nenhuma partida gravada ainda.<br>'
      + 'Jogue contra a máquina ou online: a partida fica salva aqui.</p>';
    return;
  }
  for (const r of Replays.lista) {
    const item = document.createElement('div');
    item.className = 'replay-item';

    const info = document.createElement('div');
    info.className = 'replay-info';
    const n1 = ELEMENTS[r.e1] ? ELEMENTS[r.e1].nome : r.e1;
    const n2 = ELEMENTS[r.e2] ? ELEMENTS[r.e2].nome : r.e2;
    const nomes = `${n1} x ${n2}`;
    const quem = r.vencedor === 'p1' ? n1 : n2;
    const sobrou = r.hpRestante === null || r.hpRestante === undefined ? '' : ` · ${r.hpRestante} HP`;
    info.innerHTML = `<div class="replay-titulo">${nomes}</div>`
      + `<div class="replay-sub">${r.modo === 'online' ? 'Online' : 'Vs Máquina'} · ${r.turnos.length} turnos · ${dataCurta(r.data)}</div>`
      + `<div class="replay-sub">Venceu <b>${quem}</b>${sobrou}</div>`;
    info.appendChild(document.createElement('div'));

    const acoes = document.createElement('div');
    acoes.className = 'replay-acoes';

    const ver = document.createElement('button');
    ver.className = 'btn btn-primary replay-btn';
    ver.textContent = 'Ver';
    ver.addEventListener('click', () => { ensureAudio(); sfx.click(); verReplay(r); });
    acoes.appendChild(ver);

    const apagar = document.createElement('button');
    apagar.className = 'btn btn-plain replay-apagar';
    apagar.textContent = 'Apagar';
    apagar.title = 'Apagar este replay';
    apagar.addEventListener('click', () => {
      ensureAudio(); sfx.click();
      if (!confirm('Apagar este replay? Não dá para desfazer.')) return;
      Replays.remover(r.id);
      renderListaReplays();
    });
    acoes.appendChild(apagar);

    item.appendChild(info);
    item.appendChild(acoes);
    cx.appendChild(item);
  }
}

/* ---------------- Reproducao ----------------
   Monta a tela de batalha (canvas, paineis, HUD) e entao injeta o
   estado gravado do comeco da partida. A partir dai e so chamar o
   resolveRound de cada turno, em ordem. */
async function verReplay(rec) {
  if (!rec || !rec.base) return;
  ensureAudio();
  sfx.click();
  pararReplay();

  /* o startBattle monta o canvas e os paineis; o turno que ele abre no
     fim e Wrong logo em seguida, porque o replay sobrescreve o game
     inteiro logo abaixo. */
  currentMode = 'replay';
  emReplay = true;
  replayAtivo = rec;
  replayAbortar = false;
  filaCountadores = (rec.contadores || []).slice();

  startBattle(rec.e1, rec.e2);
  startReplayVisual();

  /* o estado gravado manda: e a foto exata do primeiro turno. o `mode`
     trocado impede que o resolveRound tente mandar mensagem de rede
     (ele so envia quando mode === 'online'), e o `state` travado em
     'resolve' impede que o laco de desenho abra a fase de decisao e
     deixe a maquina escolher no meio da reproducao. */
  game = clonar(rec.base);
  game.mode = 'replay';
  game.state = 'resolve';
  game.frenzy = false;
  game.turns = 0;
  tut = null;
  refreshHUD();

  for (const t of rec.turnos) {
    if (replayAbortar) break;
    if (!game || game.state === 'over') break;
    game.turns++;
    game.players.p1.selection = clonar(t.p1);
    game.players.p2.selection = clonar(t.p2);
    await resolveRound();
    if (replayAbortar) break;
  }

  /* Pausa curta no fim para o golpe final e a explosão aparecerem antes de
     trocar de tela. */
  if (!replayAbortar) {
    try { await delay(1400); } catch (e) { /* a animacao foi cortada */ }
  }
  fimReplay();
  if (!replayAbortar) {
    /* Sem isto a reproducao terminava na tela de batalha com o estado travado
       em "resolve": sem colunas de escolha, sem proximo turno, sem botao --
       uma tela morta. Volta para a lista, que e de onde o replay veio. */
    renderListaReplays();
    showScreen('screen-replays');
  }
}

/* Esconde as duas colunas de acoes: o replay mostra a luta, nao os
   turnos. E troca o rotulo do HUD por "REPLAY". */
function startReplayVisual() {
  document.body.classList.add('em-replay');
  $('btn-exit-battle').hidden = true;
  for (const k of [1, 2]) {
    const p = $('panel-' + k);
    if (p) p.classList.add('replay-hidden');
  }
  const r = $('replay-bar');
  if (r) r.hidden = false;
  animatePhaseLabel('REPLAY');
}

function fimReplay() {
  if (!emReplay) return;
  emReplay = false;
  replayAtivo = null;
  gravando = false;
  registro = null;
  /* o relogio volta SEMPRE que a reproducao acaba, tocada ou pulada: se
     ficasse mentindo, o jogo inteiro passaria a rodar com o tempo errado
     depois do primeiro "Pular". */
  _pararAceleracao();
  const r = $('replay-bar');
  if (r) r.hidden = true;
  const sair = $('replay-sair');
  if (sair) sair.hidden = true;
  document.body.classList.remove('em-replay');
  $('btn-exit-battle').hidden = false;
  for (const k of [1, 2]) {
    const p = $('panel-' + k);
    if (p) p.classList.remove('replay-hidden');
  }
}

/* ---------------- Pular / Sair ---------------- */
/* "Pular" vai direto ao fim da partida. Nao da para pular de verdade no
   meio da reproducao sem quebrar o codigo, porque da parapausa em cada
   animacao depende de um `await` que ja esta em voo. O que dá e
   resolver o resto da partida com o relogio do navegador mentindo: as
   mesmas funcoes, o mesmo estado, so que rapido. */
function pularReplay() {
  if (!emReplay) return;
  sfx.click();
  if (_pularRestore) return;
  _pularRestore = {
    now: Date.now,
    raf: window.requestAnimationFrame,
    caf: window.cancelAnimationFrame,
    st: window.setTimeout,
    cst: window.clearTimeout,
    perf: performance.now.bind(performance),
  };

  /* O relogio precisa ANDAR, nao ficar parado: o tween mede o progresso como
     (agora - inicio) / duracao. Com um relogio parado, ou com o callback do
     rAF recebendo um tempo diferente do performance.now, essa conta nunca
     chega em 1 e a animacao entra em laco infinito. Entao o falso relogio
     salta 1 segundo a cada leitura, e o rAF entrega exatamente o mesmo valor
     que o performance.now acabou de devolver. */
  let tFake = 1000000000000;
  const tick = () => { tFake += 1000; return tFake; };

  window.Date.now = tick;
  window.performance.now = tick;
  window.requestAnimationFrame = f => { try { f(tick()); } catch (e) { /* a animacao foi cortada */ } return 0; };
  window.cancelAnimationFrame = () => {};
  /* Todo prazo vira 0, mas o callback PRECISA continuar sendo chamado: o
     `delay()` do jogo e um setTimeout dentro de um Promise, e um setTimeout
     descartado deixaria a promise esperando para sempre. */
  window.setTimeout = (f, t, ...a) => _pularRestore.st(f, 0, ...a);
  window.clearTimeout = id => { if (id) _pularRestore.cst(id); };
}

function _pararAceleracao() {
  if (!_pularRestore) return;
  window.Date.now = _pularRestore.now;
  window.performance.now = _pularRestore.perf;
  window.requestAnimationFrame = _pularRestore.raf;
  window.cancelAnimationFrame = _pularRestore.caf;
  window.setTimeout = _pularRestore.st;
  window.clearTimeout = _pularRestore.cst;
  _pularRestore = null;
}
let _pularRestore = null;

/* "Sair" interrompe a reproducao agora e volta para onde o jogador
   estava. A promise do verReplay ainda vai acordar e cair no fim da
   lista, entao o Abortar e o que de fato garante que nada mais
   aconteca. */
function sairReplay() {
  if (!emReplay) return;
  sfx.click();
  pararReplay();
}

function pararReplay() {
  replayAbortar = true;
  _pararAceleracao();
  fimReplay();
  if (_replayIdle) { clearTimeout(_replayIdle); _replayIdle = null; }
  if ($('gameover') && !$('gameover').hidden) {
    showScreen('screen-battle');
    $('gameover').hidden = true;
    document.body.classList.remove('partida-encerrada');
  }
  showScreen('screen-replays');
}
let _replayIdle = null;

/* Aberta pelo "Ver replay" da tela de resultado. `ultimoReplay` e a partida
   que acabou de ser salva, para o botao nao depender de a lista estar
   ordenada nem de o jogador ter ido antes na tela de replays. */
function verUltimoReplay() {
  const r = ultimoReplay || Replays.lista[0];
  if (!r) { alert('Nenhuma partida gravada ainda.'); return; }
  verReplay(r);
}
