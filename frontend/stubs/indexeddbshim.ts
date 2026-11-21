/** Browser stand-in for `indexeddbshim`, which XO's state package only uses to emulate IndexedDB in Node. */
export default function setGlobalVars(): void {
    throw new Error('indexeddbshim is not available in the browser.');
}
