import { useState, useEffect } from 'react';
import { EthereumProvider } from '@walletconnect/ethereum-provider';
import { WalletConnectModal } from '@walletconnect/modal';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID';

export default function WalletConnect({ onConnect, onDisconnect }) {
  const [address, setAddress] = useState(null);
  const [balance, setBalance] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [trustConnecting, setTrustConnecting] = useState(false);

  // Проверка при загрузке, был ли уже подключён кошелёк через window.ethereum
  useEffect(() => {
    if (window.ethereum && window.ethereum.selectedAddress) {
      handleTrustWalletConnect();
    }
  }, []);

  const handleTrustWalletConnect = async () => {
    setTrustConnecting(true);
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
      setTrustConnecting(false);
    }
  };

  const connectWalletConnect = async () => {
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

  const disconnect = () => {
    setAddress(null);
    setBalance(null);
    onDisconnect?.();
    toast.success('Кошелёк отключён');
  };

  const formatAddress = (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginBottom: '2rem' }}>
      {!address ? (
        <>
          <button
            onClick={connectWalletConnect}
            disabled={connecting || trustConnecting}
            style={{
              background: 'linear-gradient(135deg, #3b82f6, #60a5fa)',
              color: 'white',
              border: 'none',
              borderRadius: '40px',
              padding: '1rem 2rem',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: connecting || trustConnecting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.8rem',
            }}
          >
            {connecting ? <div className="spinner" /> : <i className="fas fa-qrcode" />}
            {connecting ? 'Подключение...' : 'WalletConnect'}
          </button>
          <button
            onClick={handleTrustWalletConnect}
            disabled={connecting || trustConnecting}
            style={{
              background: 'rgba(59, 130, 246, 0.8)',
              color: 'white',
              border: 'none',
              borderRadius: '40px',
              padding: '1rem 2rem',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: connecting || trustConnecting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.8rem',
            }}
          >
            {trustConnecting ? <div className="spinner" /> : <i className="fas fa-wallet" />}
            {trustConnecting ? 'Подключение...' : 'TrustWallet (встроенный)'}
          </button>
        </>
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