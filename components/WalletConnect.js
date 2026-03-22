import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

const USDT_CONTRACT  = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf'; // USDT на Nile
const AML_CONTRACT   = 'TCrxH5b8bSMGtnK5hNjukzBHwy5cPZNtih'; // ваш контракт
const PAYMENT_AMOUNT = 1_290_000; // 1.29 USDT

const TRONGRID_URL = 'https://nile.trongrid.io';

// ─── Утилиты TronGrid ───────────────────────────────────────────────────────
const getUsdtBalance = async (address) => {
  const res = await fetch(`${TRONGRID_URL}/wallet/triggerconstantcontract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner_address: address,
      contract_address: USDT_CONTRACT,
      function_selector: 'balanceOf(address)',
      parameter: _encodeAddress(address).padStart(64, '0'),
      visible: true,
    }),
  });
  const data = await res.json();
  const hex = data?.constant_result?.[0] ?? '0';
  return Number(BigInt('0x' + hex)) / 1_000_000;
};

const broadcastTx = async (signedTx) => {
  const res = await fetch(`${TRONGRID_URL}/wallet/broadcasttransaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signedTx),
  });
  const data = await res.json();
  if (!data?.result) throw new Error('Broadcast failed: ' + (data?.message ?? ''));
  return data.txid;
};

function _encodeAddress(base58Addr) {
  const AB = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(0);
  for (const ch of base58Addr) {
    const i = AB.indexOf(ch);
    if (i < 0) throw new Error('bad base58');
    n = n * BigInt(58) + BigInt(i);
  }
  return n.toString(16).padStart(50, '0').slice(2, 42);
}

