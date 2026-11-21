/** Browser stand-in for Node's `path`. Only XO's SQLite store (never opened here) uses it. */
export const join = (...parts: string[]): string => parts.join('/');
export default { join };
