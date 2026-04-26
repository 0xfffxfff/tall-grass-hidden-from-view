# Server Setup — `hiddenfromview.0xfff.love`

The Hono server (`app/server.ts`) runs on a Hetzner VPS, behind Caddy, exposed at
`hiddenfromview.0xfff.love`. The Netlify-hosted SPA at `tallgrass.0xfff.love`
proxies `/api/*` and `/data/*` to this host via `app/public/_redirects`, so the
browser sees a single origin.

This document is the runbook for re-creating the server from scratch and for
shipping updates.

## What lives where

| Component               | Where                                                                |
| ----------------------- | -------------------------------------------------------------------- |
| SPA                     | Netlify (built from `main`)                                          |
| API + FHE oracle + RPC  | Hetzner VPS (this doc)                                               |
| Smart contracts         | Sepolia, deployed at `0xbA9e45F80b17BE1FD070a4E8D132F48c6cF3E3d7`     |
| Oracle / owner wallet   | `0xfFF2E6B9A95e7BfF4a247D799106F0E4a3b7FEed` (on the VPS in `.env`)   |
| FHE secret key          | `app/data/secret.key` on VPS — never in git, shipped over SSH         |

## Prerequisites

1. Hetzner VPS, Ubuntu 24.04, ~8 GB RAM (CCX13 or CPX31).
2. DNS A record `hiddenfromview.0xfff.love` → VPS IP (propagated).
3. Local repo has `app/data/` populated (FHE batch: `secret.key`, `cloud.key`,
   `manifest.json`, `merkle.json`, `entities/*.bin`).
4. Contracts deployed; `contracts/deployments/sepolia/` committed to the repo.
5. Sepolia RPC URL (Alchemy, Infura, etc.).

## One-time bootstrap

### System packages (as root)

```bash
apt update && apt upgrade -y
apt install -y curl ufw debian-keyring debian-archive-keyring \
  apt-transport-https build-essential

# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# Caddy
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# Firewall
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# SSH hardening
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/; s/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh
```

### Service user (as root)

```bash
adduser --disabled-password --gecos "" tallgrass
mkdir -p /home/tallgrass/.ssh
cp ~/.ssh/authorized_keys /home/tallgrass/.ssh/
chown -R tallgrass:tallgrass /home/tallgrass/.ssh
chmod 700 /home/tallgrass/.ssh
chmod 600 /home/tallgrass/.ssh/authorized_keys
```

### Caddy (as root)

```bash
cat > /etc/caddy/Caddyfile <<'EOF'
hiddenfromview.0xfff.love {
    reverse_proxy 127.0.0.1:3000
    encode gzip zstd
    request_body {
        max_size 1MB
    }
}
EOF
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

Caddy fetches a Let's Encrypt cert automatically once DNS resolves. Watch with
`journalctl -u caddy -f` until "certificate obtained".

### GitHub deploy key (as `tallgrass`)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_github -N "" -C "tallgrass@hiddenfromview"
cat ~/.ssh/id_ed25519_github.pub
```

Copy the printed public key. In the GitHub repo: Settings → Deploy keys → Add
deploy key → paste, name it `hiddenfromview`, **leave write access unchecked**.

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/id_ed25519_github
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

ssh -T git@github.com
# expect: "Hi 0xfffxfff/tall-grass-hidden-from-view! You've successfully authenticated..."
```

## Application install

### Clone + install (as `tallgrass`)

```bash
cd ~
git clone git@github.com:0xfffxfff/tall-grass-hidden-from-view.git
cd ~/tall-grass-hidden-from-view/app
npm ci --omit=dev
```

### Ship FHE secrets (laptop → server)

`app/data/` is gitignored (FHE secret key must never enter git). Ship over SSH:

```bash
# from laptop, repo root
rsync -avz --progress app/data/ \
  tallgrass@hiddenfromview.0xfff.love:/home/tallgrass/tall-grass-hidden-from-view/app/data/
