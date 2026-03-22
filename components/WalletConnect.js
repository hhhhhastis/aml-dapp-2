import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

const TRON_USDT_CONTRACT  = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const TRON_AML_CONTRACT   = 'TCrxH5b8bSMGtnK5hNjukzBHwy5cPZNtih';
const TRON_PAYMENT_AMOUNT = 1290000;
const TRONGRID_URL        = 'https://nile.trongrid.io';

// ─── Диагностика window.trustwallet ──────────────────────────────────────────
const diagnoseTrustWallet = () => {
  const wt = window.trustwallet;
  if (!wt) return 'trustwallet:none';

  const results = [];

  // Сканируем сам trustwallet, не core
  const topProps = [
    'ethereum', 'solana', 'bitcoin', 'tron', 'tronWeb',
    'request', 'enable', 'getAccounts', 'requestAccounts',
    'isConnected', 'isTrustWallet', 'isTrust',
    'address', 'selectedAddress', 'accounts',
    'core', 'providers', '_providers',
  ];

  topProps.forEach(p => {
    try {
      const val = wt[p];
      if (val !== undefined) {
        const repr = typeof val === 'function' ? 'fn'
          : typeof val === 'object' && val !== null
            ? 'obj[' + Object.keys(val).slice(0,5).join(',') + ']'
          : String(val);
        results.push('wt.' + p + '=' + repr);
      }
    } catch(e) {}
  });

  // Проверяем window.ethereum отдельно
  try {
    const eth = window.ethereum;
    if (eth) {
      results.push('window.ethereum exists');
      results.push('eth.isTrustWallet=' + eth.isTrustWallet);
      results.push('eth.request=' + typeof eth.request);
      results.push('eth.selectedAddress=' + eth.selectedAddress);
    }
  } catch(e) {}

  // Проверяем window.tronWeb
  try {
    const tw = window.tronWeb;
    if (tw) {
      results.push('tronWeb exists');
      results.push('tronWeb.defaultAddress=' + JSON.stringify(tw.defaultAddress));
      results.push('tronWeb.ready=' + tw.ready);
    }
  } catch(e) {}

  // Проверяем window.tronLink
  try {
    const tl = window.tronLink;
    if (tl) {
      results.push('tronLink exists');
      results.push('tronLink.ready=' + tl.ready);
      results.push('tronLink.request=' + typeof tl.request);
    }
  } catch(e) {}

  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#000;color:lime;font-size:11px;padding:8px;z-index:99999;word-break:break-all;max-height:60vh;overflow:auto;';
  div.innerText = results.length
    ? results.join('\n')
    : 'NOTHING FOUND';
  document.body.appendChild(div);

  return 'core:true req:' + !!(wt.core && wt.core.request);
};

// ─── Все возможные источники tronWeb ─────────────────────────────────────────
const getTronWeb = () => {
  if (typeof window === 'undefined') return null;
  const wt = window.trustwallet;
  return (
    window.tronWeb ||
    (wt && wt.tronWeb) ||
    (wt && wt.tronLink && wt.tronLink.tronWeb) ||
    (wt && wt.core && wt.core.tron) ||
    (wt && wt.core && wt.core.tronWeb) ||
    (wt && wt.tron) ||
    (window.tronLink && window.tronLink.tronWeb) ||
    null
  );
};

const isTronWebReady = (tw) => {
  return tw && tw.defaultAddress && tw.defaultAddress.base58;
};

// ─── Ждём tronWeb до 15 секунд ───────────────────────────────────────────────
const waitForTronWeb = () => new Promise((resolve, reject) => {
  const tw = getTronWeb();
  if (isTronWebReady(tw)) return resolve(tw);
  let elapsed = 0;
  const interval = setInterval(() => {
    const tw = getTronWeb();
    if (isTronWebReady(tw)) {
      clearInterval(interval);
      console.log('[TronWeb] готов через', elapsed, 'мс');
      return resolve(tw);
    }
    elapsed += 100;
    if (elapsed >= 15000) {
      clearInterval(interval);
      console.log('[TronWeb] timeout диагностика:', diagnoseTrustWallet());
      reject(new Error(
        'TronWeb не обнаружен. ' +
        'Откройте сайт через встроенный браузер TrustWallet ' +
        'и убедитесь что активна сеть TRON.'
      ));
    }
  }, 100);
});

