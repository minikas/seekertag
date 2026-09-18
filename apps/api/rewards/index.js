import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { verifySignIn } from '@solana/wallet-standard-util';
import bs58 from 'bs58';
import { amountToUnits, unitsToAmount, rewardDuration, MAX_REWARD_SECONDS } from '@seekertag/shared/reward';
import { escrowAddress } from '@seekertag/shared/escrow-wire';
import { RewardChainError } from './chain.js';
import { createPriceFeed } from './prices.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const activeStatuses = ['pending', 'reserved'];

export function createRewards({ db, get, all, run, transaction, fail, chain, publicOrigin, ownerTag, ownerReport, requireOwner, requireFinder, writeLimit }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rewards (
      id TEXT PRIMARY KEY, tag_id TEXT NOT NULL REFERENCES tags(id), owner_id TEXT NOT NULL REFERENCES users(id),
      payer TEXT NOT NULL, verifier TEXT NOT NULL, treasury TEXT NOT NULL, fee_bps INTEGER NOT NULL, network TEXT NOT NULL, seed TEXT UNIQUE NOT NULL,
      escrow TEXT UNIQUE NOT NULL, currency TEXT NOT NULL, mint TEXT, decimals INTEGER NOT NULL, amount_units TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','reserved','released','refunded','abandoned')),
      refund_after INTEGER, created_at TEXT NOT NULL, checked_at TEXT, deposit_signature TEXT, settlement_signature TEXT,
      release_report_id TEXT REFERENCES reports(id), release_wallet TEXT
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_reward ON rewards(tag_id) WHERE status IN ('pending','reserved');
    CREATE INDEX IF NOT EXISTS rewards_owner_tag ON rewards(tag_id,owner_id,created_at);
    CREATE TABLE IF NOT EXISTS reward_operations (
      id TEXT PRIMARY KEY, reward_id TEXT NOT NULL REFERENCES rewards(id), kind TEXT NOT NULL,
      spec TEXT NOT NULL, unsigned_tx TEXT NOT NULL, fee_lamports TEXT NOT NULL, rent_lamports TEXT NOT NULL,
      last_valid_height INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('prepared','submitted','confirmed','failed','expired')),
      signed_tx TEXT, signature TEXT UNIQUE, created_at TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS one_reward_operation ON reward_operations(reward_id) WHERE status IN ('prepared','submitted');
    CREATE TABLE IF NOT EXISTS finder_reward_wallets (
      report_id TEXT PRIMARY KEY REFERENCES reports(id), address TEXT NOT NULL, verified_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS finder_wallet_challenges (
      id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id), payload TEXT NOT NULL, expires_at INTEGER NOT NULL
    ) STRICT;
  `);
  const rewardColumns = new Set(all('PRAGMA table_info(rewards)').map(column => column.name));
  if (!rewardColumns.has('treasury')) run('ALTER TABLE rewards ADD COLUMN treasury TEXT');
  if (!rewardColumns.has('fee_bps')) run('ALTER TABLE rewards ADD COLUMN fee_bps INTEGER');
  const current = tag => get("SELECT * FROM rewards WHERE tag_id=? AND owner_id=? AND status!='abandoned' ORDER BY created_at DESC,rowid DESC LIMIT 1", tag.id, tag.owner_id);
  const inflight = reward => get("SELECT * FROM reward_operations WHERE reward_id=? AND status IN ('prepared','submitted')", reward.id);
  const broadcasts = new Map();
  async function broadcast(op) {
    if (op.status !== 'submitted' || !op.signed_tx) return;
    const previous = broadcasts.get(op.id);
    if (previous?.busy || previous && Date.now() - previous.at < 5_000) return;
    const attempt = { at: Date.now(), busy: true }; broadcasts.set(op.id, attempt);
    try { await chain.send(op.signed_tx); }
    catch { /* A timeout is ambiguous. Keep the lock and reconcile before retrying. */ }
    finally { attempt.busy = false; }
  }
  function configured() { if (!chain) fail(503, 'Os depósitos de recompensa ainda não estão disponíveis.', 'REWARD_UNAVAILABLE'); return chain; }
  const route = fn => async (req, res) => { try { await fn(req, res); } catch (error) { if (error instanceof RewardChainError) fail(409, error.message, 'REWARD_CHAIN_ERROR'); throw error; } };
  function payer(userId) {
    const address = get("SELECT subject FROM auth_identities WHERE user_id=? AND provider='solana'", userId)?.subject;
    if (!address) fail(409, 'Vincule sua carteira Solana em Minha conta para financiar uma recompensa.', 'WALLET_REQUIRED');
    return address;
  }
  function assertTagOwner(tag) {
    if (!get('SELECT id FROM tags WHERE id=? AND owner_id=?', tag.id, tag.owner_id)) fail(409, 'A etiqueta mudou de dono. Abra o objeto novamente.', 'TAG_TRANSFERRED');
  }
  function assertSession(req) {
    if (!get('SELECT hash FROM sessions WHERE hash=? AND user_id=? AND expires_at>?', req.sessionHash, req.user.id, Date.now())) fail(401, 'Sua sessão expirou. Entre novamente.', 'UNAUTHORIZED');
  }
  function view(reward, verified = false) {
    if (!reward || reward.status === 'abandoned') return null;
    let status = reward.status;
    if (status === 'reserved' && reward.refund_after * 1000 <= Date.now()) status = 'expired';
    if (activeStatuses.includes(reward.status) && reward.checked_at && !verified && Date.now() - Date.parse(reward.checked_at) > 60_000) status = 'unverified';
    const op = inflight(reward);
    return { id: reward.id, status, currency: reward.currency, amount: unitsToAmount(reward.amount_units, reward.decimals), amountUnits: reward.amount_units,
      network: reward.network, escrow: reward.escrow, refundAfter: reward.refund_after ? new Date(reward.refund_after * 1000).toISOString() : null,
      checkedAt: reward.checked_at, signature: reward.settlement_signature || reward.deposit_signature,
      operation: op ? { id: op.id, kind: op.kind, status: op.status } : null };
  }
  function settleReport(reward, reportId) {
    const report = get('SELECT * FROM reports WHERE id=? AND tag_id=? AND owner_id=?', reportId, reward.tag_id, reward.owner_id);
    if (!report || report.status !== 'open') return;
    const at = now();
    run("UPDATE reports SET status='resolved',updated_at=? WHERE tag_id=? AND owner_id=? AND status='open'", at, reward.tag_id, reward.owner_id);
    run("UPDATE tags SET status='active',updated_at=?,returned_at=?,recovery_count=recovery_count+1 WHERE id=? AND owner_id=?", at, at, reward.tag_id, reward.owner_id);
    run("INSERT INTO tag_events(tag_id,owner_id,type,status,created_at) VALUES(?,?,'returned','active',?)", reward.tag_id, reward.owner_id, at);
  }
  async function refresh(reward) {
    if (!reward || !activeStatuses.includes(reward.status)) return reward;
    configured();
    if (reward.network !== chain.config.network) throw new RewardChainError('Esta reserva pertence a outra rede.');
    let state = await chain.read(reward);
    const operation = inflight(reward);
    let operationStatus;
    let seenOnChain = false;
    if (operation?.signature) {
      const receipt = await chain.signatureState(operation.signature);
      seenOnChain = !!receipt;
      if (receipt?.confirmationStatus === 'finalized') operationStatus = receipt.err ? 'failed' : 'confirmed';
    }
    function reflected() {
      if (!operation || !state) return false;
      const spec = JSON.parse(operation.spec);
      return operation.kind === 'fund' || (operation.kind === 'release' && state.status === 2 && state.reportHash === spec.reportHash && state.recipient === spec.recipient) || (operation.kind === 'refund' && state.status === 3) || (operation.kind === 'renew' && state.refundAfter >= spec.previousRefundAfter + rewardDuration(spec));
    }
    if (!operationStatus && reflected()) operationStatus = 'confirmed';
    if (operation && !operationStatus) {
      const finality = await chain.finality();
      if (finality.height > operation.last_valid_height) {
        // A transaction can finalize between the first account read and this
        // height check. Re-read at that finalized slot before abandoning it.
        state = await chain.read(reward, finality.slot);
        operationStatus = reflected() ? 'confirmed' : 'expired';
      }
    }
    transaction(() => {
      const live = get('SELECT * FROM rewards WHERE id=?', reward.id);
      if (!activeStatuses.includes(live.status)) return;
      if (state) {
        if (state.status === 2) {
          // Only a co-signed release prepared for this exact verified report can settle a return.
          if (!live.release_report_id || state.reportHash !== hash(live.release_report_id) || state.recipient !== live.release_wallet) fail(409, 'A liberação não corresponde a esta conversa.', 'REWARD_MISMATCH');
          run("UPDATE rewards SET status='released',refund_after=?,checked_at=? WHERE id=?", state.refundAfter, now(), live.id);
          settleReport(live, live.release_report_id);
        } else run('UPDATE rewards SET status=?,refund_after=MAX(COALESCE(refund_after,0),?),checked_at=? WHERE id=?', state.status === 3 ? 'refunded' : 'reserved', state.refundAfter, now(), live.id);
      }
      if (operation && operationStatus) {
        run("UPDATE reward_operations SET status=? WHERE id=? AND status IN ('prepared','submitted')", operationStatus, operation.id);
        if (operationStatus === 'confirmed' && operation.signature) run(`UPDATE rewards SET ${operation.kind === 'fund' ? 'deposit_signature' : 'settlement_signature'}=? WHERE id=?`, operation.signature, live.id);
        if (!state && live.status === 'pending' && ['failed', 'expired'].includes(operationStatus)) run("UPDATE rewards SET status='abandoned' WHERE id=?", live.id);
      }
    });
    if (operationStatus) broadcasts.delete(operation.id);
    else if (operation?.status === 'submitted' && !seenOnChain) {
      // Reads from either the editor or object details keep a dropped send alive.
      // Only resend the original signature, after verifying it has not expired.
      await broadcast(get('SELECT * FROM reward_operations WHERE id=?', operation.id));
    }
    return get('SELECT * FROM rewards WHERE id=?', reward.id);
  }
  function operationView(op) {
    const reward = get('SELECT * FROM rewards WHERE id=?', op.reward_id);
    return { id: op.id, rewardId: reward.id, currency: reward.currency, network: reward.network, spec: JSON.parse(op.spec), transaction: op.unsigned_tx,
      feeLamports: op.fee_lamports, rentLamports: op.rent_lamports, lastValidBlockHeight: op.last_valid_height };
  }
  function ownerOperation(req) {
    const op = get('SELECT reward_operations.* FROM reward_operations JOIN rewards ON rewards.id=reward_operations.reward_id WHERE reward_operations.id=? AND rewards.owner_id=?', req.params.operationId, req.user.id);
    if (!op) fail(404, 'Operação de recompensa não encontrada.', 'NOT_FOUND');
    return op;
  }
  async function getState(tag) {
    const saved = current(tag);
    if (!saved) return null;
    try { return view(await refresh(saved), true); }
    catch (error) {
      if (!activeStatuses.includes(saved.status)) throw error;
      return { ...view(saved), status: 'unverified' };
    }
  }
  function assertUnlocked(tagId) {
    if (get("SELECT id FROM rewards WHERE tag_id=? AND status IN ('pending','reserved')", tagId)) fail(409, 'Libere ou cancele a reserva antes de alterar a recompensa ou transferir a etiqueta.', 'REWARD_LOCKED');
  }
  function assertEditable(tagId) {
    // Keep this synchronous and inside the tag write transaction. A stale client
    // or unavailable RPC must not unlock an operation already sent for signing.
    if (get("SELECT o.id FROM reward_operations o JOIN rewards r ON r.id=o.reward_id WHERE r.tag_id=? AND o.status='submitted'", tagId)) {
      fail(409, 'Aguarde a confirmação da transação para editar este objeto.', 'REWARD_PENDING');
    }
  }
  const prices = createPriceFeed();
  function install(app) {
    app.get('/api/rewards/prices', requireOwner, async (_req, res) => {
      try { res.json(await prices()); }
      catch { res.status(503).json({ error: 'Cotação indisponível. Tente atualizar.', code: 'PRICE_UNAVAILABLE' }); }
    });
    app.get('/api/rewards/config', requireOwner, (req, res) => {
      res.json({ reward: null, config: chain?.config || null, payer: get("SELECT subject FROM auth_identities WHERE user_id=? AND provider='solana'", req.user.id)?.subject || null });
    });
    app.get('/api/rewards/balance', requireOwner, route(async (req, res) => {
      configured(); res.json(await chain.balance(payer(req.user.id), req.query.currency || 'SOL'));
    }));
    app.get('/api/tags/:id/reward', requireOwner, route(async (req, res) => {
      const tag = ownerTag(req);
      res.json({ reward: await getState(tag), config: chain?.config || null, payer: get("SELECT subject FROM auth_identities WHERE user_id=? AND provider='solana'", req.user.id)?.subject || null });
    }));
    app.get('/api/tags/:id/reward/balance', requireOwner, route(async (req, res) => {
      ownerTag(req); configured();
      res.json(await chain.balance(payer(req.user.id), req.query.currency || 'SOL'));
    }));
    app.post('/api/tags/:id/reward/prepare', requireOwner, writeLimit, route(async (req, res) => {
      const tag = ownerTag(req); configured(); const wallet = payer(req.user.id);
      const kind = req.body.kind;
      if (!['fund', 'renew', 'release', 'refund'].includes(kind)) fail(400, 'Operação de recompensa inválida.');
      let reward = await refresh(current(tag));
      if (reward && inflight(reward)) fail(409, 'Uma transação está em andamento. Aguarde a confirmação ou retome o pedido.', 'REWARD_PENDING');
      if (['fund', 'renew'].includes(kind)) {
        try { rewardDuration(req.body); } catch { fail(400, 'Prazo inválido. Escolha de 1 hora a 5 anos.'); }
      }
      if (kind === 'fund') {
        if (reward && activeStatuses.includes(reward.status)) fail(409, 'Este objeto já tem uma reserva.', 'REWARD_LOCKED');
        const asset = chain.asset(req.body.currency);
        let units;
        try { units = amountToUnits(req.body.amount, asset.decimals).toString(); } catch { fail(400, 'Valor de recompensa inválido.'); }
        const seed = randomBytes(32).toString('hex');
        reward = { id: randomUUID(), tag_id: tag.id, owner_id: req.user.id, payer: wallet, verifier: chain.config.verifier, treasury: chain.config.treasury, fee_bps: chain.config.feeBps, network: chain.config.network, seed,
          escrow: escrowAddress(wallet, seed).toBase58(), currency: asset.currency, mint: asset.mint, decimals: asset.decimals, amount_units: units, status: 'pending' };
      } else if (!reward || reward.status !== 'reserved') fail(409, 'Não há uma reserva disponível para esta ação.', 'REWARD_NOT_RESERVED');
      if (wallet !== reward.payer) fail(409, 'Use a carteira que fez o depósito.', 'REWARD_WALLET_MISMATCH');
      const spec = { kind, payer: reward.payer, verifier: reward.verifier, treasury: reward.treasury, feeBps: reward.fee_bps, rewardId: reward.seed, mint: reward.mint, amountUnits: reward.amount_units, computeBudget: 'fixed-v2' };
      if (['fund', 'renew'].includes(kind)) {
        if (req.body.durationSeconds !== undefined) spec.durationSeconds = req.body.durationSeconds;
        else spec.days = req.body.days;
      }
      if (kind === 'renew') spec.previousRefundAfter = reward.refund_after;
      const networkTime = ['renew', 'refund'].includes(kind) ? await chain.clock() : null;
      if (kind === 'renew' && Math.max(reward.refund_after, networkTime) + rewardDuration(spec) > networkTime + (spec.durationSeconds !== undefined ? MAX_REWARD_SECONDS : 365 * 86_400)) fail(400, 'A renovação não pode ultrapassar 5 anos a partir de hoje.');
      if (kind === 'refund' && reward.refund_after > networkTime) fail(409, 'A reserva só pode ser cancelada após o vencimento.', 'REWARD_LOCKED');
      if (kind === 'release') {
        if (typeof req.body.reportId !== 'string' || req.body.reportId.length > 80) fail(400, 'Conversa inválida.');
        const report = get("SELECT * FROM reports WHERE id=? AND tag_id=? AND owner_id=? AND status='open'", req.body.reportId, tag.id, req.user.id);
        const finder = report && get('SELECT address FROM finder_reward_wallets WHERE report_id=?', report.id);
        if (!finder || finder.address === wallet) fail(409, 'Quem encontrou precisa confirmar a carteira de recebimento na conversa.', 'FINDER_WALLET_REQUIRED');
        spec.recipient = finder.address; spec.reportHash = hash(report.id);
      }
      const [balance, prepared] = await Promise.all([chain.balance(wallet, reward.currency), chain.prepare(spec)]);
      const solNeeded = BigInt(prepared.feeLamports) + BigInt(prepared.rentLamports) + (kind === 'fund' && !reward.mint ? BigInt(reward.amount_units) : 0n);
      if (BigInt(balance.solLamports) < solNeeded || (kind === 'fund' && BigInt(balance.availableUnits) < BigInt(reward.amount_units))) fail(409, 'Saldo insuficiente para a recompensa e as taxas da rede.', 'INSUFFICIENT_BALANCE');
      const id = randomUUID();
      transaction(() => {
        assertSession(req); assertTagOwner(tag);
        if (kind === 'fund') {
          assertUnlocked(tag.id);
          run("INSERT INTO rewards(id,tag_id,owner_id,payer,verifier,treasury,fee_bps,network,seed,escrow,currency,mint,decimals,amount_units,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending',?)", reward.id, tag.id, req.user.id, wallet, reward.verifier, reward.treasury, reward.fee_bps, reward.network, reward.seed, reward.escrow, reward.currency, reward.mint, reward.decimals, reward.amount_units, now());
          run('UPDATE tags SET reward_amount=?,reward_currency=? WHERE id=?', Number(unitsToAmount(reward.amount_units, reward.decimals)), reward.currency, tag.id);
        } else {
          const fresh = get('SELECT * FROM rewards WHERE id=?', reward.id);
          if (fresh.status !== 'reserved' || inflight(fresh)) fail(409, 'Uma transação está em andamento. Aguarde a confirmação ou retome o pedido.', 'REWARD_PENDING');
          if (kind === 'release') {
            if (!get("SELECT id FROM reports WHERE id=? AND tag_id=? AND owner_id=? AND status='open'", req.body.reportId, tag.id, req.user.id)) fail(409, 'Esta conversa já foi encerrada.');
            run('UPDATE rewards SET release_report_id=?,release_wallet=? WHERE id=?', req.body.reportId, spec.recipient, reward.id);
          }
        }
        run("INSERT INTO reward_operations(id,reward_id,kind,spec,unsigned_tx,fee_lamports,rent_lamports,last_valid_height,status,created_at) VALUES(?,?,?,?,?,?,?,?, 'prepared',?)", id, reward.id, kind, JSON.stringify(spec), prepared.transaction, prepared.feeLamports, prepared.rentLamports, prepared.lastValidBlockHeight, now());
      });
      res.status(201).json({ operation: operationView(get('SELECT * FROM reward_operations WHERE id=?', id)) });
    }));
    app.get('/api/reward-operations/:operationId', requireOwner, route(async (req, res) => {
      const op = ownerOperation(req); configured();
      const reward = await refresh(get('SELECT * FROM rewards WHERE id=?', op.reward_id));
      const fresh = get('SELECT * FROM reward_operations WHERE id=?', op.id);
      res.json({ operation: operationView(fresh), status: fresh.status, reward: view(reward, true) });
    }));
    app.post('/api/reward-operations/:operationId/submit', requireOwner, writeLimit, route(async (req, res) => {
      const op = ownerOperation(req); configured();
      const reward = await refresh(get('SELECT * FROM rewards WHERE id=?', op.reward_id));
      const fresh = get('SELECT * FROM reward_operations WHERE id=?', op.id);
      if (fresh.status === 'confirmed') { res.json({ reward: view(reward, true), status: 'confirmed' }); return; }
      if (!['prepared', 'submitted'].includes(fresh.status)) fail(409, 'Esta transação expirou ou falhou. Prepare um novo pedido.', 'REWARD_OPERATION_EXPIRED');
      const signed = chain.signedPayload(req.body.transaction, op.unsigned_tx, JSON.parse(op.spec));
      if (fresh.signature && fresh.signature !== signed.signature) fail(409, 'A assinatura não corresponde à transação solicitada.');
      transaction(() => {
        assertSession(req);
        run("UPDATE reward_operations SET status='submitted',signed_tx=?,signature=? WHERE id=? AND status IN ('prepared','submitted')", signed.encoded, signed.signature, op.id);
      });
      // Persist before broadcasting. Timeouts and app restarts can safely retry the
      // exact same signature; a second debit is never created to resolve ambiguity.
      await broadcast(get('SELECT * FROM reward_operations WHERE id=?', op.id));
      res.status(202).json({ reward: view(get('SELECT * FROM rewards WHERE id=?', reward.id)), status: 'submitted', signature: signed.signature });
    }));
    app.post('/api/reward-operations/:operationId/retry', requireOwner, writeLimit, route(async (req, res) => {
      const op = ownerOperation(req); configured();
      const reward = await refresh(get('SELECT * FROM rewards WHERE id=?', op.reward_id));
      const fresh = get('SELECT * FROM reward_operations WHERE id=?', op.id);
      await broadcast(fresh);
      res.json({ reward: view(reward, true), status: fresh.status });
    }));
    for (const finder of [false, true]) {
      const path = `/api/${finder ? 'finder/' : ''}reports/:id/reward`;
      app.get(path, finder ? requireFinder : requireOwner, route(async (req, res) => {
        const report = finder ? req.finderReport : ownerReport(req);
        const tag = get('SELECT * FROM tags WHERE id=? AND owner_id=?', report.tag_id, report.owner_id);
        const wallet = get('SELECT address FROM finder_reward_wallets WHERE report_id=?', report.id)?.address || null;
        const paid = get("SELECT * FROM rewards WHERE release_report_id=? AND status='released'", report.id);
        res.json({ reward: paid ? view(paid) : tag && report.status === 'open' ? await getState(tag) : null, recipient: wallet, tagId: report.tag_id, config: chain?.config || null });
      }));
    }
    app.post('/api/finder/reports/:id/reward/wallet/challenge', requireFinder, route(async (req, res) => {
      configured(); const report = req.finderReport;
      if (report.status !== 'open') fail(409, 'Esta conversa já foi encerrada.');
      run('DELETE FROM finder_wallet_challenges WHERE expires_at<=?', Date.now());
      if (get('SELECT COUNT(*) AS n FROM finder_wallet_challenges WHERE report_id=?', report.id).n >= 5) fail(429, 'Aguarde antes de tentar novamente.');
      const statements = { pt: 'Confirmar a carteira para receber a recompensa desta devolução no SeekerTag. Esta assinatura não autoriza transações.', en: 'Confirm the wallet to receive this SeekerTag return reward. This signature does not authorize transactions.', es: 'Confirmar la cartera para recibir la recompensa de esta devolución en SeekerTag. Esta firma no autoriza transacciones.' };
      const payload = { domain: new URL(publicOrigin).host, uri: publicOrigin, version: '1', chainId: 'solana:mainnet', statement: statements[['pt','en','es'].includes(req.body.language) ? req.body.language : 'pt'],
        nonce: randomBytes(24).toString('hex'), issuedAt: now(), expirationTime: new Date(Date.now() + 5 * 60_000).toISOString(), resources: [`urn:seekertag:return:${report.id}`] };
      const id = randomUUID(); run('INSERT INTO finder_wallet_challenges(id,report_id,payload,expires_at) VALUES(?,?,?,?)', id, report.id, JSON.stringify(payload), Date.now() + 5 * 60_000);
      res.json({ challengeId: id, payload });
    }));
    app.post('/api/finder/reports/:id/reward/wallet/verify', requireFinder, route(async (req, res) => {
      configured(); const report = req.finderReport;
      if (report.status !== 'open') fail(409, 'Esta conversa já foi encerrada.');
      const challenge = typeof req.body.challengeId === 'string' && get('SELECT * FROM finder_wallet_challenges WHERE id=? AND report_id=? AND expires_at>?', req.body.challengeId, report.id, Date.now());
      if (!challenge) fail(401, 'A confirmação expirou ou já foi usada. Tente novamente.');
      let address;
      try {
        const decode = (value, max) => { if (typeof value !== 'string' || value.length > max || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(); const bytes = Buffer.from(value, 'base64'); if (bytes.toString('base64') !== value) throw new Error(); return bytes; };
        const publicKey = decode(req.body.address, 44); const signature = decode(req.body.signature, 88); const signedMessage = decode(req.body.signedMessage, 6000);
        if (publicKey.length !== 32 || signature.length !== 64 || !PublicKey.isOnCurve(publicKey)) throw new Error();
        address = bs58.encode(publicKey);
        if (!verifySignIn({ ...JSON.parse(challenge.payload), address }, { account: { address, publicKey, chains: [], features: [] }, signedMessage, signature, signatureType: 'ed25519' })) throw new Error();
      } catch { fail(401, 'A carteira não confirmou este pedido de acesso. Tente novamente.'); }
      if (get("SELECT subject FROM auth_identities WHERE user_id=? AND provider='solana'", report.owner_id)?.subject === address || get('SELECT id FROM rewards WHERE tag_id=? AND owner_id=? AND payer=?', report.tag_id, report.owner_id, address)) fail(403, 'A carteira de quem encontrou deve ser diferente da carteira do dono.');
      const existing = get('SELECT address FROM finder_reward_wallets WHERE report_id=?', report.id);
      if (existing && existing.address !== address) fail(409, 'Esta conversa já tem uma carteira de recebimento confirmada.');
      transaction(() => {
        if (!run('DELETE FROM finder_wallet_challenges WHERE id=?', challenge.id).changes) fail(401, 'Confirmação já usada.');
        if (!existing) run('INSERT INTO finder_reward_wallets(report_id,address,verified_at) VALUES(?,?,?)', report.id, address, now());
      });
      res.json({ recipient: address });
    }));
  }
  return { install, current, view, getState, refresh, assertUnlocked, assertEditable };
}
