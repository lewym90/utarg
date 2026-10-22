# Utarg

Prosta aplikacja do codziennego zapisywania utargu sklepu. Działa na iPhonie, Androidzie i komputerze, instaluje się jak zwykła aplikacja (ikona na pulpicie), działa bez internetu i po każdym wpisie wysyła kopię danych do prywatnego repozytorium GitHub.

## Co potrafi

- **Dziś**: duże pole na kwotę, przycisk „Zapisz utarg” i przycisk „Zamknięte” dla dni bez sprzedaży. Pod spodem suma miesiąca i roku oraz ostatnie wpisy.
- **Miesiąc**: lista wszystkich dni miesiąca (28–31) z kwotami i **sumą miesiąca**. Suma liczy się na bieżąco, więc nie zależy od wpisu w ostatnim dniu.
- **Rok**: 12 miesięcy w układzie tabeli (dni w wierszach, miesiące w kolumnach) z sumami miesięcznymi i **sumą roczną**, albo lista miesięcy z wykresem.
- **Dni bez wpisu**: aplikacja ostrzega o pominiętych dniach. Dzień, w którym sklep był zamknięty, oznacza się jednym dotknięciem („Zamknięte”, liczy się jako 0,00 zł). W Ustawieniach można zaznaczyć stałe dni wolne (np. niedziela), wtedy nie ma żadnych przypomnień.
- **Bezpieczeństwo danych**: zapis na urządzeniu (podwójny), kopia w GitHub po każdym wpisie, możliwość cofnięcia ostatniej zmiany, ostrzeżenie przy podejrzanie dużej kwocie (literówka), ręczny eksport JSON i CSV.
- Wszystko po polsku, jasny i ciemny motyw (automatycznie lub ręcznie, zapamiętywany).

## Uruchomienie i publikacja

Aplikacja to zwykłe pliki (HTML, CSS, JavaScript), bez budowania i bez zależności.

### Podgląd na swoim komputerze

```
node tools/serve.js
```

Otwórz http://localhost:8080.

### Publikacja na GitHub Pages

1. Utwórz na GitHubie repozytorium (np. `utarg`) i wgraj do niego wszystkie pliki z tego folderu (bez `node_modules`).
2. W repozytorium wejdź w **Settings → Pages**, w „Build and deployment” wybierz **Deploy from a branch**, gałąź `main` i folder `/ (root)`.
3. Po minucie aplikacja jest dostępna pod adresem `https://TWOJ-LOGIN.github.io/utarg/`.

> Repozytorium z **kodem aplikacji** może być publiczne (nie ma w nim żadnych danych klienta). GitHub Pages dla repozytoriów prywatnych wymaga płatnego planu.

### Nowa wersja

Po zmianach w kodzie zwiększ numer w `sw.js` (`VERSION`) i w `js/app.js` (`APP_VERSION`). Aplikacje na urządzeniach same pobiorą nową wersję, gdy mają internet.

## Instalacja na urządzeniu klienta

| Urządzenie | Jak zainstalować |
| --- | --- |
| iPhone / iPad | Otwórz adres w **Safari** → przycisk Udostępnij → **Do ekranu początkowego** |
| Android | Chrome → menu (⋮) → **Zainstaluj aplikację** (albo „Dodaj do ekranu głównego”) |
| Komputer (Chrome, Edge) | Ikona instalacji w pasku adresu albo Ustawienia → Zainstaluj aplikację |

## Kopia bezpieczeństwa w GitHub (ważne)

Dane klienta trafiają do **osobnego, prywatnego** repozytorium, a nie do repozytorium z kodem. Jednorazowa konfiguracja (najlepiej na koncie klienta, żeby dane należały do niego):

1. Utwórz repozytorium, np. `utarg-dane`. Wybierz **Private** i zaznacz „Add a README file”.
2. Wejdź na https://github.com/settings/personal-access-tokens/new i utwórz token:
   - „Repository access” → **Only select repositories** → wybierz tylko `utarg-dane`,
   - „Repository permissions” → **Contents: Read and write**,
   - ustaw długi czas ważności.
