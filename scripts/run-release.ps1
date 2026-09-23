# Canlı çıkış sonrası Jira release'ini tamamlar ve Teams'e bildirir.
# Kullanım:
#   .\scripts\run-release.ps1                                   # interaktif (release listeden seçilir)
#   .\scripts\run-release.ps1 -p OE -v "2026.09.1" --dry-run    # sadece önizleme
#   .\scripts\run-release.ps1 -p OE -v "2026.09.1" -d "2026-09-23 14:30"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js bulunamadı. https://nodejs.org adresinden Node.js 20+ kurun." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Host "Bağımlılıklar kuruluyor (ilk çalıştırma)..." -ForegroundColor Cyan
    npm install --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
if (-not (Test-Path (Join-Path $root '.env'))) {
    Write-Host ".env dosyası yok. .env.example dosyasını .env olarak kopyalayıp doldurun." -ForegroundColor Red
    exit 1
}

& npx --no-install tsx src/cli.ts release @args
exit $LASTEXITCODE
