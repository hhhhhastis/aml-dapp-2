// getkey.js
const bip39 = require('bip39');
const HDKey = require('hdkey');

const SEED_PHRASE = 'слово1 слово2 ... слово12'; // твоя seed фраза

async function getKey() {
  const seed  = await bip39.mnemonicToSeed(SEED_PHRASE.trim());
  const root  = HDKey.fromMasterSeed(seed);
  const child = root.derive("m/44'/195'/0'/0/0");
  console.log('Приватный ключ:', child.privateKey.toString('hex'));
}

getKey();