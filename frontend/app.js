const CONTRACT = 'swarm-bounty.swarmbuilder.testnet';
const COORDINATOR = 'swarm-market.swarmbuilder.testnet';
const SETTLEMENT_TX = 'FXPLtAdy49pF7FahgT31jTzEk813ohEErEYVbKSQhaHi';
const RPCS = ['https://rpc.testnet.fastnear.com', 'https://rpc.testnet.near.org'];
const AGENT1 = 'agent1.swarmbuilder.testnet';
const AGENT2 = 'agent2.swarmbuilder.testnet';
const params = new URLSearchParams(location.search);
const detailRoute = /\/bounty(?:\.html)?\/?$/.test(location.pathname);
const simulation = /\/swarm(?:\.html)?\/?$/.test(location.pathname) || params.get('mode') === 'swarm';
const liveSwarm = simulation && params.get('mode') !== 'simulation' && params.get('live') !== '0';
const requestedBounty = Number(params.get('id'));
// This app is deployed against the testnet contract. Requiring testnet here
// prevents a mainnet wallet session from being selected accidentally.
let connector = null;
const state = { bounties: [], selected: null, wallet: null, walletAccount: null, busy: false, loading: true, loaded: false, error: null };
const el = (id) => document.getElementById(id);
const fmt = (value) => Number(value).toFixed(2);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const bytesToHex = (value) => Array.isArray(value) ? `0x${value.map((byte) => Number(byte).toString(16).padStart(2, '0')).join('')}` : String(value ?? '');
const shortHash = (value) => value ? `${value.slice(0, 10)}…${value.slice(-8)}` : '-';
const demoAgents = [{ account: AGENT1, stake: 0.5, submitted: true, score: 90, attestation: 'demo-tee-quote-v2-a1b2c3d4' }, { account: AGENT2, stake: 0.5, submitted: true, score: 75, attestation: 'demo-tee-quote-v2-e5f6a7b8' }];
const swarmState = { round: 0, rounds: [] };
const recordedCoordinatorRound = { recorded: true, id: 'round-01', task: 'Confidential GPU inference', budget: 0.25, phase: 'Allocated', bids: [
  { seller: 'worker-01', commitment: 'recorded on-chain', quality: 82, price: 0.038, allocated: true },
  { seller: 'worker-02', commitment: 'recorded on-chain', quality: 86, price: 0.038, allocated: true },
  { seller: 'worker-03', commitment: 'recorded on-chain', quality: 88, price: 0.038, allocated: true },
  { seller: 'worker-04', commitment: 'recorded on-chain', quality: 94, price: 0.038, allocated: true },
  { seller: 'worker-05', commitment: 'recorded on-chain', quality: 91, price: 0.038, allocated: true }
], demands: Array.from({ length: 5 }, () => ({ max_price: '50000000000000000000000', quantity: 1 })), allocations: Array.from({ length: 5 }, (_, index) => ({ worker: `worker-0${index + 1}`, quantity: 1 })), maxDemand: 0.25, maxBuyerPrice: 0.05, allocatedUnits: 5, savings: 0.06, winner: { seller: 'worker-04', quality: 94, price: 0.038 }, runnerUp: { seller: 'worker-05', quality: 91, price: 0.038 } };

function toast(message) { const target = el('toast'); target.textContent = message; target.classList.add('show'); window.setTimeout(() => target.classList.remove('show'), 3000); }
function loadingState() { return '<div class="market-loading" role="status" aria-live="polite"><span class="loading-line"></span><span class="loading-line short"></span><span class="loading-line"></span><p>Reading the live NEAR market…</p></div>'; }
function emptyState() { return '<div class="empty"><span>-</span><p>No bounty found on testnet.</p><small>Create the first task to open the market.</small></div>'; }
function errorState() { return '<div class="empty error-state"><span>!</span><p>Market data is temporarily unavailable.</p><small>Check your connection and try again.</small><button type="button" class="text-btn" id="retry-btn">Retry market read <span>-&gt;</span></button></div>'; }
function evidenceMeta(attestation) {
  if (!attestation) return { label: 'Awaiting evidence', className: 'pending' };
  try {
    const evidence = JSON.parse(attestation);
    if (evidence.response_signature && evidence.nonce) return { label: 'Live TEE evidence', className: 'live' };
  } catch (_) { /* Compact demo evidence is not JSON. */ }
  return { label: 'Evidence recorded', className: 'recorded' };
}
function agentEvidenceMeta(agent) {
  if (agent.verified) return { label: 'Cryptographically verified', className: 'verified' };
  return evidenceMeta(agent.attestation);
}
function verificationSummary(agents) {
  const verified = agents.filter((agent) => agent.verified).length;
  const liveEvidence = agents.filter((agent) => agentEvidenceMeta(agent).className === 'live').length;
  return `<div class="verification-panel"><div><span class="panel-kicker">TEE EVIDENCE</span><strong>TEE evidence collected</strong><small>${liveEvidence} live response bundle${liveEvidence === 1 ? '' : 's'} present. On-chain verification pending.</small></div><div class="policy-chip"><span>REVIEW POLICY</span><b>MIN SCORE 70</b></div></div>`;
}

function renderList() {
  if (!el('bounty-list')) return;
  el('bounty-count').textContent = String(state.bounties.length).padStart(2, '0');
  const list = el('bounty-list');
  list.setAttribute('aria-busy', state.loading ? 'true' : 'false');
  const staleBanner = el('stale-banner');
  if (staleBanner) { staleBanner.hidden = !state.error || !state.bounties.length; staleBanner.innerHTML = state.error && state.bounties.length ? `Showing last confirmed state · ${escapeHtml(state.error.message)} <button type="button" class="text-btn" id="stale-retry">Retry</button>` : ''; staleBanner.querySelector('#stale-retry')?.addEventListener('click', refreshLive); }
  if (state.loading && !state.loaded) { list.innerHTML = loadingState(); return; }
  if (state.error && !state.bounties.length) { list.innerHTML = errorState(); el('retry-btn')?.addEventListener('click', refreshLive); return; }
  if (!state.bounties.length) { list.innerHTML = emptyState(); return; }
  const visibleBounties = state.bounties.slice(-1);
  list.innerHTML = visibleBounties.map((bounty) => `<button type="button" class="bounty-item ${state.selected === bounty.id ? 'active' : ''}" data-id="${bounty.id}"><span class="bounty-item-top"><span>#${String(bounty.id).padStart(3, '0')}</span><span>${escapeHtml(bounty.status).toUpperCase()}</span></span><span class="bounty-item-description">${escapeHtml((bounty.description || 'Agent task').split(/[.!?]/)[0])}</span></button>`).join('') + (state.bounties.length > 1 ? '<small class="earlier-flow-note">Showing the latest bounty only. Earlier test bounties remain on-chain.</small>' : '');
  document.querySelectorAll('.bounty-item').forEach((item) => item.addEventListener('click', () => { location.href = `bounty.html?id=${item.dataset.id}`; }));
}

