# Finance Manager — Manuale utente

> Webapp self-hosted per la gestione della contabilità famigliare.
> Multi-utente, conti personali e condivisi, dashboard, chat con AI locale.
> Funziona anche da telefono come app installabile (PWA).

---

## Indice

1. [Cosa puoi fare](#1-cosa-puoi-fare)
2. [Primo accesso](#2-primo-accesso)
3. [Invitare altri utenti](#3-invitare-altri-utenti)
4. [Conti correnti, contanti e carte](#4-conti-correnti-contanti-e-carte)
5. [Condividere un conto](#5-condividere-un-conto)
6. [Categorie](#6-categorie)
7. [Movimenti (entrate, uscite, giroconti)](#7-movimenti)
8. [Allegati a un movimento](#8-allegati)
9. [Carte di credito (addebito differito)](#9-carte-di-credito)
10. [Movimenti ricorrenti](#10-movimenti-ricorrenti)
11. [Budget mensili](#11-budget-mensili)
12. [Obiettivi di risparmio](#12-obiettivi-di-risparmio)
13. [Dashboard](#13-dashboard)
14. [Report e confronti](#14-report-e-confronti)
15. [Chat con l'AI](#15-chat-con-lai)
16. [Importare un estratto conto (CSV / OFX)](#16-importare-un-estratto-conto)
17. [Collegamento banca (sincronizzazione automatica)](#17-collegamento-banca)
18. [Modelli AI (Ollama)](#18-modelli-ai-ollama)
19. [Impostazioni](#19-impostazioni)
20. [Configurazione email (SMTP, solo admin)](#20-smtp-solo-admin)
21. [Backup e ripristino (solo admin)](#21-backup-e-ripristino-solo-admin)
22. [Installare l'app sul telefono](#22-installare-lapp-sul-telefono)
23. [Domande frequenti](#23-faq)

---

## 1. Cosa puoi fare

Finance Manager è la tua **dashboard finanziaria di famiglia**. Con un singolo
account o invitando altri membri puoi:

- Tenere traccia di **conti correnti, contanti, carte di credito**
- Registrare **entrate, uscite e giroconti** tra conti
- Categorizzare ogni movimento e allegare **scontrini, ricevute, PDF**
- Vedere a colpo d'occhio l'andamento dei tuoi soldi sulla **Dashboard**
- Generare **report mensili/annuali** e **confrontare due periodi**
- Definire **budget per categoria** e **obiettivi di risparmio**
- Automatizzare i movimenti **ricorrenti** (stipendio, affitto, abbonamenti)
- Chiedere consigli a un'**AI locale** che vede solo i tuoi dati
- Importare **estratti conto in CSV o OFX** dalla banca, oppure **collegare
  direttamente il conto** per uno scarico automatico ogni notte
- **Condividere conti** con altri membri della famiglia
- Funziona sul telefono come **app installabile**

Niente lascia il tuo server: l'AI gira in locale, gli allegati sono sul tuo
storage, le email partono dal tuo SMTP.

---

## 2. Primo accesso

Se hai installato il software, l'amministratore (admin) viene creato
automaticamente al primo avvio con le credenziali che hai impostato nel file
`.env` (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`).

1. Apri il browser su `http://localhost/` (o sul dominio dove è installato).
2. Inserisci email e password dell'admin.
3. Sei dentro!

> 💡 **Cambia subito la password** in *Impostazioni → Cambia password*.

### Account "admin" vs account "user"

- **Admin**: può invitare nuovi utenti, configurare SMTP, fare backup/ripristino.
- **User**: gestisce i propri conti, categorie, budget, obiettivi e movimenti.

Tutti gli altri possono comunque fare praticamente tutto sui propri dati,
solo le funzioni "di sistema" (inviti, SMTP, backup) sono riservate all'admin.

### Hai dimenticato la password?

Sulla pagina di login c'è il link **"Password dimenticata?"**:

1. Inserisci la tua email
2. Ricevi un link di reset (richiede SMTP configurato — sezione 20)
3. Il link è valido **1 ora** ed è monouso
4. Clicca, scegli una nuova password, e sei subito loggato

Se l'admin non ha ancora configurato SMTP, il link viene loggato sul
backend e va copiato manualmente all'utente (`docker compose logs backend`).

---

## 3. Invitare altri utenti

Solo l'admin può creare nuovi account, e lo fa **per invito** (non c'è
registrazione libera, per protezione).

1. Vai in **Impostazioni** (in alto a destra c'è il logout, ma per le
   impostazioni clicca su *Impostazioni* nella sidebar / bottom nav).
2. Crea un invito tramite l'endpoint admin (al momento l'azione è nelle
   pagine di amministrazione: vedi *FAQ* per i dettagli).
3. Il sistema invia un'email contenente un link `/accept-invite?token=...`
   valido **48 ore**. Se non hai ancora configurato SMTP (vedi sezione 20)
   il link viene comunque generato e l'admin può copiarlo a mano.
4. L'invitato apre il link, sceglie nome completo e password, e l'account
   viene creato.

> 💡 La sicurezza: gli inviti scadono dopo 48h e ogni nuovo invito invalida
> i precedenti per la stessa email. Se l'admin sospetta che un link sia stato
> rubato basta inviarne uno nuovo.

---

## 4. Conti correnti, contanti e carte

In **Conti** vedi tutti i conti che gestisci o a cui sei stato invitato.

### Creare un conto

Pulsante **+ Nuovo conto**. Devi scegliere:

- **Nome**: es. "Conto Intesa", "Contanti", "Carta Revolut"
- **Tipo**:
  - *Conto corrente*
  - *Carta di credito* (vedi sezione 9)
  - *Contanti*
- **Saldo iniziale**: il saldo di partenza in euro. Tutto in euro.
- **Colore** e **icona** (opzionali, solo per l'estetica)

### Modificare o archiviare

- **Modifica**: puoi cambiare nome, colore, icona. Il tipo non si cambia
  (se sbagli, archivialo e creane uno nuovo).
- **Archivia**: il conto sparisce dall'elenco ma i movimenti storici restano
  nei report. Solo il proprietario può archiviare.

---

## 5. Condividere un conto

Se hai un conto cointestato con il partner, puoi condividerlo:

1. Sulla card del conto clicca **Condividi**.
2. Cerca l'utente per email o nome (deve già essere registrato sul sistema:
   se manca, l'admin deve prima invitarlo).
3. Scegli il livello di permesso:
   - **Solo lettura**: vede saldo e movimenti ma non può modificare
   - **Scrittura**: può aggiungere/modificare/cancellare movimenti
4. Clicca *Aggiungi*. L'altro utente vedrà subito il conto nei suoi.

In qualsiasi momento puoi cambiare il ruolo o rimuovere un membro. Il
**proprietario** del conto sei sempre tu (chi l'ha creato).

> 💡 Quando un movimento è creato/modificato in un conto condiviso, il
> sistema registra **chi** ha fatto l'azione nell'audit log.

---

## 6. Categorie

> 🎨 **Riallinea al tema**: il pulsante in alto nella pagina Categorie assegna a
> ogni categoria principale un colore della palette dell'app, e le
> sottocategorie prendono il colore della categoria padre. Serve quando i colori
> si sono accumulati nel tempo e stonano tra loro. Chiede conferma, perché
> riscrive i colori di **tutte** le categorie e quelli attuali non tornano
> indietro. Se vuoi cambiare un colore singolo, la palette dell'app è comunque
> la prima cosa che trovi aprendo il selettore colore.

Le categorie servono a etichettare i movimenti e poi a fare report e budget.

Vai in **Categorie**:

- Lista divisa in due colonne: **Uscite** e **Entrate**, ordinate
  alfabeticamente (parent → figli alfabetici al loro interno).
- **+ Nuova categoria**: nome, colore, icona, tipo (entrata/uscita), opzionale
  categoria padre per creare una gerarchia di max 2 livelli (es. *Casa →
  Bollette → Luce* non si può, ma *Casa → Bollette* sì).
- **Palette estesa**: scegli tra 50+ colori predefiniti per distinguere
  bene anche tante categorie a colpo d'occhio.

### Sottocategorie e colore

- Quando crei una sottocategoria, il colore del **padre** è proposto come
  default (puoi sovrascriverlo prima di salvare).
- Quando **modifichi il colore di un padre**, il sistema chiede se vuoi
  propagare il nuovo colore anche a tutte le sue sottocategorie. Utile se
  cambi il "tema" cromatico di un blocco (es. ricolori "Casa" da blu a
  verde e tutte le bollette/condominio si aggiornano in blocco).
- Le sottocategorie con colore già personalizzato vengono toccate solo se
  confermi la propagazione.

### Condivisione

- Le categorie sono **personali**: ogni utente ha le sue, non si condividono
  in generale.
- **Eccezione**: quando un conto viene condiviso con un altro utente, le
  categorie usate sui movimenti di quel conto vengono propagate al
  destinatario (creazione automatica se mancanti) così i report condivisi
  restano coerenti.

> 💡 Quando importi un CSV/OFX l'AI suggerisce automaticamente la categoria
> (vedi sezione 16).

---

## 7. Movimenti

In **Movimenti** vedi la lista cronologica di tutto. Filtri disponibili:

- Cerca per descrizione/note
- Filtra per conto, categoria, intervallo di date

### Aggiungere un movimento

**+ Nuovo movimento**, scegli prima il **tipo**:

- **Uscita**: importo in negativo (escono soldi dal conto)
- **Entrata**: importo in positivo (entrano soldi)
- **Giroconto**: trasferisci da un conto a un altro

Compila:

- **Conto** (sorgente per i giroconti)
- **Importo** in euro
- **Data**
- **Categoria** (per entrate e uscite)
- **Descrizione** e **Note** (facoltative)

### Giroconti

Quando scegli *Giroconto*, compaiono due campi extra:

- **Conto destinazione**: tra quelli che gestisci
- **Data arrivo** (opzionale): se la valuta arriva in un giorno diverso da
  quando parte (utile per bonifici programmati).
- **Categoria** (opzionale): puoi etichettare anche i giroconti — utile per
  esempio per marcare "Risparmio" o "Pagamento carta". Resta comunque
  escluso dai totali entrate/uscite nei report.

Cosa succede sotto il cofano:

> Il sistema crea **due movimenti collegati**: uscita di -X€ sul conto
> sorgente alla data di partenza, entrata di +X€ sul conto destinazione alla
> data di arrivo, **entrambi con la stessa categoria** se l'hai
> specificata. Se cancelli uno dei due, **viene cancellato anche l'altro
> automaticamente** (operazione coordinata). I saldi di entrambi i conti
> vengono aggiornati in tempo reale.

### Modificare o cancellare

Dalla lista, sulle righe usa l'icona matita o cestino. La modifica di un
movimento aggiorna automaticamente il saldo del conto. La cancellazione di
un giroconto coordina la cancellazione su entrambi i lati.

---

## 8. Allegati

Per ogni movimento puoi allegare scontrini e documenti:

- **Formati supportati**: PNG, JPG, WebP, GIF, PDF
- **Dimensione max**: 10 MB per file
- **Quanti**: nessun limite di numero per movimento

### Caricare

Puoi allegare file **sia in fase di creazione del movimento** sia
modificandolo dopo. Nella modale del movimento c'è una zona "trascina file
qui": puoi selezionarne anche più di uno alla volta, il caricamento è
asincrono e parte solo dopo che il movimento è stato creato/salvato.

### Eliminare

L'icona cestino sull'allegato chiede sempre **conferma esplicita** prima
di rimuoverlo (l'eliminazione è irreversibile).

### Anteprima

Sulla riga di ciascun allegato c'è un'icona **occhio**: cliccandola si apre
una finestra:

- **Immagini**: anteprima inline a schermo intero
- **PDF**: visualizzato in un viewer interno

Le anteprime usano URL temporanei firmati che durano 15 minuti, quindi non
serve fare login di nuovo per vederli.

---

## 9. Carte di credito

Le carte di credito hanno un comportamento speciale: quando spendi, il
denaro non esce subito dal conto corrente — esce alla **data di addebito**
(tipicamente il 15 del mese successivo).

### Configurare una carta

Crea un nuovo conto, scegli tipo *Carta di credito*, poi imposta:

- **Conto di pagamento**: il conto corrente da cui verranno addebitate le
  spese (es. il tuo "Intesa")
- **Giorno di addebito**: tipicamente 15

### Cosa succede quando spendi sulla carta

Esempio: il **3 maggio 2026** fai una spesa di 50€ sulla carta:

1. Sul conto **Carta** vedi subito un movimento -50€ in data 3 maggio.
2. Sul **Conto di pagamento** appare **automaticamente** un addebito di
   -50€ in data **15 giugno 2026**, etichettato come "Addebito CdC: …"
3. Quel movimento è marcato come **pending** (in attesa) — non viene contato
   nel saldo finché non arriva la data del 15 giugno.
4. La notte del 15 giugno il sistema "salda" l'addebito: rimuove il pending
   e lo scala dal saldo del conto corrente.

### Modificare o cancellare una spesa carta

- Se modifichi importo o data della spesa, il sistema **propaga
  automaticamente** la modifica all'addebito futuro corrispondente.
- Se cancelli una spesa **prima** che venga addebitata, sparisce anche
  l'addebito futuro (nessun impatto sul conto corrente).
- Se cancelli una spesa **dopo** l'addebito, il sistema annulla l'effetto
  sul saldo del conto corrente.

---

## 10. Movimenti ricorrenti

In **Ricorrenze** automatizzi i movimenti che si ripetono (stipendio,
affitto, Netflix, …).

### Creare una regola

**+ Nuova**, imposta:

- **Tipo**: *entrata*, *uscita* o **giroconto** (con conto sorgente +
  conto destinazione, come per i movimenti normali)
- **Conto**, **Importo**, **Categoria** (opzionale anche per i giroconti)
- **Frequenza**: giornaliera, settimanale, quindicinale, mensile, trimestrale, annuale
- **Inizio** (data) e **Fine** opzionale (lascia vuoto per durata illimitata)
- **Descrizione**

Le ricorrenze esistenti sono **modificabili**: clicca sulla matita per
cambiare importo, frequenza, date, categoria, ecc. La modifica vale per le
generazioni future, non riscrive quelle già emesse.

### Come funziona — esecuzione automatica

Un cron server-side gira **ogni notte alle 01:00**: trova tutte le regole
attive con `prossima esecuzione ≤ oggi` e genera automaticamente le
transazioni (e aggiorna i saldi). Se una regola è "indietro" (es. server
spento per qualche giorno), la run la esegue **N volte** finché torna in
pari — non perdi nessuna occorrenza.

Se attivi una regola con data inizio nel passato, alla prima esecuzione il
sistema crea retroattivamente tutti i movimenti arretrati in un colpo solo.

> 💡 Caveat: il cron parte solo se il container `backend` è in esecuzione
> alle 01:00. Se la macchina era spenta, le regole vengono comunque
> processate alla **successiva** run notturna (oppure subito con "Esegui
> ora"). Niente occorrenze perse.

### Sospendere / riprendere / cancellare

Ogni regola ha bottoni *Sospendi* (mette in pausa la generazione), *Riprendi*,
*Elimina* (con conferma). C'è anche **Esegui ora** in alto per forzare
manualmente la generazione di tutto ciò che è dovuto in questo momento —
utile per testare o se non vuoi aspettare la run notturna.

> 💡 Le ricorrenze su **carta di credito** generano automaticamente anche
> l'addebito futuro sul conto di pagamento. Le ricorrenze di tipo
> **giroconto** creano la coppia di movimenti collegati su entrambi i conti.

---

## 11. Budget mensili

In **Budget** definisci un tetto di spesa mensile per categoria.

### Creare un budget

Scegli il mese in alto, poi **+ Nuovo**: scegli categoria e importo limite.

### Cosa vedi

Per ogni budget c'è una card con:

- **Speso del mese** / Limite (es. 145,30 € / 200,00 €)
- **Barra di avanzamento** colorata:
  - Verde: stai sotto l'80%
  - Arancione: tra l'80% e il 99%
  - Rosso: hai sforato

Lo "speso" si calcola in tempo reale aggregando le uscite della categoria
nel mese sui conti a cui hai accesso.

> 💡 I budget sono **personali**: anche se condividi un conto, ognuno ha i
> propri budget.

---

## 12. Obiettivi di risparmio

In **Obiettivi** definisci dei goal (es. "Vacanze 3000€ entro agosto").

### Creare un obiettivo

**+ Nuovo**:

- **Nome** dell'obiettivo
- **Importo target**
- **Già accantonato** (se parti da zero, lascia 0)
- **Scadenza** (opzionale)
- **Conto di riferimento** (opzionale, solo informativo)

### Aggiornare il progresso

Per ora l'aggiornamento è **manuale**: clicchi *Modifica* e aggiorni il campo
"già accantonato". Quando lo raggiungi, premi *Completa* e l'obiettivo si
chiude (ma resta visibile come "Completato").

---

## 13. Dashboard

La pagina iniziale dopo il login mostra:

### KPI in cima

Tre card grandi: **Entrate**, **Uscite**, **Netto** del periodo selezionato.

Le card **Entrate** e **Uscite** sono **cliccabili**: scelgono cosa mostra la
card "per categoria" più sotto (torta + lista delle categorie). Cliccando
*Entrate* vedi le entrate divise per categoria, cliccando *Uscite* torni alle
spese (la vista predefinita). La card selezionata è evidenziata da un bordo
colorato. In entrambi i casi valgono i filtri in alto: conti, periodo e
categorie.

### Filtri di periodo

In alto a destra:

- Preset rapidi: **7g**, **30g**, **90g**, **YTD** (year-to-date)
- Date custom da/a per intervalli arbitrari

### Grafici

- **Andamento patrimonio**: area chart del saldo cumulativo nel periodo
- **Spese / Entrate per categoria**: pie chart con i colori delle categorie e
  lista con gli importi sotto; il verso (spese o entrate) si sceglie cliccando
  le card KPI in cima. Il selettore **Padre / Sottocategorie** decide se
  aggregare per categoria padre o mostrare il dettaglio dei figli
- **Entrate vs uscite**: bar chart per giornata

### Ultime operazioni

Lista degli ultimi 10 movimenti, con tono colorato (verde entrate, rosso
uscite, grigio giroconti).

---

## 14. Report e confronti

Pagina **Report**, tre modalità (menu in alto a destra) più il filtro conti.

> 💡 In tutte le modalità le voci **Entrate** e **Uscite** sono **cliccabili**:
> scelgono se le categorie mostrate sotto (lista "Top categorie" o torta) sono
> quelle delle entrate o quelle delle spese. Di default vedi le spese. La voce
> selezionata è evidenziata, e vale anche per il drill-down: aprendo una
> categoria vedi i movimenti di quel verso.

### Riepilogo annuale

- Scegli l'anno
- Vedi totali entrate/uscite/netto dell'intero anno
- Bar chart con i 12 mesi affiancati
- Lista delle **top categorie** con percentuale e barra: clicca una categoria
  per aprire le sottocategorie e poi i singoli movimenti

### Riepilogo mensile

Come l'annuale ma su un singolo mese (anno + mese), con il bar chart
giornaliero al posto di quello dei 12 mesi.

### Report dell'assistente

Nel riepilogo **annuale** e in quello **mensile**, sotto i totali, trovi una
card con un commento scritto dall'AI sul periodo che stai guardando: sintesi,
andamento, dove sono finiti i soldi, cosa l'ha colpita e qualche consiglio.

- Si scrive **da solo** la prima volta che apri un periodo, e resta salvato: se
  torni su quel periodo lo ritrovi già pronto, senza attese.
- Mentre lo sta scrivendo vedi l'animazione di caricamento e il tempo trascorso.
  Il pulsante resta **disabilitato** finché non ha finito, anche se esci dalla
  pagina e rientri (o apri l'app da un altro dispositivo).
- Il pulsante **Rigenera** lo riscrive da capo: chiede conferma, perché il
  report precedente viene sovrascritto e non è più recuperabile.
- Se aggiungi o modifichi movimenti del periodo, compare l'avviso "i movimenti
  sono cambiati dopo la generazione": rigeneralo tu quando vuoi.
- Sotto al titolo trovi sempre **da quale modello è stato scritto** (es.
  "Generato il 31/08 alle 09:12 · OpenCode · deepseek-v4-flash").
- Se il modello in cloud non è disponibile o ha esaurito il credito, il report
  lo scrive comunque il **modello locale** e accanto al nome compare
  *(riserva)*. Vale anche per la chat, che in quel caso te lo dice sotto la
  risposta, e per i suggerimenti di categoria negli import.
- Se non risponde nessuno dei due, la card mostra l'errore invece di restare in
  attesa.

### Confronto periodi

Imposta due intervalli di date arbitrari (es. *Aprile vs Maggio*, *2025 vs
2026*) e confrontali side-by-side:

- Totali per ogni periodo (clicca *Entrate* o *Uscite* per cambiare il verso
  delle torte di **entrambi** i periodi, così il confronto resta omogeneo)
- Pie chart delle categorie per ogni periodo
- **Delta**: differenza assoluta + percentuale colorata (verde se aumentato
  per le entrate / diminuito per le uscite, rosso il contrario)

> 💡 I giroconti sono **esclusi** dai totali (sono trasferimenti interni,
> non rappresentano denaro entrante/uscente).

---

## 15. Chat con l'AI

In **Chat** trovi un assistente AI (Ollama, in locale) che ha accesso ai tuoi
dati ma non può vedere quelli di altri utenti.

### Cosa puoi chiedergli

Esempi pratici:

- *"Quanto ho speso questo mese in totale?"*
- *"Quali sono le mie 3 categorie con più uscite negli ultimi 30 giorni?"*
- *"Confronta le mie spese di questo mese con il mese scorso."*
- *"Dammi 3 consigli per ridurre le spese fisse."*
- *"Sto rispettando i miei budget?"*
- *"In quale mese ho speso di più nel 2026?"*

### Come funziona

L'AI usa "tool" per leggere i tuoi dati reali quando serve (saldi conti,
totali periodi, categorie, budget). **Non inventa cifre**: se ti dà un
numero, l'ha letto dal database. La risposta arriva token-per-token (come
ChatGPT) per non farti aspettare.

Mentre lavora, sopra la risposta vedi un indicatore che ti dice cosa sta
facendo ("sto pensando…", "sto consultando le tue transazioni…") con un
cronometro: la chat non sembra mai "ferma". Se qualcosa va storto, compare
un messaggio chiaro con il motivo dell'errore.

### Sessioni

A sinistra hai l'elenco delle conversazioni precedenti. Si auto-titolano
dal primo messaggio. Puoi crearne di nuove o cancellarle.

> 💡 **Privacy**: la chat **non** chiama servizi esterni. Tutto gira sul
> tuo server. I dati di altri utenti sono fisicamente irraggiungibili
> dall'AI: il backend inietta sempre il tuo `userId` nelle query.

---

## 16. Importare un estratto conto

Se la tua banca esporta movimenti in CSV o OFX, puoi caricare il file.

### Procedura

1. Vai in **Importa**
2. Scegli il **conto di destinazione**
3. Trascina il file (o cliccalo). Formati: `.csv`, `.ofx`, `.qfx`. Max 5 MB.
4. Il sistema parsa il file, deduplica contro i movimenti già presenti, e
   chiede all'**AI locale** di suggerire una categoria per ogni riga.
5. Si apre la **schermata di review**: una tabella con tutte le righe
   importate, una checkbox per ciascuna, e la categoria suggerita
   modificabile.
6. Spunta/togli ciò che vuoi importare, eventualmente cambia categoria,
   poi premi **Importa N**. Il sistema crea le transazioni e aggiorna i saldi.

### Cosa riconosce

Il parser CSV gestisce header in italiano e inglese (`data`, `descrizione`,
`importo`, `addebito`/`accredito`, `causale`, `memo`, `narration`...) e
formato importi italiano (`1.234,56`).

I duplicati (stessa data + importo + descrizione) sono evidenziati con un
badge **Possibile duplicato** e di default deselezionati.

---

## 17. Collegamento banca

Oltre all'import manuale di CSV/OFX (sezione 16), puoi collegare direttamente
il conto corrente alla tua banca: i movimenti vengono scaricati da soli ogni
notte, categorizzati da un'AI e proposti in una coda di revisione prima di
diventare movimenti veri.

### Cosa serve

- Un **account gratuito su enablebanking.com** (a carico dell'admin
  dell'installazione, non di ogni utente): registrazione self-service, "modalità
  personale" per collegare i propri conti, nessun contratto commerciale.
- L'admin registra un'**applicazione** nel Control Panel di Enable Banking:
  ottiene un **Application ID** e scarica una volta sola una **chiave privata
  RS256 (.pem)**.
- L'admin inserisce questi due valori in **Impostazioni → Credenziali Enable
  Banking** (sezione admin-only). Una volta configurate, **tutti gli utenti**
  possono collegare le proprie banche: ogni utente gestisce solo i propri
  collegamenti.

> 💡 La chiave privata non è mai più visibile dopo il salvataggio (è cifrata
> nel database): se la perdi, rigenerala dal portale Enable Banking e
> reinseriscila.

### Collegare una banca

1. In **Impostazioni → Collegamenti bancari**, premi **+ Collega banca**.
2. **Cerca la tua banca** nell'elenco (logo + nome).
3. Premi **Apri il sito della banca**: si apre una nuova scheda dove accedi
   con le tue credenziali bancarie e confermi l'accesso **in sola lettura**.
   La finestra del wizard resta aperta e controlla da sola quando hai finito
   (nessun bisogno di incollare codici).
4. **Nota iPhone**: sull'app installata (PWA) l'autorizzazione si apre in
   **Safari**, fuori dall'app. È normale: completa il consenso in Safari e poi
   torna a Finance Manager, il wizard si aggiorna automaticamente (o riaprilo
   dall'app se lo avevi chiuso — il collegamento resta comunque salvato "in
   attesa").
5. **Abbina i conti**: la banca ti restituisce i conti che hai autorizzato;
   per ciascuno scegli se collegarlo a un conto Finance Manager già esistente
   o crearne uno nuovo (oppure "non collegare"). Vengono proposti solo i tuoi
   **conti correnti** in EUR non già collegati a un'altra banca.
6. Premi **Collega N conti**. Fatto: la prima sincronizzazione parte da sola
   in background.

### Sincronizzazione

- **Automatica**: ogni notte alle **06:00** il sistema scarica i movimenti
  nuovi di tutti i collegamenti attivi.
- **Manuale**: dalla card del collegamento c'è **"Sincronizza ora"** (su
  tutti i conti collegati o su un singolo conto). Limite: **4 sincronizzazioni
  manuali al giorno per utente** (è un limite imposto anche dalle banche
  stesse); superato il limite, il pulsante avvisa e bisogna aspettare il giorno
  dopo — il sync automatico notturno continua comunque a funzionare.
- Ogni sync mostra un riepilogo: quanti movimenti nuovi, quanti duplicati
  scartati, eventuali valute non gestite.

### Pagina "Da confermare"

I movimenti scaricati dalla banca **non diventano subito veri movimenti**:
finiscono in una coda di revisione, raggiungibile dal menu **"Da confermare"**
(anche dal badge sulla card del collegamento e dalla notifica in campanella).

Per ogni riga:

- Un'**AI locale** (la stessa dell'import CSV, sezione 16) propone una
  categoria, modificabile prima di confermare.
- Le **coppie di giroconto** (es. bonifico da un conto collegato a un altro
  conto collegato) vengono riconosciute automaticamente e mostrate come riga
  unica con la freccia "Conto A → Conto B"; puoi accoppiare o separare a mano
  se il sistema non è sicuro.
- I **probabili duplicati** (un movimento che sembra già inserito a mano)
  finiscono in una sezione a parte, non confermabili finché non li ripristini
  tu esplicitamente.
- Puoi selezionare più righe insieme (barra di azioni in fondo allo schermo,
  ottimizzata anche per il pollice su telefono) e **confermare in blocco**:
  le righe selezionate diventano movimenti reali (o giroconti, per le coppie),
  con saldo dei conti aggiornato.

### Rinnovo del consenso

Le banche richiedono di **rinnovare l'autorizzazione periodicamente**, in
genere ogni **~90 giorni** (la durata esatta dipende dalla banca). Ricevi una
**notifica circa 7 giorni prima** della scadenza; se il consenso scade senza
rinnovo, la sincronizzazione di quel collegamento si ferma finché non lo
rinnovi.

Per rinnovare: dalla card del collegamento premi **Rinnova**, ripeti
l'autorizzazione sul sito della banca come al primo collegamento. I conti
vengono **ri-agganciati automaticamente tramite IBAN** — non devi rifare il
mapping. Se un conto non viene ritrovato, resta in pausa e va ricollegato a
mano.

### Riconciliazione saldi

Sulla card di ogni conto collegato vedi anche il **saldo dichiarato dalla
banca** (rilevato all'ultima sincronizzazione) a confronto con il saldo
calcolato da Finance Manager. Se combaciano vedi un segno di spunta; se ci
sono differenze, vedi l'importo dello scostamento — utile per accorgerti di
un movimento mancante o inserito due volte a mano.

### Limiti

- Si collegano solo **conti correnti** (niente carte di credito o conti in
  valuta diversa dall'euro in questa versione).
- **Un solo consenso attivo per banca**: molte banche italiane non permettono
  due autorizzazioni contemporanee per lo stesso istituto — un nuovo
  consenso (es. il rinnovo) sostituisce automaticamente il precedente.
- Se la tua banca non è ancora supportata, resta disponibile l'import
  manuale CSV/OFX (sezione 16).

> 💡 **Sicurezza**: il consenso che dai alla banca è di **sola lettura**
> (accesso "AIS", solo consultazione movimenti e saldi). Nessuna operazione
> di pagamento è possibile tramite questo collegamento, né da Finance Manager
> né in caso di compromissione del server: la banca stessa non accetterebbe
> un ordine di pagamento senza un consenso separato con doppia
> autenticazione, che questa integrazione non richiede né supporta.

---

## 18. Modelli AI (Ollama)

L'AI (usata per la chat, sezione 15, e per suggerire le categorie nell'import
CSV/OFX e nella coda "Da confermare") può usare **due provider**, scelti
dall'admin in **Impostazioni → Modello AI**:

- **Ollama (locale)** — il modello gira sul tuo server, con il modello scelto
  dall'admin. Sezione dedicata qui sotto.
- **OpenCode (cloud)** — usa un **modello su internet** con la tua **API key**
  OpenCode (Zen o Go). Alla prima configurazione la chiave viene verificata e
  la **tipologia viene rilevata da sola** (Zen o Go, forzabile a mano con il
  selettore "Tipologia"): i modelli mostrati sono quelli della tua tipologia
  di chiave, con **costo** (dollari per 1 milione di token) e **qualità**
  accanto a ciascuno. La chiave è cifrata e non viene mai mostrata per intero.
  Con OpenCode attivo **non è necessario che Ollama sia in esecuzione**: se è
  spento, chat e categorizzazione continuano a funzionare.

### Ollama (locale)

- **Modello attivo**: mostrato in cima alla card, con lo stato del server
  Ollama (raggiungibile o no).
- **Modelli installati**: elenco con dimensione su disco; puoi impostarne uno
  come attivo ("Usa questo") o eliminarlo (non è possibile eliminare quello
  attivo).
- **Catalogo modelli disponibili**: lista curata di modelli compatibili
  (dimensione di download, RAM richiesta, descrizione). Premi **Scarica** per
  avviare il download: prosegue **sul server** anche se chiudi la pagina o
  l'app (utile da telefono, dove la scheda del browser può "morire" in
  background), con una barra di avanzamento in tempo reale. Un download alla
  volta.
- I modelli più pesanti mostrano un avviso se superano il limite di RAM del
  container (8 GB) o se ci si avvicinano.

> 💡 Cambiare modello ha effetto sia sulla **chat** sia sulla
> **categorizzazione automatica** (import CSV/OFX e sync bancario): un
> modello più grande è in genere più preciso ma più lento e più pesante in
> RAM. Download e cambio modello sono riservati agli amministratori; tutti
> gli utenti vedono qual è il modello attivo.

---

## 19. Impostazioni

Pagina **Impostazioni** (icona ingranaggio nella nav).

Le sezioni sono **comprimibili ed espandibili**: tocca il titolo di una
sezione per aprirla o chiuderla (la tua scelta viene ricordata). Anche da
chiusa, accanto al titolo vedi lo stato di configurazione (es. "Configurato",
"OpenCode Go connesso"); i valori sensibili (chiavi API, password) non vengono
mai mostrati in chiaro, solo mascherati.

### Profilo

Cambia il tuo **nome completo** visibile agli altri membri condivisi.

### Aspetto

- **Tema**: chiaro, scuro, automatico (segue il sistema)
- **Lingua**: italiano o inglese (cambia immediatamente, persistito)
- **Tema cromatico**: scelta tra varianti (default, glass, ecc.) per
  cambiare la palette di accenti senza toccare chiaro/scuro
- **Font dei numeri**: scegli il font usato per gli importi (sans
  classico, mono per allineamento perfetto, ecc.)
- **Modalità privacy**: oscura tutti gli importi nella UI con pallini —
  utile se condividi lo schermo o sei in pubblico. Toggle veloce.

### Modalità Demo

In *Impostazioni* trovi un toggle **Modalità Demo**:

- **ON**: l'app mostra dati realistici simulati (conti, movimenti,
  budget, ecc.) **senza mai toccare il tuo database reale**. Le mutation
  (crea/modifica/elimina) vengono ignorate sul backend e ritornano una
  risposta finta. Utile per fare screenshot, mostrare l'app a qualcuno,
  o esplorare funzioni senza paura di sporcare i dati.
- **OFF**: torni ai tuoi dati veri.

Il toggle è **per-dispositivo** (memorizzato nel browser): puoi attivare
demo solo sul telefono mentre il PC continua a vedere i dati reali.

### Cambia password

- Inserisci la password attuale + due volte la nuova (min. 8 caratteri)
- **Attenzione**: il cambio invalida tutte le sessioni attive ovunque tu
  fossi loggato (telefono, altro browser…). Dovrai rifare login.

### Sezioni admin

Se sei admin vedi anche:

- **Server SMTP** → vedi sezione 20
- **Backup &amp; Restore** → vedi sezione 21

---

## 20. SMTP (solo admin)

Per inviare email di invito serve un server SMTP. La configurazione si
gestisce dall'app, **non** dal file `.env`.

### Configurare

1. Vai in **Impostazioni → Server SMTP** (visibile solo agli admin)
2. Compila:
   - **Host**: es. `smtp.gmail.com`, `smtp.zoho.com`, `mail.privateemail.com`
   - **Porta**: tipicamente 587 (STARTTLS) o 465 (TLS implicito)
   - **Modalità sicurezza**:
     - *STARTTLS*: per porta 587
     - *TLS implicito*: per porta 465
   - **Username** e **Password** (la password è cifrata at-rest in DB con
     AES-256-GCM derivata dal segreto JWT)
   - **Mittente (email)**: indirizzo che apparirà nel "From"
   - **Mittente (nome)**: es. "Finance Manager"
3. Clicca **Salva**

### Testare

C'è un campo **"Invia email di test"**: inserisci un'email tua, premi
*Invia test*, e ricevi una mail di prova entro pochi secondi. Se non arriva,
controlla nei log del backend l'eventuale errore SMTP (host/porta/credenziali
errate, blocchi del provider, ecc).

### Modificare la password

Il campo password mostra "•••••• salvata 🔒" se è già stata configurata.
Lascialo vuoto per mantenerla invariata, oppure digitane una nuova per
sostituirla.

### Rimuovere

Pulsante **Rimuovi** elimina la configurazione: gli inviti continueranno a
funzionare ma il sistema **non** invierà email — l'admin dovrà copiare
manualmente il link `/accept-invite?token=...` all'invitato.

> 💡 Sicurezza: la password SMTP non è mai ritornata al client. Il sistema
> mostra solo un flag "salvata" nella UI. Un dump del solo database non
> permette di estrarre la password senza conoscere anche `JWT_ACCESS_SECRET`.

---

## 21. Backup e ripristino (solo admin)

In **Impostazioni → Backup &amp; Restore**.

### Scaricare il backup

Pulsante **Scarica backup .zip**. Il file contiene:

- `manifest.json` (versione e timestamp)
- `data/<tabella>.json` per ogni tabella (utenti, conti, movimenti, allegati,
  ricorrenze, budget, obiettivi, chat, audit log, …)
- `blobs/<chiave>` per ogni allegato (immagini e PDF da MinIO)

In pratica è una **fotografia completa** del sistema: dati + allegati. Mettilo
al sicuro su un altro disco / cloud / chiavetta USB.

### Ripristinare da backup

⚠️ **Operazione distruttiva**: il restore **cancella tutti i dati attuali**
(utenti compresi) prima di importare quelli del backup. Tutte le sessioni
diventano invalide e dovrai rifare login.

1. Trascina il `.zip` di backup nella zona dedicata
2. Conferma la finestra di avviso
3. Aspetta (può richiedere qualche minuto se hai molti allegati)
4. A fine operazione vieni disconnesso. Fai login con le credenziali del
   backup.

> 💡 Se il `JWT_ACCESS_SECRET` del server di destinazione è diverso da
> quello che ha generato il backup, le password SMTP non saranno
> decifrabili e dovranno essere reinserite. Tutto il resto funziona.

---

## 22. Installare l'app sul telefono

Finance Manager è una **PWA**: si installa sulla schermata Home come una
vera app, senza passare dagli store.

### Su Android (Chrome)

1. Apri il sito Finance Manager dal telefono
2. Compare un banner in basso "Installa Finance Manager come app", premi
   **Installa**
3. (oppure menu ⋮ → *Installa app*)

### Su iPhone (Safari)

1. Apri il sito Finance Manager
2. Tocca il pulsante **Condividi** (quadrato con freccia in alto)
3. Scegli **Aggiungi alla schermata Home**
4. Conferma

Una volta installata, l'app si apre **a schermo intero** senza barra del
browser, ha la sua icona, e funziona anche per la **lettura offline degli
ultimi movimenti** quando non hai rete (i dati sono cached dal service
worker).

### Layout mobile

Sul telefono la navigazione passa a una **bottom bar** con 5 voci principali
(Dashboard, Conti, Movimenti, Report, Chat). Il resto delle pagine sta nel
menu in alto. Tutto è ottimizzato per pollice.

---

## 23. FAQ

### Posso registrarmi senza invito?
No, di proposito. È pensata per famiglia/gruppo chiuso: solo l'admin invita.

### Ho dimenticato la password
Usa il link **"Password dimenticata?"** sulla pagina di login (vedi
sezione 2). Riceverai un'email con un link di reset valido 1 ora. Se SMTP
non è configurato, l'admin trova il link nei log del backend
(`docker compose logs backend`).

### Ho dimenticato la password admin e SMTP non funziona
Accedi alla macchina dove gira il container e resetta a livello di
database. Da terminale del container: `npm run prisma:seed` rigenera
l'utente admin solo se non esiste — quindi prima cancella l'admin
(`docker compose exec postgres psql -U finance -d finance_manager -c "DELETE FROM users WHERE email='admin@example.com'"`)
oppure modifica `passwordHash` con una hash argon2 valida.

### Le mie spese si vedono dagli altri membri condivisi?
Solo le spese sui **conti che hai condiviso**. I tuoi conti personali
restano completamente privati. Anche le **categorie**, i **budget**, gli
**obiettivi** e le **chat AI** sono sempre personali, non si vedono.

### L'AI ha accesso a Internet?
Dipende dal provider (sezione 18). Con **Ollama (locale)** no: gira sul tuo
server e non manda nulla all'esterno. Con **OpenCode (cloud)** i prompt vengono
inviati ai server OpenCode con la tua API key — attivalo solo se sei a
conforto con questo (i tuoi dati finanziari vengono usati solo per rispondere).

### Posso esportare singoli movimenti?
Per ora puoi solo fare il backup completo (sezione 21). Esportazione
selettiva CSV/Excel è una feature da aggiungere.

### Quanto spazio serve?
- Database: cresce di pochi MB anche con anni di storico
- Allegati: dipende da quanti scontrini carichi (limite 10 MB cad.)
- Modello AI: ~4.5 GB di disco una tantum

### Posso cambiare il modello AI?
Sì, senza toccare `.env` né riavviare nulla: l'admin va in **Impostazioni →
Modello AI locale** (sezione 18), scarica un modello dal catalogo e lo
seleziona come attivo. Il cambio vale subito per chat e categorizzazione.
`OLLAMA_MODEL` in `.env` resta come fallback iniziale se non è mai stato
scelto un modello dall'app.

### La mia banca non è nell'elenco, cosa faccio?
Puoi comunque importare l'estratto conto manualmente in CSV/OFX (sezione
16). Se la tua banca compare in un secondo momento nell'elenco di "Collega
banca" (sezione 17), potrai passare al collegamento automatico senza perdere
lo storico già importato.

### Posso usarlo da più dispositivi contemporaneamente?
Sì. Login da PC + telefono + tablet, tutto in tempo reale.

### Ho problemi con SMTP, come scopro l'errore?
Dai log del container backend: `docker compose logs -f backend`. Cerca
righe con "SMTP" o "Invite email failed".

### I giroconti contano nelle entrate/uscite del report?
No, sono esclusi (sono interni). Contano nel saldo del conto. Se gli
metti una categoria, quella serve solo a etichettarli per ricerca/filtro,
ma resta esclusa dai totali entrate/uscite.

### Le ricorrenze partono da sole?
Sì. Un cron interno gira ogni notte alle **01:00** e genera tutte le
transazioni dovute (anche retroattivamente se il server era spento). Il
pulsante *"Esegui ora"* nella pagina Ricorrenze è un trigger manuale
identico al cron — utile per testare o forzare subito senza aspettare la
notte.

### Cosa fa la "Modalità Demo"?
È un toggle nelle Impostazioni che fa vedere all'app dati simulati
realistici (conti, movimenti, budget…) **senza mai modificare il database
reale**. Le mutation che fai mentre è attiva non hanno effetto. Utile per
demo, screenshot, esplorazione. È per-dispositivo.

### Cosa succede se cambio la `billing_day` di una carta?
Solo i nuovi movimenti useranno il nuovo giorno. Gli addebiti già generati
restano alla loro data originale.

### L'app funziona offline?
In parte: la PWA cachata permette di **leggere** ultimi movimenti
quando sei senza rete. Per **scrivere** serve connessione al backend.

---

## Termini comuni

| Termine | Significato |
|---|---|
| **Movimento** | Una transazione: entrata, uscita o giroconto |
| **Conto** | Un contenitore di soldi: corrente, contanti, carta di credito |
| **Categoria** | Etichetta del movimento per fare report (es. "Spesa", "Auto") |
| **Giroconto** | Trasferimento da un tuo conto a un altro tuo conto |
| **Pending** | Addebito carta di credito non ancora applicato sul conto pagamento |
| **Budget** | Tetto mensile per una categoria di spesa |
| **Obiettivo** | Goal di risparmio (es. vacanze, fondo emergenze) |
| **Ricorrenza** | Movimento automatico generato a frequenza fissa |
| **Backup** | Archivio .zip con tutti i dati e gli allegati |
| **PWA** | Progressive Web App: si installa sul telefono come un'app |
| **Admin** | Utente con permessi extra (inviti, SMTP, backup) |
| **Modalità Demo** | Toggle che mostra dati finti realistici senza toccare il DB reale |
| **Consenso (bancario)** | Autorizzazione data alla banca per leggere (sola lettura) i movimenti di un conto |
| **Da confermare** | Coda di revisione dei movimenti scaricati dalla banca, in attesa di conferma |
| **Privacy mode** | Maschera tutti gli importi con pallini, utile in pubblico |

---

Buona gestione delle tue finanze! 💰
