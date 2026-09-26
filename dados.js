'use strict';

/* ============================================================
   BOLISTIC - dados do jogo
   Tabelas das bolas e das acoes, as constantes de balanceamento e a
   regra da roda. Nao depende de nada: e o primeiro arquivo carregado.
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