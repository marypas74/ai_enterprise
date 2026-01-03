# Shared Storage Setup for Enterprise AI Chat

Questa guida spiega come configurare lo storage condiviso per i progetti, accessibile sia da Windows che da Linux.

## Prerequisiti

- Ubuntu Server con MicroK8s
- Accesso sudo
- Rete accessibile da Windows

## Step 1: Preparare la Partizione

### Opzione A: Usare una partizione esistente

Se hai già una partizione dedicata (es. `/dev/sdb1`), montala:

```bash
# Crea il punto di mount
sudo mkdir -p /data/shared-projects

# Monta la partizione (sostituisci /dev/sdb1 con la tua partizione)
sudo mount /dev/sdb1 /data/shared-projects

# Aggiungi a /etc/fstab per mount automatico al boot
echo "/dev/sdb1 /data/shared-projects ext4 defaults 0 2" | sudo tee -a /etc/fstab
```

### Opzione B: Usare una directory esistente

La directory verrà creata automaticamente dallo script.

## Step 2: Eseguire lo Script di Setup

```bash
cd /home/mpasqui/enterprise-ai-chat
chmod +x scripts/setup-shared-storage.sh
sudo ./scripts/setup-shared-storage.sh /data/shared-projects
```

## Step 3: Configurare la Password Samba

```bash
# Imposta password per l'utente ai-chat
sudo smbpasswd -a ai-chat

# Oppure aggiungi il tuo utente esistente
sudo usermod -aG ai-chat $USER
sudo smbpasswd -a $USER
```

## Step 4: Applicare le Configurazioni Kubernetes

```bash
# Crea il PersistentVolume e PersistentVolumeClaim
sudo microk8s kubectl apply -f k8s/storage/shared-projects-pv.yaml

# Verifica che siano stati creati
sudo microk8s kubectl get pv
sudo microk8s kubectl get pvc -n enterprise-ai-chat

# Riavvia il backend per montare il volume
sudo microk8s kubectl rollout restart deployment/backend -n enterprise-ai-chat
```

## Step 5: Accesso da Windows

1. Apri Esplora File
2. Nella barra degli indirizzi inserisci: `\\IP_SERVER\projects`
   - Esempio: `\\192.168.1.123\projects`
3. Inserisci le credenziali configurate nello Step 3
4. (Opzionale) Clicca destro → "Connetti unità di rete" per montare come disco

## Step 6: Accesso da Linux

```bash
# Installa cifs-utils
sudo apt install cifs-utils

# Crea punto di mount
sudo mkdir -p /mnt/projects

# Monta la condivisione
sudo mount -t cifs //192.168.1.123/projects /mnt/projects -o username=ai-chat,password=TUA_PASSWORD

# Per mount automatico, aggiungi a /etc/fstab:
# //192.168.1.123/projects /mnt/projects cifs username=ai-chat,password=TUA_PASSWORD 0 0
```

## Struttura Directory Consigliata

```
/data/shared-projects/
├── agents/              # Working directories per agent sessions
│   ├── session_1/
│   ├── session_2/
│   └── ...
├── repositories/        # Repository git clonati
│   ├── project-a/
│   └── project-b/
└── uploads/            # File caricati dagli utenti
```

## Troubleshooting

### Il pod backend non si avvia
```bash
# Verifica stato PVC
sudo microk8s kubectl describe pvc shared-projects-pvc -n enterprise-ai-chat

# Verifica stato PV
sudo microk8s kubectl describe pv shared-projects-pv

# Verifica eventi del pod
sudo microk8s kubectl describe pod -l app=backend -n enterprise-ai-chat
```

### Windows non riesce a connettersi
```bash
# Verifica che Samba sia in esecuzione
sudo systemctl status smbd

# Verifica la configurazione
testparm

# Controlla i log
sudo tail -f /var/log/samba/log.smbd
```

### Permessi file errati
```bash
# Reimposta i permessi
sudo chown -R ai-chat:ai-chat /data/shared-projects
sudo chmod -R 2775 /data/shared-projects
```
