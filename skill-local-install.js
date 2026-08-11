import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const LOCAL_SKILL_NAME = 'image2-studio-generate';
export const REQUIRED_SKILL_FILES = [
  'SKILL.md',
  'agents/openai.yaml',
  'scripts/generate-image.mjs',
];

const SERVER_URL_TOKEN = "'IMAGE2_STUDIO_PACKAGE_URL'";

export function resolveLocalSkillTargets(homeDir = os.homedir()) {
  const roots = [
    { id: 'agents', root: path.join(homeDir, '.agents', 'skills') },
    { id: 'codex', root: path.join(homeDir, '.codex', 'skills') },
  ];
  const seen = new Set();

  return roots
    .map((target) => ({ ...target, root: path.resolve(target.root) }))
    .filter((target) => {
      if (seen.has(target.root)) return false;
      seen.add(target.root);
      return true;
    })
    .map((target) => ({
      ...target,
      path: path.join(target.root, LOCAL_SKILL_NAME),
    }));
}

export async function installLocalSkill({ sourceDir, serverUrl, homeDir = os.homedir() }) {
  const targets = [];

  for (const target of resolveLocalSkillTargets(homeDir)) {
    const existed = await pathExists(target.path);
    await fs.rm(target.path, { recursive: true, force: true });
    await fs.mkdir(target.root, { recursive: true });
    await fs.cp(sourceDir, target.path, { recursive: true });
    await patchInstalledSkillServerUrl(target.path, serverUrl);

    targets.push({
      ...(await inspectLocalSkillTarget(target, serverUrl)),
      action: existed ? 'replaced' : 'created',
    });
  }

  return buildVerificationResult(targets, serverUrl);
}

export async function verifyLocalSkill({ serverUrl, homeDir = os.homedir() }) {
  const targets = await Promise.all(
    resolveLocalSkillTargets(homeDir).map((target) => inspectLocalSkillTarget(target, serverUrl)),
  );
  return buildVerificationResult(targets, serverUrl);
}

async function inspectLocalSkillTarget(target, serverUrl) {
  const files = [];
  for (const relativePath of REQUIRED_SKILL_FILES) {
    files.push({ path: relativePath, exists: await pathExists(path.join(target.path, relativePath)) });
  }

  const missingFiles = files.filter((file) => !file.exists).map((file) => file.path);
  const scriptPath = path.join(target.path, 'scripts', 'generate-image.mjs');
  let serverUrlConfigured = false;
  if (await pathExists(scriptPath)) {
    const source = await fs.readFile(scriptPath, 'utf8');
    serverUrlConfigured = source.includes(`const packagedBaseUrl = ${JSON.stringify(serverUrl)};`);
  }

  return {
    id: target.id,
    path: target.path,
    files,
    missingFiles,
    serverUrlConfigured,
    valid: missingFiles.length === 0 && serverUrlConfigured,
  };
}

function buildVerificationResult(targets, serverUrl) {
  const valid = targets.length > 0 && targets.every((target) => target.valid);
  return {
    valid,
    serverUrl,
    targets,
    restartRequired: true,
    callableAfterRestart: valid,
  };
}

async function patchInstalledSkillServerUrl(skillDir, serverUrl) {
  const scriptPath = path.join(skillDir, 'scripts', 'generate-image.mjs');
  const source = await fs.readFile(scriptPath, 'utf8');
  const next = source.includes(SERVER_URL_TOKEN)
    ? source.replace(SERVER_URL_TOKEN, JSON.stringify(serverUrl))
    : source.replace(/const packagedBaseUrl = ['"][^'"]*['"];/, `const packagedBaseUrl = ${JSON.stringify(serverUrl)};`);
  await fs.writeFile(scriptPath, next, 'utf8');
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
