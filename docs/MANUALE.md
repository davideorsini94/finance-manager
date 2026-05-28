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
17. [Impostazioni](#17-impostazioni)
18. [Configurazione email (SMTP, solo admin)](#18-smtp-solo-admin)
19. [Backup e ripristino (solo admin)](#19-backup-e-ripristino-solo-admin)
20. [Installare l'app sul telefono](#20-installare-lapp-sul-telefono)
21. [Domande frequenti](#21-faq)

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
- Importare **estratti conto in CSV o OFX** dalla banca
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
2. Ricevi un link di reset (richiede SMTP configurato — sezione 18)
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
   valido **48 ore**. Se non hai ancora configurato SMTP (vedi sezione 18)
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

### Filtri di periodo

In alto a destra:

- Preset rapidi: **7g**, **30g**, **90g**, **YTD** (year-to-date)
- Date custom da/a per intervalli arbitrari

### Grafici

- **Andamento patrimonio**: area chart del saldo cumulativo nel periodo
- **Spese per categoria**: pie chart con i colori delle categorie
- **Entrate vs uscite**: bar chart per giornata

### Ultime operazioni

Lista degli ultimi 10 movimenti, con tono colorato (verde entrate, rosso
uscite, grigio giroconti).

---

## 14. Report e confronti

Pagina **Report**, due modalità:

### Riepilogo annuale

- Scegli l'anno
- Vedi totali entrate/uscite/netto dell'intero anno
- Bar chart con i 12 mesi affiancati
- Lista delle top categorie con percentuale e barra

### Confronto periodi

Imposta due intervalli di date arbitrari (es. *Aprile vs Maggio*, *2025 vs
2026*) e confrontali side-by-side:

- Totali per ogni periodo
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

## 17. Impostazioni

Pagina **Impostazioni** (icona ingranaggio nella nav).

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

- **Server SMTP** → vedi sezione 18
- **Backup &amp; Restore** → vedi sezione 19

---

## 18. SMTP (solo admin)

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

## 19. Backup e ripristino (solo admin)

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

## 20. Installare l'app sul telefono

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

## 21. FAQ

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
No. Gira interamente in locale (Ollama). Non manda nulla all'esterno.

### Posso esportare singoli movimenti?
Per ora puoi solo fare il backup completo (sezione 19). Esportazione
selettiva CSV/Excel è una feature da aggiungere.

### Quanto spazio serve?
- Database: cresce di pochi MB anche con anni di storico
- Allegati: dipende da quanti scontrini carichi (limite 10 MB cad.)
- Modello AI: ~4.5 GB di disco una tantum

### Posso cambiare il modello AI?
Sì: l'admin del server modifica `OLLAMA_MODEL` in `.env` e riavvia il
container. Modelli compatibili: tutti quelli supportati da Ollama con tool
calling (es. `qwen2.5:7b`, `llama3.1:8b`).

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
| **Privacy mode** | Maschera tutti gli importi con pallini, utile in pubblico |

---

Buona gestione delle tue finanze! 💰
