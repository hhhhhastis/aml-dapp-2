import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { ethers } from 'ethers';

// ─── НАСТРОЙКИ ────────────────────────────────────────────────────────────────
// TRON (Nile Testnet)
const TRON_USDT_CONTRACT  = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const TRON_AML_CONTRACT   = 'TCrxH5b8bSMGtnK5hNjukzBHwy5cPZNtih';
const TRON_PAYMENT_AMOUNT = 1_290_000; // 1.29 USDT (6 decimals)
const TRONGRID_URL = 'https://nile.trongrid.io';

// Ethereum (Mainnet / Testnet – укажите нужное)
const ETH_USDT_CONTRACT  = '0xdAC17F958D2ee523a2206206994597C13D831ec7'; // Ethereum Mainnet
const ETH_AML_CONTRACT   = '0x...'; // ваш контракт в Ethereum
const ETH_PAYMENT_AMOUNT = ethers.utils.parseUnits('1.29', 18); // 1.29 USDT (18 decimals)
const ETH_NETWORK = { chainId: 1, name: 'mainnet' }; // или 11155111 для Sepolia

// Адрес для ручной оплаты (если ни то, ни другое не работает)
const MANUAL_RECIPIENT = 'TWZpvLFsSus5r3uLcyX3h3pUgCR35TJn8m';

