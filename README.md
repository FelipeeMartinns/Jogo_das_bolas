# Jogo das Bolas

Um jogo de luta entre bolas elementais, jogado em turnos no navegador. Cada jogador escolhe em segredo sua jogada, e o sistema resolve quem levou a melhor. Você joga contra a máquina ou contra outro jogador pela internet.

## jogue agora em:

https://felipeemartinns.github.io/Jogo_das_bolas/

## Como rodar

Basta abrir o arquivo `index.html` em um navegador moderno (Chrome, Edge, Firefox):

- Dê dois cliques no arquivo `index.html`, **ou**
- arraste o arquivo para uma aba do navegador.

Não precisa instalar nada nem usar servidor. [Servir via HTTP](#opcional-rodar-com-servidor-http) também funciona.

### Modos de jogo

| Modo       | Descrição                                                                |
| ---------- | ------------------------------------------------------------------------ |
| Vs Máquina | Um humano contra a máquina (IA de contra-ataque)                         |
| Online     | Dois jogadores pela internet (PeerJS/WebRTC), com ou sem tempo por turno |
| Tutorial   | Aprendizado guiado, do primeiro turno à Incineração                      |

O tutorial joga uma partida de verdade com você como **Pedra** contra um oponente
fixo chamado **Treino** (que não pode te eliminar). Ele explica onde clicar, o
ciclo das ações, os 5 segundos por turno, o Frenesi e o botão Combo; no final você
vira **Fogo**, guarda stacks e solta a **Incineração**. Dá para pular a qualquer
momento pelo ✕ no cartão do coach.

## Controles

A escolha da jogada é feita por teclado ou clique nos botões do painel.

| Ação      | Tecla |
| --------- | ----- |
| Ataque    | Q     |
| Defesa    | W     |
| Projétil  | E     |
| Refletir  | R     |
| Combo     | T     |
| Confirmar | A     |

## Mecânicas

- Cada jogada escolhe uma ação: **Ataque**, **Refletir**, **Projétil**, **Defesa** ou **Agarrar**.
- As cinco ações formam uma **roda**: cada uma vence as **duas seguintes** e perde para as duas anteriores.

  ```
  Ataque  →  Refletir  →  Projétil  →  Defesa  →  Agarrar  →  (volta ao Ataque)
  ```

  Cada ação vence as duas à sua direita na roda. É a única regra do jogo: **não existe par sem vencedor**, e todas as ações ficam em **2 vitórias e 2 derrotas**. Com 4 ações isso era impossível (a soma não fechava), por isso havia um ciclo mais duas exceções — que era justamente o que deixava o jogo desbalanceado. Com 5, a regra é uma frase só e o ciclo antigo de 4 continua idêntico dentro dela.

- **Contragolpe**: a **Defesa** segura o **Ataque** e o **Agarrar** — são os dois únicos confrontos que abrem a janela. Aí acende um botão amarelo com **2 segundos** para apertar; apertar a tempo causa **+1 de dano** no atacante.
- **Agarrar** pega o **Ataque** e o **Refletir**, e **cancela a 2ª ação do Combo** do adversário. Só cancela se ele **ganhou** o confronto (perde para Projétil e Defesa) e **nunca cancela uma habilidade ativa** — ela é de uso único e perdê-la sem errar a jogada seria injusto. A ação cancelada não gasta o Combo.
- **Refletir** causa **+1 de dano** contra o Projétil e, contra a Defesa, **usa o escudo do próprio inimigo como ataque** — o Pedra atira a própria parede de pedra contra ele.
- **Projétil** vence a Defesa com o **dano normal**, sem nenhuma redução, e também vence o Agarrar. **Ataque** vence o Projétil por ser mais rápido.
- Espelhos: **Ataque × Ataque** e **Agarrar × Agarrar** ferem os dois. **Refletir × Refletir**, **Defesa × Defesa** e **Projétil × Projétil** só dão feedback visual (as ondas, os escudos, a colisão no ar), sem dano para ninguém.
- Cada ação tem **3 cargas**, que só importam dentro do Combo: repetir a mesma ação gasta uma carga, e sem carga não dá para repetir. As cargas recarregam quando zeram.
- **Combo** (3 por jogador, **não recarregam**): permite jogar **2 ações** no mesmo turno. O combo **só se completa se a primeira ação realmente conectar** - se ela for bloqueada, espelhada ou ignorada, a segunda nem acontece. **O combo só é gasto se ele acontecer de verdade**, então dá para arriscar e tentar de novo. A roda tem 5 posições e cada uma enfrenta sempre uma das outras 4, então toda ação tem oposição: quem não joga nada simplesmente não causa dano.
- Turno de escolha: **5 segundos** para escolher e confirmar. Se não confirmar, o que já foi escolhido é usado; sem nenhuma escolha, o sistema não conta ações. Se o inimigo for uma bola **Tempo**, você tem **1 segundo a menos** (vale também no Vs Máquina quando a máquina é o Tempo).
- **Frenesi**: quando um jogador chega à metade da vida, o tempo cai para **3 segundos** por turno e a tela fica com aviso vermelho.
- **Sala online com ou sem tempo**: quem **cria a sala** escolhe, na tela do modo online, se os turnos terão cronômetro. Em **Sem tempo** o relógio vira **∞**, ninguém é bloqueado por demorar, e o Frenesi não aperta o tempo. Os dois lados entram na mesma regra. Nos outros modos (Vs Máquina e Treino) o cronômetro continua sempre valendo.

## As bolas

| Bola      | Vantagem                                                                                                                                                                                                                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fogo**  | Todo projétil que acerta acumula +2 de stacks. Projéteis causam só o dano base; a habilidade ativa **Incineração** (botão no turno) consome os stacks e lança todo o dano acumulado no inimigo.                                                                                                                                             |
| **Pedra** | Ataques causam dano dobrado — inclusive o Contragolpe, então é a melhor defensora do jogo.                                                                                                                                                                                                                                                  |
| **Água**  | Refletir causa **+1 de dano** em qualquer reflexo.                                                                                                                                                                                                                                                                                          |
| **Ar**    | Ataques causam **+1** ao acertar um Projétil e **+2** ao acertar um Refletir; Projétil causa **+2** ao acertar a Defesa.                                                                                                                                                                                                                    |
| **Raio**  | Ao chegar à metade da vida, energiza. A habilidade ativa (botão **Raio** no turno, uso único) causa **2 de dano**, bloqueia 1 ação aleatória dele por **3 turnos** e concede **dano dobrado permanente** para o Raio pelo resto da partida.                                                                                                 |
| **Tempo** | Reduz em **1 segundo** apenas o tempo do inimigo — vale mesmo no **Vs Máquina** se a máquina for o Tempo. Ganha **1 stack** por ponto de dano sofrido (máx. 7); a habilidade ativa **Regenerar** (botão no turno, **uso único**) recupera **1 de vida por stack** e, após usar, o Tempo **perde 1 de dano em todas as ações por 3 turnos**. |

Os multiplicadores valem para a bola do jogador que vence a troca (ex.: uma bola Pedra que vence com um Ataque causa 4 de dano; a Água que reflete um Projétil causa 4). O maior dano posible O maior dano de **uma ação normal** é **5**, do Contragolpe da bola Pedra. As habilidades ativas furam esse teto: o **Raio energizado** chega a **6**, e a **Incineração** do Fogo lança todo o dano acumulado de uma vez.

## Estrutura

```
index.html   página e telas (menu, seleção, batalha, game over)
style.css    visual e animações CSS
dados.js     as tabelas (as 6 bolas, as 5 ações) e a regra da roda
jogo.js      o estado compartilhado e o fluxo da partida
replay.js    gravação, persistência e reprodução dos replays
audio.js     sons e música
telas.js     navegação de telas, coleção de bolas, configurações
controles.js painéis, HUD, a escolha da jogada e a máquina
regras.js    a roda decide: dano, combo, agarrar e contragolpe
online.js    salas e partida online (PeerJS/WebRTC)
tutorial.js  o tutorial
arena.js     desenho e animação da arena (o canvas)
```

Os arquivos `.js` são **scripts comuns, não módulos**: todos dividem o mesmo
escopo global, e é por isso que o jogo abre com dois cliques, sem servidor. A
ordem das tags `<script>` no `index.html` só importa para o que roda no momento
de ler o arquivo — o resto se liga por funções, que só são chamadas depois que
tudo carregou. O `arena.js` vai por último porque é ele que inicia o loop de
desenho.

Para ajustar balanceamento, edite as constantes no topo de `dados.js`:
`BASE_DMG` (dano base), `MAX_HP` (vida), `DECISION_SLOW`/`DECISION_FAST` (tempos das fases), `USE_PER_ACTION` (usos por ação) e `TEMPO_STACK_CAP`/`TEMPO_HEAL_PER_STACK` (stacks e cura da bola Tempo).

## (Opcional) Rodar com servidor HTTP

Alguns navegadores restringem recursos ao abrir localmente. Para evitar qualquer limitação, suba um servidor simples na pasta do jogo:

```bash
python -m http.server 8000
# ou
npx serve .
```

Depois acesse `http://localhost:8000` no navegador.
