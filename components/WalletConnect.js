import { useState } from 'react';
import toast from 'react-hot-toast';

const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_WC_PROJECT_ID';

export default function WalletConnect({ onConnect, onDisconnect }) {
  const [address, setAddress] = useState(null);
  const [connecting, setConnecting] = useState(false);

  const connectWalletConnect = async () => {
    if (WC_PROJECT_ID === 'YOUR_WC_PROJECT_ID') {
      toast.error('WalletConnect не настроен. Получи Project ID на cloud.walletconnect.com');
      return;
    }

    setConnecting(true);
    try {
      const { SignClient } = await import('@walletconnect/sign-client');
      const { WalletConnectModal } = await import('@walletconnect/modal');

      const client = await SignClient.init({
        projectId: WC_PROJECT_ID,
        metadata: {
          name: 'AML Checker',
          description: 'TRC-20 Risk Score',
          url: window.location.origin,
          icons: [window.location.origin + '/favicon.ico'],
        },
      });

      const modal = new WalletConnectModal({
        projectId: WC_PROJECT_ID,
        themeMode: 'dark',
        themeVariables: { '--wcm-accent-color': '#3b82f6' },
        explorerRecommendedWalletIds: [
          '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // TrustWallet
        ],
      });

      const { uri, approval } = await client.connect({
        requiredNamespaces: {
          tron: {
            methods: ['tron_signTransaction', 'tron_signMessage'],
            chains: ['tron:0x2b6653dc'],
            events: [],
          },
        },
      });

      if (uri) modal.openModal({ uri });

      let session;
      try {
        session = await approval();
      } finally {
        modal.closeModal();
      }

      const accounts = session.namespaces?.tron?.accounts ?? [];
      if (!accounts.length) throw new Error('Кошелёк не вернул TRON аккаунт.');
      const addr = accounts[0].split(':')[2];

      setAddress(addr);
      onConnect?.(addr);
      toast.success('Кошелёк подключён');
    } catch (err) {
      console.error(err);
      if (err.message?.includes('User rejected')) {
        toast.error('Подключение отклонено.');
      } else {
        toast.error(err.message || 'Ошибка подключения');
      }
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () => {
    setAddress(null);
    onDisconnect?.();
    toast.success('Кошелёк отключён');
  };

  const formatAddress = (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' }}>
      {!address ? (
        <button
          onClick={connectWalletConnect}
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
            <div style={{ color: '#60a5fa', fontFamily: 'monospace' }}>
              {formatAddress(address)}
            </div>
          </div>
          <button
            onClick={disconnect}
            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
          >
            <i className="fas fa-sign-out-alt" />
          </button>
        </div>
      )}
    </div>
  );
}