import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';

const candidates = Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address));
const address = process.env.SEEKERTAG_LAN_HOST || candidates[0]?.address;
if (!address) { console.error('Não foi encontrado um endereço de rede local. Conecte o Wi-Fi ou defina SEEKERTAG_LAN_HOST.'); process.exit(1); }
const apiOnly = process.argv.includes('--api-only');
const port = process.env.PORT || '4318';
const env = {
  ...process.env,
  PUBLIC_URL: process.env.PUBLIC_URL || `http://${address}:${port}`,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL || `http://${address}:${port}/api`,
};
console.log(`SeekerTag API: ${env.EXPO_PUBLIC_API_URL}\nAbra o aplicativo Android na mesma rede Wi-Fi.\nPara compilar: EXPO_PUBLIC_API_URL=${env.EXPO_PUBLIC_API_URL} npm run android`);
const child = spawn('npm', ['run', apiOnly ? 'api' : 'dev'], { stdio: 'inherit', env });
child.on('exit', code => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
