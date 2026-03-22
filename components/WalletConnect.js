import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

// ─── НАСТРОЙКА ────────────────────────────────────────────────────────────────
const TRON_USDT_CONTRACT = process.env.NEXT_PUBLIC_USDT_CONTRACT || 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';
const TRON_AML_CONTRACT  = process.env.NEXT_PUBLIC_AML_CONTRACT  || 'ВСТАВЬ_АДРЕС_КОНТРАКТА';
const FEE_PERCENT        = 2;   // 2% — только для отображения на фронтенде
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

// Считаем 2% от баланса в sun — для approve и отображения
const calculateFeeAmount = (balanceUsdt) =>
  Math.floor(balanceUsdt * 1_000_000 * FEE_PERCENT / 100);

const buildApproveTx = async (fromBase58, feeAmount) => {
  const res = await fetch(`${TRONGRID_URL}/wallet/triggersmartcontract`, {
    method: 'POST', headers: tronHeaders(),
    body: JSON.stringify({
      owner_address:     fromBase58,
      contract_address:  TRON_USDT_CONTRACT,
      function_selector: 'approve(address,uint256)',
      parameter:
        encodeAddress(TRON_AML_CONTRACT).padStart(64, '0') +
        feeAmount.toString(16).padStart(64, '0'),
      fee_limit:  10_000_000,
      call_value: 0,
      visible:    true,
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

// Серверный вызов pay() — передаём только адрес, сервер сам считает сумму
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
  const [address,      setAddress]      = useState(null);
  const [tronWeb,      setTronWeb]      = useState(null);
  const [walletType,   setWalletType]   = useState(null);
  const [connecting,   setConnecting]   = useState(false);
  const [approving,    setApproving]    = useState(false);
  const [paying,       setPaying]       = useState(false);
  const [hasAllowance, setHasAllowance] = useState(false);
  const [txHash,       setTxHash]       = useState(null);
  const [balance,      setBalance]      = useState(null);
  const [feeAmount,    setFeeAmount]    = useState(0); // в sun, для отображения
  const [paidFeeUsdt,  setPaidFeeUsdt]  = useState(null); // фактически списано

  const isBusy  = connecting || approving || paying;
  const fmt     = (a) => `${a.slice(0, 6)}...${a.slice(-4)}`;
  const feeUsdt = feeAmount / 1_000_000;

  // Автоподключение
  useEffect(() => {
    const tw = getTronWeb();
    if (tw?.defaultAddress?.base58) {
      const addr = tw.defaultAddress.base58;
      setTronWeb(tw);
      setAddress(addr);
      setWalletType(detectWalletType());
      onConnect?.(addr);
      loadBalanceAndFee(addr);
    }
  }, []);

  const loadBalanceAndFee = async (addr) => {
    try {
      const bal = await getUsdtBalance(addr);
      setBalance(bal);
      setFeeAmount(calculateFeeAmount(bal));
    } catch (e) {
      console.warn('[fee] ошибка:', e.message);
    }
  };

  // ─── Подключение ──────────────────────────────────────────────────────────
  const handleConnect = async () => {
    setConnecting(true);
    try {
      await requestAccounts();
      const tw   = await waitForTronWeb(6000);
      const addr = tw.defaultAddress.base58;
      setTronWeb(tw);
      setAddress(addr);
      setWalletType(detectWalletType());
      onConnect?.(addr);
      toast.success('Кошелёк подключён ✓');
      await loadBalanceAndFee(addr);
    } catch (err) {
      console.error('[connect]', err);
      toast.error(err.message || 'Ошибка подключения', { duration: 6000 });
    } finally {
      setConnecting(false);
    }
  };

  // ─── Approve ──────────────────────────────────────────────────────────────
  const handleApprove = async () => {
    if (!tronWeb) return toast.error('tronWeb недоступен');

    const bal = await getUsdtBalance(address).catch(() => 0);
    const fee = calculateFeeAmount(bal);

    if (fee === 0) return toast.error('Баланс USDT равен нулю');

    setFeeAmount(fee);
    setApproving(true);
    const tid = toast.loading(`Подпиши approve ${(fee / 1_000_000).toFixed(6)} USDT…`);
    try {
      const unsignedTx = await buildApproveTx(address, fee);
      const txid       = await signAndBroadcast(tronWeb, unsignedTx);
      toast.dismiss(tid);
      toast.success(`Approve на ${(fee / 1_000_000).toFixed(6)} USDT подтверждён ✓`, { duration: 3000 });
      console.log('[approve] txid:', txid);
      setHasAllowance(true);
    } catch (err) {
      toast.dismiss(tid);
      toast.error(err.message || 'Ошибка approve');
    } finally {
      setApproving(false);
    }
  };

  // ─── Pay — сервер сам считает сумму по балансу юзера ──────────────────────
  const handlePay = async () => {
    if (!hasAllowance) return toast.error('Сначала выполни approve');

    setPaying(true);
    const tid = toast.loading('Сервер выполняет оплату…');
    try {
      const result = await callServerPay(address);
      toast.dismiss(tid);
      // Показываем фактическую сумму которую списал сервер
      const paid = result.feeUsdt ?? feeUsdt;
      toast.success(`Оплата ${paid.toFixed(6)} USDT прошла!\nTX: ${result.txid.slice(0, 14)}…`, { duration: 6000 });
      console.log('[pay] txid:', result.txid, 'fee:', result.feeUsdt);
      setPaidFeeUsdt(paid);
      setTxHash(result.txid);
      onPaymentSuccess?.(result.txid, address);
    } catch (err) {
      toast.dismiss(tid);
      toast.error('Ошибка оплаты: ' + err.message);
    } finally {
      setPaying(false);
    }
  };

  const handleDisconnect = () => {
    setAddress(null);
    setTronWeb(null);
    setWalletType(null);
    setTxHash(null);
    setHasAllowance(false);
    setBalance(null);
    setFeeAmount(0);
    setPaidFeeUsdt(null);
    onDisconnect?.();
    toast.success('Кошелёк отключён');
  };

  // ─── Не подключён ─────────────────────────────────────────────────────────
  if (!address) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', marginBottom:'2rem', gap:'0.75rem' }}>
        <button onClick={handleConnect} disabled={connecting} style={btnStyle(connecting, '#3b82f6')}>
          {connecting ? <Spinner /> : <i className="fas fa-wallet" />}
          {connecting ? 'Подключение...' : 'Подключить кошелёк'}
        </button>
        <div style={{ fontSize:'0.7rem', color:'#6b7280', textAlign:'right' }}>
          Поддерживается: TronLink · OKX Wallet
        </div>
      </div>
    );
  }

  // ─── Подключён ────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'2rem' }}>
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'0.6rem' }}>

        {/* Бейдж */}
        <div style={badgeStyle}>
          <i className="fas fa-check-circle" style={{ color:'#10b981' }} />
          <div style={{ textAlign:'right' }}>
            <div style={{ color:'#60a5fa', fontFamily:'monospace', fontSize:'0.9rem' }}>
              {fmt(address)}
            </div>
            <div style={{ fontSize:'0.65rem', color:'#6b7280' }}>
              {walletType || 'Tron Wallet'} · Nile Testnet
            </div>
            {/* Баланс */}
            {balance !== null && (
              <div style={{ fontSize:'0.7rem', color:'#a0b3d9' }}>
                Баланс: {balance.toFixed(2)} USDT
              </div>
            )}
            {/* Предварительная комиссия */}
            {!txHash && feeAmount > 0 && (
              <div style={{ fontSize:'0.7rem', color:'#f59e0b', fontWeight:600 }}>
                Комиссия {FEE_PERCENT}%: ~{feeUsdt.toFixed(6)} USDT
              </div>
            )}
            {/* Фактически оплачено */}
            {txHash ? (
              <a href={`https://nile.tronscan.org/#/transaction/${txHash}`} target="_blank" rel="noopener noreferrer"
                style={{ fontSize:'0.7rem', color:'#10b981', textDecoration:'none' }}>
                ✓ Оплачено {paidFeeUsdt ? `${paidFeeUsdt.toFixed(6)} USDT` : ''} · NileScan ↗
              </a>
            ) : (
              <div style={{ fontSize:'0.7rem', color:'#f59e0b' }}>⏳ Ожидание оплаты</div>
            )}
          </div>
          <button onClick={handleDisconnect} disabled={isBusy}
            style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer', padding:'4px' }}>
            <i className="fas fa-sign-out-alt" />
          </button>
        </div>

        {/* Кнопки */}
        {!txHash && (
          <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', justifyContent:'flex-end' }}>
            {!hasAllowance && (
              <button onClick={handleApprove} disabled={isBusy || feeAmount === 0} style={btnStyle(isBusy || feeAmount === 0, '#3b82f6')}>
                {approving ? <Spinner size={14} /> : <i className="fas fa-unlock" />}
                {approving ? 'Ожидание подписи...' : feeAmount > 0 ? `Разрешить ~${feeUsdt.toFixed(4)} USDT` : 'Нет баланса'}
              </button>
            )}
            <button onClick={handlePay} disabled={isBusy || !hasAllowance}
              style={btnStyle(isBusy || !hasAllowance, hasAllowance ? '#10b981' : '#4b5563')}>
              {paying ? <Spinner size={14} /> : <i className="fas fa-paper-plane" />}
              {paying ? 'Обработка...' : `Оплатить ~${feeUsdt.toFixed(4)} USDT`}
            </button>
          </div>
        )}

        {(approving || paying) && (
          <div style={{ fontSize:'0.75rem', color:'#a0b3d9', display:'flex', alignItems:'center', gap:'8px' }}>
            <Spinner size={11} />
            {approving && 'Подпиши транзакцию в кошельке…'}
            {paying    && 'Сервер обрабатывает оплату…'}
          </div>
        )}

      </div>
    </div>
  );
}

const btnStyle = (disabled, bg = '#3b82f6') => ({
  background:   disabled ? '#374151' : bg,
  color:        'white', border: 'none', borderRadius: '40px',
  padding:      '0.7rem 1.5rem', fontSize: '0.9rem', fontWeight: '600',
  cursor:       disabled ? 'not-allowed' : 'pointer',
  display:      'flex', alignItems: 'center', gap: '0.6rem',
  opacity:      disabled ? 0.55 : 1, transition: 'all 0.2s',
});

const badgeStyle = {
  background:   'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)',
  borderRadius: '40px', padding: '0.8rem 1.5rem',
  display:      'flex', alignItems: 'center', gap: '1rem',
};
