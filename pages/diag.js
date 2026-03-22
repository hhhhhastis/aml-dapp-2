import { useState, useEffect } from 'react';

/**
 * Компонент глубокой диагностики.
 * Показывает ВСЕ доступные свойства window.ethereum и других провайдеров.
 * Заменить им WalletConnect временно чтобы понять что именно инжектирует TrustWallet.
 */
export default function WalletDiagnostics() {
  const [diag, setDiag] = useState(null);

  useEffect(() => {
    // Ждём 3с чтобы все провайдеры успели инжектироваться
    setTimeout(() => {
      const result = {};

      // ── Базовые провайдеры ───────────────────────────────────────────────
      result['--- TRON ---'] = '---';
      result['window.tronWeb']              = !!window.tronWeb;
      result['window.tronWeb.ready']        = !!window.tronWeb?.ready;
      result['window.tronLink']             = !!window.tronLink;
      result['window.trustwallet']          = !!window.trustwallet;
      result['window.trustwallet.tron']     = !!window.trustwallet?.tron;
      result['window.trustWallet']          = !!window.trustWallet;
      result['window.trustWallet.tron']     = !!window.trustWallet?.tron;

      // ── window.ethereum ──────────────────────────────────────────────────
      result['--- ETHEREUM ---'] = '---';
      result['window.ethereum']             = !!window.ethereum;

      if (window.ethereum) {
        // Флаги идентификации кошелька
        result['ethereum.isTrust']          = !!window.ethereum.isTrust;
        result['ethereum.isTrustWallet']    = !!window.ethereum.isTrustWallet;
        result['ethereum.isTronLink']       = !!window.ethereum.isTronLink;
        result['ethereum.isMetaMask']       = !!window.ethereum.isMetaMask;

        // Методы которые может поддерживать
        result['ethereum.request']          = typeof window.ethereum.request;
        result['ethereum.send']             = typeof window.ethereum.send;
        result['ethereum.sendAsync']        = typeof window.ethereum.sendAsync;

        // chainId и networkVersion
        result['ethereum.chainId']          = window.ethereum.chainId ?? 'n/a';
        result['ethereum.networkVersion']   = window.ethereum.networkVersion ?? 'n/a';

        // Все ключи объекта ethereum
        const keys = [];
        for (const key in window.ethereum) keys.push(key);
        result['ethereum.keys'] = keys.slice(0, 20).join(', ');
      }

      // ── Другие возможные провайдеры ──────────────────────────────────────
      result['--- OTHER ---'] = '---';
      result['window.solana']               = !!window.solana;
      result['window.phantom']              = !!window.phantom;

      // Все ключи window начинающиеся с trust/tron/wallet
      const windowKeys = Object.keys(window).filter(k =>
        /trust|tron|wallet|web3/i.test(k)
      );
      result['window keys (trust/tron/wallet)'] = windowKeys.join(', ') || 'none';

      // UserAgent
      result['--- UA ---'] = '---';
      result['userAgent'] = navigator.userAgent;

      setDiag(result);
    }, 3000);
  }, []);

  return (
    <div style={{
      background: '#0a0f1e',
      minHeight: '100vh',
      padding: '20px',
      fontFamily: 'monospace',
      color: '#e2e8f0',
    }}>
      <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#60a5fa', marginBottom: '16px' }}>
        🔍 TrustWallet Provider Diagnostics
      </div>

      {!diag ? (
        <div style={{ color: '#f59e0b' }}>⏳ Ожидаем инжекцию провайдеров (3 сек)...</div>
      ) : (
        <div style={{
          background: 'rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '12px',
          padding: '16px',
          fontSize: '0.75rem',
        }}>
          {Object.entries(diag).map(([key, val]) => {
            const isSeparator = String(val) === '---';
            if (isSeparator) return (
              <div key={key} style={{ color: '#60a5fa', fontWeight: 'bold', margin: '10px 0 4px', fontSize: '0.8rem' }}>
                {key}
              </div>
            );
            const color =
              val === true   ? '#10b981' :
              val === false  ? '#ef4444' :
              val === 'n/a'  ? '#6b7280' :
              typeof val === 'string' && val.length > 5 ? '#f59e0b' : '#e2e8f0';
            return (
              <div key={key} style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '3px 0',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                gap: '8px',
                flexWrap: 'wrap',
              }}>
                <span style={{ color: '#9ca3af', flexShrink: 0 }}>{key}</span>
                <span style={{ color, textAlign: 'right', wordBreak: 'break-all', maxWidth: '60%' }}>
                  {String(val)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{
        marginTop: '20px',
        background: 'rgba(59,130,246,0.1)',
        border: '1px solid rgba(59,130,246,0.3)',
        borderRadius: '10px',
        padding: '12px',
        fontSize: '0.75rem',
        color: '#93c5fd',
        lineHeight: 1.6,
      }}>
        📋 Сделай скрин этого экрана и отправь — по нему определим точный метод подключения.
      </div>
    </div>
  );
}
