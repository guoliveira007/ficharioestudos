import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiJson } from "./exam-ai.server";
import { getArea, normalizeSteps, type AreaId, type TopicStep } from "@/data/workshop";

export type CatalogTopic = {
  id: string;
  area: string;
  subjectLabel: string;
  frente: string;
  boards: string[];
  examFocus: string;
  title: string;
  summary: string;
  steps: number;
  questions: number;
  sessions: number;
  bestScore: number | null;
};

/** Catálogo de assuntos disponíveis na oficina, por área e matéria. */
export const listWorkshopCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CatalogTopic[]> => {
    const { supabase, userId } = context;
    const [topics, questions, sessions] = await Promise.all([
      supabase
        .from("workshop_topics")
        .select("id,area,subject_label,frente,boards,exam_focus,title,summary,steps")
        .eq("user_id", userId)
        .order("area")
        .order("subject_label")
        .order("frente")
        .order("title"),
      supabase.from("workshop_questions").select("topic_id").eq("user_id", userId),
      supabase
        .from("workshop_sessions")
        .select("topic_id,correct,total,finished_at")
        .eq("user_id", userId),
    ]);

    const perTopic = new Map<string, number>();
    for (const q of questions.data ?? []) {
      const key = String(q.topic_id ?? "");
      if (key) perTopic.set(key, (perTopic.get(key) ?? 0) + 1);
    }
    const done = new Map<string, { count: number; best: number | null }>();
    for (const s of sessions.data ?? []) {
      const key = String(s.topic_id ?? "");
      if (!key) continue;
      const prev = done.get(key) ?? { count: 0, best: null };
      const rate = s.total > 0 ? Math.round((s.correct / s.total) * 100) : null;
      done.set(key, {
        count: prev.count + 1,
        best: rate === null ? prev.best : Math.max(prev.best ?? 0, rate),
      });
    }

    return (topics.data ?? []).map((t) => ({
      id: t.id,
      area: t.area,
      subjectLabel: t.subject_label ?? "",
      frente: t.frente ?? "",
      boards: (t.boards ?? []) as string[],
      examFocus: t.exam_focus ?? "",
      title: t.title,
      summary: t.summary ?? "",
      steps: normalizeSteps(t.steps).length,
      questions: perTopic.get(t.id) ?? 0,
      sessions: done.get(t.id)?.count ?? 0,
      bestScore: done.get(t.id)?.best ?? null,
    }));
  });

export type WorkshopQuestion = {
  id: string;
  statement: string;
  options: Record<string, string>;
  difficulty: string;
};

export type WorkshopSession = {
  sessionId: string;
  topicId: string;
  area: AreaId;
  title: string;
  summary: string;
  subjectLabel: string;
  steps: TopicStep[];
  questions: WorkshopQuestion[];
};

/** Abre (ou retoma) um treino de um assunto. */
export const startWorkshopSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ topicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<WorkshopSession> => {
    const { supabase, userId } = context;
    const { data: topic, error } = await supabase
      .from("workshop_topics")
      .select("id,area,title,summary,subject_label,steps")
      .eq("id", data.topicId)
      .single();
    if (error || !topic) throw new Error("Assunto não encontrado.");

    const { data: questions } = await supabase
      .from("workshop_questions")
      .select("id,statement,options,difficulty")
      .eq("user_id", userId)
      .eq("topic_id", topic.id)
      .limit(8);

    const { data: session, error: sessionError } = await supabase
      .from("workshop_sessions")
      .insert({ user_id: userId, topic_id: topic.id, area: topic.area })
      .select("id")
      .single();
    if (sessionError || !session) throw new Error("Não consegui abrir o treino agora.");

    return {
      sessionId: session.id,
      topicId: topic.id,
      area: getArea(topic.area).id,
      title: topic.title,
      summary: topic.summary ?? "",
      subjectLabel: topic.subject_label ?? "",
      steps: normalizeSteps(topic.steps),
      questions: (questions ?? []).map((q) => ({
        id: q.id,
        statement: q.statement,
        options: (q.options ?? {}) as Record<string, string>,
        difficulty: q.difficulty ?? "media",
      })),
    };
  });

