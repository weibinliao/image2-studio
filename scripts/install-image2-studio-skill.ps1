$ErrorActionPreference = 'Stop'
$skillName = 'image2-studio-generate'
$githubRoot = if ($env:IMAGE2_STUDIO_SKILL_GITHUB_ROOT) {
  $env:IMAGE2_STUDIO_SKILL_GITHUB_ROOT.TrimEnd('/')
} else {
  'https://raw.githubusercontent.com/weibinliao/image2-studio/main/codex-skill/image2-studio-generate'
}
$installHome = if ($env:IMAGE2_SKILL_HOME) { $env:IMAGE2_SKILL_HOME } else { $HOME }
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('image2-github-skill-' + [guid]::NewGuid().ToString('N'))

try {
  $sourceDir = Join-Path $tempRoot $skillName
  New-Item -ItemType Directory -Path $sourceDir -Force | Out-Null
  $files = @('SKILL.md', 'agents/openai.yaml', 'scripts/generate-image.mjs')

  foreach ($relativePath in $files) {
    $targetPath = Join-Path $sourceDir $relativePath
    New-Item -ItemType Directory -Path (Split-Path -Parent $targetPath) -Force | Out-Null
    Invoke-WebRequest -UseBasicParsing -Uri "$githubRoot/$relativePath" -OutFile $targetPath
  }

  foreach ($targetRoot in @(
    (Join-Path (Join-Path $installHome '.agents') 'skills')
    (Join-Path (Join-Path $installHome '.codex') 'skills')
  ) | Select-Object -Unique) {
    New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
    $targetDir = Join-Path $targetRoot $skillName
    if (Test-Path -LiteralPath $targetDir) { Remove-Item -LiteralPath $targetDir -Recurse -Force }
    Copy-Item -LiteralPath $sourceDir -Destination $targetDir -Recurse -Force
    Write-Host "Installed Image2 Studio Skill -> $targetDir"
  }
} finally {
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
