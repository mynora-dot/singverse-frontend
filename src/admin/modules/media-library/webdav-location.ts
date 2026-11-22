/** Decode the original path once. Keep reserved delimiters and malformed escapes as written. */
export function displayWebDavLocation(value: string): string {
  return value.replace(/^(https?:\/\/[^/?#]*)([^?#]*)/i, (_, origin: string, path: string) =>
    origin + path.replace(/(?:%[89a-f][0-9a-f])+|%[0-7][0-9a-f]/gi, bytes => {
      try {
        const decoded = decodeURIComponent(bytes)
        return bytes.length > 3 || /^[\w .~%-]$/.test(decoded) ? decoded : bytes
      } catch { return bytes }
    }),
  )
}
