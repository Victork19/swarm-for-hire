import { NearConnector } from 'https://esm.sh/@hot-labs/near-connect?bundle';

const CONTRACT = 'swarm-bounty.swarmbuilder.testnet';
const RPC = 'https://rpc.testnet.near.org';
const AGENT1 = 'agent1.swarmbuilder.testnet';
const AGENT2 = 'agent2.swarmbuilder.testnet';
const params = new URLSearchParams(location.search);
const showcase = params.get('mode') === 'showcase';
// Require transaction signing, but do not hard-filter the manifest by network:
// this keeps HOT and other supported wallets visible in the standard selector.
const connector = new NearConnector({ features: { signAndSendTransaction: true }, footerBranding: null });
const state = { bounties: [], selected: null, wallet: null, walletAccount: null };
const el = (id) => document.getElementById(id);
const fmt = (value) => Number(value).toFixed(2);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const demoAgents = [{ account: AGENT1, stake: 0.5, submitted: true, score: 90, attestation: 'demo-tee-quote-v2-a1b2c3d4' }, { account: AGENT2, stake: 0.5, submitted: true, score: 75, attestation: 'demo-tee-quote-v2-e5f6a7b8' }];

function toast(message) { const target = el('toast'); target.textContent = message; target.classList.add('show'); window.setTimeout(() => target.classList.remove('show'), 3000); }
function emptyState() { return '<div class="empty"><span>-</span><p>No bounty found on testnet.</p><small>Create the first task to open the market.</small></div>'; }

function renderList() {
  el('bounty-count').textContent = String(state.bounties.length).padStart(2, '0');
  const list = el('bounty-list');
  if (!state.bounties.length) { list.innerHTML = emptyState(); return; }
  list.innerHTML = state.bounties.map((bounty) => `<button type="button" class="bounty-item ${state.selected === bounty.id ? 'active' : ''}" data-id="${bounty.id}"><span class="bounty-item-top"><span>#${String(bounty.id).padStart(3, '0')}</span><span>${escapeHtml(bounty.status).toUpperCase()}</span></span><span class="bounty-item-description">${escapeHtml(bounty.description)}</span><span class="bounty-item-foot"><span>${bounty.agents.length} / 2 AGENTS</span><span>${fmt(bounty.budget)} NEAR</span></span></button>`).join('');
  document.querySelectorAll('.bounty-item').forEach((item) => item.addEventListener('click', () => { state.selected = Number(item.dataset.id); renderList(); renderDetail(); }));
}

function renderDetail() {
  const bounty = state.bounties.find((item) => item.id === state.selected);
  if (!bounty) { el('detail').innerHTML = '<div class="detail-empty"><span class="big-mark">*</span><h2>Select a bounty.</h2><p>Choose a live task to inspect its agents, attestations, and settlement state.</p></div>'; return; }
  const submissions = bounty.agents.filter((agent) => agent.submitted).length;
  const canSettle = bounty.status === 'Settled' || submissions >= 2;
  const joined = state.walletAccount && bounty.agents.some((agent) => agent.account === state.walletAccount);
  const rows = bounty.agents.map((agent) => { const account = agent.account || 'account unavailable'; const attestation = agent.attestation || ''; return `<tr><td><span class="agent-account">${escapeHtml(account)}</span><small>${agent.submitted ? 'TEE worker complete' : 'awaiting worker'}</small></td><td>${fmt(agent.stake)} NEAR</td><td>${agent.submitted ? 'received' : 'pending'}</td><td>${agent.submitted ? `<code class="attestation" title="${escapeHtml(attestation)}">${escapeHtml(attestation)}</code>` : '-'}</td><td><span class="score ${bounty.winner === agent.account ? 'winner' : ''}">${agent.submitted ? escapeHtml(agent.score) : '-'}</span></td></tr>`; }).join('');
  const winner = bounty.winner || '';
  const payout = fmt(Number(bounty.budget) * 0.8);
  el('detail').innerHTML = `<div class="detail-header"><div><div class="detail-kicker">BOUNTY / ${String(bounty.id).padStart(3, '0')} - ${showcase ? 'SHOWCASE' : 'LIVE TESTNET'}</div><h2>Agent performance</h2></div><span class="status-tag ${escapeHtml(bounty.status).toLowerCase()}">${escapeHtml(bounty.status)}</span></div><p class="brief">${escapeHtml(bounty.description)}</p><div class="table-wrap"><table class="agent-table"><thead><tr><th>AGENT</th><th>STAKE</th><th>SUBMISSION</th><th>QUOTE</th><th>SCORE</th></tr></thead><tbody>${rows}</tbody></table></div><div class="settle-row"><p>${bounty.status === 'Settled' ? `Settled - winner ${escapeHtml(winner)}` : canSettle ? 'Two submissions are ready for settlement' : 'Waiting for two submissions'}</p><div class="detail-actions">${!showcase && !joined && bounty.status === 'Open' ? '<button type="button" class="text-btn" id="join-btn">Join bounty / 0.5 NEAR</button>' : ''}<button type="button" class="primary" id="settle-btn" ${showcase || !canSettle || bounty.status === 'Settled' ? 'disabled' : ''}>Settle bounty <span>-&gt;</span></button></div></div>${bounty.status === 'Settled' ? `<div class="result"><span>WINNER / ${escapeHtml(winner)}</span><strong>+${payout} NEAR</strong></div>` : ''}`;
  const button = el('settle-btn');
  if (button) button.addEventListener('click', settleLive);
  const joinButton = el('join-btn');
  if (joinButton) joinButton.addEventListener('click', () => joinLive(bounty.id));
}