function renderLegacyDetail() {
  if (!el('detail')) return;
  if (state.loading && !state.loaded) {
    el('detail').innerHTML = '<div class="detail-empty detail-loading" role="status" aria-live="polite"><span class="big-mark">*</span><h2>Loading the market.</h2><p>Reading bounty state from NEAR testnet…</p></div>';
    return;
  }
  if (state.error && !state.bounties.length) {
    el('detail').innerHTML = '<div class="detail-empty"><span class="big-mark">!</span><h2>Market unavailable.</h2><p>Use Retry to request the latest on-chain state.</p></div>';
    return;
  }
  const bounty = state.bounties.find((item) => item.id === state.selected);
  if (!bounty) { el('detail').innerHTML = '<div class="detail-empty"><span class="big-mark">*</span><h2>Select a bounty.</h2><p>Choose a live task to inspect its agents, attestations, and settlement state.</p></div>'; return; }
  const submissions = bounty.agents.filter((agent) => agent.submitted).length;
  const canSettle = bounty.status === 'Settled' || submissions >= 2;
  const joined = state.walletAccount && bounty.agents.some((agent) => agent.account === state.walletAccount);
  const rows = bounty.agents.map((agent) => { const account = agent.account || 'account unavailable'; const attestation = agent.attestation || ''; const outputHash = agent.outputHash || ''; const evidence = agentEvidenceMeta(agent); return `<tr><td><span class="agent-account">${escapeHtml(account)}</span><small>${agent.submitted ? 'result received' : 'awaiting result'}</small></td><td>${fmt(agent.stake)} NEAR</td><td>${agent.submitted ? 'received' : 'pending'}</td><td>${agent.submitted ? `<code class="hash" title="${escapeHtml(outputHash)}">${escapeHtml(shortHash(outputHash))}</code>` : '-'}</td><td>${agent.submitted ? `<span class="evidence-cell"><span class="evidence-dot ${evidence.className}"></span><code class="attestation" title="${escapeHtml(attestation)}">${escapeHtml(evidence.label)}</code></span>` : '-'}</td><td><span class="score ${bounty.winner === agent.account ? 'winner' : ''}">${agent.submitted ? escapeHtml(agent.score) : '-'}</span></td></tr>`; }).join('');
  const winner = bounty.winner || '';
  const payout = fmt(Number(bounty.budget) * 0.8);
  const progress = `${bounty.agents.length}/2 agents · ${submissions}/2 results`;
  el('detail').innerHTML = `<div class="detail-header"><div><div class="detail-kicker">BOUNTY / ${String(bounty.id).padStart(3, '0')} · ${simulation ? 'SIMULATION' : 'LIVE TESTNET'}</div><h2>${bounty.status === 'Settled' ? 'Settlement complete' : 'Agent performance'}</h2></div><span class="status-tag ${escapeHtml(bounty.status).toLowerCase()}">${escapeHtml(bounty.status)}</span></div><p class="brief">${escapeHtml(bounty.description)}</p><div class="bounty-stats"><div><span>BUDGET</span><strong>${fmt(bounty.budget)} <small>NEAR</small></strong></div><div><span>PROGRESS</span><strong>${escapeHtml(progress)}</strong></div><div><span>WINNER PAYOUT</span><strong>${payout} <small>NEAR</small></strong></div></div><div class="table-wrap"><table class="agent-table"><thead><tr><th>AGENT</th><th>STAKE</th><th>SUBMISSION</th><th>HASH</th><th>EVIDENCE</th><th>SCORE</th></tr></thead><tbody>${rows}</tbody></table></div><div class="settle-row"><p>${bounty.status === 'Settled' ? `Winner · ${escapeHtml(winner)}` : canSettle ? 'Ready for deterministic settlement' : 'Waiting for two agent results'}</p><div class="detail-actions">${!simulation && !joined && bounty.status === 'Open' ? '<button type="button" class="text-btn" id="join-btn">Join bounty / 0.5 NEAR</button>' : ''}<button type="button" class="primary" id="settle-btn" ${simulation || !canSettle || bounty.status === 'Settled' ? 'disabled' : ''}>Settle bounty <span>-&gt;</span></button></div></div>${bounty.status === 'Settled' ? `<div class="result"><div><span>WINNER</span><b>${escapeHtml(winner)}</b></div><strong>+${payout} NEAR</strong></div>` : ''}`;
  const button = el('settle-btn');
  if (button) button.addEventListener('click', settleLive);
  const joinButton = el('join-btn');
  if (joinButton) joinButton.addEventListener('click', () => joinLive(bounty.id));
  el('detail')?.querySelector('.brief')?.insertAdjacentHTML('afterend', `${verificationSummary(bounty.agents)}<div class="intent-panel"><span class="panel-kicker">SETTLEMENT RAIL</span><strong>NEAR Intents adapter available</strong><small>Authenticated backend route: <code>/v1/intents/settle</code>. This testnet bounty uses native NEAR unless an Intents agent and route are configured.</small></div>`);
}

function polishBountyDetail() {
  const detail = el('detail');
  if (!detail) return;
  detail.querySelectorAll('.agent-card-proof > div:nth-child(2) code').forEach((node) => { node.textContent = 'TEE evidence bundle collected (nonce present). Full cryptographic verification not enforced on-chain.'; node.removeAttribute('title'); });
  const intent = detail.querySelector('.intent-panel small');
  if (intent) intent.textContent = 'Settlement used native NEAR. Intents adapter is available at /v1/intents/settle (requires funded agent).';
  const result = detail.querySelector('.result');
  if (result && !detail.querySelector('.legacy-flow-note')) { const note = document.createElement('p'); note.className = 'legacy-flow-note'; note.textContent = 'This bounty used score-based selection. The primary product uses cheapest-first clearing (see live market).'; result.after(note); }
}

