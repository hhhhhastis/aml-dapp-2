import { useState, useEffect } from 'react';

export default function WalletDiagnostics() {
  const [diag, setDiag] = useState(null);

  useEffect(() => {
    setTimeout(() => {
      const r = {};

      // ── trustProvider полный разбор ───────────────────────────────────────
      r['--- trustProvider ---'] = '---';
      r['typeof trustProvider']  = typeof window.trustProvider;
      r['trustProvider value']   = String(window.trustProvider);

      const tp = window.trustProvider;
      if (tp) {
        // Все ключи включая прототип
        const ownKeys = Object.getOwnPropertyNames(tp);
        const protoKeys = tp.__proto__ ? Object.getOwnPropertyNames(tp.__proto__) : [];
        r['own keys']   = ownKeys.join(', ')  || 'none';
        r['proto keys'] = protoKeys.join(', ') || 'none';

        r['typeof getAccounts']     = typeof tp.getAccounts;
        r['typeof signTransaction'] = typeof tp.signTransaction;
        r['typeof request']         = typeof tp.request;

        // Пробуем вызвать getAccounts
        r['getAccounts callable'] = typeof tp.getAccounts === 'function' ? 'YES' : 'NO';
      }

      // ── Пробуем через Object.keys ─────────────────────────────────────────
      r['--- trustProvider Object.keys ---'] = '---';
      try {
        r['Object.keys'] = Object.keys(window.trustProvider ?? {}).join(', ') || 'empty';
      } catch(e) {
        r['Object.keys error'] = e.message;
      }

      // ── Проверяем все window.trust* свойства ─────────────────────────────
      r['--- all window.trust* ---'] = '---';
      const trustKeys = Object.keys(window).filter(k => k.toLowerCase().startsWith('trust'));
      for (const key of trustKeys) {
        const val = window[key];
        r[`window.${key} typeof`] = typeof val;
        if (val && typeof val === 'object') {
          try {
            const methods = Object.getOwnPropertyNames(val).filter(k => typeof val[k] === 'function');
            r[`window.${key} methods`] = methods.join(', ') || 'none';
          } catch(_) {}
          try {
            const prMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(val) ?? {}).filter(k => typeof val[k] === 'function');
            r[`window.${key} proto methods`] = prMethods.join(', ') || 'none';
          } catch(_) {}
        }
      }

      // ── window.trustwallet.ethereum как TRON провайдер? ───────────────────
      r['--- ethereum provider ---'] = '---';
      const eth = window.ethereum || window.trustwallet?.ethereum;
      if (eth) {
        r['eth.isTrust']       = !!eth.isTrust;
        r['eth.isTrustWallet'] = !!eth.isTrustWallet;
        r['eth.request']       = typeof eth.request;
        // Пробуем запросить аккаунты
        r['can eth_requestAccounts'] = typeof eth.request === 'function' ? 'YES' : 'NO';
      }

      setDiag(r);
    }, 2000);
  }, []);

  return (
    <div style={{ background:'#0a0f1e', minHeight:'100vh', padding:'20px', fontFamily:'monospace', color:'#e2e8f0', fontSize:'0.72rem' }}>
      <div style={{ fontSize:'1rem', fontWeight:'bold', color:'#60a5fa', marginBottom:'16px' }}>
        🔍 trustProvider Deep Diagnostics
      </div>
      {!diag ? (
        <div style={{ color:'#f59e0b' }}>⏳ Ожидаем (2 сек)...</div>
      ) : (
        <div style={{ background:'rgba(0,0,0,0.5)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'12px', padding:'16px' }}>
          {Object.entries(diag).map(([key, val]) => {
            const isSep = String(val) === '---';
            if (isSep) return <div key={key} style={{ color:'#60a5fa', fontWeight:'bold', margin:'10px 0 4px', fontSize:'0.78rem' }}>{key}</div>;
            const color = /function|YES|true/.test(String(val)) ? '#10b981' : /undefined|NO|false|none|empty/.test(String(val)) ? '#ef4444' : '#f59e0b';
            return (
              <div key={key} style={{ display:'flex', justifyContent:'space-between', padding:'3px 0', borderBottom:'1px solid rgba(255,255,255,0.05)', gap:'8px', flexWrap:'wrap' }}>
                <span style={{ color:'#9ca3af', flexShrink:0 }}>{key}</span>
                <span style={{ color, textAlign:'right', wordBreak:'break-all', maxWidth:'55%' }}>{String(val)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
