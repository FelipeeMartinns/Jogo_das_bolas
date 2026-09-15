# Jogo das Bolas

Um jogo de luta entre bolas elementais, jogado em turnos no navegador. Cada jogador escolhe em segredo sua jogada, e o sistema resolve quem levou a melhor.

## Como rodar

Basta abrir o arquivo `index.html` em um navegador moderno (Chrome, Edge, Firefox):

- Dê dois cliques no arquivo `index.html`, **ou**
- arraste o arquivo para uma aba do navegador.

Não precisa instalar nada nem usar servidor. [Servir via HTTP](#opcional-rodar-com-servidor-http) também funciona.

### Modos de jogo

| Modo        | Descrição                                        |
|-------------|--------------------------------------------------|
| Hot-seat    | Dois jogadores no mesmo teclado, no mesmo PC     |
| Vs Máquina  | Um humano contra a máquina (IA de contra-ataque) |
| Online      | Disponibilizado futuramente (botão desativado)   |

## Controles

A escolha da jogada é feita por teclado ou clique nos botões do painel.

| Ação      | Jogador 1 | Jogador 2 |
|-----------|-----------|-----------|
| Ataque    | Q         | U         |
| Defesa    | W         | I         |
| Projétil  | E         | O         |
| Refletir  | R         | P         |
| Combo     | T         | K         |
| Confirmar | A         | L         |

## Mecânicas

- Cada jogada escolhe uma ação: **Ataque**, **Defesa**, **Projétil** ou **Refletir**.
- Ciclo de forças:
  - Ataque vence Projétil.
  - Projétil vence Defesa.
  - Defesa vence Ataque e Refletir.
  - Refletir devolve um Projétil contra quem o lançou.
- Defender um ataque com sucesso causa dano (contra-ataque).
- Cada ação tem **3 usos**. Quando os 3 acabam, eles recarregam no turno seguinte.
- **Combo** (3 por jogador, **não recarregam**): permite jogar **2 ações** no mesmo turno. Uma ação que não tem oposição no turno acerta direto.
- Turno de escolha: **5 segundos** para escolher e confirmar. Se não confirmar, o que já foi escolhido é usado; sem nenhuma escolha, o sistema não conta ações. Se o inimigo for uma bola **Tempo**, você tem **1 segundo a menos** (vale também no Vs Máquina quando a máquina é o Tempo).
- **Frenesi**: quando um jogador chega à metade da vida, o tempo cai para **3 segundos** por turno e a tela fica com aviso vermelho.

## As bolas

| Bola | Vantagem |
|------|----------|
| **Fogo** | Todo projétil que acerta acumula +2 de stacks. Projéteis causam só o dano base; a habilidade ativa **Incineração** (botão no turno) consome os stacks e lança todo o dano acumulado no inimigo. |
| **Pedra** | Ataques causam dano dobrado. |
| **Água**  | Refletir uma habilidade inimiga causa dano dobrado. |
| **Ar**    | +1 de dano ao acertar um projétil, +2 ao acertar defesa ou ao refletir. |
| **Raio**  | Ao chegar à metade da vida, energiza. A habilidade ativa (botão **Raio** no turno, uso único) eletrocuta o inimigo, bloqueia 1 ação aleatória dele por **3 turnos** e concede **dano dobrado permanente** para o Raio pelo resto da partida. |
| **Tempo** | Reduz em **1 segundo** apenas o tempo do inimigo — vale mesmo no **Vs Máquina** se a máquina for o Tempo. Ganha **1 stack** por ponto de dano sofrido (máx. 7); a habilidade ativa **Regenerar** (botão no turno, **uso único**) recupera **1 de vida por stack** e, após usar, o Tempo **perde 1 de dano em todas as ações por 3 turnos**. |

Os multiplicadores valem para a bola do jogador que vence a troca (ex.: uma bola Pedra que vence com um Ataque causa 4 de dano; a Água que reflete causa 4).

## Estrutura

```
index.html   página e telas (menu, seleção, batalha, game over)
style.css    visual e animações CSS
game.js      toda a lógica, regras, IA, sons e desenho da arena em canvas
```

Para ajustar balanceamento, edite as constantes no topo de `game.js`:
`BASE_DMG` (dano base), `MAX_HP` (vida), `DECISION_SLOW`/`DECISION_FAST` (tempos das fases), `USE_PER_ACTION` (usos por ação) e `TEMPO_STACK_CAP`/`TEMPO_HEAL_PER_STACK` (stacks e cura da bola Tempo).

## (Opcional) Rodar com servidor HTTP

Alguns navegadores restringem recursos ao abrir localmente. Para evitar qualquer limitação, suba um servidor simples na pasta do jogo:

```bash
python -m http.server 8000
# ou
npx serve .
```

Depois acesse `http://localhost:8000` no navegador.