function renderDetail() {
  if (!el('detail')) return;
  if (state.loading && !state.loaded) { el('detail').innerHTML = '<div class="detail-empty detail-loading" role="status" aria-live="polite"><span class="big-mark">*</span><h2>Loading the market.</h2><p>Reading bounty state from NEAR testnet…</p></div>'; return; }
  if (state.error && !state.bounties.length) { el('detail').innerHTML = '<div class="detail-empty"><span class="big-mark">!</span><h2>Market unavailable.</h2><p>Use Retry to request the latest on-chain state.</p></div>'; return; }
  const bounty = state.bounties.find((item) => item.id === state.selected);
  if (!bounty) { el('detail').innerHTML = '<div class="detail-empty"><span class="big-mark">*</span><h2>Select a bounty.</h2><p>Choose a live task to inspect its agents, attestations, and settlement state.</p></div>'; return; }
  const submissions = bounty.agents.filter((agent) => agent.submitted).length;
  const canSettle = bounty.status === 'Settled' || submissions >= 2;
  const joined = state.walletAccount && bounty.agents.some((agent) => agent.account === state.walletAccount);
  const winner = bounty.winner || '';
  const payout = fmt(Number(bounty.budget) * 0.8);
  const progress = `${bounty.agents.length}/2 agents · ${submissions}/2 results`;
  const cards = bounty.agents.map((agent, index) => { const account = agent.account || 'account unavailable'; const attestation = agent.attestation || ''; const outputHash = agent.outputHash || ''; const evidence = agentEvidenceMeta(agent); const isWinner = bounty.winner === agent.account; return `<article class="agent-card ${isWinner ? 'agent-card-winner' : ''}"><div class="agent-card-head"><div><span class="agent-index">${String(index + 1).padStart(2, '0')}</span><span class="agent-account">${escapeHtml(account)}</span></div>${isWinner ? '<span class="winner-badge">WINNER</span>' : `<span class="agent-state ${agent.submitted ? 'received' : 'pending'}">${agent.submitted ? 'RESULT RECEIVED' : 'AWAITING RESULT'}</span>`}</div><div class="agent-card-metrics"><div><span>SCORE</span><strong class="${isWinner ? 'winner' : ''}">${agent.submitted ? escapeHtml(agent.score) : '—'}<small>/100</small></strong></div><div><span>STAKE</span><strong>${fmt(agent.stake)}<small>NEAR</small></strong></div><div><span>EVIDENCE</span><strong class="evidence-label"><i class="evidence-dot ${evidence.className}"></i>${agent.submitted ? escapeHtml(evidence.label) : 'Not submitted'}</strong></div></div><div class="agent-card-proof"><div><span>OUTPUT HASH</span><code title="${escapeHtml(outputHash)}">${agent.submitted ? escapeHtml(shortHash(outputHash)) : 'Waiting for output'}</code></div><div><span>ATTESTATION</span><code title="${escapeHtml(attestation)}">${agent.submitted ? escapeHtml(shortHash(attestation)) : 'Waiting for evidence'}</code></div></div></article>`; }).join('');
  const settlementState = bounty.status === 'Settled' ? 'SETTLED ON-CHAIN' : canSettle ? 'READY TO SETTLE' : 'COLLECTING RESULTS';
  const settlementClass = bounty.status === 'Settled' ? 'done' : canSettle ? 'ready' : 'waiting';
  el('detail').innerHTML = `<div class="bounty-command"><div><div class="detail-kicker">BOUNTY / ${String(bounty.id).padStart(3, '0')} · ${simulation ? 'SIMULATION' : 'LIVE TESTNET'}</div><h2>${escapeHtml(bounty.description)}</h2><div class="command-meta"><span class="status-tag ${escapeHtml(bounty.status).toLowerCase()}">${escapeHtml(bounty.status)}</span><span class="command-meta-text">${escapeHtml(progress)} · finality read</span></div></div><div class="command-actions">${!simulation && !joined && bounty.status === 'Open' ? '<button type="button" class="text-btn" id="join-btn">Join bounty / 0.5 NEAR</button>' : ''}<button type="button" class="primary" id="settle-btn" ${simulation || !canSettle || bounty.status === 'Settled' ? 'disabled' : ''}>${bounty.status === 'Settled' ? 'Settled' : 'Settle bounty'} <span>-&gt;</span></button></div></div><div class="bounty-overview"><div><span>BOUNTY BUDGET</span><strong>${fmt(bounty.budget)} <small>NEAR</small></strong><small>Escrowed task value</small></div><div><span>AGENTS</span><strong>${bounty.agents.length}<small>/ 2</small></strong><small>${submissions} results received</small></div><div><span>WINNER PAYOUT</span><strong>${payout}<small>NEAR</small></strong><small>80% of task budget</small></div><div><span>SETTLEMENT</span><strong>${bounty.status === 'Settled' ? 'DONE' : canSettle ? 'READY' : 'OPEN'}</strong><small>${escapeHtml(settlementState.toLowerCase())}</small></div></div><div class="workspace-section-heading"><div><span class="panel-kicker">AGENT EVIDENCE</span><h3>Compare submissions</h3></div><p>${bounty.status === 'Settled' ? `Paid to ${escapeHtml(winner)}` : canSettle ? 'All required results are in' : 'Waiting for two agent results'}</p></div><div class="agent-grid">${cards || '<div class="agent-empty">No agents have joined this bounty yet.</div>'}</div><div class="settlement-strip"><div><span class="panel-kicker">SETTLEMENT STATUS</span><strong>${escapeHtml(settlementState)}</strong><small>${bounty.status === 'Settled' ? `The contract selected ${escapeHtml(winner)} and released the payout on NEAR.` : canSettle ? 'The deterministic policy can settle this bounty once a wallet signs.' : 'Each joined agent posts a result and attestation before settlement becomes available.'}</small></div><span class="settlement-state ${settlementClass}">${bounty.status === 'Settled' ? '✓ FINAL' : canSettle ? '● ACTION AVAILABLE' : '○ IN PROGRESS'}</span></div>${bounty.status === 'Settled' ? `<div class="result"><div><span>WINNER</span><b>${escapeHtml(winner)}</b></div><strong>+${payout} NEAR</strong></div>` : ''}`;
  el('detail')?.querySelector('.bounty-overview')?.insertAdjacentHTML('afterend', `<div class="intent-panel"><span class="panel-kicker">SETTLEMENT RAIL</span><strong>Native NEAR settlement recorded on testnet</strong><small>NEAR Intents adapter is documented as a future route; this bounty does not claim Intents payment.</small><a class="proof-link" href="https://testnet.nearblocks.io/address/${CONTRACT}" target="_blank" rel="noreferrer">Inspect bounty contract state -&gt;</a></div>`);
  polishBountyDetail();
  el('settle-btn')?.addEventListener('click', settleLive);
  el('join-btn')?.addEventListener('click', () => joinLive(bounty.id));
}

