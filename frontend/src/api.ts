/** Display name for the greeting and avatar. */
export const USER_NAME: string =
  import.meta.env.VITE_PAPERLAB_USER_NAME || "研究者";
export async function api<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers:
        options.body instanceof FormData
          ? options.headers
          : { "Content-Type": "application/json", ...options.headers },
    });
  } catch {
    throw new Error(
      "无法连接本地后端。请运行启动脚本，并检查 127.0.0.1:8000。",
    );
  }
  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try {
      const body = await response.json();
      message =
        typeof body.detail === "string"
          ? body.detail
          : JSON.stringify(body.detail);
    } catch {
      /* non-JSON server error */
    }
    throw new Error(message);
  }
  return response.json();
}
export const base = (id: string, version: string) =>
  `/api/papers/${encodeURIComponent(id)}/${encodeURIComponent(version)}`;
export function paperCommand(p: {
  paper_id: string;
  version: string;
  source_url: string | null;
}) {
  const reference = p.paper_id.startsWith("local-")
    ? `${p.paper_id} --version ${p.version}`
    : /^\d{4}\.\d{4,5}$/.test(p.paper_id)
      ? `${p.paper_id}${p.version}`
      : p.source_url || p.paper_id;
  return `$paper ${reference}`;
}
export function readLocal<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* reading preferences are optional */
  }
}
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (!ok) throw new Error("无法访问剪贴板，请手动选择并复制文本。");
  }
}
