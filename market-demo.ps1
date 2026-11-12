param([string]$Coordinator = 'swarm-market.swarmbuilder.testnet')
$ErrorActionPreference = 'Stop'
$tmp = Join-Path $env:TEMP 'swarm-live-market'
New-Item -ItemType Directory -Force $tmp | Out-Null

function NearCall([string]$Signer, [string]$Method, [string]$ArgsFile, [string]$Deposit = '0 NEAR') {
  near contract call-function as-transaction $Coordinator $Method file-args $ArgsFile prepaid-gas '100 Tgas' attached-deposit $Deposit sign-as $Signer network-config testnet sign-with-keychain send
  if ($LASTEXITCODE -ne 0) { throw "Failed: $Signer -> $Method" }
}
function WriteArgs($Value, [string]$Name) { $path = Join-Path $tmp $Name; $Value | ConvertTo-Json -Compress | Set-Content $path; return $path }
function HashBytes([string]$Value) { $sha = [Security.Cryptography.SHA256]::Create(); return @($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)) | ForEach-Object { [int]$_ }) }

$open = WriteArgs @{ task = 'Pool confidential GPU inference demand'; budget = '250000000000000000000000'; buyer_count = 5; worker_count = 5 } 'open.json'
NearCall $Coordinator 'open_round' $open
$round = 1

$buyers = 1..5 | ForEach-Object { "buyer-{0:D2}.swarmbuilder.testnet" -f $_ }
foreach ($buyer in $buyers) {
  $demand = WriteArgs @{ round_id = $round; max_price = '50000000000000000000000'; quantity = '1' } "demand-$buyer.json"
  NearCall $buyer 'submit_demand' $demand '0.05 NEAR'
}

$bids = @(
  @{ account = 'worker-01.swarmbuilder.testnet'; price = '30000000000000000000000'; quality = 82; salt = 'market-alpha' },
  @{ account = 'worker-02.swarmbuilder.testnet'; price = '32000000000000000000000'; quality = 86; salt = 'market-bravo' },
  @{ account = 'worker-03.swarmbuilder.testnet'; price = '34000000000000000000000'; quality = 88; salt = 'market-charlie' },
  @{ account = 'worker-04.swarmbuilder.testnet'; price = '36000000000000000000000'; quality = 94; salt = 'market-delta' },
  @{ account = 'worker-05.swarmbuilder.testnet'; price = '38000000000000000000000'; quality = 91; salt = 'market-echo' }
)
foreach ($bid in $bids) {
  $commitment = HashBytes "$($bid.price)|$($bid.quality)|$($bid.salt)"
  $commit = WriteArgs @{ round_id = $round; commitment = $commitment } "commit-$($bid.account).json"
  NearCall $bid.account 'commit_bid' $commit
}

$openReveal = WriteArgs @{ round_id = $round } 'round.json'
NearCall $Coordinator 'open_reveal' $openReveal
foreach ($bid in $bids) {
  $reveal = WriteArgs @{ round_id = $round; price = $bid.price; quality = $bid.quality; salt = $bid.salt } "reveal-$($bid.account).json"
  NearCall $bid.account 'reveal_bid' $reveal
}
NearCall $Coordinator 'clear_market' $openReveal
NearCall $Coordinator 'allocate_market' $openReveal
Write-Host "PASS: live market round $round cleared, allocated, paid, and refunded." -ForegroundColor Green
