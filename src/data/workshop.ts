/**
 * Oficina de estudos: áreas, roteiro da aula guiada e instruções por área.
 * Usado tanto na leitura dos PDFs quanto na sessão de treino.
 */

export const AREAS = [
  {
    id: "naturezas",
    label: "Naturezas",
    hint: "Biologia, Física e Química",
    brief:
      "Caminho de raciocínio: fenômeno observado → modelo/lei que explica → aplicação numérica ou interpretação de gráfico/experimento. " +
      "Sempre exija unidades corretas, ordem de grandeza e leitura fina de gráficos e tabelas.",
  },
  {
    id: "matematica",
    label: "Matemática",
    hint: "Matemática e suas tecnologias",
    brief:
      "Caminho de raciocínio: conceito → técnica de cálculo → aplicação em contexto. " +
      "Exija a montagem da expressão antes da conta, conferência do resultado e interpretação da resposta no enunciado.",
  },
  {
    id: "linguagens",
    label: "Linguagens",
    hint: "Português, literatura, interpretação e inglês",
    brief:
      "Caminho de raciocínio: conceito → leitura atenta do texto → análise com evidência textual. " +
      "Exija sempre a marca no texto que sustenta a resposta, e cuidado com paráfrases que extrapolam o enunciado.",
  },
] as const;

export type AreaId = (typeof AREAS)[number]["id"];

export const AREA_IDS = AREAS.map((a) => a.id) as AreaId[];

export function getArea(id: string) {
  return AREAS.find((a) => a.id === id) ?? AREAS[0];
}

/** Um passo da aula guiada, extraído do PDF de material. */
export type TopicStep = {
  /** título curto do passo */
  titulo: string;
  /** explicação do conceito, em 3 a 6 frases */
  explicacao: string;
  /** exemplo resolvido ou trecho comentado */
  exemplo: string;
  /** pergunta de checagem feita ao aluno no fim do passo */
  pergunta: string;
  /** resposta esperada, usada só pela correção */
  respostaEsperada: string;
};

export function normalizeSteps(raw: unknown): TopicStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const s = item as Partial<TopicStep>;
      return {
        titulo: String(s?.titulo ?? "").trim(),
        explicacao: String(s?.explicacao ?? "").trim(),
        exemplo: String(s?.exemplo ?? "").trim(),
        pergunta: String(s?.pergunta ?? "").trim(),
        respostaEsperada: String(s?.respostaEsperada ?? "").trim(),
      };
    })
    .filter((s) => s.titulo && s.explicacao && s.pergunta)
    .slice(0, 8);
}

/** Pastas da nuvem que alimentam a oficina. */
export const CLOUD_FOLDERS = [
  { key: "materiais", match: /materia(is|l)/i },
  { key: "simulados", match: /simulad/i },
] as const;

export type CloudFolderKey = (typeof CLOUD_FOLDERS)[number]["key"];
