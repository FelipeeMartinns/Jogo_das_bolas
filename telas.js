'use strict';

/* ============================================================
   BOLISTIC - telas
   A navegacao entre menu, selecao e batalha, mais a colecao de
   bolas e o painel de configuracoes.
   ============================================================ */
/* ---------------- Navegação de telas ---------------- */
function showScreen(id) {
  currentScreen = id.replace('screen-', '');
  /* As telas sao descobertas no proprio HTML em vez de uma lista escrita a
     mao aqui. Com a lista fixa, uma tela nova que ninguem lembrasse de
     adicionar simplesmente nunca aparecia: nenhuma outra tela era escondida e
     a dela continuava escondida, Resultado: clique sem nada acontecendo. */
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; });
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

/* A tela de batalha é um beco sem saída: o único jeito de sair era esperar a
   partida terminar. Isso não é problema num jogo contra a máquina, mas no
   online significava que um guest que travasse ficava preso para sempre sem
   nenhum botão. Este é o botão de saída, com confirmação para não ser
   apertado sem querer. */
function confirmExitBattle() {
  if (!game) return;
  const onlineMode = game.mode === 'online';
  const turno = game.state === 'resolve'
    ? 'A rodada está em andamento.'
    : `Você está no turno ${game.turns}.`;
  const pergunta = onlineMode
    ? `${turno}\n\nSair agora desconecta a sala e encerra a partida para os dois. O adversário fica sabendo que você saiu.\n\nTem certeza?`
    : `${turno}\n\nA partida em andamento será perdida. Tem certeza?`;
  if (!confirm(pergunta)) return;
  ensureAudio();
  sfx.click();
  backToMenu();
}

function backToMenu() {
  /* cancela o turno agendado: sem isso, sair no meio da janela entre as
     animações deixa um setTimeout vivo que abriria o turno de uma partida
     que já não existe. */
  if (proximoTurnoTimer) { clearTimeout(proximoTurnoTimer); proximoTurnoTimer = null; }
  if (online.peer || online.conn) {
    sendOnline({ type: 'leave' });
    closeOnline();
  } else if (game && game.mode === 'online') {
    closeOnline();
  }
  game = null;
  $('gameover').hidden = true;
  document.body.classList.remove('frenzy');
  document.body.classList.remove('partida-encerrada');
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