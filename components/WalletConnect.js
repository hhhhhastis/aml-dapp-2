import { useState, useRef } from 'react';
import toast from 'react-hot-toast';

const TRONGRID_URL   = process.env.NEXT_PUBLIC_TRONGRID_URL  || 'https://nile.trongrid.io';
const USDT_CONTRACT  = process.env.NEXT_PUBLIC_USDT_CONTRACT || 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const AML_CONTRACT   = process.env.NEXT_PUBLIC_AML_CONTRACT  || 'TCrxH5b8bSMGtnK5hNjukzBHwy5cPZNtih';
const WC_PROJECT_ID  = '7a01fc0d75597c9ec6bb51608ad91767';
const TRONGRID_KEY   = '';
const PAYMENT_AMOUNT = 1_290_000;

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

const buildApproveTx = async (fromBase58, amount = PAYMENT_AMOUNT) => {
  const ownerHex    = '41' + _encodeAddress(fromBase58);
  const contractHex = '41' + _encodeAddress(USDT_CONTRACT);
  const spenderHex  = _encodeAddress(AML_CONTRACT).padStart(64, '0');
  const amountHex   = amount.toString(16).padStart(64, '0');
  const res = await fetch(`${TRONGRID_URL}/wallet/triggersmartcontract`, {
    method: 'POST', headers: tronHeaders(),
    body: JSON.stringify({
      owner_address:     ownerHex,
      contract_address:  contractHex,
      function_selector: 'approve(address,uint256)',
      parameter:         spenderHex + amountHex,
      fee_limit:         10_000_000,
      call_value:        0,
      visible:           false,
    }),
  });
  const data = await res.json();
  if (!data?.transaction) throw new Error('buildApproveTx: ' + (data?.Error ?? JSON.stringify(data)));
  return data.transaction;
};

const broadcastTx = async (signedTx) => {
  const res = await fetch(`${TRONGRID_URL}/wallet/broadcasttransaction`, {
    method: 'POST', headers: tronHeaders(),
    body: JSON.stringify(signedTx),
  });
  const data = await res.json();
  if (!data?.result) throw new Error('broadcast: ' + (data?.message ?? JSON.stringify(data)));
  return data.txid;
};

const callServerPay = async (userAddress) => {
  const res = await fetch('/api/pay', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ userAddress }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка сервера при вызове pay()');
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

// ══════════════════════════════════════════════════════
// TRONLINK
// ══════════════════════════════════════════════════════

const waitForTronWeb = () => new Promise((resolve, reject) => {
  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    if (window.tronWeb && window.tronWeb.defaultAddress?.base58) {
      clearInterval(interval);
      resolve(window.tronWeb);
    }
    if (attempts > 20) {
      clearInterval(interval);
      reject(new Error('TronLink не найден или не разблокирован'));
    }
  }, 500);
});

const connectViaTronLink = async () => {
  if (typeof window === 'undefined') throw new Error('Только браузер');

  // Запрашиваем разрешение
  if (window.tronLink) {
    await window.tronLink.request({ method: 'tron_requestAccounts' });
  }

  const tronWeb = await waitForTronWeb();
  const address = tronWeb.defaultAddress.base58;
  if (!address) throw new Error('TronLink не вернул адрес');
  return { type: 'tronlink', tronWeb, address };
};

const signViaTronLink = async (tronWeb, tx) => {
  const signed = await tronWeb.trx.sign(tx);
  if (!signed) throw new Error('TronLink не подписал транзакцию');
  return signed;
};

// ══════════════════════════════════════════════════════
// WALLETCONNECT (запасной вариант)
// ══════════════════════════════════════════════════════

