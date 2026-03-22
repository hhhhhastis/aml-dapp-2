// pages/diag.jsx
import { useState, useEffect } from 'react';

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
    setData(null);
    addLog('▶ Запуск диагностики v2...');
    const result = {};

    // ── window.trustwallet прямой request ──────────────────────────────────
    const tw = window.trustwallet;
    result.tw_request_type = typeof tw?.request;
    result.tw_send_type    = typeof tw?.send;

    // Пробуем tron_requestAccounts через window.trustwallet.request напрямую
    addLog('Пробуем trustwallet.request({method:"tron_requestAccounts"})...');
    try {
      if (typeof tw?.request === 'function') {
        const r = await tw.request({ method: 'tron_requestAccounts' });
        result.tw_request_result = JSON.stringify(r);
        addLog('✅ trustwallet.request успех: ' + JSON.stringify(r));
      } else {
        result.tw_request_result = 'request не функция';
        addLog('❌ trustwallet.request не функция');
      }
    } catch (e) {
      result.tw_request_error = e.message;
      addLog('❌ trustwallet.request ошибка: ' + e.message);
    }

    // ── Пробуем trustwallet.send ───────────────────────────────────────────
    addLog('Пробуем trustwallet.send({method:"tron_requestAccounts"})...');
    try {
      if (typeof tw?.send === 'function') {
        const r = await tw.send({ method: 'tron_requestAccounts' });
        result.tw_send_result = JSON.stringify(r);
        addLog('✅ trustwallet.send успех: ' + JSON.stringify(r));
      } else {
        result.tw_send_result = 'send не функция';
        addLog('❌ trustwallet.send не функция');
      }
    } catch (e) {
      result.tw_send_error = e.message;
      addLog('❌ trustwallet.send ошибка: ' + e.message);
    }

    // ── Пробуем trustProvider через bind ──────────────────────────────────
    addLog('Пробуем trustProvider.getAccounts через bind...');
    try {
      const tp = window.trustProvider;
      if (tp && typeof tp.getAccounts === 'function') {
        const bound = tp.getAccounts.bind(tp);
        const r = await bound();
        result.tp_bind_result = JSON.stringify(r);
        addLog('✅ bind успех: ' + JSON.stringify(r));
      } else {
        addLog('❌ trustProvider.getAccounts не доступен');
      }
    } catch (e) {
      result.tp_bind_error = e.message;
      addLog('❌ bind ошибка: ' + e.message);
    }

    // ── Пробуем через window напрямую ─────────────────────────────────────
    addLog('Пробуем window.trustProvider.getAccounts() напрямую...');
    try {
      const r = await window.trustProvider.getAccounts();
      result.tp_direct_result = JSON.stringify(r);
      addLog('✅ напрямую успех: ' + JSON.stringify(r));
    } catch (e) {
      result.tp_direct_error = e.message;
      addLog('❌ напрямую ошибка: ' + e.message);
    }

    // ── Все ключи window.trustwallet ──────────────────────────────────────
    try {
      result.tw_all_keys = Object.keys(window.trustwallet || {}).join(', ');
    } catch { result.tw_all_keys = 'ошибка'; }

    // ── Версия TW если есть ───────────────────────────────────────────────
    result.tw_version = window.trustwallet?.version ?? 'нет';
    result.tw_isTrust = window.trustwallet?.isTrust ?? 'нет';

    result.userAgent = navigator.userAgent.slice(0, 100);

    addLog('✅ Диагностика v2 завершена');
    setData(result);
  };

  useEffect(() => { runDiag(); }, []);

  const s = { background: '#0f172a', minHeight: '100vh', padding: '20px 16px', color: '#e2e8f0', fontFamily: 'sans-serif' };

  return (
    <div style={s}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>🔍 TW Диагностика v2</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>aml-dapp-2.vercel.app/diag</div>

      <button onClick={runDiag} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 14, cursor: 'pointer', marginBottom: 16 }}>
        🔄 Перезапустить
      </button>

      <Section title="📋 Лог">
        {log.map((l, i) => (
          <div key={i} style={{ fontSize: 12, fontFamily: 'monospace', color: l.includes('✅') ? '#10b981' : l.includes('❌') ? '#ef4444' : '#94a3b8', padding: '2px 0' }}>{l}</div>
        ))}
      </Section>

      {data && <>
        <Section title="trustwallet.request напрямую">
          <Row label="typeof request" value={data.tw_request_type} ok={data.tw_request_type === 'function'} />
          <Row label="typeof send"    value={data.tw_send_type}    ok={data.tw_send_type === 'function'} />
          {data.tw_request_result !== undefined && <Row label="request результат" value={data.tw_request_result} ok={true} />}
          {data.tw_request_error   !== undefined && <Row label="request ошибка"   value={data.tw_request_error}  ok={false} />}
          {data.tw_send_result     !== undefined && <Row label="send результат"   value={data.tw_send_result}    ok={true} />}
          {data.tw_send_error      !== undefined && <Row label="send ошибка"      value={data.tw_send_error}     ok={false} />}
        </Section>

        <Section title="trustProvider через bind / напрямую">
          {data.tp_bind_result   !== undefined && <Row label="bind результат"    value={data.tp_bind_result}   ok={true} />}
          {data.tp_bind_error    !== undefined && <Row label="bind ошибка"       value={data.tp_bind_error}    ok={false} />}
          {data.tp_direct_result !== undefined && <Row label="прямой результат"  value={data.tp_direct_result} ok={true} />}
          {data.tp_direct_error  !== undefined && <Row label="прямой ошибка"     value={data.tp_direct_error}  ok={false} />}
        </Section>

        <Section title="window.trustwallet мета">
          <Row label="all keys" value={data.tw_all_keys} />
          <Row label="version"  value={data.tw_version} />
          <Row label="isTrust"  value={data.tw_isTrust} />
        </Section>

        <Section title="User Agent">
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#94a3b8', wordBreak: 'break-all' }}>{data.userAgent}</div>
        </Section>
      </>}
    </div>
  );
}
