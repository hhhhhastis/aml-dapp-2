import { useState, useEffect } from 'react';

export default function WalletDiagnostics() {
  const [diag, setDiag] = useState(null);

  useEffect(() => {
    setTimeout(() => {
      const result = {};

      // ── Все ключи trustwalletTon ──────────────────────────────────────────
      result['--- trustwalletTon ---'] = '---';
      result['exists'] = !!window.trustwalletTon;

      if (window.trustwalletTon) {
        const obj = window.trustwalletTon;
        result['typeof']          = typeof obj;
        result['has .request']    = typeof obj.request;
        result['has .on']         = typeof obj.on;
        result['has .send']       = typeof obj.send;
        result['has .sendAsync']  = typeof obj.sendAsync;
        result['has .enable']     = typeof obj.enable;
        result['has .getAccounts']= typeof obj.getAccounts;
        result['has .signTransaction'] = typeof obj.signTransaction;
        result['has .sign']       = typeof obj.sign;

        // Все ключи объекта
        const keys = [];
        try { for (const k in obj) keys.push(k); } catch(_) {}
        try { Object.getOwnPropertyNames(obj).forEach(k => { if (!keys.includes(k)) keys.push(k); }); } catch(_) {}
        result['all keys'] = keys.join(', ') || 'none';
      }

      // ── trustProvider ────────────────────────────────────────────────────
      result['--- trustProvider ---'] = '---';
      result['exists'] = !!window.trustProvider;
      if (window.trustProvider) {
        const obj = window.trustProvider;
        result['trustProvider.request']    = typeof obj.request;
        result['trustProvider.tron']       = !!obj.tron;
        result['trustProvider.tron.request'] = typeof obj.tron?.request;
        const keys = [];
        try { for (const k in obj) keys.push(k); } catch(_) {}
        result['trustProvider keys'] = keys.join(', ') || 'none';
      }

      // ── trustwallet (корневой объект) ────────────────────────────────────
      result['--- window.trustwallet ---'] = '---';
      if (window.trustwallet) {
        const obj = window.trustwallet;
        const keys = [];
        try { for (const k in obj) keys.push(k); } catch(_) {}
        try { Object.getOwnPropertyNames(obj).forEach(k => { if (!keys.includes(k)) keys.push(k); }); } catch(_) {}
        result['trustwallet keys'] = keys.join(', ') || 'none';
        result['trustwallet.tron'] = !!obj.tron;
        result['trustwallet.solana'] = !!obj.solana;
        result['trustwallet.ton']  = !!obj.ton;
        // Проверяем каждое свойство на наличие request
        for (const k of keys.slice(0, 10)) {
          if (obj[k] && typeof obj[k] === 'object') {
            result[`trustwallet.${k}.request`] = typeof obj[k].request;
          }
        }
      }

      setDiag(result);
    }, 2000);
  }, []);

  return (
    <div style={{ background:'#0a0f1e', minHeight:'100vh', padding:'20px', fontFamily:'monospace', color:'#e2e8f0' }}>
      <div style={{ fontSize:'1.1rem', fontWeight:'bold', color:'#60a5fa', marginBottom:'16px' }}>
        🔍 trustwalletTon Deep Diagnostics
      </div>
      {!diag ? (
        <div style={{ color:'#f59e0b' }}>⏳ Ожидаем (2 сек)...</div>
      ) : (
        <div style={{ background:'rgba(0,0,0,0.5)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'12px', padding:'16px', fontSize:'0.72rem' }}>
          {Object.entries(diag).map(([key, val]) => {
            const isSep = String(val) === '---';
            if (isSep) return (
              <div key={key} style={{ color:'#60a5fa', fontWeight:'bold', margin:'10px 0 4px' }}>{key}</div>
            );
            const color =
              val === true || val === 'function' ? '#10b981' :
              val === false || val === 'undefined' ? '#ef4444' : '#f59e0b';
            return (
              <div key={key} style={{ display:'flex', justifyContent:'space-between', padding:'3px 0', borderBottom:'1px solid rgba(255,255,255,0.05)', gap:'8px', flexWrap:'wrap' }}>
                <span style={{ color:'#9ca3af' }}>{key}</span>
                <span style={{ color, textAlign:'right', wordBreak:'break-all', maxWidth:'55%' }}>{String(val)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
