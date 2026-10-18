const backendUrl = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000").replace(/\/+$/, "");

export type User = {
  id: string;
  email: string | null;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// These answer 401 for a reason a refresh can't fix.
const noRefreshPaths = ["/api/v1/auth/login", "/api/v1/auth/signup", "/api/v1/auth/refresh", "/api/v1/auth/logout"];

let refreshing: Promise<boolean> | null = null;

// Several requests can hit an expired session at once; they share one refresh
// because Supabase refresh tokens are single-use.
const refreshSession = () =>
  (refreshing ??= fetch(`${backendUrl}/api/v1/auth/refresh`, { method: "POST", credentials: "include" })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    }));

// Session tokens live in httpOnly cookies, so every call just includes credentials.
export const apiFetch = async (path: string, init: RequestInit = {}) => {
  const send = () =>
    fetch(`${backendUrl}${path}`, {
      ...init,
      credentials: "include",
      headers: init.body ? { "Content-Type": "application/json", ...init.headers } : init.headers,
    });
  const response = await send();

  if (response.status === 401 && !noRefreshPaths.includes(path) && (await refreshSession())) {
    return send();
  }

  return response;
};

export const apiJson = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await apiFetch(path, init);

  if (!response.ok) {
    const body = await response.json().catch(() => null);

    throw new ApiError(response.status, body?.error?.message ?? `Request failed (${response.status}).`);
  }

  return (response.status === 204 ? undefined : await response.json()) as T;
};

export const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : "The server could not be reached.";
