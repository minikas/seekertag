import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { Keypair, PublicKey } from '@solana/web3.js';
import { receivingWalletAddress } from '@seekertag/shared/wallet-address';
import { buildValidator } from '../scripts/validator.mjs';

test('browser bundle uses the same receiving address validation as API and mobile', async () => {
  const context = { TextEncoder, TextDecoder, Uint8Array };
  runInNewContext(new TextDecoder().decode(await buildValidator()), context);
  const valid = Keypair.generate().publicKey.toBase58();
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('finder-test')], PublicKey.default);
  for (const value of ['', 'invalid', '0'.repeat(44), '1'.repeat(32), pda.toBase58(), valid, ` ${valid} `]) {
    assert.equal(context.FinderWallet.receivingWalletAddress(value), receivingWalletAddress(value));
  }
  const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const source = script.slice(script.indexOf('function validateWalletInput()'), script.indexOf("$('#wallet-input').addEventListener"));
  const elements = { '#wallet-input': { value: '', setAttribute() {} }, '#review-wallet': {}, '#wallet-error': {} };
  context.$ = selector => elements[selector];
  context.t = key => key;
  runInNewContext(source, context);
  for (const [value, disabled] of [['', true], ['invalid', true], ['1'.repeat(32), true], [pda.toBase58(), true], [valid, false], ['', true]]) {
    elements['#wallet-input'].value = value;
    context.validateWalletInput();
    assert.equal(elements['#review-wallet'].disabled, disabled);
  }
});
