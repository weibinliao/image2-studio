import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = path.join(ROOT, '.local', 'logs');
const PID_FILE = path.join(ROOT, '.local', 'image2-studio.pid');
const ENV_FILE = path.join(ROOT, '.env');

const envFile = await readEnvFile(ENV_FILE);
const port = Number(envFile.PORT || process.env.PORT || 3020);
const host = envFile.HOST || process.env.HOST || '0.0.0.0';
const publicLanIP = envFile.PUBLIC_LAN_IP || process.env.PUBLIC_LAN_IP || '';

await fsp.mkdir(LOG_DIR, { recursive: true });

const existingPid = await readPid(PID_FILE);
if (existingPid && isProcessAlive(existingPid)) {
  console.log(`Image2 Studio is already running. PID: ${existingPid}`);
  printUrls(port, publicLanIP);
  process.exit(0);
}

if (await isPortOpen(port)) {
  console.error(`Port ${port} is already in use. Stop the existing service first, then run npm start again.`);
  process.exit(1);
}

const out = fs.openSync(path.join(LOG_DIR, 'server.out.log'), 'a');
const err = fs.openSync(path.join(LOG_DIR, 'server.err.log'), 'a');
const child = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  detached: true,
  windowsHide: true,
  stdio: ['ignore', out, err],
  env: normalizeEnv(process.env),
});

child.unref();
await fsp.writeFile(PID_FILE, String(child.pid));

console.log(`Image2 Studio started in background. PID: ${child.pid}`);
console.log(`Logs: ${path.relative(ROOT, LOG_DIR)}`);
printUrls(port, publicLanIP);

function printUrls(portNumber, lanIP) {
  console.log(`Local: http://localhost:${portNumber}`);
  if (lanIP) console.log(`LAN:   http://${lanIP}:${portNumber}`);
}

async function readEnvFile(filePath) {
  try {
    const content = await fsp.readFile(filePath, 'utf8');
    const values = {};
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const splitAt = trimmed.indexOf('=');
      if (splitAt === -1) continue;
      const key = trimmed.slice(0, splitAt).trim();
      const value = trimmed.slice(splitAt + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key) values[key] = value;
    }
    return values;
  } catch {
    return {};
  }
}

async function readPid(filePath) {
  try {
    const value = await fsp.readFile(filePath, 'utf8');
    return Number(value.trim()) || 0;
  } catch {
    return 0;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isPortOpen(portNumber) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: portNumber });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1200, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function normalizeEnv(source) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (key.toLowerCase() === 'path') {
      env.Path = value;
    } else {
      env[key] = value;
    }
  }
  return env;
}
