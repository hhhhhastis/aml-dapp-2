// pages/api/pay.js

const TRONGRID_URL = process.env.NEXT_PUBLIC_TRONGRID_URL || 'https://nile.trongrid.io';
const AML_CONTRACT = process.env.NEXT_PUBLIC_AML_CONTRACT;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userAddress } = req.body;

  if (!userAddress) {
    return res.status(400).json({ error: 'userAddress обязателен' });
  }
  if (!AML_CONTRACT) {
    return res.status(500).json({ error: 'AML_CONTRACT не настроен' });
  }

  console.log('[pay] userAddress:', userAddress);
  console.log('[pay] AML_CONTRACT:', AML_CONTRACT);
  console.log('[pay] TRONGRID_URL:', TRONGRID_URL);

  try {
    // Конвертируем base58 адрес в hex для API
    const userHex = await base58ToHex(userAddress);
    const contractHex = await base58ToHex(AML_CONTRACT);

    console.log('[pay] userHex:', userHex);
    console.log('[pay] contractHex:', contractHex);

    // Строим транзакцию вызова pay() от имени пользователя
    const response = await fetch(`${TRONGRID_URL}/wallet/triggersmartcontract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner_address:     userHex,
        contract_address:  contractHex,
        function_selector: 'pay()',
        parameter:         '',
        fee_limit:         100_000_000,
        call_value:        0,
        visible:           false,
      }),
    });

    const data = await response.json();
    console.log('[pay] triggersmartcontract response:', JSON.stringify(data));

    if (!data?.transaction) {
      const msg = data?.result?.message
        ? Buffer.from(data.result.message, 'hex').toString('utf8')
        : JSON.stringify(data);
      throw new Error('Ошибка при построении транзакции: ' + msg);
    }

    // Возвращаем неподписанную транзакцию фронтенду для подписи пользователем
    return res.status(200).json({ transaction: data.transaction });

  } catch (err) {
    console.error('[pay] ошибка:', err.message);
    return res.status(500).json({ error: err.message || 'Внутренняя ошибка сервера' });
  }
}

// Конвертация base58 → hex для TronGrid API
async function base58ToHex(base58Addr) {
  const AB = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(0);
  for (const ch of base58Addr) {
    const i = AB.indexOf(ch);
    if (i < 0) throw new Error('Невалидный base58 адрес: ' + base58Addr);
    n = n * BigInt(58) + BigInt(i);
  }
  return '41' + n.toString(16).padStart(50, '0').slice(2, 42);
}