param(
  [int]$BountyId = -1,
  [switch]$SkipCreate,
  [decimal]$StorageReserve = 0,
  [string]$ReserveAccount = ''
)
$ErrorActionPreference = 'Stop'
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
$contract = 'swarm-bounty.swarmbuilder.testnet'
$creator = 'creator.swarmbuilder.testnet'
$agent1 = 'agent1.swarmbuilder.testnet'
$agent2 = 'agent2.swarmbuilder.testnet'
$argsDir = Join-Path $PSScriptRoot 'demo-args'
$utf8NoBom = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $false

function Invoke-NearCapture([string[]]$Arguments) {
  $output = (& near @Arguments 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "NEAR command failed: near $($Arguments -join ' ')`n$output" }
  return $output
}

if ($BountyId -lt 0 -and $env:SWARM_BOUNTY_ID) { $BountyId = [int]$env:SWARM_BOUNTY_ID }
if ($SkipCreate -and $BountyId -lt 0) { throw 'Set -BountyId when using -SkipCreate.' }

if (-not $SkipCreate -and $BountyId -lt 0) {
  $nextOutput = Invoke-NearCapture @('contract','call-function','as-read-only',$contract,'get_next_bounty_id','json-args','{}','network-config','testnet','now')
  $match = [regex]::Match($nextOutput, 'Function execution return value \(printed to stdout\):\s*(\d+)')
  if (-not $match.Success) { throw "Could not determine the next bounty id from near output.`n$nextOutput" }
  $BountyId = [int]$match.Groups[1].Value
}

$runArgs = Join-Path $env:TEMP "swarm-demo-$BountyId"
New-Item -ItemType Directory -Force -Path $runArgs | Out-Null
Get-ChildItem $argsDir -Filter '*.json' | ForEach-Object {
  $payload = Get-Content -Raw $_.FullName | ConvertFrom-Json
  if ($payload.PSObject.Properties.Name -contains 'bounty_id') { $payload.bounty_id = $BountyId }
  $json = $payload | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText((Join-Path $runArgs $_.Name), $json, $utf8NoBom)
}

function Invoke-NearChecked([string[]]$Arguments) {
  & near @Arguments
  if ($LASTEXITCODE -ne 0) { throw "NEAR command failed: near $($Arguments -join ' ')" }
}

if ($StorageReserve -gt 0) {
  if ([string]::IsNullOrWhiteSpace($ReserveAccount)) { throw '-ReserveAccount is required when -StorageReserve is greater than zero.' }
  Write-Host "[0/6] Funding contract storage reserve: $StorageReserve NEAR from $ReserveAccount"
  Invoke-NearChecked @('tokens',$ReserveAccount,'send-near',$contract,"$StorageReserve NEAR",'network-config','testnet','sign-with-keychain','send')
}

if (-not $SkipCreate) {
  Write-Host "[1/6] Creator creates 5 NEAR bounty (id $BountyId)"
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
