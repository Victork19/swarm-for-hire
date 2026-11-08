$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$contract = 'swarm-bounty.swarmbuilder.testnet'

& "$root\build.ps1"
near contract deploy "$contract" use-file "$root\target\wasm32-unknown-unknown\release\swarm_bounty.wasm" without-init-call network-config testnet sign-with-keychain send
if ($LASTEXITCODE -ne 0) { throw 'Contract deployment failed.' }
near contract call-function as-transaction "$contract" new json-args '{}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as "$contract" network-config testnet sign-with-keychain send
if ($LASTEXITCODE -ne 0) { throw 'Contract initialization failed.' }
Write-Host "Deployed and initialized $contract" -ForegroundColor Green
