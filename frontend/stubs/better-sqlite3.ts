/** Browser stand-in for `better-sqlite3`. XO's state package imports it; this tool never opens a database. */
export default class Database {
    constructor() {
        throw new Error('SQLite is not available in the browser.');
    }
}
