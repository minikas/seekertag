// Local-only Solana test harness. Never accepts an external RPC or existing wallet.
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const LOCAL_PROGRAM_ID = new PublicKey(createHash('sha256').update('SeekerTag local reward escrow program v1').digest());
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function executable(name) {
  const directories = [process.env.SOLANA_BIN_DIR, join(projectRoot, 'artifacts/solana-tools/solana-release/bin'), ...(process.env.PATH || '').split(delimiter)].filter(Boolean);
  const found = directories.map(directory => join(directory, name)).find(existsSync);
  if (!found) throw new Error(`${name} is required. Set SOLANA_BIN_DIR to the official Agave release bin directory.`);
  return found;
}

export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function rpcPort() {
  // A validator also binds the websocket port immediately after its RPC port.
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = await freePort();
    if (port >= 65534) continue;
    const server = createServer();
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port + 1, '127.0.0.1', resolve); });
      await new Promise(resolve => server.close(resolve));
      return port;
    } catch { server.close(); }
  }
  throw new Error('Unable to allocate consecutive local RPC ports.');
}

export async function startRewardValidator({ programPath } = {}) {
  const so = resolve(projectRoot, programPath || process.env.REWARD_PROGRAM_SO || 'programs/reward-escrow/target/deploy/seekertag_reward_escrow.so');
  if (!existsSync(so)) throw new Error(`Compiled escrow program missing: ${so}. Run npm run build:rewards first.`);
  const validator = executable('solana-test-validator');
  const directory = mkdtempSync(join(tmpdir(), 'seekertag-reward-validator-'));
  const configPath = join(directory, 'isolated-cli.yml');
  // Never load a user's existing Solana CLI configuration or wallet. The mint
  // below has no private key in this test; this harness uses RPC airdrops.
  writeFileSync(configPath, 'json_rpc_url: http://127.0.0.1:8899\nwebsocket_url: ""\nkeypair_path: /nonexistent-seekertag-test-wallet\naddress_labels: {}\ncommitment: confirmed\n', { mode: 0o600 });
  const artifacts = join(projectRoot, 'artifacts/rewards');
  mkdirSync(artifacts, { recursive: true });
  const logPath = join(artifacts, `validator-${Date.now()}.log`);
  const output = createWriteStream(logPath, { mode: 0o600 });
  const port = await rpcPort();
  let faucetPort = await freePort();
  while (faucetPort === port || faucetPort === port + 1) faucetPort = await freePort();
  let gossipPort = await freePort();
  while ([port, port + 1, faucetPort].includes(gossipPort)) gossipPort = await freePort();
  const child = spawn(validator, [
    '--reset', '--ledger', join(directory, 'ledger'), '--bind-address', '127.0.0.1',
    '--config', configPath, '--url', `http://127.0.0.1:${port}`, '--mint', new PublicKey(createHash('sha256').update('SeekerTag unused local genesis mint').digest()).toBase58(),
    '--rpc-port', String(port), '--faucet-port', String(faucetPort),
    '--gossip-port', String(gossipPort),
    '--bpf-program', LOCAL_PROGRAM_ID.toBase58(), so,
    '--quiet',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  const url = `http://127.0.0.1:${port}`;
  const connection = new Connection(url, { commitment: 'confirmed', disableRetryOnRateLimit: true });
  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;
    // web3.js has no public Connection.close(); this test-only connection owns
    // its websocket. Close it while the validator can still acknowledge it.
    connection._rpcWebSocket.close(1000);
    if (child.exitCode === null && child.signalCode === null && !spawnError) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await Promise.race([exited, pause(5000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await Promise.race([exited, pause(5000)]);
      }
    }
    output.end();
    rmSync(directory, { recursive: true, force: true });
  }
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) throw spawnError || new Error(`Local validator exited (${child.exitCode ?? child.signalCode}). ${readFileSync(logPath, 'utf8').slice(-2500)}`);
      try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }), signal: AbortSignal.timeout(1000) });
        if ((await response.json()).result === 'ok') { ready = true; break; }
      } catch { /* Booting. */ }
      await pause(500);
    }
    if (!ready) throw new Error(`Local validator did not become ready. Log: ${logPath}`);
    const account = await connection.getAccountInfo(LOCAL_PROGRAM_ID);
    if (!account?.executable) throw new Error('Local validator did not load the compiled escrow program.');
    return { connection, url, programId: LOCAL_PROGRAM_ID, genesisHash: await connection.getGenesisHash(), stop, logPath };
  } catch (error) { await stop(); throw error; }
}
