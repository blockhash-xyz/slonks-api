export const DEFAULT_API = "https://api.slonks.xyz";

export function normalizeApiUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const detail = body.trim() ? `: ${body.trim().slice(0, 240)}` : "";
    throw new Error(`fetch ${url}: ${res.status} ${res.statusText}${detail}`);
  }
  return (await res.json()) as T;
}

export function logStatus(json: boolean, message: string): void {
  if (json) console.error(message);
  else console.log(message);
}

export function requireValue(name: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

export function parsePositiveInt(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function parseNonNegativeInt(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

export function parseNonNegativeNumber(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

export function parseRatio(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
  return value;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
