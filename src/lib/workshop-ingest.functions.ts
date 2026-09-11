import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiJson, toDataUrl } from "./exam-ai.server";
import { AREA_IDS, CLOUD_FOLDERS, normalizeSteps, type AreaId } from "@/data/workshop";
import { SHARED_FOLDER_URL } from "@/lib/onedrive.functions";

export type SourceRow = {
  id: string;
  name: string;
  folder: string;
  path: string;
  status: string;
  error: string | null;
  pages: number | null;
};

const MAX_FILE_BYTES = 18 * 1024 * 1024;

/** Situação da biblioteca de estudo: quantos arquivos, assuntos e questões já existem. */
export const workshopLibraryStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [sources, topics, questions] = await Promise.all([
      supabase.from("workshop_sources").select("id,name,folder,path,status,error,pages").eq("user_id", userId).order("folder").order("name"),
      supabase.from("workshop_topics").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("workshop_questions").select("id", { count: "exact", head: true }).eq("user_id", userId),
    ]);
    const rows = (sources.data ?? []) as SourceRow[];
    return {
      sources: rows,
      pending: rows.filter((s) => s.status === "pendente").length,
      done: rows.filter((s) => s.status === "lido").length,
      failed: rows.filter((s) => s.status === "erro").length,
      topics: topics.count ?? 0,
      questions: questions.count ?? 0,
    };
  });

/** Percorre as pastas "Materiais" e "Simulados Internos" e registra os PDFs encontrados. */
export const scanCloudLibrary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { encodeShareToken, graph, listChildren } = await import("@/lib/cloud-graph.server");

    const shared = await graph(
      `/shares/${encodeShareToken(SHARED_FOLDER_URL)}/driveItem?$select=id,name,parentReference`,
    );
    const rootDrive = String(shared["parentReference"]?.["driveId"] ?? "");
    const rootItem = String(shared["id"] ?? "");
    if (!rootDrive || !rootItem) throw new Error("Não consegui abrir a pasta compartilhada.");

    const top = await listChildren(rootDrive, rootItem);
    const found: {
      onedrive_item_id: string;
      drive_id: string;
      name: string;
      folder: string;
      path: string;
      size: number;
      user_id: string;
    }[] = [];

    for (const entry of CLOUD_FOLDERS) {
      const folder = top.find((c) => c.isFolder && entry.match.test(c.name));
      if (!folder) continue;

      // varredura em largura, no máximo 4 níveis
      let level: { id: string; path: string }[] = [{ id: folder.id, path: folder.name }];
      for (let depth = 0; depth < 4 && level.length; depth += 1) {
        const next: { id: string; path: string }[] = [];
        for (const node of level) {
          const children = await listChildren(rootDrive, node.id);
          for (const child of children) {
            if (child.isFolder) {
              next.push({ id: child.id, path: `${node.path}/${child.name}` });
            } else if (/\.pdf$/i.test(child.name) && child.size <= MAX_FILE_BYTES) {
              found.push({
                user_id: userId,
                onedrive_item_id: child.id,
                drive_id: rootDrive,
                name: child.name,
                folder: entry.key,
                path: node.path,
                size: child.size,
              });
            }
          }
        }
        level = next;
      }
    }

    if (found.length) {
      const { error } = await supabase
        .from("workshop_sources")
        .upsert(found, { onConflict: "user_id,onedrive_item_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }

    const { count } = await supabase
      .from("workshop_sources")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "pendente");

    return { found: found.length, pending: count ?? 0 };
  });

const areaOf = (value: unknown): AreaId => {
  const v = String(value ?? "").toLowerCase();
  if (v.startsWith("mat")) return "matematica";
  if (v.startsWith("ling")) return "linguagens";
  return AREA_IDS.includes(v as AreaId) ? (v as AreaId) : "naturezas";
};

type AiTopic = {
  area?: string;
  materia?: string;
  frente?: string;
  bancas?: unknown;
  comoCai?: string;
  titulo?: string;
  resumo?: string;
  passos?: unknown;
  questoes?: {
    enunciado?: string;
    alternativas?: Record<string, string> | string[];
    gabarito?: string;
    explicacao?: string;
    dificuldade?: string;
    pagina?: number;
    banca?: string;
  }[];
};

const norm = (v: unknown) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const BOARDS = ["ENEM", "FUVEST", "UNIFESP"] as const;

const boardsOf = (raw: unknown): string[] => {
  const list = Array.isArray(raw) ? raw : [raw];
  const found = list
    .map((v) => BOARDS.find((b) => norm(v).includes(norm(b))))
    .filter((b): b is (typeof BOARDS)[number] => !!b);
  return Array.from(new Set(found));
};

