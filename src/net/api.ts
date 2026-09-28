import { auth } from '../firebase/firebase';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  readonly status: number;
  readonly retryAfter: number | null;

  constructor(status: number, message: string, retryAfter: number | null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, 'Not signed in', null);
  const response = await fetch(`${API_BASE}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { error?: string } | null;
    const retryAfter = Number(response.headers.get('Retry-After'));
    throw new ApiError(response.status, error?.error ?? response.statusText, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
  }
  return response.json() as Promise<T>;
}

const RETRIES = 3;

export async function withRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 429 || attempt >= RETRIES) throw err;
      await new Promise((resolve) => setTimeout(resolve, (err.retryAfter ?? 2) * 1000));
    }
  }
}
