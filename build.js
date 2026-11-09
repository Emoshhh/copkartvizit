// Kartvizitleri şifreleyip docs/k/ klasörüne yazar ve herkesin linkini linkler.txt'ye çıkarır.
//
//   node build.js            → kisiler.json'dan kartları üret
//   node build.js geri-al    → docs/k/ içindeki şifreli kartlardan kisiler.json ve fotolar/'ı geri oluştur
//
// Okunabilir veriler (kisiler.json, fotolar/, .anahtar, linkler.txt) .gitignore'da: depoya hiç girmez.
// .anahtar dosyasını güvenli bir yere yedekle. O olmadan mevcut linkler yeniden üretilemez.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SITE = "https://cop31kartvizit.github.io/";

const ROOT = __dirname;
const KISILER = path.join(ROOT, "kisiler.json");
const FOTOLAR = path.join(ROOT, "fotolar");
const ANAHTAR = path.join(ROOT, ".anahtar");
const KLASOR = path.join(ROOT, "docs", "k");

const VARSAYILAN = {
  foto: "", unvan: { tr: "", en: "" }, kurum: "", kurumLogo: "", tanitim: { tr: "", en: "" },
  telefon: "", whatsapp: false, eposta: "", linkedin: "", web: "", instagram: "", x: "",
  vcardNot: "Met at COP31 Antalya"
};
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

const hata = (msg) => { console.error("HATA: " + msg); process.exit(1); };
const b64u = (buf) => Buffer.from(buf).toString("base64url");

function anaAnahtar() {
  if (!fs.existsSync(ANAHTAR)) {
    if (process.argv[2] === "geri-al") hata(".anahtar dosyası yok. Yedeğindeki .anahtar dosyasını bu klasöre koy.");
    fs.writeFileSync(ANAHTAR, b64u(crypto.randomBytes(32)) + "\n");
    console.log("! Yeni .anahtar oluşturuldu. Bu dosyayı güvenli bir yere YEDEKLE (ör. şifre yöneticisi).");
  }
  return Buffer.from(fs.readFileSync(ANAHTAR, "utf8").trim(), "base64url");
}
// Her kişinin anahtarı ana anahtardan türetilir: ana anahtar aynı kaldıkça linkler değişmez.
const kisiAnahtari = (ana, id) => crypto.createHmac("sha256", ana).update("kart:" + id).digest().subarray(0, 16);
// Numaralı/numarasız sayfaların dosya adı ve anahtarı da ana anahtardan türetilir (dışarıdan kişiyle ilişkilendirilemez).
const varyantId = (ana, id, v) => crypto.createHmac("sha256", ana).update(`dosya:${id}:${v}`).digest("hex").slice(0, 10);
const varyantAnahtari = (ana, id, v) => crypto.createHmac("sha256", ana).update(`kart:${id}:${v}`).digest().subarray(0, 16);

function sifrele(anahtar, veri) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-128-gcm", anahtar, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(veri), "utf8"), c.final(), c.getAuthTag()]);
  return { iv: b64u(iv), ct: b64u(ct) };
}
function coz(anahtar, { iv, ct }) {
  const buf = Buffer.from(ct, "base64url");
  const d = crypto.createDecipheriv("aes-128-gcm", anahtar, Buffer.from(iv, "base64url"));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString("utf8"));
}

