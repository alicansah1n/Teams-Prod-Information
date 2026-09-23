# Teams Prod Information

Canlı çıkış yapıldıktan sonra tek komutla:

1. Jira Cloud'daki seçilen release'in (örn. *Özel Entegratörlük → 2026.09.1*) içindeki **To be Deployed** maddelerini **Completed** yapar,
2. her maddeye "Bu madde 23.09.2026 14:30 tarihinde 2026.09.1 sürümü ile canlıya alınmıştır." yorumunu ekler,
3. release'i **Released** yapar ve **Release Date**'i canlı çıkış tarihiyle günceller,
4. Teams kanalına şu mesajı gönderir:
   > ✅ **Özel Entegratörlük** paketindeki **2026.09.1** sürümü **23.09.2026 14:30** tarihinde canlıya çıkılmıştır.

Hiçbir şey değiştirilmeden önce **önizleme** gösterilir ve **onay** istenir.

---

## 1. Kurulum (bir kez)

**Gereksinim:** Node.js 20 veya üstü (`node -v`).

```powershell
cd C:\...\Teams-Prod-Information
npm install
copy .env.example .env
```

`.env` dosyasını doldurun:

| Değişken | Açıklama |
|---|---|
| `JIRA_BASE_URL` | `https://sirketiniz.atlassian.net` |
| `JIRA_EMAIL` | API token'ın sahibi olan Atlassian hesabı (tercihen teknik/ortak kullanıcı) |
| `JIRA_API_TOKEN` | Aşağıdaki adımla oluşturulan token |
| `TEAMS_WEBHOOK_URL` | Aşağıdaki adımla oluşturulan Teams Workflows adresi |
| `TZ_NAME` | Varsayılan `Europe/Istanbul` |
| `TRIGGERED_BY` | Teams mesajında "Tetikleyen" olarak görünecek isim (boşsa Windows kullanıcı adı) |

> `.env` gizli bilgiler içerir; paylaşmayın, git'e eklemeyin (`.gitignore`'da zaten var).

### Jira API token
1. https://id.atlassian.com/manage-profile/security/api-tokens → **Create API token**.
2. Token'ın ait olduğu kullanıcının ilgili projede şu yetkileri olmalı:
   - *Browse Projects*, *Transition Issues*, *Add Comments*
   - Release'i Released yapmak için *Administer Projects* (proje yöneticisi rolü)

### Teams kanal webhook'u (admin onayı gerekmez)
1. Bildirimin gideceği Teams **kanalında**, kanal adının yanındaki **⋯** → **Workflows**.
2. **"Post to a channel when a webhook request is received"** şablonunu seçin.
3. Akışa bir ad verin, Team ve Kanal'ı seçip **Add workflow** deyin.
4. Oluşan URL'yi kopyalayıp `.env` → `TEAMS_WEBHOOK_URL` alanına yapıştırın.

> Workflow onu oluşturan kişinin hesabına bağlıdır; kişi ayrılırsa akış durur. Mümkünse ortak bir hesapla oluşturun.
> URL'yi bilen herkes kanala mesaj atabilir, gizli tutun.

### Proje ayarları — `config/releases.config.json`

```json
{
  "defaults": {
    "sourceStatus": "To be Deployed",
    "targetStatus": "Completed",
    "transitionFields": {},
    "addComment": true,
    "commentTemplate": "Bu madde {date} {time} tarihinde {version} sürümü ile canlıya alınmıştır.",
    "appendTimeToVersionDescription": true
  },
  "projects": {
    "OZE": {
      "displayName": "Özel Entegratörlük",
      "transitionFields": { "resolution": { "name": "Done" } }
    }
  }
}
```

