import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

const TRON_USDT_CONTRACT  = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const TRON_AML_CONTRACT   = 'TCrxH5b8bSMGtnK5hNjukzBHwy5cPZNtih';
const TRON_PAYMENT_AMOUNT = 1290000;
const TRONGRID_URL        = 'https://nile.trongrid.io';

// Nile Testnet chainId = 3448148188 = 0xCD8690DC
const TRON_CHAIN_ID = '0xCD8690DC';

// ─── Переключаем TrustWallet на Tron Nile Testnet ────────────────────────────
const switchToTron = async () => {
  const provider = window.ethereum || window.trustwallet;
  if (!provider?.request) throw new Error('Провайдер не найден');

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: TRON_CHAIN_ID }],
    });
  } catch (switchErr) {
    console.log('[switchToTron] err code:', switchErr.code, switchErr.message);
    // Сеть не добавлена — добавляем
    if (switchErr.code === 4902 || switchErr.code === -32603) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId:   TRON_CHAIN_ID,
          chainName: 'Tron Nile Testnet',
          nativeCurrency: { name: 'TRX', symbol: 'TRX', decimals: 6 },
          rpcUrls:           ['https://nile.trongrid.io/jsonrpc'],
          blockExplorerUrls: ['https://nile.tronscan.org'],
        }],
      });
    } else {
      throw switchErr;
    }
  }
};

// ─── Ждём tronWeb после переключения сети ────────────────────────────────────
const waitForTronWeb = (ms = 10000) => new Promise((resolve, reject) => {
  const get = () =>
    window.tronWeb ||
    window.trustwallet?.tronWeb ||
    window.trustwallet?.tron ||
    null;

  const tw = get();
  if (tw?.defaultAddress?.base58) return resolve(tw);

  let elapsed = 0;
  const iv = setInterval(() => {
    const tw = get();
    if (tw?.defaultAddress?.base58) {
      clearInterval(iv);
      return resolve(tw);
    }
    elapsed += 200;
    if (elapsed >= ms) {
      clearInterval(iv);
      reject(new Error('tronWeb не появился после переключения сети'));
    }
  }, 200);
});

