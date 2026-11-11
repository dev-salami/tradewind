// Offline helper, run where viem is already installed:
// node contracts/tradewind/scripts/sign-test-vector.mjs
// This is a well-known public test key, never a funded or production key.
import { privateKeyToAccount } from 'viem/accounts';

const MESSAGE = 'verifiable-model:abababababababababababababababababababababababababababababababab:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd';
const account = privateKeyToAccount('0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318');
console.log('MESSAGE:', MESSAGE);
console.log('Address:', account.address);
console.log('SIG_HEX:', await account.signMessage({ message: MESSAGE }));
