// İnternetsiz çalışma için servis çalışanı.
// - Sayfa, logolar ve QR kütüphanesi ilk açılışta telefona kaydedilir.
// - Açılan kartların şifreli dosyaları (k/*.json) her açılışta güncellenip saklanır.
// - Önce internet denenir (en güncel hal için); 3 sn içinde yanıt yoksa saklanan kopya kullanılır.
// Sayfada bir değişiklik yapınca SURUM'ü artır ki eski önbellek temizlensin.
const SURUM = "kartvizit-v2";
const QR_LIB = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
const TEMEL = ["./", "index.html", "cop31-logo.webp", "amblem.png", "vadaa.png", "manifest.webmanifest", QR_LIB];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SURUM).then((c) => c.addAll(TEMEL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((adlar) => Promise.all(adlar.filter((a) => a !== SURUM).map((a) => caches.delete(a))))
      .then(() => self.clients.claim())
  );
});

const bekle = (ms) => new Promise((tamam) => setTimeout(tamam, ms));

async function onceInternet(istek, anahtar) {
  const c = await caches.open(SURUM);
  const ag = fetch(istek, { cache: "no-store" }).then((yanit) => {
    if (yanit.ok) c.put(anahtar, yanit.clone());
    return yanit;
  });
  // 3 sn içinde internet yanıt verirse onu kullan
  const hizli = await Promise.race([ag.catch(() => null), bekle(3000).then(() => null)]);
  if (hizli) return hizli;
  // Yanıt gelmedi ya da internet yok: saklanan kopya varsa onu ver, yoksa interneti beklemeye devam et
  const kayitli = await c.match(anahtar);
  return kayitli || ag;
}

// Sayfa, servis çalışanı devreye girmeden önce açtığı kartın dosyasını buraya bildirir; o da saklanır
self.addEventListener("message", (e) => {
  const url = e.data && e.data.sakla;
  if (typeof url === "string" && /\/k\/[a-z0-9]+\.json$/.test(new URL(url).pathname)) {
    e.waitUntil(caches.open(SURUM).then((c) => c.add(url)).catch(() => {}));
  }
});

self.addEventListener("fetch", (e) => {
  const istek = e.request;
  if (istek.method !== "GET") return;
  const url = new URL(istek.url);
  const ayniSite = url.origin === self.location.origin;

  // Sayfanın kendisi (# kısmı sunucuya gitmez, hep aynı index.html)
  if (istek.mode === "navigate" && ayniSite) {
    e.respondWith(onceInternet(istek, "./"));
    return;
  }
  // Şifreli kart dosyaları
  if (ayniSite && /\/k\/[a-z0-9]+\.json$/.test(url.pathname)) {
    e.respondWith(onceInternet(istek, url.origin + url.pathname));
    return;
  }
  // Logolar, görseller, QR kütüphanesi: önce kayıtlı kopya
  if (ayniSite || istek.url === QR_LIB) {
    e.respondWith(caches.match(istek, { ignoreSearch: true }).then((k) => k || fetch(istek).then((y) => {
      if (y.ok) caches.open(SURUM).then((c) => c.put(istek, y.clone()));
      return y;
    })));
  }
});