- `projects` anahtarı **Jira proje anahtarıdır** (issue numaralarındaki ön ek, örn. `OZE-10566` → `OZE`).
- `displayName`: Teams mesajındaki "paket" adı. Boşsa Jira proje adı kullanılır.
- Proje bazında `defaults` içindeki her alan ezilebilir.
- `sourceStatusId` / `targetStatusId`: Statü adları farklı dillerde/benzer isimlerde ise ID ile kesin eşleşme (ID'ler `doctor` çıktısında görünür).
- `transitionFields`: Completed geçişinde zorunlu bir alan varsa (örn. Resolution): `{ "resolution": { "name": "Done" } }`.
- `appendTimeToVersionDescription`: Jira release tarihi saat tutmadığı için saati release açıklamasına `Canlı çıkış: 23.09.2026 14:30` olarak yazar.

### Kontrol

```powershell
npm run doctor                 # Jira bağlantısı, yetkiler, statüler
npm run doctor -- --teams-test # + Teams kanalına test mesajı
```

---

## 2. Kullanım

### En kolayı
`scripts\run-release.bat` dosyasına çift tıklayın → release'i listeden seçin → önizlemeyi kontrol edin → onaylayın.

Listede her release'in yanında bir işaret, sağda da üzerinde durduğunuz release'in **bilgi kartı** (statü dağılımı, uygun olup olmadığı) görünür:

| İşaret | Anlamı |
|---|---|
| `✔ 5 bekliyor` | Uygun: 5 madde To be Deployed, kalanlar Completed |
| `✔ hepsi tamam` | Uygun: tüm maddeler zaten Completed, release sadece kapatılır ve bildirilir |
| `✖ 3 farklı statü` | Uygun değil: 3 madde başka statüde (Test, Coding…) |
| `✖ madde yok` | Uygun değil: release'te hiç madde yok |

Uygun olmayan release'ler de seçilip önizlemesi görülebilir, ama işlem başlatılamaz. ↑↓ ile gezilir, Enter ile seçilir; harf yazarak adı öyle başlayan release'e atlanabilir.

### Komut satırından

```powershell
# Bekleyen release'leri gör
npm run versions -- -p OZE

# Interaktif
npm run release

# Önce sadece önizleme (hiçbir şey değişmez)
npm run release -- -p OZE -v "2026.09.1" --dry-run

# Uygula (saat verilmezse "şimdi" kullanılır)
npm run release -- -p OZE -v "2026.09.1" -d "2026-09-23 14:30"
```

| Seçenek | Anlamı |
|---|---|
| `-p, --project` | Jira proje anahtarı (config'te tek proje varsa gerekmez) |
| `-v, --version` | Release adı (verilmezse listeden seçilir) |
| `-d, --date` | Canlı çıkış zamanı: `2026-09-23 14:30` veya `23.09.2026 14:30` |
| `--dry-run` | Sadece önizleme |
| `-y, --yes` | Onay sormadan çalıştır (Jenkins vb. otomasyon için) |
| `--no-comment` | Maddelere yorum ekleme |
| `--no-notify` | Teams'e mesaj gönderme |
| `--release-with-errors` | Hatalı madde olsa bile release'i Released yap |

### Önizlemede ne görürsünüz
- ✔ **Completed yapılacaklar** ve kullanılacak Jira geçişi
- • **Zaten Completed** olanlar (dokunulmaz)
- ✖ **Başka statüdekiler** (örn. Test, Coding) → **işlem yapılmaz**
- ✖ **Geçirilemeyecekler** (Completed'a doğrudan geçiş yok veya zorunlu alan eksik) → **işlem yapılmaz**

---

## 3. Davranış kuralları

| Release'teki maddeler | Sonuç |
|---|---|
| To be Deployed + Completed | ✔ To be Deployed olanlar Completed yapılır, release kapatılır, Teams'e bildirilir |
| Hepsi To be Deployed | ✔ Hepsi Completed yapılır, release kapatılır, bildirilir |
| Hepsi Completed | ✔ Madde değişmez; release kapatılır (zaten kapalıysa dokunulmaz), bildirilir |
| En az 1 madde farklı statüde | ✖ Hiçbir şey yapılmaz |
| Hiç madde yok | ✖ Hiçbir şey yapılmaz |

- **Ya hep ya hiç:** ✖ durumlarında ve Completed'a geçirilemeyen bir To be Deployed maddesi varsa **hiçbir şey değiştirilmez**, onay bile sorulmaz. `--yes` ile de aşılamaz.
- Sadece statüsü **tam olarak** `To be Deployed` olan maddeler Completed yapılır.
- Önizleme ile onay arasında biri Jira'da bir maddenin statüsünü değiştirirse ya da release'e madde ekler/çıkarırsa, işlem başlamadan bu fark edilir ve **hiçbir şey yapılmaz**.
- Bazı statülerin engel olmamasını isterseniz (örn. iptal edilmiş maddeler) config'te belirtin: `"allowedStatuses": ["Canceled"]`. Bu maddelere dokunulmaz.
- Geçiş, adına göre değil **hedef statüye** göre bulunur; workflow'daki geçiş adı değişse de çalışır.
- Onaydan sonra Jira bir maddeyi reddederse (örn. yetki hatası) diğerleri işlenir, ama release **Released yapılmaz** ve Teams'e ⚠️ "Kontrol Gerekli" kartı gider. Sorun giderildikten sonra komutu tekrar çalıştırmanız yeterli.
- **Tekrar çalıştırmak güvenlidir:** tamamlanmış maddeler ve kapalı release atlanır (Teams bildirimi yine gönderilir).
- Jira'nın istek limitine (HTTP 429) takılırsa beklenip otomatik tekrar denenir.
- Her çalıştırma `logs/` altına JSON olarak kaydedilir (ne planlandı, ne yapıldı, bildirim gitti mi).
- Teams'e mesaj gidemezse Jira işlemi geri alınmaz; ekranda yazan komutla tekrar gönderilir:
  ```powershell
  npm run notify -- --log "logs\20260923-143012-OZE-2026.09.1.json"
  ```

**Çıkış kodları:** `0` başarılı · `1` hata/ayar sorunu · `2` kısmen tamamlandı (kontrol gerekli) · `3` release uygun değil, hiçbir şey yapılmadı · `130` kullanıcı iptal etti.

---

## 4. Sorun giderme

| Mesaj | Çözüm |
|---|---|
| `Kimlik doğrulama başarısız` | `JIRA_EMAIL` ve `JIRA_API_TOKEN` eşleşmiyor veya token iptal edilmiş |
| `Bu işlem için Jira yetkiniz yok` | Token sahibine gerekli proje yetkilerini verin (`npm run doctor`) |
| `"Completed" statüsüne doğrudan geçiş yok` | Workflow'da To be Deployed → Completed geçişi yok; workflow'u veya `targetStatus`'u kontrol edin |
| `Geçiş için zorunlu alan(lar) eksik` | Config'te `transitionFields` ile değer verin |
| `The value 'To be Deployed' does not exist for the field 'status'` | Statü adı Jira'dakinden farklı; `doctor` çıktısındaki adı/ID'yi config'e yazın |
| Teams `HTTP 400/404` | Webhook URL yanlış veya Workflow silinmiş/kapalı |

---

## 5. Geliştirici notları

```
src/
  cli.ts, cli/          komutlar, önizleme ve sonuç çıktıları
  core/releaseService   plan() → hiçbir şeyi değiştirmez · execute() → uygular
  jira/                 Jira Cloud REST v3 istemcisi (retry, sayfalama) ve uç noktalar
  teams/                Adaptive Card şablonları ve Workflows webhook gönderimi
tests/                  sahte Jira/Teams ile uçtan uca senaryolar
```

```powershell
npm test          # testler
npm run typecheck # tip kontrolü
```

`ReleaseService` tetikleyiciden bağımsızdır; ileride bir Jenkins job'u (`npm run release -- -p OZE -v "$VERSION" --yes`) veya Teams bot'u aynı çekirdeği kullanabilir.
