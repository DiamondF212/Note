# Timer in background su Android

Il conto alla rovescia usa `@capacitor/local-notifications`: alla pressione di «Avvio» viene
programmata una notifica di sistema alla scadenza, che suona anche con schermo spento o app chiusa.

Dopo `npm install`:

1. `npm run android:sync`
2. In `android/app/src/main/AndroidManifest.xml` (creato da `cap add android`) aggiungi, accanto agli altri `<uses-permission>`:
   `<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />`
   (serve per far suonare l'avviso al secondo esatto su Android 12+; senza, l'avviso può slittare di qualche minuto).
3. Al primo avvio l'app chiede il permesso per le notifiche (Android 13+): va concesso.

Nel browser/PWA non esistono allarmi di sistema affidabili: il tempo è calcolato su orari assoluti
(non si sfasa mai) e il controllo gira in un Web Worker, ma la scadenza viene segnalata solo finché
il browser mantiene viva la pagina.
