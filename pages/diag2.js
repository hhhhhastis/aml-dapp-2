import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

function Diag2() {
  const [log, setLog] = useState([]);
  const add = (msg) => setLog(p => [...p, msg]);

  const btnStyle = (bg) => ({
    margin: '0.5rem', padding: '0.5rem 1rem',
    background: bg, color: '#fff', border: 'none', borderRadius: '8px'
  });

  useEffect(() => {
    const tw = window.trustwallet;
    add('trustwallet: ' + typeof tw);
    add('trustwallet.tron: ' + typeof tw?.tron);
    if (tw?.tron) add('tron keys: ' + Object.keys(tw.tron).join(', '));
    const tp = window.trustProvider;
    add('trustProvider: ' + typeof tp);
    if (tp) add('trustProvider keys: ' + Object.keys(tp).join(', '));
    add('tronWeb: ' + typeof window.tronWeb);
    add('tronLink: ' + typeof window.tronLink);
  }, []);

  const testGetAccounts = async () => {
    try {
      add('Пробуем getAccounts (callback)...');
      const res = await Promise.race([
        new Promise((resolve, reject) => {
          window.trustProvider.getAccounts((err, accounts) => {
            if (err) reject(new Error(JSON.stringify(err)));
            else resolve(accounts);
          });
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 5s')), 5000))
      ]);
      add('Результат: ' + JSON.stringify(res));
    } catch(e) { add('Ошибка: ' + e.message); }
  };

  const testGetAccounts2 = async () => {
    try {
      add('Пробуем getAccounts (promise)...');
      const res = await window.trustProvider.getAccounts();
      add('Результат: ' + JSON.stringify(res));
    } catch(e) { add('Ошибка: ' + e.message); }
  };

  const testEth = async () => {
    try {
      add('Пробуем eth_accounts...');
      const res = await window.trustwallet.request({ method: 'eth_accounts' });
      add('eth_accounts: ' + JSON.stringify(res));
    } catch(e) { add('Ошибка: ' + e.message); }
  };

  const testInspect = () => {
    try {
      const tp = window.trustProvider;
      add('trustProvider toString: ' + tp.toString());
      add('getAccounts type: ' + typeof tp.getAccounts);
      add('signTransaction type: ' + typeof tp.signTransaction);
      const allKeys = [];
      for (let key in tp) allKeys.push(key);
      add('all keys (for..in): ' + allKeys.join(', '));
      const proto = Object.getPrototypeOf(tp);
      add('prototype keys: ' + Object.getOwnPropertyNames(proto).join(', '));
    } catch(e) { add('Ошибка inspect: ' + e.message); }
  };

  const testCallbackFixed = async () => {
    try {
      add('Пробуем callback с таймаутом...');
      const res = await Promise.race([
        new Promise((resolve, reject) => {
          window.trustProvider.getAccounts((err, accounts) => {
            if (err) reject(new Error(JSON.stringify(err)));
            else resolve(accounts);
          });
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 5s')), 5000))
      ]);
      add('Результат: ' + JSON.stringify(res));
    } catch(e) { add('Ошибка: ' + e.message); }
  };
  const testDeeplink = () => {
    const uri = 'wc:test@2?relay-protocol=irn&symKey=test';
    const deeplink = `trust://wc?uri=${encodeURIComponent(uri)}`;
    add('Deeplink: ' + deeplink);
    window.location.href = deeplink;
  };

  const testSignTransaction = async () => {
    try {
      add('Пробуем signTransaction (callback)...');
      const fakeTx = { txID: 'test', raw_data: {}, raw_data_hex: '' };
      const res = await Promise.race([
        new Promise((resolve, reject) => {
          window.trustProvider.signTransaction(fakeTx, (err, result) => {
            if (err) reject(new Error(JSON.stringify(err)));
            else resolve(result);
          });
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 10s')), 10000))
      ]);
      add('Результат: ' + JSON.stringify(res));
    } catch(e) { add('Ошибка: ' + e.message); }
  };

  const testSignTransaction2 = async () => {
    try {
      add('Пробуем signTransaction (promise)...');
      const fakeTx = { txID: 'test', raw_data: {}, raw_data_hex: '' };
      const res = await window.trustProvider.signTransaction(fakeTx);
      add('Результат: ' + JSON.stringify(res));
    } catch(e) { add('Ошибка: ' + e.message); }
  };

  return (
    <div style={{ padding: '1rem', background: '#0f192d', minHeight: '100vh', color: '#fff', fontFamily: 'monospace' }}>
      <h2>🔬 Диагностика Trust Wallet</h2>
      <button onClick={testGetAccounts}     style={btnStyle('#f59e0b')}>getAccounts (callback)</button>
      <button onClick={testGetAccounts2}    style={btnStyle('#8b5cf6')}>getAccounts (promise)</button>
      <button onClick={testEth}             style={btnStyle('#10b981')}>eth_accounts</button>
      <button onClick={testInspect}         style={btnStyle('#e11d48')}>Inspect trustProvider</button>
      <button onClick={testCallbackFixed}   style={btnStyle('#0891b2')}>getAccounts + timeout</button>
      <button onClick={testSignTransaction}  style={btnStyle('#dc2626')}>signTransaction (callback)</button>
      <button onClick={testSignTransaction2} style={btnStyle('#7c3aed')}>signTransaction (promise)</button>
      <div style={{ marginTop: '1rem', background: '#1a2744', padding: '1rem', borderRadius: '8px' }}>
        {log.map((l, i) => (
          <div key={i} style={{ padding: '0.2rem 0', borderBottom: '1px solid #2d3f6b', fontSize: '0.85rem' }}>{l}</div>
        ))}
      </div>
    </div>
  );
}

export default dynamic(() => Promise.resolve(Diag2), { ssr: false });