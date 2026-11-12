# Giacenze

Gestione del magazzino pellet: prodotti, carichi, scarichi e rettifiche, giacenza in sacchi e bancali, scorte minime, andamento degli ultimi 60 giorni ed esportazione CSV.

## Cos'è e cosa cambia rispetto alla pagina di Claude

Questa è la stessa applicazione che usavi nella pagina di Claude, ma ora è un vero sito che puoi aprire da qualsiasi telefono o computer e usare in più persone contemporaneamente.

- **I dati ora stanno in Netlify Database** (un database Postgres) e non più nella pagina di Claude. Tutti vedono gli stessi dati e la pagina si aggiorna da sola ogni pochi secondi.
- **Non c'è nessun codice di accesso.** Chiunque conosca l'indirizzo del sito può vedere e modificare tutto il magazzino. Vedi la nota sulla protezione più sotto.
- **I dati della vecchia pagina non vengono copiati automaticamente.** Il sito parte vuoto: i prodotti e i movimenti vanno reinseriti.
- Netlify Database richiede un **piano Netlify a crediti (Credit-based)** e consuma crediti. La tabella dei dati viene creata automaticamente a ogni pubblicazione: non devi fare nulla.

## Pubblicare il sito (percorso A, consigliato): GitHub + Netlify

1. Crea un repository su GitHub e carica tutti i file di questa cartella.
2. Su Netlify scegli **Add new project > Import from Git** e seleziona il repository. Non servono comandi di build particolari: le impostazioni sono già in `netlify.toml`.
3. Avvia la pubblicazione. Al termine il sito è online.

## Pubblicare il sito (percorso B): Netlify CLI

Serve Node.js installato sul computer.

1. Nella cartella del progetto: `npm install`
2. `netlify login`
3. `netlify init` (collega o crea il progetto su Netlify)
4. `netlify deploy --prod`

Attenzione: se il progetto è anche collegato a GitHub, una pubblicazione manuale con `--prod` viene sostituita dalla pubblicazione successiva fatta con un nuovo caricamento su GitHub.

## Provarlo sul proprio computer

1. `npm install`
2. `netlify dev` e apri l'indirizzo mostrato.

I test automatici della logica del server si lanciano con `npm test`.

## Condividerlo con i dipendenti

Mandate loro l'indirizzo del sito. Su telefono si può aggiungere il sito alla schermata Home.

## Protezione dei dati

L'indirizzo del sito è l'unica protezione: chi lo conosce vede e modifica giacenze, costi e movimenti. Per questo:

- non pubblicare l'indirizzo e condividilo solo con le persone del negozio;
- il sito non compare nei motori di ricerca (`noindex` e `robots.txt`), ma questo non impedisce l'accesso a chi ha il link;
- se serve una protezione vera, si può chiedere di aggiungere di nuovo un codice di accesso, oppure usare la protezione con password di Netlify, se il tuo piano la include. Un progetto Private su Netlify bloccherebbe i dipendenti che non hanno un accesso (seat) Netlify.

## Come è fatto (per chi mantiene il progetto)

- `public/index.html`: l'interfaccia.
- `netlify/functions/api.mts`: l'unica funzione, raggiungibile su `/api/*`.
- `netlify/lib/handler.mjs`: controlli e risposte; `netlify/lib/store.mjs`: tutto l'SQL.
- `netlify/database/migrations/`: struttura del database. Un file già pubblicato non va mai modificato: per cambiare la struttura se ne aggiunge uno nuovo.
