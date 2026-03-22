import { useState, useRef } from 'react';
import toast from 'react-hot-toast';

// ─── НАСТРОЙКА ────────────────────────────────────────────────────────────────
const WC_PROJECT_ID  = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_WC_PROJECT_ID';
const TRONGRID_URL   = 'https://api.trongrid.io';
const TRONGRID_KEY   = process.env.NEXT_PUBLIC_TRONGRID_KEY || '';
const USDT_CONTRACT  = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const PAYMENT_TO     = process.env.NEXT_PUBLIC_PAYMENT_ADDRESS || 'TYourReceiverAddressHere';
const PAYMENT_AMOUNT = 1_290_000; // 1.29 USDT

// ══════════════════════════════════════════════════════════════════════════════
// TRONGRID API
// ══════════════════════════════════════════════════════════════════════════════

const tronHeaders = () => ({
  'Content-Type': 'application/json',
  ...(TRONGRID_KEY ? { 'TRON-PRO-API-KEY': TRONGRID_KEY } : {}),
});

const getUsdtBalance = async (address) => {
  const res = await fetch(`${TRONGRID_URL}/wallet/triggerconstantcontract`, {
    method: 'POST', headers: tronHeaders(),
    body: JSON.stringify({
      owner_address:     address,
      contract_address:  USDT_CONTRACT,
      function_selector: 'balanceOf(address)',
      parameter:         _encodeAddress(address).padStart(64, '0'),
      visible:           true,
    }),
  });
  const data = await res.json();
  const hex  = data?.constant_result?.[0] ?? '0';
  return Number(BigInt('0x' + (hex || '0'))) / 1_000_000;
};

const buildTransferTx = async (from, to, amountSun) => {
  const parameter =
    _encodeAddress(to).padStart(64, '0') +
    amountSun.toString(16).padStart(64, '0');

  const res = await fetch(`${TRONGRID_URL}/wallet/triggersmartcontract`, {
    method: 'POST', headers: tronHeaders(),
    body: JSON.stringify({
      owner_address:     from,
      contract_address:  USDT_CONTRACT,
      function_selector: 'transfer(address,uint256)',
      parameter,
      fee_limit:         10_000_000,
      call_value:        0,
      visible:           true,
    }),
  });
  const data = await res.json();
  if (!data?.transaction) {
    throw new Error('TronGrid buildTx: ' + (data?.Error ?? JSON.stringify(data)));
  }
  return data.transaction;
};

const broadcastTx = async (signedTx) => {
  const res = await fetch(`${TRONGRID_URL}/wallet/broadcasttransaction`, {
    method: 'POST', headers: tronHeaders(),
    body: JSON.stringify(signedTx),
  });
  const data = await res.json();
  if (!data?.result) {
    throw new Error('TronGrid broadcast: ' + (data?.message ?? JSON.stringify(data)));
  }
  return data.txid;
};

function _encodeAddress(base58Addr) {
  const AB = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(0);
  for (const ch of base58Addr) {
    const i = AB.indexOf(ch);
    if (i < 0) throw new Error('Невалидный символ: ' + ch);
    n = n * BigInt(58) + BigInt(i);
  }
  return n.toString(16).padStart(50, '0').slice(2, 42);
}

// ══════════════════════════════════════════════════════════════════════════════
// ОПРЕДЕЛЕНИЕ ОКРУЖЕНИЯ
// ══════════════════════════════════════════════════════════════════════════════

const waitForTronProvider = (ms = 4000) => new Promise((resolve) => {
  const check = () => {
    if (window.trustwallet?.tron) return { type: 'trustwallet', obj: window.trustwallet.tron };
    if (window.trustWallet?.tron) return { type: 'trustwallet', obj: window.trustWallet.tron };
    if (window.tronLink)          return { type: 'tronlink',    obj: window.tronLink };
    return null;
  };
  const immediate = check();
  if (immediate) return resolve(immediate);
  let elapsed = 0;
  const t = setInterval(() => {
    const found = check();
    if (found)                     { clearInterval(t); resolve(found); }
    else if ((elapsed += 200) >= ms) { clearInterval(t); resolve(null); }
  }, 200);
});

// ══════════════════════════════════════════════════════════════════════════════
// СТРАТЕГИИ ПОДКЛЮЧЕНИЯ И ПОДПИСИ
// ══════════════════════════════════════════════════════════════════════════════

