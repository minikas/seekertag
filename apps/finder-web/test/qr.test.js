import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receivingWalletAddress } from '@seekertag/shared/wallet-address';
import { addressFromQr } from '../src/qr-scanner.js';

test('QR accepts only receiving addresses, never external links or transaction requests', () => {
  const address = '6xMj8p34vD1Qcu1FjT3RuSuHv4N5kjWJ9vxBLYNbmyaw';
  for (const value of [address, ` ${address} `, `solana:${address}`, `solana:${address}?amount=2&label=Reward`]) {
    assert.equal(addressFromQr(value, receivingWalletAddress), address);
  }
  for (const value of ['', '1'.repeat(32), 'x'.repeat(2049), `https://example.com/${address}`, 'solana:https://example.com/transaction', `ethereum:${address}`, '<script>alert(1)</script>']) {
    assert.equal(addressFromQr(value, receivingWalletAddress), null);
  }
});
