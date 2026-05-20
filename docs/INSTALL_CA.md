# Installazione Certificato Internal CA (Enterprise AI Chat)

**Quando**: hai aperto `https://aia2.lan` e il browser mostra "Certificato non sicuro" o "ERR_CERT_AUTHORITY_INVALID".

**Soluzione**: importa il certificato CA dell'organizzazione nel tuo browser/sistema operativo. Una volta importato, il browser si fida automaticamente di `aia2.lan` e di tutti i sotto-domini interni firmati dalla CA.

## Step 1 — Scarica la CA

Dalla pagina di login, clicca su **"Scarica Certificato CA (fidati del sito)"**.
Salva il file `enterprise-ai-ca.crt`.

In alternativa via shell:
```bash
curl -kO https://plane.lushlolli.com/api/public/internal-ca.crt
```

## Step 2 — Installa la CA nel sistema operativo

### Chrome / Edge (Windows/macOS/Linux)
Chrome e Edge usano lo store certificati del sistema operativo.

**Windows**:
1. Doppio-clic su `enterprise-ai-ca.crt`
2. Click "Installa certificato"
3. Scegli "Computer locale" → Avanti
4. "Inserisci tutti i certificati nel seguente archivio" → Sfoglia
5. Seleziona **"Autorità di certificazione radice attendibili"** → OK → Avanti → Fine
6. Conferma il dialog di sicurezza Windows

**macOS**:
1. Doppio-clic su `enterprise-ai-ca.crt` (apre Accesso Portachiavi)
2. Trascina il certificato nella categoria **"Sistema"**
3. Doppio-clic sul certificato appena importato
4. Espandi "Fidati" → imposta **"Quando si utilizza questo certificato"** = **"Fidati sempre"**
5. Chiudi (richiede password admin)

**Linux (Debian/Ubuntu)**:
```bash
sudo cp enterprise-ai-ca.crt /usr/local/share/ca-certificates/enterprise-ai-ca.crt
sudo update-ca-certificates
```

**Linux (Fedora/RHEL)**:
```bash
sudo cp enterprise-ai-ca.crt /etc/pki/ca-trust/source/anchors/
sudo update-ca-trust
```

### Firefox (tutte le piattaforme)
Firefox ha uno store certificati proprio, separato da OS.
1. Settings → Privacy & Security → Certificates → **View Certificates**
2. Tab **"Authorities"** → **Import**
3. Seleziona `enterprise-ai-ca.crt`
4. Spunta **"Trust this CA to identify websites"** → OK

### Safari (macOS)
Safari usa lo store macOS — segui istruzioni macOS sopra (Accesso Portachiavi).

## Step 3 — Mobile

### Android
1. Settings → Security → **Install from storage** (o "Encryption & credentials" → "Install a certificate" → "CA certificate")
2. Seleziona `enterprise-ai-ca.crt`
3. Conferma installazione (richiede PIN/password dispositivo)

⚠️ Nota: Android 7+ richiede l'app trusted manualmente o uno **work profile**. Per uso aziendale considera MDM.

### iOS
1. Apri `enterprise-ai-ca.crt` in Safari → "Allow"
2. Settings → General → **VPN & Device Management** → seleziona il profilo "Enterprise AI Chat Internal CA" → Install
3. Settings → General → About → **Certificate Trust Settings**
4. Abilita il toggle per "Enterprise AI Chat Internal CA"

## Step 4 — Verifica

Apri `https://aia2.lan` nel browser. Nessun warning certificato dovrebbe apparire e il lucchetto è verde.

## Sicurezza

- La CA è valida 10 anni. La chiave privata è custodita su `/data/shared-projects/certs/` con permessi `600` (solo root).
- I cert server firmati dalla CA hanno validità 825 giorni (standard browser moderni).
- Disinstallare la CA quando non più necessaria: rimuoverla dallo store del browser/OS.

## Troubleshooting

**"Errore: importa fallito"** → assicurati di selezionare la categoria "Autorità di certificazione radice" (non "Personali" o "Computer").

**"Browser ancora mostra warning"** → riavvia il browser dopo l'import. Chrome può richiedere il restart completo del processo.

**"Mobile dice profilo non firmato"** → su iOS, prima accetta il download in Safari, poi vai in Settings → Profile Downloaded.

## Rigenerazione (admin)

Se la CA o il cert server scadono o sono compromessi:
```bash
sudo bash scripts/generate-ca-and-cert.sh
```
Lo script:
- riusa la CA esistente se presente (per non invalidare cert client già fidati);
- rigenera il server cert con SAN aggiornati;
- aggiorna il Secret K8s `lan-tls`.

Per **rigenerare anche la CA** (in caso di compromissione):
```bash
sudo rm /data/shared-projects/certs/enterprise-ai-ca.{key,crt}
sudo bash scripts/generate-ca-and-cert.sh
```
⚠️ Tutti gli utenti devono reimportare la nuova CA.
