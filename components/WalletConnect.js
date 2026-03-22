import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

const TRON_USDT_CONTRACT  = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const TRON_AML_CONTRACT   = 'TCrxH5b8bSMGtnK5hNjukzBHwy5cPZNtih';
const TRON_PAYMENT_AMOUNT = 1290000;
const TRONGRID_URL        = 'https://nile.trongrid.io';

// ─── Все возможные источники tronWeb ─────────────────────────────────────────
const getTronWeb = () => {
  return (
    window.tronWeb                                          ||
    (window.trustwallet && window.trustwallet.tronWeb)     ||
    (window.trustwallet && window.trustwallet.tronLink && window.trustwallet.tronLink.tronWeb) ||
    (window.tronLink && window.tronLink.tronWeb)           ||
    (window.TronWeb && window.TronWeb.tronWeb)             ||
    null
  );
};

// ─── Ждём tronWeb (официальный паттерн) ──────────────────────────────────────
const waitForTronWeb = () => new Promise((resolve, reject) => {
  const tw = getTronWeb();
  if (tw && tw.defaultAddress && tw.defaultAddress.base58) {
    return resolve(tw);
  }
  let elapsed = 0;
  const interval = setInterval(() => {
    const tw = getTronWeb();
    if (tw && tw.defaultAddress && tw.defaultAddress.base58) {
      clearInterval(interval);
      console.log('[TronWeb] найден через:', tw);
      return resolve(tw);
    }
    elapsed += 100;
    if (elapsed >= 10000) {
      clearInterval(interval);
      reject(new Error(
        'TronWeb не обнаружен за 10 секунд. ' +
        'Откройте сайт через встроенный браузер TrustWallet ' +
        'и убедитесь что активна сеть TRON.'
      ));
    }
  }, 100);
});

