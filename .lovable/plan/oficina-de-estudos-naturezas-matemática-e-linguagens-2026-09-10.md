# Oficina de estudos — Naturezas, Matemática e Linguagens

Uma nova oficina, no mesmo espírito da de redação, mas para conteúdo: primeiro uma explicação guiada passo a passo, depois exercícios do mesmo assunto tirados dos simulados. Todo o conteúdo vem dos PDFs das pastas "Materiais" e "Simulados Internos" da sua nuvem.

## Como vai funcionar para você

1. **Escolher** — na oficina você escolhe a área (Naturezas, Matemática ou Linguagens), a matéria e o assunto. Cada assunto mostra de qual aula/simulado ele veio.
2. **Etapa 1 — aula guiada** — a plataforma explica o assunto em passos curtos, um de cada vez, sempre terminando com uma pergunta rápida. Você responde com suas palavras e recebe na hora: o que acertou, o que faltou e a versão correta do raciocínio. Só avança quando o passo fecha.
3. **Etapa 2 — exercícios** — em seguida vêm questões reais dos simulados sobre o mesmo assunto, uma por vez, com correção, explicação do erro e indicação de qual passo da aula revisar.
4. **Fechamento** — resumo da sessão: acertos, pontos fracos, tempo e sugestão do próximo assunto. Erros viram revisões e flashcards, como já acontece no resto do app.

## Leitura dos PDFs (feita uma vez)

Uma rotina de importação, disponível só para você (conta dona), percorre as duas pastas da nuvem, baixa cada PDF e guarda:

- **Materiais** → assuntos com explicação estruturada em passos.
- **Simulados Internos** → questões (enunciado, alternativas, gabarito quando existir), classificadas por matéria e assunto.

A importação mostra progresso por arquivo, pode ser retomada de onde parou e nunca reprocessa um arquivo já lido (controle por identificador do arquivo na nuvem), então rodar de novo não duplica nada. Arquivos novos na nuvem entram numa próxima passada.

## Detalhes técnicos

**Banco (uma migration)**

- `workshop_sources` — arquivo lido da nuvem: `onedrive_item_id` (único por usuário), `drive_id`, `name`, `folder` (`materiais` | `simulados`), `kind`, `status` (`pendente`/`lido`/`erro`), `pages`, `error`, `processed_at`.
- `workshop_topics` — assunto: `area` (naturezas/matematica/linguagens), `subject_id` (liga em `subjects`), `title`, `summary`, `steps` (jsonb: título, explicação, exemplo, pergunta de checagem, resposta esperada), `source_id`.
- `workshop_questions` — questão do simulado: `topic_id`, `source_id`, `statement`, `options` (jsonb), `correct_answer`, `explanation`, `difficulty`, `page_number`.
- `workshop_sessions` / `workshop_answers` — sessão de treino (área, tópico, etapa, minutos) e cada resposta com acerto, feedback e passo relacionado.

Todas com `user_id`, GRANT para `authenticated` + `service_role`, RLS `auth.uid() = user_id`, `created_at`/`updated_at` com trigger.

**Backend**

- `src/lib/workshop-ingest.functions.ts` — `scanCloudLibrary` (lista recursivamente as duas pastas via as funções OneDrive já existentes e cria linhas em `workshop_sources`) e `ingestSource` (baixa 1 PDF, extrai texto com o pipeline atual de PDF, manda para a IA e grava tópicos/questões). Ambas protegidas por `requireSupabaseAuth` + checagem de dona, como as funções da Nuvem.
- `src/lib/workshop.functions.ts` — `listWorkshopCatalog`, `startWorkshopSession`, `workshopStep` (devolutiva de um passo da aula) e `workshopAnswer` (correção da questão). Mesmo padrão de `redacao-coach.functions.ts`: `aiJson` com resposta JSON validada.
- `src/data/workshop.ts` — definição das três áreas, roteiro padrão de uma aula guiada e prompts base por área (Naturezas: fenômeno → modelo → cálculo/interpretação; Matemática: conceito → técnica → aplicação; Linguagens: conceito → leitura do texto → análise).

**Frontend**

- `src/routes/estudo.tsx` — catálogo (áreas → matérias → assuntos, com estado "novo/em treino/dominado") e a sessão em duas etapas, reaproveitando `AppShell`, `RichText`, `DiagramBlock` e o visual da oficina de redação (sublinhados por gravidade nas respostas dissertativas).
- `src/routes/nuvem.tsx` — bloco "Biblioteca de estudo" com o botão de leitura dos PDFs, progresso e contagem de assuntos/questões extraídos.
- Item "Oficina de estudos" no menu do `AppShell` e atalho na Visão geral.
- `head()` próprio na nova rota, com título e descrição específicos.

**Ordem de execução**

1. Migration das tabelas.
2. Funções de leitura da nuvem + painel de importação na Nuvem.
3. Rodar a leitura dos PDFs das duas pastas.
4. Oficina (catálogo + aula guiada + exercícios) e integração com revisões/flashcards.
