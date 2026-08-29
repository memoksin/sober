# SOBER v1 — Monorepo playbook

Kesin hüküm: monorepo nasıl üretilir, yönetilir, sürdürülür. Tek kişi, part-time,
junior, yanında AI ajanlar. `BUILD-PLAN.md`'yi tekrar etmez; onu uygular ve dört
yerde düzeltir. Düzeltmeler **→ ADR** ile işaretli: `BUILD-PLAN.md` bağlayıcı olduğu
için orada değişiklik senin ADR'inle olur, bu dosyayla olmaz.

Dayanak: v0'ın ölçülmüş tarihi (`REVIEW-2026-08-29.md §2.1`), 201 commit / 11 takvim
günü / zirve günde 45 commit.

---

## 1. v0 nasıl patladı — tempo açısından

v0'ın sorunu yavaşlık değildi. 11 günde 201 commit, 9 aktif günde ortalama 22
commit/gün. Bu insan temposu değil, ajan temposu. Review kapasitesi ajanların
üretimine yetişmedi; kod okunmadan indi; kurallar prose'da kaldı; son gün üç ajan
aynı dosyayı düzenledi.

Hüküm: **v1'de hız sınırı ajan değil, senin okuyabildiğin diff miktarıdır.**
Günde okuyup anlayabildiğinden fazla kod üretilmez. Bu tek cümle bu dosyanın geri
kalanını belirler.

---

## 2. Üretim: sıra

### 2.1 Sıralı mı, paralel mi

**Phase 0–5 sıralı. Phase içi en fazla 2 paralel ajan, üç koşul sağlanırsa**
(`BUILD-PLAN.md §5`): arayüz merge edilmiş bir dosyada var, dosya kümeleri kesişmiyor
ve barrel içermiyor, iki diff'i bugün okuyabiliyorsun.

Paket bazında:

| Phase | Paket | Mod | Paralel olabilecek tek şey |
|---|---|---|---|
| 0 | skeleton, CI, fixture | solo | CI YAML ↔ Biome/turbo config (farklı dosyalar) |
| 1 | `schema` | solo | hiçbir şey — kayıt şekli tek elden |
| 2 | `core` | solo | `status.ts` testleri ↔ `git/worktree.ts` (modül oluştuktan sonra) |
| 3 | `cli`, `mcp`, plugin, adapter | solo | bağımsız CLI alt komutları ↔ bağımsız MCP tool'ları |
| 4 | sync, contributors, PR | solo | hiçbir şey — merge kodu tek elden |
| 5 | `server`, `dashboard` | solo | bağımsız dashboard bileşenleri (layout senden) |
| 6 | diğer host adapter'ları | paralel | her adapter kendi dizininde |

"Solo" = tek ajan veya sen. "Paralel" = 2 ajan, tavan 2. Tavan phase 6'ya kadar
kalkmaz; kalkma koşulu `BUILD-PLAN.md:151` ("son dört ajan diff'ini satır satır okudum").

### 2.2 Her fazın kapısı

Kapı geçilmeden sonraki faz başlamaz. Kapı bir cümle değil, çalıştırılabilir bir şeydir.

| Phase | Kapı |
|---|---|
| 0 | 6 check boş repoda yeşil **ve** biri kasten kırmızı görüldü |
| 1 | `schema` M1 alanlarıyla dolu, snapshot testi var, `core` henüz yok |
| 2 | Integration harness gerçek repoda yeşil: worktree aç/kapat, status türet, brief render, archive |
| 3 | `BUILD-PLAN.md §3`'teki 9 adım gerçek bir repoda elle yürütüldü — M1 |
| 4 | İki klon, bir board, alan-seviyesi çakışma çözüldü, bozuk graph push edilemedi — M2 |
| 5 | 9 adım terminal açmadan — M3 |

---

## 3. Üretim: hız

### 3.1 Takvim — düzeltilmiş → ADR

`BUILD-PLAN.md §4` "focused day" ile ölçüyor ve M1'i 21–29 gün diyor. İki düzeltme:

1. **Phase 0 ve 2 junior için uzar.** Bundling/CI hataları "okuma bloğu" değil "debug
   spirali" olur; ilk gerçek merge çakışmasını elle çözmek bir tam gün alır.
2. **Phase 5 kısalır.** Dashboard 42.696 satır değildi, 8.892 satırdı
   (`REVIEW-2026-08-29.md §2.1`). 14–20 gün tahmini yanlış rakama dayanıyor.

| Phase | BUILD-PLAN | Bu dosya | Neden |
|---|---|---|---|
| 0 | 3–4 | **5–7** | packaging + fixture + ilk CI kırmızısı |
| 1 | 2–3 | 2–3 | — |
| 2 | 8–11 | **11–15** | git plumbing; ilk conflict günü |
| 3 | 8–11 | 8–11 | — |
| **M1** | 21–29 | **26–36** | |
| 4 | 8–12 | 8–12 | — |
| 5 | 14–20 | **10–14** | doğru rakam, ekran kes |
| **v1** | 43–61 | **44–62** | toplam aynı, dağılım farklı |

