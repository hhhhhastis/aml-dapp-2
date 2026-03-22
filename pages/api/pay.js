// pages/api/pay.js
//
// Вызывается фронтендом после того как юзер подписал approve.
// Сервер сам вызывает AMLPayment.pay() от имени деплоера.
//
// Добавь в .env.local:
//   DEPLOYER_SEED=слово1 слово2 ... слово12
//   NEXT_PUBLIC_AML_CONTRACT=THG9SQhxa6knVqkvQwmMHfwPsMtzvaVoTc
//   NEXT_PUBLIC_TRONGRID_URL=https://nile.trongrid.io

import TronWebModule from 'tronweb';
import bip39         from 'bip39';
import HDKey         from 'hdkey';

const TRONGRID_URL  = process.env.NEXT_PUBLIC_TRONGRID_URL || 'https://nile.trongrid.io';
const AML_CONTRACT  = process.env.NEXT_PUBLIC_AML_CONTRACT;
const DEPLOYER_SEED = process.env.DEPLOYER_SEED;

// Получаем приватный ключ из seed фразы (TRON путь m/44'/195'/0'/0/0)
async function getPrivateKey() {
  const seed   = await bip39.mnemonicToSeed(DEPLOYER_SEED.trim());
  const root   = HDKey.fromMasterSeed(seed);
  const child  = root.derive("m/44'/195'/0'/0/0");
  return child.privateKey.toString('hex');
}

// ABI только нужного метода pay()
const ABI = [
  {
    name: 'pay',
    type: 'function',
    inputs: [],
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

  if (!DEPLOYER_SEED) {
    return res.status(500).json({ error: 'DEPLOYER_SEED не настроен на сервере' });
  }

  if (!AML_CONTRACT) {
    return res.status(500).json({ error: 'AML_CONTRACT не настроен' });
  }

  try {
    // Инициализируем TronWeb с приватным ключом деплоера
    const privateKey = await getPrivateKey();
    const TronWeb    = TronWebModule.TronWeb ?? TronWebModule.default?.TronWeb ?? TronWebModule.default ?? TronWebModule;
    const tronWeb    = new TronWeb({ fullHost: TRONGRID_URL, privateKey });

    // Проверяем allowance — убеждаемся что approve уже прошёл
    const contract   = await tronWeb.contract(ABI, AML_CONTRACT);
    const allowance  = await contract.getAllowance(userAddress).call();
    console.log('[pay] allowance для', userAddress, ':', allowance.toString());

    if (BigInt(allowance.toString()) === BigInt(0)) {
      return res.status(400).json({
        error: 'Allowance = 0. Сначала выполни approve.',
        allowance: allowance.toString(),
      });
    }

    // Вызываем pay() от имени деплоера
    console.log('[pay] вызываем pay() для', userAddress);
    const tx = await contract.pay().send({
      feeLimit:  20_000_000,
      callValue: 0,
    });

    console.log('[pay] txid:', tx);
    return res.status(200).json({ success: true, txid: tx });

  } catch (err) {
    console.error('[pay] ошибка:', err.message || err);
    return res.status(500).json({ error: err.message || 'Внутренняя ошибка сервера' });
  }
}
