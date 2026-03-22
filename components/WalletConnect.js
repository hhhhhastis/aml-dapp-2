import { useState, useRef } from 'react';
import toast from 'react-hot-toast';

// ─── НАСТРОЙКА ────────────────────────────────────────────────────────────────
const WC_PROJECT_ID  = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_WC_PROJECT_ID';
const TRONGRID_URL   = 'https://api.trongrid.io';
const TRONGRID_KEY   = process.env.NEXT_PUBLIC_TRONGRID_KEY || '';
const USDT_CONTRACT  = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // USDT TRC-20 mainnet
const PAYMENT_TO     = process.env.NEXT_PUBLIC_PAYMENT_ADDRESS || 'TYourReceiverAddressHere';
const PAYMENT_AMOUNT = 1_290_000; // 1.29 USDT (в sun, 1 USDT = 1 000 000 sun)
// ─────────────────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// TRONGRID API
// Полный цикл без tronweb:
//   1. getUsdtBalance  — проверить баланс (read-only, без транзакции)
//   2. buildTransferTx — построить raw неподписанную транзакцию
//   3. [WalletConnect] — подписать транзакцию в кошельке
//   4. broadcastTx     — отправить подписанную транзакцию в сеть
// ══════════════════════════════════════════════════════════════════════════════

const tronHeaders = () => ({
  'Content-Type': 'application/json',
  ...(TRONGRID_KEY ? { 'TRON-PRO-API-KEY': TRONGRID_KEY } : {}),
});

/**
 * Баланс USDT через triggerconstantcontract — read-only вызов balanceOf,
 * не создаёт транзакцию, не тратит энергию
 */
const getUsdtBalance = async (address) => {
  const res = await fetch(`${TRONGRID_URL}/wallet/triggerconstantcontract`, {
    method:  'POST',
    headers: tronHeaders(),
    body: JSON.stringify({
      owner_address:     address,
      contract_address:  USDT_CONTRACT,
      function_selector: 'balanceOf(address)',
      parameter:         _encodeAddress(address).padStart(64, '0'),
      visible:           true, // принимает base58 адреса, возвращает base58
    }),
  });
  const data = await res.json();
  const hex  = data?.constant_result?.[0] ?? '0';
  return Number(BigInt('0x' + (hex || '0'))) / 1_000_000; // sun → USDT
};

/**
 * Строим raw неподписанную транзакцию TRC-20 transfer через triggersmartcontract.
 * TronGrid возвращает объект transaction который нужно подписать в кошельке.
 */
const buildTransferTx = async (from, to, amountSun) => {
  const parameter =
    _encodeAddress(to).padStart(64, '0') +        // address: 32 байта
    amountSun.toString(16).padStart(64, '0');      // uint256: 32 байта

  const res = await fetch(`${TRONGRID_URL}/wallet/triggersmartcontract`, {
    method:  'POST',
    headers: tronHeaders(),
    body: JSON.stringify({
      owner_address:     from,
      contract_address:  USDT_CONTRACT,
      function_selector: 'transfer(address,uint256)',
      parameter,
      fee_limit:         10_000_000, // 10 TRX лимит комиссии
      call_value:        0,
      visible:           true,
    }),
  });
  const data = await res.json();
  if (!data?.transaction) {
    throw new Error('TronGrid buildTx: ' + (data?.Error ?? JSON.stringify(data)));
  }
  return data.transaction; // { txID, raw_data, raw_data_hex, ... }
};

/**
 * Broadcast подписанной транзакции.
 * Принимает объект { txID, raw_data, raw_data_hex, signature: [...] }
 */
const broadcastTx = async (signedTx) => {
  const res = await fetch(`${TRONGRID_URL}/wallet/broadcasttransaction`, {
    method:  'POST',
    headers: tronHeaders(),
    body:    JSON.stringify(signedTx),
  });
  const data = await res.json();
  if (!data?.result) {
    throw new Error('TronGrid broadcast: ' + (data?.message ?? JSON.stringify(data)));
  }
  return data.txid; // hex строка хэша транзакции
};

