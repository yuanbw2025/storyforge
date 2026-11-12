# StoryForge · 故事熔炉

**Escreva histórias. Entre nos seus mundos.**

<!-- readme-languages:start -->
[简体中文](./README.md) · [English](./README.en.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md) · [Italiano](./README.it.md) · [Español](./README.es.md) · [Português](./README.pt.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md)
<!-- readme-languages:end -->

**Tutoriais e comunidade em chinês:** [Vídeo Bilibili](https://www.bilibili.com/video/BV1q37j6QExh/) · [Introdução Zhihu](https://zhuanlan.zhihu.com/p/2038714210188780594) · **Grupo QQ: 1082374587** · [Mais contatos](#community)

[Comece a criar](#quick-start) · [Experimente Fog Harbor](#try-a-story) · [Explore a arquitetura](#architecture)

StoryForge é uma ferramenta de código aberto para criar e vivenciar narrativas com IA, projetada para manter os dados localmente. Escreva romances e narrativas curtas, adapte um romance para roteiro ou quadrinhos, construa mundos reutilizáveis e explore experiências interativas. Você escolhe o processo e aprova as propostas da IA antes de incorporá-las à sua obra.

> Estado de `main` verificado em 13 de outubro de 2026: romance, narrativa curta, roteiro, quadrinhos, pré-produção animada e motor de mundos têm entradas oficiais. O modo de nós e os produtos interativos são prévias. Este README está traduzido; isso não significa que toda a interface ou os documentos vinculados estejam disponíveis em português. As capturas e muitos guias estão em chinês.

<a id="try-a-story"></a>


**Sem ambiente de desenvolvimento:** [baixe a versão portátil mais recente](https://github.com/yuanbw2025/storyforge/releases/latest), escolha Windows x64, Mac Apple Silicon/Intel ou Linux x64, extraia toda a pasta e execute `Start-StoryForge`. Aplicação, mídias e Node.js estão incluídos; não é necessário instalar npm. A IA exige seu próprio provedor e os recursos de prévia mantêm sua indicação.

## Primeira utilização? Escolha o download e peça ajuda a uma IA local

**Há duas formas de utilizar o StoryForge.**

- **Instalador ou pacote portátil** — baixe o programa adequado das Releases oficiais e instale ou extraia.
- **Código-fonte pelo Git** — conveniente para atualizar, consultar o código, corrigir problemas ou desenvolver funções.

Um Agent de desktop como ByteDance Trae, Tencent WorkBuddy, Alibaba Tongyi Lingma ou Google Antigravity pode ajudar. Para instalação habitual, verificação do funcionamento e diagnóstico básico, comece com uma versão ou cota gratuita. **Preencha o dispositivo e a pasta e copie a instrução correspondente.**

### Opção 1 — Baixar o repositório com Git

> Quero **baixar o código-fonte do StoryForge pelo Git e executá-lo localmente**. O repositório é https://github.com/yuanbw2025/storyforge e o destino é «caminho da minha pasta». Verifique o ambiente, instale Git se necessário, leia o README e as instruções de desenvolvimento, instale o ambiente e as dependências necessários, inicie o projeto e diga onde abri-lo. **Verifique primeiro os arquivos existentes e preserve minhas obras, configurações e alterações locais.** Explique também como atualizar depois.

### Opção 2 — Baixar um pacote Release oficial

> Quero **baixar uma aplicação StoryForge pronta das Releases oficiais**, para «Windows, macOS, Linux ou Android», em «caminho da pasta». A página é https://github.com/yuanbw2025/storyforge/releases/latest . Verifique a versão estável oficial mais recente, selecione o instalador ou pacote portátil para o sistema e a arquitetura do processador, confira as somas de verificação fornecidas e ajude a instalar ou extrair e iniciar. Para um telefone, explique como transferir e instalar o pacote. **Se StoryForge já estiver instalado, ajude primeiro a fazer backup das obras e configurações e depois atualize conforme as instruções oficiais.** Apresente as opções disponíveis caso não haja pacote compatível.

**Guias e canais para bugs, sugestões e problemas na documentação estão na [base de conhecimento oficial](https://docs.storyforge-lab.com/en/).**

**Dê uma Star no canto superior direito do repositório para encontrá-lo novamente e acompanhar atualizações.**

---

## Importante — Use IA local para investigar problemas e enviar relatos

StoryForge continua em desenvolvimento e é **desenvolvido e mantido por uma pessoa**. Com tantas funções, bugs podem ocorrer. Os relatos são bem-vindos.

**Um Agent local pode ajudar tanto com o código Git quanto com o cliente baixado.** Se um capítulo não abrir, a geração ou o salvamento falhar, ou o aplicativo fechar, peça que examine os erros e os diagnósticos disponíveis e envie diretamente um relato. **Copie esta instrução descrevendo o problema.**

> Meu StoryForge apresenta este problema: «descrição». Verifique a versão, os erros e os diagnósticos relevantes. Organize os passos de reprodução, o resultado esperado e o observado e os logs pertinentes, e **envie diretamente um relato pela entrada oficial de feedback do projeto**. Se já houver o mesmo problema, complemente o relato existente. Remova chaves API, dados de conta e manuscritos privados antes do envio e depois informe o número ou link do relato. **Preserve minhas obras, configurações e alterações locais, continue a investigação e proponha uma correção.**

O Agent pode investigar, organizar e enviar as informações necessárias ao mantenedor. Também pode ajudar com correções simples enquanto você continua usando o aplicativo e aguarda atualizações. **Faça backup antes de operar sobre dados e preserve arquivos originais e obras antes das alterações.**

Você também pode desenvolver funções com um Agent local, criar seu próprio projeto ou contribuir com melhorias para o StoryForge por uma PR.

---

## Site oficial, demonstração e documentação

Conheça o projeto no site, explore a interface real na demonstração isolada e baixe o código para criar com todos os recursos.

| Entrada | Finalidade |
|---|---|
| [Site oficial](https://storyforge-lab.com/) | Projeto, produtos, oficina comunitária e contatos |
| [Demonstração](https://storyforge-lab.com/storyforge/) | Interface real, exemplos, cópias de teste e edição manual; configuração API, geração IA e serviços externos desativados |
| [Oficina comunitária](https://storyforge-lab.com/workshop) | Encontrar plugins e conteúdos, conferir autores e dependências, baixar e importar localmente |
| [Documentação](https://docs.storyforge-lab.com/en/) | Instalação, primeiros passos, produtos, modelos, backups, métodos de prompts, plugins e problemas |
| [Novidades e desenvolvimento](https://docs.storyforge-lab.com/en/updates/changelog) | Mudanças em main, trabalho não integrado e verificações históricas |

[Estado de desenvolvimento](https://docs.storyforge-lab.com/en/updates/development-status) · [GitHub Releases](https://github.com/yuanbw2025/storyforge/releases)

A documentação está em chinês e inglês. A demonstração usa armazenamento separado; manuscritos não migram automaticamente entre versões, domínios ou portas. Releases são fixas; main, implantação do aplicativo e documentação têm estados distintos.

## Recursos recentes e uso

Revisado com main remoto em 13 de outubro de 2026. Romance, narrativa curta, roteiro, quadrinhos, materiais de séries animadas e motor de mundos têm entradas oficiais. Nós e produtos interativos continuam em prévia; API de plugins 1 / SDK 0.1 é uma prévia de desenvolvimento.

### Pré-produção de séries animadas

Uma ideia ou romance leva à bíblia da série, episódios, personagens/figurinos/locais/objetos/sons, roteiros, storyboards e quadros de referência. Prompts de imagem e movimento ficam separados. Continuidade, direitos e limites são revisados antes dos pacotes Seedance, Runway, LTX ou genéricos. Materiais e entregas mantêm versões; revisões exigem conferir os planos afetados. Vídeo, edição e mixagem acontecem fora; cada serviço define as opções suportadas.

[Guia de uso](https://docs.storyforge-lab.com/en/features/motion-drama)

### Plugins e oficina criativa

Instale plugins funcionais, conteúdo sem código ou conjuntos com dependências fixas, ativados por obra ou mundo. Doze exemplos cobrem notas, cartões, calendários, cronologias, quadros, nós, IA e ferramentas. As substituições específicas abrangem história do mundo e progresso narrativo. Ative a prévia em `/workshop/discover`, crie uma obra de teste e confirme a confiança. Desativar ou desinstalar preserva dados. O SDK verifica e empacota `.sfplugin`; instruções IA e kit Skill ajudam no desenvolvimento. Interfaces nativas compartilham origem: declarações de capacidade não são uma sandbox contra código malicioso. Oficina pública e gestão local têm funções distintas.

[Guia de uso](https://docs.storyforge-lab.com/en/workshop/)

### Nós: conectar, revisar e recuperar

Adicione ou busque nós, arraste de portas de entrada ou saída e selecione nós compatíveis. Templates de prompts, variáveis, temperatura, tokens e quantidade de candidatos ficam no grafo sem alterar o template global. Executar até um nó trata somente pré-requisitos. Candidatos salvos usam a adoção do romance quando permitida. Recuperar após atualizar não inicia geração; a validação completa entre modos continua.

[Guia de uso](https://docs.storyforge-lab.com/en/features/nodes)

### Codex local e modelos por tarefa

Além de APIs e serviços locais compatíveis, Codex app-server reutiliza uma conta ChatGPT conectada localmente: detecte login, escolha modelos e atribua presets sem chave API para esse canal. Apenas texto e saída estruturada; não funciona num aplicativo hospedado puramente estático. Imagens, áudio e embeddings precisam de configuração própria. Limites de assinatura e permissões valem. Registros recentes ajudam após desconexão; resultados desconhecidos não são reenviados nem transferidos automaticamente para outra API paga.

[Guia de uso](https://docs.storyforge-lab.com/en/getting-started/model-config)

## Características técnicas

| Tecnologia ou projeto | Função e valor |
|---|---|
| React + TypeScript + Vite | Interfaces e tipos de domínio; Zustand para estado, TipTap para texto e Three.js para cenas 3D integradas |
| Dexie / IndexedDB | Armazenamento local; PROJECT_TABLES governa backup, importação, exclusão, migração e referências |
| Contexto e adoção rastreáveis | CONTEXT_SOURCES + assembleContext() registram leituras; Context Gateway recupera fontes; FIELD_REGISTRY + AdoptionSchema + adopt() controlam escritas oficiais |
| Harness persistente | Skills, contratos, eventos, checkpoints, candidatos e recibos; validação de versão/escopo e recuperação de resultados salvos |
| Produtos independentes e mundos congelados | Work possui conteúdo; produtos leem seu SourcePlan e possuem mídia, publicações e partidas sem reescrever o romance original |

Arquitetura e evidências abaixo explicam os limites. Qualidade literária, personagens e capacidades dos provedores ainda exigem julgamento do autor.

**Leia mais:** [Pré-produção animada](https://docs.storyforge-lab.com/en/features/motion-drama) · [Instalação e desenvolvimento de plugins](https://docs.storyforge-lab.com/en/workshop/) · [Nós](https://docs.storyforge-lab.com/en/features/nodes) · [Configuração de modelos](https://docs.storyforge-lab.com/en/getting-started/model-config) · [Backup e recuperação](https://docs.storyforge-lab.com/en/guides/backup-restore) · [Métodos de prompts](https://docs.storyforge-lab.com/en/prompts/) · [Feedback e suporte](https://docs.storyforge-lab.com/en/feedback/)

## Experimente uma história original

### Fog Harbor: The Last Light — prévia comunitária de RPG

Investigue um antigo naufrágio com dois companheiros de IA, proteja os segredos do seu personagem e decida como os navios voltarão nesta noite. Um mestre de jogo IA (KP) conduz a aventura com regras originais **2d6**, **7 cenas, 6 pistas e 3 finais**.

![Tela de entrada da aventura Fog Harbor](./docs/assets/readme/ttrpg-current.png)

O jogo e os arquivos de mídia incluídos estão no repositório. Configure sua própria API de modelo para começar. A captura mostra a entrada real da aventura.

**Ciclo de jogo:** propor uma ação → resolver as regras → ler a resposta do mestre → consultar pistas → salvar e continuar.

<details>
<summary>Como jogar e limites atuais</summary>

Execute o código atual de `main`, abra **TTRPG** (`跑团`) e escolha a aventura abaixo da seção de produção, ou acesse `/storyforge/play`. Configure o modelo e escolha um personagem. Jogue sozinho com companheiros de IA ou revezando o mesmo dispositivo. Progresso, retomada e checkpoints são locais. O modo multijogador público on-line não está implantado; os segredos em um dispositivo compartilhado não ficam protegidos contra seu proprietário.

[Guia do jogador](./examples/ttrpg/README.md) · [Evidências de produção e partidas](./examples/ttrpg/fog-harbor/production-status.md)

</details>

## Por que StoryForge

- **Memória ligada ao manuscrito.** Texto original, fatos, resumos e busca ajudam a recuperar pistas antigas; mudanças confirmadas após um capítulo alimentam os seguintes.
- **Um processo específico para cada produto.** A narrativa curta verifica extensão e conclusão; o roteiro preserva decisões de adaptação; os quadrinhos separam painéis, imagens e letreiramento.
- **O autor mantém o controle.** A criação oficial produz primeiro propostas. Harness acrescenta proteção de revisões, evidências de execução e recuperação de estados salvos.

[Início rápido](#quick-start) · [Produtos](#products) · [Primeira sessão](#first-session) · [Mundos](#worlds) · [Harness](#architecture) · [Privacidade](#privacy) · [Comunidade](#community)

<a id="quick-start"></a>

## Início rápido

Abra o [aplicativo web](https://yuanbw.vercel.app/storyforge/) ou execute o código localmente. A criação local básica não exige uma conta StoryForge. A IA usa suas credenciais do provedor, com custos de API separados. O site pode estar atrás de `main`; Releases antigas são versões fixas.

Use **Node.js 24** e npm, como na CI:

```bash
git clone https://github.com/yuanbw2025/storyforge.git
cd storyforge
npm ci
npm run dev
```

Abra o endereço informado pelo Vite com o caminho `/storyforge/` e mantenha o terminal em execução. Um ZIP do código exige os mesmos passos após a extração; não é um instalador de desktop.

Na página inicial, abra as configurações de modelo no canto superior direito (`模型与本地设置`). Para serviços API, escolha o provedor, informe API Key, Base URL e um modelo acessível, depois teste a conexão e uma geração pequena. Conectar não comprova qualidade, saldo ou capacidade de contexto. Para erros CORS do navegador, siga as instruções do proxy local no painel.

<a id="products"></a>

## Escolha por onde começar

![Página de produtos do StoryForge](./docs/assets/readme/home-current.png)

| Objetivo | Entrada | Resultado e estado |
|---|---|---|
| Escrever um romance | Romance | Personagens, planos, capítulos, continuidade e revisão; processo técnico atual validado |
| Concluir uma narrativa curta | Narrativa curta | Projeto, fichas de capítulos, escrita, revisão, edição imutável; Markdown/TXT/JSON |
| Adaptar para roteiro | Romance para roteiro | Fontes fixadas, decisões, cenas estruturadas, revisões; Fountain/FDX/impressão |
| Adaptar para quadrinhos | Romance para quadrinhos | Páginas, painéis, referências visuais, letreiramento, edições; PNG/WebP/CBZ/PDF |
| Preparar uma série animada | Materiais de série animada | Bíblia, episódios, materiais, storyboard e pacotes; vídeo produzido externamente |
| Criar um mundo | Motor de mundos | Conteúdo semântico, derivação explícita, versões imutáveis e leitura |
| Montar um processo visual | Modo de nós | Prévia; compartilha lógica e dados do romance |
| Jogar ou criar experiências | TTRPG / Conversa com personagens / Cidade IA / Jogos de texto | Prévias com ciclos próprios de produção e execução |

Escrever romances não exige o motor de mundos. O autor pode derivar explicitamente um mundo de conteúdo confirmado de romances ou narrativas curtas. Roteiros e quadrinhos são adaptações independentes sem essa exportação. Uma aventura publicada pode ser jogada sem criar um mundo antes.

<a id="first-session"></a>

## Sua primeira sessão de escrita

1. Abra **Romance** (`长篇`) → **Biblioteca** (`作品库`) → **Novo romance** (`新建长篇`) e informe o título.
2. Registre intenção, referências e regras de escrita; preencha a ambientação necessária.
3. Planeje conflito e personagens, depois volumes e capítulos. Escreva manualmente ou edite e aprove as propostas da IA.
4. Desenvolva cenas e texto. Confira mudanças em fatos, estados, relações e pistas antes de continuar.
5. Em **Gerenciamento de dados** (`数据管理`), exporte o texto e um backup JSON completo.

![Plano de romance com um exemplo escrito manualmente](./docs/assets/readme/longform-outline-current.png)

## O que cada produto faz pela sua obra

### Romances e nós

O espaço do romance inclui referências, ambientação, personagens e relações, tramas, planos, capítulos, antecipações, fatos, inventários, estilo, modelos de prompts e histórico.

A memória mantém o **texto original como evidência**, fatos e estados estruturados, resumos de capítulo/volume/obra e índices de busca. Context Gateway descobre recursos antes de ler detalhes e registra as fontes realmente usadas. Resumos e índices derivados são verificados pelos hashes das fontes; quando ausentes ou desatualizados, o texto original serve de alternativa. O escopo da obra e os limites temporais filtram a recuperação.

Após um capítulo, o processamento propõe alterações em fatos, personagens, relações, objetos, cronologia, pistas e tramas para confirmação do autor. A análise de impacto considera planos futuros e preserva a história confirmada. Verificações de versão impedem que propostas antigas sobrescrevam edições recentes.

Os nós oficiais reutilizam os mesmos Skills, dados e processos de aprovação, permitindo compor etapas e resultados intermediários. Rascunhos experimentais não podem entrar no conteúdo oficial. A interoperabilidade completa entre interfaces continua em validação.

[Busca narrativa](./src/lib/context-gateway/narrative-retrieval.ts) · [Processamento após o capítulo](./src/lib/ai/chapter-memory/run-chapter-memory.ts) · [Contrato romance/nós](./docs/products/LONGFORM-AND-NODE.md)

### Narrativa curta: um caminho visível até a conclusão

O processo dedicado visa **5.000–25.000 caracteres chineses em 3–8 capítulos**: brief, projeto, fichas, escrita, revisão, reescrita e publicação. Verifica extensão real, estrutura, texto ausente e propostas pendentes. Os problemas de revisão apontam capítulos e trechos; a revisão é vinculada ao hash do manuscrito e precisa ser atualizada após alterações. As reescritas se concentram em capítulos específicos. Problemas bloqueadores impedem a publicação; cada edição aceita fica imutável e preserva as anteriores.

[Produção e critérios de conclusão](./src/lib/short-novel/service.ts) · [Execuções IA persistentes dedicadas](./src/lib/agent/run/short-novel-durable.ts)

### Roteiros: decisões de adaptação rastreáveis

O processo fixa as fontes selecionadas e as conecta a fatos, causalidade, decisões de adaptação, momentos narrativos, fichas e cenas. É possível verificar por que um evento foi removido, combinado ou transformado. As cenas usam uma **AST**, representação estruturada dos blocos do roteiro, validada pelo código e convertida para Fountain, FDX ou impressão.

Fidelidade à fonte e estrutura dramática têm revisões separadas. Uma correção identifica cena e revisão esperada; cenas bloqueadas precisam ser desbloqueadas e correções desatualizadas são rejeitadas. As edições fixam fontes, decisões e cenas. Alterações posteriores no romance não mudam automaticamente o roteiro publicado.

[Produção e revisões](./src/lib/screenplay/production.ts) · [Edições](./src/lib/screenplay/release.ts) · [Renderizadores](./src/lib/screenplay/renderers.ts)

### Quadrinhos: imagens e letreiramento em camadas separadas

Primeiro são desenvolvidos momentos narrativos, páginas e painéis; depois, imagens e letreiramento. Identidades estáveis e ordem de leitura explícita conectam enquadramentos, ações, diálogos e fontes. Sujeitos visuais dão identidade a personagens, lugares e objetos. Imagens candidatas registram procedência e evidências das referências realmente enviadas ao provedor.

O **letreiramento SVG local** acrescenta balões, legendas e efeitos sonoros editáveis sobre as imagens. Corrigir um diálogo não exige gerar outro painel. As verificações sinalizam transbordamento, sobreposições e margens inseguras; o autor ainda confere partes da imagem encobertas. Storyboard e edição visual têm critérios separados. As edições visuais mantêm referências fortes aos Blob das imagens selecionadas.

**Limite atual:** o adaptador genérico de imagens compatível com OpenAI envia apenas texto e declara não oferecer imagens de referência, seeds fixos ou inpainting. Citar uma referência no prompt não equivale a enviar a imagem. A produção visual precisa de um serviço de imagens configurado ou materiais adequados do autor, com seleção e revisão humana da continuidade.

[Produção](./src/lib/comic/production.ts) · [Evidências de mídia](./src/lib/comic/media-service.ts) · [Letreiramento](./src/lib/comic/renderers.ts) · [Verificações de qualidade](./src/lib/comic/qa.ts)

Os processos técnicos atuais estão implementados em `main`; desempenho dos provedores e qualidade do conteúdo continuam em avaliação. Veja a [base de capacidades](./docs/roadmap/CAPABILITY-BASELINE.md).

<a id="worlds"></a>

## Mundos e produtos interativos

Crie ou derive explicitamente um mundo, fixe uma versão e configure e inicie a produção dentro do produto escolhido. O motor mantém somente **conteúdo semântico versionado**. Cada produto é dono de suas mídias, partidas e evolução privada. Alterações posteriores do romance e partidas não reescrevem automaticamente o mundo compartilhado.

A derivação registra obra de origem, revisão, intervalo e hash. Adaptadores específicos declaram recursos obrigatórios, opcionais e proibidos e fixam um **SourcePlan**. Leituras progressivas por `describe / search / read` deixam um Context Manifest por execução e um SourceManifest final das leituras reais. Uma aventura pode continuar na versão 1 enquanto o autor prepara a 2.

[Cliente de recursos do mundo](./src/lib/context-gateway/world-release-client.ts) · [Contrato do mundo](./docs/products/WORLD-ENGINE.md)

**Todos os produtos abaixo são prévias:**

| Produto | Mecanismos implementados | Limite atual |
|---|---|---|
| [TTRPG / mestre IA](./src/lib/ttrpg/information-boundary.ts) | Regras, dados e efeitos resolvidos pelo código; contextos separados mestre/jogador/PNJ, segredos por destinatário, eventos e checkpoints | Fog Harbor tem evidências com modelos reais; sem multijogador público on-line |
| [Conversa com personagens](./src/lib/character-interaction/runtime.ts) | Perfis e voz fixados, objetivos de cena, memória de compromissos/segredos/conflitos, confiança/proximidade/cautela/respeito | Qualidade de personagens a longo prazo em avaliação |
| [Cidade IA Afterstory](./src/lib/ai-town/runtime.ts) | Seis períodos diários, lugares e deslocamentos, conhecimento, memórias, relações, gestão leve e compensação do tempo offline | Replay de 14 dias validado; modelos a longo prazo e mídias não simuladas ainda avaliados |
| [Aventura textual](./src/lib/adventure/runtime.ts) | Pré-requisitos, inventário, recursos, habilidades, missões e consequências verificados pelo código | Cada obra precisa de validação específica |
| [AVG](./src/lib/avg/runtime.ts) | Indicações declarativas, camadas de fundos/personagens/áudio, verificações de mídia e snapshots de cena | Experiência audiovisual completa em validação |
| [Mundo aberto textual](./src/lib/open-world/runtime.ts) | Regiões, viagens, recursos, facções, agendas e mudanças regionais ao longo do tempo | Produção completa e jogo prolongado em desenvolvimento |

Comunidade on-line e serviços comerciais são trabalho de etapas posteriores.

<a id="architecture"></a>

## Arquitetura compartilhada e coerência a longo prazo

**Harness é o sistema de execução e validação ao redor das chamadas ao modelo.** Vincula contratos de tarefa, entradas reais, propostas, versões, checkpoints e resultados à obra. Cada produto mantém seus próprios serviços de domínio e dados.

```mermaid
flowchart TB
  subgraph PRODUCTS["Produtos · serviços e propriedade independentes"]
    L["Romances / Nós"]
    C["Narrativa curta / Roteiros / Quadrinhos"]
    W["Motor de mundos"]
    I["TTRPG / Personagens / Cidade IA / Jogos de texto"]
  end
  L & C & W & I --> H["Harness compartilhado · Tarefas IA oficiais<br/>Skill + Run Contract · Orçamento · Versões · Recuperação"]
  H --> G["Context Gateway / Memória<br/>Fontes registradas · Busca · Texto original"]
  H --> M["Adaptadores de modelos<br/>Propostas e respostas brutas"]
  H --> A["Incorporação à obra<br/>Aprovação do autor · Validação · adopt"]
  H -.-> E["Registro persistente<br/>Eventos · Checkpoints · Recibos"]
  G -->|"Leituras dentro do escopo"| D["Dados e arquivos locais<br/>IndexedDB / Arquivos e mídias<br/>PROJECT_TABLES governa os ciclos de vida"]
  A -->|"Escritas transacionais e releitura"| D
  E --> D
  classDef engine fill:#e8f0fa,stroke:#5279a4,color:#18324f
  classDef author fill:#fff2df,stroke:#b58a45,color:#593b16
  classDef data fill:#eaf4ee,stroke:#628b73,color:#254a34
  class H,M,E engine
  class A author
  class G,D data
```

As setas indicam dependências ou acessos a dados, não a ordem de execução. Romances e narrativas curtas não exigem o motor de mundos. As experiências interativas usam comandos e máquinas de estados próprios.

### Como manter a coerência entre capítulos

O ciclo contínuo consiste em **recuperar evidências, aprovar mudanças e disponibilizar a versão correta para a próxima tarefa**. Geração, atualização da memória, auditoria e planejamento futuro contribuem para isso.

```mermaid
flowchart TB
  K["Dados confirmados<br/>Texto / Fatos / Estado / Pistas"]
  K --> R["1. Fixar tarefa e buscar<br/>Escopo, tempo, versões e lacunas"]
  R --> C["2. Gerar e verificar proposta<br/>Estrutura e limites de informação<br/>Revisão semântica se configurada"]
  C --> A["3. Aprovação e verificação de versão<br/>Adotar → Reler → Recibo"]
  A --> P["4. Processamento e impacto futuro<br/>Propor mudanças → Aprovação do autor"]
  P -->|"Atualizar dados e índices para os próximos capítulos"| K
  R -. "Falta evidência obrigatória" .-> X["Pausar / Rejeitar escrita<br/>Preservar evidências para resolver"]
  A -. "Fonte ou destino desatualizado" .-> X
  classDef engine fill:#e8f0fa,stroke:#5279a4,color:#18324f
  classDef author fill:#fff2df,stroke:#b58a45,color:#593b16
  classDef data fill:#eaf4ee,stroke:#628b73,color:#254a34
  classDef paused fill:#f7eaea,stroke:#b27a7a,color:#6a3030
  class R,C engine
  class A,P author
  class K data
  class X paused
```

Cada execução oficial preserva seu registro e checkpoints. Processamento após o capítulo e revisões futuras são execuções separadas e limitadas, com verificações de versão e aprovações próprias. O ciclo pode abranger várias sessões.

- Fontes obrigatórias ausentes bloqueiam o avanço. Os manifestos registram escopo, hashes, leituras e lacunas. Limites de obra, mundo e tempo evitam misturas e conhecimento prematuro.
- A adoção verifica novamente as revisões de entrada e destino. Uma proposta desatualizada não pode sobrescrever texto recente. Releitura e recibo verificam o resultado salvo.
- Auditorias explícitas de coerência se vinculam ao hash do texto. Alterações invalidam evidências antigas de auditoria.
- A recuperação restaura estados persistidos com verificação de versão. Um resultado desconhecido do provedor não provoca novos envios às cegas.

Exemplo: o capítulo 8 estabelece quem possui um objeto único. No capítulo 80, a busca pode trazer o trecho original e o estado confirmado. Se o autor mudar o proprietário antes de aprovar uma proposta, a verificação de revisão bloqueia sua adoção direta. Depois de confirmar o novo capítulo e suas atualizações de memória, os capítulos seguintes podem utilizá-los.

### Evidências que você pode consultar

- [Busca em grande escala e isolamento de mundos e informações futuras](./tests/regression/R-PHASE4-long-form-scale-gate.test.ts)
- [Bloqueio sem evidência obrigatória e destinos exatos de edição](./tests/regression/R-CTXG7-gateway-execution.test.ts)
- [Rejeição de propostas desatualizadas após alterações de texto ou ajustes](./tests/regression/R-HARNESS7-prose-generation-durable.test.ts)
- [Recuperação do processamento do capítulo sem nova chamada ao modelo](./tests/regression/R-HARNESS20-chapter-post-adoption-durable.test.ts)
- [Invalidação de auditorias após edições e sem reenvios para resultados desconhecidos](./tests/regression/R-MEMORY-CLOSE1-consistency-audit-durable.test.ts)
- [Preservação da história escrita e invalidação de planos futuros](./tests/regression/R-FUTURE1-continuous-evolution.test.ts)

[Execuções oficiais de prosa](./src/lib/agent/run/prose-generation-durable.ts) · [Recibos de verificação](./src/lib/agent/run/verification-receipt.ts) · [Arquitetura](./docs/ARCHITECTURE.md) · [Padrão Harness](./docs/HARNESS-QUALITY-STANDARD.md)

**Alcance das garantias:** o código verifica versões, escopos, estrutura, transições e regras de escrita. A revisão semântica depende da configuração ou de ação explícita do autor. Subtexto, metáforas, pistas não registradas e qualidade literária ainda exigem julgamento humano e do modelo. Testes de **100.000 / 300.000 / 1.000.000 de caracteres** demonstram comportamento técnico, sem garantir a coerência literária de um romance de um milhão de palavras. A recuperação cobre estados salvos; entradas auxiliares e experimentais mantêm os limites declarados.

<a id="privacy"></a>

## Modelos, armazenamento e privacidade

- Use seu provedor de nuvem ou um serviço local compatível, como Ollama ou LM Studio. Predefinições não certificam que todo modelo tenha qualidade igual para cada produto.
- A geração em nuvem envia o contexto selecionado ao provedor configurado. Armazenamento local não torna toda chamada IA offline.
- Obras e partidas ficam no IndexedDB do perfil e origem do navegador. Mudar navegador, host ou porta não transfere os dados.
- Chaves API duram por padrão a sessão do navegador. Somente a escolha explícita de lembrá-las no dispositivo as salva no localStorage.
- Exporte um **backup JSON completo** antes de trocar de dispositivo ou apagar dados do navegador. Markdown/TXT não o substituem; para mídias use os exports do produto ou espaço de trabalho.
- Acesso a pastas locais exige autorização: [guia do espaço de memória](./docs/MEMORY-WORKSPACE-GUIDE.md).
- O backup opcional GitHub Gist envia o JSON completo do projeto ao seu Gist privado. Não há criptografia de ponta a ponta.

<a id="community"></a>

## Comunidade e contribuições

[GitHub Issues](https://github.com/yuanbw2025/storyforge/issues) · [Site do desenvolvedor](https://yuanbw.vercel.app/) · [Perfil Zhihu do desenvolvedor](https://www.zhihu.com/people/dan-ran-xing-yuan-59) · Grupo QQ: **1082374587**

[Tutorial Bilibili](https://www.bilibili.com/video/BV1q37j6QExh/) e [introdução Zhihu](https://zhuanlan.zhihu.com/p/2038714210188780594) são recursos históricos em chinês; menus podem diferir. Para relatar bugs, informe versão, navegador/sistema, passos e resultados esperado/real. Remova chaves e textos privados das capturas e registros. Estrelas, exemplos, vídeos, traduções e contribuições são bem-vindos.

StoryForge usa **React, TypeScript, Vite, Zustand, TipTap e Dexie**. Três registros governam a base: `CONTEXT_SOURCES` + `assembleContext()` para leituras IA; `FIELD_REGISTRY` + `AdoptionSchema` + `adopt()` para escritas aprovadas; `PROJECT_TABLES` para o ciclo de vida das tabelas.

```bash
npm run ci
npm run ci:e2e
```

Antes de contribuir, leia [AGENTS.md](./AGENTS.md), [CONTRIBUTING.md](./CONTRIBUTING.md), o [processo de colaboração](./docs/COLLAB-WORKFLOW.md) e a [carta do projeto](./docs/PROJECT-MASTER-CHARTER.md).

## Estrelas, apoio e licença

[![StoryForge Star History](https://raw.githubusercontent.com/yuanbw2025/storyforge/readme-assets/storyforge-star-history.svg)](https://www.star-history.com/?repos=yuanbw2025%2Fstoryforge&type=date&legend=top-left)

O apoio financeiro é voluntário e não muda o acesso a funções ou atualizações futuras. Ajuda a financiar assinaturas de modelos e manutenção. [Detalhes de apoio](./README.md#自愿赞助).

Código sob licença [MIT](./LICENSE). Obras originais, modelos, mídias de terceiros e saídas mantêm seus respectivos termos. Veja o [aviso de licença SRD TTRPG](./docs/ttrpg/licenses/SRD-5.2.1-CC-BY-4.0.md) quando aplicável.
