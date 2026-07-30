import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PID_FILE = path.join(ROOT, '.local', 'image2-studio.pid');

const pid = await readPid(PID_FILE);
if (!pid) {
  console.log('No background PID file found.');
  process.exit(0);
}

try {
  process.kill(pid);
  await fsp.rm(PID_FILE, { force: true });
  console.log(`Stopped Image2 Studio. PID: ${pid}`);
} catch (error) {
  if (error.code === 'ESRCH') {
    await fsp.rm(PID_FILE, { force: true });
    console.log(`PID ${pid} was not running. Removed stale PID file.`);
  } else {
    console.error(`Failed to stop PID ${pid}: ${error.message}`);
    process.exit(1);
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
