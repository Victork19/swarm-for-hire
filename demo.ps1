$ErrorActionPreference = 'Stop'
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
$contract = 'swarm-bounty.swarmbuilder.testnet'
$creator = 'creator.swarmbuilder.testnet'
$agent1 = 'agent1.swarmbuilder.testnet'
$agent2 = 'agent2.swarmbuilder.testnet'
$argsDir = Join-Path $PSScriptRoot 'demo-args'

function Invoke-NearChecked([string[]]$Arguments) {
  & near @Arguments
  if ($LASTEXITCODE -ne 0) { throw "NEAR command failed: near $($Arguments -join ' ')" }
}

Write-Host '[1/6] Creator creates 5 NEAR bounty'
Invoke-NearChecked @('contract','call-function','as-transaction',$contract,'create_bounty','file-args',"$argsDir\create.json",'prepaid-gas','100 Tgas','attached-deposit','5 NEAR','sign-as',$creator,'network-config','testnet','sign-with-keychain','send')
Write-Host '[2/6] Agent 1 joins'
Invoke-NearChecked @('contract','call-function','as-transaction',$contract,'join_bounty','file-args',"$argsDir\join.json",'prepaid-gas','50 Tgas','attached-deposit','0.5 NEAR','sign-as',$agent1,'network-config','testnet','sign-with-keychain','send')
Write-Host '[3/6] Agent 2 joins'
Invoke-NearChecked @('contract','call-function','as-transaction',$contract,'join_bounty','file-args',"$argsDir\join.json",'prepaid-gas','50 Tgas','attached-deposit','0.5 NEAR','sign-as',$agent2,'network-config','testnet','sign-with-keychain','send')
Write-Host '[4/6] Agent 1 submits score 90'
Invoke-NearChecked @('contract','call-function','as-transaction',$contract,'submit_output','file-args',"$argsDir\submit1.json",'prepaid-gas','100 Tgas','attached-deposit','0 NEAR','sign-as',$agent1,'network-config','testnet','sign-with-keychain','send')
Write-Host '[5/6] Agent 2 submits score 75'
Invoke-NearChecked @('contract','call-function','as-transaction',$contract,'submit_output','file-args',"$argsDir\submit2.json",'prepaid-gas','100 Tgas','attached-deposit','0 NEAR','sign-as',$agent2,'network-config','testnet','sign-with-keychain','send')
Write-Host '[6/6] Settle'
Invoke-NearChecked @('contract','call-function','as-transaction',$contract,'settle','file-args',"$argsDir\settle.json",'prepaid-gas','100 Tgas','attached-deposit','0 NEAR','sign-as',$creator,'network-config','testnet','sign-with-keychain','send')
Write-Host 'PASS: agent1 should be winner with a 4 NEAR payout.' -ForegroundColor Green
