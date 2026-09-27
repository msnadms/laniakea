export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function seedParam(value: unknown, name: string): number {
  const seed = typeof value === 'string' ? Number(value) : value;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new HttpError(400, `${name} must be an unsigned 32-bit integer`);
  }
  return seed;
}

export function finiteParam(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new HttpError(400, `${name} must be a finite number`);
  return value;
}