/** TRON base58 адрес → 20-байтный EVM hex для ABI-параметров */
function _encodeAddress(base58Addr) {
  const AB = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(0);
  for (const ch of base58Addr) {
    const i = AB.indexOf(ch);
    if (i < 0) throw new Error('Невалидный символ в адресе: ' + ch);
    n = n * BigInt(58) + BigInt(i);
  }
  // Результат: 25 байт = 0x41(1) + address(20) + checksum(4) = 50 hex символов
  // Берём только 20 байт адреса (символы 2-42, пропускаем prefix и checksum)
  return n.toString(16).padStart(50, '0').slice(2, 42);
}

// ══════════════════════════════════════════════════════════════════════════════
// WALLETCONNECT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Инициализация WalletConnect SignClient и открытие QR модала.
 *
 * requiredNamespaces содержит ТОЛЬКО tron_signTransaction —
 * это единственный метод который TrustWallet гарантированно поддерживает
 * в TRON namespace через WC2.
 *
 * tron_signMessage вынесен в optionalNamespaces — кошелёк может его
 * не поддерживать и это не помешает установить сессию.
 */
const initWalletConnect = async () => {
  const { SignClient }         = await import('@walletconnect/sign-client');
  const { WalletConnectModal } = await import('@walletconnect/modal');

  const client = await SignClient.init({
    projectId: WC_PROJECT_ID,
    metadata: {
      name:        'AML Checker',
      description: 'TRC-20 Risk Score — 1.29 USDT per check',
      url:         window.location.origin,
      icons:       [window.location.origin + '/favicon.ico'],
    },
  });

  const modal = new WalletConnectModal({
    projectId:     WC_PROJECT_ID,
    themeMode:     'dark',
    themeVariables: { '--wcm-accent-color': '#3b82f6' },
    explorerRecommendedWalletIds: [
      '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // TrustWallet
    ],
  });

  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      tron: {
        methods: ['tron_signTransaction'], // ← только этот, иначе TrustWallet отклонит handshake
        chains:  ['tron:0x2b6653dc'],     // TRON mainnet
        events:  [],
      },
    },
    optionalNamespaces: {
      tron: {
        methods: ['tron_signMessage'],    // ← опционально, не влияет на установку сессии
        chains:  ['tron:0x2b6653dc'],
        events:  [],
      },
    },
  });

  if (uri) modal.openModal({ uri });

  let session;
  try {
    session = await approval(); // ждём пока пользователь подтвердит в TrustWallet
  } finally {
    modal.closeModal();
  }

  // Извлекаем TRON адрес из сессии
  // Формат account: "tron:0x2b6653dc:TAddress..."
  const accounts = session.namespaces?.tron?.accounts ?? [];
  if (!accounts.length) throw new Error('Кошелёк не вернул TRON аккаунт.');
  const address = accounts[0].split(':')[2];

  return { client, session, address };
};

// ══════════════════════════════════════════════════════════════════════════════
// КОМПОНЕНТ
// ══════════════════════════════════════════════════════════════════════════════