// ─── Полный флоу подключения ──────────────────────────────────────────────────
const connectTron = async () => {
  const provider = window.ethereum || window.trustwallet;
  if (!provider?.request) {
    throw new Error('TrustWallet не найден. Откройте сайт через браузер TrustWallet.');
  }

  // Шаг 1: запрашиваем аккаунты (покажет попап если не подключён)
  console.log('[connectTron] requesting accounts...');
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  console.log('[connectTron] accounts:', accounts);

  // Шаг 2: переключаем на Tron Nile
  console.log('[connectTron] switching to Tron Nile...');
  await switchToTron();
  console.log('[connectTron] switched!');

  // Шаг 3: ждём tronWeb (TrustWallet может инжектировать его после переключения)
  try {
    const tronWeb = await waitForTronWeb(8000);
    const address = tronWeb.defaultAddress.base58;
    console.log('[connectTron] tronWeb ready, address:', address);
    return { tronWeb, address, via: 'tronWeb' };
  } catch (e) {
    console.warn('[connectTron] tronWeb не появился:', e.message);
  }

  // Шаг 4: fallback — запрашиваем аккаунты повторно после переключения
  const accountsAfter = await provider.request({ method: 'eth_requestAccounts' });
  console.log('[connectTron] accountsAfter:', accountsAfter);
  const addr = accountsAfter?.[0];

  // TrustWallet на Tron возвращает TRX адрес в base58 (начинается на T)
  if (addr?.startsWith('T')) {
    return { tronWeb: null, address: addr, via: 'provider-base58' };
  }

  throw new Error(
    'Не удалось получить Tron адрес. ' +
    'В TrustWallet выберите сеть TRON и попробуйте снова.'
  );
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

// ─── Отправка транзакции через tronWeb ───────────────────────────────────────
const sendTronTransaction = async (tronWeb, txBuilderFn, address) => {
  if (!tronWeb) throw new Error('tronWeb недоступен — подпись невозможна');

  let unsignedTx;
  try {
    unsignedTx = await txBuilderFn(tronWeb, address);
  } catch (err) {
    throw new Error('Ошибка при построении транзакции: ' + err.message);
  }

  if (!unsignedTx?.txID) throw new Error('Не удалось создать транзакцию');
  console.log('[TX] unsigned txID:', unsignedTx.txID);

  let signedTx;
  try {
    signedTx = await tronWeb.trx.sign(unsignedTx);
  } catch (err) {
    if (err?.message?.includes('Confirmation declined')) {
      throw new Error('Вы отклонили транзакцию.');
    }
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

  // Автоподключение если tronWeb уже инжектирован
  useEffect(() => {
    const tw =
      window.tronWeb ||
      window.trustwallet?.tronWeb ||
      window.trustwallet?.tron ||
      null;

    if (tw?.defaultAddress?.base58) {
      const addr = tw.defaultAddress.base58;
      console.log('[AutoConnect] tronWeb найден, addr:', addr);
      setTronWeb(tw);
      setAddress(addr);
      setDebugInfo('auto addr:' + addr.slice(0, 8));
      onConnect?.(addr);
      checkAllowance(tw, addr);
    } else {
      setDebugInfo(
        'tw:'  + !!window.tronWeb    +
        ' tl:' + !!window.tronLink   +
        ' wt:' + !!window.trustwallet +
        ' eth:' + !!window.ethereum
      );
    }
  }, []);

  // ─── Проверка allowance ──────────────────────────────────────────────────
  const checkAllowance = async (tw, addr) => {
    if (!tw) return;
    try {
      const contract  = await tw.contract().at(TRON_USDT_CONTRACT);
      const allowance = await contract.allowance(addr, TRON_AML_CONTRACT).call();
      const has = BigInt(allowance.toString()) >= BigInt(TRON_PAYMENT_AMOUNT);
      console.log('[Allowance]', allowance.toString(), '>=', TRON_PAYMENT_AMOUNT, ':', has);
      setHasAllowance(has);
    } catch (e) {
      console.error('[Allowance]', e.message);
      setHasAllowance(false);
    }
  };

  // ─── Подключение ─────────────────────────────────────────────────────────
  const handleConnect = async () => {
    setConnecting(true);
    try {
      const result = await connectTron();
      console.log('[Connect] result:', result);

      setAddress(result.address);
      setTronWeb(result.tronWeb);
      setDebugInfo('via:' + result.via + ' addr:' + result.address.slice(0, 8));
      onConnect?.(result.address);
      toast.success('Кошелёк подключён');

      if (result.tronWeb) {
        await checkAllowance(result.tronWeb, result.address);
      }
    } catch (err) {
      console.error('[Connect]', err.message);
      setDebugInfo('err: ' + err.message.slice(0, 80));
      toast.error(err.message);
    } finally {
      setConnecting(false);
    }
  };

  // ─── Approve USDT ────────────────────────────────────────────────────────
  const handleApprove = async () => {
    if (!tronWeb) return toast.error('tronWeb недоступен');
    setApproving(true);
    const tid = toast.loading('Подпишите approve в кошельке…');
    try {
      await sendTronTransaction(tronWeb, async (tw, fromAddress) => {
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
        if (!data?.transaction) throw new Error('Не удалось построить approve');
        return data.transaction;
      }, address);

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

  // ─── Pay ─────────────────────────────────────────────────────────────────
  // Фронт запрашивает неподписанную транзакцию у /api/pay (pages/api/pay.js),
  // затем подписывает через tronWeb.trx.sign и бродкастит.
  const handlePay = async () => {
    if (!tronWeb) return toast.error('tronWeb недоступен');
    setPaying(true);
    const tid = toast.loading('Оплата через контракт…');
    try {
      const txid = await sendTronTransaction(tronWeb, async () => {
        const res = await fetch('/api/pay', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ userAddress: address }),
        });
        const data = await res.json();
        console.log('[Pay] /api/pay response:', JSON.stringify(data));
        if (!data?.transaction) throw new Error(data.error || 'Ошибка сервера');
        return data.transaction;
      }, address);

      setTxHash(txid);
      toast.dismiss(tid);
      toast.success('Оплата прошла! TX: ' + txid.slice(0, 14) + '…');
      onPaymentSuccess?.(txid, address);
    } catch (err) {
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
          cursor:  connecting ? 'not-allowed' : 'pointer',
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
                href:   'https://nile.tronscan.org/#/transaction/' + txHash,
                target: '_blank', rel: 'noopener noreferrer',
                style:  { fontSize: '0.72rem', color: '#10b981', textDecoration: 'none' }
              }, 'Оплачено · Scan')
            : e('div', { style: { fontSize: '0.72rem', color: '#f59e0b' } }, 'Ожидание оплаты')
        ),
        e('button', {
          onClick: handleDisconnect,
          style: { background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }
        }, e('i', { className: 'fas fa-sign-out-alt' }))
      ),

      // Approve + Pay — только если tronWeb доступен
      !txHash && tronWeb && e('div', { style: { display: 'flex', gap: '0.5rem' } },
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
        }, approving ? e(Spinner, { size: 14 }) : 'Разрешить оплату'),

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
        }, paying ? e(Spinner, { size: 14 }) : 'Оплатить')
      ),

      // Предупреждение если адрес есть но tronWeb нет
      !txHash && !tronWeb && address && e('div', {
        style: { fontSize: '0.7rem', color: '#f59e0b', fontFamily: 'monospace', maxWidth: '280px', textAlign: 'right' }
      }, '⚠️ tronWeb недоступен. Попробуйте переподключиться.')
    )
  );
}