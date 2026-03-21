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

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const checkExisting = async () => {
      let attempts = 0;
      while (!window.tronWeb && attempts < 25) {
        await new Promise(r => setTimeout(r, 200));
        attempts++;
      }
      if (window.tronWeb && window.tronWeb.defaultAddress?.base58) {
        const addr = window.tronWeb.defaultAddress.base58;
        setAddress(addr);
        onConnect?.(addr);
        const bal = await window.tronWeb.trx.getBalance(addr);
        setBalance(TronWeb.fromSun(bal));
      }
    };
    checkExisting();
  }, []);

  const connectWallet = async () => {
    setConnecting(true);
    try {
      let attempts = 0;
      while (!window.tronWeb && attempts < 25) {
        await new Promise(r => setTimeout(r, 200));
        attempts++;
      }
      if (!window.tronWeb) throw new Error('Кошелёк не обнаружен. Установите TronLink или откройте сайт в TrustWallet.');

      let addr = window.tronWeb.defaultAddress?.base58;
      if (!addr && window.tronWeb.requestAccounts) {
        const accounts = await window.tronWeb.requestAccounts();
        addr = accounts[0];
      }
      if (!addr) throw new Error('Не удалось получить адрес');

      setAddress(addr);
      onConnect?.(addr);
      const bal = await window.tronWeb.trx.getBalance(addr);
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

  const copyLinkAndOpenTrust = () => {
    const currentUrl = window.location.href;
    navigator.clipboard.writeText(currentUrl).then(() => {
      alert('Ссылка скопирована!\n\n1. Откройте TrustWallet\n2. Перейдите в DApp Browser\n3. Вставьте ссылку в адресную строку');
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
              opacity: connecting ? 0.7 : 1,
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
                onClick={connectWallet}
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
                  fontSize: '0.9rem',
                }}
                onMouseEnter={(e) => (e.target.style.background = 'rgba(59,130,246,0.1)')}
                onMouseLeave={(e) => (e.target.style.background = 'transparent')}
              >
                <i className="fas fa-plug" style={{ width: '20px' }} />
                TronLink / TrustWallet (встроенный)
              </button>
              {isMobile && (
                <button
                  onClick={copyLinkAndOpenTrust}
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
                    fontSize: '0.9rem',
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
            background: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
            borderRadius: '40px',
            padding: '0.8rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <i className="fas fa-check-circle" style={{ color: '#10b981' }} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#60a5fa', fontFamily: 'monospace' }}>
              {formatAddress(address)}
            </div>
            {balance && (
              <div style={{ fontSize: '0.75rem', color: '#a0b3d9' }}>
                {parseFloat(balance).toFixed(2)} TRX
              </div>
            )}
          </div>
          <button
            onClick={disconnect}
            style={{
              background: 'none',
              border: 'none',
              color: '#ef4444',
              cursor: 'pointer',
            }}
          >
            <i className="fas fa-sign-out-alt" />
          </button>
        </div>
      )}
    </div>
  );
}