export type StepFeedback = {
  aprovado: boolean;
  nota: number;
  acertos: string[];
  ajustes: string[];
  explicacao: string;
  dica: string;
  dicaProximo: string;
  podeTentarNovamente: boolean;
  tentativa: number;
};

/** Corrige a resposta do aluno a uma pergunta de checagem da aula guiada. */
export const workshopStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        stepIndex: z.number().int().min(0).max(20),
        answer: z.string().min(1).max(4000),
        attempt: z.number().int().min(1).max(5).default(1),
        revelar: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<StepFeedback> => {
    const { supabase, userId } = context;
    const { data: session, error } = await supabase
      .from("workshop_sessions")
      .select("id,topic_id,area")
      .eq("id", data.sessionId)
      .single();
    if (error || !session) throw new Error("Treino não encontrado.");

    const { data: topic } = await supabase
      .from("workshop_topics")
      .select("title,steps,subject_label")
      .eq("id", session.topic_id!)
      .single();
    const steps = normalizeSteps(topic?.steps);
    const step = steps[data.stepIndex];
    if (!step) throw new Error("Passo não encontrado.");
    const area = getArea(session.area);

    const ultima = data.revelar || data.attempt >= 3;

    const parsed = await aiJson<Partial<StepFeedback>>(
      "Você é professor particular de cursinho, em português do Brasil, acompanhando o aluno passo a passo. " +
        `Área: ${area.label}. ${area.brief}\n` +
        `Assunto: ${topic?.title ?? ""} (${topic?.subject_label ?? ""}).\n` +
        `Passo atual: ${step.titulo}. Conteúdo ensinado: ${step.explicacao}\n` +
        `Pergunta feita: ${step.pergunta}\nResposta esperada (referência): ${step.respostaEsperada}\n` +
        `Esta é a tentativa ${data.attempt} do aluno.\n\n` +
        "Avalie a resposta do aluno com generosidade quanto à forma e rigor quanto ao conteúdo. " +
        "No máximo 3 acertos e 3 ajustes, cada um em uma frase, citando o que ele escreveu. " +
        (ultima
          ? "'explicacao' traz a resposta completa, desenvolvida em passos, com o porquê de cada etapa e ligada ao que ele escreveu (mínimo 4 frases). 'dica' fica vazia. "
          : "NUNCA entregue a resposta pronta agora: o aluno vai tentar de novo. Deixe 'explicacao' vazia quando ele errar e escreva em 'dica' um empurrão socrático (uma pergunta ou pista que o faça achar o próprio erro). Se ele acertou, aí sim preencha 'explicacao' consolidando o raciocínio. ") +
        "'aprovado' é true quando ele entendeu o essencial e pode avançar. 'nota' vai de 0 a 10. " +
        "'dicaProximo' diz no que prestar atenção no próximo passo.\n" +
        'Responda só JSON: {"aprovado":true,"nota":0,"acertos":["..."],"ajustes":["..."],"explicacao":"...","dica":"...","dicaProximo":"..."}',
      [{ type: "text", text: `RESPOSTA DO ALUNO:\n${data.answer.trim()}` }],
    );

    const strList = (v: unknown) =>
      Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean).slice(0, 3) : [];
    const nota = Number(parsed.nota);
    const aprovado = parsed.aprovado !== false;
    const feedback: StepFeedback = {
      aprovado,
      nota: Number.isFinite(nota) ? Math.max(0, Math.min(10, Math.round(nota * 10) / 10)) : 0,
      acertos: strList(parsed.acertos),
      ajustes: strList(parsed.ajustes),
      explicacao: aprovado || ultima ? String(parsed.explicacao ?? "").trim() : "",
      dica: aprovado ? "" : String(parsed.dica ?? "").trim(),
      dicaProximo: String(parsed.dicaProximo ?? "").trim(),
      podeTentarNovamente: !aprovado && !ultima,
      tentativa: data.attempt,
    };

    await supabase.from("workshop_answers").insert({
      user_id: userId,
      session_id: session.id,
      stage: "aula",
      step_index: data.stepIndex,
      answer: data.answer.slice(0, 4000),
      is_correct: feedback.aprovado,
      score: feedback.nota,
      feedback: feedback as unknown as never,
    });
    if (feedback.aprovado || ultima) {
      await supabase
        .from("workshop_sessions")
        .update({ step_index: data.stepIndex + 1 })
        .eq("id", session.id);
    }

    return feedback;
  });