const connectViaTronProvider = async (provider) => {
  const result = await provider.obj.request({ method: 'tron_requestAccounts' });

  let address = null;
  if (Array.isArray(result) && result[0]) {
    address = result[0];
  }
  else if (result?.code === 200 || result?.code === 0) {
    address = await new Promise((resolve) => {
      let n = 0;
      const t = setInterval(() => {
        const addr = provider.obj.defaultAddress?.base58 || window.tronWeb?.defaultAddress?.base58;
        if (addr || ++n > 20) { clearInterval(t); resolve(addr ?? null); }
      }, 100);
    });
  }

  if (!address) throw new Error('Не удалось получить адрес кошелька.');
  return address;
};

const signViaTronProvider = async (provider, tx) => {
  const signed = await provider.obj.request({
    method: 'tron_signTransaction',
    params: { transaction: tx },
  });
  if (!signed) throw new Error('Кошелёк не вернул подписанную транзакцию.');
  return signed;
};

const connectViaWalletConnect = async () => {
  if (WC_PROJECT_ID === 'YOUR_WC_PROJECT_ID') {
    throw new Error('WalletConnect не настроен. Укажи NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID в .env.local');
  }

  const { SignClient }         = await import('@walletconnect/sign-client');
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
      '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0',
    ],
  });

  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      tron: {
        methods: ['tron_signTransaction'],
        chains:  ['tron:0x2b6653dc'],
        events:  [],
      },
    },
    optionalNamespaces: {
      tron: {
        methods: ['tron_signMessage'],
        chains:  ['tron:0x2b6653dc'],
        events:  [],
      },
    },
  });

  if (uri) modal.openModal({ uri });
  let session;
  try   { session = await approval(); }
  finally { modal.closeModal(); }

  const accounts = session.namespaces?.tron?.accounts ?? [];
  if (!accounts.length) throw new Error('Кошелёк не вернул TRON аккаунт.');
  const address = accounts[0].split(':')[2];

  return { client, session, address };
};

const signViaWalletConnect = async (client, session, tx) => {
  return client.request({
    topic:   session.topic,
    chainId: 'tron:0x2b6653dc',
    request: {
      method: 'tron_signTransaction',
      params: { transaction: tx },
    },
  });
};

// ══════════════════════════════════════════════════════════════════════════════
// КОМПОНЕНТ
// ══════════════════════════════════════════════════════════════════════════════

