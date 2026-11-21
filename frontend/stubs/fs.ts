/**
 * Browser stand-in for Node's `fs`. XO's state package imports it for its SQLite store, which this tool never opens.
 */
export const existsSync = (): boolean => false;
export const mkdirSync = (): void => {
    throw new Error('fs is not available in the browser.');
};
export const readFileSync = (): never => {
    throw new Error('fs is not available in the browser.');
};
export default { existsSync, mkdirSync, readFileSync };
