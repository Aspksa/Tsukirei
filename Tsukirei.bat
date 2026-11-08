@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
set "TSUKIREI_BAT=%~f0"
set "TSUKIREI_ARGS=%*"
where powershell.exe >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Windows PowerShell 5.1 is required.
    pause
    exit /b 10
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:TSUKIREI_BAT,[Text.Encoding]::UTF8);$m='### TSUKIREI_PS_BEGIN ###';$i=$t.LastIndexOf($m);if($i -lt 0){exit 90};& ([ScriptBlock]::Create($t.Substring($i+$m.Length)))"
set "TSUKIREI_EXIT=%ERRORLEVEL%"
if not "%TSUKIREI_EXIT%"=="0" (
    echo.
    echo [Tsukirei] Launcher stopped with code %TSUKIREI_EXIT%.
    echo Press any key to close this window.
    pause >nul
)
exit /b %TSUKIREI_EXIT%
### TSUKIREI_PS_BEGIN ###
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$root = Split-Path -Parent $env:TSUKIREI_BAT
$runtime = Join-Path $root '.runtime'
$logs = Join-Path $root 'logs'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$diagnose = ($env:TSUKIREI_ARGS -split '\s+') -contains '--diagnose'
$noOpen = ($env:TSUKIREI_ARGS -split '\s+') -contains '--no-open'
$help = ($env:TSUKIREI_ARGS -split '\s+') -contains '--help'

function Say([string]$message) { Write-Host "[Tsukirei] $message" }
function Find-App {
    foreach ($relative in @('.', 'frontend', 'web', 'app', 'client')) {
        $dir = [IO.Path]::GetFullPath((Join-Path $root $relative))
        if (Test-Path -LiteralPath (Join-Path $dir 'package.json') -PathType Leaf) { return $dir }
    }
    return $null
}
function Check-Node([string]$exe) {
    if (-not $exe -or -not (Test-Path -LiteralPath $exe -PathType Leaf)) { return $false }
    try {
        $version = (& $exe '--version' 2>$null).Trim()
        if ($version -notmatch '^v(\d+)\.(\d+)\.') { return $false }
        $major = [int]$Matches[1]
        $minor = [int]$Matches[2]
        return ($major -gt 22 -or ($major -eq 22 -and $minor -ge 18))
    } catch { return $false }
}
function Find-Node {
    $portable = Join-Path $runtime 'node'
    if (Test-Path -LiteralPath $portable -PathType Container) {
        foreach ($dir in @(Get-ChildItem -LiteralPath $portable -Directory | Sort-Object Name -Descending)) {
            $exe = Join-Path $dir.FullName 'node.exe'
            if (Check-Node $exe) { return $exe }
        }
    }
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd -and (Check-Node $cmd.Source)) { return $cmd.Source }
    return $null
}
function Install-Node {
    Say 'Node.js 22.18+ не найден. Устанавливаю переносимый Node.js LTS без прав администратора...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $arch = if ([Environment]::Is64BitOperatingSystem) {
        if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
    } else { 'x86' }
    $releases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 30
    $entry = $releases | Where-Object { $_.lts -ne $false -and $_.files -contains "win-$arch-zip" } | Select-Object -First 1
    if (-not $entry) { throw "Не найдена совместимая LTS-версия Node.js для Windows $arch." }
    $version = [string]$entry.version
    $name = "node-$version-win-$arch"
    $folder = Join-Path $runtime 'node'
    $destination = Join-Path $folder $name
    $existing = Join-Path $destination 'node.exe'
    if (Check-Node $existing) { return $existing }
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
    $temporary = Join-Path $folder ('.download-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temporary -Force | Out-Null
    try {
        $base = "https://nodejs.org/dist/$version"
        $zipName = "$name.zip"
        $zip = Join-Path $temporary $zipName
        $sums = Join-Path $temporary 'SHASUMS256.txt'
        Invoke-WebRequest -Uri "$base/$zipName" -OutFile $zip -UseBasicParsing -TimeoutSec 120
        Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -OutFile $sums -UseBasicParsing -TimeoutSec 30
        $line = Get-Content -LiteralPath $sums | Where-Object { $_ -match ('\s+' + [regex]::Escape($zipName) + '$') } | Select-Object -First 1
        if (-not $line) { throw 'Не найдена контрольная сумма SHA-256 архива Node.js.' }
        $expected = ($line -split '\s+')[0].ToLowerInvariant()
        $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($expected -ne $actual) { throw 'Проверка SHA-256 не пройдена. Архив не используется.' }
        Expand-Archive -LiteralPath $zip -DestinationPath $temporary -Force
        $expanded = Join-Path $temporary $name
        if (-not (Check-Node (Join-Path $expanded 'node.exe'))) { throw 'Архив Node.js повреждён или некорректен.' }
        if (-not (Test-Path -LiteralPath $destination)) { Move-Item -LiteralPath $expanded -Destination $destination }
        return (Join-Path $destination 'node.exe')
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue }
    }
}
function Test-Port([int]$number) {
    $tcp = New-Object Net.Sockets.TcpClient
    try {
        $async = $tcp.BeginConnect('127.0.0.1', $number, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(350)) { return $false }
        $tcp.EndConnect($async)
        return $true
    } catch { return $false }
    finally { $tcp.Close() }
}
function Get-ExitText([string]$path) {
    if (Test-Path -LiteralPath $path) { return (Get-Content -LiteralPath $path -Tail 35 -ErrorAction SilentlyContinue | Out-String) }
    return ''
}

