import { randomUUID } from 'node:crypto';

const presets = [
  ['backpack', 'Mochila', 'shopping-bag', '#304441'], ['luggage', 'Mala', 'briefcase', '#34434B'],
  ['keys', 'Chaves', 'key', '#404A44'], ['pet', 'Pet', 'heart', '#3E4144'],
  ['electronics', 'Eletrônico', 'headphones', '#30454A'], ['other', 'Outro', 'box', '#414B4A'],
];
const icons = new Set(['shopping-bag', 'briefcase', 'key', 'heart', 'headphones', 'box', 'smartphone', 'watch', 'book', 'camera', 'credit-card', 'umbrella', 'truck', 'home', 'coffee', 'tag']);
const normalized = name => name.normalize('NFKC').trim().toLocaleLowerCase('pt-BR');

export function createCategories({ db, get, all, run, transaction, fail }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
      normalized_name TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL,
      default_key TEXT, created_at TEXT NOT NULL, UNIQUE(owner_id, normalized_name)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS category_accounts (owner_id TEXT PRIMARY KEY REFERENCES users(id)) STRICT;
  `);
  if (!all('PRAGMA table_info(tags)').some(column => column.name === 'category_id')) {
    db.exec('ALTER TABLE tags ADD COLUMN category_id TEXT REFERENCES categories(id)');
  }
  db.exec('CREATE INDEX IF NOT EXISTS tags_category ON tags(category_id)');

  function insert(owner, name, icon, color, defaultKey = null) {
    const id = randomUUID();
    run('INSERT INTO categories(id,owner_id,name,normalized_name,icon,color,default_key,created_at) VALUES(?,?,?,?,?,?,?,?)', id, owner, name, normalized(name), icon, color, defaultKey, new Date().toISOString());
    return get('SELECT * FROM categories WHERE id=?', id);
  }
  function ensure(owner) {
    if (get('SELECT owner_id FROM category_accounts WHERE owner_id=?', owner)) return;
    for (const [key, name, icon, color] of presets) {
      if (!get('SELECT id FROM categories WHERE owner_id=? AND normalized_name=?', owner, normalized(name))) insert(owner, name, icon, color, key);
    }
    run('INSERT INTO category_accounts(owner_id) VALUES(?)', owner);
  }
  function legacy(owner, name, color) {
    ensure(owner);
    const match = get('SELECT * FROM categories WHERE owner_id=? AND normalized_name=?', owner, normalized(name));
    if (match) return match;
    if (name === 'other') {
      const other = get("SELECT * FROM categories WHERE owner_id=? AND default_key='other'", owner);
      if (other) return other;
    }
    return insert(owner, name, 'box', /^#[0-9a-f]{6}$/i.test(color) ? color : '#414B4A');
  }
  // Preserve existing category text/color and attach stable, account-owned IDs.
  transaction(() => {
    for (const user of all('SELECT id FROM users')) ensure(user.id);
    for (const tag of all('SELECT * FROM tags WHERE category_id IS NULL')) {
      run('UPDATE tags SET category_id=? WHERE id=?', legacy(tag.owner_id, tag.category, tag.color).id, tag.id);
    }
  });
  function owned(id, owner) {
    if (typeof id !== 'string') fail(400, 'Escolha uma categoria.', 'CATEGORY_REQUIRED');
    const row = get('SELECT * FROM categories WHERE id=? AND owner_id=?', id, owner);
    if (!row) fail(404, 'Categoria não encontrada.', 'CATEGORY_NOT_FOUND');
    return row;
  }
  function view(row) {
    return { id: row.id, name: row.name, icon: row.icon, color: row.color, defaultKey: row.default_key,
      tagCount: get('SELECT COUNT(*) AS n FROM tags WHERE category_id=? AND owner_id=?', row.id, row.owner_id).n };
  }
  function validate(body, previous) {
    const name = (body.name ?? previous?.name);
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 32 || /[\x00-\x1f\x7f]/.test(name)) fail(400, 'Use um nome de categoria entre 1 e 32 caracteres.', 'CATEGORY_NAME_INVALID');
    const icon = body.icon ?? previous?.icon ?? 'tag';
    const color = body.color ?? previous?.color ?? '#304441';
    if (!icons.has(icon)) fail(400, 'Escolha um ícone válido.', 'CATEGORY_ICON_INVALID');
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) fail(400, 'Escolha uma cor válida.', 'CATEGORY_COLOR_INVALID');
    return { name: name.trim(), icon, color };
  }
  function capacity(owner) {
    if (get('SELECT COUNT(*) AS n FROM categories WHERE owner_id=?', owner).n >= 50) fail(409, 'Você atingiu o limite de 50 categorias.', 'CATEGORY_LIMIT');
  }
  return {
    ensure,
    forTag(owner, body, values, previous) {
      ensure(owner);
      if (body.categoryId !== undefined) {
        const row = owned(body.categoryId, owner);
        values.category = row.name; values.color = row.color;
        return row.id;
      }
      if (previous?.category_id && body.category === undefined) return previous.category_id;
      const existing = get('SELECT id FROM categories WHERE owner_id=? AND normalized_name=?', owner, normalized(values.category));
      const defaultOther = values.category === 'other' && get("SELECT id FROM categories WHERE owner_id=? AND default_key='other'", owner);
      if (!existing && !defaultOther) capacity(owner);
      return legacy(owner, values.category, values.color).id;
    },
    metadata(id) {
      const row = id && get('SELECT icon,default_key FROM categories WHERE id=?', id);
      return { categoryId: id || null, categoryIcon: row?.icon || 'box', categoryDefaultKey: row?.default_key || null };
    },
    transfer(tag, recipient) {
      ensure(recipient);
      const source = tag.category_id && get('SELECT * FROM categories WHERE id=?', tag.category_id);
      const match = source?.default_key && get('SELECT * FROM categories WHERE owner_id=? AND default_key=?', recipient, source.default_key)
        || get('SELECT * FROM categories WHERE owner_id=? AND normalized_name=?', recipient, normalized(source?.name || tag.category));
      if (match) return match;
      capacity(recipient);
      return insert(recipient, source?.name || tag.category, source?.icon || 'box', source?.color || '#414B4A', source?.default_key || null);
    },
    install(app, requireOwner, writeLimit) {
      app.get('/api/categories', requireOwner, (req, res) => {
        transaction(() => ensure(req.user.id));
        res.json({ categories: all('SELECT * FROM categories WHERE owner_id=? ORDER BY created_at,rowid', req.user.id).map(view) });
      });
      app.post('/api/categories', requireOwner, writeLimit, (req, res) => {
        const v = validate(req.body);
        const row = transaction(() => {
          ensure(req.user.id); capacity(req.user.id);
          if (get('SELECT id FROM categories WHERE owner_id=? AND normalized_name=?', req.user.id, normalized(v.name))) fail(409, 'Já existe uma categoria com esse nome.', 'CATEGORY_EXISTS');
          return insert(req.user.id, v.name, v.icon, v.color);
        });
        res.status(201).json({ category: view(row) });
      });
      app.patch('/api/categories/:id', requireOwner, writeLimit, (req, res) => {
        const previous = owned(req.params.id, req.user.id);
        const v = validate(req.body, previous);
        transaction(() => {
          if (get('SELECT id FROM categories WHERE owner_id=? AND normalized_name=? AND id<>?', req.user.id, normalized(v.name), previous.id)) fail(409, 'Já existe uma categoria com esse nome.', 'CATEGORY_EXISTS');
          // A renamed preset becomes user content and is no longer translated.
          run('UPDATE categories SET name=?,normalized_name=?,icon=?,color=?,default_key=? WHERE id=?', v.name, normalized(v.name), v.icon, v.color, v.name === previous.name ? previous.default_key : null, previous.id);
          run('UPDATE tags SET category=?,color=?,updated_at=? WHERE category_id=? AND owner_id=?', v.name, v.color, new Date().toISOString(), previous.id, req.user.id);
        });
        res.json({ category: view(owned(previous.id, req.user.id)) });
      });
      app.delete('/api/categories/:id', requireOwner, writeLimit, (req, res) => {
        const row = owned(req.params.id, req.user.id);
        transaction(() => {
          if (view(row).tagCount) {
            if (!req.body.replacementId) fail(409, 'Escolha outra categoria para os objetos antes de excluir.', 'CATEGORY_IN_USE');
            const replacement = owned(req.body.replacementId, req.user.id);
            if (replacement.id === row.id) fail(400, 'Escolha uma categoria diferente.', 'CATEGORY_REPLACEMENT_INVALID');
            run('UPDATE tags SET category_id=?,category=?,color=?,updated_at=? WHERE category_id=? AND owner_id=?', replacement.id, replacement.name, replacement.color, new Date().toISOString(), row.id, req.user.id);
          }
          run('DELETE FROM categories WHERE id=? AND owner_id=?', row.id, req.user.id);
        });
        res.status(204).end();
      });
    },
  };
}