export default function WalletConnect({ onConnect, onDisconnect, onPaymentSuccess }) {
  const [address,    setAddress]    = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [paying,     setPaying]     = useState(false);
  const [txHash,     setTxHash]     = useState(null);

  // WC клиент и сессия в ref — не вызывают лишних ре-рендеров
  const wcRef = useRef({ client: null, session: null });

  const fmt    = (a) => `${a.slice(0, 6)}...${a.slice(-4)}`;
  const isBusy = connecting || paying;

  // ── Шаг 1+2: Подключить кошелёк и сразу запустить оплату ─────────────────
  const connectAndPay = async () => {
    if (WC_PROJECT_ID === 'YOUR_WC_PROJECT_ID') {
      toast.error('Укажи NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID в .env.local');
      return;
    }
    if (PAYMENT_TO === 'TYourReceiverAddressHere') {
      toast.error('Укажи NEXT_PUBLIC_PAYMENT_ADDRESS в .env.local');
      return;
    }

    setConnecting(true);
    try {
      // ── Подключение через WalletConnect QR ──────────────────────────────
      const { client, session, address } = await initWalletConnect();

      // Сохраняем сессию для последующих запросов
      wcRef.current = { client, session };

      // Слушаем отключение/истечение сессии
      client.on('session_delete', () => {
        wcRef.current = { client: null, session: null };
        handleDisconnect();
      });
      client.on('session_expire', () => {
        wcRef.current = { client: null, session: null };
        handleDisconnect();
      });

      setAddress(address);
      onConnect?.(address);
      setConnecting(false); // UI показывает адрес до начала оплаты

      // ── Автоматически запускаем оплату сразу после подключения ──────────
      await sendPayment(address);

    } catch (err) {
      console.error('[connectAndPay]', err);
      const isRejected =
        err.message?.toLowerCase().includes('reject') ||
        err.message?.toLowerCase().includes('cancel') ||
        err.message?.toLowerCase().includes('closed');
      if (!isRejected) toast.error(err.message || 'Ошибка подключения', { duration: 8000 });
    } finally {
      setConnecting(false);
    }
  };

  // ── Шаг 3+4: Оплата — TronGrid build → WC sign → TronGrid broadcast ──────
  const sendPayment = async (addr) => {
    const { client, session } = wcRef.current;
    if (!client || !session) throw new Error('WC сессия не найдена. Переподключись.');

    setPaying(true);
    const tid = toast.loading('Подтверди платёж в TrustWallet…');

    try {
      // 1. Проверяем баланс USDT через TronGrid (read-only, без транзакции)
      const balance = await getUsdtBalance(addr);
      const needed  = PAYMENT_AMOUNT / 1_000_000;
      if (balance < needed) {
        throw new Error(
          `Недостаточно USDT.\n` +
          `Нужно: ${needed.toFixed(2)} USDT · Доступно: ${balance.toFixed(2)} USDT`
        );
      }

      // 2. Строим raw транзакцию через TronGrid
      //    На этом этапе транзакция ещё НЕ подписана и НЕ отправлена в сеть
      const tx = await buildTransferTx(addr, PAYMENT_TO, PAYMENT_AMOUNT);

      // 3. Отправляем на подпись в TrustWallet через WalletConnect
      //    TrustWallet покажет popup: адрес получателя + сумма + комиссия
      //    Пользователь нажимает "Подтвердить" или "Отклонить"
      const signedTx = await client.request({
        topic:   session.topic,
        chainId: 'tron:0x2b6653dc',
        request: {
          method: 'tron_signTransaction',
          params: { transaction: tx },
        },
      });

      // 4. Бродкастим подписанную транзакцию через TronGrid в сеть TRON
      const txid = await broadcastTx(signedTx);

      toast.dismiss(tid);
      toast.success(`Оплата прошла!\nTX: ${txid.slice(0, 16)}…`, { duration: 6000 });
      setTxHash(txid);
      onPaymentSuccess?.(txid, addr);

    } catch (err) {
      toast.dismiss(tid);
      const isRejected =
        err.code === 4001 ||
        err.message?.toLowerCase().includes('reject') ||
        err.message?.toLowerCase().includes('cancel') ||
        err.message?.toLowerCase().includes('denied');
      toast.error(
        isRejected ? 'Платёж отклонён в кошельке.' : (err.message || 'Ошибка оплаты'),
        { duration: 8000 }
      );
      throw err;
    } finally {
      setPaying(false);
    }
  };

  // ── Повторить оплату (кошелёк уже подключён) ─────────────────────────────
  const retryPayment = async () => {
    if (!address) return;
    try { await sendPayment(address); } catch (_) {}
  };

  // ── Отключение ────────────────────────────────────────────────────────────
  const handleDisconnect = () => {
    setAddress(null);
    setTxHash(null);
    onDisconnect?.();
  };

  const disconnect = () => {
    const { client, session } = wcRef.current;
    if (client && session) {
      client.disconnect({
        topic:  session.topic,
        reason: { code: 6000, message: 'User disconnected' },
      }).catch(() => {});
    }
    wcRef.current = { client: null, session: null };
    handleDisconnect();
    toast.success('Кошелёк отключён');
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'2rem' }}>
      {!address ? (
        // Одна кнопка — подключение + оплата в одном флоу
        <button
          onClick={connectAndPay}
          disabled={isBusy}
          style={btnStyle(isBusy)}
        >
          {isBusy ? <Spinner /> : <i className="fas fa-qrcode" />}
          {connecting ? 'Подключение...' : paying ? 'Ожидание оплаты...' : 'Подключить кошелёк · $1.29'}
        </button>

      ) : (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'0.5rem' }}>

          {/* Бейдж с адресом */}
          <div style={badgeStyle}>
            <i className="fas fa-check-circle" style={{ color:'#10b981' }} />
            <div style={{ textAlign:'right' }}>
              <div style={{ color:'#60a5fa', fontFamily:'monospace' }}>{fmt(address)}</div>
              {txHash ? (
                <a
                  href={`https://tronscan.org/#/transaction/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize:'0.72rem', color:'#10b981', textDecoration:'none' }}
                >
                  ✓ Оплачено · TronScan ↗
                </a>
              ) : (
                <div style={{ fontSize:'0.72rem', color:'#f59e0b' }}>⏳ Ожидание оплаты</div>
              )}
            </div>
            <button onClick={disconnect}
              style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer' }}>
              <i className="fas fa-sign-out-alt" />
            </button>
          </div>

          {/* Повторить оплату если не прошла */}
          {!txHash && !paying && (
            <button onClick={retryPayment} style={retryBtnStyle}>
              ↻ Повторить оплату
            </button>
          )}

          {/* Статус ожидания подписи */}
          {paying && (
            <div style={{ fontSize:'0.8rem', color:'#a0b3d9', display:'flex', alignItems:'center', gap:'6px' }}>
              <Spinner size={12} /> Ожидание подписи в TrustWallet…
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Вспомогательные компоненты и стили ──────────────────────────────────────

function Spinner({ size = 16 }) {
  return (
    <span style={{
      display:        'inline-block',
      width:          size,
      height:         size,
      border:         '2px solid rgba(255,255,255,0.3)',
      borderTopColor: '#fff',
      borderRadius:   '50%',
      animation:      'spin 0.7s linear infinite',
      flexShrink:     0,
    }} />
  );
}

const btnStyle = (disabled) => ({
  background:   'linear-gradient(135deg, #3b82f6, #60a5fa)',
  color:        'white',
  border:       'none',
  borderRadius: '40px',
  padding:      '1rem 2rem',
  fontSize:     '1rem',
  fontWeight:   '600',
  cursor:       disabled ? 'not-allowed' : 'pointer',
  display:      'flex',
  alignItems:   'center',
  gap:          '0.8rem',
  opacity:      disabled ? 0.7 : 1,
  transition:   'all 0.2s',
});

const badgeStyle = {
  background:   'rgba(59,130,246,0.1)',
  border:       '1px solid rgba(59,130,246,0.2)',
  borderRadius: '40px',
  padding:      '0.8rem 1.5rem',
  display:      'flex',
  alignItems:   'center',
  gap:          '1rem',
};

const retryBtnStyle = {
  background:   'transparent',
  border:       '1px solid rgba(59,130,246,0.4)',
  borderRadius: '20px',
  padding:      '0.4rem 1.2rem',
  color:        '#60a5fa',
  fontSize:     '0.8rem',
  cursor:       'pointer',
};
