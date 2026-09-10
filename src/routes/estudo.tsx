import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Cloud,
  Loader2,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { RichText } from "@/lib/text";
import { errorMessage } from "@/lib/error-message";
import { AREAS, type AreaId } from "@/data/workshop";
import {
  finishWorkshopSession,
  listWorkshopCatalog,
  startWorkshopSession,
  workshopAnswer,
  workshopStep,
  type AnswerFeedback,
  type CatalogTopic,
  type StepFeedback,
  type WorkshopSession,
} from "@/lib/workshop.functions";

export const Route = createFileRoute("/estudo")({
  head: () => ({
    meta: [
      { title: "Oficina de estudos — naturezas, matemática e linguagens | Fichário" },
      {
        name: "description",
        content:
          "Aula guiada passo a passo e exercícios de simulados para naturezas, matemática e linguagens, com correção comentada e revisão dos pontos fracos.",
      },
      { property: "og:title", content: "Oficina de estudos guiada por matéria" },
      {
        property: "og:description",
        content:
          "Escolha a área e o assunto, aprenda em passos com perguntas de checagem e treine com questões reais dos simulados.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <EstudoPage />
    </AppShell>
  ),
});

function EstudoPage() {
  const [session, setSession] = useState<WorkshopSession | null>(null);
  return session ? (
    <Runner session={session} onExit={() => setSession(null)} />
  ) : (
    <Catalog onStart={setSession} />
  );
}

/* ---------------------------------- catálogo --------------------------------- */

function Catalog({ onStart }: { onStart: (s: WorkshopSession) => void }) {
  const listCatalog = useServerFn(listWorkshopCatalog);
  const start = useServerFn(startWorkshopSession);
  const [area, setArea] = useState<AreaId>("naturezas");
  const [subject, setSubject] = useState<string>("todas");
  const [opening, setOpening] = useState<string | null>(null);

  const { data: topics = [], isLoading } = useQuery({
    queryKey: ["workshop-catalog"],
    queryFn: () => listCatalog(),
  });

  const inArea = useMemo(
    () => (topics as CatalogTopic[]).filter((t) => t.area === area),
    [topics, area],
  );
  const subjects = useMemo(
    () => Array.from(new Set(inArea.map((t) => t.subjectLabel).filter(Boolean))).sort(),
    [inArea],
  );
  const shown = subject === "todas" ? inArea : inArea.filter((t) => t.subjectLabel === subject);

  async function open(topicId: string) {
    setOpening(topicId);
    try {
      onStart(await start({ data: { topicId } }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-soft">
          oficina de estudos
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">Aprender e treinar por assunto</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">
          Primeiro a aula guiada, em passos curtos com uma pergunta em cada um. Depois as questões
          dos simulados sobre o mesmo assunto, com correção comentada.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        {AREAS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => {
              setArea(a.id);
              setSubject("todas");
            }}
            className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
              area === a.id
                ? "border-sun bg-sun/15 text-ink"
                : "border-line text-ink-soft hover:text-ink"
            }`}
          >
            {a.label}
            <span className="ml-2 text-[11px] text-ink-soft">{a.hint}</span>
          </button>
        ))}
      </div>

      {subjects.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {["todas", ...subjects].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSubject(s)}
              className={`rounded border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
                subject === s ? "border-sun text-ink" : "border-line text-ink-soft hover:text-ink"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {isLoading && (
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <Loader2 className="size-4 animate-spin" /> Carregando os assuntos…
        </p>
      )}

      {!isLoading && shown.length === 0 && (
        <div className="rounded-lg border border-dashed border-line p-8 text-center">
          <Cloud className="mx-auto size-6 text-sun" />
          <p className="mt-3 text-sm text-ink-soft">
            Ainda não há assuntos desta área. Abra a página <strong>Nuvem</strong> e toque em
            “Montar biblioteca de estudo” para eu ler os materiais e simulados da sua pasta.
          </p>
        </div>
      )}

      <div className="grid gap-3">
        {shown.map((topic) => (
          <button
            key={topic.id}
            type="button"
            disabled={opening !== null}
            onClick={() => open(topic.id)}
            className="group flex items-start gap-3 rounded-lg border border-line bg-paper p-4 text-left transition-colors hover:border-sun disabled:opacity-60"
          >
            <BookOpen className="mt-0.5 size-4 shrink-0 text-sun" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{topic.title}</span>
                {topic.subjectLabel && (
                  <span className="rounded bg-background px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft">
                    {topic.subjectLabel}
                  </span>
                )}
                {topic.bestScore !== null && (
                  <span className="font-mono text-[10px] text-sun-deep">
                    melhor: {topic.bestScore}%
                  </span>
                )}
              </div>
              {topic.summary && (
                <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{topic.summary}</p>
              )}
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft">
                {topic.steps} passos · {topic.questions} questões
                {topic.sessions > 0 ? ` · ${topic.sessions} treinos` : ""}
              </p>
            </div>
            {opening === topic.id ? (
              <Loader2 className="mt-1 size-4 animate-spin text-ink-soft" />
            ) : (
              <ChevronRight className="mt-1 size-4 text-ink-soft transition-transform group-hover:translate-x-0.5" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------- treino ---------------------------------- */

type Stage = "aula" | "exercicios" | "fim";

function Runner({ session, onExit }: { session: WorkshopSession; onExit: () => void }) {
  const sendStep = useServerFn(workshopStep);
  const sendAnswer = useServerFn(workshopAnswer);
  const finish = useServerFn(finishWorkshopSession);

  const [stage, setStage] = useState<Stage>("aula");
  const [stepIndex, setStepIndex] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [stepFeedback, setStepFeedback] = useState<StepFeedback | null>(null);
  const [qIndex, setQIndex] = useState(0);
  const [answerFeedback, setAnswerFeedback] = useState<AnswerFeedback | null>(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const started = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const step = session.steps[stepIndex];
  const question = session.questions[qIndex];
  const minutes = Math.floor(elapsed / 60);
  const clock = `${String(minutes).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  async function submitStep() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      setStepFeedback(await sendStep({ data: { sessionId: session.sessionId, stepIndex, answer: text } }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function nextStep() {
    setStepFeedback(null);
    setText("");
    if (stepIndex + 1 < session.steps.length) {
      setStepIndex((i) => i + 1);
    } else if (session.questions.length > 0) {
      setStage("exercicios");
    } else {
      void end();
    }
  }

  async function submitAnswer(value: string) {
    if (busy || !question) return;
    setBusy(true);
    try {
      const feedback = await sendAnswer({
        data: { sessionId: session.sessionId, questionId: question.id, answer: value },
      });
      setAnswerFeedback(feedback);
      setScore((s) => ({ correct: s.correct + (feedback.correta ? 1 : 0), total: s.total + 1 }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function nextQuestion() {
    setAnswerFeedback(null);
    setText("");
    if (qIndex + 1 < session.questions.length) setQIndex((i) => i + 1);
    else void end();
  }

  async function end() {
    try {
      await finish({ data: { sessionId: session.sessionId, minutes: Math.max(1, minutes) } });
    } catch {
      /* o resumo local continua valendo */
    }
    setStage("fim");
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="mb-5 flex items-center gap-3">
        <button
          type="button"
          onClick={onExit}
          className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-soft transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" /> assuntos
        </button>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-soft">{clock}</span>
      </div>

      <h1 className="text-xl font-semibold text-ink">{session.title}</h1>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-soft">
        {session.subjectLabel || session.area}
        {stage === "aula" && session.steps.length > 0
          ? ` · passo ${stepIndex + 1} de ${session.steps.length}`
          : stage === "exercicios"
            ? ` · questão ${qIndex + 1} de ${session.questions.length}`
            : ""}
      </p>

      {stage === "aula" && step && (
        <section className="mt-6 space-y-4">
          <div className="rounded-lg border border-line bg-paper p-4">
            <p className="font-medium text-ink">{step.titulo}</p>
            <div className="mt-2 text-sm leading-relaxed text-ink-soft">
              <RichText text={step.explicacao} />
            </div>
            {step.exemplo && (
              <div className="mt-3 rounded border border-line bg-background p-3 text-sm text-ink-soft">
                <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em]">exemplo</p>
                <RichText text={step.exemplo} />
              </div>
            )}
          </div>

          <div className="rounded-lg border border-sun/40 bg-sun/5 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <Target className="size-4 text-sun-deep" /> {step.pergunta}
            </p>
            {!stepFeedback && (
              <>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  placeholder="Responda com suas palavras…"
                  className="mt-3 w-full resize-y rounded border border-line bg-paper p-3 text-sm text-ink outline-none focus:border-sun"
                />
                <button
                  type="button"
                  onClick={submitStep}
                  disabled={busy || !text.trim()}
                  className="mt-3 flex items-center gap-2 rounded bg-sun px-4 py-2 text-sm font-medium text-ink transition-opacity disabled:opacity-50"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  Conferir resposta
                </button>
              </>
            )}
          </div>

          {stepFeedback && (
            <div className="rounded-lg border border-line bg-paper p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-soft">
                nota {stepFeedback.nota} de 10
              </p>
              {stepFeedback.acertos.map((a) => (
                <p key={a} className="mt-2 flex gap-2 text-sm text-ink">
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> {a}
                </p>
              ))}
              {stepFeedback.ajustes.map((a) => (
                <p key={a} className="mt-2 flex gap-2 text-sm text-ink">
                  <X className="mt-0.5 size-4 shrink-0 text-amber-600" /> {a}
                </p>
              ))}
              {stepFeedback.explicacao && (
                <div className="mt-3 border-t border-line pt-3 text-sm leading-relaxed text-ink-soft">
                  <RichText text={stepFeedback.explicacao} />
                </div>
              )}
              {stepFeedback.dicaProximo && (
                <p className="mt-3 text-sm text-sun-deep">{stepFeedback.dicaProximo}</p>
              )}
              <button
                type="button"
                onClick={nextStep}
                className="mt-4 flex items-center gap-2 rounded bg-sun px-4 py-2 text-sm font-medium text-ink"
              >
                {stepIndex + 1 < session.steps.length
                  ? "Próximo passo"
                  : session.questions.length
                    ? "Ir para os exercícios"
                    : "Encerrar treino"}
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}
        </section>
      )}

      {stage === "exercicios" && question && (
        <section className="mt-6 space-y-4">
          <div className="rounded-lg border border-line bg-paper p-4 text-sm leading-relaxed text-ink">
            <RichText text={question.statement} />
          </div>

          {!answerFeedback &&
            (Object.keys(question.options).length > 0 ? (
              <div className="grid gap-2">
                {Object.entries(question.options).map(([letter, value]) => (
                  <button
                    key={letter}
                    type="button"
                    disabled={busy}
                    onClick={() => submitAnswer(letter)}
                    className="flex gap-3 rounded border border-line bg-paper p-3 text-left text-sm text-ink transition-colors hover:border-sun disabled:opacity-60"
                  >
                    <span className="font-mono text-sun-deep">{letter}</span>
                    <span className="min-w-0 flex-1">{value}</span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={5}
                  placeholder="Escreva sua resolução…"
                  className="w-full resize-y rounded border border-line bg-paper p-3 text-sm text-ink outline-none focus:border-sun"
                />
                <button
                  type="button"
                  onClick={() => submitAnswer(text)}
                  disabled={busy || !text.trim()}
                  className="flex items-center gap-2 rounded bg-sun px-4 py-2 text-sm font-medium text-ink disabled:opacity-50"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  Corrigir
                </button>
              </>
            ))}

          {busy && !answerFeedback && (
            <p className="flex items-center gap-2 text-sm text-ink-soft">
              <Loader2 className="size-4 animate-spin" /> Corrigindo…
            </p>
          )}

          {answerFeedback && (
            <div
              className={`rounded-lg border p-4 ${
                answerFeedback.correta ? "border-emerald-500/50 bg-emerald-500/5" : "border-red-500/50 bg-red-500/5"
              }`}
            >
              <p className="font-medium text-ink">
                {answerFeedback.correta ? "Acertou" : "Errou"}
                {answerFeedback.gabarito ? ` · gabarito ${answerFeedback.gabarito}` : ""}
              </p>
              {answerFeedback.ondeErrou && (
                <p className="mt-2 text-sm text-ink">{answerFeedback.ondeErrou}</p>
              )}
              {answerFeedback.explicacao && (
                <div className="mt-3 border-t border-line pt-3 text-sm leading-relaxed text-ink-soft">
                  <RichText text={answerFeedback.explicacao} />
                </div>
              )}
              {answerFeedback.passoRevisar && (
                <p className="mt-3 text-sm text-sun-deep">Revisar: {answerFeedback.passoRevisar}</p>
              )}
              <button
                type="button"
                onClick={nextQuestion}
                className="mt-4 flex items-center gap-2 rounded bg-sun px-4 py-2 text-sm font-medium text-ink"
              >
                {qIndex + 1 < session.questions.length ? "Próxima questão" : "Ver resumo"}
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}
        </section>
      )}

      {stage === "fim" && (
        <section className="mt-6 rounded-lg border border-line bg-paper p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-soft">
            treino concluído
          </p>
          <p className="mt-2 text-2xl font-semibold text-ink">
            {score.total > 0 ? `${score.correct} de ${score.total} questões` : "Aula concluída"}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {minutes} minuto{minutes === 1 ? "" : "s"} de estudo em {session.title}.
          </p>
          <button
            type="button"
            onClick={onExit}
            className="mt-5 rounded bg-sun px-4 py-2 text-sm font-medium text-ink"
          >
            Escolher outro assunto
          </button>
        </section>
      )}
    </div>
  );
}
