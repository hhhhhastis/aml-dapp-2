import { useState, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';

// ─── НАСТРОЙКА ────────────────────────────────────────────────────────────────
const WC_PROJECT_ID  = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_WC_PROJECT_ID';
const TRONGRID_URL   = 'https://api.trongrid.io';
const TRONGRID_KEY   = process.env.NEXT_PUBLIC_TRONGRID_KEY || '';
const USDT_CONTRACT  = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const PAYMENT_TO     = process.env.NEXT_PUBLIC_PAYMENT_ADDRESS || 'TYourReceiverAddressHere';
const PAYMENT_AMOUNT = 1_290_000;
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
      owner_address: address, contract_address: USDT_CONTRACT,
      function_selector: 'balanceOf(address)',
      parameter: _encodeAddress(address).padStart(64, '0'), visible: true,
    }),
  });
  const data = await res.json();
  const hex = data?.constant_result?.[0] ?? '0';
  return Number(BigInt('0x' + (hex || '0'))) / 1_000_000;
};

const buildTransferTx = async (from, to, amountSun) => {
  const parameter =
    _encodeAddress(to).padStart(64, '0') +
    amountSun.toString(16).padStart(64, '0');

  const res = await fetch(`${TRONGRID_URL}/wallet/triggersmartcontract`, {
    method: 'POST', headers: tronHeaders(),
    body: JSON.stringify({
      owner_address: from, contract_address: USDT_CONTRACT,
      function_selector: 'transfer(address,uint256)',
      parameter, fee_limit: 10_000_000, call_value: 0, visible: true,
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
    if (i < 0) throw new Error('bad base58: ' + ch);
    n = n * BigInt(58) + BigInt(i);
  }
  return n.toString(16).padStart(50, '0').slice(2, 42);
}

// ══════════════════════════════════════════════════════════════════════════════
// ПОДПИСЬ ТРАНЗАКЦИИ — перебираем все форматы params
//
// TrustWallet в разных версиях ожидает разный формат:
//
//   Формат 1 (новый):  params: { transaction: tx }
//   Формат 2 (старый): params: [tx]
//   Формат 3 (raw):    params: tx  (сам объект без обёртки)
//
// Также проверяем что ответ — это подписанный объект с полем signature.
// TrustWallet иногда возвращает { result: signedTx } вместо самого signedTx.
// ══════════════════════════════════════════════════════════════════════════════

const trySignTransaction = async (signFn, tx) => {
  // Три варианта как передать транзакцию
  const paramVariants = [
    { transaction: tx },  // Формат 1: { transaction: {...} }
    [tx],                 // Формат 2: [{...}]  (массив)
    tx,                   // Формат 3: {...}     (напрямую)
  ];

  let lastError;
  for (const params of paramVariants) {
    try {
      const result = await signFn(params);

      // Нормализуем ответ — TrustWallet может обернуть в { result: ... }
      const signed = result?.result ?? result;

      // Проверяем что это валидная подписанная транзакция
      if (signed && (signed.signature || signed.txID)) {
        return signed;
      }

      // Если вернул что-то непонятное — логируем и пробуем следующий формат
      console.warn('[signTx] неожиданный ответ:', result, '| params были:', params);

    } catch (e) {
      lastError = e;
      console.warn('[signTx] ошибка с форматом', params, ':', e.message);

      // Пользователь отклонил — не перебираем дальше
      if (e.code === 4001 ||
          e.message?.toLowerCase().includes('reject') ||
          e.message?.toLowerCase().includes('cancel') ||
          e.message?.toLowerCase().includes('denied')) {
        throw e;
      }
      // "Unknown method" — пробуем следующий вариант
      if (e.message?.includes('Unknown method') || e.code === -32601) continue;

      // Другие ошибки — пробрасываем
      throw e;
    }
  }

  throw new Error(
    'Кошелёк не вернул подписанную транзакцию.\n' +
    'Последняя ошибка: ' + (lastError?.message ?? 'нет ответа')
  );
};

// ── Подпись через нативный провайдер (window.trustwallet.tron) ───────────────
const signViaNativeProvider = (provider, tx) =>
  trySignTransaction(
    (params) => provider.obj.request({ method: 'tron_signTransaction', params }),
    tx
  );

// ── Подпись через WalletConnect ───────────────────────────────────────────────
const signViaWC = (client, session, tx) =>
  trySignTransaction(
    (params) => client.request({
      topic: session.topic,
      chainId: 'tron:0x2b6653dc',
      request: { method: 'tron_signTransaction', params },
    }),
    tx
  );

// ── Ждём нативный провайдер ───────────────────────────────────────────────────
const waitForTronProvider = (ms = 4000) => new Promise((resolve) => {
  const check = () => {
    if (window.trustwallet?.tron) return { type: 'trustwallet', obj: window.trustwallet.tron };
    if (window.trustWallet?.tron) return { type: 'trustwallet', obj: window.trustWallet.tron };
    if (window.tronLink)          return { type: 'tronlink',    obj: window.tronLink };
    return null;
  };
  const found = check();
  if (found) return resolve(found);
  let elapsed = 0;
  const t = setInterval(() => {
    const f = check();
    if (f)                         { clearInterval(t); resolve(f); }
    else if ((elapsed += 200) >= ms) { clearInterval(t); resolve(null); }
  }, 200);
});

// ── Подключение через нативный провайдер ──────────────────────────────────────
const connectViaNativeProvider = async (provider) => {
  const result = await provider.obj.request({ method: 'tron_requestAccounts' });
  let address = null;
  if (Array.isArray(result) && result[0]) {
    address = result[0];
  } else if (result?.code === 200 || result?.code === 0) {
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

// ── Подключение через WalletConnect ──────────────────────────────────────────
const connectViaWC = async () => {
  if (WC_PROJECT_ID === 'YOUR_WC_PROJECT_ID') {
    throw new Error('WalletConnect не настроен. Укажи NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID в .env.local');
  }
  const { SignClient }         = await import('@walletconnect/sign-client');
  const { WalletConnectModal } = await import('@walletconnect/modal');

  const client = await SignClient.init({
    projectId: WC_PROJECT_ID,
    metadata: { name:'AML Checker', description:'TRC-20 Risk Score', url: window.location.origin, icons:[window.location.origin+'/favicon.ico'] },
  });
  const modal = new WalletConnectModal({
    projectId: WC_PROJECT_ID, themeMode: 'dark',
    themeVariables: { '--wcm-accent-color': '#3b82f6' },
    explorerRecommendedWalletIds: ['4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0'],
  });

  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      tron: { methods: ['tron_signTransaction'], chains: ['tron:0x2b6653dc'], events: [] },
    },
    optionalNamespaces: {
      tron: { methods: ['tron_signMessage'], chains: ['tron:0x2b6653dc'], events: [] },
    },
  });

  if (uri) modal.openModal({ uri });
  let session;
  try { session = await approval(); } finally { modal.closeModal(); }

  const accounts = session.namespaces?.tron?.accounts ?? [];
  if (!accounts.length) throw new Error('Кошелёк не вернул TRON аккаунт.');
  return { client, session, address: accounts[0].split(':')[2] };
};

// ══════════════════════════════════════════════════════════════════════════════
// КОМПОНЕНТ
// ══════════════════════════════════════════════════════════════════════════════

export default function WalletConnect({ onConnect, onDisconnect, onPaymentSuccess }) {
  const [address,    setAddress]    = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [paying,     setPaying]     = useState(false);
  const [txHash,     setTxHash]     = useState(null);
  const [debugInfo,  setDebugInfo]  = useState(null);
  const [showDebug,  setShowDebug]  = useState(false);

  const sessionRef = useRef({ type: null, provider: null, client: null, session: null });
  const fmt    = (a) => `${a.slice(0, 6)}...${a.slice(-4)}`;
  const isBusy = connecting || paying;

  useEffect(() => {
    setTimeout(() => {
      setDebugInfo({
        'trustwallet.tron': !!window.trustwallet?.tron,
        'tronLink':         !!window.tronLink,
        'tronWeb':          !!window.tronWeb,
        'tronWeb.ready':    !!window.tronWeb?.ready,
        'ethereum':         !!window.ethereum,
        'ua': navigator.userAgent.slice(0, 80),
      });
    }, 2000);
  }, []);

  const connectAndPay = async () => {
    if (PAYMENT_TO === 'TTZL2so9rwijmkKGburrCWB5572FG9fi2m') {
      toast.error('Укажи NEXT_PUBLIC_PAYMENT_ADDRESS в .env.local');
      return;
    }
    setConnecting(true);
    let addr = null;
    try {
      const nativeProvider = await waitForTronProvider(4000);

      if (nativeProvider) {
        addr = await connectViaNativeProvider(nativeProvider);
        sessionRef.current = { type: 'native', provider: nativeProvider };
      } else {
        const wc = await connectViaWC();
        addr = wc.address;
        sessionRef.current = { type: 'wc', client: wc.client, session: wc.session };
        wc.client.on('session_delete', () => { sessionRef.current = { type:null }; handleDisconnect(); });
        wc.client.on('session_expire',  () => { sessionRef.current = { type:null }; handleDisconnect(); });
      }

      setAddress(addr);
      onConnect?.(addr);
      setConnecting(false);
      await sendPayment(addr);
    } catch (err) {
      console.error('[connectAndPay]', err);
      const isRejected = /reject|cancel|closed/i.test(err.message ?? '');
      if (!isRejected) toast.error(err.message || 'Ошибка подключения', { duration: 10000 });
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
      // 1. Баланс
      const balance = await getUsdtBalance(addr);
      const needed  = PAYMENT_AMOUNT / 1_000_000;
      if (balance < needed) throw new Error(`Недостаточно USDT.\nНужно: ${needed.toFixed(2)} · Доступно: ${balance.toFixed(2)}`);

      // 2. Строим транзакцию
      const tx = await buildTransferTx(addr, PAYMENT_TO, PAYMENT_AMOUNT);

      // 3. Подписываем — перебираем форматы params автоматически
      let signedTx;
      if (sess.type === 'native') {
        signedTx = await signViaNativeProvider(sess.provider, tx);
      } else {
        signedTx = await signViaWC(sess.client, sess.session, tx);
      }

      // 4. Broadcast
      const txid = await broadcastTx(signedTx);

      toast.dismiss(tid);
      toast.success(`Оплата прошла! TX: ${txid.slice(0,16)}…`, { duration: 6000 });
      setTxHash(txid);
      onPaymentSuccess?.(txid, addr);
    } catch (err) {
      toast.dismiss(tid);
      const rejected = /reject|cancel|denied/i.test(err.message ?? '') || err.code === 4001;
      toast.error(rejected ? 'Платёж отклонён.' : (err.message || 'Ошибка оплаты'), { duration: 8000 });
      throw err;
    } finally {
      setPaying(false);
    }
  };

  const retryPayment = async () => { if (address) try { await sendPayment(address); } catch(_){} };

  const handleDisconnect = () => { setAddress(null); setTxHash(null); onDisconnect?.(); };

  const disconnect = () => {
    const sess = sessionRef.current;
    if (sess.type === 'wc' && sess.client && sess.session) {
      sess.client.disconnect({ topic: sess.session.topic, reason: { code:6000, message:'User disconnected' } }).catch(()=>{});
    }
    sessionRef.current = { type: null };
    handleDisconnect();
    toast.success('Кошелёк отключён');
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'0.75rem', marginBottom:'2rem' }}>

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
                  style={{ fontSize:'0.72rem', color:'#10b981', textDecoration:'none' }}>✓ Оплачено · TronScan ↗</a>
              ) : (
                <div style={{ fontSize:'0.72rem', color:'#f59e0b' }}>⏳ Ожидание оплаты</div>
              )}
            </div>
            <button onClick={disconnect} style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer' }}>
              <i className="fas fa-sign-out-alt" />
            </button>
          </div>
          {!txHash && !paying && <button onClick={retryPayment} style={retryStyle}>↻ Повторить оплату</button>}
          {paying && <div style={{ fontSize:'0.8rem', color:'#a0b3d9', display:'flex', alignItems:'center', gap:'6px' }}><Spinner size={12} /> Ожидание подписи…</div>}
        </div>
      )}

      {/* Диагностика */}
      <div>
        <button onClick={() => setShowDebug(v => !v)}
          style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'8px', padding:'4px 10px', color:'#6b7280', fontSize:'0.7rem', cursor:'pointer' }}>
          {showDebug ? '▲ диагностика' : '▼ диагностика'}
        </button>
        {showDebug && debugInfo && (
          <div style={{ marginTop:8, background:'rgba(0,0,0,0.5)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:10, padding:12, fontSize:'0.68rem', fontFamily:'monospace', minWidth:280 }}>
            {Object.entries(debugInfo).map(([k,v]) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'2px 0', borderBottom:'1px solid rgba(255,255,255,0.05)', gap:8 }}>
                <span style={{ color:'#9ca3af' }}>{k}</span>
                <span style={{ color: v===true?'#10b981': v===false?'#ef4444':'#f59e0b', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{String(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

function Spinner({ size = 16 }) {
  return <span style={{ display:'inline-block', width:size, height:size, border:'2px solid rgba(255,255,255,0.3)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin 0.7s linear infinite', flexShrink:0 }} />;
}

const btnStyle = (disabled) => ({
  background:'linear-gradient(135deg, #3b82f6, #60a5fa)', color:'white',
  border:'none', borderRadius:'40px', padding:'1rem 2rem',
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
  borderRadius:'20px', padding:'0.4rem 1.2rem', color:'#60a5fa', fontSize:'0.8rem', cursor:'pointer',
};