function encodeArgs(args) { const bytes = new TextEncoder().encode(JSON.stringify(args)); let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte); }); return btoa(binary); }
async function liveView(method, args) { const payload = { jsonrpc: '2.0', id: 'swarm-ui', method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: CONTRACT, method_name: method, args_base64: encodeArgs(args) } }; const response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); if (!response.ok) throw new Error(`RPC ${response.status}`); const data = await response.json(); if (data.error) throw new Error(data.error.message || 'RPC error'); return JSON.parse(new TextDecoder().decode(Uint8Array.from(data.result.result))); }

async function refreshLive() {
  try {
    const bounties = await liveView('get_bounties', {});
    state.bounties = await Promise.all(bounties.map(async (bounty) => ({ id: bounty.id, budget: Number(bounty.budget) / 1e24, description: bounty.description, status: bounty.status, winner: bounty.winner, agents: (await liveView('get_agents', { bounty_id: bounty.id })).map((agent) => ({ account: agent.account, stake: Number(agent.stake) / 1e24, submitted: Boolean(agent.output_hash), score: agent.score, attestation: agent.attestation })) })));
    if (state.bounties.length && state.selected === null) state.selected = state.bounties[state.bounties.length - 1].id;
    renderList(); renderDetail();
  } catch (error) { renderList(); toast(`Market read failed: ${error.message}`); }
}

async function connectWallet() {
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
  try { await sendFunctionCall('create_bounty', { description: 'Summarize NEAR Intents 30-day volume with a clear, evidence-backed readout.', deadline_seconds: 3600 }, parseNearAmount('5'), '100000000000000'); toast('Bounty created on testnet'); await refreshLive(); } catch (error) { toast(`Create failed: ${error.message}`); }
}

async function settleLive() {
  try { await sendFunctionCall('settle', { bounty_id: state.selected }, '0', '100000000000000'); toast('Settlement submitted to NEAR'); await refreshLive(); } catch (error) { toast(`Settlement failed: ${error.message}`); }
}

async function joinLive(bountyId) {
  try { await sendFunctionCall('join_bounty', { bounty_id: bountyId }, parseNearAmount('0.5'), '50000000000000'); toast('Agent stake submitted to NEAR'); await refreshLive(); } catch (error) { toast(`Join failed: ${error.message}`); }
}

function runShowcase() { state.bounties = [{ id: 0, budget: 5, description: 'Summarize NEAR Intents 30-day volume with a clear, evidence-backed readout.', status: 'Open', agents: [] }]; state.selected = 0; renderList(); renderDetail(); window.setTimeout(() => { state.bounties[0].agents = demoAgents.map((agent) => ({ ...agent })); renderList(); renderDetail(); toast('Showcase workers returned attested output'); }, 900); window.setTimeout(() => { state.bounties[0].status = 'Settled'; state.bounties[0].winner = AGENT1; renderList(); renderDetail(); toast('Showcase settlement completed'); }, 1800); }

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
el('wallet-btn').addEventListener('click', () => connectWallet().catch((error) => toast(`Wallet connection failed: ${error.message}`)));
if (!showcase) el('create-btn').addEventListener('click', createLive);
el('showcase-btn').addEventListener('click', () => { if (showcase) { location.href = location.pathname; return; } location.href = `${location.pathname}?mode=showcase`; });
if (showcase) { el('mode-label').textContent = 'SHOWCASE MODE'; el('showcase-btn').textContent = 'Back to live market'; el('create-btn').textContent = 'Run showcase'; el('create-btn').addEventListener('click', runShowcase); el('product-status').textContent = 'Deterministic walkthrough. No wallet or funds required.'; runShowcase(); } else { renderList(); refreshLive(); }
