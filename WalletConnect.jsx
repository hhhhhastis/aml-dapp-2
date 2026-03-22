import { useState, useRef } from 'react';
import toast from 'react-hot-toast';

// ─── НАСТРОЙКА ────────────────────────────────────────────────────────────────
const WC_PROJECT_ID  = '7a01fc0d75597c9ec6bb51608ad91767';
const TRONGRID_URL   = 'https://api.trongrid.io';
const TRONGRID_KEY   = '';
const USDT_CONTRACT  = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const AML_CONTRACT   = 'ВСТАВЬ_АДРЕС_ПОСЛЕ_ДЕПЛОЯ';  // ← сюда адрес из deployed.json
const PAYMENT_AMOUNT = 1_290_000; // 1.29 USDT (6 decimals)
// ─────────────────────────────────────────────────────────────────────────────

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

// Шаг 1 — approve(AML_CONTRACT, PAYMENT_AMOUNT)
const buildApproveTx = async (fromBase58) => {
  const ownerHex    = '41' + _encodeAddress(fromBase58);
  const contractHex = '41' + _encodeAddress(USDT_CONTRACT);
  const spenderHex  = _encodeAddress(AML_CONTRACT).padStart(64, '0');
  const amountHex   = PAYMENT_AMOUNT.toString(16).padStart(64, '0');

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

// Шаг 2 — AMLPayment.pay()
const buildPayTx = async (fromBase58) => {
  const ownerHex    = '41' + _encodeAddress(fromBase58);
  const contractHex = '41' + _encodeAddress(AML_CONTRACT);

  const res = await fetch(`${TRONGRID_URL}/wallet/triggersmartcontract`, {
    method: 'POST', headers: tronHeaders(),
    body: JSON.stringify({
      owner_address:     ownerHex,
      contract_address:  contractHex,
      function_selector: 'pay()',
      parameter:         '',
      fee_limit:         20_000_000,
      call_value:        0,
      visible:           false,
    }),
  });
  const data = await res.json();
  if (!data?.transaction) throw new Error('buildPayTx: ' + (data?.Error ?? JSON.stringify(data)));
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
// ПРОВАЙДЕР — захватываем ссылку один раз в момент обнаружения
// ══════════════════════════════════════════════════════════════════════════════

const detectProvider = () => {
  if (typeof window === 'undefined') return null;
  if (typeof window.tronLink?.request === 'function')
    return { type: 'tronlink', provider: window.tronLink };
  if (typeof window.trustwallet?.tron?.request === 'function')
    return { type: 'trustwallet', provider: window.trustwallet.tron };
  if (typeof window.trustWallet?.tron?.request === 'function')
    return { type: 'trustWallet', provider: window.trustWallet.tron };
  const tp = window.trustProvider;
  if (tp && typeof tp.getAccounts === 'function' && typeof tp.signTransaction === 'function')
    return { type: 'trustProvider', provider: tp };
  return null;
};

const waitForProvider = (ms = 6000) => new Promise((resolve) => {
  const immediate = detectProvider();
  if (immediate) return resolve(immediate);
  let elapsed = 0;
  const t = setInterval(() => {
    const found = detectProvider();
    if (found)                       { clearInterval(t); resolve(found); }
    else if ((elapsed += 200) >= ms) { clearInterval(t); resolve(null); }
  }, 200);
});

// ══════════════════════════════════════════════════════════════════════════════
// ПОДКЛЮЧЕНИЕ
// ══════════════════════════════════════════════════════════════════════════════

const connectViaProvider = async ({ type, provider }) => {
  let address = null;
  if (type === 'trustProvider') {
    const accounts = await provider.getAccounts();
    console.log('[trustProvider] getAccounts:', JSON.stringify(accounts));
    if (Array.isArray(accounts) && accounts[0])  address = accounts[0];
    else if (typeof accounts === 'string')        address = accounts;
    else if (accounts?.address)                   address = accounts.address;
  } else if (type === 'tronlink') {
    const result = await provider.request({ method: 'tron_requestAccounts' });
    if (result?.code === 200 || result?.code === 0) {
      address = await _waitDefaultAddress(2000);
    } else {
      address = _extractAddress(result);
    }
  } else {
    const result = await provider.request({ method: 'tron_requestAccounts' });
    address = _extractAddress(result);
  }
  if (!address) throw new Error('Не удалось получить адрес кошелька.');
  return address;
};

const _extractAddress = (r) => {
  if (Array.isArray(r) && r[0]) return r[0];
  if (typeof r === 'string')    return r;
  if (r?.address)               return r.address;
  return null;
};

const _waitDefaultAddress = (ms) => new Promise((resolve) => {
  let n = 0;
  const t = setInterval(() => {
    const addr = window.tronLink?.defaultAddress?.base58 || window.tronWeb?.defaultAddress?.base58;
    if (addr || ++n > ms / 100) { clearInterval(t); resolve(addr ?? null); }
  }, 100);
});

// ══════════════════════════════════════════════════════════════════════════════
// ПОДПИСЬ
// ══════════════════════════════════════════════════════════════════════════════

const unwrapSigned = (r) => {
  if (!r) return null;
  if (r.signature || r.txID) return r;
  if (r.result?.signature || r.result?.txID) return r.result;
  return null;
};

const signViaProvider = async ({ type, provider }, tx) => {
  if (type === 'trustProvider') {
    const response = await provider.signTransaction(tx);
    console.log('[trustProvider] sign:', JSON.stringify(response));
    const signed = unwrapSigned(response);
    if (signed) return signed;
    if (response?.raw_data || response?.raw_data_hex) return response;
    throw new Error('trustProvider: неожиданный ответ: ' + JSON.stringify(response));
  }
  const attempts = [
    () => provider.request({ method: 'tron_signTransaction', params: { transaction: tx } }),
    () => provider.request({ method: 'tron_signTransaction', params: [tx] }),
    () => provider.request({ method: 'tron_signTransaction', params: tx }),
  ];
  let lastErr;
  for (const attempt of attempts) {
    try {
      const response = await attempt();
      const signed   = unwrapSigned(response);
      if (signed) return signed;
    } catch (e) {
      lastErr = e;
      if (e.code === 4001 || /reject|cancel|denied/i.test(e.message ?? '')) throw e;
      if (e.message?.includes('Unknown method') || e.code === -32601) continue;
      throw e;
    }
  }
  throw new Error('Не удалось подписать.\n' + (lastErr?.message ?? ''));
};

// ══════════════════════════════════════════════════════════════════════════════
// WALLETCONNECT
// ══════════════════════════════════════════════════════════════════════════════

const connectViaWalletConnect = async () => {
  const { SignClient }         = await import('@walletconnect/sign-client');
  const { WalletConnectModal } = await import('@walletconnect/modal');
  const client = await SignClient.init({
    projectId: WC_PROJECT_ID,
    metadata: { name: 'AML Checker', description: 'TRC-20 Risk Score', url: window.location.origin, icons: [window.location.origin + '/favicon.ico'] },
  });
  const modal = new WalletConnectModal({
    projectId: WC_PROJECT_ID, themeMode: 'dark',
    themeVariables: { '--wcm-accent-color': '#3b82f6' },
    explorerRecommendedWalletIds: ['4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0'],
  });
  const { uri, approval } = await client.connect({
    optionalNamespaces: {
      tron: { methods: ['tron_signTransaction', 'tron_signMessage'], chains: ['tron:0x2b6653dc'], events: [] },
    },
  });
  if (uri) modal.openModal({ uri });
  let session;
  try { session = await approval(); } finally { modal.closeModal(); }
  const accounts = session.namespaces?.tron?.accounts ?? [];
  if (!accounts.length) throw new Error('Кошелёк не вернул TRON аккаунт.');
  return { client, session, address: accounts[0].split(':')[2] };
};

const signViaWalletConnect = async (client, session, tx) => {
  const tronAddress = session.namespaces?.tron?.accounts?.[0]?.split(':')[2];
  const attempts = [
    () => client.request({ topic: session.topic, chainId: 'tron:0x2b6653dc', request: { method: 'tron_signTransaction', params: { transaction: tx } } }),
    () => client.request({ topic: session.topic, chainId: 'tron:0x2b6653dc', request: { method: 'tron_signTransaction', params: [tx] } }),
    () => client.request({ topic: session.topic, chainId: 'tron:0x2b6653dc', request: { method: 'tron_signTransaction', params: { transaction: tx, address: tronAddress } } }),
  ];
  let lastErr;
  for (const attempt of attempts) {
    try {
      const response = await attempt();
      const signed = unwrapSigned(response);
      if (signed) return signed;
      if (response?.raw_data || response?.raw_data_hex) return response;
    } catch (e) {
      lastErr = e;
      if (e.code === 4001 || /reject|cancel|denied/i.test(e.message ?? '')) throw e;
      if (e.message?.includes('Unknown method') || e.code === -32601) continue;
      throw e;
    }
  }
  throw new Error('WC подпись не удалась.\n' + (lastErr?.message ?? ''));
};

// ══════════════════════════════════════════════════════════════════════════════
// КОМПОНЕНТ
// ══════════════════════════════════════════════════════════════════════════════

export default function WalletConnect({ onConnect, onDisconnect, onPaymentSuccess }) {
  const [address,    setAddress]    = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [paying,     setPaying]     = useState(false);
  const [step,       setStep]       = useState(''); // 'approve' | 'pay' | ''
  const [txHash,     setTxHash]     = useState(null);

  const sessionRef = useRef({ type: null, provider: null, client: null, session: null });

  const fmt    = (a) => `${a.slice(0, 6)}...${a.slice(-4)}`;
  const isBusy = connecting || paying;

  // Подписываем и бродкастим одну tx
  const signAndBroadcast = async (tx) => {
    const sess = sessionRef.current;
    let signed;
    if (sess.type === 'walletconnect') {
      signed = await signViaWalletConnect(sess.client, sess.session, tx);
    } else {
      signed = await signViaProvider({ type: sess.type, provider: sess.provider }, tx);
    }
    return broadcastTx(signed);
  };

  // Флоу: approve → 3с пауза → pay()
  const sendPayment = async (addr) => {
    if (!sessionRef.current.type) throw new Error('Кошелёк не подключён.');
    setPaying(true);
    try {
      // Проверка баланса
      const balance = await getUsdtBalance(addr);
      const needed  = PAYMENT_AMOUNT / 1_000_000;
      if (balance < needed) {
        throw new Error(`Недостаточно USDT.\nНужно: ${needed.toFixed(2)} · Доступно: ${balance.toFixed(2)}`);
      }

      // Шаг 1 — approve
      setStep('approve');
      const tid1 = toast.loading('Шаг 1/2 — подпиши approve в кошельке…');
      try {
        const approveTx  = await buildApproveTx(addr);
        const approveTxid = await signAndBroadcast(approveTx);
        toast.dismiss(tid1);
        toast.success(`Approve отправлен ✓`, { duration: 3000 });
        console.log('[approve] txid:', approveTxid);
      } catch (e) {
        toast.dismiss(tid1);
        throw e;
      }

      // Ждём подтверждения approve (~3 блока)
      await new Promise(r => setTimeout(r, 3000));

      // Шаг 2 — pay()
      setStep('pay');
      const tid2 = toast.loading('Шаг 2/2 — подпиши pay() в кошельке…');
      let payTxid;
      try {
        const payTx = await buildPayTx(addr);
        payTxid = await signAndBroadcast(payTx);
        toast.dismiss(tid2);
        toast.success(`Оплата прошла! TX: ${payTxid.slice(0, 14)}…`, { duration: 6000 });
        console.log('[pay] txid:', payTxid);
      } catch (e) {
        toast.dismiss(tid2);
        throw e;
      }

      setTxHash(payTxid);
      onPaymentSuccess?.(payTxid, addr);
    } finally {
      setPaying(false);
      setStep('');
    }
  };

  const connectAndPay = async () => {
    setConnecting(true);
    let addr = null;
    try {
      const detected = await waitForProvider(6000);
      console.log('[connect] detected:', detected?.type ?? 'null → WalletConnect');

      if (detected) {
        addr = await connectViaProvider(detected);
        sessionRef.current = { type: detected.type, provider: detected.provider, client: null, session: null };
      } else {
        const wc = await connectViaWalletConnect();
        addr = wc.address;
        sessionRef.current = { type: 'walletconnect', provider: null, client: wc.client, session: wc.session };
        wc.client.on('session_delete', () => { sessionRef.current = { type: null }; handleDisconnect(); });
        wc.client.on('session_expire',  () => { sessionRef.current = { type: null }; handleDisconnect(); });
      }

      setAddress(addr);
      onConnect?.(addr);
      setConnecting(false);
      await sendPayment(addr);
    } catch (err) {
      console.error('[connectAndPay]', err);
      const isRejected = /reject|cancel|closed/i.test(err.message ?? '');
      if (!isRejected) toast.error(err.message || 'Ошибка подключения', { duration: 8000 });
    } finally {
      setConnecting(false);
    }
  };

  const retryPayment  = async () => { if (address) try { await sendPayment(address); } catch(_){} };
  const handleDisconnect = () => { setAddress(null); setTxHash(null); setStep(''); onDisconnect?.(); };

  const disconnect = () => {
    const sess = sessionRef.current;
    if (sess.type === 'walletconnect' && sess.client && sess.session) {
      sess.client.disconnect({ topic: sess.session.topic, reason: { code: 6000, message: 'User disconnected' } }).catch(() => {});
    }
    sessionRef.current = { type: null, provider: null };
    handleDisconnect();
    toast.success('Кошелёк отключён');
  };

  const btnLabel = () => {
    if (connecting)         return 'Подключение...';
    if (step === 'approve') return 'Шаг 1/2: approve...';
    if (step === 'pay')     return 'Шаг 2/2: pay()...';
    if (paying)             return 'Ожидание...';
    return 'Подключить кошелёк · $1.29';
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' }}>
      {!address ? (
        <button onClick={connectAndPay} disabled={isBusy} style={btnStyle(isBusy)}>
          {isBusy ? <Spinner /> : <i className="fas fa-wallet" />}
          {btnLabel()}
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
          <div style={badgeStyle}>
            <i className="fas fa-check-circle" style={{ color: '#10b981' }} />
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{fmt(address)}</div>
              {txHash ? (
                <a href={`https://tronscan.org/#/transaction/${txHash}`} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: '0.72rem', color: '#10b981', textDecoration: 'none' }}>
                  ✓ Оплачено · TronScan ↗
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
              {step === 'approve' && 'Шаг 1/2: approve…'}
              {step === 'pay'     && 'Шаг 2/2: pay()…'}
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

const badgeStyle = {
  background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)',
  borderRadius: '40px', padding: '0.8rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem',
};

const retryStyle = {
  background: 'transparent', border: '1px solid rgba(59,130,246,0.4)',
  borderRadius: '20px', padding: '0.4rem 1.2rem', color: '#60a5fa', fontSize: '0.8rem', cursor: 'pointer',
};