export type StepDeepDive = {
  teoria: string;
  formulas: string[];
  exemploResolvido: string;
  errosComuns: string[];
  perguntaExtra: string;
};

/** Aprofunda um passo da aula: teoria completa, exemplo resolvido e pegadinhas. */
export const workshopDeepen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        stepIndex: z.number().int().min(0).max(20),
        duvida: z.string().max(600).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<StepDeepDive> => {
    const { supabase } = context;
    const { data: session, error } = await supabase
      .from("workshop_sessions")
      .select("id,topic_id,area")
      .eq("id", data.sessionId)
      .single();
    if (error || !session) throw new Error("Treino não encontrado.");

    const { data: topic } = await supabase
      .from("workshop_topics")
      .select("title,steps,subject_label")
      .eq("id", session.topic_id!)
      .single();
    const step = normalizeSteps(topic?.steps)[data.stepIndex];
    if (!step) throw new Error("Passo não encontrado.");
    const area = getArea(session.area);

    const parsed = await aiJson<Partial<StepDeepDive>>(
      "Você é professor de cursinho de alto nível, em português do Brasil, aprofundando um passo da aula para um aluno de vestibular exigente (FUVEST, UNIFESP, ENEM). " +
        `Área: ${area.label}. ${area.brief}\nAssunto: ${topic?.title ?? ""} (${topic?.subject_label ?? ""}).\n` +
        `Passo: ${step.titulo}\nBase já vista: ${step.explicacao}\n` +
        (data.duvida.trim() ? `Dúvida específica do aluno: ${data.duvida.trim()}\n` : "") +
        "'teoria' desenvolve o conteúdo com profundidade real (6 a 10 frases), explicando o porquê, não só o que. " +
        "'formulas' traz até 4 fórmulas, definições ou regras-chave (vazio quando não fizer sentido na área). " +
        "'exemploResolvido' mostra um exemplo típico de prova resolvido passo a passo. " +
        "'errosComuns' lista até 4 pegadinhas e confusões frequentes. " +
        "'perguntaExtra' é uma pergunta desafio sobre o passo.\n" +
        'Responda só JSON: {"teoria":"...","formulas":["..."],"exemploResolvido":"...","errosComuns":["..."],"perguntaExtra":"..."}',
      [{ type: "text", text: step.explicacao }],
    );

    const strList = (v: unknown, n: number) =>
      Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean).slice(0, n) : [];

    return {
      teoria: String(parsed.teoria ?? "").trim(),
      formulas: strList(parsed.formulas, 4),
      exemploResolvido: String(parsed.exemploResolvido ?? "").trim(),
      errosComuns: strList(parsed.errosComuns, 4),
      perguntaExtra: String(parsed.perguntaExtra ?? "").trim(),
    };
  });

export type AnswerFeedback = {
  correta: boolean;
  gabarito: string;
  explicacao: string;
  ondeErrou: string;
  passoRevisar: string;
  dica: string;
  descartadas: string[];
  podeTentarNovamente: boolean;
  tentativa: number;
};

