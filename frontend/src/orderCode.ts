// The order code a guest keeps (ADR-0014): 12 characters from the letters A to Z without
// I, L and O and the digits 2 to 9, shown as XXXX-XXXX-XXXX. The server decides what is a
// real code; this only tidies what a person typed or the browser remembered.
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{12}$/

// The stored form of a typed code (no hyphens or spaces, upper case), or null when it
// cannot be one.
export function normalizeCode(text: string): string | null {
  const cleaned = text.toUpperCase().replace(/[\s-]+/g, '')
  return CODE.test(cleaned) ? cleaned : null
}

export function formatCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1-')
}