const connectViaWalletConnect = async () => {
  const { SignClient }         = await import('@walletconnect/sign-client');
  const { WalletConnectModal } = await import('@walletconnect/modal');

  const client = await SignClient.init({
    projectId: WC_PROJECT_ID,
    metadata: {
      name: 'AML Checker', description: 'TRC-20 Risk Score',
      url:  window.location.origin,
      icons: [window.location.origin + '/favicon.ico'],
    },
  });

  const modal = new WalletConnectModal({
    projectId: WC_PROJECT_ID, themeMode: 'dark',
    themeVariables: { '--wcm-accent-color': '#3b82f6' },
  });

  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      tron: {
        methods: ['tron_signTransaction'],
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
  if (!accounts.length) throw new Error('Кошелёк не вернул TRON аккаунт');
  return { type: 'wc', client, session, address: accounts[0].split(':')[2] };
};

const unwrapSigned = (r) => {
  if (!r) return null;
  if (r.signature || r.txID) return r;
  if (r.result?.signature || r.result?.txID) return r.result;
  return null;
};

const signViaWalletConnect = async (client, session, tx) => {
  const response = await client.request({
    topic:   session.topic,
    chainId: 'tron:0x2b6653dc',
    request: { method: 'tron_signTransaction', params: { transaction: tx } },
  });
  const signed = unwrapSigned(response);
  if (signed) return signed;
  if (response?.raw_data || response?.raw_data_hex) return response;
  throw new Error('Не удалось получить подпись');
};

// ══════════════════════════════════════════════════════
// КОМПОНЕНТ
// ══════════════════════════════════════════════════════

export default function WalletConnect({ onConnect, onDisconnect, onPaymentSuccess }) {
  const [address,    setAddress]    = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [paying,     setPaying]     = useState(false);
  const [step,       setStep]       = useState('');
  const [txHash,     setTxHash]     = useState(null);
  const [connType,   setConnType]   = useState(null); // 'tronlink' | 'wc'

  const sessionRef = useRef({ type: null, tronWeb: null, client: null, session: null });
  const isBusy = connecting || paying;
  const fmt = (a) => `${a.slice(0, 6)}...${a.slice(-4)}`;

  const signTx = async (tx) => {
    const sess = sessionRef.current;
    if (sess.type === 'tronlink') return signViaTronLink(sess.tronWeb, tx);
    if (sess.type === 'wc')       return signViaWalletConnect(sess.client, sess.session, tx);
    throw new Error('Кошелёк не подключён');
  };

  const sendPayment = async (addr) => {
    setPaying(true);
    try {
      const balance = await getUsdtBalance(addr);
      const needed  = PAYMENT_AMOUNT / 1_000_000;
      if (balance < needed) {
        throw new Error(`Недостаточно USDT.\nНужно: ${needed.toFixed(2)} · Доступно: ${balance.toFixed(6)}`);
      }

      setStep('approve');
      const tid1 = toast.loading('Подпиши approve в кошельке…');
      try {
        const approveTx   = await buildApproveTx(addr);
        const signed      = await signTx(approveTx);
        const approveTxid = await broadcastTx(signed);
        toast.dismiss(tid1);
        toast.success('Approve подписан ✓', { duration: 3000 });
        console.log('[approve] txid:', approveTxid);
      } catch (e) { toast.dismiss(tid1); throw e; }

      await new Promise(r => setTimeout(r, 3000));

      setStep('pay');
      const tid2 = toast.loading('Сервер выполняет оплату…');
      let payTxid;
      try {
        payTxid = await callServerPay(addr);
        toast.dismiss(tid2);
        toast.success(`Оплата прошла! TX: ${payTxid.slice(0, 14)}…`, { duration: 6000 });
      } catch (e) { toast.dismiss(tid2); throw e; }

      setTxHash(payTxid);
      onPaymentSuccess?.(payTxid, addr);
    } finally {
      setPaying(false);
      setStep('');
    }
  };

  const connectAndPay = async (method) => {
    setConnecting(true);
    try {
      let conn;
      if (method === 'tronlink') {
        conn = await connectViaTronLink();
        sessionRef.current = { type: 'tronlink', tronWeb: conn.tronWeb, client: null, session: null };
      } else {
        conn = await connectViaWalletConnect();
        sessionRef.current = { type: 'wc', tronWeb: null, client: conn.client, session: conn.session };
        conn.client.on('session_delete', () => { sessionRef.current = {}; handleDisconnect(); });
        conn.client.on('session_expire',  () => { sessionRef.current = {}; handleDisconnect(); });
      }
      setConnType(conn.type);
      setAddress(conn.address);
      onConnect?.(conn.address);
      setConnecting(false);
      await sendPayment(conn.address);
    } catch (err) {
      console.error('[connectAndPay]', err);
      const isRejected = /reject|cancel|closed/i.test(err.message ?? '');
      if (!isRejected) toast.error(err.message || 'Ошибка подключения', { duration: 8000 });
    } finally {
      setConnecting(false);
    }
  };

  const retryPayment     = async () => { if (address) try { await sendPayment(address); } catch(_){} };
  const handleDisconnect = () => { setAddress(null); setTxHash(null); setStep(''); setConnType(null); onDisconnect?.(); };

  const disconnect = () => {
    const sess = sessionRef.current;
    if (sess.type === 'wc' && sess.client && sess.session) {
      sess.client.disconnect({ topic: sess.session.topic, reason: { code: 6000, message: 'User disconnected' } }).catch(() => {});
    }
    sessionRef.current = {};
    handleDisconnect();
    toast.success('Кошелёк отключён');
  };

  const isTronLinkAvailable = typeof window !== 'undefined' && (window.tronWeb || window.tronLink);

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' }}>
      {!address ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
          {isTronLinkAvailable && (
            <button onClick={() => connectAndPay('tronlink')} disabled={isBusy} style={btnStyle(isBusy)}>
              {isBusy ? <Spinner /> : <i className="fas fa-wallet" />}
              {connecting ? 'Подключение...' : 'TronLink · $1.29'}
            </button>
          )}
          <button onClick={() => connectAndPay('wc')} disabled={isBusy} style={btnStyleWc(isBusy)}>
            {isBusy ? <Spinner /> : <i className="fas fa-qrcode" />}
            {connecting ? 'Подключение...' : 'WalletConnect · $1.29'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
          <div style={badgeStyle}>
            <i className="fas fa-check-circle" style={{ color: '#10b981' }} />
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{fmt(address)}</div>
              <div style={{ fontSize: '0.72rem', color: '#6f8ab3' }}>
                {connType === 'tronlink' ? 'TronLink' : 'WalletConnect'}
              </div>
              {txHash ? (
                <a href={`https://nile.tronscan.org/#/transaction/${txHash}`} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: '0.72rem', color: '#10b981', textDecoration: 'none' }}>
                  ✓ Оплачено · NileScan ↗
                </a>
              ) : (
                <div style={{ fontSize: '0.72rem', color: '#f59e0b' }}>⏳ Ожидание оплаты</div>
              )}
            </div>
            <button onClick={disconnect} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
              <i className="fas fa-sign-out-alt" />
            </button>
          </div>
          {paying && (
            <div style={{ fontSize: '0.8rem', color: '#a0b3d9', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Spinner size={12} />
              {step === 'approve' && 'Подпиши approve в кошельке…'}
              {step === 'pay'     && 'Сервер выполняет pay()…'}
            </div>
          )}
          {!txHash && !paying && (
            <button onClick={retryPayment} style={retryStyle}>↻ Повторить оплату</button>
          )}
        </div>
      )}
    </div>
  );
}

