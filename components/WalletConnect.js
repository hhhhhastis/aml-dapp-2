import { useState, useEffect, useRef } from 'react';
import { EthereumProvider } from '@walletconnect/ethereum-provider';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID';

export default function WalletConnect({ onConnect, onDisconnect }) {
  const [address, setAddress] = useState(null);
  const [balance, setBalance] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Закрытие меню при клике вне
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Проверка существующего подключения
  useEffect(() => {
    const checkExisting = async () => {
      if (window.ethereum && window.ethereum.selectedAddress) {
        const addr = window.ethereum.selectedAddress;
        setAddress(addr);
        onConnect?.(addr);
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const bal = await provider.getBalance(addr);
        setBalance(ethers.utils.formatEther(bal));
      }
    };
    checkExisting();
  }, []);

  // WalletConnect подключение
  const connectWalletConnect = async () => {
    setMenuOpen(false);
    setConnecting(true);
    try {
      const provider = await EthereumProvider.init({
        projectId,
        chains: [1],
        showQrModal: true,
        qrModalOptions: { themeMode: 'dark' },
      });
      await provider.connect();
      const ethersProvider = new ethers.providers.Web3Provider(provider);
      const signer = ethersProvider.getSigner();
      const addr = await signer.getAddress();
      setAddress(addr);
      onConnect?.(addr);
      const bal = await ethersProvider.getBalance(addr);
      setBalance(ethers.utils.formatEther(bal));
      toast.success('Кошелёк подключён через WalletConnect');
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Ошибка подключения WalletConnect');
    } finally {
      setConnecting(false);
    }
  };

  // TrustWallet (встроенный) подключение
  const connectTrustWallet = async () => {
    setMenuOpen(false);
    setConnecting(true);
    try {
      if (!window.ethereum) {
        toast.error('TrustWallet не обнаружен. Откройте сайт во встроенном браузере TrustWallet.');
        return;
      }
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const addr = accounts[0];
      if (!addr) throw new Error('Нет адреса');
      setAddress(addr);
      onConnect?.(addr);
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const bal = await provider.getBalance(addr);
      setBalance(ethers.utils.formatEther(bal));
      toast.success('TrustWallet подключён');
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Ошибка подключения TrustWallet');
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
                onClick={connectWalletConnect}
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
                <i className="fas fa-qrcode" style={{ width: '20px' }} />
                WalletConnect (QR-код)
              </button>
              <button
                onClick={connectTrustWallet}
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
                <i className="fas fa-wallet" style={{ width: '20px' }} />
                TrustWallet (встроенный)
              </button>
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
                {parseFloat(balance).toFixed(4)} ETH
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