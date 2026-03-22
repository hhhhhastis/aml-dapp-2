import { useState, useRef } from 'react';
import toast from 'react-hot-toast';

// ─── НАСТРОЙКА ────────────────────────────────────────────────────────────────
const WC_PROJECT_ID  = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_WC_PROJECT_ID';
const TRONGRID_URL   = 'https://api.trongrid.io';
const TRONGRID_KEY   = process.env.NEXT_PUBLIC_TRONGRID_KEY || '';
const USDT_CONTRACT  = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const PAYMENT_TO     = process.env.NEXT_PUBLIC_PAYMENT_ADDRESS || 'TYourReceiverAddressHere';
const PAYMENT_AMOUNT = 1_290_000; // 1.29 USDT в sun

// ─── TronGrid helpers (без tronweb) ──────────────────────────────────────────
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
  const res = await fetch(`${TRONGRID_URL}/wallet/triggersmartcontract`, {
    method: 'POST', headers: tronHeaders(),
    body: JSON.stringify({
      owner_address:     from,
      contract_address:  USDT_CONTRACT,
      function_selector: 'transfer(address,uint256)',
      parameter:         _encodeAddress(to).padStart(64,'0') + amountSun.toString(16).padStart(64,'0'),
      fee_limit:         10_000_000,
      call_value:        0,
      visible:           true,
    }),
  });
  const data = await res.json();
  if (!data?.transaction) throw new Error('TronGrid: не удалось построить транзакцию. ' + (data?.Error ?? ''));
  return data.transaction;
};

const broadcastTx = async (signedTx) => {
  const res = await fetch(`${TRONGRID_URL}/wallet/broadcasttransaction`, {
    method: 'POST', headers: tronHeaders(),
    body: JSON.stringify(signedTx),
  });
  const data = await res.json();
  if (!data?.result) throw new Error('Broadcast: ' + (data?.message ?? JSON.stringify(data)));
  return data.txid;
};

function _encodeAddress(addr) {
  const AB = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(0);
  for (const ch of addr) { const i = AB.indexOf(ch); if (i<0) throw new Error('bad base58'); n = n*BigInt(58)+BigInt(i); }
  return n.toString(16).padStart(50,'0').slice(2,42);
}

// ─── Обнаружение провайдера ─────────────────────────────────────────────────
const waitForProvider = (ms = 4000) => new Promise((resolve) => {
  const check = () => {
    if (window.trustwallet?.tron) return { type:'trustwallet', obj: window.trustwallet.tron };
    if (window.trustWallet?.tron) return { type:'trustwallet', obj: window.trustWallet.tron };
    if (window.tronLink)          return { type:'tronlink',    obj: window.tronLink };
    if (window.tronWeb?.ready)    return { type:'tronweb',     obj: window.tronWeb };
    return null;
  };
  const immediate = check();
  if (immediate) return resolve(immediate);
  let elapsed = 0;
  const t = setInterval(() => {
    const found = check();
    if (found)              { clearInterval(t); resolve(found); }
    else if ((elapsed+=200) >= ms) { clearInterval(t); resolve(null); }
  }, 200);
});

const waitTronWebReady = (ms = 3000) => new Promise((resolve) => {
  if (window.tronWeb?.ready) return resolve(window.tronWeb);
  let elapsed = 0;
  const t = setInterval(() => {
    if (window.tronWeb?.ready) { clearInterval(t); resolve(window.tronWeb); }
    else if ((elapsed+=100) >= ms) { clearInterval(t); resolve(window.tronWeb ?? null); }
  }, 100);
});