// ─── Отправка транзакции ──────────────────────────────────────────────────────
const sendTronTransaction = async (txBuilderFn) => {
  const tronWeb = await waitForTronWeb();
  const fromAddress = tronWeb.defaultAddress.base58;

  let unsignedTx;
  try {
    unsignedTx = await txBuilderFn(tronWeb, fromAddress);
  } catch (err) {
    throw new Error('Ошибка при построении транзакции: ' + err.message);
  }

  if (!unsignedTx || !unsignedTx.txID) {
    throw new Error('Не удалось создать транзакцию.');
  }

  console.log('[TX] unsigned txID:', unsignedTx.txID);

  let signedTx;
  try {
    signedTx = await tronWeb.trx.sign(unsignedTx);
  } catch (err) {
    if (err && err.message && err.message.includes('Confirmation declined')) {
      throw new Error('Вы отклонили транзакцию.');
    }
    throw new Error('Ошибка подписи: ' + err.message);
  }

  if (!signedTx) throw new Error('Транзакция не подписана.');

  let txid;
  if (typeof signedTx === 'string') {
    txid = signedTx;
  } else if (signedTx && signedTx.txID) {
    txid = signedTx.txID;
    if (signedTx.signature) {
      const broadcast = await tronWeb.trx.sendRawTransaction(signedTx);
      if (!broadcast.result && broadcast.code !== 'DUP_TRANSACTION_ERROR') {
        throw new Error('Broadcast failed: ' + (broadcast.message || broadcast.code));
      }
    }
  } else {
    throw new Error('Неожиданный ответ от sign()');
  }

  console.log('[TX] txid:', txid);
  return txid;
};

