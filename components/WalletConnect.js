import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

const TRON_USDT_CONTRACT  = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const TRON_AML_CONTRACT   = 'TCrxH5b8bSMGtnK5hNjukzBHwy5cPZNtih';
const TRON_PAYMENT_AMOUNT = 1290000;
const TRONGRID_URL        = 'https://nile.trongrid.io';
const TRON_CHAIN_ID       = '0xCD8690DC'; // Nile Testnet

// ─── Определяем окружение ─────────────────────────────────────────────────────
const getEnv = () => ({
  hasTronWeb:     !!(window.tronWeb?.defaultAddress?.base58),
  hasTronLink:    !!(window.tronLink?.request),
  hasTrustWallet: !!(window.trustwallet),
  hasEthereum:    !!(window.ethereum),
});

// ─── Ждём tronWeb с адресом ───────────────────────────────────────────────────
const waitForTronWeb = (ms = 10000) => new Promise((resolve, reject) => {
  const get = () => window.tronWeb || window.trustwallet?.tronWeb || null;
  const tw = get();
  if (tw?.defaultAddress?.base58) return resolve(tw);
  let elapsed = 0;
  const iv = setInterval(() => {
    const tw = get();
    if (tw?.defaultAddress?.base58) { clearInterval(iv); return resolve(tw); }
    elapsed += 200;
    if (elapsed >= ms) { clearInterval(iv); reject(new Error('timeout')); }
  }, 200);
});

