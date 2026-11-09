const CONTRACT = 'swarm-bounty.swarmbuilder.testnet';
const RPC = 'https://rpc.testnet.near.org';
const AGENT1 = 'agent1.swarmbuilder.testnet';
const AGENT2 = 'agent2.swarmbuilder.testnet';
const state = { bounties: [], selected: null, live: new URLSearchParams(location.search).get('mode') === 'live' };
const el = (id) => document.getElementById(id);
const fmt = (value) => Number(value).toFixed(2);
const demoAgents = [
  { account: AGENT1, stake: 0.5, submitted: true, score: 90, attestation: 'demo-tee-quote-v2-a1b2c3d4' },
  { account: AGENT2, stake: 0.5, submitted: true, score: 75, attestation: 'demo-tee-quote-v2-e5f6a7b8' }
];

function toast(message) {
  const target = el('toast');
  target.textContent = message;
  target.classList.add('show');
  window.setTimeout(() => target.classList.remove('show'), 2600);
}

function renderList() {
  el('bounty-count').textContent = String(state.bounties.length).padStart(2, '0');
  const list = el('bounty-list');
  if (!state.bounties.length) {
    list.innerHTML = '<div class="empty"><span>-</span><p>No live bounties yet.</p><small>Create one to open the swarm.</small></div>';
    return;
  }
  list.innerHTML = state.bounties.map((bounty) => `<button class="bounty-item ${state.selected === bounty.id ? 'active' : ''}" data-id="${bounty.id}"><span class="bounty-item-top"><span>#${String(bounty.id).padStart(3, '0')}</span><span>${bounty.status.toUpperCase()}</span></span><span class="bounty-item-description">${bounty.description}</span><span class="bounty-item-foot"><span>${bounty.agents.length} / 2 AGENTS</span><span>${fmt(bounty.budget)} NEAR</span></span></button>`).join('');
  document.querySelectorAll('.bounty-item').forEach((item) => item.addEventListener('click', () => { state.selected = Number(item.dataset.id); renderList(); renderDetail(); }));
}

function renderDetail() {
  const bounty = state.bounties.find((item) => item.id === state.selected);
  if (!bounty) {
    el('detail').innerHTML = '<div class="detail-empty"><span class="big-mark">*</span><h2>Awaiting a brief.</h2><p>The control surface will populate when a bounty is created.</p></div>';
    return;
  }
  const submissions = bounty.agents.filter((agent) => agent.submitted).length;
  const canSettle = bounty.status === 'Settled' || submissions >= 2;
  const rows = bounty.agents.map((agent) => `<tr><td><span class="agent-account">${agent.account}</span><small>${agent.submitted ? 'TEE worker complete' : 'awaiting worker'}</small></td><td>${fmt(agent.stake)} NEAR</td><td>${agent.submitted ? 'received' : 'pending'}</td><td>${agent.submitted ? `<a class="quote-link" href="https://explorer.testnet.near.org/accounts/${CONTRACT}" target="_blank" rel="noreferrer">view quote</a>` : '-'}</td><td><span class="score ${bounty.winner === agent.account ? 'winner' : ''}">${agent.submitted ? agent.score : '-'}</span></td></tr>`).join('');
  el('detail').innerHTML = `<div class="detail-header"><div><div class="detail-kicker">BOUNTY / ${String(bounty.id).padStart(3, '0')} - ${state.live ? 'LIVE TESTNET' : 'DEMO MODE'}</div><h2>Agent performance</h2></div><span class="status-tag ${bounty.status.toLowerCase()}">${bounty.status === 'Settled' ? 'SETTLED' : 'OPEN'}</span></div><p class="brief">${bounty.description}</p><div class="table-wrap"><table class="agent-table"><thead><tr><th>AGENT</th><th>STAKE</th><th>SUBMISSION</th><th>QUOTE</th><th>SCORE</th></tr></thead><tbody>${rows}</tbody></table></div><div class="settle-row"><p>${bounty.status === 'Settled' ? `Settled - winner ${bounty.winner}` : canSettle ? '2 submissions verified - ready to settle' : 'Waiting for 2 verified submissions'}</p><button class="primary" id="settle-btn" ${state.live || !canSettle || bounty.status === 'Settled' ? 'disabled' : ''}>Settle bounty <span>-&gt;</span></button></div>${bounty.status === 'Settled' ? `<div class="result"><span>WINNER / ${bounty.winner}</span><strong>+4.00 NEAR</strong></div>` : ''}`;
  const button = el('settle-btn');
  if (button) button.addEventListener('click', settle);
}

function create() { state.bounties = [{ id: 0, budget: 5, description: 'Summarize NEAR Intents 30-day volume with a clear, evidence-backed readout.', status: 'Open', agents: [] }]; state.selected = 0; renderList(); renderDetail(); toast('Demo bounty created with 5 NEAR budget'); }
function runAgents() { if (!state.bounties.length) create(); const bounty = state.bounties.find((item) => item.id === state.selected); bounty.agents = demoAgents.map((agent) => ({ ...agent })); renderList(); renderDetail(); toast('Two TEE workers returned attested output'); }
function settle() { const bounty = state.bounties.find((item) => item.id === state.selected); bounty.status = 'Settled'; bounty.winner = AGENT1; renderList(); renderDetail(); toast('Settlement complete - agent1 received 4.00 NEAR'); }
function decodeResult(bytes) { return JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes))); }
function encodeArgs(args) { const bytes = new TextEncoder().encode(JSON.stringify(args)); let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte); }); return btoa(binary); }
async function liveView(method, args) { const payload = { jsonrpc: '2.0', id: 'swarm-ui', method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: CONTRACT, method_name: method, args_base64: encodeArgs(args) } }; const response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); if (!response.ok) throw new Error(`RPC ${response.status}`); const data = await response.json(); if (data.error) throw new Error(data.error.message || 'RPC error'); return decodeResult(data.result.result); }
async function refreshLive() { try { const [bounty, agents] = await Promise.all([liveView('get_bounty', { bounty_id: 0 }), liveView('get_agents', { bounty_id: 0 })]); if (!bounty) throw new Error('Bounty 0 not found'); state.bounties = [{ id: bounty.id, budget: Number(bounty.budget) / 1e24, description: bounty.description, status: bounty.status, winner: bounty.winner, agents: agents.map((agent) => ({ account: agent.account, stake: Number(agent.stake) / 1e24, submitted: Boolean(agent.output_hash), score: agent.score, attestation: agent.attestation })) }]; state.selected = bounty.id; renderList(); renderDetail(); toast('Loaded live testnet bounty'); } catch (error) { toast(`Live read failed: ${error.message}`); } }

el('create-btn').addEventListener('click', () => state.live ? toast('Live mode is read-only; use demo.ps1 for transactions') : create());
el('run-btn').addEventListener('click', () => state.live ? toast('Live mode is read-only; use demo.ps1 for transactions') : runAgents());
el('wallet-btn').textContent = state.live ? 'View contract ->' : 'Live contract ->';
el('wallet-btn').addEventListener('click', () => window.open(`https://explorer.testnet.near.org/accounts/${CONTRACT}`, '_blank', 'noopener'));
renderList();
if (state.live) refreshLive();
