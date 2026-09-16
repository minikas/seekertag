import assert from 'node:assert/strict';
import { SendTransactionError } from '@solana/web3.js';

/** Reject transport/signing errors as test failures: the compiled program must run. */
export async function rejectsInProgram(operation, programId, connection) {
  let failure;
  try { await operation(); } catch (error) { failure = error; }
  assert.ok(failure instanceof SendTransactionError, 'expected a Solana transaction rejection, not success or an unrelated transport/signing error');
  const logs = failure.logs || await failure.getLogs(connection);
  assert.ok(logs?.some(line => line.startsWith(`Program ${programId.toBase58()} failed:`)), `expected rejection by program ${programId.toBase58()}, received: ${logs?.join('\n') || failure.message}`);
}