// ─── Подключение через TronLink/tronWeb ──────────────────────────────────────
const connectViaTronLink = async () => {
  if (window.tronLink?.request) {
    try {
      await window.tronLink.request({ method: 'tron_requestAccounts' });
    } catch(e) {
      console.warn('[tronLink.request]', e.message);
    }
  }
  const tw = await waitForTronWeb(8000);
  return { tronWeb: tw, address: tw.defaultAddress.base58, via: 'tronLink' };
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

// ─── Валидация TRX адреса ─────────────────────────────────────────────────────
const isValidTronAddress = (addr) => {
  if (!addr || !addr.startsWith('T')) return false;
  if (addr.length !== 34) return false;
  const AB = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  return [...addr].every(c => AB.includes(c));
};

// ─── Отправка транзакции ──────────────────────────────────────────────────────
const sendTronTransaction = async (tronWeb, txBuilderFn, address) => {
  if (!tronWeb) throw new Error('tronWeb недоступен');
  const unsignedTx = await txBuilderFn(tronWeb, address);
  if (!unsignedTx?.txID) throw new Error('Не удалось создать транзакцию');
  console.log('[TX] unsigned txID:', unsignedTx.txID);
  let signedTx;
  try {
    signedTx = await tronWeb.trx.sign(unsignedTx);
  } catch (err) {
    if (err?.message?.includes('Confirmation declined')) throw new Error('Вы отклонили транзакцию.');
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

// ─── Модалка ручного ввода адреса (для TrustWallet) ───────────────────────────
function ManualAddressModal({ onConfirm, onCancel }) {
  const [val, setVal] = useState('');
  const valid = isValidTronAddress(val.trim());
  const e = React.createElement;

  return e('div', {
    style: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1.5rem',
    }
  },
    e('div', {
      style: {
        background: '#1a2035', borderRadius: '16px', padding: '1.5rem',
        width: '100%', maxWidth: '360px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }
    },
      e('h3', { style: { color: '#fff', margin: '0 0 0.5rem', fontSize: '1.1rem' } },
        '🔗 Подключить кошелёк Tron'
      ),
      e('p', { style: { color: '#a0b3d9', fontSize: '0.82rem', margin: '0 0 1rem', lineHeight: 1.5 } },
        'Введите ваш TRX адрес — найдите его в TrustWallet → TRON → Получить.'
      ),
      e('input', {
        type: 'text',
        placeholder: 'T... (34 символа)',
        value: val,
        onChange: (ev) => setVal(ev.target.value),
        style: {
          width: '100%', padding: '0.75rem 1rem', borderRadius: '10px',
          border: '1px solid ' + (val && !valid ? '#ef4444' : 'rgba(59,130,246,0.4)'),
          background: 'rgba(255,255,255,0.05)', color: '#fff',
          fontSize: '0.85rem', fontFamily: 'monospace',
          boxSizing: 'border-box', outline: 'none',
        }
      }),
      val && !valid && e('div', {
        style: { color: '#ef4444', fontSize: '0.72rem', marginTop: '0.3rem' }
      }, 'Адрес должен начинаться с T и содержать 34 символа'),

      // ── Диагностическая кнопка ──────────────────────────────────────────
      e('button', {
        onClick: async () => {
          const provider = window.ethereum || window.trustwallet;
          const out = [];
          try {
            const chainId = await provider.request({ method: 'eth_chainId' });
            out.push('chainId: ' + chainId + ' (' + parseInt(chainId, 16) + ')');
            document.getElementById('tw-diag-out').innerText = out.join('\n');

            out.push('requesting accounts...');
            document.getElementById('tw-diag-out').innerText = out.join('\n');
            try {
              const acc = await provider.request({ method: 'eth_requestAccounts' });
              out.push('accounts: ' + JSON.stringify(acc));
              if (acc && acc[0]) {
                out.push('addr[0]: ' + acc[0]);
                out.push('starts T: ' + acc[0].startsWith('T'));
                out.push('length: ' + acc[0].length);
              }
            } catch(e) {
              out.push('requestAccounts err: ' + e.code + ' ' + (e.message||'').slice(0,80));
            }

            out.push('tronWeb: ' + !!window.tronWeb);
            if (window.tronWeb) {
              out.push('tronWeb.defaultAddress: ' + JSON.stringify(window.tronWeb.defaultAddress));
              out.push('tronWeb.ready: ' + window.tronWeb.ready);
            }

            const wt = window.trustwallet;
            if (wt) {
              out.push('wt.selectedAddress: ' + wt.selectedAddress);
              // wt.address — функция, вызываем её
              try {
                const addrResult = await wt.address();
                out.push('wt.address(): ' + JSON.stringify(addrResult));
              } catch(e) {
                out.push('wt.address() err: ' + e.message);
              }
              // Пробуем wt.getAccounts
              try {
                const ga = await wt.getAccounts();
                out.push('wt.getAccounts(): ' + JSON.stringify(ga));
              } catch(e) {
                out.push('wt.getAccounts err: ' + e.message);
              }
              // Полный скан adapter через for...in и prototype
              try {
                const core = wt.core();
                const adapter = core && core.adapter;
                out.push('adapter type: ' + typeof adapter);

                // for...in — раскрывает Proxy и prototype методы
                const found = [];
                try {
                  for (const k in adapter) { found.push(k); }
                  out.push('for-in keys: ' + JSON.stringify(found.slice(0, 20)));
                } catch(e) { out.push('for-in err: ' + e.message); }

                // Известные методы TronWeb Adapter (из @tronweb3/tronwallet-adapters)
                const methods = ['connect','disconnect','signTransaction',
                  'signMessage','request','getAccount','account',
                  'address','network','ready','readyState','name',
                  'icon','url','supportedTransactionVersions'];
                for (const m of methods) {
                  try {
                    const v = adapter[m];
                    if (v !== undefined) out.push('adapter.' + m + ': ' + typeof v + ' ' + String(v).slice(0,50));
                  } catch(e) {}
                }

                // Пробуем connect напрямую если нашли
                if (typeof adapter.connect === 'function') {
                  try {
                    const r = await adapter.connect();
                    out.push('adapter.connect() OK: ' + JSON.stringify(r));
                  } catch(e) {
                    out.push('adapter.connect err: ' + e.message?.slice(0,80));
                  }
                }

              } catch(e) {
                out.push('adapter scan err: ' + e.message);
              }
            }

          } catch(e) {
            out.push('FATAL: ' + e.message);
          }
          document.getElementById('tw-diag-out').innerText = out.join('\n');
        },
        style: {
          width: '100%', marginTop: '0.75rem', padding: '0.5rem',
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)',
          color: '#a0b3d9', borderRadius: '8px', cursor: 'pointer', fontSize: '0.78rem',
        }
      }, '🔍 Диагностика TrustWallet'),
      e('pre', {
        id: 'tw-diag-out',
        style: {
          fontSize: '0.7rem', color: '#4ade80', background: '#0a0a0a',
          padding: '0.5rem', borderRadius: '6px', marginTop: '0.4rem',
          whiteSpace: 'pre-wrap', minHeight: '20px', maxHeight: '120px',
          overflow: 'auto', display: 'block',
        }
      }, ''),

      e('div', { style: { display: 'flex', gap: '0.75rem', marginTop: '1rem' } },
        e('button', {
          onClick: onCancel,
          style: {
            flex: 1, padding: '0.7rem', borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.15)', background: 'transparent',
            color: '#a0b3d9', cursor: 'pointer', fontSize: '0.9rem',
          }
        }, 'Отмена'),
        e('button', {
          onClick: () => valid && onConfirm(val.trim()),
          disabled: !valid,
          style: {
            flex: 1, padding: '0.7rem', borderRadius: '10px',
            border: 'none',
            background: valid ? 'linear-gradient(135deg,#3b82f6,#60a5fa)' : '#374151',
            color: '#fff', cursor: valid ? 'pointer' : 'not-allowed',
            fontSize: '0.9rem', fontWeight: '600',
          }
        }, 'Подключить')
      )
    )
  );
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
  const [showManual, setShowManual]     = useState(false);

  // Автоподключение если tronWeb уже есть
  useEffect(() => {
    const tw = window.tronWeb || window.trustwallet?.tronWeb || null;
    if (tw?.defaultAddress?.base58) {
      const addr = tw.defaultAddress.base58;
      setTronWeb(tw);
      setAddress(addr);
      setDebugInfo('auto addr:' + addr.slice(0, 8));
      onConnect?.(addr);
      checkAllowance(tw, addr);
    } else {
      const env = getEnv();
      setDebugInfo(
        'tw:'  + env.hasTronWeb +
        ' tl:' + env.hasTronLink +
        ' wt:' + env.hasTrustWallet +
        ' eth:' + env.hasEthereum
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
    } catch (e) {
      console.error('[Allowance]', e.message);
      setHasAllowance(false);
    }
  };

  // ─── Подключение ─────────────────────────────────────────────────────────
  const handleConnect = async () => {
    const env = getEnv();
    if (env.hasTronWeb || env.hasTronLink) {
      setConnecting(true);
      try {
        const result = await connectViaTronLink();
        setAddress(result.address);
        setTronWeb(result.tronWeb);
        setDebugInfo('via:' + result.via + ' addr:' + result.address.slice(0, 8));
        onConnect?.(result.address);
        toast.success('Кошелёк подключён');
        await checkAllowance(result.tronWeb, result.address);
      } catch (err) {
        console.error('[Connect]', err.message);
        setDebugInfo('err: ' + err.message.slice(0, 80));
        toast.error('Ошибка подключения: ' + err.message);
      } finally {
        setConnecting(false);
      }
      return;
    }
    // TrustWallet — открываем модалку с диагностикой
    setShowManual(true);
  };

  const handleManualConfirm = (addr) => {
    setShowManual(false);
    setAddress(addr);
    setTronWeb(null);
    setDebugInfo('manual addr:' + addr.slice(0, 8));
    onConnect?.(addr);
    toast.success('Адрес подключён');
  };

  // ─── Approve ─────────────────────────────────────────────────────────────
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
  const handlePay = async () => {
    if (!tronWeb) return toast.error('tronWeb недоступен');
    setPaying(true);
    const tid = toast.loading('Оплата через контракт…');
    try {
      const txid = await sendTronTransaction(tronWeb, async () => {
        const res = await fetch('/api/pay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userAddress: address }),
        });
        const data = await res.json();
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
      showManual && e(ManualAddressModal, {
        onConfirm: handleManualConfirm,
        onCancel: () => setShowManual(false),
      }),
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
            tronWeb ? 'TRON Nile Testnet' : 'TRON (только чтение)'
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
        e('div', { style: { color: '#f59e0b', fontSize: '0.75rem', marginBottom: '0.4rem', fontWeight: '600' } },
          '⚠️ Для оплаты используйте TronLink'
        ),
        e('div', { style: { color: '#a0b3d9', fontSize: '0.7rem', lineHeight: 1.5 } },
          'TrustWallet не поддерживает подпись Tron транзакций. ' +
          'Откройте этот сайт в браузере TronLink для оплаты.'
        )
      )
    )
  );
}
