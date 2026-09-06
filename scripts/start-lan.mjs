import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';

const candidates = Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address));
const address = process.env.SEEKERTAG_LAN_HOST || candidates[0]?.address;
if (!address) { console.error('Não foi encontrado um endereço de rede local. Conecte o Wi-Fi ou defina SEEKERTAG_LAN_HOST.'); process.exit(1); }
const built = process.argv.includes('--built');
const env = { ...process.env, PUBLIC_URL: `http://${address}:${built ? 4318 : 8081}`, EXPO_PUBLIC_API_URL: `http://${address}:4318/api`, CORS_ORIGINS: [process.env.CORS_ORIGINS, 'http://localhost:4318', 'http://127.0.0.1:4318'].filter(Boolean).join(',') };
console.log(`SeekerTag na rede local: ${env.PUBLIC_URL}\nConecte os celulares à mesma rede Wi-Fi. Etiquetas desta sessão dependem deste computador e endereço.\nPara APK: EXPO_PUBLIC_API_URL=${env.EXPO_PUBLIC_API_URL} npm run android`);
const child = spawn('npm', ['run', built ? 'serve' : 'dev'], { stdio: 'inherit', env });
child.on('exit', code => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