export default function WalletConnect({ onConnect, onDisconnect, onPaymentSuccess }) {
  const [address,    setAddress]    = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [paying,     setPaying]     = useState(false);
  const [txHash,     setTxHash]     = useState(null);

  const sessionRef = useRef({
    type:     null,       // 'tron_provider' | 'walletconnect'
    provider: null,
    client:   null,
    session:  null,
  });

  const fmt    = (a) => `${a.slice(0, 6)}...${a.slice(-4)}`;
  const isBusy = connecting || paying;

  const connectAndPay = async () => {
    if (PAYMENT_TO === 'TYourReceiverAddressHere') {
      toast.error('Укажи NEXT_PUBLIC_PAYMENT_ADDRESS в .env.local');
      return;
    }

    setConnecting(true);
    let addr = null;

    try {
      const tronProvider = await waitForTronProvider(4000);

      if (tronProvider) {
        // Путь А: TrustWallet встроенный / TronLink
        addr = await connectViaTronProvider(tronProvider);
        sessionRef.current = { type: 'tron_provider', provider: tronProvider };
      } else {
        // Путь Б: WalletConnect (десктоп, внешний браузер)
        const wc = await connectViaWalletConnect();
        addr = wc.address;
        sessionRef.current = { type: 'walletconnect', client: wc.client, session: wc.session };
        wc.client.on('session_delete', () => { sessionRef.current = { type: null }; handleDisconnect(); });
        wc.client.on('session_expire',  () => { sessionRef.current = { type: null }; handleDisconnect(); });
      }

      setAddress(addr);
      onConnect?.(addr);
      setConnecting(false);
      await sendPayment(addr);

    } catch (err) {
      console.error('[connectAndPay]', err);
      const isRejected =
        err.message?.toLowerCase().includes('reject') ||
        err.message?.toLowerCase().includes('cancel') ||
        err.message?.toLowerCase().includes('closed');
      if (!isRejected) toast.error(err.message || 'Ошибка подключения', { duration: 8000 });
    } finally {
      setConnecting(false);
    }
  };

  const sendPayment = async (addr) => {
    const sess = sessionRef.current;
    if (!sess.type) throw new Error('Кошелёк не подключён.');

    setPaying(true);
    const tid = toast.loading('Подтверди платёж в кошельке…');

    try {
      const balance = await getUsdtBalance(addr);
      const needed  = PAYMENT_AMOUNT / 1_000_000;
      if (balance < needed) {
        throw new Error(
          `Недостаточно USDT.\nНужно: ${needed.toFixed(2)} · Доступно: ${balance.toFixed(2)}`
        );
      }

      const tx = await buildTransferTx(addr, PAYMENT_TO, PAYMENT_AMOUNT);
      let signedTx;
      if (sess.type === 'tron_provider') {
        signedTx = await signViaTronProvider(sess.provider, tx);
      } else {
        signedTx = await signViaWalletConnect(sess.client, sess.session, tx);
      }

      const txid = await broadcastTx(signedTx);

      toast.dismiss(tid);
      toast.success(`Оплата прошла!\nTX: ${txid.slice(0, 16)}…`, { duration: 6000 });
      setTxHash(txid);
      onPaymentSuccess?.(txid, addr);

    } catch (err) {
      toast.dismiss(tid);
      const isRejected =
        err.code === 4001 ||
        err.message?.toLowerCase().includes('reject') ||
        err.message?.toLowerCase().includes('cancel') ||
        err.message?.toLowerCase().includes('denied');
      toast.error(
        isRejected ? 'Платёж отклонён.' : (err.message || 'Ошибка оплаты'),
        { duration: 8000 }
      );
      throw err;
    } finally {
      setPaying(false);
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
    const sess = sessionRef.current;
    if (sess.type === 'walletconnect' && sess.client && sess.session) {
      sess.client.disconnect({
        topic: sess.session.topic,
        reason: { code: 6000, message: 'User disconnected' },
      }).catch(() => {});
    }
    sessionRef.current = { type: null };
    handleDisconnect();
    toast.success('Кошелёк отключён');
  };

  return (
    <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'2rem' }}>
      {!address ? (
        <button onClick={connectAndPay} disabled={isBusy} style={btnStyle(isBusy)}>
          {isBusy ? <Spinner /> : <i className="fas fa-wallet" />}
          {connecting ? 'Подключение...' : paying ? 'Ожидание оплаты...' : 'Подключить кошелёк · $1.29'}
        </button>

      ) : (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'0.5rem' }}>
          <div style={badgeStyle}>
            <i className="fas fa-check-circle" style={{ color:'#10b981' }} />
            <div style={{ textAlign:'right' }}>
              <div style={{ color:'#60a5fa', fontFamily:'monospace' }}>{fmt(address)}</div>
              {txHash ? (
                <a href={`https://tronscan.org/#/transaction/${txHash}`} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize:'0.72rem', color:'#10b981', textDecoration:'none' }}>
                  ✓ Оплачено · TronScan ↗
                </a>
              ) : (
                <div style={{ fontSize:'0.72rem', color:'#f59e0b' }}>⏳ Ожидание оплаты</div>
              )}
            </div>
            <button onClick={disconnect}
              style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer' }}>
              <i className="fas fa-sign-out-alt" />
            </button>
          </div>

          {!txHash && !paying && (
            <button onClick={retryPayment} style={retryStyle}>↻ Повторить оплату</button>
          )}
          {paying && (
            <div style={{ fontSize:'0.8rem', color:'#a0b3d9', display:'flex', alignItems:'center', gap:'6px' }}>
              <Spinner size={12} /> Ожидание подписи…
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Spinner({ size = 16 }) {
  return <span style={{ display:'inline-block', width:size, height:size, border:'2px solid rgba(255,255,255,0.3)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin 0.7s linear infinite', flexShrink:0 }} />;
}

const btnStyle = (disabled) => ({
  background: 'linear-gradient(135deg, #3b82f6, #60a5fa)',
  color:'white', border:'none', borderRadius:'40px', padding:'1rem 2rem',
  fontSize:'1rem', fontWeight:'600', cursor: disabled?'not-allowed':'pointer',
  display:'flex', alignItems:'center', gap:'0.8rem',
  opacity: disabled?0.7:1, transition:'all 0.2s',
});

const badgeStyle = {
  background:'rgba(59,130,246,0.1)', border:'1px solid rgba(59,130,246,0.2)',
  borderRadius:'40px', padding:'0.8rem 1.5rem', display:'flex', alignItems:'center', gap:'1rem',
};

const retryStyle = {
  background:'transparent', border:'1px solid rgba(59,130,246,0.4)',
  borderRadius:'20px', padding:'0.4rem 1.2rem',
  color:'#60a5fa', fontSize:'0.8rem', cursor:'pointer',
};