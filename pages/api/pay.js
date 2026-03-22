const TRONGRID_URL         = process.env.NEXT_PUBLIC_TRONGRID_URL || 'https://nile.trongrid.io';
const AML_CONTRACT         = process.env.NEXT_PUBLIC_AML_CONTRACT;
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

const ABI = [
  {
    name: 'pay',
    type: 'function',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getAllowance',
    type: 'function',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userAddress } = req.body;

  if (!userAddress) {
    return res.status(400).json({ error: 'userAddress обязателен' });
  }
  if (!DEPLOYER_PRIVATE_KEY) {
    return res.status(500).json({ error: 'DEPLOYER_PRIVATE_KEY не настроен' });
  }
  if (!AML_CONTRACT) {
    return res.status(500).json({ error: 'AML_CONTRACT не настроен' });
  }

  try {
    const TronWebModule = await import('tronweb');
    const TronWeb = TronWebModule.TronWeb 
        ?? TronWebModule.default?.TronWeb 
        ?? TronWebModule.default 
        ?? TronWebModule;

    const tronWeb = new TronWeb({
      fullHost:   TRONGRID_URL,
      privateKey: DEPLOYER_PRIVATE_KEY,
    });

    const contract = await tronWeb.contract(ABI, AML_CONTRACT);

    // 1. Проверяем allowance
    const allowance = await contract.getAllowance(userAddress).call({});
    console.log('[pay] allowance:', allowance.toString());

    if (BigInt(allowance.toString()) === BigInt(0)) {
      return res.status(400).json({
        error: 'Allowance = 0. Сначала выполни approve.',
        allowance: allowance.toString(),
      });
    }

    // 2. Симулируем вызов — ловим revert до реальной транзакции
    const simulation = await tronWeb.transactionBuilder.triggerConstantContract(
      AML_CONTRACT,
      'pay(address)',
      {},
      [{ type: 'address', value: userAddress }],
      tronWeb.defaultAddress.base58
    );

    console.log('[pay] simulation result:', JSON.stringify(simulation, null, 2));

    if (!simulation.result?.result) {
      const revertMsg = simulation.result?.message
        ? tronWeb.toUtf8(simulation.result.message)
        : 'Unknown revert reason';
      return res.status(400).json({
        error: 'Контракт вернёт ошибку: ' + revertMsg,
        simulation,
      });
    }

    // 3. Вызываем pay()
    console.log('[pay] вызываем pay() для', userAddress);
    const tx = await contract.pay(userAddress).send({
      feeLimit:  100_000_000, // 100 TRX
      callValue: 0,
    });

    console.log('[pay] txid:', tx);
    return res.status(200).json({ success: true, txid: tx });

  } catch (err) {
    console.error('[pay] ошибка:', err);
    return res.status(500).json({ error: err.message || 'Внутренняя ошибка сервера' });
  }
}