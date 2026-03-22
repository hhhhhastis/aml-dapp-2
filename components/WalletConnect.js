import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

const TRON_USDT_CONTRACT  = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const TRON_AML_CONTRACT   = 'TCrxH5b8bSMGtnK5hNjukzBHwy5cPZNtih';
const TRON_PAYMENT_AMOUNT = 1290000;
const TRONGRID_URL        = 'https://nile.trongrid.io';

// ─── Получаем tronWeb из всех возможных источников ───────────────────────────
const getTronWeb = () =>
  window.tronWeb ||
  window.trustwallet?.tronWeb ||
  window.trustwallet?.tronLink?.tronWeb ||
  null;

// ─── Ждём tronWeb с адресом ───────────────────────────────────────────────────
const waitForTronWeb = (ms = 10000) => new Promise((resolve, reject) => {
  const check = () => {
    const tw = getTronWeb();
    if (tw?.defaultAddress?.base58) return tw;
    return null;
  };
  const tw = check();
  if (tw) return resolve(tw);
  let elapsed = 0;
  const iv = setInterval(() => {
    const tw = check();
    if (tw) { clearInterval(iv); return resolve(tw); }
    elapsed += 200;
    if (elapsed >= ms) { clearInterval(iv); reject(new Error('tronWeb timeout')); }
  }, 200);
});

// ─── Подключение через TrustWallet на Tron сети ─────────────────────────────
const connectWallet = async () => {
  const wt = window.trustwallet;
  if (!wt?.request) throw new Error('TrustWallet не найден');

  console.log('[connect] chainId (decimal):', await wt.request({ method: 'eth_chainId' }).catch(() => '?'));

  // Метод 1: tron_requestAccounts через window.trustwallet напрямую
  try {
    console.log('[connect] trying tron_requestAccounts...');
    const res = await wt.request({ method: 'tron_requestAccounts' });
    console.log('[connect] tron_requestAccounts result:', JSON.stringify(res));
    if (res?.code === 200 || res?.address) {
      const addr = res.address || res.base58;
      if (addr?.startsWith('T')) {
        await waitForTronWeb(3000).catch(() => {});
        return { tronWeb: getTronWeb(), address: addr };
      }
    }
  } catch(e) {
    console.warn('[connect] tron_requestAccounts err:', e.message);
  }

  // Метод 2: ждём tronWeb — он может появиться после tron_requestAccounts
  const tw = getTronWeb();
  if (tw?.defaultAddress?.base58) {
    return { tronWeb: tw, address: tw.defaultAddress.base58 };
  }
  try {
    const tw2 = await waitForTronWeb(3000);
    return { tronWeb: tw2, address: tw2.defaultAddress.base58 };
  } catch(e) {
    console.warn('[connect] waitForTronWeb:', e.message);
  }

  // Метод 3: eth_requestAccounts — в Tron сети может вернуть TRX адрес
  try {
    console.log('[connect] trying eth_requestAccounts...');
    const accounts = await wt.request({ method: 'eth_requestAccounts' });
    console.log('[connect] accounts:', JSON.stringify(accounts));
    const addr = accounts?.[0];
    if (addr?.startsWith('T') && addr.length === 34) {
      return { tronWeb: getTronWeb(), address: addr };
    }
  } catch(e) {
    console.warn('[connect] eth_requestAccounts err:', e.message);
  }

  // Метод 4: читаем адрес без запроса — wt уже знает кто мы
  try {
    // eth_accounts (без попапа) — иногда возвращает адрес если уже авторизован
    const acc = await wt.request({ method: 'eth_accounts' });
    console.log('[connect] eth_accounts:', JSON.stringify(acc));
    const addr = acc?.[0];
    if (addr?.startsWith('T') && addr.length === 34) {
      return { tronWeb: getTronWeb(), address: addr };
    }
  } catch(e) {
    console.warn('[connect] eth_accounts err:', e.message);
  }

  // Метод 5: читаем адрес через solana провайдер (иногда TrustWallet даёт его там)
  try {
    const eth = window.ethereum;
    if (eth?.request) {
      const acc2 = await eth.request({ method: 'eth_requestAccounts' });
      console.log('[connect] ethereum accounts:', JSON.stringify(acc2));
      // После авторизации проверяем tronWeb
      const tw3 = getTronWeb();
      if (tw3?.defaultAddress?.base58) {
        return { tronWeb: tw3, address: tw3.defaultAddress.base58 };
      }
    }
  } catch(e) {
    console.warn('[connect] ethereum err:', e.message);
  }

  // Метод 6: ждём дольше — TrustWallet может инжектировать tronWeb асинхронно
  try {
    const tw4 = await waitForTronWeb(8000);
    return { tronWeb: tw4, address: tw4.defaultAddress.base58 };
  } catch(e) {
    console.warn('[connect] long wait:', e.message);
  }

  throw new Error(
    'TrustWallet не предоставляет доступ к Tron адресу. ' +
    'Попробуйте зайти на сайт через DApp браузер TrustWallet → Explore.'
  );
};

