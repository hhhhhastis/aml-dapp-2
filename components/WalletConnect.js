import { useState, useEffect } from 'react';
import { WalletConnectModal } from '@walletconnect/modal';
import { TronWalletConnect } from '@walletconnect/tron';
import TronWeb from 'tronweb';
import toast from 'react-hot-toast';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID';

export default function WalletConnect({ onConnect, onDisconnect }) {
  const [address, setAddress] = useState(null);
  const [balance, setBalance] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [tronWebInstance, setTronWebInstance] = useState(null);

  const [wcClient, setWcClient] = useState(null);

  useEffect(() => {
    const init = async () => {
      const client = new TronWalletConnect({
        projectId,
        metadata: {
          name: 'AML Checker',
          description: 'AML verification dApp',
          url: window.location.origin,
          icons: [],
        },
      });
      setWcClient(client);
    };
    init();
  }, []);

  const connect = async () => {
    if (!wcClient) {
      toast.error('Инициализация...');
      return;
    }
    setConnecting(true);
    try {
      const session = await wcClient.connect();
      if (session && session.accounts && session.accounts[0]) {
        const addr = session.accounts[0];
        const tronWeb = session.tronWeb; // экземпляр TronWeb, готовый к использованию
        setAddress(addr);
        setTronWebInstance(tronWeb);
        onConnect?.(addr, tronWeb); // передаём tronWeb в родительский компонент
        const bal = await tronWeb.trx.getBalance(addr);
        setBalance(TronWeb.fromSun(bal));
        toast.success('Кошелёк подключён через WalletConnect');
      } else {
        throw new Error('Не удалось получить адрес');
      }
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Ошибка подключения');
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (wcClient) {
      await wcClient.disconnect();
    }
    setAddress(null);
    setBalance(null);
    setTronWebInstance(null);
    onDisconnect?.();
    toast.success('Кошелёк отключён');
  };

  const formatAddress = (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' }}>
      {!address ? (
        <button
          onClick={connect}
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
          {connecting ? <div className="spinner" /> : <i className="fas fa-qrcode" />}
          {connecting ? 'Подключение...' : 'Подключить кошелёк'}
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