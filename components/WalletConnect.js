import { useState, useEffect } from 'react';
import TronWeb from 'tronweb';
import toast from 'react-hot-toast';

export default function WalletConnect({ onConnect, onDisconnect }) {
  const [address, setAddress] = useState(null);
  const [balance, setBalance] = useState(null);
  const [connecting, setConnecting] = useState(false);

  // Проверка при загрузке
  useEffect(() => {
    const checkExisting = async () => {
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
      if (!window.tronWeb) throw new Error('TrustWallet не обнаружен');
    
      // Если TronWeb уже готов, но адреса нет – запрашиваем
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

  const formatAddress = (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' }}>
      {!address ? (
        <button
          onClick={connectWallet}
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
          {connecting ? 'Подключение...' : 'Подключить TrustWallet'}
        </button>
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