Haftada 4 focused day ile M1 **7–9 hafta**, v1 **11–16 hafta**.

### 3.2 Günlük tavan

- Günde en fazla **2 ajan çalışması**: 2 acceptance listesi yazılır, 2 check sonucu okunur (ADR 0022). Üçüncüsü yarına kalır.
- Bir PR **400 satırı** geçemez (test hariç). Geçiyorsa node yanlış bölünmüş; böl.
- Günün son 30 dakikası kod yazmaz: yarının node'unu ve acceptance listesini yazar.

### 3.3 Takıldım → yükselt kuralı

`BUILD-PLAN.md`'de yok. Ekleniyor:

**Aynı hata üzerinde 2 saat (sen + ajan toplam) ilerleme yoksa dur.** Sorunu üç
cümlede yaz: ne bekledin, ne oldu, ne denedin. Sonra sırayla:
1. Aynı problemi çözen açık kaynak bir repo bul (`gh search code`), yaklaşımı oku.
2. Mimari bir soruysa ADR taslağı aç, kodu bırak.
3. Araç sorunuysa (esbuild, pnpm, git) resmi dokümanı baştan oku, hafızadan değil.

Bu kural git plumbing (phase 2, 4) ve packaging (phase 0) için **1 saat**.

---

## 4. Devretme haritası

İlke `BUILD-PLAN.md §6`'dan: spesifikasyon senin, yazım ajanın. Ajan, kendi
değerlendiremeyeceğin bir şey üretiyorsa devretme.

Dört kip: **Ver** (diff'i review edersin, yaklaşımı değil) · **Eşle** (ajan yazar,
sen her adımı okur ve yönlendirirsin) · **Sen** (ajan sadece soru cevaplar) ·
**Önce oku** (saat).

| Phase | Ver | Eşle | Sen | Önce oku |
|---|---|---|---|---|
| 0 | `biome.json`, `turbo.json`, `.dependency-cruiser.cjs`, CI YAML, Changesets, commitlint, Renovate config | **esbuild bundle script + publint + smoke test** (BUILD-PLAN "Ver" diyor → ADR; ADR 0007'nin caveat'leri yüzünden eşle) · coverage ratchet script'i · integration fixture | branch protection, CODEOWNERS, `tsconfig.base.json` | npm packaging 3 s · `git help worktree` 2 s |
| 1 | Zod şemaları (kayıt şekli senden) · snapshot testi | — | kayıt şeklini kâğıda yaz | status modeli kâğıtta 2 s |
| 2 | status türetme, brief render, archive, run log, testler (acceptance listesi senden) | **`git/worktree.ts`, `git/merge.ts`, dosya kilidi, atomik yazma** (BUILD-PLAN "solo" diyor → ADR; ilk kez eşle) | storage layout, hata sınıfları, `core/index.ts` | `merge=binary`, `:1:/:2:/:3:` 4 s — **bir çakışmayı elle çöz, bitmeden phase 2'ye girme** |
| 3 | CLI arg parse, help, çıktı formatı · MCP tool'ları (ilk 2'den sonra) · plugin dosyaları · secretlint entegrasyonu | **ilk 2 MCP tool + elicitation** · adapter (`claude -p` invocation) | tool listesi ve her tool'un sözleşmesi · `sober stop` mekanizması | MCP elicitation 3 s · Claude Code headless doc, implementasyon günü, 2 s |
| 4 | contributors.json, claim, same-files uyarısı, draft PR açma | **field-level 3-way merge · post-merge validation** | çakışma sorusunun şekli | `git help merge`, `git help attributes` tekrar 2 s |
| 5 | wire contract'tan HTTP handler'lar · bileşenler (layout senden) · digest | graph library spike'ından sonra canvas | wire contract'ı `schema`'ya yazmak · hangi ekranın kesileceği | Cytoscape vs sigma spike 1 gün |

**Asla devretme** (`BUILD-PLAN.md §6`): ADR kabulü, `SCOPE.md`/`CHARTER.md`/`BUILD-PLAN.md`
değişikliği, kayıt şekli, "done" tanımı. Ek: **barrel dosyalar ve `docs/`** ajan
PR'ına girmez — CODEOWNERS bunu zorunlu review'a bağlar.

---

## 5. Yönetim: repo mekaniği

`STRUCTURE.md` araçları sayıyor. Eksik olan mekanikler, phase 0'da:

