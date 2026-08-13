import fs from 'node:fs/promises';
import path from 'node:path';

const PACKAGE_ROOT = 'image2-studio-generate';
const SERVER_URL_TOKEN = "'IMAGE2_STUDIO_PACKAGE_URL'";
const PACKAGE_FILES = [
  'SKILL.md',
  'agents/openai.yaml',
  'scripts/generate-image.mjs',
];

export async function buildSkillPackage({ skillDir, serverUrl }) {
  const files = await buildSkillFiles({ skillDir, serverUrl });
  return createStoredZip(files);
}

export async function buildSkillManifest({ skillDir, serverUrl }) {
  const files = await buildSkillFiles({ skillDir, serverUrl });
  return {
    name: PACKAGE_ROOT,
    version: 1,
    files: files.map((file) => ({
      path: String(file.name).slice(`${PACKAGE_ROOT}/`.length),
      encoding: 'utf8',
      content: Buffer.from(file.content).toString('utf8'),
    })),
  };
}

async function buildSkillFiles({ skillDir, serverUrl }) {
  return Promise.all(PACKAGE_FILES.map(async (relativePath) => {
    const sourcePath = path.join(skillDir, ...relativePath.split('/'));
    let content = await fs.readFile(sourcePath);
    if (relativePath === 'scripts/generate-image.mjs') {
      const source = content.toString('utf8');
      if (!source.includes(SERVER_URL_TOKEN)) {
        throw new Error('Skill package URL placeholder is missing');
      }
      content = Buffer.from(source.replace(SERVER_URL_TOKEN, JSON.stringify(normalizeServerUrl(serverUrl))), 'utf8');
    }
    return {
      name: `${PACKAGE_ROOT}/${relativePath}`,
      content,
    };
  }));
}

export function buildSkillInstallCommand({ serverUrl }) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const scriptUrl = `${baseUrl}/api/codex-skill/install.ps1`;
  return encodePowerShellCommand(`$server='${escapePowerShellSingleQuoted(baseUrl)}'; $installer='${escapePowerShellSingleQuoted(scriptUrl)}'; Write-Host ('[Image2 Skill] Connecting to ' + $server); $script=Invoke-RestMethod -UseBasicParsing -Uri $installer; & ([scriptblock]::Create([string]$script))`);
}

export const buildSkillInstallPrompt = buildSkillInstallCommand;

export function buildSkillVerifyCommand({ serverUrl }) {
  const baseUrl = normalizeServerUrl(serverUrl);
  return encodePowerShellCommand(`$server='${escapePowerShellSingleQuoted(baseUrl)}'; $required=@('SKILL.md','agents/openai.yaml','scripts/generate-image.mjs'); $roots=@((Join-Path (Join-Path $HOME '.agents') 'skills'),(Join-Path (Join-Path $HOME '.codex') 'skills')) | Select-Object -Unique; $failed=$false; foreach($root in $roots){ $dir=Join-Path $root 'image2-studio-generate'; foreach($file in $required){ if(-not (Test-Path -LiteralPath (Join-Path $dir $file))){ Write-Host ('[Failed] Missing ' + (Join-Path $dir $file)) -ForegroundColor Red; $failed=$true } }; $entry=Join-Path $dir 'scripts/generate-image.mjs'; if(Test-Path -LiteralPath $entry){ $source=[IO.File]::ReadAllText($entry); if(-not $source.Contains($server)){ Write-Host ('[Failed] Wrong server URL in ' + $entry) -ForegroundColor Red; $failed=$true } else { Write-Host ('[Verified] ' + $dir) -ForegroundColor Green } } }; try { $status=Invoke-RestMethod -UseBasicParsing -Uri ($server + '/api/status') -Headers @{'X-Image2-Role'='member'}; if($status.admin -ne $false){ throw 'The service did not accept member mode.' }; Write-Host ('[Verified] Image2 Studio reachable: ' + $server) -ForegroundColor Green } catch { Write-Host ('[Failed] Image2 Studio member connection: ' + $_.Exception.Message) -ForegroundColor Red; $failed=$true }; if($failed){ throw 'Image2 Skill verification failed. Reinstall the Skill.' }; Write-Host '[Complete] Restart the Agent before invoking the Skill.' -ForegroundColor Cyan`);
}