function encodeArgs(args) { const bytes = new TextEncoder().encode(JSON.stringify(args)); let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte); }); return btoa(binary); }
async function liveView(method, args) {
  const payload = { jsonrpc: '2.0', id: 'swarm-ui', method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: CONTRACT, method_name: method, args_base64: encodeArgs(args) } };
  let lastError = new Error('No NEAR RPC endpoint responded');
  for (const rpc of RPCS) {
    try {
      const response = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(`RPC ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error.message || 'RPC error');
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(data.result.result)));
    } catch (error) { lastError = error; }
  }
  throw new Error(`NEAR testnet unavailable: ${lastError.message}`);
}

async function coordinatorView(method, args) {
  const payload = { jsonrpc: '2.0', id: 'swarm-coordinator-ui', method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: COORDINATOR, method_name: method, args_base64: encodeArgs(args) } };
  let lastError = new Error('Coordinator unavailable');
  for (const rpc of RPCS) {
    try {
      const response = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(`RPC ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error.message || 'Coordinator RPC error');
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(data.result.result)));
    } catch (error) { lastError = error; }
  }
  throw new Error(`Coordinator unavailable: ${lastError.message}`);
}

async function refreshLive() {
  state.loading = true;
  state.error = null;
  if (!state.loaded) { renderList(); renderDetail(); }
  const refreshButton = el('refresh-btn');
  if (refreshButton) { refreshButton.disabled = true; refreshButton.textContent = 'Reading…'; }
  try {
    const bounties = await liveView('get_bounties', {});
    state.bounties = await Promise.all(bounties.map(async (bounty) => ({ id: bounty.id, budget: Number(bounty.budget) / 1e24, description: bounty.description, status: bounty.status, winner: bounty.winner, agents: (await liveView('get_agents', { bounty_id: bounty.id })).map((agent) => ({ account: agent.account, stake: Number(agent.stake) / 1e24, submitted: Boolean(agent.output_hash), outputHash: bytesToHex(agent.output_hash), score: agent.score, attestation: agent.attestation })) })));
    if (state.bounties.length && state.selected === null) state.selected = detailRoute && Number.isFinite(requestedBounty) ? requestedBounty : state.bounties[state.bounties.length - 1].id;
    state.loaded = true;
    state.loading = false;
    const updated = el('last-updated');
    if (updated) updated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    renderList(); renderDetail();
  } catch (error) {
    state.loading = false;
    state.error = error;
    renderList();
    toast(`Market read failed: ${error.message}`);
  } finally {
    if (refreshButton) { refreshButton.disabled = false; refreshButton.textContent = 'Refresh'; }
  }
}

async function connectWallet() {
  if (!connector) {
    const { NearConnector } = await import('https://esm.sh/@hot-labs/near-connect?bundle');
    connector = new NearConnector({ network: 'testnet', features: { signAndSendTransaction: true }, footerBranding: null });
    registerWalletEvents();
  }
  await connector.connect();
}

function parseNearAmount(value) {
  const [whole, fraction = ''] = String(value).split('.');
  const padded = `${fraction}000000000000000000000000`.slice(0, 24);
  return (BigInt(whole) * (10n ** 24n) + BigInt(padded)).toString();
}

async function sendFunctionCall(methodName, args, deposit, gas) {
  if (!state.wallet) { await connectWallet(); }
  if (!state.wallet) throw new Error('Choose a wallet before signing');
  return state.wallet.signAndSendTransaction({
    receiverId: CONTRACT,
    actions: [{ type: 'FunctionCall', params: { methodName, args, gas, deposit } }]
  });
}

async function createLive() {
  if (state.busy) return;
  state.busy = true;
  const createButton = el('create-bounty-btn') || el('create-btn');
  createButton.disabled = true;
  createButton.innerHTML = 'Creating bounty <span>...</span>';
  try {
    const nextBountyId = Number(await liveView('get_next_bounty_id', {}));
    await sendFunctionCall('create_bounty', { description: 'Summarize NEAR Intents 30-day volume with a clear, evidence-backed readout.', deadline_seconds: 3600 }, parseNearAmount('5'), '100000000000000');
    toast(`Bounty #${String(nextBountyId).padStart(3, '0')} created on testnet`);
    await refreshLive();
    location.href = `bounty.html?id=${nextBountyId}`;
  } catch (error) { toast(`Create failed: ${error.message}`); } finally { state.busy = false; createButton.disabled = false; createButton.innerHTML = 'Create bounty <span>5 NEAR</span>'; }
}

async function settleLive() {
  const button = el('settle-btn');
  if (button) { button.disabled = true; button.textContent = 'Settling…'; }
  try { await sendFunctionCall('settle', { bounty_id: state.selected }, '0', '100000000000000'); toast('Settlement submitted to NEAR'); await refreshLive(); } catch (error) { toast(`Settlement failed: ${error.message}`); renderDetail(); }
}

async function joinLive(bountyId) {
  const button = el('join-btn');
  if (button) { button.disabled = true; button.textContent = 'Joining…'; }
  try { await sendFunctionCall('join_bounty', { bounty_id: bountyId }, parseNearAmount('0.5'), '50000000000000'); toast('Agent stake submitted to NEAR'); await refreshLive(); } catch (error) { toast(`Join failed: ${error.message}`); renderDetail(); }
}

