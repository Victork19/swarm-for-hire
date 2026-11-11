param(
  [Parameter(Mandatory = $true)]
  [int]$BountyId,
  [switch]$SkipJoins
)

$ErrorActionPreference = 'Stop'
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
$env:DEMO_MODE = '0'

$contract = 'swarm-bounty.swarmbuilder.testnet'
$creator = 'creator.swarmbuilder.testnet'
$agent1 = 'agent1.swarmbuilder.testnet'
$agent2 = 'agent2.swarmbuilder.testnet'
$runDir = Join-Path $env:TEMP "swarm-live-$BountyId"
$utf8NoBom = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $false

if ([string]::IsNullOrWhiteSpace($env:NEAR_AI_API_KEY)) {
  throw 'Set NEAR_AI_API_KEY before running live-demo.ps1.'
}

New-Item -ItemType Directory -Force -Path $runDir | Out-Null

function Write-JsonFile([string]$Path, $Value) {
  [System.IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Compress -Depth 20), $utf8NoBom)
}

function Invoke-NearChecked([string[]]$Arguments) {
  & near @Arguments
  if ($LASTEXITCODE -ne 0) { throw "NEAR command failed: near $($Arguments -join ' ')" }
}

function Invoke-Worker([string]$Agent, [int]$Score) {
  $request = @{ bounty_id = $BountyId; description = 'Summarize NEAR Intents 30-day volume. Return a concise, source-grounded answer and clearly state when exact figures cannot be verified.'; agent_account = $Agent } | ConvertTo-Json -Compress
  $env:DEFAULT_SCORE = [string]$Score
  $raw = $request | python (Join-Path $PSScriptRoot 'worker\worker.py')
  if ($LASTEXITCODE -ne 0) { throw "Worker failed for $Agent." }
  $result = $raw | ConvertFrom-Json
  if ($result.error) { throw "Worker failed for ${Agent}: $($result.error)" }
  Write-Host "Live worker ${Agent}: score=$($result.score), status=$($result.verification_status)" -ForegroundColor Cyan
  Write-Host "Output: $($result.output_preview)"
  return $result
}

if ($SkipJoins) {
  Write-Host "[1/6] Reusing joined agents for bounty $BountyId"
} else {
  Write-Host "[1/6] Agent 1 joins bounty $BountyId"
  Write-JsonFile (Join-Path $runDir 'join.json') @{ bounty_id = $BountyId }
  Invoke-NearChecked @('contract','call-function','as-transaction',$contract,'join_bounty','file-args',"$runDir\join.json",'prepaid-gas','50 Tgas','attached-deposit','0.5 NEAR','sign-as',$agent1,'network-config','testnet','sign-with-keychain','send')

  Write-Host "[2/6] Agent 2 joins bounty $BountyId"
  Invoke-NearChecked @('contract','call-function','as-transaction',$contract,'join_bounty','file-args',"$runDir\join.json",'prepaid-gas','50 Tgas','attached-deposit','0.5 NEAR','sign-as',$agent2,'network-config','testnet','sign-with-keychain','send')
}

Write-Host '[3/6] Agent 1 requests a live NEAR AI Cloud result'
$result1 = Invoke-Worker $agent1 90

Write-Host '[4/6] Agent 2 requests a live NEAR AI Cloud result'
$result2 = Invoke-Worker $agent2 75

function Convert-HashToBytes([string]$Hash) {
  $hex = $Hash -replace '^0x', ''
  if ($hex.Length -ne 64) { throw "Expected a 32-byte output hash, received $Hash" }
  $bytes = @()
  for ($i = 0; $i -lt $hex.Length; $i += 2) { $bytes += [Convert]::ToByte($hex.Substring($i, 2), 16) }
  return $bytes
}

Write-Host '[5/6] Submit live hashes and evidence'
Write-JsonFile (Join-Path $runDir 'submit1.json') @{ bounty_id = $BountyId; output_hash = @(Convert-HashToBytes $result1.output_hash); attestation = $result1.attestation; score = 90 }
Write-JsonFile (Join-Path $runDir 'submit2.json') @{ bounty_id = $BountyId; output_hash = @(Convert-HashToBytes $result2.output_hash); attestation = $result2.attestation; score = 75 }
Invoke-NearChecked @('contract','call-function','as-transaction',$contract,'submit_output','file-args',"$runDir\submit1.json",'prepaid-gas','100 Tgas','attached-deposit','0 NEAR','sign-as',$agent1,'network-config','testnet','sign-with-keychain','send')
Invoke-NearChecked @('contract','call-function','as-transaction',$contract,'submit_output','file-args',"$runDir\submit2.json",'prepaid-gas','100 Tgas','attached-deposit','0 NEAR','sign-as',$agent2,'network-config','testnet','sign-with-keychain','send')

Write-Host '[6/6] Settle bounty'
Write-JsonFile (Join-Path $runDir 'settle.json') @{ bounty_id = $BountyId }
Invoke-NearChecked @('contract','call-function','as-transaction',$contract,'settle','file-args',"$runDir\settle.json",'prepaid-gas','100 Tgas','attached-deposit','0 NEAR','sign-as',$creator,'network-config','testnet','sign-with-keychain','send')
Write-Host "PASS: live NEAR AI evidence submitted; agent1 should win bounty $BountyId with a 4 NEAR payout." -ForegroundColor Green