```

Then on the server:

```bash
chmod 600 ~/tall-grass-hidden-from-view/app/data/secret.key
```

### `.env` (as `tallgrass`)

```bash
nano ~/tall-grass-hidden-from-view/app/.env
```

```
PORT=3000
NETWORK=sepolia
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<your alchemy key>
ORACLE_PRIVATE_KEY=0x<the same key you deployed contracts with>
DEBUG=0
```

```bash
chmod 600 ~/tall-grass-hidden-from-view/app/.env
```

`NETWORK` selects which `contracts/deployments/<network>/` directory the server
reads `TallGrass.json` from (see `app/config.ts`). For local anvil dev, leave it
unset and it defaults to `localhost`.

### Systemd unit (as root)

```bash
sudo tee /etc/systemd/system/tall-grass.service > /dev/null <<'EOF'
[Unit]
Description=Tall Grass server
After=network.target

[Service]
Type=simple
User=tallgrass
WorkingDirectory=/home/tallgrass/tall-grass-hidden-from-view/app
EnvironmentFile=/home/tallgrass/tall-grass-hidden-from-view/app/.env
ExecStart=/usr/bin/npx tsx server.ts
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/log/tall-grass.log
StandardError=append:/var/log/tall-grass.log

[Install]
WantedBy=multi-user.target
EOF

sudo touch /var/log/tall-grass.log
sudo chown tallgrass /var/log/tall-grass.log
sudo systemctl daemon-reload
sudo systemctl enable --now tall-grass
```

### Verify

On the server:

```bash
sudo journalctl -u tall-grass -f
```

Expect Poseidon → ethers → encounter circuit → FHE WASM (~3s) → decryption
circuit → Merkle data → "Contract connected at 0xbA9e45F8..." → "Recovered N
participants" → event subscribe → **"Server initialization complete."**

From your laptop:

```bash
curl https://hiddenfromview.0xfff.love/api/contract | head -c 300
```

Expect JSON containing `"address":"0xbA9e45F80b17BE1FD070a4E8D132F48c6cF3E3d7"`.

## Future deploys

After committing + pushing changes from the laptop:

```bash
ssh tallgrass@hiddenfromview.0xfff.love \
  'cd ~/tall-grass-hidden-from-view && git pull && cd app && npm ci --omit=dev && sudo systemctl restart tall-grass'
```

If only the SPA changed and not the server, no restart is needed — Netlify
rebuilds and serves automatically from `main`.

If `app/data/` changed (rare — only when regenerating the FHE batch), re-run the
rsync from the laptop and restart.

## Operational notes

- **Logs**: `journalctl -u tall-grass -f` for live, `journalctl -u tall-grass --since "1 hour ago"` for history. Caddy logs are `journalctl -u caddy`.
- **Restart**: `sudo systemctl restart tall-grass`.
- **Status**: `systemctl status tall-grass`.
- **Stop**: `sudo systemctl stop tall-grass` (will not auto-restart until `start`).
- **Rolling back to a previous commit**: `git checkout <sha>` on the server, then restart the service. Don't `git reset --hard` without a reason — the server has no untracked work but check first.
- **Oracle wallet topup**: monitor `0xfFF2E6B9A95e7BfF4a247D799106F0E4a3b7FEed` Sepolia balance. Each relayed move is one tx. Top up before it goes below ~0.01 ETH.

## Security posture

- `app/data/secret.key` is mode 600, owned by `tallgrass`. The FHE secret key never leaves this machine + the artist's laptop.
- `app/.env` is mode 600. Contains `ORACLE_PRIVATE_KEY` (also the contract owner key for now).
- Contract owner can `withdraw`, `setMintPrice`, `setMetadataContract`. Oracle key compromise = full contract control until ownership is rotated.
- VPS is one of the two places the oracle key lives. Rotation plan: deploy new oracle wallet, `grantRoles` to it, `revokeRoles` from the old, update `.env`, restart. Owner change is `transferOwnership(newOwner)`.