if ($help) {
    Say 'Команды: Tsukirei.bat [--diagnose] [--no-open] [--help]'
    Say '--diagnose проверяет окружение без установки и запуска приложения.'
    exit 0
}
Say "Папка проекта: $root"
$app = Find-App
if ($diagnose) {
    Say "Windows PowerShell: $($PSVersionTable.PSVersion)"
    Say "Приложение: $(if ($app) { $app } else { 'пока отсутствует (есть только BAT и README)' })"
    $node = Find-Node
    Say "Node.js 22.18+: $(if ($node) { $node } else { 'не найден; при запуске установится автоматически' })"
    Say "Локальные файлы: $runtime; журналы: $logs"
    Say 'Диагностика завершена.'
    exit 0
}
if (-not $app) {
    Say 'Исходники приложения не найдены. Репозиторий пока пустой — это ожидаемо.'
    Say 'BAT готов. Для запуска сайта нужно добавить исходники и package.json.'
    Say 'Для проверки запустите Tsukirei.bat --diagnose.'
    exit 2
}

$mutex = $null
$process = $null
try {
    New-Item -ItemType Directory -Path $runtime, $logs -Force | Out-Null
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $bytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant())) }
    finally { $sha.Dispose() }
    $name = 'Local\Tsukirei_' + ([BitConverter]::ToString($bytes).Replace('-', '').Substring(0, 24))
    $mutex = [System.Threading.Mutex]::new($false, $name)
    if (-not $mutex.WaitOne(0, $false)) { Say 'Этот экземпляр Tsukirei уже запущен.'; exit 3 }

    $node = Find-Node
    if (-not $node) { $node = Install-Node }
    $env:PATH = (Split-Path -Parent $node) + ';' + $env:PATH
    $npmCli = Join-Path (Split-Path -Parent $node) 'node_modules\npm\bin\npm-cli.js'
    if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) {
        throw "Рядом с Node.js не найден npm CLI: $npmCli"
    }
    $packageFile = Join-Path $app 'package.json'
    $package = Get-Content -LiteralPath $packageFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $script = @('dev', 'start', 'preview') | Where-Object { $package.scripts -and $package.scripts.PSObject.Properties.Name -contains $_ } | Select-Object -First 1
    if (-not $script) { throw 'В package.json нет команды dev, start или preview.' }
    $scriptContent = [string]$package.scripts.$script
    $vite = $scriptContent -match '(?i)(^|\s|/|\\)vite(\s|$)'
    $next = $scriptContent -match '(?i)next\s+dev'
    $defaultPort = if ($vite) { 5173 } else { 3000 }
    $port = $defaultPort
    if ($env:TSUKIREI_PORT) {
        $candidate = 0
        if (-not [int]::TryParse($env:TSUKIREI_PORT, [ref]$candidate) -or $candidate -lt 1024 -or $candidate -gt 65535) {
            throw 'TSUKIREI_PORT должен быть числом от 1024 до 65535.'
        }
        $port = $candidate
    }
    if (-not $env:TSUKIREI_PORT -and (Test-Port $port)) {
        $originalPort = $port
        foreach ($candidate in 3001..3020) {
            if (-not (Test-Port $candidate)) { $port = $candidate; break }
        }
        if ($port -eq $originalPort) { throw 'Все порты 3000–3020 заняты. Укажите свободный TSUKIREI_PORT.' }
        Say "Порт $originalPort занят. Использую свободный порт $port."
    }
    if (Test-Port $port) { throw "Порт $port занят. Закройте другой сервер или укажите свободный TSUKIREI_PORT." }
    $env:PORT = "$port"
    $env:HOST = '127.0.0.1'
    $env:npm_config_cache = Join-Path $runtime 'npm-cache'
    $env:npm_config_update_notifier = 'false'

    $lock = Join-Path $app 'package-lock.json'
    $deps = Join-Path $app 'node_modules'
    $installMarker = Join-Path $runtime ('deps-' + [IO.Path]::GetFileName($app) + '.sha256')
    $depHash = (Get-FileHash -LiteralPath $(if (Test-Path -LiteralPath $lock) { $lock } else { $packageFile }) -Algorithm SHA256).Hash
    $hasPackages = ($package.dependencies -and $package.dependencies.PSObject.Properties.Count -gt 0) -or ($package.devDependencies -and $package.devDependencies.PSObject.Properties.Count -gt 0)
    $installed = ((-not $hasPackages) -or (Test-Path -LiteralPath $deps -PathType Container)) -and (Test-Path -LiteralPath $installMarker -PathType Leaf) -and ((Get-Content -LiteralPath $installMarker -Raw).Trim() -eq $depHash)
    if (-not $installed) {
        Say 'Устанавливаю или обновляю зависимости приложения...'
        Push-Location -LiteralPath $app
        try {
            if (Test-Path -LiteralPath $lock) { & $node $npmCli ci --no-audit --no-fund }
            else { & $node $npmCli install --no-audit --no-fund }
            if ($LASTEXITCODE -ne 0) { throw "Установка npm завершилась с ошибкой (код $LASTEXITCODE)." }
        } finally { Pop-Location }
        $depHash = (Get-FileHash -LiteralPath $(if (Test-Path -LiteralPath $lock) { $lock } else { $packageFile }) -Algorithm SHA256).Hash
        Set-Content -LiteralPath $installMarker -Value $depHash -Encoding Ascii
    }

    $output = Join-Path $logs "$stamp-out.log"
    $errors = Join-Path $logs "$stamp-error.log"
    $args = '"' + $npmCli + '" run ' + $script
    if ($vite) { $args += " -- --host 127.0.0.1 --port $port --strictPort" }
    elseif ($next) { $args += " -- --hostname 127.0.0.1 --port $port" }
    Say "Запускаю npm run $script, порт $port..."
    Say "Журналы: $output и $errors"
    $process = Start-Process -FilePath $node -ArgumentList $args -WorkingDirectory $app -RedirectStandardOutput $output -RedirectStandardError $errors -NoNewWindow -PassThru
    $url = "http://127.0.0.1:$port/"
    $ready = $false
    for ($seconds = 0; $seconds -lt 60; $seconds++) {
        $process.Refresh()
        if ($process.HasExited) { break }
        if (Test-Port $port) {
            try {
                $response = Invoke-WebRequest -Uri $url -TimeoutSec 3 -UseBasicParsing
                if ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 400) {
                    $health = Invoke-RestMethod -Uri ($url + 'api/health') -TimeoutSec 3
                    if ($health.ok -eq $true -and $health.name -eq 'Tsukirei') {
                        $ready = $true
                        break
                    }
                }
            } catch { }
        }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) {
        Say 'Сервер не открылся. Последние строки журналов:'
        Write-Host (Get-ExitText $errors)
        Write-Host (Get-ExitText $output)
        throw 'Приложение не запустилось. Посмотрите ошибки выше.'
    }
    Say "Сервер готов: $url"
    if (-not $noOpen) {
        try { Start-Process $url | Out-Null }
        catch { Say "Браузер не открылся автоматически. Откройте вручную: $url" }
    }
    Say 'Для остановки нажмите Ctrl+C в этом окне.'
    while (-not $process.HasExited) { Start-Sleep -Seconds 1; $process.Refresh() }
    Say "Сервер остановлен (код $($process.ExitCode))."
    if ($process.ExitCode -ne 0) { Write-Host (Get-ExitText $errors); exit $process.ExitCode }
} catch {
    Say "ОШИБКА: $($_.Exception.Message)"
    try {
        New-Item -ItemType Directory -Path $logs -Force | Out-Null
        Add-Content -LiteralPath (Join-Path $logs 'launcher-errors.log') -Value "[$(Get-Date -Format o)] $($_ | Out-String)" -Encoding UTF8
    } catch { }
    exit 1
} finally {
    if ($process) {
        try { $process.Refresh(); if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } } catch { }
        $process.Dispose()
    }
    if ($mutex) {
        try { $mutex.ReleaseMutex() } catch { }
        $mutex.Dispose()
    }
}
exit 0
