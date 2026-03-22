import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

function Diag2() {
  const [log, setLog] = useState([]);
  const add = (msg) => setLog(p => [...p, msg]);

  useEffect(() => {
    const tw = window.trustwallet;
    add('trustwallet: ' + typeof tw);
    add('trustwallet.tron: ' + typeof tw?.tron);
    if (tw?.tron) {
      add('tron keys: ' + Object.keys(tw.tron).join(', '));
    }
    const tp = window.trustProvider;
    add('trustProvider: ' + typeof tp);
    if (tp) {
      add('trustProvider keys: ' + Object.keys(tp).join(', '));
    }
    add('tronWeb: ' + typeof window.tronWeb);
    add('tronLink: ' + typeof window.tronLink);
  }, []);

  const testGetAccounts = async () => {
  try {
    add('Пробуем trustProvider.getAccounts()...');
    const res = await new Promise((resolve, reject) => {
      window.trustProvider.getAccounts((err, accounts) => {
        if (err) reject(err);
        else resolve(accounts);
      });
    });
    add('Результат: ' + JSON.stringify(res));
  } catch(e) {
    add('Ошибка: ' + e.message);
  }
  };

    const testGetAccounts2 = async () => {
      try {
        add('Пробуем trustProvider.getAccounts() как promise...');
        const res = await window.trustProvider.getAccounts();
        add('Результат: ' + JSON.stringify(res));
      } catch(e) {
        add('Ошибка2: ' + e.message);
      }
    };

  const testRequest = async () => {
    try {
      add('Пробуем tron_requestAccounts...');
      const res = await window.trustwallet.tron.request({ method: 'tron_requestAccounts' });
      add('Результат: ' + JSON.stringify(res));
    } catch(e) {
      add('Ошибка: ' + e.message);
    }
  };

  const testEth = async () => {
    try {
      add('Пробуем eth_accounts...');
      const res = await window.trustwallet.request({ method: 'eth_accounts' });
      add('eth_accounts: ' + JSON.stringify(res));
    } catch(e) {
      add('Ошибка eth_accounts: ' + e.message);
    }
  };

  

  return (
    <div style={{ padding: '1rem', background: '#0f192d', minHeight: '100vh', color: '#fff', fontFamily: 'monospace' }}>
      <h2>🔬 Диагностика Trust Wallet</h2>
      <button onClick={testRequest} style={{ margin: '0.5rem', padding: '0.5rem 1rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '8px' }}>
        Тест tron_requestAccounts
      </button>
      <button onClick={testEth} style={{ margin: '0.5rem', padding: '0.5rem 1rem', background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px' }}>
        Тест eth_accounts
      </button>
      <div style={{ marginTop: '1rem', background: '#1a2744', padding: '1rem', borderRadius: '8px' }}>
      <button onClick={testGetAccounts} style={btnStyle('#f59e0b')}>
          getAccounts (callback)
        </button>
        <button onClick={testGetAccounts2} style={btnStyle('#8b5cf6')}>
          getAccounts (promise)
        </button>
        {log.map((l, i) => (
          <div key={i} style={{ padding: '0.2rem 0', borderBottom: '1px solid #2d3f6b', fontSize: '0.85rem' }}>{l}</div>
        ))}
      </div>
    </div>
  );
}

export default dynamic(() => Promise.resolve(Diag2), { ssr: false });