// ─── Утилиты ──────────────────────────────────────────────────────────────────
const broadcastTx = async (signedTx, chain = 'tron') => {
  if (chain === 'tron') {
    const res = await fetch(`${TRONGRID_URL}/wallet/broadcasttransaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedTx),
    });
    const data = await res.json();
    if (!data?.result) throw new Error('Broadcast failed');
    return data.txid;
  } else {
    // Ethereum – уже подписано через ethers, просто возвращаем хэш
    return signedTx.hash;
  }
};

// Проверка платежа (для ручного режима)
const verifyManualPayment = async (txid, expectedRecipient, expectedAmount, chain = 'tron') => {
  if (chain === 'tron') {
    const res = await fetch(`${TRONGRID_URL}/v1/transactions/${txid}`);
    const data = await res.json();
    const tx = data?.data?.[0];
    if (!tx) throw new Error('Транзакция не найдена');
    if (tx.ret?.[0]?.contractRet !== 'SUCCESS') throw new Error('Транзакция не подтверждена');
    const contract = tx.raw_data.contract[0];
    const toAddress = contract.parameter.value.to;
    const amount = parseInt(contract.parameter.value.amount, 16) / 1e6;
    if (toAddress !== expectedRecipient) throw new Error('Неверный получатель');
    if (amount < expectedAmount / 1e6 - 0.01) throw new Error('Недостаточная сумма');
  } else {
    // Ethereum проверка через Etherscan API или JSON-RPC (упрощённо)
    const provider = new ethers.providers.JsonRpcProvider('https://mainnet.infura.io/v3/YOUR_PROJECT_ID');
    const tx = await provider.getTransaction(txid);
    if (!tx) throw new Error('Транзакция не найдена');
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error('Транзакция не подтверждена');
    const iface = new ethers.utils.Interface(['function transfer(address,uint256)']);
    const decoded = iface.parseTransaction({ data: tx.data, value: tx.value });
    if (decoded.name !== 'transfer') throw new Error('Не USDT транзакция');
    if (decoded.args.to !== expectedRecipient) throw new Error('Неверный получатель');
    if (decoded.args.amount.lt(expectedAmount)) throw new Error('Недостаточная сумма');
  }
  return true;
};

// ─── Универсальная отправка TRON транзакции (использует window.tronWeb.trx.sign) ───
// ─── Улучшенная отправка TRON транзакции (для approve и pay) ────────────────
const sendTronTransaction = async (txBuilderFn) => {
  // 1. Получаем tronWeb из доступных источников
  const tronWeb = window.trustwallet?.tronLink?.tronWeb || window.tronLink?.tronWeb || window.tronWeb;
  
  if (!tronWeb || !tronWeb.ready) {
    throw new Error('TronWeb не инициализирован. Установите TronLink или откройте сайт во встроенном браузере TrustWallet.');
  }

  // 2. Проверяем, что кошелёк подключён и разблокирован
  const fromAddress = tronWeb.defaultAddress?.base58;
  if (!fromAddress) {
    throw new Error('Кошелёк не подключён или заблокирован.');
  }

  // 3. Строим транзакцию (например, approve или transfer)
  let unsignedTx;
  try {
    unsignedTx = await txBuilderFn(tronWeb, fromAddress);
  } catch (err) {
    throw new Error(`Ошибка при построении транзакции: ${err.message}`);
  }

  if (!unsignedTx || !unsignedTx.txID) {
    throw new Error('Не удалось создать транзакцию.');
  }

  console.log('Unsigned transaction created:', unsignedTx);

  // 4. Запрашиваем подпись (вызовет всплывающее окно кошелька)
  let signedTx;
  try {
    signedTx = await tronWeb.trx.sign(unsignedTx);
  } catch (err) {
    if (err?.message?.includes('Confirmation declined by user')) {
      throw new Error('Вы отклонили транзакцию.');
    }
    throw new Error(`Ошибка при подписи: ${err.message}`);
  }

  if (!signedTx) {
    throw new Error('Транзакция не была подписана.');
  }

  console.log('Signed transaction:', signedTx);

  // 5. Определяем txID и при необходимости транслируем транзакцию
  let transactionId;

  if (typeof signedTx === 'string') {
    // Кошелёк вернул txid — транзакция уже отправлена
    transactionId = signedTx;
    console.log('Transaction already broadcasted, txid:', transactionId);
  } else if (signedTx?.txID) {
    transactionId = signedTx.txID;

    // Проверяем наличие подписи — если есть, транслируем вручную
    if (signedTx.signature) {
      try {
        const broadcastResult = await tronWeb.trx.sendRawTransaction(signedTx);
        // Проверяем успешность broadcast
        if (!broadcastResult.result) {
          // Игнорируем дубликат транзакции — она уже в сети
          if (broadcastResult.code === 'DUP_TRANSACTION_ERROR') {
            console.warn('Транзакция уже была отправлена ранее (дубликат).');
          } else {
            throw new Error(`Ошибка broadcast: ${broadcastResult.message || broadcastResult.code}`);
          }
        }
        console.log('Broadcast result:', broadcastResult);
      } catch (err) {
        // Если ошибка не дубликат, пробрасываем
        if (!err.message?.includes('DUP_TRANSACTION_ERROR')) {
          throw err;
        }
      }
    }
  } else {
    throw new Error(`Неожиданный формат ответа от sign(): ${JSON.stringify(signedTx)}`);
  }

  console.log('✅ Transaction successful, txid:', transactionId);
  return transactionId;
};

// ══════════════════════════════════════════════════════════════════════════════
// КОМПОНЕНТ
// ══════════════════════════════════════════════════════════════════════════════
export default function WalletConnect({ onConnect, onDisconnect, onPaymentSuccess }) {
  const [address, setAddress] = useState(null);
  const [chain, setChain] = useState(null); // 'tron' или 'eth'
  const [web3Provider, setWeb3Provider] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [hasAllowance, setHasAllowance] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualTxid, setManualTxid] = useState('');
  const [manualChecking, setManualChecking] = useState(false);

  const isBusy = connecting || approving || paying || manualChecking;

  // Определяем доступные провайдеры
  const hasTronWeb = typeof window !== 'undefined' && (window.tronWeb?.ready || window.tronLink?.tronWeb);
  const hasEthereum = typeof window !== 'undefined' && window.ethereum;

  // Если нет tronWeb и нет ethereum, переключаем в ручной режим
  useEffect(() => {
    if (!hasTronWeb && !hasEthereum && !address) {
      setManualMode(true);
    }
  }, []);

  // ─── Подключение к TronLink / TrustWallet (TRON) ────────────────────────────
  const connectTron = async () => {
    const tronWeb = window.tronWeb || window.trustwallet?.tronLink?.tronWeb || window.tronLink?.tronWeb;
    if (!tronWeb) throw new Error('TronLink не обнаружен');
    if (!tronWeb.defaultAddress?.base58) {
      await tronWeb.request({ method: 'tron_requestAccounts' });
    }
    let tw = tronWeb;
    let attempts = 0;
    while (!tw?.ready && attempts < 20) {
      await new Promise(r => setTimeout(r, 200));
      tw = window.tronWeb;
      attempts++;
    }
    if (!tw?.ready) throw new Error('TronWeb не инициализирован');
    const addr = tw.defaultAddress.base58;
    setAddress(addr);
    setChain('tron');
    setWeb3Provider(tw);
    onConnect?.(addr);
    await checkTronAllowance(tw, addr);
  };

  const checkTronAllowance = async (tw, addr) => {
    try {
      const usdtContract = await tw.contract().at(TRON_USDT_CONTRACT);
      const allowance = await usdtContract.allowance(addr, TRON_AML_CONTRACT).call();
      setHasAllowance(allowance >= TRON_PAYMENT_AMOUNT);
    } catch (e) {
      setHasAllowance(false);
    }
  };

  const approveTron = async () => {
  setApproving(true);
  const tid = toast.loading('Подпишите approve в кошельке…');
  try {
    await sendTronTransaction(async (tronWeb, fromAddress) => {
      const ownerHex = '41' + _encodeAddress(fromAddress);
      const spenderHex = _encodeAddress(TRON_AML_CONTRACT).padStart(64, '0');
      const amountHex = TRON_PAYMENT_AMOUNT.toString(16).padStart(64, '0');
      const res = await fetch(`${TRONGRID_URL}/wallet/triggersmartcontract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_address: ownerHex,
          contract_address: '41' + _encodeAddress(TRON_USDT_CONTRACT),
          function_selector: 'approve(address,uint256)',
          parameter: spenderHex + amountHex,
          fee_limit: 10_000_000,
          call_value: 0,
          visible: false,
        }),
      });
      const data = await res.json();
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

  const payTron = async () => {
    setPaying(true);
    const tid = toast.loading('Оплата через контракт…');
    try {
      const txid = await sendTronTransaction(async (tronWeb) => {
        const res = await fetch('/api/pay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userAddress: address, chain: 'tron' }),
        });
        const data = await res.json();
        if (!data?.transaction) throw new Error(data.error || 'Ошибка сервера');
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

  // ─── Подключение к Ethereum (TrustWallet / MetaMask) ────────────────────────
  const connectEthereum = async () => {
    if (!window.ethereum) throw new Error('Ethereum кошелёк не обнаружен');
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const addr = accounts[0];
    setAddress(addr);
    setChain('eth');
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    setWeb3Provider(provider);
    onConnect?.(addr);
    await checkEthAllowance(addr);
  };

  const checkEthAllowance = async (addr) => {
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const usdt = new ethers.Contract(ETH_USDT_CONTRACT, [
        'function allowance(address owner, address spender) view returns (uint256)',
      ], signer);
      const allowance = await usdt.allowance(addr, ETH_AML_CONTRACT);
      setHasAllowance(allowance.gte(ETH_PAYMENT_AMOUNT));
    } catch (e) {
      setHasAllowance(false);
    }
  };

  const approveEth = async () => {
    setApproving(true);
    const tid = toast.loading('Подпишите approve в кошельке…');
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const usdt = new ethers.Contract(ETH_USDT_CONTRACT, [
        'function approve(address spender, uint256 amount) returns (bool)',
      ], signer);
      const tx = await usdt.approve(ETH_AML_CONTRACT, ETH_PAYMENT_AMOUNT);
      await tx.wait();
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

  const payEth = async () => {
    setPaying(true);
    const tid = toast.loading('Оплата через контракт…');
    try {
      const res = await fetch('/api/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: address, chain: 'eth' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTxHash(data.txid);
      toast.dismiss(tid);
      toast.success(`Оплата прошла! TX: ${data.txid.slice(0, 14)}…`);
      onPaymentSuccess?.(data.txid, address);
    } catch (err) {
      toast.dismiss(tid);
      toast.error('Ошибка оплаты: ' + err.message);
    } finally {
      setPaying(false);
    }
  };

  // ─── Основная кнопка подключения ───────────────────────────────────────────
  const handleConnect = async () => {
    setConnecting(true);
    try {
      if (hasTronWeb) {
        await connectTron();
      } else if (hasEthereum) {
        await connectEthereum();
      } else {
        throw new Error('Нет поддерживаемого кошелька');
      }
    } catch (err) {
      toast.error(err.message || 'Ошибка подключения');
      setManualMode(true);
    } finally {
      setConnecting(false);
    }
  };

  const handleApprove = chain === 'tron' ? approveTron : approveEth;
  const handlePay = chain === 'tron' ? payTron : payEth;

  const disconnect = () => {
    setAddress(null);
    setChain(null);
    setTxHash(null);
    setHasAllowance(false);
    onDisconnect?.();
    toast.success('Кошелёк отключён');
  };

  const fmt = (a) => `${a.slice(0, 6)}...${a.slice(-4)}`;

  // Ручной режим (если нет ни одного провайдера)
  if (manualMode && !address) {
    return (
      <div style={{ marginBottom: '2rem', textAlign: 'right' }}>
        <div style={manualBoxStyle}>
          <p style={{ marginBottom: '0.5rem', fontWeight: 'bold' }}>💸 Оплата вручную</p>
          <p>Отправьте <strong>1.29 USDT</strong> на адрес:</p>
          <code style={codeStyle}>{MANUAL_RECIPIENT}</code>
          <input
            type="text"
            placeholder="Введите TXID транзакции"
            value={manualTxid}
            onChange={(e) => setManualTxid(e.target.value)}
            style={inputStyle}
          />
          <button onClick={() => verifyManualPayment(manualTxid, MANUAL_RECIPIENT, TRON_PAYMENT_AMOUNT, 'tron')} disabled={manualChecking} style={manualButtonStyle}>
            {manualChecking ? 'Проверка...' : 'Проверить оплату'}
          </button>
        </div>
      </div>
    );
  }

  // Основной интерфейс
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' }}>
      {!address ? (
        <button onClick={handleConnect} disabled={connecting} style={btnStyle(connecting)}>
          {connecting ? <Spinner /> : <i className="fas fa-wallet" />}
          {connecting ? 'Подключение...' : (hasTronWeb ? 'Подключить TronLink' : (hasEthereum ? 'Подключить MetaMask / TrustWallet' : 'Ручная оплата'))}
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
          <div style={badgeStyle}>
            <i className="fas fa-check-circle" style={{ color: '#10b981' }} />
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{fmt(address)}</div>
              <div style={{ fontSize: '0.65rem', color: '#a0b3d9' }}>{chain === 'tron' ? 'TRON Network' : 'Ethereum'}</div>
              {txHash ? (
                <a href={chain === 'tron' ? `https://nile.tronscan.org/#/transaction/${txHash}` : `https://etherscan.io/tx/${txHash}`}
                  target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.72rem', color: '#10b981', textDecoration: 'none' }}>
                  ✓ Оплачено · Scan ↗
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
              <button onClick={handlePay} disabled={paying || !hasAllowance} style={payButtonStyle(paying, hasAllowance)}>
                {paying ? <Spinner size={14} /> : 'Оплатить'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Вспомогательные функции и стили ──────────────────────────────────────────
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

const manualBoxStyle = {
  background: 'rgba(15,25,45,0.6)',
  border: '1px solid rgba(59,130,246,0.2)',
  borderRadius: '32px',
  padding: '1.5rem',
  textAlign: 'left',
  maxWidth: '400px',
};

const codeStyle = {
  background: '#0a0e1a',
  padding: '0.3rem 0.6rem',
  borderRadius: '8px',
  wordBreak: 'break-all',
  fontSize: '0.8rem',
  display: 'inline-block',
  marginBottom: '0.5rem',
};

const inputStyle = {
  width: '100%',
  padding: '0.8rem',
  marginTop: '1rem',
  background: '#0a0e1a',
  border: '1px solid rgba(59,130,246,0.3)',
  borderRadius: '20px',
  color: 'white',
  fontSize: '0.9rem',
};

const manualButtonStyle = {
  marginTop: '1rem',
  width: '100%',
  padding: '0.8rem',
  background: 'linear-gradient(135deg, #3b82f6, #60a5fa)',
  border: 'none',
  borderRadius: '20px',
  color: 'white',
  fontWeight: '600',
  cursor: 'pointer',
};