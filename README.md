# Sharpe Trade Bot

Bot untuk melakukan swap otomatis di Monad Network dengan fitur credit tracking.

## Fitur

- Swap otomatis MON ke SHARPE 
- Menunggu credit update setiap swap
- Swap balik semua SHARPE ke MON di akhir
- Tracking points dan credit activity

## Prasyarat

- Node.js v18 atau lebih baru
- NPM atau Yarn
- Wallet Monad dengan MON untuk gas fee

## Instalasi

1. Clone repository:
```bash
git clone https://github.com/yogiprayoga1313/sharpe-trade.git
cd sharpe-trade
```

2. Install dependencies:
```bash
npm install
# atau
yarn install
```

3. Buat file `.env` di root project:
```env
# RPC URL
MONAD_RPC_URL=https://rpc.monad.xyz

# API URLs
SHERPA_API_URL=https://api.sherpa.trade
HEDGEMONY_API_URL=https://prod-api.hedgemony.xyz

# Wallet Private Key
PRIVATE_KEY=your_private_key_here
```

## Penggunaan

1. Pastikan file `.env` sudah berisi semua konfigurasi yang diperlukan
   - Ganti `your_private_key_here` dengan private key wallet Anda (dimulai dengan "0x")

2. Jalankan bot:
```bash
node index.js
```

Bot akan:
- Melakukan login dengan wallet
- Melakukan 5 kali swap MON ke WMON
- Menunggu credit update setiap swap
- Swap balik semua WMON ke MON di akhir
- Menampilkan balance dan points di setiap langkah

## Konfigurasi

### Swap Amount
Jumlah MON yang akan di-swap setiap kali transaksi bisa diatur di `index.js`:
```javascript
const SWAP_AMOUNT = "0.0012"; // Amount in MON
```

### Gas Settings
Pengaturan gas bisa diatur di fungsi swap:
```javascript
const tx = {
    gasLimit: 500000,
    maxFeePerGas: ethers.parseUnits("100", "gwei"),
    maxPriorityFeePerGas: ethers.parseUnits("1.5", "gwei")
};
```

### Delay Settings
Jeda antara swap bisa diatur di fungsi main:
```javascript
await delay(5000); // 5 seconds delay
```

## Keamanan

- JANGAN share private key Anda
- JANGAN commit file `.env` ke repository
- Gunakan wallet khusus untuk bot
- Pastikan jumlah MON yang di-swap sesuai dengan kemampuan wallet

## Troubleshooting

1. Error "Invalid private key"
   - Pastikan format private key benar
   - Private key harus dimulai dengan "0x"

2. Error "Insufficient funds"
   - Pastikan wallet memiliki cukup MON untuk gas fee
   - Perkiraan gas fee: 0.001 MON per transaksi

3. Error "Transaction failed"
   - Cek gas price di network
   - Pastikan slippage cukup (default 0.1%)

## Kontribusi

1. Fork repository
2. Buat branch baru (`git checkout -b feature/AmazingFeature`)
3. Commit perubahan (`git commit -m 'Add some AmazingFeature'`)
4. Push ke branch (`git push origin feature/AmazingFeature`)
5. Buat Pull Request

