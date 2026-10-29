# Bussveien – holdeplasskjerm (prototype)

Stående 16:9-skjerm (1080 × 1920, 32") for holdeplasser langs bussveien. Ren HTML/CSS/JS uten byggesteg.

## Kjøre

Åpne `index.html` i Chrome. Hvis nettleseren blokkerer kall fra `file://`, start en lokal server i mappen:

```bash
python3 -m http.server 8080
```

…og åpne http://localhost:8080.

Fullskjerm/kiosk på selve skjermen:

```bash
google-chrome --kiosk --app=http://localhost:8080
```

Scenen er alltid 1080 × 1920 og skaleres til vinduet, så den ser lik ut på en laptop og på skjermen.

## Snarveier

| Tast | Funksjon |
| --- | --- |
| `S` | Innstillinger (eller tannhjulet nede til høyre) |
| `E` | Rediger layout: dra bokser for å flytte, dra hjørnet for å endre størrelse |
| `T` | Simuler trafikkmelding av/på |
| `G` | Vis rutenett og prioritet på boksene |
| `1`–`4` | Oppsett 1–4 (Liste og trasé, Med klokke, Liste, Per rute) |
| `F` | Fullskjerm |

URL-parametre: `?quay=NSR:Quay:12345`, `?source=demo|entur|auto`, `?preset=skisse1|skisse2|skisse3`.

## Data

- **Entur Journey Planner v3** (GraphQL) for avganger, avvik (situations) og stoppmønster for trasélinjen.
  Geocoderen brukes til holdeplass-søket i innstillingene. Klientnavn: `bussveien-skjerm-prototype`.
- **Auto** (standard) prøver Entur og faller tilbake til demodata. «DEMO» vises i toppfeltet når demodata brukes.
- Demodataene er fiktive (linje 1 Sandnes og 2 Forus som deler seg etter Hinnasvingen), laget for å vise gaffelen.

## Bento-layout og prioritet

Rutenettet under toppfeltet er 12 kolonner × 20 rader. Hver infoboks har en liste med tillatte størrelser
(f.eks. Neste buss: 12×12, 12×10, 8×8). Layoutmotoren (`js/layout.js`) prøver alle kombinasjoner i prioritert
rekkefølge og velger den som

1. viser flest av de viktigste boksene,
2. gir de viktigste boksene størst plass,
3. etterlater færrest tomme ruter (bokser strekkes for å fylle hull).

En trafikkmelding er «må vises». Når den kommer, krymper andre bokser eller viker plass, og alt animeres.

Prioritet, av/på og tillatte størrelser endres i innstillingspanelet. I redigeringsmodus (`E`) kan boksene dras og skaleres direkte, med snapping til rutenettet. En egen layout lagres for kombinasjonen av synlige bokser, så layouten med og uten trafikkmelding kan settes hver for seg. «Tilbake til automatisk» fjerner den.

Fargemodus på linjene (Nøytral / Linjefarger / Dempet) og egne farger per linje stilles under Visning.

Trasé viser tre stopp hver vei pluss start- og endeholdeplass (stiplet linje når det er skjulte stopp imellom).
Stoppnavn kan stå rett eller skrått (45°). Boksen tegnes vertikalt når den er høyere enn den er bred,
f.eks. 4×20 langs hele høyre kant. Valgene lagres i nettleseren (localStorage).

## Filer

```
index.html
css/style.css
js/anim.js          fjær-easing, tekstbytte, FLIP-lister
js/layout.js        bento-layoutmotor
js/data.js          Entur + demodata
js/settings.js      innstillinger og panel
js/main.js          oppstart, skalering, layout-animasjon
js/widgets/*.js     infoboksene (hero, departures, routes, clock, traffic, line)
fonts/              Inter (variabel), lokalt
```

En ny infoboks legges til ved å registrere `BV.widgets.<id>` med `title`, `sizes`, `available()` og `create()`.
Se en av de eksisterende boksene.

## Publisert versjon

`python3 tools/build-artifact.py` samler alt i `dist/bussveien.html`, som publiseres som privat side på claude.ai.
Den siden kan ikke kalle Entur (nettleserens sikkerhetsregler for artifacts), så den viser alltid demodata.
Kjør lokalt for live Entur-data.

## Oppdateringer

Kjør `python3 tools/bump-version.py` før hver commit som skal ut. Det gir filene nye adresser (så nettlesere ikke viser gamle kopier), og skjermer som står åpne, laster seg selv på nytt innen ett minutt.