| Mekanik | Ne | Neden |
|---|---|---|
| `workspace:*` | tüm iç bağımlılıklar | caret aralık yok, "hangi cli hangi core'a karşı test edildi" sorusu olmaz |
| `pnpm-workspace.yaml` `catalog:` | tüm dış bağımlılık sürümleri tek yerde | `vitest`/`zod`/`typescript` sürüm sürüklenmesi olmaz |
| `syncpack` | CI'da catalog denetimi | haftalık temizliğe ekle |
| tsconfig `composite: true` + `tsc -b` | typecheck kapısı | project references bunsuz çalışmaz |
| `turbo.json` `dependsOn: ["^build"]` | build sırası | schema → core → cli |
| `turbo run --affected` | PR'da sadece etkilenen paket | CI süresi paket sayısıyla büyümesin |
| Turbo cache (GH Actions cache) | tekrar eden build/test | 3 OS × 6 check — cache'siz 20 dk |
| `pnpm dedupe --check` | CI | lockfile şişmesi |
| CODEOWNERS | `packages/*/index.ts`, `docs/`, `.github/` | barrel ve doküman kuralı otomatik |
| Renovate, gruplu, haftalık | tek PR | 10 ayrı PR junior'ı boğar |
| `vitest.config.ts` + `test.projects` | `vitest.workspace.ts` yerine | Vitest 4'te kaldırıldı |
| `tsconfig.base.json` | `module: NodeNext`, `verbatimModuleSyntax`, `isolatedModules`, `strict`, `noUncheckedIndexedAccess` | ESM-only, açıkça |

---

## 6. Sürdürme

`BUILD-PLAN.md §7`'nin beş ratchet'i kalır. Üç ekleme:

**6.1 Ritim**

| Ne zaman | Ne | Süre |
|---|---|---|
| Her gün | yarının node'u + acceptance listesi | 30 dk |
| Her hafta | `knip`, `depcheck`, `syncpack`, Renovate PR'ı | 30 dk |
| Her hafta | bir aydan eski her `ponytail:`/`TODO` okunur, ya kapanır ya ADR olur | 15 dk |
| Her faz kapısı | changeset'ler toplanır, sürüm kesilir, CHANGELOG okunur | 1 saat |
| M1, M2, M3 | `npm publish` — M1'de `0.x`, M3'te `1.0.0` | — |

**6.2 Sayısal tavanlar** — ratchet değil, alarm

- `core` export sayısı > 60 → CI warning, ADR ister.
- `apps/dashboard` satır sayısı > 1.5 × `packages/core` → dur, ekran kes. v0'ın gerçek oranı 0.67'ydi; 1.5 ekranın core'u geçmeye başladığı yer.
- Bir faz, tahmininin 1.5 katını geçti → faz kapısını yeniden yaz, devam etme.

**6.3 Sürüm kesme**

Changesets ile. `cli` tek yayınlanan paket, `fixed` grup gerekmez. Sürüm kesme
sadece faz kapılarında; ara kesim yok. Her kesim `--provenance` ile.

---

## 7. Phase 0 — ilk 5 gün, gün gün

`STRUCTURE.md`'nin 11 adımı, güne bölünmüş. Kendi başına: **REVIEW-2026-08-29 §5
"Must" listesi bitmeden bu başlamaz.**

| Gün | İş | Kip |
|---|---|---|
| 1 | `create-turbo`, layout, `packageManager`/`engines` pin, `tsconfig.base.json`, `catalog:`, Biome, commitlint, Changesets, CODEOWNERS | Ver + Sen |
| 2 | dependency-cruiser 4 kural, `turbo.json`, `vitest.config.ts` projects, coverage ratchet script'i | Ver + Eşle |
| 3 | esbuild bundle script, publint, pack-install smoke, `secretlint`, `.gitattributes` | **Eşle** — önce 3 saat packaging oku |
| 4 | integration fixture: temp repo + bare remote + commit/push testi; CI YAML, 3 OS | Eşle + Ver |
| 5 | branch protection, Renovate, ratchet'i kasten kır (tip hatası PR'ı → kırmızı), düzelt | Sen |

Gün 5 akşamı: 6 check yeşil, biri kırmızı görülmüş. Phase 1 başlar.

---

## 8. Bu dosyanın BUILD-PLAN ile çeliştiği yerler → ADR

1. §3.1 tempo tablosu (phase 0/2 uzar, 5 kısalır).
2. §3.3 takıldım → yükselt kuralı (yeni).
3. §4 esbuild/publint "Ver" → "Eşle"; phase 2 git kodu "solo" → "Eşle".
4. §6.2 sayısal tavanlar (yeni ratchet değil, alarm).

Dördü tek ADR oldu: **ADR 0023**, kabul edildi 2026-08-29. `BUILD-PLAN.md` §4,
§5, §6, §7 buna göre düzeltildi. Bu dosya artık BUILD-PLAN ile çelişmez.

Review birimi de değişti: diff değil, check sonuçları (ADR 0022). §3.2'deki
"günde 2 diff" → "günde 2 acceptance listesi yazıp 2 check sonucu okumak".