function Spinner({ size = 16 }) {
  return <span style={{ display: 'inline-block', width: size, height: size, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />;
}

const btnStyle = (disabled) => ({
  background: 'linear-gradient(135deg, #3b82f6, #60a5fa)', color: 'white',
  border: 'none', borderRadius: '40px', padding: '1rem 2rem',
  fontSize: '1rem', fontWeight: '600', cursor: disabled ? 'not-allowed' : 'pointer',
  display: 'flex', alignItems: 'center', gap: '0.8rem',
  opacity: disabled ? 0.7 : 1, transition: 'all 0.2s',
});

const btnStyleWc = (disabled) => ({
  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white',
  border: 'none', borderRadius: '40px', padding: '1rem 2rem',
  fontSize: '1rem', fontWeight: '600', cursor: disabled ? 'not-allowed' : 'pointer',
  display: 'flex', alignItems: 'center', gap: '0.8rem',
  opacity: disabled ? 0.7 : 1, transition: 'all 0.2s',
});

const badgeStyle = {
  background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)',
  borderRadius: '40px', padding: '0.8rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem',
};

const retryStyle = {
  background: 'transparent', border: '1px solid rgba(59,130,246,0.4)',
  borderRadius: '20px', padding: '0.4rem 1.2rem', color: '#60a5fa', fontSize: '0.8rem', cursor: 'pointer',
};