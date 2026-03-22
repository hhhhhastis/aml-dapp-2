import { useState, useRef } from 'react';
import toast from 'react-hot-toast';

const WC_PROJECT_ID  = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_WC_PROJECT_ID';
const TRONGRID_URL   = 'https://api.trongrid.io';
const TRONGRID_KEY   = process.env.NEXT_PUBLIC_TRONGRID_KEY || '';
const USDT_CONTRACT  = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const PAYMENT_TO     = process.env.NEXT_PUBLIC_PAYMENT_ADDRESS || 'TYourReceiverAddressHere';
const PAYMENT_AMOUNT = 1_290_000; // 1.29 USDT

// ─── TronGrid API helpers ──────────────────────────────────────────────────
const tronHeaders = () => ({
  'Content-Type': 'application/json',
  ...(TRONGRID_KEY ? { 'TRON-PRO-API-KEY': TRONGRID_KEY } : {}),
});

const getUsdtBalance = async (address) => {
  const res = await fetch(`${TRONGRID_URL}/wallet/triggerconstantcontract`, {
    method: 'POST',
    headers: tronHeaders(),
    body: JSON.stringify({
      owner_address:     address,
      contract_address:  USDT_CONTRACT,
      function_selector: 'balanceOf(address)',
      parameter:         encodeAddress(address).padStart(64, '0'),
      visible:           true,
    }),
  });
  const data = await res.json();
  const hex = data?.constant_result?.[0] ?? '0';
  return Number(BigInt('0x' + (hex || '0'))) / 1_000_000;
};

const buildTransferTx = async (fromAddress, toAddress, amountSun) => {
  const parameter = encodeAddress(toAddress).padStart(64, '0') + amountSun.toString(16).padStart(64, '0');
  const res = await fetch(`${TRONGRID_URL}/wallet/triggersmartcontract`, {
    method: 'POST',
    headers: tronHeaders(),
    body: JSON.stringify({
      owner_address:     fromAddress,
      contract_address:  USDT_CONTRACT,
      function_selector: 'transfer(address,uint256)',
      parameter,
      fee_limit:         10_000_000,
      call_value:        0,
      visible:           true,
    }),
  });
  const data = await res.json();
  if (!data?.transaction) throw new Error('TronGrid: не удалось построить транзакцию. ' + (data?.Error ?? JSON.stringify(data)));
  return data.transaction;
};

const broadcastTx = async (signedTx) => {
  const res = await fetch(`${TRONGRID_URL}/wallet/broadcasttransaction`, {
    method: 'POST',
    headers: tronHeaders(),
    body: JSON.stringify(signedTx),
  });
  const data = await res.json();
  if (!data?.result) throw new Error('Broadcast ошибка: ' + (data?.message ?? JSON.stringify(data)));
  return data.txid;
};

function encodeAddress(base58Addr) {
  const AB = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(0);
  for (const ch of base58Addr) {
    const i = AB.indexOf(ch);
    if (i < 0) throw new Error('Невалидный base58 символ: ' + ch);
    n = n * BigInt(58) + BigInt(i);
  }
  return n.toString(16).padStart(50, '0').slice(2, 42);
}

// ─── Spinner ────────────────────────────────────────────────────────────────
const Spinner = ({ size = 16 }) => (
  <span style={{
    display: 'inline-block',
    width: size,
    height: size,
    border: '2px solid rgba(255,255,255,0.3)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
    flexShrink: 0,
  }} />
);