3. W aplikacji: **Ustawienia → Kopia bezpieczeństwa w GitHub**, wpisz `login/utarg-dane` i wklej token, a potem „Połącz i wyślij kopię”.
4. Na drugim urządzeniu zrób to samo (ten sam token i repozytorium). Dane zsynchronizują się same.

### Wariant testowy: jedno repozytorium publiczne (kod i dane razem)

Do własnych testów można użyć jednego, publicznego repozytorium na kod i na dane. Pamiętaj o konsekwencjach: **każdy w internecie zobaczy kwoty i historię zmian**, a token z uprawnieniem „Contents: Read and write” pozwalałby zmienić także kod aplikacji. Do prawdziwej firmy użyj osobnego, prywatnego repozytorium na dane.

1. Utwórz w repozytorium z aplikacją osobną gałąź na dane: lista gałęzi → wpisz `dane` → „Create branch”. Dzięki temu kopie nie uruchamiają ponownego budowania strony (GitHub Pages publikuje tylko gałąź `main`).
2. Utwórz token ograniczony do tego jednego repozytorium (Contents: Read and write).
3. W aplikacji: Ustawienia → Kopia bezpieczeństwa: wpisz `login/utarg`, wklej token, w polu „Gałąź na dane” wpisz `dane`. Aplikacja zapyta o zgodę na publiczne repozytorium.

Jak to działa:

- Po każdym wpisie aplikacja scala dane z GitHub i z urządzenia (dla każdego dnia wygrywa nowszy wpis) i wysyła plik `utarg-dane.json`. Każda zmiana to osobny commit, więc w historii repozytorium można odzyskać dowolną wcześniejszą wersję.
- Gdy aplikacja jest otwarta, co minutę sprawdza w tle, czy ktoś inny (np. drugie urządzenie) nie dopisał danych, i dołącza je bez żadnych kliknięć. Przy powrocie do aplikacji sprawdza też od razu.
- Bez internetu wpisy zostają na urządzeniu, a kopia wysyłana jest automatycznie, gdy połączenie wróci. Stan widać w pasku „Kopia zapisana / czeka na wysłanie”.
- Aplikacja **odmawia** połączenia z repozytorium publicznym.
- Token jest przechowywany tylko na urządzeniu i wysyłany wyłącznie do `api.github.com`. Ma dostęp tylko do jednego repozytorium, więc w razie zgubienia telefonu wystarczy go unieważnić na GitHubie.

## Dlaczego liczenie jest bezbłędne

- Wszystkie kwoty to **liczby całkowite w groszach** (żadnych ułamków, więc żadnych błędów zaokrągleń typu 0,1 + 0,2).
- Sumy miesięczne i roczne są zawsze **wyliczane z wpisów**, nigdy wpisywane ręcznie.
- Pole kwoty odrzuca niejednoznaczne zapisy (np. `1.234`) zamiast zgadywać.
- Testy automatyczne (`npm install`, potem `npm test`) sprawdzają m.in. lata przestępne, miesiące po 28–31 dni, sumy na losowych danych względem niezależnego liczenia, scalanie danych z kilku urządzeń, kopię na atrapie GitHuba oraz obsługę interfejsu.

## Struktura

```
index.html            szkielet aplikacji
css/style.css         wygląd (jasny/ciemny motyw)
js/core.js            logika: kwoty, daty, sumy, scalanie danych (bez DOM, testowana)
js/store.js           zapis na urządzeniu (localStorage + IndexedDB)
js/sync.js            kopia i synchronizacja z GitHub
js/app.js             interfejs
sw.js                 tryb offline
manifest.webmanifest  instalacja jako aplikacja
icons/                ikony
tests/                testy automatyczne
tools/serve.js        lokalny serwer podglądu
```

## Dobre praktyki dla klienta

- Raz w miesiącu pobrać plik kopii (Ustawienia → Pobierz kopię) i zachować go w innym miejscu, np. w poczcie.
- Nie czyścić danych witryny w przeglądarce i nie odinstalowywać aplikacji, zanim kopia nie będzie widoczna jako „zapisana”. Dane i tak są w GitHub, ale warto to sprawdzić.
- Aplikacja polega na zegarze urządzenia: data i godzina na telefonie i komputerze powinny być ustawione automatycznie.
