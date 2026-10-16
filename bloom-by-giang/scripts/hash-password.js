// Tạo SHOP_PASSWORD_HASH: npm run hash-password -- "matkhaucuaban"
const { hash } = require('../src/password');
const pw = process.argv[2];
if (!pw) { console.error('Cách dùng: npm run hash-password -- "matkhau"'); process.exit(1); }
console.log(hash(pw));
