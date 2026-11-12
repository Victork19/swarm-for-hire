param(
  [string]$Account = 'swarm-market.swarmbuilder.testnet',
  [switch]$SkipInit
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$artifact = Join-Path $root 'target\wasm32-unknown-unknown\release\swarm_coordinator.wasm'
if (-not (Test-Path $artifact)) { throw "Build the coordinator first: $artifact" }

near contract deploy $Account use-file $artifact without-init-call network-config testnet sign-with-keychain send
if ($LASTEXITCODE -ne 0) { throw 'Coordinator deployment failed.' }
if (-not $SkipInit) {
  near contract call-function as-transaction $Account new json-args '{}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as $Account network-config testnet sign-with-keychain send
  if ($LASTEXITCODE -ne 0) { throw 'Coordinator initialization failed.' }
}
Write-Host "Coordinator deployed: $Account" -ForegroundColor Green
