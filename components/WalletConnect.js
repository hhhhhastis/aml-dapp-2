import { useState, useEffect, useRef } from 'react';
import TronWeb from 'tronweb';
import toast from 'react-hot-toast';

export default function WalletConnect({ onConnect, onDisconnect }) {
  const [address, setAddress] = useState(null);
  const [balance, setBalance] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  // Универсальное получение TronWeb из разных источников
  const getTronWeb = () => {
    if (window.tronWeb && window.tronWeb.ready) return window.tronWeb;
    if (window.tronLink) return window.tronLink;
    if (window.trustwallet && window.trustwallet.tron) return window.trustwallet.tron;
    return null;
  };

  const waitForTronWeb = (timeout = 10000) => {
    return new Promise((resolve) => {
      const start = Date.now();
      const interval = setInterval(() => {
        const tw = getTronWeb();
        if (tw) {
          clearInterval(interval);
          resolve(tw);
        } else if (Date.now() - start > timeout) {
          clearInterval(interval);
          resolve(null);
        }
      }, 500);
    });
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Проверка существующего подключения
  useEffect(() => {
    const check = async () => {
      const tw = await waitForTronWeb(5000);
      if (tw && tw.defaultAddress?.base58) {
        const addr = tw.defaultAddress.base58;
        setAddress(addr);
        onConnect?.(addr, tw);
        const bal = await tw.trx.getBalance(addr);
        setBalance(TronWeb.fromSun(bal));
      }
    };
    check();
  }, []);

  const connect = async () => {
    setConnecting(true);
    try {
      let tw = await waitForTronWeb(10000);
      if (!tw) {
        // Специальный вызов для TrustWallet (window.trustwallet.tron.request)
        if (window.trustwallet && window.trustwallet.tron && window.trustwallet.tron.request) {
          const accounts = await window.trustwallet.tron.request({ method: 'tron_requestAccounts' });
          if (accounts && accounts[0]) {
            tw = window.trustwallet.tron;
          } else {
            throw new Error('TrustWallet не разрешил подключение');
          }
        } else {
          throw new Error('Кошелёк не обнаружен');
        }
      }

      let addr = tw.defaultAddress?.base58;
      if (!addr && tw.requestAccounts) {
        const accounts = await tw.requestAccounts();
        addr = accounts[0];
      }
      if (!addr) throw new Error('Не удалось получить адрес');

      setAddress(addr);
      onConnect?.(addr, tw);
      const bal = await tw.trx.getBalance(addr);
      setBalance(TronWeb.fromSun(bal));
      toast.success('Кошелёк подключён');
    } catch (err) {
      console.error(err);
      toast.error(err.message);
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () => {
    setAddress(null);
    setBalance(null);
    onDisconnect?.();
    toast.success('Кошелёк отключён');
  };

  const copyLink = () => {
    const currentUrl = window.location.href;
    navigator.clipboard.writeText(currentUrl).then(() => {
      alert('Ссылка скопирована!\n\n1. Откройте TrustWallet\n2. Перейдите в DApp Browser\n3. Вставьте ссылку');
    }).catch(() => {
      alert('Не удалось скопировать ссылку. Пожалуйста, откройте страницу в TrustWallet вручную.');
    });
  };

  const formatAddress = (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem', position: 'relative' }}>
      {!address ? (
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            disabled={connecting}
            style={{
              background: 'linear-gradient(135deg, #3b82f6, #60a5fa)',
              color: 'white',
              border: 'none',
              borderRadius: '40px',
              padding: '1rem 2rem',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: connecting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.8rem',
            }}
          >
            {connecting ? <div className="spinner" /> : <i className="fas fa-wallet" />}
            {connecting ? 'Подключение...' : 'Подключить кошелёк'}
          </button>
          {menuOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                background: '#1a1f2e',
                border: '1px solid rgba(59,130,246,0.2)',
                borderRadius: '20px',
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)',
                zIndex: 10,
                minWidth: '220px',
                overflow: 'hidden',
              }}
            >
              <button
                onClick={connect}
                style={{
                  width: '100%',
                  padding: '12px 20px',
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) => (e.target.style.background = 'rgba(59,130,246,0.1)')}
                onMouseLeave={(e) => (e.target.style.background = 'transparent')}
              >
                <i className="fas fa-plug" style={{ width: '20px' }} />
                TronLink / TrustWallet (встроенный)
              </button>
              {isMobile && (
                <button
                  onClick={copyLink}
                  style={{
                    width: '100%',
                    padding: '12px 20px',
                    background: 'transparent',
                    border: 'none',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => (e.target.style.background = 'rgba(59,130,246,0.1)')}
                  onMouseLeave={(e) => (e.target.style.background = 'transparent')}
                >
                  <i className="fas fa-copy" style={{ width: '20px' }} />
                  Открыть в TrustWallet (скопировать ссылку)
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            background: 'rgba(59,130,246,0.1)',
            border: '1px solid rgba(59,130,246,0.2)',
            borderRadius: '40px',
            padding: '0.8rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <i className="fas fa-check-circle" style={{ color: '#10b981' }} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{formatAddress(address)}</div>
            {balance && <div style={{ fontSize: '0.75rem', color: '#a0b3d9' }}>{parseFloat(balance).toFixed(2)} TRX</div>}
          </div>
          <button onClick={disconnect} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
            <i className="fas fa-sign-out-alt" />
          </button>
        </div>
      )}
    </div>
  );
}