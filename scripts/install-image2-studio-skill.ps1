param(
  [Parameter(Mandatory = $true)]
  [string]$ServerUrl
)

$ErrorActionPreference = 'Stop'
$skillName = 'image2-studio-generate'
$ServerUrl = $ServerUrl.TrimEnd('/')
if ($ServerUrl -notmatch '^https?://') { throw 'ServerUrl must start with http:// or https://' }
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
  $installedFromManifest = $false

  try {
    Write-Host "[Image2 Skill] Fetching LAN manifest: $ServerUrl/api/codex-skill/manifest"
    $manifest = Invoke-RestMethod -UseBasicParsing -Uri "$ServerUrl/api/codex-skill/manifest"
    if ($manifest.name -ne $skillName -or [int]$manifest.version -ne 1 -or -not $manifest.files) {
      throw 'Invalid Image2 Studio Skill manifest.'
    }
    foreach ($file in @($manifest.files)) {
      $relativePath = [string]$file.path
      if (-not $relativePath -or [IO.Path]::IsPathRooted($relativePath) -or $relativePath -match '(^|[\\/])\.\.(?:[\\/]|$)') {
        throw 'Invalid Skill file path.'
      }
      $targetPath = Join-Path $sourceDir $relativePath
      New-Item -ItemType Directory -Path (Split-Path -Parent $targetPath) -Force | Out-Null
      [IO.File]::WriteAllText($targetPath, [string]$file.content, (New-Object Text.UTF8Encoding($false)))
    }
    $installedFromManifest = Test-Path -LiteralPath (Join-Path $sourceDir 'SKILL.md')
    Write-Host '[Image2 Skill] LAN manifest downloaded.' -ForegroundColor Green
  } catch {
    Write-Warning "LAN manifest unavailable; fetching the address-free GitHub template: $($_.Exception.Message)"
    Remove-Item -LiteralPath $sourceDir -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $sourceDir -Force | Out-Null
    foreach ($relativePath in $files) {
      $targetPath = Join-Path $sourceDir $relativePath
      New-Item -ItemType Directory -Path (Split-Path -Parent $targetPath) -Force | Out-Null
      Invoke-WebRequest -UseBasicParsing -Uri "$githubRoot/$relativePath" -OutFile $targetPath
    }
  }

  $entryScriptPath = Join-Path $sourceDir 'scripts/generate-image.mjs'
  $entryScript = [IO.File]::ReadAllText($entryScriptPath)
  $jsonServerUrl = ConvertTo-Json -Compress $ServerUrl
  if ($entryScript.Contains("'IMAGE2_STUDIO_PACKAGE_URL'")) {
    $entryScript = $entryScript.Replace("'IMAGE2_STUDIO_PACKAGE_URL'", $jsonServerUrl)
  } else {
    $entryScript = [regex]::Replace($entryScript, 'const packagedBaseUrl = [''\"][^''\"]*[''"];', "const packagedBaseUrl = $jsonServerUrl;")
  }
  [IO.File]::WriteAllText($entryScriptPath, $entryScript, (New-Object Text.UTF8Encoding($false)))

  $targetRoots = @(
    (Join-Path (Join-Path $installHome '.agents') 'skills')
    (Join-Path (Join-Path $installHome '.codex') 'skills')
  ) | Select-Object -Unique

  foreach ($targetRoot in $targetRoots) {
    New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
    $targetDir = Join-Path $targetRoot $skillName
    if (Test-Path -LiteralPath $targetDir) { Remove-Item -LiteralPath $targetDir -Recurse -Force }
    Copy-Item -LiteralPath $sourceDir -Destination $targetDir -Recurse -Force
    Write-Host "[Installed] Image2 Studio Skill -> $targetDir"
  }

  foreach ($targetRoot in $targetRoots) {
    $targetDir = Join-Path $targetRoot $skillName
    foreach ($relativePath in $files) {
      if (-not (Test-Path -LiteralPath (Join-Path $targetDir $relativePath))) {
        throw "Installed Skill is missing $relativePath in $targetDir"
      }
    }
    $installedScript = [IO.File]::ReadAllText((Join-Path $targetDir 'scripts/generate-image.mjs'))
    if (-not $installedScript.Contains($ServerUrl)) { throw "Installed Skill is not bound to $ServerUrl" }
    Write-Host "[Verified] $targetDir" -ForegroundColor Green
  }
  Write-Host "[Complete] Skill bound to Image2 Studio: $ServerUrl" -ForegroundColor Cyan
  Write-Host '[Next] Restart the Agent before invoking the Skill.'
} finally {
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
