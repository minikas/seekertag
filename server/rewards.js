import { createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { deriveRewardAddresses, formatAmount, parseAmount } from '../shared/reward-protocol.mjs';
import { createRewardChain, rewardConfig } from './reward-chain.js';

const timestamp = () => Math.floor(Date.now() / 1000);
const DAY = 86400;
const iso = (seconds) => new Date(Number(seconds) * 1000).toISOString();

export function installRewards({ app, db, get, all, run, transaction, fail, requireOwner, requireFinder, ownerTag, ownerReport, publicTag, limiter, publicOrigin, options = {} }) {
  const schema = `
    CREATE TABLE IF NOT EXISTS rewards (
      id TEXT PRIMARY KEY, tag_id TEXT NOT NULL REFERENCES tags(id), owner_id TEXT NOT NULL REFERENCES users(id),
      wallet TEXT NOT NULL, mint TEXT NOT NULL, program_id TEXT NOT NULL, cluster TEXT NOT NULL, genesis_hash TEXT NOT NULL,
      amount_units TEXT NOT NULL, reference TEXT UNIQUE NOT NULL, address TEXT UNIQUE NOT NULL, vault TEXT NOT NULL,
      expires_at INTEGER NOT NULL, chain_status TEXT NOT NULL CHECK(chain_status IN ('draft','funded','committed','paid','refunded','cancelled')),
      recipient_wallet TEXT, paid_report_id TEXT REFERENCES reports(id), transaction_signature TEXT,
      claim_seq TEXT NOT NULL DEFAULT '0', committed_at INTEGER NOT NULL DEFAULT 0,
      commitment_report_id TEXT REFERENCES reports(id), report_reference TEXT,
      created_at INTEGER NOT NULL, verified_at INTEGER
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS rewards_one_live ON rewards(tag_id) WHERE chain_status IN ('draft','funded','committed');
    CREATE INDEX IF NOT EXISTS rewards_history ON rewards(tag_id,owner_id,created_at);
    CREATE TABLE IF NOT EXISTS reward_intents (
      id TEXT PRIMARY KEY, reward_id TEXT NOT NULL REFERENCES rewards(id), action TEXT NOT NULL CHECK(action IN ('fund','renew','release','refund','commit','waive')),
      target_expiry INTEGER NOT NULL, report_id TEXT REFERENCES reports(id), recipient_wallet TEXT, report_reference TEXT,
      claim_seq TEXT NOT NULL DEFAULT '0', transaction_data TEXT, blockhash TEXT, last_valid_block_height INTEGER,
      status TEXT NOT NULL CHECK(status IN ('building','pending','completed','expired','superseded')), created_at INTEGER NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS rewards_one_intent ON reward_intents(reward_id) WHERE status IN ('building','pending');
    CREATE TABLE IF NOT EXISTS reward_recipients (
      report_id TEXT PRIMARY KEY REFERENCES reports(id), reference TEXT UNIQUE NOT NULL, wallet TEXT, verified_at INTEGER
    ) STRICT;
    CREATE TABLE IF NOT EXISTS reward_wallet_proofs (
      reference TEXT NOT NULL, wallet TEXT NOT NULL, report_id TEXT NOT NULL REFERENCES reports(id),
      verified_at INTEGER NOT NULL, PRIMARY KEY(reference,wallet)
    ) STRICT;
    INSERT OR IGNORE INTO reward_wallet_proofs(reference,wallet,report_id,verified_at)
      SELECT reference,wallet,report_id,verified_at FROM reward_recipients WHERE wallet IS NOT NULL AND verified_at IS NOT NULL;
    CREATE TABLE IF NOT EXISTS reward_challenges (
      nonce TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id), reward_id TEXT NOT NULL REFERENCES rewards(id),
      wallet TEXT NOT NULL, message TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE INDEX IF NOT EXISTS reward_challenges_report ON reward_challenges(report_id,expires_at);
    CREATE TABLE IF NOT EXISTS reward_report_history (
      report_id TEXT PRIMARY KEY REFERENCES reports(id), reward_id TEXT NOT NULL REFERENCES rewards(id)
    ) STRICT;
  `;
  migrateRewardSchema(db, schema);
  db.exec(schema);
  const config = rewardConfig(options.env || process.env);
  // Injecting the RPC client is a programmatic testing facility, never an API input.
  const chain = createRewardChain(config, options.connection);
  const queues = new Map();
  const refreshes = new Map();
  const serialized = async (tagId, work) => {
    const previous = queues.get(tagId) || Promise.resolve();
    let unlock;
    const gate = new Promise((resolve) => { unlock = resolve; });
    const current = previous.catch(() => {}).then(() => gate);
    queues.set(tagId, current);
    await previous.catch(() => {});
    try { return await work(); } finally { unlock(); if (queues.get(tagId) === current) queues.delete(tagId); }
  };
  const latest = (tagId, ownerId) => get("SELECT * FROM rewards WHERE tag_id=? AND owner_id=? AND chain_status!='cancelled' ORDER BY created_at DESC,rowid DESC LIMIT 1", tagId, ownerId);
  const reload = (row) => get('SELECT * FROM rewards WHERE id=?', row.id);
  const pending = (row) => get("SELECT * FROM reward_intents WHERE reward_id=? AND status IN ('building','pending')", row.id);
  const enabled = () => { if (!config.enabled) fail(503, 'A reserva de SKR não está disponível.', 'REWARDS_UNAVAILABLE'); };
  const unavailable = () => fail(503, 'Não foi possível verificar a reserva na rede. Tente novamente.', 'REWARDS_UNAVAILABLE');
  const ready = async () => { enabled(); try { await chain.ready(); } catch { unavailable(); } };
  const wallet = (value) => {
    try { if (typeof value !== 'string' || value.length > 44) throw new Error(); const key = new PublicKey(value); if (!PublicKey.isOnCurve(key.toBytes())) throw new Error(); return key.toBase58(); }
    catch { fail(400, 'Informe uma carteira Solana válida.', 'INVALID_WALLET'); }
  };
  const days = (value) => { if (!Number.isInteger(value) || value < 1 || value > 365) fail(400, 'Escolha entre 1 e 365 dias.', 'INVALID_DURATION'); return value; };
  const amount = (value) => {
    try { if (typeof value !== 'string' || value.length > 30) throw new Error(); const units = parseAmount(value, 6); if (units <= 0n || units > 1_000_000n * 1_000_000n) throw new Error(); return units.toString(); }
    catch { fail(400, 'Use um valor positivo até 1.000.000, com até 6 casas decimais.', 'INVALID_AMOUNT'); }
  };
  const ownerNow = (req, tagId) => {
    if (!get('SELECT hash FROM sessions WHERE hash=? AND expires_at>?', req.sessionHash, Date.now())) fail(401, 'Entre novamente para continuar.', 'UNAUTHORIZED');
    const tag = get('SELECT * FROM tags WHERE id=? AND owner_id=?', tagId, req.user.id);
    if (!tag) fail(404, 'Etiqueta não encontrada.', 'NOT_FOUND');
    return tag;
  };
  const openReport = (report) => {
    const current = get('SELECT * FROM reports WHERE id=?', report.id);
    const tag = get('SELECT * FROM tags WHERE id=?', report.tag_id);
    if (!current || current.status !== 'open') fail(409, 'Esta conversa já foi concluída.', 'REPORT_RESOLVED');
    if (!tag || tag.owner_id !== report.owner_id) fail(409, 'A etiqueta foi transferida.', 'TAG_TRANSFERRED');
    if (tag.status === 'paused') fail(409, 'Reative a etiqueta antes de reservar ou pagar.', 'TAG_PAUSED');
    return current;
  };
  function view(row, statusOverride) {
    if (!row || row.chain_status === 'cancelled') return null;
    const status = statusOverride || (row.chain_status === 'funded' && row.expires_at <= timestamp() ? 'expired' : row.chain_status);
    return { id: row.id, status, amount: formatAmount(BigInt(row.amount_units), 6), assetLabel: row.cluster === 'mainnet-beta' ? 'SKR' : 'Test SKR', cluster: row.cluster, wallet: row.wallet, expiresAt: iso(row.expires_at), address: row.address, claimSeq: row.claim_seq, ...(row.committed_at ? { committedAt: iso(row.committed_at) } : {}), ...(row.report_reference ? { reportRef: row.report_reference } : {}), explorerUrl: row.cluster === 'localnet' ? null : `https://explorer.solana.com/address/${row.address}${row.cluster === 'mainnet-beta' ? '' : '?cluster=devnet'}`, ...(row.recipient_wallet ? { recipientWallet: row.recipient_wallet } : {}), ...(row.transaction_signature ? { transactionSignature: row.transaction_signature } : {}) };
  }
  function event(row, type) {
    const tag = get('SELECT status FROM tags WHERE id=?', row.tag_id);
    run('INSERT INTO tag_events(tag_id,owner_id,type,status,created_at) VALUES(?,?,?,?,?)', row.tag_id, row.owner_id, type, tag.status, new Date().toISOString());
  }
  async function reconcile(row, signature) {
    enabled();
    let inspected;
    let signatureResult;
    try {
      inspected = await chain.inspect(row);
      if (signature !== undefined) signatureResult = await chain.verifySignature(signature, all('SELECT id,transaction_data FROM reward_intents WHERE reward_id=?', row.id).map((intent) => ({ id: intent.id, transaction: intent.transaction_data })));
    } catch { unavailable(); }
    if (signatureResult?.invalid) fail(400, 'A transação não corresponde a esta recompensa.', 'INVALID_TRANSACTION');
    const receipt = inspected.receipt;
    let commitment;
    if (receipt && ['committed', 'paid'].includes(receipt.status)) {
      // Reconcile direct on-chain transactions against this tag's proved wallet.
      commitment = get(`SELECT p.*,r.id AS report_id FROM reward_wallet_proofs p JOIN reports r ON r.id=p.report_id
        WHERE p.reference=? AND p.wallet=? AND p.verified_at IS NOT NULL AND r.tag_id=? AND r.owner_id=?`,
        receipt.reportRef.toString('hex'), receipt.recipient?.toBase58() || '', row.tag_id, row.owner_id);
      if (!commitment) unavailable();
    }
    transaction(() => {
      const old = reload(row);
      if (receipt) {
        if (old.chain_status === 'cancelled' || old.chain_status === 'paid' && receipt.status !== 'paid' || old.chain_status === 'refunded' && receipt.status !== 'refunded' || BigInt(old.expires_at) > receipt.expiresAt || BigInt(old.claim_seq) > receipt.claimSeq) unavailable();
        if (BigInt(old.claim_seq) === receipt.claimSeq) {
          if (['committed', 'paid'].includes(old.chain_status) && ['committed', 'paid'].includes(receipt.status)
              && (old.recipient_wallet !== receipt.recipient?.toBase58() || old.report_reference !== receipt.reportRef.toString('hex') || BigInt(old.committed_at) !== receipt.committedAt)) unavailable();
          if (old.chain_status === 'funded' && ['committed', 'paid'].includes(receipt.status)) unavailable();
        }
        const expiry = Number(receipt.expiresAt);
        if (!Number.isSafeInteger(expiry) || expiry > 8_640_000_000_000) unavailable();
        run('UPDATE rewards SET chain_status=?,expires_at=?,recipient_wallet=?,paid_report_id=?,claim_seq=?,committed_at=?,commitment_report_id=?,report_reference=?,verified_at=? WHERE id=?', receipt.status, expiry, commitment?.wallet || null, receipt.status === 'paid' ? commitment?.report_id : null, receipt.claimSeq.toString(), Number(receipt.committedAt), commitment?.report_id || null, commitment?.reference || null, timestamp(), row.id);
        if (old.chain_status !== receipt.status || old.claim_seq !== receipt.claimSeq.toString() || old.expires_at !== expiry) run('UPDATE rewards SET transaction_signature=NULL WHERE id=?', row.id);
        if (old.chain_status !== receipt.status) event(row, `reward_${receipt.status}`);
        else if (old.expires_at !== expiry) event(row, 'reward_renewed');
      } else run('UPDATE rewards SET verified_at=? WHERE id=?', timestamp(), row.id);
      if (signatureResult?.intentId && receipt) {
        const signedIntent = get('SELECT * FROM reward_intents WHERE id=?', signatureResult.intentId);
        const sameClaim = BigInt(signedIntent.claim_seq) === receipt.claimSeq;
        const matches = signedIntent.report_id === commitment?.report_id && signedIntent.recipient_wallet === commitment?.wallet;
        const isCurrent = receipt.status === 'paid' ? signedIntent.action === 'release' && sameClaim && matches
          : receipt.status === 'committed' ? signedIntent.action === 'commit' && BigInt(signedIntent.claim_seq) + 1n === receipt.claimSeq && matches
          : receipt.status === 'refunded' ? signedIntent.action === 'refund'
          : ['fund', 'renew'].includes(signedIntent.action) || signedIntent.action === 'waive' && sameClaim;
        if (isCurrent) run('UPDATE rewards SET transaction_signature=? WHERE id=?', signature, row.id);
      }
      for (const intent of all("SELECT * FROM reward_intents WHERE reward_id=? AND status IN ('building','pending')", row.id)) {
        const completed = receipt && (intent.action === 'fund'
          || intent.action === 'renew' && receipt.expiresAt >= BigInt(intent.target_expiry)
          || intent.action === 'commit' && receipt.claimSeq > BigInt(intent.claim_seq)
          || intent.action === 'waive' && (receipt.claimSeq > BigInt(intent.claim_seq) || receipt.claimSeq === BigInt(intent.claim_seq) && ['funded', 'refunded'].includes(receipt.status))
          || intent.action === 'release' && receipt.status === 'paid' && receipt.claimSeq === BigInt(intent.claim_seq) && commitment?.report_id === intent.report_id
          || intent.action === 'refund' && receipt.status === 'refunded');
        const superseded = receipt && ['release', 'waive'].includes(intent.action) && (receipt.claimSeq !== BigInt(intent.claim_seq) || ['funded', 'refunded'].includes(receipt.status) || intent.action === 'waive' && receipt.status === 'paid');
        if (superseded && !completed) run("UPDATE reward_intents SET status='superseded' WHERE id=?", intent.id);
        else if (completed) run("UPDATE reward_intents SET status='completed' WHERE id=?", intent.id);
        else if (intent.status === 'pending' && inspected.blockHeight > intent.last_valid_block_height || intent.status === 'building' && intent.created_at + 60 < timestamp()) run("UPDATE reward_intents SET status='expired' WHERE id=?", intent.id);
      }
    });
    return reload(row);
  }
  async function verifiedView(row) {
    if (!row) return null;
    // Public scans share one in-flight refresh. Otherwise unauthenticated scans
    // could fill the mutation queue with slow RPC reads and starve the owner.
    if (refreshes.has(row.id)) return refreshes.get(row.id);
    const refresh = (async () => {
      try { return view(await serialized(row.tag_id, () => reconcile(reload(row)))); } catch (error) { if (error.status === 503) return view(reload(row), 'unavailable'); throw error; }
    })();
    refreshes.set(row.id, refresh);
    try { return await refresh; } finally { if (refreshes.get(row.id) === refresh) refreshes.delete(row.id); }
  }
  function reportReward(report) {
    const historical = get('SELECT reward_id FROM reward_report_history WHERE report_id=?', report.id);
    if (historical) return get('SELECT * FROM rewards WHERE id=?', historical.reward_id);
    if (report.status !== 'open') return null;
    return latest(report.tag_id, report.owner_id);
  }
  const canResolve = (row, report) => !row || row.chain_status === 'refunded' || row.chain_status === 'paid' && row.paid_report_id === report.id;
  async function conversation(report, verifiedReward) {
    const row = reportReward(report);
    const reward = verifiedReward === undefined ? await verifiedView(row) : verifiedReward;
    const current = row && reload(row);
    const proof = current?.commitment_report_id === report.id && ['committed', 'paid'].includes(current.chain_status)
      ? get('SELECT * FROM reward_wallet_proofs WHERE report_id=? AND reference=? AND wallet=?', report.id, current.report_reference, current.recipient_wallet)
      : get('SELECT * FROM reward_recipients WHERE report_id=?', report.id);
    return { reward, commitmentMatchesReport: Boolean(row && reload(row).commitment_report_id === report.id && reward?.status !== 'unavailable'), ...(proof?.wallet ? { recipient: { wallet: proof.wallet, verifiedAt: iso(proof.verified_at), reportRef: proof.reference } } : {}), canResolve: reward?.status !== 'unavailable' && canResolve(row && reload(row), report) };
  }
  const assertFundingWallet = (row, address) => { if (row.wallet !== address) fail(403, 'Conecte a carteira que depositou a recompensa.', 'WRONG_REWARD_WALLET'); };
  const assertNoIntent = (row) => { if (pending(row)) fail(409, 'Há uma transação pendente. Sincronize antes de continuar.', 'REWARD_PENDING'); };
  function prepared(row, intent) {
    return { reward: view(row), transaction: intent.transaction_data, wallet: intent.action === 'waive' ? intent.recipient_wallet : row.wallet, action: intent.action, lastValidBlockHeight: intent.last_valid_block_height, intent: { id: intent.id, rewardId: row.reference, mint: row.mint, programId: row.program_id, amountBaseUnits: row.amount_units, expiresAt: String(intent.target_expiry), claimSeq: intent.claim_seq, ...(intent.recipient_wallet ? { recipientWallet: intent.recipient_wallet, reportRef: intent.report_reference } : {}) } };
  }
  async function build(row, action, { expiry = row.expires_at, report = null, recipient = null } = {}, req) {
    const authorize = () => {
      if (action !== 'waive') ownerNow(req, row.tag_id);
      else if (!req.finderReport || req.finderReport.id !== report?.id || reload(row).commitment_report_id !== report.id || reload(row).recipient_wallet !== recipient?.wallet) fail(403, 'Este compromisso pertence a outra carteira ou conversa.', 'WRONG_REWARD_RECIPIENT');
      if (report) openReport(report);
    };
    authorize();
    let intent = pending(row);
    // A pending owner payout must not prevent the finder from renouncing.
    // The contract resolves the race; its sequence blocks replay after rebind.
    if (action === 'waive' && intent?.action === 'release') {
      run("UPDATE reward_intents SET status='superseded' WHERE id=?", intent.id);
      intent = null;
    }
    if (intent) {
      if (intent.status === 'pending' && intent.action === action && (!['commit', 'release', 'waive'].includes(action) || intent.report_id === report.id && intent.recipient_wallet === recipient.wallet)) return prepared(row, intent);
      fail(409, 'Há uma transação pendente. Sincronize antes de continuar.', 'REWARD_PENDING');
    }
    const id = randomUUID();
    transaction(() => {
      authorize();
      const current = reload(row);
      if (current.chain_status !== row.chain_status || current.expires_at !== row.expires_at || current.claim_seq !== row.claim_seq) fail(409, 'A recompensa mudou. Sincronize novamente.', 'REWARD_CHANGED');
      if (pending(row)) fail(409, 'Há uma transação pendente.', 'REWARD_PENDING');
      run("INSERT INTO reward_intents(id,reward_id,action,target_expiry,report_id,recipient_wallet,report_reference,claim_seq,status,created_at) VALUES(?,?,?,?,?,?,?,?,'building',?)", id, row.id, action, expiry, report?.id || null, recipient?.wallet || null, recipient?.reference || null, row.claim_seq, timestamp());
    });
    intent = get('SELECT * FROM reward_intents WHERE id=?', id);
    let payload;
    try { payload = await chain.prepare(row, intent); }
    catch { run("UPDATE reward_intents SET status='expired' WHERE id=? AND status='building'", id); unavailable(); }
    transaction(() => {
      authorize();
      const updated = run("UPDATE reward_intents SET transaction_data=?,blockhash=?,last_valid_block_height=?,status='pending' WHERE id=? AND status='building'", payload.transaction, payload.blockhash, payload.lastValidBlockHeight, id);
      if (updated.changes !== 1) fail(409, 'Esta preparação expirou. Sincronize novamente.', 'REWARD_PENDING');
    });
    return prepared(reload(row), get('SELECT * FROM reward_intents WHERE id=?', id));
  }
  const ownerLimit = limiter(30, 60_000, (req) => req.user.id);
  const finderLimit = limiter(10, 60_000, (req) => req.finderReport.id);
  const publicLimit = limiter(60, 60_000);
  app.get('/api/rewards/config', publicLimit, async (_req, res) => {
    const result = { enabled: config.enabled, available: config.enabled, cluster: config.cluster, assetLabel: config.assetLabel, mint: config.mint, programId: config.programId };
    if (!config.enabled) result.reason = config.reason;
    else try { await chain.ready(); } catch { result.available = false; result.reason = 'Could not verify the configured network, program and mint.'; }
    res.json(result);
  });
  app.get('/api/tags/:id/reward', requireOwner, async (req, res) => { const tag = ownerTag(req); res.json({ reward: await verifiedView(latest(tag.id, tag.owner_id)) }); });
  app.get('/api/public/tags/:code/reward', publicLimit, async (req, res) => { const tag = publicTag(req.params.code); res.json({ reward: await verifiedView(latest(tag.id, tag.owner_id)) }); });
  app.get('/api/reports/:id/reward', requireOwner, async (req, res) => res.json(await conversation(ownerReport(req))));
  app.get('/api/finder/reports/:id/reward', requireFinder, async (req, res) => res.json(await conversation(req.finderReport)));

  app.post('/api/tags/:id/reward/prepare', requireOwner, ownerLimit, async (req, res) => {
    const tag = ownerTag(req); const address = wallet(req.body.wallet); const units = amount(req.body.amount); const duration = days(req.body.days);
    res.json(await serialized(tag.id, async () => {
      await ready();
      const current = ownerNow(req, tag.id);
      if (current.status === 'paused') fail(409, 'Reative a etiqueta antes de reservar.', 'TAG_PAUSED');
      let row = latest(tag.id, req.user.id);
      if (row) row = await reconcile(row);
      if (row?.chain_status === 'draft') {
        assertFundingWallet(row, address);
        if (row.amount_units !== units) fail(409, 'Cancele a preparação anterior antes de alterar o valor.', 'REWARD_EXISTS');
        if (!pending(row) && row.expires_at <= timestamp()) run('UPDATE rewards SET expires_at=? WHERE id=?', timestamp() + duration * DAY, row.id);
        row = reload(row);
      } else {
        if (['funded', 'committed'].includes(row?.chain_status)) fail(409, 'Esta etiqueta já tem uma recompensa reservada.', 'REWARD_EXISTS');
        if (row?.chain_status === 'paid' && get("SELECT id FROM reports WHERE id=? AND status='open'", row.paid_report_id)) fail(409, 'Confirme a devolução já paga antes de criar outra recompensa.', 'RETURN_PENDING');
        const reference = randomBytes(32).toString('hex');
        const addresses = deriveRewardAddresses(config.programId, address, Buffer.from(reference, 'hex'));
        const id = randomUUID();
        transaction(() => {
          if (ownerNow(req, tag.id).status === 'paused') fail(409, 'Reative a etiqueta antes de reservar.', 'TAG_PAUSED');
          if (get("SELECT id FROM rewards WHERE tag_id=? AND chain_status IN ('draft','funded','committed')", tag.id)) fail(409, 'Esta etiqueta já tem uma preparação ativa.', 'REWARD_EXISTS');
          run("INSERT INTO rewards(id,tag_id,owner_id,wallet,mint,program_id,cluster,genesis_hash,amount_units,reference,address,vault,expires_at,chain_status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?)", id, tag.id, req.user.id, address, config.mint, config.programId, config.cluster, config.genesisHash, units, reference, addresses.reward.toBase58(), addresses.vault.toBase58(), timestamp() + duration * DAY, timestamp());
          event({ id, tag_id: tag.id, owner_id: req.user.id }, 'reward_prepared');
        });
        row = get('SELECT * FROM rewards WHERE id=?', id);
      }
      return build(row, 'fund', {}, req);
    }));
  });
  for (const action of ['renew', 'refund', 'cancel']) app.post(`/api/tags/:id/reward/${action}`, requireOwner, ownerLimit, async (req, res) => {
    const tag = ownerTag(req); const address = wallet(req.body.wallet); const duration = action === 'renew' ? days(req.body.days) : null;
    res.json(await serialized(tag.id, async () => {
      let row = latest(tag.id, req.user.id);
      if (!row) fail(404, 'Recompensa não encontrada.', 'NOT_FOUND');
      assertFundingWallet(row, address);
      row = await reconcile(row);
      ownerNow(req, tag.id);
      if (action === 'cancel') {
        assertNoIntent(row);
        if (row.chain_status !== 'draft') fail(409, 'Um depósito confirmado só pode ser retirado após o prazo.', 'REWARD_EXISTS');
        transaction(() => { assertNoIntent(row); run("UPDATE rewards SET chain_status='cancelled' WHERE id=? AND chain_status='draft'", row.id); event(row, 'reward_cancelled'); });
        return { reward: null };
      }
      if (row.chain_status !== 'funded') fail(409, 'Esta recompensa não tem um depósito ativo.', 'REWARD_NOT_FUNDED');
      if (action === 'refund' && row.expires_at > timestamp()) fail(409, 'O depósito só pode ser retirado após o prazo.', 'REWARD_NOT_EXPIRED');
      const expiry = action === 'renew' ? Math.max(timestamp(), row.expires_at) + duration * DAY : row.expires_at;
      if (expiry > timestamp() + 365 * DAY) fail(400, 'O prazo total não pode ultrapassar 365 dias a partir de agora.', 'INVALID_DURATION');
      return build(row, action, { expiry }, req);
    }));
  });
  for (const action of ['commit', 'release']) app.post(`/api/reports/:id/reward/${action}`, requireOwner, ownerLimit, async (req, res) => {
    const report = ownerReport(req); const address = wallet(req.body.wallet);
    res.json(await serialized(report.tag_id, async () => {
      openReport(report);
      let row = reportReward(report);
      if (!row) fail(404, 'Recompensa não encontrada.', 'NOT_FOUND');
      assertFundingWallet(row, address);
      row = await reconcile(row);
      ownerNow(req, report.tag_id); openReport(report);
      if (action === 'commit') {
        if (row.chain_status !== 'funded') fail(409, 'A recompensa já está comprometida ou encerrada.', 'REWARD_NOT_FUNDED');
        if (row.expires_at <= timestamp()) fail(409, 'Renove a oferta antes de assumir um compromisso.', 'REWARD_EXPIRED');
      } else if (row.chain_status !== 'committed' || row.commitment_report_id !== report.id) fail(409, 'Confirme o compromisso com esta conversa antes de pagar.', 'REWARD_COMMITMENT_REQUIRED');
      const recipient = action === 'commit' ? get('SELECT * FROM reward_recipients WHERE report_id=?', report.id)
        : get('SELECT * FROM reward_wallet_proofs WHERE report_id=? AND reference=? AND wallet=?', report.id, row.report_reference, row.recipient_wallet);
      if (!recipient?.wallet || !recipient.verified_at) fail(409, 'Quem encontrou precisa comprovar sua carteira nesta conversa.', 'RECIPIENT_UNVERIFIED');
      return build(row, action, { report, recipient }, req);
    }));
  });
  app.post('/api/finder/reports/:id/reward/waive', requireFinder, finderLimit, async (req, res) => {
    const report = req.finderReport; const address = wallet(req.body.wallet);
    res.json(await serialized(report.tag_id, async () => {
      openReport(report);
      let row = reportReward(report);
      if (!row) fail(404, 'Recompensa não encontrada.', 'NOT_FOUND');
      row = await reconcile(row); openReport(report);
      if (row.chain_status !== 'committed' || row.commitment_report_id !== report.id || row.recipient_wallet !== address) fail(403, 'Este compromisso pertence a outra carteira ou conversa.', 'WRONG_REWARD_RECIPIENT');
      const recipient = get('SELECT * FROM reward_wallet_proofs WHERE report_id=? AND reference=? AND wallet=?', report.id, row.report_reference, row.recipient_wallet);
      return build(row, 'waive', { report, recipient }, req);
    }));
  });
  app.post('/api/finder/reports/:id/reward/wallet/challenge', requireFinder, finderLimit, async (req, res) => {
    const report = req.finderReport; const address = wallet(req.body.wallet);
    res.json(await serialized(report.tag_id, async () => {
      openReport(report);
      let row = reportReward(report);
      if (!row) fail(404, 'Recompensa não encontrada.', 'NOT_FOUND');
      row = await reconcile(row); openReport(report); assertNoIntent(row);
      if (row.chain_status !== 'funded') fail(409, 'A recompensa precisa estar reservada.', 'REWARD_NOT_FUNDED');
      const nonce = randomBytes(32).toString('base64url'); const expires = timestamp() + 300;
      const message = `SeekerTag finder wallet verification\nDomain: ${publicOrigin}\nReport: ${report.id}\nReward: ${row.address}\nNetwork: ${row.cluster}\nWallet: ${address}\nNonce: ${nonce}\nExpires: ${iso(expires)}\nThis signature proves wallet ownership. It does not transfer tokens.`;
      transaction(() => {
        openReport(report); assertNoIntent(row);
        run('DELETE FROM reward_challenges WHERE expires_at<=? OR (report_id=? AND used=1)', timestamp(), report.id);
        run('UPDATE reward_challenges SET used=1 WHERE report_id=?', report.id);
        run('INSERT INTO reward_challenges(nonce,report_id,reward_id,wallet,message,expires_at) VALUES(?,?,?,?,?,?)', nonce, report.id, row.id, address, message, expires);
      });
      return { message, nonce };
    }));
  });
  app.post('/api/finder/reports/:id/reward/wallet/verify', requireFinder, finderLimit, async (req, res) => {
    const report = req.finderReport; const address = wallet(req.body.wallet);
    if (typeof req.body.nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(req.body.nonce) || typeof req.body.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(req.body.signature)) fail(400, 'Assinatura inválida.', 'INVALID_SIGNATURE');
    res.json(await serialized(report.tag_id, async () => {
      openReport(report);
      let row = reportReward(report);
      if (!row) fail(404, 'Recompensa não encontrada.', 'NOT_FOUND');
      row = await reconcile(row); openReport(report); assertNoIntent(row);
      if (row.chain_status !== 'funded') fail(409, 'A recompensa precisa estar reservada.', 'REWARD_NOT_FUNDED');
      transaction(() => {
        openReport(report); assertNoIntent(row);
        const challenge = get('SELECT * FROM reward_challenges WHERE nonce=? AND report_id=? AND reward_id=? AND wallet=? AND used=0 AND expires_at>?', req.body.nonce, report.id, row.id, address, timestamp());
        if (!challenge) fail(400, 'Esta confirmação expirou ou já foi usada.', 'INVALID_CHALLENGE');
        const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), new PublicKey(address).toBuffer()]), format: 'der', type: 'spki' });
        if (!verify(null, Buffer.from(challenge.message, 'utf8'), publicKey, Buffer.from(req.body.signature, 'base64'))) fail(400, 'Assinatura inválida.', 'INVALID_SIGNATURE');
        const updated = run('UPDATE reward_challenges SET used=1 WHERE nonce=? AND used=0', challenge.nonce);
        if (updated.changes !== 1) fail(400, 'Esta confirmação já foi usada.', 'INVALID_CHALLENGE');
        const reference = randomBytes(32).toString('hex');
        run('INSERT INTO reward_wallet_proofs(reference,wallet,report_id,verified_at) VALUES(?,?,?,?)', reference, address, report.id, timestamp());
        run('INSERT INTO reward_recipients(report_id,reference,wallet,verified_at) VALUES(?,?,?,?) ON CONFLICT(report_id) DO UPDATE SET reference=excluded.reference,wallet=excluded.wallet,verified_at=excluded.verified_at', report.id, reference, address, timestamp());
      });
      return { recipient: { wallet: address, verifiedAt: iso(timestamp()) } };
    }));
  });
  const sync = async (row, signature) => ({ reward: row ? view(await serialized(row.tag_id, () => reconcile(reload(row), signature))) : null });
  app.post('/api/tags/:id/reward/sync', requireOwner, ownerLimit, async (req, res) => { const tag = ownerTag(req); res.json(await sync(latest(tag.id, tag.owner_id), req.body.signature)); });
  app.post('/api/reports/:id/reward/sync', requireOwner, ownerLimit, async (req, res) => { const report = ownerReport(req); const result = await sync(reportReward(report), req.body.signature); res.json(await conversation(report, result.reward)); });
  app.post('/api/finder/reports/:id/reward/sync', requireFinder, finderLimit, async (req, res) => { const report = req.finderReport; const result = await sync(reportReward(report), req.body.signature); res.json(await conversation(report, result.reward)); });

  return {
    assertTagMutable(tag, values) {
      if (!get("SELECT id FROM rewards WHERE tag_id=? AND chain_status IN ('draft','funded','committed')", tag.id)) return;
      if (!values || values.rewardAmount !== tag.reward_amount || values.rewardCurrency !== tag.reward_currency || values.status === 'paused') fail(409, 'Conclua ou retire a recompensa antes de transferir, pausar ou alterar o prêmio.', 'REWARD_LOCKED');
    },
    async assertResolve(report) {
      const row = reportReward(report);
      if (!row) return;
      const current = await serialized(row.tag_id, () => reconcile(reload(row)));
      if (!canResolve(current, report)) fail(409, 'Confirme o pagamento desta conversa antes de concluir a devolução.', 'REWARD_PAYMENT_REQUIRED');
    },
    recordResolution(report) {
      const row = latest(report.tag_id, report.owner_id);
      if (!canResolve(row, report)) fail(409, 'Confirme o pagamento desta conversa antes de concluir a devolução.', 'REWARD_PAYMENT_REQUIRED');
      if (row) for (const open of all("SELECT id FROM reports WHERE tag_id=? AND owner_id=? AND status='open'", report.tag_id, report.owner_id)) run('INSERT OR IGNORE INTO reward_report_history(report_id,reward_id) VALUES(?,?)', open.id, row.id);
    },
  };
}

function migrateRewardSchema(db, schema) {
  const old = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='rewards'").get();
  if (!old || old.sql.includes("'committed'")) return;
  const tables = ['rewards', 'reward_intents'];
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    for (const name of tables) {
      const start = schema.indexOf(`CREATE TABLE IF NOT EXISTS ${name} (`);
      const end = schema.indexOf(') STRICT;', start) + ') STRICT;'.length;
      db.exec(schema.slice(start, end).replace(`IF NOT EXISTS ${name}`, `${name}_v2`));
      const columns = db.prepare(`PRAGMA table_info(${name})`).all().map(row => row.name).join(',');
      db.exec(`INSERT INTO ${name}_v2 (${columns}) SELECT ${columns} FROM ${name}`);
    }
    db.exec('DROP TABLE reward_intents; DROP TABLE rewards; ALTER TABLE rewards_v2 RENAME TO rewards; ALTER TABLE reward_intents_v2 RENAME TO reward_intents;');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Reward migration violated a foreign key');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.exec('PRAGMA foreign_keys=ON'); }
}