// ══════════════════════════════════════════════════════════════════════════════
export default function WalletConnect({ onConnect, onDisconnect, onPaymentSuccess }) {
  const [address,    setAddress]    = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [paying,     setPaying]     = useState(false);
  const [txHash,     setTxHash]     = useState(null);
  const wcRef = useRef({ client: null, session: null });

  const fmt   = (a) => `${a.slice(0,6)}...${a.slice(-4)}`;
  const isBusy = connecting || paying;

  // ── Оплата через нативный TronWeb (TrustWallet / TronLink) ────────────────
  const payViaTronWeb = async (addr) => {
    const tw = window.tronWeb;
    if (!tw) throw new Error('tronWeb недоступен');
    const balance = await getUsdtBalance(addr);
    const needed  = PAYMENT_AMOUNT / 1_000_000;
    if (balance < needed) {
      throw new Error(`Недостаточно USDT. Нужно: ${needed.toFixed(2)} · Доступно: ${balance.toFixed(2)}`);
    }
    const tx = await buildTransferTx(addr, PAYMENT_TO, PAYMENT_AMOUNT);
    const signed = await tw.trx.sign(tx);
    return broadcastTx(signed);
  };

  // ── Оплата через WalletConnect ─────────────────────────────────────────────
  const payViaWC = async (addr) => {
    const { client, session } = wcRef.current;
    if (!client || !session) throw new Error('WC сессия потеряна');

    const balance = await getUsdtBalance(addr);
    const needed  = PAYMENT_AMOUNT / 1_000_000;
    if (balance < needed) {
      throw new Error(`Недостаточно USDT. Нужно: ${needed.toFixed(2)} · Доступно: ${balance.toFixed(2)}`);
    }

    const tx = await buildTransferTx(addr, PAYMENT_TO, PAYMENT_AMOUNT);
    let signed;
    try {
      signed = await client.request({
        topic:   session.topic,
        chainId: 'tron:0x2b6653dc',
        request: {
          method: 'tron_signTransaction',
          params: { transaction: tx },
        },
      });
    } catch (e) {
      if (e.message?.includes('Unknown method') || e.code === -32601) {
        throw new Error(
          'Этот кошелёк не поддерживает TRON через WalletConnect.\n' +
          'Используй TrustWallet через встроенный браузер (вкладка Browser).'
        );
      }
      throw e;
    }
    return broadcastTx(signed);
  };

  // ── Общий платёж ──────────────────────────────────────────────────────────
  const sendPayment = async (addr, method) => {
    setPaying(true);
    const tid = toast.loading('Подтверди платёж в кошельке…');
    try {
      const txid = method === 'wc'
        ? await payViaWC(addr)
        : await payViaTronWeb(addr);
      toast.dismiss(tid);
      toast.success(`Оплата прошла! TX: ${txid.slice(0,16)}…`, { duration: 6000 });
      setTxHash(txid);
      onPaymentSuccess?.(txid, addr);
    } catch (err) {
      toast.dismiss(tid);
      const rejected = err.code===4001 || err.message?.toLowerCase().includes('reject') || err.message?.toLowerCase().includes('cancel');
      toast.error(rejected ? 'Платёж отклонён в кошельке.' : (err.message || 'Ошибка оплаты'), { duration: 8000 });
      throw err;
    } finally {
      setPaying(false);
    }
  };

  // ── Подключение нативным способом ─────────────────────────────────────────
  const connectNative = async () => {
    const provider = await waitForProvider(4000);
    if (!provider) {
      throw new Error(
        'Кошелёк не обнаружен.\n' +
        '📱 Мобайл: открой сайт во встроенном браузере TrustWallet (вкладка Browser)\n' +
        '🖥 Десктоп: используй кнопку «WalletConnect QR»'
      );
    }

    let addr = null;

    if (provider.type === 'trustwallet') {
      const result = await provider.obj.request({ method: 'tron_requestAccounts' });
      addr = Array.isArray(result) ? result[0] : result?.address ?? null;
      await waitTronWebReady(2000);
      if (!addr) addr = window.tronWeb?.defaultAddress?.base58;
    } else if (provider.type === 'tronlink') {
      if (provider.obj.request) {
        const result = await provider.obj.request({ method: 'tron_requestAccounts' });
        if (result?.code === 200 || result?.code === 0 || Array.isArray(result)) {
          await waitTronWebReady(2000);
          addr = window.tronWeb?.defaultAddress?.base58 ?? (Array.isArray(result) ? result[0] : null);
        }
      } else if (provider.obj.requestAccounts) {
        await provider.obj.requestAccounts();
        await waitTronWebReady(2000);
        addr = window.tronWeb?.defaultAddress?.base58;
      }
      if (!addr) addr = provider.obj.defaultAddress?.base58;
    } else if (provider.type === 'tronweb') {
      addr = provider.obj.defaultAddress?.base58;
      if (!addr) throw new Error('Кошелёк заблокирован. Разблокируй и попробуй снова.');
    }

    if (!addr) throw new Error('Не удалось получить адрес кошелька.');
    return addr;
  };

  // ── Подключение через WalletConnect QR ─────────────────────────────────────
  const connectViaWC = async () => {
    if (WC_PROJECT_ID === 'YOUR_WC_PROJECT_ID') {
      throw new Error('WalletConnect не настроен. Укажи Project ID в .env.local');
    }

    const { SignClient }         = await import('@walletconnect/sign-client');
    const { WalletConnectModal } = await import('@walletconnect/modal');

    const client = await SignClient.init({
      projectId: WC_PROJECT_ID,
      metadata: { name:'AML Checker', description:'TRC-20 Risk Score', url: window.location.origin, icons:[window.location.origin+'/favicon.ico'] },
    });

    client.on('session_delete', () => { wcRef.current={client:null,session:null}; handleDisconnect(); });
    client.on('session_expire',  () => { wcRef.current={client:null,session:null}; handleDisconnect(); });

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
          methods:  ['tron_signTransaction'],
          chains:   ['tron:0x2b6653dc'],
          events:   [],
        },
      },
      optionalNamespaces: {
        tron: {
          methods:  ['tron_signMessage'],
          chains:   ['tron:0x2b6653dc'],
          events:   [],
        },
      },
    });

    if (uri) modal.openModal({ uri });
    let session;
    try   { session = await approval(); }
    finally { modal.closeModal(); }

    const accounts = session.namespaces?.tron?.accounts ?? [];
    if (!accounts.length) throw new Error('Кошелёк не вернул TRON аккаунт.');
    const addr = accounts[0].split(':')[2];

    wcRef.current = { client, session };
    return addr;
  };

  // ── Действия ────────────────────────────────────────────────────────────────
  const handleConnectNative = async () => {
    setConnecting(true);
    try {
      const addr = await connectNative();
      setAddress(addr);
      onConnect?.(addr);
      setConnecting(false);
      await sendPayment(addr, 'native');
    } catch (err) {
      toast.error(err.message, { duration: 8000 });
    } finally {
      setConnecting(false);
    }
  };

  const handleConnectWC = async () => {
    setConnecting(true);
    try {
      const addr = await connectViaWC();
      setAddress(addr);
      onConnect?.(addr);
      setConnecting(false);
      await sendPayment(addr, 'wc');
    } catch (err) {
      const rejected = err.message?.toLowerCase().includes('reject') || err.message?.toLowerCase().includes('cancel');
      if (!rejected) toast.error(err.message || 'Ошибка', { duration: 8000 });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => { setAddress(null); setTxHash(null); onDisconnect?.(); };

  const disconnect = () => {
    const { client, session } = wcRef.current;
    if (client && session) client.disconnect({ topic: session.topic, reason: { code:6000, message:'User disconnected' } }).catch(()=>{});
    wcRef.current = { client:null, session:null };
    handleDisconnect();
    toast.success('Кошелёк отключён');
  };

  // ── UI ──────────────────────────────────────────────────────────────────────
  const btnStyle = (c1, c2) => ({
    background: `linear-gradient(135deg, ${c1}, ${c2})`,
    color:'white', border:'none', borderRadius:'40px', padding:'1rem 2rem',
    fontSize:'1rem', fontWeight:'600', cursor: isBusy ? 'not-allowed' : 'pointer',
    display:'flex', alignItems:'center', gap:'0.8rem',
    opacity: isBusy ? 0.7 : 1, transition:'all 0.2s',
  });

  const badgeStyle = {
    background:'rgba(59,130,246,0.1)', border:'1px solid rgba(59,130,246,0.2)',
    borderRadius:'40px', padding:'0.8rem 1.5rem', display:'flex', alignItems:'center', gap:'1rem',
  };

  const Spinner = ({ size=16 }) => (
    <span style={{ display:'inline-block', width:size, height:size, border:'2px solid rgba(255,255,255,0.3)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin 0.7s linear infinite', flexShrink:0 }} />
  );

  return (
    <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'2rem', flexDirection:'column', alignItems:'flex-end', gap:'0.5rem' }}>
      {!address ? (
        <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem', alignItems:'flex-end' }}>
          <button onClick={handleConnectNative} disabled={isBusy} style={btnStyle('#3b82f6','#60a5fa')}>
            {connecting ? <Spinner /> : <i className="fas fa-wallet" />}
            {connecting ? 'Подключение...' : 'TrustWallet / TronLink · $1.29'}
          </button>
          <button onClick={handleConnectWC} disabled={isBusy} style={btnStyle('#6d28d9','#8b5cf6')}>
            {paying ? <Spinner /> : <i className="fas fa-qrcode" />}
            {paying ? 'Ожидание оплаты...' : 'WalletConnect QR · $1.29'}
          </button>
        </div>
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
            <button onClick={disconnect} style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer' }}>
              <i className="fas fa-sign-out-alt" />
            </button>
          </div>
          {!txHash && !paying && (
            <button onClick={() => sendPayment(address, wcRef.current.session ? 'wc' : 'native').catch(()=>{})}
              style={{ background:'transparent', border:'1px solid rgba(59,130,246,0.4)', borderRadius:'20px',
                padding:'0.4rem 1.2rem', color:'#60a5fa', fontSize:'0.8rem', cursor:'pointer' }}>
              ↻ Повторить оплату
            </button>
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