/** Corrige uma questão do simulado dentro do treino. */
export const workshopAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        questionId: z.string().uuid(),
        answer: z.string().min(1).max(4000),
        attempt: z.number().int().min(1).max(5).default(1),
        revelar: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<AnswerFeedback> => {
    const { supabase, userId } = context;
    const { data: question, error } = await supabase
      .from("workshop_questions")
      .select("id,statement,options,correct_answer,explanation,topic_label,area")
      .eq("id", data.questionId)
      .single();
    if (error || !question) throw new Error("Questão não encontrada.");

    const options = (question.options ?? {}) as Record<string, string>;
    const temAlternativas = Object.keys(options).length > 0;
    const area = getArea(question.area);
    const chosen = data.answer.trim();
    const letter = chosen.toUpperCase().slice(0, 1);
    const known = question.correct_answer ? String(question.correct_answer).toUpperCase() : null;
    const ultima = data.revelar || data.attempt >= 2;

    const parsed = await aiJson<Partial<AnswerFeedback>>(
      "Você é professor de cursinho corrigindo uma questão com o aluno, em português do Brasil. " +
        `Área: ${area.label}. ${area.brief}\nAssunto: ${question.topic_label ?? ""}.\n` +
        (known ? `Gabarito oficial: ${known}. Use este gabarito.\n` : "O gabarito não veio no material: resolva a questão e determine a alternativa correta.\n") +
        (question.explanation ? `Resolução do material: ${question.explanation}\n` : "") +
        `Esta é a tentativa ${data.attempt} do aluno.\n` +
        (ultima
          ? "'explicacao' resolve a questão em passos completos, dizendo por que cada alternativa errada é errada. 'dica' fica vazia. "
          : "O aluno ainda vai tentar de novo: se ele errou, NÃO revele o gabarito nem a resolução. Deixe 'explicacao' vazia, escreva em 'dica' uma pista socrática que o reoriente e liste em 'descartadas' as letras que ele já pode eliminar com segurança (sem incluir a correta). Se acertou, preencha 'explicacao' normalmente. ") +
        "'ondeErrou' explica, em uma frase, o raciocínio que levou o aluno ao engano (ou o que ele acertou, se estiver certo). 'passoRevisar' indica o conceito a revisar.\n" +
        'Responda só JSON: {"correta":true,"gabarito":"A","explicacao":"...","ondeErrou":"...","passoRevisar":"...","dica":"...","descartadas":["B"]}',
      [
        {
          type: "text",
          text: [
            `QUESTÃO:\n${question.statement}`,
            temAlternativas
              ? `ALTERNATIVAS:\n${Object.entries(options).map(([k, v]) => `${k}) ${v}`).join("\n")}`
              : "Questão dissertativa.",
            `RESPOSTA DO ALUNO: ${chosen}`,
          ].join("\n\n"),
        },
      ],
    );

    const gabarito = known ?? String(parsed.gabarito ?? "").toUpperCase().slice(0, 1);
    const correta = temAlternativas && gabarito ? letter === gabarito : parsed.correta === true;
    const mostrar = correta || ultima;

    const feedback: AnswerFeedback = {
      correta,
      gabarito: mostrar ? gabarito : "",
      explicacao: mostrar ? String(parsed.explicacao ?? "").trim() : "",
      ondeErrou: String(parsed.ondeErrou ?? "").trim(),
      passoRevisar: String(parsed.passoRevisar ?? "").trim(),
      dica: mostrar ? "" : String(parsed.dica ?? "").trim(),
      descartadas: mostrar
        ? []
        : Array.isArray(parsed.descartadas)
          ? parsed.descartadas
              .map((s) => String(s).toUpperCase().slice(0, 1))
              .filter((s) => s && s !== gabarito)
              .slice(0, 3)
          : [letter].filter(Boolean),
      podeTentarNovamente: !correta && !ultima,
      tentativa: data.attempt,
    };

    await supabase.from("workshop_answers").insert({
      user_id: userId,
      session_id: data.sessionId,
      question_id: question.id,
      stage: "exercicios",
      answer: chosen.slice(0, 4000),
      is_correct: correta,
      feedback: feedback as unknown as never,
    });

    if (data.attempt === 1) {
      const { data: session } = await supabase
        .from("workshop_sessions")
        .select("correct,total")
        .eq("id", data.sessionId)
        .single();
      await supabase
        .from("workshop_sessions")
        .update({
          stage: "exercicios",
          correct: (session?.correct ?? 0) + (correta ? 1 : 0),
          total: (session?.total ?? 0) + 1,
        })
        .eq("id", data.sessionId);
    }

    return feedback;
  });

/** Fecha o treino e devolve o resumo da sessão. */
export const finishWorkshopSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid(), minutes: z.number().int().min(0).max(600) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: session } = await supabase
      .from("workshop_sessions")
      .update({ minutes: data.minutes, finished_at: new Date().toISOString(), stage: "fim" })
      .eq("id", data.sessionId)
      .select("correct,total,area,topic_id")
      .single();

    if (session) {
      await supabase.from("study_sessions").insert({
        user_id: userId,
        day: new Date().toISOString().slice(0, 10),
        minutes: data.minutes,
        cards_reviewed: 0,
        correct: session.correct ?? 0,
        total: session.total ?? 0,
      });
    }

    return {
      correct: session?.correct ?? 0,
      total: session?.total ?? 0,
    };
  });
