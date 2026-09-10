import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BookOpen, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/error-message";
import {
  ingestSource,
  nextPendingSource,
  retryFailedSources,
  scanCloudLibrary,
  workshopLibraryStatus,
} from "@/lib/workshop-ingest.functions";

/**
 * Painel da Nuvem que monta a biblioteca da oficina de estudos:
 * varre as pastas de materiais e simulados e lê um PDF por vez.
 */
export function StudyLibraryPanel() {
  const status = useServerFn(workshopLibraryStatus);
  const scan = useServerFn(scanCloudLibrary);
  const next = useServerFn(nextPendingSource);
  const ingest = useServerFn(ingestSource);
  const retry = useServerFn(retryFailedSources);

  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const stop = useRef(false);

  const { data, refetch, isLoading } = useQuery({
    queryKey: ["workshop-library"],
    queryFn: () => status(),
  });

  async function run() {
    setRunning(true);
    stop.current = false;
    try {
      const scanned = await scan();
      await refetch();
      if (scanned.pending === 0) toast.info("Nenhum arquivo novo para ler.");

      // lê um arquivo por vez, para o progresso aparecer e não estourar tempo
      for (let i = 0; i < 400 && !stop.current; i += 1) {
        const pending = await next();
        if (!pending) break;
        setCurrent(pending.name);
        try {
          await ingest({ data: { sourceId: pending.id } });
        } catch (err) {
          console.error("ingest falhou", err);
        }
        await refetch();
      }
      toast.success("Biblioteca de estudo atualizada.");
    } catch (err) {
      toast.error(errorMessage(err, "Não consegui ler a pasta agora."));
    } finally {
      setCurrent(null);
      setRunning(false);
    }
  }

  const total = data?.sources.length ?? 0;
  const done = data?.done ?? 0;
  const percent = total ? Math.round((done / total) * 100) : 0;

  return (
    <section className="mt-4 rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <BookOpen className="size-4 shrink-0 text-sun" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">Biblioteca de estudo</p>
          <p className="text-xs text-ink-soft">
            Leio as pastas “Materiais” e “Simulados Internos” e transformo os PDFs em aulas guiadas
            e questões de naturezas, matemática e linguagens.
          </p>
        </div>
        {!running ? (
          <button
            type="button"
            onClick={run}
            className="flex items-center gap-2 rounded-lg bg-sun px-3 py-2 text-sm font-medium text-ink"
          >
            <Sparkles className="size-4" />
            {done > 0 ? "Atualizar biblioteca" : "Montar biblioteca de estudo"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              stop.current = true;
            }}
            className="rounded-lg border border-line px-3 py-2 text-sm text-ink-soft"
          >
            Parar depois deste
          </button>
        )}
      </div>

      {(running || total > 0) && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
            <div className="h-full bg-sun transition-all" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-soft">
            {running && <Loader2 className="size-3.5 animate-spin text-sun" />}
            {done} de {total} arquivos lidos · {data?.topics ?? 0} assuntos ·{" "}
            {data?.questions ?? 0} questões
          </p>
          {current && (
            <p className="mt-1 truncate text-xs text-ink-soft">Lendo agora: {current}</p>
          )}
          {!running && (data?.failed ?? 0) > 0 && (
            <button
              type="button"
              onClick={async () => {
                await retry();
                await refetch();
                toast.info("Arquivos com erro voltaram para a fila.");
              }}
              className="mt-2 flex items-center gap-1 text-xs text-sun-deep hover:underline"
            >
              <RefreshCw className="size-3.5" /> tentar de novo {data?.failed} arquivo(s) com erro
            </button>
          )}
        </div>
      )}

      {!isLoading && (data?.topics ?? 0) > 0 && (
        <Link
          to="/estudo"
          className="mt-3 inline-flex text-sm text-sun-deep underline-offset-2 hover:underline"
        >
          Abrir a oficina de estudos
        </Link>
      )}
    </section>
  );
}
