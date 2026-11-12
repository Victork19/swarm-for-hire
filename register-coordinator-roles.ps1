param([string]$Account = 'swarm-market.swarmbuilder.testnet')
$ErrorActionPreference = 'Stop'
$roles = Get-Content .\swarm-roles.json -Raw | ConvertFrom-Json
foreach ($buyer in $roles.buyers) {
  $args = @{ account = $buyer } | ConvertTo-Json -Compress
  $args | Set-Content "$env:TEMP\swarm-register-buyer.json"
  near contract call-function as-transaction $Account register_buyer file-args "$env:TEMP\swarm-register-buyer.json" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as $Account network-config testnet sign-with-keychain send
  if ($LASTEXITCODE -ne 0) { throw "Failed to register buyer $buyer" }
}
foreach ($worker in $roles.workers) {
  $args = @{ account = $worker } | ConvertTo-Json -Compress
  $args | Set-Content "$env:TEMP\swarm-register-worker.json"
  near contract call-function as-transaction $Account register_worker file-args "$env:TEMP\swarm-register-worker.json" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as $Account network-config testnet sign-with-keychain send
  if ($LASTEXITCODE -ne 0) { throw "Failed to register worker $worker" }
}
Write-Host 'Registered all 20 buyers and 5 workers.' -ForegroundColor Green