// ─── Компонент ─────────────────────────────────────────────────────────────
export default function WalletConnect({ onConnect, onDisconnect, onPaymentSuccess }) {
  const [address, setAddress] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const wcRef = useRef({ client: null, session: null });

  const fmt = (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  const isBusy = connecting || paying;

  const sendPayment = async (addr) => {
    setPaying(true);
    const tid = toast.loading('Подтверди оплату в кошельке…');
    try {
      const { client, session } = wcRef.current;
      if (!client || !session) throw new Error('Сессия WalletConnect потеряна.');

      const balance = await getUsdtBalance(addr);
      const needed = PAYMENT_AMOUNT / 1_000_000;
      if (balance < needed) {
        throw new Error(`Недостаточно USDT. Нужно: ${needed.toFixed(2)} USDT · Доступно: ${balance.toFixed(2)} USDT`);
      }

      const tx = await buildTransferTx(addr, PAYMENT_TO, PAYMENT_AMOUNT);
      const signedTx = await client.request({
        topic: session.topic,
        chainId: 'tron:0x2b6653dc',
        request: {
          method: 'tron_signTransaction',
          params: { transaction: tx },
        },
      });
      const txid = await broadcastTx(signedTx);

      toast.dismiss(tid);
      toast.success(`Оплата прошла!\nTX: ${txid.slice(0, 16)}…`, { duration: 6000 });
      setTxHash(txid);
      onPaymentSuccess?.(txid, addr);
    } catch (err) {
      toast.dismiss(tid);
      const isRejected = err.code === 4001 || err.message?.toLowerCase().includes('reject') || err.message?.toLowerCase().includes('cancel');
      toast.error(isRejected ? 'Оплата отклонена в кошельке.' : (err.message || 'Ошибка оплаты'));
      throw err;
    } finally {
      setPaying(false);
    }
  };

  const connectAndPay = async () => {
    if (WC_PROJECT_ID === 'YOUR_WC_PROJECT_ID') {
      toast.error('Укажи WalletConnect Project ID в .env.local');
      return;
    }
    if (PAYMENT_TO === 'TYourReceiverAddressHere') {
      toast.error('Укажи адрес получателя NEXT_PUBLIC_PAYMENT_ADDRESS в .env.local');
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
          description: 'TRC-20 Risk Score · 1.29 USDT',
          url: window.location.origin,
          icons: [window.location.origin + '/favicon.ico'],
        },
      });

      client.on('session_delete', () => { wcRef.current = { client: null, session: null }; handleDisconnect(); });
      client.on('session_expire',  () => { wcRef.current = { client: null, session: null }; handleDisconnect(); });

      const modal = new WalletConnectModal({
        projectId: WC_PROJECT_ID,
        themeMode: 'dark',
        themeVariables: { '--wcm-accent-color': '#3b82f6' },
        explorerRecommendedWalletIds: ['4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0'],
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
      try { session = await approval(); } finally { modal.closeModal(); }

      const accounts = session.namespaces?.tron?.accounts ?? [];
      if (!accounts.length) throw new Error('Кошелёк не вернул TRON аккаунт.');
      const addr = accounts[0].split(':')[2];

      wcRef.current = { client, session };
      setAddress(addr);
      onConnect?.(addr);
      setConnecting(false);
      await sendPayment(addr);
    } catch (err) {
      console.error('[connectAndPay]', err);
      const isRejected = err.message?.toLowerCase().includes('reject') || err.message?.toLowerCase().includes('cancel');
      if (!isRejected) toast.error(err.message || 'Ошибка подключения');
    } finally {
      setConnecting(false);
    }
  };

  const retryPayment = async () => {
    if (!address) return;
    try { await sendPayment(address); } catch (_) {}
  };

  const handleDisconnect = () => {
    setAddress(null);
    setTxHash(null);
    onDisconnect?.();
  };

  const disconnect = () => {
    const { client, session } = wcRef.current;
    if (client && session) {
      client.disconnect({ topic: session.topic, reason: { code: 6000, message: 'User disconnected' } }).catch(() => {});
    }
    wcRef.current = { client: null, session: null };
    handleDisconnect();
    toast.success('Кошелёк отключён');
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' }}>
      {!address ? (
        <button
          onClick={connectAndPay}
          disabled={isBusy}
          style={{
            background: 'linear-gradient(135deg, #3b82f6, #60a5fa)',
            color: 'white',
            border: 'none',
            borderRadius: '40px',
            padding: '1rem 2rem',
            fontSize: '1rem',
            fontWeight: '600',
            cursor: isBusy ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.8rem',
            opacity: isBusy ? 0.7 : 1,
          }}
        >
          {isBusy ? <Spinner /> : <i className="fas fa-qrcode" />}
          {connecting ? 'Подключение...' : paying ? 'Ожидание оплаты...' : 'Подключить кошелёк · $1.29'}
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
          <div style={{
            background: 'rgba(59,130,246,0.1)',
            border: '1px solid rgba(59,130,246,0.2)',
            borderRadius: '40px',
            padding: '0.8rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
          }}>
            <i className="fas fa-check-circle" style={{ color: '#10b981' }} />
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{fmt(address)}</div>
              {txHash ? (
                <a href={`https://tronscan.org/#/transaction/${txHash}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.72rem', color: '#10b981', textDecoration: 'none' }}>
                  ✓ Оплачено · TronScan ↗
                </a>
              ) : (
                <div style={{ fontSize: '0.72rem', color: '#f59e0b' }}>⏳ Ожидание оплаты</div>
              )}
            </div>
            <button onClick={disconnect} title="Отключить" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
              <i className="fas fa-sign-out-alt" />
            </button>
          </div>
          {!txHash && (
            <button onClick={retryPayment} disabled={paying} style={{
              background: 'transparent',
              border: '1px solid rgba(59,130,246,0.4)',
              borderRadius: '20px',
              padding: '0.4rem 1.2rem',
              color: '#60a5fa',
              fontSize: '0.8rem',
              cursor: paying ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              {paying ? <><Spinner size={12} /> Обработка…</> : '↻ Повторить оплату'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}