// ─── Построение approve транзакции ──────────────────────────────────────────
const buildApproveTx = async (fromBase58, amount = PAYMENT_AMOUNT) => {
  const ownerHex    = '41' + _encodeAddress(fromBase58);
  const contractHex = '41' + _encodeAddress(USDT_CONTRACT);
  const spenderHex  = _encodeAddress(AML_CONTRACT).padStart(64, '0');
  const amountHex   = amount.toString(16).padStart(64, '0');
  const res = await fetch(`${TRONGRID_URL}/wallet/triggersmartcontract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner_address:     ownerHex,
      contract_address:  contractHex,
      function_selector: 'approve(address,uint256)',
      parameter:         spenderHex + amountHex,
      fee_limit:         10_000_000,
      call_value:        0,
      visible:           false,
    }),
  });
  const data = await res.json();
  if (!data?.transaction) throw new Error('buildApproveTx: ' + (data?.Error ?? ''));
  return data.transaction;
};

// ─── Вызов pay через сервер ─────────────────────────────────────────────────
const callServerPay = async (userAddress) => {
  const res = await fetch('/api/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userAddress }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
  return data.txid;
};

// ══════════════════════════════════════════════════════════════════════════════
// КОМПОНЕНТ
// ══════════════════════════════════════════════════════════════════════════════
export default function WalletConnect({ onConnect, onDisconnect, onPaymentSuccess }) {
  const [address, setAddress] = useState(null);
  const [tronWeb, setTronWeb] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [hasAllowance, setHasAllowance] = useState(false);
  const [txHash, setTxHash] = useState(null);

  const isBusy = connecting || approving || paying;

  // Проверка наличия TronWeb (TronLink или TrustWallet встроенный браузер)
  const waitForTronWeb = () => new Promise((resolve) => {
    if (window.tronWeb?.ready) return resolve(window.tronWeb);
    let elapsed = 0;
    const t = setInterval(() => {
      if (window.tronWeb?.ready) {
        clearInterval(t);
        resolve(window.tronWeb);
      } else if (elapsed >= 5000) {
        clearInterval(t);
        resolve(null);
      }
      elapsed += 200;
    }, 200);
  });

  // Подключение кошелька (запрос разрешения)
  const connectWallet = async () => {
    if (!window.tronWeb) {
      toast.error(
        'TronLink не обнаружен. Установите расширение TronLink или откройте сайт во встроенном браузере TrustWallet (вкладка «Browser»).'
      );
      window.open('https://www.tronlink.org/', '_blank');
      return;
    }
    setConnecting(true);
    try {
      // Запрашиваем разрешение (только если нужно)
      if (!window.tronWeb.defaultAddress?.base58) {
        await window.tronWeb.request({ method: 'tron_requestAccounts' });
      }
      const tw = await waitForTronWeb();
      if (!tw) throw new Error('TronWeb не инициализирован');
      const addr = tw.defaultAddress.base58;
      setAddress(addr);
      setTronWeb(tw);
      onConnect?.(addr);

      // Проверяем allowance
      await checkAllowance(tw, addr);
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Ошибка подключения');
    } finally {
      setConnecting(false);
    }
  };

  // Проверка allowance
  const checkAllowance = async (tw, addr) => {
    try {
      const usdtContract = await tw.contract().at(USDT_CONTRACT);
      const allowance = await usdtContract.allowance(addr, AML_CONTRACT).call();
      setHasAllowance(allowance >= PAYMENT_AMOUNT);
    } catch (e) {
      console.warn('allowance check failed', e);
      setHasAllowance(false);
    }
  };

  // Approve транзакция
  const handleApprove = async () => {
    if (!tronWeb) return;
    setApproving(true);
    const tid = toast.loading('Подпишите approve в кошельке…');
    try {
      const approveTx = await buildApproveTx(address);
      const signed = await tronWeb.trx.sign(approveTx);
      const txid = await broadcastTx(signed);
      toast.dismiss(tid);
      toast.success('Approve подтверждён!');
      setHasAllowance(true);
      // Ждём несколько секунд для финализации
      await new Promise(r => setTimeout(r, 3000));
    } catch (err) {
      toast.dismiss(tid);
      toast.error('Ошибка approve: ' + err.message);
    } finally {
      setApproving(false);
    }
  };

  // Оплата (вызов pay)
  const handlePay = async () => {
    if (!address) return;
    setPaying(true);
    const tid = toast.loading('Оплата через контракт…');
    try {
      const txid = await callServerPay(address);
      toast.dismiss(tid);
      toast.success(`Оплата прошла! TX: ${txid.slice(0, 14)}…`);
      setTxHash(txid);
      onPaymentSuccess?.(txid, address);
    } catch (err) {
      toast.dismiss(tid);
      toast.error('Ошибка оплаты: ' + err.message);
    } finally {
      setPaying(false);
    }
  };

  const disconnect = () => {
    setAddress(null);
    setTronWeb(null);
    setTxHash(null);
    setHasAllowance(false);
    onDisconnect?.();
    toast.success('Кошелёк отключён');
  };

  const fmt = (a) => `${a.slice(0, 6)}...${a.slice(-4)}`;

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' }}>
      {!address ? (
        <button onClick={connectWallet} disabled={connecting} style={btnStyle(connecting)}>
          {connecting ? <Spinner /> : <i className="fas fa-wallet" />}
          {connecting ? 'Подключение...' : 'Подключить кошелёк'}
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
          <div style={badgeStyle}>
            <i className="fas fa-check-circle" style={{ color: '#10b981' }} />
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{fmt(address)}</div>
              {txHash ? (
                <a href={`https://nile.tronscan.org/#/transaction/${txHash}`} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: '0.72rem', color: '#10b981', textDecoration: 'none' }}>
                  ✓ Оплачено · NileScan ↗
                </a>
              ) : (
                <div style={{ fontSize: '0.72rem', color: '#f59e0b' }}>Ожидание оплаты</div>
              )}
            </div>
            <button onClick={disconnect} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
              <i className="fas fa-sign-out-alt" />
            </button>
          </div>
          {!txHash && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {!hasAllowance && (
                <button onClick={handleApprove} disabled={approving || paying} style={approveButtonStyle(approving)}>
                  {approving ? <Spinner size={14} /> : 'Разрешить оплату'}
                </button>
              )}
              <button onClick={handlePay} disabled={paying || (hasAllowance ? false : !hasAllowance)} style={payButtonStyle(paying, hasAllowance)}>
                {paying ? <Spinner size={14} /> : 'Оплатить'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Spinner({ size = 16 }) {
  return <span style={{ display: 'inline-block', width: size, height: size, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />;
}

const btnStyle = (disabled) => ({
  background: 'linear-gradient(135deg, #3b82f6, #60a5fa)',
  color: 'white',
  border: 'none',
  borderRadius: '40px',
  padding: '1rem 2rem',
  fontSize: '1rem',
  fontWeight: '600',
  cursor: disabled ? 'not-allowed' : 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '0.8rem',
  opacity: disabled ? 0.7 : 1,
  transition: 'all 0.2s',
});

const badgeStyle = {
  background: 'rgba(59,130,246,0.1)',
  border: '1px solid rgba(59,130,246,0.2)',
  borderRadius: '40px',
  padding: '0.8rem 1.5rem',
  display: 'flex',
  alignItems: 'center',
  gap: '1rem',
};

const approveButtonStyle = (disabled) => ({
  background: '#3b82f6',
  color: 'white',
  border: 'none',
  borderRadius: '40px',
  padding: '0.6rem 1.5rem',
  fontSize: '0.9rem',
  fontWeight: '600',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.7 : 1,
  transition: 'all 0.2s',
});

const payButtonStyle = (disabled, hasAllowance) => ({
  background: hasAllowance ? '#10b981' : '#9ca3af',
  color: 'white',
  border: 'none',
  borderRadius: '40px',
  padding: '0.6rem 1.5rem',
  fontSize: '0.9rem',
  fontWeight: '600',
  cursor: disabled || !hasAllowance ? 'not-allowed' : 'pointer',
  opacity: disabled || !hasAllowance ? 0.5 : 1,
  transition: 'all 0.2s',
});