export function buildSkillInstallScript({ serverUrl }) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const manifestUrl = `${baseUrl}/api/codex-skill/manifest`;
  const archiveUrl = `${baseUrl}/api/codex-skill`;

  return [
    "$ErrorActionPreference = 'Stop'",
    "$skillName = 'image2-studio-generate'",
    `$manifestUrl = '${escapePowerShellSingleQuoted(manifestUrl)}'`,
    `$archiveUrl = '${escapePowerShellSingleQuoted(archiveUrl)}'`,
    "$installHome = if ($env:IMAGE2_SKILL_HOME) { $env:IMAGE2_SKILL_HOME } else { $HOME }",
    "$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('image2-skill-' + [guid]::NewGuid().ToString('N'))",
    "$zipPath = Join-Path $tempRoot 'skill.zip'",
    "$extractPath = Join-Path $tempRoot 'extract'",
    'try {',
    '  $sourceDir = Join-Path $tempRoot $skillName',
    '  New-Item -ItemType Directory -Path $sourceDir -Force | Out-Null',
    '  $installedFromManifest = $false',
    '  try {',
    '    $manifest = Invoke-RestMethod -UseBasicParsing -Uri $manifestUrl',
    "    if ($manifest.name -ne $skillName -or [int]$manifest.version -ne 1 -or -not $manifest.files) { throw 'Invalid Image2 Studio Skill manifest.' }",
    '    foreach ($file in @($manifest.files)) {',
    "      $relativePath = [string]$file.path",
    "      if (-not $relativePath -or [IO.Path]::IsPathRooted($relativePath) -or $relativePath -match '(^|[\\/])\.\.(?:[\\/]|$)') { throw 'Invalid Skill file path.' }",
    '      $targetPath = Join-Path $sourceDir $relativePath',
    '      New-Item -ItemType Directory -Path (Split-Path -Parent $targetPath) -Force | Out-Null',
    '      [IO.File]::WriteAllText($targetPath, [string]$file.content, (New-Object Text.UTF8Encoding($false)))',
    '    }',
    '    $installedFromManifest = Test-Path -LiteralPath (Join-Path $sourceDir \'SKILL.md\')',
    '  } catch {',
    '    Remove-Item -LiteralPath $sourceDir -Recurse -Force -ErrorAction SilentlyContinue',
    '    New-Item -ItemType Directory -Path $extractPath -Force | Out-Null',
    '    Invoke-WebRequest -UseBasicParsing -Uri $archiveUrl -OutFile $zipPath',
    '    try {',
    '      Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop',
    '      [IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extractPath)',
    '    } catch {',
    '      if (Get-Command tar.exe -ErrorAction SilentlyContinue) {',
    '        & tar.exe -xf $zipPath -C $extractPath',
    '        if ($LASTEXITCODE -ne 0) { throw }',
    '      } else {',
    '        Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force',
    '      }',
    '    }',
    '    $sourceDir = Join-Path $extractPath $skillName',
    '  }',
    "  if (-not $installedFromManifest -and -not (Test-Path -LiteralPath (Join-Path $sourceDir 'SKILL.md'))) { throw 'Downloaded archive is not a valid Image2 Studio Skill.' }",
    '  $targetRoots = @(',
    "    (Join-Path (Join-Path $installHome '.agents') 'skills')",
    "    (Join-Path (Join-Path $installHome '.codex') 'skills')",
    '  ) | Select-Object -Unique',
    '  foreach ($targetRoot in $targetRoots) {',
    '    New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null',
    '    $targetDir = Join-Path $targetRoot $skillName',
    '    if (Test-Path -LiteralPath $targetDir) { Remove-Item -LiteralPath $targetDir -Recurse -Force }',
    '    Copy-Item -LiteralPath $sourceDir -Destination $targetDir -Recurse -Force',
    '    Write-Host "[Installed] Image2 Studio Skill -> $targetDir"',
    '  }',
    '  $requiredFiles = @(\'SKILL.md\', \'agents/openai.yaml\', \'scripts/generate-image.mjs\')',
    '  foreach ($targetRoot in $targetRoots) {',
    '    $targetDir = Join-Path $targetRoot $skillName',
    '    foreach ($relativePath in $requiredFiles) {',
    '      if (-not (Test-Path -LiteralPath (Join-Path $targetDir $relativePath))) { throw "Installed Skill is missing $relativePath in $targetDir" }',
    '    }',
    '    $entryScript = [IO.File]::ReadAllText((Join-Path $targetDir \'scripts/generate-image.mjs\'))',
    `    if (-not $entryScript.Contains('${escapePowerShellSingleQuoted(baseUrl)}')) { throw 'Installed Skill server URL validation failed.' }`,
    '    Write-Host "[Verified] $targetDir" -ForegroundColor Green',
    '  }',
    `  Write-Host '[Complete] Skill bound to Image2 Studio: ${escapePowerShellSingleQuoted(baseUrl)}' -ForegroundColor Cyan`,
    "  Write-Host '[Next] Restart the Agent before invoking the Skill.'",
    '} finally {',
    '  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }',
    '}',
    '',
  ].join('\r\n');
}

function normalizeServerUrl(value) {
  const url = new URL(String(value));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Skill server URL must use http or https');
  return url.href.replace(/\/$/, '');
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replaceAll("'", "''");
}

function encodePowerShellCommand(script) {
  return `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`;
}

function createStoredZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { date, time } = dosDateTime(new Date());

  for (const file of files) {
    const name = Buffer.from(String(file.name).replace(/\\/g, '/'), 'utf8');
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content);
    const checksum = crc32(content);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function dosDateTime(value) {
  const year = Math.max(1980, value.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
  };
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}