// ─── Подписываем транзакцию ───────────────────────────────────────────────────
const signAndBroadcast = async (tronWeb, unsignedTx) => {
  if (!tronWeb) throw new Error('tronWeb недоступен для подписи');
  if (!unsignedTx?.txID) throw new Error('Нет транзакции для подписи');

  console.log('[sign] txID:', unsignedTx.txID);
  let signedTx;
  try {
    signedTx = await tronWeb.trx.sign(unsignedTx);
  } catch(err) {
    if (err?.message?.includes('Confirmation declined')) throw new Error('Вы отклонили транзакцию');
    throw new Error('Ошибка подписи: ' + err.message);
  }
  if (!signedTx) throw new Error('Транзакция не подписана');
  if (typeof signedTx === 'string') return signedTx;

  if (signedTx.txID && signedTx.signature) {
    const broadcast = await tronWeb.trx.sendRawTransaction(signedTx);
    if (!broadcast.result && broadcast.code !== 'DUP_TRANSACTION_ERROR') {
      throw new Error('Broadcast failed: ' + (broadcast.message || broadcast.code));
    }
    return signedTx.txID;
  }
  throw new Error('Неожиданный ответ от sign()');
};

// ─── encode base58 → hex ──────────────────────────────────────────────────────
function encodeAddress(base58Addr) {
  const AB = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(0);
  for (const ch of base58Addr) {
    const i = AB.indexOf(ch);
    if (i < 0) throw new Error('bad base58');
    n = n * BigInt(58) + BigInt(i);
  }
  return n.toString(16).padStart(50, '0').slice(2, 42);
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner({ size = 16 }) {
  return React.createElement('span', {
    style: {
      display: 'inline-block', width: size, height: size,
      border: '2px solid rgba(255,255,255,0.3)',
      borderTopColor: '#fff', borderRadius: '50%',
      animation: 'spin 0.7s linear infinite', flexShrink: 0,
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// КОМПОНЕНТ
// ══════════════════════════════════════════════════════════════════════════════
export default function WalletConnect({ onConnect, onDisconnect, onPaymentSuccess }) {
  const [address, setAddress]           = useState(null);
  const [tronWeb, setTronWeb]           = useState(null);
  const [connecting, setConnecting]     = useState(false);
  const [approving, setApproving]       = useState(false);
  const [paying, setPaying]             = useState(false);
  const [hasAllowance, setHasAllowance] = useState(false);
  const [txHash, setTxHash]             = useState(null);
  const [debugInfo, setDebugInfo]       = useState('');

  // Автоподключение если tronWeb уже есть
  useEffect(() => {
    const tw = getTronWeb();
    if (tw?.defaultAddress?.base58) {
      const addr = tw.defaultAddress.base58;
      setTronWeb(tw);
      setAddress(addr);
      setDebugInfo('auto:' + addr.slice(0, 8));
      onConnect?.(addr);
      checkAllowance(tw, addr);
    } else {
      setDebugInfo(
        'tw:' + !!window.tronWeb +
        ' wt:' + !!window.trustwallet +
        ' eth:' + !!window.ethereum
      );
    }
  }, []);

  const checkAllowance = async (tw, addr) => {
    if (!tw) return;
    try {
      const contract  = await tw.contract().at(TRON_USDT_CONTRACT);
      const allowance = await contract.allowance(addr, TRON_AML_CONTRACT).call();
      const has = BigInt(allowance.toString()) >= BigInt(TRON_PAYMENT_AMOUNT);
      console.log('[Allowance]', allowance.toString(), '>=', TRON_PAYMENT_AMOUNT, ':', has);
      setHasAllowance(has);
    } catch(e) {
      console.error('[Allowance]', e.message);
      setHasAllowance(false);
    }
  };

  // ─── Подключение ─────────────────────────────────────────────────────────
  const handleConnect = async () => {
    setConnecting(true);
    const log = (msg) => {
      console.log('[Connect]', msg);
      setDebugInfo(prev => (prev + '\n' + msg).split('\n').slice(-4).join('\n'));
    };
    try {
      const wt = window.trustwallet;
      log('wt.request=' + typeof wt?.request);

      // Шаг 1: tron_requestAccounts
      log('1. tron_requestAccounts...');
      try {
        const r = await wt.request({ method: 'tron_requestAccounts' });
        log('1. result: ' + JSON.stringify(r)?.slice(0, 80));
      } catch(e) { log('1. err: ' + e.message?.slice(0, 60)); }

      // Шаг 2: tronWeb?
      const tw = getTronWeb();
      log('2. tronWeb: ' + !!tw + ' addr: ' + (tw?.defaultAddress?.base58 || 'none'));

      // Шаг 3: eth_requestAccounts
      log('3. eth_requestAccounts...');
      try {
        const r2 = await wt.request({ method: 'eth_requestAccounts' });
        log('3. result: ' + JSON.stringify(r2)?.slice(0, 80));
      } catch(e) { log('3. err: ' + e.message?.slice(0, 60)); }

      // Шаг 4: tronWeb после?
      const tw2 = getTronWeb();
      log('4. tronWeb: ' + !!tw2 + ' addr: ' + (tw2?.defaultAddress?.base58 || 'none'));

      const result = await connectWallet().catch(e => { throw e; });
      setAddress(result.address);
      setTronWeb(result.tronWeb);
      log('OK: ' + result.address.slice(0, 10));
      onConnect?.(result.address);
      toast.success('Кошелёк подключён');
      if (result.tronWeb) await checkAllowance(result.tronWeb, result.address);
    } catch(err) {
      log('FAIL: ' + err.message?.slice(0, 60));
      toast.error(err.message);
    } finally {
      setConnecting(false);
    }
  };

  // ─── Approve ─────────────────────────────────────────────────────────────
  const handleApprove = async () => {
    if (!tronWeb) return toast.error('tronWeb недоступен');
    setApproving(true);
    const tid = toast.loading('Подпишите approve в кошельке…');
    try {
      const ownerHex   = '41' + encodeAddress(address);
      const spenderHex = encodeAddress(TRON_AML_CONTRACT).padStart(64, '0');
      const amountHex  = TRON_PAYMENT_AMOUNT.toString(16).padStart(64, '0');

      const res = await fetch(TRONGRID_URL + '/wallet/triggersmartcontract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_address:     ownerHex,
          contract_address:  '41' + encodeAddress(TRON_USDT_CONTRACT),
          function_selector: 'approve(address,uint256)',
          parameter:         spenderHex + amountHex,
          fee_limit:         100000000,
          call_value:        0,
          visible:           false,
        }),
      });
      const data = await res.json();
      console.log('[Approve] build:', JSON.stringify(data));
      if (!data?.transaction) throw new Error('Не удалось построить approve');

      await signAndBroadcast(tronWeb, data.transaction);
      toast.dismiss(tid);
      toast.success('Approve подтверждён!');
      setHasAllowance(true);
    } catch(err) {
      toast.dismiss(tid);
      toast.error('Ошибка approve: ' + err.message);
    } finally {
      setApproving(false);
    }
  };

  // ─── Pay ─────────────────────────────────────────────────────────────────
  const handlePay = async () => {
    if (!tronWeb) return toast.error('tronWeb недоступен');
    setPaying(true);
    const tid = toast.loading('Оплата через контракт…');
    try {
      const res = await fetch('/api/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: address }),
      });
      const data = await res.json();
      console.log('[Pay] /api/pay:', JSON.stringify(data));
      if (!data?.transaction) throw new Error(data.error || 'Ошибка сервера');

      const txid = await signAndBroadcast(tronWeb, data.transaction);
      setTxHash(txid);
      toast.dismiss(tid);
      toast.success('Оплата прошла! TX: ' + txid.slice(0, 14) + '…');
      onPaymentSuccess?.(txid, address);
    } catch(err) {
      toast.dismiss(tid);
      toast.error('Ошибка оплаты: ' + err.message);
    } finally {
      setPaying(false);
    }
  };

  // ─── Disconnect ──────────────────────────────────────────────────────────
  const handleDisconnect = () => {
    setAddress(null);
    setTronWeb(null);
    setTxHash(null);
    setHasAllowance(false);
    setDebugInfo('');
    onDisconnect?.();
  };

  const fmt    = (a) => a.slice(0, 6) + '...' + a.slice(-4);
  const isBusy = connecting || approving || paying;
  const e      = React.createElement;

  // ─── Не подключён ────────────────────────────────────────────────────────
  if (!address) {
    return e('div', {
      style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginBottom: '2rem', gap: '0.5rem' }
    },
      e('button', {
        onClick:  handleConnect,
        disabled: connecting,
        style: {
          background: 'linear-gradient(135deg, #3b82f6, #60a5fa)',
          color: 'white', border: 'none', borderRadius: '40px',
          padding: '1rem 2rem', fontSize: '1rem', fontWeight: '600',
          cursor: connecting ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', gap: '0.8rem',
          opacity: connecting ? 0.7 : 1, transition: 'all 0.2s',
        }
      },
        connecting ? e(Spinner, null) : e('i', { className: 'fas fa-wallet' }),
        connecting ? 'Подключение...' : 'Подключить кошелёк'
      ),
      debugInfo && e('div', {
        style: { fontSize: '0.6rem', color: '#6b7280', fontFamily: 'monospace', maxWidth: '320px', wordBreak: 'break-all' }
      }, debugInfo)
    );
  }

  // ─── Подключён ───────────────────────────────────────────────────────────
  return e('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' } },
    e('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' } },

      e('div', {
        style: {
          background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)',
          borderRadius: '40px', padding: '0.8rem 1.5rem',
          display: 'flex', alignItems: 'center', gap: '1rem',
        }
      },
        e('i', { className: 'fas fa-check-circle', style: { color: '#10b981' } }),
        e('div', { style: { textAlign: 'right' } },
          e('div', { style: { color: '#60a5fa', fontFamily: 'monospace' } }, fmt(address)),
          e('div', { style: { fontSize: '0.65rem', color: '#a0b3d9' } },
            tronWeb ? 'TRON Nile Testnet' : 'TRON (без tronWeb)'
          ),
          txHash
            ? e('a', {
                href: 'https://nile.tronscan.org/#/transaction/' + txHash,
                target: '_blank', rel: 'noopener noreferrer',
                style: { fontSize: '0.72rem', color: '#10b981', textDecoration: 'none' }
              }, 'Оплачено · Scan')
            : e('div', { style: { fontSize: '0.72rem', color: '#f59e0b' } }, 'Ожидание оплаты')
        ),
        e('button', {
          onClick: handleDisconnect,
          style: { background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }
        }, e('i', { className: 'fas fa-sign-out-alt' }))
      ),

      !txHash && tronWeb && e('div', { style: { display: 'flex', gap: '0.5rem' } },
        !hasAllowance && e('button', {
          onClick: handleApprove, disabled: isBusy,
          style: {
            background: '#3b82f6', color: 'white', border: 'none',
            borderRadius: '40px', padding: '0.6rem 1.5rem',
            fontSize: '0.9rem', fontWeight: '600',
            cursor: isBusy ? 'not-allowed' : 'pointer',
            opacity: isBusy ? 0.7 : 1, transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
          }
        }, approving ? e(Spinner, { size: 14 }) : 'Разрешить оплату'),

        e('button', {
          onClick: handlePay, disabled: isBusy || !hasAllowance,
          style: {
            background: hasAllowance ? '#10b981' : '#9ca3af',
            color: 'white', border: 'none', borderRadius: '40px',
            padding: '0.6rem 1.5rem', fontSize: '0.9rem', fontWeight: '600',
            cursor: (!hasAllowance || isBusy) ? 'not-allowed' : 'pointer',
            opacity: (!hasAllowance || isBusy) ? 0.5 : 1, transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
          }
        }, paying ? e(Spinner, { size: 14 }) : 'Оплатить')
      ),

      !txHash && !tronWeb && address && e('div', {
        style: {
          background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: '12px', padding: '0.75rem 1rem', maxWidth: '280px', textAlign: 'right',
        }
      },
        e('div', { style: { color: '#f59e0b', fontSize: '0.75rem', fontWeight: '600' } },
          '⚠️ tronWeb недоступен — подпись невозможна'
        )
      )
    )
  );
}