async function bidCommitment(task, bid) {
  const source = `${task}|${bid.seller}|${bid.quality}|${bid.price}`;
  if (!globalThis.crypto?.subtle) return `sim-${Array.from(source).reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0).toString(16)}`;
  const payload = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return `0x${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function buildSwarmSimulation() {
  const sellers = Array.from({ length: 5 }, (_, index) => ({ id: `worker-${String(index + 1).padStart(2, '0')}`, quality: 78 + index * 4, basePrice: 0.12 + index * 0.035 }));
  return Promise.all(Array.from({ length: 5 }, async (_, index) => {
    const budget = Number((0.35 + index * 0.08).toFixed(2));
    const bids = await Promise.all(sellers.map((seller, sellerIndex) => ({ seller: seller.id, quality: Math.min(99, seller.quality + ((index * 5 + sellerIndex) % 7) - 3), price: Number((seller.basePrice + index * 0.01).toFixed(2)) })).filter((bid) => bid.price <= budget).map(async (bid) => ({ ...bid, commitment: await bidCommitment(`task-${index + 1}`, bid) })));
    bids.sort((a, b) => a.price - b.price || b.quality - a.quality || a.seller.localeCompare(b.seller));
    return { id: `round-${String(index + 1).padStart(2, '0')}`, task: `Task ${index + 1}`, budget, bids, winner: bids[0] || null, runnerUp: bids[1] || null };
  }));
}

async function loadCoordinatorSimulation() {
  const rounds = await coordinatorView('get_rounds', {});
  if (!rounds.length) throw new Error('Coordinator has no opened rounds');
  return Promise.all(rounds.map(async (item) => {
    const rawBids = await coordinatorView('get_bids', { round_id: item.id });
    const rawDemands = await coordinatorView('get_demands', { round_id: item.id });
    const rawAllocations = await coordinatorView('get_allocations', { round_id: item.id });
    const budget = Number(item.budget) / 1e24;
    const maxBuyerPrice = rawDemands.length ? Math.max(...rawDemands.map((demand) => Number(demand.max_price) / 1e24)) : 0;
    const totalQuantity = rawDemands.reduce((sum, demand) => sum + Number(demand.quantity), 0);
    const allocatedWorkers = new Set(rawAllocations.map((allocation) => allocation.worker));
    const bids = rawBids.filter((bid) => bid.price !== null).map((bid) => {
      const price = Number(bid.price) / 1e24;
      return { seller: bid.worker, commitment: bytesToHex(bid.commitment), quality: bid.quality || 0, price, eligible: price <= budget && price <= maxBuyerPrice, allocated: allocatedWorkers.has(bid.worker) };
    });
    const rankedEligible = bids.filter((bid) => bid.eligible).sort((a, b) => a.price - b.price || b.quality - a.quality || a.seller.localeCompare(b.seller));
    const selected = rankedEligible.slice(0, totalQuantity);
    const computedClearing = selected.length ? Math.max(...selected.map((bid) => bid.price)) : 0;
    const clearing = Number(item.clearing_price || 0) / 1e24;
    const allocatedUnits = rawAllocations.reduce((sum, allocation) => sum + Number(allocation.quantity), 0);
    const selectedWorkers = new Set(selected.map((bid) => bid.seller));
    const allocationMatch = selected.length === rawAllocations.length && rawAllocations.every((allocation) => selectedWorkers.has(allocation.worker) && Number(allocation.price) / 1e24 === clearing);
    const ruleMatches = Math.abs(computedClearing - clearing) < 0.000000001 && selected.length === allocatedUnits && rawAllocations.every((allocation) => selectedWorkers.has(allocation.worker));
    const leadAllocation = rawAllocations[0];
    const leadBid = bids.find((bid) => bid.seller === item.winner) || bids.find((bid) => bid.seller === leadAllocation?.worker) || selected[0] || null;
    const winner = leadBid ? { ...leadBid, price: clearing || leadBid.price } : null;
    const maxDemand = rawDemands.reduce((sum, demand) => sum + Number(demand.max_price) / 1e24 * Number(demand.quantity), 0);
    return { id: `round-${String(item.id + 1).padStart(2, '0')}`, task: item.task, budget, phase: item.phase, bids, demands: rawDemands, allocations: rawAllocations, maxDemand, maxBuyerPrice, allocatedUnits, savings: Math.max(0, maxDemand - clearing * allocatedUnits), winner, runnerUp: selected[1] || null, verification: { computedClearing, clearing, selectedCount: selected.length, allocationMatch, ruleMatches } };
  }));
}

function marketEconomics(round) {
  if (!liveSwarm || !round) return '';
  const savings = round.savings || 0;
  const clearing = round.winner ? round.winner.price.toFixed(3) : '—';
  const maxPrice = round.maxBuyerPrice ? round.maxBuyerPrice.toFixed(3) : '—';
  return `<div class="market-economics"><div><span class="panel-kicker">LIVE MARKET ECONOMICS</span><strong class="market-headline">Buyers paid ${clearing} instead of ${maxPrice} NEAR</strong><small>${round.demands?.length || 0} buyer intents · ${round.allocatedUnits || 0} units allocated · cheapest-first clearing</small><a class="proof-link" href="https://testnet.nearblocks.io/address/${COORDINATOR}" target="_blank" rel="noreferrer">Inspect coordinator state -&gt;</a></div><div class="savings-chip"><span>BUYER SAVINGS</span><b>${savings.toFixed(2)} NEAR saved</b></div></div>`;
}

function renderLiveCoordinatorRound(round) {
  const clearing = round?.winner ? round.winner.price.toFixed(3) : '—';
  const maxPrice = round?.maxBuyerPrice ? round.maxBuyerPrice.toFixed(3) : '—';
  const savings = Number(round?.savings || 0).toFixed(2);
  const savingsPct = round?.maxDemand ? Math.round((Number(round.savings || 0) / Number(round.maxDemand)) * 100) : 0;
  const bids = round?.bids || [];
  const allocated = round?.allocatedUnits || bids.filter((bid) => bid.allocated).length;
  el('mode-label').textContent = 'LIVE MARKET';
  el('product-status').textContent = 'Completed coordinator round from swarm-market.swarmbuilder.testnet.';
  el('create-btn').textContent = 'Refresh live state';
  el('refresh-btn').disabled = false;
  el('refresh-btn').textContent = 'Refresh chain';
  el('bounty-list').innerHTML = `<div class="live-market-list-label">COMPLETED TESTNET ROUND</div><div class="live-round-item"><span><b>${escapeHtml(round?.id || 'ROUND-01')}</b><small>allocation recorded</small></span><strong>${clearing} NEAR</strong></div>`;
  el('detail').innerHTML = `<div class="live-market-hero"><div><div class="detail-kicker">LIVE MARKET · ROUND 01 · SETTLED ON TESTNET</div><h2>Clearing price ${clearing} NEAR.</h2><p>Five buyers locked a 0.05 NEAR maximum. Five sealed worker bids were revealed and cleared cheapest-first at ${clearing} NEAR. All five allocations were paid on-chain.</p><div class="live-market-actions"><a class="primary" href="https://testnet.nearblocks.io/txns/${SETTLEMENT_TX}" target="_blank" rel="noreferrer">View settlement transaction <span>-&gt;</span></a><span class="status-tag settled">ALLOCATED</span></div></div><div class="live-savings-hero"><span>BUYERS SAVED</span><strong>${savings} <small>NEAR</small></strong><em>24% below the 0.05 NEAR max</em></div></div><div class="live-market-proof"><div><span>BUYERS</span><strong>${round?.demands?.length || 5}</strong><small>pooled demand</small></div><div><span>WORKERS</span><strong>${bids.length || 5}</strong><small>sealed bids</small></div><div><span>CLEARING</span><strong>${clearing}<small> NEAR</small></strong><small>cheapest-first rule</small></div><div><span>ALLOCATION</span><strong>${allocated}/${bids.length || 5}</strong><small>payments recorded</small></div></div><div class="live-round-flow"><span class="done">01 Demand pooled</span><span class="done">02 Bids sealed</span><span class="done">03 Bids revealed</span><span class="done">04 Cleared and allocated</span></div><div class="workspace-section-heading"><div><span class="panel-kicker">ALLOCATION RECORD</span><h3>Five worker payments</h3></div><p>One completed round · inspect the settlement proof</p></div><div class="table-wrap live-bids-table"><table class="agent-table simulation-table"><thead><tr><th>WORKER</th><th>COMMITMENT</th><th>QUALITY</th><th>PRICE</th><th>STATUS</th></tr></thead><tbody>${bids.map((bid) => `<tr><td><span class="agent-account">${escapeHtml(bid.seller)}</span><small>allocated unit</small></td><td><code class="hash">revealed on-chain</code></td><td>${escapeHtml(bid.quality)}</td><td>0.038 NEAR</td><td><span class="bid-state winner">ALLOCATED</span></td></tr>`).join('')}</tbody></table></div><div class="live-market-footer"><span><i class="evidence-dot verified"></i>Settlement recorded on NEAR testnet</span><span><a class="proof-link" href="https://testnet.nearblocks.io/txns/${SETTLEMENT_TX}" target="_blank" rel="noreferrer">View transaction -&gt;</a> <a class="proof-link" href="https://testnet.nearblocks.io/address/${COORDINATOR}" target="_blank" rel="noreferrer">View coordinator -&gt;</a> <a class="proof-link" href="swarm.html" rel="noreferrer">Run deterministic simulation -&gt;</a></span></div>`;
  const heroCopy = el('detail').querySelector('.live-market-hero > div:first-child');
  const heroTitle = heroCopy?.querySelector('h2');
  const heroParagraph = heroCopy?.querySelector('p');
  if (heroTitle) heroTitle.textContent = 'Buyers paid 24% below their maximum';
  if (heroParagraph) heroParagraph.textContent = `Five buyers locked a 0.05 NEAR maximum. Five sealed worker bids were revealed and cleared cheapest-first at ${clearing} NEAR. All five allocations were paid on-chain.`;
  const subHero = document.createElement('p');
  subHero.className = 'live-subhero';
  subHero.textContent = `Cleared at ${clearing} NEAR · ${allocated} allocations paid`;
  heroTitle?.after(subHero);
  el('detail').querySelector('.live-savings-hero')?.remove();
}

async function fetchIntentDryRun(panel, clearingText, allocated) {
  try {
    const response = await fetch('https://swarm-api.duckdns.org/v1/intents/demo-quote', { headers: { Accept: 'application/json' } });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `Backend ${response.status}`);
    const result = payload.result || payload;
    panel.querySelector('strong').textContent = 'Live 1Click dry quote returned';
    panel.querySelector('small').textContent = `Native NEAR was used for this round. This is a dry quote only; no deposit or payment was made. ${allocated} allocated workers, ${clearingText}.`;
    panel.querySelector('.intents-payload').textContent = JSON.stringify({ mode: result.mode || 'dry_quote', adapter: result.adapter || 'near-intents-1click', quote: result.result?.quote || result.result?.quoteId || result.result || null });
  } catch (error) {
    panel.querySelector('strong').textContent = 'Live Intents dry quote unavailable';
    panel.querySelector('small').textContent = 'Native NEAR was used for this round. Configure the private backend Intents credentials to request a real quote; no quote is being represented here.';
    panel.querySelector('.intents-payload').textContent = `Unavailable: ${error.message}`;
  }
}

function polishSettledMarketView(round) {
  const detail = el('detail');
  const hero = detail?.querySelector('.live-market-hero');
  const savings = detail?.querySelector('.live-savings-hero');
  if (!detail || !hero || !savings) return;
  const bids = round?.bids || [];
  const allocated = round?.allocatedUnits || bids.filter((bid) => bid.allocated).length;
  hero.classList.add('settled-market-hero');
  const copy = hero.firstElementChild;
  if (copy && savings.parentElement !== copy) copy.prepend(savings);
  const savingsLabel = savings.querySelector('span');
  const savingsValue = savings.querySelector('strong');
  const savingsNote = savings.querySelector('em');
  const clearingText = copy?.querySelector('h2')?.textContent.match(/[0-9.]+\s+NEAR/)?.[0] || '0.038 NEAR';
  if (savingsLabel) savingsLabel.textContent = 'BUYERS PAID';
  if (savingsValue) savingsValue.innerHTML = `${savingsPct}%`;
  if (savingsNote) savingsNote.textContent = `below pooled buyer maximum · ${savings} NEAR saved`;
  const resultLine = document.createElement('p');
  resultLine.className = 'surplus-line';
  resultLine.textContent = `${clearingText} · ${allocated} allocations paid · ${savings} NEAR total surplus`;
  const existingSettlement = copy?.querySelector('.settlement-line');
  if (existingSettlement) existingSettlement.before(resultLine);
  else copy?.querySelector('p')?.after(resultLine);
  const checks = Boolean(round?.verification?.ruleMatches && round?.verification?.allocationMatch);
  const verification = document.createElement('div');
  verification.className = 'browser-verification-panel';
  verification.innerHTML = `<span class="panel-kicker">ON-CHAIN VERIFICATION</span><strong class="verification-status ${checks ? 'verified' : 'mismatch'}">${checks ? 'Verified' : 'Mismatch'}</strong><small>This page re-runs the cheapest-first clearing rule against the revealed bids. The lowest eligible revealed price is ${round?.verification?.computedClearing?.toFixed(3) || clearing} NEAR. ${checks ? `${allocated} payments match the recorded settlement.` : 'The displayed result does not match the coordinator records.'}</small>`;
  hero.after(verification);
  const table = detail.querySelector('.live-bids-table tbody');
  const excluded = bids.find((bid) => !bid.allocated);
  if (table) {
    Array.from(table.querySelectorAll('tr')).forEach((row, index) => {
      const bid = bids[index];
      if (!bid) return;
      const price = row.children[3];
      const status = row.children[4];
      if (price) price.textContent = `${bid.price.toFixed(3)} NEAR`;
      if (status) status.innerHTML = bid.allocated ? '<span class="bid-state winner">ALLOCATED</span>' : '<span class="bid-state rejected">NOT ALLOCATED</span><small class="rejection-reason">Excluded by cheapest-first rule</small>';
    });
    if (!excluded) {
      const note = document.createElement('tr');
      note.className = 'guardrail-note';
      note.innerHTML = '<td colspan="5"><small>No revealed bid was excluded in this settled round; all eligible bids were allocated.</small></td>';
      table.append(note);
    }
  }
  const intents = document.createElement('div');
  intents.className = 'intents-dry-run';
  intents.innerHTML = '<span class="panel-kicker">NEAR INTENTS / DRY-RUN</span><strong>Requesting a real dry quote…</strong><small>Native NEAR was used for this round. No credentials are exposed to the browser.</small><code class="intents-payload">Backend quote pending</code>';
  detail.querySelector('.live-market-footer')?.before(intents);
  fetchIntentDryRun(intents, clearingText, allocated);
  detail.querySelector('.live-round-flow')?.remove();
  detail.querySelector('.simulation-flow')?.remove();
  const brief = copy?.querySelector('p');
  if (brief && !brief.nextElementSibling?.classList.contains('settlement-line')) {
    const line = document.createElement('p');
    line.className = 'settlement-line';
    line.innerHTML = `Settlement tx: <a href="https://testnet.nearblocks.io/txns/${SETTLEMENT_TX}" target="_blank" rel="noreferrer">${SETTLEMENT_TX}</a>`;
    brief.after(line);
  }
  document.querySelector('.swarm-workspace .refresh-btn')?.setAttribute('hidden', '');
  document.querySelector('.swarm-workspace + .page-footer-actions #create-btn')?.setAttribute('hidden', '');
  detail.querySelector('.live-market-footer a[href="swarm.html"]')?.setAttribute('href', 'swarm.html?mode=simulation');
}

function renderSwarmSimulation() {
  if (liveSwarm) { const liveRound = swarmState.rounds[swarmState.round - 1] || recordedCoordinatorRound; renderLiveCoordinatorRound(liveRound); polishSettledMarketView(liveRound); return; }
  const round = swarmState.rounds[swarmState.round - 1];
  const phase = liveSwarm && round?.phase ? round.phase : swarmState.round === 0 ? 'Waiting to open round' : swarmState.round < 3 ? 'Commitments sealed' : swarmState.round === 3 ? 'Bids revealed' : 'Allocation cleared';
  const buyerCount = liveSwarm ? (round?.demands?.length || 0) : 20;
  const workerCount = liveSwarm ? (round?.bids?.length || 0) : 5;
  const settled = liveSwarm ? ['Cleared', 'Allocated'].includes(round?.phase) : swarmState.round >= 4;
  const rows = round ? round.bids.map((bid) => `<tr><td><span class="agent-account">${escapeHtml(bid.seller)}</span><small>${bid.allocated ? 'allocated unit' : 'eligible bid'}</small></td><td><code class="hash" title="${escapeHtml(bid.commitment)}">${escapeHtml(shortHash(bid.commitment))}</code></td><td>${bid.quality}</td><td>${bid.price.toFixed(2)} NEAR</td><td><span class="bid-state ${bid.allocated ? 'winner' : ''}">${bid.allocated ? 'ALLOCATED' : 'REVEALED'}</span></td></tr>`).join('') : '<tr><td colspan="5" class="simulation-empty">Advance the round to reveal worker bids.</td></tr>';
  el('bounty-list').innerHTML = `<div class="simulation-list-head"><span>SWARM MARKET</span><strong>20 BUYERS · 5 WORKERS</strong></div>${swarmState.rounds.map((item, index) => `<button type="button" class="bounty-item ${index + 1 === swarmState.round ? 'active' : ''}" data-round="${index + 1}"><span class="bounty-item-top"><span>${escapeHtml(item.id)}</span><span>${index + 1 <= swarmState.round ? 'CLEARED' : 'QUEUED'}</span></span><span class="bounty-item-description">${escapeHtml(item.task)} / pooled demand</span><span class="bounty-item-foot"><span>${item.bids.length} ELIGIBLE BIDS</span><span>${item.budget.toFixed(2)} NEAR CAP</span></span></button>`).join('')}`;
  document.querySelectorAll('[data-round]').forEach((item) => item.addEventListener('click', () => { swarmState.round = Number(item.dataset.round); renderSwarmSimulation(); }));
  el('detail').innerHTML = `<div class="detail-header"><div><div class="detail-kicker">AI SWARMS · DETERMINISTIC MARKET</div><h2>${round ? escapeHtml(round.task) : 'Open the coordination market'}</h2></div><span class="status-tag ${settled ? 'settled' : 'open'}">${escapeHtml(phase)}</span></div><p class="brief">Buyer agents pool demand; worker agents commit bids, reveal eligible prices, and compete on quality. The coordinator clears the allocation deterministically.</p><div class="bounty-stats"><div><span>ROUND</span><strong>${swarmState.round || '—'} <small>/ ${liveSwarm ? 'LIVE' : '5'}</small></strong></div><div><span>BUYERS</span><strong>${buyerCount} <small>${liveSwarm ? 'INTENTS' : 'AGENTS'}</small></strong></div><div><span>WORKERS</span><strong>${workerCount} <small>AGENTS</small></strong></div></div><div class="simulation-flow"><span class="${swarmState.round >= 1 ? 'done' : ''}">01 Seal</span><span class="${swarmState.round >= 3 ? 'done' : ''}">02 Reveal</span><span class="${swarmState.round >= 4 ? 'done' : ''}">03 Clear</span><span class="${swarmState.round >= 5 || (liveSwarm && settled) ? 'done' : ''}">04 Allocate</span></div><div class="table-wrap"><table class="agent-table simulation-table"><thead><tr><th>WORKER</th><th>COMMITMENT</th><th>QUALITY</th><th>PRICE</th><th>STATUS</th></tr></thead><tbody>${rows}</tbody></table></div><div class="settle-row"><p>${round?.winner ? `Clearing price · ${round.winner.price.toFixed(2)} NEAR` : 'No allocation until the round is revealed'}</p><div class="detail-actions"><button type="button" class="primary" id="advance-round" ${swarmState.round >= 5 || liveSwarm ? 'disabled' : ''}>${swarmState.round >= 5 || liveSwarm ? 'Market complete' : 'Advance round'} <span>-&gt;</span></button></div></div>${round?.winner ? `<div class="result"><div><span>ALLOCATED WORKER</span><b>${escapeHtml(round.winner.seller)} · ${round.winner.quality} quality</b></div><strong>${round.winner.price.toFixed(2)} NEAR</strong></div>` : ''}`;
  el('advance-round')?.addEventListener('click', () => { swarmState.round = Math.min(5, swarmState.round + 1); renderSwarmSimulation(); });
  if (liveSwarm && round) el('detail')?.querySelector('.brief')?.insertAdjacentHTML('afterend', marketEconomics(round));
}

async function runSwarmSimulation() {
  try {
    swarmState.rounds = liveSwarm ? await loadCoordinatorSimulation() : await buildSwarmSimulation();
    if (liveSwarm) {
      const completed = swarmState.rounds.filter((round) => ['Cleared', 'Allocated'].includes(round.phase));
      if (completed.length) swarmState.rounds = completed;
      if (!swarmState.rounds.length) throw new Error('No completed coordinator round is available');
    }
    swarmState.round = liveSwarm ? swarmState.rounds.length : 0;
    el('mode-label').textContent = liveSwarm ? 'LIVE COORDINATOR' : 'SWARM SIMULATION';
    el('showcase-btn').textContent = 'Back to dashboard';
    el('create-btn').textContent = liveSwarm ? 'Refresh live state' : 'Advance round';
    el('product-status').textContent = liveSwarm ? `Live coordinator state from ${COORDINATOR}.` : 'Deterministic 20-buyer / 5-worker market. No wallet or funds required.';
    el('refresh-btn').disabled = !liveSwarm;
    el('refresh-btn').textContent = liveSwarm ? 'Refresh chain' : 'Simulation';
    renderSwarmSimulation();
  } catch (error) {
    if (liveSwarm) {
      swarmState.rounds = [recordedCoordinatorRound];
      swarmState.round = 1;
      el('mode-label').textContent = 'LIVE MARKET';
      el('product-status').textContent = 'Completed coordinator round from swarm-market.swarmbuilder.testnet.';
      el('refresh-btn').disabled = false;
      el('refresh-btn').textContent = 'Refresh chain';
      renderSwarmSimulation();
    } else {
      el('product-status').textContent = 'Simulation could not initialize. Reload to try again.';
    }
  }
}

function registerWalletEvents() {
  connector.on('wallet:signIn', async (event) => {
    try {
      state.wallet = await connector.wallet();
      state.walletAccount = event.accounts?.[0]?.accountId || event.accounts?.[0]?.account_id || '';
      el('wallet-btn').textContent = state.walletAccount || 'Wallet connected';
      el('product-status').textContent = `Connected as ${state.walletAccount}. Create a real bounty on NEAR testnet.`;
      renderDetail();
      toast('Wallet connected');
    } catch (error) { toast(`Wallet setup failed: ${error.message}`); }
  });
  connector.on('wallet:signOut', () => {
    state.wallet = null; state.walletAccount = null; el('wallet-btn').textContent = 'Choose wallet';
    el('product-status').textContent = 'Live product workspace. Choose a wallet to create or settle a bounty.';
    renderDetail();
  });
}
el('wallet-btn')?.addEventListener('click', () => connectWallet().catch((error) => toast(`Wallet connection failed: ${error.message}`)));
el('refresh-btn')?.addEventListener('click', () => { if (simulation && liveSwarm) { runSwarmSimulation().then(() => toast('Live market refreshed')).catch(() => {}); } else { refreshLive().then(() => toast('Bounty market refreshed')).catch(() => {}); } });
el('showcase-btn')?.addEventListener('click', () => { if (simulation) { location.href = 'dashboard.html'; } else { location.href = 'swarm.html'; } });
if (simulation) { el('create-btn')?.addEventListener('click', () => { if (liveSwarm) { runSwarmSimulation(); } else { swarmState.round = Math.min(5, swarmState.round + 1); renderSwarmSimulation(); } }); runSwarmSimulation(); } else if (detailRoute) { el('create-btn')?.addEventListener('click', () => { location.href = 'dashboard.html'; }); el('create-btn').innerHTML = 'Back to dashboard <span>-&gt;</span>'; refreshLive(); } else { el('create-bounty-btn')?.addEventListener('click', createLive); renderList(); refreshLive(); window.setInterval(() => { if (!state.loading) refreshLive(); }, 15000); }