// ─── Запрос доступа к аккаунту (перебираем все варианты) ─────────────────────
const requestTronAccounts = async () => {
  const tw = getTronWeb();
  if (!tw) throw new Error('TronWeb не найден');

  // Вариант 1: через tronWeb.request
  if (tw.request) {
    try {
      await tw.request({ method: 'tron_requestAccounts' });
      return;
    } catch (e) {
      console.warn('[requestAccounts] tronWeb.request failed:', e.message);
    }
  }

  // Вариант 2: через tronLink.request
  if (window.tronLink && window.tronLink.request) {
    try {
      await window.tronLink.request({ method: 'tron_requestAccounts' });
      return;
    } catch (e) {
      console.warn('[requestAccounts] tronLink.request failed:', e.message);
    }
  }

  // Вариант 3: через tronLink.send (старый API)
  if (window.tronLink && window.tronLink.send) {
    try {
      await window.tronLink.send('tron_requestAccounts');
      return;
    } catch (e) {
      console.warn('[requestAccounts] tronLink.send failed:', e.message);
    }
  }

  // Вариант 4: через trustwallet
  if (window.trustwallet && window.trustwallet.request) {
    try {
      await window.trustwallet.request({ method: 'tron_requestAccounts' });
      return;
    } catch (e) {
      console.warn('[requestAccounts] trustwallet.request failed:', e.message);
    }
  }

  console.warn('[requestAccounts] все варианты исчерпаны, пробуем без запроса');
};

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

  console.log('[TX] unsigned:', unsignedTx);

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

  console.log('[TX] signed:', signedTx);

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
      display: 'inline-block',
      width: size,
      height: size,
      border: '2px solid rgba(255,255,255,0.3)',
      borderTopColor: '#fff',
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
      flexShrink: 0,
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
  const [providerInfo, setProviderInfo] = useState('');

  // Автоподключение при загрузке если tronWeb уже доступен
  useEffect(() => {
    let elapsed = 0;
    const interval = setInterval(() => {
      const tw = getTronWeb();
      if (tw && tw.defaultAddress && tw.defaultAddress.base58) {
        clearInterval(interval);
        const addr = tw.defaultAddress.base58;

        // Определяем какой провайдер сработал
        let provider = 'unknown';
        if (window.tronWeb && window.tronWeb.defaultAddress && window.tronWeb.defaultAddress.base58) {
          provider = 'window.tronWeb';
        } else if (window.trustwallet && window.trustwallet.tronWeb) {
          provider = 'trustwallet.tronWeb';
        } else if (window.tronLink && window.tronLink.tronWeb) {
          provider = 'tronLink.tronWeb';
        }

        console.log('[AutoConnect] провайдер:', provider, 'адрес:', addr);
        setProviderInfo(provider);
        setAddress(addr);
        onConnect && onConnect(addr);
        checkAllowance(tw, addr);
      }
      elapsed += 100;
      if (elapsed >= 3000) clearInterval(interval);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const checkAllowance = async (tw, addr) => {
    try {
      const usdtContract = await tw.contract().at(TRON_USDT_CONTRACT);
      const allowance = await usdtContract.allowance(addr, TRON_AML_CONTRACT).call();
      const has = BigInt(allowance.toString()) >= BigInt(TRON_PAYMENT_AMOUNT);
      console.log('[Allowance]', allowance.toString(), 'нужно:', TRON_PAYMENT_AMOUNT, 'достаточно:', has);
      setHasAllowance(has);
    } catch (e) {
      console.error('[Allowance] ошибка:', e.message);
      setHasAllowance(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      // Пробуем запросить доступ
      await requestTronAccounts();

      // Ждём пока tronWeb станет готов
      const tronWeb = await waitForTronWeb();
      const addr = tronWeb.defaultAddress.base58;

      // Определяем провайдер
      let provider = 'unknown';
      if (window.tronWeb === tronWeb) provider = 'window.tronWeb';
      else if (window.trustwallet && window.trustwallet.tronWeb === tronWeb) provider = 'trustwallet.tronWeb';
      else if (window.tronLink && window.tronLink.tronWeb === tronWeb) provider = 'tronLink.tronWeb';

      console.log('[Connect] провайдер:', provider, 'адрес:', addr);
      setProviderInfo(provider);
      setAddress(addr);
      onConnect && onConnect(addr);
      toast.success('Кошелёк подключён');
      await checkAllowance(tronWeb, addr);
    } catch (err) {
      console.error('[Connect] ошибка:', err.message);
      toast.error(err.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleApprove = async () => {
    setApproving(true);
    const tid = toast.loading('Подпишите approve в кошельке…');
    try {
      await sendTronTransaction(async (tronWeb, fromAddress) => {
        const ownerHex   = '41' + encodeAddress(fromAddress);
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
        if (!data || !data.transaction) {
          throw new Error('Не удалось построить approve');
        }
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

  const handlePay = async () => {
    setPaying(true);
    const tid = toast.loading('Оплата через контракт…');
    try {
      const txid = await sendTronTransaction(async () => {
        const res = await fetch('/api/pay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userAddress: address }),
        });
        const data = await res.json();
        if (!data || !data.transaction) {
          throw new Error(data.error || 'Ошибка сервера');
        }
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

  const handleDisconnect = () => {
    setAddress(null);
    setTxHash(null);
    setHasAllowance(false);
    setProviderInfo('');
    onDisconnect && onDisconnect();
  };

  const fmt = (a) => a.slice(0, 6) + '...' + a.slice(-4);
  const isBusy = connecting || approving || paying;
  const e = React.createElement;

  if (!address) {
    return e('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' } },
      e('button', {
        onClick: handleConnect,
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
      )
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
          e('div', { style: { fontSize: '0.65rem', color: '#a0b3d9' } }, 'TRON · ' + providerInfo),
          txHash
            ? e('a', {
                href: 'https://nile.tronscan.org/#/transaction/' + txHash,
                target: '_blank',
                rel: 'noopener noreferrer',
                style: { fontSize: '0.72rem', color: '#10b981', textDecoration: 'none' }
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
          onClick: handleApprove,
          disabled: isBusy,
          style: {
            background: '#3b82f6', color: 'white', border: 'none',
            borderRadius: '40px', padding: '0.6rem 1.5rem',
            fontSize: '0.9rem', fontWeight: '600',
            cursor: isBusy ? 'not-allowed' : 'pointer',
            opacity: isBusy ? 0.7 : 1, transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
          }
        },
          approving ? e(Spinner, { size: 14 }) : 'Разрешить оплату'
        ),
        e('button', {
          onClick: handlePay,
          disabled: isBusy || !hasAllowance,
          style: {
            background: hasAllowance ? '#10b981' : '#9ca3af',
            color: 'white', border: 'none', borderRadius: '40px',
            padding: '0.6rem 1.5rem', fontSize: '0.9rem', fontWeight: '600',
            cursor: (!hasAllowance || isBusy) ? 'not-allowed' : 'pointer',
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