const optionsOf = (raw: unknown): Record<string, string> => {
  if (Array.isArray(raw)) {
    const letters = ["A", "B", "C", "D", "E"];
    return Object.fromEntries(raw.slice(0, 5).map((v, i) => [letters[i]!, String(v)]));
  }
  if (raw && typeof raw === "object") {
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>)
        .slice(0, 6)
        .map(([k, v]) => [k.toUpperCase().slice(0, 1), String(v)]),
    );
  }
  return {};
};

/** Lê UM PDF da nuvem e transforma em assuntos com passos e questões. */
export const ingestSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ sourceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: source, error } = await supabase
      .from("workshop_sources")
      .select("id,name,folder,path,drive_id,onedrive_item_id,status")
      .eq("id", data.sourceId)
      .single();
    if (error || !source) throw new Error("Arquivo não encontrado.");
    if (source.status === "lido") return { topics: 0, questions: 0, skipped: true };

    try {
      const { fetchFileBytes } = await import("@/lib/cloud-graph.server");
      const bytes = await fetchFileBytes(String(source.drive_id), String(source.onedrive_item_id));

      // taxonomia real do aluno: matérias e frentes já usadas na plataforma
      const [{ data: subjectRows }, { data: lessonRows }] = await Promise.all([
        supabase.from("subjects").select("id,name,parent_id,area").eq("user_id", userId),
        supabase.from("custom_lessons").select("subject,frente").eq("user_id", userId).limit(400),
      ]);
      const subjects = subjectRows ?? [];
      const byId = new Map(subjects.map((s) => [s.id, s]));
      const taxonomy = new Map<string, Set<string>>();
      for (const s of subjects) {
        const parent = s.parent_id ? byId.get(s.parent_id) : null;
        const materia = parent ? parent.name : s.name;
        const set = taxonomy.get(materia) ?? new Set<string>();
        if (parent) set.add(s.name);
        taxonomy.set(materia, set);
      }
      for (const l of lessonRows ?? []) {
        const materia = String(l.subject ?? "").trim();
        const frente = String(l.frente ?? "").trim();
        if (!materia) continue;
        const set = taxonomy.get(materia) ?? new Set<string>();
        if (frente) set.add(frente);
        taxonomy.set(materia, set);
      }
      const taxonomyText =
        [...taxonomy.entries()]
          .map(([m, fs]) => `- ${m}${fs.size ? `: ${[...fs].slice(0, 12).join(", ")}` : ""}`)
          .slice(0, 40)
          .join("\n") || "(sem matérias cadastradas ainda)";

      const subjectIdFor = (materia: string, frente: string) => {
        const nm = norm(materia);
        const nf = norm(frente);
        const parent = subjects.find((s) => !s.parent_id && norm(s.name) === nm);
        if (parent && nf) {
          const child = subjects.find(
            (s) => s.parent_id === parent.id && norm(s.name) === nf,
          );
          if (child) return child.id;
        }
        return parent?.id ?? null;
      };

      const isExam = source.folder === "simulados";
      const parsed = await aiJson<{ topicos?: AiTopic[] }>(
        "Você é professor de um dos melhores cursinhos do Brasil montando material de estudo a partir de um PDF, " +
          "com foco exclusivo em ENEM, FUVEST e UNIFESP. Leia o arquivo inteiro e organize em assuntos objetivos.\n" +
          (isExam
            ? "Este PDF é um SIMULADO. Para cada assunto cobrado, extraia as questões com enunciado completo, alternativas, " +
              "gabarito (quando aparecer) e resolução comentada. Os 'passos' revisam a teoria mínima que a questão exige."
            : "Este PDF é MATERIAL DE AULA. Para cada assunto, monte uma aula em passos progressivos e extraia os exercícios do PDF como questões.") +
          "\n\nMATÉRIAS E FRENTES QUE O ALUNO JÁ USA (reaproveite os nomes exatos sempre que couber):\n" +
          taxonomyText +
          "\n\nRegras obrigatórias:\n" +
          "1. Use apenas o conteúdo do PDF; não invente dados. Português do Brasil.\n" +
          "2. 'area' é 'naturezas', 'matematica' ou 'linguagens'. 'materia' é a disciplina (Física, Química, Biologia, Matemática, Português, Literatura, Inglês, Redação…).\n" +
          "3. 'frente' é a frente/divisão dentro da matéria (ex.: Mecânica, Eletromagnetismo, Físico-Química, Orgânica, Álgebra, Geometria, Gramática, Literatura, Interpretação). " +
          "Prefira uma frente da lista acima; só crie outra se nenhuma servir. Nunca deixe 'frente' vazia.\n" +
          "4. 'bancas' lista onde o assunto mais cai, entre ENEM, FUVEST e UNIFESP. 'comoCai' diz em 1 ou 2 frases o recorte típico de cobrança dessas bancas.\n" +
          "5. Seja DIDÁTICO e ENXUTO: nada de encher linguiça. 3 a 5 passos por assunto. Cada passo: 'titulo' curto, " +
          "'explicacao' direta em 3 a 5 frases (o porquê, não só o que), 'exemplo' resolvido no estilo da banca, " +
          "'pergunta' de checagem que exige raciocínio (não decoreba) e 'respostaEsperada' objetiva.\n" +
          "6. Priorize o que é recorrente em prova; descarte curiosidades e trechos administrativos do PDF.\n" +
          "7. Fórmulas em texto simples. No máximo 6 assuntos e 8 questões por assunto. Em cada questão, 'banca' é ENEM, FUVEST, UNIFESP ou o vestibular citado no PDF.\n" +
          'Responda só JSON: {"topicos":[{"area":"...","materia":"...","frente":"...","bancas":["ENEM"],"comoCai":"...","titulo":"...","resumo":"...",' +
          '"passos":[{"titulo":"...","explicacao":"...","exemplo":"...","pergunta":"...","respostaEsperada":"..."}],' +
          '"questoes":[{"enunciado":"...","alternativas":{"A":"...","B":"..."},"gabarito":"A","explicacao":"...","dificuldade":"facil|media|dificil","pagina":1,"banca":"ENEM"}]}]}',
        [
          {
            type: "file",
            file: { filename: String(source.name), file_data: toDataUrl(bytes, "application/pdf") },
          },
          { type: "text", text: `Arquivo: ${source.path}/${source.name}` },
        ],
        { maxTokens: 32000 },
      );

      const topics = Array.isArray(parsed.topicos) ? parsed.topicos.slice(0, 6) : [];
      let topicCount = 0;
      let questionCount = 0;

      for (const topic of topics) {
        const title = String(topic.titulo ?? "").trim();
        const steps = normalizeSteps(topic.passos);
        if (!title || steps.length === 0) continue;
        const area = areaOf(topic.area);
        const subjectLabel = String(topic.materia ?? "").trim();
        const frente = String(topic.frente ?? "").trim().slice(0, 80);
        const boards = boardsOf(topic.bancas);

        const { data: inserted, error: topicError } = await supabase
          .from("workshop_topics")
          .insert({
            user_id: userId,
            source_id: source.id,
            subject_id: subjectIdFor(subjectLabel, frente),
            area,
            subject_label: subjectLabel,
            frente,
            boards,
            exam_focus: String(topic.comoCai ?? "").trim().slice(0, 400),
            title,
            summary: String(topic.resumo ?? "").trim(),
            steps: steps as unknown as never,
          })
          .select("id")
          .single();
        if (topicError || !inserted) continue;
        topicCount += 1;

        const questions = (Array.isArray(topic.questoes) ? topic.questoes : [])
          .slice(0, 8)
          .map((q) => ({
            user_id: userId,
            topic_id: inserted.id,
            source_id: source.id,
            area,
            subject_label: subjectLabel,
            frente,
            board: boardsOf(q.banca)[0] ?? boards[0] ?? null,
            topic_label: title,
            statement: String(q.enunciado ?? "").trim(),
            options: optionsOf(q.alternativas) as unknown as never,
            correct_answer: q.gabarito ? String(q.gabarito).toUpperCase().slice(0, 1) : null,
            explanation: String(q.explicacao ?? "").trim() || null,
            difficulty: ["facil", "media", "dificil"].includes(String(q.dificuldade))
              ? String(q.dificuldade)
              : "media",
            page_number: Number.isFinite(Number(q.pagina)) ? Number(q.pagina) : null,
          }))
          .filter((q) => q.statement.length > 10);

        if (questions.length) {
          const { error: qError } = await supabase.from("workshop_questions").insert(questions);
          if (!qError) questionCount += questions.length;
        }
      }

      await supabase
        .from("workshop_sources")
        .update({ status: "lido", error: null, processed_at: new Date().toISOString() })
        .eq("id", source.id);

      return { topics: topicCount, questions: questionCount, skipped: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao ler o arquivo.";
      await supabase
        .from("workshop_sources")
        .update({ status: "erro", error: message.slice(0, 400) })
        .eq("id", source.id);
      throw new Error(message);
    }
  });

/** Devolve o próximo arquivo pendente (a página lê um por vez, mostrando o progresso). */
export const nextPendingSource = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("workshop_sources")
      .select("id,name,folder")
      .eq("user_id", context.userId)
      .eq("status", "pendente")
      .order("folder")
      .order("name")
      .limit(1)
      .maybeSingle();
    return data ?? null;
  });

/** Marca de novo como pendente os arquivos que falharam, para tentar outra vez. */
export const retryFailedSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("workshop_sources")
      .update({ status: "pendente", error: null })
      .eq("user_id", context.userId)
      .eq("status", "erro");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
