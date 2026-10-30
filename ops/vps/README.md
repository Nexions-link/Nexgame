# NexGameWorld VPS staging (НЕ запускать production)
Server: 94.103.87.93, Ubuntu 24.04. Keep TeamSpeak unchanged.
The server is currently listening on 0.0.0.0. Do not start until a bind-address fix or firewall protection is verified.
The existing Neon DB must not be used concurrently by two live world servers.
The shared/server.env must be created locally on VPS (mode 0600) and must NEVER be committed.
The workflow is manual and performs only SSH verification; it never starts the game.
Owner (root), once: install -d -o ngw-deploy -g ngw-deploy -m 750 /opt/nexgameworld/{releases,shared}
Owner (root), once: install -m 644 ops/vps/nexgameworld.service /etc/systemd/system/nexgameworld.service && systemctl daemon-reload
Do NOT enable/start this unit yet. A root-managed systemd unit cannot be restarted by ngw-deploy without a narrowly scoped sudoers rule.
For first SSH check, GitHub Actions secret SSH_PRIVATE_KEY is required. Verify fingerprint independently: SHA256:l6vDF6OA5Oy7oadrp7w9QNFzySIf9TftJVm3a5hdUwk.
Follow-up: implement safe artifact deployment, secure loopback binding, database configuration and HTTPS/WSS before production switch.
