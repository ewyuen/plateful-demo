import { normalizeCode } from './orderCode'

// The order codes this browser has been given or has looked up, kept in its own storage so
// "Orders on this device" can list them. Only the codes are kept, never on the server, and
// a browser that blocks storage simply remembers nothing (the same care as draftStorage).
export const STORAGE_KEY = 'plateful.orderCodes'
export const MAX_CODES = 20
const VERSION = 1

interface Kept {
  code: string
  savedAt: number
}

function store(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function read(): Kept[] {
  try {
    const raw = store()?.getItem(STORAGE_KEY)
    if (raw === null || raw === undefined) return []
    const value: unknown = JSON.parse(raw)
    if (
      typeof value !== 'object' ||
      value === null ||
      (value as { version?: unknown }).version !== VERSION ||
      !Array.isArray((value as { codes?: unknown }).codes)
    ) {
      return []
    }
    const kept: Kept[] = []
    for (const entry of (value as { codes: unknown[] }).codes) {
      const { code, savedAt } = (entry ?? {}) as { code?: unknown; savedAt?: unknown }
      if (typeof code !== 'string' || normalizeCode(code) !== code || typeof savedAt !== 'number') return []
      kept.push({ code, savedAt })
    }
    return kept
  } catch {
    return []
  }
}

function write(kept: Kept[]) {
  try {
    store()?.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, codes: kept }))
  } catch {
    // Full or blocked: the codes are shown for this visit but not remembered.
  }
}

// The remembered codes, newest first.
export function loadCodes(): string[] {
  return read().map((entry) => entry.code)
}

// Remembers a code (a code already there moves to the front) and answers the new list.
// Only the newest 20 are kept.
export function addCode(code: string, now: number = Date.now()): string[] {
  const normal = normalizeCode(code)
  if (normal === null) return loadCodes()
  const kept = [{ code: normal, savedAt: now }, ...read().filter((entry) => entry.code !== normal)].slice(
    0,
    MAX_CODES,
  )
  write(kept)
  return kept.map((entry) => entry.code)
}

export function removeCode(code: string): string[] {
  const kept = read().filter((entry) => entry.code !== code)
  write(kept)
  return kept.map((entry) => entry.code)
}
