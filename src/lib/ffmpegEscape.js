/**
 * Escapes a filesystem path for safe use INSIDE an ffmpeg filter_complex
 * string (e.g. as the value of fontfile= or textfile=). ffmpeg's filter
 * parser treats ':' as an option separator and '\' as an escape char, so
 * both need escaping here — this matters especially for Windows paths
 * like C:\Users\... which are common if this ever runs outside VSCode's
 * WSL/Linux shell.
 */
export function escapePathForFilter(p) {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}
