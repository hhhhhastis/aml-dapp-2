// DiagnosticPage.jsx
// Добавь временно в роутер: <Route path="/diag" element={<DiagnosticPage />} />
// Открывай в браузере Trust Wallet: aml-dapp-2.vercel.app/diag

import { useState, useEffect } from 'react';

function inspect(val, depth = 0) {
  if (depth > 2) return '...';
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  const t = typeof val;
  if (t === 'function') return 'function';
  if (t !== 'object') return String(val);
  try {
    const keys = Object.keys(val);
    return keys.length ? keys.join(', ') : '{}';
  } catch { return '[недоступно]'; }
}

function Row({ label, value, ok }) {
  const color = ok === true ? '#10b981' : ok === false ? '#ef4444' : '#f59e0b';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.08)', fontSize: 13 }}>
      <span style={{ color: '#a0b3d9', fontFamily: 'monospace' }}>{label}</span>
      <span style={{ color, fontFamily: 'monospace', maxWidth: '55%', textAlign: 'right', wordBreak: 'break-all' }}>{String(value)}</span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20, background: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: '12px 16px' }}>
      <div style={{ color: '#60a5fa', fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{title}</div>
      {children}
    </div>
  );
}

export default function DiagnosticPage() {
  const [data, setData] = useState(null);
  const [log,  setLog]  = useState([]);

  const addLog = (msg) => setLog(prev => [...prev, `${new Date().toLocaleTimeString()} ${msg}`]);

  const runDiag = async () => {
    setLog([]);
    addLog('▶ Запуск диагностики...');
    const result = {};

    // ── window.trustProvider ──────────────────────────────────────────────
    const tp = window.trustProvider;
    result.tp_typeof          = typeof tp;
    result.tp_isNull          = tp === null;
    result.tp_isUndefined     = tp === undefined;
    result.tp_keys            = tp ? inspect(tp) : '—';
    result.tp_getAccounts     = typeof tp?.getAccounts;
    result.tp_signTransaction = typeof tp?.signTransaction;
    result.tp_request         = typeof tp?.request;
    addLog(`trustProvider type: ${typeof tp}`);

    // ── Повторное чтение через 500мс ──────────────────────────────────────
    await new Promise(r => setTimeout(r, 500));
    const tp2 = window.trustProvider;
    result.tp2_typeof     = typeof tp2;
    result.tp2_sameRef    = tp === tp2;
    result.tp2_getAccounts = typeof tp2?.getAccounts;
    addLog(`trustProvider через 500мс: ${typeof tp2}, same ref: ${tp === tp2}`);

    // ── window.trustwallet ────────────────────────────────────────────────
    result.tw_typeof     = typeof window.trustwallet;
    result.tw_tron       = typeof window.trustwallet?.tron;
    result.tw_tron_req   = typeof window.trustwallet?.tron?.request;
    result.tw_keys       = window.trustwallet ? inspect(window.trustwallet) : '—';

    // ── window.trustWallet ────────────────────────────────────────────────
    result.tW_typeof     = typeof window.trustWallet;
    result.tW_tron       = typeof window.trustWallet?.tron;
    result.tW_tron_req   = typeof window.trustWallet?.tron?.request;

    // ── window.tronLink ───────────────────────────────────────────────────
    result.tl_typeof     = typeof window.tronLink;
    result.tl_request    = typeof window.tronLink?.request;

    // ── window.tronWeb ────────────────────────────────────────────────────
    result.tronWeb       = typeof window.tronWeb;

    // ── Попытка вызвать getAccounts ───────────────────────────────────────
    addLog('Пробуем вызвать trustProvider.getAccounts()...');
    try {
      const tp3 = window.trustProvider;
      addLog(`trustProvider перед вызовом: ${typeof tp3}, getAccounts: ${typeof tp3?.getAccounts}`);
      if (typeof tp3?.getAccounts === 'function') {
        const accounts = await tp3.getAccounts();
        result.getAccounts_result = JSON.stringify(accounts);
        addLog(`✅ getAccounts вернул: ${JSON.stringify(accounts)}`);
      } else {
        result.getAccounts_result = 'getAccounts не является функцией';
        addLog(`❌ getAccounts не функция: ${typeof tp3?.getAccounts}`);
      }
    } catch (e) {
      result.getAccounts_error = e.message;
      addLog(`❌ Ошибка getAccounts: ${e.message}`);
    }

    // ── User Agent ────────────────────────────────────────────────────────
    result.userAgent = navigator.userAgent.slice(0, 80);

    addLog('✅ Диагностика завершена');
    setData(result);
  };

  useEffect(() => { runDiag(); }, []);

  const s = { background: '#0f172a', minHeight: '100vh', padding: '20px 16px', color: '#e2e8f0', fontFamily: 'sans-serif' };

  return (
    <div style={s}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: '#fff' }}>🔍 Trust Wallet Диагностика</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>aml-dapp-2.vercel.app/diag</div>

      <button onClick={runDiag} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 14, cursor: 'pointer', marginBottom: 16 }}>
        🔄 Перезапустить
      </button>

      {/* Лог */}
      <Section title="📋 Лог выполнения">
        {log.map((l, i) => (
          <div key={i} style={{ fontSize: 12, fontFamily: 'monospace', color: l.includes('✅') ? '#10b981' : l.includes('❌') ? '#ef4444' : '#94a3b8', padding: '2px 0' }}>{l}</div>
        ))}
      </Section>

      {data && <>
        <Section title="window.trustProvider (первое чтение)">
          <Row label="typeof"          value={data.tp_typeof}          ok={data.tp_typeof === 'object'} />
          <Row label="=== undefined"   value={data.tp_isUndefined}     ok={!data.tp_isUndefined} />
          <Row label="=== null"        value={data.tp_isNull}          ok={!data.tp_isNull} />
          <Row label="keys"            value={data.tp_keys} />
          <Row label="getAccounts"     value={data.tp_getAccounts}     ok={data.tp_getAccounts === 'function'} />
          <Row label="signTransaction" value={data.tp_signTransaction} ok={data.tp_signTransaction === 'function'} />
          <Row label="request"         value={data.tp_request} />
        </Section>

        <Section title="window.trustProvider (через 500мс)">
          <Row label="typeof"          value={data.tp2_typeof}      ok={data.tp2_typeof === 'object'} />
          <Row label="same reference"  value={data.tp2_sameRef} />
          <Row label="getAccounts"     value={data.tp2_getAccounts} ok={data.tp2_getAccounts === 'function'} />
        </Section>

        <Section title="Вызов getAccounts()">
          {data.getAccounts_result !== undefined
            ? <Row label="результат" value={data.getAccounts_result} ok={true} />
            : <Row label="ошибка"    value={data.getAccounts_error}  ok={false} />
          }
        </Section>

        <Section title="window.trustwallet">
          <Row label="typeof"       value={data.tw_typeof} />
          <Row label=".tron"        value={data.tw_tron} />
          <Row label=".tron.request" value={data.tw_tron_req} ok={data.tw_tron_req === 'function'} />
          <Row label="keys"         value={data.tw_keys} />
        </Section>

        <Section title="window.trustWallet">
          <Row label="typeof"        value={data.tW_typeof} />
          <Row label=".tron"         value={data.tW_tron} />
          <Row label=".tron.request" value={data.tW_tron_req} ok={data.tW_tron_req === 'function'} />
        </Section>

        <Section title="window.tronLink / tronWeb">
          <Row label="tronLink typeof"  value={data.tl_typeof} />
          <Row label="tronLink.request" value={data.tl_request} ok={data.tl_request === 'function'} />
          <Row label="tronWeb"          value={data.tronWeb} />
        </Section>

        <Section title="User Agent">
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#94a3b8', wordBreak: 'break-all' }}>{data.userAgent}</div>
        </Section>
      </>}
    </div>
  );
}
