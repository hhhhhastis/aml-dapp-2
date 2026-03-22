import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { TrustAdapter } from '@tronweb3/tronwallet-adapter-trust';

const TRON_USDT_CONTRACT  = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const TRON_AML_CONTRACT   = 'TCrxH5b8bSMGtnK5hNjukzBHwy5cPZNtih';
const TRON_PAYMENT_AMOUNT = 1290000;
const TRONGRID_URL        = 'https://nile.trongrid.io';

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
  const [connecting, setConnecting]     = useState(false);
  const [approving, setApproving]       = useState(false);
  const [paying, setPaying]             = useState(false);
  const [hasAllowance, setHasAllowance] = useState(false);
  const [txHash, setTxHash]             = useState(null);
  const [debugInfo, setDebugInfo]       = useState('');

  // Создаём адаптер один раз — отключаем deeplink (мы УЖЕ внутри TrustWallet)
  const adapter = useMemo(() => new TrustAdapter({
    openUrlWhenWalletNotFound: false,
    openTrustWalletAppOnMobile: false,
    checkTimeout: 3000,
  }), []);

  // tronWeb живёт в window.trustwallet.tronLink.tronWeb (официальная документация)
  const getTronWeb = () =>
    window.trustwallet?.tronLink?.tronWeb ||
    window.tronWeb ||
    null;

  useEffect(() => {
    // Слушаем события адаптера
    adapter.on('connect', (addr) => {
      console.log('[TrustAdapter] connect:', addr);
      setAddress(addr);
      setDebugInfo('connected:' + addr.slice(0, 8));
      onConnect?.(addr);
      const tw = getTronWeb();
      if (tw) checkAllowance(tw, addr);
    });

    adapter.on('disconnect', () => {
      console.log('[TrustAdapter] disconnect');
      setAddress(null);
      setHasAllowance(false);
      setDebugInfo('disconnected');
      onDisconnect?.();
    });

    adapter.on('accountsChanged', (addr) => {
      console.log('[TrustAdapter] accountsChanged:', addr);
      setAddress(addr);
    });

    // Если уже подключён
    if (adapter.connected && adapter.address) {
      setAddress(adapter.address);
      setDebugInfo('auto:' + adapter.address.slice(0, 8));
      onConnect?.(adapter.address);
      const tw = getTronWeb();
      if (tw) checkAllowance(tw, adapter.address);
    } else {
      setDebugInfo(
        'readyState:' + adapter.readyState +
        ' wt:' + !!window.trustwallet +
        ' eth:' + !!window.ethereum
      );
    }

    return () => adapter.removeAllListeners();
  }, [adapter]);

  // ─── Проверка allowance ──────────────────────────────────────────────────
  const checkAllowance = async (tw, addr) => {
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

  // ─── Ждём пока адаптер инициализируется ─────────────────────────────────
  const waitAdapterReady = (ms = 5000) => new Promise((resolve, reject) => {
    if (adapter.readyState === 'Found' || adapter.readyState === 'Installed') return resolve();
    let elapsed = 0;
    const iv = setInterval(() => {
      if (adapter.readyState === 'Found' || adapter.readyState === 'Installed') {
        clearInterval(iv); resolve();
      }
      elapsed += 200;
      if (elapsed >= ms) { clearInterval(iv); reject(new Error('Adapter не готов: ' + adapter.readyState)); }
    }, 200);
    // Слушаем событие readyStateChanged
    adapter.once('readyStateChanged', (state) => {
      if (state === 'Found' || state === 'Installed') { clearInterval(iv); resolve(); }
    });
  });

  // ─── Подключение через TrustAdapter ──────────────────────────────────────
  const handleConnect = async () => {
    setConnecting(true);
    try {
      console.log('[Connect] readyState:', adapter.readyState);
      // Если Loading — ждём инициализации
      if (adapter.readyState === 'Loading') {
        setDebugInfo('waiting adapter...');
        await waitAdapterReady(5000);
      }
      console.log('[Connect] readyState after wait:', adapter.readyState);
      await adapter.connect();
      // адрес придёт через событие 'connect'
    } catch (err) {
      console.error('[Connect]', err.message);
      setDebugInfo('err: ' + err.message.slice(0, 80));
      toast.error('Ошибка подключения: ' + err.message);
    } finally {
      setConnecting(false);
    }
  };

  // ─── Approve USDT ────────────────────────────────────────────────────────
  const handleApprove = async () => {
    setApproving(true);
    const tid = toast.loading('Подпишите approve в кошельке…');
    try {
      const tw = getTronWeb();
      if (!tw) throw new Error('tronWeb недоступен');

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

      // Подписываем через TrustAdapter
      const signed = await adapter.signTransaction(data.transaction);
      console.log('[Approve] signed:', signed?.txID);

      // Бродкастим
      const broadcast = await tw.trx.sendRawTransaction(signed);
      console.log('[Approve] broadcast:', broadcast);
      if (!broadcast.result && broadcast.code !== 'DUP_TRANSACTION_ERROR') {
        throw new Error('Broadcast failed: ' + (broadcast.message || broadcast.code));
      }

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
  const handlePay = async () => {
    setPaying(true);
    const tid = toast.loading('Оплата через контракт…');
    try {
      const tw = getTronWeb();
      if (!tw) throw new Error('tronWeb недоступен');

      // Получаем неподписанную транзакцию с сервера
      const res = await fetch('/api/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: address }),
      });
      const data = await res.json();
      console.log('[Pay] /api/pay:', JSON.stringify(data));
      if (!data?.transaction) throw new Error(data.error || 'Ошибка сервера');

      // Подписываем через TrustAdapter
      const signed = await adapter.signTransaction(data.transaction);
      console.log('[Pay] signed:', signed?.txID);

      // Бродкастим
      const broadcast = await tw.trx.sendRawTransaction(signed);
      console.log('[Pay] broadcast:', broadcast);
      if (!broadcast.result && broadcast.code !== 'DUP_TRANSACTION_ERROR') {
        throw new Error('Broadcast failed: ' + (broadcast.message || broadcast.code));
      }

      setTxHash(signed.txID);
      toast.dismiss(tid);
      toast.success('Оплата прошла! TX: ' + signed.txID.slice(0, 14) + '…');
      onPaymentSuccess?.(signed.txID, address);
    } catch (err) {
      toast.dismiss(tid);
      toast.error('Ошибка оплаты: ' + err.message);
    } finally {
      setPaying(false);
    }
  };

  // ─── Disconnect ──────────────────────────────────────────────────────────
  const handleDisconnect = async () => {
    try { await adapter.disconnect(); } catch(e) {}
    setAddress(null);
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
          e('div', { style: { fontSize: '0.65rem', color: '#a0b3d9' } }, 'TRON · TrustWallet'),
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

      !txHash && e('div', { style: { display: 'flex', gap: '0.5rem' } },
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
      )
    )
  );
}
