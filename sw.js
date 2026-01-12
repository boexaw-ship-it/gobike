// sw.js (Minimal version)
self.addEventListener('install', (event) => {
  // Install လုပ်ချိန်မှာ ဘာမှမလုပ်ပါ
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Activate လုပ်ချိန်မှာလည်း ဘာမှမလုပ်ပါ
});

self.addEventListener('fetch', (event) => {
  // Network ကနေပဲ အမြဲတိုက်ရိုက်ယူမယ် (Offline မရပါ)
  return; 
});