function uret() {
  if (!fs.existsSync(KISILER)) hata("kisiler.json bulunamadı.");
  const ana = anaAnahtar();
  const kisiler = JSON.parse(fs.readFileSync(KISILER, "utf8"));
  let yeniId = false;
  const ids = new Set();
  const linkler = [];
  const yonetim = [];

  fs.rmSync(KLASOR, { recursive: true, force: true });
  fs.mkdirSync(KLASOR, { recursive: true });

  for (const kisi of kisiler) {
    if (!kisi.ad || !kisi.soyad) hata(`Ad ve soyad zorunlu: ${JSON.stringify(kisi)}`);
    if (!kisi.id) { kisi.id = crypto.randomBytes(5).toString("hex"); yeniId = true; }
    if (!/^[a-z0-9]+$/.test(kisi.id)) hata(`Geçersiz id: "${kisi.id}"`);
    if (ids.has(kisi.id)) hata(`Aynı id iki kez kullanılmış: "${kisi.id}"`);
    ids.add(kisi.id);

    const { id, ...bilgi } = kisi;
    const kart = { ...VARSAYILAN, ...bilgi };
    if (kart.foto) {
      const dosya = path.join(FOTOLAR, kart.foto);
      if (!fs.existsSync(dosya)) hata(`Fotoğraf bulunamadı: fotolar/${kart.foto}`);
      const mime = MIME[path.extname(dosya).toLowerCase()] || hata(`Desteklenmeyen fotoğraf türü: ${kart.foto} (jpg, png, webp)`);
      const veri = fs.readFileSync(dosya);
      if (veri.length > 400 * 1024) console.log(`! ${kart.foto} ${Math.round(veri.length / 1024)} KB. Kart daha hızlı açılsın diye 400 KB altına küçült.`);
      kart.fotoDosya = kart.foto;
      kart.foto = `data:${mime};base64,${veri.toString("base64")}`;
    }
    if (kart.kurumLogo) {
      const dosya = path.join(FOTOLAR, kart.kurumLogo);
      if (!fs.existsSync(dosya)) hata(`Kurum logosu bulunamadı: fotolar/${kart.kurumLogo}`);
      const mime = MIME[path.extname(dosya).toLowerCase()] || hata(`Desteklenmeyen logo türü: ${kart.kurumLogo} (jpg, png, webp)`);
      kart.kurumLogoDosya = kart.kurumLogo;
      kart.kurumLogo = `data:${mime};base64,${fs.readFileSync(dosya).toString("base64")}`;
    }

    // Her kişi için 3 sayfa, her biri ayrı dosya ve ayrı anahtarla:
    //   sahip → "Senin sayfan" (sadece kişinin kendisinde; numaralı/numarasız QR butonları burada)
    //   tam   → karşı tarafın gördüğü, telefonlu
    //   kisa  → karşı tarafın gördüğü, telefonsuz
    const yaz = (dosyaId, anahtar, veri) => {
      fs.writeFileSync(path.join(KLASOR, `${dosyaId}.json`), JSON.stringify({ v: 1, ...sifrele(anahtar, veri) }));
      return `${dosyaId}.${b64u(anahtar)}`;
    };
    const { fotoDosya, kurumLogoDosya, ...paylasilan } = kart;
    const tam = yaz(varyantId(ana, id, "tam"), varyantAnahtari(ana, id, "tam"), { ...paylasilan, mod: "paylasim" });
    const kisa = yaz(varyantId(ana, id, "kisa"), varyantAnahtari(ana, id, "kisa"),
      { ...paylasilan, telefon: "", whatsapp: false, mod: "paylasim" });
    const sahip = yaz(id, kisiAnahtari(ana, id), { ...kart, mod: "sahip", paylas: { tam, kisa } });

    linkler.push(`${kart.ad} ${kart.soyad}\n` +
      `  Senin sayfan (sadece kişiye gönder): ${SITE}#${sahip}\n` +
      `  Numaralı kart:  ${SITE}#${tam}\n` +
      `  Numarasız kart: ${SITE}#${kisa}\n`);
    yonetim.push({ ad: kart.ad, soyad: kart.soyad, unvan: kart.unvan, sahip });
    console.log(`✓ ${kart.ad} ${kart.soyad}`);
  }

  // Yönetici sayfası: herkesin "Senin sayfan" linki tek listede (sadece yöneticide; ayrı dosya, ayrı anahtar)
  const yId = varyantId(ana, "yonetim", "liste"), yAnahtar = varyantAnahtari(ana, "yonetim", "liste");
  fs.writeFileSync(path.join(KLASOR, `${yId}.json`), JSON.stringify({ v: 1, ...sifrele(yAnahtar, { mod: "yonetim", kisiler: yonetim }) }));
  linkler.unshift(`YÖNETİCİ SAYFASI (herkesin linki burada, SADECE SENDE kalsın):\n  ${SITE}#${yId}.${b64u(yAnahtar)}\n`);

  if (yeniId) fs.writeFileSync(KISILER, JSON.stringify(kisiler, null, 2) + "\n");
  fs.writeFileSync(path.join(ROOT, "linkler.txt"), linkler.join("\n"));
  console.log(`${kisiler.length} kişi × 3 sayfa şifrelendi → docs/k/   Linkler → linkler.txt`);
}

function geriAl() {
  const ana = anaAnahtar();
  if (fs.existsSync(KISILER)) hata("kisiler.json zaten var. Üzerine yazmamak için önce adını değiştir.");
  fs.mkdirSync(FOTOLAR, { recursive: true });
  const kisiler = fs.readdirSync(KLASOR).filter((f) => f.endsWith(".json")).flatMap((f) => {
    const id = path.basename(f, ".json");
    let kart;
    // Sadece "Senin sayfan" dosyaları kişinin kendi id'siyle açılır; numaralı/numarasız kopyalar atlanır.
    try { kart = coz(kisiAnahtari(ana, id), JSON.parse(fs.readFileSync(path.join(KLASOR, f), "utf8"))); } catch (e) { return []; }
    if (kart.mod !== "sahip") return [];
    delete kart.mod; delete kart.paylas;
    if (kart.foto && kart.fotoDosya) {
      fs.writeFileSync(path.join(FOTOLAR, kart.fotoDosya), Buffer.from(kart.foto.split(",")[1], "base64"));
      kart.foto = kart.fotoDosya;
    }
    delete kart.fotoDosya;
    if (kart.kurumLogo && kart.kurumLogoDosya) {
      fs.writeFileSync(path.join(FOTOLAR, kart.kurumLogoDosya), Buffer.from(kart.kurumLogo.split(",")[1], "base64"));
      kart.kurumLogo = kart.kurumLogoDosya;
    }
    delete kart.kurumLogoDosya;
    return [{ id, ...kart }];
  });
  fs.writeFileSync(KISILER, JSON.stringify(kisiler, null, 2) + "\n");
  console.log(`${kisiler.length} kişi geri alındı → kisiler.json`);
}

process.argv[2] === "geri-al" ? geriAl() : uret();
