import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { receivingWalletAddress } from '@seekertag/shared/wallet-address';
import { receivingWalletFormSchema } from '../../src/form.model.ts';

test('receiving addresses preserve case and trim pasted whitespace without requiring a wallet', () => {
  const address = Keypair.generate().publicKey.toBase58();
  assert.equal(receivingWalletAddress(address), address);
  assert.equal(receivingWalletAddress(` \n${address}\t `), address);
});

test('the receiving form normalizes valid pastes and attaches validation errors to the address field', () => {
  const address = Keypair.generate().publicKey.toBase58();
  assert.deepEqual(receivingWalletFormSchema.parse({ address: ` ${address}\n` }), { address });
  for (const value of ['', 'invalid-wallet', `solana:${address}`]) {
    const result = receivingWalletFormSchema.safeParse({ address: value });
    assert.equal(result.success, false);
    assert.deepEqual(result.error.issues[0].path, ['address']);
    assert.equal(result.error.issues[0].message, 'Informe um endereço de carteira Solana válido.');
  }
});

test('receiving addresses reject invalid base58, wrong key lengths, URLs and program-derived addresses', () => {
  const address = Keypair.generate().publicKey.toBase58();
  const [programAddress] = PublicKey.findProgramAddressSync([Buffer.from('test')], SystemProgram.programId);
  for (const value of [undefined, null, 123, {}, [], '', ' ', '0'.repeat(44), '1'.repeat(31), '1'.repeat(45),
    `1${address}`, `${address.slice(0, 12)} ${address.slice(12)}`, `solana:${address}`, 'https://wallet.example',
    SystemProgram.programId.toBase58(), programAddress.toBase58(), 'x'.repeat(101)]) {
    assert.equal(receivingWalletAddress(value), null, String(value));
  }
});
