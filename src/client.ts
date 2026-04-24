import { getToken, getBaseUrl } from "./config.js";

export type ApiError = { error: string; status: number };
export type ApiResult<T> = { data: T; error: null } | { data: null; error: ApiError };

export async function api<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<ApiResult<T>> {
  const token = getToken();
  const base = getBaseUrl();

  const url = new URL(path, base);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v) url.searchParams.set(k, v);
    }
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return {
      data: null,
      error: { error: `Network error: ${(err as Error).message}`, status: 0 },
    };
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const json = (await response.json()) as { error?: string };
      message = json.error ?? message;
    } catch {}
    return { data: null, error: { error: message, status: response.status } };
  }

  const data = (await response.json()) as T;
  return { data, error: null };
}
