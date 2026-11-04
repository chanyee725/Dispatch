<#
  Windows version of scripts/update.sh: bring this machine's Dispatch up to the latest commit
  and make everything use it.

    powershell -ExecutionPolicy Bypass -File scripts\update.ps1               pull, relink skills, restart servers
    powershell -ExecutionPolicy Bypass -File scripts\update.ps1 -NoRestart    pull and relink only
    powershell -ExecutionPolicy Bypass -File scripts\update.ps1 -Build        also rebuild the web UI from web\

  Skills are linked as directory junctions (no admin rights or Developer Mode needed).
  Refuses to pull over local changes in the clone. Safe to run again.
#>
param(
  [switch]$NoRestart,
  [switch]$Build
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$homeDir = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }

function Step($t) { Write-Host ""; Write-Host $t -ForegroundColor White }
function Ok($t) { Write-Host "  + $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  ! $t" -ForegroundColor Yellow }

foreach ($tool in "git", "node") {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Warn "$tool is required"; exit 1 }
}

# 1. Pull ------------------------------------------------------------------------------------------
Step "1. Pull"
$dirty = git -C $repo status --porcelain --untracked-files=no
if ($dirty) {
  Warn "local changes in $repo - commit or stash them, then run again:"
  $dirty | ForEach-Object { Write-Host "    $_" }
  exit 1
}
$branch = (git -C $repo branch --show-current).Trim()
$before = (git -C $repo rev-parse --short HEAD).Trim()
git -C $repo fetch -q origin
git -C $repo pull -q --ff-only origin $branch
if ($LASTEXITCODE -ne 0) { Warn "git pull failed"; exit 1 }
$after = (git -C $repo rev-parse --short HEAD).Trim()
if ($before -eq $after) { Ok "already at $after ($branch)" }
else {
  Ok "$before -> $after ($branch)"
  git -C $repo log --oneline "$before..$after" | Select-Object -First 20 | ForEach-Object { Write-Host "    $_" }
}

# 2. Web UI (optional) -------------------------------------------------------------------------------
if ($Build) {
  Step "2. Web UI"
  npm --prefix (Join-Path $repo "web") install --no-audit --no-fund | Out-Null
  npm --prefix (Join-Path $repo "web") run build | Out-Null
  Ok "rebuilt web\ into public\"
}

# 3. Skills ------------------------------------------------------------------------------------------
Step "3. Skills"
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $homeDir ".codex" }
$targets = @((Join-Path $homeDir ".claude\skills"), (Join-Path $codexHome "skills"))
$skills = Get-ChildItem (Join-Path $repo "skills") -Directory | Where-Object { Test-Path (Join-Path $_.FullName "SKILL.md") }
foreach ($t in $targets) {
  New-Item -ItemType Directory -Force -Path $t | Out-Null
  foreach ($s in $skills) {
    $link = Join-Path $t $s.Name
    if (Test-Path $link) {
      $item = Get-Item $link -Force
      if ($item.LinkType) { $item.Delete() }  # old junction/symlink: remove the link only
      else { Warn "$link is a real folder, left as is"; continue }
    }
    New-Item -ItemType Junction -Path $link -Target $s.FullName | Out-Null
    Ok "$link -> $($s.FullName)"
  }
}

# 4. Restart running servers ---------------------------------------------------------------------------
if (-not $NoRestart) {
  Step "4. Restart running servers"
  $reg = Join-Path $homeDir ".dispatch\servers"
  $count = 0
  foreach ($f in (Get-ChildItem $reg -Filter *.json -ErrorAction SilentlyContinue)) {
    $e = Get-Content $f.FullName -Raw | ConvertFrom-Json
    if (-not $e.port -or -not $e.path) { continue }
    $path = $e.path -replace '^~', $homeDir
    if (-not (Test-Path $path)) { continue }
    $proc = Get-Process -Id $e.pid -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    $count++
    Stop-Process -Id $e.pid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    $dot = Join-Path $path ".dispatch"
    New-Item -ItemType Directory -Force -Path $dot | Out-Null
    Set-Content -Path (Join-Path $dot "server.port") -Value $e.port -NoNewline
    $env:DISPATCH_PORT = "$($e.port)"
    $p = Start-Process -FilePath "node" -ArgumentList @((Join-Path $repo "server\index.js"), $path) `
      -WorkingDirectory $path -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $dot "server.log") -RedirectStandardError (Join-Path $dot "server.err.log")
    Remove-Item Env:DISPATCH_PORT
    Set-Content -Path (Join-Path $dot "server.pid") -Value $p.Id -NoNewline
    $up = $false
    for ($i = 0; $i -lt 60; $i++) {
      try { Invoke-RestMethod "http://127.0.0.1:$($e.port)/api/state" -TimeoutSec 1 | Out-Null; $up = $true; break } catch { Start-Sleep -Milliseconds 500 }
    }
    if ($up) { Ok "$($e.name) -> http://127.0.0.1:$($e.port)" }
    else { Warn "$($e.name) did not come back; see $dot\server.log" }
  }
  if ($count -eq 0) { Ok "no running servers" } else { Ok "restarted $count server(s); cut-off turns resume on their own" }
}

Step "Done"
Write-Host "  Dispatch is at $(git -C $repo log -1 --format='%h %s')"