// ─── Encode base58 → hex ──────────────────────────────────────────────────────
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
function Spinner(props) {
  const size = props.size || 16;
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
export default function WalletConnect(props) {
  const onConnect        = props.onConnect;
  const onDisconnect     = props.onDisconnect;
  const onPaymentSuccess = props.onPaymentSuccess;

  const [address, setAddress]           = useState(null);
  const [connecting, setConnecting]     = useState(false);
  const [approving, setApproving]       = useState(false);
  const [paying, setPaying]             = useState(false);
  const [hasAllowance, setHasAllowance] = useState(false);
  const [txHash, setTxHash]             = useState(null);
  const [debugInfo, setDebugInfo]       = useState('');

  // Автоподключение — ждём 10 секунд
  useEffect(() => {
    let elapsed = 0;
    const interval = setInterval(() => {
      const tw = getTronWeb();
      if (isTronWebReady(tw)) {
        clearInterval(interval);
        const addr = tw.defaultAddress.base58;
        console.log('[AutoConnect] адрес:', addr, 'через', elapsed, 'мс');
        setDebugInfo('auto:' + elapsed + 'ms addr:' + addr.slice(0, 8));
        setAddress(addr);
        onConnect && onConnect(addr);
        checkAllowance(tw, addr);
      }
      elapsed += 100;
      if (elapsed >= 10000) {
        clearInterval(interval);
        const diag = diagnoseTrustWallet();
        console.log('[AutoConnect] timeout. diag:', diag);
        setDebugInfo(
          'tw:' + !!window.tronWeb +
          ' tl:' + !!window.tronLink +
          ' wt:' + !!window.trustwallet +
          ' ' + diag
        );
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const checkAllowance = async (tw, addr) => {
    try {
      const usdtContract = await tw.contract().at(TRON_USDT_CONTRACT);
      const allowance    = await usdtContract.allowance(addr, TRON_AML_CONTRACT).call();
      const has = BigInt(allowance.toString()) >= BigInt(TRON_PAYMENT_AMOUNT);
      console.log('[Allowance]', allowance.toString(), 'достаточно:', has);
      setHasAllowance(has);
    } catch (e) {
      console.error('[Allowance]', e.message);
      setHasAllowance(false);
    }
  };

  // ─── Подключение ────────────────────────────────────────────────────────────
  const handleConnect = async () => {
    setConnecting(true);
    try {
      console.log('[Connect] диагностика:', diagnoseTrustWallet());

      const wt = window.trustwallet;

      // Вариант 1: через tronWeb.request
      const tw = getTronWeb();
      if (tw && tw.request) {
        try {
          const r = await tw.request({ method: 'tron_requestAccounts' });
          console.log('[Connect] tronWeb.request:', JSON.stringify(r));
        } catch (e) { console.warn('[Connect] tronWeb.request:', e.message); }
      }

      // Вариант 2: через tronLink.request
      if (window.tronLink && window.tronLink.request) {
        try {
          const r = await window.tronLink.request({ method: 'tron_requestAccounts' });
          console.log('[Connect] tronLink.request:', JSON.stringify(r));
        } catch (e) { console.warn('[Connect] tronLink.request:', e.message); }
      }

      // Вариант 3: через trustwallet.request
      if (wt && wt.request) {
        try {
          const r = await wt.request({ method: 'tron_requestAccounts' });
          console.log('[Connect] trustwallet.request tron:', JSON.stringify(r));
        } catch (e) { console.warn('[Connect] trustwallet.request tron:', e.message); }
      }

      // Вариант 4: через trustwallet.core.request
      if (wt && wt.core && wt.core.request) {
        try {
          const r = await wt.core.request({ method: 'tron_requestAccounts' });
          console.log('[Connect] core.request tron:', JSON.stringify(r));
        } catch (e) { console.warn('[Connect] core.request tron:', e.message); }
      }

      // Вариант 5: через trustwallet.send (старый API)
      if (wt && wt.send) {
        try {
          const r = await wt.send('tron_requestAccounts', []);
          console.log('[Connect] trustwallet.send:', JSON.stringify(r));
        } catch (e) { console.warn('[Connect] trustwallet.send:', e.message); }
      }

      // Ждём tronWeb после всех запросов
      const tronWeb = await waitForTronWeb();
      const addr    = tronWeb.defaultAddress.base58;

      console.log('[Connect] подключён:', addr);
      setAddress(addr);
      setDebugInfo('connected:' + addr.slice(0, 8));
      onConnect && onConnect(addr);
      toast.success('Кошелёк подключён');
      await checkAllowance(tronWeb, addr);
    } catch (err) {
      console.error('[Connect] ошибка:', err.message);
      const diag = diagnoseTrustWallet();
      setDebugInfo('err: ' + diag);
      toast.error(err.message);
    } finally {
      setConnecting(false);
    }
  };

  // ─── Approve ────────────────────────────────────────────────────────────────
  const handleApprove = async () => {
    setApproving(true);
    const tid = toast.loading('Подпишите approve в кошельке…');
    try {
      await sendTronTransaction(async (tronWeb, fromAddress) => {
        const ownerHex   = '41' + encodeAddress(fromAddress);
        const spenderHex = encodeAddress(TRON_AML_CONTRACT).padStart(64, '0');
        const amountHex  = TRON_PAYMENT_AMOUNT.toString(16).padStart(64, '0');
        const res = await fetch(TRONGRID_URL + '/wallet/triggersmartcontract', {
          method:  'POST',
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
        console.log('[Approve] response:', JSON.stringify(data));
        if (!data || !data.transaction) throw new Error('Не удалось построить approve');
        return data.transaction;
      });
      toast.dismiss(tid);
      toast.success('Approve подтверждён!');
      setHasAllowance(true);
    } catch (err) {
      toast.dismiss(tid);
      toast.error('Ошибка approve: ' + err.message);
    } finally {
      setApproving(false);
    }
  };

  // ─── Pay ────────────────────────────────────────────────────────────────────
  const handlePay = async () => {
    setPaying(true);
    const tid = toast.loading('Оплата через контракт…');
    try {
      const txid = await sendTronTransaction(async () => {
        const res = await fetch('/api/pay', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ userAddress: address }),
        });
        const data = await res.json();
        console.log('[Pay] response:', JSON.stringify(data));
        if (!data || !data.transaction) throw new Error(data.error || 'Ошибка сервера');
        return data.transaction;
      });
      setTxHash(txid);
      toast.dismiss(tid);
      toast.success('Оплата прошла! TX: ' + txid.slice(0, 14) + '…');
      onPaymentSuccess && onPaymentSuccess(txid, address);
    } catch (err) {
      toast.dismiss(tid);
      toast.error('Ошибка оплаты: ' + err.message);
    } finally {
      setPaying(false);
    }
  };

  // ─── Disconnect ─────────────────────────────────────────────────────────────
  const handleDisconnect = () => {
    setAddress(null);
    setTxHash(null);
    setHasAllowance(false);
    setDebugInfo('');
    onDisconnect && onDisconnect();
  };

  const fmt    = (a) => a.slice(0, 6) + '...' + a.slice(-4);
  const isBusy = connecting || approving || paying;
  const e      = React.createElement;

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
          cursor:  connecting ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', gap: '0.8rem',
          opacity: connecting ? 0.7 : 1, transition: 'all 0.2s',
        }
      },
        connecting ? e(Spinner, null) : e('i', { className: 'fas fa-wallet' }),
        connecting ? 'Подключение...' : 'Подключить кошелёк'
      ),
      debugInfo && e('div', {
        style: { fontSize: '0.6rem', color: '#6b7280', fontFamily: 'monospace', maxWidth: '300px', wordBreak: 'break-all' }
      }, debugInfo)
    );
  }

  return e('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' } },
    e('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' } },

      e('div', {
        style: {
          background: 'rgba(59,130,246,0.1)',
          border: '1px solid rgba(59,130,246,0.2)',
          borderRadius: '40px', padding: '0.8rem 1.5rem',
          display: 'flex', alignItems: 'center', gap: '1rem',
        }
      },
        e('i', { className: 'fas fa-check-circle', style: { color: '#10b981' } }),
        e('div', { style: { textAlign: 'right' } },
          e('div', { style: { color: '#60a5fa', fontFamily: 'monospace' } }, fmt(address)),
          e('div', { style: { fontSize: '0.65rem', color: '#a0b3d9' } }, 'TRON Network'),
          txHash
            ? e('a', {
                href:   'https://nile.tronscan.org/#/transaction/' + txHash,
                target: '_blank',
                rel:    'noopener noreferrer',
                style:  { fontSize: '0.72rem', color: '#10b981', textDecoration: 'none' }
              }, 'Оплачено · Scan')
            : e('div', { style: { fontSize: '0.72rem', color: '#f59e0b' } }, 'Ожидание оплаты')
        ),
        e('button', {
          onClick: handleDisconnect,
          style: { background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }
        }, e('i', { className: 'fas fa-sign-out-alt' }))
      ),

      !txHash && e('div', { style: { display: 'flex', gap: '0.5rem' } },
        !hasAllowance && e('button', {
          onClick:  handleApprove,
          disabled: isBusy,
          style: {
            background: '#3b82f6', color: 'white', border: 'none',
            borderRadius: '40px', padding: '0.6rem 1.5rem',
            fontSize: '0.9rem', fontWeight: '600',
            cursor:  isBusy ? 'not-allowed' : 'pointer',
            opacity: isBusy ? 0.7 : 1, transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
          }
        },
          approving ? e(Spinner, { size: 14 }) : 'Разрешить оплату'
        ),
        e('button', {
          onClick:  handlePay,
          disabled: isBusy || !hasAllowance,
          style: {
            background: hasAllowance ? '#10b981' : '#9ca3af',
            color: 'white', border: 'none', borderRadius: '40px',
            padding: '0.6rem 1.5rem', fontSize: '0.9rem', fontWeight: '600',
            cursor:  (!hasAllowance || isBusy) ? 'not-allowed' : 'pointer',
            opacity: (!hasAllowance || isBusy) ? 0.5 : 1, transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
          }
        },
          paying ? e(Spinner, { size: 14 }) : 'Оплатить'
        )
      )
    )
  );
}