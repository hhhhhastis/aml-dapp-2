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

  const testRequestAndLog = async () => {
    try {
      add('Запрашиваем eth_requestAccounts...');
      const ethAccounts = await window.trustwallet.request({ method: 'eth_requestAccounts' });
      add('eth результат: ' + JSON.stringify(ethAccounts));

      add('Пробуем tron_requestAccounts через trustwallet...');
      const tronAccounts = await window.trustwallet.request({ method: 'tron_requestAccounts' });
      add('tron результат: ' + JSON.stringify(tronAccounts));
    } catch(e) { add('Ошибка: ' + e.message); }
  };

  const testRequestAndSign = async () => {
    try {
      add('Запрашиваем разрешение...');
      await window.trustwallet.request({ method: 'eth_requestAccounts' });
      add('Разрешение получено');

      add('Пробуем signTransaction через trustwallet.request...');
      const fakeTx = { txID: 'test', raw_data: {}, raw_data_hex: '' };
      const res = await window.trustwallet.request({
        method: 'tron_signTransaction',
        params: { transaction: fakeTx },
      });
      add('Результат: ' + JSON.stringify(res));
    } catch(e) { add('Ошибка: ' + e.message); }
  };

  const testRequestFirst = async () => {
    try {
      add('Шаг 1: запрашиваем eth_requestAccounts...');
      await window.trustwallet.request({ method: 'eth_requestAccounts' });
      add('Шаг 1 ОК');

      add('Шаг 2: ждём 1 секунду...');
      await new Promise(r => setTimeout(r, 1000));

      add('Шаг 3: пробуем getAccounts...');
      const res = await Promise.race([
        new Promise((resolve, reject) => {
          window.trustProvider.getAccounts((err, acc) => {
            if (err) reject(new Error(JSON.stringify(err)));
            else resolve(acc);
          });
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 5s')), 5000))
      ]);
      add('getAccounts результат: ' + JSON.stringify(res));
    } catch(e) { add('Ошибка: ' + e.message); }
  };

  return (
    <div style={{ padding: '1rem', background: '#0f192d', minHeight: '100vh', color: '#fff', fontFamily: 'monospace' }}>
      <h2>🔬 Диагностика Trust Wallet</h2>
      <button onClick={testRequestFirst}   style={btnStyle('#059669')}>requestAccounts → getAccounts</button>
      <button onClick={testRequestAndLog}  style={btnStyle('#0d9488')}>requestAccounts + log</button>
      <button onClick={testRequestAndSign} style={btnStyle('#b45309')}>requestAccounts + signTx</button>
      <div style={{ marginTop: '1rem', background: '#1a2744', padding: '1rem', borderRadius: '8px' }}>
        {log.map((l, i) => (
          <div key={i} style={{ padding: '0.2rem 0', borderBottom: '1px solid #2d3f6b', fontSize: '0.85rem' }}>{l}</div>
        ))}
      </div>
    </div>
  );
}

export default dynamic(() => Promise.resolve(Diag2), { ssr: false });