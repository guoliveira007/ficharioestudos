/**
 * Acesso interno ao OneDrive (Microsoft Graph via gateway da Lovable).
 * Só pode ser importado dentro de handlers de servidor.
 */

const GATEWAY_URL = "https://connector-gateway.lovable.dev/microsoft_onedrive/v1.0";

export async function graph(path: string, init?: RequestInit) {
  const apiKey = process.env["MICROSOFT_ONEDRIVE_API_KEY"];
  const lovableKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey || !lovableKey) throw new Error("Conexão com o OneDrive não está configurada.");

  const res = await fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": apiKey,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`OneDrive gateway failed [${res.status}]: ${body}`);
    throw new Error(`OneDrive respondeu ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<Record<string, any>>;
}

export function encodeShareToken(shareUrl: string) {
  const url = shareUrl.trim();
  if (!/^https:\/\/(1drv\.ms|onedrive\.live\.com)\//.test(url)) {
    throw new Error("Link de compartilhamento do OneDrive inválido.");
  }
  const base64 = Buffer.from(url, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `u!${base64}`;
}

export type GraphChild = {
  id: string;
  name: string;
  isFolder: boolean;
  size: number;
  driveId: string;
};

/** Lista os filhos de uma pasta identificada por drive + item. */
export async function listChildren(driveId: string, itemId: string): Promise<GraphChild[]> {
  const json = await graph(
    `/drives/${driveId}/items/${itemId}/children?$top=400&$select=id,name,folder,file,size`,
  );
  return ((json["value"] ?? []) as Record<string, any>[]).map((raw) => ({
    id: String(raw["id"]),
    name: String(raw["name"]),
    isFolder: !!raw["folder"],
    size: Number(raw["size"] ?? 0),
    driveId,
  }));
}

/** Link temporário de download de um item. */
export async function downloadUrl(driveId: string, itemId: string) {
  const json = await graph(`/drives/${driveId}/items/${itemId}`);
  const url = json["@microsoft.graph.downloadUrl"] as string | undefined;
  if (!url) throw new Error("Não foi possível gerar o link do arquivo.");
  return url;
}

/** Baixa o conteúdo de um arquivo da nuvem. */
export async function fetchFileBytes(driveId: string, itemId: string): Promise<Uint8Array> {
  const url = await downloadUrl(driveId, itemId);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar o arquivo (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}
