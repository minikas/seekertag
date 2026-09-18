import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, Message } from '@solana/web3.js';
import { getTransactionDecoder } from '@solana/kit';
import { LiteSVM, FailedTransactionMetadata } from 'litesvm';
import bs58 from 'bs58';
import { PROGRAM, TOKEN_PROGRAM, tokenAddress } from '@seekertag/shared/escrow-wire';
import { MAINNET_MINTS } from '@seekertag/shared/reward';
import { createRewardChain } from '../../rewards/chain.js';

// A JSON-RPC boundary around the actual SBF VM: API tests use the production
// transaction builder, signature verifier, RPC decoder and confirmation logic.
export async function rpcHarness() {
  const svm = new LiteSVM().withBlockhashCheck(false);
  svm.addProgramFromFile(PROGRAM.toBase58(), fileURLToPath(new URL('../../../../artifacts/escrow/seekertag_escrow.so', import.meta.url)));
  const clock = svm.getClock(); clock.unixTimestamp = BigInt(Math.floor(Date.now() / 1000)); svm.setClock(clock);
  const verifier = Keypair.generate(); const treasury = Keypair.generate(); svm.airdrop(treasury.publicKey.toBase58(), 1_000_000n); const receipts = new Map(); const unfinalized = new Map();
  const h = { svm, verifier, treasury, holdFinality: false, offline: false, height: 100, sends: 0 };
  function account(address, commitment) {
    const value = commitment === 'finalized' && unfinalized.has(address) ? unfinalized.get(address) : svm.getAccount(address);
    return !value?.exists ? null : { lamports: Number(value.lamports), data: [Buffer.from(value.data).toString('base64'), 'base64'], owner: value.programAddress, executable: value.executable, rentEpoch: 0 };
  }
  const context = value => ({ context: { slot: 100 }, value });
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const { id, method, params = [] } = JSON.parse(raw);
    res.setHeader('Content-Type', 'application/json');
    if (h.offline) { res.statusCode = 503; res.end('{}'); return; }
    try {
      let result;
      if (method === 'getGenesisHash') result = 'localnet';
      else if (method === 'getAccountInfo') result = context(account(params[0], params[1]?.commitment));
      else if (method === 'getMultipleAccounts') result = context(params[0].map(key => account(key, params[1]?.commitment)));
      else if (method === 'getMinimumBalanceForRentExemption') result = Number(svm.minimumBalanceForRentExemption(BigInt(params[0])));
      else if (method === 'getLatestBlockhash') { svm.expireBlockhash(); result = context({ blockhash: svm.latestBlockhash(), lastValidBlockHeight: h.height + 150 }); }
      else if (method === 'getFeeForMessage') {
        const message = Message.from(Buffer.from(params[0], 'base64'));
        let units = 200_000n; let price = 0n;
        for (const ix of message.instructions) if (message.accountKeys[ix.programIdIndex].equals(ComputeBudgetProgram.programId)) {
          const data = Buffer.from(bs58.decode(ix.data));
          if (data[0] === 2) units = BigInt(data.readUInt32LE(1));
          if (data[0] === 3) price = data.readBigUInt64LE(1);
        }
        result = context(message.header.numRequiredSignatures * 5000 + Number((units * price + 999_999n) / 1_000_000n));
      }
      else if (method === 'getBlockHeight') result = h.height;
      else if (method === 'getEpochInfo') { h.onFinalityRead?.(); result = { epoch: 0, slotIndex: 100, slotsInEpoch: 432000, absoluteSlot: 100, blockHeight: h.height }; }
      else if (method === 'getSignatureStatuses') result = context(params[0].map(signature => receipts.get(signature) || null));
      else if (method === 'sendTransaction') {
        h.sends++;
        const rawTx = Buffer.from(params[0], 'base64'); const tx = Transaction.from(rawTx); const signature = bs58.encode(tx.signature);
        if (receipts.has(signature)) result = signature;
        else {
          if (h.holdFinality) for (const key of tx.compileMessage().accountKeys) {
            const address = key.toBase58(); if (!unfinalized.has(address)) unfinalized.set(address, svm.getAccount(address));
          }
          const meta = svm.sendTransaction(getTransactionDecoder().decode(rawTx));
          if (meta instanceof FailedTransactionMetadata) throw new Error(meta.meta().logs().join('\n'));
          receipts.set(signature, { slot: 100, confirmations: h.holdFinality ? 1 : null, err: null, confirmationStatus: h.holdFinality ? 'confirmed' : 'finalized' });
          result = signature;
        }
      } else throw new Error(`Unsupported test RPC method ${method}`);
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
    } catch (error) { res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32002, message: error.message } })); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  h.rpcUrl = `http://127.0.0.1:${server.address().port}`;
  h.chain = createRewardChain({ network: 'localnet', rpcUrl: h.rpcUrl, verifier, treasury: treasury.publicKey.toBase58(), testMints: MAINNET_MINTS });
  h.finalize = () => { h.holdFinality = false; unfinalized.clear(); for (const value of receipts.values()) { value.confirmationStatus = 'finalized'; value.confirmations = null; } };
  h.advance = seconds => { const c = svm.getClock(); c.unixTimestamp += BigInt(seconds); svm.setClock(c); };
  h.fund = (wallet, sol = 10_000_000_000n) => {
    svm.airdrop(wallet.publicKey.toBase58(), sol);
    for (const mintAddress of Object.values(MAINNET_MINTS)) {
      const mint = new PublicKey(mintAddress); const data = Buffer.alloc(82);
      data.writeUInt32LE(1, 0); verifier.publicKey.toBuffer().copy(data, 4); data.writeBigUInt64LE(1_000_000_000n, 36); data[44] = 6; data[45] = 1;
      svm.setAccount({ address: mintAddress, executable: false, programAddress: TOKEN_PROGRAM.toBase58(), lamports: svm.minimumBalanceForRentExemption(82n), data });
      const source = Buffer.alloc(165); mint.toBuffer().copy(source); wallet.publicKey.toBuffer().copy(source, 32); source.writeBigUInt64LE(1_000_000_000n, 64); source[108] = 1;
      svm.setAccount({ address: tokenAddress(wallet.publicKey, mint).toBase58(), executable: false, programAddress: TOKEN_PROGRAM.toBase58(), lamports: svm.minimumBalanceForRentExemption(165n), data: source });
    }
  };
  h.close = () => new Promise(resolve => server.close(resolve));
  return h;
}
