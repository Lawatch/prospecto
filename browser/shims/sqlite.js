// Équivalent navigateur de `node:sqlite` (DatabaseSync) au-dessus de sql.js (SQLite compilé en WebAssembly).
// La base vit en mémoire ; chaque écriture programme un enregistrement dans IndexedDB (voir storage.js).
let SQL = null;
let initialBytes = null;
let onWrite = () => {};

export function configureSqlite({ sqlModule, bytes, onChange }) {
  SQL = sqlModule;
  initialBytes = bytes || null;
  onWrite = onChange || (() => {});
}

const READ_ONLY = /^\s*(SELECT|PRAGMA\s+\w+\s*$|WITH\b(?![\s\S]*\b(INSERT|UPDATE|DELETE)\b))/i;

function bindArgs(stmt, args) {
  if (!args.length) return;
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) && !(args[0] instanceof Uint8Array)) stmt.bind(args[0]);
  else stmt.bind(args);
}

class StatementSync {
  constructor(owner, sql) {
    this.owner = owner;
    this.sql = sql;
  }

  all(...args) {
    const stmt = this.owner.db.prepare(this.sql);
    try {
      bindArgs(stmt, args);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      if (!READ_ONLY.test(this.sql)) onWrite();
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(...args) {
    return this.all(...args)[0];
  }

  run(...args) {
    const stmt = this.owner.db.prepare(this.sql);
    try {
      bindArgs(stmt, args);
      stmt.step();
    } finally {
      stmt.free();
    }
    const changes = this.owner.db.getRowsModified();
    const lastInsertRowid = this.owner.db.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? 0;
    onWrite();
    return { changes, lastInsertRowid };
  }
}

export class DatabaseSync {
  constructor() {
    if (!SQL) throw new Error('SQLite (WebAssembly) non initialisé');
    this.db = new SQL.Database(initialBytes || undefined);
    initialBytes = null;
  }

  exec(sql) {
    this.db.exec(sql);
    if (!READ_ONLY.test(sql)) onWrite();
  }

  prepare(sql) {
    return new StatementSync(this, sql);
  }

  close() {
    this.db.close();
  }

  // Copie binaire complète de la base (sauvegarde, export).
  export() {
    const bytes = this.db.export();
    // sql.js rouvre la base à l'export : les PRAGMA reviennent à leur valeur par défaut.
    this.db.exec('PRAGMA foreign_keys = ON;');
    return bytes;
  }
}
