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
    add('trustwallet: ' + typeof window.trustwallet);
    add('trustProvider: ' + typeof window.trustProvider);
    add('tronWeb: ' + typeof window.tronWeb);
    add('tronLink: ' + typeof window.tronLink);
    add('ethereum: ' + typeof window.ethereum);
    add('tron: ' + typeof window.tron);
  }, []);

  const testMetaMask = async () => {
    try {
      add('ethereum: ' + typeof window.ethereum);
      add('ethereum keys: ' + Object.keys(window.ethereum || {}).slice(0, 10).join(', '));
      add('tron: ' + typeof window.tron);
      add('isTron: ' + window.ethereum?.isTron);

      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      add('eth accounts: ' + JSON.stringify(accounts));

      try {
        const tron = await window.ethereum.request({ method: 'tron_requestAccounts' });
        add('tron accounts: ' + JSON.stringify(tron));
      } catch(e) { add('tron_requestAccounts ошибка: ' + e.message); }
    } catch(e) { add('Ошибка: ' + e.message); }
  };

  return (
    <div style={{ padding: '1rem', background: '#0f192d', minHeight: '100vh', color: '#fff', fontFamily: 'monospace' }}>
      <h2>🔬 Диагностика MetaMask</h2>
      <button onClick={testMetaMask} style={btnStyle('#e97316')}>Тест MetaMask TRON</button>
      <div style={{ marginTop: '1rem', background: '#1a2744', padding: '1rem', borderRadius: '8px' }}>
        {log.map((l, i) => (
          <div key={i} style={{ padding: '0.2rem 0', borderBottom: '1px solid #2d3f6b', fontSize: '0.85rem' }}>{l}</div>
        ))}
      </div>
    </div>
  );
}

export default dynamic(() => Promise.resolve(Diag2), { ssr: false });