$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
$env:Path = "$cargoBin;$env:Path"

$vsdev = @(
  'C:\BuildTools\Common7\Tools\VsDevCmd.bat',
  'C:\Program Files\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat'
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $vsdev) { throw 'Visual Studio Build Tools not found. Finish the MSVC workload installation first.' }
cmd /c "`"$vsdev`" -arch=x64 -host_arch=x64 && set" | ForEach-Object {
  if ($_ -match '^(.*?)=(.*)$') { Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2] }
}
if (-not $env:VCToolsInstallDir) { throw 'MSVC environment could not be loaded.' }

Push-Location $root
try {
  $env:Path = "$cargoBin;$env:Path"
  rustup target add wasm32-unknown-unknown
  cargo build --manifest-path .\contract\Cargo.toml --target wasm32-unknown-unknown --release
  if ($LASTEXITCODE -ne 0) { throw 'WASM contract build failed.' }
  $artifact = Join-Path $root 'target\wasm32-unknown-unknown\release\swarm_bounty.wasm'
  if (-not (Test-Path $artifact)) { throw "Expected artifact not found: $artifact" }
  Write-Host "Contract build passed: $artifact" -ForegroundColor Green
} finally { Pop-Location }
