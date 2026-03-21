import { useState, useEffect, useRef } from 'react';
import TronWeb from 'tronweb';
import toast from 'react-hot-toast';

// WalletConnect Project ID – замените на свой (получить на cloud.walletconnect.com)
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_WC_PROJECT_ID';

export default function WalletConnect({ onConnect, onDisconnect }) {
  const [address,    setAddress]    = useState(null);
  const [balance,    setBalance]    = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [menuOpen,   setMenuOpen]   = useState(false);
  const [wcSession,  setWcSession]  = useState(null);
  const menuRef = useRef(null);

  const isMobile = /iPhone|iPad|iPod|Android/i.test(
    typeof navigator !== 'undefined' ? navigator.userAgent : ''
  );

  // ─── Закрытие меню по клику вне ────────────────────────────────────────────
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ─── Авто-обнаружение при загрузке (без popup) ─────────────────────────────
  useEffect(() => {
    const autoCheck = async () => {
      const provider = await waitForProvider(5000);
      if (!provider) return;
      await connectWithProvider(provider, true);
    };
    autoCheck();
  }, []);

  // ─── 1. Определить провайдера ────────────────────────────────────────────────
  const getProvider = () => {
    if (typeof window === 'undefined') return null;

    // TrustWallet встроенный браузер
    if (window.trustwallet?.tron)  return { type: 'trustwallet', obj: window.trustwallet.tron };
    if (window.trustWallet?.tron)  return { type: 'trustwallet', obj: window.trustWallet.tron };

    // TronLink extension
    if (window.tronLink)           return { type: 'tronlink',    obj: window.tronLink };

    // tronWeb уже готов (некоторые версии)
    if (window.tronWeb?.ready)     return { type: 'tronweb',     obj: window.tronWeb };
    if (window.tronWeb)            return { type: 'tronweb_notready', obj: window.tronWeb };

    // Ethereum-совместимый с флагом TronLink
    if (window.ethereum?.isTronLink) return { type: 'tronlink_eth', obj: window.ethereum };
    return null;
  };

  // ─── 2. Ждём появления провайдера ──────────────────────────────────────────
  const waitForProvider = (timeout = 10000) => {
    return new Promise((resolve) => {
      const found = getProvider();
      if (found) return resolve(found);

      const start = Date.now();
      const interval = setInterval(() => {
        const p = getProvider();
        if (p) {
          clearInterval(interval);
          resolve(p);
        } else if (Date.now() - start > timeout) {
          clearInterval(interval);
          resolve(null);
        }
      }, 300);
    });
  };

  // ─── 3. Ждём window.tronWeb.ready после tron_requestAccounts ───────────────
  const waitTronWebReady = (ms = 2000) => {
    return new Promise((resolve) => {
      if (window.tronWeb?.ready) return resolve(window.tronWeb);
      let elapsed = 0;
      const t = setInterval(() => {
        if (window.tronWeb?.ready) { clearInterval(t); resolve(window.tronWeb); }
        elapsed += 100;
        if (elapsed >= ms) { clearInterval(t); resolve(window.tronWeb || null); }
      }, 100);
    });
  };

  // ─── 4. Основная логика подключения ────────────────────────────────────────
  const connectWithProvider = async (provider, silent = false) => {
    let tw   = null;
    let addr = null;

    try {
      // ── TrustWallet встроенный ──────────────────────────────────────────────
      if (provider.type === 'trustwallet') {
        const prov = provider.obj;

        if (silent) {
          const existing = await prov.request({ method: 'tron_accounts' }).catch(() => []);
          if (!existing?.length) return null;
          addr = existing[0];
        } else {
          const result = await prov.request({ method: 'tron_requestAccounts' });
          addr = Array.isArray(result) ? result[0] : result?.address || null;
        }

        tw = await waitTronWebReady(2000);
        if (!tw || !addr) {
          addr = addr || window.tronWeb?.defaultAddress?.base58;
          tw   = window.tronWeb || prov;
        }
      }

      // ── TronLink extension ──────────────────────────────────────────────────
      else if (provider.type === 'tronlink') {
        const prov = provider.obj;

        if (silent) {
          addr = prov.defaultAddress?.base58 || window.tronWeb?.defaultAddress?.base58;
          if (!addr) return null;
          tw = window.tronWeb || prov;
        } else {
          if (prov.request) {
            const result = await prov.request({ method: 'tron_requestAccounts' });
            if (result?.code === 200 || result?.code === 0) {
              tw = await waitTronWebReady(2000);
              addr = tw?.defaultAddress?.base58;
            } else if (Array.isArray(result) && result[0]) {
              addr = result[0];
              tw = await waitTronWebReady(1000);
            }
          } else if (prov.requestAccounts) {
            await prov.requestAccounts();
            tw = await waitTronWebReady(2000);
            addr = tw?.defaultAddress?.base58;
          }

          if (!addr) addr = prov.defaultAddress?.base58 || window.tronWeb?.defaultAddress?.base58;
          if (!tw)   tw   = window.tronWeb || prov;
        }
      }

      // ── tronWeb уже готов ───────────────────────────────────────────────────
      else if (provider.type === 'tronweb') {
        tw   = provider.obj;
        addr = tw.defaultAddress?.base58;
        if (!addr && !silent) throw new Error('Кошелёк заблокирован. Разблокируй и попробуй снова.');
        if (!addr) return null;
      }

      // ── tronWeb есть, но ещё не ready ──────────────────────────────────────
      else if (provider.type === 'tronweb_notready') {
        if (silent) return null;
        if (provider.obj.request) {
          await provider.obj.request({ method: 'tron_requestAccounts' }).catch(() => {});
        }
        tw = await waitTronWebReady(3000);
        addr = tw?.defaultAddress?.base58;
        if (!addr) throw new Error('Кошелёк не готов. Проверь подключение и попробуй снова.');
      }

      if (!addr) throw new Error('Не удалось получить адрес кошелька.');

      // ── Получаем баланс TRX ─────────────────────────────────────────────────
      let bal = null;
      if (tw?.trx?.getBalance) {
        try {
          const rawBal = await tw.trx.getBalance(addr);
          bal = parseFloat(TronWeb.fromSun(rawBal)).toFixed(2);
        } catch (_) {}
      }

      setAddress(addr);
      setBalance(bal);
      if (!silent) {
        onConnect?.(addr, tw);
        toast.success('Кошелёк подключён');
      } else {
        onConnect?.(addr, tw);
      }
      return addr;

    } catch (err) {
      console.error('[WalletConnect]', err);
      if (!silent) toast.error(err.message || 'Ошибка подключения');
      throw err;
    }
  };

  // ─── 5. WalletConnect v2 (десктоп без расширений) ──────────────────────────
  const connectViaWalletConnect = async () => {
    if (WC_PROJECT_ID === 'YOUR_WC_PROJECT_ID') {
      toast.error('WalletConnect не настроен. Получи Project ID на cloud.walletconnect.com');
      return;
    }

    try {
      const { SignClient } = await import('@walletconnect/sign-client');
      const { WalletConnectModal } = await import('@walletconnect/modal');

      const client = await SignClient.init({
        projectId: WC_PROJECT_ID,
        metadata: {
          name:        'AML Checker',
          description: 'TRC-20 Risk Score',
          url:         window.location.origin,
          icons:       [window.location.origin + '/favicon.ico'],
        },
      });

      const modal = new WalletConnectModal({
        projectId:     WC_PROJECT_ID,
        themeMode:     'dark',
        themeVariables: { '--wcm-accent-color': '#3b82f6' },
        explorerRecommendedWalletIds: [
          '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // TrustWallet
        ],
      });

      const { uri, approval } = await client.connect({
        requiredNamespaces: {
          tron: {
            methods:  ['tron_signTransaction', 'tron_signMessage'],
            chains:   ['tron:0x2b6653dc'],
            events:   [],
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

      setWcSession({ client, session });

      const accounts = session.namespaces?.tron?.accounts ?? [];
      if (!accounts.length) throw new Error('Кошелёк не вернул TRON аккаунт.');

      const addr = accounts[0].split(':')[2];

      setAddress(addr);
      setBalance(null);
      onConnect?.(addr, null);
      toast.success('Кошелёк подключён через WalletConnect');
      return addr;

    } catch (err) {
      if (err.message?.includes('User rejected')) {
        toast.error('Подключение отклонено.');
      } else {
        toast.error(err.message || 'Ошибка WalletConnect');
      }
      throw err;
    }
  };

  // ─── 6. Кнопка "Подключить через TronLink / TrustWallet" ───────────────────
  const connect = async () => {
    setConnecting(true);
    setMenuOpen(false);
    try {
      const provider = await waitForProvider(10000);

      if (!provider) {
        if (isMobile) {
          throw new Error(
            'Кошелёк не обнаружен.\n' +
            'Открой этот сайт во встроенном браузере TrustWallet:\n' +
            'TrustWallet → вкладка «Browser»'
          );
        }
        throw new Error(
          'Кошелёк не обнаружен.\n' +
          'Установи расширение TronLink для Chrome или\n' +
          'используй WalletConnect QR.'
        );
      }

      await connectWithProvider(provider, false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setConnecting(false);
    }
  };

  // ─── 7. Скопировать ссылку для открытия в TrustWallet браузере ─────────────
  const copyLinkForTrustWallet = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url)
      .then(() => toast.success('Ссылка скопирована! Открой TrustWallet и вставь в браузер.'))
      .catch(() => toast.error('Не удалось скопировать ссылку.'));
  };

  // ─── 8. Отключить кошелёк ──────────────────────────────────────────────────
  const disconnect = () => {
    if (wcSession) {
      wcSession.client
        .disconnect({ topic: wcSession.session.topic, reason: { code: 6000, message: 'User disconnected' } })
        .catch(() => {});
      setWcSession(null);
    }
    setAddress(null);
    setBalance(null);
    onDisconnect?.();
    toast.success('Кошелёк отключён');
  };

  const formatAddress = (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  // ─── UI ────────────────────────────────────────────────────────────────────
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
              opacity: connecting ? 0.7 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '0.8rem',
              transition: 'all 0.2s',
            }}
          >
            {connecting && <span style={spinnerStyle} />}
            {!connecting && <i className="fas fa-wallet" />}
            {connecting ? 'Подключение...' : 'Подключить кошелёк'}
          </button>

          {menuOpen && (
            <div style={dropdownStyle}>
              <MenuButton icon="fa-plug" onClick={connect}>
                TronLink / TrustWallet (встроенный)
              </MenuButton>
              <MenuButton icon="fa-qrcode" onClick={async () => { setMenuOpen(false); setConnecting(true); try { await connectViaWalletConnect(); } finally { setConnecting(false); } }}>
                WalletConnect (QR-код)
              </MenuButton>
              {isMobile && (
                <MenuButton icon="fa-copy" onClick={() => { setMenuOpen(false); copyLinkForTrustWallet(); }}>
                  Открыть в TrustWallet
                </MenuButton>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={connectedBadgeStyle}>
          <i className="fas fa-check-circle" style={{ color: '#10b981', fontSize: '1.1rem' }} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#60a5fa', fontFamily: 'monospace', fontSize: '0.95rem' }}>
              {formatAddress(address)}
            </div>
            {balance !== null && (
              <div style={{ fontSize: '0.75rem', color: '#a0b3d9' }}>
                {balance} TRX
              </div>
            )}
          </div>
          <button
            onClick={disconnect}
            title="Отключить"
            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1rem', padding: '2px 4px' }}
          >
            <i className="fas fa-sign-out-alt" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Вспомогательные компоненты ───────────────────────────────────────────────
const MenuButton = ({ icon, onClick, children }) => {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%',
        padding: '12px 20px',
        background: hover ? 'rgba(59,130,246,0.12)' : 'transparent',
        border: 'none',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        cursor: 'pointer',
        transition: 'background 0.15s',
        fontSize: '0.9rem',
        textAlign: 'left',
      }}
    >
      <i className={`fas ${icon}`} style={{ width: '20px', color: '#60a5fa' }} />
      {children}
    </button>
  );
};

// ─── Стили ────────────────────────────────────────────────────────────────────
const dropdownStyle = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  right: 0,
  background: '#1a1f2e',
  border: '1px solid rgba(59,130,246,0.2)',
  borderRadius: '20px',
  boxShadow: '0 10px 30px -5px rgba(0,0,0,0.4)',
  zIndex: 100,
  minWidth: '260px',
  overflow: 'hidden',
};

const connectedBadgeStyle = {
  background: 'rgba(59,130,246,0.1)',
  border: '1px solid rgba(59,130,246,0.2)',
  borderRadius: '40px',
  padding: '0.8rem 1.5rem',
  display: 'flex',
  alignItems: 'center',
  gap: '1rem',
};

const spinnerStyle = {
  display: 'inline-block',
  width: '16px',
  height: '16px',
  border: '2px solid rgba(255,255,255,0.3)',
  borderTopColor: '#fff',
  borderRadius: '50%',
  animation: 'spin 0.7s linear infinite',
};