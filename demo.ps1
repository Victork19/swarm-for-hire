param([int]$BountyId = 0, [switch]$SkipCreate)
$ErrorActionPreference = 'Stop'
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
$contract = 'swarm-bounty.swarmbuilder.testnet'
$creator = 'creator.swarmbuilder.testnet'
$agent1 = 'agent1.swarmbuilder.testnet'
$agent2 = 'agent2.swarmbuilder.testnet'
$argsDir = Join-Path $PSScriptRoot 'demo-args'
$runArgs = Join-Path $env:TEMP "swarm-demo-$BountyId"
New-Item -ItemType Directory -Force -Path $runArgs | Out-Null
Get-ChildItem $argsDir -Filter '*.json' | ForEach-Object {
  $payload = Get-Content -Raw $_.FullName | ConvertFrom-Json
  if ($payload.PSObject.Properties.Name -contains 'bounty_id') { $payload.bounty_id = $BountyId }
  $payload | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $runArgs $_.Name) -Encoding utf8
}

function Invoke-NearChecked([string[]]$Arguments) {
  & near @Arguments
  if ($LASTEXITCODE -ne 0) { throw "NEAR command failed: near $($Arguments -join ' ')" }
}

if (-not $SkipCreate) {
  Write-Host "[1/6] Creator creates 5 NEAR bounty (expected id $BountyId)"
  Invoke-NearChecked @('contract','call-function','as-transaction',$contract,'create_bounty','file-args',"$runArgs\create.json",'prepaid-gas','100 Tgas','attached-deposit','5 NEAR','sign-as',$creator,'network-config','testnet','sign-with-keychain','send')
} else { Write-Host "[1/6] Reusing bounty $BountyId" }
Write-Host '[2/6] Agent 1 joins'
Invoke-NearChecked @('contract','call-function','as-transaction',$contract,'join_bounty','file-args',"$runArgs\join.json",'prepaid-gas','50 Tgas','attached-deposit','0.5 NEAR','sign-as',$agent1,'network-config','testnet','sign-with-keychain','send')
Write-Host '[3/6] Agent 2 joins'
Invoke-NearChecked @('contract','call-function','as-transaction',$contract,'join_bounty','file-args',"$runArgs\join.json",'prepaid-gas','50 Tgas','attached-deposit','0.5 NEAR','sign-as',$agent2,'network-config','testnet','sign-with-keychain','send')
Write-Host '[4/6] Agent 1 submits score 90'
Invoke-NearChecked @('contract','call-function','as-transaction',$contract,'submit_output','file-args',"$runArgs\submit1.json",'prepaid-gas','100 Tgas','attached-deposit','0 NEAR','sign-as',$agent1,'network-config','testnet','sign-with-keychain','send')
Write-Host '[5/6] Agent 2 submits score 75'
Invoke-NearChecked @('contract','call-function','as-transaction',$contract,'submit_output','file-args',"$runArgs\submit2.json",'prepaid-gas','100 Tgas','attached-deposit','0 NEAR','sign-as',$agent2,'network-config','testnet','sign-with-keychain','send')
Write-Host '[6/6] Settle'
Invoke-NearChecked @('contract','call-function','as-transaction',$contract,'settle','file-args',"$runArgs\settle.json",'prepaid-gas','100 Tgas','attached-deposit','0 NEAR','sign-as',$creator,'network-config','testnet','sign-with-keychain','send')
Write-Host 'PASS: agent1 should be winner with a 4 NEAR payout.' -ForegroundColor Green
